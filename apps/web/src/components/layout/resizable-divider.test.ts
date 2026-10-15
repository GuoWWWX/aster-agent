// @vitest-environment jsdom

import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LIVE_PANEL_RESIZE_EVENT, NATIVE_PANEL_RESIZE_EVENT, type LivePanelResizeDetail } from "./live-panel-resize.js";

import {
  clampResizablePanelWidth,
  getResizeCollapseTransition,
  getResizedPanelWidth,
  ResizableDivider,
} from "./resizable-divider.js";

let root: Root | null = null;
const listeners: Array<(event: Event) => void> = [];

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  for (const listener of listeners) window.removeEventListener(LIVE_PANEL_RESIZE_EVENT, listener);
  listeners.length = 0;
  document.body.replaceChildren();
  delete document.body.dataset.resizingPanel;
  vi.restoreAllMocks();
});

function pointer(type: string, clientX: number): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, button: 0, clientX });
  Object.defineProperty(event, "pointerId", { value: 1 });
  return event;
}

function renderDivider(): { divider: HTMLDivElement; releasePointerCapture: ReturnType<typeof vi.fn>; snapshots: Array<{ phase: string; size: number; width: string; collapsed: string }> } {
  const container = document.createElement("div");
  document.body.append(container);
  const snapshots: Array<{ phase: string; size: number; width: string; collapsed: string }> = [];
  function Layout(): ReturnType<typeof createElement> {
    const [width, setWidth] = useState(300);
    const [collapsed, setCollapsed] = useState(false);
    return createElement("section", { style: { width }, "data-collapsed": String(collapsed) },
      createElement(ResizableDivider, {
        ariaLabel: "调整侧栏宽度", direction: "from-end", liveResizeId: "right-workspace",
        size: width, collapsed, min: 220, max: 600, onResize: setWidth, onCollapsedChange: setCollapsed,
      }));
  }
  root = createRoot(container);
  act(() => root?.render(createElement(Layout)));
  const divider = container.querySelector<HTMLDivElement>('[role="separator"]')!;
  const section = container.querySelector("section")!;
  const releasePointerCapture = vi.fn();
  Object.assign(divider, { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn(() => true), releasePointerCapture });
  const listener = (event: Event): void => {
    const detail = (event as CustomEvent<LivePanelResizeDetail>).detail;
    snapshots.push({ phase: detail.phase, size: detail.size, width: section.style.width, collapsed: section.dataset.collapsed ?? "" });
  };
  window.addEventListener(LIVE_PANEL_RESIZE_EVENT, listener);
  listeners.push(listener);
  return { divider, releasePointerCapture, snapshots };
}

describe("ResizableDivider pointer updates", () => {
  it("applies native geometry immediately and rejects input from a different drag", () => {
    const { divider, snapshots } = renderDivider();
    let id = "";
    const started = (event: Event): void => { id = (event as CustomEvent<LivePanelResizeDetail>).detail.dragId ?? id; };
    window.addEventListener(LIVE_PANEL_RESIZE_EVENT, started); listeners.push(started);
    act(() => { divider.dispatchEvent(pointer("pointerdown", 500)); });
    act(() => { window.dispatchEvent(new CustomEvent(NATIVE_PANEL_RESIZE_EVENT, {
      detail: { id: "stale", phase: "move", pointerX: 450, size: 350, collapsed: false } })); });
    expect(snapshots.at(-1)?.phase).toBe("start");
    act(() => { window.dispatchEvent(new CustomEvent(NATIVE_PANEL_RESIZE_EVENT, {
      detail: { id, phase: "move", pointerX: 450, size: 350, collapsed: false } })); });
    expect(snapshots.at(-1)).toEqual({ phase: "move", size: 350, width: "350px", collapsed: "false" });
    act(() => { window.dispatchEvent(new CustomEvent(NATIVE_PANEL_RESIZE_EVENT, {
      detail: { id, phase: "end", pointerX: 440, size: 360, collapsed: false } })); });
    expect(snapshots.at(-1)).toEqual({ phase: "end", size: 360, width: "360px", collapsed: "false" });
    expect(document.body.hasAttribute("data-resizing-panel")).toBe(false);
  });
  it("commits width and collapse state before emitting each live resize event", () => {
    const { divider, snapshots } = renderDivider();
    act(() => { divider.dispatchEvent(pointer("pointerdown", 500)); });
    act(() => {
      window.dispatchEvent(pointer("pointermove", 460));
      expect(snapshots.at(-1)).toEqual({ phase: "move", size: 340, width: "340px", collapsed: "false" });
      window.dispatchEvent(pointer("pointermove", 610));
      expect(snapshots.at(-1)).toEqual({ phase: "move", size: 220, width: "220px", collapsed: "true" });
      window.dispatchEvent(pointer("pointermove", 550));
      expect(snapshots.at(-1)).toEqual({ phase: "move", size: 220, width: "220px", collapsed: "false" });
      window.dispatchEvent(pointer("pointerup", 550));
    });
    expect(divider.hasAttribute("data-resizing")).toBe(false);
    expect(document.body.hasAttribute("data-resizing-panel")).toBe(false);
  });

  it.each(["pointerup", "pointercancel", "unmount"])("removes capture and global listeners after %s", (ending) => {
    const { divider, releasePointerCapture, snapshots } = renderDivider();
    act(() => { divider.dispatchEvent(pointer("pointerdown", 500)); });
    act(() => {
      if (ending === "unmount") { root?.unmount(); root = null; }
      else window.dispatchEvent(pointer(ending, 500));
    });
    expect(releasePointerCapture).toHaveBeenCalledWith(1);
    expect(document.body.hasAttribute("data-resizing-panel")).toBe(false);
    expect(divider.hasAttribute("data-resizing")).toBe(false);
    const count = snapshots.length;
    act(() => { window.dispatchEvent(pointer("pointermove", 400)); });
    expect(snapshots).toHaveLength(count);
    expect(snapshots.at(-1)?.phase).toBe("end");
  });
});

describe("ResizableDivider helpers", () => {
  it("clamps a requested width to the configured range", () => {
    expect(clampResizablePanelWidth(189.4, 220, 420)).toBe(220);
    expect(clampResizablePanelWidth(320.6, 220, 420)).toBe(321);
    expect(clampResizablePanelWidth(480, 220, 420)).toBe(420);
  });

  it("uses the correct drag direction for each sidebar", () => {
    expect(getResizedPanelWidth(288, 40, "from-start")).toBe(328);
    expect(getResizedPanelWidth(280, 40, "from-end")).toBe(240);
  });

  it("collapses and restores after crossing the resize threshold", () => {
    expect(getResizeCollapseTransition(196, 220, 24, false)).toBe("collapse");
    expect(getResizeCollapseTransition(244, 220, 24, true)).toBe("expand");
    expect(getResizeCollapseTransition(220, 220, 24, false)).toBeNull();
    expect(getResizeCollapseTransition(220, 220, 24, true)).toBeNull();
  });
});
