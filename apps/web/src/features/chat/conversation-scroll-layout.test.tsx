// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { ConversationWorkspace } from "./workspace-content.js";

it("does not mistake a queued programmatic scroll for leaving the bottom after a resize", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const observers: TestResizeObserver[] = [];
  const frames = new Map<number, FrameRequestCallback>(); let sequence = 0;
  class TestResizeObserver implements ResizeObserver {
    public targets = new Set<Element>();
    public constructor(public callback: ResizeObserverCallback) { observers.push(this); }
    public observe(target: Element): void { this.targets.add(target); }
    public unobserve(target: Element): void { this.targets.delete(target); }
    public disconnect(): void { this.targets.clear(); }
    public resize(): void { this.callback([...this.targets].map(target => ({ target, contentRect: new DOMRect(0, 0, 200, 100),
      borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] })), this); }
  }
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(window, "requestAnimationFrame").mockImplementation(callback => { frames.set(++sequence, callback); return sequence; });
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(id => { frames.delete(id); });
  const container = document.createElement("div"); document.body.append(container); const root = createRoot(container);
  try {
    const client = new MockAgentClient(); const session = await client.createConversation({});
    const page = vi.spyOn(client, "listConversationTimelinePage").mockResolvedValueOnce({ items: [{ id: crypto.randomUUID(), conversationId: session.id,
      runId: null, kind: "message", attachments: [], role: "user", modelId: null, status: "completed", content: "Long history", createdAt: new Date().toISOString() }],
      hasMore: true, nextBeforeSequence: 2 }).mockResolvedValue({ items: [], hasMore: false, nextBeforeSequence: null });
    await act(async () => { root.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={{...session,pinOrder:null}} /></TooltipProvider>);
      for (let i = 0; i < 20; i++) await Promise.resolve(); });
    const messages = container.querySelector<HTMLElement>('[aria-label="对话记录"]')!;
    let height = 1200; let top = 0;
    Object.defineProperties(messages, { clientHeight: { configurable: true, value: 600 }, scrollHeight: { configurable: true, get: () => height },
      scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.min(value, height - 600); } } });
    act(() => { const pending = [...frames.values()]; frames.clear(); pending.forEach(callback => callback(0)); });
    expect(top).toBe(600);
    height += 53;
    act(() => { messages.dispatchEvent(new Event("scroll")); });
    expect(page).toHaveBeenCalledTimes(1);
    const host = container.querySelector('[data-user-message-content]')!;
    const observer = observers.find(candidate => candidate.targets.has(host))!;
    expect(observer).toBeDefined();
    act(() => observer.resize()); expect(top).toBe(653);
    await act(async () => { top = 240; messages.dispatchEvent(new Event("scroll")); await Promise.resolve(); });
    expect(page).toHaveBeenCalledTimes(2);
    height += 100;
    act(() => observer.resize()); expect(top).toBe(240);
  } finally { act(() => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); }
});
