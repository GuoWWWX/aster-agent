// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { NativeOverlayResizePointer } from "@agent/protocol";

import { emitLivePanelResize } from "../layout/live-panel-resize.js";
import { NativeOverlayProvider, useNativeOverlayContainer } from "./native-overlay-provider.js";

let root: Root;
let host: Window;
let mount: HTMLElement;
const update = vi.fn();
let parentFocus: () => void;
let resizePointer: (pointer: NativeOverlayResizePointer) => void;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("PointerEvent", MouseEvent);
  vi.stubGlobal("ResizeObserver", class { observe(): void {} unobserve(): void {} disconnect(): void {} });
  vi.spyOn(window, "requestAnimationFrame").mockReturnValue(1);
  vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => undefined);
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  host = iframe.contentWindow!;
  host.document.body.innerHTML = '<div id="overlay-root"></div>';
  Object.assign(host, { nativeOverlay: {
    update,
    onParentFocus: (listener: () => void) => { parentFocus = listener; return vi.fn(); },
    onResizePointer: (listener: typeof resizePointer) => { resizePointer = listener; return vi.fn(); },
  } });
  vi.spyOn(host, "close").mockImplementation(() => undefined);
  vi.spyOn(window, "open").mockReturnValue(host);
  vi.stubGlobal("agentDesktop", {});
  mount = document.createElement("div");
  document.body.append(mount);
  root = createRoot(mount);
  update.mockReset();
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function Popup(): ReactElement {
  const container = useNativeOverlayContainer();
  return <>{container === undefined ? null : createPortal(<div data-native-view-overlay="" role="dialog">Actual popup</div>, container)}</>;
}

async function flush(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => window.setTimeout(resolve, 0));
  });
}

async function ready(): Promise<HTMLElement> {
  act(() => root.render(<NativeOverlayProvider><Popup /></NativeOverlayProvider>));
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
  act(() => { window.dispatchEvent(new MessageEvent("message", { data: "aster:native-overlay-ready", origin: location.origin, source: host })); });
  const popup = host.document.querySelector<HTMLElement>("[data-native-view-overlay]")!;
  vi.spyOn(popup, "getBoundingClientRect").mockReturnValue(new DOMRect(600, 80, 300, 200));
  await flush();
  return popup;
}

it("keeps the popup in the native host, mirrors theme, and removes its input region when closed", async () => {
  document.documentElement.dataset.theme = "dark";
  const popup = await ready();
  expect(mount.textContent).not.toContain("Actual popup");
  expect(host.document.documentElement.dataset.theme).toBe("dark");
  expect(update).toHaveBeenLastCalledWith({ regions: [{ x: 588, y: 68, width: 324, height: 224 }], interactive: true, resizing: false });
  popup.dataset.state = "closed";
  await flush();
  expect(update).toHaveBeenLastCalledWith({ regions: [], interactive: false, resizing: false });
});

it("preserves outside gesture targets and dismisses when focus returns from the native page", async () => {
  await ready();
  const listener = vi.fn();
  host.document.addEventListener("click", listener);
  mount.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  expect(listener).toHaveBeenCalledWith(expect.objectContaining({ target: mount }));
  const escape = vi.fn();
  host.document.addEventListener("keydown", escape);
  parentFocus();
  expect(escape).toHaveBeenCalledWith(expect.objectContaining({ key: "Escape" }));
  const parentKeys = vi.fn();
  window.addEventListener("keydown", parentKeys);
  host.document.dispatchEvent(new KeyboardEvent("keydown", { key: "z", ctrlKey: true, bubbles: true }));
  expect(parentKeys).not.toHaveBeenCalled();
  host.document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  expect(parentKeys).toHaveBeenCalledOnce();
  window.removeEventListener("keydown", parentKeys);
});

it("relays every native drag movement without placing a full-window input layer above the page", async () => {
  await ready();
  const surface = document.createElement("div");
  surface.dataset.managedBrowserSurface = "";
  vi.spyOn(surface, "getBoundingClientRect").mockReturnValue(new DOMRect(500, 100, 300, 400));
  document.body.append(surface);
  document.body.dataset.resizingPanel = "true";
  act(() => emitLivePanelResize({ id: "right-workspace", phase: "start", size: 300 }));
  expect(update).toHaveBeenLastCalledWith({ regions: [{ x: 588, y: 68, width: 324, height: 224 }], interactive: true, resizing: true });
  const move = vi.fn();
  window.addEventListener("pointermove", move);
  for (const x of [450, 400, 350]) resizePointer({ phase: "move", x, y: 200 });
  expect(move).not.toHaveBeenCalled();
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 20)); });
  expect(move).toHaveBeenCalledTimes(1);
  expect(move).toHaveBeenLastCalledWith(expect.objectContaining({ clientX: 350 }));
  window.removeEventListener("pointermove", move);
  const up = vi.fn();
  window.addEventListener("pointerup", up);
  resizePointer({ phase: "end", x: 350, y: 200 });
  expect(up).toHaveBeenCalledTimes(1);
  window.removeEventListener("pointerup", up);
  delete document.body.dataset.resizingPanel;
  act(() => emitLivePanelResize({ id: "right-workspace", phase: "end", size: 350 }));
  expect(update).toHaveBeenLastCalledWith({ regions: [{ x: 588, y: 68, width: 324, height: 224 }], interactive: true, resizing: false });
});

it("ignores readiness messages from any other window", async () => {
  act(() => root.render(<NativeOverlayProvider><Popup /></NativeOverlayProvider>));
  await act(async () => { await new Promise((resolve) => window.setTimeout(resolve, 0)); });
  act(() => { window.dispatchEvent(new MessageEvent("message", { data: "aster:native-overlay-ready", origin: location.origin, source: window })); });
  expect(host.document.querySelector("[data-native-view-overlay]")).toBeNull();
  expect(update).not.toHaveBeenCalled();
});
