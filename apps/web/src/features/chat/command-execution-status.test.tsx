// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { CommandExecutionStatus, type CommandExecutionState } from "./command-execution-status.js";

let root: Root;
let mount: HTMLDivElement;
const startedAt = "2026-10-16T00:00:00Z";
const state: CommandExecutionState = { status: "running", startedAt, completedAt: null, timedOut: false };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers(); vi.setSystemTime(Date.parse(startedAt) + 2_000);
  mount = document.createElement("div"); document.body.append(mount); root = createRoot(mount);
});
afterEach(() => { act(() => root.unmount()); mount.remove(); vi.useRealTimers(); });

it("ticks from process start, freezes at process exit and releases the timer", () => {
  act(() => root.render(<CommandExecutionStatus execution={state} />));
  expect(mount.textContent).toBe("运行中2s");
  act(() => { vi.advanceTimersByTime(3_000); });
  expect(mount.textContent).toBe("运行中5s");
  act(() => root.render(<CommandExecutionStatus execution={{ ...state, status: "completed", completedAt: "2026-10-16T00:00:02.900Z" }} />));
  expect(mount.textContent).toBe("已完成2s");
  expect(vi.getTimerCount()).toBe(0);
  act(() => { vi.advanceTimersByTime(60_000); });
  expect(mount.textContent).toBe("已完成2s");
});

it.each([
  ["failed", true, "超时"], ["failed", false, "失败"], ["cancelled", false, "已停止"],
  ["awaiting_approval", false, "待审批"],
] as const)("shows %s without inventing a missing duration", (status, timedOut, label) => {
  act(() => root.render(<CommandExecutionStatus execution={{ ...state, status, timedOut }} />));
  expect(mount.textContent).toBe(label);
  expect(vi.getTimerCount()).toBe(0);
});

it("omits timing from expanded summaries and starts no redundant clock", () => {
  act(() => root.render(<CommandExecutionStatus execution={state} showDuration={false} />));
  expect(mount.textContent).toBe("运行中");
  expect(mount.querySelector("[data-command-duration]")).toBeNull();
  expect(vi.getTimerCount()).toBe(0);
});
