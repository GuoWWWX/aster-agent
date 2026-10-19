import { ConversationStreamSubscriptions } from "./conversation-stream-subscriptions.js";
import { htmlPreviewRequestSchema, htmlPreviewResponseSchema } from "@agent/protocol";
import {
  scheduledTaskListSchema,
  scheduledTaskSchema,
  saveScheduledTaskIpcArgumentsSchema,
  scheduledTaskReferenceIpcArgumentsSchema,
} from "@agent/protocol";
import {
  userQuestionSchema,
  userQuestionReferenceSchema,
  answerUserQuestionInputSchema,
  backgroundCommandSchema,
  stopBackgroundCommandInputSchema,
  backgroundCommandOutputSchema,
  readBackgroundCommandInputSchema,
} from "@agent/protocol";
import {
  app,
  BrowserWindow,
  clipboard,
  shell,
  ipcMain as electronIpcMain,
  type IpcMainEvent,
} from "electron";
import { openProjectDirectory } from "../projects/open-project-directory.js";
import { z } from "zod";
import { publishConversationAttentionEvent } from "../windows/conversation-attention.js";
import {
  approveToolChangeIpcArgumentsSchema,
  applicationSettingsSchema,
  cancelRunIpcArgumentsSchema,
  clipboardWriteTextIpcArgumentsSchema,
  conversationMessageSubmissionSchema,
  conversationPendingMessageListSchema,
  pendingConversationMessageReferenceIpcArgumentsSchema,
  pluginCatalogEntrySchema,
  pluginCatalogListSchema,
  conversationReferenceIpcArgumentsSchema,
  conversationRunEventSchema,
  conversationStreamSubscriptionSchema,
  conversationTimelinePageIpcArgumentsSchema,
  conversationTimelinePageSchema,
  emptyIpcArgumentsSchema,
  gitFileDiffIpcArgumentsSchema,
  gitFileDiffSchema,
  gitOperationIpcArgumentsSchema,
  gitReviewIpcArgumentsSchema,
  gitReviewSnapshotSchema,
  IPC_CHANNELS,
  managedBrowserBoundsIpcArgumentsSchema,
  managedBrowserEventSchema,
  projectReferenceIpcArgumentsSchema,
  reorderPendingConversationMessagesIpcArgumentsSchema,
  setPendingQueuePausedIpcArgumentsSchema,
  pendingQueuePausedResponseSchema,
  replaceLatestConversationMessageIpcArgumentsSchema,
  runtimeInfoSchema,
  runtimePlatformSchema,
  runAcceptedSchema,
  setPluginEnabledIpcArgumentsSchema,
  terminalSessionEventSchema,
  workspaceBrowserTabCloseRequestSchema,
  workspaceBrowserTabOpenedIpcArgumentsSchema,
  workspaceBrowserTabOpenRequestSchema,
  workspaceTerminalTabCloseRequestSchema,
  workspaceTerminalTabOpenRequestSchema,
  sendConversationMessageIpcArgumentsSchema,
  updatePendingConversationMessageIpcArgumentsSchema,
  voidIpcResponseSchema,
  windowStateSchema,
} from "@agent/protocol";
import { runIpcHandler } from "./ipc-error-boundary.js";
import { DESKTOP_CAPABILITIES } from "./desktop-capabilities.js";
import { createIpcHandlerRegistrar, DESKTOP_IPC_HANDLER_CHANNELS } from "./ipc-handler-registrar.js";
import { getTrustedWindow, parseNoArguments, type IpcHandler } from "./ipc-handler-context.js";
import type { MainIpcDependencies } from "./main-ipc-dependencies.js";
import { registerProjectHandlers } from "./project-handlers.js";
import { registerConversationCatalogHandlers } from "./conversation-catalog-handlers.js";
import { registerAttachmentHandlers } from "./attachment-handlers.js";
import { registerTeamHandlers } from "./team-handlers.js";
import { registerTaskContextHandlers } from "./task-context-handlers.js";
import { registerTeamChatHandlers } from "./team-chat-handlers.js";
import { registerTeamWorkItemHandlers } from "./team-work-item-handlers.js";
import { registerModelHandlers } from "./model-handlers.js";
import {
  registerApplicationSettingsHandlers,
  registerStorageAndIntegrationSettingsHandlers,
} from "./settings-handlers.js";
import { registerComputerUseHandlers } from "./computer-use-handlers.js";
import { registerBrowserSettingsHandlers, registerManagedBrowserHandlers } from "./browser-handlers.js";
import { registerTerminalSettingsHandlers, registerTerminalSessionHandlers } from "./terminal-handlers.js";
import { registerSkillDocumentHandlers } from "./skill-document-handlers.js";
import { registerConfigurationWorkspaceHandlers } from "./configuration-workspace-handlers.js";

function getWindowState(window: BrowserWindow) {
  return windowStateSchema.parse({
    isFocused: window.isFocused(),
    isFullScreen: window.isFullScreen(),
    isMaximized: window.isMaximized()
  });
}

function getRuntimeInfo() {
  return runtimeInfoSchema.parse({
    appVersion: app.getVersion(),
    capabilities: DESKTOP_CAPABILITIES,
    platform: runtimePlatformSchema.parse(process.platform)
  });
}

function sendWindowStateChanged(window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    window.webContents.send(IPC_CHANNELS.windowStateChanged, getWindowState(window));
  }
}

function subscribeToWindowState(window: BrowserWindow): void {
  window.on("focus", () => sendWindowStateChanged(window));
  window.on("blur", () => sendWindowStateChanged(window));
  window.on("maximize", () => sendWindowStateChanged(window));
  window.on("unmaximize", () => sendWindowStateChanged(window));
  window.on("enter-full-screen", () => sendWindowStateChanged(window));
  window.on("leave-full-screen", () => sendWindowStateChanged(window));
}

type MainIpcRegistrationOptions = {
  eventStreams?: ConversationStreamSubscriptions;
  resumePendingMessages?: boolean;
  emitConversationRunEvent?: (event: unknown) => void;
};

function sendWindowConversationRunEvent(
  getMainWindow: () => BrowserWindow | undefined,
  event: unknown,
  eventStreams: ConversationStreamSubscriptions,
): void {
  const parsed = conversationRunEventSchema.parse(event);
  publishConversationAttentionEvent(parsed);
  const window = getMainWindow();
  eventStreams.publish(window === undefined || window.isDestroyed() ? undefined : window.webContents, parsed);
}

export function registerMainIpcHandlers(
  getMainWindow: () => BrowserWindow | undefined,
  {
    agentRuntime,
    scheduledTasks,
    applicationStorageLocation,
    applicationSettings,
    browserConfiguration,
    computerUseConfiguration,
    computerUse,
    attachments,
    conversationDeletion,
    conversationLifecycle,
    credentials,
    contextCompression,
    configurationWorkspaces,
    modelCatalog,
    pluginCatalog,
    database,
    eventProjector,
    integrationConfiguration,
    gitReview,
    managedBrowser,
    htmlPreviews,
    projectRegistry,
    threadLogLegacyImporter,
    skillDocuments,
    terminalConfiguration,
    teamWorkItems,
    terminalSessions,
    workspaceTerminalTabs,
    workspaceBrowserTabs,
    tools,
  }: MainIpcDependencies,
  { resumePendingMessages = true, eventStreams: configuredStreams, emitConversationRunEvent: configuredEmitter }: MainIpcRegistrationOptions = {},
): () => void {
  const eventStreams = configuredStreams ?? new ConversationStreamSubscriptions();
  const emitConversationRunEvent = configuredEmitter ?? ((event: unknown) =>
    sendWindowConversationRunEvent(getMainWindow, event, eventStreams));
  const ipcMain = createIpcHandlerRegistrar<IpcHandler>({
    handle(channel, handler): void {
      electronIpcMain.handle(channel, (event, ...args: unknown[]) =>
        runIpcHandler(channel, () => handler(event, ...args)),
      );
    },
    removeHandler(channel): void {
      electronIpcMain.removeHandler(channel);
    },
  });
  ipcMain.handle(IPC_CHANNELS.conversationSetStreamSubscriptions, (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    if (event.senderFrame !== event.sender.mainFrame) throw new Error("Rejected stream subscription from a subframe.");
    const [ids] = z.tuple([conversationStreamSubscriptionSchema]).parse(args);
    eventStreams.subscribe(window.webContents, ids);
    return voidIpcResponseSchema.parse(undefined);
  });
  ipcMain.handle(IPC_CHANNELS.scheduledTaskList, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow); emptyIpcArgumentsSchema.parse(args);
    return scheduledTaskListSchema.parse(scheduledTasks.list());
  });
  ipcMain.handle(IPC_CHANNELS.scheduledTaskSave, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow); const [input] = saveScheduledTaskIpcArgumentsSchema.parse(args);
    return scheduledTaskSchema.parse(scheduledTasks.save(input));
  });
  ipcMain.handle(IPC_CHANNELS.scheduledTaskDelete, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow); const [input] = scheduledTaskReferenceIpcArgumentsSchema.parse(args);
    scheduledTasks.delete(input.id);
  });
  ipcMain.handle(IPC_CHANNELS.scheduledTaskRun, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow); const [input] = scheduledTaskReferenceIpcArgumentsSchema.parse(args);
    return scheduledTaskSchema.parse(scheduledTasks.run(input.id));
  });
  ipcMain.handle(IPC_CHANNELS.htmlPreview, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    if (event.senderFrame !== event.sender.mainFrame) throw new Error("Rejected HTML preview request from a subframe.");
    const [input] = z.tuple([htmlPreviewRequestSchema]).parse(args);
    if (input.kind === "release") { htmlPreviews.release(input.id, input.conversationId); return null; }
    const conversation = database.getConversation(input.conversationId);
    if (input.kind !== "browser") return htmlPreviewResponseSchema.parse(await htmlPreviews.create(input));
    const preview = htmlPreviews.get(input.id, input.conversationId);
    htmlPreviews.retain(input.id, input.conversationId);
    let retained = true;
    let sessionId: string | undefined;
    const release = (): void => {
      if (retained) { retained = false; htmlPreviews.release(input.id, input.conversationId); }
    };
    try {
      const session = await managedBrowser.open({}, { isolated: true, onClose: release });
      sessionId = session.sessionId;
      await workspaceBrowserTabs.open({ conversationId: conversation.id, projectId: conversation.projectId ?? conversation.id,
        requestedName: preview.title, session, signal: new AbortController().signal });
      await managedBrowser.navigate({ sessionId, url: preview.url });
      return null;
    } catch (error) {
      if (sessionId !== undefined) {
        workspaceBrowserTabs.close({ conversationId: conversation.id, sessionId });
        managedBrowser.close({ sessionId });
      }
      release();
      throw error;
    }
  });
  const disposeApplicationSettingsListener = applicationSettings.onChanged((settings) => {
    const window = getMainWindow();
    if (window === undefined || window.isDestroyed()) return;
    window.webContents.send(
      IPC_CHANNELS.applicationSettingsChanged,
      applicationSettingsSchema.parse(settings),
    );
  });
  const disposeTerminalSessionListener = terminalSessions.onEvent((event) => {
    const window = getMainWindow();
    if (window === undefined || window.isDestroyed()) return;
    window.webContents.send(IPC_CHANNELS.terminalSessionEvent, terminalSessionEventSchema.parse(event));
  });
  const disposeWorkspaceTerminalTabListener = workspaceTerminalTabs.onOpenRequested((request) => {
    const window = getMainWindow();
    if (window === undefined || window.isDestroyed()) return false;
    window.webContents.send(
      IPC_CHANNELS.workspaceTerminalOpenRequested,
      workspaceTerminalTabOpenRequestSchema.parse(request),
    );
    return true;
  });
  const disposeWorkspaceBrowserTabListener = workspaceBrowserTabs.onOpenRequested((request) => {
    const window = getMainWindow();
    if (window === undefined || window.isDestroyed()) return false;
    window.webContents.send(
      IPC_CHANNELS.workspaceBrowserOpenRequested,
      workspaceBrowserTabOpenRequestSchema.parse(request),
    );
    return true;
  });
  const disposeWorkspaceTerminalTabCloseListener = workspaceTerminalTabs.onCloseRequested((request) => {
    const window = getMainWindow();
    if (window === undefined || window.isDestroyed()) return false;
    window.webContents.send(
      IPC_CHANNELS.workspaceTerminalCloseRequested,
      workspaceTerminalTabCloseRequestSchema.parse(request),
    );
    return true;
  });
  const handleManagedBrowserBounds = (event: IpcMainEvent, ...args: unknown[]): void => {
    void runIpcHandler(IPC_CHANNELS.managedBrowserSetBounds, () => {
      getTrustedWindow(event, getMainWindow);
      const [input] = managedBrowserBoundsIpcArgumentsSchema.parse(args);
      managedBrowser.setBounds(input);
    }).catch(() => undefined);
  };
  electronIpcMain.on(IPC_CHANNELS.managedBrowserSetBounds, handleManagedBrowserBounds);
  const disposeWorkspaceBrowserTabCloseListener = workspaceBrowserTabs.onCloseRequested((request) => {
    const window = getMainWindow();
    if (window === undefined || window.isDestroyed()) return false;
    window.webContents.send(
      IPC_CHANNELS.workspaceBrowserCloseRequested,
      workspaceBrowserTabCloseRequestSchema.parse(request),
    );
    return true;
  });
  const disposeManagedBrowserListener = managedBrowser.onEvent((event) => {
    const window = getMainWindow();
    if (window === undefined || window.isDestroyed()) return;
    window.webContents.send(IPC_CHANNELS.managedBrowserEvent, managedBrowserEventSchema.parse(event));
  });

  ipcMain.handle(IPC_CHANNELS.runtimeGetInfo, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return getRuntimeInfo();
  });

  ipcMain.handle(IPC_CHANNELS.userQuestionList, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
    return z.array(userQuestionSchema).parse(agentRuntime.listUserQuestions(input.conversationId));
  });
  ipcMain.handle(IPC_CHANNELS.userQuestionAnswer, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([answerUserQuestionInputSchema]).parse(args);
    return userQuestionSchema.parse(agentRuntime.answerUserQuestion(input, emitConversationRunEvent));
  });
  ipcMain.handle(IPC_CHANNELS.userQuestionMarkViewed, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([userQuestionReferenceSchema]).parse(args);
    return userQuestionSchema.parse(agentRuntime.markUserQuestionViewed(input.questionId, emitConversationRunEvent));
  });
  ipcMain.handle(IPC_CHANNELS.backgroundCommandList, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
    return z.array(backgroundCommandSchema).parse(agentRuntime.listBackgroundCommands(input.conversationId));
  });
  ipcMain.handle(IPC_CHANNELS.backgroundCommandStop, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([stopBackgroundCommandInputSchema]).parse(args);
    return backgroundCommandSchema.parse(await agentRuntime.stopBackgroundCommand(input.conversationId, input.commandId));
  });
  ipcMain.handle(IPC_CHANNELS.backgroundCommandRead, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = z.tuple([readBackgroundCommandInputSchema]).parse(args);
    return backgroundCommandOutputSchema.parse(agentRuntime.readBackgroundCommand(input));
  });

  ipcMain.handle(IPC_CHANNELS.pluginList, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return pluginCatalogListSchema.parse(pluginCatalog.list().map((plugin) => ({
      contentHash: plugin.contentHash,
      enabled: plugin.enabled,
      id: plugin.id,
      name: plugin.name,
      updatedAt: plugin.updatedAt,
      version: plugin.version,
    })));
  });

  ipcMain.handle(IPC_CHANNELS.pluginSetEnabled, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setPluginEnabledIpcArgumentsSchema.parse(args);
    const plugin = pluginCatalog.setEnabled(input.pluginId, input.enabled);
    return pluginCatalogEntrySchema.parse({
      contentHash: plugin.contentHash,
      enabled: plugin.enabled,
      id: plugin.id,
      name: plugin.name,
      updatedAt: plugin.updatedAt,
      version: plugin.version,
    });
  });

  registerProjectHandlers({ ipcMain, getMainWindow }, { projectRegistry, tools });

  registerConversationCatalogHandlers({ ipcMain, getMainWindow }, { agentRuntime, conversationDeletion, conversationLifecycle, credentials, database, eventProjector, projectRegistry, threadLogLegacyImporter, teamWorkItems }, emitConversationRunEvent);

  registerAttachmentHandlers({ ipcMain, getMainWindow }, { attachments });

  ipcMain.handle(
    IPC_CHANNELS.conversationSendMessage,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = sendConversationMessageIpcArgumentsSchema.parse(args);
      return conversationMessageSubmissionSchema.parse(
        database.isTeamWorkItemExecutionTreeConversation(input.conversationId)
          ? teamWorkItems.sendExecutionGuidance(input, (runEvent) =>
            emitConversationRunEvent(runEvent))
          : agentRuntime.sendMessage(input, (runEvent) =>
            emitConversationRunEvent(runEvent)
          )
      );
    }
  );

  registerTeamHandlers({ ipcMain, getMainWindow }, { agentRuntime, database, teamWorkItems }, emitConversationRunEvent);

  registerTaskContextHandlers({ ipcMain, getMainWindow }, { database }, emitConversationRunEvent);
  registerTeamChatHandlers({ ipcMain, getMainWindow }, { agentRuntime, database }, emitConversationRunEvent);
  registerTeamWorkItemHandlers({ ipcMain, getMainWindow }, { teamWorkItems }, emitConversationRunEvent);

  ipcMain.handle(
    IPC_CHANNELS.conversationReplaceLatestMessage,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = replaceLatestConversationMessageIpcArgumentsSchema.parse(args);
      return runAcceptedSchema.parse(
        await agentRuntime.replaceLatestMessage(input, (runEvent) =>
          emitConversationRunEvent(runEvent)
        )
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationListPendingMessages,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      return conversationPendingMessageListSchema.parse(
        agentRuntime.listPendingMessages(input.conversationId)
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.conversationGetPendingQueuePaused, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
    return pendingQueuePausedResponseSchema.parse(agentRuntime.isPendingQueuePaused(input.conversationId));
  });
  ipcMain.handle(IPC_CHANNELS.projectOpenDirectory, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = projectReferenceIpcArgumentsSchema.parse(args);
    await openProjectDirectory(projectRegistry, input.projectId, (path) => shell.openPath(path));
    return voidIpcResponseSchema.parse(undefined);
  });
  ipcMain.handle(IPC_CHANNELS.conversationSetPendingQueuePaused, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setPendingQueuePausedIpcArgumentsSchema.parse(args);
    return pendingQueuePausedResponseSchema.parse(agentRuntime.setPendingQueuePaused(
      input.conversationId, input.paused, (runEvent) => emitConversationRunEvent(runEvent),
    ));
  });
  ipcMain.handle(
    IPC_CHANNELS.conversationPromotePendingMessage,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = pendingConversationMessageReferenceIpcArgumentsSchema.parse(args);
      return conversationPendingMessageListSchema.parse(
        agentRuntime.promotePendingMessage(input.pendingMessageId, (runEvent) =>
          emitConversationRunEvent(runEvent)
        )
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationDeletePendingMessage,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = pendingConversationMessageReferenceIpcArgumentsSchema.parse(args);
      return conversationPendingMessageListSchema.parse(
        await agentRuntime.deletePendingMessage(input.pendingMessageId, (runEvent) =>
          emitConversationRunEvent(runEvent)
        )
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationUpdatePendingMessage,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = updatePendingConversationMessageIpcArgumentsSchema.parse(args);
      return conversationPendingMessageListSchema.parse(
        agentRuntime.updatePendingMessage(
          input.pendingMessageId,
          input.content,
          (runEvent) => emitConversationRunEvent(runEvent)
        )
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationReorderPendingMessages,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = reorderPendingConversationMessagesIpcArgumentsSchema.parse(args);
      return conversationPendingMessageListSchema.parse(
        agentRuntime.reorderPendingMessages(
          input.conversationId,
          input.pendingMessageIds,
          (runEvent) => emitConversationRunEvent(runEvent)
        )
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationCancelRun,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = cancelRunIpcArgumentsSchema.parse(args);
      if ("conversationId" in input) agentRuntime.cancelConversation(input.conversationId);
      else agentRuntime.cancelRun(input.runId);
      return voidIpcResponseSchema.parse(undefined);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationApproveToolChange,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = approveToolChangeIpcArgumentsSchema.parse(args);
      agentRuntime.approveToolChange(input);
      return voidIpcResponseSchema.parse(undefined);
    }
  );

  registerModelHandlers({ ipcMain, getMainWindow }, { credentials, modelCatalog });

  registerApplicationSettingsHandlers({ ipcMain, getMainWindow }, { applicationSettings });

  ipcMain.handle(
    IPC_CHANNELS.conversationListTimelinePage,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationTimelinePageIpcArgumentsSchema.parse(args);
      await eventProjector.prepareTimeline(input.conversationId);
      return conversationTimelinePageSchema.parse(eventProjector.listTimelinePage(input));
    },
  );

  registerStorageAndIntegrationSettingsHandlers({ ipcMain, getMainWindow }, { applicationStorageLocation, contextCompression, configurationWorkspaces, integrationConfiguration });

  registerComputerUseHandlers({ ipcMain, getMainWindow }, { computerUseConfiguration, computerUse });

  registerBrowserSettingsHandlers({ ipcMain, getMainWindow }, { browserConfiguration, managedBrowser });

  registerTerminalSettingsHandlers({ ipcMain, getMainWindow }, { terminalConfiguration });

  ipcMain.handle(IPC_CHANNELS.gitReviewGetSnapshot, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = gitReviewIpcArgumentsSchema.parse(args);
    return gitReviewSnapshotSchema.parse(await gitReview.getSnapshot(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitReviewGetFileDiff, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = gitFileDiffIpcArgumentsSchema.parse(args);
    return gitFileDiffSchema.parse(await gitReview.getFileDiff(input));
  });

  ipcMain.handle(IPC_CHANNELS.gitReviewRunOperation, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = gitOperationIpcArgumentsSchema.parse(args);
    return gitReviewSnapshotSchema.parse(await gitReview.runOperation(input));
  });

  registerTerminalSessionHandlers({ ipcMain, getMainWindow }, { terminalSessions, workspaceTerminalTabs });

  ipcMain.handle(IPC_CHANNELS.workspaceBrowserOpened, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = workspaceBrowserTabOpenedIpcArgumentsSchema.parse(args);
    workspaceBrowserTabs.confirmOpened(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  registerManagedBrowserHandlers({ ipcMain, getMainWindow }, { database, managedBrowser });

  registerSkillDocumentHandlers({ ipcMain, getMainWindow }, { skillDocuments });

  registerConfigurationWorkspaceHandlers({ ipcMain, getMainWindow }, { configurationWorkspaces });

  ipcMain.handle(IPC_CHANNELS.windowGetState, (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return getWindowState(window);
  });

  ipcMain.handle(IPC_CHANNELS.windowMinimize, (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    window.minimize();
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.windowToggleMaximize, (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }

    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.windowClose, (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    window.close();
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.clipboardWriteText, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [text] = clipboardWriteTextIpcArgumentsSchema.parse(args);
    clipboard.writeText(text);
    return voidIpcResponseSchema.parse(undefined);
  });

  try {
    ipcMain.assertRegisteredChannels(DESKTOP_IPC_HANDLER_CHANNELS);
  } catch (error) {
    if (configuredStreams === undefined) eventStreams.dispose();
    disposeApplicationSettingsListener();
    disposeTerminalSessionListener();
    disposeWorkspaceTerminalTabListener();
    disposeWorkspaceTerminalTabCloseListener();
    disposeWorkspaceBrowserTabListener();
    disposeWorkspaceBrowserTabCloseListener();
    disposeManagedBrowserListener();
    electronIpcMain.removeListener(IPC_CHANNELS.managedBrowserSetBounds, handleManagedBrowserBounds);
    ipcMain.dispose();
    throw error;
  }

  const mainWindow = getMainWindow();
  if (mainWindow !== undefined && !mainWindow.isDestroyed()) {
    subscribeToWindowState(mainWindow);
  }
  if (resumePendingMessages) {
    setImmediate(() => {
      agentRuntime.resumePendingMessages((runEvent) =>
        emitConversationRunEvent(runEvent)
      );
    });
  }

  return () => {
    if (configuredStreams === undefined) eventStreams.dispose();
    disposeApplicationSettingsListener();
    disposeTerminalSessionListener();
    disposeWorkspaceTerminalTabListener();
    disposeWorkspaceTerminalTabCloseListener();
    disposeWorkspaceBrowserTabListener();
    disposeWorkspaceBrowserTabCloseListener();
    disposeManagedBrowserListener();
    electronIpcMain.removeListener(IPC_CHANNELS.managedBrowserSetBounds, handleManagedBrowserBounds);
    workspaceTerminalTabs.dispose();
    workspaceBrowserTabs.dispose();
    ipcMain.dispose();
  };
}
