// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AppUpdateState } from "@agent/protocol";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { AgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { TooltipProvider } from "../ui/tooltip.js";
import { ActivityBar } from "./activity-bar.js";

let root: Root | null = null;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

it("opens About from the update indicator when a new version is announced", async () => {
  let notify: ((state: AppUpdateState) => void) | undefined;
  const idle: AppUpdateState = { status: "idle", currentVersion: "0.1.0", availableVersion: null, progress: null, message: null };
  const client = {
    getAppUpdateState: vi.fn().mockResolvedValue(idle),
    onAppUpdateChanged: (listener: (state: AppUpdateState) => void) => { notify = listener; return () => undefined; },
  } as unknown as AgentClient;
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  await act(() => Promise.resolve().then(() => { root?.render(<TooltipProvider><ActivityBar agentClient={client} /></TooltipProvider>); }));
  expect(element.querySelector('[aria-label="更新至 0.2.0"]')).toBeNull();
  await act(() => Promise.resolve().then(() => { notify?.({ ...idle, status: "available", availableVersion: "0.2.0" }); }));
  const indicator = element.querySelector<HTMLButtonElement>('[aria-label="更新至 0.2.0"]');
  expect(indicator).not.toBeNull();
  await act(() => Promise.resolve().then(() => { indicator?.click(); }));
  expect(useWorkbenchUiStore.getState()).toMatchObject({ activeActivity: "settings", settingsSection: "about" });
});
