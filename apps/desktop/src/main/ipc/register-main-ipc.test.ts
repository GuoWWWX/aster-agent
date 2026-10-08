import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { IPC_CHANNELS, type ConversationSummary } from "@agent/protocol";
import { registerMainIpcHandlers } from "./register-main-ipc.js";

const electron = vi.hoisted(() => ({
  handle: vi.fn<(channel: string, handler: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>) => void>(),
  removeHandler: vi.fn<(channel: string) => void>(), on: vi.fn(), removeListener: vi.fn(),
  fromWebContents: vi.fn(),
}));
vi.mock("electron", () => ({
  app: {}, clipboard: {}, dialog: {}, shell: {}, ipcMain: electron,
  BrowserWindow: { fromWebContents: electron.fromWebContents },
}));

describe("result viewed IPC notification", () => {
  let dispose: (() => void) | undefined;
  const send = vi.fn();
  const markViewed = vi.fn();
  const conversation: ConversationSummary = {
    id: "00000000-0000-4000-8000-000000000001", title: "已结束的子代理",
    activeRunId: null, activeSubagentCount: 0, hasUnreadResult: false,
    agentId: null, archivedAt: null, createdAt: "2026-10-09T00:00:00.000Z",
    isArchived: false, isPinned: false, lastRunStatus: "completed",
    modelSelection: null, parentConversationId: null, pinOrder: null,
    projectId: null, teamId: null, teamWorkItemId: null, threadKind: "subagent",
    updatedAt: "2026-10-09T00:00:00.000Z", workspaceRootPath: null,
  };
  let invoke: (event: IpcMainInvokeEvent, input: unknown) => Promise<unknown>;
  const event = { sender: {} } as IpcMainInvokeEvent;

  beforeEach(() => {
    vi.clearAllMocks();
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window);
    markViewed.mockReturnValue(conversation);
    const unsubscribe = () => undefined;
    // Only subscription owners and the handler's lifecycle owner are used at registration.
    const dependencies = {
      applicationSettings: { onChanged: () => unsubscribe },
      terminalSessions: { onEvent: () => unsubscribe },
      workspaceTerminalTabs: { onOpenRequested: () => unsubscribe, onCloseRequested: () => unsubscribe, dispose: unsubscribe },
      workspaceBrowserTabs: { onOpenRequested: () => unsubscribe, onCloseRequested: () => unsubscribe, dispose: unsubscribe },
      managedBrowser: { onEvent: () => unsubscribe },
      conversationLifecycle: { markConversationResultViewed: markViewed },
    } as unknown as Parameters<typeof registerMainIpcHandlers>[1];
    dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    invoke = electron.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.conversationMarkResultViewed)![1];
  });
  afterEach(() => { dispose?.(); dispose = undefined; });

  it("broadcasts the committed summary to every conversation view", async () => {
    await expect(invoke(event, { conversationId: conversation.id })).resolves.toEqual(conversation);
    expect(send).toHaveBeenCalledExactlyOnceWith(IPC_CHANNELS.conversationRunEvent, {
      type: "conversation.updated", conversation,
    });
    expect(markViewed.mock.invocationCallOrder[0]).toBeLessThan(send.mock.invocationCallOrder[0]!);
  });

  it("does not broadcast a viewed result when persistence fails", async () => {
    markViewed.mockImplementation(() => { throw new Error("write failed"); });
    await expect(invoke(event, { conversationId: conversation.id })).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([{ conversationId: "invalid" }, { conversationId: conversation.id, extra: true }])(
    "rejects invalid input before updating or notifying", async (input) => {
      await expect(invoke(event, input)).rejects.toThrow();
      expect(markViewed).not.toHaveBeenCalled();
      expect(send).not.toHaveBeenCalled();
    },
  );

  it("rejects an untrusted renderer before updating or notifying", async () => {
    electron.fromWebContents.mockReturnValue(null);
    await expect(invoke(event, { conversationId: conversation.id })).rejects.toThrow();
    expect(markViewed).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("disposes every registered handler and the bounds listener", () => {
    const registered = electron.handle.mock.calls.map(([channel]) => channel);
    dispose?.(); dispose = undefined;
    expect(electron.removeHandler.mock.calls.map(([channel]) => channel)).toEqual(registered);
    expect(electron.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.managedBrowserSetBounds, expect.any(Function));
  });
});
