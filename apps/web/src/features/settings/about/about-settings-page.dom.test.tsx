// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppUpdateState } from "@agent/protocol";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentClient } from "../../../runtime/index.js";
import { AboutSettings } from "./about-settings-page.js";

let root: Root | null = null;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

it("shows the repository, update progress, and pause action", async () => {
  const available: AppUpdateState = { status: "available", currentVersion: "0.1.0", availableVersion: "0.2.0", progress: null, message: null };
  let notify: ((state: AppUpdateState) => void) | undefined;
  const pause = vi.fn().mockResolvedValue({ ...available, status: "paused" });
  const client = {
    getRuntimeInfo: vi.fn().mockResolvedValue({ appVersion: "0.1.0" }),
    getAppUpdateState: vi.fn().mockResolvedValue(available),
    onAppUpdateChanged: (listener: (state: AppUpdateState) => void) => { notify = listener; return () => undefined; },
    pauseAppUpdate: pause,
  } as unknown as AgentClient;
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  await act(() => Promise.resolve().then(() => { root?.render(<AboutSettings agentClient={client} />); }));
  expect(element.querySelector<HTMLAnchorElement>('a[href="https://github.com/GuoWWWX/aster-agent"]')?.target).toBe("_blank");
  expect(element.textContent).toContain("0.1.0");
  expect(element.textContent).toContain("下载更新");
  await act(() => Promise.resolve().then(() => { notify?.({ ...available, status: "downloading", progress: { mode: "differential", transferred: 512, total: 1024, bytesPerSecond: 256 } }); }));
  expect(element.querySelector("progress")?.value).toBe(50);
  expect(element.textContent).toContain("差量更新");
  const pauseButton = [...element.querySelectorAll("button")].find((button) => button.textContent === "暂停下载");
  await act(() => Promise.resolve().then(() => { pauseButton?.click(); }));
  expect(pause).toHaveBeenCalledOnce();
  expect(element.textContent).toContain("继续下载");
});

it("keeps a newer pushed state when an earlier action returns later", async () => {
  const available: AppUpdateState = { status: "available", currentVersion: "0.1.0", availableVersion: "0.2.0", progress: null, message: null };
  let notify: ((state: AppUpdateState) => void) | undefined;
  let complete: ((state: AppUpdateState) => void) | undefined;
  const client = {
    getRuntimeInfo: vi.fn().mockResolvedValue({ appVersion: "0.1.0" }),
    getAppUpdateState: vi.fn().mockResolvedValue(available),
    onAppUpdateChanged: (listener: (state: AppUpdateState) => void) => { notify = listener; return () => undefined; },
    downloadAppUpdate: () => new Promise<AppUpdateState>((resolve) => { complete = resolve; }),
  } as unknown as AgentClient;
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  await act(() => Promise.resolve().then(() => { root?.render(<AboutSettings agentClient={client} />); }));
  const download = [...element.querySelectorAll("button")].find((button) => button.textContent === "下载更新");
  await act(() => Promise.resolve().then(() => { download?.click(); }));
  await act(() => Promise.resolve().then(() => { notify?.({ ...available, status: "downloaded" }); }));
  await act(() => Promise.resolve().then(() => { complete?.({ ...available, status: "downloading" }); }));
  expect(element.textContent).toContain("重启并安装");
  expect(element.textContent).not.toContain("暂停下载");
});
