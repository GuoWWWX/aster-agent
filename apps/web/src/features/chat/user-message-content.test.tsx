// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserMessageContent } from "./user-message-content.js";
import { MarkdownLayoutScope } from "../../components/markdown/markdown-layout-scope.js";

let root: Root | undefined;
const observers: TestResizeObserver[] = [];
let textHeight = 40;
class TestResizeObserver implements ResizeObserver {
  public target: Element = document.createElement("p");
  public constructor(private readonly callback: ResizeObserverCallback) { observers.push(this); }
  public observe(target: Element): void { this.target = target; }
  public disconnect(): void {}
  public unobserve(): void {}
  public resize(width = 300): void { this.callback([{ target: this.target, contentRect: new DOMRect(0, 0, width, textHeight),
    borderBoxSize: [], contentBoxSize: [], devicePixelContentBoxSize: [] }], this); }
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  textHeight = 40;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(() => textHeight);
  const computedStyle = document.createElement("p").style; computedStyle.lineHeight = "20px";
  vi.spyOn(window, "getComputedStyle").mockReturnValue(computedStyle);
});
afterEach(() => { act(() => root?.unmount()); root = undefined; observers.length = 0; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function render(content: string, measured = true): HTMLDivElement {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root?.render(<UserMessageContent content={content} />));
  if (measured) act(() => observers.at(-1)?.resize());
  return container;
}
it("waits for browser layout before measuring and ignores hidden cached messages", () => {
  const measure = vi.spyOn(window, "getComputedStyle");
  textHeight = 200;
  const container = render("长消息\n".repeat(20), false);
  expect(measure).not.toHaveBeenCalled();
  act(() => observers.at(-1)?.resize());
  expect(container.querySelector("button")?.textContent).toContain("展开全文");
  measure.mockClear();
  act(() => observers.at(-1)?.resize(0));
  expect(measure).not.toHaveBeenCalled();
  expect(container.querySelector("button")?.textContent).toContain("展开全文");
});
it("notifies the conversation when deferred folding changes the whole message height", () => {
  const resized = vi.fn(); textHeight = 200;
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root?.render(<MarkdownLayoutScope onResize={resized}><UserMessageContent content="长消息" /></MarkdownLayoutScope>));
  const body = container.querySelector("[data-user-message-content]");
  const paragraph = container.querySelector("p");
  const observer = observers.find(candidate => candidate.target === body);
  expect(observer).toBeDefined();
  expect(resized).not.toHaveBeenCalled();
  act(() => observer?.resize()); expect(resized).toHaveBeenCalledTimes(1);
  act(() => observers.find(candidate => candidate.target === paragraph)?.resize());
  expect(container.querySelector("button")?.textContent).toContain("展开全文");
  act(() => observer?.resize());
  expect(resized).toHaveBeenCalledTimes(2);
});
it("leaves short messages fully visible without a disclosure", () => {
  const container = render("短消息");
  expect(container.querySelector("p")?.textContent).toBe("短消息");
  expect(container.querySelector("button")).toBeNull();
});
it("folds overflowing text, expands and folds it again without truncating the original", () => {
  textHeight = 200;
  const content = "长消息\n".repeat(20); const container = render(content);
  const button = container.querySelector<HTMLButtonElement>("button")!;
  expect(button.getAttribute("aria-expanded")).toBe("false");
  expect(container.querySelector("p")?.classList.contains("line-clamp-6")).toBe(true);
  expect(container.querySelector("p")?.textContent).toBe(content);
  act(() => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector("p")?.classList.contains("line-clamp-6")).toBe(false);
  act(() => button.click());
  expect(button.getAttribute("aria-expanded")).toBe("false");
});
it("detects wrapping after resize and folds edited text afresh", () => {
  const container = render("一段会因窗口变窄而换行的消息");
  act(() => { textHeight = 180; observers.at(-1)?.resize(); });
  expect(container.querySelector("button")?.textContent).toContain("展开全文");
  act(() => container.querySelector<HTMLButtonElement>("button")?.click());
  act(() => root?.render(<UserMessageContent content="编辑后的另一条长消息" />));
  act(() => observers.at(-1)?.resize());
  expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
});
