// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { UserMessageContent } from "./user-message-content.js";

let root: Root | undefined;
const observers: TestResizeObserver[] = [];
let textHeight = 40;
class TestResizeObserver implements ResizeObserver {
  public constructor(private readonly callback: ResizeObserverCallback) { observers.push(this); }
  public observe(): void {}
  public disconnect(): void {}
  public unobserve(): void {}
  public resize(): void { this.callback([], this); }
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
function render(content: string): HTMLDivElement {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  act(() => root?.render(<UserMessageContent content={content} />)); return container;
}
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
  expect(container.querySelector("button")?.getAttribute("aria-expanded")).toBe("false");
});
