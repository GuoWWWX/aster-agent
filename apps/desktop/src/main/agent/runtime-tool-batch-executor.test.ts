import { GraphInterrupt } from "@langchain/langgraph";
import { describe, expect, it, vi } from "vitest";
import type { ModelMessageAttachment, ModelToolCall } from "../model/model-contracts.js";
import type { LangChainToolResultEnvelope } from "./runtime-tool-results.js";
import { RuntimeToolCallLedger } from "./runtime-tool-call-ledger.js";
import { executeRuntimeToolBatch, type RuntimeToolBatchOperations } from "./runtime-tool-batch-executor.js";

function toolCall(id: string, name = id): ModelToolCall {
  return { id, name, arguments: "{}" };
}

function result(content: string): LangChainToolResultEnvelope {
  return { activeSkills: [], content, isError: false, marker: "agent-tool-result-v1", successful: true };
}

function fixture(toolCalls: readonly ModelToolCall[]) {
  const controller = new AbortController();
  const ledger = new RuntimeToolCallLedger();
  const getPolicy = vi.fn<RuntimeToolBatchOperations["getPolicy"]>().mockReturnValue({ kind: "serial" });
  const prepare = vi.fn<RuntimeToolBatchOperations["prepare"]>().mockResolvedValue();
  const invokeToolNode = vi.fn<RuntimeToolBatchOperations["invokeToolNode"]>().mockImplementation(calls =>
    Promise.resolve(new Map([...calls].reverse().map(call => [call.id, result(call.id)]))));
  const input = { runId: "run", toolCalls, signal: controller.signal, ledger, operations: { getPolicy, prepare, invokeToolNode } };
  return { controller, ledger, getPolicy, prepare, invokeToolNode, input, execute: () => executeRuntimeToolBatch(input) };
}

describe("Runtime Tool Call batch execution", () => {
  it("prepares every file snapshot before the first tool executes", async () => {
    const calls = [toolCall("file-1", "write_file"), toolCall("read"), toolCall("file-2", "write_file")];
    const f = fixture(calls);
    const order: string[] = [];
    f.getPolicy.mockImplementation(call => ({ kind: "serial", prepareBeforeBatch: call.name === "write_file" }));
    f.prepare.mockImplementation(call => { order.push(`prepare:${call.id}`); return Promise.resolve(); });
    f.invokeToolNode.mockImplementation(chunk => {
      order.push(`execute:${chunk.map(call => call.id).join(",")}`);
      return Promise.resolve(new Map(chunk.map(call => [call.id, result(call.id)])));
    });
    await f.execute();
    expect(order).toEqual(["prepare:file-1", "prepare:file-2", "execute:file-1", "execute:read", "execute:file-2"]);
    expect(new Set(f.prepare.mock.calls.map(([, batchId]) => batchId)).size).toBe(1);
  });

  it.each([
    { group: "read" as const, count: 19, sizes: [8, 8, 3] },
    { group: "command" as const, count: 10, sizes: [4, 4, 2] },
  ])("bounds the $group windows and returns results in input order", async ({ group, count, sizes }) => {
    const calls = Array.from({ length: count }, (_, index) => toolCall(`${group}-${index}`));
    const f = fixture(calls);
    f.getPolicy.mockReturnValue({ kind: "parallel", group });
    const output = await f.execute();
    expect(f.invokeToolNode.mock.calls.map(([chunk]) => chunk.length)).toEqual(sizes);
    expect(f.invokeToolNode.mock.calls.map(([, mode]) => mode)).toEqual(sizes.map(() => "parallel"));
    expect(new Set(f.invokeToolNode.mock.calls.map(([, , batchId]) => batchId)).size).toBe(1);
    expect(output.messages.map(message => [message.toolCallId, message.content])).toEqual(calls.map(call => [call.id, call.id]));
    expect(output.successful).toBe(true);
  });

  it("waits for a parallel window before invoking the next window", async () => {
    const f = fixture(Array.from({ length: 9 }, (_, index) => toolCall(`read-${index}`)));
    f.getPolicy.mockReturnValue({ kind: "parallel", group: "read" });
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => { release = resolve; });
    f.invokeToolNode.mockImplementationOnce(async calls => {
      await gate;
      return new Map(calls.map(call => [call.id, result(call.id)]));
    });
    const output = f.execute();
    expect(f.invokeToolNode).toHaveBeenCalledOnce();
    release();
    await output;
    expect(f.invokeToolNode.mock.calls.map(([chunk]) => chunk.length)).toEqual([8, 1]);
  });

  it("keeps serial boundaries and distinct parallel policy groups in order", async () => {
    const ids = ["read-1", "read-2", "command-1", "command-2", "serial", "read-3"];
    const f = fixture(ids.map(id => toolCall(id)));
    f.getPolicy.mockImplementation(call => call.id === "serial" ? { kind: "serial" }
      : { kind: "parallel", group: call.id.startsWith("read") ? "read" : "command" });
    await f.execute();
    expect(f.invokeToolNode.mock.calls.map(([chunk, mode]) => [chunk.map(call => call.id), mode])).toEqual([
      [["read-1", "read-2"], "parallel"], [["command-1", "command-2"], "parallel"], [["serial"], "serial"], [["read-3"], "parallel"],
    ]);
  });

  it("skips cached calls without recomputing policy or preparing another snapshot", async () => {
    const calls = [toolCall("before"), toolCall("cached", "write_file"), toolCall("after")];
    const f = fixture(calls);
    f.getPolicy.mockReturnValue({ kind: "parallel", group: "read" });
    f.ledger.rememberCompleted({ runId: "run", callId: "cached" }, {
      envelope: result("saved"), message: { attachments: [], content: "saved", role: "tool", toolCallId: "cached", toolCalls: [] },
    });
    const output = await f.execute();
    expect(f.getPolicy.mock.calls.map(([call]) => call.id)).toEqual(["before", "after"]);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.invokeToolNode.mock.calls.map(([chunk]) => chunk.map(call => call.id))).toEqual([["before"], ["after"]]);
    expect(output.messages.map(message => message.content)).toEqual(["before", "saved", "after"]);
  });

  it("turns an invalid policy argument into a prepared failed tool result", async () => {
    const f = fixture([toolCall("invalid")]);
    f.getPolicy.mockImplementation(() => { throw new Error("invalid arguments"); });
    f.invokeToolNode.mockImplementation(calls => {
      const prepared = f.ledger.getPrepared({ runId: "run", callId: "invalid" });
      if (prepared?.kind !== "completed") throw new Error("Expected a prepared error");
      return Promise.resolve(new Map(calls.map(call => [call.id, { ...result(prepared.content), isError: true, successful: false }])));
    });
    const output = await f.execute();
    expect(output.successful).toBe(false);
    expect(f.ledger.getPrepared({ runId: "run", callId: "invalid" })).toMatchObject({ isError: true, kind: "completed" });
    expect(f.invokeToolNode.mock.calls[0]?.[1]).toBe("serial");
    expect(f.prepare).not.toHaveBeenCalled();
  });

  it.each(["abort", "interrupt"] as const)("propagates a policy %s without preparing or invoking tools", async kind => {
    const f = fixture([toolCall("blocked")]);
    const error = kind === "abort" ? new DOMException("stopped", "AbortError") : new GraphInterrupt([]);
    f.getPolicy.mockImplementation(() => { throw error; });
    await expect(f.execute()).rejects.toBe(error);
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.invokeToolNode).not.toHaveBeenCalled();
    expect(f.ledger.getPrepared({ runId: "run", callId: "blocked" })).toBeUndefined();
  });

  it("does not execute any tool when cancelled before batch preparation", async () => {
    const f = fixture([toolCall("write", "write_file")]);
    f.controller.abort();
    await expect(f.execute()).rejects.toMatchObject({ name: "AbortError" });
    expect(f.getPolicy).not.toHaveBeenCalled();
    expect(f.prepare).not.toHaveBeenCalled();
    expect(f.invokeToolNode).not.toHaveBeenCalled();
  });

  it("retains a completed serial side effect when cancellation prevents the next tool", async () => {
    const f = fixture([toolCall("first"), toolCall("second")]);
    f.invokeToolNode.mockImplementationOnce(calls => {
      f.controller.abort();
      return Promise.resolve(new Map(calls.map(call => [call.id, result(call.id)])));
    });
    await expect(f.execute()).rejects.toMatchObject({ name: "AbortError" });
    expect(f.invokeToolNode).toHaveBeenCalledOnce();
    expect(f.ledger.getCompleted({ runId: "run", callId: "first" })?.envelope.content).toBe("first");
    expect(f.ledger.getCompleted({ runId: "run", callId: "second" })).toBeUndefined();
  });

  it("reuses the batch identity and cached side effect after an approval interrupt", async () => {
    const calls = [toolCall("done"), toolCall("approval")];
    const f = fixture(calls);
    const interrupt = new GraphInterrupt([]);
    f.invokeToolNode.mockResolvedValueOnce(new Map([["done", result("done")]])).mockRejectedValueOnce(interrupt);
    await expect(f.execute()).rejects.toBe(interrupt);
    const batchId = f.invokeToolNode.mock.calls[0]?.[2];
    await f.execute();
    expect(f.invokeToolNode.mock.calls.map(([, , id]) => id)).toEqual([batchId, batchId, batchId]);
    expect(f.invokeToolNode.mock.calls.map(([chunk]) => chunk.map(call => call.id))).toEqual([["done"], ["approval"], ["approval"]]);
    expect(f.ledger.getCompleted({ runId: "run", callId: "done" })?.envelope.content).toBe("done");
  });

  it("fails explicitly when ToolNode omits a result instead of misassigning another call", async () => {
    const f = fixture([toolCall("missing", "read_file")]);
    f.invokeToolNode.mockResolvedValueOnce(new Map());
    await expect(f.execute()).rejects.toThrow("ToolNode did not return a result for read_file.");
    expect(f.ledger.getCompleted({ runId: "run", callId: "missing" })).toBeUndefined();
  });

  it("keeps screenshot captions and the latest four returned images in one transient message", async () => {
    const sources: ModelMessageAttachment["source"][] = ["browser", "computer", "generated", "upload", "project", "upload"];
    const images: ModelMessageAttachment[] = sources.map((source, index) => ({
      contextTokens: 1, data: "image-data", id: `image-${index}`, kind: "image", mimeType: "image/png",
      name: `image-${index}.png`, projectPath: null, readState: "preview", source, truncated: false,
    }));
    const f = fixture([toolCall("one"), toolCall("two")]);
    f.invokeToolNode.mockImplementation(calls => Promise.resolve(new Map(calls.map(call => [call.id,
      { ...result(call.id), modelAttachments: call.id === "one" ? images.slice(0, 3) : images.slice(3) }]))));
    const output = await f.execute();
    expect(output.messages).toHaveLength(3);
    expect(output.messages[2]?.attachments).toEqual(images.slice(-4));
    expect(output.messages[2]?.content).toContain("Rendered page screenshots");
    expect(output.messages[2]?.content).toContain("Authorized application window screenshots");
    expect(output.messages[2]?.content).toContain("Images returned by view_attachments");
  });
});
