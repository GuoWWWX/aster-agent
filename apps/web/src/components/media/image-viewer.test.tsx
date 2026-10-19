// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui/tooltip.js";
import { MediaPreviewDialog } from "./image-viewer.js";
const portal = vi.hoisted(() => ({ container: undefined as HTMLElement | undefined }));
vi.mock("../ui/native-overlay-provider.js", () => ({ useNativeOverlayContainer: () => portal.container }));
afterEach(() => { vi.unstubAllGlobals(); portal.container = undefined; });

it("uses a transparent overlay, keeps image controls active and closes on uncovered space", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const node = document.createElement("div"); document.body.append(node); const root = createRoot(node), changed = vi.fn();
  act(() => root.render(<TooltipProvider><MediaPreviewDialog open onOpenChange={changed} src="data:image/png;base64,AQID" title="Preview" /></TooltipProvider>));
  expect(document.querySelector('[data-slot="dialog-overlay"]')?.className).toContain("bg-transparent");
  act(() => document.querySelector("img")!.click()); expect(changed).not.toHaveBeenCalled();
  act(() => (document.querySelector('[aria-label="放大图片"]') as HTMLButtonElement).click()); expect(changed).not.toHaveBeenCalled();
  act(() => (document.querySelector('[data-slot="dialog-content"]') as HTMLDivElement).click()); expect(changed).toHaveBeenCalledWith(false);
  act(() => root.unmount()); node.remove();
});

it("closes on blank space in a separate overlay document", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  const frame = document.createElement("iframe"); document.body.append(frame);
  portal.container = frame.contentDocument!.body;
  const node = document.createElement("div"); document.body.append(node);
  const root = createRoot(node), changed = vi.fn();
  act(() => root.render(<TooltipProvider><MediaPreviewDialog open onOpenChange={changed} src="data:image/png;base64,AQID" title="Overlay" /></TooltipProvider>));
  const content = portal.container.querySelector<HTMLDivElement>('[data-slot="dialog-content"]')!;
  expect(content instanceof HTMLElement).toBe(false);
  act(() => portal.container!.querySelector<HTMLImageElement>("img")!.click()); expect(changed).not.toHaveBeenCalled();
  act(() => content.click()); expect(changed).toHaveBeenCalledWith(false);
  act(() => root.unmount()); node.remove(); frame.remove();
});
