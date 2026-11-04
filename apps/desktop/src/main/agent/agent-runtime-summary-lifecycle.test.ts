import { afterEach, expect, it, vi } from "vitest";
import type { CompleteTurnInput, ModelProviderAdapter, ModelTurnResult } from "../model/model-contracts.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { AgentRuntime } from "./agent-runtime.js";
import { createLocalTurnSummary } from "./runtime-turn-summary.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, reject, resolve };
}

const summaryResult: ModelTurnResult = {
  content: createLocalTurnSummary([]), finishReason: "stop", toolCalls: [],
};
const cleanups: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) await cleanup();
  vi.restoreAllMocks();
});

function fixture() {
  const database = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(database);
  const tools = new ProjectToolRegistry(projects);
  const summaries: { input: CompleteTurnInput; result: ReturnType<typeof deferred<ModelTurnResult>> }[] = [];
  const model: ModelProviderAdapter = { completeTurn: input => {
    if (input.tools.length > 0) {
      input.onTextDelta("done");
      return Promise.resolve({ content: "done", finishReason: "stop", toolCalls: [] });
    }
    const result = deferred<ModelTurnResult>();
    summaries.push({ input, result });
    return result.promise;
  } };
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({
    apiKey: "fixture-no-network", apiFormat: "openai-chat-completions", baseUrl: "https://fixture.invalid/v1",
    contextWindow: 200_000, modelId: "fixture", reasoningOptions: [],
  }) }, projects, tools, model, undefined, { getConfiguration: () => ({
    mode: "tokens", percentageThreshold: 80, tokenThreshold: 100_000, version: 1,
  }) }, null, null, null, null, null, undefined, null, null, null, null, null, null, null, null,
  { generateTurnSummaries: true });
  const save = vi.spyOn(database, "saveConversationTurnSummary");
  const errors = vi.spyOn(console, "error").mockImplementation(() => undefined);
  let closed = false;
  const close = () => { database.close(); closed = true; };
  cleanups.push(async () => {
    for (const summary of summaries) summary.result.resolve(summaryResult);
    await new Promise<void>(resolve => { setImmediate(resolve); });
    if (!closed) await runtime.stopAllRuns();
    await tools.dispose();
    if (!closed) close();
  });
  async function run(conversationId = database.createConversation(null).id) {
    const expectedSummaries = summaries.length + 1;
    const { runId } = await new Promise<{ runId: string }>(resolve => {
      runtime.sendMessage({ conversationId, content: `long-${"x".repeat(4_000)}` }, event => {
        if (event.type === "run.finished") resolve({ runId: event.runId });
      });
    });
    await vi.waitFor(() => { expect(summaries).toHaveLength(expectedSummaries); });
    // Let executeRun's finally complete, rather than equating run.finished with its drain promise.
    await new Promise<void>(resolve => { setImmediate(resolve); });
    const summary = summaries.at(-1);
    if (summary === undefined) throw new Error("Summary request did not start.");
    return { conversationId, runId, summary };
  }
  return { close, database, errors, run, runtime, save, summaries };
}

it("keeps normal summaries asynchronous and uses the configured background gateway", async () => {
  const f = fixture();
  const { conversationId, summary } = await f.run();
  expect(f.database.getConversation(conversationId).activeRunId).toBeNull();
  expect(f.save).not.toHaveBeenCalled();
  expect(summary.input.signal.aborted).toBe(false);
  expect(summary.input.configuration.modelId).toBe("fixture");
  expect(summary.input.tools).toEqual([]);
  expect(summary.input.maxOutputTokens).toBe(2_048);
  summary.result.resolve(summaryResult);
  await vi.waitFor(() => { expect(f.save).toHaveBeenCalledTimes(1); });
  expect(f.errors).not.toHaveBeenCalled();
});

it("aborts and drains completed-Run summaries before persistence may close", async () => {
  const f = fixture();
  const { summary } = await f.run();
  let drained = false;
  const stopping = f.runtime.stopAllRuns().then(() => { drained = true; });
  await Promise.resolve();
  expect.soft(summary.input.signal.aborted).toBe(true);
  expect.soft(drained).toBe(false);
  summary.result.resolve(summaryResult);
  await stopping;
  f.close();
  await new Promise<void>(resolve => { setImmediate(resolve); });
  expect(f.save).not.toHaveBeenCalled();
  expect(f.errors).not.toHaveBeenCalled();
});

it("does not start a summary when shutdown begins inside the run.finished notification", async () => {
  const f = fixture();
  const conversation = f.database.createConversation(null);
  let stopping: Promise<void> | undefined;
  await new Promise<void>(resolve => {
    f.runtime.sendMessage({ conversationId: conversation.id, content: `long-${"x".repeat(4_000)}` }, event => {
      if (event.type === "run.finished") {
        stopping = f.runtime.stopAllRuns();
        resolve();
      }
    });
  });
  await stopping;
  expect(f.summaries).toHaveLength(0);
  expect(f.save).not.toHaveBeenCalled();
  expect(f.errors).not.toHaveBeenCalled();
});

it.each(["conversation", "run"] as const)("cancels a completed Run's pending summary through the %s entry", async entry => {
  const f = fixture();
  const { conversationId, runId, summary } = await f.run();
  if (entry === "conversation") f.runtime.cancelConversation(conversationId);
  else f.runtime.cancelRun(runId);
  expect.soft(summary.input.signal.aborted).toBe(true);
  summary.result.resolve(summaryResult);
  await new Promise<void>(resolve => { setImmediate(resolve); });
  expect(f.save).not.toHaveBeenCalled();
  expect(f.errors).not.toHaveBeenCalled();
});

it.each([false, true])("discards a late summary after deletion (physical=%s)", async physical => {
  const f = fixture();
  const { conversationId, summary } = await f.run();
  const deletion = f.database.createConversationDeletionTask(conversationId);
  if (physical) {
    f.database.beginConversationDeletionTask(deletion.id);
    f.database.completeConversationDeletionTask(deletion.id);
  }
  summary.result.resolve(summaryResult);
  await new Promise<void>(resolve => { setImmediate(resolve); });
  expect(f.save).not.toHaveBeenCalled();
  expect(f.errors).not.toHaveBeenCalled();
});

it("drains every outstanding summary when successive Runs use one conversation", async () => {
  const f = fixture();
  const first = await f.run();
  const second = await f.run(first.conversationId);
  let drained = false;
  const stopping = f.runtime.stopAllRuns().then(() => { drained = true; });
  expect.soft(first.summary.input.signal.aborted).toBe(true);
  expect.soft(second.summary.input.signal.aborted).toBe(true);
  first.summary.result.resolve(summaryResult);
  await new Promise<void>(resolve => { setImmediate(resolve); });
  expect.soft(drained).toBe(false);
  second.summary.result.resolve(summaryResult);
  await stopping;
  expect(f.save).not.toHaveBeenCalled();
  expect(f.errors).not.toHaveBeenCalled();
});

it("cancels only the targeted conversation's summary", async () => {
  const f = fixture();
  const first = await f.run();
  const second = await f.run();
  f.runtime.cancelConversation(first.conversationId);
  expect.soft(first.summary.input.signal.aborted).toBe(true);
  expect(second.summary.input.signal.aborted).toBe(false);
  first.summary.result.resolve(summaryResult);
  second.summary.result.resolve(summaryResult);
  await vi.waitFor(() => { expect(f.save).toHaveBeenCalledTimes(1); });
  expect(f.save).toHaveBeenCalledWith(expect.objectContaining({ conversationId: second.conversationId }));
  expect(f.errors).not.toHaveBeenCalled();
});

it("suppresses expected summary abort errors while draining", async () => {
  const f = fixture();
  const { summary } = await f.run();
  const stopping = f.runtime.stopAllRuns();
  summary.result.reject(new DOMException("cancelled", "AbortError"));
  await stopping;
  expect(f.save).not.toHaveBeenCalled();
  expect(f.errors).not.toHaveBeenCalled();
});

it("reports a genuine summary provider failure and still releases its job", async () => {
  const f = fixture();
  const { summary } = await f.run();
  summary.result.reject(new Error("fixture summary failure"));
  await vi.waitFor(() => { expect(f.errors).toHaveBeenCalledTimes(1); });
  await f.runtime.stopAllRuns();
  expect(f.save).not.toHaveBeenCalled();
});
