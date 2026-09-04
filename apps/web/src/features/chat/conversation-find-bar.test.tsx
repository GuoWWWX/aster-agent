// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import {
  ConversationFindBar,
  findConversationTextRanges,
  scrollConversationMatchIntoView,
} from "./conversation-find-bar.js";

describe("conversation text search", () => {
  it("finds every case-insensitive match while ignoring the search controls", () => {
    const root = document.createElement("div");
    root.innerHTML = `
      <div data-conversation-timeline-item="one">Aster supports search. ASTER is fast.</div>
      <div data-conversation-find-ignore>Aster</div>
    `;

    const ranges = findConversationTextRanges(root, "aster");

    expect(ranges.map((range) => range.toString())).toEqual(["Aster", "ASTER"]);
  });

  it("supports a one-character query", () => {
    const root = document.createElement("div");
    root.textContent = "查找对话";

    expect(findConversationTextRanges(root, "找")).toHaveLength(1);
  });

  it("registers every match and a separate active highlight", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const originalHighlight = Object.getOwnPropertyDescriptor(globalThis, "Highlight");
    const originalHighlights = Object.getOwnPropertyDescriptor(globalThis.CSS, "highlights");
    const registeredHighlights = new Map<string, unknown>();
    const setHighlight = vi.fn((name: string, highlight: unknown) => {
      registeredHighlights.set(name, highlight);
    });
    class TestHighlight {
      public constructor(public readonly ranges: readonly Range[]) {}
    }
    Object.defineProperty(globalThis, "Highlight", {
      configurable: true,
      value: class extends TestHighlight {
        public constructor(...ranges: Range[]) {
          super(ranges);
        }
      },
    });
    Object.defineProperty(globalThis.CSS, "highlights", {
      configurable: true,
      value: { delete: vi.fn(), set: setHighlight },
    });
    const host = document.createElement("div");
    const messages = document.createElement("div");
    messages.innerHTML = '<div data-conversation-timeline-item="one">查找内容，再查找一次</div>';
    document.body.append(host, messages);
    const messagesRef = createRef<HTMLDivElement>();
    Object.defineProperty(messagesRef, "current", { value: messages });
    const reactRoot = createRoot(host);

    try {
      act(() => reactRoot.render(
        <TooltipProvider>
          <ConversationFindBar active containerRef={messagesRef} revision="one" />
        </TooltipProvider>,
      ));
      act(() => {
        window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "f" }));
      });
      const input = host.querySelector<HTMLInputElement>('[aria-label="在当前对话中查找"]');
      act(() => {
        if (input === null) return;
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "查找");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => Promise.resolve());

      const allMatches = registeredHighlights.get("conversation-find-match");
      const activeMatch = registeredHighlights.get("conversation-find-active");
      expect(allMatches).toBeInstanceOf(TestHighlight);
      expect((allMatches as TestHighlight).ranges).toHaveLength(2);
      expect(activeMatch).toBeInstanceOf(TestHighlight);
      expect((activeMatch as TestHighlight).ranges).toHaveLength(1);
    } finally {
      act(() => reactRoot.unmount());
      messages.remove();
      host.remove();
      if (originalHighlight === undefined) Reflect.deleteProperty(globalThis, "Highlight");
      else Object.defineProperty(globalThis, "Highlight", originalHighlight);
      if (originalHighlights === undefined) Reflect.deleteProperty(globalThis.CSS, "highlights");
      else Object.defineProperty(globalThis.CSS, "highlights", originalHighlights);
    }
  });

  it("scrolls the exact active match into the visible conversation area", () => {
    const root = document.createElement("div");
    root.innerHTML = '<div data-conversation-timeline-item="one">first match</div>';
    const [range] = findConversationTextRanges(root, "match");
    expect(range).toBeDefined();
    if (range === undefined) return;
    const scrollTo = vi.fn();
    Object.defineProperties(root, {
      clientHeight: { configurable: true, value: 400 },
      scrollTop: { configurable: true, value: 100 },
      scrollTo: { configurable: true, value: scrollTo },
    });
    vi.spyOn(root, "getBoundingClientRect").mockReturnValue({
      bottom: 500,
      height: 400,
      left: 0,
      right: 600,
      toJSON: () => ({}),
      top: 100,
      width: 600,
      x: 0,
      y: 100,
    });
    Object.defineProperty(range, "getBoundingClientRect", { configurable: true, value: vi.fn(() => ({
      bottom: 740,
      height: 20,
      left: 20,
      right: 100,
      toJSON: () => ({}),
      top: 720,
      width: 80,
      x: 20,
      y: 720,
    })) });

    scrollConversationMatchIntoView(root, range);

    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", top: 530 });
  });

  it("opens with Ctrl+F, navigates matches, and closes with Escape", async () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const host = document.createElement("div");
    document.body.append(host);
    const messages = document.createElement("div");
    messages.innerHTML = '<div data-conversation-timeline-item="one">查找内容，再查找一次</div>';
    document.body.append(messages);
    const messagesRef = createRef<HTMLDivElement>();
    Object.defineProperty(messagesRef, "current", { value: messages });
    const reactRoot = createRoot(host);
    act(() => reactRoot.render(
      <TooltipProvider>
        <ConversationFindBar active containerRef={messagesRef} revision="one" />
      </TooltipProvider>,
    ));

    void act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ctrlKey: true, key: "f" }));
    });
    const input = host.querySelector<HTMLInputElement>('[aria-label="在当前对话中查找"]');
    expect(input).not.toBeNull();
    act(() => {
      if (input === null) return;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, "查找");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => Promise.resolve());
    expect(host.textContent).toContain("1 / 2");

    void act(() => {
      window.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Escape" }));
    });
    expect(host.querySelector('[aria-label="在当前对话中查找"]')).toBeNull();
    act(() => reactRoot.unmount());
    messages.remove();
    host.remove();
  });
});
