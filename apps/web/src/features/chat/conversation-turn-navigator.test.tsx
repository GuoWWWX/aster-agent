// @vitest-environment jsdom
import type { ConversationMessageItem, ConversationTimelineItem } from "@agent/protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  ConversationTurnNavigator,
  conversationTurnDragMarkerTopPixels,
  conversationTurnIndexAtRailPosition,
  conversationTurnMarkerWidthPixels,
  conversationTurnOffsetPixels,
  conversationTurnRailScrollTopForPointer,
  createConversationTurnPreviews,
  isConversationTurnNavigatorNarrow,
  visibleConversationTurnIds,
  scrollConversationTurnIntoView,
} from "./conversation-turn-navigator.js";

class TestResizeObserver {
  disconnect(): void {}
  observe(): void {}
  unobserve(): void {}
}

it("centers a turn by scrolling only the message viewport", () => {
  const viewport = document.createElement("div");
  const anchor = document.createElement("div");
  viewport.scrollTop = 300;
  Object.defineProperties(viewport, {
    clientHeight: { value: 500 }, clientTop: { value: 1 },
  });
  vi.spyOn(viewport, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 100, 900, 502));
  vi.spyOn(anchor, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 800, 500, 100));
  const scrollTo = vi.fn();
  const scrollIntoView = vi.fn();
  viewport.scrollTo = scrollTo;
  anchor.scrollIntoView = scrollIntoView;
  scrollConversationTurnIntoView(viewport, anchor, "auto");
  expect(scrollTo).toHaveBeenCalledWith({ top: 799, behavior: "auto" });
  expect(scrollIntoView).not.toHaveBeenCalled();
});

function message(input: {
  content: string;
  id: string;
  role: "assistant" | "user";
  runId: string;
}): ConversationMessageItem {
  return {
    attachments: [],
    content: input.content,
    conversationId: "2cb335d4-ed29-4fe8-8c3a-2382d6b9ec3e",
    createdAt: "2026-09-04T00:00:00.000Z",
    id: input.id,
    kind: "message",
    modelId: input.role === "assistant" ? "test-model" : null,
    role: input.role,
    runId: input.runId,
    status: "completed",
  };
}

describe("conversation turn navigator", () => {
  it("creates one accessible marker label per user question and shortens Markdown", () => {
    const timeline: ConversationTimelineItem[] = [
      message({ content: "请帮我分析 **缓存命中率**", id: "user-1", role: "user", runId: "run-1" }),
      message({
        content: `已经分析完成。\n\n\`\`\`text\nlong diagnostic output\n\`\`\`\n${"主要原因是网关连接不稳定，需要检查连接复用与超时配置。".repeat(6)}`,
        id: "assistant-1",
        role: "assistant",
        runId: "run-1",
      }),
    ];

    const [turn] = createConversationTurnPreviews(timeline);

    expect(turn?.question).toBe("请帮我分析 缓存命中率");
    expect(turn?.answer).toContain("代码片段");
    expect(turn?.answer.endsWith("…")).toBe(true);
    expect(turn?.id).toBe("user-1");
  });

  it("marks every user message intersecting the visible conversation viewport", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-conversation-timeline-item="user-1"><div>first</div></div>
      <div data-conversation-timeline-item="user-2"><div>second</div></div>
      <div data-conversation-timeline-item="user-3"><div>third</div></div>
    `;
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      bottom: 500, height: 400, left: 0, right: 500, top: 100, width: 500, x: 0, y: 100,
      toJSON: () => ({}),
    });
    const [first, second, third] = root.querySelectorAll<HTMLElement>("[data-conversation-timeline-item] > div");
    vi.spyOn(first!, "getBoundingClientRect").mockReturnValue({
      bottom: 150, height: 30, left: 0, right: 100, top: 120, width: 100, x: 0, y: 120,
      toJSON: () => ({}),
    });
    vi.spyOn(second!, "getBoundingClientRect").mockReturnValue({
      bottom: 340, height: 30, left: 0, right: 100, top: 310, width: 100, x: 0, y: 310,
      toJSON: () => ({}),
    });
    vi.spyOn(third!, "getBoundingClientRect").mockReturnValue({
      bottom: 550, height: 30, left: 0, right: 100, top: 520, width: 100, x: 0, y: 520,
      toJSON: () => ({}),
    });

    expect(Array.from(visibleConversationTurnIds(
      root,
      new Set(["user-1", "user-2", "user-3"]),
    ))).toEqual(["user-1", "user-2"]);
  });

  it("keeps real message markers tightly and evenly spaced around the center", () => {
    const offsets = Array.from({ length: 4 }, (_, index) =>
      conversationTurnOffsetPixels(index, 4)
    );

    expect(offsets).toEqual([-15, -5, 5, 15]);
    expect(offsets.slice(1).map((offset, index) => offset - offsets[index]!))
      .toEqual([10, 10, 10]);
  });

  it("maps a dragged rail position to the nearest conversation turn", () => {
    const shared = {
      railClientHeight: 100,
      railScrollTop: 0,
      railTop: 200,
      turnCount: 5,
    };

    expect(conversationTurnIndexAtRailPosition({ ...shared, clientY: 230 })).toBe(0);
    expect(conversationTurnIndexAtRailPosition({ ...shared, clientY: 250 })).toBe(2);
    expect(conversationTurnIndexAtRailPosition({ ...shared, clientY: 270 })).toBe(4);
    expect(conversationTurnIndexAtRailPosition({ ...shared, clientY: 100 })).toBe(0);
    expect(conversationTurnIndexAtRailPosition({ ...shared, clientY: 400 })).toBe(4);
  });

  it("keeps the dragged indicator on the first and last real turn markers", () => {
    const shared = {
      railClientHeight: 100,
      railScrollTop: 0,
      railTop: 200,
      turnCount: 5,
    };

    expect(conversationTurnDragMarkerTopPixels({ ...shared, clientY: 100 })).toBe(30);
    expect(conversationTurnDragMarkerTopPixels({ ...shared, clientY: 250 })).toBe(50);
    expect(conversationTurnDragMarkerTopPixels({ ...shared, clientY: 400 })).toBe(70);
  });

  it("scrolls hidden turn markers into view while dragging at the rail edges", () => {
    const shared = {
      railClientHeight: 100,
      railScrollHeight: 300,
      railTop: 200,
    };

    expect(conversationTurnRailScrollTopForPointer({
      ...shared,
      clientY: 298,
      railScrollTop: 80,
    })).toBeGreaterThan(80);
    expect(conversationTurnRailScrollTopForPointer({
      ...shared,
      clientY: 202,
      railScrollTop: 80,
    })).toBeLessThan(80);
    expect(conversationTurnRailScrollTopForPointer({
      ...shared,
      clientY: 250,
      railScrollTop: 80,
    })).toBe(80);
  });

  it("expands the hovered marker and its neighbors as a three-step ridge", () => {
    expect([0, 1, 2, 3, 4].map((index) =>
      conversationTurnMarkerWidthPixels(index, 2)
    )).toEqual([16, 24, 32, 24, 16]);
    expect(conversationTurnMarkerWidthPixels(0, null)).toBe(8);
    expect(conversationTurnMarkerWidthPixels(8, 2)).toBe(8);
  });

  it("hides the rail before it can overlap narrow conversation content", () => {
    expect(isConversationTurnNavigatorNarrow(823)).toBe(true);
    expect(isConversationTurnNavigatorNarrow(824)).toBe(false);
  });

  it("renders exactly one marker for each real user message", () => {
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: TestResizeObserver,
    });
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      callback(0);
      return 1;
    });
    const messages = document.createElement("div");
    messages.innerHTML = `
      <div data-conversation-timeline-item="user-1"><div>first</div></div>
      <div data-conversation-timeline-item="assistant-1"><div>answer</div></div>
    `;
    const container = document.createElement("div");
    document.body.append(messages, container);
    const root = createRoot(container);
    const timeline: ConversationTimelineItem[] = [
      message({ content: "问题", id: "user-1", role: "user", runId: "run-1" }),
      message({ content: "回答", id: "assistant-1", role: "assistant", runId: "run-1" }),
    ];

    act(() => root.render(
      <TooltipProvider>
        <ConversationTurnNavigator
          bottomOffsetPx={120}
          containerRef={{ current: messages }}
          hidden={false}
          timeline={timeline}
          onNavigateStart={() => undefined}
        />
      </TooltipProvider>,
    ));

    const markers = container.querySelectorAll<HTMLButtonElement>('button[aria-label^="跳到提问"]');
    const navigator = container.querySelector<HTMLElement>('nav[aria-label="对话轮次导航"]');
    expect(markers).toHaveLength(1);
    expect(navigator).not.toBeNull();
    expect(document.querySelector("[role=tooltip]")).toBeNull();
    expect(container.querySelector("[data-conversation-density-rail]")).toBeNull();
    expect(markers[0]?.getAttribute("aria-current")).toBe("true");
    expect(markers[0]?.querySelector<HTMLElement>("span")?.style.width).toBe("8px");
    act(() => {
      markers[0]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(document.querySelector("[role=tooltip]")?.textContent).toContain("问题");
    expect(document.querySelector("[role=tooltip]")?.textContent).toContain("回答");
    expect(markers[0]?.querySelector<HTMLElement>("span")?.style.width).toBe("32px");
    expect(markers[0]?.querySelector("span")?.className).toContain("bg-[var(--app-foreground)]");
    Object.defineProperties(navigator!, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });
    navigator!.dispatchEvent(new WheelEvent("wheel", {
      bubbles: true,
      cancelable: true,
      deltaY: 42,
    }));
    expect(navigator?.scrollTop).toBe(42);

    act(() => root.unmount());
    requestFrame.mockRestore();
    document.body.replaceChildren();
  });

  it("moves the active marker with the pointer and reveals overflow markers while dragging", () => {
    Object.assign(globalThis, {
      IS_REACT_ACT_ENVIRONMENT: true,
      ResizeObserver: TestResizeObserver,
    });
    let nextFrameId = 0;
    const frameCallbacks = new Map<number, FrameRequestCallback>();
    const requestFrame = vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      nextFrameId += 1;
      frameCallbacks.set(nextFrameId, callback);
      return nextFrameId;
    });
    const cancelFrame = vi.spyOn(window, "cancelAnimationFrame").mockImplementation((frameId) => {
      frameCallbacks.delete(frameId);
    });
    const flushFrames = (): void => {
      const callbacks = Array.from(frameCallbacks.values());
      frameCallbacks.clear();
      callbacks.forEach((callback) => callback(0));
    };
    const messages = document.createElement("div");
    Object.defineProperty(messages, "clientWidth", { configurable: true, value: 900 });
    const timeline = Array.from({ length: 30 }, (_, index) => [
      message({
        content: `问题 ${index + 1}`,
        id: `user-${index + 1}`,
        role: "user",
        runId: `run-${index + 1}`,
      }),
      message({
        content: `回答 ${index + 1}`,
        id: `assistant-${index + 1}`,
        role: "assistant",
        runId: `run-${index + 1}`,
      }),
    ]).flat();
    messages.scrollTo = vi.fn();
    for (const item of timeline) {
      const wrapper = document.createElement("div");
      wrapper.dataset.conversationTimelineItem = item.id;
      const anchor = document.createElement("div");
      Object.defineProperty(anchor, "scrollIntoView", { value: vi.fn() });
      wrapper.append(anchor);
      messages.append(wrapper);
    }
    const container = document.createElement("div");
    document.body.append(messages, container);
    const root = createRoot(container);

    act(() => root.render(
      <TooltipProvider delayDuration={0}>
        <ConversationTurnNavigator
          bottomOffsetPx={120}
          containerRef={{ current: messages }}
          hidden={false}
          timeline={timeline}
          onNavigateStart={() => undefined}
        />
      </TooltipProvider>,
    ));
    act(flushFrames);

    const navigator = container.querySelector<HTMLElement>('nav[aria-label="对话轮次导航"]');
    const firstMarker = container.querySelector<HTMLButtonElement>('button[aria-label="跳到提问：问题 1"]');
    expect(navigator).not.toBeNull();
    expect(firstMarker).not.toBeNull();
    Object.defineProperties(navigator!, {
      clientHeight: { configurable: true, value: 100 },
      scrollHeight: { configurable: true, value: 300 },
    });
    vi.spyOn(navigator!, "getBoundingClientRect").mockReturnValue({
      bottom: 300, height: 100, left: 0, right: 40, top: 200, width: 40, x: 0, y: 200,
      toJSON: () => ({}),
    });
    const pointerEvent = (type: string, clientY: number): MouseEvent => {
      const event = new MouseEvent(type, { bubbles: true, button: 0, clientY });
      Object.defineProperty(event, "pointerId", { value: 7 });
      return event;
    };

    act(() => {
      firstMarker!.dispatchEvent(pointerEvent("pointerdown", 250));
    });
    act(flushFrames);
    act(() => {
      firstMarker!.dispatchEvent(pointerEvent("pointermove", 295));
    });
    act(flushFrames);

    const firstEdgeScrollTop = navigator!.scrollTop;
    expect(firstEdgeScrollTop).toBeGreaterThan(0);
    act(flushFrames);
    expect(navigator!.scrollTop).toBeGreaterThan(firstEdgeScrollTop);
    const activeMarker = container.querySelector<HTMLButtonElement>('button[aria-current="true"]');
    expect(activeMarker?.style.top).toBe(`${navigator!.scrollTop + 95}px`);
    expect(document.querySelector("[role=tooltip]")?.textContent).toContain("问题 14");
    expect(document.querySelector("[role=tooltip]")?.textContent).toContain("回答 14");

    act(() => {
      firstMarker!.dispatchEvent(pointerEvent("pointerup", 295));
      root.unmount();
    });
    requestFrame.mockRestore();
    cancelFrame.mockRestore();
    document.body.replaceChildren();
  });
});
