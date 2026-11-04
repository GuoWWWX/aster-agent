// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useWorkbenchModalBackdrop } from "./use-workbench-modal-backdrop.js";

const portal = vi.hoisted(() => ({ container: undefined as HTMLElement | undefined }));
vi.mock("./native-overlay-provider.js", () => ({ useNativeOverlayContainer: () => portal.container }));
let root: Root;
let workbench: HTMLElement;
let rail: HTMLElement;
let top = 36;
let left = 44;

function Backdrop() { return <div data-backdrop="" style={useWorkbenchModalBackdrop()} />; }

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  document.body.innerHTML = '<header class="app-titlebar"></header><div class="workbench-grid"><aside data-slot="activity-bar"></aside><aside class="workbench-sidebar"></aside><main class="workbench-main"></main></div><div id="mount"></div>';
  workbench = document.querySelector<HTMLElement>(".workbench-grid")!;
  rail = workbench.querySelector<HTMLElement>("[data-slot=activity-bar]")!;
  top = 36; left = 44;
  vi.spyOn(workbench, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, top, window.innerWidth - 8, window.innerHeight - top - 10));
  vi.spyOn(rail, "getBoundingClientRect").mockImplementation(() => new DOMRect(0, top, left, window.innerHeight - top));
  root = createRoot(document.getElementById("mount")!);
});
afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  portal.container = undefined;
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

it("clips the modal backdrop to the workbench outside both chrome bars and follows resize", () => {
  act(() => root.render(<Backdrop />));
  const backdrop = document.querySelector<HTMLElement>("[data-backdrop]")!;
  expect([backdrop.style.top, backdrop.style.left, backdrop.style.right, backdrop.style.bottom]).toEqual(["36px", "44px", "8px", "10px"]);
  top = 48; left = 60;
  act(() => { window.dispatchEvent(new Event("resize")); });
  expect([backdrop.style.top, backdrop.style.left]).toEqual(["48px", "60px"]);
  expect(workbench.querySelector<HTMLElement>("main")?.style.filter).toBe("");
});

it("blurs only host work surfaces for native dialogs and restores them after the last modal closes", () => {
  const frame = document.createElement("iframe"); document.body.append(frame);
  portal.container = frame.contentDocument!.body;
  const main = workbench.querySelector<HTMLElement>("main")!;
  const sidebar = workbench.querySelector<HTMLElement>(".workbench-sidebar")!;
  main.style.filter = "contrast(1.1)";
  act(() => root.render(<><Backdrop key="one" /><Backdrop key="two" /></>));
  expect(main.style.filter).toBe("contrast(1.1) blur(3px)");
  expect(sidebar.style.filter).toBe("blur(3px)");
  expect(rail.style.filter).toBe("");
  expect(document.querySelector<HTMLElement>(".app-titlebar")?.style.filter).toBe("");
  act(() => root.render(<><Backdrop key="two" /></>));
  expect(main.style.filter).toBe("contrast(1.1) blur(3px)");
  act(() => root.render(null));
  expect(main.style.filter).toBe("contrast(1.1)");
  expect(sidebar.style.filter).toBe("");
});
