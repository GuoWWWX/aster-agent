// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { TooltipProvider } from "../ui/tooltip.js";
import { MediaPreviewDialog } from "./image-viewer.js";
afterEach(() => vi.unstubAllGlobals());

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
