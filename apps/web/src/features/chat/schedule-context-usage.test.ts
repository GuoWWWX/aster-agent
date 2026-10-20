// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { scheduleContextUsage } from "./schedule-context-usage.js";

afterEach(() => { vi.unstubAllGlobals(); });
it("waits for a paint and an idle slot, and cancels a superseded conversation's pending read", () => {
  let paint: FrameRequestCallback | undefined, idle: IdleRequestCallback | undefined;
  vi.stubGlobal("requestAnimationFrame", vi.fn((callback: FrameRequestCallback) => { paint = callback; return 1; }));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  vi.stubGlobal("requestIdleCallback", vi.fn((callback: IdleRequestCallback) => { idle = callback; return 2; }));
  const cancelIdle = vi.fn(); vi.stubGlobal("cancelIdleCallback", cancelIdle);
  const refresh = vi.fn();
  const cancel = scheduleContextUsage(refresh);
  expect(refresh).not.toHaveBeenCalled();
  paint?.(0);
  expect(refresh).not.toHaveBeenCalled();
  cancel();
  idle?.({ didTimeout: false, timeRemaining: () => 10 });
  expect(refresh).not.toHaveBeenCalled();
  expect(cancelIdle).toHaveBeenCalledWith(2);
  scheduleContextUsage(refresh);
  paint?.(1); idle?.({ didTimeout: false, timeRemaining: () => 10 });
  expect(refresh).toHaveBeenCalledTimes(1);
});
