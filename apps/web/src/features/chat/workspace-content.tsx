import {
  Bot,
  ArchiveRestore,
  ArrowDown,
  ArrowUp,
  AtSign,
  BrainCircuit,
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
  Globe2,
  GripVertical,
  LoaderCircle,
  List,
  ListEnd,
  ListTodo,
  MessageSquareText,
  Paperclip,
  Pencil,
  RefreshCw,
  Scale,
  Search,
  Send,
  SendHorizontal,
  ShieldCheck,
  Images,
  Sparkles,
  SlidersHorizontal,
  Square,
  SquarePen,
  Terminal,
  Trash2,
  UsersRound,
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
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent,
  type MouseEvent,
  type CSSProperties,
  type Dispatch,
  type DragEvent,
  type ReactElement,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";

import type {
  AgentAvatarIcon,
  AgentTeam,
  ContextCompressionConfiguration,
  ApproveToolChangeInput,
  ConversationAttachment,
  ConversationMessageDeliveryMode,
  ConversationModelSelection,
  ConversationModelRetryItem,
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
  SkillConfiguration,
  TeamInstanceScope,
  TeamInstanceView,
} from "@agent/protocol";
import {
  agentAvatarIconSchema,
  conversationAttachmentListSchema,
  DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  isGpt56ReasoningModel,
  isReasoningOptionEnabled,
  modelReasoningOptionKey,
  redactErrorIdentifiers,
} from "@agent/protocol";

import { IconButton } from "../../components/ui/icon-button.js";
import { TooltipAnchor } from "../../components/ui/tooltip.js";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { AgentMarkdown } from "../../components/markdown/agent-markdown.js";
import { requestMediaPreview } from "../../components/media/image-viewer.js";
import {
  createDiffPresentation,
  DiffView,
  type DiffPresentation,
} from "../../components/diff/diff-view.js";
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
import { AgentAvatar, SubagentAvatar } from "../team/agent-avatar.js";
import { TeamWorkspace } from "../team/team-workspace.js";
import { CollaborationProjectionGraph } from "../team/collaboration/collaboration-graph.js";
import { useConversationWorkspaceCache } from "./conversation-workspace-cache.js";
import { formatConversationRunMarkdown } from "./conversation-copy.js";
import { ConversationFindBar } from "./conversation-find-bar.js";
import { ConversationTurnNavigator } from "./conversation-turn-navigator.js";
import {
  ContextUsageIndicator,
  ProviderCacheStatus,
} from "./context-usage-indicator.js";
import { ReasoningEnergyField } from "./reasoning-energy-field.js";
import {
  isConversationScrolledToBottom,
  scrollConversationToBottom,
} from "./conversation-scroll.js";
import {
  appendAssistantDelta,
  appendAssistantReasoningDelta,
  completeStreamingAssistantMessages,
  shouldApplyTimelineLoad,
} from "./conversation-timeline-state.js";
import {
  summarizeTaskFileChanges,
  type TaskFileChangeSummary,
} from "./task-file-change-summary.js";
import "./workspace-content.css";

const DEFAULT_COMPOSER_CLEARANCE_PX = 120;

type WorkspaceContentProps = {
  activeProject: ProjectSummary | null;
  activeSession: ProjectSession | null;
  agentClient: AgentClient;
  canAddProjects: boolean;
  isAddingProject: boolean;
  isCreatingSession: boolean;
  locateTimelineItem?: { conversationId: string; id: string; requestId: number } | null;
  projects: readonly ProjectSummary[];
  protectedSessionIds?: readonly string[];
  sessions: readonly ProjectSession[];
  teamInstances?: readonly TeamInstanceView[];
  onAddProject: () => Promise<ProjectSummary | null>;
  onCreateProjectSession: (projectId: string) => void;
  onCreateTemporarySession: () => void;
  onForkConversation: (conversationId: string, throughMessageId: string) => Promise<void>;
  onLocateProject: (projectId: string) => void;
  onLocateSession: (sessionId: string) => void;
  onOpenProjectFile?: (projectId: string, path: string) => void;
  onOpenTeamConversation: (
    conversation: ProjectSession,
    sourceConversationId?: string,
    timelineItemId?: string,
  ) => void;
  onNavigateToTeamConversation?: (conversationId: string) => void;
  onProjectSelected: (projectId: string) => void;
  onSessionSelected: (sessionId: string) => void;
  onSessionUpdated: (conversation: ConversationSummary) => void;
  onSessionViewed: (sessionId: string) => void;
};

type ConversationPathScope = {
  kind: "project" | "team" | "temporary";
  label: string;
};

export function resolveConversationPathScope(
  project: Pick<ProjectSummary, "name"> | null,
  session: Pick<ProjectSession, "teamId" | "teamWorkItemId">,
  teams: readonly Pick<AgentTeam, "id" | "name">[],
): ConversationPathScope {
  if (project !== null) return { kind: "project", label: project.name };
  if (session.teamId !== null && session.teamWorkItemId == null) {
    return {
      kind: "team",
      label: teams.find((team) => team.id === session.teamId)?.name ?? "团队会话",
    };
  }
  return { kind: "temporary", label: "临时对话" };
}

export type ConversationPathIconKind = "agent" | "conversation" | "subagent" | "team_lead";

export function resolveConversationPathIconKind(
  scope: ConversationPathScope["kind"],
  session: Pick<ProjectSession, "avatarIcon" | "parentConversationId" | "threadKind">,
): ConversationPathIconKind {
  if (scope === "team") return "agent";
  if (session.parentConversationId === null) {
    return session.threadKind === "team_lead" ? "team_lead" : "conversation";
  }
  if (session.threadKind === "team_lead") return "team_lead";
  return session.avatarIcon === null || session.avatarIcon === undefined
    ? "subagent"
    : "agent";
}

type ToolBatchTimelineItem = {
  batchId: string;
  id: string;
  kind: "tool_batch";
  tools: ConversationToolItem[];
};

type RunActivityReasoningItem = {
  content: string;
  id: string;
  kind: "activity_reasoning";
  streaming: boolean;
};

type RunActivityProgressItem = {
  content: string;
  id: string;
  kind: "activity_progress";
  streaming: boolean;
};

type RunActivityTextItem = RunActivityProgressItem | RunActivityReasoningItem;

type RunActivityItem =
  | ConversationModelRetryItem
  | ConversationToolItem
  | RunActivityTextItem;

type RunActivityTimelineItem = {
  durationMs: number | null;
  id: string;
  items: RunActivityItem[];
  kind: "run_activity";
  runId: string;
  runIds: string[];
};

type TimelineDisplayItem = ConversationTimelineItem
  | RunActivityTimelineItem
  | ToolBatchTimelineItem;

type SubmittedTeamWorkItem = {
  id: string;
  teamId: string | null;
  teamInstanceId: string | null;
  title: string;
};

export function submittedTeamWorkItems(
  item: TimelineDisplayItem,
): SubmittedTeamWorkItem[] {
  const tools = item.kind === "tool_batch"
    ? item.tools
    : item.kind === "run_activity"
      ? item.items.filter((entry): entry is ConversationToolItem => entry.kind === "tool")
    : item.kind === "tool" ? [item] : [];
  return tools.flatMap((tool) => {
    if (
      tool.name !== "submit_team_work_item"
      || tool.status !== "completed"
      || tool.result === null
    ) return [];
    try {
      const parsed: unknown = JSON.parse(tool.result);
      if (!isRecord(parsed) || parsed.ok !== true || !isRecord(parsed.value)) return [];
      const id = parsed.value.id;
      const teamId = parsed.value.teamId;
      const teamInstanceId = parsed.value.teamInstanceId;
      const title = parsed.value.title;
      return typeof id === "string" && typeof title === "string"
        ? [{
            id,
            teamId: typeof teamId === "string" ? teamId : null,
            teamInstanceId: typeof teamInstanceId === "string" ? teamInstanceId : null,
            title,
          }]
        : [];
    } catch {
      return [];
    }
  });
}

export function resolveSubmittedTeamGraphTitle(
  workItem: Pick<SubmittedTeamWorkItem, "teamId" | "teamInstanceId">,
  teamInstances: readonly Pick<TeamInstanceView, "id" | "name">[],
  teams: readonly Pick<AgentTeam, "id" | "name">[],
): string {
  const instanceName = workItem.teamInstanceId === null
    ? undefined
    : teamInstances.find((instance) => instance.id === workItem.teamInstanceId)?.name;
  const templateName = workItem.teamId === null
    ? undefined
    : teams.find((team) => team.id === workItem.teamId)?.name;
  return `${instanceName ?? templateName ?? "Agent 团队"} · Agent 协作图`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

type ModelActivity = {
  anchorTimelineItemId: string | null;
  preview?: string;
  runId: string | null;
  status: "progress" | "thinking";
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

const MAX_DRAFT_ATTACHMENTS = 10;
const MAX_DRAFT_ATTACHMENT_BYTES = 25 * 1_024 * 1_024;

function getClipboardAttachmentFiles(clipboardData: DataTransfer): File[] {
  const files = Array.from(clipboardData.files);
  if (files.length > 0) return files;

  return Array.from(clipboardData.items).flatMap((item) => {
    if (item.kind !== "file") return [];
    const file = item.getAsFile();
    return file === null ? [] : [file];
  });
}

function pastedAttachmentName(file: File, index: number): string {
  const name = file.name.trim();
  if (name.length > 0) return name;

  const extension = file.type === "image/jpeg"
    ? "jpg"
    : file.type === "image/gif"
      ? "gif"
      : file.type === "image/webp"
        ? "webp"
        : file.type === "image/png"
          ? "png"
          : "bin";
  return `pasted-${file.type.startsWith("image/") ? "image" : "file"}-${index + 1}.${extension}`;
}

function readAttachmentFileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error ?? new Error("无法读取粘贴的附件"));
    reader.onload = () => {
      if (typeof reader.result !== "string") {
        reject(new Error("无法读取粘贴的附件"));
        return;
      }
      const separatorIndex = reader.result.indexOf(",");
      if (separatorIndex < 0) {
        reject(new Error("无法读取粘贴的附件"));
        return;
      }
      resolve(reader.result.slice(separatorIndex + 1));
    };
    reader.readAsDataURL(file);
  });
}

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
  "id" | "projectId" | "teamId" | "threadKind" | "title"
>;

type ProjectFileMention = Pick<ProjectEntry, "name" | "path"> & {
  workspaceId: string;
};

type TeamMention = {
  id: string;
  name: string;
  scope: TeamInstanceScope;
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
  { description: "立即压缩较早的对话上下文", name: "compact", title: "压缩上下文" },
  { description: "先拆分步骤并创建任务清单", name: "plan", title: "规划任务" },
  { description: "审查实现中的缺陷、风险和回归", name: "review", title: "审查代码" },
  { description: "运行相关测试并根据结果修复", name: "test", title: "运行测试" },
] as const;

type SlashCommand = (typeof SLASH_COMMANDS)[number];

type SlashOption =
  | { kind: "command"; value: SlashCommand }
  | { kind: "skill"; value: SkillConfiguration };

type ConversationReasoningControlProps = {
  disabled: boolean;
  fallbackOption?: ModelReasoningOption | null;
  onValueChange: (value: string) => void;
  options: readonly ModelReasoningOption[];
  selectedKey: string;
};

const REASONING_COLOR_STOPS = [
  { color: "var(--reasoning-blue)", progress: 0 },
  { color: "var(--reasoning-light-blue)", progress: 34 },
  { color: "var(--reasoning-blue-violet)", progress: 68 },
  { color: "var(--reasoning-maximum)", progress: 100 },
] as const;

export function reasoningEndpointColor(progress: number): string {
  const normalizedProgress = Number.isFinite(progress)
    ? Math.min(Math.max(progress, 0), 100)
    : 0;
  const upperIndex = REASONING_COLOR_STOPS.findIndex(
    (stop) => stop.progress >= normalizedProgress,
  );
  if (upperIndex <= 0) return REASONING_COLOR_STOPS[0].color;

  const lower = REASONING_COLOR_STOPS[upperIndex - 1]!;
  const upper = REASONING_COLOR_STOPS[upperIndex]!;
  if (normalizedProgress === upper.progress) return upper.color;

  const upperWeight = Math.round(
    ((normalizedProgress - lower.progress) / (upper.progress - lower.progress)) * 100,
  );
  return `color-mix(in srgb, ${lower.color} ${100 - upperWeight}%, ${upper.color} ${upperWeight}%)`;
}

function ConversationReasoningControl({
  disabled,
  fallbackOption,
  onValueChange,
  options,
  selectedKey,
}: ConversationReasoningControlProps): ReactElement {
  const [mode, setMode] = useState<"slider" | "list">("slider");
  const [open, setOpen] = useState(false);
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
  const displayName = selectedOption === undefined
    ? fallbackSelectedOption === undefined
      ? "自动"
      : reasoningOptionDisplayName(fallbackSelectedOption)
    : reasoningOptionDisplayName(selectedOption);
  const isDisabled = disabled || options.length === 0;
  const colorProgress = selectedIndex === 0
    ? 0
    : options.length <= 1
      ? 100
      : 34 + ((selectedIndex - 1) / (options.length - 1)) * 66;
  const isMaximumStrength = options.length > 0 && selectedIndex === options.length;
  const sliderStyle = {
    "--reasoning-fill": reasoningEndpointColor(colorProgress),
  } as CSSProperties;
  const labels = [
    "自动",
    ...options.map((option) => reasoningOptionDisplayName(option)),
  ];

  const selectSliderValue = (value: string): void => {
    const index = Number(value);
    const option = options[index - 1];
    onValueChange(option === undefined ? "auto" : modelReasoningOptionKey(option));
  };

  const selectReasoningOption = (value: string): void => {
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
        align="end"
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
              disabled={isDisabled}
              max={Math.max(options.length, 1)}
              min={0}
              step={1}
              style={sliderStyle}
              value={[selectedIndex]}
              onValueChange={(values) => selectSliderValue(String(values[0] ?? 0))}
            >
              <SliderTrack className="conversation-workspace__reasoning-track">
                <SliderRange className="conversation-workspace__reasoning-range">
                  <ReasoningEnergyField active={isMaximumStrength} />
                </SliderRange>
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
  locateTimelineItem = null,
  projects,
  onAddProject,
  onCreateProjectSession,
  onCreateTemporarySession,
  onForkConversation,
  onLocateProject,
  onLocateSession,
  onOpenProjectFile,
  onOpenTeamConversation,
  onNavigateToTeamConversation,
  onProjectSelected,
  onSessionSelected,
  onSessionUpdated,
  onSessionViewed,
  protectedSessionIds,
  sessions,
  teamInstances = [],
}: WorkspaceContentProps): ReactElement {
  const activeActivity = useWorkbenchUiStore((state) => state.activeActivity);
  const retainedSessions = useConversationWorkspaceCache(
    activeActivity === "conversations" ? activeSession : null,
    sessions,
    protectedSessionIds,
  );

  if (activeActivity === "team") {
    return (
      <TeamWorkspace
        agentClient={agentClient}
        projects={projects}
        onOpenConversation={onOpenTeamConversation}
        {...(onNavigateToTeamConversation === undefined ? {} : {
          onNavigateToConversation: onNavigateToTeamConversation,
        })}
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
    <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
      {retainedSessions.map((session) => {
        const isActive = session.id === activeSession.id;
        const conversationProject = session.projectId === null
          ? null
          : projects.find((project) => project.id === session.projectId) ?? null;
        const projectId = session.projectId;
        return (
          <div
            aria-hidden={!isActive}
            className={isActive ? "flex min-h-0 min-w-0 flex-1 overflow-hidden" : "hidden"}
            key={session.id}
          >
            <ConversationWorkspace
              active={isActive}
              agentClient={agentClient}
              canAddProjects={canAddProjects}
              isAddingProject={isAddingProject}
              locateTimelineItem={locateTimelineItem?.conversationId === session.id
                ? { id: locateTimelineItem.id, requestId: locateTimelineItem.requestId }
                : null}
              onLocateProject={onLocateProject}
              onLocateSession={onLocateSession}
              onOpenProjectFile={projectId === null || onOpenProjectFile === undefined
                ? undefined
                : (path) => {
                    onOpenProjectFile?.(projectId, path);
                  }}
              onOpenTeamConversation={onOpenTeamConversation}
              {...(onNavigateToTeamConversation === undefined ? {} : {
                onNavigateToTeamConversation,
              })}
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
              teamInstances={teamInstances}
              teamManaged={session.teamWorkItemId !== null && session.teamWorkItemId !== undefined}
            />
          </div>
        );
      })}
    </div>
  );
}

export function ConversationWorkspace({
  active = true,
  agentClient,
  canAddProjects = false,
  compact = false,
  isAddingProject = false,
  locateTimelineItem = null,
  onAddProject,
  onLocateProject,
  onLocateSession,
  onOpenProjectFile,
  onOpenTeamConversation,
  onNavigateToTeamConversation,
  onForkConversation,
  onProjectSelected,
  onSessionSelected,
  onSessionUpdated,
  onViewed,
  project,
  projects = [],
  relatedSessions = EMPTY_PROJECT_SESSIONS,
  session,
  teamInstances = [],
  teamManaged = false,
}: {
  active?: boolean;
  agentClient: AgentClient;
  canAddProjects?: boolean;
  compact?: boolean;
  isAddingProject?: boolean;
  locateTimelineItem?: { id: string; requestId: number } | null;
  onAddProject?: () => Promise<ProjectSummary | null>;
  onLocateProject?: (projectId: string) => void;
  onLocateSession?: (sessionId: string) => void;
  onOpenProjectFile?: ((path: string) => void) | undefined;
  onOpenTeamConversation?: (
    conversation: ProjectSession,
    sourceConversationId?: string,
    timelineItemId?: string,
  ) => void;
  onNavigateToTeamConversation?: (conversationId: string) => void;
  onForkConversation?: (conversationId: string, throughMessageId: string) => Promise<void>;
  onProjectSelected?: (projectId: string) => void;
  onSessionSelected?: (sessionId: string) => void;
  onSessionUpdated?: (conversation: ConversationSummary) => void;
  onViewed?: () => void;
  project: ProjectSummary | null;
  projects?: readonly ProjectSummary[];
  relatedSessions?: readonly ProjectSession[];
  session: ProjectSession;
  teamInstances?: readonly TeamInstanceView[];
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
  const [editingAttachments, setEditingAttachments] = useState<ConversationAttachment[] | null>(null);
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
  const [slashSkills, setSlashSkills] = useState<SkillConfiguration[]>([]);
  const [draftAttachments, setDraftAttachments] = useState<ConversationAttachment[]>([]);
  const [draftAttachmentPreviewUrls, setDraftAttachmentPreviewUrls] = useState<
    Record<string, string>
  >({});
  const draftAttachmentPreviewUrlsRef = useRef<Record<string, string>>({});
  const [contextCompressionConfiguration, setContextCompressionConfiguration] =
    useState<ContextCompressionConfiguration>(DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION);
  const [contextUsage, setContextUsage] =
    useState<ConversationContextUsage | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isChangingWorkspace, setIsChangingWorkspace] = useState(false);
  const [isChangingProject, setIsChangingProject] = useState(false);
  const [isAddingAttachments, setIsAddingAttachments] = useState(false);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(true);
  const [isMockRuntime, setIsMockRuntime] = useState(false);
  const [isSavingTeamPermission, setIsSavingTeamPermission] = useState(false);
  const [isScrolledAwayFromBottom, setIsScrolledAwayFromBottom] = useState(false);
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
  const composerOverlayRef = useRef<HTMLDivElement | null>(null);
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(
    DEFAULT_COMPOSER_CLEARANCE_PX,
  );
  const isReturningToBottomRef = useRef(false);
  const lastKnownScrollTopRef = useRef<number | null>(null);
  const locatedTimelineRequestIdRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const copiedMessageTimeoutRef = useRef<number | null>(null);
  const rememberDraftAttachmentPreview = useCallback((attachmentId: string, url: string): void => {
    draftAttachmentPreviewUrlsRef.current = {
      ...draftAttachmentPreviewUrlsRef.current,
      [attachmentId]: url,
    };
    setDraftAttachmentPreviewUrls(draftAttachmentPreviewUrlsRef.current);
  }, []);
  const forgetDraftAttachmentPreview = useCallback((attachmentId: string): void => {
    const currentUrl = draftAttachmentPreviewUrlsRef.current[attachmentId];
    if (currentUrl !== undefined) URL.revokeObjectURL(currentUrl);
    const nextUrls = { ...draftAttachmentPreviewUrlsRef.current };
    delete nextUrls[attachmentId];
    draftAttachmentPreviewUrlsRef.current = nextUrls;
    setDraftAttachmentPreviewUrls(nextUrls);
  }, []);
  const clearDraftAttachmentPreviews = useCallback((): void => {
    Object.values(draftAttachmentPreviewUrlsRef.current).forEach((url) => {
      URL.revokeObjectURL(url);
    });
    draftAttachmentPreviewUrlsRef.current = {};
    setDraftAttachmentPreviewUrls({});
  }, []);
  useEffect(() => () => {
    Object.values(draftAttachmentPreviewUrlsRef.current).forEach((url) => {
      URL.revokeObjectURL(url);
    });
  }, []);
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
  const slashMenuOpen = slashQuery !== null;
  useEffect(() => {
    if (!slashMenuOpen) return;
    let cancelled = false;
    void agentClient.getIntegrationConfiguration().then((configuration) => {
      if (!cancelled) setSlashSkills(configuration.skills);
    }).catch(() => {
      if (!cancelled) setSlashSkills([]);
    });
    return () => {
      cancelled = true;
    };
  }, [agentClient, session.id, slashMenuOpen]);
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
  const composerAttachments = useMemo(() => {
    if (editingMessageId === null) {
      return editingPendingMessageId === null ? draftAttachments : [];
    }
    return editingAttachments ?? [];
  }, [draftAttachments, editingAttachments, editingMessageId, editingPendingMessageId]);
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
      setSubagentApprovals((current) => current.length === 0 ? current : []);
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
    clearDraftAttachmentPreviews();
    void Promise.resolve().then(loadDraftAttachments);
  }, [clearDraftAttachmentPreviews, loadDraftAttachments]);

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
              conversation.id !== session.id
              && !conversation.isArchived
              && conversation.teamId === null
            )
            .map(({ id, projectId, teamId, threadKind, title }) => ({
              id,
              projectId,
              teamId,
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
    if (messages === null || !active) return;
    lastKnownScrollTopRef.current = messages.scrollTop;
    const isAtBottom = isConversationScrolledToBottom(messages);
    if (isReturningToBottomRef.current) {
      isReturningToBottomRef.current = !isAtBottom;
      shouldStickToBottomRef.current = true;
      setIsScrolledAwayFromBottom(!isAtBottom);
      return;
    }
    shouldStickToBottomRef.current = isAtBottom;
    setIsScrolledAwayFromBottom(!isAtBottom);
  }, [active]);

  const handleScrollToBottom = useCallback((): void => {
    const messages = messagesRef.current;
    if (messages === null) return;
    isReturningToBottomRef.current = true;
    shouldStickToBottomRef.current = true;
    messages.scrollTo({
      behavior: "smooth",
      left: 0,
      top: messages.scrollHeight,
    });
  }, []);

  useLayoutEffect(() => {
    const overlay = composerOverlayRef.current;
    if (overlay === null) return;

    const updateHeight = (): void => {
      const nextHeight = Math.ceil(overlay.getBoundingClientRect().height);
      if (nextHeight <= 0) return;
      setComposerOverlayHeight((current) => current === nextHeight ? current : nextHeight);
    };
    updateHeight();
    if (typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(updateHeight);
    observer.observe(overlay);
    return () => observer.disconnect();
  }, []);

  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (!active || isLoadingTimeline || messages === null) return;
    const savedScrollTop = lastKnownScrollTopRef.current;
    const shouldRestoreBottom = savedScrollTop === null || shouldStickToBottomRef.current;
    const restoreScrollPosition = (): void => {
      if (lastKnownScrollTopRef.current !== savedScrollTop) return;
      if (shouldRestoreBottom) {
        scrollConversationToBottom(messages);
      } else {
        messages.scrollLeft = 0;
        messages.scrollTop = savedScrollTop;
      }
      const isAtBottom = isConversationScrolledToBottom(messages);
      shouldStickToBottomRef.current = isAtBottom;
      setIsScrolledAwayFromBottom(!isAtBottom);
    };
    restoreScrollPosition();
    const animationFrame = window.requestAnimationFrame(restoreScrollPosition);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [active, isLoadingTimeline]);

  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (!active || messages === null || !shouldStickToBottomRef.current) return;

    const scrollToBottom = (): void => {
      if (shouldStickToBottomRef.current) scrollConversationToBottom(messages);
    };
    scrollToBottom();
    const animationFrame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [active, composerOverlayHeight, isLoadingTimeline, modelActivity, operationError, taskList, timeline]);

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
    setEditingAttachments(message.attachments);
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
    setEditingAttachments(null);
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
    setEditingAttachments(null);
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
        && composerAttachments.length === 0
        && activeProjectFileMentions.length === 0
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
        const replacementAttachmentIds = composerAttachments.map((attachment) => attachment.id);
        const accepted = await agentClient.replaceLatestConversationMessage({
          attachmentIds: replacementAttachmentIds,
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
        setEditingAttachments(null);
        setDraftAttachments((current) => current.filter(
          (attachment) => !replacementAttachmentIds.includes(attachment.id),
        ));
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
        clearDraftAttachmentPreviews();
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

  const handleForceContextCompaction = async (): Promise<void> => {
    if (
      activeRunId !== null
      || isSending
      || isFinishedSubagent
      || (!isMockRuntime && modelStatus?.configured === false)
    ) return;
    setIsSending(true);
    beginRunProgress(setRunProgresses, null, timelineRef.current.at(-1)?.id ?? null);
    setModelActivity({
      anchorTimelineItemId: timelineRef.current.at(-1)?.id ?? null,
      runId: null,
      status: "thinking",
    });
    setOperationError(null);
    try {
      const accepted = await agentClient.sendConversationMessage({
        ...(selectedAgent === undefined
          ? {}
          : { agent: toConversationAgentBinding(selectedAgent) }),
        content: "/compact",
        conversationId: session.id,
        deliveryMode: messageDeliveryMode,
        ...(activeModel === undefined
          ? {}
          : { modelId: activeModel.modelId, providerId: activeModel.providerId }),
        permissionMode,
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
      void loadContextUsage();
    } catch (error) {
      discardPendingRunProgress(setRunProgresses);
      setModelActivity(null);
      setOperationError(getUserErrorMessage(error, "无法强制压缩上下文"));
    } finally {
      setIsSending(false);
      refocusComposer();
    }
  };

  const handleChooseAttachments = useCallback(async (): Promise<void> => {
    if (isAddingAttachments || isSending || isFinishedSubagent) return;
    setIsAddingAttachments(true);
    setOperationError(null);
    try {
      const attachments = await agentClient.chooseConversationAttachments({
        conversationId: session.id,
      });
      setDraftAttachments(attachments);
      if (editingMessageId !== null) {
        const previousDraftIds = new Set(draftAttachments.map((attachment) => attachment.id));
        const addedAttachments = attachments.filter(
          (attachment) => !previousDraftIds.has(attachment.id),
        );
        setEditingAttachments((current) => mergeConversationAttachments(
          current ?? [],
          addedAttachments,
        ));
      }
    } catch (error) {
      setOperationError(getUserErrorMessage(error, "无法添加附件"));
    } finally {
      setIsAddingAttachments(false);
    }
  }, [
    agentClient,
    draftAttachments,
    editingMessageId,
    isAddingAttachments,
    isSending,
    isFinishedSubagent,
    session.id,
  ]);

  const handlePasteAttachments = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
      const files = getClipboardAttachmentFiles(event.clipboardData);
      if (files.length === 0) return;

      if (
        isMockRuntime
        || isSending
        || isFinishedSubagent
        || isAddingAttachments
        || editingPendingMessageId !== null
      ) {
        return;
      }
      event.preventDefault();

      const remainingCount = MAX_DRAFT_ATTACHMENTS - composerAttachments.length;
      if (files.length > remainingCount) {
        setOperationError(`每条消息最多添加 ${MAX_DRAFT_ATTACHMENTS} 个附件。`);
        return;
      }
      const oversizedFile = files.find((file) => file.size > MAX_DRAFT_ATTACHMENT_BYTES);
      if (oversizedFile !== undefined) {
        setOperationError(`“${pastedAttachmentName(oversizedFile, 0)}”超过 25 MB。`);
        return;
      }

      setIsAddingAttachments(true);
      setOperationError(null);
      void (async () => {
        try {
          let attachments = draftAttachments;
          const addedAttachments: ConversationAttachment[] = [];
          for (const [index, file] of files.entries()) {
            const previousAttachmentIds = new Set(attachments.map((attachment) => attachment.id));
            const importedAttachments = await agentClient.importConversationAttachmentBytes({
              base64: await readAttachmentFileAsBase64(file),
              conversationId: session.id,
              ...(file.type.length === 0 ? {} : { mimeType: file.type }),
              name: pastedAttachmentName(file, index),
            });
            const importedImage = file.type.startsWith("image/")
              ? importedAttachments.find((attachment) =>
                attachment.kind === "image" && !previousAttachmentIds.has(attachment.id)
              )
              : undefined;
            if (importedImage !== undefined) {
              rememberDraftAttachmentPreview(importedImage.id, URL.createObjectURL(file));
            }
            addedAttachments.push(...importedAttachments.filter(
              (attachment) => !previousAttachmentIds.has(attachment.id),
            ));
            attachments = importedAttachments;
          }
          setDraftAttachments(attachments);
          if (editingMessageId !== null) {
            setEditingAttachments((current) => mergeConversationAttachments(
              current ?? [],
              addedAttachments,
            ));
          }
        } catch (error) {
          try {
            setDraftAttachments(await agentClient.listDraftConversationAttachments({
              conversationId: session.id,
            }));
          } catch {
            // Keep the current draft list when the recovery read also fails.
          }
          setOperationError(getUserErrorMessage(error, "无法粘贴附件"));
        } finally {
          setIsAddingAttachments(false);
        }
      })();
    },
    [
      agentClient,
      composerAttachments.length,
      draftAttachments,
      editingMessageId,
      editingPendingMessageId,
      isAddingAttachments,
      isFinishedSubagent,
      isMockRuntime,
      isSending,
      rememberDraftAttachmentPreview,
      session.id,
    ],
  );

  const handleRemoveAttachment = useCallback(async (
    attachment: ConversationAttachment,
  ): Promise<void> => {
    const attachmentId = attachment.id;
    if (removingAttachmentId !== null || isSending) return;
    if (editingMessageId !== null && attachment.messageId !== null) {
      setEditingAttachments((current) => (
        current?.filter((candidate) => candidate.id !== attachmentId) ?? null
      ));
      return;
    }
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
      setEditingAttachments((current) => (
        current?.filter((candidate) => candidate.id !== attachmentId) ?? null
      ));
      forgetDraftAttachmentPreview(attachmentId);
    } catch {
      setOperationError("无法移除附件");
    } finally {
      setRemovingAttachmentId(null);
    }
  }, [
    agentClient,
    editingMessageId,
    forgetDraftAttachmentPreview,
    isSending,
    removingAttachmentId,
    session.id,
  ]);

  const mentionOptions = useMemo((): MentionOption[] => {
    if (mentionQuery === null || mentionQuery.query.length === 0) return [];
    const options: MentionOption[] = [];
    const normalizedQuery = mentionQuery.query.toLocaleLowerCase();
    const canMentionTeams = session.projectId !== null
      && session.parentConversationId === null
      && session.threadKind === "agent"
      && !teamManaged;
    if (canMentionTeams) {
      options.push(...teamInstances
        .filter((instance) =>
          !selectedTeamMentions.some((selected) => selected.id === instance.id)
          && instance.name.toLocaleLowerCase().includes(normalizedQuery)
          && (
            instance.scope === "global"
            || (instance.scope === "project" && instance.projectId === session.projectId)
            || (
              instance.scope === "conversation"
              && instance.sourceConversationId === session.id
            )
          )
        )
        .slice(0, 4)
        .map((instance): MentionOption => ({
          kind: "team",
          value: {
            id: instance.id,
            name: instance.name,
            scope: instance.scope,
          },
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
    session.id,
    session.parentConversationId,
    session.projectId,
    session.threadKind,
    teamManaged,
    teamInstances,
  ]);

  const slashOptions = useMemo(() => {
    if (slashQuery === null) return [];
    const query = slashQuery.query.toLocaleLowerCase();
    const allowedSkillIds = selectedAgent?.capabilityScope === "custom"
      ? new Set(selectedAgent.skillIds)
      : null;
    const commands: SlashOption[] = SLASH_COMMANDS
      .filter((command) =>
        command.name.includes(query)
        || command.title.toLocaleLowerCase().includes(query)
      )
      .map((command) => ({ kind: "command", value: command }));
    const skills: SlashOption[] = slashSkills
      .filter((skill) =>
        skill.enabled
        && (allowedSkillIds === null || allowedSkillIds.has(skill.id))
        && (skill.scope === "user"
          || (skill.scope === "project" && session.projectId !== null)
          || (skill.scope === "team" && session.teamId !== null))
        && (
          skill.id.toLocaleLowerCase().includes(query)
          || skill.name.toLocaleLowerCase().includes(query)
          || skill.description.toLocaleLowerCase().includes(query)
        )
      )
      .map((skill) => ({ kind: "skill", value: skill }));
    return [...commands, ...skills];
  }, [selectedAgent, session.projectId, session.teamId, slashQuery, slashSkills]);

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

  const selectSlashOption = useCallback((option: SlashOption): void => {
    if (slashQuery === null) return;
    const optionName = option.kind === "skill" ? option.value.id : option.value.name;
    const insertedText = `/${optionName} `;
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
      const option = slashOptions[Number(event.currentTarget.dataset.optionIndex)];
      if (option !== undefined) selectSlashOption(option);
    },
    [selectSlashOption, slashOptions],
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
          if (selected !== undefined) selectSlashOption(selected);
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
      selectSlashOption,
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

  const handleReorderPendingMessages = useCallback(async (
    pendingMessageIds: readonly string[],
    pendingMessageId: string,
  ): Promise<void> => {
    if (pendingMessageActionId !== null) return;
    if (
      pendingMessageIds.length !== pendingMessages.length
      || pendingMessageIds.every((id, index) => id === pendingMessages[index]?.id)
    ) return;
    const messagesById = new Map(pendingMessages.map((message) => [message.id, message]));
    const next = pendingMessageIds.flatMap((id) => {
      const message = messagesById.get(id);
      return message === undefined ? [] : [message];
    });
    if (next.length !== pendingMessages.length) return;
    const previous = pendingMessages;
    setPendingMessages(next);
    setPendingMessageActionId(pendingMessageId);
    setOperationError(null);
    try {
      setPendingMessages(await agentClient.reorderConversationPendingMessages({
        conversationId: session.id,
        pendingMessageIds: [...pendingMessageIds],
      }));
    } catch (error) {
      setPendingMessages(previous);
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
  const subagentConversationIds = useMemo(
    () => new Set([session, ...relatedSessions]
      .filter((candidate) => candidate.threadKind === "subagent")
      .map((candidate) => candidate.id)),
    [relatedSessions, session],
  );
  const displayTimeline = groupRunActivities(
    projectSubagentMessagesForParentTimeline(timeline, subagentConversationIds),
  );
  const forceableCompactionId = forceableContextCompactionId(timeline, activeRunId);
  const runningContextCompactionRunIds = new Set(
    displayTimeline.flatMap((item) =>
      item.kind === "tool" && isRunningContextCompaction(item) && item.runId !== null
        ? [item.runId]
        : [],
    ),
  );
  useLayoutEffect(() => {
    if (
      locateTimelineItem === null
      || isLoadingTimeline
      || locatedTimelineRequestIdRef.current === locateTimelineItem.requestId
    ) return;
    const messages = messagesRef.current;
    if (messages === null) return;
    const anchor = Array.from(messages.querySelectorAll<HTMLElement>(
      "[data-conversation-timeline-item]",
    )).find((candidate) => (
      candidate.dataset.conversationTimelineItem === locateTimelineItem.id
    ));
    if (anchor === undefined) return;
    const target = anchor.firstElementChild instanceof HTMLElement
      ? anchor.firstElementChild
      : anchor;
    shouldStickToBottomRef.current = false;
    if (typeof target.scrollIntoView === "function") {
      target.scrollIntoView({ behavior: "smooth", block: "center" });
    }
    locatedTimelineRequestIdRef.current = locateTimelineItem.requestId;
  }, [isLoadingTimeline, locateTimelineItem, timeline]);
  const latestActiveToolId = useMemo(() => getLatestActiveToolId(timeline), [timeline]);
  const runDurationsByInsertIndex = useMemo(
    () => getConversationRunDurationInsertIndexes(displayTimeline),
    [displayTimeline],
  );
  const repeatedAssistantFailureMessageIds = useMemo(
    () => getRepeatedAssistantFailureMessageIds(displayTimeline),
    [displayTimeline],
  );
  const runProgressesByInsertIndex = useMemo(() => {
    const progressByIndex = new Map<number, RunProgress[]>();
    for (const progress of runProgresses) {
      const insertIndex = getConversationRunProgressInsertIndex(
        displayTimeline,
        progress.anchorTimelineItemId,
      );
      const items = progressByIndex.get(insertIndex) ?? [];
      items.push(progress);
      progressByIndex.set(insertIndex, items);
    }
    return progressByIndex;
  }, [displayTimeline, runProgresses]);
  const modelActivityInsertIndex = modelActivity === null
    ? -1
    : getModelActivityInsertIndex(
        displayTimeline,
        modelActivity.runId,
        runProgresses.find((progress) => progress.runId === modelActivity.runId)
          ?.anchorTimelineItemId
          ?? modelActivity.anchorTimelineItemId,
      );
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
  const conversationAgentAvatars = useMemo(() => {
    const profilesById = new Map(agentProfiles.map((agent) => [agent.id, agent]));
    const avatars = new Map<string, AgentProfile["avatar"]>();
    for (const candidate of [session, ...relatedSessions]) {
      const profile = candidate.agentId === null
        ? undefined
        : profilesById.get(candidate.agentId);
      if (profile !== undefined) {
        avatars.set(candidate.id, profile.avatar);
      } else if (candidate.avatarIcon !== null && candidate.avatarIcon !== undefined) {
        avatars.set(candidate.id, { icon: candidate.avatarIcon, kind: "icon" });
      }
    }
    return avatars;
  }, [agentProfiles, relatedSessions, session]);
  const pathScope = resolveConversationPathScope(project, session, teams);
  const pathAgent = session.agentId === null
    ? undefined
    : agentProfiles.find((agent) => agent.id === session.agentId);
  const pathIconKind = resolveConversationPathIconKind(pathScope.kind, session);

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
          {pathScope.kind === "project" && project !== null ? (
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
          ) : pathScope.kind === "team" ? (
            <>
              <span className="conversation-workspace__path-temporary">
                <UsersRound aria-hidden="true" size={16} />
                团队
              </span>
              <ChevronRight aria-hidden="true" size={12} strokeWidth={1.75} />
              <span
                className="conversation-workspace__path-temporary conversation-workspace__path-team"
                title={pathScope.label}
              >
                <span>{pathScope.label}</span>
              </span>
            </>
          ) : (
            <span className="conversation-workspace__path-temporary">
              <MessageSquareText aria-hidden="true" size={16} />
              {pathScope.label}
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
            {pathIconKind === "conversation" ? (
              <MessageSquareText aria-hidden="true" size={14} strokeWidth={1.75} />
            ) : pathIconKind === "team_lead" ? (
              <Scale aria-label="Team Lead 对话" size={14} />
            ) : pathIconKind === "agent" && pathAgent !== undefined ? (
              <AgentAvatar avatar={pathAgent.avatar} size="compact" />
            ) : pathIconKind === "agent"
              && session.avatarIcon !== null
              && session.avatarIcon !== undefined ? (
              <AgentAvatar
                avatar={{ icon: session.avatarIcon, kind: "icon" }}
                size="compact"
              />
            ) : (
              <SubagentAvatar icon={session.avatarIcon} seed={session.id} size="compact" />
            )}
            <h1 id={headingId}>{session.title}</h1>
          </button>
        </div>
        <RuntimeBadge
          isConfigured={isMockRuntime || !isModelUnavailable}
          isMockRuntime={isMockRuntime}
          isRunning={isRunning}
          modelDisplayName={modelDisplayName}
        />
      </header>

      <div
        className="conversation-workspace__surface"
      >
        <ConversationFindBar active={active} containerRef={messagesRef} revision={timeline} />
        <ConversationTurnNavigator
          bottomOffsetPx={composerOverlayHeight + 12}
          containerRef={messagesRef}
          hidden={compact}
          timeline={timeline}
          onNavigateStart={() => {
            shouldStickToBottomRef.current = false;
          }}
        />
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
                      <span>已处理 {formatRunDuration(0, durationMs)}</span>
                    </div>
                  ))}
                  {(runProgressesByInsertIndex.get(index) ?? [])
                    .filter((progress) =>
                      (progress.runId === null || !runningContextCompactionRunIds.has(progress.runId))
                      && (
                        item.kind !== "run_activity"
                        || progress.runId === null
                        || !item.runIds.includes(progress.runId)
                      )
                    )
                    .map((progress) => (
                      <RunProgressIndicator key={progress.runId ?? "pending"} progress={progress} />
                    ))}
                  {modelActivity !== null
                    && modelActivityInsertIndex === index
                    && item.kind !== "tool_batch"
                    && item.kind !== "run_activity" ? (
                    <ModelActivityIndicator activity={modelActivity} />
                  ) : null}
                  {repeatedAssistantFailureMessageIds.has(item.id) ? null : (
                    <div
                      className="contents"
                      data-conversation-timeline-item={item.id}
                    >
                      <TimelineItem
                        agentClient={agentClient}
                        item={item}
                        agentAvatar={item.kind === "agent_message"
                          ? conversationAgentAvatars.get(item.senderConversationId)
                            ?? agentProfiles.find((agent) =>
                              item.senderTitle === agent.name
                              || item.senderTitle.startsWith(`${agent.name} ·`)
                            )?.avatar
                            ?? null
                          : null}
                        agentAvatarSeed={item.kind === "agent_message"
                          && subagentConversationIds.has(item.senderConversationId)
                          ? item.senderConversationId
                          : null}
                        teamManaged={teamManaged}
                        activeRunId={activeRunId}
                        latestActiveToolId={latestActiveToolId}
                        modelActivity={modelActivity !== null
                          && modelActivityInsertIndex === index
                          && (item.kind === "tool_batch" || item.kind === "run_activity")
                          ? modelActivity
                          : null}
                        runProgress={item.kind === "run_activity"
                          ? runProgresses.find((progress) =>
                              progress.runId !== null && item.runIds.includes(progress.runId)
                            )
                            ?? null
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
                        canForceContextCompaction={item.kind === "tool"
                          && item.id === forceableCompactionId}
                        latestUserMessageId={teamManaged ? null : latestUserMessageId}
                        onChangeApproval={handleChangeApproval}
                        onCopyMessage={handleCopyMessage}
                        onEditMessage={handleEditMessage}
                        onForkMessage={handleForkMessage}
                        onForceContextCompaction={handleForceContextCompaction}
                        onOpenProjectFile={onOpenProjectFile}
                        onSessionSelected={onSessionSelected}
                        liveToolOutputs={liveToolOutputs}
                      />
                    </div>
                  )}
                  {submittedTeamWorkItems(item).map((workItem) => (
                    <CollaborationProjectionGraph
                      agentClient={agentClient}
                      key={workItem.id}
                      title={resolveSubmittedTeamGraphTitle(workItem, teamInstances, teams)}
                      variant="conversation"
                      workItemId={workItem.id}
                      {...(onOpenTeamConversation === undefined ? {} : {
                        onOpenConversation: (conversationId: string) => {
                          const conversation = relatedSessions.find(
                            (candidate) => candidate.id === conversationId,
                          );
                          if (conversation !== undefined) onOpenTeamConversation(conversation, session.id);
                        },
                      })}
                      {...(onNavigateToTeamConversation === undefined ? {} : {
                        onNavigateToConversation: onNavigateToTeamConversation,
                      })}
                    />
                  ))}
                </Fragment>
              ))}
              {(runProgressesByInsertIndex.get(displayTimeline.length) ?? [])
                .filter((progress) =>
                  progress.runId === null || !runningContextCompactionRunIds.has(progress.runId)
                )
                .map((progress) => (
                  <RunProgressIndicator key={progress.runId ?? "pending"} progress={progress} />
                ))}
              {modelActivity !== null && modelActivityInsertIndex === displayTimeline.length ? (
                <ModelActivityIndicator activity={modelActivity} />
              ) : null}
            </>
          )}
          {operationError !== null ? <ConversationErrorItem content={operationError} /> : null}
          <div
            aria-hidden="true"
            className="w-full shrink-0"
            data-conversation-composer-clearance
            style={{ height: `${composerOverlayHeight}px` }}
          />
        </div>

        {isScrolledAwayFromBottom ? (
          <IconButton
            className="absolute left-1/2 z-[5] -translate-x-1/2 rounded-full border border-[var(--app-border)] bg-[var(--app-panel)] text-[var(--app-foreground)] shadow-md hover:bg-[var(--app-hover)]"
            label="回到对话底部"
            size="compact"
            style={{ bottom: `${composerOverlayHeight + 5}px` }}
            variant="quiet"
            onClick={handleScrollToBottom}
          >
            <ArrowDown aria-hidden="true" size={16} />
          </IconButton>
        ) : null}

        <div ref={composerOverlayRef} className="conversation-workspace__composer-overlay">
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
              agentClient={agentClient}
              actioningMessageId={pendingMessageActionId}
              editingMessageId={editingPendingMessageId}
              messages={pendingMessages}
              onDelete={handleDeletePendingMessage}
              onEdit={handleEditPendingMessage}
              onReorder={handleReorderPendingMessages}
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
            {composerAttachments.length > 0 ? (
              <AttachmentStrip variant="draft">
                {composerAttachments.map((attachment) => (
                  <AttachmentChip
                    agentClient={agentClient}
                    key={attachment.id}
                    attachment={attachment}
                    isRemoving={removingAttachmentId === attachment.id}
                    {...(draftAttachmentPreviewUrls[attachment.id] === undefined
                      ? {}
                      : { previewUrl: draftAttachmentPreviewUrls[attachment.id] })}
                    onRemove={() => void handleRemoveAttachment(attachment)}
                  />
                ))}
              </AttachmentStrip>
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
                    <FileTypeIcon path={mention.path} size={13} />
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
                          <FileTypeIcon path={option.value.path} size={15} />
                        )}
                        <span>
                          <strong>{option.kind === "conversation"
                            ? option.value.title
                            : option.kind === "team" ? option.value.name : option.value.name}</strong>
                          <small>{option.kind === "conversation"
                            ? `${projectName ?? "临时对话"} · ${threadKindLabel(option.value.threadKind)}`
                            : option.kind === "team"
                              ? option.value.scope === "global"
                                ? "全局团队"
                                : option.value.scope === "project"
                                  ? "项目团队"
                                  : "对话团队"
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
                  ) : slashOptions.map((option, index) => (
                    <button
                      aria-selected={index === mentionSelectionIndex}
                      className={index === mentionSelectionIndex ? "is-selected" : undefined}
                      data-option-index={index}
                      key={`${option.kind}:${option.kind === "skill"
                        ? option.value.id
                        : option.value.name}`}
                      role="option"
                      type="button"
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={handleSlashCommandClick}
                    >
                      {option.kind === "skill" ? (
                        <Sparkles aria-hidden="true" size={15} />
                      ) : option.value.name === "compact" ? (
                        <ArchiveRestore aria-hidden="true" size={15} />
                      ) : option.value.name === "plan" ? (
                        <ListTodo aria-hidden="true" size={15} />
                      ) : option.value.name === "review" ? (
                        <FileSearch aria-hidden="true" size={15} />
                      ) : (
                        <Terminal aria-hidden="true" size={15} />
                      )}
                      <span>
                        <strong>/{option.kind === "skill"
                          ? option.value.id
                          : option.value.name} · {option.kind === "skill"
                            ? option.value.name
                            : option.value.title}</strong>
                        <small>{option.kind === "skill"
                          ? `Skill · ${option.value.description || "使用这个 Skill 处理任务"}`
                          : option.value.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              ) : null}
              <textarea
                ref={composerRef}
                aria-label="输入任务"
                data-query-active={mentionQuery !== null || slashQuery !== null
                  ? "true"
                  : undefined}
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
                onPaste={handlePasteAttachments}
              />
            </div>
            <div className="conversation-workspace__composer-toolbar">
              <div className="conversation-workspace__composer-options">
                <IconButton
                  disabled={
                    isMockRuntime
                    || isSending
                    || isFinishedSubagent
                    || isAddingAttachments
                    || editingPendingMessageId !== null
                    || composerAttachments.length >= MAX_DRAFT_ATTACHMENTS
                  }
                  label={editingPendingMessageId !== null
                    ? "排队消息暂不支持修改附件"
                    : isAddingAttachments
                      ? "正在添加附件"
                      : "添加文件或图片，也可直接粘贴"}
                  size="compact"
                  type="button"
                  variant="quiet"
                  onClick={() => void handleChooseAttachments()}
                >
                  {isAddingAttachments ? (
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
                    <SelectItem value="read_only">规划</SelectItem>
                    <SelectItem value="ask_before_changes">请求审批</SelectItem>
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
                    align="end"
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
                        && composerAttachments.length === 0
                        && activeProjectFileMentions.length === 0
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
          {showContextUsage ? <ProviderCacheStatus usage={contextUsage} /> : null}
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
    case "model.retry_updated":
      updateTimeline((current) => upsertTimelineItem(
        completeStreamingAssistantMessages(current),
        event.retry,
      ));
      setModelActivity((current) => current?.runId === event.runId ? null : current);
      return;
    case "assistant.reasoning_delta": {
      if (event.kind === "content") {
        setModelActivity((current) => current?.runId === event.runId ? null : current);
        updateTimeline((current) => appendAssistantReasoningDelta(current, event));
        return;
      }
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
          status: event.kind === "progress" ? "progress" : "thinking"
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
      setModelActivity((current) => current?.runId === event.runId ? null : current);
      if (event.tool.name === "compact_context") {
        removeRunProgress(setRunProgresses, event.runId);
      }
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

function ModelActivityIndicator({ activity }: { activity: ModelActivity }): ReactElement {
  const label = modelActivityLabel(activity);
  const hasPreview = activity.preview !== undefined
    && activity.preview.trim().length > 0;

  return (
    <div
      aria-live="polite"
      className="conversation-model-activity"
      data-has-preview={String(hasPreview)}
      data-status={activity.status}
      role="status"
    >
      <span className="conversation-model-activity__label" title={label}>{label}</span>
    </div>
  );
}

function RunProgressIndicator({ progress }: { progress: RunProgress }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const intervalId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, []);
  const label = `已处理 ${formatRunDuration(progress.startedAt, now)}`;

  return (
    <div
      aria-label={label}
      className="conversation-run-progress"
      role="timer"
    >
      <span className="conversation-run-progress__label">{label}</span>
    </div>
  );
}

function modelActivityLabel(activity: ModelActivity): string {
  const preview = activity.preview?.trim();
  return preview === undefined || preview.length === 0
    ? "正在推理"
    : normalizeModelActivityPreview(preview);
}

export function normalizeModelActivityPreview(preview: string): string {
  return preview
    .trim()
    .replace(/([\p{L}\p{N}])[*_]{3,}(?=[\p{L}\p{N}])/gu, "$1 · ")
    .replace(/(^|[\s([{])(?:\*{1,3}|_{1,3})(?=\S)/gu, "$1")
    .replace(/([\p{L}\p{N})\]}])(?:\*{1,3}|_{1,3})(?=$|[\s.,!?;:)\]}])/gu, "$1")
    .replace(/[\t ]*·[\t ]*/gu, " · ")
    .replace(/[\t ]{2,}/gu, " ");
}

function beginRunProgress(
  setRunProgresses: Dispatch<SetStateAction<RunProgress[]>>,
  runId: string | null,
  anchorTimelineItemId: string | null,
): void {
  const startedAt = Date.now();
  setRunProgresses((current) => {
    if (current.some((progress) => progress.runId === runId)) return current;
    const pending = runId === null
      ? undefined
      : current.findLast((progress) => progress.runId === null);
    if (pending !== undefined) {
      return current.map((progress) => progress === pending
        ? { ...progress, anchorTimelineItemId, runId }
        : progress);
    }
    return [
      ...current,
      { anchorTimelineItemId, outputStartedAt: null, runId, startedAt },
    ];
  });
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

function reorderPendingMessageIds(
  identifiers: readonly string[],
  sourceId: string,
  targetId: string,
  position: "after" | "before",
): string[] {
  const reordered = identifiers.filter((identifier) => identifier !== sourceId);
  const targetIndex = reordered.indexOf(targetId);
  if (targetIndex < 0) return [...identifiers];
  reordered.splice(position === "before" ? targetIndex : targetIndex + 1, 0, sourceId);
  return reordered;
}

function setPendingMessageDragPreview(
  event: DragEvent<HTMLElement>,
  item: HTMLElement,
): void {
  const bounds = item.getBoundingClientRect();
  const preview = item.cloneNode(true) as HTMLElement;
  preview.classList.add("conversation-pending-queue__drag-preview");
  preview.style.width = `${bounds.width}px`;
  preview.style.height = `${bounds.height}px`;
  document.body.append(preview);
  event.dataTransfer.setDragImage(
    preview,
    Math.max(0, event.clientX - bounds.left),
    Math.max(0, event.clientY - bounds.top),
  );
  window.setTimeout(() => preview.remove(), 0);
}

function PendingMessageAttachmentPreviews({
  agentClient,
  attachmentIds,
  conversationId,
}: {
  agentClient: AgentClient;
  attachmentIds: readonly string[];
  conversationId: string;
}): ReactElement | null {
  const visibleAttachmentIds = useMemo(() => attachmentIds.slice(0, 3), [attachmentIds]);
  const [previewUrls, setPreviewUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    let cancelled = false;
    void Promise.all(visibleAttachmentIds.map(async (attachmentId) => {
      try {
        const preview = await agentClient.readConversationAttachmentPreview({
          attachmentId,
          conversationId,
        });
        return [attachmentId, `data:${preview.mimeType};base64,${preview.data}`] as const;
      } catch {
        return null;
      }
    })).then((previews) => {
      if (cancelled) return;
      setPreviewUrls(Object.fromEntries(previews.filter((preview) => preview !== null)));
    });
    return () => {
      cancelled = true;
    };
  }, [agentClient, conversationId, visibleAttachmentIds]);

  if (attachmentIds.length === 0) return null;
  return (
    <span className="conversation-pending-queue__attachments" aria-label={`${attachmentIds.length} 个附件`}>
      {visibleAttachmentIds.map((attachmentId) => {
        const previewUrl = previewUrls[attachmentId];
        return previewUrl === undefined ? (
          <span className="conversation-pending-queue__attachment-fallback" key={attachmentId}>
            <Paperclip aria-hidden="true" size={13} />
          </span>
        ) : (
          <button
            aria-label="预览待发送图片"
            className="conversation-pending-queue__attachment-preview"
            key={attachmentId}
            type="button"
            onClick={() => requestMediaPreview({
              alt: "待发送图片",
              src: previewUrl,
              title: "待发送图片",
            })}
          >
            <img alt="" src={previewUrl} />
          </button>
        );
      })}
      {attachmentIds.length > visibleAttachmentIds.length ? (
        <small>+{attachmentIds.length - visibleAttachmentIds.length}</small>
      ) : null}
    </span>
  );
}

function ConversationPendingMessageQueue({
  agentClient,
  actioningMessageId,
  editingMessageId,
  messages,
  onDelete,
  onEdit,
  onReorder,
  onPromote,
}: {
  agentClient: AgentClient;
  actioningMessageId: string | null;
  editingMessageId: string | null;
  messages: readonly ConversationPendingMessage[];
  onDelete: (pendingMessageId: string) => Promise<void>;
  onEdit: (message: ConversationPendingMessage) => void;
  onReorder: (
    pendingMessageIds: readonly string[],
    pendingMessageId: string,
  ) => Promise<void>;
  onPromote: (pendingMessageId: string) => Promise<void>;
}): ReactElement {
  const [draggedMessageId, setDraggedMessageId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{
    id: string;
    position: "after" | "before";
  } | null>(null);

  function finishDrag(): void {
    setDraggedMessageId(null);
    setDropIndicator(null);
  }

  return (
    <section className="conversation-pending-queue" aria-label="待发送消息">
      <header>
        <ListEnd aria-hidden="true" size={14} />
        <strong>待发送</strong>
        <span>{messages.length}</span>
      </header>
      <div className="conversation-pending-queue__items">
        {messages.map((message) => {
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
              data-dragging={String(draggedMessageId === message.id)}
              data-delivery-mode={message.deliveryMode}
              data-editing={String(isEditing)}
              data-drop-position={dropIndicator?.id === message.id
                ? dropIndicator.position
                : undefined}
              draggable={actioningMessageId === null}
              key={message.id}
              onDragEnd={finishDrag}
              onDragOver={(event) => {
                if (draggedMessageId === null || draggedMessageId === message.id) {
                  setDropIndicator(null);
                  return;
                }
                event.preventDefault();
                event.dataTransfer.dropEffect = "move";
                const bounds = event.currentTarget.getBoundingClientRect();
                setDropIndicator({
                  id: message.id,
                  position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
                });
              }}
              onDragStart={(event) => {
                if (
                  actioningMessageId !== null
                  || (event.target as Element).closest(
                    ".conversation-pending-queue__drag-handle",
                  ) === null
                ) {
                  event.preventDefault();
                  return;
                }
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", message.id);
                setPendingMessageDragPreview(event, event.currentTarget);
                setDraggedMessageId(message.id);
                setDropIndicator(null);
              }}
              onDrop={(event) => {
                event.preventDefault();
                if (draggedMessageId === null || dropIndicator === null) {
                  finishDrag();
                  return;
                }
                const reordered = reorderPendingMessageIds(
                  messages.map((current) => current.id),
                  draggedMessageId,
                  message.id,
                  dropIndicator.position,
                );
                const sourceId = draggedMessageId;
                finishDrag();
                void onReorder(reordered, sourceId);
              }}
            >
              <span
                aria-label="拖拽调整顺序"
                className="conversation-pending-queue__drag-handle"
                title="拖拽调整顺序"
              >
                <GripVertical aria-hidden="true" size={14} />
              </span>
              <span className="conversation-pending-queue__identity">
                <PendingMessageAttachmentPreviews
                  agentClient={agentClient}
                  attachmentIds={message.attachmentIds}
                  conversationId={message.conversationId}
                />
                <span className="conversation-pending-queue__content" title={message.content || fallback}>
                  {message.content || fallback}
                </span>
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
                {isApproving ? "提交中" : "允许一次"}
              </button>
              {isExternalRead ? null : (
                <button
                  className="inline-flex min-h-7 items-center gap-1 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-transparent px-2 text-[var(--app-foreground)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isApproving}
                  title="仅允许该 Subagent 对话后续完全相同的命令或同一工具与路径"
                  type="button"
                  onClick={() => void onChangeApproval(approval.tool, true, "session")}
                >
                  <Check aria-hidden="true" size={13} />
                  本 Subagent 允许相同操作
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

export function projectSubagentMessagesForParentTimeline(
  timeline: ConversationTimelineItem[],
  subagentConversationIds: ReadonlySet<string>,
): ConversationTimelineItem[] {
  let removeReceiptDividerFromNextAssistant = false;
  const projected: ConversationTimelineItem[] = [];

  for (const item of timeline) {
    if (
      item.kind === "agent_message"
      && subagentConversationIds.has(item.senderConversationId)
    ) {
      removeReceiptDividerFromNextAssistant = true;
      continue;
    }
    if (item.kind === "message" && item.role === "user") {
      removeReceiptDividerFromNextAssistant = false;
    }
    if (
      removeReceiptDividerFromNextAssistant
      && item.kind === "message"
      && item.role === "assistant"
    ) {
      removeReceiptDividerFromNextAssistant = false;
      projected.push({
        ...item,
        content: item.content
          .replace(/(?:^|\r?\n)[ \t]*---[ \t]*(?=\r?\n|$)/u, "")
          .replace(/(?:\r?\n){3,}/gu, "\n\n"),
      });
      continue;
    }
    projected.push(item);
  }

  return projected;
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

export function groupRunActivities(
  timeline: ConversationTimelineItem[],
): TimelineDisplayItem[] {
  const lastRunItemIndex = new Map<string, number>();
  for (const [index, item] of timeline.entries()) {
    if (item.runId !== null) lastRunItemIndex.set(item.runId, index);
  }

  const activities = new Map<string, RunActivityTimelineItem & { firstIndex: number }>();
  const activityFor = (
    runId: string,
    index: number,
  ): RunActivityTimelineItem & { firstIndex: number } => {
    const existing = activities.get(runId);
    if (existing !== undefined) return existing;
    const created: RunActivityTimelineItem & { firstIndex: number } = {
      durationMs: null,
      firstIndex: index,
      id: `run-activity:${runId}`,
      items: [],
      kind: "run_activity",
      runId,
      runIds: [runId],
    };
    activities.set(runId, created);
    return created;
  };

  for (const [index, item] of timeline.entries()) {
    if (item.runId === null) continue;
    if (item.kind === "model_retry") {
      const activity = activityFor(item.runId, index);
      activity.items.push(item);
      if (item.durationMs != null) activity.durationMs = item.durationMs;
      continue;
    }
    if (item.kind === "tool") {
      if (item.name === "compact_context") continue;
      activityFor(item.runId, index).items.push(item);
      continue;
    }
    if (item.kind !== "message" || item.role !== "assistant") continue;

    const reasoningContent = item.reasoningContent?.trim();
    const visibleContent = stripLeadingThinkingSummary(item.content);
    const isIntermediate = index < (lastRunItemIndex.get(item.runId) ?? index);
    const hasReasoning = reasoningContent !== undefined
      && reasoningContent.length > 0
      && (item.modelId === null || !isGpt56ReasoningModel(item.modelId));
    const hasProgress = isIntermediate && visibleContent.trim().length > 0;
    const existingActivity = activities.get(item.runId);
    if (!hasReasoning && !hasProgress && existingActivity === undefined) continue;

    const activity = existingActivity ?? activityFor(item.runId, index);
    if (item.durationMs != null) activity.durationMs = item.durationMs;
    if (hasReasoning) {
      activity.items.push({
        content: item.reasoningContent ?? "",
        id: `${item.id}:reasoning`,
        kind: "activity_reasoning",
        streaming: item.status === "streaming",
      });
    }
    if (hasProgress) {
      activity.items.push({
        content: visibleContent,
        id: `${item.id}:progress`,
        kind: "activity_progress",
        streaming: item.status === "streaming",
      });
    }
  }

  const projected: TimelineDisplayItem[] = [];
  for (const [index, item] of timeline.entries()) {
    if (item.kind === "tool" && item.name === "compact_context") {
      projected.push(item);
      continue;
    }
    const activity = item.runId === null ? undefined : activities.get(item.runId);
    if (activity?.firstIndex === index) {
      projected.push({
        durationMs: activity.durationMs,
        id: activity.id,
        items: activity.items,
        kind: activity.kind,
        runId: activity.runId,
        runIds: activity.runIds,
      });
    }
    if (activity === undefined) {
      const visibleContent = item.kind === "message" && item.role === "assistant"
        ? stripLeadingThinkingSummary(item.content)
        : null;
      const isLegacyGptSummary = item.kind === "message"
        && item.role === "assistant"
        && item.modelId !== null
        && isGpt56ReasoningModel(item.modelId)
        && item.reasoningContent !== undefined;
      if (
        visibleContent !== null
        && visibleContent.length === 0
        && item.kind === "message"
        && item.attachments.length === 0
        && item.status !== "failed"
      ) {
        continue;
      }
      projected.push(item.kind === "message" && visibleContent !== null
        ? {
            ...item,
            content: visibleContent,
            ...(isLegacyGptSummary ? { reasoningContent: undefined } : {}),
          }
        : item);
      continue;
    }
    if (item.kind === "tool" || item.kind === "model_retry") continue;
    if (item.kind !== "message" || item.role !== "assistant") {
      projected.push(item);
      continue;
    }

    const isIntermediate = index < (lastRunItemIndex.get(item.runId ?? "") ?? index);
    if (isIntermediate) {
      if (item.attachments.length > 0) {
        projected.push({
          ...item,
          content: "",
          durationMs: null,
          reasoningContent: undefined,
        });
      }
      continue;
    }
    const visibleContent = stripLeadingThinkingSummary(item.content);
    if (visibleContent.length === 0 && item.attachments.length === 0 && item.status !== "failed") {
      continue;
    }
    projected.push({
      ...item,
      content: visibleContent,
      durationMs: null,
      reasoningContent: undefined,
    });
  }

  return combineAutomaticContinuationDurations(projected);
}

function combineAutomaticContinuationDurations(
  timeline: TimelineDisplayItem[],
): TimelineDisplayItem[] {
  const combined = [...timeline];
  const mergedActivityIndexes = new Set<number>();
  let turnStartIndex = 0;

  const combineTurn = (turnEndIndex: number): void => {
    const activityIndexes: number[] = [];
    for (let index = turnStartIndex; index < turnEndIndex; index += 1) {
      if (combined[index]?.kind === "run_activity") activityIndexes.push(index);
    }
    const firstActivityIndex = activityIndexes[0];
    if (firstActivityIndex === undefined) return;

    const completedRunIds = new Set<string>();
    let combinedDurationMs = 0;
    let hasDuration = false;
    for (let index = turnStartIndex; index < turnEndIndex; index += 1) {
      const item = combined[index];
      if (item === undefined) continue;
      const isCompletedAssistant = item.kind === "message" && item.role === "assistant";
      const isTerminalRetry = item.kind === "model_retry" && item.status !== "retrying";
      if (
        item.kind !== "run_activity"
        && !isCompletedAssistant
        && !isTerminalRetry
      ) continue;
      if (item.durationMs == null) continue;
      const runId = item.runId ?? `legacy-turn:${turnStartIndex}`;
      if (completedRunIds.has(runId)) continue;
      completedRunIds.add(runId);
      combinedDurationMs += item.durationMs;
      hasDuration = true;
    }
    for (let index = turnStartIndex; index < turnEndIndex; index += 1) {
      const item = combined[index];
      if (item === undefined) continue;
      if (item.kind === "run_activity") {
        combined[index] = {
          ...item,
          durationMs: hasDuration && index === firstActivityIndex
            ? combinedDurationMs
            : null,
        };
        continue;
      }
      const isCompletedAssistant = item.kind === "message" && item.role === "assistant";
      const isTerminalRetry = item.kind === "model_retry" && item.status !== "retrying";
      if ((isCompletedAssistant || isTerminalRetry) && item.durationMs != null) {
        combined[index] = { ...item, durationMs: null };
      }
    }

    if (activityIndexes.length < 2) return;
    const firstActivity = combined[firstActivityIndex];
    if (firstActivity?.kind !== "run_activity") return;
    combined[firstActivityIndex] = {
      ...firstActivity,
      items: activityIndexes.flatMap((index) => {
        const activity = combined[index];
        return activity?.kind === "run_activity" ? activity.items : [];
      }),
      runIds: activityIndexes.flatMap((index) => {
        const activity = combined[index];
        return activity?.kind === "run_activity" ? activity.runIds : [];
      }),
    };
    for (const index of activityIndexes.slice(1)) mergedActivityIndexes.add(index);
  };

  for (const [index, item] of combined.entries()) {
    const startsVisibleTurn = (item.kind === "message" && item.role === "user")
      || (item.kind === "agent_message" && item.messageType !== "task_result");
    if (!startsVisibleTurn) continue;
    combineTurn(index);
    turnStartIndex = index + 1;
  }
  combineTurn(combined.length);

  return combined.filter((_, index) => !mergedActivityIndexes.has(index));
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

export function projectTimelineForActiveRun(
  timeline: ConversationTimelineItem[],
  activeRunId: string | null,
  showToolActivity: boolean,
): ConversationTimelineItem[] {
  if (activeRunId === null) return timeline;

  const currentRunTools = timeline.filter((item): item is ConversationToolItem =>
    item.kind === "tool" && item.runId === activeRunId
  );
  if (currentRunTools.length === 0) return timeline;

  const visibleTools = showToolActivity
    ? currentRunTools.filter((tool) =>
        tool.status === "running" || tool.status === "awaiting_approval"
      )
    : [];
  if (showToolActivity && visibleTools.length === 0) {
    const latestTool = currentRunTools.at(-1);
    if (latestTool !== undefined) visibleTools.push(latestTool);
  }
  const visibleToolIds = new Set(visibleTools.map((tool) => tool.id));

  return timeline.filter((item) =>
    item.kind !== "tool"
    || item.runId !== activeRunId
    || visibleToolIds.has(item.id)
  );
}

export function getLatestActiveToolId(
  timeline: readonly {
    id: string;
    kind: string;
    status?: string | undefined;
  }[],
): string | null {
  const latestTool = timeline.findLast((item) => item.kind === "tool");
  return latestTool?.status === "running" || latestTool?.status === "awaiting_approval"
    ? latestTool.id
    : null;
}

export function stripLeadingThinkingSummary(content: string): string {
  const match = /^\s*<(think|thinking)>([\s\S]*?)<\/\1>\s*/iu.exec(content);
  if (match?.[2] === undefined) return content;
  return content.slice(match[0].length).trimStart();
}

export function getConversationRunDurationInsertIndexes(
  timeline: readonly {
    durationMs?: number | null | undefined;
    kind: string;
    messageType?: string | undefined;
    role?: string | undefined;
    runId?: string | null | undefined;
    status?: string | undefined;
  }[],
): ReadonlyMap<number, readonly number[]> {
  const durationsByInsertIndex = new Map<number, number[]>();
  const completedRunIds = new Set<string>();
  let runStartIndex = 0;

  for (const [index, item] of timeline.entries()) {
    if (
      (item.kind === "agent_message" && item.messageType !== "task_result")
      || (item.kind === "message" && item.role === "user")
    ) {
      runStartIndex = index + 1;
      continue;
    }
    const isCompletedAssistant = item.kind === "message" && item.role === "assistant";
    const isTerminalRetry = item.kind === "model_retry" && item.status !== "retrying";
    if ((!isCompletedAssistant && !isTerminalRetry) || item.durationMs == null) continue;
    const runId = item.runId ?? `legacy-turn:${runStartIndex}`;
    if (completedRunIds.has(runId)) continue;
    completedRunIds.add(runId);
    const currentDuration = durationsByInsertIndex.get(runStartIndex)?.[0] ?? 0;
    durationsByInsertIndex.set(runStartIndex, [currentDuration + item.durationMs]);
  }

  return durationsByInsertIndex;
}

export function getRepeatedAssistantFailureMessageIds(
  timeline: readonly {
    content?: string | undefined;
    id: string;
    kind: string;
    role?: string | undefined;
    runId?: string | null | undefined;
    status?: string | undefined;
  }[],
): ReadonlySet<string> {
  const repeatedIds = new Set<string>();

  for (let index = 1; index < timeline.length; index += 1) {
    const previous = timeline[index - 1];
    const current = timeline[index];
    if (
      previous?.kind === "message"
      && previous.role === "assistant"
      && previous.status === "failed"
      && typeof previous.runId === "string"
      && current?.kind === "message"
      && current.role === "assistant"
      && current.status === "failed"
      && typeof current.runId === "string"
      && current.runId !== previous.runId
      && current.content?.trim() === previous.content?.trim()
    ) {
      repeatedIds.add(current.id);
    }
  }

  return repeatedIds;
}

export function getConversationRunProgressInsertIndex(
  timeline: readonly {
    id: string;
    items?: readonly { id: string }[] | undefined;
    kind: string;
    role?: string | undefined;
    tools?: readonly { id: string }[] | undefined;
  }[],
  anchorTimelineItemId: string | null,
): number {
  const anchorIndex = anchorTimelineItemId === null
    ? -1
    : timeline.findIndex((item) =>
      item.id === anchorTimelineItemId
      || item.items?.some((entry) => entry.id === anchorTimelineItemId) === true
      || item.tools?.some((tool) => tool.id === anchorTimelineItemId) === true,
    );
  const searchStartIndex = anchorIndex < 0 ? timeline.length - 1 : anchorIndex;

  for (let index = searchStartIndex; index >= 0; index -= 1) {
    const item = timeline[index];
    if (item?.kind === "message" && item.role === "user") return index + 1;
  }

  return 0;
}

export function getModelActivityInsertIndex(
  timeline: readonly {
    id: string;
    items?: readonly {
      id: string;
      kind: string;
      runId?: string | null | undefined;
    }[] | undefined;
    kind: string;
    role?: string | undefined;
    runId?: string | null | undefined;
  }[],
  runId: string | null,
  fallbackAnchorTimelineItemId: string | null,
): number {
  if (runId !== null) {
    const latestRetryIndex = timeline.findLastIndex((item) =>
      (item.kind === "model_retry" && item.runId === runId)
      || item.items?.some((entry) =>
        entry.kind === "model_retry" && entry.runId === runId
      ) === true
    );
    if (latestRetryIndex >= 0) {
      return timeline[latestRetryIndex]?.kind === "model_retry"
        ? latestRetryIndex + 1
        : latestRetryIndex;
    }
  }

  return getConversationRunProgressInsertIndex(timeline, fallbackAnchorTimelineItemId);
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

function ReasoningDisclosure({
  children,
  streaming,
}: {
  children: ReactNode;
  streaming: boolean;
}): ReactElement {
  const contentId = useId();
  const [isExpanded, setIsExpanded] = useState(streaming);

  return (
    <section className="my-[5px] min-w-0">
      <button
        aria-controls={contentId}
        aria-expanded={isExpanded}
        className="inline-flex min-h-[29px] max-w-full min-w-0 items-center gap-[6px] border-0 bg-transparent px-0 py-[2px] text-left text-[length:var(--app-font-size-control)] font-medium text-[var(--app-muted-foreground)] hover:text-[var(--app-foreground)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1"
        title={isExpanded ? "收起思考过程" : "展开思考过程"}
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <BrainCircuit aria-hidden="true" className="shrink-0" size={14} />
        <span className="min-w-0 flex-[0_1_auto] truncate">
          {streaming ? "正在思考" : "思考过程"}
        </span>
        {streaming ? (
          <span className="shrink-0 text-[length:var(--app-font-size-auxiliary)]">实时</span>
        ) : null}
        <Eye aria-hidden="true" className="shrink-0" size={15} />
        <ChevronRight
          aria-hidden="true"
          className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          size={15}
        />
      </button>
      {isExpanded ? (
        <div
          className="ml-5 flex min-w-0 flex-col gap-[5px] py-[5px] text-[length:var(--app-font-size-body)]"
          id={contentId}
        >
          {children}
        </div>
      ) : null}
    </section>
  );
}

function AssistantReasoningBlock({
  content,
  streaming,
}: {
  content: string;
  streaming: boolean;
}): ReactElement {
  return (
    <ReasoningDisclosure streaming={streaming}>
      <AgentMarkdown content={content} />
    </ReasoningDisclosure>
  );
}

export function modelRetryStatusLabel(
  retry: Pick<ConversationModelRetryItem, "attempt" | "maxAttempts" | "retryInMs" | "status">,
  remainingRetryInMs: number | null = retry.retryInMs,
): string {
  if (retry.status === "completed") return `连接已恢复 · 重试 ${retry.attempt} 次`;
  if (retry.status === "failed") {
    return `重新连接失败 · 已重试 ${retry.attempt}/${retry.maxAttempts}`;
  }
  if (remainingRetryInMs !== null && remainingRetryInMs <= 0) {
    return `正在重新连接 ${retry.attempt}/${retry.maxAttempts} · 即将重试`;
  }
  const retrySeconds = Math.ceil((remainingRetryInMs ?? 1_000) / 1_000);
  return `正在重新连接 ${retry.attempt}/${retry.maxAttempts} · ${retrySeconds} 秒后重试`;
}

function ModelRetryTimelineItem({ item }: { item: ConversationModelRetryItem }): ReactElement {
  const contentId = useId();
  const [isExpanded, setIsExpanded] = useState(false);
  const [countdownNowMs, setCountdownNowMs] = useState(() => Date.now());
  useEffect(() => {
    if (item.status !== "retrying" || item.retryInMs === null) return undefined;
    const intervalId = window.setInterval(() => setCountdownNowMs(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [item.retryInMs, item.status, item.updatedAt]);
  const retryUpdatedAtMs = Date.parse(item.updatedAt);
  const remainingRetryInMs = item.status === "retrying" && item.retryInMs !== null
    ? Number.isNaN(retryUpdatedAtMs)
      ? item.retryInMs
      : Math.max(0, Math.min(item.retryInMs, retryUpdatedAtMs + item.retryInMs - countdownNowMs))
    : item.retryInMs;
  const label = modelRetryStatusLabel(item, remainingRetryInMs);
  const statusClassName = item.status === "failed"
    ? "text-[var(--app-status-danger-fg)]"
    : item.status === "completed"
      ? "text-[var(--app-status-success-fg)]"
      : "text-[var(--app-status-info-fg)]";
  const detailsLabel = isExpanded ? "收起重试详情" : "展开重试详情";

  return (
    <section
      aria-live={item.status === "retrying" ? "polite" : undefined}
      className="w-full max-w-[var(--conversation-content-max-width)] shrink-0 self-center text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]"
      data-status={item.status}
    >
      <div className="flex min-h-[30px] min-w-0 items-center gap-[7px] py-0.5">
        <RefreshCw
          aria-hidden="true"
          className={`shrink-0 ${statusClassName} ${item.status === "retrying" ? "animate-spin" : ""}`}
          size={15}
        />
        <button
          aria-controls={contentId}
          aria-expanded={isExpanded}
          aria-label={`${detailsLabel}：${label}`}
          className="inline-flex min-w-0 flex-[0_1_auto] cursor-pointer items-center overflow-hidden border-0 bg-transparent p-0 text-left text-[var(--app-muted-foreground)] transition-colors hover:text-[var(--app-foreground)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1 [font:inherit]"
          title={detailsLabel}
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
        >
          <span className="min-w-0 truncate">
            模型请求重试 · <span className={`font-medium ${statusClassName}`}>{label}</span>
          </span>
        </button>
        <button
          aria-controls={contentId}
          aria-expanded={isExpanded}
          aria-label={detailsLabel}
          className="grid size-[21px] shrink-0 place-items-center rounded-[var(--app-radius)] border-0 bg-transparent p-0 text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] hover:text-[var(--app-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-[-1px]"
          title={detailsLabel}
          type="button"
          onClick={() => setIsExpanded((current) => !current)}
        >
          <ChevronRight
            aria-hidden="true"
            className={`transition-transform ${isExpanded ? "rotate-90" : ""}`}
            size={15}
          />
        </button>
      </div>
      {isExpanded ? (
        <div
          className="ml-[7px] border-l border-[var(--app-border)] pl-[22px]"
          id={contentId}
        >
          <p className="m-0 py-1.5 text-[length:var(--app-font-size-body)] leading-5 text-[var(--app-foreground)]">
            {stripLegacyErrorInstanceId(item.reason)}
          </p>
        </div>
      ) : null}
    </section>
  );
}

function TimelineItem({
  agentClient,
  item,
  agentAvatar,
  agentAvatarSeed,
  teamManaged,
  activeRunId,
  latestActiveToolId,
  modelActivity,
  runProgress,
  approvalErrors,
  approvingToolId,
  canCopyMessage,
  canForceContextCompaction,
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
  onForceContextCompaction,
  onOpenProjectFile,
  onSessionSelected,
  liveToolOutputs,
}: {
  agentClient: AgentClient;
  item: TimelineDisplayItem;
  agentAvatar: AgentProfile["avatar"] | null;
  agentAvatarSeed: string | null;
  teamManaged: boolean;
  activeRunId: string | null;
  latestActiveToolId: string | null;
  modelActivity: ModelActivity | null;
  runProgress: RunProgress | null;
  approvalErrors: Readonly<Record<string, string>>;
  approvingToolId: string | null;
  canCopyMessage: boolean;
  canForceContextCompaction: boolean;
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
  onForceContextCompaction: () => Promise<void>;
  onOpenProjectFile: ((path: string) => void) | undefined;
  onSessionSelected: ((sessionId: string) => void) | undefined;
  liveToolOutputs: Readonly<Record<string, LiveToolOutput>>;
}): ReactElement | null {
  if (item.kind === "model_retry") {
    return <ModelRetryTimelineItem item={item} />;
  }

  if (item.kind === "run_activity") {
    return (
      <RunActivityTimelineItem
        agentClient={agentClient}
        key={`${item.id}:${String(activeRunId !== null && item.runIds.includes(activeRunId))}`}
        item={item}
        teamManaged={teamManaged}
        activeRunId={activeRunId}
        latestActiveToolId={latestActiveToolId}
        modelActivity={modelActivity}
        runProgress={runProgress}
        approvalErrors={approvalErrors}
        approvingToolId={approvingToolId}
        onOpenProjectFile={onOpenProjectFile}
        onChangeApproval={onChangeApproval}
        liveToolOutputs={liveToolOutputs}
      />
    );
  }

  if (item.kind === "tool_batch") {
    const hasFailure = item.tools.some((tool) =>
      toolItemHasFailure(tool) || approvalErrors[tool.id] !== undefined
    );
    return (
      <ToolBatchTimelineItem
        agentClient={agentClient}
        key={`${item.id}:${String(hasFailure)}:${latestActiveToolId ?? "idle"}`}
        item={item}
        teamManaged={teamManaged}
        activeRunId={activeRunId}
        latestActiveToolId={latestActiveToolId}
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
    if (item.name === "compact_context") {
      return (
        <ContextCompactionTimelineItem
          canForce={canForceContextCompaction}
          item={item}
          onForce={onForceContextCompaction}
        />
      );
    }
    return (
      <ToolTimelineItem
        agentClient={agentClient}
        key={`${item.id}:${approvalErrors[item.id] === undefined ? String(toolItemHasFailure(item)) : "approval_failed"}:${latestActiveToolId ?? "idle"}`}
        item={item}
        teamManaged={teamManaged}
        latestActiveToolId={latestActiveToolId}
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
      <div
        className="chat-message-group flex w-full max-w-[var(--conversation-content-max-width)] flex-col items-end gap-[5px] self-center"
        data-role="user"
      >
        <button
          aria-label={`打开来源对话 ${item.senderTitle}`}
          className="inline-flex min-w-0 max-w-full items-center gap-[6px] rounded-[var(--app-radius)] px-[2px] py-[1px] text-[length:var(--app-font-size-control)] font-semibold text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] hover:text-[var(--app-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1"
          title={`打开来源对话：${item.senderTitle}`}
          type="button"
          onClick={() => onSessionSelected?.(item.senderConversationId)}
        >
          {agentAvatar !== null ? (
            <AgentAvatar avatar={agentAvatar} size="compact" />
          ) : agentAvatarSeed !== null ? (
            <SubagentAvatar icon={null} seed={agentAvatarSeed} size="compact" />
          ) : (
            <Bot aria-hidden="true" className="shrink-0" size={15} />
          )}
          <span className="min-w-0 truncate">
            {item.senderTitle}
          </span>
        </button>
        <article
          className="chat-message"
          data-role="user"
          data-status={item.status}
        >
          <p>{item.content}</p>
        </article>
      </div>
    );
  }

  const copied = copiedMessageId === item.id;
  const editing = editingMessageId === item.id;
  const isForking = forkingMessageId === item.id;
  const renderedReasoningContent = item.reasoningContent?.trim() ?? "";
  const renderedMessageContent = item.role === "assistant"
    ? stripLeadingThinkingSummary(item.content)
    : item.content;
  const canEdit = item.role === "user" && item.id === latestUserMessageId;
  const showMessageMeta = item.role === "user"
    || canShowCompletionTime
    || canCopyMessage
    || canForkMessage
    || canEdit;
  const hasMessageBody = item.role === "assistant"
    || renderedMessageContent.length > 0
    || item.attachments.length > 0;
  const messageAttachments = item.attachments.length > 0 ? (
    <AttachmentStrip variant="message">
      {item.attachments.map((attachment) => (
        <AttachmentChip
          agentClient={agentClient}
          key={attachment.id}
          attachment={attachment}
        />
      ))}
    </AttachmentStrip>
  ) : null;

  return (
    <div className="chat-message-group" data-role={item.role}>
      {item.role === "user" ? messageAttachments : null}
      {hasMessageBody ? (
        <article className="chat-message" data-role={item.role} data-status={item.status}>
          {item.role === "assistant" && item.status === "failed" ? (
            <ConversationErrorContent content={item.content} />
          ) : item.role === "assistant" ? (
            <>
              {renderedReasoningContent.length > 0 ? (
                <AssistantReasoningBlock
                  content={renderedReasoningContent}
                  key={item.status}
                  streaming={item.status === "streaming"}
                />
              ) : null}
              {renderedMessageContent.length > 0
                ? <AgentMarkdown content={renderedMessageContent} />
                : null}
            </>
          ) : (
            renderedMessageContent.length > 0 ? <p>{renderedMessageContent}</p> : null
          )}
        </article>
      ) : null}
      {item.role === "assistant" ? messageAttachments : null}
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
            variant={editing ? "selected" : "quiet"}
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
  agentClient,
  attachment,
  isRemoving = false,
  onRemove,
  previewUrl,
}: {
  agentClient: AgentClient;
  attachment: ConversationAttachment;
  isRemoving?: boolean;
  onRemove?: () => void;
  previewUrl?: string;
}): ReactElement {
  const [storedPreviewUrl, setStoredPreviewUrl] = useState<string | null>(null);
  const sourceLabel = attachment.projectPath ?? "上传文件";
  const isDraft = onRemove !== undefined;
  useEffect(() => {
    if (attachment.kind !== "image" || previewUrl !== undefined) return;
    let cancelled = false;
    void agentClient.readConversationAttachmentPreview({
      attachmentId: attachment.id,
      conversationId: attachment.conversationId,
    }).then((preview) => {
      if (!cancelled) {
        setStoredPreviewUrl(`data:${preview.mimeType};base64,${preview.data}`);
      }
    }).catch(() => {
      if (!cancelled) setStoredPreviewUrl(null);
    });
    return () => {
      cancelled = true;
    };
  }, [agentClient, attachment.conversationId, attachment.id, attachment.kind, previewUrl]);
  const resolvedPreviewUrl = previewUrl ?? storedPreviewUrl ?? undefined;
  const showsImagePreview = attachment.kind === "image" && resolvedPreviewUrl !== undefined;
  return (
    <span
      className={[
        "conversation-attachment",
        isDraft ? "conversation-attachment--draft" : "",
        showsImagePreview
          ? "conversation-attachment--image-preview"
          : "conversation-attachment--file-card",
      ].filter(Boolean).join(" ")}
      title={`${attachment.name} · ${sourceLabel} · ${formatFileSize(attachment.sizeBytes)}`}
    >
      {showsImagePreview ? (
        <button
          aria-label={`预览图片 ${attachment.name}`}
          className="conversation-attachment__image-button"
          type="button"
          onClick={() => requestMediaPreview({
            alt: attachment.name,
            src: resolvedPreviewUrl,
            title: attachment.name,
          })}
        >
          <img alt={attachment.name} src={resolvedPreviewUrl} />
        </button>
      ) : (
        <>
          <span className="conversation-attachment__file-icon">
            <FileTypeIcon path={attachment.name} size={28} />
          </span>
          <span className="conversation-attachment__identity">
            <strong>{attachment.name}</strong>
            <small>
              {attachmentTypeLabel(attachment)} · {formatFileSize(attachment.sizeBytes)}
              {!isDraft && attachment.truncated ? " · 已按预览注入" : ""}
            </small>
          </span>
        </>
      )}
      {onRemove === undefined ? null : (
        <button
          aria-label={`移除附件 ${attachment.name}`}
          className="conversation-attachment__remove-button"
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

function AttachmentStrip({
  children,
  variant,
}: {
  children: ReactNode;
  variant: "draft" | "message";
}): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (container === null) return;
    const handleWheel = (event: WheelEvent): void => {
      handleHorizontalAttachmentWheel(container, event);
    };
    container.addEventListener("wheel", handleWheel, { passive: false });
    return () => container.removeEventListener("wheel", handleWheel);
  }, []);
  return (
    <div
      ref={containerRef}
      className={`conversation-attachments conversation-attachments--${variant}`}
    >
      {children}
    </div>
  );
}

function handleHorizontalAttachmentWheel(
  container: HTMLDivElement,
  event: WheelEvent,
): void {
  if (container.scrollWidth <= container.clientWidth) return;
  const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
    ? event.deltaX
    : event.deltaY;
  if (delta === 0) return;
  event.preventDefault();
  container.scrollLeft += delta;
}

function mergeConversationAttachments(
  current: readonly ConversationAttachment[],
  additions: readonly ConversationAttachment[],
): ConversationAttachment[] {
  const seen = new Set(current.map((attachment) => attachment.id));
  return [
    ...current,
    ...additions.filter((attachment) => {
      if (seen.has(attachment.id)) return false;
      seen.add(attachment.id);
      return true;
    }),
  ];
}

function attachmentTypeLabel(attachment: ConversationAttachment): string {
  const extensionMatch = /\.([^.]+)$/u.exec(attachment.name.trim());
  if (extensionMatch?.[1] !== undefined && extensionMatch[1].length <= 12) {
    return extensionMatch[1].toLocaleUpperCase();
  }
  const mimeSubtype = attachment.mimeType.split("/").at(-1)?.split("+")[0]?.trim();
  return mimeSubtype === undefined || mimeSubtype.length === 0
    ? "FILE"
    : mimeSubtype.toLocaleUpperCase();
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
  | "limit"
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
  message: string;
  summary: string;
  technicalDetail: string | null;
  title: string;
};

function splitConversationErrorDetail(detail: string): {
  message: string;
  technicalDetail: string | null;
} {
  const marker = /(?:接口错误|网络错误详情|内部错误详情)：/u.exec(detail);
  if (marker?.index === undefined) {
    return { message: detail, technicalDetail: null };
  }
  return {
    message: detail.slice(0, marker.index).trim(),
    technicalDetail: detail.slice(marker.index).trim() || null,
  };
}

export function describeConversationError(
  content: string,
  scope: ConversationErrorScope = "model",
): ConversationErrorPresentation {
  const detail = stripLegacyErrorInstanceId(content);
  const normalized = detail.toLowerCase();
  const separated = splitConversationErrorDetail(detail);
  if (scope === "tool") {
    return {
      category: "tool",
      detail: detail || "工具调用没有返回可显示的错误详情。",
      message: detail || "工具调用没有返回可显示的错误详情。",
      summary: summarizeErrorDetail(detail, "工具执行未完成"),
      technicalDetail: null,
      title: "工具调用失败",
    };
  }
  if (scope === "operation") {
    return {
      category: "internal",
      detail: detail || "操作没有返回可显示的错误详情。",
      message: detail || "操作没有返回可显示的错误详情。",
      summary: summarizeErrorDetail(detail, "操作未完成"),
      technicalDetail: null,
      title: "操作失败",
    };
  }

  if (/GraphRecursionError|GRAPH_RECURSION_LIMIT|Recursion limit of \d+ reached/iu.test(detail)) {
    const message = "本轮执行达到安全上限，已停止继续运行。请缩小任务范围或补充停止条件后再试。";
    return {
      category: "limit",
      detail: detail || message,
      message,
      summary: "执行达到安全上限",
      technicalDetail: detail.length > 0 ? detail : null,
      title: "执行达到安全上限",
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
  const labels: Record<Exclude<ConversationErrorCategory, "limit" | "tool" | "unknown">, string> = {
    authentication: "模型认证失败",
    internal: "软件内部错误",
    network: "网络连接失败",
    provider: "模型服务返回错误",
    quota: "模型额度或频率受限",
    response: "模型响应无法处理",
    timeout: "模型请求超时",
  };
  const title = category === "unknown" ? "模型请求未完成" : labels[category];
  const isInternal = category === "internal";
  const message = isInternal
    ? "软件内部发生错误，请稍后重试。如果持续出现，请重新启动软件。"
    : separated.message || title;
  const technicalDetail = isInternal
    ? separated.technicalDetail ?? (detail.length > 0 && detail !== message ? detail : null)
    : separated.technicalDetail;

  return {
    category,
    detail: detail || "模型请求没有返回可显示的错误详情。",
    message,
    summary: category === "unknown" ? summarizeErrorDetail(detail, "模型请求未完成") : title,
    technicalDetail,
    title,
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
      className="conversation-error-quote"
      data-category={presentation.category}
      data-scope={scope}
      role="alert"
    >
      <CircleAlert aria-hidden="true" className="conversation-error-quote__icon" size={16} />
      <div className="conversation-error-quote__body">
        <strong className="conversation-error-quote__heading">{presentation.title}</strong>
        <p className="conversation-error-quote__message">{presentation.message}</p>
        {presentation.technicalDetail === null ? null : (
          <details className="conversation-error-quote__technical">
            <summary>
              <ChevronRight aria-hidden="true" size={14} />
              查看技术详情
            </summary>
            <pre>{presentation.technicalDetail}</pre>
          </details>
        )}
      </div>
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

type RunActivityDisplayItem =
  | ConversationModelRetryItem
  | ConversationToolItem
  | RunActivityTextItem
  | ToolBatchTimelineItem;

function groupRunActivityItems(
  items: RunActivityItem[],
): RunActivityDisplayItem[] {
  const grouped: RunActivityDisplayItem[] = [];
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

  for (const item of items) {
    if (item.kind === "tool") {
      tools.push(item);
      continue;
    }
    flushTools();
    grouped.push(item);
  }
  flushTools();
  return grouped;
}

function RunActivityTimelineItem({
  agentClient,
  item,
  teamManaged,
  activeRunId,
  latestActiveToolId,
  modelActivity,
  runProgress,
  approvalErrors,
  approvingToolId,
  onOpenProjectFile,
  onChangeApproval,
  liveToolOutputs,
}: {
  agentClient: AgentClient;
  item: RunActivityTimelineItem;
  teamManaged: boolean;
  activeRunId: string | null;
  latestActiveToolId: string | null;
  modelActivity: ModelActivity | null;
  runProgress: RunProgress | null;
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
  const isActive = activeRunId !== null && item.runIds.includes(activeRunId);
  const [isExpanded, setIsExpanded] = useState(isActive);
  const [now, setNow] = useState(() => Date.now());
  const contentId = useId();
  useEffect(() => {
    if (runProgress === null) return;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [runProgress]);
  const durationMs = runProgress === null
    ? item.durationMs
    : (item.durationMs ?? 0) + Math.max(0, now - runProgress.startedAt);
  const label = durationMs === null
    ? "工作过程"
    : `已处理 ${formatRunDuration(0, durationMs)}`;
  const displayItems = groupRunActivityItems(item.items);
  const hasReasoning = displayItems.some((entry) => entry.kind === "activity_reasoning");
  const reasoningStreaming = displayItems.some((entry) =>
    entry.kind === "activity_reasoning" && entry.streaming
  );
  const hasFailure = item.items.some((entry) =>
    entry.kind === "tool"
    && (toolItemHasFailure(entry) || approvalErrors[entry.id] !== undefined)
  );
  const toggleLabel = isExpanded ? "收起工作过程" : "展开工作过程";
  const activityContent = displayItems.map((entry) => {
    if (entry.kind === "model_retry") {
      return <ModelRetryTimelineItem item={entry} key={entry.id} />;
    }
    if (entry.kind === "activity_reasoning") {
      return (
        <div
          className="min-w-0 py-[5px] text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]"
          key={entry.id}
        >
          <AgentMarkdown content={entry.content} />
        </div>
      );
    }
    if (entry.kind === "activity_progress") {
      return (
        <div
          className="py-[5px] text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]"
          key={entry.id}
        >
          <AgentMarkdown content={entry.content} />
        </div>
      );
    }
    if (entry.kind === "tool_batch") {
      return (
        <ToolBatchTimelineItem
          agentClient={agentClient}
          activeRunId={activeRunId}
          approvalErrors={approvalErrors}
          approvingToolId={approvingToolId}
          item={entry}
          key={`${entry.id}:${latestActiveToolId ?? "idle"}`}
          latestActiveToolId={latestActiveToolId}
          liveToolOutputs={liveToolOutputs}
          modelActivity={null}
          onChangeApproval={onChangeApproval}
          onOpenProjectFile={onOpenProjectFile}
          teamManaged={teamManaged}
        />
      );
    }
    return (
      <ToolTimelineItem
        agentClient={agentClient}
        approvalActionable={entry.runId === activeRunId}
        approvalError={approvalErrors[entry.id] ?? null}
        isApproving={approvingToolId === entry.id}
        item={entry}
        key={`${entry.id}:${String(toolItemHasFailure(entry))}:${latestActiveToolId ?? "idle"}`}
        latestActiveToolId={latestActiveToolId}
        liveOutput={liveToolOutputs[entry.id]}
        onChangeApproval={onChangeApproval}
        onOpenProjectFile={onOpenProjectFile}
        teamManaged={teamManaged}
        variant="activity"
      />
    );
  });
  const modelActivityContent = modelActivity?.runId !== null
    && modelActivity?.runId !== undefined
    && item.runIds.includes(modelActivity.runId)
    ? <ModelActivityIndicator activity={modelActivity} />
    : null;

  return (
    <section
      className="conversation-run-activity flex w-full min-w-0 flex-col"
      data-status={hasFailure ? "failed" : isActive ? "running" : "completed"}
    >
      <button
        aria-controls={contentId}
        aria-expanded={isExpanded}
        className="flex w-full min-w-0 items-center gap-[5px] border-0 border-b border-solid border-[var(--app-border)] bg-transparent px-0 py-[6px] text-left text-[length:var(--app-font-size-body)] font-normal text-[var(--app-muted-foreground)] hover:text-[var(--app-foreground)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-2"
        title={toggleLabel}
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span>{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          size={15}
        />
      </button>
      {isExpanded ? (
        <div className="flex min-w-0 flex-col gap-[5px] pt-[5px]" id={contentId}>
          {hasReasoning ? (
            <ReasoningDisclosure streaming={reasoningStreaming}>
              {activityContent}
              {modelActivityContent}
            </ReasoningDisclosure>
          ) : (
            <>
              {activityContent}
              {modelActivityContent}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

function ToolBatchTimelineItem({
  agentClient,
  item,
  teamManaged,
  activeRunId,
  latestActiveToolId,
  modelActivity,
  approvalErrors,
  approvingToolId,
  onOpenProjectFile,
  onChangeApproval,
  liveToolOutputs,
}: {
  agentClient: AgentClient;
  item: Extract<TimelineDisplayItem, { kind: "tool_batch" }>;
  teamManaged: boolean;
  activeRunId: string | null;
  latestActiveToolId: string | null;
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
  const shouldAutoExpand = latestActiveToolId !== null
    && item.tools.some((tool) => tool.id === latestActiveToolId);
  const [isExpanded, setIsExpanded] = useState(shouldAutoExpand);
  const hasFailure = item.tools.some((tool) =>
    toolItemHasFailure(tool) || approvalErrors[tool.id] !== undefined
  );
  const label = modelActivity === null
    ? toolBatchLabel(item.tools, teamManaged)
    : modelActivityLabel(modelActivity);
  const toggleLabel = isExpanded ? "收起本轮工具调用" : "展开本轮工具调用";

  return (
    <section className="tool-activity-batch" data-status={hasFailure ? "failed" : undefined}>
      <header className="tool-activity-batch__header">
        <span className="tool-activity-batch__identity">
          <button
            aria-expanded={isExpanded}
            aria-label={`${toggleLabel}：${label}`}
            className="inline-flex min-w-0 flex-[0_1_auto] cursor-pointer items-center gap-[7px] overflow-hidden border-0 bg-transparent p-0 text-left text-[var(--app-muted-foreground)] transition-colors hover:text-[var(--app-foreground)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1 [font:inherit]"
            title={toggleLabel}
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
          >
            <ToolTypeIcon name={representativeToolName(item.tools)} />
            <span>{label}</span>
          </button>
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
              agentClient={agentClient}
              key={`${tool.id}:${approvalErrors[tool.id] === undefined ? String(toolItemHasFailure(tool)) : "approval_failed"}:${latestActiveToolId ?? "idle"}`}
              item={tool}
              teamManaged={teamManaged}
              latestActiveToolId={latestActiveToolId}
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

export function contextCompactionLabel(item: ConversationToolItem): string {
  if (item.status === "running") return "正在压缩上下文";
  if (item.status === "failed") return "上下文压缩失败";
  if (item.status === "cancelled") {
    try {
      const argumentsValue: unknown = JSON.parse(item.arguments);
      if (
        typeof argumentsValue === "object"
        && argumentsValue !== null
        && "trigger" in argumentsValue
        && argumentsValue.trigger === "manual"
      ) return "上下文压缩已暂停";
    } catch {
      // Older or partially written rows keep the generic cancellation label.
    }
    return "上下文压缩已取消";
  }
  return "已压缩";
}

export function isRunningContextCompaction(item: ConversationToolItem): boolean {
  return item.name === "compact_context" && item.status === "running";
}

export function forceableContextCompactionId(
  timeline: readonly ConversationTimelineItem[],
  activeRunId: string | null,
): string | null {
  if (activeRunId !== null) return null;
  const latestUserIndex = timeline.findLastIndex(
    (item) => item.kind === "message" && item.role === "user",
  );
  const latestCompaction = timeline.slice(latestUserIndex + 1).findLast(
    (item): item is ConversationToolItem => (
      item.kind === "tool" && item.name === "compact_context"
    ),
  );
  if (latestCompaction?.status === "failed") return latestCompaction.id;
  if (
    latestCompaction?.status === "cancelled"
    && contextCompactionLabel(latestCompaction) === "上下文压缩已暂停"
  ) return latestCompaction.id;
  return null;
}

export function contextCompactionDurationMs(
  item: ConversationToolItem,
  now = Date.now(),
): number | null {
  if (item.status === "running") {
    const startedAt = Date.parse(item.createdAt);
    return Number.isFinite(startedAt) ? Math.max(0, now - startedAt) : null;
  }
  if (item.result === null) return null;
  try {
    const result: unknown = JSON.parse(item.result);
    if (
      typeof result === "object"
      && result !== null
      && "durationMs" in result
      && typeof result.durationMs === "number"
      && Number.isFinite(result.durationMs)
    ) {
      return Math.max(0, result.durationMs);
    }
  } catch {
    // Older or partially written rows have no persisted duration.
  }
  return null;
}

export function contextCompactionTooltip(
  item: ConversationToolItem,
  now = Date.now(),
): string {
  const durationMs = contextCompactionDurationMs(item, now);
  const duration = durationMs === null ? null : formatRunDuration(0, durationMs);
  let compressedMessageCount: number | null = null;
  let errorMessage: string | null = null;
  if (item.result !== null) {
    try {
      const result: unknown = JSON.parse(item.result);
      if (typeof result === "object" && result !== null) {
        if (
          "compressedMessageCount" in result
          && typeof result.compressedMessageCount === "number"
          && Number.isFinite(result.compressedMessageCount)
        ) {
          compressedMessageCount = Math.max(0, Math.floor(result.compressedMessageCount));
        }
        if (
          "error" in result
          && typeof result.error === "object"
          && result.error !== null
          && "message" in result.error
          && typeof result.error.message === "string"
          && result.error.message.trim().length > 0
        ) {
          errorMessage = result.error.message.trim();
        }
      }
    } catch {
      // Older or partially written rows fall back to status-only details.
    }
  }

  let detail: string;
  if (item.status === "running") {
    detail = "正在压缩上下文";
  } else if (item.status === "failed") {
    detail = errorMessage ?? "上下文压缩未完成";
  } else if (item.status === "cancelled") {
    detail = contextCompactionLabel(item) === "上下文压缩已暂停"
      ? "压缩已暂停，可以继续压缩"
      : "上下文压缩已取消";
  } else if (compressedMessageCount === 0) {
    detail = "没有需要压缩的历史消息";
  } else if (compressedMessageCount !== null) {
    detail = `已处理 ${compressedMessageCount} 条历史消息`;
  } else {
    detail = "上下文压缩完成";
  }
  if (duration === null) return detail;
  return `${detail} · ${item.status === "running" ? "已用时" : "用时"} ${duration}`;
}

function ContextCompactionTimelineItem({
  canForce,
  item,
  onForce,
}: {
  canForce: boolean;
  item: ConversationToolItem;
  onForce: () => Promise<void>;
}): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (item.status !== "running") return undefined;
    const intervalId = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(intervalId);
  }, [item.status]);
  const label = contextCompactionLabel(item);
  const durationMs = contextCompactionDurationMs(item, now);
  const duration = durationMs === null ? null : formatRunDuration(0, durationMs);
  const tooltip = contextCompactionTooltip(item, now);
  const accessibleLabel = duration === null ? label : `${label} ${duration}`;
  const actionLabel = item.status === "cancelled"
    ? "继续压缩"
    : "强制压缩：缩小历史范围后再次尝试";
  return (
    <div
      aria-label={accessibleLabel}
      aria-live={item.status === "running" ? "polite" : undefined}
      className="context-compaction-divider"
      data-status={item.status}
      role={item.status === "running" ? "status" : "separator"}
    >
      <span aria-hidden="true" className="context-compaction-divider__line" />
      <span className="context-compaction-divider__label">
        <ArchiveRestore aria-hidden="true" size={15} />
        <TooltipAnchor content={tooltip}>
          <span className="context-compaction-divider__text" tabIndex={0}>{label}</span>
        </TooltipAnchor>
        {duration === null ? null : (
          <span className="shrink-0 tabular-nums">{duration}</span>
        )}
        {canForce ? (
          <TooltipAnchor content={actionLabel}>
            <button
              aria-label={actionLabel}
              className="context-compaction-divider__force"
              type="button"
              onClick={() => void onForce()}
            >
              <RefreshCw aria-hidden="true" size={13} />
            </button>
          </TooltipAnchor>
        ) : null}
      </span>
      <span aria-hidden="true" className="context-compaction-divider__line" />
    </div>
  );
}

function ToolTimelineItem({
  agentClient,
  item,
  teamManaged,
  latestActiveToolId,
  approvalActionable,
  approvalError,
  isApproving,
  variant = "card",
  onOpenProjectFile,
  onChangeApproval,
  liveOutput,
}: {
  agentClient: AgentClient;
  item: ConversationToolItem;
  teamManaged: boolean;
  latestActiveToolId: string | null;
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
  const terminalApprovalLabel = workspaceTerminalApprovalLabel(item);
  const isExpiredApproval = item.status === "awaiting_approval" && !approvalActionable;
  const effectiveStatus = isExpiredApproval
    ? "cancelled"
    : approvalError === null && !toolItemHasFailure(item)
    ? item.status
    : "failed";
  const shouldAutoExpand = item.id === latestActiveToolId;
  const [isExpanded, setIsExpanded] = useState(shouldAutoExpand);
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
            isExpanded={isExpanded}
            teamManaged={teamManaged}
            onOpenProjectFile={onOpenProjectFile}
            onToggle={() => setIsExpanded((current) => !current)}
          />
          {effectiveStatus === "running" ? <ToolExecutionTimer /> : null}
          {effectiveStatus !== "completed" && effectiveStatus !== "running" ? (
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
          agentClient={agentClient}
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
            {terminalApprovalLabel ?? (isExternalRead
              ? "读取工作区外文件前需要确认"
              : isCommand
              ? "等待确认后执行命令"
              : isFileDeletion
                ? "等待确认后删除文件"
                : "等待确认后写入文件")}
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
              {isApproving ? "提交中" : "允许一次"}
            </button>
            {isExternalRead ? null : (
              <button
                disabled={isApproving}
                title="当前对话后续完全相同的命令或同一工具与路径自动允许"
                type="button"
                onClick={() => void onChangeApproval(item, true, "session")}
              >
                <Check aria-hidden="true" size={14} />
                本对话允许相同操作
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
    case "terminal_control":
    case "create_terminal":
    case "open_terminal":
    case "execute_terminal_command":
    case "read_terminal_output":
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
    case "browser_control":
      return <Globe2 aria-hidden="true" size={15} />;
    case "read_attachment":
      return <Paperclip aria-hidden="true" size={15} />;
    case "view_attachments":
      return <Images aria-hidden="true" size={15} />;
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

function workspaceTerminalApprovalLabel(item: ConversationToolItem): string | null {
  if (item.name === "create_terminal" || item.name === "open_terminal") {
    return "等待确认后打开侧边终端";
  }
  if (item.name === "execute_terminal_command") return "等待确认后向侧边终端发送命令";
  if (item.name !== "terminal_control") return null;
  const argumentsValue = parseToolPayload(item.arguments);
  switch (argumentsValue?.action) {
    case "create":
      return "等待确认后打开侧边终端";
    case "write":
      return "等待确认后向侧边终端发送命令";
    case "close":
      return "等待确认后关闭侧边终端";
    default:
      return "等待确认后操作侧边终端";
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
      const mode = argumentsValue?.mode === "service"
        || commandResult?.mode === "service"
        || (argumentsValue?.mode === undefined && typeof argumentsValue?.serviceName === "string")
        ? "service"
        : "batch";
      const serviceName = typeof argumentsValue?.serviceName === "string"
        ? argumentsValue.serviceName
        : command;
      if (mode === "service") {
        if (commandResult?.status === "running") {
          return serviceName === null ? "服务已启动" : `已启动 ${serviceName}`;
        }
        if (commandResult?.status === "completed") {
          return serviceName === null ? "服务已结束" : `${serviceName} 已结束`;
        }
        return serviceName === null ? "启动后台服务" : `启动 ${serviceName}`;
      }
      if (commandResult?.status === "running") {
        return command === null ? "命令正在后台运行" : `后台运行 ${command}`;
      }
      return command === null
        ? (completed ? "已运行命令" : "运行命令")
        : `${completed ? "已运行" : "运行"} ${command}`;
    }
    case "terminal_control": {
      const action = typeof argumentsValue?.action === "string" ? argumentsValue.action : null;
      switch (action) {
        case "create":
          return completed ? "侧边终端已打开" : "打开侧边终端";
        case "list":
          return completed ? "已查看侧边终端" : "查看侧边终端";
        case "write": {
          const command = typeof argumentsValue?.command === "string"
            ? argumentsValue.command
            : null;
          return command === null
            ? (completed ? "命令已发送到侧边终端" : "向侧边终端发送命令")
            : `${completed ? "已发送" : "发送"} ${command}`;
        }
        case "read":
          return completed ? "已读取侧边终端输出" : "读取侧边终端输出";
        case "close":
          return completed ? "侧边终端已关闭" : "关闭侧边终端";
        default:
          return completed ? "侧边终端操作已完成" : "操作侧边终端";
      }
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
    case "view_attachments": {
      const attachmentIds = Array.isArray(argumentsValue?.attachment_ids)
        ? argumentsValue.attachment_ids
        : [];
      return `${completed ? "已查看" : "查看"} ${attachmentIds.length} 个附件`;
    }
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
    case "browser_control": {
      const action = typeof argumentsValue?.action === "string" ? argumentsValue.action : null;
      switch (action) {
        case "open":
          return completed ? "网页已打开" : "打开网页";
        case "observe":
          return completed ? "已查看页面" : "查看页面";
        case "navigate":
          return completed ? "已跳转网页" : "跳转网页";
        case "click":
          return completed ? "已点击页面元素" : "点击页面元素";
        case "fill":
          return completed ? "已填写页面" : "填写页面";
        case "select":
          return completed ? "已选择页面选项" : "选择页面选项";
        case "key":
          return completed ? "已向页面发送按键" : "向页面发送按键";
        case "scroll":
          return completed ? "已滚动页面" : "滚动页面";
        case "wait":
          return completed ? "页面等待结束" : "等待页面";
        case "close":
          return completed ? "网页已关闭" : "关闭网页";
        default:
          return completed ? "浏览器操作已完成" : "操作浏览器";
      }
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
  isExpanded,
  teamManaged,
  onOpenProjectFile,
  onToggle,
}: {
  item: ConversationToolItem;
  isExpanded: boolean;
  teamManaged: boolean;
  onOpenProjectFile: ((path: string) => void) | undefined;
  onToggle: () => void;
}): ReactElement {
  const summary = fileChangeSummary(item);
  const label = toolActivityLabel(item, teamManaged);
  const toggleLabel = isExpanded ? "收起调用详情" : "展开调用详情";
  const toggleClassName = "min-w-0 flex-[0_1_auto] cursor-pointer overflow-hidden border-0 bg-transparent p-0 text-left text-ellipsis whitespace-nowrap text-[var(--app-muted-foreground)] transition-colors hover:text-[var(--app-foreground)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1 [font:inherit]";
  const fileLinkClassName = "inline-flex min-w-0 cursor-pointer items-center gap-1 overflow-hidden border-0 bg-transparent p-0 text-inherit transition-colors hover:text-[var(--app-accent)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-2 [font:inherit]";
  if (summary === null) {
    return (
      <button
        aria-expanded={isExpanded}
        aria-label={`${toggleLabel}：${label}`}
        className={toggleClassName}
        title={toggleLabel}
        type="button"
        onClick={onToggle}
      >
        <span className="tool-timeline-item__label-text">{label}</span>
      </button>
    );
  }

  return (
    <span className="tool-timeline-item__activity-label">
      <button
        aria-expanded={isExpanded}
        aria-label={`${toggleLabel}：${label}`}
        className={toggleClassName}
        title={toggleLabel}
        type="button"
        onClick={onToggle}
      >
        <span className="tool-timeline-item__label-text">{summary.action}</span>
      </button>
      {onOpenProjectFile === undefined ? (
        <span className="inline-flex min-w-0 items-center gap-1 overflow-hidden" title={summary.path}>
          <FileTypeIcon className="shrink-0" path={summary.path} size={14} />
          <span className="tool-timeline-item__label-text truncate">
            {fileNameFromPath(summary.path)}
          </span>
        </span>
      ) : (
        <button
          aria-label={`在侧边工作区打开文件 ${summary.path}`}
          className={fileLinkClassName}
          title={`在侧边工作区打开 ${summary.path}`}
          type="button"
          onClick={() => onOpenProjectFile(summary.path)}
        >
          <FileTypeIcon className="shrink-0" path={summary.path} size={14} />
          <span className="tool-timeline-item__label-text min-w-0 truncate">
            {fileNameFromPath(summary.path)}
          </span>
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
    iconToolName: "terminal_control",
    label: (count) => `操作 ${count} 次侧边终端`,
    names: [
      "terminal_control",
      "create_terminal",
      "open_terminal",
      "execute_terminal_command",
      "read_terminal_output",
    ],
    priority: 95,
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
    names: ["read_file", "read_external_file", "read_attachment", "view_attachments"],
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
    iconToolName: "browser_control",
    label: (count) => `操作 ${count} 次浏览器`,
    names: ["browser_control"],
    priority: 55,
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
  agentClient,
  item,
  teamManaged,
  liveOutput,
  onOpenProjectFile,
}: {
  agentClient: AgentClient;
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

  if (item.name === "view_attachments") {
    return (
      <AttachmentViewResult
        agentClient={agentClient}
        payload={item.result}
        status={item.status}
      />
    );
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
  const [copied, setCopied] = useState(false);
  const invocation = parseCommandInvocation(argumentsPayload);
  const command = invocation?.command ?? "命令参数无法识别，请查看原始调用。";
  const result = resultPayload === null ? null : parseCommandResult(resultPayload);
  const output = commandTerminalOutput(resultPayload, status, liveOutput);
  const clipboardText = commandTerminalClipboardText(command, output);

  return (
    <section className="tool-timeline-item__payload tool-structured-result tool-command-terminal">
      <header className="tool-command-terminal__header">
        <span>{commandTerminalHeaderLabel(result?.terminal ?? null)}</span>
        <IconButton
          className="tool-command-terminal__copy"
          label={copied ? "已复制终端内容" : "复制终端内容"}
          size="compact"
          variant="quiet"
          onClick={() => void copyTextWithFeedback(clipboardText, setCopied)}
        >
          {copied ? <Check aria-hidden="true" size={15} /> : <Copy aria-hidden="true" size={15} />}
        </IconButton>
      </header>
      <div className="tool-structured-result__content">
        <pre>
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
                <FileTypeIcon path={entry.path} size={14} />
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

function AttachmentViewResult({
  agentClient,
  payload,
  status,
}: {
  agentClient: AgentClient;
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const attachments = payload === null ? null : parseAttachmentViewResult(payload);
  if (attachments === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult summary={`查看 ${attachments.length} 个附件`}>
      <AttachmentStrip variant="message">
        {attachments.map((attachment) => (
          <AttachmentChip
            agentClient={agentClient}
            attachment={attachment}
            key={attachment.id}
          />
        ))}
      </AttachmentStrip>
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
              <FileTypeIcon path={match} size={14} />
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
              <SubagentAvatar
                icon={task.avatarIcon}
                seed={task.childConversationId}
                size="compact"
              />
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
      <section
        className="tool-timeline-item__payload tool-structured-result tool-file-change"
        data-change-type={changeType}
      >
        <header className="tool-file-change__header">
          {onOpenProjectFile === undefined ? (
            <span
              className="tool-file-change__path inline-flex items-center gap-1"
              title={presentation.path}
            >
              <FileTypeIcon className="shrink-0" path={presentation.path} size={14} />
              <span className="min-w-0 truncate">
                {fileNameFromPath(presentation.path)}
              </span>
            </span>
          ) : (
            <button
              aria-label={`在侧边工作区打开文件 ${presentation.path}`}
              className="tool-file-change__path inline-flex items-center gap-1"
              title={`在侧边工作区打开 ${presentation.path}`}
              type="button"
              onClick={() => onOpenProjectFile(presentation.path)}
            >
              <FileTypeIcon className="shrink-0" path={presentation.path} size={14} />
              <span className="min-w-0 truncate">
                {fileNameFromPath(presentation.path)}
              </span>
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
        <div className="tool-structured-result__content">
          <DiffView presentation={presentation} />
        </div>
        {error === null ? null : <ToolErrorNotice message={error} />}
      </section>
    );
  }

  return <ToolResultNotice result={result} status="failed" />;
}

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
  const presentation = describeConversationError(message, "tool");

  return (
    <section
      className="tool-timeline-item__payload tool-structured-result"
      data-status="failed"
      role="alert"
    >
      <p className="tool-timeline-item__payload-label flex items-center gap-1.5">
        <CircleAlert
          aria-hidden="true"
          className="text-[var(--app-status-danger-fg)]"
          size={14}
        />
        <span className="text-[var(--app-status-danger-fg)]">失败原因</span>
      </p>
      <div className="tool-structured-result__content">
        <p
          className="m-0 max-h-40 overflow-auto whitespace-pre-wrap px-2 py-2 text-[length:var(--app-font-size-control)] leading-5 text-[var(--app-foreground)] [overflow-wrap:anywhere]"
          data-tool-error-detail
        >
          {presentation.detail}
        </p>
      </div>
    </section>
  );
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

export function runtimeBadgeLabel(
  isMockRuntime: boolean,
  modelDisplayName: string,
): string {
  return isMockRuntime ? "浏览器预览" : modelDisplayName;
}

function RuntimeBadge({
  isConfigured,
  isMockRuntime,
  isRunning,
  modelDisplayName,
}: {
  isConfigured: boolean;
  isMockRuntime: boolean;
  isRunning: boolean;
  modelDisplayName: string;
}): ReactElement {
  const label = runtimeBadgeLabel(isMockRuntime, modelDisplayName);

  return (
    <span
      className="runtime-badge"
      data-configured={String(isConfigured)}
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
  await copyTextWithFeedback(diff, setCopied);
}

async function copyTextWithFeedback(
  text: string,
  setCopied: (copied: boolean) => void,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1_500);
  } catch {
    setCopied(false);
  }
}

export function commandTerminalHeaderLabel(
  terminal: { displayName: string } | null,
): string {
  return terminal?.displayName.trim() || "命令行";
}

export function commandTerminalClipboardText(command: string, output: string): string {
  return output.length === 0 ? `$ ${command}` : `$ ${command}\n\n${output}`;
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

export function parseAttachmentViewResult(payload: string): ConversationAttachment[] | null {
  const result = parseToolValue(payload);
  const parsed = conversationAttachmentListSchema.safeParse(result?.attachments);
  return parsed.success ? parsed.data : null;
}

type CommandResultPayload = {
  command: string | null;
  commandId: string | null;
  completedAt: string | null;
  exitCode: number | null;
  mode: "batch" | "service" | null;
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
      mode: result.mode === "batch" || result.mode === "service" ? result.mode : null,
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
  if (result.status === "running" && lines.length === 0) {
    lines.push(result.mode === "service" ? "[服务正在后台运行]" : "[命令正在后台运行]");
  }
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
