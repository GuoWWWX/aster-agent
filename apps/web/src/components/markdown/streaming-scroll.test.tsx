// @vitest-environment jsdom
import { act, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AgentMarkdown } from "./agent-markdown.js";
import { useStreamingScroll } from "../ui/use-streaming-scroll.js";

let root: Root;
let mount: HTMLElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  // jsdom has no layout. Model a 100px viewport with growing/clamped content.
  const tops = new WeakMap<Element, number>();
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(function (this: HTMLElement) {
    return Math.max(100, (this.textContent?.length ?? 0) * 10);
  });
  vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(100);
  Object.defineProperty(HTMLElement.prototype, "scrollTop", { configurable: true,
    get(this: HTMLElement) { return tops.get(this) ?? 0; },
    set(this: HTMLElement, value: number) { tops.set(this, Math.max(0, Math.min(value, this.scrollHeight - this.clientHeight))); },
  });
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
});
afterEach(() => {
  act(() => root.unmount()); document.body.replaceChildren();
  delete (HTMLElement.prototype as Partial<HTMLElement>).scrollTop;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
function scrollTo(element: HTMLElement, top: number): void {
  act(() => { element.scrollTop = top; element.dispatchEvent(new Event("scroll")); });
}
function tail(element: HTMLElement): number { return element.scrollHeight - element.clientHeight; }
function markdown(lines: number): string { return "```html\n" + "<div>输出内容</div>\n".repeat(lines); }
it("follows growing Markdown fences across DOM replacement, pauses on upward scrolling and resumes at bottom", () => {
  // Streaming is wired through the real Markdown component by its caller.
  const render = (lines: number, streaming = true): void => {
    act(() => root.render(<AgentMarkdown content={markdown(lines)} streaming={streaming} />));
  };
  render(20);
  let pre = mount.querySelector("pre")!;
  expect(pre.scrollTop).toBe(tail(pre));
  render(25); pre = mount.querySelector("pre")!;
  expect(pre.scrollTop).toBe(tail(pre));
  scrollTo(pre, 35); pre.scrollLeft = 17;
  pre.dispatchEvent(new Event("scroll"));
  render(30); pre = mount.querySelector("pre")!;
  expect(pre.scrollTop).toBe(35);
  expect(pre.scrollLeft).toBe(17);
  scrollTo(pre, tail(pre));
  render(35, false); pre = mount.querySelector("pre")!;
  expect(pre.scrollTop).toBe(tail(pre));
  render(40, false); pre = mount.querySelector("pre")!;
  expect(pre.scrollTop).toBeLessThan(tail(pre));
});
it("opens completed historical code at the beginning", () => {
  act(() => root.render(<AgentMarkdown content={markdown(20)} />));
  expect(mount.querySelector("pre")?.scrollTop).toBe(0);
});
function Output({ text, running }: { text: string; running: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  useStreamingScroll(host, text, running);
  return <div ref={host}><pre>{text}</pre></div>;
}
it("applies the same follow/pause/resume rule to live command output without replacing its scroll container", () => {
  const render = (text: string, running = true): void => { act(() => root.render(<Output text={text} running={running} />)); };
  render("line\n".repeat(30));
  const pre = mount.querySelector("pre")!;
  expect(pre.scrollTop).toBe(tail(pre));
  scrollTo(pre, 40);
  render("line\n".repeat(40));
  expect(mount.querySelector("pre")).toBe(pre);
  expect(pre.scrollTop).toBe(40);
  scrollTo(pre, tail(pre));
  render("line\n".repeat(50));
  expect(pre.scrollTop).toBe(tail(pre));
  scrollTo(pre, 60);
  render("line\n".repeat(55), false);
  expect(pre.scrollTop).toBe(60);
});

function Cards({ preview, text }: { preview: boolean; text: string }) {
  const host = useRef<HTMLDivElement>(null);
  useStreamingScroll(host, `${preview}:${text}`, true);
  return <div ref={host}>
    <div className="agent-markdown__code-block">{preview ? <div>HTML 预览</div> : <pre>{"first\n".repeat(30)}</pre>}</div>
    <div className="agent-markdown__code-block"><pre key={text}>{text}</pre></div>
  </div>;
}
it("keeps each card's position when an earlier HTML fence switches to preview", () => {
  act(() => root.render(<Cards preview={false} text={"second\n".repeat(30)} />));
  const blocks = mount.querySelectorAll("pre");
  scrollTo(blocks[0]!, 25);
  scrollTo(blocks[1]!, 80);
  act(() => root.render(<Cards preview text={"second\n".repeat(40)} />));
  expect(mount.querySelectorAll("pre")).toHaveLength(1);
  expect(mount.querySelector("pre")?.scrollTop).toBe(80);
});
