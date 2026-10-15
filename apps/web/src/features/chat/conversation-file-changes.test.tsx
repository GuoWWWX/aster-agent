// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ConversationChangesBadge, ConversationChangesCard } from "./conversation-file-changes.js";

let root: Root | undefined;
const summary = { additions: 12, deletions: 6, files: Array.from({ length: 6 }, (_, i) => ({ path: `src/file-${i}.tsx`, additions: 2, deletions: 1 })) };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
});
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it("opens above the badge on hover and keeps the popup while moving into it within 200 ms", () => {
  vi.useFakeTimers();
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const review = vi.fn();
  act(() => root?.render(<ConversationChangesBadge summary={summary} onReview={review} />));
  const badge = container.querySelector("button")!;
  act(() => { badge.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
  const popup = document.querySelector<HTMLElement>('[aria-label="文件改动列表"]')!;
  expect(popup).not.toBeNull(); expect(popup.dataset.side).toBe("top");
  act(() => { badge.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })); });
  act(() => { vi.advanceTimersByTime(199); });
  expect(document.querySelector('[aria-label="文件改动列表"]')).not.toBeNull();
  act(() => { popup.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
  act(() => { vi.advanceTimersByTime(201); });
  expect(document.querySelector('[aria-label="文件改动列表"]')).not.toBeNull();
  act(() => { popup.querySelectorAll("button")[4]!.click(); });
  expect(review).toHaveBeenLastCalledWith("src/file-4.tsx");
  act(() => { badge.dispatchEvent(new MouseEvent("pointerover", { bubbles: true })); });
  act(() => { document.querySelector('[aria-label="文件改动列表"]')!.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })); });
  act(() => { vi.advanceTimersByTime(200); });
  expect(document.querySelector('[aria-label="文件改动列表"]')).toBeNull();
  act(() => { badge.click(); }); expect(review).toHaveBeenLastCalledWith();
});

it("keeps the first three files in the completed card and expands the rest without duplicate rows", () => {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const review = vi.fn();
  act(() => root?.render(<ConversationChangesCard summary={summary} onReview={review} />));
  expect(container.querySelectorAll("[data-changed-file]")).toHaveLength(3);
  const more = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("再显示 3 个文件"))!;
  act(() => { more.click(); }); expect(container.querySelectorAll("[data-changed-file]")).toHaveLength(6);
  act(() => { container.querySelector<HTMLButtonElement>('[data-changed-file="src/file-5.tsx"]')!.click(); });
  expect(review).toHaveBeenLastCalledWith("src/file-5.tsx");
  act(() => { [...container.querySelectorAll("button")].find(button => button.textContent === "查看变更")!.click(); });
  expect(review).toHaveBeenLastCalledWith();
});
