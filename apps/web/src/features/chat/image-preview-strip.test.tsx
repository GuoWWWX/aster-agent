// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { ImagePreviewStrip } from "./image-preview-strip.js";

it("uses the wheel to browse overflowing images and releases vertical scrolling at the ends", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(<ImagePreviewStrip><img alt="第一张" /><img alt="第二张" /></ImagePreviewStrip>));
  const row = host.querySelector<HTMLElement>('[role="region"]')!;
  Object.defineProperties(row, { scrollWidth: { value: 600 }, clientWidth: { value: 200 } });
  const wheel = (deltaY: number, options: WheelEventInit = {}) => {
    const event = new WheelEvent("wheel", { deltaY, bubbles: true, cancelable: true, ...options });
    row.dispatchEvent(event); return event;
  };
  expect(wheel(80).defaultPrevented).toBe(true); expect(row.scrollLeft).toBe(80);
  expect(wheel(-30).defaultPrevented).toBe(true); expect(row.scrollLeft).toBe(50);
  expect(wheel(0, { deltaX: 60 }).defaultPrevented).toBe(true); expect(row.scrollLeft).toBe(110);
  expect(wheel(10, { ctrlKey: true }).defaultPrevented).toBe(false); expect(row.scrollLeft).toBe(110);
  row.scrollLeft = 400; expect(wheel(80).defaultPrevented).toBe(false);
  row.scrollLeft = 0; expect(wheel(-80).defaultPrevented).toBe(false);
  act(() => root.unmount()); host.remove(); vi.unstubAllGlobals();
});
