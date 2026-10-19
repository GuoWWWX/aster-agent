// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui/tooltip.js";
import { MediaPreviewDialog } from "./image-viewer.js";
const portal = vi.hoisted(() => ({ container: undefined as HTMLElement | undefined }));
vi.mock("../ui/native-overlay-provider.js", () => ({ useNativeOverlayContainer: () => portal.container }));
afterEach(() => { vi.unstubAllGlobals(); portal.container = undefined; });

it("uses a lightly blurred overlay, keeps image controls active and closes on uncovered space", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node), changed = vi.fn();
  act(() => root.render(<TooltipProvider><MediaPreviewDialog open onOpenChange={changed} src="data:image/png;base64,AQID" title="Preview" /></TooltipProvider>));
  expect(document.querySelector('[data-slot="dialog-overlay"]')?.className).toContain("backdrop-blur-[3px]");
  act(() => document.querySelector("img")!.click()); expect(changed).not.toHaveBeenCalled();
  act(() => (document.querySelector('[aria-label="放大图片"]') as HTMLButtonElement).click()); expect(changed).not.toHaveBeenCalled();
  act(() => (document.querySelector('[data-slot="dialog-content"]') as HTMLDivElement).click()); expect(changed).toHaveBeenCalledWith(false);
  act(() => root.unmount()); node.remove();
});

it("closes on blank space in a separate overlay document", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const frame = document.createElement("iframe"); document.body.append(frame);
  const workbench = document.createElement("div"); workbench.className = "workbench-grid";
  workbench.innerHTML = '<aside data-slot="activity-bar"></aside><main class="workbench-main"></main>';
  document.body.append(workbench);
  portal.container = frame.contentDocument!.body;
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node), changed = vi.fn();
  act(() => root.render(<TooltipProvider><MediaPreviewDialog open onOpenChange={changed} src="data:image/png;base64,AQID" title="Overlay" /></TooltipProvider>));
  const content = portal.container.querySelector<HTMLDivElement>('[data-slot="dialog-content"]')!;
  expect(content instanceof HTMLElement).toBe(false);
  expect(workbench.querySelector<HTMLElement>("main")?.style.filter).toBe("blur(3px)");
  expect(workbench.querySelector<HTMLElement>("aside")?.style.filter).toBe("");
  act(() => portal.container!.querySelector<HTMLImageElement>("img")!.click()); expect(changed).not.toHaveBeenCalled();
  act(() => content.click()); expect(changed).toHaveBeenCalledWith(false);
  act(() => root.unmount());
  expect(workbench.querySelector<HTMLElement>("main")?.style.filter).toBe("");
  node.remove(); frame.remove(); workbench.remove();
});

it("navigates the whole supplied conversation gallery lazily and retains the current image on failure", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node), changed = vi.fn();
  const first = vi.fn().mockResolvedValue("data:image/png;base64,FIRST");
  const third = vi.fn().mockRejectedValueOnce(new Error("missing")).mockResolvedValue("data:image/png;base64,THIRD");
  await act(async () => { root.render(<TooltipProvider><MediaPreviewDialog open onOpenChange={changed} src="data:image/png;base64,SECOND" imageKey="second" title="second.png"
    images={[{ key: "first", label: "D:/pictures/first.png", load: first }, { key: "second", label: "second.png", load: () => Promise.resolve("data:image/png;base64,SECOND") }, { key: "third", label: "third.png", load: third }]} /></TooltipProvider>); await Promise.resolve(); });
  expect(first).not.toHaveBeenCalled(); expect(third).not.toHaveBeenCalled();
  expect(document.body.textContent).toContain("2 / 3");
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="下一张图片"]')!.click(); await Promise.resolve(); });
  expect(document.querySelector("img")?.src).toContain("SECOND");
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("无法读取");
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="下一张图片"]')!.click(); await Promise.resolve(); });
  expect(document.querySelector("img")?.src).toContain("THIRD");
  expect(document.body.textContent).toContain("3 / 3");
  expect(document.querySelector<HTMLButtonElement>('[aria-label="下一张图片"]')?.disabled).toBe(true);
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="上一张图片"]')!.click(); await Promise.resolve(); });
  expect(document.body.textContent).toContain("2 / 3");
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="上一张图片"]')!.click(); await Promise.resolve(); });
  expect(document.body.textContent).toContain("D:/pictures/first.png");
  expect(changed).not.toHaveBeenCalled();
  act(() => root.unmount()); node.remove();
});
