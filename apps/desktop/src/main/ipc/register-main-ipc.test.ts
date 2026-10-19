import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow, IpcMainInvokeEvent } from "electron";
import { DEFAULT_BROWSER_CONFIGURATION, DEFAULT_COMPUTER_USE_CONFIGURATION, DEFAULT_MODEL_CATALOG, IPC_CHANNELS, type ConversationSummary } from "@agent/protocol";
import { WorkspaceBrowserTabController } from "../tools/workspace-browser-tab-controller.js";
import { registerMainIpcHandlers } from "./register-main-ipc.js";

const electron = vi.hoisted(() => ({
  handle: vi.fn<(channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>) => void>(),
  removeHandler: vi.fn<(channel: string) => void>(), on: vi.fn(), removeListener: vi.fn(),
  fromWebContents: vi.fn(),
  showOpenDialog: vi.fn(() => Promise.resolve({ canceled: false, filePaths: ["D:\\Downloads"] })),
  getFileIcon: vi.fn(() => Promise.resolve({ isEmpty: () => false, resize: () => ({ toDataURL: () => "data:image/png;base64,aGVsbG8=" }) })),
}));
vi.mock("electron", () => ({
  app: { getPath: () => "C:\\Downloads", getFileIcon: electron.getFileIcon }, clipboard: {}, dialog: { showOpenDialog: electron.showOpenDialog }, shell: {}, ipcMain: electron,
  BrowserWindow: { fromWebContents: electron.fromWebContents },
}));

describe("result viewed IPC notification", () => {
  it("validates and revokes computer grants through trusted settings IPC, with symmetric disposal", async () => {
    const save = vi.fn((input: unknown) => input);
    const controller = { getStatus: vi.fn(() => ({ supported: true, running: false, elevated: false })), start: vi.fn(() => ({ supported: true, running: true, elevated: true })), stop: vi.fn() };
    Object.assign(dependencies, { computerUseConfiguration: { getConfiguration: () => DEFAULT_COMPUTER_USE_CONFIGURATION, saveConfiguration: save }, computerUse: controller });
    dispose?.();
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send, isDestroyed: () => false } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window);
    dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    const handler = (channel: string) => electron.handle.mock.calls.filter(([name]) => name === channel).at(-1)![1];
    expect(await handler(IPC_CHANNELS.computerUseGetConfiguration)(event)).toEqual(DEFAULT_COMPUTER_USE_CONFIGURATION);
    expect(await handler(IPC_CHANNELS.computerUseGetApplicationIcons)(event)).toEqual({});
    await expect(handler(IPC_CHANNELS.computerUseGetApplicationIcons)(event, { executablePath: "C:\\other.exe" })).rejects.toThrow();
    expect(await handler(IPC_CHANNELS.computerUseSaveConfiguration)(event, { ...DEFAULT_COMPUTER_USE_CONFIGURATION, enabled: true })).toMatchObject({ enabled: true });
    expect(save).toHaveBeenCalledOnce(); expect(controller.stop).toHaveBeenCalledOnce();
    await handler(IPC_CHANNELS.computerUseSaveConfiguration)(event, { configuration: DEFAULT_COMPUTER_USE_CONFIGURATION, baselineApplications: [] });
    expect(save).toHaveBeenLastCalledWith(DEFAULT_COMPUTER_USE_CONFIGURATION, []);
    await expect(handler(IPC_CHANNELS.computerUseSaveConfiguration)(event, { ...DEFAULT_COMPUTER_USE_CONFIGURATION, shell: "whoami" })).rejects.toThrow();
    await expect(handler(IPC_CHANNELS.computerUseStart)(event, { administrator: true })).rejects.toThrow();
    expect(controller.start).not.toHaveBeenCalled();
    electron.fromWebContents.mockReturnValue(null);
    await expect(handler(IPC_CHANNELS.computerUseStart)(event)).rejects.toThrow(); expect(controller.start).not.toHaveBeenCalled();
    dispose?.(); dispose = undefined;
    for (const channel of [IPC_CHANNELS.computerUseGetConfiguration, IPC_CHANNELS.computerUseSaveConfiguration, IPC_CHANNELS.computerUseChooseApplication, IPC_CHANNELS.computerUseGetApplicationIcons, IPC_CHANNELS.computerUseGetStatus, IPC_CHANNELS.computerUseStart, IPC_CHANNELS.computerUseStop]) expect(electron.removeHandler).toHaveBeenCalledWith(channel);
  });
  it("loads executable icons only for configured permanent grants and blacklisted software", async () => {
    const application = { id: "11111111-1111-4111-8111-111111111111", name: "Editor", executablePath: "C:\\Editor.exe", enabled: true };
    const blocked = { ...application, id: "22222222-2222-4222-8222-222222222222", name: "Blocked", executablePath: "C:\\Blocked.exe" };
    Object.assign(dependencies, { computerUseConfiguration: { getConfiguration: () => ({ ...DEFAULT_COMPUTER_USE_CONFIGURATION, applications: [application], blockedApplications: [blocked] }) } });
    dispose?.(); const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send, isDestroyed: () => false } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window); dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    const handler = electron.handle.mock.calls.filter(([name]) => name === IPC_CHANNELS.computerUseGetApplicationIcons).at(-1)![1];
    expect(await handler(event)).toEqual({ [application.id]: "data:image/png;base64,aGVsbG8=", [blocked.id]: "data:image/png;base64,aGVsbG8=" });
    expect(electron.getFileIcon).toHaveBeenCalledWith(application.executablePath, { size: "normal" });
    expect(electron.getFileIcon).toHaveBeenCalledWith(blocked.executablePath, { size: "normal" });
  });
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
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send, isDestroyed: () => false } } as unknown as BrowserWindow;
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

  it("validates user completion grants and bounded reference lookups from the trusted window only", async () => {
    const collaboration = { getCompletionPolicy: vi.fn(() => ({ allowAgentCompletion: false })),
      setCompletionPolicy: vi.fn(() => ({ allowAgentCompletion: true })), resolveReferences: vi.fn(() => []) };
    Object.assign(dependencies, { database: { collaboration } }); dispose?.();
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send, isDestroyed: () => false } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window);
    dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    const trusted = { sender: window.webContents } as IpcMainInvokeEvent;
    const handler = (channel: string) => electron.handle.mock.calls.filter(([name]) => name === channel).at(-1)![1];
    expect(await handler(IPC_CHANNELS.taskCompletionPolicyGet)(trusted, { conversationId: conversation.id })).toEqual({ allowAgentCompletion: false });
    expect(await handler(IPC_CHANNELS.taskCompletionPolicySet)(trusted, { teamInstanceId: conversation.id, allowAgentCompletion: true })).toEqual({ allowAgentCompletion: true });
    expect(await handler(IPC_CHANNELS.chatReferencesResolve)(trusted, { conversationId: conversation.id, ids: [conversation.id] })).toEqual([]);
    await expect(handler(IPC_CHANNELS.taskCompletionPolicyGet)(trusted, { conversationId: conversation.id, teamInstanceId: conversation.id })).rejects.toThrow();
    await expect(handler(IPC_CHANNELS.taskCompletionPolicySet)(trusted, { conversationId: conversation.id, allowAgentCompletion: true, extra: true })).rejects.toThrow();
    await expect(handler(IPC_CHANNELS.chatReferencesResolve)(trusted, { conversationId: conversation.id, ids: Array.from({ length: 21 }, () => conversation.id) })).rejects.toThrow();
    electron.fromWebContents.mockReturnValue(null);
    await expect(handler(IPC_CHANNELS.taskCompletionPolicySet)(trusted, { conversationId: conversation.id, allowAgentCompletion: true })).rejects.toThrow();
    expect(collaboration.setCompletionPolicy).toHaveBeenCalledTimes(1);
    dispose?.(); dispose = undefined;
    for (const channel of [IPC_CHANNELS.taskCompletionPolicyGet, IPC_CHANNELS.taskCompletionPolicySet, IPC_CHANNELS.chatReferencesResolve]) expect(electron.removeHandler).toHaveBeenCalledWith(channel);
  });

  it("validates the real coordination conversation lookup and disposes its IPC handler", async () => {
    const result = { ...conversation, threadKind: "agent", coordinationTeamInstanceId: conversation.id };
    const getTeamChatCoordinationConversation = vi.fn(() => result);
    Object.assign(dependencies, { agentRuntime: { getTeamChatCoordinationConversation } });
    dispose?.();
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send, isDestroyed: () => false } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window);
    dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    const handler = electron.handle.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.teamChatCoordinationConversation).at(-1)![1];
    const trusted = { sender: window.webContents } as IpcMainInvokeEvent;
    const input = { teamInstanceId: conversation.id, agentId: "default-agent" };
    await expect(handler(trusted, input)).resolves.toEqual(result);
    expect(getTeamChatCoordinationConversation).toHaveBeenCalledExactlyOnceWith(input);
    await expect(handler(trusted, { teamInstanceId: "invalid" })).rejects.toThrow();
    await expect(handler(trusted, { ...input, conversationId: conversation.id })).rejects.toThrow();
    electron.fromWebContents.mockReturnValue(null);
    await expect(handler(trusted, input)).rejects.toThrow();
    expect(getTeamChatCoordinationConversation).toHaveBeenCalledTimes(1);
    dispose?.(); dispose = undefined;
    expect(electron.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.teamChatCoordinationConversation);
  });
  it("validates and scopes group pause requests and disposes the channel", async () => {
    const pauseTeamChat = vi.fn(() => Promise.resolve());
    Object.assign(dependencies, { agentRuntime: { pauseTeamChat } });
    dispose?.();
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send, isDestroyed: () => false } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window);
    dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    const handler = electron.handle.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.teamChatPause).at(-1)![1];
    const trusted = { sender: window.webContents } as IpcMainInvokeEvent;
    const teamInstanceId = conversation.id;
    await expect(handler(trusted, { teamInstanceId })).resolves.toBeNull();
    expect(pauseTeamChat).toHaveBeenCalledExactlyOnceWith(teamInstanceId, expect.any(Function));
    await expect(handler(trusted, { teamInstanceId: "invalid" })).rejects.toThrow();
    await expect(handler(trusted, { teamInstanceId, extra: true })).rejects.toThrow();
    electron.fromWebContents.mockReturnValue(null);
    await expect(handler(trusted, { teamInstanceId })).rejects.toThrow();
    expect(pauseTeamChat).toHaveBeenCalledTimes(1);
    dispose?.(); dispose = undefined;
    expect(electron.removeHandler).toHaveBeenCalledWith(IPC_CHANNELS.teamChatPause);
  });

  it("shows the HTML browser tab before waiting for page resources to finish loading", async () => {
    const preview = { id: conversation.id, title: "demo.html", url: "http://127.0.0.1:1234/token/demo.html", source: "<p>demo</p>" };
    const session = { sessionId: conversation.id };
    let finishLoad: () => void = () => {};
    const loaded = new Promise<void>((resolve) => { finishLoad = resolve; });
    const navigate = vi.fn(() => loaded);
    const openBrowser = vi.fn(async (input: { url?: string }) => {
      if (input.url !== undefined) await navigate();
      return session;
    });
    const openTab = vi.fn(() => Promise.resolve(undefined));
    Object.assign(dependencies, {
      htmlPreviews: { get: () => preview, retain: vi.fn(), release: vi.fn() },
      database: { getConversation: () => conversation },
    });
    Object.assign(dependencies.managedBrowser, { open: openBrowser, navigate });
    Object.assign(dependencies.workspaceBrowserTabs, { open: openTab });
    dispose?.();
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window);
    dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    const handler = electron.handle.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.htmlPreview).at(-1)![1];
    const frame = {};
    const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    const opening = handler(trusted, { kind: "browser", conversationId: conversation.id, id: preview.id });
    let completed = false;
    void opening.then(() => { completed = true; });
    try {
      await vi.waitFor(() => expect(openTab).toHaveBeenCalledOnce(), { timeout: 150 });
      expect(openBrowser).toHaveBeenCalledWith({}, expect.objectContaining({ isolated: true }));
      expect(navigate).toHaveBeenCalledWith({ sessionId: session.sessionId, url: preview.url });
      expect(openTab.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]!);
      expect(completed).toBe(false);
    } finally {
      finishLoad();
      await opening;
    }
    expect(completed).toBe(true);
  });

  it("validates HTML preview sources and owns isolated browser references through close and failure", async () => {
    const preview = { id: conversation.id, title: "demo.html", url: "http://127.0.0.1:1234/token/demo.html", source: "<p>demo</p>" };
    const htmlPreviews = { create: vi.fn(() => Promise.resolve(preview)), get: vi.fn(() => preview), retain: vi.fn(), release: vi.fn() };
    let closed: (() => void) | undefined;
    const openBrowser = vi.fn((_input: unknown, options: { isolated?: boolean; onClose?: () => void }) => {
      closed = options.onClose;
      return Promise.resolve({ sessionId: conversation.id });
    });
    const openTab = vi.fn(() => Promise.resolve(undefined));
    const navigate = vi.fn(() => Promise.resolve());
    const closeTab = vi.fn();
    const closeBrowser = vi.fn(() => closed?.());
    Object.assign(dependencies, { htmlPreviews, database: { getConversation: () => conversation } });
    Object.assign(dependencies.managedBrowser, { open: openBrowser, close: closeBrowser, navigate });
    Object.assign(dependencies.workspaceBrowserTabs, { open: openTab, close: closeTab });
    dispose?.();
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window);
    dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    const handler = electron.handle.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.htmlPreview).at(-1)![1];
    const frame = {};
    const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    const source = { kind: "file", conversationId: conversation.id, path: "demo.html" };
    await expect(handler(trusted, source)).resolves.toEqual(preview);
    await expect(handler(trusted, { ...source, root: "C:/" })).rejects.toThrow();
    await expect(handler({ ...trusted, senderFrame: {} } as IpcMainInvokeEvent, source)).rejects.toThrow();
    electron.fromWebContents.mockReturnValueOnce(null);
    await expect(handler(trusted, source)).rejects.toThrow();
    expect(htmlPreviews.create).toHaveBeenCalledTimes(1);
    const browser = { kind: "browser", conversationId: conversation.id, id: preview.id };
    await handler(trusted, browser);
    expect(openBrowser).toHaveBeenCalledWith({}, expect.objectContaining({ isolated: true }));
    expect(openTab).toHaveBeenCalledWith(expect.objectContaining({ conversationId: conversation.id, projectId: conversation.id, requestedName: "demo.html" }));
    expect(htmlPreviews.retain.mock.invocationCallOrder[0]).toBeLessThan(openBrowser.mock.invocationCallOrder[0]!);
    closed?.(); closed?.();
    expect(htmlPreviews.release).toHaveBeenCalledTimes(1);
    openTab.mockRejectedValueOnce(new Error("tab failed"));
    await expect(handler(trusted, browser)).rejects.toThrow();
    expect(closeBrowser).toHaveBeenCalledTimes(1);
    expect(htmlPreviews.release).toHaveBeenCalledTimes(2);
    expect(closeTab).toHaveBeenCalledWith({ conversationId: conversation.id, sessionId: conversation.id });
    navigate.mockRejectedValueOnce(new Error("page load failed"));
    await expect(handler(trusted, browser)).rejects.toThrow("AGENT_ERROR:");
    expect(closeBrowser).toHaveBeenCalledTimes(2);
    expect(closeTab).toHaveBeenCalledTimes(2);
    expect(htmlPreviews.release).toHaveBeenCalledTimes(3);
    openBrowser.mockRejectedValueOnce(new Error("load failed"));
    await expect(handler(trusted, browser)).rejects.toThrow();
    expect(closeTab).toHaveBeenCalledTimes(2);
    expect(htmlPreviews.release).toHaveBeenCalledTimes(4);
    await handler(trusted, { ...browser, kind: "release" });
    expect(htmlPreviews.release).toHaveBeenCalledTimes(5);
    htmlPreviews.create.mockResolvedValueOnce({ ...preview, url: "https://example.com" });
    await expect(handler(trusted, source)).rejects.toThrow();
  });

  it("releases the HTML browser when shutdown cancels its pending tab acknowledgement", async () => {
    const preview = { id: conversation.id, title: "demo.html", url: "http://127.0.0.1:1234/token/demo.html", source: "<p>demo</p>" };
    const htmlPreviews = { get: () => preview, retain: vi.fn(), release: vi.fn() };
    const tabs = new WorkspaceBrowserTabController();
    const closeTab = vi.spyOn(tabs, "close");
    let closed: (() => void) | undefined;
    const closeBrowser = vi.fn(() => closed?.());
    const navigate = vi.fn(() => Promise.resolve());
    Object.assign(dependencies, { htmlPreviews, database: { getConversation: () => conversation }, workspaceBrowserTabs: tabs });
    Object.assign(dependencies.managedBrowser, {
      open: vi.fn((_input: unknown, options: { onClose?: () => void }) => {
        closed = options.onClose;
        return Promise.resolve({ sessionId: conversation.id, canGoBack: false, canGoForward: false,
          isLoading: false, title: "新标签页", url: "", zoomPercent: 100 });
      }),
      close: closeBrowser,
      navigate,
    });
    dispose?.();
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window);
    dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    const handler = electron.handle.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.htmlPreview).at(-1)![1];
    const frame = {};
    const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    const opening = expect(handler(trusted, { kind: "browser", conversationId: conversation.id, id: preview.id })).rejects.toThrow("AGENT_ERROR:");
    await vi.waitFor(() => expect(send).toHaveBeenCalledWith(IPC_CHANNELS.workspaceBrowserOpenRequested, expect.any(Object)));
    tabs.dispose();
    await opening;
    expect(navigate).not.toHaveBeenCalled();
    expect(closeBrowser).toHaveBeenCalledOnce();
    expect(closeTab).toHaveBeenCalledWith({ conversationId: conversation.id, sessionId: conversation.id });
    expect(htmlPreviews.retain).toHaveBeenCalledOnce();
    expect(htmlPreviews.release).toHaveBeenCalledOnce();
  });

  it("validates catalog updates and rejects untrusted senders before saving", async () => {
    dispose?.();
    const saveCatalog = vi.fn((value: typeof DEFAULT_MODEL_CATALOG) => value);
    Object.assign(dependencies, { modelCatalog: { saveCatalog } });
    const window = { isDestroyed: () => false, on: vi.fn(), webContents: { send } } as unknown as BrowserWindow;
    electron.fromWebContents.mockReturnValue(window);
    dispose = registerMainIpcHandlers(() => window, dependencies, { resumePendingMessages: false });
    const handler = electron.handle.mock.calls.filter(([channel]) => channel === IPC_CHANNELS.modelSaveCatalog).at(-1)![1];
    const frame = {};
    const trusted = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    await expect(handler(trusted, DEFAULT_MODEL_CATALOG)).resolves.toEqual(DEFAULT_MODEL_CATALOG);
    expect(saveCatalog).toHaveBeenCalledTimes(1);
    await expect(handler(trusted, { ...DEFAULT_MODEL_CATALOG, reasoningRules: [{ id: "bad" }] })).rejects.toBeDefined();
    electron.fromWebContents.mockReturnValueOnce(null);
    await expect(handler({ sender: {} } as IpcMainInvokeEvent, DEFAULT_MODEL_CATALOG)).rejects.toBeDefined();
    expect(saveCatalog).toHaveBeenCalledTimes(1);
  });

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

  it("validates conversation stream subscriptions and rejects untrusted senders", async () => {
    const subscribe = electron.handle.mock.calls.find(([channel]) => channel === IPC_CHANNELS.conversationSetStreamSubscriptions)![1];
    await expect(subscribe(event, [conversation.id])).resolves.toBeUndefined();
    await expect(subscribe({ ...event, senderFrame: {} } as IpcMainInvokeEvent, [])).rejects.toThrow();
    await expect(subscribe(event, ["invalid"])).rejects.toThrow();
    await expect(subscribe(event, [], "extra")).rejects.toThrow();
    electron.fromWebContents.mockReturnValueOnce(undefined);
    await expect(subscribe(event, [])).rejects.toThrow();
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
