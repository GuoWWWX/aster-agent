import { ipcRenderer, type IpcRendererEvent } from "electron";
import { IPC_CHANNELS } from "../../../../packages/protocol/src/ipc-channels.js";
// Import the narrow schema module directly. The protocol barrel also exports
// Skill YAML parsing, which pulls a Node-only `yaml` dependency into the
// sandboxed preload bundle and prevents Electron from loading the bridge.
import { applicationSettingsSchema } from "../../../../packages/protocol/src/application-settings.js";
import {
  managedBrowserEventSchema,
  terminalSessionEventSchema,
  workspaceBrowserTabCloseRequestSchema,
  workspaceBrowserTabOpenRequestSchema,
  workspaceTerminalTabOpenRequestSchema,
} from "../../../../packages/protocol/src/developer-tools.js";
import type {
  DesktopBridge,
  ConversationContextUsageInput,
  ImportConversationAttachmentBytesInput,
  RemoveConversationAttachmentInput,
  CancelRunInput,
  ApproveToolChangeInput,
  ApplicationSettings,
  BrowserConfiguration,
  ConversationReferenceInput,
  ForkConversationInput,
  PendingConversationMessageReferenceInput,
  ReorderPendingConversationMessagesInput,
  ConversationRunEvent,
  ConversationTaskList,
  ContextCompressionConfiguration,
  ConfigurationWorkspaceDirectoryListing,
  ConfigurationWorkspaceEntry,
  ConfigurationWorkspaceFile,
  CreateSkillDocumentInput,
  CreateConfigurationWorkspaceEntryInput,
  CreateProjectEntryInput,
  CreateConversationInput,
  DiscoverModelsInput,
  IntegrationConfiguration,
  GitFileDiffInput,
  GitOperationInput,
  GitReviewInput,
  DeleteConfigurationWorkspaceEntryInput,
  ListConfigurationWorkspaceEntriesInput,
  ProjectReferenceInput,
  RenameConversationInput,
  RenameProjectInput,
  ReadProjectFileInput,
  ReadProjectPreviewImageInput,
  ReadConfigurationWorkspaceFileInput,
  ReorderConversationsInput,
  ReplaceLatestConversationMessageInput,
  ReorderProjectsInput,
  SaveModelConfigurationInput,
  TestModelConnectionInput,
  SetDefaultModelInput,
  SetTeamCoordinatorInput,
  SendConversationMessageInput,
  SendTeamMessageInput,
  GetTeamWorkItemExecutionInput,
  ListTeamWorkItemsInput,
  RequestTeamWorkItemReworkInput,
  SubmitTeamWorkItemInput,
  UpdateTeamWorkItemInput,
  UpdateTeamWorkItemPermissionInput,
  AcceptTeamWorkItemInput,
  PluginCatalogEntry,
  ManagedBrowserBoundsInput,
  ManagedBrowserCommandInput,
  ManagedBrowserNavigateInput,
  ManagedBrowserOpenInput,
  ManagedBrowserReferenceInput,
  SetPluginEnabledInput,
  UpdatePendingConversationMessageInput,
  SetConversationArchivedInput,
  SetConversationModelSelectionInput,
  SetConversationProjectInput,
  SetConversationPinnedInput,
  SetProjectPinnedInput,
  SkillDocumentReferenceInput,
  SkillDiscoveryResult,
  SkillDocumentSaveInput,
  TerminalConfiguration,
  TerminalSessionOpenInput,
  TerminalSessionOutput,
  TerminalSessionOutputInput,
  TerminalSessionReferenceInput,
  TerminalSessionResizeInput,
  TerminalSessionWriteInput,
  WorkspaceTerminalTabOpenedInput,
  WorkspaceBrowserTabOpenedInput,
  WriteConfigurationWorkspaceFileInput,
  WriteProjectFileInput,
  WindowState
} from "@agent/protocol";

import { toAgentClientError } from "./agent-error.js";

type IpcChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];
type BridgeResult<Key extends keyof DesktopBridge> = Awaited<
  ReturnType<DesktopBridge[Key]>
>;

async function invoke<Result>(channel: IpcChannel, input?: unknown): Promise<Result> {
  try {
    return input === undefined
      ? await (ipcRenderer.invoke(channel) as Promise<Result>)
      : await (ipcRenderer.invoke(channel, input) as Promise<Result>);
  } catch (reason) {
    throw toAgentClientError(reason);
  }
}

export function createDesktopBridge(): DesktopBridge {
  return {
    addProject() {
      return invoke<BridgeResult<"addProject">>(IPC_CHANNELS.projectAdd);
    },
    createProjectEntry(input: CreateProjectEntryInput) {
      return invoke<BridgeResult<"createProjectEntry">>(
        IPC_CHANNELS.projectCreateEntry,
        input
      );
    },
    createConfigurationWorkspaceEntry(input: CreateConfigurationWorkspaceEntryInput) {
      return invoke<ConfigurationWorkspaceEntry>(
        IPC_CHANNELS.configurationWorkspaceCreateEntry,
        input,
      );
    },
    async approveToolChange(input: ApproveToolChangeInput) {
      await invoke<void>(IPC_CHANNELS.conversationApproveToolChange, input);
    },
    async cancelRun(input: CancelRunInput) {
      await invoke<void>(IPC_CHANNELS.conversationCancelRun, input);
    },
    async closeWindow() {
      await invoke<void>(IPC_CHANNELS.windowClose);
    },
    async writeClipboardText(text: string) {
      await invoke<void>(IPC_CHANNELS.clipboardWriteText, text);
    },
    createConversation(input: CreateConversationInput) {
      return invoke<BridgeResult<"createConversation">>(
        IPC_CHANNELS.conversationCreate,
        input
      );
    },
    selectConversationWorkspace(input: ConversationReferenceInput) {
      return invoke<BridgeResult<"selectConversationWorkspace">>(
        IPC_CHANNELS.conversationSelectWorkspace,
        input
      );
    },
    clearConversationWorkspace(input: ConversationReferenceInput) {
      return invoke<BridgeResult<"clearConversationWorkspace">>(
        IPC_CHANNELS.conversationClearWorkspace,
        input
      );
    },
    forkConversation(input: ForkConversationInput) {
      return invoke<BridgeResult<"forkConversation">>(
        IPC_CHANNELS.conversationFork,
        input
      );
    },
    getConversationContextUsage(input: ConversationContextUsageInput) {
      return invoke<BridgeResult<"getConversationContextUsage">>(
        IPC_CHANNELS.conversationGetContextUsage,
        input
      );
    },
    chooseConversationAttachments(input: ConversationReferenceInput) {
      return invoke<BridgeResult<"chooseConversationAttachments">>(
        IPC_CHANNELS.conversationChooseAttachments,
        input
      );
    },
    importConversationAttachmentBytes(input: ImportConversationAttachmentBytesInput) {
      return invoke<BridgeResult<"importConversationAttachmentBytes">>(
        IPC_CHANNELS.conversationImportAttachmentBytes,
        input,
      );
    },
    listDraftConversationAttachments(input: ConversationReferenceInput) {
      return invoke<BridgeResult<"listDraftConversationAttachments">>(
        IPC_CHANNELS.conversationListDraftAttachments,
        input
      );
    },
    async removeConversationAttachment(input: RemoveConversationAttachmentInput) {
      await invoke<void>(IPC_CHANNELS.conversationRemoveAttachment, input);
    },
    async setTeamCoordinator(input: SetTeamCoordinatorInput) {
      await invoke<void>(IPC_CHANNELS.teamSetCoordinator, input);
    },
    sendTeamMessage(input: SendTeamMessageInput) {
      return invoke<BridgeResult<"sendTeamMessage">>(IPC_CHANNELS.teamSendMessage, input);
    },
    listTeamWorkItems(input: ListTeamWorkItemsInput) {
      return invoke<BridgeResult<"listTeamWorkItems">>(IPC_CHANNELS.teamWorkItemList, input);
    },
    getTeamWorkItemExecution(input: GetTeamWorkItemExecutionInput) {
      return invoke<BridgeResult<"getTeamWorkItemExecution">>(
        IPC_CHANNELS.teamWorkItemGetExecution,
        input,
      );
    },
    submitTeamWorkItem(input: SubmitTeamWorkItemInput) {
      return invoke<BridgeResult<"submitTeamWorkItem">>(IPC_CHANNELS.teamWorkItemSubmit, input);
    },
    updateTeamWorkItem(input: UpdateTeamWorkItemInput) {
      return invoke<BridgeResult<"updateTeamWorkItem">>(IPC_CHANNELS.teamWorkItemUpdate, input);
    },
    updateTeamWorkItemPermission(input: UpdateTeamWorkItemPermissionInput) {
      return invoke<BridgeResult<"updateTeamWorkItemPermission">>(
        IPC_CHANNELS.teamWorkItemUpdatePermission,
        input,
      );
    },
    requestTeamWorkItemRework(input: RequestTeamWorkItemReworkInput) {
      return invoke<BridgeResult<"requestTeamWorkItemRework">>(
        IPC_CHANNELS.teamWorkItemRequestRework,
        input,
      );
    },
    acceptTeamWorkItem(input: AcceptTeamWorkItemInput) {
      return invoke<BridgeResult<"acceptTeamWorkItem">>(IPC_CHANNELS.teamWorkItemAccept, input);
    },
    listPlugins() {
      return invoke<PluginCatalogEntry[]>(IPC_CHANNELS.pluginList);
    },
    setPluginEnabled(input: SetPluginEnabledInput) {
      return invoke<PluginCatalogEntry>(IPC_CHANNELS.pluginSetEnabled, input);
    },
    getConversationTaskList(input: ConversationReferenceInput) {
      return invoke<ConversationTaskList | null>(
        IPC_CHANNELS.conversationGetTaskList,
        input
      );
    },
    async closeConversationTaskList(input: ConversationReferenceInput) {
      await invoke<void>(IPC_CHANNELS.conversationCloseTaskList, input);
    },
    async deleteConversationTaskList(input: ConversationReferenceInput) {
      await invoke<void>(IPC_CHANNELS.conversationDeleteTaskList, input);
    },
    createSkillDocument(input?: CreateSkillDocumentInput) {
      return invoke<BridgeResult<"createSkillDocument">>(
        IPC_CHANNELS.skillCreateDocument,
        input,
      );
    },
    chooseSkillDirectory() {
      return invoke<SkillDiscoveryResult | null>(IPC_CHANNELS.skillChooseDirectory);
    },
    discoverSkillDocuments() {
      return invoke<SkillDiscoveryResult>(IPC_CHANNELS.skillDiscoverDocuments);
    },
    async deleteConversation(input: ConversationReferenceInput) {
      await invoke<void>(IPC_CHANNELS.conversationDelete, input);
    },
    async deleteConfigurationWorkspaceEntry(input: DeleteConfigurationWorkspaceEntryInput) {
      await invoke<void>(IPC_CHANNELS.configurationWorkspaceDeleteEntry, input);
    },
    discoverModels(input: DiscoverModelsInput) {
      return invoke<BridgeResult<"discoverModels">>(IPC_CHANNELS.modelDiscover, input);
    },
    testModelConnection(input: TestModelConnectionInput) {
      return invoke<BridgeResult<"testModelConnection">>(
        IPC_CHANNELS.modelTestConnection,
        input,
      );
    },
    getModelStatus() {
      return invoke<BridgeResult<"getModelStatus">>(IPC_CHANNELS.modelGetStatus);
    },
    getContextCompressionConfiguration() {
      return invoke<BridgeResult<"getContextCompressionConfiguration">>(
        IPC_CHANNELS.contextCompressionGetConfiguration
      );
    },
    getApplicationSettings() {
      return invoke<BridgeResult<"getApplicationSettings">>(
        IPC_CHANNELS.applicationSettingsGetConfiguration,
      );
    },
    getModelCatalog() {
      return invoke<BridgeResult<"getModelCatalog">>(IPC_CHANNELS.modelGetCatalog);
    },
    getIntegrationConfiguration() {
      return invoke<BridgeResult<"getIntegrationConfiguration">>(
        IPC_CHANNELS.integrationGetConfiguration
      );
    },
    getBrowserConfiguration() {
      return invoke<BridgeResult<"getBrowserConfiguration">>(
        IPC_CHANNELS.browserGetConfiguration
      );
    },
    getTerminalConfiguration() {
      return invoke<BridgeResult<"getTerminalConfiguration">>(
        IPC_CHANNELS.terminalGetConfiguration
      );
    },
    getGitReviewSnapshot(input: GitReviewInput) {
      return invoke<BridgeResult<"getGitReviewSnapshot">>(IPC_CHANNELS.gitReviewGetSnapshot, input);
    },
    getGitFileDiff(input: GitFileDiffInput) {
      return invoke<BridgeResult<"getGitFileDiff">>(IPC_CHANNELS.gitReviewGetFileDiff, input);
    },
    runGitOperation(input: GitOperationInput) {
      return invoke<BridgeResult<"runGitOperation">>(IPC_CHANNELS.gitReviewRunOperation, input);
    },
    openTerminalSession(input: TerminalSessionOpenInput) {
      return invoke<BridgeResult<"openTerminalSession">>(IPC_CHANNELS.terminalSessionOpen, input);
    },
    readTerminalSessionOutput(input: TerminalSessionOutputInput) {
      return invoke<TerminalSessionOutput>(IPC_CHANNELS.terminalSessionReadOutput, input);
    },
    async writeTerminalSession(input: TerminalSessionWriteInput) {
      await invoke<void>(IPC_CHANNELS.terminalSessionWrite, input);
    },
    async resizeTerminalSession(input: TerminalSessionResizeInput) {
      await invoke<void>(IPC_CHANNELS.terminalSessionResize, input);
    },
    async closeTerminalSession(input: TerminalSessionReferenceInput) {
      await invoke<void>(IPC_CHANNELS.terminalSessionClose, input);
    },
    async confirmWorkspaceTerminalTabOpened(input: WorkspaceTerminalTabOpenedInput) {
      await invoke<void>(IPC_CHANNELS.workspaceTerminalOpened, input);
    },
    async confirmWorkspaceBrowserTabOpened(input: WorkspaceBrowserTabOpenedInput) {
      await invoke<void>(IPC_CHANNELS.workspaceBrowserOpened, input);
    },
    openManagedBrowser(input: ManagedBrowserOpenInput) {
      return invoke<BridgeResult<"openManagedBrowser">>(IPC_CHANNELS.managedBrowserOpen, input);
    },
    async navigateManagedBrowser(input: ManagedBrowserNavigateInput) {
      await invoke<void>(IPC_CHANNELS.managedBrowserNavigate, input);
    },
    async commandManagedBrowser(input: ManagedBrowserCommandInput) {
      await invoke<void>(IPC_CHANNELS.managedBrowserCommand, input);
    },
    captureManagedBrowser(input: ManagedBrowserReferenceInput) {
      return invoke<BridgeResult<"captureManagedBrowser">>(IPC_CHANNELS.managedBrowserCapture, input);
    },
    async setManagedBrowserBounds(input: ManagedBrowserBoundsInput) {
      await invoke<void>(IPC_CHANNELS.managedBrowserSetBounds, input);
    },
    async closeManagedBrowser(input: ManagedBrowserReferenceInput) {
      await invoke<void>(IPC_CHANNELS.managedBrowserClose, input);
    },
    importSkillDocument() {
      return invoke<BridgeResult<"importSkillDocument">>(
        IPC_CHANNELS.skillImportDocument
      );
    },
    getModelApiKey(providerId: string) {
      return invoke<BridgeResult<"getModelApiKey">>(IPC_CHANNELS.modelGetApiKey, {
        providerId
      });
    },
    getRuntimeInfo() {
      return invoke<BridgeResult<"getRuntimeInfo">>(IPC_CHANNELS.runtimeGetInfo);
    },
    getWindowState() {
      return invoke<BridgeResult<"getWindowState">>(IPC_CHANNELS.windowGetState);
    },
    async listProjectEntries(input) {
      return invoke<BridgeResult<"listProjectEntries">>(
        IPC_CHANNELS.projectListEntries,
        input
      );
    },
    listConfigurationWorkspaceEntries(input: ListConfigurationWorkspaceEntriesInput) {
      return invoke<ConfigurationWorkspaceDirectoryListing>(
        IPC_CHANNELS.configurationWorkspaceListEntries,
        input,
      );
    },
    listProjects() {
      return invoke<BridgeResult<"listProjects">>(IPC_CHANNELS.projectList);
    },
    readProjectFile(input: ReadProjectFileInput) {
      return invoke<BridgeResult<"readProjectFile">>(
        IPC_CHANNELS.projectReadFile,
        input
      );
    },
    writeProjectFile(input: WriteProjectFileInput) {
      return invoke<BridgeResult<"writeProjectFile">>(
        IPC_CHANNELS.projectWriteFile,
        input
      );
    },
    readProjectPreviewImage(input: ReadProjectPreviewImageInput) {
      return invoke<BridgeResult<"readProjectPreviewImage">>(
        IPC_CHANNELS.projectReadPreviewImage,
        input
      );
    },
    readConfigurationWorkspaceFile(input: ReadConfigurationWorkspaceFileInput) {
      return invoke<ConfigurationWorkspaceFile>(
        IPC_CHANNELS.configurationWorkspaceReadFile,
        input,
      );
    },
    async removeProject(input: ProjectReferenceInput) {
      await invoke<void>(IPC_CHANNELS.projectRemove, input);
    },
    listConversationTimeline(input: ConversationReferenceInput) {
      return invoke<BridgeResult<"listConversationTimeline">>(
        IPC_CHANNELS.conversationListTimeline,
        input
      );
    },
    listConversationPendingMessages(input: ConversationReferenceInput) {
      return invoke<BridgeResult<"listConversationPendingMessages">>(
        IPC_CHANNELS.conversationListPendingMessages,
        input
      );
    },
    markConversationResultViewed(input: ConversationReferenceInput) {
      return invoke<BridgeResult<"markConversationResultViewed">>(
        IPC_CHANNELS.conversationMarkResultViewed,
        input
      );
    },
    listConversations() {
      return invoke<BridgeResult<"listConversations">>(IPC_CHANNELS.conversationList);
    },
    listConversationForks(input: ConversationReferenceInput) {
      return invoke<BridgeResult<"listConversationForks">>(
        IPC_CHANNELS.conversationListForks,
        input
      );
    },
    async minimizeWindow() {
      await invoke<void>(IPC_CHANNELS.windowMinimize);
    },
    onConversationRunEvent(listener) {
      const handleConversationRunEvent = (
        _event: IpcRendererEvent,
        runEvent: unknown
      ): void => {
        listener(runEvent as ConversationRunEvent);
      };

      ipcRenderer.on(IPC_CHANNELS.conversationRunEvent, handleConversationRunEvent);

      return () => {
        ipcRenderer.removeListener(
          IPC_CHANNELS.conversationRunEvent,
          handleConversationRunEvent
        );
      };
    },
    onApplicationSettingsChanged(listener) {
      const handleApplicationSettingsChanged = (
        _event: IpcRendererEvent,
        settings: unknown,
      ): void => {
        listener(applicationSettingsSchema.parse(settings));
      };

      ipcRenderer.on(IPC_CHANNELS.applicationSettingsChanged, handleApplicationSettingsChanged);

      return () => {
        ipcRenderer.removeListener(
          IPC_CHANNELS.applicationSettingsChanged,
          handleApplicationSettingsChanged,
        );
      };
    },
    onTerminalSessionEvent(listener) {
      const handle = (_event: IpcRendererEvent, value: unknown): void => {
        listener(terminalSessionEventSchema.parse(value));
      };
      ipcRenderer.on(IPC_CHANNELS.terminalSessionEvent, handle);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.terminalSessionEvent, handle);
    },
    onWorkspaceTerminalTabOpenRequested(listener) {
      const handle = (_event: IpcRendererEvent, value: unknown): void => {
        listener(workspaceTerminalTabOpenRequestSchema.parse(value));
      };
      ipcRenderer.on(IPC_CHANNELS.workspaceTerminalOpenRequested, handle);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceTerminalOpenRequested, handle);
    },
    onWorkspaceBrowserTabOpenRequested(listener) {
      const handle = (_event: IpcRendererEvent, value: unknown): void => {
        listener(workspaceBrowserTabOpenRequestSchema.parse(value));
      };
      ipcRenderer.on(IPC_CHANNELS.workspaceBrowserOpenRequested, handle);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceBrowserOpenRequested, handle);
    },
    onWorkspaceBrowserTabCloseRequested(listener) {
      const handle = (_event: IpcRendererEvent, value: unknown): void => {
        listener(workspaceBrowserTabCloseRequestSchema.parse(value));
      };
      ipcRenderer.on(IPC_CHANNELS.workspaceBrowserCloseRequested, handle);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.workspaceBrowserCloseRequested, handle);
    },
    onManagedBrowserEvent(listener) {
      const handle = (_event: IpcRendererEvent, value: unknown): void => {
        listener(managedBrowserEventSchema.parse(value));
      };
      ipcRenderer.on(IPC_CHANNELS.managedBrowserEvent, handle);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.managedBrowserEvent, handle);
    },
    onWindowStateChanged(listener) {
      const handleWindowStateChanged = (
        _event: IpcRendererEvent,
        state: unknown
      ): void => {
        listener(state as WindowState);
      };

      ipcRenderer.on(IPC_CHANNELS.windowStateChanged, handleWindowStateChanged);

      return () => {
        ipcRenderer.removeListener(
          IPC_CHANNELS.windowStateChanged,
          handleWindowStateChanged
        );
      };
    },
    async toggleMaximizeWindow() {
      await invoke<void>(IPC_CHANNELS.windowToggleMaximize);
    },
    renameConversation(input: RenameConversationInput) {
      return invoke<BridgeResult<"renameConversation">>(
        IPC_CHANNELS.conversationRename,
        input
      );
    },
    reorderConversations(input: ReorderConversationsInput) {
      return invoke<BridgeResult<"reorderConversations">>(
        IPC_CHANNELS.conversationReorder,
        input
      );
    },
    renameProject(input: RenameProjectInput) {
      return invoke<BridgeResult<"renameProject">>(IPC_CHANNELS.projectRename, input);
    },
    reorderProjects(input: ReorderProjectsInput) {
      return invoke<BridgeResult<"reorderProjects">>(IPC_CHANNELS.projectReorder, input);
    },
    setConversationArchived(input: SetConversationArchivedInput) {
      return invoke<BridgeResult<"setConversationArchived">>(
        IPC_CHANNELS.conversationSetArchived,
        input
      );
    },
    setConversationProject(input: SetConversationProjectInput) {
      return invoke<BridgeResult<"setConversationProject">>(
        IPC_CHANNELS.conversationSetProject,
        input
      );
    },
    setConversationModelSelection(input: SetConversationModelSelectionInput) {
      return invoke<BridgeResult<"setConversationModelSelection">>(
        IPC_CHANNELS.conversationSetModelSelection,
        input
      );
    },
    setConversationPinned(input: SetConversationPinnedInput) {
      return invoke<BridgeResult<"setConversationPinned">>(
        IPC_CHANNELS.conversationSetPinned,
        input
      );
    },
    setProjectPinned(input: SetProjectPinnedInput) {
      return invoke<BridgeResult<"setProjectPinned">>(
        IPC_CHANNELS.projectSetPinned,
        input
      );
    },
    readSkillDocument(input: SkillDocumentReferenceInput) {
      return invoke<BridgeResult<"readSkillDocument">>(
        IPC_CHANNELS.skillReadDocument,
        input
      );
    },
    sendConversationMessage(input: SendConversationMessageInput) {
      return invoke<BridgeResult<"sendConversationMessage">>(
        IPC_CHANNELS.conversationSendMessage,
        input
      );
    },
    replaceLatestConversationMessage(input: ReplaceLatestConversationMessageInput) {
      return invoke<BridgeResult<"replaceLatestConversationMessage">>(
        IPC_CHANNELS.conversationReplaceLatestMessage,
        input
      );
    },
    promoteConversationPendingMessage(input: PendingConversationMessageReferenceInput) {
      return invoke<BridgeResult<"promoteConversationPendingMessage">>(
        IPC_CHANNELS.conversationPromotePendingMessage,
        input
      );
    },
    deleteConversationPendingMessage(input: PendingConversationMessageReferenceInput) {
      return invoke<BridgeResult<"deleteConversationPendingMessage">>(
        IPC_CHANNELS.conversationDeletePendingMessage,
        input
      );
    },
    updateConversationPendingMessage(input: UpdatePendingConversationMessageInput) {
      return invoke<BridgeResult<"updateConversationPendingMessage">>(
        IPC_CHANNELS.conversationUpdatePendingMessage,
        input
      );
    },
    reorderConversationPendingMessages(input: ReorderPendingConversationMessagesInput) {
      return invoke<BridgeResult<"reorderConversationPendingMessages">>(
        IPC_CHANNELS.conversationReorderPendingMessages,
        input
      );
    },
    saveModelConfiguration(input: SaveModelConfigurationInput) {
      return invoke<BridgeResult<"saveModelConfiguration">>(
        IPC_CHANNELS.modelSaveConfiguration,
        input
      );
    },
    setDefaultModel(input: SetDefaultModelInput) {
      return invoke<BridgeResult<"setDefaultModel">>(
        IPC_CHANNELS.modelSetDefault,
        input
      );
    },
    saveContextCompressionConfiguration(input: ContextCompressionConfiguration) {
      return invoke<BridgeResult<"saveContextCompressionConfiguration">>(
        IPC_CHANNELS.contextCompressionSaveConfiguration,
        input
      );
    },
    saveApplicationSettings(input: ApplicationSettings) {
      return invoke<BridgeResult<"saveApplicationSettings">>(
        IPC_CHANNELS.applicationSettingsSaveConfiguration,
        input,
      );
    },
    saveIntegrationConfiguration(input: IntegrationConfiguration) {
      return invoke<BridgeResult<"saveIntegrationConfiguration">>(
        IPC_CHANNELS.integrationSaveConfiguration,
        input
      );
    },
    saveBrowserConfiguration(input: BrowserConfiguration) {
      return invoke<BridgeResult<"saveBrowserConfiguration">>(
        IPC_CHANNELS.browserSaveConfiguration,
        input
      );
    },
    saveTerminalConfiguration(input: TerminalConfiguration) {
      return invoke<BridgeResult<"saveTerminalConfiguration">>(
        IPC_CHANNELS.terminalSaveConfiguration,
        input
      );
    },
    saveSkillDocument(input: SkillDocumentSaveInput) {
      return invoke<BridgeResult<"saveSkillDocument">>(
        IPC_CHANNELS.skillSaveDocument,
        input
      );
    }
    ,
    writeConfigurationWorkspaceFile(input: WriteConfigurationWorkspaceFileInput) {
      return invoke<ConfigurationWorkspaceFile>(
        IPC_CHANNELS.configurationWorkspaceWriteFile,
        input,
      );
    },
  };
}
