// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ConversationRunEvent } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { LiveProviderCacheStatus } from "./live-provider-cache-status.js";

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); document.body.replaceChildren(); vi.unstubAllGlobals(); });

it("shows first-token timing immediately, throttles estimates and releases its timer after completion", () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new MockAgentClient();
  let emit: (event: ConversationRunEvent) => void = () => {};
  const unsubscribe = vi.fn();
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { emit = listener; return unsubscribe; });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<TooltipProvider><LiveProviderCacheStatus agentClient={client} conversationId="conversation" usage={null} /></TooltipProvider>));
  const metric = (selector: string) => container.querySelector(selector)?.textContent;
  act(() => emit({ type: "model.request_started", conversationId: "conversation", runId: "run", estimatedInputTokens: 1200 }));
  expect(metric('[data-token-direction="up"]')).toContain("≈1.2K");
  act(() => emit({ type: "model.first_token_received", conversationId: "conversation", runId: "run", latencyMs: 250 }));
  expect(metric('[data-cache-metric="首字"]')).toContain("250ms");
  act(() => {
    for (let index = 0; index < 100; index++) emit({ type: "assistant.delta", conversationId: "conversation", runId: "run", modelId: "model", messageId: "message", delta: "abcd" });
  });
  expect(metric('[data-token-direction="down"]')).toContain("≈0");
  act(() => { vi.advanceTimersByTime(1000); });
  expect(metric('[data-token-direction="down"]')).toContain("≈113");
  expect(metric('[data-cache-metric="速度"]')).toContain("≈113.0 tok/s");
  act(() => emit({ type: "assistant.delta", conversationId: "other", runId: "run", modelId: "model", messageId: "message", delta: "ignored" }));
  act(() => emit({ type: "run.finished", conversationId: "conversation", runId: "run", status: "completed", error: null }));
  expect(vi.getTimerCount()).toBe(0);
  expect(metric('[data-token-direction="down"]')).toContain("--");
  act(() => root.unmount());
  expect(unsubscribe).toHaveBeenCalledOnce();
});

it("resets each request, excludes progress labels and ignores completion of an older Run", () => {
  vi.useFakeTimers(); vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const client = new MockAgentClient();
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { emit = listener; return () => {}; });
  const container = document.createElement("div"); document.body.append(container);
  const root = createRoot(container);
  act(() => root.render(<TooltipProvider><LiveProviderCacheStatus agentClient={client} conversationId="conversation" usage={null} /></TooltipProvider>));
  act(() => {
    emit({ type: "model.request_started", conversationId: "conversation", runId: "old" });
    emit({ type: "model.request_started", conversationId: "conversation", runId: "new", estimatedInputTokens: 200 });
    emit({ type: "assistant.reasoning_delta", conversationId: "conversation", runId: "new", modelId: "model", messageId: "message", kind: "content", reset: true, delta: "ab" });
    emit({ type: "assistant.reasoning_delta", conversationId: "conversation", runId: "new", modelId: "model", messageId: "message", kind: "content", reset: true, delta: "abcd" });
    emit({ type: "assistant.reasoning_delta", conversationId: "conversation", runId: "new", modelId: "model", messageId: "message", kind: "progress", reset: false, delta: "not model tokens" });
    emit({ type: "run.finished", conversationId: "conversation", runId: "old", status: "completed", error: null });
    vi.advanceTimersByTime(1000);
  });
  expect(vi.getTimerCount()).toBe(1);
  expect(container.querySelector('[data-token-direction="down"]')?.textContent).toContain("≈2");
  act(() => emit({ type: "run.finished", conversationId: "conversation", runId: "new", status: "cancelled", error: null }));
  expect(vi.getTimerCount()).toBe(0);
  act(() => emit({ type: "model.request_started", conversationId: "conversation", runId: "third" }));
  expect(vi.getTimerCount()).toBe(1);
  act(() => root.unmount());
  expect(vi.getTimerCount()).toBe(0);
});
