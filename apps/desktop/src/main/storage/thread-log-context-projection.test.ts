import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";

import { applyContextEvent } from "./thread-log-context-projection.js";
import type { ThreadLogContext, ThreadLogEvent } from "./thread-log-contracts.js";

const timestamp = "2026-10-19T00:00:00.000Z";
const conversationId = randomUUID();

function event(type: ThreadLogEvent["type"], payload: Record<string, unknown>): ThreadLogEvent {
  return { conversationId, createdAt: timestamp, eventId: randomUUID(), payload, sequence: 100, type, version: 1 };
}

function context(): ThreadLogContext {
  return { checkpoint: null, messages: [] };
}

describe("ThreadLog context projection", () => {
  it("maps sparse legacy message positions and their checkpoint into the local context after an existing prefix", () => {
    const state = context();
    applyContextEvent(state, event("run_queued", { runId: "prefix", content: "prefix" }));
    applyContextEvent(state, event("legacy_snapshot_imported", {
      modelMessages: [
        { sequence: 10, role: "user", content: "legacy question", runId: "legacy" },
        { sequence: 20, role: "system", content: "invalid role" },
        { sequence: 30, role: "assistant", content: "legacy call", runId: "legacy",
          toolCalls: [{ id: "call", name: "read_file", arguments: "{}" }, { id: 3 }] },
        { sequence: 50, role: "tool", content: "legacy result", runId: "legacy", toolCallId: "call" },
      ],
      checkpoint: { coveredThroughSequence: 30, summary: "legacy summary" },
    }));

    expect(state.messages.map(message => [message.sequence, message.content]))
      .toEqual([[1, "prefix"], [2, "legacy question"], [3, "legacy call"], [4, "legacy result"]]);
    expect(state.checkpoint).toEqual({
      coveredThroughSequence: 3, summary: "legacy summary", createdAt: timestamp, updatedAt: timestamp,
    });
    expect(state.messages[2]?.toolCalls).toEqual([{ id: "call", name: "read_file", arguments: "{}" }]);
    expect(state.messages[3]?.toolCallId).toBe("call");
  });

  it("removes a superseded branch and its checkpoint while preserving and renumbering another branch", () => {
    const state = context();
    applyContextEvent(state, event("run_queued", { runId: "old", content: "old question" }));
    applyContextEvent(state, event("run_queued", { runId: "kept", content: "kept question" }));
    applyContextEvent(state, event("assistant_message", { runId: "old", content: "old answer" }));
    applyContextEvent(state, event("context_checkpoint", { summary: "contains old branch" }));
    applyContextEvent(state, event("run_superseded", { runId: "old" }));
    expect(state.messages).toEqual([expect.objectContaining({ sequence: 1, content: "kept question", runId: "kept" })]);
    expect(state.checkpoint).toBeNull();
  });

  it("replaces the prior Run with the model-visible replacement and retains other Runs", () => {
    const state = context();
    applyContextEvent(state, event("run_queued", { runId: "old", content: "old" }));
    applyContextEvent(state, event("run_queued", { runId: "other", content: "other" }));
    applyContextEvent(state, event("context_checkpoint", { summary: "previous" }));
    applyContextEvent(state, event("run_replaced", {
      previousRunId: "old", runId: "new", content: "raw", modelContent: "replacement", attachmentIds: ["image", 42],
    }));
    expect(state.messages.map(message => [message.sequence, message.content])).toEqual([[1, "other"], [2, "replacement"]]);
    expect(state.messages[1]?.attachmentIds).toEqual(["image"]);
    expect(state.checkpoint).toBeNull();
  });

  it("keeps queued Agent input hidden until consumption and rejects an unrelated message batch atomically", () => {
    const state = context();
    const messageId = randomUUID();
    applyContextEvent(state, event("agent_message", {
      message: { deliveryMode: "queue" }, modelContent: "queued input",
    }));
    expect(state.messages).toEqual([]);
    expect(() => applyContextEvent(state, event("agent_messages_consumed", {
      messageIds: [messageId], queuedMessages: [
        { messageId, modelContent: "first" }, { messageId: randomUUID(), modelContent: "unrelated" },
      ],
    }))).toThrow("consumed message batch");
    expect(state.messages).toEqual([]);
    applyContextEvent(state, event("agent_messages_consumed", {
      runId: "consumer", messageIds: [messageId], queuedMessages: [{ messageId, modelContent: "queued input" }],
    }));
    expect(state.messages).toEqual([expect.objectContaining({ sequence: 1, content: "queued input", runId: "consumer", role: "user" })]);
  });

  it("keeps provider replay state on Assistant messages and accepts only complete tool-call fields", () => {
    const state = context();
    const providerState = { apiFormat: "openai-responses", baseUrl: "https://example.test/v1", modelId: "fixture", payload: { opaque: "unchanged" } };
    applyContextEvent(state, event("assistant_message", { content: "", providerState,
      toolCalls: [{ id: "call", name: "read_file", arguments: "{}" }, { id: "invalid", name: "read_file" }] }));
    applyContextEvent(state, event("tool_result", { content: "discarded", toolCallId: "" }));
    applyContextEvent(state, event("tool_result", { content: "result", toolCallId: "call" }));
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toMatchObject({ providerState, toolCalls: [{ id: "call", name: "read_file", arguments: "{}" }] });
    expect(state.messages[1]).toMatchObject({ role: "tool", toolCallId: "call", content: "result" });
  });

  it("honors explicit checkpoint coverage and keeps a previous summary when an empty checkpoint arrives", () => {
    const state = context();
    applyContextEvent(state, event("run_queued", { content: "covered" }));
    applyContextEvent(state, event("run_queued", { content: "recent" }));
    applyContextEvent(state, event("context_checkpoint", { summary: "summary", coveredThroughContextSequence: 1 }));
    expect(state.checkpoint?.coveredThroughSequence).toBe(1);
    const previous = state.checkpoint;
    applyContextEvent(state, event("context_checkpoint", { summary: " " }));
    expect(state.checkpoint).toEqual(previous);
    applyContextEvent(state, event("run_superseded", { runId: "unknown" }));
    expect(state.checkpoint).toEqual(previous);
  });

  it.each(["turn", "cancelled"])("projects final %s content but leaves failure receipts out of model history", (assistantKind) => {
    const state = context();
    applyContextEvent(state, event("run_terminal", { assistantKind: "failure", content: "failure diagnostic" }));
    applyContextEvent(state, event("run_terminal", { assistantKind, content: "retained answer", runId: "done" }));
    expect(state.messages).toEqual([expect.objectContaining({ sequence: 1, content: "retained answer", role: "assistant" })]);
  });

  it("keeps UI-only events out of context and validates a group message before changing state", () => {
    const state = context();
    applyContextEvent(state, event("runtime_activity_updated", { content: "diagnostic" }));
    applyContextEvent(state, event("task_list_updated", { content: "task status" }));
    expect(() => applyContextEvent(state, event("group_message", { message: { role: "system", content: "invalid" } }))).toThrow();
    expect(state.messages).toEqual([]);
    applyContextEvent(state, event("group_message", { message: { role: "user", content: "group input" } }));
    expect(state.messages).toEqual([expect.objectContaining({ role: "user", content: "group input", runId: null })]);
  });
});
