import { describe, expect, it, vi } from "vitest";

import type { ModelConfiguration, ModelProviderAdapter } from "../model/model-contracts.js";
import { ModelGateway } from "../model/model-gateway.js";
import { ModelRequestError } from "../model/model-request-error.js";
import type { ContextSummary, ManagedContextSourceMessage } from "./context-manager.js";
import { RuntimeContextCompactor, type ContextCompactor } from "./runtime-context-compactor.js";

const summary: ContextSummary = {
  artifactRefs: [], commands: [], constraints: [], decisions: [], errors: [], filesChanged: [],
  filesRead: [], goals: ["Continue the current task"], pendingWork: [], rejectedApproaches: [],
  requirements: [], taskStatus: [], testResults: [],
};
const rawSummary = JSON.stringify(summary);
const configuration: ModelConfiguration = {
  apiFormat: "openai-chat-completions", apiKey: "test-key", baseUrl: "https://example.test/v1",
  modelId: "configured-model", reasoningOptions: [{ kind: "effort", displayName: "Low", value: "low" }],
};

function source(runId: string | null, sequence: number, role: "user" | "assistant"): ManagedContextSourceMessage {
  return { attachmentIds: [], attachments: [], content: `${runId}-${sequence}`, role, runId, sequence, toolCallId: null, toolCalls: [] };
}

function turns(count: number): ManagedContextSourceMessage[] {
  return Array.from({ length: count }, (_, index) => [
    source(`run-${index}`, index * 2 + 1, "user"),
    source(`run-${index}`, index * 2 + 2, "assistant"),
  ]).flat();
}

function fixture(override: ContextCompactor | null = null, maxRetries = 2) {
  const controller = new AbortController();
  const completeTurn = vi.fn<ModelProviderAdapter["completeTurn"]>().mockResolvedValue({
    content: rawSummary, finishReason: "stop", toolCalls: [],
  });
  const getConversationTurnSummary = vi.fn<(runId: string) => { summary: string } | null>().mockReturnValue(null);
  const wait = vi.fn<(delayMs: number, signal: AbortSignal) => Promise<void>>().mockResolvedValue();
  const compactor = new RuntimeContextCompactor(
    new ModelGateway({ completeTurn }), { getConversationTurnSummary }, wait, override, maxRetries,
  );
  const input = { configuration, messages: turns(4), previousSummary: "Earlier checkpoint", signal: controller.signal };
  return { compactor, completeTurn, controller, getConversationTurnSummary, input, wait };
}

describe("Runtime context compaction", () => {
  it("reuses each completed turn summary without changing the original coverage or missing turns", async () => {
    const compact = vi.fn<ContextCompactor["compact"]>().mockResolvedValue(rawSummary);
    const { compactor, getConversationTurnSummary, input, completeTurn } = fixture({ compact });
    getConversationTurnSummary.mockImplementation(runId => runId === "run-0" ? { summary: "First turn outcome" } : null);
    const messages = [...input.messages, source(null, 9, "user")];
    const original = structuredClone(messages);
    await expect(compactor.resolve({ ...input, messages, conversationId: "conversation", forceCompaction: false }))
      .resolves.toEqual({ compressedMessageCount: 9, coveredThroughSequence: 9, summary: rawSummary });
    expect(compact.mock.calls[0]?.[0].messages).toEqual([
      { attachmentIds: [], attachments: [], content: "[Completed turn summary]\nFirst turn outcome", role: "assistant", runId: "run-0", sequence: 2, toolCallId: null, toolCalls: [] },
      ...messages.slice(2),
    ]);
    expect(getConversationTurnSummary.mock.calls.flat()).toEqual(["run-0", "run-1", "run-2", "run-3"]);
    expect(messages).toEqual(original);
    expect(completeTurn).not.toHaveBeenCalled();
  });

  it("retries an automatic compaction once with a smaller prefix of complete turns", async () => {
    const failure = new Error("summary rejected");
    const compact = vi.fn<ContextCompactor["compact"]>().mockRejectedValueOnce(failure).mockResolvedValue(rawSummary);
    const { compactor, input } = fixture({ compact });
    await expect(compactor.resolve({ ...input, conversationId: "conversation", forceCompaction: false }))
      .resolves.toEqual({ compressedMessageCount: 4, coveredThroughSequence: 4, summary: rawSummary });
    expect(compact.mock.calls.map(([request]) => request.messages)).toEqual([input.messages, input.messages.slice(0, 4)]);
  });

  it("progressively narrows a manual compaction while retaining the previous checkpoint", async () => {
    const compact = vi.fn<ContextCompactor["compact"]>()
      .mockRejectedValueOnce(new Error("first rejected"))
      .mockRejectedValueOnce(new Error("second rejected"))
      .mockResolvedValue(rawSummary);
    const { compactor, input } = fixture({ compact });
    await expect(compactor.resolve({ ...input, conversationId: "conversation", forceCompaction: true }))
      .resolves.toEqual({ compressedMessageCount: 2, coveredThroughSequence: 2, summary: rawSummary });
    expect(compact.mock.calls.map(([request]) => [request.messages.length, request.previousSummary]))
      .toEqual([[8, "Earlier checkpoint"], [4, "Earlier checkpoint"], [2, "Earlier checkpoint"]]);
  });

  it("does not invent coverage when every complete prefix fails validation", async () => {
    const compact = vi.fn<ContextCompactor["compact"]>().mockResolvedValue("not a summary");
    const { compactor, input } = fixture({ compact });
    await expect(compactor.resolve({ ...input, conversationId: "conversation", forceCompaction: true }))
      .rejects.toThrow("Context compaction did not return a JSON object.");
    expect(compact.mock.calls.map(([request]) => request.messages.length)).toEqual([8, 4, 2]);
  });

  it("rejects empty candidates without reading summaries or requesting the model", async () => {
    const { compactor, input, completeTurn, getConversationTurnSummary } = fixture();
    await expect(compactor.resolve({ ...input, messages: [], conversationId: "conversation", forceCompaction: false }))
      .rejects.toThrow("Context compaction requires at least one completed message.");
    expect(completeTurn).not.toHaveBeenCalled();
    expect(getConversationTurnSummary).not.toHaveBeenCalled();
  });

  it("uses the configured lowest reasoning and bounded reconnect delays without tools", async () => {
    const { compactor, completeTurn, input, wait } = fixture();
    completeTurn.mockRejectedValueOnce(new ModelRequestError(503, "unavailable"))
      .mockRejectedValueOnce(new ModelRequestError(429, "busy"));
    await expect(compactor.compact(input)).resolves.toBe(rawSummary);
    expect(wait.mock.calls).toEqual([[1_000, input.signal], [2_000, input.signal]]);
    expect(completeTurn).toHaveBeenCalledTimes(3);
    for (const [request] of completeTurn.mock.calls) {
      expect(request).toMatchObject({ configuration, reasoning: configuration.reasoningOptions[0], tools: [], maxOutputTokens: 2048, signal: input.signal });
    }
  });

  it("never reconnects a summary request after receiving visible text", async () => {
    const failure = new ModelRequestError(503, "stream disconnected");
    const { compactor, completeTurn, input, wait } = fixture();
    completeTurn.mockImplementationOnce(request => { request.onTextDelta("partial"); return Promise.reject(failure); });
    await expect(compactor.compact(input)).rejects.toBe(failure);
    expect(completeTurn).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("honors cancellation during reconnect backoff", async () => {
    const { compactor, completeTurn, controller, input, wait } = fixture();
    completeTurn.mockRejectedValue(new ModelRequestError(503, "unavailable"));
    wait.mockImplementationOnce(() => { controller.abort(); return Promise.resolve(); });
    await expect(compactor.compact(input)).rejects.toMatchObject({ name: "AbortError" });
    expect(completeTurn).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledOnce();
  });

  it("can disable reconnects for a nonblocking completed-turn summary", async () => {
    const failure = new ModelRequestError(503, "unavailable");
    const { compactor, completeTurn, input, wait } = fixture();
    completeTurn.mockRejectedValue(failure);
    await expect(compactor.compact(input, 0)).rejects.toBe(failure);
    expect(completeTurn).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });

  it("stops after the configured reconnect budget and propagates the last failure", async () => {
    const failure = new ModelRequestError(503, "unavailable");
    const { compactor, completeTurn, input, wait } = fixture();
    completeTurn.mockRejectedValue(failure);
    await expect(compactor.compact(input)).rejects.toBe(failure);
    expect(completeTurn).toHaveBeenCalledTimes(3);
    expect(wait).toHaveBeenCalledTimes(2);
  });

  it.each(["empty", "forbidden"] as const)("does not reconnect a %s response", async kind => {
    const { compactor, completeTurn, input, wait } = fixture();
    if (kind === "empty") completeTurn.mockResolvedValueOnce({ content: "  ", finishReason: "stop", toolCalls: [] });
    else completeTurn.mockRejectedValueOnce(new ModelRequestError(403, "forbidden"));
    await expect(compactor.compact(input)).rejects.toThrow();
    expect(completeTurn).toHaveBeenCalledOnce();
    expect(wait).not.toHaveBeenCalled();
  });
});
