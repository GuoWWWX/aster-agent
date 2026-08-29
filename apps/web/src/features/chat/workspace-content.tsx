import {
  Bot,
  ArrowDown,
  ArrowUp,
  AtSign,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Check,
  Copy,
  Eye,
  FileDiff,
  FileSearch,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  GitFork,
  Image as ImageIcon,
  LoaderCircle,
  List,
  ListEnd,
  ListTodo,
  MessageSquareText,
  Paperclip,
  Pencil,
  Search,
  Send,
  SendHorizontal,
  ShieldCheck,
  SlidersHorizontal,
  Square,
  SquarePen,
  Terminal,
  Trash2,
  UsersRound,
  WifiOff,
  Wrench,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  Fragment,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type CSSProperties,
  type Dispatch,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";

import type {
  AgentAvatarIcon,
  ContextCompressionConfiguration,
  ApproveToolChangeInput,
  ConversationAttachment,
  ConversationMessageDeliveryMode,
  ConversationModelSelection,
  ConversationMessageItem,
  ConversationPendingMessage,
  ConversationContextUsage,
  ConversationPermissionMode,
  ConversationRunEvent,
  ConversationSummary,
  ConversationTaskList,
  ConversationTimelineItem,
  ConversationToolItem,
  ModelReasoningOption,
  ModelProfile,
  ModelRuntimeStatus,
  ProjectEntry,
  ProjectSummary,
} from "@agent/protocol";
import {
  agentAvatarIconSchema,
  DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  isReasoningOptionEnabled,
  modelReasoningOptionKey,
  redactErrorIdentifiers,
} from "@agent/protocol";

import { IconButton } from "../../components/ui/icon-button.js";
import { AgentMarkdown } from "../../components/markdown/agent-markdown.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import {
  Slider,
  SliderRange,
  SliderThumb,
  SliderTrack,
} from "../../components/ui/slider.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import {
  getCachedModelStatus,
  loadModelStatus,
  rememberModelStatus,
} from "../../runtime/model-status-cache.js";
import {
  useAgentDirectoryStore,
  type AgentProfile,
} from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { useApplicationSettingsStore } from "../../stores/application-settings-store.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationProjectPicker } from "../projects/conversation-project-picker.js";
import { ModelProfilePicker } from "../settings/model-profile-picker.js";
import { SettingsWorkspace } from "../settings/settings-workspace.js";
import { reasoningOptionDisplayName } from "../settings/model-reasoning-options.js";
import { TaskWorkspace } from "../tasks/task-workspace.js";
import { AgentAvatar } from "../team/agent-avatar.js";
import { TeamWorkspace } from "../team/team-workspace.js";
import { useConversationWorkspaceCache } from "./conversation-workspace-cache.js";
import { formatConversationRunMarkdown } from "./conversation-copy.js";
import { ContextUsageIndicator } from "./context-usage-indicator.js";
import { isConversationScrolledToBottom } from "./conversation-scroll.js";
import {
  appendAssistantDelta,
  completeStreamingAssistantMessages,
  shouldApplyTimelineLoad,
} from "./conversation-timeline-state.js";
import {
  summarizeTaskFileChanges,
  type TaskFileChangeSummary,
} from "./task-file-change-summary.js";
import "./workspace-content.css";

type WorkspaceContentProps = {
  activeProject: ProjectSummary | null;
  activeSession: ProjectSession | null;
  agentClient: AgentClient;
  canAddProjects: boolean;
  isAddingProject: boolean;
  isCreatingSession: boolean;
  projects: readonly ProjectSummary[];
  sessions: readonly ProjectSession[];
  onAddProject: () => Promise<ProjectSummary | null>;
  onCreateProjectSession: (projectId: string) => void;
  onCreateTemporarySession: () => void;
  onForkConversation: (conversationId: string, throughMessageId: string) => Promise<void>;
  onLocateProject: (projectId: string) => void;
  onLocateSession: (sessionId: string) => void;
  onOpenProjectFile?: (projectId: string, path: string) => void;
  onOpenTeamConversation: (conversation: ConversationSummary) => void;
  onProjectSelected: (projectId: string) => void;
  onSessionSelected: (sessionId: string) => void;
  onSessionUpdated: (conversation: ConversationSummary) => void;
  onSessionViewed: (sessionId: string) => void;
};

type TimelineDisplayItem = ConversationTimelineItem | {
  batchId: string;
  id: string;
  kind: "tool_batch";
  tools: ConversationToolItem[];
};

type ModelActivity = {
  anchorTimelineItemId: string | null;
  attempt?: number;
  preview?: string;
  reason?: string;
  retryInMs?: number;
  runId: string | null;
  status: "thinking" | "retrying";
};

type LiveToolOutput = {
  exitCode: number | null;
  stderr: string;
  stdout: string;
  status: "running" | "completed" | "failed" | "cancelled";
  timedOut: boolean;
  truncated: boolean;
};

type RunProgress = {
  anchorTimelineItemId: string | null;
  outputStartedAt: number | null;
  runId: string | null;
  startedAt: number;
};

export type SubagentPendingApproval = {
  childConversationId: string;
  childTitle: string;
  tool: ConversationToolItem;
};

export function collectSubagentPendingApprovals(
  subagents: readonly Pick<ProjectSession, "activeRunId" | "id" | "title">[],
  timelines: ReadonlyMap<string, readonly ConversationTimelineItem[]>,
): SubagentPendingApproval[] {
  return subagents.flatMap((subagent) => {
    if (subagent.activeRunId === null) return [];
    return (timelines.get(subagent.id) ?? []).flatMap((item) =>
      item.kind === "tool"
      && item.runId === subagent.activeRunId
      && item.status === "awaiting_approval"
        ? [{ childConversationId: subagent.id, childTitle: subagent.title, tool: item }]
        : []
    );
  });
}

export function createRestoredRunProgresses(
  runId: string | null,
  startedAt = Date.now(),
): RunProgress[] {
  return runId === null
    ? []
    : [{ anchorTimelineItemId: null, outputStartedAt: null, runId, startedAt }];
}

type ConversationMention = Pick<
  ConversationSummary,
  "id" | "projectId" | "threadKind" | "title"
>;

type ProjectFileMention = Pick<ProjectEntry, "name" | "path"> & {
  workspaceId: string;
};

type TeamMention = {
  enabled: boolean;
  id: string;
  name: string;
};

type MentionOption =
  | { kind: "conversation"; value: ConversationMention }
  | { kind: "directory"; value: ProjectFileMention }
  | { kind: "file"; value: ProjectFileMention }
  | { kind: "team"; value: TeamMention };

type MentionQuery = {
  end: number;
  query: string;
  start: number;
};

const MAX_SELECTED_CONVERSATION_MENTIONS = 5;
const MAX_SELECTED_PROJECT_FILE_MENTIONS = 10;
const EMPTY_PROJECT_SESSIONS: readonly ProjectSession[] = [];

const SLASH_COMMANDS = [
  { description: "先拆分步骤并创建任务清单", name: "plan", title: "规划任务" },
  { description: "审查实现中的缺陷、风险和回归", name: "review", title: "审查代码" },
  { description: "运行相关测试并根据结果修复", name: "test", title: "运行测试" },
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number];

type ConversationReasoningControlProps = {
  disabled: boolean;
  fallbackOption?: ModelReasoningOption | null;
  onValueChange: (value: string) => void;
  options: readonly ModelReasoningOption[];
  selectedKey: string;
};

function ConversationReasoningControl({
  disabled,
  fallbackOption,
  onValueChange,
  options,
  selectedKey,
}: ConversationReasoningControlProps): ReactElement {
  const [mode, setMode] = useState<"slider" | "list">("slider");
  const [open, setOpen] = useState(false);
  const [isMaxEffectActive, setIsMaxEffectActive] = useState(false);
  const maxEffectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectedOption = options.find(
    (option) => modelReasoningOptionKey(option) === selectedKey,
  );
  const fallbackSelectedOption = fallbackOption !== null
    && fallbackOption !== undefined
    && modelReasoningOptionKey(fallbackOption) === selectedKey
    ? fallbackOption
    : undefined;
  const selectedIndex = selectedOption === undefined
    ? 0
    : options.findIndex((option) => modelReasoningOptionKey(option) === selectedKey) + 1;
  const progress = options.length === 0 ? 0 : (selectedIndex / options.length) * 100;
  const displayName = selectedOption === undefined
    ? fallbackSelectedOption === undefined
      ? "自动"
      : reasoningOptionDisplayName(fallbackSelectedOption)
    : reasoningOptionDisplayName(selectedOption);
  const isDisabled = disabled || options.length === 0;
  const strengthWeight = Math.round(progress * 0.46);
  const isMaximumStrength = options.length > 0 && selectedIndex === options.length;
  const maximumOptionKey = options.length > 0
    ? modelReasoningOptionKey(options[options.length - 1]!)
    : null;
  const sliderStyle = {
    "--reasoning-fill": selectedIndex === 0
      ? "color-mix(in srgb, var(--app-muted-foreground) 58%, var(--app-accent))"
      : isMaximumStrength
        ? "var(--reasoning-maximum)"
      : `color-mix(in srgb, var(--app-accent) ${100 - strengthWeight}%, var(--reasoning-strong) ${strengthWeight}%)`,
    "--reasoning-progress": `${progress}%`,
  } as CSSProperties;
  const labels = [
    "自动",
    ...options.map((option) => reasoningOptionDisplayName(option)),
  ];

  useEffect(() => () => {
    if (maxEffectTimerRef.current !== null) {
      clearTimeout(maxEffectTimerRef.current);
    }
  }, []);

  const updateMaxEffect = (isMaximum: boolean): void => {
    if (maxEffectTimerRef.current !== null) {
      clearTimeout(maxEffectTimerRef.current);
      maxEffectTimerRef.current = null;
    }

    setIsMaxEffectActive(isMaximum);
    if (isMaximum) {
      maxEffectTimerRef.current = setTimeout(() => {
        setIsMaxEffectActive(false);
        maxEffectTimerRef.current = null;
      }, 900);
    }
  };

  const selectSliderValue = (value: string): void => {
    const index = Number(value);
    const option = options[index - 1];
    updateMaxEffect(option !== undefined && index === options.length);
    onValueChange(option === undefined ? "auto" : modelReasoningOptionKey(option));
  };

  const selectReasoningOption = (value: string): void => {
    updateMaxEffect(value === maximumOptionKey);
    onValueChange(value);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          aria-label={`推理强度：${displayName}`}
          className="conversation-workspace__reasoning-trigger"
          disabled={isDisabled}
          title={`推理强度：${displayName}`}
          type="button"
        >
          <span>{displayName}</span>
          <ChevronDown aria-hidden="true" size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        alignOffset={5}
        className="conversation-workspace__reasoning-popover"
        side="top"
        sideOffset={8}
      >
        <header className="conversation-workspace__reasoning-popover-header">
          <span>
            <strong>推理强度</strong>
          </span>
          <IconButton
            className="conversation-workspace__reasoning-mode-toggle"
            label={mode === "slider" ? "切换为列表选择" : "切换为滑块选择"}
            size="compact"
            variant="quiet"
            onClick={() => setMode((current) => current === "slider" ? "list" : "slider")}
          >
            {mode === "slider"
              ? <List aria-hidden="true" size={14} />
              : <SlidersHorizontal aria-hidden="true" size={14} />}
          </IconButton>
        </header>
        {mode === "slider" ? (
          <div className="conversation-workspace__reasoning-slider-panel">
            <Slider
              aria-label="推理强度"
              className="conversation-workspace__reasoning-slider"
              data-max-effect={isMaxEffectActive ? "active" : undefined}
              disabled={isDisabled}
              max={Math.max(options.length, 1)}
              min={0}
              step={1}
              style={sliderStyle}
              value={[selectedIndex]}
              onValueChange={(values) => selectSliderValue(String(values[0] ?? 0))}
            >
              <SliderTrack className="conversation-workspace__reasoning-track">
                <SliderRange className="conversation-workspace__reasoning-range" />
              </SliderTrack>
              <SliderThumb
                aria-label="推理强度"
                aria-valuetext={displayName}
                className="conversation-workspace__reasoning-thumb"
              />
            </Slider>
            <div
              className="conversation-workspace__reasoning-scale"
              style={{ gridTemplateColumns: `repeat(${labels.length}, minmax(0, 1fr))` }}
            >
              {labels.map((label, index) => (
                <span
                  className={index === selectedIndex ? "is-selected" : undefined}
                  key={`${label}-${index}`}
                >
                  {label}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="conversation-workspace__reasoning-option-list" role="listbox" aria-label="推理强度选项">
            <button
              aria-selected={selectedOption === undefined}
              className={selectedOption === undefined ? "is-selected" : undefined}
              role="option"
              type="button"
              onClick={() => selectReasoningOption("auto")}
            >
              <span>自动</span>
              {selectedOption === undefined ? <Check aria-hidden="true" size={14} /> : null}
            </button>
            {options.map((option) => {
              const optionKey = modelReasoningOptionKey(option);
              const isSelected = optionKey === selectedKey;
              return (
                <button
                  aria-selected={isSelected}
                  className={isSelected ? "is-selected" : undefined}
                  key={optionKey}
                  role="option"
                  type="button"
                  onClick={() => selectReasoningOption(optionKey)}
                >
                  <span>{reasoningOptionDisplayName(option)}</span>
                  {isSelected ? <Check aria-hidden="true" size={14} /> : null}
                </button>
              );
            })}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

export function WorkspaceContent({
  activeProject,
  activeSession,
  agentClient,
  canAddProjects,
  isAddingProject,
  isCreatingSession,
  projects,
  onAddProject,
  onCreateProjectSession,
  onCreateTemporarySession,
  onForkConversation,
  onLocateProject,
  onLocateSession,
  onOpenProjectFile,
  onOpenTeamConversation,
  onProjectSelected,
  onSessionSelected,
  onSessionUpdated,
  onSessionViewed,
  sessions,
}: WorkspaceContentProps): ReactElement {
  const activeActivity = useWorkbenchUiStore((state) => state.activeActivity);
  const retainedSessions = useConversationWorkspaceCache(
    activeActivity === "conversations" ? activeSession : null,
    sessions,
  );

  if (activeActivity === "team") {
    return (
      <TeamWorkspace
        agentClient={agentClient}
        projects={projects}
        onOpenConversation={onOpenTeamConversation}
      />
    );
  }

  if (activeActivity === "tasks") {
    return <TaskWorkspace activeProject={activeProject} />;
  }

  if (activeActivity === "settings") {
    return <SettingsWorkspace agentClient={agentClient} />;
  }

  if (activeSession === null) {
    return (
      <ProjectConversationEmpty
        activeProject={activeProject}
        isCreatingSession={isCreatingSession}
        onCreateProjectSession={onCreateProjectSession}
        onCreateTemporarySession={onCreateTemporarySession}
      />
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      {retainedSessions.map((session) => {
        const isActive = session.id === activeSession.id;
        const conversationProject = session.projectId === null
          ? null
          : projects.find((project) => project.id === session.projectId) ?? null;
        const projectId = session.projectId;
        return (
          <div
            aria-hidden={!isActive}
            className={isActive ? "flex min-h-0 flex-1" : "hidden"}
            key={session.id}
          >
            <ConversationWorkspace
              agentClient={agentClient}
              canAddProjects={canAddProjects}
              isAddingProject={isAddingProject}
              onLocateProject={onLocateProject}
              onLocateSession={onLocateSession}
              onOpenProjectFile={projectId === null || onOpenProjectFile === undefined
                ? undefined
                : (path) => {
                    onOpenProjectFile?.(projectId, path);
                  }}
              onForkConversation={onForkConversation}
              onAddProject={onAddProject}
              onProjectSelected={onProjectSelected}
               onSessionSelected={onSessionSelected}
               onSessionUpdated={onSessionUpdated}
               onViewed={() => onSessionViewed(session.id)}
               project={conversationProject}
              projects={projects}
              relatedSessions={sessions}
              session={session}
              teamManaged={session.teamWorkItemId !== null && session.teamWorkItemId !== undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

export function ConversationWorkspace({
  agentClient,
  canAddProjects = false,
  compact = false,
  isAddingProject = false,
  onAddProject,
  onLocateProject,
  onLocateSession,
  onOpenProjectFile,
  onForkConversation,
  onProjectSelected,
  onSessionSelected,
  onSessionUpdated,
  onViewed,
  project,
  projects = [],
  relatedSessions = EMPTY_PROJECT_SESSIONS,
  session,
  teamManaged = false,
}: {
  agentClient: AgentClient;
  canAddProjects?: boolean;
  compact?: boolean;
  isAddingProject?: boolean;
  onAddProject?: () => Promise<ProjectSummary | null>;
  onLocateProject?: (projectId: string) => void;
  onLocateSession?: (sessionId: string) => void;
  onOpenProjectFile?: ((path: string) => void) | undefined;
  onForkConversation?: (conversationId: string, throughMessageId: string) => Promise<void>;
  onProjectSelected?: (projectId: string) => void;
  onSessionSelected?: (sessionId: string) => void;
  onSessionUpdated?: (conversation: ConversationSummary) => void;
  onViewed?: () => void;
  project: ProjectSummary | null;
  projects?: readonly ProjectSummary[];
  relatedSessions?: readonly ProjectSession[];
  session: ProjectSession;
  /** A Team WorkItem owns execution policy; its Timeline still supports controlled user input. */
  teamManaged?: boolean;
}): ReactElement {
  const headingId = useId();
  const agentProfiles = useAgentDirectoryStore((state) => state.agents);
  const teams = useAgentDirectoryStore((state) => state.teams);
  const defaultAgent = agentProfiles.find((agent) => agent.isDefault)
    ?? agentProfiles[0];
  const defaultMessageDeliveryMode = useApplicationSettingsStore(
    (state) => state.defaultMessageDeliveryMode,
  );
  const defaultPermissionMode = useApplicationSettingsStore(
    (state) => state.defaultPermissionMode,
  );
  const sendShortcut = useApplicationSettingsStore((state) => state.sendShortcut);
  const showContextUsage = useApplicationSettingsStore((state) => state.showContextUsage);
  const [activeRunId, setActiveRunId] = useState<string | null>(
    session.activeRunId,
  );
  const [activeSubagentCount, setActiveSubagentCount] = useState(
    session.activeSubagentCount ?? 0,
  );
  const [selectedAgentId, setSelectedAgentId] = useState(() =>
    readConversationAgentSelection(
      session.id,
      session.agentId ?? defaultAgent?.id ?? "",
    ),
  );
  const [composerValue, setComposerValue] = useState("");
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const messageDeliveryMode: ConversationMessageDeliveryMode = defaultMessageDeliveryMode;
  const [availableConversationMentions, setAvailableConversationMentions] =
    useState<ConversationMention[]>([]);
  const [selectedConversationMentions, setSelectedConversationMentions] =
    useState<ConversationMention[]>([]);
  const [selectedTeamMentions, setSelectedTeamMentions] = useState<TeamMention[]>([]);
  const [selectedProjectFileMentions, setSelectedProjectFileMentions] =
    useState<ProjectFileMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const [mentionSelectionIndex, setMentionSelectionIndex] = useState(0);
  const [projectMentionListing, setProjectMentionListing] = useState<{
    directoryPath: string;
    entries: ProjectEntry[];
    workspaceId: string;
  } | null>(null);
  const [slashQuery, setSlashQuery] = useState<MentionQuery | null>(null);
  const [draftAttachments, setDraftAttachments] = useState<ConversationAttachment[]>([]);
  const [contextCompressionConfiguration, setContextCompressionConfiguration] =
    useState<ContextCompressionConfiguration>(DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION);
  const [contextUsage, setContextUsage] =
    useState<ConversationContextUsage | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isChangingWorkspace, setIsChangingWorkspace] = useState(false);
  const [isChangingProject, setIsChangingProject] = useState(false);
  const [isChoosingAttachments, setIsChoosingAttachments] = useState(false);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(true);
  const [isMockRuntime, setIsMockRuntime] = useState(false);
  const [isSavingTeamPermission, setIsSavingTeamPermission] = useState(false);
  const [isSending, setIsSending] = useState(false);
  const [liveToolOutputs, setLiveToolOutputs] = useState<Record<string, LiveToolOutput>>({});
  const [modelActivity, setModelActivity] = useState<ModelActivity | null>(null);
  const initialModelStatus = getCachedModelStatus(agentClient);
  const initialModelSelection = resolveInitialConversationModelSelection(
    session.modelSelection,
    initialModelStatus,
  );
  const [modelStatus, setModelStatus] = useState<ModelRuntimeStatus | null>(initialModelStatus);
  const [runProgresses, setRunProgresses] = useState<RunProgress[]>(() =>
    createRestoredRunProgresses(session.activeRunId),
  );
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<ConversationPendingMessage[]>([]);
  const [pendingMessageActionId, setPendingMessageActionId] = useState<string | null>(null);
  const [approvingToolId, setApprovingToolId] = useState<string | null>(null);
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});
  const [editingPendingMessageId, setEditingPendingMessageId] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] =
    useState<ConversationPermissionMode>(defaultPermissionMode);
  const [selectedModelKey, setSelectedModelKey] = useState(() => (
    initialModelSelection === null
      ? ""
      : modelKey(initialModelSelection)
  ));
  const [selectedReasoningOptionKey, setSelectedReasoningOptionKey] = useState(() => (
    initialModelSelection?.reasoning === null || initialModelSelection?.reasoning === undefined
      ? "auto"
      : modelReasoningOptionKey(initialModelSelection.reasoning)
  ));
  const [taskListAction, setTaskListAction] = useState<"closing" | null>(null);
  const [taskList, setTaskList] = useState<ConversationTaskList | null>(null);
  const [isTaskListExpanded, setIsTaskListExpanded] = useState(false);
  const [timeline, setTimeline] = useState<ConversationTimelineItem[]>([]);
  const timelineRef = useRef<ConversationTimelineItem[]>([]);
  const timelineLoadRequestIdRef = useRef(0);
  const timelineRevisionRef = useRef(0);
  const [subagentApprovals, setSubagentApprovals] = useState<SubagentPendingApproval[]>([]);
  const subagentSessions = useMemo(
    () => relatedSessions.filter((candidate) =>
      candidate.parentConversationId === session.id
      && candidate.threadKind === "subagent"
    ),
    [relatedSessions, session.id],
  );
  const contextUsageRequestRef = useRef(0);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const copiedMessageTimeoutRef = useRef<number | null>(null);
  const isFinishedSubagent = !teamManaged && (
    session.subagentTaskStatus === "completed"
    || session.subagentTaskStatus === "failed"
    || session.subagentTaskStatus === "cancelled"
  );
  const isEditingComposerMessage = editingMessageId !== null || editingPendingMessageId !== null;
  const modelOptions: readonly ModelProfile[] =
    modelStatus?.models.length
      ? modelStatus.models
      : isMockRuntime
        ? [{
          connectionStatus: "unknown",
          connectionStatusUpdatedAt: null,
          contextWindow: 0,
          displayName: "mock-agent",
          modelId: "mock-agent",
          lastSuccessfulAt: null,
          providerApiFormat: "openai-chat-completions",
          providerBaseUrl: "https://mock.invalid/v1",
          providerId: "00000000-0000-4000-8000-000000000000",
          providerName: "浏览器预览",
          reasoningOptions: []
        }]
        : [];
  const enabledAgentProfiles = agentProfiles.filter((agent) => agent.enabled);
  const selectedAgent = enabledAgentProfiles.find((agent) => agent.id === selectedAgentId)
    ?? defaultAgent
    ?? enabledAgentProfiles[0];
  const inheritedSelection = session.modelSelection ?? modelStatus?.recentSelection ?? null;
  const defaultModel = modelOptions.find(
    (model) => model.providerId === inheritedSelection?.providerId
      && model.modelId === inheritedSelection.modelId,
  ) ?? modelOptions.find(
    (model) => model.providerId === modelStatus?.providerId && model.modelId === modelStatus.modelId,
  ) ?? (isMockRuntime ? modelOptions[0] : undefined);
  const activeModel = modelOptions.find(
    (model) => modelKey(model) === selectedModelKey,
  ) ?? defaultModel;
  const activeModelKey = activeModel === undefined ? "" : modelKey(activeModel);
  const activeReasoningOptions = (activeModel?.reasoningOptions ?? [])
    .filter(isReasoningOptionEnabled);
  const selectedReasoningOption = activeReasoningOptions.find(
    (option) => modelReasoningOptionKey(option) === selectedReasoningOptionKey,
  );
  const effectiveReasoningOptionKey = selectedReasoningOption === undefined
    ? activeModel === undefined ? selectedReasoningOptionKey : "auto"
    : selectedReasoningOptionKey;
  const modelDisplayName = activeModel?.displayName ?? session.modelSelection?.modelId ?? "未配置模型";

  useEffect(() => {
    const selection = session.modelSelection ?? modelStatus?.recentSelection ?? null;
    setSelectedModelKey(selection === null
      ? ""
      : modelKey({ modelId: selection.modelId, providerId: selection.providerId }));
    setSelectedReasoningOptionKey(selection?.reasoning === null || selection?.reasoning === undefined
      ? "auto"
      : modelReasoningOptionKey(selection.reasoning));
  }, [
    modelStatus?.recentSelection,
    session.id,
    session.modelSelection,
  ]);

  const persistModelSelection = useCallback(async (
    model: ModelProfile,
    reasoning: ModelReasoningOption | null,
  ): Promise<void> => {
    try {
      const conversation = await agentClient.setConversationModelSelection({
        conversationId: session.id,
        modelSelection: {
          modelId: model.modelId,
          providerId: model.providerId,
          reasoning,
        },
      });
      onSessionUpdated?.(conversation);
      const currentStatus = getCachedModelStatus(agentClient);
      if (currentStatus !== null && conversation.threadKind !== "subagent" && !teamManaged) {
        const nextStatus = rememberModelStatus(agentClient, {
          ...currentStatus,
          recentSelection: conversation.modelSelection,
        });
        setModelStatus(nextStatus);
      }
    } catch (error) {
      setOperationError(getUserErrorMessage(error, "无法保存对话模型选择"));
    }
  }, [agentClient, onSessionUpdated, session.id, teamManaged]);

  const selectModel = useCallback((model: ModelProfile): void => {
    setSelectedModelKey(modelKey(model));
    setSelectedReasoningOptionKey("auto");
    void persistModelSelection(model, null);
  }, [persistModelSelection]);

  const selectReasoning = useCallback((key: string): void => {
    setSelectedReasoningOptionKey(key);
    if (activeModel === undefined) return;
    const reasoning = key === "auto"
      ? null
      : activeReasoningOptions.find((option) => modelReasoningOptionKey(option) === key) ?? null;
    void persistModelSelection(activeModel, reasoning);
  }, [activeModel, activeReasoningOptions, persistModelSelection]);

  const selectPermissionMode = useCallback((value: string): void => {
    const nextPermissionMode = value as ConversationPermissionMode;
    if (!teamManaged || session.teamWorkItemId === null || session.teamWorkItemId === undefined) {
      setPermissionMode(nextPermissionMode);
      return;
    }
    if (nextPermissionMode === permissionMode || isSavingTeamPermission) return;
    setIsSavingTeamPermission(true);
    setOperationError(null);
    void agentClient.updateTeamWorkItemPermission({
      permissionMode: nextPermissionMode,
      workItemId: session.teamWorkItemId,
    }).then((workItem) => {
      setPermissionMode(workItem.permissionMode);
    }).catch((error) => {
      setOperationError(getUserErrorMessage(error, "无法保存团队权限模式"));
    }).finally(() => {
      setIsSavingTeamPermission(false);
    });
  }, [agentClient, isSavingTeamPermission, permissionMode, session.teamWorkItemId, teamManaged]);
  const referenceWorkspaceId = project?.id
    ?? (session.workspaceRootPath === null ? null : session.id);
  const activeProjectFileMentions = useMemo(
    () => selectedProjectFileMentions.filter(
      (mention) => mention.workspaceId === referenceWorkspaceId,
    ),
    [referenceWorkspaceId, selectedProjectFileMentions],
  );
  const latestUserMessageId = useMemo(() =>
    timeline.findLast((item) => item.kind === "message" && item.role === "user")?.id ?? null,
  [timeline]);
  const forkableAssistantMessageIds = useMemo(
    () => getFinalCompletedAssistantMessageIds(timeline),
    [timeline],
  );
  const projectMentionLocation = useMemo(
    () => mentionQuery === null || mentionQuery.query.length === 0
      ? null
      : parseProjectMentionQuery(mentionQuery.query),
    [mentionQuery],
  );

  const loadContextUsage = useCallback(async (): Promise<void> => {
    const requestId = contextUsageRequestRef.current + 1;
    contextUsageRequestRef.current = requestId;

    try {
      const nextUsage = await agentClient.getConversationContextUsage({
        attachmentIds: draftAttachments.map((attachment) => attachment.id),
        conversationId: session.id,
        ...(activeModel === undefined
          ? {}
          : { modelId: activeModel.modelId, providerId: activeModel.providerId }),
        permissionMode,
        ...(selectedConversationMentions.length === 0
          ? {}
          : {
            referencedConversationIds: selectedConversationMentions.map((mention) => mention.id),
          }),
        ...(activeProjectFileMentions.length === 0
          ? {}
          : {
            referencedProjectPaths: activeProjectFileMentions.map((mention) => mention.path),
          }),
      });
      if (contextUsageRequestRef.current === requestId) {
        setContextUsage(nextUsage);
      }
    } catch {
      if (contextUsageRequestRef.current === requestId) {
        setContextUsage(null);
      }
    }
  }, [
    activeModel,
    activeProjectFileMentions,
    agentClient,
    draftAttachments,
    permissionMode,
    selectedConversationMentions,
    session.id,
  ]);

  const loadTimeline = useCallback(async (): Promise<void> => {
    const conversationId = session.id;
    const requestId = ++timelineLoadRequestIdRef.current;
    const timelineRevision = timelineRevisionRef.current;
    try {
      const nextTimeline = await agentClient.listConversationTimeline({
        conversationId,
      });
      if (shouldApplyTimelineLoad(
        requestId,
        timelineLoadRequestIdRef.current,
        timelineRevision,
        timelineRevisionRef.current,
      )) {
        timelineRevisionRef.current += 1;
        timelineRef.current = nextTimeline;
        setTimeline(nextTimeline);
      }
    } catch {
      if (requestId === timelineLoadRequestIdRef.current) {
        setOperationError("无法加载对话记录");
      }
    } finally {
      if (requestId === timelineLoadRequestIdRef.current) {
        setIsLoadingTimeline(false);
      }
    }
  }, [agentClient, session.id]);

  useEffect(() => {
    let disposed = false;
    const activeSubagents = subagentSessions.filter((subagent) => subagent.activeRunId !== null);
    if (activeSubagents.length === 0) {
      setSubagentApprovals([]);
      return () => {
        disposed = true;
      };
    }

    void Promise.all(activeSubagents.map(async (subagent) => {
      try {
        const childTimeline = await agentClient.listConversationTimeline({
          conversationId: subagent.id,
        });
        return [subagent.id, childTimeline] as const;
      } catch {
        return [subagent.id, [] as ConversationTimelineItem[]] as const;
      }
    })).then((entries) => {
      if (disposed) return;
      setSubagentApprovals(collectSubagentPendingApprovals(
        activeSubagents,
        new Map(entries),
      ));
    });

    return () => {
      disposed = true;
    };
  }, [agentClient, subagentSessions]);

  const loadTaskList = useCallback(async (): Promise<void> => {
    try {
      setTaskList(await agentClient.getConversationTaskList({ conversationId: session.id }));
    } catch {
      setTaskList(null);
    }
  }, [agentClient, session.id]);

  const loadPendingMessages = useCallback(async (): Promise<void> => {
    try {
      setPendingMessages(await agentClient.listConversationPendingMessages({
        conversationId: session.id,
      }));
    } catch {
      setPendingMessages([]);
    }
  }, [agentClient, session.id]);

  const loadDraftAttachments = useCallback(async (): Promise<void> => {
    try {
      setDraftAttachments(await agentClient.listDraftConversationAttachments({
        conversationId: session.id,
      }));
    } catch {
      setDraftAttachments([]);
    }
  }, [agentClient, session.id]);

  useEffect(() => {
    void Promise.resolve().then(loadTimeline);
  }, [loadTimeline]);

  useEffect(() => {
    void Promise.resolve().then(loadTaskList);
  }, [loadTaskList]);

  useEffect(() => {
    void Promise.resolve().then(loadPendingMessages);
  }, [loadPendingMessages]);

  useEffect(() => {
    void Promise.resolve().then(loadDraftAttachments);
  }, [loadDraftAttachments]);

  useEffect(() => {
    if (!teamManaged || session.teamWorkItemId === null || session.teamWorkItemId === undefined) return;
    let disposed = false;
    void agentClient.listTeamWorkItems({}).then((workItems) => {
      const workItem = workItems.find((candidate) => candidate.id === session.teamWorkItemId);
      if (!disposed && workItem !== undefined) setPermissionMode(workItem.permissionMode);
    }).catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [agentClient, session.id, session.teamWorkItemId, teamManaged]);

  useEffect(() => {
    const awaitingApprovalToolIds = new Set(
      [
        ...timeline.flatMap((item) =>
          item.kind === "tool" && item.status === "awaiting_approval" ? [item.id] : []
        ),
        ...subagentApprovals.map((approval) => approval.tool.id),
      ],
    );
    setApprovalErrors((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([toolId]) => awaitingApprovalToolIds.has(toolId)),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [subagentApprovals, timeline]);

  useEffect(() => {
    void Promise.resolve().then(loadContextUsage);
  }, [loadContextUsage]);

  useEffect(() => () => {
    if (copiedMessageTimeoutRef.current !== null) {
      window.clearTimeout(copiedMessageTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    let disposed = false;
    void agentClient.listConversations()
      .then(async (conversations) => {
        const forks = await Promise.all(
          conversations.map((conversation) =>
            agentClient.listConversationForks({ conversationId: conversation.id })
              .catch(() => []),
          ),
        );
        if (disposed) return;
        setAvailableConversationMentions(
          [...conversations, ...forks.flat()]
            .filter((conversation) =>
              conversation.id !== session.id && !conversation.isArchived
            )
            .map(({ id, projectId, threadKind, title }) => ({
              id,
              projectId,
              threadKind,
              title,
            })),
        );
      })
      .catch(() => {
        if (!disposed) setAvailableConversationMentions([]);
      });
    return () => {
      disposed = true;
    };
  }, [agentClient, session.id]);

  useEffect(() => {
    const directoryPath = projectMentionLocation?.directoryPath;
    if (referenceWorkspaceId === null || directoryPath === undefined) return;
    let disposed = false;
    void agentClient.listProjectEntries({
      directoryPath,
      projectId: referenceWorkspaceId,
    }).then((listing) => {
      if (disposed) return;
      setProjectMentionListing({
        directoryPath: listing.directoryPath,
        entries: listing.entries,
        workspaceId: referenceWorkspaceId,
      });
    }).catch(() => {
      if (disposed) return;
      setProjectMentionListing({
        directoryPath,
        entries: [],
        workspaceId: referenceWorkspaceId,
      });
    });
    return () => {
      disposed = true;
    };
  }, [agentClient, projectMentionLocation?.directoryPath, referenceWorkspaceId]);

  useEffect(() => {
    let disposed = false;

    void Promise.all([
      agentClient.getCapabilities(),
      loadModelStatus(agentClient),
      agentClient.getContextCompressionConfiguration()
        .catch(() => DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION),
    ])
      .then(([capabilities, status, contextCompression]) => {
        if (disposed) {
          return;
        }

        setIsMockRuntime(capabilities.mode === "mock");
        setModelStatus(status);
        setContextCompressionConfiguration(contextCompression);
      })
      .catch(() => {
        if (!disposed) {
          setOperationError("无法读取模型状态");
        }
      });

    return () => {
      disposed = true;
    };
  }, [agentClient]);

  useEffect(() => {
    timelineRef.current = timeline;
  }, [timeline]);

  useEffect(() => {
    setActiveRunId(session.activeRunId);
    setIsCancelling(false);
    setModelActivity((current) => current?.runId === session.activeRunId ? current : null);
    setRunProgresses(createRestoredRunProgresses(session.activeRunId));
    setLiveToolOutputs({});
  }, [session.activeRunId, session.id]);

  useEffect(() => {
    return agentClient.onConversationRunEvent((event) => {
      const sourceSubagent = "conversationId" in event
        ? subagentSessions.find((candidate) => candidate.id === event.conversationId)
        : undefined;
      if (event.type === "tool.approval_requested" && sourceSubagent !== undefined) {
        setSubagentApprovals((current) => [
          ...current.filter((approval) => approval.tool.id !== event.tool.id),
          {
            childConversationId: sourceSubagent.id,
            childTitle: sourceSubagent.title,
            tool: event.tool,
          },
        ]);
      }
      if (event.type === "tool.completed" && sourceSubagent !== undefined) {
        setSubagentApprovals((current) =>
          current.filter((approval) => approval.tool.id !== event.tool.id)
        );
      }
      if (event.type === "run.finished" && sourceSubagent !== undefined) {
        setSubagentApprovals((current) => current.filter((approval) =>
          approval.childConversationId !== sourceSubagent.id
          || approval.tool.runId !== event.runId
        ));
      }
      if (event.type === "task_list.updated" && event.conversationId === session.id) {
        setTaskList(event.taskList);
        if (event.taskList === null) setIsTaskListExpanded(false);
        return;
      }
      if (event.type === "pending_messages.updated" && event.conversationId === session.id) {
        setPendingMessages(event.pendingMessages);
        void loadTimeline();
        return;
      }
      if (event.type === "conversation.updated") {
        if (event.conversation.id === session.id) {
          setActiveRunId(event.conversation.activeRunId);
          setActiveSubagentCount(event.conversation.activeSubagentCount);
        }
        return;
      }
      if (event.conversationId !== session.id) {
        return;
      }

      timelineRevisionRef.current += 1;
      handleRunEvent(
        event,
        setTimeline,
        setActiveRunId,
        setIsCancelling,
        timelineRef,
        setModelActivity,
        setRunProgresses,
        setLiveToolOutputs,
      );
      if (event.type === "run.started") {
        void loadTimeline();
      }
      if (event.type === "run.finished") {
        void loadTimeline();
        void loadTaskList();
      }
      if (event.type !== "assistant.delta" && event.type !== "assistant.reasoning_delta") {
        void loadContextUsage();
      }
    });
  }, [
    agentClient,
    loadContextUsage,
    loadTaskList,
    loadTimeline,
    session.id,
    subagentSessions,
  ]);

  const handleMessagesScroll = useCallback((): void => {
    const messages = messagesRef.current;
    if (messages === null) return;
    shouldStickToBottomRef.current = isConversationScrolledToBottom(messages);
  }, []);

  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (messages === null || !shouldStickToBottomRef.current) return;

    const scrollToBottom = (): void => {
      if (shouldStickToBottomRef.current) messages.scrollTop = messages.scrollHeight;
    };
    scrollToBottom();
    const animationFrame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [isLoadingTimeline, modelActivity, operationError, taskList, timeline]);

  const handleCopyMessage = useCallback(async (
    message: ConversationMessageItem,
  ): Promise<void> => {
    try {
      await agentClient.writeClipboardText(
        message.role === "user"
          ? message.content
          : formatConversationRunMarkdown(timelineRef.current, message),
      );
      if (copiedMessageTimeoutRef.current !== null) {
        window.clearTimeout(copiedMessageTimeoutRef.current);
      }
      setCopiedMessageId(message.id);
      copiedMessageTimeoutRef.current = window.setTimeout(() => {
        setCopiedMessageId(null);
        copiedMessageTimeoutRef.current = null;
      }, 1_500);
    } catch {
      setCopiedMessageId(null);
      setOperationError("无法复制这条消息");
    }
  }, [agentClient]);

  const handleForkMessage = useCallback(async (
    message: ConversationMessageItem,
  ): Promise<void> => {
    if (
      onForkConversation === undefined
      || forkingMessageId !== null
      || !forkableAssistantMessageIds.has(message.id)
    ) {
      return;
    }
    setForkingMessageId(message.id);
    setOperationError(null);
    try {
      await onForkConversation(session.id, message.id);
    } catch (error) {
      setOperationError(getUserErrorMessage(error, "无法从这条回复创建分支对话"));
    } finally {
      setForkingMessageId(null);
    }
  }, [
    forkableAssistantMessageIds,
    forkingMessageId,
    onForkConversation,
    session.id,
  ]);

  const handleEditMessage = useCallback((message: ConversationMessageItem): void => {
    if (message.id !== latestUserMessageId || isFinishedSubagent) return;
    setEditingPendingMessageId(null);
    setEditingMessageId(message.id);
    setComposerValue(message.content);
    setMentionQuery(null);
    setSlashQuery(null);
    setSelectedConversationMentions([]);
    setSelectedTeamMentions([]);
    setSelectedProjectFileMentions([]);
    setOperationError(null);
    queueMicrotask(() => {
      const composer = composerRef.current;
      if (composer === null) return;
      composer.focus();
      composer.setSelectionRange(composer.value.length, composer.value.length);
    });
  }, [isFinishedSubagent, latestUserMessageId]);

  const handleCancelEditing = useCallback((): void => {
    setEditingMessageId(null);
    setEditingPendingMessageId(null);
    setComposerValue("");
    setMentionQuery(null);
    setSlashQuery(null);
    setSelectedConversationMentions([]);
    setSelectedTeamMentions([]);
    setSelectedProjectFileMentions([]);
    queueMicrotask(() => composerRef.current?.focus());
  }, []);

  const handleEditPendingMessage = useCallback((message: ConversationPendingMessage): void => {
    if (isFinishedSubagent) return;
    setEditingMessageId(null);
    setEditingPendingMessageId(message.id);
    setComposerValue(message.content);
    setMentionQuery(null);
    setSlashQuery(null);
    setSelectedConversationMentions([]);
    setSelectedTeamMentions([]);
    setSelectedProjectFileMentions([]);
    setOperationError(null);
    queueMicrotask(() => {
      const composer = composerRef.current;
      if (composer === null) return;
      composer.focus();
      composer.setSelectionRange(composer.value.length, composer.value.length);
    });
  }, [isFinishedSubagent]);

  const refocusComposer = (): void => {
    window.setTimeout(() => {
      const composer = composerRef.current;
      if (composer === null || composer.disabled) return;
      composer.focus();
    }, 0);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const content = composerValue.trim();
    const hasNoSubmitContent = isEditingComposerMessage
      ? content.length === 0
      : content.length === 0
        && draftAttachments.length === 0
        && activeProjectFileMentions.length === 0;
    if (
      hasNoSubmitContent ||
      pendingMessageActionId !== null ||
      isSending ||
      isFinishedSubagent ||
      (editingPendingMessageId === null
        && !isMockRuntime
        && modelStatus?.configured === false)
    ) {
      return;
    }

    if (editingPendingMessageId !== null) {
      setPendingMessageActionId(editingPendingMessageId);
      setOperationError(null);
      try {
        const updatedMessages = await agentClient.updateConversationPendingMessage({
          content,
          pendingMessageId: editingPendingMessageId,
        });
        setPendingMessages((current) => mergePendingMessageUpdate(current, updatedMessages));
        setEditingPendingMessageId(null);
        setComposerValue("");
        setMentionQuery(null);
        setSlashQuery(null);
        setSelectedConversationMentions([]);
        setSelectedTeamMentions([]);
        setSelectedProjectFileMentions([]);
      } catch (error) {
        setOperationError(getUserErrorMessage(error, "无法修改排队消息"));
      } finally {
        setPendingMessageActionId(null);
        refocusComposer();
      }
      return;
    }

    setIsSending(true);
    if (activeRunId === null) {
      beginRunProgress(
        setRunProgresses,
        null,
        timelineRef.current.at(-1)?.id ?? null,
      );
      setModelActivity({
        anchorTimelineItemId: timelineRef.current.at(-1)?.id ?? null,
        runId: null,
        status: "thinking",
      });
    }
    setOperationError(null);
    try {
      if (editingMessageId !== null) {
        const accepted = await agentClient.replaceLatestConversationMessage({
          content,
          conversationId: session.id,
          messageId: editingMessageId,
          ...(activeModel === undefined
            ? {}
            : { modelId: activeModel.modelId, providerId: activeModel.providerId }),
          permissionMode,
          ...(selectedConversationMentions.length === 0
            ? {}
            : {
              referencedConversationIds: selectedConversationMentions.map((mention) => mention.id),
            }),
          ...(activeProjectFileMentions.length === 0
            ? {}
            : {
              referencedProjectPaths: activeProjectFileMentions.map((mention) => mention.path),
            }),
          ...(selectedReasoningOption === undefined ? {} : { reasoning: selectedReasoningOption }),
        });
        timelineRevisionRef.current += 1;
        setTimeline((current) => {
          const next = replaceTimelineFromMessage(current, accepted.userMessage);
          timelineRef.current = next;
          return next;
        });
        setActiveRunId(accepted.runId);
        confirmRunProgress(setRunProgresses, accepted.runId, accepted.userMessage.id);
        setModelActivity({
          anchorTimelineItemId: accepted.userMessage.id,
          runId: accepted.runId,
          status: "thinking",
        });
        setEditingMessageId(null);
        void loadTimeline();
      } else {
        const accepted = await agentClient.sendConversationMessage({
          ...(selectedAgent === undefined
            ? {}
            : { agent: toConversationAgentBinding(selectedAgent) }),
          content,
          conversationId: session.id,
          deliveryMode: messageDeliveryMode,
          ...(draftAttachments.length === 0
            ? {}
            : { attachmentIds: draftAttachments.map((attachment) => attachment.id) }),
          ...(activeModel === undefined
            ? {}
            : { modelId: activeModel.modelId, providerId: activeModel.providerId }),
          permissionMode,
          ...(selectedConversationMentions.length === 0
            ? {}
            : {
              referencedConversationIds: selectedConversationMentions.map((mention) => mention.id),
            }),
          ...(activeProjectFileMentions.length === 0
            ? {}
            : {
              referencedProjectPaths: activeProjectFileMentions.map((mention) => mention.path),
            }),
          ...(selectedReasoningOption === undefined ? {} : { reasoning: selectedReasoningOption }),
        });
        if (accepted.kind === "started") {
          timelineRevisionRef.current += 1;
          setTimeline((current) => {
            const next = upsertTimelineItem(current, accepted.userMessage);
            timelineRef.current = next;
            return next;
          });
          setActiveRunId(accepted.runId);
          confirmRunProgress(setRunProgresses, accepted.runId, accepted.userMessage.id);
          setModelActivity({
            anchorTimelineItemId: accepted.userMessage.id,
            runId: accepted.runId,
            status: "thinking",
          });
        } else {
          setPendingMessages((current) => [
            ...current.filter((message) => message.id !== accepted.pendingMessage.id),
            accepted.pendingMessage,
          ]);
        }
        setDraftAttachments([]);
      }
      setComposerValue("");
      setMentionQuery(null);
      setSlashQuery(null);
      setSelectedConversationMentions([]);
      setSelectedTeamMentions([]);
      setSelectedProjectFileMentions([]);
      void loadContextUsage();
    } catch (error) {
      if (activeRunId === null) {
        discardPendingRunProgress(setRunProgresses);
        setModelActivity(null);
      }
      setOperationError(getUserErrorMessage(error, "任务发送失败"));
    } finally {
      setIsSending(false);
      refocusComposer();
    }
  };

  const handleChooseAttachments = useCallback(async (): Promise<void> => {
    if (isChoosingAttachments || isSending || isFinishedSubagent) return;
    setIsChoosingAttachments(true);
    setOperationError(null);
    try {
      const attachments = await agentClient.chooseConversationAttachments({
        conversationId: session.id,
      });
      setDraftAttachments(attachments);
    } catch (error) {
      setOperationError(getUserErrorMessage(error, "无法添加附件"));
    } finally {
      setIsChoosingAttachments(false);
    }
  }, [agentClient, isChoosingAttachments, isSending, isFinishedSubagent, session.id]);

  const handleRemoveAttachment = useCallback(async (attachmentId: string): Promise<void> => {
    if (removingAttachmentId !== null || isSending) return;
    setRemovingAttachmentId(attachmentId);
    setOperationError(null);
    try {
      await agentClient.removeConversationAttachment({
        attachmentId,
        conversationId: session.id,
      });
      setDraftAttachments((current) =>
        current.filter((attachment) => attachment.id !== attachmentId)
      );
    } catch {
      setOperationError("无法移除附件");
    } finally {
      setRemovingAttachmentId(null);
    }
  }, [agentClient, isSending, removingAttachmentId, session.id]);

  const mentionOptions = useMemo((): MentionOption[] => {
    if (mentionQuery === null || mentionQuery.query.length === 0) return [];
    const options: MentionOption[] = [];
    const normalizedQuery = mentionQuery.query.toLocaleLowerCase();
    const canMentionTeams = session.projectId !== null
      && session.parentConversationId === null
      && session.threadKind === "agent"
      && !teamManaged;
    if (canMentionTeams) {
      options.push(...teams
        .filter((team) =>
          !selectedTeamMentions.some((selected) => selected.id === team.id)
          && team.name.toLocaleLowerCase().includes(normalizedQuery)
        )
        .slice(0, 4)
        .map((team): MentionOption => ({
          kind: "team",
          value: { enabled: team.enabled, id: team.id, name: team.name },
        })));
    }
    if (
      !mentionQuery.query.includes("/")
      && selectedConversationMentions.length < MAX_SELECTED_CONVERSATION_MENTIONS
    ) {
      options.push(...availableConversationMentions
        .filter((conversation) =>
          !selectedConversationMentions.some((selected) => selected.id === conversation.id)
          && conversation.title.toLocaleLowerCase().includes(normalizedQuery)
        )
        .slice(0, Math.max(0, 4 - options.length))
        .map((value): MentionOption => ({ kind: "conversation", value })));
    }
    if (
      referenceWorkspaceId !== null
      && projectMentionLocation !== null
      && projectMentionListing?.workspaceId === referenceWorkspaceId
      && projectMentionListing.directoryPath === projectMentionLocation.directoryPath
      && activeProjectFileMentions.length < MAX_SELECTED_PROJECT_FILE_MENTIONS
    ) {
      const entryQuery = projectMentionLocation.entryQuery.toLocaleLowerCase();
      options.push(...projectMentionListing.entries
        .filter((entry) =>
          entry.kind !== "symlink"
          && entry.name.toLocaleLowerCase().includes(entryQuery)
          && (
            entry.kind === "directory"
            || !activeProjectFileMentions.some((selected) => selected.path === entry.path)
          )
        )
        .slice(0, Math.max(0, 8 - options.length))
        .map((entry): MentionOption => ({
          kind: entry.kind === "directory" ? "directory" : "file",
          value: {
            name: entry.name,
            path: entry.path,
            workspaceId: referenceWorkspaceId,
          },
        })));
    }
    return options;
  }, [
    activeProjectFileMentions,
    availableConversationMentions,
    mentionQuery,
    projectMentionListing,
    projectMentionLocation,
    referenceWorkspaceId,
    selectedConversationMentions,
    selectedTeamMentions,
    session.parentConversationId,
    session.projectId,
    session.threadKind,
    teamManaged,
    teams,
  ]);

  const slashOptions = useMemo(() => {
    if (slashQuery === null) return [];
    const query = slashQuery.query.toLocaleLowerCase();
    return SLASH_COMMANDS.filter((command) =>
      command.name.includes(query)
      || command.title.toLocaleLowerCase().includes(query)
    );
  }, [slashQuery]);

  const selectMention = useCallback((option: MentionOption): void => {
    if (mentionQuery === null) return;
    const insertedText = option.kind === "directory"
      ? `@${option.value.path}/`
      : `@${option.kind === "conversation"
        ? option.value.title
        : option.kind === "team" ? option.value.name : option.value.path} `;
    const nextValue = `${composerValue.slice(0, mentionQuery.start)}${insertedText}${composerValue.slice(mentionQuery.end)}`;
    const nextCaret = mentionQuery.start + insertedText.length;
    setComposerValue(nextValue);
    if (option.kind === "conversation") {
      setSelectedConversationMentions((current) =>
        current.some((selected) => selected.id === option.value.id)
          ? current
          : current.length >= MAX_SELECTED_CONVERSATION_MENTIONS
            ? current
            : [...current, option.value]
      );
    } else if (option.kind === "team") {
      setSelectedTeamMentions((current) => current.some((selected) => selected.id === option.value.id)
        ? current
        : [...current, option.value]);
    } else if (option.kind === "file") {
      setSelectedProjectFileMentions((current) =>
        current.some((selected) => selected.path === option.value.path)
          ? current
          : current.length >= MAX_SELECTED_PROJECT_FILE_MENTIONS
            ? current
            : [...current, option.value]
      );
    }
    setMentionQuery(option.kind === "directory"
      ? {
        end: nextCaret,
        query: `${option.value.path}/`,
        start: mentionQuery.start,
      }
      : null);
    setSlashQuery(null);
    setMentionSelectionIndex(0);
    queueMicrotask(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }, [composerValue, mentionQuery]);

  const selectSlashCommand = useCallback((command: SlashCommand): void => {
    if (slashQuery === null) return;
    const insertedText = `/${command.name} `;
    const nextValue = `${composerValue.slice(0, slashQuery.start)}${insertedText}${composerValue.slice(slashQuery.end)}`;
    const nextCaret = slashQuery.start + insertedText.length;
    setComposerValue(nextValue);
    setMentionQuery(null);
    setSlashQuery(null);
    setMentionSelectionIndex(0);
    queueMicrotask(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }, [composerValue, slashQuery]);

  const handleMentionOptionClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const option = mentionOptions[Number(event.currentTarget.dataset.optionIndex)];
      if (option !== undefined) selectMention(option);
    },
    [mentionOptions, selectMention],
  );

  const handleSlashCommandClick = useCallback(
    (event: MouseEvent<HTMLButtonElement>): void => {
      const command = slashOptions[Number(event.currentTarget.dataset.optionIndex)];
      if (command !== undefined) selectSlashCommand(command);
    },
    [selectSlashCommand, slashOptions],
  );

  const handleComposerKeyDown = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>): void => {
      if (mentionQuery !== null && mentionOptions.length > 0) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setMentionSelectionIndex((current) => {
            const offset = event.key === "ArrowDown" ? 1 : -1;
            return (current + offset + mentionOptions.length) % mentionOptions.length;
          });
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const selected = mentionOptions[mentionSelectionIndex] ?? mentionOptions[0];
          if (selected !== undefined) selectMention(selected);
          return;
        }
      }
      if (slashQuery !== null && slashOptions.length > 0) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          setMentionSelectionIndex((current) => {
            const offset = event.key === "ArrowDown" ? 1 : -1;
            return (current + offset + slashOptions.length) % slashOptions.length;
          });
          return;
        }
        if (event.key === "Enter" && !event.shiftKey) {
          event.preventDefault();
          const selected = slashOptions[mentionSelectionIndex] ?? slashOptions[0];
          if (selected !== undefined) selectSlashCommand(selected);
          return;
        }
      }
      if (event.key === "Escape" && (mentionQuery !== null || slashQuery !== null)) {
        event.preventDefault();
        setMentionQuery(null);
        setSlashQuery(null);
        return;
      }
      const shouldSend = sendShortcut === "enter"
        ? !event.shiftKey
        : (event.ctrlKey || event.metaKey) && !event.shiftKey;
      if (event.key !== "Enter" || !shouldSend || event.nativeEvent.isComposing) {
        return;
      }

      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    },
    [
      mentionOptions,
      mentionQuery,
      mentionSelectionIndex,
      selectMention,
      selectSlashCommand,
      slashOptions,
      sendShortcut,
      slashQuery,
    ],
  );

  const handleCancel = useCallback(async (): Promise<void> => {
    if (activeRunId === null || isCancelling) {
      return;
    }

    setIsCancelling(true);
    setOperationError(null);
    try {
      await agentClient.cancelRun({ runId: activeRunId });
    } catch {
      setIsCancelling(false);
      setOperationError("无法停止当前任务");
    }
  }, [activeRunId, agentClient, isCancelling]);

  const handlePromotePendingMessage = useCallback(async (pendingMessageId: string) => {
    if (pendingMessageActionId !== null) return;
    setPendingMessageActionId(pendingMessageId);
    setOperationError(null);
    try {
      setPendingMessages(await agentClient.promoteConversationPendingMessage({
        pendingMessageId,
      }));
    } catch (error) {
      setOperationError(getUserErrorMessage(error, "无法直接发送这条消息"));
    } finally {
      setPendingMessageActionId(null);
    }
  }, [agentClient, pendingMessageActionId]);

  const handleDeletePendingMessage = useCallback(async (pendingMessageId: string) => {
    if (pendingMessageActionId !== null) return;
    setPendingMessageActionId(pendingMessageId);
    setOperationError(null);
    try {
      setPendingMessages(await agentClient.deleteConversationPendingMessage({
        pendingMessageId,
      }));
      void loadDraftAttachments();
    } catch (error) {
      setOperationError(getUserErrorMessage(error, "无法删除排队消息"));
    } finally {
      setPendingMessageActionId(null);
    }
  }, [agentClient, loadDraftAttachments, pendingMessageActionId]);

  const handleMovePendingMessage = useCallback(async (
    pendingMessageId: string,
    direction: -1 | 1,
  ): Promise<void> => {
    if (pendingMessageActionId !== null) return;
    const currentIndex = pendingMessages.findIndex((message) => message.id === pendingMessageId);
    const targetIndex = currentIndex + direction;
    if (currentIndex < 0 || targetIndex < 0 || targetIndex >= pendingMessages.length) return;
    const next = [...pendingMessages];
    const current = next[currentIndex];
    const target = next[targetIndex];
    if (current === undefined || target === undefined) return;
    next[currentIndex] = target;
    next[targetIndex] = current;
    setPendingMessageActionId(pendingMessageId);
    setOperationError(null);
    try {
      setPendingMessages(await agentClient.reorderConversationPendingMessages({
        conversationId: session.id,
        pendingMessageIds: next.map((message) => message.id),
      }));
    } catch (error) {
      setOperationError(getUserErrorMessage(error, "无法调整排队顺序"));
    } finally {
      setPendingMessageActionId(null);
    }
  }, [agentClient, pendingMessageActionId, pendingMessages, session.id]);

  const handleChangeApproval = useCallback(
    async (
      tool: ConversationToolItem,
      approved: boolean,
      scope: ApproveToolChangeInput["scope"] = "once",
    ): Promise<void> => {
      if (approvingToolId !== null || tool.status !== "awaiting_approval") return;
      setApprovingToolId(tool.id);
      setApprovalErrors((current) => {
        if (!(tool.id in current)) return current;
        const next = { ...current };
        delete next[tool.id];
        return next;
      });
      try {
        await agentClient.approveToolChange({
          approved,
          runId: tool.runId,
          scope,
          toolId: tool.id,
        });
      } catch (error) {
        setApprovalErrors((current) => ({
          ...current,
          [tool.id]: getUserErrorMessage(error, "无法提交文件变更决定"),
        }));
      } finally {
        setApprovingToolId(null);
      }
    },
    [agentClient, approvingToolId],
  );

  const handleCloseTaskList = useCallback(async (): Promise<void> => {
    if (taskList === null || taskListAction !== null) {
      return;
    }

    setTaskListAction("closing");
    setOperationError(null);
    try {
      await agentClient.closeConversationTaskList({
        conversationId: session.id,
      });
      setIsTaskListExpanded(false);
      setTaskList(null);
    } catch {
      setOperationError("无法关闭任务清单");
    } finally {
      setTaskListAction(null);
    }
  }, [agentClient, session.id, taskList, taskListAction]);

  const handleSelectWorkspace = async (): Promise<void> => {
    if (isChangingWorkspace || activeRunId !== null) return;
    setIsChangingWorkspace(true);
    setOperationError(null);
    try {
      const conversation = await agentClient.selectConversationWorkspace({
        conversationId: session.id,
      });
      if (conversation !== null) {
        setSelectedProjectFileMentions([]);
        onSessionUpdated?.(conversation);
      }
    } catch {
      setOperationError("无法添加工作目录");
    } finally {
      setIsChangingWorkspace(false);
    }
  };

  const handleClearWorkspace = async (): Promise<void> => {
    if (isChangingWorkspace || activeRunId !== null) return;
    setIsChangingWorkspace(true);
    setOperationError(null);
    try {
      const conversation = await agentClient.clearConversationWorkspace({
        conversationId: session.id,
      });
      setSelectedProjectFileMentions([]);
      onSessionUpdated?.(conversation);
    } catch {
      setOperationError("无法移除工作目录");
    } finally {
      setIsChangingWorkspace(false);
    }
  };

  const isModelUnavailable = !isMockRuntime && modelStatus?.configured === false;
  const hasActiveModelRun = activeRunId !== null;
  const isRunning = hasActiveModelRun || activeSubagentCount > 0;
  const shouldShowStopButton = hasActiveModelRun && !isEditingComposerMessage;
  const displayTimeline = groupToolBatches(
    timeline,
    modelActivity?.anchorTimelineItemId ?? null,
  );
  const runDurationsByInsertIndex = useMemo(
    () => getConversationRunDurationInsertIndexes(displayTimeline),
    [displayTimeline],
  );
  const modelActivityInsertIndex = modelActivity === null
    ? -1
    : (() => {
      const anchorTimelineItemId = modelActivity.anchorTimelineItemId;
      if (anchorTimelineItemId === null) {
        return displayTimeline.length;
      }
      const anchorIndex = displayTimeline.findIndex((item) =>
        timelineDisplayItemContains(item, anchorTimelineItemId),
      );
      return anchorIndex < 0 ? displayTimeline.length : anchorIndex + 1;
    })();
  const runProgressesByInsertIndex = useMemo(() => {
    const progressByIndex = new Map<number, RunProgress[]>();
    for (const progress of runProgresses) {
      const anchorTimelineItemId = progress.anchorTimelineItemId;
      const anchorIndex = anchorTimelineItemId === null
        ? -1
        : displayTimeline.findIndex((item) =>
          timelineDisplayItemContains(item, anchorTimelineItemId),
        );
      const insertIndex = anchorIndex < 0 ? displayTimeline.length : anchorIndex + 1;
      const items = progressByIndex.get(insertIndex) ?? [];
      items.push(progress);
      progressByIndex.set(insertIndex, items);
    }
    return progressByIndex;
  }, [displayTimeline, runProgresses]);
  const canChangeProject =
    !compact
    && !isLoadingTimeline
    && displayTimeline.length === 0
    && draftAttachments.length === 0
    && !isFinishedSubagent
    && onAddProject !== undefined
    && onSessionUpdated !== undefined;
  const canChangeAgent =
    !isLoadingTimeline
    && !isFinishedSubagent
    && !teamManaged;
  const taskFileChanges = summarizeTaskFileChanges(
    timeline,
    taskList?.createdAt ?? null,
  );

  return (
    <section
      className="conversation-workspace"
      aria-labelledby={headingId}
      data-compact={String(compact)}
      onInputCapture={onViewed}
      onKeyDownCapture={onViewed}
      onPointerDownCapture={onViewed}
      onWheelCapture={onViewed}
    >
      <header className="conversation-workspace__header">
        <div className="conversation-workspace__path" aria-label="对话路径">
          {project !== null ? (
            <button
              aria-label={`在左侧定位项目 ${project.name}`}
              className="conversation-workspace__path-link conversation-workspace__path-link--project"
              title={project.name}
              type="button"
              onClick={() => onLocateProject?.(project.id)}
            >
              <Folder aria-hidden="true" size={14} strokeWidth={1.75} />
              <span>{project.name}</span>
            </button>
          ) : (
            <span className="conversation-workspace__path-temporary">
              <MessageSquareText aria-hidden="true" size={16} />
              临时对话
            </span>
          )}
          <ChevronRight aria-hidden="true" size={12} strokeWidth={1.75} />
          <button
            aria-label={`在左侧定位对话 ${session.title}`}
            className="conversation-workspace__path-link conversation-workspace__path-link--conversation"
            title={session.title}
            type="button"
            onClick={() => onLocateSession?.(session.id)}
          >
            <MessageSquareText aria-hidden="true" size={14} strokeWidth={1.75} />
            <h1 id={headingId}>{session.title}</h1>
          </button>
        </div>
        <RuntimeBadge
          isMockRuntime={isMockRuntime}
          isRunning={isRunning}
          status={modelStatus}
        />
      </header>

      <div
        className="conversation-workspace__surface"
        data-has-task-list={String(taskList !== null)}
        data-has-pending-messages={String(pendingMessages.length > 0)}
        data-has-subagent-approvals={String(subagentApprovals.length > 0)}
      >
        <div
          ref={messagesRef}
          className="conversation-workspace__messages"
          aria-label="对话记录"
          onScroll={handleMessagesScroll}
        >
          {isLoadingTimeline ? (
            <div className="conversation-workspace__loading" role="status">
              <LoaderCircle aria-hidden="true" size={17} />
              <span>正在加载对话</span>
            </div>
          ) : displayTimeline.length === 0 && runProgresses.length === 0 && modelActivity === null ? (
            <div className="conversation-workspace__blank">等待任务</div>
          ) : (
            <>
              {displayTimeline.map((item, index) => (
                <Fragment key={item.id}>
                  {(runDurationsByInsertIndex.get(index) ?? []).map((durationMs, durationIndex) => (
                    <div
                      className="conversation-run-duration"
                      key={`${item.id}:duration:${durationIndex}`}
                    >
                      <span>用时 {formatRunDuration(0, durationMs)}</span>
                    </div>
                  ))}
                  {(runProgressesByInsertIndex.get(index) ?? []).map((progress) => (
                    <RunProgressIndicator key={progress.runId ?? "pending"} progress={progress} />
                  ))}
                  {modelActivity !== null
                    && modelActivityInsertIndex === index
                    && item.kind !== "tool_batch" ? (
                    <ModelActivityIndicator activity={modelActivity} />
                  ) : null}
                  <TimelineItem
                    item={item}
                    teamManaged={teamManaged}
                    activeRunId={activeRunId}
                    modelActivity={modelActivity !== null
                      && modelActivityInsertIndex === index
                      && item.kind === "tool_batch"
                      ? modelActivity
                      : null}
                    approvalErrors={approvalErrors}
                    approvingToolId={approvingToolId}
                    copiedMessageId={copiedMessageId}
                    editingMessageId={editingMessageId}
                    forkingMessageId={forkingMessageId}
                    canForkMessage={item.kind === "message"
                      && forkableAssistantMessageIds.has(item.id)
                      && onForkConversation !== undefined
                      && !isFinishedSubagent}
                    canShowCompletionTime={item.kind === "message"
                      && forkableAssistantMessageIds.has(item.id)}
                    canCopyMessage={item.kind === "message" && (
                      item.role === "user"
                        ? item.content.length > 0
                        : forkableAssistantMessageIds.has(item.id)
                    )}
                    latestUserMessageId={teamManaged ? null : latestUserMessageId}
                    onChangeApproval={handleChangeApproval}
                    onCopyMessage={handleCopyMessage}
                    onEditMessage={handleEditMessage}
                    onForkMessage={handleForkMessage}
                    onOpenProjectFile={onOpenProjectFile}
                    onSessionSelected={onSessionSelected}
                    liveToolOutputs={liveToolOutputs}
                  />
                </Fragment>
              ))}
              {(runProgressesByInsertIndex.get(displayTimeline.length) ?? []).map((progress) => (
                <RunProgressIndicator key={progress.runId ?? "pending"} progress={progress} />
              ))}
              {modelActivity !== null && modelActivityInsertIndex === displayTimeline.length ? (
                <ModelActivityIndicator activity={modelActivity} />
              ) : null}
            </>
          )}
          {operationError !== null ? <ConversationErrorItem content={operationError} /> : null}
        </div>

        <div className="conversation-workspace__composer-overlay">
          {taskList !== null ? (
            <ConversationTaskListPanel
              allowClose={teamManaged || !isFinishedSubagent}
              expanded={isTaskListExpanded}
              fileChanges={taskFileChanges}
              isActioning={taskListAction !== null || isFinishedSubagent}
              isRunActive={hasActiveModelRun}
              lastRunStatus={session.lastRunStatus}
              taskList={taskList}
              onClose={() => void handleCloseTaskList()}
              onToggle={() => setIsTaskListExpanded((current) => !current)}
            />
          ) : null}

          {pendingMessages.length > 0 ? (
            <ConversationPendingMessageQueue
              actioningMessageId={pendingMessageActionId}
              editingMessageId={editingPendingMessageId}
              messages={pendingMessages}
              onDelete={handleDeletePendingMessage}
              onEdit={handleEditPendingMessage}
              onMove={handleMovePendingMessage}
              onPromote={handlePromotePendingMessage}
            />
          ) : null}

          {subagentApprovals.length > 0 ? (
            <SubagentApprovalQueue
              approvalErrors={approvalErrors}
              approvals={subagentApprovals}
              approvingToolId={approvingToolId}
              onChangeApproval={handleChangeApproval}
              {...(onSessionSelected === undefined
                ? {}
                : { onOpenSubagent: onSessionSelected })}
            />
          ) : null}

          <form className="conversation-workspace__composer" onSubmit={(event) => void handleSubmit(event)}>
          <div className="conversation-workspace__composer-surface">
            {isEditingComposerMessage ? (
              <div className="conversation-workspace__editing" role="status">
                <Pencil aria-hidden="true" size={14} />
                <span>{editingPendingMessageId === null ? "正在编辑最新消息" : "正在编辑排队消息"}</span>
                <IconButton
                  disabled={isSending || pendingMessageActionId !== null}
                  label="取消编辑"
                  size="compact"
                  type="button"
                  variant="quiet"
                  onClick={handleCancelEditing}
                >
                  <X aria-hidden="true" size={14} />
                </IconButton>
              </div>
            ) : null}
            {isFinishedSubagent ? (
              <div className="conversation-workspace__readonly" role="status">
                <Bot aria-hidden="true" size={14} />
                <span>Subagent 任务已结束，可查看完整过程</span>
              </div>
            ) : null}
            {canChangeProject ? (
              <div className="conversation-workspace__composer-project">
                <span>项目</span>
                <ConversationProjectPicker
                  canAddProjects={canAddProjects}
                  disabled={isRunning || isSending || isChangingProject}
                  isAddingProject={isAddingProject}
                  projects={projects}
                  selectedProjectId={session.projectId}
                  onAddProject={onAddProject}
                  onProjectChange={async (projectId) => {
                    setIsChangingProject(true);
                    setOperationError(null);
                    try {
                      const conversation = await agentClient.setConversationProject({
                        conversationId: session.id,
                        projectId,
                      });
                      setSelectedProjectFileMentions([]);
                      onSessionUpdated(conversation);
                      if (projectId !== null) onProjectSelected?.(projectId);
                      return true;
                    } catch {
                      setOperationError("无法修改对话所属项目");
                      return false;
                    } finally {
                      setIsChangingProject(false);
                    }
                  }}
                />
              </div>
            ) : null}
            {!isEditingComposerMessage && draftAttachments.length > 0 ? (
              <div className="conversation-attachments conversation-attachments--draft">
                {draftAttachments.map((attachment) => (
                  <AttachmentChip
                    key={attachment.id}
                    attachment={attachment}
                    isRemoving={removingAttachmentId === attachment.id}
                    onRemove={() => void handleRemoveAttachment(attachment.id)}
                  />
                ))}
              </div>
            ) : null}
            {selectedConversationMentions.length > 0
              || selectedTeamMentions.length > 0
              || activeProjectFileMentions.length > 0 ? (
              <div className="conversation-mentions conversation-mentions--draft">
                {selectedTeamMentions.map((mention) => (
                  <span className="conversation-mention-chip" data-kind="team" key={mention.id}>
                    <UsersRound aria-hidden="true" size={13} />
                    <span>{mention.name}</span>
                    <button
                      aria-label={`移除团队引用 ${mention.name}`}
                      type="button"
                      onClick={() => setSelectedTeamMentions((current) =>
                        current.filter((candidate) => candidate.id !== mention.id)
                      )}
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </span>
                ))}
                {selectedConversationMentions.map((mention) => (
                  <span className="conversation-mention-chip" data-kind="conversation" key={mention.id}>
                    <AtSign aria-hidden="true" size={13} />
                    <span>{mention.title}</span>
                    <button
                      aria-label={`移除对话引用 ${mention.title}`}
                      type="button"
                      onClick={() => setSelectedConversationMentions((current) =>
                        current.filter((candidate) => candidate.id !== mention.id)
                      )}
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </span>
                ))}
                {activeProjectFileMentions.map((mention) => (
                  <span className="conversation-mention-chip" data-kind="file" key={mention.path}>
                    <FileText aria-hidden="true" size={13} />
                    <span title={mention.path}>{mention.path}</span>
                    <button
                      aria-label={`移除文件引用 ${mention.path}`}
                      type="button"
                      onClick={() => setSelectedProjectFileMentions((current) =>
                        current.filter((candidate) => candidate.path !== mention.path)
                      )}
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div className="conversation-workspace__composer-input">
              {
                mentionQuery !== null
                && mentionQuery.query.length > 0
                && mentionOptions.length > 0
              ? (
                <div className="conversation-mention-menu" role="listbox" aria-label="引用对话或文件">
                  {mentionOptions.map((option, index) => {
                    const projectName = option.kind === "conversation"
                      ? projects.find(
                        (candidate) => candidate.id === option.value.projectId,
                      )?.name
                      : null;
                    return (
                      <button
                        aria-selected={index === mentionSelectionIndex}
                        className={index === mentionSelectionIndex ? "is-selected" : undefined}
                        data-option-index={index}
                        key={option.kind === "conversation" || option.kind === "team"
                          ? `${option.kind}:${option.value.id}`
                          : `${option.kind}:${option.value.path}`}
                        role="option"
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={handleMentionOptionClick}
                      >
                        {option.kind === "team" ? (
                          <UsersRound aria-hidden="true" size={15} />
                        ) : option.kind === "conversation" ? (
                          <MessageSquareText aria-hidden="true" size={15} />
                        ) : option.kind === "directory" ? (
                          <Folder aria-hidden="true" size={15} />
                        ) : (
                          <FileText aria-hidden="true" size={15} />
                        )}
                        <span>
                          <strong>{option.kind === "conversation"
                            ? option.value.title
                            : option.kind === "team" ? option.value.name : option.value.name}</strong>
                          <small>{option.kind === "conversation"
                            ? `${projectName ?? "临时对话"} · ${threadKindLabel(option.value.threadKind)}`
                            : option.kind === "team"
                              ? option.value.enabled ? "团队 · 自动分发" : "团队 · 已暂停，接收后排队"
                            : `${option.kind === "directory" ? "目录" : "文件"} · ${option.value.path}`}</small>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : slashQuery !== null ? (
                <div className="conversation-mention-menu" role="listbox" aria-label="斜杠命令">
                  {slashOptions.length === 0 ? (
                    <p>没有匹配的命令</p>
                  ) : slashOptions.map((command, index) => (
                    <button
                      aria-selected={index === mentionSelectionIndex}
                      className={index === mentionSelectionIndex ? "is-selected" : undefined}
                      data-option-index={index}
                      key={command.name}
                      role="option"
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={handleSlashCommandClick}
                    >
                      {command.name === "plan" ? (
                        <ListTodo aria-hidden="true" size={15} />
                      ) : command.name === "review" ? (
                        <FileSearch aria-hidden="true" size={15} />
                      ) : (
                        <Terminal aria-hidden="true" size={15} />
                      )}
                      <span>
                        <strong>/{command.name} · {command.title}</strong>
                        <small>{command.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                ref={composerRef}
                aria-label="输入任务"
                disabled={isSending || pendingMessageActionId !== null || isModelUnavailable || isFinishedSubagent}
                placeholder={isFinishedSubagent
                  ? "Subagent 任务已结束，可查看完整过程"
                  : isModelUnavailable
                  ? "请先在设置中配置模型"
                  : selectedAgent === undefined
                    ? "输入任务"
                    : `向 ${selectedAgent.name} 输入任务`}
                rows={2}
                value={composerValue}
                onChange={(event) => {
                  const nextValue = event.target.value;
                  const nextMentionQuery = findMentionQuery(
                    nextValue,
                    event.target.selectionStart,
                  );
                  setComposerValue(nextValue);
                  setMentionQuery(nextMentionQuery);
                  setSlashQuery(nextMentionQuery === null
                    ? findSlashQuery(nextValue, event.target.selectionStart)
                    : null);
                  setMentionSelectionIndex(0);
                }}
                onClick={(event) => {
                  const nextMentionQuery = findMentionQuery(
                    event.currentTarget.value,
                    event.currentTarget.selectionStart,
                  );
                  setMentionQuery(nextMentionQuery);
                  setSlashQuery(nextMentionQuery === null
                    ? findSlashQuery(
                      event.currentTarget.value,
                      event.currentTarget.selectionStart,
                    )
                    : null);
                  setMentionSelectionIndex(0);
                }}
                onKeyDown={handleComposerKeyDown}
              />
            </div>
            <div className="conversation-workspace__composer-toolbar">
              <div className="conversation-workspace__composer-options">
                <IconButton
                  disabled={
                    isMockRuntime
                    || isSending
                    || isFinishedSubagent
                    || isChoosingAttachments
                    || isEditingComposerMessage
                    || draftAttachments.length >= 10
                  }
                  label={isEditingComposerMessage
                    ? "编辑消息时保留原附件"
                    : isChoosingAttachments
                      ? "正在添加附件"
                      : "添加文件或图片"}
                  size="compact"
                  type="button"
                  variant="quiet"
                  onClick={() => void handleChooseAttachments()}
                >
                  {isChoosingAttachments ? (
                    <LoaderCircle
                      aria-hidden="true"
                      className="conversation-workspace__spin"
                      size={15}
                    />
                  ) : (
                    <Paperclip aria-hidden="true" size={15} />
                  )}
                </IconButton>
                {project === null && !isMockRuntime && onSessionUpdated !== undefined ? (
                  <span className="conversation-workspace__workspace-control">
                    <IconButton
                      disabled={isRunning || isSending || isChangingWorkspace || isFinishedSubagent}
                      label={session.workspaceRootPath === null ? "添加工作目录" : "更换工作目录"}
                      size="compact"
                      type="button"
                      variant="quiet"
                      onClick={() => void handleSelectWorkspace()}
                    >
                      <FolderPlus aria-hidden="true" size={15} />
                    </IconButton>
                    {session.workspaceRootPath === null ? null : (
                      <>
                        <button
                          className="conversation-workspace__workspace-path"
                          disabled={isRunning || isSending || isChangingWorkspace || isFinishedSubagent}
                          title={session.workspaceRootPath}
                          type="button"
                          onClick={() => void handleSelectWorkspace()}
                        >
                          <Folder aria-hidden="true" size={13} />
                          <span>{fileNameFromPath(session.workspaceRootPath)}</span>
                        </button>
                        <IconButton
                          disabled={isRunning || isSending || isChangingWorkspace || isFinishedSubagent}
                          label="移除工作目录"
                          size="compact"
                          type="button"
                          variant="quiet"
                          onClick={() => void handleClearWorkspace()}
                        >
                          <X aria-hidden="true" size={14} />
                        </IconButton>
                      </>
                    )}
                  </span>
                ) : null}
                {selectedAgent === undefined ? null : (
                  <Select
                    disabled={!canChangeAgent}
                    value={selectedAgent.id}
                    onValueChange={(agentId) => {
                      setSelectedAgentId(agentId);
                      saveConversationAgentSelection(session.id, agentId);
                    }}
                  >
                    <SelectTrigger
                      aria-label="对话 Agent"
                      className="conversation-workspace__composer-select conversation-workspace__composer-select--agent"
                      title={canChangeAgent
                        ? `当前 Agent：${selectedAgent.name}`
                        : `对话已由 ${selectedAgent.name} 接管`}
                    >
                      <AgentAvatar avatar={selectedAgent.avatar} size="compact" />
                      <SelectValue>
                        <span className="conversation-agent-select-value">
                          {selectedAgent.name}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent
                      align="start"
                      className="conversation-workspace__agent-select-content"
                      side="top"
                    >
                      {enabledAgentProfiles.map((agent) => (
                        <SelectItem
                          key={agent.id}
                          className="conversation-agent-select-item"
                          value={agent.id}
                        >
                          <span className="conversation-agent-option">
                            <AgentAvatar avatar={agent.avatar} size="compact" status={agent.status} />
                            <span>
                              <strong>{agent.name}</strong>
                              <small>{agent.isDefault ? "默认 Agent" : agent.role}</small>
                            </span>
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select
                  disabled={isFinishedSubagent || isSavingTeamPermission}
                  value={permissionMode}
                  onValueChange={selectPermissionMode}
                >
                  <SelectTrigger
                    aria-label="权限模式"
                    className="conversation-workspace__composer-select conversation-workspace__composer-select--permission"
                    title={teamManaged && activeRunId !== null
                      ? "已保存到团队工作项；将在下一次团队执行时生效"
                      : undefined}
                  >
                    <ShieldCheck aria-hidden="true" size={14} />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent
                    align="start"
                    className="conversation-workspace__permission-select-content"
                    side="top"
                  >
                    <SelectItem value="read_only">只读</SelectItem>
                    <SelectItem value="ask_before_changes">修改前询问</SelectItem>
                    <SelectItem value="full_access">完全访问</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="conversation-workspace__composer-actions">
                {showContextUsage ? (
                  <ContextUsageIndicator
                    contextWindowTokens={activeModel?.contextWindow ?? 0}
                    modelName={activeModel?.displayName ?? null}
                    usage={contextUsage}
                  />
                ) : null}
                <span className="conversation-workspace__model-controls">
                  <ModelProfilePicker
                    ariaLabel="对话模型列表"
                    className="model-profile-picker--conversation"
                    defaultContextCompression={contextCompressionConfiguration}
                    models={modelOptions}
                    selectedModelId={activeModel?.modelId ?? null}
                    selectedProviderId={activeModel?.providerId ?? null}
                    side="top"
                    trigger={
                      <button
                        aria-label="模型"
                        className="conversation-workspace__composer-select conversation-workspace__composer-select--model"
                        disabled={isFinishedSubagent || activeModelKey.length === 0}
                        title={modelDisplayName}
                        type="button"
                      >
                        <span>{modelDisplayName}</span>
                      </button>
                    }
                    onSelect={selectModel}
                  />
                  <span aria-hidden="true" className="conversation-workspace__model-divider">·</span>
                  <ConversationReasoningControl
                    disabled={isFinishedSubagent || activeModelKey.length === 0}
                    fallbackOption={session.modelSelection?.reasoning ?? null}
                    options={activeReasoningOptions}
                    selectedKey={effectiveReasoningOptionKey}
                    onValueChange={selectReasoning}
                  />
                </span>
                <IconButton
                  className="conversation-workspace__send-button"
                  disabled={
                    shouldShowStopButton
                      ? isCancelling
                      : (
                    (isEditingComposerMessage
                      ? composerValue.trim().length === 0
                      : (
                        composerValue.trim().length === 0
                        && draftAttachments.length === 0
                        && activeProjectFileMentions.length === 0
                      ))
                        || isSending
                        || pendingMessageActionId !== null
                        || isModelUnavailable
                        || isFinishedSubagent
                      )
                  }
                  label={shouldShowStopButton
                    ? isCancelling ? "正在停止任务" : "停止任务"
                    : isFinishedSubagent
                      ? "Subagent 任务已结束"
                      : isSending
                        ? isEditingComposerMessage ? "正在保存修改" : "正在发送任务"
                        : editingMessageId !== null
                          ? "保存并重新生成"
                          : editingPendingMessageId !== null
                            ? "保存排队消息"
                          : "发送任务"}
                  size="compact"
                  type={shouldShowStopButton ? "button" : "submit"}
                  variant="active"
                  onClick={shouldShowStopButton ? () => void handleCancel() : undefined}
                >
                  {shouldShowStopButton ? (
                    isCancelling ? (
                      <LoaderCircle aria-hidden="true" className="conversation-workspace__spin" size={15} />
                    ) : (
                      <Square aria-hidden="true" size={14} />
                    )
                  ) : isSending ? (
                    <LoaderCircle aria-hidden="true" className="conversation-workspace__spin" size={15} />
                  ) : (
                    <ArrowUp aria-hidden="true" size={17} strokeWidth={2.25} />
                  )}
                </IconButton>
              </div>
            </div>
          </div>
          </form>
        </div>
      </div>
    </section>
  );
}

function modelKey(model: Pick<ModelProfile, "modelId" | "providerId">): string {
  return `${model.providerId}:${encodeURIComponent(model.modelId)}`;
}

export function resolveInitialConversationModelSelection(
  sessionSelection: ConversationModelSelection | null,
  status: ModelRuntimeStatus | null,
): ConversationModelSelection | null {
  return sessionSelection ?? status?.recentSelection ?? null;
}

function findMentionQuery(value: string, cursor: number): MentionQuery | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/(?:^|\s)@([^\s@]*)$/u);
  if (match === null) return null;
  const matchedText = match[0];
  const leadingWhitespace = /^\s/u.test(matchedText) ? 1 : 0;
  return {
    end: cursor,
    query: match[1] ?? "",
    start: cursor - matchedText.length + leadingWhitespace,
  };
}

function findSlashQuery(value: string, cursor: number): MentionQuery | null {
  const beforeCursor = value.slice(0, cursor);
  const match = beforeCursor.match(/^\/([^\s/]*)$/u);
  if (match === null) return null;
  return {
    end: cursor,
    query: match[1] ?? "",
    start: 0,
  };
}

function parseProjectMentionQuery(query: string): {
  directoryPath: string;
  entryQuery: string;
} | null {
  const normalized = query.replaceAll("\\", "/");
  if (
    normalized.startsWith("/")
    || normalized.includes("//")
    || normalized.split("/").some((segment) => segment === "..")
  ) {
    return null;
  }
  const slashIndex = normalized.lastIndexOf("/");
  return slashIndex < 0
    ? { directoryPath: "", entryQuery: normalized }
    : {
      directoryPath: normalized.slice(0, slashIndex),
      entryQuery: normalized.slice(slashIndex + 1),
    };
}

function threadKindLabel(kind: ConversationSummary["threadKind"]): string {
  switch (kind) {
    case "agent":
      return "Agent";
    case "team_lead":
      return "Team Lead";
    case "subagent":
      return "Subagent";
  }
}

function handleRunEvent(
  event: ConversationRunEvent,
  setTimeline: (updater: (current: ConversationTimelineItem[]) => ConversationTimelineItem[]) => void,
  setActiveRunId: (runId: string | null | ((current: string | null) => string | null)) => void,
  setIsCancelling: (value: boolean) => void,
  timelineRef: { current: ConversationTimelineItem[] },
  setModelActivity: Dispatch<SetStateAction<ModelActivity | null>>,
  setRunProgresses: Dispatch<SetStateAction<RunProgress[]>>,
  setLiveToolOutputs: Dispatch<SetStateAction<Record<string, LiveToolOutput>>>,
): void {
  const updateTimeline = (
    updater: (current: ConversationTimelineItem[]) => ConversationTimelineItem[],
  ): void => {
    setTimeline((current) => {
      const next = updater(current);
      timelineRef.current = next;
      return next;
    });
  };

  switch (event.type) {
    case "model.request_started":
      updateTimeline(completeStreamingAssistantMessages);
      beginRunProgress(
        setRunProgresses,
        event.runId,
        timelineRef.current.at(-1)?.id ?? null,
      );
      setModelActivity({
        anchorTimelineItemId: timelineRef.current.at(-1)?.id ?? null,
        runId: event.runId,
        status: "thinking",
      });
      return;
    case "model.request_retrying":
      updateTimeline(completeStreamingAssistantMessages);
      setModelActivity({
        attempt: event.attempt,
        anchorTimelineItemId: timelineRef.current.at(-1)?.id ?? null,
        ...(event.reason === undefined ? {} : { reason: event.reason }),
        retryInMs: event.retryInMs,
        runId: event.runId,
        status: "retrying"
      });
      return;
    case "assistant.reasoning_delta": {
      updateTimeline(completeStreamingAssistantMessages);
      const anchorTimelineItemId = timelineRef.current.at(-1)?.id ?? null;
      setModelActivity((current) => {
        const isContinuingSummary = current?.runId === event.runId && !event.reset;
        const previousPreview = isContinuingSummary
          ? current.preview ?? ""
          : "";
        return {
          anchorTimelineItemId: isContinuingSummary
            ? current.anchorTimelineItemId
            : anchorTimelineItemId,
          preview: `${previousPreview}${event.delta}`.slice(-600),
          runId: event.runId,
          status: "thinking"
        };
      });
      return;
    }
    case "assistant.delta":
      markRunOutputStarted(setRunProgresses, event.runId);
      setModelActivity((current) => current?.runId === event.runId ? null : current);
      updateTimeline((current) => appendAssistantDelta(current, event));
      return;
    case "run.finished":
      updateTimeline(completeStreamingAssistantMessages);
      setActiveRunId((current) => (current === event.runId ? null : current));
      setIsCancelling(false);
      setModelActivity((current) => current?.runId === event.runId ? null : current);
      removeRunProgress(setRunProgresses, event.runId);
      return;
    case "run.started":
      updateTimeline(completeStreamingAssistantMessages);
      setActiveRunId(event.runId);
      setIsCancelling(false);
      beginRunProgress(
        setRunProgresses,
        event.runId,
        timelineRef.current.at(-1)?.id ?? null,
      );
      return;
    case "tool.completed":
    case "tool.started":
      updateTimeline((current) => upsertTimelineItem(
        completeStreamingAssistantMessages(current),
        event.tool,
      ));
      if (event.type === "tool.completed" && event.tool.name === "run_command") {
        const result = event.tool.result === null ? null : parseCommandResult(event.tool.result);
        if (result?.status !== "running") {
          setLiveToolOutputs((current) => {
            if (!(event.tool.id in current)) return current;
            const next = { ...current };
            delete next[event.tool.id];
            return next;
          });
        }
      }
      return;
    case "tool.output_delta":
      setLiveToolOutputs((current) => {
        const previous = current[event.toolId] ?? {
          exitCode: null,
          stderr: "",
          stdout: "",
          status: event.status,
          timedOut: false,
          truncated: false,
        };
        const next = {
          ...previous,
          [event.stream]: `${previous[event.stream]}${event.delta}`,
          exitCode: event.exitCode,
          status: event.status,
          timedOut: event.timedOut,
          truncated: event.truncated,
        };
        return { ...current, [event.toolId]: next };
      });
      return;
    case "tool.approval_requested":
      setModelActivity((current) => current?.runId === event.runId ? null : current);
      updateTimeline((current) => upsertTimelineItem(
        completeStreamingAssistantMessages(current),
        event.tool,
      ));
      return;
    case "conversation.updated":
    case "task_list.updated":
      return;
  }
}

function ModelActivityIndicator({ activity }: { activity: ModelActivity }): ReactElement | null {
  const label = modelActivityLabel(activity);

  if (label === null) return null;

  if (activity.status === "retrying") {
    return <RetryActivityIndicator activity={activity} label={label} />;
  }

  return (
    <div
      aria-live="polite"
      className="conversation-model-activity"
      data-status={activity.status}
      role="status"
    >
      <span className="conversation-model-activity__label" title={label}>{label}</span>
    </div>
  );
}

function RetryActivityIndicator({
  activity,
  label,
}: {
  activity: ModelActivity;
  label: string;
}): ReactElement {
  const [isExpanded, setIsExpanded] = useState(false);
  const hasReason = activity.reason !== undefined && activity.reason.trim().length > 0;
  const toggleLabel = isExpanded ? "收起重试详情" : "展开重试详情";

  return (
    <section
      aria-live="polite"
      className="conversation-model-activity"
      data-status="retrying"
      role="status"
    >
      <button
        aria-expanded={isExpanded}
        aria-label={hasReason ? toggleLabel : label}
        className="conversation-model-activity__summary"
        disabled={!hasReason}
        title={hasReason ? toggleLabel : label}
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <WifiOff aria-hidden="true" size={15} />
        <span className="conversation-model-activity__label" title={label}>{label}</span>
        {hasReason ? <ChevronRight aria-hidden="true" size={14} /> : null}
      </button>
      {isExpanded && hasReason ? (
        <p className="conversation-model-activity__detail">
          {stripLegacyErrorInstanceId(activity.reason ?? "")}
        </p>
      ) : null}
    </section>
  );
}

function RunProgressIndicator({ progress }: { progress: RunProgress }): ReactElement {
  const outputStartedAt = progress.outputStartedAt;
  const hasOutput = outputStartedAt !== null;
  const label = hasOutput ? "正在回答" : "正在思考";

  return (
    <div
      aria-live="polite"
      className="conversation-run-progress"
      data-status={hasOutput ? "processed" : "thinking"}
      role="status"
    >
      <span className="conversation-run-progress__label">{label}</span>
    </div>
  );
}

function modelActivityLabel(activity: ModelActivity): string | null {
  const preview = activity.preview?.trim();
  return activity.status === "retrying"
    ? `正在重新连接 ${activity.attempt ?? 1}/5 · ${Math.ceil((activity.retryInMs ?? 1_000) / 1_000)} 秒后重试`
    : preview === undefined || preview.length === 0
      ? null
      : preview;
}

function beginRunProgress(
  setRunProgresses: Dispatch<SetStateAction<RunProgress[]>>,
  runId: string | null,
  anchorTimelineItemId: string | null,
): void {
  const startedAt = Date.now();
  setRunProgresses((current) => current.some((progress) => progress.runId === runId)
    ? current
    : [
      ...current,
      { anchorTimelineItemId, outputStartedAt: null, runId, startedAt },
    ]);
}

function confirmRunProgress(
  setRunProgresses: Dispatch<SetStateAction<RunProgress[]>>,
  runId: string,
  anchorTimelineItemId: string,
): void {
  const startedAt = Date.now();
  setRunProgresses((current) => {
    const existing = current.find((progress) => progress.runId === runId);
    const pending = current.findLast((progress) => progress.runId === null);
    if (existing !== undefined) {
      return current
        .filter((progress) => progress !== pending)
        .map((progress) => progress === existing
          ? { ...progress, anchorTimelineItemId }
          : progress);
    }
    if (pending === undefined) {
      return [
        ...current,
        { anchorTimelineItemId, outputStartedAt: null, runId, startedAt },
      ];
    }
    return current.map((progress) => progress === pending
      ? { ...progress, anchorTimelineItemId, runId }
      : progress);
  });
}

function discardPendingRunProgress(
  setRunProgresses: Dispatch<SetStateAction<RunProgress[]>>,
): void {
  setRunProgresses((current) => current.filter((progress) => progress.runId !== null));
}

function markRunOutputStarted(
  setRunProgresses: Dispatch<SetStateAction<RunProgress[]>>,
  runId: string,
): void {
  const outputStartedAt = Date.now();
  setRunProgresses((current) => current.map((progress) =>
    progress.runId === runId && progress.outputStartedAt === null
      ? { ...progress, outputStartedAt }
      : progress,
  ));
}

function removeRunProgress(
  setRunProgresses: Dispatch<SetStateAction<RunProgress[]>>,
  runId: string,
): void {
  setRunProgresses((current) => current.filter((progress) => progress.runId !== runId));
}

export function formatRunDuration(startedAt: number, outputStartedAt: number): string {
  let remainingSeconds = Math.max(0, Math.floor((outputStartedAt - startedAt) / 1_000));
  const days = Math.floor(remainingSeconds / 86_400);
  remainingSeconds -= days * 86_400;
  const hours = Math.floor(remainingSeconds / 3_600);
  remainingSeconds -= hours * 3_600;
  const minutes = Math.floor(remainingSeconds / 60);
  const seconds = remainingSeconds - minutes * 60;

  if (days > 0) return `${days}天 ${hours}小时 ${minutes}分 ${seconds}秒`;
  if (hours > 0) return `${hours}小时 ${minutes}分 ${seconds}秒`;
  if (minutes > 0) return `${minutes}分 ${seconds}秒`;
  return `${seconds}秒`;
}

function mergePendingMessageUpdate(
  current: readonly ConversationPendingMessage[],
  updated: readonly ConversationPendingMessage[],
): ConversationPendingMessage[] {
  const currentOrder = new Map(current.map((message, index) => [message.id, index]));
  return [...updated].sort((left, right) => {
    const leftIndex = currentOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightIndex = currentOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftIndex - rightIndex;
  });
}

function ConversationPendingMessageQueue({
  actioningMessageId,
  editingMessageId,
  messages,
  onDelete,
  onEdit,
  onMove,
  onPromote,
}: {
  actioningMessageId: string | null;
  editingMessageId: string | null;
  messages: readonly ConversationPendingMessage[];
  onDelete: (pendingMessageId: string) => Promise<void>;
  onEdit: (message: ConversationPendingMessage) => void;
  onMove: (pendingMessageId: string, direction: -1 | 1) => Promise<void>;
  onPromote: (pendingMessageId: string) => Promise<void>;
}): ReactElement {
  return (
    <section className="conversation-pending-queue" aria-label="待发送消息">
      <header>
        <ListEnd aria-hidden="true" size={14} />
        <strong>待发送</strong>
        <span>{messages.length}</span>
      </header>
      <div className="conversation-pending-queue__items">
        {messages.map((message, index) => {
          const isActioning = actioningMessageId === message.id;
          const isEditing = editingMessageId === message.id;
          const fallback = message.attachmentIds.length > 0
            ? `${message.attachmentIds.length} 个附件`
            : message.referencedProjectPaths.length > 0
              ? `${message.referencedProjectPaths.length} 个文件引用`
              : "空消息";
          return (
            <article
              className="conversation-pending-queue__item"
              data-delivery-mode={message.deliveryMode}
              data-editing={String(isEditing)}
              key={message.id}
            >
              <span className="conversation-pending-queue__position">{index + 1}</span>
              <span className="conversation-pending-queue__content" title={message.content || fallback}>
                {message.content || fallback}
              </span>
              <span className="conversation-pending-queue__mode">
                {message.deliveryMode === "steer" ? "等待介入" : "排队中"}
              </span>
              <span className="conversation-pending-queue__actions">
                {isActioning ? (
                  <LoaderCircle aria-hidden="true" className="conversation-workspace__spin" size={14} />
                ) : (
                  <>
                    <IconButton
                      disabled={index === 0}
                      label="上移"
                      size="compact"
                      type="button"
                      variant="quiet"
                      onClick={() => void onMove(message.id, -1)}
                    >
                      <ArrowUp aria-hidden="true" size={14} />
                    </IconButton>
                    <IconButton
                      disabled={index === messages.length - 1}
                      label="下移"
                      size="compact"
                      type="button"
                      variant="quiet"
                      onClick={() => void onMove(message.id, 1)}
                    >
                      <ArrowDown aria-hidden="true" size={14} />
                    </IconButton>
                    <IconButton
                      disabled={isEditing}
                      label="编辑"
                      size="compact"
                      type="button"
                      variant="quiet"
                      onClick={() => onEdit(message)}
                    >
                      <Pencil aria-hidden="true" size={14} />
                    </IconButton>
                    {message.deliveryMode === "queue" ? (
                      <IconButton
                        label="直接发送"
                        size="compact"
                        type="button"
                        variant="quiet"
                        onClick={() => void onPromote(message.id)}
                      >
                        <SendHorizontal aria-hidden="true" size={14} />
                      </IconButton>
                    ) : null}
                    <IconButton
                      label="删除"
                      size="compact"
                      type="button"
                      variant="quiet"
                      onClick={() => void onDelete(message.id)}
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </IconButton>
                  </>
                )}
              </span>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function SubagentApprovalQueue({
  approvalErrors,
  approvals,
  approvingToolId,
  onChangeApproval,
  onOpenSubagent,
}: {
  approvalErrors: Readonly<Record<string, string>>;
  approvals: readonly SubagentPendingApproval[];
  approvingToolId: string | null;
  onChangeApproval: (
    tool: ConversationToolItem,
    approved: boolean,
    scope?: ApproveToolChangeInput["scope"],
  ) => Promise<void>;
  onOpenSubagent?: (sessionId: string) => void;
}): ReactElement {
  return (
    <section
      aria-label="Subagent 待审批操作"
      aria-live="polite"
      className="mx-auto mb-[5px] max-h-48 w-[min(var(--conversation-content-max-width),calc(100%-32px))] overflow-y-auto rounded-[var(--app-radius-large)] border border-[var(--app-border)] bg-[var(--app-panel)] text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] shadow-sm"
    >
      <header className="flex min-h-8 items-center gap-[5px] bg-[var(--app-panel-subtle)] px-2.5 py-1.5 font-semibold">
        <CircleAlert aria-hidden="true" className="shrink-0 text-[var(--app-accent)]" size={15} />
        <span className="min-w-0 flex-1">Subagent 等待审批</span>
        <span className="text-[var(--app-muted-foreground)]">{approvals.length} 项</span>
      </header>
      {approvals.map((approval) => {
        const isApproving = approvingToolId === approval.tool.id;
        const isExternalRead = approval.tool.name === "read_external_file";
        const approvalError = approvalErrors[approval.tool.id];
        return (
          <article
            className="border-t border-[var(--app-border)] px-2.5 py-2"
            key={approval.tool.id}
          >
            <div className="flex min-w-0 items-center gap-[5px]">
              <button
                className="flex min-w-0 items-center gap-[5px] rounded-[var(--app-radius-small)] px-1 py-0.5 text-left hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] disabled:cursor-default disabled:hover:bg-transparent"
                disabled={onOpenSubagent === undefined}
                title={`打开 Subagent：${approval.childTitle}`}
                type="button"
                onClick={() => onOpenSubagent?.(approval.childConversationId)}
              >
                <Bot aria-hidden="true" className="shrink-0 text-[var(--app-muted-foreground)]" size={14} />
                <span className="truncate font-medium">{approval.childTitle}</span>
                <ChevronRight aria-hidden="true" className="shrink-0 text-[var(--app-muted-foreground)]" size={13} />
              </button>
              <span className="min-w-0 flex-1 truncate text-[var(--app-muted-foreground)]">
                {toolActivityLabel(approval.tool)}
              </span>
            </div>
            {approvalError === undefined ? null : (
              <p className="mt-[5px] text-[var(--app-destructive)]">{approvalError}</p>
            )}
            <div className="mt-[5px] flex flex-wrap justify-end gap-[5px]">
              <button
                className="inline-flex min-h-7 items-center gap-1 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-transparent px-2 text-[var(--app-foreground)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isApproving}
                type="button"
                onClick={() => void onChangeApproval(approval.tool, false)}
              >
                <X aria-hidden="true" size={13} />
                拒绝
              </button>
              <button
                className="inline-flex min-h-7 items-center gap-1 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-transparent px-2 text-[var(--app-foreground)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isApproving}
                type="button"
                onClick={() => void onChangeApproval(approval.tool, true)}
              >
                <Check aria-hidden="true" size={13} />
                {isApproving ? "提交中" : "仅本次允许"}
              </button>
              {isExternalRead ? null : (
                <button
                  className="inline-flex min-h-7 items-center gap-1 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-transparent px-2 text-[var(--app-foreground)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isApproving}
                  title="仅允许该 Subagent 对话后续同类操作"
                  type="button"
                  onClick={() => void onChangeApproval(approval.tool, true, "session")}
                >
                  <Check aria-hidden="true" size={13} />
                  允许该 Subagent 会话
                </button>
              )}
              {isExternalRead ? null : (
                <button
                  className="inline-flex min-h-7 items-center gap-1 rounded-[var(--app-radius)] bg-[var(--app-accent)] px-2 text-[var(--app-accent-foreground)] hover:opacity-90 focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isApproving}
                  title="保存到该 Subagent 当前绑定 Agent 的权限规则"
                  type="button"
                  onClick={() => void onChangeApproval(approval.tool, true, "agent")}
                >
                  <ShieldCheck aria-hidden="true" size={13} />
                  Agent 一直允许
                </button>
              )}
            </div>
          </article>
        );
      })}
    </section>
  );
}

function ConversationTaskListPanel({
  allowClose = true,
  expanded,
  fileChanges,
  isActioning,
  isRunActive,
  lastRunStatus,
  taskList,
  onClose,
  onToggle,
}: {
  allowClose?: boolean;
  expanded: boolean;
  fileChanges: TaskFileChangeSummary;
  isActioning: boolean;
  isRunActive: boolean;
  lastRunStatus: ProjectSession["lastRunStatus"];
  taskList: ConversationTaskList;
  onClose: () => void;
  onToggle: () => void;
}): ReactElement {
  const [isChangesExpanded, setIsChangesExpanded] = useState(false);
  const runningIndex = taskList.tasks.findIndex((task) => task.status === "running");
  const blockedIndex = taskList.tasks.findIndex((task) => task.status === "blocked");
  const failedIndex = taskList.tasks.findIndex((task) => task.status === "failed");
  const completedCount = taskList.tasks.filter((task) => task.status === "completed").length;
  const isCompleted = completedCount === taskList.tasks.length;
  const inactiveRunningStatus = runningIndex < 0 || isRunActive
    ? null
    : lastRunStatus === "cancelled"
      ? "stopped"
      : lastRunStatus === "failed"
        ? "interrupted"
        : "paused";
  const summaryStatus = isCompleted
    ? "completed"
    : failedIndex >= 0
      ? "failed"
      : blockedIndex >= 0
        ? "blocked"
        : inactiveRunningStatus ?? "active";
  const currentStep =
    runningIndex >= 0
      ? runningIndex + 1
      : failedIndex >= 0
        ? failedIndex + 1
        : blockedIndex >= 0
          ? blockedIndex + 1
      : completedCount === taskList.tasks.length
        ? taskList.tasks.length
        : Math.min(taskList.tasks.length, completedCount + 1);
  const summaryId = `conversation-task-list-${taskList.conversationId}`;
  const changesId = `${summaryId}-changes`;

  const toggleTasks = (): void => {
    setIsChangesExpanded(false);
    onToggle();
  };

  const toggleChanges = (): void => {
    if (expanded) onToggle();
    setIsChangesExpanded((current) => !current);
  };

  return (
    <div
      className="conversation-task-list"
      data-expanded={String(expanded)}
      data-status={summaryStatus}
    >
      <div className="conversation-task-list__body">
        {expanded ? (
          <div className="conversation-task-list__details" id={summaryId} role="list">
            {taskList.tasks.map((task) => {
              const displayStatus = task.status === "running" && inactiveRunningStatus !== null
                ? inactiveRunningStatus
                : task.status;
              return (
                <div className="conversation-task-list__task" key={task.id} role="listitem">
                  <span
                    aria-label={
                      displayStatus === "completed"
                        ? "已完成"
                        : displayStatus === "running"
                          ? "正在进行"
                          : displayStatus === "blocked"
                            ? "已阻塞"
                            : displayStatus === "failed"
                              ? "已失败"
                              : displayStatus === "stopped"
                                ? "已停止"
                                : displayStatus === "interrupted"
                                  ? "已中断"
                                  : "已暂停"
                    }
                    className="conversation-task-list__status"
                    data-status={displayStatus}
                  >
                    {displayStatus === "completed" ? (
                      <Check aria-hidden="true" size={15} strokeWidth={2.4} />
                    ) : displayStatus === "running" ? (
                      <LoaderCircle
                        aria-hidden="true"
                        className="conversation-workspace__spin"
                        size={15}
                        strokeWidth={2.2}
                      />
                    ) : displayStatus === "blocked" ? (
                      <CircleAlert aria-hidden="true" size={15} strokeWidth={2.2} />
                    ) : displayStatus === "paused" ? (
                      <ListTodo aria-hidden="true" size={15} strokeWidth={1.9} />
                    ) : (
                      <X aria-hidden="true" size={15} strokeWidth={2.2} />
                    )}
                  </span>
                  <div className="conversation-task-list__task-content">
                    <span>{task.title}</span>
                  </div>
                </div>
              );
            })}
          </div>
        ) : null}
        {isChangesExpanded ? (
          <div
            aria-label="任务文件改动"
            className="conversation-task-list__details conversation-task-list__changes-details"
            id={changesId}
            role="list"
          >
            {fileChanges.files.map((file) => (
              <div className="conversation-task-list__file" key={file.path} role="listitem">
                <span title={file.path}>{file.path}</span>
                <span className="conversation-task-list__file-stats">
                  <span data-kind="addition">+{file.additions}</span>
                  <span data-kind="deletion">-{file.deletions}</span>
                </span>
              </div>
            ))}
          </div>
        ) : null}
        <div className="conversation-task-list__summary-control">
          <button
            aria-controls={summaryId}
            aria-expanded={expanded}
            className="conversation-task-list__summary"
            type="button"
            onClick={toggleTasks}
          >
            {isCompleted ? (
              <Check aria-hidden="true" className="conversation-task-list__summary-status" size={15} />
            ) : summaryStatus === "failed" ? (
              <X aria-hidden="true" className="conversation-task-list__summary-status" size={15} />
            ) : summaryStatus === "blocked" ? (
              <CircleAlert aria-hidden="true" className="conversation-task-list__summary-status" size={15} />
            ) : summaryStatus === "paused" ? (
              <ListTodo aria-hidden="true" className="conversation-task-list__summary-status" size={15} strokeWidth={1.9} />
            ) : summaryStatus === "stopped" || summaryStatus === "interrupted" ? (
              <X aria-hidden="true" className="conversation-task-list__summary-status" size={15} />
            ) : runningIndex >= 0 ? (
              <LoaderCircle
                aria-hidden="true"
                className="conversation-task-list__summary-status conversation-workspace__spin"
                size={15}
              />
            ) : (
              <ListTodo aria-hidden="true" size={15} strokeWidth={1.9} />
            )}
            <span>{`第 ${currentStep}/${taskList.tasks.length} 步`}</span>
            <span className="conversation-task-list__summary-divider" aria-hidden="true">·</span>
            <span>{
              isCompleted
                ? "任务已完成"
                : summaryStatus === "failed"
                  ? "任务已失败"
                  : summaryStatus === "blocked"
                    ? "任务已阻塞"
                    : summaryStatus === "stopped"
                      ? "任务已停止"
                      : summaryStatus === "interrupted"
                        ? "任务已中断"
                        : summaryStatus === "paused"
                          ? "任务待继续"
                          : "任务清单"
            }</span>
            <ChevronDown aria-hidden="true" className="conversation-task-list__chevron" size={15} />
          </button>
          {fileChanges.files.length > 0 ? (
            <button
              aria-controls={changesId}
              aria-expanded={isChangesExpanded}
              aria-label={`查看 ${fileChanges.files.length} 个文件的改动`}
              className="conversation-task-list__changes"
              title="查看文件改动"
              type="button"
              onClick={toggleChanges}
            >
              <span>{fileChanges.files.length} 个文件已更改</span>
              <span data-kind="addition">+{fileChanges.additions}</span>
              <span data-kind="deletion">-{fileChanges.deletions}</span>
            </button>
          ) : null}
        </div>
      </div>
      {allowClose ? <IconButton
        className="conversation-task-list__action"
        disabled={isActioning}
        label="关闭任务清单"
        size="compact"
        variant="quiet"
        onClick={onClose}
      >
        {isActioning ? (
          <LoaderCircle aria-hidden="true" className="conversation-workspace__spin" size={14} />
        ) : (
          <X aria-hidden="true" size={15} />
        )}
      </IconButton> : null}
    </div>
  );
}

function upsertTimelineItem(
  timeline: ConversationTimelineItem[],
  item: ConversationTimelineItem,
): ConversationTimelineItem[] {
  const index = timeline.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) {
    return [...timeline, item];
  }

  return timeline.map((candidate) => (candidate.id === item.id ? item : candidate));
}

function replaceTimelineFromMessage(
  timeline: ConversationTimelineItem[],
  replacement: ConversationMessageItem,
): ConversationTimelineItem[] {
  const sourceIndex = timeline.findIndex((item) => item.id === replacement.id);
  const source = timeline[sourceIndex];
  if (sourceIndex < 0 || source?.kind !== "message" || source.runId === null) {
    return upsertTimelineItem(timeline, replacement);
  }

  return timeline.flatMap((item, index) => {
    if (item.id === replacement.id) return [replacement];
    return index > sourceIndex && item.runId === source.runId ? [] : [item];
  });
}

export function formatConversationTime(createdAt: string, now = new Date()): string {
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime())) return "";

  const isSameDay = timestamp.getFullYear() === now.getFullYear()
    && timestamp.getMonth() === now.getMonth()
    && timestamp.getDate() === now.getDate();
  if (isSameDay) return formatLocalClock(timestamp);

  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  const isYesterday = timestamp.getFullYear() === yesterday.getFullYear()
    && timestamp.getMonth() === yesterday.getMonth()
    && timestamp.getDate() === yesterday.getDate();
  if (isYesterday) return `昨天 ${formatLocalClock(timestamp)}`;

  if (timestamp.getFullYear() === now.getFullYear()) {
    return `${timestamp.getMonth() + 1}月${timestamp.getDate()}日 ${formatLocalClock(timestamp)}`;
  }
  return `${timestamp.getFullYear()}年${timestamp.getMonth() + 1}月${timestamp.getDate()}日 ${formatLocalClock(timestamp)}`;
}

function formatConversationDateTime(createdAt: string): string {
  const timestamp = new Date(createdAt);
  if (Number.isNaN(timestamp.getTime())) return "";
  return `${timestamp.getFullYear()}年${timestamp.getMonth() + 1}月${timestamp.getDate()}日 ${formatLocalClock(timestamp)}`;
}

function formatLocalClock(timestamp: Date): string {
  return `${String(timestamp.getHours()).padStart(2, "0")}:${String(timestamp.getMinutes()).padStart(2, "0")}`;
}

export function groupToolBatches(
  timeline: ConversationTimelineItem[],
  breakAfterTimelineItemId: string | null = null,
): TimelineDisplayItem[] {
  const grouped: TimelineDisplayItem[] = [];
  let tools: ConversationToolItem[] = [];

  const flushTools = (): void => {
    if (tools.length === 0) return;
    const firstTool = tools[0];
    if (firstTool === undefined) return;
    if (tools.length === 1) {
      grouped.push(firstTool);
    } else {
      grouped.push({
        batchId: firstTool.batchId ?? firstTool.id,
        id: `tool-batch:${firstTool.id}`,
        kind: "tool_batch",
        tools,
      });
    }
    tools = [];
  };

  for (const item of timeline) {
    if (item.kind === "tool") {
      tools.push(item);
      if (item.id === breakAfterTimelineItemId) flushTools();
      continue;
    }
    flushTools();
    grouped.push(item);
  }

  flushTools();
  return grouped;
}

export function getConversationRunDurationInsertIndexes(
  timeline: readonly {
    durationMs?: number | null | undefined;
    kind: string;
    role?: string | undefined;
    runId?: string | null | undefined;
  }[],
): ReadonlyMap<number, readonly number[]> {
  const durationsByInsertIndex = new Map<number, number[]>();
  const completedRunIds = new Set<string>();
  let runStartIndex = 0;

  for (const [index, item] of timeline.entries()) {
    if (item.kind === "message" && item.role === "user") {
      runStartIndex = index + 1;
      continue;
    }
    if (item.kind !== "message" || item.role !== "assistant" || item.durationMs == null) {
      continue;
    }
    const runId = item.runId ?? `legacy-turn:${runStartIndex}`;
    if (completedRunIds.has(runId)) continue;
    completedRunIds.add(runId);
    const durations = durationsByInsertIndex.get(runStartIndex) ?? [];
    durations.push(item.durationMs);
    durationsByInsertIndex.set(runStartIndex, durations);
  }

  return durationsByInsertIndex;
}

export function getFinalCompletedAssistantMessageIds(
  timeline: readonly {
    id: string;
    kind: string;
    role?: string | undefined;
    runId?: string | null | undefined;
    status?: string | undefined;
  }[],
): ReadonlySet<string> {
  return new Set(timeline.flatMap((item, index) => {
    if (
      item.kind !== "message"
      || item.role !== "assistant"
      || item.status !== "completed"
      || item.runId == null
    ) {
      return [];
    }
    const hasLaterItemInRun = timeline
      .slice(index + 1)
      .some((candidate) => candidate.runId === item.runId);
    return hasLaterItemInRun ? [] : [item.id];
  }));
}

function timelineDisplayItemContains(item: TimelineDisplayItem, timelineItemId: string): boolean {
  return item.kind === "tool_batch"
    ? item.tools.some((tool) => tool.id === timelineItemId)
    : item.id === timelineItemId;
}

function TimelineItem({
  item,
  teamManaged,
  activeRunId,
  modelActivity,
  approvalErrors,
  approvingToolId,
  canCopyMessage,
  canForkMessage,
  canShowCompletionTime,
  copiedMessageId,
  editingMessageId,
  forkingMessageId,
  latestUserMessageId,
  onChangeApproval,
  onCopyMessage,
  onEditMessage,
  onForkMessage,
  onOpenProjectFile,
  onSessionSelected,
  liveToolOutputs,
}: {
  item: TimelineDisplayItem;
  teamManaged: boolean;
  activeRunId: string | null;
  modelActivity: ModelActivity | null;
  approvalErrors: Readonly<Record<string, string>>;
  approvingToolId: string | null;
  canCopyMessage: boolean;
  canForkMessage: boolean;
  canShowCompletionTime: boolean;
  copiedMessageId: string | null;
  editingMessageId: string | null;
  forkingMessageId: string | null;
  latestUserMessageId: string | null;
  onChangeApproval: (
    tool: ConversationToolItem,
    approved: boolean,
    scope?: ApproveToolChangeInput["scope"],
  ) => Promise<void>;
  onCopyMessage: (message: ConversationMessageItem) => Promise<void>;
  onEditMessage: (message: ConversationMessageItem) => void;
  onForkMessage: (message: ConversationMessageItem) => Promise<void>;
  onOpenProjectFile: ((path: string) => void) | undefined;
  onSessionSelected: ((sessionId: string) => void) | undefined;
  liveToolOutputs: Readonly<Record<string, LiveToolOutput>>;
}): ReactElement | null {
  if (item.kind === "tool_batch") {
    const hasFailure = item.tools.some((tool) =>
      toolItemHasFailure(tool) || approvalErrors[tool.id] !== undefined
    );
    return (
      <ToolBatchTimelineItem
        key={`${item.id}:${String(hasFailure)}`}
        item={item}
        teamManaged={teamManaged}
        activeRunId={activeRunId}
        modelActivity={modelActivity}
        approvalErrors={approvalErrors}
        approvingToolId={approvingToolId}
        onOpenProjectFile={onOpenProjectFile}
        onChangeApproval={onChangeApproval}
        liveToolOutputs={liveToolOutputs}
      />
    );
  }

  if (item.kind === "tool") {
    return (
      <ToolTimelineItem
        key={`${item.id}:${approvalErrors[item.id] === undefined ? String(toolItemHasFailure(item)) : "approval_failed"}`}
        item={item}
        teamManaged={teamManaged}
        approvalActionable={item.runId === activeRunId}
        approvalError={approvalErrors[item.id] ?? null}
        isApproving={approvingToolId === item.id}
        onOpenProjectFile={onOpenProjectFile}
        variant="activity"
        onChangeApproval={onChangeApproval}
        liveOutput={liveToolOutputs[item.id]}
      />
    );
  }

  if (item.kind === "agent_message") {
    if (item.messageType === "task_result") return null;
    return (
      <article
        className="chat-message conversation-agent-message"
        data-role="user"
        data-status={item.status}
      >
        <button
          aria-label={`打开来源对话 ${item.senderTitle}`}
          className="conversation-agent-message__source"
          title={`打开来源对话：${item.senderTitle}`}
          type="button"
          onClick={() => onSessionSelected?.(item.senderConversationId)}
        >
          <Bot aria-hidden="true" size={15} />
          <span>
            {item.messageType === "agent_result"
                ? "Agent 处理结果"
                : "来自"} {item.senderTitle}
          </span>
        </button>
        <p>{item.content}</p>
      </article>
    );
  }

  const copied = copiedMessageId === item.id;
  const editing = editingMessageId === item.id;
  const isForking = forkingMessageId === item.id;
  const canEdit = item.role === "user" && item.id === latestUserMessageId;
  const showMessageMeta = item.role === "user"
    || canShowCompletionTime
    || canCopyMessage
    || canForkMessage
    || canEdit;

  return (
    <div className="chat-message-group" data-role={item.role}>
      <article className="chat-message" data-role={item.role} data-status={item.status}>
        {item.role === "assistant" && item.status === "failed" ? (
          <ConversationErrorContent content={item.content} />
        ) : item.role === "assistant" ? (
          <AgentMarkdown content={item.content} />
        ) : (
          <>
            {item.attachments.length > 0 ? (
              <div className="conversation-attachments conversation-attachments--message">
                {item.attachments.map((attachment) => (
                  <AttachmentChip key={attachment.id} attachment={attachment} />
                ))}
              </div>
            ) : null}
            {item.content.length > 0 ? <p>{item.content}</p> : null}
          </>
        )}
      </article>
      {showMessageMeta ? <div className="chat-message__meta">
        {item.role === "user" ? (
          <time dateTime={item.createdAt} title={formatConversationDateTime(item.createdAt)}>
            {formatConversationTime(item.createdAt)}
          </time>
        ) : null}
        {canCopyMessage ? (
          <IconButton
            disabled={item.content.length === 0}
            label={copied
              ? item.role === "user" ? "已复制消息" : "已复制完整回复"
              : item.role === "user" ? "复制消息" : "复制完整回复"}
            size="compact"
            type="button"
            variant="quiet"
            onClick={() => void onCopyMessage(item)}
          >
            {copied ? (
              <Check aria-hidden="true" size={14} />
            ) : (
              <Copy aria-hidden="true" size={14} />
            )}
          </IconButton>
        ) : null}
        {item.role === "assistant" ? (
          canForkMessage ? (
            <IconButton
              disabled={isForking}
              label={isForking ? "正在创建分支对话" : "从此回复创建分支对话"}
              size="compact"
              type="button"
              variant="quiet"
              onClick={() => void onForkMessage(item)}
            >
              {isForking ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="conversation-workspace__spin"
                  size={14}
                />
              ) : (
                <GitFork aria-hidden="true" size={14} />
              )}
            </IconButton>
          ) : null
        ) : canEdit ? (
          <IconButton
            disabled={editing}
            label={editing ? "正在编辑" : "编辑并重新生成"}
            size="compact"
            type="button"
            variant={editing ? "active" : "quiet"}
            onClick={() => onEditMessage(item)}
          >
            <Pencil aria-hidden="true" size={14} />
          </IconButton>
        ) : null}
        {item.role === "assistant" && canShowCompletionTime && item.completedAt != null ? (
          <time dateTime={item.completedAt} title={formatConversationDateTime(item.completedAt)}>
            {formatConversationTime(item.completedAt)}
          </time>
        ) : null}
      </div> : null}
    </div>
  );
}

function AttachmentChip({
  attachment,
  isRemoving = false,
  onRemove,
}: {
  attachment: ConversationAttachment;
  isRemoving?: boolean;
  onRemove?: () => void;
}): ReactElement {
  const sourceLabel = attachment.projectPath ?? "上传文件";
  return (
    <span className="conversation-attachment" title={`${sourceLabel} · ${formatFileSize(attachment.sizeBytes)}`}>
      {attachment.kind === "image" ? (
        <ImageIcon aria-hidden="true" size={15} />
      ) : (
        <FileText aria-hidden="true" size={15} />
      )}
      <span className="conversation-attachment__identity">
        <strong>{attachment.name}</strong>
        <small>
          {formatFileSize(attachment.sizeBytes)}
          {attachment.truncated ? " · 已按预览注入" : ""}
        </small>
      </span>
      {onRemove === undefined ? null : (
        <button
          aria-label={`移除附件 ${attachment.name}`}
          disabled={isRemoving}
          type="button"
          onClick={onRemove}
        >
          {isRemoving ? (
            <LoaderCircle aria-hidden="true" className="conversation-workspace__spin" size={13} />
          ) : (
            <X aria-hidden="true" size={13} />
          )}
        </button>
      )}
    </span>
  );
}

function formatFileSize(sizeBytes: number): string {
  if (sizeBytes < 1_024) return `${sizeBytes} B`;
  if (sizeBytes < 1_024 * 1_024) return `${Math.ceil(sizeBytes / 1_024)} KB`;
  return `${(sizeBytes / (1_024 * 1_024)).toFixed(1)} MB`;
}

function ConversationErrorItem({ content }: { content: string }): ReactElement {
  return <ConversationErrorQuote content={content} scope="operation" />;
}

function ConversationErrorContent({ content }: { content: string }): ReactElement {
  return <ConversationErrorQuote content={content} scope="model" />;
}

export function stripLegacyErrorInstanceId(content: string): string {
  return redactErrorIdentifiers(content.replace(
    /\s*[（(]错误编号：[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[）)]/giu,
    "",
  )).trim();
}

type ConversationErrorScope = "model" | "operation" | "tool";
type ConversationErrorCategory =
  | "authentication"
  | "internal"
  | "network"
  | "provider"
  | "quota"
  | "response"
  | "timeout"
  | "tool"
  | "unknown";

export type ConversationErrorPresentation = {
  category: ConversationErrorCategory;
  detail: string;
  summary: string;
  title: string;
};

export function describeConversationError(
  content: string,
  scope: ConversationErrorScope = "model",
): ConversationErrorPresentation {
  const detail = stripLegacyErrorInstanceId(content);
  const normalized = detail.toLowerCase();
  if (scope === "tool") {
    return {
      category: "tool",
      detail: detail || "工具调用没有返回可显示的错误详情。",
      summary: summarizeErrorDetail(detail, "工具执行未完成"),
      title: "工具调用失败",
    };
  }
  if (scope === "operation") {
    return {
      category: "internal",
      detail: detail || "操作没有返回可显示的错误详情。",
      summary: summarizeErrorDetail(detail, "操作未完成"),
      title: "操作失败",
    };
  }

  const httpStatus = detail.match(/\bHTTP\s+(\d{3})\b/iu)?.[1] ?? null;
  const isTimeoutStatus = httpStatus === "408" || httpStatus === "504";
  const category = normalized.includes("401")
    || normalized.includes("403")
    || /模型认证失败|api key|apikey|unauthorized|forbidden/iu.test(detail)
    ? "authentication"
    : normalized.includes("402")
      || normalized.includes("429")
      || /额度不足|余额不足|请求过于频繁|too many requests|quota|insufficient credit/iu.test(detail)
      ? "quota"
      : isTimeoutStatus
        || (httpStatus === null && /请求超时|连接超时|timed out|timeout/iu.test(detail))
        ? "timeout"
        : /接口错误|模型服务暂时不可用|gateway|upstream|\b5\d{2}\b/iu.test(detail)
          ? "provider"
          : /网络连接失败|网络错误详情|fetch failed|socket|econn|connection failed|error sending request/iu.test(detail)
            ? "network"
            : /模型未返回|响应无法处理|无法处理的响应|empty response|incomplete response/iu.test(detail)
              ? "response"
              : /内部错误|软件内部|ipc|sqlite|database|module not found/iu.test(detail)
                ? "internal"
                : "unknown";
  const labels: Record<Exclude<ConversationErrorCategory, "tool" | "unknown">, string> = {
    authentication: "模型认证失败",
    internal: "软件内部错误",
    network: "网络连接失败",
    provider: "模型服务返回错误",
    quota: "模型额度或频率受限",
    response: "模型响应无法处理",
    timeout: "模型请求超时",
  };

  return {
    category,
    detail: detail || "模型请求没有返回可显示的错误详情。",
    summary: category === "unknown"
      ? summarizeErrorDetail(detail, "模型请求未完成")
      : labels[category],
    title: category === "unknown" ? "模型请求未完成" : labels[category],
  };
}

function summarizeErrorDetail(detail: string, fallback: string): string {
  const firstLine = detail
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .find((line) => line.length > 0);
  if (firstLine === undefined) return fallback;
  const summary = firstLine
    .replace(/^接口错误：HTTP\s+\d+：?/iu, "")
    .replace(/^网络错误详情：/iu, "")
    .replace(/^内部错误详情：/iu, "")
    .trim();
  return summary.length > 120 ? `${summary.slice(0, 117)}...` : summary || fallback;
}

function ConversationErrorQuote({
  content,
  scope,
}: {
  content: string;
  scope: ConversationErrorScope;
}): ReactElement {
  const presentation = describeConversationError(content, scope);

  return (
    <div
      className="agent-markdown conversation-error-quote"
      data-category={presentation.category}
      data-scope={scope}
      role="alert"
    >
      <blockquote>
        <p className="conversation-error-quote__heading">
          <CircleAlert aria-hidden="true" size={15} />
          <strong>{presentation.title}</strong>
        </p>
        <p className="conversation-error-quote__detail">{presentation.detail}</p>
      </blockquote>
    </div>
  );
}

function toolItemHasFailure(item: ConversationToolItem): boolean {
  if (item.status === "failed") return true;
  if (item.result === null) return false;
  if (parseToolError(item.result) !== null) return true;

  if (
    item.name === "spawn_subagent"
    || item.name === "list_subagents"
    || item.name === "wait_for_subagents"
  ) {
    return parseSubagentToolResult(item.result)?.tasks.some((task) =>
      task.status === "failed" || task.status === "cancelled"
    ) === true;
  }

  if (item.name === "run_command") {
    const result = parseCommandResult(item.result);
    return result?.status === "failed" || result?.timedOut === true;
  }

  if (item.name === "wait_for_commands" || item.name === "stop_command") {
    const result = parseCommandLifecycleResult(
      item.result,
      item.name === "wait_for_commands" ? "wait" : "stop",
    );
    return result?.commands.some((command) =>
      command.status === "failed" || command.timedOut
    ) === true;
  }

  return false;
}

function ToolBatchTimelineItem({
  item,
  teamManaged,
  activeRunId,
  modelActivity,
  approvalErrors,
  approvingToolId,
  onOpenProjectFile,
  onChangeApproval,
  liveToolOutputs,
}: {
  item: Extract<TimelineDisplayItem, { kind: "tool_batch" }>;
  teamManaged: boolean;
  activeRunId: string | null;
  modelActivity: ModelActivity | null;
  approvalErrors: Readonly<Record<string, string>>;
  approvingToolId: string | null;
  onOpenProjectFile: ((path: string) => void) | undefined;
  onChangeApproval: (
    tool: ConversationToolItem,
    approved: boolean,
    scope?: ApproveToolChangeInput["scope"],
  ) => Promise<void>;
  liveToolOutputs: Readonly<Record<string, LiveToolOutput>>;
}): ReactElement {
  const [isExpanded, setIsExpanded] = useState(() =>
    item.tools.some((tool) =>
      tool.status === "running"
      || tool.status === "awaiting_approval"
      || approvalErrors[tool.id] !== undefined
    ),
  );
  const hasFailure = item.tools.some((tool) =>
    toolItemHasFailure(tool) || approvalErrors[tool.id] !== undefined
  );
  const executionMode = toolBatchExecutionMode(item.tools);
  const hasRunningTool = item.tools.some((tool) => tool.status === "running");
  const label = modelActivity === null
    ? toolBatchLabel(item.tools, teamManaged)
    : modelActivityLabel(modelActivity) ?? toolBatchLabel(item.tools, teamManaged);
  const toggleLabel = isExpanded ? "收起本轮工具调用" : "展开本轮工具调用";

  return (
    <section className="tool-activity-batch" data-status={hasFailure ? "failed" : undefined}>
      <header className="tool-activity-batch__header">
        <span className="tool-activity-batch__identity">
          <ToolTypeIcon name={representativeToolName(item.tools)} />
          <span>{label}</span>
          {executionMode === "parallel" ? (
            <span className="tool-activity-batch__execution">
              {hasRunningTool ? "并行执行中" : "并行执行"}
            </span>
          ) : null}
          {hasFailure ? <span className="tool-activity-batch__status">有失败项</span> : null}
          <button
            aria-expanded={isExpanded}
            aria-label={toggleLabel}
            className="tool-activity-batch__toggle"
            title={toggleLabel}
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
          >
            <ChevronRight aria-hidden="true" size={15} />
          </button>
        </span>
      </header>
      {isExpanded ? (
        <div className="tool-activity-batch__items">
          {item.tools.map((tool) => (
            <ToolTimelineItem
              key={`${tool.id}:${approvalErrors[tool.id] === undefined ? String(toolItemHasFailure(tool)) : "approval_failed"}`}
              item={tool}
              teamManaged={teamManaged}
              approvalActionable={tool.runId === activeRunId}
              approvalError={approvalErrors[tool.id] ?? null}
              isApproving={approvingToolId === tool.id}
              onOpenProjectFile={onOpenProjectFile}
              variant="activity"
              onChangeApproval={onChangeApproval}
              liveOutput={liveToolOutputs[tool.id]}
            />
          ))}
        </div>
      ) : null}
    </section>
  );
}

function ToolTimelineItem({
  item,
  teamManaged,
  approvalActionable,
  approvalError,
  isApproving,
  variant = "card",
  onOpenProjectFile,
  onChangeApproval,
  liveOutput,
}: {
  item: ConversationToolItem;
  teamManaged: boolean;
  approvalActionable: boolean;
  approvalError: string | null;
  isApproving: boolean;
  variant?: "activity" | "card";
  onOpenProjectFile: ((path: string) => void) | undefined;
  onChangeApproval: (
    tool: ConversationToolItem,
    approved: boolean,
    scope?: ApproveToolChangeInput["scope"],
  ) => Promise<void>;
  liveOutput: LiveToolOutput | undefined;
}): ReactElement {
  const isCommand = item.name === "run_command";
  const isExternalRead = item.name === "read_external_file";
  const isFileDeletion = item.name === "delete_file";
  const isExpiredApproval = item.status === "awaiting_approval" && !approvalActionable;
  const effectiveStatus = isExpiredApproval
    ? "cancelled"
    : approvalError === null && !toolItemHasFailure(item)
    ? item.status
    : "failed";
  const [isExpanded, setIsExpanded] = useState(() =>
    effectiveStatus === "running" || effectiveStatus === "awaiting_approval",
  );
  const [isRawCallOpen, setIsRawCallOpen] = useState(false);
  const detailsLabel = isExpanded ? "收起调用详情" : "展开调用详情";

  return (
    <article
      className={variant === "activity" ? "tool-activity-row" : "tool-timeline-item"}
      data-status={effectiveStatus}
    >
      <header className="tool-timeline-item__header">
        <span className="tool-timeline-item__identity">
          <ToolTypeIcon name={item.name} />
          <ToolActivityLabel
            item={item}
            teamManaged={teamManaged}
            onOpenProjectFile={onOpenProjectFile}
          />
          {effectiveStatus === "running" ? <ToolExecutionTimer /> : null}
          {effectiveStatus !== "completed" ? (
            <span className="tool-timeline-item__status-label">
              {toolStatusLabel(effectiveStatus)}
            </span>
          ) : null}
          <button
            aria-label="查看调用情况"
            className="tool-timeline-item__raw-button"
            title="查看调用情况"
            type="button"
            onClick={() => setIsRawCallOpen(true)}
          >
            <Eye aria-hidden="true" size={15} />
          </button>
          <button
            aria-expanded={isExpanded}
            aria-label={detailsLabel}
            className="tool-timeline-item__toggle"
            title={detailsLabel}
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
          >
            <ChevronRight aria-hidden="true" size={15} />
          </button>
        </span>
      </header>
      {isExpanded ? (
        <ToolDetail
          item={item}
          teamManaged={teamManaged}
          onOpenProjectFile={onOpenProjectFile}
          {...(liveOutput === undefined ? {} : { liveOutput })}
        />
      ) : null}
      {approvalError === null ? null : <ToolErrorNotice message={approvalError} />}
      {isExpiredApproval ? (
        <footer className="tool-timeline-item__approval">
          <span>该审批已随运行结束失效。</span>
        </footer>
      ) : item.status === "awaiting_approval" ? (
        <footer className="tool-timeline-item__approval">
          <span>
            {isExternalRead
              ? "读取工作区外文件前需要确认"
              : isCommand
              ? "等待确认后执行命令"
              : isFileDeletion
                ? "等待确认后删除文件"
                : "等待确认后写入文件"}
          </span>
          <span className="tool-timeline-item__approval-actions">
            <button
              disabled={isApproving}
              type="button"
              onClick={() => void onChangeApproval(item, false)}
            >
              <X aria-hidden="true" size={14} />
              拒绝
            </button>
            <button
              disabled={isApproving}
              type="button"
              onClick={() => void onChangeApproval(item, true)}
            >
              <Check aria-hidden="true" size={14} />
              {isApproving
                ? "提交中"
                : "本次允许"}
            </button>
            {isExternalRead ? null : (
              <button
                disabled={isApproving}
                title="当前对话后续同类操作自动允许"
                type="button"
                onClick={() => void onChangeApproval(item, true, "session")}
              >
                <Check aria-hidden="true" size={14} />
                本会话允许
              </button>
            )}
            {isExternalRead ? null : (
              <button
                disabled={isApproving}
                title="保存到当前 Agent 的权限规则"
                type="button"
                onClick={() => void onChangeApproval(item, true, "agent")}
              >
                <ShieldCheck aria-hidden="true" size={14} />
                Agent 一直允许
              </button>
            )}
          </span>
        </footer>
      ) : null}
      {isRawCallOpen ? (
        <ToolRawCallDialog item={item} onClose={() => setIsRawCallOpen(false)} />
      ) : null}
    </article>
  );
}

function ToolExecutionTimer(): ReactElement {
  const startedAtRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    startedAtRef.current = Date.now();
    const updateElapsed = (): void => {
      const startedAt = startedAtRef.current;
      if (startedAt === null) return;
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAt) / 1_000)));
    };
    updateElapsed();
    const timerId = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timerId);
  }, []);

  return (
    <span
      aria-label={`已运行 ${elapsedSeconds} 秒`}
      className="tool-execution-timer"
      title={`已运行 ${elapsedSeconds} 秒`}
    >
      {elapsedSeconds}s
    </span>
  );
}

function ToolTypeIcon({ name }: { name: string }): ReactElement {
  switch (name) {
    case "run_command":
      return <Terminal aria-hidden="true" size={15} />;
    case "wait_for_commands":
    case "wait_for_project_operation":
      return <LoaderCircle aria-hidden="true" size={15} />;
    case "stop_command":
      return <Square aria-hidden="true" size={15} />;
    case "read_file":
    case "read_external_file":
    case "get_project_info":
      return <FileText aria-hidden="true" size={15} />;
    case "list_directory":
      return <FolderOpen aria-hidden="true" size={15} />;
    case "list_project_operations":
      return <Wrench aria-hidden="true" size={15} />;
    case "search_text":
    case "web_search":
      return <Search aria-hidden="true" size={15} />;
    case "find_files":
      return <FileSearch aria-hidden="true" size={15} />;
    case "read_attachment":
      return <Paperclip aria-hidden="true" size={15} />;
    case "write_file":
    case "replace_in_file":
      return <Pencil aria-hidden="true" size={15} />;
    case "delete_file":
      return <Trash2 aria-hidden="true" size={15} />;
    case "apply_patch":
      return <FileDiff aria-hidden="true" size={15} />;
    case "create_task_list":
    case "update_task_list":
      return <ListTodo aria-hidden="true" size={15} />;
    case "close_task_list":
      return <X aria-hidden="true" size={15} />;
    case "list_agent_conversations":
    case "read_agent_conversation":
      return <MessageSquareText aria-hidden="true" size={15} />;
    case "send_agent_message":
      return <Send aria-hidden="true" size={15} />;
    case "wait_for_agent_message":
    case "wait_for_subagents":
      return <LoaderCircle aria-hidden="true" size={15} />;
    case "spawn_subagent":
    case "list_subagents":
      return <Bot aria-hidden="true" size={15} />;
    default:
      return <Wrench aria-hidden="true" size={15} />;
  }
}

function toolStatusLabel(status: ConversationToolItem["status"]): string {
  switch (status) {
    case "running":
      return "执行中";
    case "awaiting_approval":
      return "等待确认";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "rejected":
      return "已拒绝";
    case "cancelled":
      return "已失效";
  }
}

function toolActivityLabel(item: ConversationToolItem, teamManaged = false): string {
  const argumentsValue = parseToolPayload(item.arguments);
  const path = typeof argumentsValue?.path === "string" ? argumentsValue.path : null;
  const completed = item.status === "completed";

  switch (item.name) {
    case "run_command": {
      const command = typeof argumentsValue?.command === "string" ? argumentsValue.command : null;
      const commandResult = item.result === null ? null : parseCommandResult(item.result);
      if (commandResult?.status === "running") {
        return command === null ? "命令正在后台运行" : `后台运行 ${command}`;
      }
      return command === null
        ? (completed ? "已运行命令" : "运行命令")
        : `${completed ? "已运行" : "运行"} ${command}`;
    }
    case "wait_for_commands": {
      const commandIds = Array.isArray(argumentsValue?.commandIds) ? argumentsValue.commandIds : [];
      return completed
        ? `已等待 ${commandIds.length} 条后台命令`
        : `等待 ${commandIds.length} 条后台命令`;
    }
    case "stop_command":
      return completed ? "后台命令已停止" : "停止后台命令";
    case "list_project_operations":
      return completed ? "已查看项目操作" : "查看项目操作";
    case "wait_for_project_operation":
      return completed ? "项目操作等待结束" : "等待项目操作";
    case "read_file":
      return path === null
        ? (completed ? "已读取文件" : "读取文件")
        : `${completed ? "已读取" : "读取"} ${fileNameFromPath(path)}`;
    case "read_external_file":
      return path === null
        ? (completed ? "已读取工作区外文件" : "读取工作区外文件")
        : `${completed ? "已读取" : "读取"} ${path}`;
    case "read_attachment":
      return completed ? "已读取附件" : "读取附件";
    case "list_directory":
      return path === null || path.length === 0 ? "查看工作区目录" : `查看 ${path}`;
    case "search_text": {
      const query = typeof argumentsValue?.query === "string" ? argumentsValue.query : null;
      return query === null ? "搜索文本" : `搜索 “${query}”`;
    }
    case "web_search": {
      const query = typeof argumentsValue?.query === "string" ? argumentsValue.query : null;
      return query === null ? "搜索网页" : `搜索网页 “${query}”`;
    }
    case "find_files": {
      const pattern = typeof argumentsValue?.pattern === "string" ? argumentsValue.pattern : null;
      return pattern === null ? "查找文件" : `查找 ${pattern}`;
    }
    case "write_file": {
      const overwrites = argumentsValue?.overwrite === true;
      if (!overwrites) return completed ? "文件已创建" : "创建文件";
      return completed ? "文件已编辑" : "编辑文件";
    }
    case "replace_in_file":
      return completed ? "文件已编辑" : "编辑文件";
    case "delete_file":
      return completed ? "文件已删除" : "删除文件";
    case "apply_patch":
      return completed ? "文件已编辑" : "编辑文件";
    case "get_project_info":
      return "读取项目信息";
    case "create_task_list":
      return completed ? "任务清单已创建" : "创建任务清单";
    case "update_task_list":
      return completed ? "任务清单已更新" : "更新任务清单";
    case "close_task_list":
      return completed ? "任务清单已关闭" : "关闭任务清单";
    case "list_agent_conversations":
      return completed
        ? (teamManaged ? "已查看团队成员对话" : "已查看 Agent 对话")
        : (teamManaged ? "查看团队成员对话" : "查看 Agent 对话");
    case "read_agent_conversation":
      return completed
        ? (teamManaged ? "已读取团队成员对话" : "已读取 Agent 对话")
        : (teamManaged ? "读取团队成员对话" : "读取 Agent 对话");
    case "send_agent_message":
      return completed
        ? (teamManaged ? "团队成员消息已发送" : "Agent 消息已发送")
        : (teamManaged ? "发送团队成员消息" : "发送 Agent 消息");
    case "wait_for_agent_message":
      return completed
        ? (teamManaged ? "团队成员消息等待结束" : "Agent 消息等待结束")
        : (teamManaged ? "等待团队成员消息" : "等待 Agent 消息");
    case "spawn_subagent":
      return completed
        ? (teamManaged ? "团队成员已启动" : "Subagent 已启动")
        : (teamManaged ? "启动团队成员" : "启动 Subagent");
    case "list_subagents":
      return completed
        ? (teamManaged ? "已查看团队成员" : "已查看 Subagent")
        : (teamManaged ? "查看团队成员" : "查看 Subagent");
    case "wait_for_subagents":
      return completed
        ? (teamManaged ? "团队成员等待结束" : "Subagent 等待结束")
        : (teamManaged ? "等待团队成员" : "等待 Subagent");
    default:
      return item.name;
  }
}

function ToolActivityLabel({
  item,
  teamManaged,
  onOpenProjectFile,
}: {
  item: ConversationToolItem;
  teamManaged: boolean;
  onOpenProjectFile: ((path: string) => void) | undefined;
}): ReactElement {
  const summary = fileChangeSummary(item);
  if (summary === null) return <span>{toolActivityLabel(item, teamManaged)}</span>;

  return (
    <span className="tool-timeline-item__activity-label">
      <span>{summary.action}</span>
      {onOpenProjectFile === undefined ? (
        <span title={summary.path}>{fileNameFromPath(summary.path)}</span>
      ) : (
        <button
          aria-label={`在侧边工作区打开文件 ${summary.path}`}
          className="tool-timeline-item__file-link"
          title={`在侧边工作区打开 ${summary.path}`}
          type="button"
          onClick={() => onOpenProjectFile(summary.path)}
        >
          {fileNameFromPath(summary.path)}
        </button>
      )}
      {summary.additions === null || summary.deletions === null ? null : (
        <span className="tool-timeline-item__change-counts">
          <span data-kind="addition">+{summary.additions}</span>
          <span data-kind="deletion">-{summary.deletions}</span>
        </span>
      )}
    </span>
  );
}

type ToolBatchCategory = {
  iconToolName: string;
  label: (count: number) => string;
  names: readonly string[];
  priority: number;
};

const TOOL_BATCH_CATEGORIES: readonly ToolBatchCategory[] = [
  {
    iconToolName: "write_file",
    label: (count) => `编辑 ${count} 个文件`,
    names: ["write_file", "replace_in_file", "apply_patch", "delete_file"],
    priority: 100,
  },
  {
    iconToolName: "run_command",
    label: (count) => `运行 ${count} 条命令`,
    names: ["run_command", "wait_for_commands", "stop_command"],
    priority: 90,
  },
  {
    iconToolName: "read_file",
    label: (count) => `读取 ${count} 个文件`,
    names: ["read_file", "read_external_file", "read_attachment"],
    priority: 80,
  },
  {
    iconToolName: "search_text",
    label: (count) => `查询 ${count} 项信息`,
    names: ["list_directory", "search_text", "web_search", "find_files", "get_project_info"],
    priority: 70,
  },
  {
    iconToolName: "list_project_operations",
    label: (count) => `协调 ${count} 项项目操作`,
    names: ["list_project_operations", "wait_for_project_operation"],
    priority: 60,
  },
  {
    iconToolName: "create_task_list",
    label: (count) => `管理 ${count} 项任务`,
    names: ["create_task_list", "update_task_list", "close_task_list"],
    priority: 50,
  },
  {
    iconToolName: "spawn_subagent",
    label: (count) => `执行 ${count} 次 Agent 协作`,
    names: [
      "list_agent_conversations",
      "read_agent_conversation",
      "send_agent_message",
      "wait_for_agent_message",
      "spawn_subagent",
      "list_subagents",
      "wait_for_subagents",
    ],
    priority: 40,
  },
];

function toolBatchCategoryCounts(tools: ConversationToolItem[]): Array<{
  category: ToolBatchCategory;
  count: number;
}> {
  return TOOL_BATCH_CATEGORIES
    .map((category) => ({
      category,
      count: tools.filter((tool) => category.names.includes(tool.name)).length,
    }))
    .filter(({ count }) => count > 0);
}

export function representativeToolName(tools: ConversationToolItem[]): string {
  return toolBatchCategoryCounts(tools)
    .sort((left, right) => right.category.priority - left.category.priority)[0]
    ?.category.iconToolName ?? tools[0]?.name ?? "tool";
}

export function toolBatchLabel(
  tools: ConversationToolItem[],
  teamManaged = false,
): string {
  const labels = toolBatchCategoryCounts(tools)
    .sort((left, right) => right.category.priority - left.category.priority)
    .slice(0, 2)
    .map(({ category, count }) => (
      teamManaged && category.iconToolName === "spawn_subagent"
        ? `协调 ${count} 次团队成员`
        : category.label(count)
    ));

  return labels.length > 0 ? labels.join("，") : `调用了 ${tools.length} 个工具`;
}

/** Returns a mode only when the whole visible batch shares one scheduler mode. */
export function toolBatchExecutionMode(
  tools: readonly ConversationToolItem[],
): "parallel" | "serial" | null {
  if (tools.length < 2) return null;
  const modes = new Set(tools.map((tool) => tool.executionMode ?? "serial"));
  if (modes.size !== 1) return null;
  const mode = [...modes][0];
  return mode === "parallel" || mode === "serial" ? mode : null;
}

function ToolDetail({
  item,
  teamManaged,
  liveOutput,
  onOpenProjectFile,
}: {
  item: ConversationToolItem;
  teamManaged: boolean;
  liveOutput?: LiveToolOutput;
  onOpenProjectFile: ((path: string) => void) | undefined;
}): ReactElement {
  if (item.name === "run_command") {
    return (
      <CommandTerminal
        argumentsPayload={item.arguments}
        resultPayload={item.result}
        status={item.status}
        {...(liveOutput === undefined ? {} : { liveOutput })}
      />
    );
  }

  if (item.name === "wait_for_commands" || item.name === "stop_command") {
    return (
      <CommandLifecycleResult
        mode={item.name === "wait_for_commands" ? "wait" : "stop"}
        payload={item.result}
        status={item.status}
      />
    );
  }

  if (item.name === "list_project_operations" || item.name === "wait_for_project_operation") {
    return (
      <ProjectOperationResult
        mode={item.name === "list_project_operations" ? "list" : "wait"}
        payload={item.result}
        status={item.status}
      />
    );
  }

  if (item.name === "get_project_info") {
    return <ProjectInfoResult payload={item.result} status={item.status} />;
  }

  if (item.name === "list_directory") {
    return <DirectoryListingResult payload={item.result} status={item.status} />;
  }

  if (item.name === "read_file") {
    return <FileReadResult payload={item.result} status={item.status} />;
  }

  if (item.name === "read_external_file") {
    return <FileReadResult payload={item.result} status={item.status} />;
  }

  if (item.name === "read_attachment") {
    return <AttachmentReadResult payload={item.result} status={item.status} />;
  }

  if (item.name === "search_text") {
    return <SearchTextResult payload={item.result} status={item.status} />;
  }

  if (item.name === "web_search") {
    return <WebSearchResult payload={item.result} status={item.status} />;
  }

  if (item.name === "find_files") {
    return <FindFilesResult payload={item.result} status={item.status} />;
  }

  if (item.name === "list_agent_conversations") {
    return <AgentConversationListResult payload={item.result} status={item.status} />;
  }

  if (item.name === "read_agent_conversation") {
    return <AgentConversationReadResult payload={item.result} status={item.status} />;
  }

  if (item.name === "send_agent_message" || item.name === "wait_for_agent_message") {
    return (
      <AgentMessageToolResult
        mode={item.name === "send_agent_message" ? "sent" : "received"}
        payload={item.result}
        status={item.status}
      />
    );
  }

  if (
    item.name === "spawn_subagent"
    || item.name === "list_subagents"
    || item.name === "wait_for_subagents"
  ) {
    return (
      <SubagentToolResult
        payload={item.result}
        status={item.status}
        teamManaged={teamManaged}
      />
    );
  }

  if (
    item.name === "write_file" ||
    item.name === "replace_in_file" ||
    item.name === "apply_patch" ||
    item.name === "delete_file"
  ) {
    return (
      <FileChangeResult
        diff={item.diff}
        onOpenProjectFile={onOpenProjectFile}
        result={item.result}
        toolName={item.name}
      />
    );
  }

  return <ToolResultNotice result={item.result} status={item.status} />;
}

function CommandTerminal({
  argumentsPayload,
  liveOutput,
  resultPayload,
  status,
}: {
  argumentsPayload: string;
  liveOutput?: LiveToolOutput;
  resultPayload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const terminalConfiguration = useWorkbenchUiStore(
    (state) => state.terminalConfiguration,
  );
  const invocation = parseCommandInvocation(argumentsPayload);
  const command = invocation?.command ?? "命令参数无法识别，请查看原始调用。";
  const result = resultPayload === null ? null : parseCommandResult(resultPayload);
  const output = commandTerminalOutput(resultPayload, status, liveOutput);
  const terminal = result?.terminal;
  const lifecycleStatus = liveOutput?.status ?? result?.status;
  const lifecycleLabel = lifecycleStatus == null ? null : commandSessionStatusLabel(lifecycleStatus);
  const terminalStyle: CSSProperties = {
    fontFamily: terminalConfiguration.fontFamily,
    fontSize: terminalConfiguration.fontSize,
    lineHeight: terminalConfiguration.lineHeight,
  };

  return (
    <section className="tool-timeline-item__payload tool-structured-result tool-command-terminal">
      <p className="tool-timeline-item__payload-label">
        {terminal?.displayName ?? terminalShellDisplayName(terminalConfiguration.shell)}
        {" · "}
        {terminalOutputEncodingLabel(terminal?.outputEncoding ?? terminalConfiguration.outputEncoding)}
        {lifecycleLabel === null ? null : ` · ${lifecycleLabel}`}
        {result?.commandId === null || result?.commandId === undefined
          ? null
          : ` · ID ${result.commandId}`}
      </p>
      <div className="tool-structured-result__content">
        <pre style={terminalStyle}>
          <code>
            <span className="tool-command-terminal__prompt">$</span> {command}
            {output.length === 0 ? null : `\n\n${output}`}
          </code>
        </pre>
      </div>
    </section>
  );
}

function CommandLifecycleResult({
  mode,
  payload,
  status,
}: {
  mode: "stop" | "wait";
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseCommandLifecycleResult(payload, mode);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  const summary = mode === "stop"
    ? "后台命令停止结果"
    : `${result.waitStatus === "timeout" ? "等待超时" : "等待结束"} · ${result.commands.length} 条命令`;
  return (
    <StructuredToolResult summary={summary}>
      <div className="tool-command-session-list">
        {result.commands.map((command, index) => (
          <CommandTerminal
            key={command.commandId ?? `${command.command}:${index}`}
            argumentsPayload={JSON.stringify({ command: command.command ?? "命令参数不可用" })}
            resultPayload={JSON.stringify({ ok: true, value: command })}
            status={command.status === "running"
              ? "running"
              : command.status === "failed"
                ? "failed"
                : "completed"}
          />
        ))}
      </div>
    </StructuredToolResult>
  );
}

function ProjectOperationResult({
  mode,
  payload,
  status,
}: {
  mode: "list" | "wait";
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseProjectOperationResult(payload, mode);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  const summary = mode === "wait"
    ? result.waitStatus === "timeout"
      ? "项目操作等待超时"
      : "项目操作等待结束"
    : `进行中的项目操作 · ${result.operations.length} 项`;
  return (
    <StructuredToolResult summary={summary}>
      {result.operations.length === 0 ? (
        <p className="tool-directory-listing__empty">当前没有其他对话占用项目写操作</p>
      ) : (
        <ul className="tool-search-results">
          {result.operations.map((operation) => (
            <li key={operation.operationId}>
              <span className="tool-search-results__path">
                {operation.scope.kind === "file" ? operation.scope.path : operation.scope.command}
              </span>
              <span className="tool-search-results__excerpt">
                {operation.conversationTitle} · {projectOperationStatusLabel(operation.status)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </StructuredToolResult>
  );
}

function ProjectInfoResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseProjectInfoResult(payload);
  if (result === null) {
    return <ToolResultNotice result={payload} status={status} />;
  }

  return (
    <StructuredToolResult summary="项目信息">
      <dl className="tool-read-facts">
        <div>
          <dt>项目名称</dt>
          <dd>{result.name}</dd>
        </div>
        <div>
          <dt>项目根目录</dt>
          <dd>{result.rootPath}</dd>
        </div>
      </dl>
    </StructuredToolResult>
  );
}

function DirectoryListingResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseDirectoryListingResult(payload);
  if (result === null) {
    return <ToolResultNotice result={payload} status={status} />;
  }

  const directoryLabel = result.directoryPath.length === 0
    ? "工作区根目录"
    : result.directoryPath;

  return (
    <StructuredToolResult summary={`${directoryLabel} · ${result.entries.length} 项`}>
      {result.entries.length === 0 ? (
        <p className="tool-directory-listing__empty">目录为空</p>
      ) : (
        <ul className="tool-directory-listing">
          {result.entries.map((entry) => (
            <li key={entry.path} data-kind={entry.kind}>
              {entry.kind === "directory" ? (
                <FolderOpen aria-hidden="true" size={14} />
              ) : (
                <FileText aria-hidden="true" size={14} />
              )}
              <span className="tool-directory-listing__name" title={entry.path}>{entry.name}</span>
              <span className="tool-directory-listing__kind">
                {entry.kind === "directory" ? "文件夹" : entry.kind === "symlink" ? "链接" : "文件"}
              </span>
            </li>
          ))}
        </ul>
      )}
      {result.truncated ? <p className="tool-directory-listing__notice">目录项过多，仅显示前 1000 项。</p> : null}
    </StructuredToolResult>
  );
}

function FileReadResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseFileReadResult(payload);
  if (result === null) {
    return <ToolResultNotice result={payload} status={status} />;
  }

  return (
    <StructuredToolResult
      summary={
        <>
          <span title={result.path}>{fileNameFromPath(result.path)}</span> · 第 {result.startLine}-{result.endLine} 行，共 {result.totalLines} 行
        </>
      }
    >
      <pre>{result.content.length === 0 ? "（文件内容为空）" : result.content}</pre>
    </StructuredToolResult>
  );
}

function AttachmentReadResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseAttachmentReadResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult
      summary={`${result.name} · 字符 ${result.startOffset}-${result.endOffset} / ${result.totalCharacters}`}
    >
      <pre>{result.content.length === 0 ? "（附件片段为空）" : result.content}</pre>
      {result.truncated ? (
        <p className="tool-directory-listing__notice">附件后面仍有内容，可继续按偏移量读取。</p>
      ) : null}
    </StructuredToolResult>
  );
}

function SearchTextResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseSearchTextResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult
      summary={`${result.mode === "regex" ? "正则搜索" : "文本搜索"} · ${result.matches.length} 项${
        result.scannedFiles === null ? "" : ` · 扫描 ${result.scannedFiles} 个文件`
      }`}
    >
      {result.matches.length === 0 ? (
        <p className="tool-directory-listing__empty">没有找到匹配内容</p>
      ) : (
        <ul className="tool-search-results">
          {result.matches.map((match, index) => (
            <li key={`${match.path}:${match.line}:${index}`}>
              <span className="tool-search-results__path">{match.path}:{match.line}</span>
              <span className="tool-search-results__excerpt">{match.text}</span>
            </li>
          ))}
        </ul>
      )}
      {result.truncated ? <p className="tool-directory-listing__notice">搜索结果已达到数量限制。</p> : null}
    </StructuredToolResult>
  );
}

function WebSearchResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseWebSearchResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult summary={`网页搜索 · ${result.results.length} 项`}>
      {result.results.length === 0 ? (
        <p className="tool-directory-listing__empty">没有找到网页结果</p>
      ) : (
        <ul className="tool-search-results">
          {result.results.map((item) => (
            <li key={item.url}>
              <a href={item.url} rel="noreferrer" target="_blank">{item.title || item.url}</a>
              <span className="tool-search-results__path">{item.hostname}</span>
              {item.description.length === 0 ? null : (
                <span className="tool-search-results__excerpt">{item.description}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </StructuredToolResult>
  );
}

function FindFilesResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseFindFilesResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult summary={`${result.pattern} · ${result.matches.length} 个文件`}>
      {result.matches.length === 0 ? (
        <p className="tool-directory-listing__empty">没有找到匹配文件</p>
      ) : (
        <ul className="tool-directory-listing">
          {result.matches.map((match) => (
            <li key={match} data-kind="file">
              <FileText aria-hidden="true" size={14} />
              <span className="tool-directory-listing__name" title={match}>{match}</span>
              <span className="tool-directory-listing__kind">文件</span>
            </li>
          ))}
        </ul>
      )}
      {result.truncated ? <p className="tool-directory-listing__notice">文件结果已达到扫描限制。</p> : null}
    </StructuredToolResult>
  );
}

function AgentConversationListResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseAgentConversationListResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult summary={`Agent 对话 · ${result.length} 项`}>
      {result.length === 0 ? (
        <p className="tool-directory-listing__empty">没有可协作的其他对话</p>
      ) : (
        <ul className="tool-search-results">
          {result.map((conversation) => (
            <li key={conversation.conversationId}>
              <span className="tool-search-results__path">{conversation.title}</span>
              <span className="tool-search-results__excerpt">
                {agentConversationKindLabel(conversation.threadKind)} · {conversation.conversationId}
              </span>
            </li>
          ))}
        </ul>
      )}
    </StructuredToolResult>
  );
}

function AgentConversationReadResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseAgentConversationReadResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult summary={`对话上下文 · 约 ${result.estimatedTokens} tokens`}>
      <pre>{result.content}</pre>
    </StructuredToolResult>
  );
}

function AgentMessageToolResult({
  mode,
  payload,
  status,
}: {
  mode: "received" | "sent";
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseAgentMessageToolResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;
  if (result.message === null) {
    return (
      <StructuredToolResult summary="Agent 消息等待结束">
        <p className="tool-directory-listing__empty">等待期间没有收到新消息</p>
      </StructuredToolResult>
    );
  }

  return (
    <StructuredToolResult summary={mode === "sent" ? "Agent 消息已发送" : "收到 Agent 消息"}>
      <dl className="tool-read-facts">
        <div>
          <dt>{mode === "sent" ? "目标对话" : "发送方"}</dt>
          <dd>{mode === "sent" ? result.message.conversationId : result.message.senderTitle}</dd>
        </div>
        {mode === "received" ? (
          <div>
            <dt>发送方 ID</dt>
            <dd>{result.message.senderConversationId}</dd>
          </div>
        ) : null}
        <div>
          <dt>消息内容</dt>
          <dd>{result.message.content}</dd>
        </div>
      </dl>
    </StructuredToolResult>
  );
}

function SubagentToolResult({
  payload,
  status,
  teamManaged,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
  teamManaged: boolean;
}): ReactElement {
  const result = payload === null ? null : parseSubagentToolResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;
  const summary = result.waitStatus === "timeout"
    ? `${teamManaged ? "团队成员等待超时" : "Subagent 等待超时"} · ${result.tasks.length} 项`
    : `${teamManaged ? "团队成员执行" : "Subagent"} · ${result.tasks.length} 项`;

  return (
    <StructuredToolResult summary={summary}>
      <ul className="tool-search-results">
        {result.tasks.map((task) => (
          <li key={task.id}>
            <span className="tool-subagent-result__identity">
              {task.avatarIcon === null ? null : (
                <AgentAvatar avatar={{ icon: task.avatarIcon, kind: "icon" }} size="compact" />
              )}
              <span className="tool-search-results__path">{task.name}</span>
            </span>
            <span className="tool-search-results__excerpt">
              {subagentTaskStatusLabel(task.status)} · {task.childConversationId}
            </span>
            {task.result !== null || task.error !== null ? (
              <span className="tool-search-results__excerpt">
                {task.result ?? task.error}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </StructuredToolResult>
  );
}

function StructuredToolResult({
  children,
  summary,
}: {
  children: ReactNode;
  summary: ReactNode;
}): ReactElement {
  return (
    <section className="tool-timeline-item__payload tool-structured-result">
      <p className="tool-timeline-item__payload-label">{summary}</p>
      <div className="tool-structured-result__content">{children}</div>
    </section>
  );
}

function FileChangeResult({
  diff,
  onOpenProjectFile,
  result,
  toolName,
}: {
  diff: string | null;
  onOpenProjectFile: ((path: string) => void) | undefined;
  result: string | null;
  toolName: string;
}): ReactElement {
  const [copied, setCopied] = useState(false);
  const error = result === null ? null : parseToolError(result);

  if (diff !== null) {
    const presentation = createDiffPresentation(diff);
    const changeType = fileChangeType(toolName, presentation);

    return (
      <section className="tool-file-change" data-change-type={changeType}>
        <div className="tool-file-change__surface">
          <header className="tool-file-change__header">
            {onOpenProjectFile === undefined ? (
              <span className="tool-file-change__path" title={presentation.path}>
                {fileNameFromPath(presentation.path)}
              </span>
            ) : (
              <button
                aria-label={`在侧边工作区打开文件 ${presentation.path}`}
                className="tool-file-change__path"
                title={`在侧边工作区打开 ${presentation.path}`}
                type="button"
                onClick={() => onOpenProjectFile(presentation.path)}
              >
                {fileNameFromPath(presentation.path)}
              </button>
            )}
            <span className="tool-file-change__summary">
              <span data-kind="addition">+{presentation.additions}</span>
              <span data-kind="deletion">-{presentation.deletions}</span>
            </span>
            <IconButton
              className="tool-file-change__copy"
              label={copied ? "已复制变更内容" : "复制变更内容"}
              size="compact"
              variant="quiet"
              onClick={() => void copyDiff(diff, setCopied)}
            >
              <Copy aria-hidden="true" size={15} />
            </IconButton>
          </header>
          <DiffView presentation={presentation} />
        </div>
        {error === null ? null : <ToolErrorNotice message={error} />}
      </section>
    );
  }

  return <ToolResultNotice result={result} status="failed" />;
}

type DiffLineKind = "addition" | "deletion" | "context";

type DiffPresentation = {
  additions: number;
  deletions: number;
  lines: Array<{ content: string; kind: DiffLineKind; lineNumber: number | null }>;
  path: string;
};

type FileChangeSummary = {
  action: string;
  additions: number | null;
  deletions: number | null;
  path: string;
};

export function fileChangeSummary(item: ConversationToolItem): FileChangeSummary | null {
  if (!isFileChangeToolName(item.name)) return null;

  const argumentsValue = parseToolPayload(item.arguments);
  const argumentPath = typeof argumentsValue?.path === "string"
    ? argumentsValue.path
    : null;
  const diffPayload = item.diff
    ?? (typeof argumentsValue?.patch === "string" ? argumentsValue.patch : null);
  const presentation = diffPayload === null ? null : createDiffPresentation(diffPayload);
  const path = presentation?.path !== undefined && presentation.path !== "文件变更"
    ? presentation.path
    : argumentPath;
  if (path === null || path === undefined || path.length === 0) return null;

  return {
    action: fileChangeActionLabel(item),
    additions: presentation?.additions ?? null,
    deletions: presentation?.deletions ?? null,
    path,
  };
}

function fileChangeActionLabel(item: ConversationToolItem): string {
  const completed = item.status === "completed";
  switch (item.name) {
    case "write_file": {
      const argumentsValue = parseToolPayload(item.arguments);
      const overwrites = argumentsValue?.overwrite === true;
      return overwrites
        ? (completed ? "已编辑" : "编辑文件")
        : (completed ? "已创建" : "创建文件");
    }
    case "delete_file":
      return completed ? "已删除" : "删除文件";
    case "apply_patch":
    case "replace_in_file":
      return completed ? "已编辑" : "编辑文件";
    default:
      return toolActivityLabel(item);
  }
}

function isFileChangeToolName(name: string): boolean {
  return name === "write_file"
    || name === "replace_in_file"
    || name === "apply_patch"
    || name === "delete_file";
}

function DiffView({ presentation }: { presentation: DiffPresentation }): ReactElement {
  return (
    <pre className="tool-diff-view">
      <code>
        {presentation.lines.length === 0 ? (
          <span className="tool-diff-view__empty">文件不包含可显示的文本内容。</span>
        ) : presentation.lines.map((line, index) => (
          <span key={`${index}:${line.content}`} className="tool-diff-view__line" data-kind={line.kind}>
            <span className="tool-diff-view__line-number">{line.lineNumber ?? ""}</span>
            <span className="tool-diff-view__line-content">{line.content || " "}</span>
          </span>
        ))}
      </code>
    </pre>
  );
}

function ToolResultNotice({
  result,
  status,
}: {
  result: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const error = result === null ? null : parseToolError(result);
  if (error !== null) return <ToolErrorNotice message={error} />;
  if (status === "failed") {
    return <ToolErrorNotice message={result?.trim() || "工具调用失败，请查看原始调用。"} />;
  }
  const message = status === "running" ? "正在执行" : "调用已完成，可查看原始调用。";

  return (
    <section className="tool-timeline-item__result-notice">
      <p>{message}</p>
    </section>
  );
}

function ToolErrorNotice({ message }: { message: string }): ReactElement {
  return <ConversationErrorQuote content={message} scope="tool" />;
}

function ToolRawCallDialog({
  item,
  onClose,
}: {
  item: ConversationToolItem;
  onClose: () => void;
}): ReactElement {
  useEffect(() => {
    const closeOnEscape = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return createPortal(
    <div
      className="tool-raw-dialog-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        aria-label={`${item.name} 原始调用`}
        aria-modal="true"
        className="tool-raw-dialog"
        role="dialog"
      >
        <header className="tool-raw-dialog__header">
          <div>
            <p>原始调用</p>
            <h2>{item.name}</h2>
          </div>
          <button aria-label="关闭原始调用" title="关闭" type="button" onClick={onClose}>
            <X aria-hidden="true" size={16} />
          </button>
        </header>
        <div className="tool-raw-dialog__content">
          <ToolPayload label="调用参数" payload={item.arguments} />
          {item.result === null ? null : <ToolPayload label="调用结果" payload={item.result} />}
          {item.diff === null ? null : (
            <section className="tool-timeline-item__payload">
              <p className="tool-timeline-item__payload-label">变更 Diff</p>
              <DiffView presentation={createDiffPresentation(item.diff)} />
            </section>
          )}
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ToolPayload({ label, payload }: { label: string; payload: string }): ReactElement {
  return (
    <section className="tool-timeline-item__payload">
      <p className="tool-timeline-item__payload-label">{label}</p>
      <pre>{formatToolPayload(payload)}</pre>
    </section>
  );
}

function RuntimeBadge({
  isMockRuntime,
  isRunning,
  status,
}: {
  isMockRuntime: boolean;
  isRunning: boolean;
  status: ModelRuntimeStatus | null;
}): ReactElement {
  const label = isMockRuntime
    ? "浏览器预览"
    : status === null
      ? "读取模型…"
      : status.configured
        ? status.models.find(
          (model) => model.providerId === status.providerId && model.modelId === status.modelId,
        )?.displayName ?? status.modelId ?? "已配置模型"
        : "未配置模型";

  return (
    <span
      className="runtime-badge"
      data-configured={String(isMockRuntime || status?.configured)}
      data-running={String(isRunning)}
      title={isRunning ? `${label} · 正在运行` : label}
    >
      {isRunning ? (
        <>
          <LoaderCircle
            aria-hidden="true"
            className="conversation-workspace__spin"
            size={12}
          />
          正在运行
        </>
      ) : (
        label
      )}
    </span>
  );
}

export function formatToolPayload(payload: string): string {
  try {
    return JSON.stringify(redactAgentErrorId(JSON.parse(payload) as unknown), null, 2);
  } catch {
    return payload;
  }
}

function redactAgentErrorId(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAgentErrorId);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      key === "agentError"
        ? redactAgentErrorObject(nestedValue)
        : redactAgentErrorId(nestedValue),
    ]),
  );
}

function redactAgentErrorObject(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;

  return redactAgentErrorValue(value);
}

function redactAgentErrorValue(value: unknown): unknown {
  if (typeof value === "string") return redactErrorIdentifiers(value);
  if (Array.isArray(value)) return value.map(redactAgentErrorValue);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "id")
      .map(([key, nestedValue]) => [key, redactAgentErrorValue(nestedValue)]),
  );
}

function parseToolPayload(payload: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function parseToolValue(payload: string): Record<string, unknown> | null {
  const parsed = parseToolPayload(payload);
  const value = parsed?.value;
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

function parseToolError(payload: string): string | null {
  const error = parseToolPayload(payload)?.error;
  return typeof error === "string" && error.length > 0 ? error : null;
}

function parseProjectInfoResult(payload: string): {
  name: string;
  rootPath: string;
} | null {
  const result = parseToolValue(payload);
  return typeof result?.name === "string" && typeof result.rootPath === "string"
    ? { name: result.name, rootPath: result.rootPath }
    : null;
}

type ProjectOperationPayload = {
  conversationTitle: string;
  operationId: string;
  scope: { command: string; kind: "command" } | { kind: "file"; path: string };
  status: "active" | "completed" | "failed";
};

function parseProjectOperationResult(
  payload: string,
  mode: "list" | "wait",
): {
  operations: ProjectOperationPayload[];
  waitStatus: "finished" | "timeout" | null;
} | null {
  const result = parseToolValue(payload);
  if (result === null) return null;
  const rawOperations = mode === "list"
    ? result.operations
    : result.operation === null || typeof result.operation !== "object"
      ? null
      : [result.operation];
  if (!Array.isArray(rawOperations)) return null;
  const operations = rawOperations.map(parseProjectOperation);
  if (operations.some((operation) => operation === null)) return null;
  return {
    operations: operations as ProjectOperationPayload[],
    waitStatus: result.waitStatus === "finished" || result.waitStatus === "timeout"
      ? result.waitStatus
      : null,
  };
}

function parseProjectOperation(value: unknown): ProjectOperationPayload | null {
  if (value === null || typeof value !== "object") return null;
  const operation = value as Record<string, unknown>;
  if (
    typeof operation.conversationTitle !== "string"
    || typeof operation.operationId !== "string"
    || (operation.status !== "active" && operation.status !== "completed" && operation.status !== "failed")
    || operation.scope === null
    || typeof operation.scope !== "object"
  ) {
    return null;
  }
  const scope = operation.scope as Record<string, unknown>;
  const parsedScope = scope.kind === "file" && typeof scope.path === "string"
    ? { kind: "file" as const, path: scope.path }
    : scope.kind === "command" && typeof scope.command === "string"
      ? { command: scope.command, kind: "command" as const }
      : null;
  return parsedScope === null
    ? null
    : {
      conversationTitle: operation.conversationTitle,
      operationId: operation.operationId,
      scope: parsedScope,
      status: operation.status,
    };
}

function projectOperationStatusLabel(status: ProjectOperationPayload["status"]): string {
  switch (status) {
    case "active":
      return "进行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
  }
}

function parseDirectoryListingResult(payload: string): {
  directoryPath: string;
  entries: Array<{ kind: "directory" | "file" | "symlink"; name: string; path: string }>;
  truncated: boolean;
} | null {
  const result = parseToolValue(payload);
  if (
    typeof result?.directoryPath !== "string" ||
    !Array.isArray(result.entries) ||
    typeof result.truncated !== "boolean"
  ) {
    return null;
  }

  const entries = result.entries.map((entry) => {
    if (entry === null || typeof entry !== "object") return null;
    const value = entry as Record<string, unknown>;
    return typeof value.name === "string" &&
      typeof value.path === "string" &&
      (value.kind === "directory" || value.kind === "file" || value.kind === "symlink")
      ? { kind: value.kind, name: value.name, path: value.path }
      : null;
  });

  return entries.every((entry) => entry !== null)
    ? {
      directoryPath: result.directoryPath,
      entries: entries as Array<{
        kind: "directory" | "file" | "symlink";
        name: string;
        path: string;
      }>,
      truncated: result.truncated
    }
    : null;
}

function parseSearchTextResult(payload: string): {
  matches: Array<{ line: number; path: string; text: string }>;
  mode: "literal" | "regex";
  scannedFiles: number | null;
  truncated: boolean;
} | null {
  const result = parseToolValue(payload);
  if (!Array.isArray(result?.matches) || typeof result.truncated !== "boolean") return null;
  const matches = result.matches.map((match) => {
    if (match === null || typeof match !== "object") return null;
    const value = match as Record<string, unknown>;
    return typeof value.line === "number" &&
      typeof value.path === "string" &&
      typeof value.text === "string"
      ? { line: value.line, path: value.path, text: value.text }
      : null;
  });
  return matches.every((match) => match !== null)
    ? {
      matches: matches.filter((match) => match !== null),
      mode: result.mode === "regex" ? "regex" : "literal",
      scannedFiles: typeof result.scannedFiles === "number" ? result.scannedFiles : null,
      truncated: result.truncated
    }
    : null;
}

function parseWebSearchResult(payload: string): {
  results: Array<{ description: string; hostname: string; title: string; url: string }>;
} | null {
  const result = parseToolValue(payload);
  if (!Array.isArray(result?.results)) return null;
  const results = result.results.map((item) => {
    if (item === null || typeof item !== "object") return null;
    const value = item as Record<string, unknown>;
    return typeof value.description === "string" &&
      typeof value.hostname === "string" &&
      typeof value.title === "string" &&
      typeof value.url === "string"
      ? {
        description: value.description,
        hostname: value.hostname,
        title: value.title,
        url: value.url,
      }
      : null;
  });
  return results.every((item) => item !== null)
    ? { results: results.filter((item) => item !== null) }
    : null;
}

function parseFindFilesResult(payload: string): {
  matches: string[];
  pattern: string;
  truncated: boolean;
} | null {
  const result = parseToolValue(payload);
  return Array.isArray(result?.matches) &&
    result.matches.every((match) => typeof match === "string") &&
    typeof result.pattern === "string" &&
    typeof result.truncated === "boolean"
    ? {
      matches: result.matches,
      pattern: result.pattern,
      truncated: result.truncated
    }
    : null;
}

function parseAgentConversationListResult(payload: string): Array<{
  conversationId: string;
  threadKind: string;
  title: string;
}> | null {
  const result = parseToolValue(payload);
  if (!Array.isArray(result?.conversations)) return null;
  const conversations = result.conversations.map((conversation) => {
    if (conversation === null || typeof conversation !== "object") return null;
    const value = conversation as Record<string, unknown>;
    return typeof value.conversationId === "string" &&
      typeof value.threadKind === "string" &&
      typeof value.title === "string"
      ? {
        conversationId: value.conversationId,
        threadKind: value.threadKind,
        title: value.title,
      }
      : null;
  });
  return conversations.every((conversation) => conversation !== null)
    ? conversations.filter((conversation) => conversation !== null)
    : null;
}

function parseAgentConversationReadResult(payload: string): {
  content: string;
  estimatedTokens: number;
} | null {
  const result = parseToolValue(payload);
  return typeof result?.content === "string" && typeof result.estimatedTokens === "number"
    ? { content: result.content, estimatedTokens: result.estimatedTokens }
    : null;
}

type AgentMessageResultPayload = {
  content: string;
  conversationId: string;
  senderConversationId: string;
  senderTitle: string;
};

function parseAgentMessageToolResult(payload: string): {
  message: AgentMessageResultPayload | null;
} | null {
  const result = parseToolValue(payload);
  if (result === null) return null;
  if (result.message === null && result.status === "timeout") return { message: null };
  if (result.message === null || typeof result.message !== "object") return null;
  const message = result.message as Record<string, unknown>;
  return typeof message.content === "string" &&
    typeof message.conversationId === "string" &&
    typeof message.senderConversationId === "string" &&
    typeof message.senderTitle === "string"
    ? {
      message: {
        content: message.content,
        conversationId: message.conversationId,
        senderConversationId: message.senderConversationId,
        senderTitle: message.senderTitle,
      },
    }
    : null;
}

type SubagentToolTaskPayload = {
  avatarIcon: AgentAvatarIcon | null;
  childConversationId: string;
  error: string | null;
  id: string;
  name: string;
  result: string | null;
  status: string;
  title: string;
};

function parseSubagentToolResult(payload: string): {
  tasks: SubagentToolTaskPayload[];
  waitStatus: string | null;
} | null {
  const result = parseToolValue(payload);
  if (result === null) return null;
  const rawTasks = Array.isArray(result.tasks)
    ? result.tasks
    : result.task === null || typeof result.task !== "object"
      ? null
      : [result.task];
  if (rawTasks === null) return null;
  const tasks = rawTasks.map((rawTask) => {
    if (rawTask === null || typeof rawTask !== "object") return null;
    const task = rawTask as Record<string, unknown>;
    const avatarIcon = task.avatarIcon === null || task.avatarIcon === undefined
      ? null
      : agentAvatarIconSchema.safeParse(task.avatarIcon);
    return typeof task.childConversationId === "string"
      && typeof task.id === "string"
      && typeof task.status === "string"
      && typeof task.title === "string"
      && (avatarIcon === null || avatarIcon.success)
      && (task.result === null || typeof task.result === "string")
      && (task.error === null || typeof task.error === "string")
      ? {
        avatarIcon: avatarIcon === null ? null : avatarIcon.data,
        childConversationId: task.childConversationId,
        error: task.error,
        id: task.id,
        name: typeof task.name === "string" ? task.name : task.title,
        result: task.result,
        status: task.status,
        title: task.title,
      }
      : null;
  });
  if (!tasks.every((task) => task !== null)) return null;
  return {
    tasks: tasks.filter((task) => task !== null),
    waitStatus: typeof result.status === "string" ? result.status : null,
  };
}

function subagentTaskStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "等待启动";
    case "running":
      return "正在运行";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    default:
      return status;
  }
}

function createDiffPresentation(diff: string): DiffPresentation {
  const sourceLines = diff.split(/\r?\n/);
  if (sourceLines.at(-1) === "") sourceLines.pop();

  const headerPath = sourceLines.find((line) => line.startsWith("+++ "))?.slice(4).split("\t")[0];
  const fallbackPath = sourceLines.find((line) => line.startsWith("--- "))?.slice(4).split("\t")[0];
  const rawPath = (headerPath !== undefined && headerPath !== "/dev/null"
    ? headerPath
    : fallbackPath !== undefined && fallbackPath !== "/dev/null"
      ? fallbackPath
      : undefined) ?? "文件变更";
  const path = rawPath.replace(/^[ab]\//, "");
  const lines: DiffPresentation["lines"] = [];
  let additions = 0;
  let deletions = 0;
  let oldLineNumber = 0;
  let newLineNumber = 0;

  for (const sourceLine of sourceLines) {
    const hunk = sourceLine.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk !== null) {
      oldLineNumber = Number(hunk[1]);
      newLineNumber = Number(hunk[2]);
      continue;
    }
    if (
      sourceLine.startsWith("Index:") ||
      sourceLine.startsWith("===") ||
      sourceLine.startsWith("--- ") ||
      sourceLine.startsWith("+++ ") ||
      sourceLine.startsWith("\\ No newline")
    ) {
      continue;
    }

    if (sourceLine.startsWith("+")) {
      additions += 1;
      lines.push({
        content: sourceLine.slice(1),
        kind: "addition",
        lineNumber: newLineNumber === 0 ? null : newLineNumber
      });
      newLineNumber += 1;
      continue;
    }
    if (sourceLine.startsWith("-")) {
      deletions += 1;
      lines.push({
        content: sourceLine.slice(1),
        kind: "deletion",
        lineNumber: oldLineNumber === 0 ? null : oldLineNumber
      });
      oldLineNumber += 1;
      continue;
    }

    lines.push({
      content: sourceLine.startsWith(" ") ? sourceLine.slice(1) : sourceLine,
      kind: "context",
      lineNumber: newLineNumber === 0 ? null : newLineNumber
    });
    oldLineNumber += 1;
    newLineNumber += 1;
  }

  return { additions, deletions, lines, path };
}

function fileNameFromPath(path: string): string {
  const normalizedPath = path.replace(/[\\/]+$/, "");
  const separatorIndex = Math.max(normalizedPath.lastIndexOf("/"), normalizedPath.lastIndexOf("\\"));
  return separatorIndex < 0 ? normalizedPath || path : normalizedPath.slice(separatorIndex + 1);
}

function agentConversationKindLabel(kind: string): string {
  switch (kind) {
    case "team_lead":
      return "团队负责人";
    case "subagent":
      return "Subagent";
    default:
      return "Agent 对话";
  }
}

function fileChangeType(toolName: string, presentation: DiffPresentation): "created" | "deleted" | "updated" {
  if (toolName === "delete_file" || (presentation.additions === 0 && presentation.deletions > 0)) {
    return "deleted";
  }
  if (presentation.additions > 0 && presentation.deletions === 0) return "created";
  return "updated";
}

async function copyDiff(diff: string, setCopied: (copied: boolean) => void): Promise<void> {
  try {
    await navigator.clipboard.writeText(diff);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  } catch {
    setCopied(false);
  }
}

function parseCommandInvocation(payload: string): { command: string } | null {
  const result = parseToolPayload(payload);
  return typeof result?.command === "string"
    ? { command: result.command }
    : null;
}

function parseFileReadResult(payload: string): {
  content: string;
  endLine: number;
  path: string;
  startLine: number;
  totalLines: number;
} | null {
  const result = parseToolValue(payload);
  return typeof result?.content === "string" &&
    typeof result.endLine === "number" &&
    typeof result.path === "string" &&
    typeof result.startLine === "number" &&
    typeof result.totalLines === "number"
    ? {
      content: result.content,
      endLine: result.endLine,
      path: result.path,
      startLine: result.startLine,
      totalLines: result.totalLines
    }
    : null;
}

function parseAttachmentReadResult(payload: string): {
  content: string;
  endOffset: number;
  name: string;
  startOffset: number;
  totalCharacters: number;
  truncated: boolean;
} | null {
  const result = parseToolValue(payload);
  return typeof result?.content === "string"
    && typeof result.endOffset === "number"
    && typeof result.name === "string"
    && typeof result.startOffset === "number"
    && typeof result.totalCharacters === "number"
    && typeof result.truncated === "boolean"
    ? {
      content: result.content,
      endOffset: result.endOffset,
      name: result.name,
      startOffset: result.startOffset,
      totalCharacters: result.totalCharacters,
      truncated: result.truncated,
    }
    : null;
}

type CommandResultPayload = {
  command: string | null;
  commandId: string | null;
  completedAt: string | null;
  exitCode: number | null;
  stderr: string;
  startedAt: string | null;
  status: "running" | "completed" | "failed" | "cancelled" | null;
  stdout: string;
  timedOut: boolean;
  terminal: {
    displayName: string;
    outputEncoding: string;
  } | null;
  truncated: boolean;
  workingDirectory: string;
};

function parseCommandResult(payload: string): CommandResultPayload | null {
  const result = parseToolValue(payload);
  return parseCommandResultValue(result);
}

function parseCommandResultValue(result: Record<string, unknown> | null): CommandResultPayload | null {
  const terminalValue = result?.terminal;
  const terminal = terminalValue !== null && typeof terminalValue === "object"
    ? terminalValue as Record<string, unknown>
    : null;
  return typeof result?.workingDirectory === "string" &&
    (typeof result.exitCode === "number" || result.exitCode === null) &&
    typeof result.stderr === "string" &&
    typeof result.stdout === "string" &&
    typeof result.timedOut === "boolean" &&
    typeof result.truncated === "boolean"
    ? {
      command: typeof result.command === "string" ? result.command : null,
      commandId: typeof result.commandId === "string" ? result.commandId : null,
      completedAt: typeof result.completedAt === "string" ? result.completedAt : null,
      exitCode: result.exitCode,
      stderr: result.stderr,
      startedAt: typeof result.startedAt === "string" ? result.startedAt : null,
      status: isCommandSessionStatus(result.status) ? result.status : null,
      stdout: result.stdout,
      terminal: terminal !== null &&
        typeof terminal.displayName === "string" &&
        typeof terminal.outputEncoding === "string"
        ? {
          displayName: terminal.displayName,
          outputEncoding: terminal.outputEncoding,
        }
        : null,
      timedOut: result.timedOut,
      truncated: result.truncated,
      workingDirectory: result.workingDirectory
    }
    : null;
}

function parseCommandLifecycleResult(
  payload: string,
  mode: "stop" | "wait",
): { commands: CommandResultPayload[]; waitStatus: "finished" | "timeout" | null } | null {
  const result = parseToolValue(payload);
  const rawCommands = mode === "wait"
    ? result?.commands
    : result?.command === null || typeof result?.command !== "object"
      ? null
      : [result.command];
  if (!Array.isArray(rawCommands)) return null;
  const commands = rawCommands.map((command) =>
    parseCommandResultValue(
      command !== null && typeof command === "object"
        ? command as Record<string, unknown>
        : null,
    )
  );
  if (commands.some((command) => command === null)) return null;
  const waitStatus = result?.waitStatus === "finished" || result?.waitStatus === "timeout"
    ? result.waitStatus
    : null;
  return {
    commands: commands as CommandResultPayload[],
    waitStatus,
  };
}

function isCommandSessionStatus(
  value: unknown,
): value is Exclude<CommandResultPayload["status"], null> {
  return value === "running" || value === "completed" || value === "failed" || value === "cancelled";
}

function commandSessionStatusLabel(status: Exclude<CommandResultPayload["status"], null>): string {
  switch (status) {
    case "running":
      return "后台运行中";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已停止";
  }
}

function terminalShellDisplayName(
  shell: "system" | "powershell" | "pwsh" | "cmd" | "bash",
): string {
  switch (shell) {
    case "system":
      return "系统终端";
    case "powershell":
      return "Windows PowerShell";
    case "pwsh":
      return "PowerShell 7";
    case "cmd":
      return "命令提示符";
    case "bash":
      return "Bash";
  }
}

function terminalOutputEncodingLabel(encoding: string): string {
  switch (encoding) {
    case "auto":
      return "自动（UTF-8/GB18030）";
    case "utf-8":
      return "UTF-8";
    case "gbk":
      return "GBK";
    case "gb18030":
      return "GB18030";
    case "utf-16le":
      return "UTF-16 LE";
    default:
      return encoding;
  }
}

function commandTerminalOutput(
  resultPayload: string | null,
  status: ConversationToolItem["status"],
  liveOutput?: LiveToolOutput,
): string {
  const result = resultPayload === null ? null : parseCommandResult(resultPayload);
  if (liveOutput !== undefined && result !== null) {
    return commandTerminalOutputValue({
      ...result,
      exitCode: liveOutput.exitCode,
      status: liveOutput.status,
      stderr: liveOutput.stderr,
      stdout: liveOutput.stdout,
      timedOut: liveOutput.timedOut,
      truncated: liveOutput.truncated,
    });
  }
  if (liveOutput !== undefined) {
    const liveLines = [liveOutput.stdout, liveOutput.stderr].filter((value) => value.length > 0);
    return liveLines.length > 0 ? liveLines.join("\n") : "[命令正在执行]";
  }
  if (resultPayload === null) {
    return status === "running" ? "正在执行..." : "等待命令结果...";
  }
  if (result === null) {
    return parseToolError(resultPayload) ?? "命令执行未返回可显示的终端输出。";
  }

  return commandTerminalOutputValue(result);
}

function commandTerminalOutputValue(result: CommandResultPayload): string {
  const lines = [result.stdout, result.stderr].filter((value) => value.length > 0);
  if (result.status === "running" && lines.length === 0) lines.push("[命令正在后台运行]");
  if (result.status === "cancelled") lines.push("[命令已停止]");
  if (result.timedOut) lines.push("[命令执行超时]");
  if (result.truncated) lines.push("[输出已截断]");
  if (result.exitCode !== 0 && !result.timedOut) {
    lines.push(`[进程退出代码：${result.exitCode ?? "未知"}]`);
  }
  if (lines.length === 0 && result.status === "completed") {
    return "[命令执行完成，未产生输出]";
  }
  return lines.join("\n");
}

const CONVERSATION_AGENT_STORAGE_PREFIX = "agent-workbench.conversation-agent.";

function toConversationAgentBinding(agent: AgentProfile) {
  return {
    avatarIcon: agent.avatar.kind === "icon" ? agent.avatar.icon : null,
    id: agent.id,
    instructions: agent.instructions,
    isDefault: agent.isDefault,
    name: agent.name,
    role: agent.role,
  };
}

function readConversationAgentSelection(
  conversationId: string,
  fallbackAgentId: string,
): string {
  try {
    return window.localStorage.getItem(
      `${CONVERSATION_AGENT_STORAGE_PREFIX}${conversationId}`,
    ) ?? fallbackAgentId;
  } catch {
    return fallbackAgentId;
  }
}

function saveConversationAgentSelection(
  conversationId: string,
  agentId: string,
): void {
  try {
    window.localStorage.setItem(
      `${CONVERSATION_AGENT_STORAGE_PREFIX}${conversationId}`,
      agentId,
    );
  } catch {
    // The prototype still works for the active view when storage is unavailable.
  }
}

function ProjectConversationEmpty({
  activeProject,
  isCreatingSession,
  onCreateProjectSession,
  onCreateTemporarySession,
}: {
  activeProject: ProjectSummary | null;
  isCreatingSession: boolean;
  onCreateProjectSession: (projectId: string) => void;
  onCreateTemporarySession: () => void;
}): ReactElement {
  const hasProject = activeProject !== null;

  return (
    <section
      className="conversation-empty"
      aria-labelledby="conversation-empty-heading"
    >
      <header className="conversation-empty__toolbar">
        <span>
          <MessageSquareText aria-hidden="true" size={16} />
          {activeProject?.name ?? "Agent 对话"}
        </span>
      </header>
      <div className="conversation-empty__content">
        <span className="conversation-empty__cube" aria-hidden="true">
          <Bot size={42} strokeWidth={1.7} />
        </span>
        <h1 id="conversation-empty-heading">
          {hasProject ? "开始项目会话" : "从哪里开始"}
        </h1>
        <p>
          {hasProject
            ? `在 ${activeProject.name} 中新建一个会话，开始交给 Agent 处理任务。`
            : "不开项目也可以开始临时对话；需要文件能力时可为对话添加工作目录。"}
        </p>
        <button
          className="conversation-empty__create"
          disabled={isCreatingSession}
          type="button"
          onClick={() => {
            if (activeProject === null) onCreateTemporarySession();
            else onCreateProjectSession(activeProject.id);
          }}
        >
          <SquarePen aria-hidden="true" size={16} />
          <span>{hasProject ? "新建对话" : "开启临时对话"}</span>
        </button>
      </div>
    </section>
  );
}
