import { describe, expect, it, vi } from "vitest";
import type { ConversationToolItem } from "@agent/protocol";
import type { ToolExecution } from "../tools/project-tool-registry.js";
import type { CachedGraphToolResult, LangChainToolResultEnvelope } from "./runtime-tool-results.js";
import { RuntimeToolCallLedger } from "./runtime-tool-call-ledger.js";

const call = { runId: "run-1", callId: "call-1" };
const envelope: LangChainToolResultEnvelope = {
  activeSkills: [], content: "done", isError: false, marker: "agent-tool-result-v1", successful: true,
};
const completed: CachedGraphToolResult = {
  envelope, message: { attachments: [], content: "done", role: "tool", toolCallId: call.callId, toolCalls: [] },
};
const started: ConversationToolItem = {
  arguments: "{}", batchId: "batch", conversationId: "conversation", createdAt: "2026-10-19T00:00:00.000Z",
  diff: null, executionMode: "serial", id: "tool", kind: "tool", name: "write_file", result: null, runId: call.runId, status: "running",
};
const prepared: ToolExecution = { content: "prepared", isError: false, kind: "completed" };

function deferred<T>() {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("Runtime Tool Call replay ledger", () => {
  it("shares an in-flight execution between simultaneous replays", async () => {
    const ledger = new RuntimeToolCallLedger();
    const work = deferred<LangChainToolResultEnvelope>();
    const execute = vi.fn(() => work.promise);
    const first = ledger.executeOnce(call, execute);
    const replay = ledger.executeOnce(call, execute);
    expect(replay).toBe(first);
    expect(execute).toHaveBeenCalledOnce();
    work.resolve(envelope);
    await expect(first).resolves.toBe(envelope);
    await expect(replay).resolves.toBe(envelope);
  });

  it("replays a completed result without executing another side effect", async () => {
    const ledger = new RuntimeToolCallLedger();
    ledger.rememberCompleted(call, completed);
    const execute = vi.fn(() => Promise.resolve(envelope));
    await expect(ledger.executeOnce(call, execute)).resolves.toBe(envelope);
    expect(ledger.getCompleted(call)).toBe(completed);
    expect(execute).not.toHaveBeenCalled();
  });

  it("retains started identity, prepared snapshot and durable intent across a rejected interrupt", async () => {
    const ledger = new RuntimeToolCallLedger();
    ledger.rememberStarted(call, started);
    ledger.rememberPrepared(call, prepared);
    ledger.recordExecutionIntent(call);
    await expect(ledger.executeOnce(call, () => Promise.reject(new Error("approval interrupt")))).rejects.toThrow("approval interrupt");
    expect(ledger.getStarted(call)).toBe(started);
    expect(ledger.getPrepared(call)).toBe(prepared);
    expect(ledger.hasExecutionIntent(call)).toBe(true);
    const execute = vi.fn(() => Promise.resolve(envelope));
    await expect(ledger.executeOnce(call, execute)).resolves.toBe(envelope);
    expect(execute).toHaveBeenCalledOnce();
  });

  it("releases in-flight failures so a subsequent resume can execute", async () => {
    const ledger = new RuntimeToolCallLedger();
    const failure = new Error("execution failed");
    const execute = vi.fn<() => Promise<LangChainToolResultEnvelope>>()
      .mockRejectedValueOnce(failure).mockResolvedValue(envelope);
    await expect(ledger.executeOnce(call, execute)).rejects.toBe(failure);
    await expect(ledger.executeOnce(call, execute)).resolves.toBe(envelope);
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("releases started and prepared state while retaining completion and intent", () => {
    const ledger = new RuntimeToolCallLedger();
    ledger.rememberStarted(call, started);
    ledger.rememberPrepared(call, prepared);
    ledger.recordExecutionIntent(call);
    ledger.rememberCompleted(call, completed);
    ledger.releasePreparation(call);
    expect(ledger.getStarted(call)).toBeUndefined();
    expect(ledger.getPrepared(call)).toBeUndefined();
    expect(ledger.getCompleted(call)).toBe(completed);
    expect(ledger.hasExecutionIntent(call)).toBe(true);
  });

  it("keeps batch identity through a resume and releases only the completed batch", () => {
    const ledger = new RuntimeToolCallLedger();
    const first = ledger.batchId(call.runId, ["one", "two"]);
    const second = ledger.batchId(call.runId, ["three"]);
    expect(ledger.batchId(call.runId, ["one", "two"])).toBe(first);
    expect(second).not.toBe(first);
    ledger.releaseBatch(call.runId, ["one", "two"]);
    expect(ledger.batchId(call.runId, ["one", "two"])).not.toBe(first);
    expect(ledger.batchId(call.runId, ["three"])).toBe(second);
  });

  it("isolates the same provider Call ID across Runs", async () => {
    const ledger = new RuntimeToolCallLedger();
    const other = { ...call, runId: "run-2" };
    ledger.rememberCompleted(call, completed);
    ledger.rememberPrepared(call, prepared);
    const execute = vi.fn(() => Promise.resolve(envelope));
    await expect(ledger.executeOnce(other, execute)).resolves.toBe(envelope);
    expect(execute).toHaveBeenCalledOnce();
    expect(ledger.getPrepared(other)).toBeUndefined();
    expect(ledger.batchId(call.runId, [call.callId])).not.toBe(ledger.batchId(other.runId, [call.callId]));
  });

  it("disposes every replay fact for one Run without clearing another Run", () => {
    const ledger = new RuntimeToolCallLedger();
    const other = { runId: "run-10", callId: call.callId };
    for (const identity of [call, other]) {
      ledger.rememberStarted(identity, started);
      ledger.rememberPrepared(identity, prepared);
      ledger.rememberCompleted(identity, completed);
      ledger.recordExecutionIntent(identity);
    }
    const batch = ledger.batchId(call.runId, [call.callId]);
    const otherBatch = ledger.batchId(other.runId, [call.callId]);
    ledger.disposeRun(call.runId);
    expect(ledger.getStarted(call)).toBeUndefined();
    expect(ledger.getPrepared(call)).toBeUndefined();
    expect(ledger.getCompleted(call)).toBeUndefined();
    expect(ledger.hasExecutionIntent(call)).toBe(false);
    expect(ledger.batchId(call.runId, [call.callId])).not.toBe(batch);
    expect(ledger.getStarted(other)).toBe(started);
    expect(ledger.getPrepared(other)).toBe(prepared);
    expect(ledger.getCompleted(other)).toBe(completed);
    expect(ledger.hasExecutionIntent(other)).toBe(true);
    expect(ledger.batchId(other.runId, [call.callId])).toBe(otherBatch);
  });

  it("does not let an old settled promise clear a newer in-flight execution after disposal", async () => {
    const ledger = new RuntimeToolCallLedger();
    const old = deferred<LangChainToolResultEnvelope>();
    const current = deferred<LangChainToolResultEnvelope>();
    const first = ledger.executeOnce(call, () => old.promise);
    ledger.disposeRun(call.runId);
    const second = ledger.executeOnce(call, () => current.promise);
    old.resolve(envelope);
    await first;
    const execute = vi.fn(() => Promise.resolve(envelope));
    expect(ledger.executeOnce(call, execute)).toBe(second);
    expect(execute).not.toHaveBeenCalled();
    current.resolve(envelope);
    await second;
  });

  it("makes a persisted completion observable to a reentrant UI notification before execution returns", async () => {
    const ledger = new RuntimeToolCallLedger();
    const duplicate = vi.fn(() => Promise.resolve(envelope));
    const notify = vi.fn(() => ledger.executeOnce(call, duplicate));
    const first = ledger.executeOnce(call, () => {
      ledger.rememberCompleted(call, completed);
      void notify();
      return Promise.resolve(envelope);
    });
    await expect(first).resolves.toBe(envelope);
    expect(notify).toHaveBeenCalledOnce();
    expect(duplicate).not.toHaveBeenCalled();
  });
});
