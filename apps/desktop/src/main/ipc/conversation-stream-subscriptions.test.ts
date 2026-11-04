import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { conversationRunEventSchema, type ConversationRunEvent } from "@agent/protocol";
import { ConversationStreamSubscriptions } from "./conversation-stream-subscriptions.js";

const conversationId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const delta = (text: string): Extract<ConversationRunEvent, { type: "assistant.delta" }> => ({ type: "assistant.delta", conversationId, runId,
  messageId: "00000000-0000-4000-8000-000000000003", modelId: "test-model", delta: text });
let streams: ConversationStreamSubscriptions;
beforeEach(() => { vi.useFakeTimers(); streams = new ConversationStreamSubscriptions(); });
afterEach(() => { streams.dispose(); vi.useRealTimers(); });
const target = () => ({ send: vi.fn<(channel: string, event: ConversationRunEvent) => void>(), isDestroyed: () => false });

describe("ConversationStreamSubscriptions", () => {
  it("keeps unopened output in Main and replays the complete text when a view subscribes", () => {
    const view = target();
    streams.publish(view, delta("hello "));
    streams.publish(view, delta("world"));
    vi.advanceTimersByTime(100);
    expect(view.send).not.toHaveBeenCalled();
    streams.subscribe(view, [conversationId]);
    expect(view.send).toHaveBeenCalledExactlyOnceWith("conversation.run_event", { ...delta("hello world"), reset: true });
    expect(conversationRunEventSchema.safeParse(view.send.mock.calls[0]?.[1]).success).toBe(true);
  });

  it("coalesces chunks and flushes them before delivering the terminal event", () => {
    const view = target();
    streams.subscribe(view, [conversationId]);
    streams.publish(view, delta("one"));
    streams.publish(view, delta("two"));
    expect(view.send).not.toHaveBeenCalled();
    vi.advanceTimersByTime(32);
    expect(view.send.mock.calls.map(call => call[1])).toEqual([{ ...delta("onetwo"), reset: false }]);
    streams.publish(view, delta("three"));
    const finished: ConversationRunEvent = { type: "run.finished", conversationId, runId, status: "completed", error: null };
    streams.publish(view, finished);
    expect(view.send.mock.calls.slice(-2).map(call => call[1])).toEqual([{ ...delta("three"), reset: false }, finished]);
    view.send.mockClear();
    streams.subscribe(view, [conversationId]);
    expect(view.send).not.toHaveBeenCalled();
  });

  it("still delivers background status while stopping hidden text pushes", () => {
    const view = target();
    streams.subscribe(view, [conversationId]);
    streams.subscribe(view, []);
    streams.publish(view, delta("background"));
    const started: ConversationRunEvent = { type: "model.request_started", conversationId, runId };
    streams.publish(view, started);
    expect(view.send.mock.calls.map(call => call[1])).toEqual([started]);
  });

  it("retains a reasoning reset when combining subsequent chunks", () => {
    const view = target();
    streams.subscribe(view, [conversationId]);
    const first: ConversationRunEvent = { ...delta("new "), type: "assistant.reasoning_delta", kind: "summary", reset: true };
    streams.publish(view, first);
    streams.publish(view, { ...first, delta: "summary", reset: false });
    vi.advanceTimersByTime(32);
    expect(view.send.mock.calls[0]?.[1]).toMatchObject({ delta: "new summary", reset: true });
  });

  it("bounds background command snapshots and releases them when the command exits after its Run", () => {
    const view = target();
    const output: Extract<ConversationRunEvent, { type: "tool.output_delta" }> = {
      type: "tool.output_delta", conversationId, runId,
      commandId: "00000000-0000-4000-8000-000000000004",
      toolId: "00000000-0000-4000-8000-000000000005",
      delta: "x".repeat(70_000), stream: "stdout", done: false,
      exitCode: null, status: "running", timedOut: false, truncated: false,
    };
    streams.publish(view, output);
    streams.publish(view, { type: "run.finished", conversationId, runId, status: "completed", error: null });
    view.send.mockClear();
    streams.subscribe(view, [conversationId]);
    expect(view.send.mock.calls[0]?.[1]).toMatchObject({ delta: "x".repeat(65_536), reset: true, truncated: true });
    streams.publish(view, { ...output, delta: "", status: "completed", done: true, exitCode: 0 });
    vi.advanceTimersByTime(32);
    expect(view.send.mock.calls.at(-1)?.[1]).toMatchObject({ status: "completed", done: true });
    view.send.mockClear();
    streams.subscribe(view, [conversationId]);
    expect(view.send).not.toHaveBeenCalled();
  });
});
