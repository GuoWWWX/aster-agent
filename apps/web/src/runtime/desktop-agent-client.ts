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
  ConversationSummary,
  ConversationTaskList,
  ConversationTimelineItem,
  CreateProjectEntryInput,
  DeleteConfigurationWorkspaceEntryInput,
  CreateConversationInput,
  DesktopBridge,
  DiscoverModelsInput,
  DiscoveredModel,
  IntegrationConfiguration,
  ListConfigurationWorkspaceEntriesInput,
  ListProjectEntriesInput,
  ModelConnectionTestResult,
  ModelCatalog,
  ModelRuntimeStatus,
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
  ListTeamWorkItemsInput,
  RequestTeamWorkItemReworkInput,
  SubmitTeamWorkItemInput,
  AcceptTeamWorkItemInput,
  TeamWorkItemView,
} from "@agent/protocol";

import type {
  AgentClient,
  ConversationRunEventListener,
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

  public getTerminalConfiguration(): Promise<TerminalConfiguration> {
    return this.desktopBridge.getTerminalConfiguration();
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

  public submitTeamWorkItem(input: SubmitTeamWorkItemInput): Promise<TeamWorkItemView> {
    return this.desktopBridge.submitTeamWorkItem(input);
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
