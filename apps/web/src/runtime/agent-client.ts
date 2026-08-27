import type {
  CapabilitySet,
  ApplicationSettings,
  ApproveToolChangeInput,
  CancelRunInput,
  ConversationContextUsage,
  ConversationContextUsageInput,
  ConversationAttachment,
  ConversationMessageSubmission,
  ConversationPendingMessage,
  ContextCompressionConfiguration,
  ConfigurationWorkspaceDirectoryListing,
  ConfigurationWorkspaceEntry,
  ConfigurationWorkspaceFile,
  CreateSkillDocumentInput,
  CreateConfigurationWorkspaceEntryInput,
  ConversationReferenceInput,
  ForkConversationInput,
  ConversationRunEvent,
  ConversationSummary,
  ConversationTaskList,
  ConversationTimelineItem,
  CreateProjectEntryInput,
  DeleteConfigurationWorkspaceEntryInput,
  CreateConversationInput,
  DiscoverModelsInput,
  DiscoveredModel,
  IntegrationConfiguration,
  ListConfigurationWorkspaceEntriesInput,
  ListProjectEntriesInput,
  ModelConnectionTestResult,
  ModelRuntimeStatus,
  ModelCatalog,
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectFile,
  ProjectPreviewImage,
  ProjectReferenceInput,
  ReadProjectFileInput,
  ReadProjectPreviewImageInput,
  ReadConfigurationWorkspaceFileInput,
  ReorderConversationsInput,
  ReplaceLatestConversationMessageInput,
  ReorderProjectsInput,
  RemoveConversationAttachmentInput,
  PendingConversationMessageReferenceInput,
  ProjectSummary,
  RenameProjectInput,
  ReorderPendingConversationMessagesInput,
  SaveModelConfigurationInput,
  TestModelConnectionInput,
  SetDefaultModelInput,
  SendConversationMessageInput,
  UpdatePendingConversationMessageInput,
  SetConversationArchivedInput,
  SetConversationProjectInput,
  SetConversationPinnedInput,
  SetProjectPinnedInput,
  RuntimeInfo,
  RunAccepted,
  SkillDocument,
  SkillDiscoveryResult,
  SkillDocumentReferenceInput,
  SkillDocumentSaveInput,
  TerminalConfiguration,
  WriteConfigurationWorkspaceFileInput,
  WriteProjectFileInput,
  WindowState,
} from "@agent/protocol";

export type WindowStateListener = (state: WindowState) => void;
export type ConversationRunEventListener = (event: ConversationRunEvent) => void;
export type ApplicationSettingsListener = (settings: ApplicationSettings) => void;

/**
 * Renderer-facing runtime port. UI code talks only to this contract so the
 * browser mock and Electron preload surface stay interchangeable.
 */
export interface AgentClient {
  addProject(): Promise<ProjectSummary | null>;
  createProjectEntry(input: CreateProjectEntryInput): Promise<ProjectEntry>;
  createConfigurationWorkspaceEntry(
    input: CreateConfigurationWorkspaceEntryInput,
  ): Promise<ConfigurationWorkspaceEntry>;
  approveToolChange(input: ApproveToolChangeInput): Promise<void>;
  cancelRun(input: CancelRunInput): Promise<void>;
  closeWindow(): Promise<void>;
  writeClipboardText(text: string): Promise<void>;
  createConversation(input: CreateConversationInput): Promise<ConversationSummary>;
  selectConversationWorkspace(
    input: ConversationReferenceInput,
  ): Promise<ConversationSummary | null>;
  clearConversationWorkspace(input: ConversationReferenceInput): Promise<ConversationSummary>;
  forkConversation(input: ForkConversationInput): Promise<ConversationSummary>;
  getConversationContextUsage(
    input: ConversationContextUsageInput,
  ): Promise<ConversationContextUsage>;
  chooseConversationAttachments(
    input: ConversationReferenceInput,
  ): Promise<ConversationAttachment[]>;
  listDraftConversationAttachments(
    input: ConversationReferenceInput,
  ): Promise<ConversationAttachment[]>;
  removeConversationAttachment(input: RemoveConversationAttachmentInput): Promise<void>;
  getConversationTaskList(
    input: ConversationReferenceInput,
  ): Promise<ConversationTaskList | null>;
  closeConversationTaskList(
    input: ConversationReferenceInput,
  ): Promise<void>;
  deleteConversationTaskList(input: ConversationReferenceInput): Promise<void>;
  chooseSkillDirectory(): Promise<SkillDiscoveryResult | null>;
  createSkillDocument(input?: CreateSkillDocumentInput): Promise<SkillDocument>;
  discoverSkillDocuments(): Promise<SkillDiscoveryResult>;
  deleteConversation(input: ConversationReferenceInput): Promise<void>;
  deleteConfigurationWorkspaceEntry(
    input: DeleteConfigurationWorkspaceEntryInput,
  ): Promise<void>;
  discoverModels(input: DiscoverModelsInput): Promise<DiscoveredModel[]>;
  testModelConnection(input: TestModelConnectionInput): Promise<ModelConnectionTestResult>;
  getModelApiKey(providerId: string): Promise<string | null>;
  getCapabilities(): Promise<CapabilitySet>;
  getModelCatalog(): Promise<ModelCatalog>;
  getModelStatus(): Promise<ModelRuntimeStatus>;
  getContextCompressionConfiguration(): Promise<ContextCompressionConfiguration>;
  getApplicationSettings(): Promise<ApplicationSettings>;
  getIntegrationConfiguration(): Promise<IntegrationConfiguration>;
  getTerminalConfiguration(): Promise<TerminalConfiguration>;
  getRuntimeInfo(): Promise<RuntimeInfo>;
  getWindowState(): Promise<WindowState>;
  importSkillDocument(): Promise<SkillDocument | null>;
  listConversationTimeline(
    input: ConversationReferenceInput,
  ): Promise<ConversationTimelineItem[]>;
  listConversationPendingMessages(
    input: ConversationReferenceInput,
  ): Promise<ConversationPendingMessage[]>;
  listConversations(): Promise<ConversationSummary[]>;
  listConversationForks(input: ConversationReferenceInput): Promise<ConversationSummary[]>;
  markConversationResultViewed(
    input: ConversationReferenceInput,
  ): Promise<ConversationSummary>;
  listProjectEntries(
    input: ListProjectEntriesInput,
  ): Promise<ProjectDirectoryListing>;
  listConfigurationWorkspaceEntries(
    input: ListConfigurationWorkspaceEntriesInput,
  ): Promise<ConfigurationWorkspaceDirectoryListing>;
  listProjects(): Promise<ProjectSummary[]>;
  readProjectFile(input: ReadProjectFileInput): Promise<ProjectFile>;
  writeProjectFile(input: WriteProjectFileInput): Promise<ProjectFile>;
  readProjectPreviewImage(input: ReadProjectPreviewImageInput): Promise<ProjectPreviewImage>;
  readConfigurationWorkspaceFile(
    input: ReadConfigurationWorkspaceFileInput,
  ): Promise<ConfigurationWorkspaceFile>;
  removeProject(input: ProjectReferenceInput): Promise<void>;
  minimizeWindow(): Promise<void>;
  onConversationRunEvent(listener: ConversationRunEventListener): () => void;
  onApplicationSettingsChanged(listener: ApplicationSettingsListener): () => void;
  onWindowStateChanged(listener: WindowStateListener): () => void;
  renameConversation(input: {
    conversationId: string;
    title: string;
  }): Promise<ConversationSummary>;
  reorderConversations(input: ReorderConversationsInput): Promise<ConversationSummary[]>;
  renameProject(input: RenameProjectInput): Promise<ProjectSummary>;
  reorderProjects(input: ReorderProjectsInput): Promise<ProjectSummary[]>;
  setConversationArchived(input: SetConversationArchivedInput): Promise<ConversationSummary>;
  setConversationProject(input: SetConversationProjectInput): Promise<ConversationSummary>;
  setConversationPinned(input: SetConversationPinnedInput): Promise<ConversationSummary>;
  setProjectPinned(input: SetProjectPinnedInput): Promise<ProjectSummary>;
  readSkillDocument(input: SkillDocumentReferenceInput): Promise<SkillDocument>;
  sendConversationMessage(
    input: SendConversationMessageInput,
  ): Promise<ConversationMessageSubmission>;
  replaceLatestConversationMessage(
    input: ReplaceLatestConversationMessageInput,
  ): Promise<RunAccepted>;
  promoteConversationPendingMessage(
    input: PendingConversationMessageReferenceInput,
  ): Promise<ConversationPendingMessage[]>;
  deleteConversationPendingMessage(
    input: PendingConversationMessageReferenceInput,
  ): Promise<ConversationPendingMessage[]>;
  updateConversationPendingMessage(
    input: UpdatePendingConversationMessageInput,
  ): Promise<ConversationPendingMessage[]>;
  reorderConversationPendingMessages(
    input: ReorderPendingConversationMessagesInput,
  ): Promise<ConversationPendingMessage[]>;
  saveModelConfiguration(
    input: SaveModelConfigurationInput,
  ): Promise<ModelRuntimeStatus>;
  setDefaultModel(input: SetDefaultModelInput): Promise<ModelRuntimeStatus>;
  saveContextCompressionConfiguration(
    input: ContextCompressionConfiguration,
  ): Promise<ContextCompressionConfiguration>;
  saveApplicationSettings(input: ApplicationSettings): Promise<ApplicationSettings>;
  saveIntegrationConfiguration(
    input: IntegrationConfiguration,
  ): Promise<IntegrationConfiguration>;
  saveTerminalConfiguration(
    input: TerminalConfiguration,
  ): Promise<TerminalConfiguration>;
  saveSkillDocument(input: SkillDocumentSaveInput): Promise<SkillDocument>;
  writeConfigurationWorkspaceFile(
    input: WriteConfigurationWorkspaceFileInput,
  ): Promise<ConfigurationWorkspaceFile>;
  toggleMaximizeWindow(): Promise<void>;
}
