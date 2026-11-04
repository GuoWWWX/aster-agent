// @vitest-environment jsdom
import { act, StrictMode, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MarkdownLayoutScope, useMarkdownLayout } from "./markdown-layout-scope.js";

let root: Root;
const observers: TestResizeObserver[] = [];
class TestResizeObserver implements ResizeObserver {
  public targets = new Set<Element>();
  public disconnect = vi.fn();
  public observe(target: Element): void { this.targets.add(target); }
  public unobserve(target: Element): void { this.targets.delete(target); }
  public constructor(public callback: ResizeObserverCallback) { observers.push(this); }
  public resize(): void { this.callback([...this.targets].map(target => ({ target, contentRect: new DOMRect(0, 0, 200, 100),
    borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] })), this); }
}
function Body() {
  const host = useRef<HTMLDivElement>(null);
  useMarkdownLayout(host, true);
  return <div ref={host}>message</div>;
}
function show(onResize: () => void): void {
  act(() => root.render(<MarkdownLayoutScope onResize={onResize}><Body /><Body /></MarkdownLayoutScope>));
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); observers.length = 0; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("uses one observer to handle a batch of message sizes after browser layout", () => {
  const resize = vi.fn(); show(resize);
  expect(resize).not.toHaveBeenCalled();
  expect(observers).toHaveLength(1); expect(observers[0]?.targets.size).toBe(2);
  act(() => observers[0]?.resize()); expect(resize).toHaveBeenCalledTimes(1);
});
it("uses the current reading policy without reattaching every message observer", () => {
  const initial = vi.fn(); const current = vi.fn(); show(initial); show(current);
  expect(observers).toHaveLength(1);
  act(() => observers[0]?.resize()); expect(initial).not.toHaveBeenCalled(); expect(current).toHaveBeenCalledTimes(1);
});
it("keeps height notifications working after development effect replay", () => {
  const resize = vi.fn();
  act(() => root.render(<StrictMode><MarkdownLayoutScope onResize={resize}><Body /><Body /></MarkdownLayoutScope></StrictMode>));
  expect(resize).not.toHaveBeenCalled();
  expect(observers.at(-1)?.targets.size).toBe(2);
  act(() => observers.forEach(observer => observer.resize())); expect(resize).toHaveBeenCalledTimes(1);
});
it("releases all observed elements and ignores late notifications on unmount", () => {
  const resize = vi.fn(); show(resize);
  const observer = observers[0]!;
  act(() => root.render(null));
  expect(observers[0]?.targets.size).toBe(0);
  expect(observers[0]?.disconnect).toHaveBeenCalledTimes(1);
  act(() => observer.callback([{ target: document.body, contentRect: new DOMRect(0, 0, 200, 100),
    borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], observer));
  expect(resize).not.toHaveBeenCalled();
});
