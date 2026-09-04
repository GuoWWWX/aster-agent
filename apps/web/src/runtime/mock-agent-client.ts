import {
  createSkillMarkdown,
  DEFAULT_BROWSER_CONFIGURATION,
  DEFAULT_APPLICATION_SETTINGS,
  CONTEXT_MESSAGE_OVERHEAD_TOKENS,
  DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  DEFAULT_MODEL_CATALOG,
  DEFAULT_TERMINAL_CONFIGURATION,
  estimateContextTokens,
  isReasoningOptionEnabled,
  modelReasoningOptionKey,
  mcpServerConfigurationSchema,
  parseSkillMarkdown,
  resolveContextCompressionThresholdTokens,
  type CreateSkillDocumentInput,
  type SkillDocument,
  type SkillDiscoveryResult,
  type ApplicationSettings,
  type AddTeamWorkItemCommentInput,
  type DeleteTeamWorkItemInput,
  type BrowserConfiguration,
  type SkillDocumentReferenceInput,
  type SkillDocumentSaveInput,
  type TerminalConfiguration,
  type CapabilitySet,
  type ApproveToolChangeInput,
  type CancelRunInput,
  type ConversationReferenceInput,
  type ConversationSearchInput,
  type ConversationSearchResult,
  type ForkConversationInput,
  type ConversationRunEvent,
  type ConversationContextUsage,
  type ConversationContextUsageInput,
  type ConversationAttachment,
  type ConversationAttachmentPreview,
  type ConversationMessageSubmission,
  type ConversationPendingMessage,
  type ConfigurationWorkspaceDirectoryListing,
  type ConfigurationWorkspaceEntry,
  type ConfigurationWorkspaceFile,
  type ContextCompressionConfiguration,
  type ConfigurationWorkspaceKind,
  type ConversationSummary,
  type ConversationTaskList,
  type ConversationTimelineItem,
  type CreateProjectEntryInput,
  type CreateConfigurationWorkspaceEntryInput,
  type CreateConversationInput,
  type CreateTeamInstanceInput,
  type EnsureTeamMemberConversationInput,
  type EnsureTeamInstanceMemberConversationInput,
  type DiscoverModelsInput,
  type DiscoveredModel,
  type GitReviewSnapshot,
  type IntegrationConfiguration,
  type ImportConversationAttachmentBytesInput,
  type DeleteConfigurationWorkspaceEntryInput,
  type ListConfigurationWorkspaceEntriesInput,
  type ListProjectEntriesInput,
  type ModelConnectionTestResult,
  type ModelCatalog,
  type ModelRuntimeStatus,
  type ManagedBrowserSession,
  type ManagedBrowserSnapshot,
  type McpServerConfiguration,
  type ModelProfile,
  type ProjectDirectoryListing,
  type ProjectEntry,
  type ProjectFile,
  type ProjectPreviewImage,
  type ProjectReferenceInput,
  type ReadProjectFileInput,
  type ReadConfigurationWorkspaceFileInput,
  type ReorderConversationsInput,
  type ReplaceLatestConversationMessageInput,
  type ReorderProjectsInput,
  type RemoveConversationAttachmentInput,
  type ProjectSummary,
  type RenameConversationInput,
  type RenameProjectInput,
  type PendingConversationMessageReferenceInput,
  type ReorderPendingConversationMessagesInput,
  type SaveModelConfigurationInput,
  type TestModelConnectionInput,
  type SetDefaultModelInput,
  type SendConversationMessageInput,
  type UpdatePendingConversationMessageInput,
  type SetConversationArchivedInput,
  type SetConversationModelSelectionInput,
  type SetConversationProjectInput,
  type SetConversationPinnedInput,
  type SetProjectPinnedInput,
  type SetProjectTeamsInNavigatorInput,
  type RuntimeInfo,
  type RunAccepted,
  type TerminalSession,
  type TerminalSessionOutput,
  type WindowState,
  type WriteConfigurationWorkspaceFileInput,
  type WriteProjectFileInput,
  type ListTeamWorkItemsInput,
  type PublishTeamWorkItemInput,
  type ListTeamInstancesInput,
  type RequestTeamWorkItemReworkInput,
  type SubmitTeamWorkItemInput,
  type UpdateTeamWorkItemInput,
  type UpdateTeamWorkItemPermissionInput,
  type AcceptTeamWorkItemInput,
  type TeamWorkItemExecutionView,
  type TeamCollaborationProjection,
  type TeamMemberConversationView,
  type TeamWorkItemView,
  type RenameTeamInstanceInput,
  type ReorderTeamInstancesInput,
  type SetTeamInstanceArchivedInput,
  type TeamInstanceReferenceInput,
  type TeamInstanceView,
} from "@agent/protocol";

import type {
  AgentClient,
  ApplicationSettingsListener,
  ConversationRunEventListener,
  WindowStateListener,
} from "./agent-client.js";

const MOCK_CAPABILITIES: CapabilitySet = {
  docxConversion: false,
  fileWrite: false,
  git: false,
  managedBrowser: false,
  mcp: false,
  mode: "mock",
  process: false,
  pty: false,
  skills: false,
  workspace: false,
};

const DEFAULT_RUNTIME_INFO: RuntimeInfo = {
  appVersion: "0.1.0",
  capabilities: MOCK_CAPABILITIES,
  platform: "win32",
};

const DEFAULT_WINDOW_STATE: WindowState = {
  isFocused: true,
  isFullScreen: false,
  isMaximized: false,
};

const MOCK_MODEL_STATUS: ModelRuntimeStatus = {
  baseUrl: null,
  configured: false,
  modelId: null,
  models: [],
  providerId: null,
  recentSelection: null,
  supportsStreaming: false,
  supportsTools: false,
};

const MOCK_RESPONSE_DELAY_MS = 800;

const MOCK_PROJECT: ProjectSummary = {
  id: "00000000-0000-4000-8000-000000000001",
  isPinned: false,
  name: "Aster",
  rootPath: "D:\\Code\\Project\\202608\\Agent",
};

const MOCK_ENTRIES_BY_DIRECTORY: Readonly<Record<string, readonly ProjectEntry[]>> = {
  "": [
    { kind: "directory", name: "apps", path: "apps" },
    { kind: "directory", name: "doc", path: "doc" },
    { kind: "directory", name: "packages", path: "packages" },
    { kind: "file", name: ".editorconfig", path: ".editorconfig" },
    { kind: "file", name: "package.json", path: "package.json" },
  ],
  apps: [
    { kind: "directory", name: "desktop", path: "apps/desktop" },
    { kind: "directory", name: "web", path: "apps/web" },
  ],
  "apps/web": [
    { kind: "directory", name: "src", path: "apps/web/src" },
    { kind: "file", name: "vite.config.ts", path: "apps/web/vite.config.ts" },
  ],
  doc: [
    {
      kind: "file",
      name: "00-AI-Agent产品与技术方案总览.md",
      path: "doc/00-AI-Agent产品与技术方案总览.md",
    },
    {
      kind: "file",
      name: "01-第一阶段需求与验收标准.md",
      path: "doc/01-第一阶段需求与验收标准.md",
    },
  ],
  packages: [
    { kind: "directory", name: "protocol", path: "packages/protocol" },
  ],
};

const MOCK_FILE_CONTENTS: Readonly<Record<string, string>> = {
  ".editorconfig": "root = true\n\n[*]\ncharset = utf-8\nindent_style = space\n",
  "package.json": '{\n  "name": "aster",\n  "private": true\n}\n',
  "apps/web/vite.config.ts": 'import { defineConfig } from "vite";\n\nexport default defineConfig({});\n',
  "doc/00-AI-Agent产品与技术方案总览.md": "# AI Agent 产品与技术方案总览\n",
  "doc/01-第一阶段需求与验收标准.md": "# 第一阶段需求与验收标准\n"
};

type MockRun = {
  conversationId: string;
  modelId: string;
  timeout: ReturnType<typeof setTimeout> | null;
};

type MockConfigurationWorkspace = {
  directories: Set<string>;
  files: Map<string, string>;
};

function createMockUuid(sequence: number): string {
  return `00000000-0000-4000-8000-${sequence.toString().padStart(12, "0")}`;
}

function createConversationTitle(content: string): string {
  const title = content.trim().replaceAll(/\s+/g, " ").slice(0, 36);
  return title.length > 0 ? title : "新会话";
}

function resolveMockForkBoundary(
  timeline: readonly ConversationTimelineItem[],
  throughMessageId: string,
): number {
  const index = timeline.findIndex((item) => item.id === throughMessageId);
  const message = timeline[index];
  if (
    index < 0
    || message?.kind !== "message"
    || message.role !== "assistant"
    || message.status !== "completed"
  ) {
    throw new Error("A mock conversation can only be forked from a completed assistant message.");
  }
  return index;
}

/**
 * Browser fallback used before a desktop preload bridge is available. It is a
 * deterministic fixture, not a substitute for a persistent runtime.
 */
export class MockAgentClient implements AgentClient {
  private readonly activeRuns = new Map<string, MockRun>();

  private readonly conversationListeners = new Set<ConversationRunEventListener>();

  private readonly applicationSettingsListeners = new Set<ApplicationSettingsListener>();

  private readonly conversations: ConversationSummary[] = [];

  private readonly projectEntriesByDirectory = new Map<string, ProjectEntry[]>(
    Object.entries(MOCK_ENTRIES_BY_DIRECTORY).map(([directoryPath, entries]) => [
      directoryPath,
      entries.map((entry) => ({ ...entry })),
    ]),
  );

  private readonly projectFileContents = new Map<string, string>(
    Object.entries(MOCK_FILE_CONTENTS),
  );

  private project: ProjectSummary | null = { ...MOCK_PROJECT };

  private readonly conversationParents = new Map<string, string>();

  private readonly inheritedTimelines = new Map<string, ConversationTimelineItem[]>();

  private readonly timelines = new Map<string, ConversationTimelineItem[]>();

  private readonly pendingMessages = new Map<string, ConversationPendingMessage[]>();

  private readonly taskLists = new Map<string, ConversationTaskList>();

  private readonly teamWorkItems: TeamWorkItemView[] = [];

  private readonly teamInstances: TeamInstanceView[] = [];

  private readonly skillDocuments = new Map<string, SkillDocument>();

  private readonly configurationWorkspaces = new Map<string, MockConfigurationWorkspace>();

  private nextIdentifier = 1;

  private readonly runtimeInfo: RuntimeInfo;

  private modelStatus: ModelRuntimeStatus = { ...MOCK_MODEL_STATUS };

  private integrationConfiguration: IntegrationConfiguration = {
    mcpServers: [],
    skillDirectories: [],
    skills: [],
    version: 1,
  };

  private terminalConfiguration: TerminalConfiguration = structuredClone(
    DEFAULT_TERMINAL_CONFIGURATION,
  );

  private browserConfiguration: BrowserConfiguration = structuredClone(
    DEFAULT_BROWSER_CONFIGURATION,
  );

  private contextCompressionConfiguration: ContextCompressionConfiguration = structuredClone(
    DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  );

  private applicationSettings: ApplicationSettings = structuredClone(
    DEFAULT_APPLICATION_SETTINGS,
  );

  private readonly modelApiKeys = new Map<string, string>();

  private nextProviderIdentifier = 1;

  private windowState: WindowState;

  public constructor(
    runtimeInfo: RuntimeInfo = DEFAULT_RUNTIME_INFO,
    windowState: WindowState = DEFAULT_WINDOW_STATE,
  ) {
    this.runtimeInfo = {
      ...runtimeInfo,
      capabilities: { ...runtimeInfo.capabilities },
    };
    this.windowState = { ...windowState };
  }

  public addProject(): Promise<ProjectSummary | null> {
    return Promise.reject(
      new Error("Project selection is unavailable in the mock host."),
    );
  }

  public createProjectEntry(input: CreateProjectEntryInput): Promise<ProjectEntry> {
    if (input.projectId !== this.project?.id) {
      return Promise.reject(new Error("The mock project is unavailable."));
    }
    const segments = input.path.split("/");
    const name = segments.pop() ?? "";
    const directoryPath = segments.join("/");
    const directoryExists = directoryPath.length === 0
      || [...this.projectEntriesByDirectory.values()].some((entries) =>
        entries.some((entry) => entry.kind === "directory" && entry.path === directoryPath)
      );
    const entryExists = [...this.projectEntriesByDirectory.values()].some((entries) =>
      entries.some((entry) => entry.path === input.path)
    );
    if (!directoryExists || entryExists) {
      return Promise.reject(new Error("The mock project entry cannot be created."));
    }
    const entry: ProjectEntry = { kind: input.kind, name, path: input.path };
    const entries = this.projectEntriesByDirectory.get(directoryPath) ?? [];
    this.projectEntriesByDirectory.set(directoryPath, [...entries, entry]);
    if (input.kind === "directory") {
      this.projectEntriesByDirectory.set(input.path, []);
    } else {
      this.projectFileContents.set(input.path, "");
    }
    return Promise.resolve({ ...entry });
  }

  public approveToolChange(input: ApproveToolChangeInput): Promise<void> {
    void input;
    return Promise.reject(new Error("File changes are unavailable in the mock host."));
  }

  public cancelRun(input: CancelRunInput): Promise<void> {
    const activeRun = this.activeRuns.get(input.runId);
    if (activeRun === undefined) {
      return Promise.resolve();
    }

    if (activeRun.timeout !== null) {
      clearTimeout(activeRun.timeout);
    }
    this.activeRuns.delete(input.runId);
    const conversation = this.conversations.find(
      (candidate) => candidate.id === activeRun.conversationId,
    );
    if (conversation !== undefined) {
      conversation.activeRunId = null;
      conversation.lastRunStatus = "cancelled";
      conversation.hasUnreadResult = false;
    }
    this.emitConversationRunEvent({
      conversationId: activeRun.conversationId,
      error: "Run cancelled by the user.",
      runId: input.runId,
      status: "cancelled",
      type: "run.finished",
    });
    return Promise.resolve();
  }

  public closeWindow(): Promise<void> {
    return Promise.reject(new Error("Window control is unavailable in the mock host."));
  }

  public writeClipboardText(text: string): Promise<void> {
    const clipboard = globalThis.navigator.clipboard;
    if (clipboard === undefined) {
      return Promise.reject(new Error("Clipboard access is unavailable in the browser preview."));
    }
    return clipboard.writeText(text);
  }

  public createConversation(
    input: CreateConversationInput,
  ): Promise<ConversationSummary> {
    const projectId = input.projectId ?? null;
    if (projectId !== null && projectId !== this.project?.id) {
      return Promise.reject(new Error("The mock project is unavailable."));
    }

    const projectConversations = this.conversations.filter(
      (conversation) => conversation.projectId === projectId,
    );
    const now = new Date().toISOString();
    const conversation: ConversationSummary = {
      activeSubagentCount: 0,
      activeRunId: null,
      agentId: input.agent?.id ?? null,
      archivedAt: null,
      avatarIcon: input.agent?.avatarIcon ?? null,
      createdAt: now,
      hasUnreadResult: false,
      id: this.createIdentifier(),
      isArchived: false,
      isPinned: false,
      lastRunStatus: null,
      modelSelection: input.modelSelection ?? this.modelStatus.recentSelection,
      parentConversationId: null,
      pinOrder: null,
      projectId,
      teamId: input.teamId ?? null,
      teamWorkItemId: null,
      threadKind: input.threadKind ?? "agent",
      title:
        projectConversations.length === 0
          ? "新会话"
          : `新会话 ${projectConversations.length + 1}`,
      updatedAt: now,
      workspaceRootPath: null,
    };

    this.conversations.unshift(conversation);
    this.timelines.set(conversation.id, []);
    return Promise.resolve({ ...conversation });
  }

  public async ensureTeamMemberConversation(
    input: EnsureTeamMemberConversationInput,
  ): Promise<TeamMemberConversationView> {
    const team = this.applicationSettings.agentDirectory.teams.find(
      (candidate) => candidate.id === input.teamId,
    );
    if (team === undefined || !team.memberIds.includes(input.agentId)) {
      throw new Error("The mock Team member is unavailable.");
    }
    const toBinding = (agentId: string) => {
      const agent = this.applicationSettings.agentDirectory.agents.find(
        (candidate) => candidate.id === agentId && candidate.enabled,
      );
      if (agent === undefined) throw new Error("The mock Agent is unavailable.");
      const configured = team.memberConfigurations[agent.id];
      return {
        avatarIcon: agent.avatar.kind === "icon" ? agent.avatar.icon : null,
        id: agent.id,
        instructions: [agent.instructions, team.instructions, configured?.instructions]
          .filter((value): value is string => value !== undefined && value.trim().length > 0)
          .join("\n\n")
          .slice(0, 20_000),
        isDefault: agent.isDefault,
        name: agent.name,
        role: configured?.role.trim() || agent.role,
      };
    };
    let lead = this.conversations.find((conversation) =>
      !conversation.isArchived
      && conversation.parentConversationId === null
      && conversation.projectId === null
      && conversation.teamId === team.id
      && conversation.threadKind === "team_lead"
    );
    if (lead === undefined) {
      const created = await this.createConversation({
        agent: toBinding(team.leadAgentId),
        projectId: null,
        teamId: team.id,
        threadKind: "team_lead",
      });
      lead = this.conversations.find((conversation) => conversation.id === created.id);
      if (lead === undefined) throw new Error("The mock Team Lead could not be created.");
      lead.title = `${lead.agentId === null ? "Team Lead" : toBinding(team.leadAgentId).name} · ${team.name}`;
    }
    if (input.agentId === team.leadAgentId) {
      return { lead: { ...lead }, member: { ...lead } };
    }
    let member = this.conversations.find((conversation) =>
      !conversation.isArchived
      && conversation.agentId === input.agentId
      && conversation.parentConversationId === lead.id
      && conversation.teamId === team.id
      && conversation.threadKind === "agent"
    );
    if (member === undefined) {
      const binding = toBinding(input.agentId);
      const created = await this.createConversation({
        agent: binding,
        projectId: null,
        teamId: team.id,
        threadKind: "agent",
      });
      member = this.conversations.find((conversation) => conversation.id === created.id);
      if (member === undefined) throw new Error("The mock Team member could not be created.");
      member.parentConversationId = lead.id;
      member.title = `${binding.name} · ${team.name}`;
    }
    return { lead: { ...lead }, member: { ...member } };
  }

  public listTeamInstances(input: ListTeamInstancesInput): Promise<TeamInstanceView[]> {
    return Promise.resolve(this.teamInstances.filter((instance) =>
      (input.includeArchived === true || !instance.isArchived)
      && (input.projectId === undefined || instance.projectId === input.projectId)
      && (
        input.sourceConversationId === undefined
        || instance.sourceConversationId === input.sourceConversationId
      )
    ).map((instance) => ({ ...instance })));
  }

  public async createTeamInstance(input: CreateTeamInstanceInput): Promise<TeamInstanceView> {
    const team = this.applicationSettings.agentDirectory.teams.find(
      (candidate) => candidate.id === input.teamId,
    );
    if (team === undefined) throw new Error("The mock Team template is unavailable.");
    const existingNames = new Set(this.teamInstances.filter((instance) =>
      !instance.isArchived && (
        instance.scope === "global"
        || (input.projectId !== undefined
          && instance.scope === "project"
          && instance.projectId === input.projectId)
        || (input.sourceConversationId !== undefined
          && instance.scope === "conversation"
          && instance.sourceConversationId === input.sourceConversationId)
      )
    ).map((instance) => instance.name.toLocaleLowerCase()));
    const baseName = input.name?.trim() || team.name;
    let name = baseName;
    for (let suffix = 1; existingNames.has(name.toLocaleLowerCase()); suffix += 1) {
      name = `${baseName} (${suffix})`;
    }
    const now = new Date().toISOString();
    const instance: TeamInstanceView = {
      createdAt: now,
      id: this.createIdentifier(),
      isArchived: false,
      name,
      projectId: input.projectId ?? null,
      rootConversationId: null,
      scope: input.scope,
      sourceConversationId: input.sourceConversationId ?? null,
      teamId: input.teamId,
      updatedAt: now,
    };
    const toBinding = (agentId: string) => {
      const agent = this.applicationSettings.agentDirectory.agents.find(
        (candidate) => candidate.id === agentId,
      );
      if (agent === undefined) throw new Error("The mock Agent is unavailable.");
      return {
        avatarIcon: agent.avatar.kind === "icon" ? agent.avatar.icon : null,
        id: agent.id,
        instructions: agent.instructions,
        isDefault: agent.isDefault,
        name: agent.name,
        role: team.memberConfigurations[agent.id]?.role.trim() || agent.role,
      };
    };
    const leadBinding = toBinding(team.leadAgentId);
    const leadSummary = await this.createConversation({
      agent: leadBinding,
      ...(instance.projectId === null ? {} : { projectId: instance.projectId }),
      teamId: team.id,
      threadKind: "team_lead",
    });
    const lead = this.conversations.find((conversation) => conversation.id === leadSummary.id)!;
    lead.parentConversationId = instance.sourceConversationId;
    lead.title = `${leadBinding.name} · ${instance.name}`;
    instance.rootConversationId = lead.id;
    this.teamInstances.push(instance);
    for (const agentId of team.memberIds) {
      if (agentId === team.leadAgentId) continue;
      const binding = toBinding(agentId);
      const memberSummary = await this.createConversation({
        agent: binding,
        ...(instance.projectId === null ? {} : { projectId: instance.projectId }),
        teamId: team.id,
        threadKind: "agent",
      });
      const member = this.conversations.find(
        (conversation) => conversation.id === memberSummary.id,
      )!;
      member.parentConversationId = lead.id;
      member.title = `${binding.name} · ${instance.name}`;
    }
    return { ...instance };
  }

  public renameTeamInstance(input: RenameTeamInstanceInput): Promise<TeamInstanceView> {
    const instance = this.teamInstances.find((candidate) => candidate.id === input.teamInstanceId);
    if (instance === undefined) return Promise.reject(new Error("The mock Team instance was not found."));
    if (input.projectId !== undefined) {
      if (instance.scope === "conversation") {
        return Promise.reject(new Error("A conversation Team retains its source conversation project."));
      }
      instance.projectId = input.projectId;
      instance.scope = input.projectId === null ? "global" : "project";
      if (instance.rootConversationId !== null) {
        const participantIds = new Set([
          instance.rootConversationId,
          ...this.conversations.filter((conversation) =>
            conversation.parentConversationId === instance.rootConversationId
          ).map((conversation) => conversation.id),
        ]);
        for (const conversation of this.conversations) {
          if (participantIds.has(conversation.id)) conversation.projectId = input.projectId;
        }
      }
    }
    instance.name = input.name.trim();
    instance.updatedAt = new Date().toISOString();
    return Promise.resolve({ ...instance });
  }

  public reorderTeamInstances(input: ReorderTeamInstancesInput): Promise<TeamInstanceView[]> {
    const visibleIds = this.teamInstances.filter((instance) =>
      !instance.isArchived && instance.scope !== "conversation"
    ).map((instance) => instance.id);
    if (
      input.teamInstanceIds.length !== visibleIds.length
      || new Set(input.teamInstanceIds).size !== input.teamInstanceIds.length
      || input.teamInstanceIds.some((teamInstanceId) => !visibleIds.includes(teamInstanceId))
    ) {
      return Promise.reject(new Error("Team instance reorder must include every visible Team."));
    }
    const orderById = new Map(input.teamInstanceIds.map((teamInstanceId, index) => [
      teamInstanceId,
      index,
    ]));
    this.teamInstances.sort((left, right) => {
      const leftOrder = orderById.get(left.id);
      const rightOrder = orderById.get(right.id);
      if (leftOrder === undefined && rightOrder === undefined) return 0;
      if (leftOrder === undefined) return 1;
      if (rightOrder === undefined) return -1;
      return leftOrder - rightOrder;
    });
    return this.listTeamInstances({ includeArchived: false });
  }

  public setTeamInstanceArchived(input: SetTeamInstanceArchivedInput): Promise<TeamInstanceView> {
    const instance = this.teamInstances.find((candidate) => candidate.id === input.teamInstanceId);
    if (instance === undefined) return Promise.reject(new Error("The mock Team instance was not found."));
    instance.isArchived = input.archived;
    instance.updatedAt = new Date().toISOString();
    return Promise.resolve({ ...instance });
  }

  public deleteTeamInstance(input: TeamInstanceReferenceInput): Promise<void> {
    const index = this.teamInstances.findIndex((candidate) => candidate.id === input.teamInstanceId);
    if (index < 0) return Promise.reject(new Error("The mock Team instance was not found."));
    this.teamInstances.splice(index, 1);
    return Promise.resolve();
  }

  public ensureTeamInstanceMemberConversation(
    input: EnsureTeamInstanceMemberConversationInput,
  ): Promise<TeamMemberConversationView> {
    const instance = this.teamInstances.find((candidate) => candidate.id === input.teamInstanceId);
    if (instance === undefined || instance.rootConversationId === null) {
      return Promise.reject(new Error("The mock Team instance is unavailable."));
    }
    const lead = this.conversations.find((conversation) => conversation.id === instance.rootConversationId);
    const member = input.agentId === lead?.agentId
      ? lead
      : this.conversations.find((conversation) =>
        conversation.parentConversationId === lead?.id && conversation.agentId === input.agentId
      );
    if (lead === undefined || member === undefined) {
      return Promise.reject(new Error("The mock Team member is unavailable."));
    }
    return Promise.resolve({ lead: { ...lead }, member: { ...member } });
  }

  public forkConversation(
    input: ForkConversationInput,
  ): Promise<ConversationSummary> {
    const source = this.conversations.find(
      (candidate) => candidate.id === input.conversationId,
    );
    const sourceTimeline = this.timelines.get(input.conversationId);
    if (source === undefined || sourceTimeline === undefined) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }
    let inheritedTimeline: ConversationTimelineItem[];
    try {
      inheritedTimeline = input.throughMessageId === undefined
        ? sourceTimeline
        : sourceTimeline.slice(
            0,
            resolveMockForkBoundary(sourceTimeline, input.throughMessageId) + 1,
          );
    } catch (error) {
      return Promise.reject(
        error instanceof Error ? error : new Error("The mock fork boundary is invalid."),
      );
    }

    const isSiblingFork = input.throughMessageId !== undefined;
    const forkCount = [...this.conversationParents.values()].filter(
      (parentId) => parentId === source.id,
    ).length;
    const siblingTitlePrefix = `${source.title} (`;
    const siblingForkNumber = this.conversations.reduce((highest, candidate) => {
      if (
        candidate.projectId !== source.projectId
        || candidate.parentConversationId !== null
        || !candidate.title.startsWith(siblingTitlePrefix)
        || !candidate.title.endsWith(")")
      ) {
        return highest;
      }
      const suffix = candidate.title.slice(siblingTitlePrefix.length, -1);
      return /^[1-9]\d*$/.test(suffix) ? Math.max(highest, Number(suffix)) : highest;
    }, 0) + 1;
    const now = new Date().toISOString();
    const conversation: ConversationSummary = {
      activeSubagentCount: 0,
      activeRunId: null,
      agentId: source.agentId,
      archivedAt: null,
      avatarIcon: source.avatarIcon ?? null,
      createdAt: now,
      hasUnreadResult: false,
      id: this.createIdentifier(),
      isArchived: false,
      isPinned: false,
      lastRunStatus: null,
      modelSelection: source.modelSelection,
      parentConversationId: isSiblingFork ? null : source.id,
      pinOrder: null,
      projectId: source.projectId,
      teamId: source.teamId,
      teamWorkItemId: null,
      threadKind: "agent",
      title: isSiblingFork
        ? `${source.title} (${siblingForkNumber})`
        : forkCount === 0 ? "侧边聊天" : `侧边聊天 ${forkCount + 1}`,
      updatedAt: now,
      workspaceRootPath: source.workspaceRootPath,
    };
    this.conversations.unshift(conversation);
    if (!isSiblingFork) this.conversationParents.set(conversation.id, source.id);
    if (isSiblingFork) {
      const timelineIdMap = new Map(
        inheritedTimeline.map((item) => [item.id, this.createIdentifier()]),
      );
      const runIdMap = new Map<string, string>();
      const attachmentIdMap = new Map<string, string>();
      for (const item of inheritedTimeline) {
        if (item.runId !== null && !runIdMap.has(item.runId)) {
          runIdMap.set(item.runId, this.createIdentifier());
        }
        if (item.kind === "message") {
          for (const attachment of item.attachments) {
            if (!attachmentIdMap.has(attachment.id)) {
              attachmentIdMap.set(attachment.id, this.createIdentifier());
            }
          }
        }
      }
      this.timelines.set(conversation.id, inheritedTimeline.map((item) => {
        const id = timelineIdMap.get(item.id);
        if (id === undefined) throw new Error("The mock fork timeline could not be mapped.");
        const runId = item.runId === null ? null : runIdMap.get(item.runId);
        if (item.runId !== null && runId === undefined) {
          throw new Error("The mock fork Run could not be mapped.");
        }
        if (item.kind === "tool") {
          if (runId === null || runId === undefined) {
            throw new Error("The mock fork tool Run could not be mapped.");
          }
          return {
            ...structuredClone(item),
            conversationId: conversation.id,
            id,
            runId,
          };
        }
        if (item.kind === "model_retry") {
          if (runId === null || runId === undefined) {
            throw new Error("The mock fork model retry Run could not be mapped.");
          }
          return {
            ...structuredClone(item),
            conversationId: conversation.id,
            id,
            runId,
          };
        }
        const copiedItem = {
          ...structuredClone(item),
          conversationId: conversation.id,
          id,
          runId: runId ?? null,
        };
        if (copiedItem.kind !== "message") return copiedItem;
        return {
          ...copiedItem,
          attachments: copiedItem.attachments.map((attachment) => ({
            ...attachment,
            conversationId: conversation.id,
            id: attachmentIdMap.get(attachment.id) ?? attachment.id,
            messageId: id,
          })),
        };
      }));
    } else {
      this.inheritedTimelines.set(conversation.id, structuredClone(inheritedTimeline));
      this.timelines.set(conversation.id, []);
    }
    return Promise.resolve({ ...conversation });
  }

  public selectConversationWorkspace(): Promise<ConversationSummary | null> {
    return Promise.reject(new Error("Conversation workspaces are unavailable in the mock host."));
  }

  public clearConversationWorkspace(): Promise<ConversationSummary> {
    return Promise.reject(new Error("Conversation workspaces are unavailable in the mock host."));
  }

  public getConversationContextUsage(
    input: ConversationContextUsageInput,
  ): Promise<ConversationContextUsage> {
    const conversation = this.conversations.find(
      (candidate) => candidate.id === input.conversationId,
    );
    const timeline = this.timelines.get(input.conversationId);
    if (conversation === undefined || timeline === undefined) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }

    const contextTimeline = [
      ...(this.inheritedTimelines.get(input.conversationId) ?? []),
      ...timeline,
    ];

    let estimatedConversationTokens = 0;
    let estimatedToolTokens = 0;
    for (const item of contextTimeline) {
      if (item.kind === "message" || item.kind === "agent_message") {
        estimatedConversationTokens +=
          estimateContextTokens(item.content) + CONTEXT_MESSAGE_OVERHEAD_TOKENS;
        continue;
      }
      if (item.kind === "model_retry") continue;

      estimatedToolTokens +=
        estimateContextTokens(item.arguments) +
        estimateContextTokens(item.result ?? "") +
        CONTEXT_MESSAGE_OVERHEAD_TOKENS;
    }

    const estimatedSystemTokens =
      estimateContextTokens(
        conversation.projectId === null
          ? `临时对话\n${input.permissionMode}`
          : `项目对话\n${input.permissionMode}`,
      ) + CONTEXT_MESSAGE_OVERHEAD_TOKENS;
    const configuredModel = this.modelStatus.models.find((model) =>
      (input.providerId === undefined || model.providerId === input.providerId) &&
      (input.modelId === undefined || model.modelId === input.modelId)
    ) ?? this.modelStatus.models.find((model) =>
      model.providerId === this.modelStatus.providerId &&
      model.modelId === this.modelStatus.modelId
    );
    const compressionThresholdTokens = resolveContextCompressionThresholdTokens(
      this.contextCompressionConfiguration,
      configuredModel?.contextWindow ?? 0,
    );
    const referenceBudgetTokens = Math.min(
      8_192,
      Math.max(1_024, Math.floor(compressionThresholdTokens * 0.15)),
    );
    const estimatedConversationReferenceTokens = [...new Set(
      input.referencedConversationIds ?? [],
    )]
        .filter((conversationId) => conversationId !== input.conversationId)
        .reduce((total, conversationId) => {
          const referencedConversation = this.conversations.find(
            (candidate) => candidate.id === conversationId,
          );
          const referencedTimeline = this.timelines.get(conversationId);
          if (referencedConversation === undefined || referencedTimeline === undefined) return total;
          const inheritedTimeline = this.inheritedTimelines.get(conversationId) ?? [];
          return total
            + estimateContextTokens(`引用对话：${referencedConversation.title}`)
            + CONTEXT_MESSAGE_OVERHEAD_TOKENS
            + [...inheritedTimeline, ...referencedTimeline].reduce(
              (messageTotal, item) => messageTotal
                + estimateContextTokens(
                  item.kind === "tool"
                    ? `${item.arguments}\n${item.result ?? ""}`
                    : item.kind === "model_retry" ? "" : item.content,
                )
                + CONTEXT_MESSAGE_OVERHEAD_TOKENS,
              0,
            );
        }, 0);
    const estimatedProjectFileReferenceTokens = estimateContextTokens(
      (input.referencedProjectPaths ?? []).join("\n"),
    );
    const estimatedReferenceTokens = Math.min(
      referenceBudgetTokens,
      estimatedConversationReferenceTokens + estimatedProjectFileReferenceTokens,
    );

    return Promise.resolve({
      compressionMode: this.contextCompressionConfiguration.mode,
      compressionThresholdTokens,
      estimatedAttachmentTokens: 0,
      estimatedConversationTokens,
      estimatedReferenceTokens,
      estimatedInputTokens:
        estimatedSystemTokens
        + estimatedConversationTokens
        + estimatedToolTokens
        + estimatedReferenceTokens,
      estimatedSkillCatalogTokens: 0,
      estimatedSystemTokens,
      estimatedTaskListTokens: 0,
      estimatedToolDefinitionTokens: 0,
      estimatedToolTokens,
      historyCharacters: contextTimeline.reduce(
        (total, item) =>
          total +
          (item.kind === "message"
              ? item.content.length
              : item.kind === "agent_message"
                ? item.content.length
                : item.kind === "model_retry"
                  ? 0
                  : item.arguments.length + (item.result?.length ?? 0)),
        0,
      ),
      includedMessageCount: contextTimeline.filter((item) => item.kind !== "model_retry").length,
      omittedMessageCount: 0,
      outputReserveTokens: 8_192,
      skillReserveTokens: 0,
    });
  }

  public chooseConversationAttachments(): Promise<ConversationAttachment[]> {
    return Promise.reject(
      new Error("File selection is unavailable in the browser preview."),
    );
  }

  public importConversationAttachmentBytes(
    input: ImportConversationAttachmentBytesInput,
  ): Promise<ConversationAttachment[]> {
    void input;
    return Promise.reject(
      new Error("Conversation attachments are unavailable in the browser preview."),
    );
  }

  public readConversationAttachmentPreview(): Promise<ConversationAttachmentPreview> {
    return Promise.reject(new Error("Conversation attachment previews are unavailable in the mock host."));
  }

  public listDraftConversationAttachments(): Promise<ConversationAttachment[]> {
    return Promise.resolve([]);
  }

  public removeConversationAttachment(
    input: RemoveConversationAttachmentInput,
  ): Promise<void> {
    void input;
    return Promise.reject(
      new Error("Conversation attachments are unavailable in the browser preview."),
    );
  }

  public getConversationTaskList(
    input: ConversationReferenceInput,
  ): Promise<ConversationTaskList | null> {
    if (!this.conversations.some((conversation) => conversation.id === input.conversationId)) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }
    const taskList = this.taskLists.get(input.conversationId);
    return Promise.resolve(taskList === undefined ? null : structuredClone(taskList));
  }

  public closeConversationTaskList(
    input: ConversationReferenceInput,
  ): Promise<void> {
    if (!this.taskLists.delete(input.conversationId)) {
      return Promise.reject(new Error("The mock task list is unavailable."));
    }
    return Promise.resolve();
  }

  public deleteConversationTaskList(input: ConversationReferenceInput): Promise<void> {
    if (!this.taskLists.delete(input.conversationId)) {
      return Promise.reject(new Error("The mock task list is unavailable."));
    }
    return Promise.resolve();
  }

  public chooseSkillDirectory(): Promise<SkillDiscoveryResult | null> {
    return Promise.resolve(null);
  }

  public createSkillDocument(input?: CreateSkillDocumentInput): Promise<SkillDocument> {
    const rootPath = input?.directoryPath ?? "C:\\mock-skills";
    if (
      rootPath !== "C:\\mock-skills"
      && !this.integrationConfiguration.skillDirectories.includes(rootPath)
    ) {
      return Promise.reject(new Error("只能在默认目录或已登记的 Skill 目录中创建。"));
    }
    let suffix = this.skillDocuments.size + 1;
    let name = suffix === 1 ? "new-skill" : `new-skill-${suffix}`;
    let entryPath = `${rootPath}\\${name}\\SKILL.md`;
    while (this.skillDocuments.has(entryPath)) {
      suffix += 1;
      name = `new-skill-${suffix}`;
      entryPath = `${rootPath}\\${name}\\SKILL.md`;
    }
    const content = createSkillMarkdown({
      description: "说明该 Skill 应在什么情况下使用。",
      name,
    });
    const document = { content, entryPath, metadata: parseSkillMarkdown(content).metadata };
    this.skillDocuments.set(entryPath, structuredClone(document));
    this.configurationWorkspaces.set(this.skillWorkspaceKey(entryPath), {
      directories: new Set(["", "assets", "references", "scripts"]),
      files: new Map([["SKILL.md", content]]),
    });
    if (!this.integrationConfiguration.skills.some((skill) => skill.entryPath === entryPath)) {
      this.integrationConfiguration = {
        ...this.integrationConfiguration,
        skills: [...this.integrationConfiguration.skills, {
          description: document.metadata.description,
          enabled: true,
          entryPath,
          id: name,
          mcpDependencies: [],
          name,
          scope: "user",
          version: "",
        }],
      };
    }
    return Promise.resolve(structuredClone(document));
  }

  public discoverSkillDocuments(): Promise<SkillDiscoveryResult> {
    return Promise.resolve({
      defaultDirectoryPath: "C:\\mock-skills",
      documents: [...this.skillDocuments.values()].map((document) => structuredClone(document)),
    });
  }

  public createConfigurationWorkspaceEntry(
    input: CreateConfigurationWorkspaceEntryInput,
  ): Promise<ConfigurationWorkspaceEntry> {
    const workspace = this.resolveConfigurationWorkspace(input.kind, input.configurationId);
    const path = this.assertConfigurationWorkspacePath(input.path);
    if (this.isProtectedConfigurationWorkspacePath(input.kind, path)) {
      return Promise.reject(new Error("The required configuration entry cannot be replaced."));
    }
    if (workspace.directories.has(path) || workspace.files.has(path)) {
      return Promise.reject(new Error("The mock configuration workspace entry already exists."));
    }
    const parentPath = path.includes("/") ? (path.slice(0, path.lastIndexOf("/"))) : "";
    if (!workspace.directories.has(parentPath)) {
      return Promise.reject(new Error("The mock configuration workspace parent directory is unavailable."));
    }
    const name = path.split("/").at(-1) ?? path;
    if (input.entryKind === "directory") {
      workspace.directories.add(path);
    } else {
      workspace.files.set(path, "");
    }
    return Promise.resolve({
      isProtected: false,
      kind: input.entryKind,
      name,
      path,
    });
  }

  public deleteConversation(input: ConversationReferenceInput): Promise<void> {
    const index = this.conversations.findIndex(
      (conversation) => conversation.id === input.conversationId,
    );
    if (index < 0) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }
    if (this.conversations[index]?.teamWorkItemId !== null
      && this.conversations[index]?.teamWorkItemId !== undefined) {
      return Promise.reject(new Error("Managed Team WorkItem conversations are retained by their WorkItem lifecycle."));
    }

    const deletedIds = new Set([
      input.conversationId,
      ...[...this.conversationParents.entries()]
        .filter(([, parentId]) => parentId === input.conversationId)
        .map(([conversationId]) => conversationId),
    ]);
    for (let candidateIndex = this.conversations.length - 1; candidateIndex >= 0; candidateIndex -= 1) {
      const candidate = this.conversations[candidateIndex];
      if (candidate !== undefined && deletedIds.has(candidate.id)) {
        this.conversations.splice(candidateIndex, 1);
        this.timelines.delete(candidate.id);
        this.taskLists.delete(candidate.id);
        this.inheritedTimelines.delete(candidate.id);
        this.conversationParents.delete(candidate.id);
      }
    }
    return Promise.resolve();
  }

  public deleteConfigurationWorkspaceEntry(
    input: DeleteConfigurationWorkspaceEntryInput,
  ): Promise<void> {
    const workspace = this.resolveConfigurationWorkspace(input.kind, input.configurationId);
    const path = this.assertConfigurationWorkspacePath(input.path);
    if (this.isProtectedConfigurationWorkspacePath(input.kind, path)) {
      return Promise.reject(new Error("The required configuration entry cannot be deleted."));
    }
    if (workspace.files.delete(path)) return Promise.resolve();
    if (!workspace.directories.has(path)) {
      return Promise.reject(new Error("The mock configuration workspace entry is unavailable."));
    }
    const prefix = `${path}/`;
    for (const directoryPath of workspace.directories) {
      if (directoryPath === path || directoryPath.startsWith(prefix)) {
        workspace.directories.delete(directoryPath);
      }
    }
    for (const filePath of workspace.files.keys()) {
      if (filePath.startsWith(prefix)) workspace.files.delete(filePath);
    }
    return Promise.resolve();
  }

  public discoverModels(input: DiscoverModelsInput): Promise<DiscoveredModel[]> {
    if (input.apiKey.trim().length === 0 || input.baseUrl.trim().length === 0) {
      return Promise.reject(new Error("Provider credentials are required."));
    }
    return Promise.resolve([
      { modelId: "gpt-5.6", ownedBy: "mock-provider" },
      { modelId: "mock-agent", ownedBy: "mock-provider" }
    ]);
  }

  public testModelConnection(input: TestModelConnectionInput): Promise<ModelConnectionTestResult> {
    const model = this.modelStatus.models.find((candidate) =>
      candidate.providerId === input.providerId && candidate.modelId === input.modelId
    );
    if (model === undefined) return Promise.reject(new Error("The selected model is not configured."));
    this.setModelConnectionStatus(input.providerId, input.modelId, "healthy");
    return Promise.resolve({
      content: `Hi! ${model.displayName} 连接正常。`,
      modelId: model.modelId,
    });
  }

  public getCapabilities(): Promise<CapabilitySet> {
    return Promise.resolve({ ...this.runtimeInfo.capabilities });
  }

  public getModelApiKey(providerId: string): Promise<string | null> {
    return Promise.resolve(this.modelApiKeys.get(providerId) ?? null);
  }

  public getModelCatalog(): Promise<ModelCatalog> {
    return Promise.resolve(structuredClone(DEFAULT_MODEL_CATALOG));
  }

  public getModelStatus(): Promise<ModelRuntimeStatus> {
    return Promise.resolve({
      ...this.modelStatus,
      models: [...this.modelStatus.models]
    });
  }

  public getContextCompressionConfiguration(): Promise<ContextCompressionConfiguration> {
    return Promise.resolve(structuredClone(this.contextCompressionConfiguration));
  }

  public getApplicationSettings(): Promise<ApplicationSettings> {
    return Promise.resolve(structuredClone(this.applicationSettings));
  }

  public getIntegrationConfiguration(): Promise<IntegrationConfiguration> {
    return Promise.resolve(structuredClone(this.integrationConfiguration));
  }

  public getBrowserConfiguration(): Promise<BrowserConfiguration> {
    return Promise.resolve(structuredClone(this.browserConfiguration));
  }

  public clearBrowserData(): Promise<void> {
    return Promise.resolve();
  }

  public getTerminalConfiguration(): Promise<TerminalConfiguration> {
    return Promise.resolve(structuredClone(this.terminalConfiguration));
  }

  public getGitReviewSnapshot(): Promise<GitReviewSnapshot> {
    return Promise.reject(new Error("Git review is unavailable in the mock host."));
  }

  public getGitFileDiff(): Promise<never> {
    return Promise.reject(new Error("Git review is unavailable in the mock host."));
  }

  public runGitOperation(): Promise<GitReviewSnapshot> {
    return Promise.reject(new Error("Git review is unavailable in the mock host."));
  }

  public openTerminalSession(): Promise<TerminalSession> {
    return Promise.reject(new Error("Terminal sessions are unavailable in the mock host."));
  }

  public readTerminalSessionOutput(): Promise<TerminalSessionOutput> {
    return Promise.reject(new Error("Terminal sessions are unavailable in the mock host."));
  }

  public writeTerminalSession(): Promise<void> {
    return Promise.reject(new Error("Terminal sessions are unavailable in the mock host."));
  }

  public resizeTerminalSession(): Promise<void> {
    return Promise.reject(new Error("Terminal sessions are unavailable in the mock host."));
  }

  public closeTerminalSession(): Promise<void> {
    return Promise.reject(new Error("Terminal sessions are unavailable in the mock host."));
  }

  public onTerminalSessionEvent(): () => void {
    return () => undefined;
  }

  public confirmWorkspaceTerminalTabOpened(): Promise<void> {
    return Promise.resolve();
  }

  public onWorkspaceTerminalTabOpenRequested(): () => void {
    return () => undefined;
  }

  public onWorkspaceTerminalTabCloseRequested(): () => void {
    return () => undefined;
  }

  public confirmWorkspaceBrowserTabOpened(): Promise<void> {
    return Promise.resolve();
  }

  public onWorkspaceBrowserTabOpenRequested(): () => void {
    return () => undefined;
  }

  public onWorkspaceBrowserTabCloseRequested(): () => void {
    return () => undefined;
  }

  public openManagedBrowser(): Promise<ManagedBrowserSession> {
    return Promise.reject(new Error("Managed browser is unavailable in the mock host."));
  }

  public navigateManagedBrowser(): Promise<void> {
    return Promise.reject(new Error("Managed browser is unavailable in the mock host."));
  }

  public commandManagedBrowser(): Promise<void> {
    return Promise.reject(new Error("Managed browser is unavailable in the mock host."));
  }

  public captureManagedBrowser(): Promise<ManagedBrowserSnapshot> {
    return Promise.reject(new Error("Managed browser is unavailable in the mock host."));
  }

  public setManagedBrowserBounds(): Promise<void> {
    return Promise.reject(new Error("Managed browser is unavailable in the mock host."));
  }

  public closeManagedBrowser(): Promise<void> {
    return Promise.reject(new Error("Managed browser is unavailable in the mock host."));
  }

  public onManagedBrowserEvent(): () => void {
    return () => undefined;
  }

  public getRuntimeInfo(): Promise<RuntimeInfo> {
    return Promise.resolve({
      ...this.runtimeInfo,
      capabilities: { ...this.runtimeInfo.capabilities },
    });
  }

  public getWindowState(): Promise<WindowState> {
    return Promise.resolve({ ...this.windowState });
  }

  public importSkillDocument(): Promise<SkillDocument | null> {
    return Promise.resolve(null);
  }

  public listConversationTimeline(
    input: ConversationReferenceInput,
  ): Promise<ConversationTimelineItem[]> {
    const timeline = this.timelines.get(input.conversationId);
    if (timeline === undefined) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }

    return Promise.resolve([...timeline]);
  }

  public searchConversations(input: ConversationSearchInput): Promise<ConversationSearchResult[]> {
    const query = input.query.toLocaleLowerCase();
    const results: ConversationSearchResult[] = [];
    for (const conversation of this.conversations) {
      for (const item of this.timelines.get(conversation.id) ?? []) {
        if (item.kind !== "message" && item.kind !== "agent_message") continue;
        if (!item.content.toLocaleLowerCase().includes(query)) continue;
        results.push({
          content: item.content.slice(0, 320),
          conversationId: conversation.id,
          conversationTitle: conversation.title,
          createdAt: item.createdAt,
          itemId: item.id,
          parentConversationId: conversation.parentConversationId,
          projectId: conversation.projectId,
          role: item.kind === "agent_message" ? "agent" : item.role,
          threadKind: conversation.threadKind,
        });
        if (results.length >= input.limit) return Promise.resolve(results);
      }
    }
    return Promise.resolve(results);
  }

  public listConversationPendingMessages(
    input: ConversationReferenceInput,
  ): Promise<ConversationPendingMessage[]> {
    return Promise.resolve(structuredClone(this.pendingMessages.get(input.conversationId) ?? []));
  }

  public markConversationResultViewed(
    input: ConversationReferenceInput,
  ): Promise<ConversationSummary> {
    const conversation = this.conversations.find(
      (candidate) => candidate.id === input.conversationId,
    );
    if (conversation === undefined) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }
    conversation.hasUnreadResult = false;
    return Promise.resolve({ ...conversation });
  }

  public listConversations(): Promise<ConversationSummary[]> {
    return Promise.resolve(
      this.conversations
        .filter((conversation) => !this.conversationParents.has(conversation.id))
        .map((conversation) => ({ ...conversation }))
        .sort((left, right) => Number(right.isPinned) - Number(left.isPinned)),
    );
  }

  public listConversationForks(
    input: ConversationReferenceInput,
  ): Promise<ConversationSummary[]> {
    if (!this.conversations.some((conversation) => conversation.id === input.conversationId)) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }
    return Promise.resolve(
      this.conversations
        .filter(
          (conversation) =>
            this.conversationParents.get(conversation.id) === input.conversationId,
        )
        .map((conversation) => ({ ...conversation }))
        .reverse(),
    );
  }

  public listProjectEntries(
    input: ListProjectEntriesInput,
  ): Promise<ProjectDirectoryListing> {
    if (input.projectId !== this.project?.id) {
      return Promise.reject(new Error("The mock project is unavailable."));
    }

    return Promise.resolve({
      directoryPath: input.directoryPath,
      entries: [...(this.projectEntriesByDirectory.get(input.directoryPath) ?? [])].map(
        (entry, index) => ({
          ...entry,
          modifiedAt: new Date(Date.UTC(2026, 7, index + 1)).toISOString(),
        }),
      ),
      projectId: input.projectId,
      truncated: false,
    });
  }

  public listConfigurationWorkspaceEntries(
    input: ListConfigurationWorkspaceEntriesInput,
  ): Promise<ConfigurationWorkspaceDirectoryListing> {
    const workspace = this.resolveConfigurationWorkspace(input.kind, input.configurationId);
    const directoryPath = this.assertConfigurationWorkspacePath(input.directoryPath, true);
    if (!workspace.directories.has(directoryPath)) {
      return Promise.reject(new Error("The mock configuration workspace directory is unavailable."));
    }
    const prefix = directoryPath.length === 0 ? "" : `${directoryPath}/`;
    const entryPaths = new Set<string>();
    for (const candidate of workspace.directories) {
      if (candidate.length === 0 || !candidate.startsWith(prefix)) continue;
      const remainder = candidate.slice(prefix.length);
      if (!remainder.includes("/")) entryPaths.add(candidate);
    }
    for (const candidate of workspace.files.keys()) {
      if (!candidate.startsWith(prefix)) continue;
      const remainder = candidate.slice(prefix.length);
      if (!remainder.includes("/")) entryPaths.add(candidate);
    }
    const entries = [...entryPaths].map((path) => ({
      isProtected: this.isProtectedConfigurationWorkspacePath(input.kind, path),
      kind: workspace.directories.has(path) ? "directory" as const : "file" as const,
      modifiedAt: new Date().toISOString(),
      name: path.split("/").at(-1) ?? path,
      path,
    })).sort((left, right) => (
      left.kind === right.kind
        ? left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: "base" })
        : left.kind === "directory" ? -1 : 1
    ));
    return Promise.resolve({
      configurationId: input.configurationId,
      directoryPath,
      entries,
      kind: input.kind,
      rootPath: this.configurationWorkspaceRootPath(input.kind, input.configurationId),
      truncated: false,
    });
  }

  public listProjects(): Promise<ProjectSummary[]> {
    return Promise.resolve(this.project === null ? [] : [{ ...this.project }]);
  }

  public listTeamWorkItems(input: ListTeamWorkItemsInput): Promise<TeamWorkItemView[]> {
    return Promise.resolve(structuredClone(this.teamWorkItems.filter((item) =>
      (input.teamId === undefined || item.teamId === input.teamId)
      && (input.projectId === undefined || item.projectId === input.projectId))));
  }

  public getTeamWorkItemExecution(workItemId: string): Promise<TeamWorkItemExecutionView> {
    if (!this.teamWorkItems.some((item) => item.id === workItemId)) {
      return Promise.reject(new Error("The mock Team WorkItem is unavailable."));
    }
    return Promise.resolve({ agents: [], workItemId });
  }

  public getTeamCollaborationProjection(workItemId: string): Promise<TeamCollaborationProjection> {
    if (!this.teamWorkItems.some((item) => item.id === workItemId)) {
      return Promise.reject(new Error("The mock Team WorkItem is unavailable."));
    }
    return Promise.resolve({
      edges: [],
      isLive: false,
      nodes: [],
      plan: null,
      summary: {
        adHocRouteCount: 0,
        lastActivityAt: null,
        messageCount: 0,
        observedRouteCount: 0,
        participantCount: 0,
        plannedRouteCount: 0,
      },
      workItemId,
    });
  }

  public submitTeamWorkItem(input: SubmitTeamWorkItemInput): Promise<TeamWorkItemView> {
    const now = new Date().toISOString();
    const item: TeamWorkItemView = {
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      acceptedCriteria: [],
      activeRunId: null,
      blockedReason: null,
      completedAt: null,
      createdAt: now,
      events: [{
        createdAt: now,
        detail: "需求已进入浏览器模拟收件箱。",
        id: this.createIdentifier(),
        sequence: this.teamWorkItems.length + 1,
        type: "received",
      }],
      executionConversationId: null,
      executionScope: input.executionScope ?? "project",
      id: this.createIdentifier(),
      modelSelection: input.modelSelection ?? {
        modelId: "mock-model",
        providerId: "00000000-0000-4000-8000-000000000001",
        reasoning: null,
      },
      permissionMode: input.permissionMode ?? "ask_before_changes",
      priority: input.priority ?? "normal",
      projectId: input.projectId,
      requirement: input.requirement,
      resultSummary: null,
      revision: 1,
      sourceConversationId: input.sourceConversationId ?? null,
      status: "queued",
      tasks: [],
      teamId: input.teamId,
      title: input.title,
      updatedAt: now,
    };
    this.teamWorkItems.push(item);
    return Promise.resolve(structuredClone(item));
  }

  public updateTeamWorkItem(input: UpdateTeamWorkItemInput): Promise<TeamWorkItemView> {
    const item = this.teamWorkItems.find((candidate) => candidate.id === input.workItemId);
    if (item === undefined) return Promise.reject(new Error("Mock Team WorkItem was not found."));
    item.title = input.title;
    item.requirement = input.requirement;
    item.updatedAt = new Date().toISOString();
    const nextTeamEventSequence = this.teamWorkItems
      .filter((candidate) => candidate.teamId === item.teamId)
      .flatMap((candidate) => candidate.events)
      .reduce((sequence, event) => Math.max(sequence, event.sequence), 0) + 1;
    item.events.push({
      createdAt: item.updatedAt,
      detail: "浏览器模拟用户在调度前更新了需求。",
      id: this.createIdentifier(),
      sequence: nextTeamEventSequence,
      type: "updated",
    });
    return Promise.resolve(structuredClone(item));
  }

  public updateTeamWorkItemPermission(
    input: UpdateTeamWorkItemPermissionInput,
  ): Promise<TeamWorkItemView> {
    const item = this.teamWorkItems.find((candidate) => candidate.id === input.workItemId);
    if (
      item === undefined
      || item.status === "completed"
      || item.status === "cancelled"
      || item.status === "failed"
    ) {
      return Promise.reject(new Error("The mock Team WorkItem permission cannot be changed."));
    }
    if (item.permissionMode === input.permissionMode) return Promise.resolve(structuredClone(item));
    item.permissionMode = input.permissionMode;
    item.updatedAt = new Date().toISOString();
    const nextTeamEventSequence = this.teamWorkItems
      .filter((candidate) => candidate.teamId === item.teamId)
      .flatMap((candidate) => candidate.events)
      .reduce((sequence, event) => Math.max(sequence, event.sequence), 0) + 1;
    item.events.push({
      createdAt: item.updatedAt,
      detail: "浏览器模拟用户更新了团队执行权限。",
      id: this.createIdentifier(),
      sequence: nextTeamEventSequence,
      type: "updated",
    });
    return Promise.resolve(structuredClone(item));
  }

  public publishTeamWorkItem(input: PublishTeamWorkItemInput): Promise<TeamWorkItemView> {
    const item = this.teamWorkItems.find((candidate) => candidate.id === input.workItemId);
    if (
      item === undefined
      || (item.status !== "queued"
        && item.status !== "blocked"
        && item.status !== "failed"
        && item.status !== "cancelled")
    ) {
      return Promise.reject(new Error("The mock Team WorkItem cannot be published."));
    }
    if (item.status === "queued") return Promise.resolve(structuredClone(item));
    item.status = "queued";
    item.executionConversationId = null;
    item.activeRunId = null;
    item.resultSummary = null;
    item.acceptedCriteria = [];
    item.blockedReason = null;
    item.completedAt = null;
    item.revision += 1;
    item.updatedAt = new Date().toISOString();
    const nextTeamEventSequence = this.teamWorkItems
      .filter((candidate) => candidate.teamId === item.teamId)
      .flatMap((candidate) => candidate.events)
      .reduce((sequence, event) => Math.max(sequence, event.sequence), 0) + 1;
    item.events.push({
      createdAt: item.updatedAt,
      detail: "浏览器模拟用户已重新发布任务。",
      id: this.createIdentifier(),
      sequence: nextTeamEventSequence,
      type: "scheduled",
    });
    return Promise.resolve(structuredClone(item));
  }

  public requestTeamWorkItemRework(
    input: RequestTeamWorkItemReworkInput,
  ): Promise<TeamWorkItemView> {
    const item = this.teamWorkItems.find((candidate) => candidate.id === input.workItemId);
    if (
      item === undefined
      || (item.status !== "waiting_user" && item.status !== "completed")
    ) {
      return Promise.reject(new Error("The mock Team WorkItem cannot be reworked."));
    }
    item.status = "running";
    item.revision += 1;
    item.acceptedCriteria = [];
    item.completedAt = null;
    item.updatedAt = new Date().toISOString();
    return Promise.resolve(structuredClone(item));
  }

  public deleteTeamWorkItem(input: DeleteTeamWorkItemInput): Promise<void> {
    const index = this.teamWorkItems.findIndex((candidate) => candidate.id === input.workItemId);
    if (index < 0) return Promise.reject(new Error("Mock Team WorkItem was not found."));
    this.teamWorkItems.splice(index, 1);
    return Promise.resolve();
  }

  public addTeamWorkItemComment(
    input: AddTeamWorkItemCommentInput,
  ): Promise<TeamWorkItemView> {
    const item = this.teamWorkItems.find((candidate) => candidate.id === input.workItemId);
    if (item === undefined) {
      return Promise.reject(new Error("The mock Team WorkItem is unavailable."));
    }
    item.updatedAt = new Date().toISOString();
    const nextTeamEventSequence = this.teamWorkItems
      .filter((candidate) => candidate.teamId === item.teamId)
      .flatMap((candidate) => candidate.events)
      .reduce((sequence, event) => Math.max(sequence, event.sequence), 0) + 1;
    item.events.push({
      createdAt: item.updatedAt,
      detail: input.content.trim(),
      id: this.createIdentifier(),
      sequence: nextTeamEventSequence,
      type: "commented",
    });
    return Promise.resolve(structuredClone(item));
  }

  public acceptTeamWorkItem(input: AcceptTeamWorkItemInput): Promise<TeamWorkItemView> {
    const item = this.teamWorkItems.find((candidate) => candidate.id === input.workItemId);
    if (item === undefined || item.status !== "waiting_user") {
      return Promise.reject(new Error("The mock Team WorkItem is not waiting for acceptance."));
    }
    if (item.acceptanceCriteria.some((criterion) => !input.acceptedCriteria.includes(criterion))) {
      return Promise.reject(new Error("Every acceptance criterion must be explicitly confirmed."));
    }
    item.acceptedCriteria = [...input.acceptedCriteria];
    item.status = "completed";
    item.completedAt = new Date().toISOString();
    item.updatedAt = item.completedAt;
    return Promise.resolve(structuredClone(item));
  }

  public readProjectFile(input: ReadProjectFileInput): Promise<ProjectFile> {
    if (input.projectId !== this.project?.id) {
      return Promise.reject(new Error("The mock project is unavailable."));
    }
    const content = this.projectFileContents.get(input.path);
    if (content === undefined) {
      return Promise.reject(new Error("The mock file is unavailable."));
    }
    return Promise.resolve({
      byteLength: new TextEncoder().encode(content).byteLength,
      content,
      isBinary: false,
      name: input.path.split("/").at(-1) ?? input.path,
      path: input.path,
      projectId: input.projectId,
      truncated: false,
    });
  }

  public writeProjectFile(input: WriteProjectFileInput): Promise<ProjectFile> {
    if (input.projectId !== this.project?.id) {
      return Promise.reject(new Error("The mock project is unavailable."));
    }
    const current = this.projectFileContents.get(input.path) ?? null;
    if (current !== input.expectedContent) {
      const error = new Error("The mock file changed after it was opened.");
      Object.assign(error, { code: "FILE_CHANGED" });
      return Promise.reject(error);
    }
    this.projectFileContents.set(input.path, input.content);
    return Promise.resolve({
      byteLength: new TextEncoder().encode(input.content).byteLength,
      content: input.content,
      isBinary: false,
      name: input.path.split("/").at(-1) ?? input.path,
      path: input.path,
      projectId: input.projectId,
      truncated: false,
    });
  }

  public readProjectPreviewImage(): Promise<ProjectPreviewImage> {
    return Promise.reject(new Error("Preview images are unavailable in the mock host."));
  }

  public readConfigurationWorkspaceFile(
    input: ReadConfigurationWorkspaceFileInput,
  ): Promise<ConfigurationWorkspaceFile> {
    const workspace = this.resolveConfigurationWorkspace(input.kind, input.configurationId);
    const path = this.assertConfigurationWorkspacePath(input.path);
    const content = workspace.files.get(path);
    if (content === undefined) {
      return Promise.reject(new Error("The mock configuration workspace file is unavailable."));
    }
    return Promise.resolve(this.toConfigurationWorkspaceFile(input.kind, input.configurationId, path, content));
  }

  public minimizeWindow(): Promise<void> {
    return Promise.reject(new Error("Window control is unavailable in the mock host."));
  }

  public onConversationRunEvent(
    listener: ConversationRunEventListener,
  ): () => void {
    this.conversationListeners.add(listener);
    return () => this.conversationListeners.delete(listener);
  }

  public onApplicationSettingsChanged(
    listener: ApplicationSettingsListener,
  ): () => void {
    this.applicationSettingsListeners.add(listener);
    return () => this.applicationSettingsListeners.delete(listener);
  }

  public onWindowStateChanged(listener: WindowStateListener): () => void {
    void listener;
    return () => undefined;
  }

  public renameConversation(
    input: RenameConversationInput,
  ): Promise<ConversationSummary> {
    const conversation = this.conversations.find(
      (candidate) => candidate.id === input.conversationId,
    );
    if (conversation === undefined) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }

    conversation.title = input.title.trim();
    conversation.updatedAt = new Date().toISOString();
    this.emitConversationRunEvent({
      conversation: { ...conversation },
      type: "conversation.updated",
    });
    return Promise.resolve({ ...conversation });
  }

  public setConversationProject(
    input: SetConversationProjectInput,
  ): Promise<ConversationSummary> {
    const conversation = this.conversations.find(
      (candidate) => candidate.id === input.conversationId,
    );
    if (conversation === undefined) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }
    if (conversation.teamWorkItemId !== null && conversation.teamWorkItemId !== undefined) {
      return Promise.reject(new Error("Managed Team WorkItem conversations retain their WorkItem project binding."));
    }
    if (input.projectId !== null && this.project?.id !== input.projectId) {
      return Promise.reject(new Error("The mock project is unavailable."));
    }
    if (conversation.activeRunId !== null) {
      return Promise.reject(new Error("A running mock conversation cannot change projects."));
    }

    conversation.projectId = input.projectId;
    if (input.projectId !== null) conversation.workspaceRootPath = null;
    conversation.updatedAt = new Date().toISOString();
    this.emitConversationRunEvent({
      conversation: { ...conversation },
      type: "conversation.updated",
    });
    return Promise.resolve({ ...conversation });
  }

  public setConversationModelSelection(
    input: SetConversationModelSelectionInput,
  ): Promise<ConversationSummary> {
    const conversation = this.conversations.find(
      (candidate) => candidate.id === input.conversationId,
    );
    if (conversation === undefined) {
      return Promise.reject(new Error("Conversation was not found."));
    }
    const model = this.modelStatus.models.find((candidate) =>
      candidate.providerId === input.modelSelection.providerId
      && candidate.modelId === input.modelSelection.modelId
    );
    if (model === undefined) {
      return Promise.reject(new Error("The selected model is not configured."));
    }
    if (input.modelSelection.reasoning !== null) {
      const reasoningKey = modelReasoningOptionKey(input.modelSelection.reasoning);
      if (!model.reasoningOptions.some((option) =>
        modelReasoningOptionKey(option) === reasoningKey && isReasoningOptionEnabled(option)
      )) {
        return Promise.reject(new Error("The selected reasoning option is not configured."));
      }
    }
    const workItem = conversation.teamWorkItemId === null || conversation.teamWorkItemId === undefined
      ? undefined
      : this.teamWorkItems.find((candidate) => candidate.id === conversation.teamWorkItemId);
    if (conversation.teamWorkItemId !== null && conversation.teamWorkItemId !== undefined) {
      if (
        workItem === undefined
        || workItem.status === "completed"
        || workItem.status === "cancelled"
        || workItem.status === "failed"
      ) {
        return Promise.reject(new Error("The mock Team WorkItem model cannot be changed."));
      }
      workItem.modelSelection = structuredClone(input.modelSelection);
      workItem.updatedAt = new Date().toISOString();
      const nextTeamEventSequence = this.teamWorkItems
        .filter((candidate) => candidate.teamId === workItem.teamId)
        .flatMap((candidate) => candidate.events)
        .reduce((sequence, event) => Math.max(sequence, event.sequence), 0) + 1;
      workItem.events.push({
        createdAt: workItem.updatedAt,
        detail: "浏览器模拟用户更新了团队执行模型和思考程度。",
        id: this.createIdentifier(),
        sequence: nextTeamEventSequence,
        type: "updated",
      });
    }
    conversation.modelSelection = structuredClone(input.modelSelection);
    if (
      conversation.threadKind !== "subagent"
      && (conversation.teamWorkItemId === null || conversation.teamWorkItemId === undefined)
    ) {
      this.modelStatus.recentSelection = structuredClone(input.modelSelection);
    }
    conversation.updatedAt = new Date().toISOString();
    return Promise.resolve({ ...conversation });
  }

  public renameProject(input: RenameProjectInput): Promise<ProjectSummary> {
    if (this.project?.id !== input.projectId) {
      return Promise.reject(new Error("The mock project is unavailable."));
    }
    this.project = { ...this.project, name: input.name.trim() };
    return Promise.resolve({ ...this.project });
  }

  public reorderConversations(
    input: ReorderConversationsInput,
  ): Promise<ConversationSummary[]> {
    const ordered = input.conversationIds.map((conversationId) =>
      this.conversations.find((conversation) => conversation.id === conversationId)
    );
    const first = ordered[0];
    if (
      first === undefined
      || ordered.some((conversation) => conversation === undefined)
      || ordered.some((conversation) => conversation?.isPinned !== first.isPinned)
      || (
        !first.isPinned
        && ordered.some((conversation) => conversation?.projectId !== first.projectId)
      )
    ) {
      return Promise.reject(new Error("Mock conversations cannot be reordered across groups."));
    }
    const groupIds = new Set(input.conversationIds);
    const remaining = this.conversations.filter((conversation) => !groupIds.has(conversation.id));
    this.conversations.splice(
      0,
      this.conversations.length,
      ...ordered as ConversationSummary[],
      ...remaining,
    );
    return this.listConversations();
  }

  public reorderProjects(input: ReorderProjectsInput): Promise<ProjectSummary[]> {
    if (
      this.project === null
      || input.projectIds.length !== 1
      || input.projectIds[0] !== this.project.id
    ) {
      return Promise.reject(new Error("The mock project order is invalid."));
    }
    return this.listProjects();
  }

  public removeProject(input: ProjectReferenceInput): Promise<void> {
    if (this.project?.id !== input.projectId) {
      return Promise.reject(new Error("The mock project is unavailable."));
    }
    this.project = null;
    for (let index = this.conversations.length - 1; index >= 0; index -= 1) {
      if (this.conversations[index]?.projectId === input.projectId) {
        this.conversations.splice(index, 1);
      }
    }
    return Promise.resolve();
  }

  public setConversationArchived(
    input: SetConversationArchivedInput,
  ): Promise<ConversationSummary> {
    const conversation = this.conversations.find(
      (candidate) => candidate.id === input.conversationId,
    );
    if (
      conversation === undefined
      || (input.archived && conversation.activeRunId !== null)
      || (
        input.archived
        && conversation.teamWorkItemId !== null
        && conversation.teamWorkItemId !== undefined
      )
    ) {
      return Promise.reject(new Error("The mock conversation cannot be archived."));
    }
    if (conversation.isArchived === input.archived) {
      return Promise.resolve({ ...conversation });
    }
    conversation.isArchived = input.archived;
    conversation.archivedAt = input.archived ? new Date().toISOString() : null;
    this.emitConversationRunEvent({ conversation: { ...conversation }, type: "conversation.updated" });
    return Promise.resolve({ ...conversation });
  }

  public setConversationPinned(
    input: SetConversationPinnedInput,
  ): Promise<ConversationSummary> {
    const conversation = this.conversations.find(
      (candidate) => candidate.id === input.conversationId,
    );
    if (conversation === undefined) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }
    if (conversation.isPinned !== input.pinned) {
      conversation.isPinned = input.pinned;
      conversation.pinOrder = input.pinned
        ? Math.max(0, ...this.conversations.map((candidate) => candidate.pinOrder ?? 0)) + 1
        : null;
      const currentIndex = this.conversations.indexOf(conversation);
      this.conversations.splice(currentIndex, 1);
      const targetIndex = input.pinned
        ? this.conversations.findLastIndex((candidate) => candidate.isPinned) + 1
        : this.conversations.findIndex((candidate) => !candidate.isPinned);
      this.conversations.splice(
        targetIndex < 0 ? this.conversations.length : targetIndex,
        0,
        conversation,
      );
    }
    this.emitConversationRunEvent({ conversation: { ...conversation }, type: "conversation.updated" });
    return Promise.resolve({ ...conversation });
  }

  public setProjectPinned(input: SetProjectPinnedInput): Promise<ProjectSummary> {
    if (this.project?.id !== input.projectId) {
      return Promise.reject(new Error("The mock project is unavailable."));
    }
    this.project = { ...this.project, isPinned: input.pinned };
    return Promise.resolve({ ...this.project });
  }

  public setProjectTeamsInNavigator(
    input: SetProjectTeamsInNavigatorInput,
  ): Promise<ProjectSummary> {
    if (this.project?.id !== input.projectId) {
      return Promise.reject(new Error("The mock project is unavailable."));
    }
    this.project = {
      ...this.project,
      showTeamsInNavigator: input.showTeamsInNavigator,
    };
    return Promise.resolve({ ...this.project });
  }

  public readSkillDocument(input: SkillDocumentReferenceInput): Promise<SkillDocument> {
    const document = this.skillDocuments.get(input.entryPath);
    return document === undefined
      ? Promise.reject(new Error("The mock Skill document is unavailable."))
      : Promise.resolve(structuredClone(document));
  }

  public sendConversationMessage(
    input: SendConversationMessageInput,
  ): Promise<ConversationMessageSubmission> {
    const conversation = this.conversations.find(
      (candidate) => candidate.id === input.conversationId,
    );
    const timeline = this.timelines.get(input.conversationId);
    if (conversation === undefined || timeline === undefined) {
      return Promise.reject(new Error("The mock conversation is unavailable."));
    }
    if ([...this.activeRuns.values()].some((run) => run.conversationId === input.conversationId)) {
      const pendingMessage: ConversationPendingMessage = {
        attachmentIds: input.attachmentIds ?? [],
        content: input.content,
        conversationId: input.conversationId,
        createdAt: new Date().toISOString(),
        deliveryMode: input.deliveryMode ?? "queue",
        id: this.createIdentifier(),
        referencedConversationIds: input.referencedConversationIds ?? [],
        referencedProjectPaths: input.referencedProjectPaths ?? [],
      };
      const pending = [...(this.pendingMessages.get(input.conversationId) ?? []), pendingMessage];
      this.pendingMessages.set(input.conversationId, pending);
      this.emitConversationRunEvent({
        conversationId: input.conversationId,
        pendingMessages: structuredClone(pending),
        type: "pending_messages.updated",
      });
      return Promise.resolve({ kind: "pending", pendingMessage });
    }
    if (input.agent !== undefined) {
      if (conversation.agentId !== null && conversation.agentId !== input.agent.id) {
        return Promise.reject(new Error("This conversation is already bound to another Agent."));
      }
      conversation.agentId = input.agent.id;
      conversation.avatarIcon = input.agent.avatarIcon ?? null;
    }

    const now = new Date().toISOString();
    const runId = this.createIdentifier();
    const userMessage: ConversationTimelineItem = {
      attachments: [],
      content: input.content,
      conversationId: input.conversationId,
      createdAt: now,
      id: this.createIdentifier(),
      kind: "message",
      modelId: null,
      role: "user",
      runId,
      status: "completed",
    };
    timeline.push(userMessage);
    if (
      !this.conversationParents.has(conversation.id) &&
      !this.inheritedTimelines.has(conversation.id) &&
      !timeline.some(
        (item) => item.kind === "message" && item.role === "user" && item.id !== userMessage.id,
      )
    ) {
      conversation.title = createConversationTitle(input.content);
    }
    conversation.updatedAt = now;
    conversation.activeRunId = runId;
    conversation.lastRunStatus = "queued";
    conversation.hasUnreadResult = false;
    const activeRun: MockRun = {
      conversationId: conversation.id,
      modelId: input.modelId ?? "mock-agent",
      timeout: null,
    };
    const assistantMessageId = this.createIdentifier();
    this.activeRuns.set(runId, activeRun);
    queueMicrotask(() => {
      if (!this.activeRuns.has(runId)) {
        return;
      }
      if (!this.conversationParents.has(conversation.id)) {
        this.emitConversationRunEvent({
          conversation: { ...conversation },
          type: "conversation.updated",
        });
      }
      conversation.lastRunStatus = "running";
      this.emitConversationRunEvent({
        conversationId: conversation.id,
        modelId: activeRun.modelId,
        runId,
        type: "run.started",
      });
      setTimeout(() => {
        if (!this.activeRuns.has(runId)) return;
        this.emitConversationRunEvent({
          conversationId: conversation.id,
          delta: "正在检查浏览器预览配置",
          kind: "summary",
          messageId: assistantMessageId,
          modelId: activeRun.modelId,
          reset: true,
          runId,
          type: "assistant.reasoning_delta",
        });
      }, 50);
      activeRun.timeout = setTimeout(() => {
        if (!this.activeRuns.has(runId)) {
          return;
        }
        const response = "浏览器预览模式不连接模型。请在桌面端配置模型后发送任务。";
        const assistantMessage: ConversationTimelineItem = {
          attachments: [],
          content: response,
          conversationId: conversation.id,
          createdAt: new Date().toISOString(),
          id: assistantMessageId,
          kind: "message",
          modelId: activeRun.modelId,
          role: "assistant",
          runId,
          status: "completed",
        };
        timeline.push(assistantMessage);
        conversation.activeRunId = null;
        conversation.lastRunStatus = "completed";
        this.setModelConnectionStatus(
          input.providerId ?? this.modelStatus.providerId ?? "",
          activeRun.modelId,
          "healthy",
        );
        conversation.hasUnreadResult = true;
        this.emitConversationRunEvent({
          conversationId: conversation.id,
          delta: response,
          messageId: assistantMessage.id,
          modelId: activeRun.modelId,
          runId,
          type: "assistant.delta",
        });
        this.activeRuns.delete(runId);
        this.emitConversationRunEvent({
          conversationId: conversation.id,
          error: null,
          runId,
          status: "completed",
          type: "run.finished",
        });
        const nextPending = this.pendingMessages.get(conversation.id)?.[0];
        if (nextPending !== undefined) {
          const remaining = (this.pendingMessages.get(conversation.id) ?? []).slice(1);
          this.pendingMessages.set(conversation.id, remaining);
          this.emitConversationRunEvent({
            conversationId: conversation.id,
            pendingMessages: structuredClone(remaining),
            type: "pending_messages.updated",
          });
          void this.sendConversationMessage({
            content: nextPending.content,
            conversationId: nextPending.conversationId,
            deliveryMode: nextPending.deliveryMode,
            referencedConversationIds: nextPending.referencedConversationIds,
            referencedProjectPaths: nextPending.referencedProjectPaths,
          });
        }
      }, MOCK_RESPONSE_DELAY_MS);
    });
    return Promise.resolve({ kind: "started", runId, userMessage });
  }

  public async replaceLatestConversationMessage(
    input: ReplaceLatestConversationMessageInput,
  ): Promise<RunAccepted> {
    const timeline = this.timelines.get(input.conversationId);
    const latestUserIndex = timeline?.findLastIndex((item) =>
      item.kind === "message" && item.role === "user"
    ) ?? -1;
    const latestUser = timeline?.[latestUserIndex];
    if (
      timeline === undefined
      || latestUser?.kind !== "message"
      || latestUser.role !== "user"
      || latestUser.id !== input.messageId
    ) {
      throw new Error("Only the latest sent user message can be edited.");
    }
    if (latestUser.runId !== null && this.activeRuns.has(latestUser.runId)) {
      await this.cancelRun({ runId: latestUser.runId });
    }
    const originalAttachments = structuredClone(latestUser.attachments);
    timeline.splice(latestUserIndex);
    const submission = await this.sendConversationMessage({
      content: input.content,
      conversationId: input.conversationId,
      ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
      ...(input.permissionMode === undefined ? {} : { permissionMode: input.permissionMode }),
      ...(input.providerId === undefined ? {} : { providerId: input.providerId }),
      ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
      ...(input.referencedConversationIds === undefined
        ? {}
        : { referencedConversationIds: input.referencedConversationIds }),
      ...(input.referencedProjectPaths === undefined
        ? {}
        : { referencedProjectPaths: input.referencedProjectPaths }),
    });
    if (submission.kind !== "started") {
      throw new Error("The replacement message could not start in the mock runtime.");
    }
    submission.userMessage.id = input.messageId;
    const selectedAttachmentIds = new Set(
      input.attachmentIds ?? originalAttachments.map((attachment) => attachment.id),
    );
    submission.userMessage.attachments = originalAttachments.filter(
      (attachment) => selectedAttachmentIds.has(attachment.id),
    );
    return submission;
  }

  public promoteConversationPendingMessage(
    input: PendingConversationMessageReferenceInput,
  ): Promise<ConversationPendingMessage[]> {
    return this.mutatePendingMessage(input.pendingMessageId, (message) => ({
      ...message,
      deliveryMode: "steer",
    }));
  }

  public deleteConversationPendingMessage(
    input: PendingConversationMessageReferenceInput,
  ): Promise<ConversationPendingMessage[]> {
    for (const [conversationId, pending] of this.pendingMessages) {
      if (!pending.some((message) => message.id === input.pendingMessageId)) continue;
      const remaining = pending.filter((message) => message.id !== input.pendingMessageId);
      this.pendingMessages.set(conversationId, remaining);
      this.emitConversationRunEvent({
        conversationId,
        pendingMessages: structuredClone(remaining),
        type: "pending_messages.updated",
      });
      return Promise.resolve(structuredClone(remaining));
    }
    return Promise.reject(new Error("The mock pending message is unavailable."));
  }

  public updateConversationPendingMessage(
    input: UpdatePendingConversationMessageInput,
  ): Promise<ConversationPendingMessage[]> {
    return this.mutatePendingMessage(input.pendingMessageId, (message) => ({
      ...message,
      content: input.content,
    }));
  }

  public reorderConversationPendingMessages(
    input: ReorderPendingConversationMessagesInput,
  ): Promise<ConversationPendingMessage[]> {
    const pending = this.pendingMessages.get(input.conversationId) ?? [];
    const byId = new Map(pending.map((message) => [message.id, message]));
    if (byId.size !== input.pendingMessageIds.length) {
      return Promise.reject(new Error("The mock pending queue order is incomplete."));
    }
    const reordered = input.pendingMessageIds.map((id) => byId.get(id)).filter(
      (message): message is ConversationPendingMessage => message !== undefined,
    );
    this.pendingMessages.set(input.conversationId, reordered);
    this.emitConversationRunEvent({
      conversationId: input.conversationId,
      pendingMessages: structuredClone(reordered),
      type: "pending_messages.updated",
    });
    return Promise.resolve(structuredClone(reordered));
  }

  public saveModelConfiguration(
    input: SaveModelConfigurationInput,
  ): Promise<ModelRuntimeStatus> {
    const providerId = input.providerId ?? this.createProviderIdentifier();
    this.modelApiKeys.set(providerId, input.apiKey);
    const models = [
      ...this.modelStatus.models.filter((model) => model.providerId !== providerId),
      ...input.models.map((model): ModelProfile => ({
        ...model,
        connectionStatus: this.modelStatus.models.find((current) =>
          current.providerId === providerId && current.modelId === model.modelId
        )?.connectionStatus ?? "unknown",
        connectionStatusUpdatedAt: this.modelStatus.models.find((current) =>
          current.providerId === providerId && current.modelId === model.modelId
        )?.connectionStatusUpdatedAt ?? null,
        lastSuccessfulAt: this.modelStatus.models.find((current) =>
          current.providerId === providerId && current.modelId === model.modelId
        )?.lastSuccessfulAt ?? null,
        providerApiFormat: input.apiFormat,
         providerBaseUrl: input.baseUrl,
         providerId,
         providerName: input.providerName,
         ...(input.providerIcon === undefined ? {} : { providerIcon: input.providerIcon }),
         ...(input.providerNote === undefined ? {} : { providerNote: input.providerNote }),
        ...(input.providerWebsiteUrl === undefined
          ? {}
          : { providerWebsiteUrl: input.providerWebsiteUrl }),
      }))
    ];
    const defaultProviderId = this.modelStatus.configured
      ? this.modelStatus.providerId
      : providerId;
    const defaultModelId = models.some((model) =>
      model.providerId === defaultProviderId && model.modelId === this.modelStatus.modelId
    )
      ? this.modelStatus.modelId
      : models.find((model) => model.providerId === defaultProviderId)?.modelId;
    const defaultModel = models.find((model) =>
      model.providerId === defaultProviderId && model.modelId === defaultModelId
    );
    if (defaultModel === undefined) {
      return Promise.reject(new Error("The default provider must have a configured model."));
    }
    this.modelStatus = {
      baseUrl: defaultModel.providerBaseUrl,
      configured: true,
      modelId: defaultModel.modelId,
      models,
      providerId: defaultModel.providerId,
      recentSelection: this.modelStatus.recentSelection,
      supportsStreaming: true,
      supportsTools: true
    };
    return this.getModelStatus();
  }

  public setDefaultModel(input: SetDefaultModelInput): Promise<ModelRuntimeStatus> {
    const model = this.modelStatus.models.find((candidate) =>
      candidate.providerId === input.providerId && candidate.modelId === input.modelId
    );
    if (model === undefined) {
      return Promise.reject(new Error("The default model must belong to the selected provider."));
    }
    this.modelStatus = {
      ...this.modelStatus,
      baseUrl: model.providerBaseUrl,
      modelId: model.modelId,
      providerId: model.providerId,
    };
    return this.getModelStatus();
  }

  public saveContextCompressionConfiguration(
    input: ContextCompressionConfiguration,
  ): Promise<ContextCompressionConfiguration> {
    this.contextCompressionConfiguration = structuredClone(input);
    return this.getContextCompressionConfiguration();
  }

  public saveApplicationSettings(input: ApplicationSettings): Promise<ApplicationSettings> {
    this.applicationSettings = structuredClone(input);
    const saved = this.getApplicationSettings();
    void saved.then((settings) => {
      for (const listener of this.applicationSettingsListeners) listener(settings);
    });
    return saved;
  }

  public saveIntegrationConfiguration(
    input: IntegrationConfiguration,
  ): Promise<IntegrationConfiguration> {
    this.integrationConfiguration = structuredClone(input);
    for (const server of input.mcpServers) {
      const workspace = this.ensureMockMcpWorkspace(server);
      workspace.files.set("mcp.json", `${JSON.stringify(server, null, 2)}\n`);
    }
    return this.getIntegrationConfiguration();
  }

  public saveBrowserConfiguration(
    input: BrowserConfiguration,
  ): Promise<BrowserConfiguration> {
    this.browserConfiguration = structuredClone(input);
    return this.getBrowserConfiguration();
  }

  public saveTerminalConfiguration(
    input: TerminalConfiguration,
  ): Promise<TerminalConfiguration> {
    this.terminalConfiguration = structuredClone(input);
    return this.getTerminalConfiguration();
  }

  public saveSkillDocument(input: SkillDocumentSaveInput): Promise<SkillDocument> {
    if (!this.skillDocuments.has(input.entryPath)) {
      return Promise.reject(new Error("The mock Skill document is unavailable."));
    }
    const document = {
      content: input.content,
      entryPath: input.entryPath,
      metadata: parseSkillMarkdown(input.content).metadata,
    };
    this.skillDocuments.set(input.entryPath, structuredClone(document));
    const workspace = this.ensureMockSkillWorkspace(input.entryPath, input.content);
    workspace.files.set("SKILL.md", input.content);
    return Promise.resolve(structuredClone(document));
  }

  public writeConfigurationWorkspaceFile(
    input: WriteConfigurationWorkspaceFileInput,
  ): Promise<ConfigurationWorkspaceFile> {
    const workspace = this.resolveConfigurationWorkspace(input.kind, input.configurationId);
    const path = this.assertConfigurationWorkspacePath(input.path);
    const parentPath = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (!workspace.directories.has(parentPath)) {
      return Promise.reject(new Error("The mock configuration workspace parent directory is unavailable."));
    }

    if (input.kind === "mcp" && path === "mcp.json") {
      let server: McpServerConfiguration;
      try {
        server = mcpServerConfigurationSchema.parse(JSON.parse(input.content));
      } catch {
        return Promise.reject(new Error("mcp.json 必须是有效的 MCP Server JSON 配置。"));
      }
      if (server.id !== input.configurationId) {
        return Promise.reject(new Error("mcp.json 中的 id 不能改变当前 MCP Server。"));
      }
      if (!this.integrationConfiguration.mcpServers.some((candidate) => candidate.id === server.id)) {
        return Promise.reject(new Error("The mock MCP server is unavailable."));
      }
      this.integrationConfiguration = {
        ...this.integrationConfiguration,
        mcpServers: this.integrationConfiguration.mcpServers.map((candidate) => (
          candidate.id === server.id ? server : candidate
        )),
      };
      const content = `${JSON.stringify(server, null, 2)}\n`;
      workspace.files.set(path, content);
      return Promise.resolve(this.toConfigurationWorkspaceFile(input.kind, input.configurationId, path, content));
    }

    if (input.kind === "skill" && path === "SKILL.md") {
      let metadata: SkillDocument["metadata"];
      try {
        metadata = parseSkillMarkdown(input.content).metadata;
      } catch (reason) {
        return Promise.reject(
          reason instanceof Error ? reason : new Error("The mock Skill document is invalid."),
        );
      }
      const skill = this.integrationConfiguration.skills.find(
        (candidate) => candidate.id === input.configurationId,
      );
      if (skill === undefined) return Promise.reject(new Error("The mock Skill is unavailable."));
      this.integrationConfiguration = {
        ...this.integrationConfiguration,
        skills: this.integrationConfiguration.skills.map((candidate) => (
          candidate.id === skill.id
            ? { ...candidate, description: metadata.description, name: metadata.name }
            : candidate
        )),
      };
      const document = {
        content: input.content,
        entryPath: skill.entryPath,
        metadata,
      };
      this.skillDocuments.set(skill.entryPath, structuredClone(document));
    }

    workspace.files.set(path, input.content);
    return Promise.resolve(this.toConfigurationWorkspaceFile(
      input.kind,
      input.configurationId,
      path,
      input.content,
    ));
  }

  public toggleMaximizeWindow(): Promise<void> {
    return Promise.reject(new Error("Window control is unavailable in the mock host."));
  }

  private setModelConnectionStatus(
    providerId: string,
    modelId: string,
    connectionStatus: ModelProfile["connectionStatus"],
  ): void {
    const updatedAt = new Date().toISOString();
    this.modelStatus = {
      ...this.modelStatus,
      models: this.modelStatus.models.map((model) => (
        model.providerId === providerId && model.modelId === modelId
          ? {
              ...model,
              connectionStatus,
              connectionStatusUpdatedAt: updatedAt,
              ...(connectionStatus === "healthy" ? { lastSuccessfulAt: updatedAt } : {}),
            }
          : model
      )),
    };
  }

  private createIdentifier(): string {
    const identifier = createMockUuid(this.nextIdentifier);
    this.nextIdentifier += 1;
    return identifier;
  }

  private createProviderIdentifier(): string {
    const identifier = `00000000-0000-4000-8000-${this.nextProviderIdentifier
      .toString()
      .padStart(12, "0")}`;
    this.nextProviderIdentifier += 1;
    return identifier;
  }

  private resolveConfigurationWorkspace(
    kind: ConfigurationWorkspaceKind,
    configurationId: string,
  ): MockConfigurationWorkspace {
    if (kind === "mcp") {
      const server = this.integrationConfiguration.mcpServers.find(
        (candidate) => candidate.id === configurationId,
      );
      if (server === undefined) throw new Error("The mock MCP server is unavailable.");
      return this.ensureMockMcpWorkspace(server);
    }
    const skill = this.integrationConfiguration.skills.find(
      (candidate) => candidate.id === configurationId,
    );
    if (skill === undefined) throw new Error("The mock Skill is unavailable.");
    const document = this.skillDocuments.get(skill.entryPath);
    if (document === undefined) throw new Error("The mock Skill document is unavailable.");
    return this.ensureMockSkillWorkspace(skill.entryPath, document.content);
  }

  private ensureMockMcpWorkspace(server: McpServerConfiguration): MockConfigurationWorkspace {
    const key = `mcp:${server.id}`;
    let workspace = this.configurationWorkspaces.get(key);
    if (workspace === undefined) {
      workspace = {
        directories: new Set(["", "scripts"]),
        files: new Map([["mcp.json", `${JSON.stringify(server, null, 2)}\n`]]),
      };
      this.configurationWorkspaces.set(key, workspace);
    }
    return workspace;
  }

  private ensureMockSkillWorkspace(
    entryPath: string,
    content: string,
  ): MockConfigurationWorkspace {
    const key = this.skillWorkspaceKey(entryPath);
    let workspace = this.configurationWorkspaces.get(key);
    if (workspace === undefined) {
      workspace = {
        directories: new Set(["", "assets", "references", "scripts"]),
        files: new Map([["SKILL.md", content]]),
      };
      this.configurationWorkspaces.set(key, workspace);
    }
    return workspace;
  }

  private skillWorkspaceKey(entryPath: string): string {
    return `skill:${entryPath}`;
  }

  private configurationWorkspaceRootPath(
    kind: ConfigurationWorkspaceKind,
    configurationId: string,
  ): string {
    return kind === "mcp"
      ? `C:\\mock-settings\\mcp\\${configurationId}`
      : `C:\\mock-settings\\skills\\${configurationId}`;
  }

  private isProtectedConfigurationWorkspacePath(
    kind: ConfigurationWorkspaceKind,
    path: string,
  ): boolean {
    return path === (kind === "mcp" ? "mcp.json" : "SKILL.md");
  }

  private assertConfigurationWorkspacePath(path: string, allowRoot = false): string {
    if (allowRoot && path.length === 0) return path;
    if (
      path.startsWith("/")
      || path.includes("\\")
      || path.includes("\u0000")
      || path.split("/").some((segment) => segment.length === 0 || segment === "." || segment === "..")
    ) {
      throw new Error("The mock configuration workspace path is invalid.");
    }
    return path;
  }

  private toConfigurationWorkspaceFile(
    kind: ConfigurationWorkspaceKind,
    configurationId: string,
    path: string,
    content: string,
  ): ConfigurationWorkspaceFile {
    return {
      byteLength: new TextEncoder().encode(content).byteLength,
      configurationId,
      content,
      isBinary: false,
      isProtected: this.isProtectedConfigurationWorkspacePath(kind, path),
      kind,
      name: path.split("/").at(-1) ?? path,
      path,
      truncated: false,
    };
  }

  private mutatePendingMessage(
    pendingMessageId: string,
    update: (message: ConversationPendingMessage) => ConversationPendingMessage,
  ): Promise<ConversationPendingMessage[]> {
    for (const [conversationId, pending] of this.pendingMessages) {
      const index = pending.findIndex((message) => message.id === pendingMessageId);
      if (index < 0) continue;
      const updated = pending.map((message, messageIndex) =>
        messageIndex === index ? update(message) : message
      );
      this.pendingMessages.set(conversationId, updated);
      this.emitConversationRunEvent({
        conversationId,
        pendingMessages: structuredClone(updated),
        type: "pending_messages.updated",
      });
      return Promise.resolve(structuredClone(updated));
    }
    return Promise.reject(new Error("The mock pending message is unavailable."));
  }

  private emitConversationRunEvent(event: ConversationRunEvent): void {
    for (const listener of this.conversationListeners) {
      listener(event);
    }
  }
}
