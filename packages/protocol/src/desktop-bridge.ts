import type {
  ApproveToolChangeInput,
  CancelRunInput,
  ConversationContextUsage,
  ConversationContextUsageInput,
  ConversationAttachment,
  ConversationMessageSubmission,
  ConversationPendingMessage,
  ConversationReferenceInput,
  ForkConversationInput,
  ConversationRunEvent,
  ConversationSummary,
  ConversationTaskList,
  ConversationTimelineItem,
  CreateConversationInput,
  DiscoverModelsInput,
  DiscoveredModel,
  ModelConnectionTestResult,
  ModelRuntimeStatus,
  RenameConversationInput,
  ReorderConversationsInput,
  ReplaceLatestConversationMessageInput,
  RunAccepted,
  ImportConversationAttachmentBytesInput,
  RemoveConversationAttachmentInput,
  PendingConversationMessageReferenceInput,
  ReorderPendingConversationMessagesInput,
  SetConversationArchivedInput,
  SetConversationProjectInput,
  SetConversationPinnedInput,
  SetTeamCoordinatorInput,
  SaveModelConfigurationInput,
  TestModelConnectionInput,
  SetDefaultModelInput,
  SendConversationMessageInput,
  SendTeamMessageInput,
  UpdatePendingConversationMessageInput
} from "./conversation.js";
import type { PluginCatalogEntry, SetPluginEnabledInput } from "./plugin.js";
import type { ContextCompressionConfiguration } from "./context-compression.js";
import type { ApplicationSettings } from "./application-settings.js";
import type { ModelCatalog } from "./model-catalog.js";
import type {
  CreateProjectEntryInput,
  ListProjectEntriesInput,
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectFile,
  ProjectPreviewImage,
  ProjectReferenceInput,
  ReadProjectFileInput,
  ReadProjectPreviewImageInput,
  RenameProjectInput,
  ReorderProjectsInput,
  SetProjectPinnedInput,
  ProjectSummary,
  WriteProjectFileInput
} from "./project.js";
import type { RuntimeInfo } from "./runtime.js";
import type { WindowState } from "./window.js";
import type { IntegrationConfiguration } from "./integration.js";
import type { TerminalConfiguration } from "./terminal.js";
import type {
  ConfigurationWorkspaceDirectoryListing,
  ConfigurationWorkspaceEntry,
  ConfigurationWorkspaceFile,
  CreateConfigurationWorkspaceEntryInput,
  DeleteConfigurationWorkspaceEntryInput,
  ListConfigurationWorkspaceEntriesInput,
  ReadConfigurationWorkspaceFileInput,
  WriteConfigurationWorkspaceFileInput,
} from "./configuration-workspace.js";
import type {
  CreateSkillDocumentInput,
  SkillDocument,
  SkillDiscoveryResult,
  SkillDocumentReferenceInput,
  SkillDocumentSaveInput,
} from "./skill-document.js";

/**
 * The complete renderer-facing desktop surface for the initial application
 * shell. It deliberately exposes operations, not a generic IPC transport.
 */
export interface DesktopBridge {
  addProject(): Promise<ProjectSummary | null>;
  createProjectEntry(input: CreateProjectEntryInput): Promise<ProjectEntry>;
  createConfigurationWorkspaceEntry(
    input: CreateConfigurationWorkspaceEntryInput
  ): Promise<ConfigurationWorkspaceEntry>;
  approveToolChange(input: ApproveToolChangeInput): Promise<void>;
  cancelRun(input: CancelRunInput): Promise<void>;
  createConversation(input: CreateConversationInput): Promise<ConversationSummary>;
  selectConversationWorkspace(
    input: ConversationReferenceInput
  ): Promise<ConversationSummary | null>;
  clearConversationWorkspace(input: ConversationReferenceInput): Promise<ConversationSummary>;
  forkConversation(input: ForkConversationInput): Promise<ConversationSummary>;
  getConversationContextUsage(
    input: ConversationContextUsageInput
  ): Promise<ConversationContextUsage>;
  chooseConversationAttachments(
    input: ConversationReferenceInput
  ): Promise<ConversationAttachment[]>;
  importConversationAttachmentBytes(
    input: ImportConversationAttachmentBytesInput
  ): Promise<ConversationAttachment[]>;
  listDraftConversationAttachments(
    input: ConversationReferenceInput
  ): Promise<ConversationAttachment[]>;
  removeConversationAttachment(input: RemoveConversationAttachmentInput): Promise<void>;
  setTeamCoordinator(input: SetTeamCoordinatorInput): Promise<void>;
  sendTeamMessage(input: SendTeamMessageInput): Promise<ConversationMessageSubmission>;
  listPlugins(): Promise<PluginCatalogEntry[]>;
  setPluginEnabled(input: SetPluginEnabledInput): Promise<PluginCatalogEntry>;
  getConversationTaskList(
    input: ConversationReferenceInput
  ): Promise<ConversationTaskList | null>;
  closeConversationTaskList(
    input: ConversationReferenceInput
  ): Promise<void>;
  deleteConversationTaskList(input: ConversationReferenceInput): Promise<void>;
  deleteConversation(input: ConversationReferenceInput): Promise<void>;
  deleteConfigurationWorkspaceEntry(
    input: DeleteConfigurationWorkspaceEntryInput
  ): Promise<void>;
  discoverModels(input: DiscoverModelsInput): Promise<DiscoveredModel[]>;
  testModelConnection(input: TestModelConnectionInput): Promise<ModelConnectionTestResult>;
  getModelApiKey(providerId: string): Promise<string | null>;
  getModelCatalog(): Promise<ModelCatalog>;
  getModelStatus(): Promise<ModelRuntimeStatus>;
  getContextCompressionConfiguration(): Promise<ContextCompressionConfiguration>;
  getApplicationSettings(): Promise<ApplicationSettings>;
  getIntegrationConfiguration(): Promise<IntegrationConfiguration>;
  getTerminalConfiguration(): Promise<TerminalConfiguration>;
  getRuntimeInfo(): Promise<RuntimeInfo>;
  getWindowState(): Promise<WindowState>;
  listProjectEntries(input: ListProjectEntriesInput): Promise<ProjectDirectoryListing>;
  listConfigurationWorkspaceEntries(
    input: ListConfigurationWorkspaceEntriesInput
  ): Promise<ConfigurationWorkspaceDirectoryListing>;
  listProjects(): Promise<ProjectSummary[]>;
  listConversationTimeline(
    input: ConversationReferenceInput
  ): Promise<ConversationTimelineItem[]>;
  listConversationPendingMessages(
    input: ConversationReferenceInput
  ): Promise<ConversationPendingMessage[]>;
  listConversations(): Promise<ConversationSummary[]>;
  listConversationForks(input: ConversationReferenceInput): Promise<ConversationSummary[]>;
  markConversationResultViewed(
    input: ConversationReferenceInput
  ): Promise<ConversationSummary>;
  readProjectFile(input: ReadProjectFileInput): Promise<ProjectFile>;
  writeProjectFile(input: WriteProjectFileInput): Promise<ProjectFile>;
  readProjectPreviewImage(input: ReadProjectPreviewImageInput): Promise<ProjectPreviewImage>;
  readConfigurationWorkspaceFile(
    input: ReadConfigurationWorkspaceFileInput
  ): Promise<ConfigurationWorkspaceFile>;
  removeProject(input: ProjectReferenceInput): Promise<void>;
  minimizeWindow(): Promise<void>;
  onConversationRunEvent(listener: (event: ConversationRunEvent) => void): () => void;
  onApplicationSettingsChanged(listener: (settings: ApplicationSettings) => void): () => void;
  toggleMaximizeWindow(): Promise<void>;
  closeWindow(): Promise<void>;
  writeClipboardText(text: string): Promise<void>;
  renameConversation(input: RenameConversationInput): Promise<ConversationSummary>;
  reorderConversations(input: ReorderConversationsInput): Promise<ConversationSummary[]>;
  renameProject(input: RenameProjectInput): Promise<ProjectSummary>;
  reorderProjects(input: ReorderProjectsInput): Promise<ProjectSummary[]>;
  setProjectPinned(input: SetProjectPinnedInput): Promise<ProjectSummary>;
  setConversationArchived(input: SetConversationArchivedInput): Promise<ConversationSummary>;
  setConversationProject(input: SetConversationProjectInput): Promise<ConversationSummary>;
  setConversationPinned(input: SetConversationPinnedInput): Promise<ConversationSummary>;
  sendConversationMessage(input: SendConversationMessageInput): Promise<ConversationMessageSubmission>;
  replaceLatestConversationMessage(
    input: ReplaceLatestConversationMessageInput
  ): Promise<RunAccepted>;
  promoteConversationPendingMessage(
    input: PendingConversationMessageReferenceInput
  ): Promise<ConversationPendingMessage[]>;
  deleteConversationPendingMessage(
    input: PendingConversationMessageReferenceInput
  ): Promise<ConversationPendingMessage[]>;
  updateConversationPendingMessage(
    input: UpdatePendingConversationMessageInput
  ): Promise<ConversationPendingMessage[]>;
  reorderConversationPendingMessages(
    input: ReorderPendingConversationMessagesInput
  ): Promise<ConversationPendingMessage[]>;
  saveModelConfiguration(
    input: SaveModelConfigurationInput
  ): Promise<ModelRuntimeStatus>;
  setDefaultModel(input: SetDefaultModelInput): Promise<ModelRuntimeStatus>;
  saveContextCompressionConfiguration(
    input: ContextCompressionConfiguration
  ): Promise<ContextCompressionConfiguration>;
  saveApplicationSettings(
    input: ApplicationSettings
  ): Promise<ApplicationSettings>;
  saveIntegrationConfiguration(
    input: IntegrationConfiguration
  ): Promise<IntegrationConfiguration>;
  saveTerminalConfiguration(
    input: TerminalConfiguration
  ): Promise<TerminalConfiguration>;
  chooseSkillDirectory(): Promise<SkillDiscoveryResult | null>;
  createSkillDocument(input?: CreateSkillDocumentInput): Promise<SkillDocument>;
  discoverSkillDocuments(): Promise<SkillDiscoveryResult>;
  importSkillDocument(): Promise<SkillDocument | null>;
  readSkillDocument(input: SkillDocumentReferenceInput): Promise<SkillDocument>;
  saveSkillDocument(input: SkillDocumentSaveInput): Promise<SkillDocument>;
  writeConfigurationWorkspaceFile(
    input: WriteConfigurationWorkspaceFileInput
  ): Promise<ConfigurationWorkspaceFile>;
  onWindowStateChanged(listener: (state: WindowState) => void): () => void;
}
