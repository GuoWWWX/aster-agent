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
  ConversationSummary,
  ConversationTaskList,
  ConversationTimelineItem,
  CreateProjectEntryInput,
  DeleteConfigurationWorkspaceEntryInput,
  CreateConversationInput,
  CreateTeamInstanceInput,
  EnsureTeamMemberConversationInput,
  EnsureTeamInstanceMemberConversationInput,
  DesktopBridge,
  DiscoverModelsInput,
  DiscoveredModel,
  GitFileDiff,
  GitFileDiffInput,
  GitOperationInput,
  GitReviewInput,
  GitReviewSnapshot,
  IntegrationConfiguration,
  ImportConversationAttachmentBytesInput,
  ListConfigurationWorkspaceEntriesInput,
  ListProjectEntriesInput,
  ModelConnectionTestResult,
  ModelCatalog,
  ModelRuntimeStatus,
  ManagedBrowserBoundsInput,
  ManagedBrowserCommandInput,
  ManagedBrowserNavigateInput,
  ManagedBrowserOpenInput,
  ManagedBrowserReferenceInput,
  ManagedBrowserSession,
  ManagedBrowserSnapshot,
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
  RenameConversationInput,
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

import type {
  AgentClient,
  ConversationRunEventListener,
  ManagedBrowserEventListener,
  TerminalSessionEventListener,
  WorkspaceTerminalTabOpenRequestListener,
  WorkspaceTerminalTabCloseRequestListener,
  WorkspaceBrowserTabOpenRequestListener,
  WorkspaceBrowserTabCloseRequestListener,
  WindowStateListener,
} from "./agent-client.js";

/**
 * Adapts the narrow preload API to the renderer runtime port. It has no React
 * dependency and keeps host-specific globals outside UI components.
 */
export class DesktopAgentClientAdapter implements AgentClient {
  private readonly conversationRunEventListeners = new Set<ConversationRunEventListener>();
  private disposeConversationRunEventBridge: (() => void) | null = null;

  public constructor(private readonly desktopBridge: DesktopBridge) {}

  public addProject(): Promise<ProjectSummary | null> {
    return this.desktopBridge.addProject();
  }

  public createProjectEntry(input: CreateProjectEntryInput): Promise<ProjectEntry> {
    return this.desktopBridge.createProjectEntry(input);
  }

  public createConfigurationWorkspaceEntry(
    input: CreateConfigurationWorkspaceEntryInput,
  ): Promise<ConfigurationWorkspaceEntry> {
    return this.desktopBridge.createConfigurationWorkspaceEntry(input);
  }

  public approveToolChange(input: ApproveToolChangeInput): Promise<void> {
    return this.desktopBridge.approveToolChange(input);
  }

  public cancelRun(input: CancelRunInput): Promise<void> {
    return this.desktopBridge.cancelRun(input);
  }

  public closeWindow(): Promise<void> {
    return this.desktopBridge.closeWindow();
  }

  public writeClipboardText(text: string): Promise<void> {
    return this.desktopBridge.writeClipboardText(text);
  }

  public createConversation(
    input: CreateConversationInput,
  ): Promise<ConversationSummary> {
    return this.desktopBridge.createConversation(input);
  }

  public listTeamInstances(input: ListTeamInstancesInput): Promise<TeamInstanceView[]> {
    return this.desktopBridge.listTeamInstances(input);
  }

  public createTeamInstance(input: CreateTeamInstanceInput): Promise<TeamInstanceView> {
    return this.desktopBridge.createTeamInstance(input);
  }

  public renameTeamInstance(input: RenameTeamInstanceInput): Promise<TeamInstanceView> {
    return this.desktopBridge.renameTeamInstance(input);
  }

  public reorderTeamInstances(input: ReorderTeamInstancesInput): Promise<TeamInstanceView[]> {
    return this.desktopBridge.reorderTeamInstances(input);
  }

  public setTeamInstanceArchived(input: SetTeamInstanceArchivedInput): Promise<TeamInstanceView> {
    return this.desktopBridge.setTeamInstanceArchived(input);
  }

  public deleteTeamInstance(input: TeamInstanceReferenceInput): Promise<void> {
    return this.desktopBridge.deleteTeamInstance(input);
  }

  public ensureTeamInstanceMemberConversation(
    input: EnsureTeamInstanceMemberConversationInput,
  ): Promise<TeamMemberConversationView> {
    return this.desktopBridge.ensureTeamInstanceMemberConversation(input);
  }

  public ensureTeamMemberConversation(
    input: EnsureTeamMemberConversationInput,
  ): Promise<TeamMemberConversationView> {
    return this.desktopBridge.ensureTeamMemberConversation(input);
  }

  public selectConversationWorkspace(
    input: ConversationReferenceInput,
  ): Promise<ConversationSummary | null> {
    return this.desktopBridge.selectConversationWorkspace(input);
  }

  public clearConversationWorkspace(
    input: ConversationReferenceInput,
  ): Promise<ConversationSummary> {
    return this.desktopBridge.clearConversationWorkspace(input);
  }

  public forkConversation(
    input: ForkConversationInput,
  ): Promise<ConversationSummary> {
    return this.desktopBridge.forkConversation(input);
  }

  public getConversationContextUsage(
    input: ConversationContextUsageInput,
  ): Promise<ConversationContextUsage> {
    return this.desktopBridge.getConversationContextUsage(input);
  }

  public chooseConversationAttachments(
    input: ConversationReferenceInput,
  ): Promise<ConversationAttachment[]> {
    return this.desktopBridge.chooseConversationAttachments(input);
  }

  public importConversationAttachmentBytes(
    input: ImportConversationAttachmentBytesInput,
  ): Promise<ConversationAttachment[]> {
    return this.desktopBridge.importConversationAttachmentBytes(input);
  }

  public readConversationAttachmentPreview(
    input: ReadConversationAttachmentPreviewInput,
  ): Promise<ConversationAttachmentPreview> {
    return this.desktopBridge.readConversationAttachmentPreview(input);
  }

  public listDraftConversationAttachments(
    input: ConversationReferenceInput,
  ): Promise<ConversationAttachment[]> {
    return this.desktopBridge.listDraftConversationAttachments(input);
  }

  public removeConversationAttachment(
    input: RemoveConversationAttachmentInput,
  ): Promise<void> {
    return this.desktopBridge.removeConversationAttachment(input);
  }

  public getConversationTaskList(
    input: ConversationReferenceInput,
  ): Promise<ConversationTaskList | null> {
    return this.desktopBridge.getConversationTaskList(input);
  }

  public closeConversationTaskList(
    input: ConversationReferenceInput,
  ): Promise<void> {
    return this.desktopBridge.closeConversationTaskList(input);
  }

  public deleteConversationTaskList(input: ConversationReferenceInput): Promise<void> {
    return this.desktopBridge.deleteConversationTaskList(input);
  }

  public chooseSkillDirectory(): Promise<SkillDiscoveryResult | null> {
    return this.desktopBridge.chooseSkillDirectory();
  }

  public createSkillDocument(input?: CreateSkillDocumentInput): Promise<SkillDocument> {
    return this.desktopBridge.createSkillDocument(input);
  }

  public discoverSkillDocuments(): Promise<SkillDiscoveryResult> {
    return this.desktopBridge.discoverSkillDocuments();
  }

  public deleteConversation(input: ConversationReferenceInput): Promise<void> {
    return this.desktopBridge.deleteConversation(input);
  }

  public deleteConfigurationWorkspaceEntry(
    input: DeleteConfigurationWorkspaceEntryInput,
  ): Promise<void> {
    return this.desktopBridge.deleteConfigurationWorkspaceEntry(input);
  }

  public discoverModels(input: DiscoverModelsInput): Promise<DiscoveredModel[]> {
    return this.desktopBridge.discoverModels(input);
  }

  public testModelConnection(input: TestModelConnectionInput): Promise<ModelConnectionTestResult> {
    return this.desktopBridge.testModelConnection(input);
  }

  public getCapabilities(): Promise<CapabilitySet> {
    return this.desktopBridge
      .getRuntimeInfo()
      .then((runtimeInfo) => runtimeInfo.capabilities);
  }

  public getModelApiKey(providerId: string): Promise<string | null> {
    return this.desktopBridge.getModelApiKey(providerId);
  }

  public getModelCatalog(): Promise<ModelCatalog> {
    return this.desktopBridge.getModelCatalog();
  }

  public getModelStatus(): Promise<ModelRuntimeStatus> {
    return this.desktopBridge.getModelStatus();
  }

  public getContextCompressionConfiguration(): Promise<ContextCompressionConfiguration> {
    return this.desktopBridge.getContextCompressionConfiguration();
  }

  public getApplicationSettings(): Promise<ApplicationSettings> {
    return this.desktopBridge.getApplicationSettings();
  }

  public getIntegrationConfiguration(): Promise<IntegrationConfiguration> {
    return this.desktopBridge.getIntegrationConfiguration();
  }

  public getBrowserConfiguration(): Promise<BrowserConfiguration> {
    return this.desktopBridge.getBrowserConfiguration();
  }

  public clearBrowserData(): Promise<void> {
    return this.desktopBridge.clearBrowserData();
  }

  public getTerminalConfiguration(): Promise<TerminalConfiguration> {
    return this.desktopBridge.getTerminalConfiguration();
  }

  public getGitReviewSnapshot(input: GitReviewInput): Promise<GitReviewSnapshot> {
    return this.desktopBridge.getGitReviewSnapshot(input);
  }

  public getGitFileDiff(input: GitFileDiffInput): Promise<GitFileDiff> {
    return this.desktopBridge.getGitFileDiff(input);
  }

  public runGitOperation(input: GitOperationInput): Promise<GitReviewSnapshot> {
    return this.desktopBridge.runGitOperation(input);
  }

  public openTerminalSession(input: TerminalSessionOpenInput): Promise<TerminalSession> {
    return this.desktopBridge.openTerminalSession(input);
  }

  public readTerminalSessionOutput(input: TerminalSessionOutputInput): Promise<TerminalSessionOutput> {
    return this.desktopBridge.readTerminalSessionOutput(input);
  }

  public writeTerminalSession(input: TerminalSessionWriteInput): Promise<void> {
    return this.desktopBridge.writeTerminalSession(input);
  }

  public resizeTerminalSession(input: TerminalSessionResizeInput): Promise<void> {
    return this.desktopBridge.resizeTerminalSession(input);
  }

  public closeTerminalSession(input: TerminalSessionReferenceInput): Promise<void> {
    return this.desktopBridge.closeTerminalSession(input);
  }

  public onTerminalSessionEvent(listener: TerminalSessionEventListener): () => void {
    return this.desktopBridge.onTerminalSessionEvent(listener);
  }

  public confirmWorkspaceTerminalTabOpened(input: WorkspaceTerminalTabOpenedInput): Promise<void> {
    return this.desktopBridge.confirmWorkspaceTerminalTabOpened(input);
  }

  public onWorkspaceTerminalTabOpenRequested(
    listener: WorkspaceTerminalTabOpenRequestListener,
  ): () => void {
    return this.desktopBridge.onWorkspaceTerminalTabOpenRequested(listener);
  }

  public onWorkspaceTerminalTabCloseRequested(
    listener: WorkspaceTerminalTabCloseRequestListener,
  ): () => void {
    return this.desktopBridge.onWorkspaceTerminalTabCloseRequested(listener);
  }

  public confirmWorkspaceBrowserTabOpened(input: WorkspaceBrowserTabOpenedInput): Promise<void> {
    return this.desktopBridge.confirmWorkspaceBrowserTabOpened(input);
  }

  public onWorkspaceBrowserTabOpenRequested(
    listener: WorkspaceBrowserTabOpenRequestListener,
  ): () => void {
    return this.desktopBridge.onWorkspaceBrowserTabOpenRequested(listener);
  }

  public onWorkspaceBrowserTabCloseRequested(
    listener: WorkspaceBrowserTabCloseRequestListener,
  ): () => void {
    return this.desktopBridge.onWorkspaceBrowserTabCloseRequested(listener);
  }

  public openManagedBrowser(input: ManagedBrowserOpenInput): Promise<ManagedBrowserSession> {
    return this.desktopBridge.openManagedBrowser(input);
  }

  public navigateManagedBrowser(input: ManagedBrowserNavigateInput): Promise<void> {
    return this.desktopBridge.navigateManagedBrowser(input);
  }

  public commandManagedBrowser(input: ManagedBrowserCommandInput): Promise<void> {
    return this.desktopBridge.commandManagedBrowser(input);
  }

  public captureManagedBrowser(input: ManagedBrowserReferenceInput): Promise<ManagedBrowserSnapshot> {
    return this.desktopBridge.captureManagedBrowser(input);
  }

  public setManagedBrowserBounds(input: ManagedBrowserBoundsInput): Promise<void> {
    return this.desktopBridge.setManagedBrowserBounds(input);
  }

  public closeManagedBrowser(input: ManagedBrowserReferenceInput): Promise<void> {
    return this.desktopBridge.closeManagedBrowser(input);
  }

  public onManagedBrowserEvent(listener: ManagedBrowserEventListener): () => void {
    return this.desktopBridge.onManagedBrowserEvent(listener);
  }

  public getRuntimeInfo(): Promise<RuntimeInfo> {
    return this.desktopBridge.getRuntimeInfo();
  }

  public getWindowState(): Promise<WindowState> {
    return this.desktopBridge.getWindowState();
  }

  public importSkillDocument(): Promise<SkillDocument | null> {
    return this.desktopBridge.importSkillDocument();
  }

  public listConversationTimeline(
    input: ConversationReferenceInput,
  ): Promise<ConversationTimelineItem[]> {
    return this.desktopBridge.listConversationTimeline(input);
  }

  public searchConversations(input: ConversationSearchInput): Promise<ConversationSearchResult[]> {
    return this.desktopBridge.searchConversations(input);
  }

  public listConversationPendingMessages(
    input: ConversationReferenceInput,
  ): Promise<ConversationPendingMessage[]> {
    return this.desktopBridge.listConversationPendingMessages(input);
  }

  public listConversations(): Promise<ConversationSummary[]> {
    return this.desktopBridge.listConversations();
  }

  public listConversationForks(
    input: ConversationReferenceInput,
  ): Promise<ConversationSummary[]> {
    return this.desktopBridge.listConversationForks(input);
  }

  public markConversationResultViewed(
    input: ConversationReferenceInput,
  ): Promise<ConversationSummary> {
    return this.desktopBridge.markConversationResultViewed(input);
  }

  public listProjectEntries(
    input: ListProjectEntriesInput,
  ): Promise<ProjectDirectoryListing> {
    return this.desktopBridge.listProjectEntries(input);
  }

  public listConfigurationWorkspaceEntries(
    input: ListConfigurationWorkspaceEntriesInput,
  ): Promise<ConfigurationWorkspaceDirectoryListing> {
    return this.desktopBridge.listConfigurationWorkspaceEntries(input);
  }

  public listProjects(): Promise<ProjectSummary[]> {
    return this.desktopBridge.listProjects();
  }

  public listTeamWorkItems(input: ListTeamWorkItemsInput): Promise<TeamWorkItemView[]> {
    return this.desktopBridge.listTeamWorkItems(input);
  }

  public getTeamWorkItemExecution(workItemId: string): Promise<TeamWorkItemExecutionView> {
    return this.desktopBridge.getTeamWorkItemExecution({ workItemId });
  }

  public getTeamCollaborationProjection(workItemId: string): Promise<TeamCollaborationProjection> {
    return this.desktopBridge.getTeamCollaborationProjection({ workItemId });
  }

  public submitTeamWorkItem(input: SubmitTeamWorkItemInput): Promise<TeamWorkItemView> {
    return this.desktopBridge.submitTeamWorkItem(input);
  }

  public updateTeamWorkItem(input: UpdateTeamWorkItemInput): Promise<TeamWorkItemView> {
    return this.desktopBridge.updateTeamWorkItem(input);
  }

  public deleteTeamWorkItem(input: DeleteTeamWorkItemInput): Promise<void> {
    return this.desktopBridge.deleteTeamWorkItem(input);
  }

  public updateTeamWorkItemPermission(
    input: UpdateTeamWorkItemPermissionInput,
  ): Promise<TeamWorkItemView> {
    return this.desktopBridge.updateTeamWorkItemPermission(input);
  }

  public publishTeamWorkItem(input: PublishTeamWorkItemInput): Promise<TeamWorkItemView> {
    return this.desktopBridge.publishTeamWorkItem(input);
  }

  public addTeamWorkItemComment(
    input: AddTeamWorkItemCommentInput,
  ): Promise<TeamWorkItemView> {
    return this.desktopBridge.addTeamWorkItemComment(input);
  }

  public requestTeamWorkItemRework(
    input: RequestTeamWorkItemReworkInput,
  ): Promise<TeamWorkItemView> {
    return this.desktopBridge.requestTeamWorkItemRework(input);
  }

  public acceptTeamWorkItem(input: AcceptTeamWorkItemInput): Promise<TeamWorkItemView> {
    return this.desktopBridge.acceptTeamWorkItem(input);
  }

  public readProjectFile(input: ReadProjectFileInput): Promise<ProjectFile> {
    return this.desktopBridge.readProjectFile(input);
  }

  public writeProjectFile(input: WriteProjectFileInput): Promise<ProjectFile> {
    return this.desktopBridge.writeProjectFile(input);
  }

  public readProjectPreviewImage(
    input: ReadProjectPreviewImageInput,
  ): Promise<ProjectPreviewImage> {
    return this.desktopBridge.readProjectPreviewImage(input);
  }

  public readConfigurationWorkspaceFile(
    input: ReadConfigurationWorkspaceFileInput,
  ): Promise<ConfigurationWorkspaceFile> {
    return this.desktopBridge.readConfigurationWorkspaceFile(input);
  }

  public removeProject(input: ProjectReferenceInput): Promise<void> {
    return this.desktopBridge.removeProject(input);
  }

  public minimizeWindow(): Promise<void> {
    return this.desktopBridge.minimizeWindow();
  }

  public onConversationRunEvent(
    listener: ConversationRunEventListener,
  ): () => void {
    this.conversationRunEventListeners.add(listener);
    this.disposeConversationRunEventBridge ??= this.desktopBridge.onConversationRunEvent((event) => {
      for (const currentListener of [...this.conversationRunEventListeners]) {
        currentListener(event);
      }
    });

    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      this.conversationRunEventListeners.delete(listener);
      if (this.conversationRunEventListeners.size === 0) {
        this.disposeConversationRunEventBridge?.();
        this.disposeConversationRunEventBridge = null;
      }
    };
  }

  public onApplicationSettingsChanged(
    listener: (settings: ApplicationSettings) => void,
  ): () => void {
    return this.desktopBridge.onApplicationSettingsChanged(listener);
  }

  public onWindowStateChanged(listener: WindowStateListener): () => void {
    return this.desktopBridge.onWindowStateChanged(listener);
  }

  public renameConversation(
    input: RenameConversationInput,
  ): Promise<ConversationSummary> {
    return this.desktopBridge.renameConversation(input);
  }

  public setConversationProject(
    input: SetConversationProjectInput,
  ): Promise<ConversationSummary> {
    return this.desktopBridge.setConversationProject(input);
  }

  public setConversationModelSelection(
    input: SetConversationModelSelectionInput,
  ): Promise<ConversationSummary> {
    return this.desktopBridge.setConversationModelSelection(input);
  }

  public renameProject(input: RenameProjectInput): Promise<ProjectSummary> {
    return this.desktopBridge.renameProject(input);
  }

  public reorderConversations(
    input: ReorderConversationsInput,
  ): Promise<ConversationSummary[]> {
    return this.desktopBridge.reorderConversations(input);
  }

  public reorderProjects(input: ReorderProjectsInput): Promise<ProjectSummary[]> {
    return this.desktopBridge.reorderProjects(input);
  }

  public setConversationArchived(
    input: SetConversationArchivedInput,
  ): Promise<ConversationSummary> {
    return this.desktopBridge.setConversationArchived(input);
  }

  public setConversationPinned(
    input: SetConversationPinnedInput,
  ): Promise<ConversationSummary> {
    return this.desktopBridge.setConversationPinned(input);
  }

  public setProjectPinned(input: SetProjectPinnedInput): Promise<ProjectSummary> {
    return this.desktopBridge.setProjectPinned(input);
  }

  public setProjectTeamsInNavigator(
    input: SetProjectTeamsInNavigatorInput,
  ): Promise<ProjectSummary> {
    return this.desktopBridge.setProjectTeamsInNavigator(input);
  }

  public readSkillDocument(input: SkillDocumentReferenceInput): Promise<SkillDocument> {
    return this.desktopBridge.readSkillDocument(input);
  }

  public sendConversationMessage(
    input: SendConversationMessageInput,
  ): Promise<ConversationMessageSubmission> {
    return this.desktopBridge.sendConversationMessage(input);
  }

  public replaceLatestConversationMessage(
    input: ReplaceLatestConversationMessageInput,
  ): Promise<RunAccepted> {
    return this.desktopBridge.replaceLatestConversationMessage(input);
  }

  public promoteConversationPendingMessage(
    input: PendingConversationMessageReferenceInput,
  ): Promise<ConversationPendingMessage[]> {
    return this.desktopBridge.promoteConversationPendingMessage(input);
  }

  public deleteConversationPendingMessage(
    input: PendingConversationMessageReferenceInput,
  ): Promise<ConversationPendingMessage[]> {
    return this.desktopBridge.deleteConversationPendingMessage(input);
  }

  public updateConversationPendingMessage(
    input: UpdatePendingConversationMessageInput,
  ): Promise<ConversationPendingMessage[]> {
    return this.desktopBridge.updateConversationPendingMessage(input);
  }

  public reorderConversationPendingMessages(
    input: ReorderPendingConversationMessagesInput,
  ): Promise<ConversationPendingMessage[]> {
    return this.desktopBridge.reorderConversationPendingMessages(input);
  }

  public saveModelConfiguration(
    input: SaveModelConfigurationInput,
  ): Promise<ModelRuntimeStatus> {
    return this.desktopBridge.saveModelConfiguration(input);
  }

  public setDefaultModel(input: SetDefaultModelInput): Promise<ModelRuntimeStatus> {
    return this.desktopBridge.setDefaultModel(input);
  }

  public saveContextCompressionConfiguration(
    input: ContextCompressionConfiguration,
  ): Promise<ContextCompressionConfiguration> {
    return this.desktopBridge.saveContextCompressionConfiguration(input);
  }

  public saveApplicationSettings(input: ApplicationSettings): Promise<ApplicationSettings> {
    return this.desktopBridge.saveApplicationSettings(input);
  }

  public saveIntegrationConfiguration(
    input: IntegrationConfiguration,
  ): Promise<IntegrationConfiguration> {
    return this.desktopBridge.saveIntegrationConfiguration(input);
  }

  public saveBrowserConfiguration(
    input: BrowserConfiguration,
  ): Promise<BrowserConfiguration> {
    return this.desktopBridge.saveBrowserConfiguration(input);
  }

  public saveTerminalConfiguration(
    input: TerminalConfiguration,
  ): Promise<TerminalConfiguration> {
    return this.desktopBridge.saveTerminalConfiguration(input);
  }

  public saveSkillDocument(input: SkillDocumentSaveInput): Promise<SkillDocument> {
    return this.desktopBridge.saveSkillDocument(input);
  }

  public writeConfigurationWorkspaceFile(
    input: WriteConfigurationWorkspaceFileInput,
  ): Promise<ConfigurationWorkspaceFile> {
    return this.desktopBridge.writeConfigurationWorkspaceFile(input);
  }

  public toggleMaximizeWindow(): Promise<void> {
    return this.desktopBridge.toggleMaximizeWindow();
  }
}
