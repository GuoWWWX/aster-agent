// @vitest-environment jsdom
import type { ConversationMessageItem, ConversationTimelineItem } from "@agent/protocol";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  ConversationTurnNavigator,
  conversationTurnIndexAtRailPosition,
  conversationTurnMarkerWidthPixels,
  conversationTurnOffsetPixels,
  createConversationTurnPreviews,
  isConversationTurnNavigatorNarrow,
  visibleConversationTurnIds,
} from "./conversation-turn-navigator.js";

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
  it("pairs user questions with the model output from the same run and shortens Markdown", () => {
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
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
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
    expect(container.querySelector("[data-conversation-density-rail]")).toBeNull();
    expect(markers[0]?.getAttribute("aria-current")).toBe("true");
    expect(markers[0]?.querySelector<HTMLElement>("span")?.style.width).toBe("8px");
    act(() => {
      markers[0]?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
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
});
