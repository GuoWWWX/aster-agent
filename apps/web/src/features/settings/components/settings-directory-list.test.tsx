// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SettingsDirectoryList } from "./settings-directory-list.js";

let root: Root | null = null;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); });

function setup() {
  const outer = document.createElement("main"); document.body.append(outer); root = createRoot(outer);
  function render(selectedId: string | null) {
    act(() => root?.render(<SettingsDirectoryList className="directory-list" selectedId={selectedId}>
      <button data-selected={selectedId === "selected"}>Entry</button>
    </SettingsDirectoryList>));
  }
  render(null);
  const list = outer.querySelector<HTMLDivElement>(".directory-list")!;
  const row = list.querySelector<HTMLButtonElement>("button")!;
  vi.spyOn(list, "getBoundingClientRect").mockReturnValue({ top: 100 } as DOMRect);
  Object.defineProperty(list, "clientHeight", { configurable: true, value: 180 });
  outer.scrollTop = 300;
  return { outer, list, row, render };
}

it("reveals a selected entry below the list by scrolling only the list", () => {
  const { outer, list, row, render } = setup();
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 260, bottom: 318 } as DOMRect);
  render("selected");
  expect(list.scrollTop).toBe(38);
  expect(outer.scrollTop).toBe(300);
});

it("reveals a selected entry above the list without changing the outer page scroll", () => {
  const { outer, list, row, render } = setup(); list.scrollTop = 100;
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 75, bottom: 133 } as DOMRect);
  render("selected");
  expect(list.scrollTop).toBe(75);
  expect(outer.scrollTop).toBe(300);
});

it("preserves manual list scrolling on unrelated renders when selection has not changed", () => {
  const { list, row, render } = setup();
  const bounds = vi.spyOn(row, "getBoundingClientRect").mockReturnValue({ top: 110, bottom: 168 } as DOMRect);
  render("selected");
  expect(list.scrollTop).toBe(0);
  list.scrollTop = 70;
  bounds.mockReturnValue({ top: 40, bottom: 98 } as DOMRect);
  render("selected");
  expect(list.scrollTop).toBe(70);
});
