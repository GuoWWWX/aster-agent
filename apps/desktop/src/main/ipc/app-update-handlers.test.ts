import { describe, expect, it, vi } from "vitest";
import { IPC_CHANNELS } from "@agent/protocol";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import type { AppUpdateController } from "../updates/app-update-controller.js";
import { registerAppUpdateHandlers } from "./app-update-handlers.js";

const electron = vi.hoisted(() => ({ fromWebContents: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: { fromWebContents: electron.fromWebContents } }));

describe("application update IPC", () => {
  it("accepts only empty requests from the trusted main frame", () => {
    const handlers = new Map<string, (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown>();
    const window = { isDestroyed: () => false } as BrowserWindow;
    const frame = {};
    const event = { sender: { mainFrame: frame }, senderFrame: frame } as unknown as IpcMainInvokeEvent;
    const state = { status: "downloaded", currentVersion: "0.1.0", availableVersion: "0.2.0", progress: null, message: null };
    const install = vi.fn(() => state);
    const updates = { getState: () => state, check: () => Promise.resolve(state), download: () => state,
      pause: () => Promise.resolve(state), install } as unknown as AppUpdateController;
    electron.fromWebContents.mockReturnValue(window);
    registerAppUpdateHandlers({ ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } }, getMainWindow: () => window }, updates);
    const handler = handlers.get(IPC_CHANNELS.appUpdateInstall)!;
    expect(handler(event)).toEqual(state);
    expect(install).toHaveBeenCalledOnce();
    expect(() => handler(event, { path: "attacker.exe" })).toThrow();
    expect(() => handler({ ...event, senderFrame: {} } as IpcMainInvokeEvent)).toThrow(/subframe/u);
    electron.fromWebContents.mockReturnValue(null);
    expect(() => handler(event)).toThrow(/untrusted/u);
    expect(install).toHaveBeenCalledOnce();
  });
});
