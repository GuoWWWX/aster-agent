import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { AgentDatabase } from "../storage/agent-database.js";
import { ThreadLog } from "../storage/thread-log.js";
import { EventProjector } from "../storage/event-projector.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import type { CompleteTurnInput, ModelProviderAdapter, ModelTurnResult } from "../model/model-contracts.js";
import { AgentRuntime } from "./agent-runtime.js";

function runtimeFor(database: AgentDatabase, model: ModelProviderAdapter, log?: ThreadLog, projector?: EventProjector) {
  const projects = new ProjectRegistry(database);
  return new AgentRuntime(database, { getConfiguration: () => ({
    apiKey: "test", apiFormat: "openai-chat-completions", baseUrl: "https://example.test", modelId: "test", reasoningOptions: [],
  }) }, projects, new ProjectToolRegistry(projects), model, undefined, undefined, undefined,
  undefined, undefined, undefined, undefined, undefined, undefined, log, projector);
}

describe("Subagent coordination", () => {
  it("recovers a missing follow-up receipt from its consumed run after restart, without inventing a summary or redelivering", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "subagent-receipt-"));
    const source = new AgentDatabase(":memory:");
    const restored = new AgentDatabase(":memory:");
    try {
      const log = new ThreadLog(directory);
      const projector = new EventProjector(source, log);
      const lifecycle = new ConversationLifecycleService(source, log, projector);
      const parent = lifecycle.createConversation(null);
      const child = lifecycle.createConversation(null);
      const model = { completeTurn: vi.fn(() => Promise.resolve({ content: "不应唤醒", toolCalls: [], finishReason: "stop" as const })) };
      runtimeFor(source, model, log, projector).cancelConversation(parent.id);
      const trigger = source.sendAgentMessage({ senderConversationId: parent.id, targetConversationId: child.id,
        runId: crypto.randomUUID(), content: "请补充验证" });
      log.append(child.id, { type: "agent_message", payload: { message: trigger } });
      const run = source.createRunForAgentMessage(child.id, "test");
      log.append(child.id, { type: "run_created", payload: { runId: run.runId, modelId: "test" } });
      log.append(child.id, { type: "agent_messages_consumed", payload: { runId: run.runId, messageIds: [trigger.id] } });
      log.append(child.id, { type: "run_terminal", payload: { runId: run.runId, status: "completed", result: null,
        error: null, assistantKind: null, content: null, messageId: null, modelId: null } });
      projector.projectConversation(child.id);
      projector.checkpointInactiveConversations();
      const nextProjector = new EventProjector(restored, log);
      nextProjector.projectAllConversationLogs({ releaseHistory: true });
      const runtime = runtimeFor(restored, model, log, nextProjector);
      runtime.resumePendingMessages(() => undefined);
      runtime.resumePendingMessages(() => undefined);
      const messages = restored.listUnreadAgentMessages(parent.id);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatchObject({ runId: run.runId, executionStatus: "completed", summaryStatus: "missing" });
      expect(messages[0]?.content).toContain("未提供总结");
      expect(log.read(parent.id)?.events.filter((event) => event.type === "agent_message")).toHaveLength(1);
      expect(model.completeTurn).not.toHaveBeenCalled();
    } finally { source.close(); restored.close(); await rm(directory, { recursive: true, force: true }); }
  });
  it("stops the owned nested execution tree but not independent conversations", async () => {
    const db = new AgentDatabase(":memory:");
    const parent = db.createConversation(null);
    const child = db.forkConversation(parent.id, "subagent");
    const nested = db.forkConversation(child.id, "subagent");
    const unrelated = db.createConversation(null);
    const started: CompleteTurnInput[] = [];
    const runtime = runtimeFor(db, { completeTurn: (input) => {
      started.push(input);
      return new Promise<ModelTurnResult>((_resolve, reject) => {
        input.signal.addEventListener("abort", () => reject(new DOMException("Cancelled", "AbortError")), { once: true });
      });
    } });
    for (const id of [parent.id, child.id, nested.id, unrelated.id]) runtime.sendMessage({ conversationId: id, content: "等待取消" }, () => undefined);
    await vi.waitFor(() => expect(started).toHaveLength(4));
    runtime.cancelConversation(parent.id);
    await vi.waitFor(() => {
      for (const id of [parent.id, child.id, nested.id]) {
        expect(db.getConversation(id).lastRunStatus).toBe("cancelled");
        expect(db.isConversationExecutionPaused(id)).toBe(true);
      }
    });
    expect(db.getConversation(unrelated.id).activeRunId).not.toBeNull();
    runtime.cancelConversation(unrelated.id);
    await vi.waitFor(() => expect(db.getConversation(unrelated.id).activeRunId).toBeNull());
    await new Promise<void>((resolve) => setImmediate(resolve));
    db.close();
  });

  it("coalesces result receipts into one wake and consumes one durable batch", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "subagent-wake-"));
    const db = new AgentDatabase(":memory:");
    const log = new ThreadLog(directory);
    const projector = new EventProjector(db, log);
    const lifecycle = new ConversationLifecycleService(db, log, projector);
    const parent = lifecycle.createConversation(null);
    const sources = [lifecycle.createConversation(null), lifecycle.createConversation(null)];
    const requests: CompleteTurnInput[] = [];
    const runtime = runtimeFor(db, { completeTurn: (input) => {
      requests.push(input); return Promise.resolve({ content: "已汇总", toolCalls: [], finishReason: "stop" });
    } }, log, projector);
    try {
      for (const [index, source] of sources.entries()) {
        db.sendAgentMessage({ senderConversationId: source.id, targetConversationId: parent.id,
          messageType: "agent_result", content: `结果 ${index}`, runId: crypto.randomUUID(), taskId: null });
        runtime.resumePendingMessages(() => undefined);
      }
      expect(requests).toHaveLength(0);
      await vi.waitFor(() => expect(db.getConversation(parent.id).lastRunStatus).toBe("completed"));
      expect(requests).toHaveLength(1);
      for (const text of ["结果 0", "结果 1"]) expect(JSON.stringify(requests[0]?.messages)).toContain(text);
      expect(log.read(parent.id)?.events.filter((e) => e.type === "agent_messages_consumed")).toHaveLength(1);
      await new Promise<void>((resolve) => setImmediate(resolve));
      projector.checkpointInactiveConversations();
      const restored = new AgentDatabase(":memory:");
      new EventProjector(restored, new ThreadLog(directory)).projectAllConversationLogs({ releaseHistory: true });
      expect(restored.listUnreadAgentMessages(parent.id)).toEqual([]);
      restored.close();
    } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
  });

  it("persists manual stop before a pending wake, retaining unread receipts across restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "subagent-stop-"));
    const db = new AgentDatabase(":memory:");
    const log = new ThreadLog(directory);
    const projector = new EventProjector(db, log);
    const lifecycle = new ConversationLifecycleService(db, log, projector);
    const parent = lifecycle.createConversation(null);
    const source = lifecycle.createConversation(null);
    const completeTurn = vi.fn(() => Promise.resolve({ content: "继续", toolCalls: [], finishReason: "stop" as const }));
    const runtime = runtimeFor(db, { completeTurn }, log, projector);
    try {
      db.sendAgentMessage({ senderConversationId: source.id, targetConversationId: parent.id,
        messageType: "agent_result", content: "迟到结果", runId: crypto.randomUUID(), taskId: null });
      runtime.resumePendingMessages(() => undefined);
      runtime.cancelConversation(parent.id);
      projector.checkpointInactiveConversations();
      const restored = new AgentDatabase(":memory:");
      const nextProjector = new EventProjector(restored, new ThreadLog(directory));
      nextProjector.projectAllConversationLogs({ releaseHistory: true });
      const next = runtimeFor(restored, { completeTurn }, log, nextProjector);
      next.resumePendingMessages(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(completeTurn).not.toHaveBeenCalled();
      expect(restored.listUnreadAgentMessages(parent.id)).toHaveLength(1);
      next.sendMessage({ conversationId: parent.id, content: "现在继续" }, () => undefined);
      await vi.waitFor(() => expect(restored.getConversation(parent.id).lastRunStatus).toBe("completed"));
      expect(completeTurn).toHaveBeenCalledTimes(1);
      expect(restored.isConversationExecutionPaused(parent.id)).toBe(false);
      await new Promise<void>((resolve) => setImmediate(resolve));
      restored.close();
    } finally { db.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
