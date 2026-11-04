// @vitest-environment jsdom
import { act, createRef } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryTextarea } from "./query-textarea.js";

afterEach(() => { vi.unstubAllGlobals(); document.body.replaceChildren(); });

describe("query textarea", () => {
  it("replaces selected prefixes with icons while preserving raw edits and clipboard text", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const textareaRef = createRef<HTMLTextAreaElement>();
    const change = vi.fn();
    act(() => root.render(<QueryTextarea value="先 /test @file" query={null}
      references={[{ start: 2, end: 7 }, { start: 8, end: 13 }]}
      renderReferenceIcon={() => <svg data-testid="icon" />} onValueChange={change} textareaRef={textareaRef} />));
    const input = textareaRef.current!;
    expect(input.value).toBe("先 \u3000test \u3000file");
    expect(container.querySelectorAll('[data-testid="icon"]')).toHaveLength(2);
    input.setSelectionRange(0, 13);
    const clipboard = { setData: vi.fn() };
    const copy = new Event("copy", { bubbles: true, cancelable: true });
    Object.defineProperty(copy, "clipboardData", { value: clipboard });
    act(() => { input.dispatchEvent(copy); });
    expect(clipboard.setData).toHaveBeenCalledWith("text/plain", "先 /test @file");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "先 \u3000test \u3000file 后文");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(change).toHaveBeenCalledWith("先 /test @file 后文", 16);
    act(() => root.unmount());
  });
  it.each([
    ["Backspace", 5, 5, 5], ["Backspace", 6, 6, 6], ["Delete", 0, 0, 5], ["Delete", 2, 4, 5],
  ])("atomically deletes a selected reference with %s at %i", (key, start, end, expectedEnd) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const textareaRef = createRef<HTMLTextAreaElement>();
    const remove = vi.fn();
    act(() => root.render(<QueryTextarea value="@file 后文" query={null} references={[{ start: 0, end: 5 }]}
      onReferenceDelete={remove} onChange={vi.fn()} textareaRef={textareaRef} />));
    expect(container.querySelector("[data-composer-query]")?.textContent).toBe("@file");
    textareaRef.current?.setSelectionRange(start, end);
    act(() => { textareaRef.current?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })); });
    expect(remove).toHaveBeenCalledWith({ start: 0, end: expectedEnd });
    act(() => root.unmount());
  });
  it.each([
    ["打算打 @", 4, 5, "@"],
    ["先看看 @README 后面的说明", 4, 11, "@README"],
    ["/review 后面的说明", 0, 7, "/review"],
    ["第一行\n第二行 @文件", 8, 11, "@文件"],
  ])("highlights only the query in %s", (value, start, end, text) => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const textareaRef = createRef<HTMLTextAreaElement>();
    act(() => root.render(<QueryTextarea value={value} query={{ start, end }} textareaRef={textareaRef} readOnly />));
    expect(container.querySelector("[data-composer-query]")?.textContent).toBe(text);
    const mirror = container.querySelector<HTMLDivElement>('[aria-hidden="true"]');
    expect(mirror?.textContent).toBe(value + "\u200b");
    expect(textareaRef.current?.value).toBe(value);
    const textarea = textareaRef.current;
    if (textarea === null) throw new Error("Expected textarea");
    textarea.scrollTop = 45;
    act(() => { textarea.dispatchEvent(new Event("scroll", { bubbles: true })); });
    expect(mirror?.scrollTop).toBe(45);
    act(() => root.render(<QueryTextarea value={value} query={null} textareaRef={textareaRef} readOnly />));
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(textareaRef.current?.hasAttribute("data-query-active")).toBe(false);
    act(() => root.unmount());
  });
});
