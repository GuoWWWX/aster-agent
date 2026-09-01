import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain as electronIpcMain,
  type IpcMainInvokeEvent
} from "electron";
import {
  acceptTeamWorkItemIpcArgumentsSchema,
  addProjectResponseSchema,
  approveToolChangeIpcArgumentsSchema,
  applicationSettingsIpcArgumentsSchema,
  applicationSettingsSchema,
  browserConfigurationIpcArgumentsSchema,
  browserConfigurationSchema,
  cancelRunIpcArgumentsSchema,
  clipboardWriteTextIpcArgumentsSchema,
  configurationWorkspaceDirectoryListingSchema,
  configurationWorkspaceEntrySchema,
  configurationWorkspaceFileSchema,
  contextCompressionConfigurationIpcArgumentsSchema,
  contextCompressionConfigurationSchema,
  conversationContextUsageIpcArgumentsSchema,
  conversationContextUsageSchema,
  conversationAttachmentListSchema,
  importConversationAttachmentBytesIpcArgumentsSchema,
  conversationListResponseSchema,
  conversationMessageSubmissionSchema,
  conversationPendingMessageListSchema,
  pendingConversationMessageReferenceIpcArgumentsSchema,
  pluginCatalogEntrySchema,
  pluginCatalogListSchema,
  conversationReferenceIpcArgumentsSchema,
  forkConversationIpcArgumentsSchema,
  conversationRunEventSchema,
  conversationSummarySchema,
  conversationTaskListResponseSchema,
  conversationTimelineResponseSchema,
  conversationWorkspaceSelectionResponseSchema,
  createConversationIpcArgumentsSchema,
  createTeamInstanceIpcArgumentsSchema,
  createConfigurationWorkspaceEntryIpcArgumentsSchema,
  createSkillDocumentIpcArgumentsSchema,
  createProjectEntryIpcArgumentsSchema,
  discoverModelsIpcArgumentsSchema,
  deleteConfigurationWorkspaceEntryIpcArgumentsSchema,
  discoveredModelSchema,
  emptyIpcArgumentsSchema,
  ensureTeamMemberConversationIpcArgumentsSchema,
  ensureTeamInstanceMemberConversationIpcArgumentsSchema,
  getTeamWorkItemExecutionIpcArgumentsSchema,
  getTeamCollaborationProjectionIpcArgumentsSchema,
  getModelApiKeyIpcArgumentsSchema,
  integrationConfigurationIpcArgumentsSchema,
  integrationConfigurationSchema,
  gitFileDiffIpcArgumentsSchema,
  gitFileDiffSchema,
  gitOperationIpcArgumentsSchema,
  gitReviewIpcArgumentsSchema,
  gitReviewSnapshotSchema,
  IPC_CHANNELS,
  listProjectEntriesIpcArgumentsSchema,
  listConfigurationWorkspaceEntriesIpcArgumentsSchema,
  listTeamWorkItemsIpcArgumentsSchema,
  listTeamInstancesIpcArgumentsSchema,
  modelCatalogSchema,
  modelConnectionTestResultSchema,
  modelRuntimeStatusSchema,
  managedBrowserBoundsIpcArgumentsSchema,
  managedBrowserCommandIpcArgumentsSchema,
  managedBrowserEventSchema,
  managedBrowserNavigateIpcArgumentsSchema,
  managedBrowserOpenIpcArgumentsSchema,
  managedBrowserReferenceIpcArgumentsSchema,
  managedBrowserSessionSchema,
  managedBrowserSnapshotSchema,
  modelApiKeySchema,
  projectDirectoryListingSchema,
  projectEntrySchema,
  projectFileSchema,
  projectListResponseSchema,
  projectPreviewImageSchema,
  projectReferenceIpcArgumentsSchema,
  projectSummarySchema,
  publishTeamWorkItemIpcArgumentsSchema,
  readProjectFileIpcArgumentsSchema,
  readProjectPreviewImageIpcArgumentsSchema,
  readConfigurationWorkspaceFileIpcArgumentsSchema,
  reorderConversationsIpcArgumentsSchema,
  reorderPendingConversationMessagesIpcArgumentsSchema,
  addTeamWorkItemCommentIpcArgumentsSchema,
  reorderProjectsIpcArgumentsSchema,
  reorderTeamInstancesIpcArgumentsSchema,
  removeConversationAttachmentIpcArgumentsSchema,
  replaceLatestConversationMessageIpcArgumentsSchema,
  requestTeamWorkItemReworkIpcArgumentsSchema,
  renameConversationIpcArgumentsSchema,
  renameProjectIpcArgumentsSchema,
  renameTeamInstanceIpcArgumentsSchema,
  runtimeInfoSchema,
  runtimePlatformSchema,
  runAcceptedSchema,
  saveModelConfigurationIpcArgumentsSchema,
  sendTeamMessageIpcArgumentsSchema,
  setTeamCoordinatorIpcArgumentsSchema,
  setPluginEnabledIpcArgumentsSchema,
  testModelConnectionIpcArgumentsSchema,
  setDefaultModelIpcArgumentsSchema,
  setConversationArchivedIpcArgumentsSchema,
  setConversationModelSelectionIpcArgumentsSchema,
  setConversationProjectIpcArgumentsSchema,
  setConversationPinnedIpcArgumentsSchema,
  setProjectPinnedIpcArgumentsSchema,
  setProjectTeamsInNavigatorIpcArgumentsSchema,
  setTeamInstanceArchivedIpcArgumentsSchema,
  terminalConfigurationIpcArgumentsSchema,
  terminalConfigurationSchema,
  teamWorkItemExecutionViewSchema,
  teamCollaborationProjectionSchema,
  teamMemberConversationViewSchema,
  teamWorkItemListSchema,
  teamWorkItemViewSchema,
  teamInstanceListSchema,
  teamInstanceViewSchema,
  deleteTeamInstanceIpcArgumentsSchema,
  terminalSessionEventSchema,
  terminalSessionOpenIpcArgumentsSchema,
  terminalSessionOutputIpcArgumentsSchema,
  terminalSessionOutputSchema,
  workspaceBrowserTabCloseRequestSchema,
  workspaceBrowserTabOpenedIpcArgumentsSchema,
  workspaceBrowserTabOpenRequestSchema,
  terminalSessionReferenceIpcArgumentsSchema,
  terminalSessionResizeIpcArgumentsSchema,
  terminalSessionSchema,
  terminalSessionWriteIpcArgumentsSchema,
  workspaceTerminalTabOpenedIpcArgumentsSchema,
  workspaceTerminalTabOpenRequestSchema,
  skillDocumentReferenceIpcArgumentsSchema,
  skillDocumentSaveIpcArgumentsSchema,
  submitTeamWorkItemIpcArgumentsSchema,
  deleteTeamWorkItemIpcArgumentsSchema,
  updateTeamWorkItemIpcArgumentsSchema,
  updateTeamWorkItemPermissionIpcArgumentsSchema,
  skillDiscoveryResultSchema,
  skillDocumentSchema,
  writeConfigurationWorkspaceFileIpcArgumentsSchema,
  writeProjectFileIpcArgumentsSchema,
  sendConversationMessageIpcArgumentsSchema,
  updatePendingConversationMessageIpcArgumentsSchema,
  voidIpcResponseSchema,
  windowStateSchema
} from "@agent/protocol";

import { AgentRuntime } from "../agent/agent-runtime.js";
import { ModelCatalogStore } from "../model/model-catalog-store.js";
import { ModelCredentialStore } from "../model/model-credential-store.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { PluginCatalog } from "../plugins/plugin-catalog.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { GitReviewReader } from "../tools/git-review-reader.js";
import { TerminalSessionController } from "../tools/terminal-session-controller.js";
import { WorkspaceTerminalTabController } from "../tools/workspace-terminal-tab-controller.js";
import { WorkspaceBrowserTabController } from "../tools/workspace-browser-tab-controller.js";
import { ManagedBrowserController } from "../windows/managed-browser-controller.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { ConversationDeletionService } from "../storage/conversation-deletion-service.js";
import { ThreadLogLegacyImporter } from "../storage/thread-log-legacy-importer.js";
import { IntegrationConfigurationStore } from "../settings/integration-configuration-store.js";
import { ApplicationSettingsStore } from "../settings/application-settings-store.js";
import { BrowserConfigurationStore } from "../settings/browser-configuration-store.js";
import { ContextCompressionConfigurationStore } from "../settings/context-compression-configuration-store.js";
import { SkillDocumentStore } from "../settings/skill-document-store.js";
import { ConfigurationWorkspaceStore } from "../settings/configuration-workspace-store.js";
import { TerminalConfigurationStore } from "../settings/terminal-configuration-store.js";
import { TeamWorkItemRuntime } from "../teams/team-work-item-runtime.js";
import { runIpcHandler } from "./ipc-error-boundary.js";
import { DESKTOP_CAPABILITIES } from "./desktop-capabilities.js";
import {
  createIpcHandlerRegistrar,
  DESKTOP_IPC_HANDLER_CHANNELS,
} from "./ipc-handler-registrar.js";

type IpcHandler = (
  event: IpcMainInvokeEvent,
  ...args: unknown[]
) => unknown;

function parseNoArguments(args: unknown[]): void {
  emptyIpcArgumentsSchema.parse(args);
}

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

function getTrustedWindow(
  event: IpcMainInvokeEvent,
  getMainWindow: () => BrowserWindow | undefined
): BrowserWindow {
  const mainWindow = getMainWindow();
  const senderWindow = BrowserWindow.fromWebContents(event.sender);

  if (
    mainWindow === undefined ||
    mainWindow.isDestroyed() ||
    senderWindow === null ||
    senderWindow !== mainWindow
  ) {
    throw new Error("Rejected IPC request from an untrusted renderer.");
  }

  return mainWindow;
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

type MainIpcDependencies = {
  agentRuntime: AgentRuntime;
  applicationSettings: ApplicationSettingsStore;
  browserConfiguration: BrowserConfigurationStore;
  attachments: ConversationAttachmentStore;
  conversationDeletion: ConversationDeletionService;
  conversationLifecycle: ConversationLifecycleService;
  credentials: ModelCredentialStore;
  contextCompression: ContextCompressionConfigurationStore;
  configurationWorkspaces: ConfigurationWorkspaceStore;
  modelCatalog: ModelCatalogStore;
  pluginCatalog: PluginCatalog;
  database: AgentDatabase;
  integrationConfiguration: IntegrationConfigurationStore;
  gitReview: GitReviewReader;
  managedBrowser: ManagedBrowserController;
  projectRegistry: ProjectRegistry;
  threadLogLegacyImporter: ThreadLogLegacyImporter;
  skillDocuments: SkillDocumentStore;
  terminalConfiguration: TerminalConfigurationStore;
  teamWorkItems: TeamWorkItemRuntime;
  terminalSessions: TerminalSessionController;
  workspaceTerminalTabs: WorkspaceTerminalTabController;
  workspaceBrowserTabs: WorkspaceBrowserTabController;
  tools: ProjectToolRegistry;
};

type MainIpcRegistrationOptions = {
  resumePendingMessages?: boolean;
};

function sendConversationRunEvent(
  getMainWindow: () => BrowserWindow | undefined,
  event: unknown
): void {
  const window = getMainWindow();
  if (window === undefined || window.isDestroyed()) return;
  window.webContents.send(
    IPC_CHANNELS.conversationRunEvent,
    conversationRunEventSchema.parse(event)
  );
}

export function registerMainIpcHandlers(
  getMainWindow: () => BrowserWindow | undefined,
  {
    agentRuntime,
    applicationSettings,
    browserConfiguration,
    attachments,
    conversationDeletion,
    conversationLifecycle,
    credentials,
    contextCompression,
    configurationWorkspaces,
    modelCatalog,
    pluginCatalog,
    database,
    integrationConfiguration,
    gitReview,
    managedBrowser,
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
  { resumePendingMessages = true }: MainIpcRegistrationOptions = {},
): () => void {
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

  ipcMain.handle(IPC_CHANNELS.projectList, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return projectListResponseSchema.parse(projectRegistry.listProjects());
  });

  ipcMain.handle(IPC_CHANNELS.projectAdd, async (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);

    const selection = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "添加项目"
    });
    const selectedDirectory = selection.filePaths[0];

    if (selection.canceled || selectedDirectory === undefined) {
      return addProjectResponseSchema.parse(null);
    }

    return addProjectResponseSchema.parse(
      await projectRegistry.registerDirectory(selectedDirectory)
    );
  });

  ipcMain.handle(IPC_CHANNELS.projectRename, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = renameProjectIpcArgumentsSchema.parse(args);
    return projectSummarySchema.parse(
      projectRegistry.renameProject(input.projectId, input.name)
    );
  });

  ipcMain.handle(IPC_CHANNELS.projectReorder, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = reorderProjectsIpcArgumentsSchema.parse(args);
    return projectListResponseSchema.parse(
      projectRegistry.reorderProjects(input.projectIds)
    );
  });

  ipcMain.handle(IPC_CHANNELS.projectSetPinned, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setProjectPinnedIpcArgumentsSchema.parse(args);
    return projectSummarySchema.parse(
      projectRegistry.setProjectPinned(input.projectId, input.pinned)
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.projectSetTeamsInNavigator,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = setProjectTeamsInNavigatorIpcArgumentsSchema.parse(args);
      return projectSummarySchema.parse(
        projectRegistry.setProjectTeamsInNavigator(
          input.projectId,
          input.showTeamsInNavigator
        )
      );
    }
  );

  ipcMain.handle(IPC_CHANNELS.projectRemove, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = projectReferenceIpcArgumentsSchema.parse(args);
    projectRegistry.removeProject(input.projectId);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(
    IPC_CHANNELS.projectListEntries,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = listProjectEntriesIpcArgumentsSchema.parse(args);

      return projectDirectoryListingSchema.parse(
        await projectRegistry.listEntries(input)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.projectReadFile,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = readProjectFileIpcArgumentsSchema.parse(args);
      return projectFileSchema.parse(await projectRegistry.readFile(input));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.projectWriteFile,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = writeProjectFileIpcArgumentsSchema.parse(args);
      return projectFileSchema.parse(
        await tools.writeUserFile(input, new AbortController().signal)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.projectReadPreviewImage,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = readProjectPreviewImageIpcArgumentsSchema.parse(args);
      return projectPreviewImageSchema.parse(await projectRegistry.readPreviewImage(input));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.projectCreateEntry,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = createProjectEntryIpcArgumentsSchema.parse(args);
      return projectEntrySchema.parse(await projectRegistry.createEntry(input));
    }
  );

  ipcMain.handle(IPC_CHANNELS.conversationList, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return conversationListResponseSchema.parse(database.listConversations());
  });

  ipcMain.handle(IPC_CHANNELS.conversationCreate, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = createConversationIpcArgumentsSchema.parse(args);
    const modelSelection = input.modelSelection === undefined
      ? undefined
      : credentials.resolveSelection(input.modelSelection);
    return conversationSummarySchema.parse(
      conversationLifecycle.createConversation(input.projectId ?? null, {
        ...(input.agent === undefined ? {} : { agent: input.agent }),
        ...(modelSelection === undefined ? {} : { modelSelection }),
        ...(input.teamId === undefined ? {} : { teamId: input.teamId }),
        ...(input.threadKind === undefined ? {} : { threadKind: input.threadKind })
      })
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.conversationSelectWorkspace,
    async (event, ...args: unknown[]) => {
      const window = getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      const conversation = database.getConversation(input.conversationId);
      if (conversation.projectId !== null) {
        throw new Error("Project conversations already use their project root.");
      }
      if (conversation.activeRunId !== null) {
        throw new Error("A running conversation cannot change its workspace.");
      }
      const selection = await dialog.showOpenDialog(window, {
        properties: ["openDirectory"],
        title: "添加对话工作目录"
      });
      const selectedDirectory = selection.filePaths[0];
      if (selection.canceled || selectedDirectory === undefined) {
        return conversationWorkspaceSelectionResponseSchema.parse(null);
      }
      const workspace = await projectRegistry.mountConversationWorkspace(
        conversation.id,
        selectedDirectory
      );
      return conversationWorkspaceSelectionResponseSchema.parse(
        database.setConversationWorkspaceRoot(conversation.id, workspace.rootPath)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationClearWorkspace,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      const conversation = database.setConversationWorkspaceRoot(
        input.conversationId,
        null
      );
      projectRegistry.unmountConversationWorkspace(input.conversationId);
      return conversationSummarySchema.parse(conversation);
    }
  );

  ipcMain.handle(IPC_CHANNELS.conversationFork, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = forkConversationIpcArgumentsSchema.parse(args);
    const conversation = database.forkConversation(
      input.conversationId,
      input.throughMessageId === undefined ? "side" : "sibling",
      input.throughMessageId,
    );
    threadLogLegacyImporter.importConversationIfMissing(conversation.id);
    if (conversation.workspaceRootPath !== null) {
      projectRegistry.inheritConversationWorkspace(
        input.conversationId,
        conversation.id
      );
    }
    return conversationSummarySchema.parse(conversation);
  });

  ipcMain.handle(IPC_CHANNELS.conversationListForks, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
    return conversationListResponseSchema.parse(
      database.listConversationForks(input.conversationId)
    );
  });

  ipcMain.handle(IPC_CHANNELS.conversationRename, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = renameConversationIpcArgumentsSchema.parse(args);
    return conversationSummarySchema.parse(
      database.renameConversation(input.conversationId, input.title)
    );
  });

  ipcMain.handle(IPC_CHANNELS.conversationReorder, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = reorderConversationsIpcArgumentsSchema.parse(args);
    database.reorderConversations(input.conversationIds);
    return conversationListResponseSchema.parse(database.listConversations());
  });

  ipcMain.handle(IPC_CHANNELS.conversationSetProject, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setConversationProjectIpcArgumentsSchema.parse(args);
    const conversation = database.setConversationProject(
      input.conversationId,
      input.projectId
    );
    if (input.projectId !== null) {
      projectRegistry.unmountConversationWorkspace(input.conversationId);
    }
    return conversationSummarySchema.parse(conversation);
  });

  ipcMain.handle(IPC_CHANNELS.conversationSetModelSelection, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setConversationModelSelectionIpcArgumentsSchema.parse(args);
    const selection = credentials.resolveSelection(input.modelSelection);
    const current = database.getConversation(input.conversationId);
    const conversation = current.teamWorkItemId === null
      ? database.setConversationModelSelection(input.conversationId, selection)
      : teamWorkItems.updateModelSelection(input.conversationId, selection);
    if (current.threadKind !== "subagent" && current.teamWorkItemId === null) {
      credentials.setRecentSelection(selection);
    }
    return conversationSummarySchema.parse(conversation);
  });

  ipcMain.handle(IPC_CHANNELS.conversationSetArchived, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setConversationArchivedIpcArgumentsSchema.parse(args);
    const conversation = conversationSummarySchema.parse(
      database.setConversationArchived(input.conversationId, input.archived)
    );
    sendConversationRunEvent(getMainWindow, {
      conversation,
      type: "conversation.updated"
    });
    return conversation;
  });

  ipcMain.handle(IPC_CHANNELS.conversationSetPinned, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = setConversationPinnedIpcArgumentsSchema.parse(args);
    return conversationSummarySchema.parse(
      database.setConversationPinned(input.conversationId, input.pinned)
    );
  });

  ipcMain.handle(IPC_CHANNELS.conversationDelete, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
    await conversationDeletion.requestDeletion(input.conversationId);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(
    IPC_CHANNELS.conversationListTimeline,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      return conversationTimelineResponseSchema.parse(
        database.listTimeline(input.conversationId)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationGetTaskList,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      return conversationTaskListResponseSchema.parse(
        database.getTaskList(input.conversationId)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationCloseTaskList,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      database.closeTaskList(input.conversationId);
      return voidIpcResponseSchema.parse(undefined);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationDeleteTaskList,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      database.deleteTaskList(input.conversationId);
      return voidIpcResponseSchema.parse(undefined);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationMarkResultViewed,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      return conversationSummarySchema.parse(
        database.markConversationResultViewed(input.conversationId)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationGetContextUsage,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationContextUsageIpcArgumentsSchema.parse(args);
      return conversationContextUsageSchema.parse(
        agentRuntime.getContextUsage(input)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationChooseAttachments,
    async (event, ...args: unknown[]) => {
      const window = getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      const selection = await dialog.showOpenDialog(window, {
        properties: ["openFile", "multiSelections"],
        title: "添加文件或图片"
      });
      if (selection.canceled || selection.filePaths.length === 0) {
        return conversationAttachmentListSchema.parse(
          attachments.listDrafts(input.conversationId)
        );
      }
      await attachments.importFiles(input.conversationId, selection.filePaths);
      return conversationAttachmentListSchema.parse(
        attachments.listDrafts(input.conversationId)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationImportAttachmentBytes,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = importConversationAttachmentBytesIpcArgumentsSchema.parse(args);
      await attachments.importBytes(input.conversationId, {
        bytes: Buffer.from(input.base64, "base64"),
        name: input.name,
        ...(input.mimeType === undefined ? {} : { mimeType: input.mimeType }),
      });
      return conversationAttachmentListSchema.parse(
        attachments.listDrafts(input.conversationId),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationListDraftAttachments,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = conversationReferenceIpcArgumentsSchema.parse(args);
      return conversationAttachmentListSchema.parse(
        attachments.listDrafts(input.conversationId)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationRemoveAttachment,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = removeConversationAttachmentIpcArgumentsSchema.parse(args);
      await attachments.removeDraft(input.conversationId, input.attachmentId);
      return voidIpcResponseSchema.parse(undefined);
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationSendMessage,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = sendConversationMessageIpcArgumentsSchema.parse(args);
      return conversationMessageSubmissionSchema.parse(
        database.isTeamWorkItemExecutionTreeConversation(input.conversationId)
          ? teamWorkItems.sendExecutionGuidance(input, (runEvent) =>
            sendConversationRunEvent(getMainWindow, runEvent))
          : agentRuntime.sendMessage(input, (runEvent) =>
            sendConversationRunEvent(getMainWindow, runEvent)
          )
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.teamSetCoordinator,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = setTeamCoordinatorIpcArgumentsSchema.parse(args);
      database.setTeamCoordinatorConversation(input.teamId, input.conversationId);
      return voidIpcResponseSchema.parse(undefined);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamEnsureMemberConversation,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = ensureTeamMemberConversationIpcArgumentsSchema.parse(args);
      return teamMemberConversationViewSchema.parse(
        teamWorkItems.ensureSharedMemberConversation(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceList,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = listTeamInstancesIpcArgumentsSchema.parse(args);
      return teamInstanceListSchema.parse(
        database.listTeamInstances(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceCreate,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = createTeamInstanceIpcArgumentsSchema.parse(args);
      return teamInstanceViewSchema.parse(teamWorkItems.createInstance(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceRename,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = renameTeamInstanceIpcArgumentsSchema.parse(args);
      return teamInstanceViewSchema.parse(teamWorkItems.renameInstance(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceReorder,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = reorderTeamInstancesIpcArgumentsSchema.parse(args);
      return teamInstanceListSchema.parse(
        database.reorderTeamInstances(input.teamInstanceIds),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceSetArchived,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = setTeamInstanceArchivedIpcArgumentsSchema.parse(args);
      return teamInstanceViewSchema.parse(teamWorkItems.setInstanceArchived(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceDelete,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = deleteTeamInstanceIpcArgumentsSchema.parse(args);
      teamWorkItems.deleteInstance(input.teamInstanceId);
      return voidIpcResponseSchema.parse(undefined);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamInstanceEnsureMemberConversation,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = ensureTeamInstanceMemberConversationIpcArgumentsSchema.parse(args);
      return teamMemberConversationViewSchema.parse(
        teamWorkItems.ensureInstanceMemberConversation(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamSendMessage,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = sendTeamMessageIpcArgumentsSchema.parse(args);
      const { teamId, ...conversationInput } = input;
      const coordinatorConversationId = database.getTeamCoordinatorConversationId(teamId);
      if (coordinatorConversationId === null) {
        throw new Error("Team has no coordinator Conversation. Create and bind a Team Lead conversation first.");
      }
      return conversationMessageSubmissionSchema.parse(
        agentRuntime.sendMessage({
          ...conversationInput,
          conversationId: coordinatorConversationId,
        }, (runEvent) => sendConversationRunEvent(getMainWindow, runEvent)),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemList,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = listTeamWorkItemsIpcArgumentsSchema.parse(args);
      return teamWorkItemListSchema.parse(teamWorkItems.list(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemGetExecution,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = getTeamWorkItemExecutionIpcArgumentsSchema.parse(args);
      return teamWorkItemExecutionViewSchema.parse(teamWorkItems.getExecution(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamCollaborationGetProjection,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = getTeamCollaborationProjectionIpcArgumentsSchema.parse(args);
      return teamCollaborationProjectionSchema.parse(
        teamWorkItems.getCollaborationProjection(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemSubmit,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = submitTeamWorkItemIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(
        teamWorkItems.submit(input, (runEvent) =>
          sendConversationRunEvent(getMainWindow, runEvent)),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemUpdate,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = updateTeamWorkItemIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(
        teamWorkItems.update(input, (runEvent) =>
          sendConversationRunEvent(getMainWindow, runEvent)),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemDelete,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = deleteTeamWorkItemIpcArgumentsSchema.parse(args);
      teamWorkItems.delete(input, (runEvent) =>
        sendConversationRunEvent(getMainWindow, runEvent));
      return voidIpcResponseSchema.parse(undefined);
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemUpdatePermission,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = updateTeamWorkItemPermissionIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(teamWorkItems.updatePermission(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemPublish,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = publishTeamWorkItemIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(
        teamWorkItems.publish(input, (runEvent) =>
          sendConversationRunEvent(getMainWindow, runEvent)),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemRequestRework,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = requestTeamWorkItemReworkIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(
        teamWorkItems.requestRework(input, (runEvent) =>
          sendConversationRunEvent(getMainWindow, runEvent)),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemAddComment,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = addTeamWorkItemCommentIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(teamWorkItems.addComment(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.teamWorkItemAccept,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = acceptTeamWorkItemIpcArgumentsSchema.parse(args);
      return teamWorkItemViewSchema.parse(teamWorkItems.accept(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationReplaceLatestMessage,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = replaceLatestConversationMessageIpcArgumentsSchema.parse(args);
      return runAcceptedSchema.parse(
        await agentRuntime.replaceLatestMessage(input, (runEvent) =>
          sendConversationRunEvent(getMainWindow, runEvent)
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

  ipcMain.handle(
    IPC_CHANNELS.conversationPromotePendingMessage,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = pendingConversationMessageReferenceIpcArgumentsSchema.parse(args);
      return conversationPendingMessageListSchema.parse(
        agentRuntime.promotePendingMessage(input.pendingMessageId, (runEvent) =>
          sendConversationRunEvent(getMainWindow, runEvent)
        )
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationDeletePendingMessage,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = pendingConversationMessageReferenceIpcArgumentsSchema.parse(args);
      return conversationPendingMessageListSchema.parse(
        agentRuntime.deletePendingMessage(input.pendingMessageId, (runEvent) =>
          sendConversationRunEvent(getMainWindow, runEvent)
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
          (runEvent) => sendConversationRunEvent(getMainWindow, runEvent)
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
          (runEvent) => sendConversationRunEvent(getMainWindow, runEvent)
        )
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.conversationCancelRun,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = cancelRunIpcArgumentsSchema.parse(args);
      agentRuntime.cancelRun(input.runId);
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

  ipcMain.handle(IPC_CHANNELS.modelGetStatus, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return modelRuntimeStatusSchema.parse(credentials.getStatus());
  });

  ipcMain.handle(IPC_CHANNELS.modelGetCatalog, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return modelCatalogSchema.parse(modelCatalog.getCatalog());
  });

  ipcMain.handle(IPC_CHANNELS.modelGetApiKey, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = getModelApiKeyIpcArgumentsSchema.parse(args);
    return modelApiKeySchema.parse(credentials.getApiKey(input.providerId));
  });

  ipcMain.handle(IPC_CHANNELS.modelDiscover, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = discoverModelsIpcArgumentsSchema.parse(args);
    return discoveredModelSchema.array().parse(
      await credentials.discoverModels(input)
    );
  });

  ipcMain.handle(IPC_CHANNELS.modelTestConnection, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = testModelConnectionIpcArgumentsSchema.parse(args);
    return modelConnectionTestResultSchema.parse(
      await credentials.testModelConnection(input.providerId, input.modelId)
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.modelSaveConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = saveModelConfigurationIpcArgumentsSchema.parse(args);
      return modelRuntimeStatusSchema.parse(credentials.saveConfiguration(input));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.modelSetDefault,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = setDefaultModelIpcArgumentsSchema.parse(args);
      return modelRuntimeStatusSchema.parse(credentials.setDefaultModel(input));
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.applicationSettingsGetConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return applicationSettingsSchema.parse(applicationSettings.getConfiguration());
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.applicationSettingsSaveConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = applicationSettingsIpcArgumentsSchema.parse(args);
      return applicationSettingsSchema.parse(applicationSettings.saveConfiguration(input));
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.contextCompressionGetConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return contextCompressionConfigurationSchema.parse(
        contextCompression.getConfiguration()
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.contextCompressionSaveConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = contextCompressionConfigurationIpcArgumentsSchema.parse(args);
      return contextCompressionConfigurationSchema.parse(
        contextCompression.saveConfiguration(input)
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.integrationGetConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return integrationConfigurationSchema.parse(
        integrationConfiguration.getConfiguration()
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.integrationSaveConfiguration,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = integrationConfigurationIpcArgumentsSchema.parse(args);
      const saved = integrationConfiguration.saveConfiguration(input);
      await configurationWorkspaces.synchronizeMcpDocuments(saved);
      return integrationConfigurationSchema.parse(
        saved
      );
    }
  );

  ipcMain.handle(
    IPC_CHANNELS.browserGetConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return browserConfigurationSchema.parse(
        browserConfiguration.getConfiguration(),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.browserSaveConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = browserConfigurationIpcArgumentsSchema.parse(args);
      const saved = browserConfigurationSchema.parse(
        browserConfiguration.saveConfiguration(input),
      );
      managedBrowser.applyConfiguration(saved);
      return saved;
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.browserClearData,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      await managedBrowser.clearBrowsingData();
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalGetConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      parseNoArguments(args);
      return terminalConfigurationSchema.parse(
        terminalConfiguration.getConfiguration(),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.terminalSaveConfiguration,
    (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = terminalConfigurationIpcArgumentsSchema.parse(args);
      return terminalConfigurationSchema.parse(
        terminalConfiguration.saveConfiguration(input),
      );
    },
  );

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

  ipcMain.handle(IPC_CHANNELS.terminalSessionOpen, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = terminalSessionOpenIpcArgumentsSchema.parse(args);
    return terminalSessionSchema.parse(terminalSessions.open(input));
  });

  ipcMain.handle(IPC_CHANNELS.terminalSessionReadOutput, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = terminalSessionOutputIpcArgumentsSchema.parse(args);
    return terminalSessionOutputSchema.parse(terminalSessions.readOutput(input));
  });

  ipcMain.handle(IPC_CHANNELS.terminalSessionWrite, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = terminalSessionWriteIpcArgumentsSchema.parse(args);
    terminalSessions.write(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.terminalSessionResize, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = terminalSessionResizeIpcArgumentsSchema.parse(args);
    terminalSessions.resize(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.terminalSessionClose, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = terminalSessionReferenceIpcArgumentsSchema.parse(args);
    terminalSessions.close(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceTerminalOpened, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = workspaceTerminalTabOpenedIpcArgumentsSchema.parse(args);
    workspaceTerminalTabs.confirmOpened(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.workspaceBrowserOpened, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = workspaceBrowserTabOpenedIpcArgumentsSchema.parse(args);
    workspaceBrowserTabs.confirmOpened(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.managedBrowserOpen, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserOpenIpcArgumentsSchema.parse(args);
    return managedBrowserSessionSchema.parse(await managedBrowser.open(input));
  });

  ipcMain.handle(IPC_CHANNELS.managedBrowserNavigate, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserNavigateIpcArgumentsSchema.parse(args);
    await managedBrowser.navigate(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.managedBrowserCommand, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserCommandIpcArgumentsSchema.parse(args);
    await managedBrowser.command(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.managedBrowserCapture, async (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserReferenceIpcArgumentsSchema.parse(args);
    return managedBrowserSnapshotSchema.parse(await managedBrowser.capture(input));
  });

  ipcMain.handle(IPC_CHANNELS.managedBrowserSetBounds, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserBoundsIpcArgumentsSchema.parse(args);
    managedBrowser.setBounds(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.managedBrowserClose, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = managedBrowserReferenceIpcArgumentsSchema.parse(args);
    managedBrowser.close(input);
    return voidIpcResponseSchema.parse(undefined);
  });

  ipcMain.handle(IPC_CHANNELS.skillCreateDocument, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = createSkillDocumentIpcArgumentsSchema.parse(args);
    return skillDocumentSchema.parse(skillDocuments.createManagedDocument(input));
  });

  ipcMain.handle(IPC_CHANNELS.skillDiscoverDocuments, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    return skillDiscoveryResultSchema.parse(skillDocuments.discoverDocuments());
  });

  ipcMain.handle(IPC_CHANNELS.skillChooseDirectory, async (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    const selection = await dialog.showOpenDialog(window, {
      properties: ["openDirectory"],
      title: "选择 Skill 目录",
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || selectedPath === undefined) return null;
    return skillDiscoveryResultSchema.parse(skillDocuments.chooseDirectory(selectedPath));
  });

  ipcMain.handle(IPC_CHANNELS.skillImportDocument, async (event, ...args: unknown[]) => {
    const window = getTrustedWindow(event, getMainWindow);
    parseNoArguments(args);
    const selection = await dialog.showOpenDialog(window, {
      filters: [{ name: "Skill 文档", extensions: ["md"] }],
      properties: ["openFile"],
      title: "导入 SKILL.md",
    });
    const selectedPath = selection.filePaths[0];
    if (selection.canceled || selectedPath === undefined) return null;
    return skillDocumentSchema.parse(skillDocuments.importDocument(selectedPath));
  });

  ipcMain.handle(IPC_CHANNELS.skillReadDocument, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = skillDocumentReferenceIpcArgumentsSchema.parse(args);
    return skillDocumentSchema.parse(skillDocuments.readDocument(input.entryPath));
  });

  ipcMain.handle(IPC_CHANNELS.skillSaveDocument, (event, ...args: unknown[]) => {
    getTrustedWindow(event, getMainWindow);
    const [input] = skillDocumentSaveIpcArgumentsSchema.parse(args);
    return skillDocumentSchema.parse(skillDocuments.saveDocument(input));
  });

  ipcMain.handle(
    IPC_CHANNELS.configurationWorkspaceListEntries,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = listConfigurationWorkspaceEntriesIpcArgumentsSchema.parse(args);
      return configurationWorkspaceDirectoryListingSchema.parse(
        await configurationWorkspaces.listEntries(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.configurationWorkspaceReadFile,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = readConfigurationWorkspaceFileIpcArgumentsSchema.parse(args);
      return configurationWorkspaceFileSchema.parse(
        await configurationWorkspaces.readFile(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.configurationWorkspaceCreateEntry,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = createConfigurationWorkspaceEntryIpcArgumentsSchema.parse(args);
      return configurationWorkspaceEntrySchema.parse(
        await configurationWorkspaces.createEntry(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.configurationWorkspaceWriteFile,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = writeConfigurationWorkspaceFileIpcArgumentsSchema.parse(args);
      return configurationWorkspaceFileSchema.parse(
        await configurationWorkspaces.writeFile(input),
      );
    },
  );

  ipcMain.handle(
    IPC_CHANNELS.configurationWorkspaceDeleteEntry,
    async (event, ...args: unknown[]) => {
      getTrustedWindow(event, getMainWindow);
      const [input] = deleteConfigurationWorkspaceEntryIpcArgumentsSchema.parse(args);
      await configurationWorkspaces.deleteEntry(input);
      return voidIpcResponseSchema.parse(undefined);
    },
  );

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
    disposeApplicationSettingsListener();
    disposeTerminalSessionListener();
    disposeWorkspaceTerminalTabListener();
    disposeWorkspaceBrowserTabListener();
    disposeWorkspaceBrowserTabCloseListener();
    disposeManagedBrowserListener();
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
        sendConversationRunEvent(getMainWindow, runEvent)
      );
    });
  }

  return () => {
    disposeApplicationSettingsListener();
    disposeTerminalSessionListener();
    disposeWorkspaceTerminalTabListener();
    disposeWorkspaceBrowserTabListener();
    disposeWorkspaceBrowserTabCloseListener();
    disposeManagedBrowserListener();
    workspaceTerminalTabs.dispose();
    workspaceBrowserTabs.dispose();
    ipcMain.dispose();
  };
}
