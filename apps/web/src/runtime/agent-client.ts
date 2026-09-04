import type {
  CapabilitySet,
  AddTeamWorkItemCommentInput,
  DeleteTeamWorkItemInput,
  ApplicationSettings,
  BrowserConfiguration,
  ApproveToolChangeInput,
  CancelRunInput,
  ConversationContextUsage,
  ConversationContextUsageInput,
  ConversationAttachment,
  ConversationAttachmentPreview,
  ConversationMessageSubmission,
  ConversationPendingMessage,
  ContextCompressionConfiguration,
  ConfigurationWorkspaceDirectoryListing,
  ConfigurationWorkspaceEntry,
  ConfigurationWorkspaceFile,
  CreateSkillDocumentInput,
  CreateConfigurationWorkspaceEntryInput,
  ConversationReferenceInput,
  ConversationSearchInput,
  ConversationSearchResult,
  ForkConversationInput,
  ConversationRunEvent,
  ConversationSummary,
  ConversationTaskList,
  ConversationTimelineItem,
  CreateProjectEntryInput,
  DeleteConfigurationWorkspaceEntryInput,
  CreateConversationInput,
  CreateTeamInstanceInput,
  EnsureTeamMemberConversationInput,
  EnsureTeamInstanceMemberConversationInput,
  DiscoverModelsInput,
  DiscoveredModel,
  IntegrationConfiguration,
  ImportConversationAttachmentBytesInput,
  GitFileDiff,
  GitFileDiffInput,
  GitOperationInput,
  GitReviewInput,
  GitReviewSnapshot,
  ListConfigurationWorkspaceEntriesInput,
  ListProjectEntriesInput,
  ModelConnectionTestResult,
  ModelRuntimeStatus,
  ManagedBrowserBoundsInput,
  ManagedBrowserCommandInput,
  ManagedBrowserEvent,
  ManagedBrowserNavigateInput,
  ManagedBrowserOpenInput,
  ManagedBrowserReferenceInput,
  ManagedBrowserSession,
  ManagedBrowserSnapshot,
  ModelCatalog,
  ProjectDirectoryListing,
  ProjectEntry,
  ProjectFile,
  ProjectPreviewImage,
  ProjectReferenceInput,
  ReadProjectFileInput,
  ReadProjectPreviewImageInput,
  ReadConversationAttachmentPreviewInput,
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
  SetConversationModelSelectionInput,
  SetConversationProjectInput,
  SetConversationPinnedInput,
  SetProjectPinnedInput,
  SetProjectTeamsInNavigatorInput,
  RuntimeInfo,
  RunAccepted,
  SkillDocument,
  SkillDiscoveryResult,
  SkillDocumentReferenceInput,
  SkillDocumentSaveInput,
  TerminalConfiguration,
  TerminalSession,
  TerminalSessionEvent,
  TerminalSessionOpenInput,
  TerminalSessionOutput,
  TerminalSessionOutputInput,
  TerminalSessionReferenceInput,
  TerminalSessionResizeInput,
  TerminalSessionWriteInput,
  WorkspaceTerminalTabOpenRequest,
  WorkspaceTerminalTabOpenedInput,
  WorkspaceTerminalTabCloseRequest,
  WorkspaceBrowserTabOpenRequest,
  WorkspaceBrowserTabOpenedInput,
  WorkspaceBrowserTabCloseRequest,
  WriteConfigurationWorkspaceFileInput,
  WriteProjectFileInput,
  WindowState,
  ListTeamWorkItemsInput,
  PublishTeamWorkItemInput,
  ListTeamInstancesInput,
  RequestTeamWorkItemReworkInput,
  SubmitTeamWorkItemInput,
  UpdateTeamWorkItemInput,
  UpdateTeamWorkItemPermissionInput,
  AcceptTeamWorkItemInput,
  TeamWorkItemExecutionView,
  TeamCollaborationProjection,
  TeamMemberConversationView,
  TeamWorkItemView,
  TeamInstanceReferenceInput,
  TeamInstanceView,
  RenameTeamInstanceInput,
  ReorderTeamInstancesInput,
  SetTeamInstanceArchivedInput,
} from "@agent/protocol";

export type WindowStateListener = (state: WindowState) => void;
export type ConversationRunEventListener = (event: ConversationRunEvent) => void;
export type ApplicationSettingsListener = (settings: ApplicationSettings) => void;
export type TerminalSessionEventListener = (event: TerminalSessionEvent) => void;
export type WorkspaceTerminalTabOpenRequestListener = (request: WorkspaceTerminalTabOpenRequest) => void;
export type WorkspaceTerminalTabCloseRequestListener = (request: WorkspaceTerminalTabCloseRequest) => void;
export type WorkspaceBrowserTabOpenRequestListener = (request: WorkspaceBrowserTabOpenRequest) => void;
export type WorkspaceBrowserTabCloseRequestListener = (request: WorkspaceBrowserTabCloseRequest) => void;
export type ManagedBrowserEventListener = (event: ManagedBrowserEvent) => void;

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
  ensureTeamMemberConversation(
    input: EnsureTeamMemberConversationInput,
  ): Promise<TeamMemberConversationView>;
  listTeamInstances(input: ListTeamInstancesInput): Promise<TeamInstanceView[]>;
  createTeamInstance(input: CreateTeamInstanceInput): Promise<TeamInstanceView>;
  renameTeamInstance(input: RenameTeamInstanceInput): Promise<TeamInstanceView>;
  reorderTeamInstances(input: ReorderTeamInstancesInput): Promise<TeamInstanceView[]>;
  setTeamInstanceArchived(input: SetTeamInstanceArchivedInput): Promise<TeamInstanceView>;
  deleteTeamInstance(input: TeamInstanceReferenceInput): Promise<void>;
  ensureTeamInstanceMemberConversation(
    input: EnsureTeamInstanceMemberConversationInput,
  ): Promise<TeamMemberConversationView>;
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
  importConversationAttachmentBytes(
    input: ImportConversationAttachmentBytesInput,
  ): Promise<ConversationAttachment[]>;
  readConversationAttachmentPreview(
    input: ReadConversationAttachmentPreviewInput,
  ): Promise<ConversationAttachmentPreview>;
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
  getBrowserConfiguration(): Promise<BrowserConfiguration>;
  clearBrowserData(): Promise<void>;
  getTerminalConfiguration(): Promise<TerminalConfiguration>;
  getGitReviewSnapshot(input: GitReviewInput): Promise<GitReviewSnapshot>;
  getGitFileDiff(input: GitFileDiffInput): Promise<GitFileDiff>;
  runGitOperation(input: GitOperationInput): Promise<GitReviewSnapshot>;
  openTerminalSession(input: TerminalSessionOpenInput): Promise<TerminalSession>;
  readTerminalSessionOutput(input: TerminalSessionOutputInput): Promise<TerminalSessionOutput>;
  writeTerminalSession(input: TerminalSessionWriteInput): Promise<void>;
  resizeTerminalSession(input: TerminalSessionResizeInput): Promise<void>;
  closeTerminalSession(input: TerminalSessionReferenceInput): Promise<void>;
  onTerminalSessionEvent(listener: TerminalSessionEventListener): () => void;
  confirmWorkspaceTerminalTabOpened(input: WorkspaceTerminalTabOpenedInput): Promise<void>;
  onWorkspaceTerminalTabOpenRequested(
    listener: WorkspaceTerminalTabOpenRequestListener,
  ): () => void;
  onWorkspaceTerminalTabCloseRequested(
    listener: WorkspaceTerminalTabCloseRequestListener,
  ): () => void;
  confirmWorkspaceBrowserTabOpened(input: WorkspaceBrowserTabOpenedInput): Promise<void>;
  onWorkspaceBrowserTabOpenRequested(listener: WorkspaceBrowserTabOpenRequestListener): () => void;
  onWorkspaceBrowserTabCloseRequested(listener: WorkspaceBrowserTabCloseRequestListener): () => void;
  openManagedBrowser(input: ManagedBrowserOpenInput): Promise<ManagedBrowserSession>;
  navigateManagedBrowser(input: ManagedBrowserNavigateInput): Promise<void>;
  commandManagedBrowser(input: ManagedBrowserCommandInput): Promise<void>;
  captureManagedBrowser(input: ManagedBrowserReferenceInput): Promise<ManagedBrowserSnapshot>;
  setManagedBrowserBounds(input: ManagedBrowserBoundsInput): Promise<void>;
  closeManagedBrowser(input: ManagedBrowserReferenceInput): Promise<void>;
  onManagedBrowserEvent(listener: ManagedBrowserEventListener): () => void;
  getRuntimeInfo(): Promise<RuntimeInfo>;
  getWindowState(): Promise<WindowState>;
  importSkillDocument(): Promise<SkillDocument | null>;
  listConversationTimeline(
    input: ConversationReferenceInput,
  ): Promise<ConversationTimelineItem[]>;
  searchConversations(input: ConversationSearchInput): Promise<ConversationSearchResult[]>;
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
  listTeamWorkItems(input: ListTeamWorkItemsInput): Promise<TeamWorkItemView[]>;
  getTeamWorkItemExecution(workItemId: string): Promise<TeamWorkItemExecutionView>;
  getTeamCollaborationProjection(workItemId: string): Promise<TeamCollaborationProjection>;
  readProjectFile(input: ReadProjectFileInput): Promise<ProjectFile>;
  writeProjectFile(input: WriteProjectFileInput): Promise<ProjectFile>;
  readProjectPreviewImage(input: ReadProjectPreviewImageInput): Promise<ProjectPreviewImage>;
  readConfigurationWorkspaceFile(
    input: ReadConfigurationWorkspaceFileInput,
  ): Promise<ConfigurationWorkspaceFile>;
  removeProject(input: ProjectReferenceInput): Promise<void>;
  submitTeamWorkItem(input: SubmitTeamWorkItemInput): Promise<TeamWorkItemView>;
  updateTeamWorkItem(input: UpdateTeamWorkItemInput): Promise<TeamWorkItemView>;
  deleteTeamWorkItem(input: DeleteTeamWorkItemInput): Promise<void>;
  updateTeamWorkItemPermission(
    input: UpdateTeamWorkItemPermissionInput,
  ): Promise<TeamWorkItemView>;
  publishTeamWorkItem(input: PublishTeamWorkItemInput): Promise<TeamWorkItemView>;
  addTeamWorkItemComment(input: AddTeamWorkItemCommentInput): Promise<TeamWorkItemView>;
  requestTeamWorkItemRework(input: RequestTeamWorkItemReworkInput): Promise<TeamWorkItemView>;
  acceptTeamWorkItem(input: AcceptTeamWorkItemInput): Promise<TeamWorkItemView>;
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
  setConversationModelSelection(
    input: SetConversationModelSelectionInput
  ): Promise<ConversationSummary>;
  setConversationProject(input: SetConversationProjectInput): Promise<ConversationSummary>;
  setConversationPinned(input: SetConversationPinnedInput): Promise<ConversationSummary>;
  setProjectPinned(input: SetProjectPinnedInput): Promise<ProjectSummary>;
  setProjectTeamsInNavigator(
    input: SetProjectTeamsInNavigatorInput,
  ): Promise<ProjectSummary>;
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
  saveBrowserConfiguration(
    input: BrowserConfiguration,
  ): Promise<BrowserConfiguration>;
  saveTerminalConfiguration(
    input: TerminalConfiguration,
  ): Promise<TerminalConfiguration>;
  saveSkillDocument(input: SkillDocumentSaveInput): Promise<SkillDocument>;
  writeConfigurationWorkspaceFile(
    input: WriteConfigurationWorkspaceFileInput,
  ): Promise<ConfigurationWorkspaceFile>;
  toggleMaximizeWindow(): Promise<void>;
}
