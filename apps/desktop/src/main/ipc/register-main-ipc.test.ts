import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { DEFAULT_BROWSER_CONFIGURATION, IPC_CHANNELS, type ConversationSummary } from "@agent/protocol";
import { registerMainIpcHandlers } from "./register-main-ipc.js";

const electron = vi.hoisted(() => ({
  handle: vi.fn<(channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => void>(),
  removeHandler: vi.fn<(channel: string) => void>(), on: vi.fn(), removeListener: vi.fn(),
  fromWebContents: vi.fn(),
  showOpenDialog: vi.fn(() => Promise.resolve({ canceled: false, filePaths: ["D:\\Downloads"] })),
}));
vi.mock("electron", () => ({
  app: { getPath: () => "C:\\Downloads" }, clipboard: {}, dialog: { showOpenDialog: electron.showOpenDialog }, shell: {}, ipcMain: electron,
  BrowserWindow: { fromWebContents: electron.fromWebContents },
}));

describe("result viewed IPC notification", () => {
  let dispose: (() => void) | undefined;
  const send = vi.fn();
  const markViewed = vi.fn();
  const listPasswords = vi.fn(() => [{ origin: "https://example.test", username: "sample-user" }]);
  const revealPassword = vi.fn((): string | null => "sample-secret");
  const emptyModelStatus = { baseUrl: null, configured: false, modelId: null, models: [], providerId: null, recentSelection: null, supportsStreaming: true, supportsTools: true };
  const deleteProvider = vi.fn(() => emptyModelStatus);
  const deleteSkill = vi.fn();
  const scheduleInput = { name: "巡检", prompt: "检查", projectId: null, agentId: null, enabled: true,
    permissionMode: "ask_before_changes" as const, recurrence: { kind: "daily" as const, time: "09:00", timezone: "UTC" } };
  const scheduledTask = { ...scheduleInput, id: "00000000-0000-4000-8000-000000000003",
    createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z", nextRunAt: "2026-10-14T09:00:00.000Z", executions: [] };
  const scheduledTasks = { list: vi.fn(() => [scheduledTask]), save: vi.fn(() => scheduledTask),
    delete: vi.fn(), run: vi.fn(() => scheduledTask) };
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
  let dependencies: Parameters<typeof registerMainIpcHandlers>[1];
  const event = { sender: {} } as IpcMainInvokeEvent;

  beforeEach(() => {
    vi.clearAllMocks();
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window);
    markViewed.mockReturnValue(conversation);
    const unsubscribe = () => undefined;
    // Only subscription owners and the handler's lifecycle owner are used at registration.
    dependencies = {
      scheduledTasks,
      credentials: { deleteProvider },
      skillDocuments: { deleteDocument: deleteSkill },
      applicationSettings: { onChanged: () => unsubscribe },
      terminalSessions: { onEvent: () => unsubscribe },
      workspaceTerminalTabs: { onOpenRequested: () => unsubscribe, onCloseRequested: () => unsubscribe, dispose: unsubscribe },
      workspaceBrowserTabs: { onOpenRequested: () => unsubscribe, onCloseRequested: () => unsubscribe, dispose: unsubscribe },
      managedBrowser: { onEvent: () => unsubscribe, getSavedPasswords: listPasswords, revealPassword },
      browserConfiguration: { getConfiguration: () => DEFAULT_BROWSER_CONFIGURATION },
      conversationLifecycle: { markConversationResultViewed: markViewed, createConversation: () => conversation },
    } as unknown as Parameters<typeof registerMainIpcHandlers>[1];
    dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    invoke = electron.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.conversationMarkResultViewed)![1];
  });
  afterEach(() => { dispose?.(); dispose = undefined; });

  it("publishes IPC creation through the shared observer after persistence", async () => {
    dispose?.();
    // The trusted window is the same object returned to the sender validator.
    const trustedWindow = { isDestroyed: () => false, on: vi.fn(), webContents: { send } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(trustedWindow);
    const publish = vi.fn();
    dispose = registerMainIpcHandlers(() => trustedWindow, dependencies, { resumePendingMessages: false, emitConversationRunEvent: publish });
    const frame = {};
    const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    const create = electron.handle.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.conversationCreate).at(-1)![1];
    await expect(create(trusted, {})).resolves.toEqual(conversation);
    expect(publish).toHaveBeenCalledExactlyOnceWith({ type: "conversation.updated", conversation });
    expect(send).not.toHaveBeenCalled();
    await expect(create(trusted, { extra: true })).rejects.toThrow();
    expect(publish).toHaveBeenCalledTimes(1);
  });

  it("validates scheduled task commands before calling their owner and rejects untrusted senders", async () => {
    const frame = {};
    const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    const handler = (channel: string) => electron.handle.mock.calls.find(([name]) => name === channel)![1];
    await expect(handler(IPC_CHANNELS.scheduledTaskList)(trusted)).resolves.toEqual([scheduledTask]);
    await expect(handler(IPC_CHANNELS.scheduledTaskSave)(trusted, scheduleInput)).resolves.toEqual(scheduledTask);
    await expect(handler(IPC_CHANNELS.scheduledTaskRun)(trusted, { id: scheduledTask.id })).resolves.toEqual(scheduledTask);
    await expect(handler(IPC_CHANNELS.scheduledTaskDelete)(trusted, { id: scheduledTask.id })).resolves.toBeUndefined();
    await expect(handler(IPC_CHANNELS.scheduledTaskSave)(trusted, { ...scheduleInput, extra: true })).rejects.toThrow();
    await expect(handler(IPC_CHANNELS.scheduledTaskRun)(trusted, { id: "invalid" })).rejects.toThrow();
    for (const channel of [IPC_CHANNELS.scheduledTaskList, IPC_CHANNELS.scheduledTaskSave, IPC_CHANNELS.scheduledTaskRun, IPC_CHANNELS.scheduledTaskDelete]) {
      electron.fromWebContents.mockReturnValueOnce(undefined);
      await expect(handler(channel)(trusted, scheduleInput)).rejects.toThrow();
    }
    expect(scheduledTasks.save).toHaveBeenCalledExactlyOnceWith(scheduleInput);
    expect(scheduledTasks.run).toHaveBeenCalledExactlyOnceWith(scheduledTask.id);
    expect(scheduledTasks.delete).toHaveBeenCalledExactlyOnceWith(scheduledTask.id);
  });
  it("validates bounded command output reads and rejects untrusted senders", async () => {
    const read = vi.fn(() => ({ command: { commandId: conversation.id, conversationId: conversation.id, command: "echo ok", mode: "batch", serviceName: null,
      workingDirectory: ".", startedAt: "2026-10-14T01:00:00Z", completedAt: "2026-10-14T01:00:01Z", status: "completed", exitCode: 0 },
      stdout: "ok", stderr: "", error: null, timedOut: false, truncated: false }));
    dependencies.agentRuntime = { readBackgroundCommand: read } as unknown as typeof dependencies.agentRuntime;
    dispose?.();
    const trustedWindow = { isDestroyed: () => false, on: vi.fn(), webContents: { send } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(trustedWindow);
    dispose = registerMainIpcHandlers(() => trustedWindow, dependencies, { resumePendingMessages: false });
    const handler = electron.handle.mock.calls.filter(([name]) => name === IPC_CHANNELS.backgroundCommandRead).at(-1)![1];
    const frame = {}; const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    const input = { conversationId: conversation.id, commandId: conversation.id };
    await expect(handler(trusted, input)).resolves.toMatchObject({ stdout: "ok" });
    await expect(handler(trusted, { ...input, maxChars: 64001 })).rejects.toThrow();
    electron.fromWebContents.mockReturnValueOnce(undefined);
    await expect(handler(trusted, input)).rejects.toThrow();
    expect(read).toHaveBeenCalledExactlyOnceWith(input);
  });

  it("validates deletion inputs and trusted senders and unregisters both deletion handlers", async () => {
    const frame = {};
    const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    const provider = electron.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.modelDeleteProvider)![1];
    const skill = electron.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.skillDeleteDocument)![1];
    const providerId = "00000000-0000-4000-8000-000000000001";
    await expect(provider(trusted, { providerId })).resolves.toEqual(emptyModelStatus);
    await expect(skill(trusted, { entryPath: "C:\\skills\\example\\SKILL.md" })).resolves.toBeUndefined();
    await expect(provider(trusted, { providerId: "" })).rejects.toThrow();
    await expect(skill(trusted, { entryPath: "", extra: true })).rejects.toThrow();
    electron.fromWebContents.mockReturnValueOnce(undefined);
    await expect(provider(trusted, { providerId })).rejects.toThrow();
    electron.fromWebContents.mockReturnValueOnce(undefined);
    await expect(skill(trusted, { entryPath: "C:\\skills\\example\\SKILL.md" })).rejects.toThrow();
    expect(deleteProvider).toHaveBeenCalledExactlyOnceWith(providerId);
    expect(deleteSkill).toHaveBeenCalledExactlyOnceWith("C:\\skills\\example\\SKILL.md");
    dispose?.(); dispose = undefined;
    for (const channel of [IPC_CHANNELS.modelDeleteProvider, IPC_CHANNELS.skillDeleteDocument]) expect(electron.removeHandler).toHaveBeenCalledWith(channel);
  });

  it("returns the system download path and password metadata without any secret", async () => {
    const frame = {};
    const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    const directory = electron.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.browserGetDefaultDownloadDirectory)![1];
    const list = electron.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.browserGetSavedPasswords)![1];
    await expect(directory(trusted)).resolves.toBe("C:\\Downloads");
    await expect(list(trusted)).resolves.toEqual([{ origin: "https://example.test", username: "sample-user" }]);
    await expect(list(trusted, "unexpected")).rejects.toThrow();
    expect(revealPassword).not.toHaveBeenCalled();
  });

  it("reveals only a valid origin for the trusted top frame and removes all new handlers", async () => {
    const frame = {};
    const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    const reveal = electron.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.browserRevealPassword)![1];
    await expect(reveal(trusted, { origin: "https://example.test" })).resolves.toBe("sample-secret");
    await expect(reveal(trusted, { origin: "http://example.test" })).rejects.toThrow();
    await expect(reveal(trusted, { origin: "https://example.test", username: "unexpected" })).rejects.toThrow();
    await expect(reveal({ ...trusted, senderFrame: {} } as IpcMainInvokeEvent, { origin: "https://example.test" })).rejects.toThrow();
    electron.fromWebContents.mockReturnValueOnce(undefined);
    await expect(reveal(trusted, { origin: "https://example.test" })).rejects.toThrow();
    expect(revealPassword).toHaveBeenCalledExactlyOnceWith({ origin: "https://example.test" });
    revealPassword.mockReturnValueOnce(null);
    await expect(reveal(trusted, { origin: "https://example.test" })).resolves.toBeNull();
    dispose?.(); dispose = undefined;
    for (const channel of [IPC_CHANNELS.browserGetDefaultDownloadDirectory, IPC_CHANNELS.browserGetSavedPasswords, IPC_CHANNELS.browserRevealPassword]) {
      expect(electron.removeHandler).toHaveBeenCalledWith(channel);
    }
  });

  it("selects a browser download directory and removes the handler on disposal", async () => {
    const choose = electron.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.browserChooseDownloadDirectory)![1];
    await expect(choose(event)).resolves.toBe("D:\\Downloads");
    expect(electron.showOpenDialog).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ properties: ["openDirectory", "createDirectory"] }));
    dispose?.();
    dispose = undefined;
    expect(electron.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.browserChooseDownloadDirectory);
  });

  it("returns null on cancelled directory selection and rejects arguments or an untrusted sender", async () => {
    const choose = electron.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.browserChooseDownloadDirectory)![1];
    electron.showOpenDialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    await expect(choose(event)).resolves.toBeNull();
    await expect(choose(event, { path: "arbitrary" })).rejects.toThrow();
    electron.fromWebContents.mockReturnValueOnce(undefined);
    await expect(choose(event)).rejects.toThrow();
    expect(electron.showOpenDialog).toHaveBeenCalledTimes(1);
  });

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
