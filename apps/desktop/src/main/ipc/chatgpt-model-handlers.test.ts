import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS } from "@agent/protocol";

const electron = vi.hoisted(() => ({ fromWebContents: vi.fn() }));
vi.mock("electron", () => ({ BrowserWindow: { fromWebContents: electron.fromWebContents } }));

import { registerModelHandlers } from "./model-handlers.js";
import type { IpcHandler } from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";

describe("ChatGPT model IPC", () => {
  it("accepts only trusted renderers and valid IDs and never returns extra credential fields", async () => {
    const handlers = new Map<string, IpcHandler>();
    const mainFrame = {};
    const window = { isDestroyed: () => false, webContents: { mainFrame } } as unknown as BrowserWindow;
    const credentials = {
      listChatGptConnections: vi.fn(() => []),
      connectChatGpt: vi.fn().mockResolvedValue({ providerId: "00000000-0000-4000-8000-000000000001", email: "user@example.test", planEnabled: true }),
      disconnectChatGpt: vi.fn().mockResolvedValue(true),
      syncChatGptModels: vi.fn(),
    };
    registerModelHandlers({ ipcMain: { handle: (channel, handler) => { handlers.set(channel, handler); } }, getMainWindow: () => window },
      { credentials, modelCatalog: {} } as unknown as Pick<MainIpcDependencies, "credentials" | "modelCatalog">);
    const event = { sender: {}, senderFrame: mainFrame } as IpcMainInvokeEvent;
    const call = (channel: string, ...args: unknown[]) => Promise.resolve(handlers.get(channel)!(event, ...args));

    electron.fromWebContents.mockReturnValue(null);
    expect(() => handlers.get(IPC_CHANNELS.modelChatGptList)!(event)).toThrow(/untrusted/u);
    electron.fromWebContents.mockReturnValue(window);
    expect(await call(IPC_CHANNELS.modelChatGptList)).toEqual([]);
    expect(await call(IPC_CHANNELS.modelProviderAccounts, { action: "providers" })).toMatchObject({ providers: [{ kind: "chatgpt" }] });
    expect(await call(IPC_CHANNELS.modelProviderAccounts, { action: "list", kind: "chatgpt" })).toEqual({ action: "list", connections: [] });
    await expect(call(IPC_CHANNELS.modelProviderAccounts, { action: "list", kind: "unsupported" })).rejects.toThrow();
    await expect(handlers.get(IPC_CHANNELS.modelProviderAccounts)!({ ...event, senderFrame: {} } as IpcMainInvokeEvent, { action: "providers" })).rejects.toThrow(/untrusted frame/u);
    await expect(call(IPC_CHANNELS.modelChatGptDisconnect, { providerId: "invalid" })).rejects.toThrow();
    expect(credentials.disconnectChatGpt).not.toHaveBeenCalled();
    expect(await call(IPC_CHANNELS.modelChatGptConnect, {})).toEqual({
      providerId: "00000000-0000-4000-8000-000000000001", email: "user@example.test", planEnabled: true,
    });
    credentials.connectChatGpt.mockResolvedValueOnce({ providerId: "00000000-0000-4000-8000-000000000001", email: null, planEnabled: true, accessToken: "secret" });
    await expect(call(IPC_CHANNELS.modelChatGptConnect, {})).rejects.toThrow();
  });
});
