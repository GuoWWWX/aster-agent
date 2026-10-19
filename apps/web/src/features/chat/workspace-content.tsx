import { AttachmentChip, AttachmentStrip } from "./conversation-attachments.js";
import { ToolErrorNotice } from "./tool-result-content.js";
export { CommandLifecycleResult } from "./command-tool-result.js";
import { ToolRawCallDialog } from "./tool-raw-call-dialog.js";
import {
  toolStatusLabel,
  workspaceTerminalApprovalLabel,
  toolActivityLabel,
  representativeToolName,
  toolBatchLabel,
  toolBatchCurrentToolLabel,
  fileChangeSummary,
} from "./tool-activity-presentation.js";
export {
  representativeToolName,
  toolBatchLabel,
  latestActiveTool,
  toolBatchCurrentToolLabel,
  toolBatchExecutionMode,
  fileChangeSummary,
} from "./tool-activity-presentation.js";
import { ToolDetail, toolHasDisplayableDetails } from "./tool-detail.js";
export { toolHasDisplayableDetails } from "./tool-detail.js";
import { isRecord } from "./tool-result-payload.js";
import { parseToolError } from "./tool-result-payload.js";
export { formatToolPayload } from "./tool-result-payload.js";
import { fileNameFromPath } from "./workspace-tool-result-model.js";
export { parseAttachmentViewResult } from "./workspace-tool-result-model.js";
import { spawnSubagentActivity, parseSubagentToolResult } from "./collaboration-tool-result-model.js";
export { spawnSubagentActivity } from "./collaboration-tool-result-model.js";
import {
  type LiveToolOutput,
  commandExecutionState,
  parseCommandResult,
  parseCommandLifecycleResult,
} from "./command-tool-result-model.js";
export { commandTerminalHeaderLabel, commandTerminalClipboardText } from "./command-tool-result-model.js";
import { ConversationErrorItem, ConversationErrorContent, stripLegacyErrorInstanceId } from "./conversation-error.js";
export {
  stripLegacyErrorInstanceId,
  type ConversationErrorPresentation,
  describeConversationError,
} from "./conversation-error.js";
import {
  upsertTimelineItem,
  mergeLatestTimelinePage,
  prependTimelinePage,
  replaceTimelineFromMessage,
  combineAutomaticContinuationDurations,
  projectSubagentMessagesForParentTimeline,
  groupRunActivities,
  getLatestActiveToolId,
  stripLeadingThinkingSummary,
  getConversationRunDurationInsertIndexes,
  getRepeatedAssistantFailureMessageIds,
  getConversationRunProgressInsertIndex,
  getModelActivityInsertIndex,
  getFinalCompletedAssistantMessageIds,
  type RunActivityItem,
  type RunActivityTextItem,
  type TimelineDisplayItem,
  type RunActivityTimelineItem as RunActivityProjection,
  type ToolBatchTimelineItem as ToolBatchProjection,
} from "./conversation-timeline-projection.js";
export {
  projectSubagentMessagesForParentTimeline,
  groupRunActivities,
  groupToolBatches,
  projectTimelineForActiveRun,
  getLatestActiveToolId,
  stripLeadingThinkingSummary,
  getConversationRunDurationInsertIndexes,
  getRepeatedAssistantFailureMessageIds,
  getConversationRunProgressInsertIndex,
  getModelActivityInsertIndex,
  getFinalCompletedAssistantMessageIds,
} from "./conversation-timeline-projection.js";
import { isImageGenerationModel } from "@agent/protocol";
import { GeneratedImagesResult, ImageGenerationVisibilityProvider } from "./generated-images-result.js";
import { imageGenerationDeliveries } from "./image-generation-deliveries.js";
import { conversationArtifacts, HtmlDeliveryPreview } from "./conversation-artifacts.js";
import { MarkdownArtifactScope, standaloneArtifactReferences } from "../../components/markdown/artifact-references.js";
import type { ChatReference } from "@agent/protocol";
import { ChatReferenceScope } from "../../components/markdown/chat-reference-scope.js";
import { MessageReferenceQuote } from "../../components/markdown/message-reference-quote.js";
import { TaskListLauncher } from "../team/task-context-directory.js";
import { LoadingState, Spinner } from "../../components/ui/loading.js";
import { ConversationWorkIndicator, toolWorkPhase } from "./conversation-work-state.js";
import { ConversationChangesBadge, ConversationChangesCard } from "./conversation-file-changes.js";
import { htmlPresentationDeliveries } from "./html-presentations.js";
import { HtmlPreviewScope } from "../../components/html-preview/html-preview-card.js";
import { QueryTextarea } from "./query-textarea.js";
import { UserMessageContent } from "./user-message-content.js";
import { TeamChatSourceContent, TeamChatSourceHeader } from "../team/team-chat-source-content.js";
import { ChatMessageBubble } from "./chat-message-bubble.js";
import { TeamChatWorkspace } from "../team/team-chat-workspace.js";
import { teamChatTabId } from "./workbench-tabs.js";
import { ChatMessageMeta, formatConversationTime, formatConversationDateTime } from "./chat-message-meta.js";
import type { PostTeamChatInput, TeamChatActivity, TeamChatMessage } from "@agent/protocol";
export { formatConversationTime } from "./chat-message-meta.js";
import { TeamChatPanel } from "../team/team-chat-panel.js";
import { TeamChatCoordinatorControl } from "../team/team-chat-coordinator-control.js";
import { createPastedTextAttachment } from "./pasted-text-attachment.js";
import { MAX_DRAFT_ATTACHMENTS, MAX_DRAFT_ATTACHMENT_BYTES, getClipboardAttachmentFiles, pastedAttachmentName, readAttachmentFileAsBase64 } from "./clipboard-attachments.js";
import { ScheduledTasksWorkspace } from "../schedules/scheduled-tasks-workspace.js";
import { useComposerHistory } from "./use-composer-history.js";



import { ToolDisclosureContext, ToolRevealContext, useToolDisclosure } from "./tool-disclosure-state.js";
import { CommandExecutionStatus } from "./command-execution-status.js";
import { findComposerReferenceRanges } from "./composer-reference-ranges.js";
import { Bot, ArchiveRestore, ArrowDown, ArrowUp, BrainCircuit, ChevronDown, ChevronRight, ChevronUp, CircleAlert, Check, Eye, FileDiff, FileSearch, FileText, Folder, FolderOpen, FolderPlus, GitFork, Globe2, GripVertical, LoaderCircle, List, ListEnd, ListTodo, MessageSquareText, MessageCircleQuestion, Paperclip, Pencil, Pause, Play, RefreshCw, Search, Send, SendHorizontal, Images, Sparkles, SlidersHorizontal, Square, SquarePen, Terminal, Trash2, UsersRound, Wrench, X } from "lucide-react";
import {
  useCallback,
  useContext,
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
  ConversationSearchResult,
  ConversationSummary,
  ConversationTaskList,
  ConversationTimelineItem,
  ConversationToolItem,
  UserQuestion,
  ModelReasoningOption,
  ModelProfile,
  ModelRuntimeStatus,
  ProjectEntry,
  ProjectSummary,
  SkillConfiguration,
  TeamChatMember,
  TeamInstanceScope,
  TeamInstanceView,
} from "@agent/protocol";
import { AgentClientError, DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION, isReasoningOptionEnabled, modelReasoningOptionKey, parseSerializedAgentError } from "@agent/protocol";

import { IconButton } from "../../components/ui/icon-button.js";
import { TooltipAnchor } from "../../components/ui/tooltip.js";

import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { AgentMarkdown, AgentMarkdownWorkspaceScope } from "../../components/markdown/agent-markdown.js";
import { useMediaPreview } from "../../components/media/image-viewer.js";
import { ConversationImagePreviewScope } from "./conversation-image-preview.js";

import {
  Popover,
  PopoverAnchor,
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
} from "../../components/ui/select.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import {
  getCachedModelStatus,
  loadModelStatus,
  rememberModelStatus,
  subscribeModelStatus,
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
import { AgentAvatar, SubagentAvatar } from "../team/agent-avatar.js";
import { ToolConversationContext, ToolConversationIdentity, toolConversationTargets } from "./tool-conversation-identity.js";
import { TeamWorkspace } from "../team/team-workspace.js";
import { CollaborationProjectionGraph } from "../team/collaboration/collaboration-graph.js";
import { CONVERSATION_WORKSPACE_CACHE_TTL_MS, useConversationWorkspaceCache } from "./conversation-workspace-cache.js";
import { formatConversationRunMarkdown } from "./conversation-copy.js";

import { ConversationFindBar } from "./conversation-find-bar.js";
import { ConversationPath } from "./conversation-path.js";
import { ConversationPermissionSelect } from "./conversation-permission-select.js";
import { ConversationHeaderControls } from "./conversation-header-controls.js";
import { ConversationContextUsageRefresh } from "./conversation-context-usage-refresh.js";
import { UserQuestionPanel } from "./user-question-panel.js";
import { questionForAnswer, questionToolForAnswer } from "./question-answer-reference.js";
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
  shouldResetTimelinePaging,
} from "./conversation-timeline-state.js";
import {
  conversationChangeSummaries,
  conversationChangeAnchors,
  type TaskFileChangeSummary,
} from "./task-file-change-summary.js";
import "./workspace-content.css";

const DEFAULT_COMPOSER_CLEARANCE_PX = 120;
const TIMELINE_PAGE_SIZE = 120;
const EMPTY_TEAM_INSTANCES: readonly TeamInstanceView[] = [];
const EMPTY_TEAM_CHAT_IDS: readonly string[] = [];
const TIMELINE_PREFETCH_VIEWPORTS = 1.5;

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
  openTeamChatInstanceIds?: readonly string[];
  sessions: readonly ProjectSession[];
  teamInstances?: readonly TeamInstanceView[];
  onAddProject: () => Promise<ProjectSummary | null>;
  onCreateProjectSession: (projectId: string) => void;
  onCreateTemporarySession: () => void;
  onForkConversation: (conversationId: string, throughMessageId: string) => Promise<void>;
  onLocateProject: (projectId: string) => void;
  onLocateSession: (sessionId: string) => void;
  onLocateConversationItem?: (conversationId: string, itemId: string) => void;
  onOpenProjectFile?: (projectId: string, path: string) => void;
  onOpenGitReview?: (projectId: string, path?: string) => void;
  onOpenTeamConversation: (
    conversation: ProjectSession,
    sourceConversationId?: string,
    timelineItemId?: string,
  ) => void;
  onNavigateToTeamConversation?: (conversationId: string) => void;
  onProjectSelected: (projectId: string | null) => void;
  onRefreshSessions?: () => Promise<void>;
  onSessionSelected: (sessionId: string) => void;
  onSessionUpdated: (conversation: ConversationSummary) => void;
  onSessionViewed: (sessionId: string) => void;
};

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

type ModelActivity = {
  anchorTimelineItemId: string | null;
  preview?: string;
  runId: string | null;
  status: "progress" | "thinking";
};

type RunProgress = {
  anchorTimelineItemId: string | null;
  outputStartedAt: number | null;
  runId: string | null;
  startedAt: number;
};

export type SubagentPendingApproval = {
  childAvatarIcon: AgentAvatarIcon | null;
  childConversationId: string;
  childTitle: string;
  tool: ConversationToolItem;
};

export function collectSubagentPendingApprovals(
  subagents: readonly Pick<ProjectSession, "activeRunId" | "avatarIcon" | "id" | "title">[],
  timelines: ReadonlyMap<string, readonly ConversationTimelineItem[]>,
): SubagentPendingApproval[] {
  return subagents.flatMap((subagent) => {
    if (subagent.activeRunId === null) return [];
    return (timelines.get(subagent.id) ?? []).flatMap((item) =>
      item.kind === "tool"
      && item.runId === subagent.activeRunId
      && item.status === "awaiting_approval"
        ? [{
            childAvatarIcon: subagent.avatarIcon ?? null,
            childConversationId: subagent.id,
            childTitle: subagent.title,
            tool: item,
          }]
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

export function scopeRunProgressToLatestInput(
  progress: RunProgress,
  timeline: readonly ConversationTimelineItem[],
): RunProgress {
  const inputs = timeline.filter((item) => item.kind === "message"
    && item.role === "user" && item.runId === progress.runId);
  const latest = inputs.at(-1);
  if (latest === undefined || (inputs.length < 2
    && timeline.find((item) => item.runId === progress.runId)?.id === latest.id)) return progress;
  const startedAt = Date.parse(latest.createdAt);
  if (!Number.isFinite(startedAt)) return progress;
  return {
    ...progress,
    anchorTimelineItemId: latest.id,
    outputStartedAt: progress.outputStartedAt !== null && progress.outputStartedAt >= startedAt
      ? progress.outputStartedAt : null,
    startedAt,
  };
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
  | { kind: "all"; value: { id: string; name: string } }
  | { kind: "conversation"; value: ConversationMention; member?: TeamChatMember }
  | { kind: "directory"; value: ProjectFileMention }
  | { kind: "file"; value: ProjectFileMention }
  | { kind: "team"; value: TeamMention };

const MENTION_GROUPS = { all: "群成员", conversation: "对话", team: "团队", directory: "文件夹", file: "文件" };

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
  modelId: string | null;
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

const FLAGSHIP_REASONING_EFFECTS = [
  [/^gpt-\d+(?:\.\d+)?-(?:sol|astra)(?:-|$)/iu, ["ultra"]],
  [/^claude-(?:opus|fable|mythos)-/iu, ["max"]],
  [/^gemini-\d+(?:\.\d+)?-(?:pro|argon)(?:-|$)/iu, ["high"]],
  [/^gemini-2\.5-pro(?:-|$)/iu, [32768]],
  [/^deepseek-v\d+(?:\.\d+)?-pro(?:-|$)/iu, ["max"]],
  [/^kimi-k3(?:-|$)/iu, ["max"]],
  [/^glm-5\.[23](?:-\d{4}(?:-\d{2}){0,2})?$/iu, ["max"]],
  [/^grok-4\.[67](?:-latest|-\d{4}(?:-\d{2}){0,2})?$/iu, ["xhigh"]],
  [/^grok-4\.[35](?:-latest|-\d{4}(?:-\d{2}){0,2})?$/iu, ["high"]],
  [/^qwen(?:\d+(?:\.\d+)?)?-max(?:-|$)/iu, ["max"]],
  [/^minimax-m3(?:-preview)?$/iu, ["max"]],
] as const;

export function shouldShowFlagshipReasoningEnergy(modelId: string | null, option: ModelReasoningOption | undefined): boolean {
  if (option === undefined || option.enabled === false) return false;
  const modelName = modelId?.trim().split("/").at(-1) ?? "";
  const value = typeof option.value === "string" ? option.value.trim().toLowerCase() : option.value;
  return FLAGSHIP_REASONING_EFFECTS.some(([pattern, levels]) => pattern.test(modelName)
    && levels.some(level => level === value));
}

function ConversationReasoningControl({
  disabled,
  fallbackOption,
  modelId,
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
  const showEnergyField = shouldShowFlagshipReasoningEnergy(modelId, selectedOption);
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
          <ChevronDown aria-hidden="true" size={16} />
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
                  {showEnergyField ? <ReasoningEnergyField active /> : null}
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
  onLocateConversationItem,
  onOpenProjectFile,
  onOpenGitReview,
  onOpenTeamConversation,
  onNavigateToTeamConversation,
  onProjectSelected,
  onRefreshSessions,
  onSessionSelected,
  onSessionUpdated,
  onSessionViewed,
  protectedSessionIds,
  openTeamChatInstanceIds = EMPTY_TEAM_CHAT_IDS,
  sessions,
  teamInstances = EMPTY_TEAM_INSTANCES,
}: WorkspaceContentProps): ReactElement {
  const activeActivity = useWorkbenchUiStore((state) => state.activeActivity);
  const teamChatTarget = useWorkbenchUiStore((state) => state.teamChatTarget);
  const retainedSessions = useConversationWorkspaceCache(
    activeActivity === "conversations" && teamChatTarget === null ? activeSession : null,
    sessions,
    protectedSessionIds,
  );
  const retainedTeamChats = useConversationWorkspaceCache(
    activeActivity === "conversations" ? teamInstances.find(instance => !instance.isArchived && instance.id === teamChatTarget?.instanceId) ?? null : null,
    teamInstances,
    openTeamChatInstanceIds,
  );

  return <>
    {activeActivity === "team" || activeActivity === "tasks" ? (
      <TeamWorkspace
        agentClient={agentClient}
        projects={projects}
        onOpenConversation={onOpenTeamConversation}
        {...(onNavigateToTeamConversation === undefined ? {} : {
          onNavigateToConversation: onNavigateToTeamConversation,
        })}
      />
    ) : activeActivity === "schedules" ? <ScheduledTasksWorkspace agentClient={agentClient} projects={projects}
      onOpenConversation={(id, projectId) => {
        void (onRefreshSessions?.() ?? Promise.resolve()).then(() => {
          onProjectSelected(projectId);
          useWorkbenchUiStore.getState().setActiveActivity("conversations");
          onSessionSelected(id);
        });
      }} /> : activeActivity === "settings" ? <SettingsWorkspace agentClient={agentClient} /> : activeSession === null && teamChatTarget === null ? (
      <ProjectConversationEmpty
        activeProject={activeProject}
        isCreatingSession={isCreatingSession}
        onCreateProjectSession={onCreateProjectSession}
        onCreateTemporarySession={onCreateTemporarySession}
      />
    ) : null}
    {retainedTeamChats.map(instance => {
      const active = activeActivity === "conversations" && teamChatTarget?.instanceId === instance.id;
      return <div key={instance.id} className={active ? "flex min-h-0 min-w-0 flex-1 overflow-hidden" : "hidden"} aria-hidden={!active}>
        <TeamChatWorkspace agentClient={agentClient} instance={instance} active={active} sessions={sessions} projects={projects} onSessionUpdated={onSessionUpdated}
          {...(onOpenProjectFile === undefined ? {} : { onOpenFile: (conversationId: string, path: string) => onOpenProjectFile(instance.projectId ?? conversationId, path) })}
          {...(active && teamChatTarget?.messageId !== undefined ? { focusMessageId: teamChatTarget.messageId } : {})}
          onOpenConversation={(conversation, messageId) => {
            onOpenTeamConversation({ ...conversation, pinOrder: conversation.pinOrder ?? null }, teamChatTabId(instance.id), messageId);
          }} />
      </div>;
    })}
    <div className={activeActivity === "conversations" && teamChatTarget === null && activeSession !== null ? "flex min-h-0 min-w-0 flex-1 overflow-hidden" : "hidden"}>
      {retainedSessions.map((session) => {
        const isActive = activeActivity === "conversations" && teamChatTarget === null && session.id === activeSession?.id;
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
              {...(onLocateConversationItem === undefined ? {} : { onLocateConversationItem })}
              onOpenProjectFile={projectId === null || onOpenProjectFile === undefined
                ? undefined
                : (path) => {
                    onOpenProjectFile?.(projectId, path);
                  }}
              onOpenGitReview={projectId === null || onOpenGitReview === undefined
                ? undefined
                : (path) => onOpenGitReview(projectId, path)}
              onOpenTeamConversation={onOpenTeamConversation}
              {...(onNavigateToTeamConversation === undefined ? {} : {
                onNavigateToTeamConversation,
              })}
              onForkConversation={onForkConversation}
              onAddProject={onAddProject}
              onProjectSelected={onProjectSelected}
              {...(onRefreshSessions === undefined ? {} : { onRefreshSessions })}
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
  </>;
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
  onLocateConversationItem,
  onOpenProjectFile,
  onOpenGitReview,
  onOpenTeamConversation,
  onNavigateToTeamConversation,
  onForkConversation,
  onProjectSelected,
  onRefreshSessions,
  onSessionSelected,
  onSessionUpdated,
  onViewed,
  project,
  projects = [],
  relatedSessions = EMPTY_PROJECT_SESSIONS,
  session,
  teamInstances = [],
  teamManaged = false,
  groupChat = null,
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
  onLocateConversationItem?: (conversationId: string, itemId: string) => void;
  onOpenProjectFile?: ((path: string) => void) | undefined;
  onOpenGitReview?: ((path?: string) => void) | undefined;
  onOpenTeamConversation?: (
    conversation: ProjectSession,
    sourceConversationId?: string,
    timelineItemId?: string,
  ) => void;
  onNavigateToTeamConversation?: (conversationId: string) => void;
  onForkConversation?: (conversationId: string, throughMessageId: string) => Promise<void>;
  onProjectSelected?: (projectId: string) => void;
  onRefreshSessions?: () => Promise<void>;
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
  groupChat?: { instanceId: string; focusMessageId?: string; initialAgentId?: string; onOpenFile?: (conversationId: string, path: string) => void } | null;
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
      groupChat?.instanceId ?? session.id,
      (groupChat === null ? session.agentId : groupChat.initialAgentId) ?? defaultAgent?.id ?? "",
    ),
  );
  const [composerValue, setComposerValue] = useState("");
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const groupRequestRef = useRef<{ fingerprint: string; id: string } | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const [forkingMessageId, setForkingMessageId] = useState<string | null>(null);
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingAttachments, setEditingAttachments] = useState<ConversationAttachment[] | null>(null);
  const [coordinationMode, setCoordinationMode] = useState(session.coordinationMode ?? "direct");
  const [isSavingCoordinationMode, setIsSavingCoordinationMode] = useState(false);
  const messageDeliveryMode: ConversationMessageDeliveryMode = coordinationMode === "parallel_queue"
    ? "queue" : defaultMessageDeliveryMode;
  const [availableConversationMentions, setAvailableConversationMentions] =
    useState<ConversationMention[]>([]);
  const [selectedConversationMentions, setSelectedConversationMentions] =
    useState<ConversationMention[]>([]);
  const [selectedTeamMentions, setSelectedTeamMentions] = useState<TeamMention[]>([]);
  const [selectedProjectFileMentions, setSelectedProjectFileMentions] =
    useState<ProjectFileMention[]>([]);
  const [mentionQuery, setMentionQuery] = useState<MentionQuery | null>(null);
  const groupInstanceId = groupChat?.instanceId;
  const [groupUsageConversation, setGroupUsageConversation] = useState<{ instanceId: string; conversationId: string } | null>(null);
  const usageConversationId = groupInstanceId === undefined ? session.id
    : groupUsageConversation?.instanceId === groupInstanceId ? groupUsageConversation.conversationId : null;
  const isGroupMentionOpen = groupChat !== null && mentionQuery !== null;
  const [groupMentionRoster, setGroupMentionRoster] = useState<{ instanceId: string; members: TeamChatMember[] } | null>(null);
  const [mentionSelectionIndex, setMentionSelectionIndex] = useState(0);
  const [projectMentionListing, setProjectMentionListing] = useState<{
    directoryPath: string;
    entries: ProjectEntry[];
    workspaceId: string;
  } | null>(null);
  const [slashQuery, setSlashQuery] = useState<MentionQuery | null>(null);
  const [slashSkills, setSlashSkills] = useState<SkillConfiguration[]>([]);
  const composerHistory = useComposerHistory({ composerValue, selectedConversationMentions,
    selectedTeamMentions, selectedProjectFileMentions }, (snapshot) => {
    setComposerValue(snapshot.composerValue);
    setSelectedConversationMentions(snapshot.selectedConversationMentions);
    setSelectedTeamMentions(snapshot.selectedTeamMentions);
    setSelectedProjectFileMentions(snapshot.selectedProjectFileMentions);
    setMentionQuery(null);
    setSlashQuery(null);
  }, composerRef, session.id, agentClient);
  const [toolDisclosureChoices] = useState(() => new Map<string, boolean>());
  const [userQuestions, setUserQuestions] = useState<UserQuestion[]>([]);
  useEffect(() => {
    let disposed = false;
    setUserQuestions([]);
    void agentClient.listUserQuestions({ conversationId: session.id }).then((questions) => {
      if (!disposed) setUserQuestions(questions);
    }).catch(() => undefined);
    const unsubscribe = agentClient.onConversationRunEvent((event) => {
      if (event.type !== "user_question.updated" || event.question.displayConversationId !== session.id) return;
      setUserQuestions((current) => [event.question, ...current.filter((question) => question.id !== event.question.id)]);
    });
    return () => { disposed = true; unsubscribe(); };
  }, [agentClient, session.id]);
  const [draftAttachments, setDraftAttachments] = useState<ConversationAttachment[]>([]);
  const [draftAttachmentPreviewUrls, setDraftAttachmentPreviewUrls] = useState<
    Record<string, string>
  >({});
  const draftAttachmentPreviewUrlsRef = useRef<Record<string, string>>({});
  const [contextCompressionConfiguration, setContextCompressionConfiguration] =
    useState<ContextCompressionConfiguration>(DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION);
  const [contextUsageMeasurement, setContextUsageMeasurement] = useState<{
    conversationId: string; usage: ConversationContextUsage;
  } | null>(null);
  const contextUsage = contextUsageMeasurement?.conversationId === usageConversationId ? contextUsageMeasurement.usage : null;
  const [lastProviderUsage, setLastProviderUsage] = useState<{
    conversationId: string;
    usage: ConversationContextUsage;
  } | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [isChangingWorkspace, setIsChangingWorkspace] = useState(false);
  const [isChangingProject, setIsChangingProject] = useState(false);
  const [isAddingAttachments, setIsAddingAttachments] = useState(false);
  const [isLoadingTimeline, setIsLoadingTimeline] = useState(true);
  const [isMockRuntime, setIsMockRuntime] = useState(false);
  const [isSavingTeamPermission, setIsSavingTeamPermission] = useState(false);
  const [isScrolledAwayFromBottom, setIsScrolledAwayFromBottom] = useState(false);
  const [disclosureRevision, setDisclosureRevision] = useState(0);
  const [isSending, setIsSending] = useState(false);
  const [liveToolOutputs, setLiveToolOutputs] = useState<Record<string, LiveToolOutput>>({});
  const [modelActivity, setModelActivity] = useState<ModelActivity | null>(null);
  const initialModelStatus = getCachedModelStatus(agentClient);
  const initialModelSelection = resolveInitialConversationModelSelection(
    session.modelSelection,
    initialModelStatus,
  );
  const [modelStatus, setModelStatus] = useState<ModelRuntimeStatus | null>(initialModelStatus);
  useEffect(() => subscribeModelStatus(agentClient, setModelStatus), [agentClient]);
  const [runProgresses, setRunProgresses] = useState<RunProgress[]>(() =>
    createRestoredRunProgresses(session.activeRunId),
  );
  const [removingAttachmentId, setRemovingAttachmentId] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [pendingMessages, setPendingMessages] = useState<ConversationPendingMessage[]>([]);
  const [pendingQueuePaused, setPendingQueuePaused] = useState(true);
  const [pendingMessageActionId, setPendingMessageActionId] = useState<string | null>(null);
  const [approvingToolId, setApprovingToolId] = useState<string | null>(null);
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});
  const [editingPendingMessageId, setEditingPendingMessageId] = useState<string | null>(null);
  const [permissionMode, setPermissionMode] =
    useState<ConversationPermissionMode>(session.permissionMode ?? defaultPermissionMode);
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
  const groupOwnerRef = useRef<PostTeamChatInput["coordinator"] | null>(null);
  const [groupActivity, setGroupActivity] = useState<TeamChatActivity | null>(null);
  const [groupReply, setGroupReply] = useState<TeamChatMessage | null>(null);
  const loadGroupOwner = useCallback((owner: PostTeamChatInput["coordinator"] | null): void => {
    if (owner == null) return;
    groupOwnerRef.current = owner;
    setSelectedAgentId(owner.agentId);
    if (owner.modelSelection != null) {
      setSelectedModelKey(modelKey(owner.modelSelection));
      setSelectedReasoningOptionKey(owner.modelSelection.reasoning == null ? "auto" : modelReasoningOptionKey(owner.modelSelection.reasoning));
    }
  }, []);
  const [taskListAction, setTaskListAction] = useState<"closing" | null>(null);
  const [taskList, setTaskList] = useState<ConversationTaskList | null>(null);
  const [timeline, setTimeline] = useState<ConversationTimelineItem[]>([]);
  const [timelineHasMore, setTimelineHasMore] = useState(false);
  const [isLoadingOlderTimeline, setIsLoadingOlderTimeline] = useState(false);
  const timelineRef = useRef<ConversationTimelineItem[]>([]);
  const inactiveTimelineDirtyRef = useRef(false);
  const timelineBeforeSequenceRef = useRef<number | null>(null);
  const timelineAfterSequenceRef = useRef<number | null>(null);
  const timelineRevealRequestRef = useRef(0);
  const timelineLoadingOlderRef = useRef(false);
  const timelineOlderLoadPromiseRef = useRef<Promise<void> | null>(null);
  const timelinePagingInitializedRef = useRef(false);
  const timelineLoadRequestIdRef = useRef(0);
  const timelineRevisionRef = useRef(0);
  const [subagentApprovals, setSubagentApprovals] = useState<SubagentPendingApproval[]>([]);
  const dismissedSubagentApprovalIdsRef = useRef(new Set<string>());
  const subagentSessions = useMemo(
    () => relatedSessions.filter((candidate) =>
      candidate.parentConversationId === session.id
      && candidate.threadKind === "subagent"
    ),
    [relatedSessions, session.id],
  );
  const contextUsageRefreshRef = useRef<{ client: AgentClient; queue: ConversationContextUsageRefresh } | null>(null);
  const contextUsageInputKeyRef = useRef<string | null>(null);
  const contextUsageDirtyRef = useRef(true);
  useEffect(() => {
    const refresh = new ConversationContextUsageRefresh(agentClient);
    contextUsageRefreshRef.current = { client: agentClient, queue: refresh };
    contextUsageInputKeyRef.current = null;
    contextUsageDirtyRef.current = true;
    return () => { refresh.dispose(); contextUsageRefreshRef.current = null; };
  }, [agentClient]);
  useEffect(() => {
    if ((!active || usageConversationId === null) && contextUsageRefreshRef.current?.queue.invalidate()) {
      contextUsageDirtyRef.current = true;
    }
  }, [active, usageConversationId]);
  const messagesRef = useRef<HTMLDivElement | null>(null);
  const composerOverlayRef = useRef<HTMLDivElement | null>(null);
  const [composerOverlayHeight, setComposerOverlayHeight] = useState(
    DEFAULT_COMPOSER_CLEARANCE_PX,
  );
  const isReturningToBottomRef = useRef(false);
  const lastKnownScrollTopRef = useRef<number | null>(null);
  const locatedTimelineRequestIdRef = useRef<number | null>(null);
  const locatedTimelineLoadRequestRef = useRef<number | null>(null);
  const shouldStickToBottomRef = useRef(true);
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
  const isEndedSubagent = !teamManaged && session.subagentTaskStatus === "ended";
  const isEditingComposerMessage = editingMessageId !== null || editingPendingMessageId !== null;
  const modelOptions: readonly ModelProfile[] =
    modelStatus?.models.length
      ? modelStatus.models.filter(model => !isImageGenerationModel(model))
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
  const selectedAgent = groupChat !== null || session.agentId === null
    ? enabledAgentProfiles.find((agent) => agent.id === selectedAgentId) ?? defaultAgent ?? enabledAgentProfiles[0]
    : agentProfiles.find((agent) => agent.id === session.agentId);
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
  const usageModelId = activeModel?.modelId;
  const usageProviderId = activeModel?.providerId;
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
    const selection = groupInstanceId !== undefined ? groupOwnerRef.current?.modelSelection ?? session.modelSelection ?? modelStatus?.recentSelection ?? null
      : session.modelSelection ?? modelStatus?.recentSelection ?? null;
    setSelectedModelKey(selection === null
      ? ""
      : modelKey({ modelId: selection.modelId, providerId: selection.providerId }));
    setSelectedReasoningOptionKey(selection?.reasoning === null || selection?.reasoning === undefined
      ? "auto"
      : modelReasoningOptionKey(selection.reasoning));
  }, [
    modelStatus?.recentSelection,
    groupInstanceId,
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
      if (nextPermissionMode === permissionMode) return;
      setPermissionMode(nextPermissionMode);
      setOperationError(null);
      void agentClient.setConversationPermissionMode({
        conversationId: session.id,
        permissionMode: nextPermissionMode,
      }).then((conversation) => {
        setPermissionMode(conversation.permissionMode ?? nextPermissionMode);
        setCoordinationMode(conversation.coordinationMode ?? "direct");
        onSessionUpdated?.(conversation);
      }).catch((error) => {
        setPermissionMode(permissionMode);
        setOperationError(getUserErrorMessage(error, "无法保存对话权限模式"));
      });
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
  }, [
    agentClient,
    isSavingTeamPermission,
    onSessionUpdated,
    permissionMode,
    session.id,
    session.teamWorkItemId,
    teamManaged,
  ]);
  const toggleCoordinationMode = useCallback(async (): Promise<void> => {
    if (isSavingCoordinationMode) return;
    setIsSavingCoordinationMode(true);
    setOperationError(null);
    try {
      const enabling = coordinationMode !== "parallel_queue";
      const conversation = await agentClient.setConversationPermissionMode({
        conversationId: session.id,
        permissionMode: enabling ? "full_access" : permissionMode,
        coordinationMode: enabling ? "parallel_queue" : "direct",
      });
      setCoordinationMode(conversation.coordinationMode ?? "direct");
      setPermissionMode(conversation.permissionMode ?? permissionMode);
      onSessionUpdated?.(conversation);
    } catch (error) {
      setOperationError(getUserErrorMessage(error, "无法切换快速协作模式"));
    } finally {
      setIsSavingCoordinationMode(false);
    }
  }, [agentClient, coordinationMode, isSavingCoordinationMode, onSessionUpdated, permissionMode, session.id]);
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
    () => mentionQuery === null
      ? null
      : parseProjectMentionQuery(mentionQuery.query),
    [mentionQuery],
  );

  const loadContextUsage = useCallback((): void => {
    const refresh = contextUsageRefreshRef.current;
    if (!active || usageConversationId === null || refresh === null || refresh.client !== agentClient) return;
    const input = {
      conversationId: usageConversationId,
      ...(usageModelId === undefined ? {} : { modelId: usageModelId }),
      ...(usageProviderId === undefined ? {} : { providerId: usageProviderId }),
      permissionMode,
      ...(groupInstanceId === undefined ? { attachmentIds: draftAttachments.map((attachment) => attachment.id) } : {}),
      ...(groupInstanceId !== undefined || selectedConversationMentions.length === 0
        ? {}
        : {
          referencedConversationIds: selectedConversationMentions.map((mention) => mention.id),
        }),
      ...(groupInstanceId !== undefined || activeProjectFileMentions.length === 0
        ? {}
        : {
          referencedProjectPaths: activeProjectFileMentions.map((mention) => mention.path),
        }),
    };
    const inputKey = JSON.stringify(input);
    if (!contextUsageDirtyRef.current && contextUsageInputKeyRef.current === inputKey) return;
    contextUsageInputKeyRef.current = inputKey;
    contextUsageDirtyRef.current = false;
    refresh.queue.request(input, nextUsage => {
      setContextUsageMeasurement({ conversationId: usageConversationId, usage: nextUsage });
      // Keep the entire last completed measurement stable while the next request streams.
      if (nextUsage.providerCache?.latest != null) {
        setLastProviderUsage({ conversationId: usageConversationId, usage: nextUsage });
      }
    }, () => {
      contextUsageDirtyRef.current = true;
      setContextUsageMeasurement(null);
    });
  }, [
    active,
    groupInstanceId,
    usageModelId,
    usageProviderId,
    activeProjectFileMentions,
    agentClient,
    draftAttachments,
    permissionMode,
    selectedConversationMentions,
    usageConversationId,
  ]);

  useEffect(() => {
    if (!active || groupInstanceId === undefined || groupUsageConversation?.instanceId === groupInstanceId) return;
    let disposed = false;
    void agentClient.getTeamChatCoordinationConversation({ teamInstanceId: groupInstanceId }).then(conversation => {
      if (!disposed) setGroupUsageConversation({ instanceId: groupInstanceId, conversationId: conversation.id });
    }).catch(reason => { if (!disposed) setOperationError(getUserErrorMessage(reason, "无法读取群聊协调对话")); });
    return () => { disposed = true; };
  }, [active, agentClient, groupInstanceId, groupUsageConversation?.instanceId]);

  useEffect(() => {
    if (groupInstanceId === undefined || usageConversationId === null) return;
    return agentClient.onConversationRunEvent(event => {
      const groupChanged = event.type === "collaboration.changed" && event.teamInstanceId === groupInstanceId;
      const ownerChanged = "conversationId" in event && event.conversationId === usageConversationId
        && (event.type === "run.finished" || event.type === "model.request_started" || event.type === "tool.completed");
      if (!groupChanged && !ownerChanged) return;
      contextUsageDirtyRef.current = true;
      if (active) void Promise.resolve().then(loadContextUsage);
    }, []);
  }, [active, agentClient, groupInstanceId, usageConversationId, loadContextUsage]);

  const loadTimeline = useCallback(async (forceLatest = false): Promise<void> => {
    if (!forceLatest && timelineAfterSequenceRef.current !== null) return;
    const conversationId = session.id;
    const requestId = ++timelineLoadRequestIdRef.current;
    const timelineRevision = timelineRevisionRef.current;
    let retryAfterConcurrentEvent = false;
    try {
      const page = await agentClient.listConversationTimelinePage({
        conversationId,
        limit: TIMELINE_PAGE_SIZE,
      });
      if (shouldApplyTimelineLoad(
        requestId,
        timelineLoadRequestIdRef.current,
        timelineRevision,
        timelineRevisionRef.current,
      )) {
        const initializesPaging = !timelinePagingInitializedRef.current;
        const resetsPaging = forceLatest || shouldResetTimelinePaging(timelineRef.current, page.items);
        timelineRevisionRef.current += 1;
        setTimeline((current) => {
          const nextTimeline = mergeLatestTimelinePage(current, page.items, resetsPaging);
          timelineRef.current = nextTimeline;
          return nextTimeline;
        });
        if (initializesPaging || resetsPaging) {
          timelinePagingInitializedRef.current = true;
          timelineBeforeSequenceRef.current = page.nextBeforeSequence;
          timelineAfterSequenceRef.current = page.nextAfterSequence ?? null;
          setTimelineHasMore(page.hasMore);
        }
      } else if (
        requestId === timelineLoadRequestIdRef.current
        && timelineRevision !== timelineRevisionRef.current
      ) {
        retryAfterConcurrentEvent = true;
      }
    } catch {
      if (requestId === timelineLoadRequestIdRef.current) {
        setOperationError("无法加载对话记录");
      }
    } finally {
      if (requestId === timelineLoadRequestIdRef.current) {
        if (retryAfterConcurrentEvent) {
          void Promise.resolve().then(() => loadTimeline());
        } else {
          setIsLoadingTimeline(false);
        }
      }
    }
  }, [agentClient, session.id]);

  const loadOlderTimeline = useCallback(async (): Promise<void> => {
    const existingLoad = timelineOlderLoadPromiseRef.current;
    if (existingLoad !== null) return existingLoad;
    const beforeSequence = timelineBeforeSequenceRef.current;
    const messages = messagesRef.current;
    if (
      beforeSequence === null
      || messages === null
      || timelineLoadingOlderRef.current
      || !timelineHasMore
    ) return;
    const operation = (async (): Promise<void> => {
      timelineLoadingOlderRef.current = true;
      setIsLoadingOlderTimeline(true);
      const previousScrollHeight = messages.scrollHeight;
      const previousScrollTop = messages.scrollTop;
      const navigationRequest = timelineRevealRequestRef.current;
      try {
        const page = await agentClient.listConversationTimelinePage({
          beforeSequence,
          conversationId: session.id,
          limit: TIMELINE_PAGE_SIZE,
        });
        if (navigationRequest !== timelineRevealRequestRef.current) return;
        timelineBeforeSequenceRef.current = page.nextBeforeSequence;
        setTimelineHasMore(page.hasMore);
        timelineRevisionRef.current += 1;
        setTimeline((current) => {
          const next = prependTimelinePage(current, page.items);
          timelineRef.current = next;
          return next;
        });
        window.requestAnimationFrame(() => {
          const currentMessages = messagesRef.current;
          if (currentMessages !== messages) return;
          currentMessages.scrollTop = previousScrollTop
            + currentMessages.scrollHeight
            - previousScrollHeight;
        });
      } catch {
        setOperationError("无法加载更早的对话记录");
      } finally {
        timelineLoadingOlderRef.current = false;
        setIsLoadingOlderTimeline(false);
      }
    })();
    timelineOlderLoadPromiseRef.current = operation;
    try {
      await operation;
    } finally {
      if (timelineOlderLoadPromiseRef.current === operation) {
        timelineOlderLoadPromiseRef.current = null;
      }
    }
  }, [agentClient, session.id, timelineHasMore]);

  const revealTimelineSearchResult = useCallback(async (
    result: Pick<ConversationSearchResult, "conversationId" | "itemId">,
  ): Promise<void> => {
    const revealRequest = ++timelineRevealRequestRef.current;
    const existingLoad = timelineOlderLoadPromiseRef.current;
    if (existingLoad !== null) await existingLoad;
    if (
      revealRequest !== timelineRevealRequestRef.current
      ||
      result.conversationId !== session.id
      || timelineRef.current.some((item) => item.id === result.itemId)
    ) return;
    const operation = (async (): Promise<void> => {
      timelineLoadingOlderRef.current = true;
      setIsLoadingOlderTimeline(true);
      try {
        ++timelineLoadRequestIdRef.current;
        const page = await agentClient.listConversationTimelinePage({
          aroundItemId: result.itemId, conversationId: session.id, limit: TIMELINE_PAGE_SIZE,
        });
        if (revealRequest !== timelineRevealRequestRef.current) return;
        shouldStickToBottomRef.current = false;
        timelineBeforeSequenceRef.current = page.nextBeforeSequence;
        timelineAfterSequenceRef.current = page.nextAfterSequence ?? null;
        setTimelineHasMore(page.hasMore);
        timelineRevisionRef.current += 1;
        timelineRef.current = page.items;
        setTimeline(page.items);
      } finally {
        timelineLoadingOlderRef.current = false;
        setIsLoadingOlderTimeline(false);
      }
    })();
    timelineOlderLoadPromiseRef.current = operation;
    try {
      await operation;
    } catch {
      setOperationError("无法加载搜索结果所在的对话记录");
    } finally {
      if (timelineOlderLoadPromiseRef.current === operation) {
        timelineOlderLoadPromiseRef.current = null;
      }
    }
  }, [agentClient, session.id]);

  const loadNewerTimeline = useCallback(async (): Promise<void> => {
    const afterSequence = timelineAfterSequenceRef.current;
    if (afterSequence === null || timelineLoadingOlderRef.current) return;
    const operation = (async () => {
      timelineLoadingOlderRef.current = true;
      const navigationRequest = timelineRevealRequestRef.current;
      try {
        const page = await agentClient.listConversationTimelinePage({
          afterSequence, conversationId: session.id, limit: TIMELINE_PAGE_SIZE,
        });
        if (navigationRequest !== timelineRevealRequestRef.current) return;
        timelineAfterSequenceRef.current = page.nextAfterSequence ?? null;
        timelineRevisionRef.current += 1;
        setTimeline((current) => {
          const next = mergeLatestTimelinePage(current, page.items);
          timelineRef.current = next;
          return next;
        });
      } catch {
        setOperationError("无法加载后续的对话记录");
      } finally {
        timelineLoadingOlderRef.current = false;
      }
    })();
    timelineOlderLoadPromiseRef.current = operation;
    try { await operation; } finally {
      if (timelineOlderLoadPromiseRef.current === operation) timelineOlderLoadPromiseRef.current = null;
    }
  }, [agentClient, session.id]);

  const searchConversationTimeline = useCallback(
    (query: string, beforeSequence?: number) => agentClient.searchConversations({
      ...(beforeSequence === undefined ? {} : { beforeSequence }),
      conversationId: session.id,
      limit: 100,
      query,
    }),
    [agentClient, session.id],
  );

  useEffect(() => {
    if (!active) return;
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
        const page = await agentClient.listConversationTimelinePage({
          conversationId: subagent.id,
          limit: 200,
        });
        return [subagent.id, page.items] as const;
      } catch {
        return [subagent.id, [] as ConversationTimelineItem[]] as const;
      }
    })).then((entries) => {
      if (disposed) return;
      setSubagentApprovals(collectSubagentPendingApprovals(
        activeSubagents,
        new Map(entries),
      ).filter((approval) => !dismissedSubagentApprovalIdsRef.current.has(approval.tool.id)));
    });

    return () => {
      disposed = true;
    };
  }, [active, agentClient, subagentSessions]);

  const loadTaskList = useCallback(async (): Promise<void> => {
    if (groupInstanceId !== undefined) return;
    try {
      setTaskList(await agentClient.getConversationTaskList({ conversationId: session.id }));
    } catch {
      setTaskList(null);
    }
  }, [agentClient, session.id, groupInstanceId]);

  const loadPendingMessages = useCallback(async (): Promise<void> => {
    if (groupInstanceId !== undefined) return;
    try {
      const [messages, paused] = await Promise.all([
        agentClient.listConversationPendingMessages({ conversationId: session.id }),
        agentClient.getConversationPendingQueuePaused({ conversationId: session.id }),
      ]);
      setPendingMessages(messages);
      setPendingQueuePaused(paused);
    } catch {
      setPendingMessages([]);
    }
  }, [agentClient, session.id, groupInstanceId]);

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
    if (groupInstanceId === undefined) void Promise.resolve().then(() => loadTimeline());
  }, [loadTimeline, groupInstanceId]);

  useEffect(() => {
    if (!active || groupInstanceId !== undefined || !inactiveTimelineDirtyRef.current) return;
    inactiveTimelineDirtyRef.current = false;
    void loadTimeline();
    void loadTaskList();
    void loadContextUsage();
    void loadPendingMessages();
  }, [active, groupInstanceId, loadTimeline, loadTaskList, loadContextUsage, loadPendingMessages]);

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
    if (!teamManaged) setPermissionMode(session.permissionMode ?? defaultPermissionMode);
  }, [defaultPermissionMode, session.id, session.permissionMode, teamManaged]);

  useEffect(() => {
    setCoordinationMode(session.coordinationMode ?? "direct");
  }, [session.id, session.coordinationMode]);

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
    if (groupInstanceId !== undefined) {
      void agentClient.getTeamChatMembers({ teamInstanceId: groupInstanceId }).then(members => {
        if (!disposed) setGroupMentionRoster({ instanceId: groupInstanceId, members });
      }).catch(() => {
        if (!disposed) setGroupMentionRoster({ instanceId: groupInstanceId, members: [] });
      });
      return () => { disposed = true; };
    }
    void agentClient.listConversationHierarchy()
      .then((conversations) => {
        if (disposed) return;
        setAvailableConversationMentions(
          conversations
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
  }, [agentClient, session.id, groupInstanceId, isGroupMentionOpen]);

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
    const runId = session.activeRunId;
    if (runId === null || timeline.length === 0) return;
    const startedAt = timeline
      .filter((item) => "runId" in item && item.runId === runId)
      .map((item) => Date.parse(item.createdAt))
      .filter(Number.isFinite)
      .sort((left, right) => left - right)[0];
    if (startedAt === undefined) return;
    setRunProgresses((current) => current.map((progress) =>
      progress.runId === runId && progress.startedAt !== startedAt
        ? { ...progress, startedAt }
        : progress,
    ));
  }, [session.activeRunId, timeline]);

  useEffect(() => {
    if (groupInstanceId !== undefined) return;
    return agentClient.onConversationRunEvent((event) => {
      if (!active) {
        if ("conversationId" in event && (event.conversationId === session.id || subagentSessions.some(item => item.id === event.conversationId))) {
          inactiveTimelineDirtyRef.current = true;
          contextUsageDirtyRef.current = true;
        }
        return;
      }
      const sourceSubagent = "conversationId" in event
        ? subagentSessions.find((candidate) => candidate.id === event.conversationId)
        : undefined;
      if (event.type === "tool.approval_requested" && sourceSubagent !== undefined) {
        setSubagentApprovals((current) => [
          ...current.filter((approval) => approval.tool.id !== event.tool.id),
          {
            childAvatarIcon: sourceSubagent.avatarIcon ?? null,
            childConversationId: sourceSubagent.id,
            childTitle: sourceSubagent.title,
            tool: event.tool,
          },
        ]);
      }
      if (
        (event.type === "tool.started" || event.type === "tool.completed")
        && sourceSubagent !== undefined
      ) {
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
        return;
      }
      if (event.type === "pending_messages.updated" && event.conversationId === session.id) {
        const consumedMessages = event.consumedMessages;
        if (consumedMessages !== undefined) {
          timelineRevisionRef.current += 1;
          setTimeline((current) => {
            const next = consumedMessages.reduce(upsertTimelineItem, current);
            timelineRef.current = next;
            return next;
          });
        }
        setPendingMessages(event.pendingMessages);
        if (event.queuePaused !== undefined) setPendingQueuePaused(event.queuePaused);
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
      if (event.type === "conversation.open_requested" || event.conversationId !== session.id) {
        return;
      }
      if (event.type === "collaboration.changed" && session.coordinationTeamInstanceId !== undefined
        && session.coordinationTeamInstanceId === event.teamInstanceId) {
        timelineRevisionRef.current += 1;
        void loadTimeline();
        return;
      }

      timelineRevisionRef.current += 1;
      handleRunEvent(
        event,
        timelineAfterSequenceRef.current === null ? setTimeline : () => undefined,
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
      if (
        event.type !== "assistant.delta"
        && event.type !== "assistant.reasoning_delta"
        && event.type !== "tool.output_delta"
        && event.type !== "model.retry_updated"
      ) {
        contextUsageDirtyRef.current = true;
        void loadContextUsage();
      }
    }, active ? [session.id] : []);
  }, [
    active,
    groupInstanceId,
    agentClient,
    loadContextUsage,
    loadTaskList,
    loadTimeline,
    session.id,
    session.coordinationTeamInstanceId,
    subagentSessions,
  ]);

  const handleMessagesScroll = useCallback((): void => {
    const messages = messagesRef.current;
    if (messages === null || !active) return;
    lastKnownScrollTopRef.current = messages.scrollTop;
    const isAtBottom = timelineAfterSequenceRef.current === null && isConversationScrolledToBottom(messages);
    if (isReturningToBottomRef.current) {
      isReturningToBottomRef.current = !isAtBottom;
      shouldStickToBottomRef.current = true;
      setIsScrolledAwayFromBottom(!isAtBottom);
      return;
    }
    shouldStickToBottomRef.current = isAtBottom;
    setIsScrolledAwayFromBottom(!isAtBottom);
    const prefetchDistance = Math.max(
      600,
      messages.clientHeight * TIMELINE_PREFETCH_VIEWPORTS,
    );
    if (messages.scrollTop <= prefetchDistance) void loadOlderTimeline();
    if (messages.scrollHeight - messages.clientHeight - messages.scrollTop <= prefetchDistance) void loadNewerTimeline();
  }, [active, loadOlderTimeline, loadNewerTimeline]);

  const handleScrollToBottom = useCallback((): void => {
    const messages = messagesRef.current;
    if (messages === null) return;
    isReturningToBottomRef.current = true;
    shouldStickToBottomRef.current = true;
    if (timelineAfterSequenceRef.current !== null) {
      ++timelineRevealRequestRef.current;
      void loadTimeline(true);
      return;
    }
    messages.scrollTo({
      behavior: "smooth",
      left: 0,
      top: messages.scrollHeight,
    });
  }, [loadTimeline]);

  const handleTimelineDisclosureInteraction = useCallback((event: MouseEvent<HTMLDivElement>): void => {
    const messages = messagesRef.current;
    if (!active || messages === null || !(event.target instanceof Element)) return;
    const disclosure = event.target.closest("button[aria-expanded]");
    if (disclosure === null || !messages.contains(disclosure)) return;
    // Capture the position before child disclosure state changes grow the timeline.
    shouldStickToBottomRef.current = timelineAfterSequenceRef.current === null
      && isConversationScrolledToBottom(messages);
    setDisclosureRevision((current) => current + 1);
  }, [active]);

  const handleHtmlGalleryResize = useCallback((): void => {
    const messages = messagesRef.current;
    if (!active || messages === null || !shouldStickToBottomRef.current || timelineAfterSequenceRef.current !== null) return;
    scrollConversationToBottom(messages);
  }, [active]);

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

  const markVisibleResult = useCallback((): void => {
    const messages = messagesRef.current;
    if (active && !isLoadingTimeline && session.hasUnreadResult
      && document.visibilityState === "visible" && document.hasFocus() && messages !== null
      && messages.clientHeight > 0 && isConversationScrolledToBottom(messages)) onViewed?.();
  }, [active, isLoadingTimeline, onViewed, session.hasUnreadResult]);

  useEffect(() => {
    if (!active || isLoadingTimeline || !session.hasUnreadResult) return;
    const frame = window.requestAnimationFrame(markVisibleResult);
    window.addEventListener("focus", markVisibleResult);
    document.addEventListener("visibilitychange", markVisibleResult);
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("focus", markVisibleResult);
      document.removeEventListener("visibilitychange", markVisibleResult);
    };
  }, [active, isLoadingTimeline, isScrolledAwayFromBottom, markVisibleResult, session.hasUnreadResult]);

  useLayoutEffect(() => {
    const messages = messagesRef.current;
    if (!active || messages === null || !shouldStickToBottomRef.current) return;

    const scrollToBottom = (): void => {
      if (shouldStickToBottomRef.current) scrollConversationToBottom(messages);
    };
    scrollToBottom();
    const animationFrame = window.requestAnimationFrame(scrollToBottom);
    return () => window.cancelAnimationFrame(animationFrame);
  }, [active, composerOverlayHeight, disclosureRevision, isLoadingTimeline, modelActivity, operationError, pendingMessages, taskList, timeline]);

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
    if (message.id !== latestUserMessageId || isEndedSubagent) return;
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
  }, [isEndedSubagent, latestUserMessageId]);

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
    if (isEndedSubagent) return;
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
  }, [isEndedSubagent]);

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
      isAddingAttachments ||
      isEndedSubagent ||
      (editingPendingMessageId === null
        && !isMockRuntime
        && modelStatus?.configured === false)
    ) {
      return;
    }

    if (groupChat !== null) {
      setIsSending(true); setOperationError(null);
      try {
        if (draftAttachments.length > 0) throw new Error("群聊附件发送尚未接入，附件已保留。可先在成员对话中发送。");
        const roster = await agentClient.getTeamChatMembers({ teamInstanceId: groupChat.instanceId });
        const body = { teamInstanceId: groupChat.instanceId, content, intent: "request" as const,
          allMembers: findComposerReferenceRanges(content, ["@全体成员"]).length > 0,
          recipientConversationIds: selectedConversationMentions.map(item => item.id).filter(id => roster.some(member => member.conversationId === id)),
          supersedesId: editingMessageId,
          replyToId: groupReply?.id ?? null,
          ...(selectedAgent === undefined ? {} : { coordinator: { agentId: selectedAgent.id,
            modelSelection: activeModel === undefined ? null : { providerId: activeModel.providerId, modelId: activeModel.modelId, reasoning: selectedReasoningOption ?? null } } }) };
        const fingerprint = JSON.stringify(body);
        if (groupRequestRef.current?.fingerprint !== fingerprint) groupRequestRef.current = { fingerprint, id: crypto.randomUUID() };
        await agentClient.postTeamChat({ ...body, requestId: groupRequestRef.current.id });
        groupRequestRef.current = null;
        setComposerValue(""); setGroupReply(null); setEditingMessageId(null); setEditingAttachments(null); setMentionQuery(null); setSlashQuery(null); setSelectedConversationMentions([]);
        setSelectedTeamMentions([]); setSelectedProjectFileMentions([]);
      } catch (error) { setOperationError(getUserErrorMessage(error, "群消息发送失败")); }
      finally { setIsSending(false); refocusComposer(); }
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
      contextUsageDirtyRef.current = true;
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
      || isEndedSubagent
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
      contextUsageDirtyRef.current = true;
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
    if (isAddingAttachments || isSending || isEndedSubagent) return;
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
    isEndedSubagent,
    session.id,
  ]);

  const handlePasteAttachments = useCallback(
    (event: ReactClipboardEvent<HTMLTextAreaElement>): void => {
      const files = getClipboardAttachmentFiles(event.clipboardData);
      if (
        isMockRuntime
        || isSending
        || isEndedSubagent
        || isAddingAttachments
        || editingPendingMessageId !== null
      ) {
        return;
      }
      const pastedText = files.length === 0 ? event.clipboardData.getData("text/plain") : null;
      const textAttachment = pastedText === null ? null : createPastedTextAttachment(pastedText);
      if (textAttachment !== null) files.push(textAttachment);
      if (files.length === 0) return;
      // Text can still paste normally if an attachment limit prevents its import.
      if (pastedText === null) event.preventDefault();

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
      event.preventDefault();
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
          if (pastedText !== null) {
            setComposerValue(current => current.length === 0 ? pastedText : `${current}\n${pastedText}`);
            setMentionQuery(null);
            setSlashQuery(null);
          }
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
      isEndedSubagent,
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
    if (mentionQuery === null) return [];
    const options: MentionOption[] = [];
    const normalizedQuery = mentionQuery.query.toLocaleLowerCase();
    if (groupChat !== null) {
      if (groupMentionRoster?.instanceId !== groupChat.instanceId
        || mentionQuery.query.includes("/")) return [];
      if ("全体成员".includes(normalizedQuery) && findComposerReferenceRanges(composerValue, ["@全体成员"]).length === 0) options.push({ kind: "all", value: { id: "all-members", name: "全体成员" } });
      if (selectedConversationMentions.length >= MAX_SELECTED_CONVERSATION_MENTIONS) return options;
      return [...options, ...groupMentionRoster.members.filter(member => !member.isArchived
        && member.name.toLocaleLowerCase().includes(normalizedQuery)
        && !selectedConversationMentions.some(selected => selected.id === member.conversationId))
        .flatMap((member): MentionOption[] => {
          const conversation = relatedSessions.find(candidate => candidate.id === member.conversationId);
          return conversation === undefined ? [] : [{ kind: "conversation", member,
            value: { ...conversation, title: member.name } }];
        })].slice(0, 12);
    }
    const canMentionTeams = session.parentConversationId === null
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
        .slice(0, 8)
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
      const conversations = [...new Map([
        ...relatedSessions.filter((candidate) => candidate.parentConversationId === session.id && !candidate.isArchived),
        ...availableConversationMentions,
      ].map((candidate) => [candidate.id, candidate])).values()];
      options.push(...conversations
        .filter((conversation) =>
          !selectedConversationMentions.some((selected) => selected.id === conversation.id)
          && conversation.title.toLocaleLowerCase().includes(normalizedQuery)
        )
        .slice(0, 12)
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
        .slice(0, 24)
        .map((entry): MentionOption => ({
          kind: entry.kind === "directory" ? "directory" : "file",
          value: {
            name: entry.name,
            path: entry.path,
            workspaceId: referenceWorkspaceId,
          },
        })));
    }
    const groupOrder = ["conversation", "team", "directory", "file"];
    return options.sort((a, b) => groupOrder.indexOf(a.kind) - groupOrder.indexOf(b.kind));
  }, [
    composerValue,
    activeProjectFileMentions,
    availableConversationMentions,
    mentionQuery,
    projectMentionListing,
    projectMentionLocation,
    referenceWorkspaceId,
    relatedSessions,
    selectedConversationMentions,
    selectedTeamMentions,
    session.id,
    session.parentConversationId,
    session.projectId,
    session.threadKind,
    teamManaged,
    teamInstances,
    groupChat,
    groupMentionRoster,
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
      .sort((left, right) => Number(left.origin === "system") - Number(right.origin === "system"))
      .map((skill) => ({ kind: "skill", value: skill }));
    return [...commands, ...skills];
  }, [selectedAgent, session.projectId, session.teamId, slashQuery, slashSkills]);

  const composerReferences = findComposerReferenceRanges(composerValue, [
    ...(groupChat === null ? [] : ["@全体成员"]),
    ...selectedConversationMentions.map((mention) => `@${mention.title}`),
    ...selectedTeamMentions.map((mention) => `@${mention.name}`),
    ...activeProjectFileMentions.map((mention) => `@${mention.path}`),
    ...SLASH_COMMANDS.map((command) => `/${command.name}`),
    ...slashSkills.map((skill) => `/${skill.id}`),
  ]);
  const changeComposerValue = useCallback((nextValue: string, caret: number): void => {
    const contains = (label: string): boolean => findComposerReferenceRanges(nextValue, [label]).length > 0;
    setSelectedConversationMentions((current) => current.filter((mention) => contains(`@${mention.title}`)));
    setSelectedTeamMentions((current) => current.filter((mention) => contains(`@${mention.name}`)));
    setSelectedProjectFileMentions((current) => current.filter((mention) => contains(`@${mention.path}`)));
    setComposerValue(nextValue);
    const nextMentionQuery = findMentionQuery(nextValue, caret);
    setMentionQuery(nextMentionQuery);
    setSlashQuery(nextMentionQuery === null ? findSlashQuery(nextValue, caret) : null);
    setMentionSelectionIndex(0);
  }, []);

  const selectMention = useCallback((option: MentionOption): void => {
    if (mentionQuery === null) return;
    const insertedText = option.kind === "directory"
      ? `@${option.value.path}/`
      : `@${option.kind === "conversation"
        ? option.value.title
        : option.kind === "team" || option.kind === "all" ? option.value.name : option.value.path} `;
    const nextValue = `${composerValue.slice(0, mentionQuery.start)}${insertedText}${composerValue.slice(mentionQuery.end)}`;
    const nextCaret = mentionQuery.start + insertedText.length;
    changeComposerValue(nextValue, nextCaret);
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
  }, [changeComposerValue, composerValue, mentionQuery]);

  const selectSlashOption = useCallback((option: SlashOption): void => {
    if (slashQuery === null) return;
    const optionName = option.kind === "skill" ? option.value.id : option.value.name;
    const insertedText = `/${optionName} `;
    const nextValue = `${composerValue.slice(0, slashQuery.start)}${insertedText}${composerValue.slice(slashQuery.end)}`;
    const nextCaret = slashQuery.start + insertedText.length;
    changeComposerValue(nextValue, nextCaret);
    setMentionQuery(null);
    setSlashQuery(null);
    setMentionSelectionIndex(0);
    queueMicrotask(() => {
      composerRef.current?.focus();
      composerRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
  }, [changeComposerValue, composerValue, slashQuery]);

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

  useEffect(() => {
    composerRef.current?.closest('.conversation-workspace__composer')?.querySelector<HTMLElement>(
      '.conversation-mention-menu [aria-selected="true"]',
    )?.scrollIntoView?.({ block: "nearest" });
  }, [mentionSelectionIndex]);

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
    if ((activeRunId === null && activeSubagentCount === 0) || isCancelling) {
      return;
    }

    setIsCancelling(true);
    setOperationError(null);
    try {
      await agentClient.cancelRun({ conversationId: session.id });
      setIsCancelling(false);
    } catch {
      setIsCancelling(false);
      setOperationError("无法停止当前任务");
    }
  }, [activeRunId, activeSubagentCount, agentClient, isCancelling, session.id]);

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
    const queuedMessages = pendingMessages.filter((message) => message.deliveryMode === "queue");
    if (
      pendingMessageIds.length !== queuedMessages.length
      || pendingMessageIds.every((id, index) => id === queuedMessages[index]?.id)
    ) return;
    const messagesById = new Map(pendingMessages.map((message) => [message.id, message]));
    if (new Set(pendingMessageIds).size !== queuedMessages.length
      || pendingMessageIds.some((id) => messagesById.get(id)?.deliveryMode !== "queue")) return;
    let queueIndex = 0;
    const next = pendingMessages.map((message) => message.deliveryMode === "steer"
      ? message : messagesById.get(pendingMessageIds[queueIndex++]!)!);
    const previous = pendingMessages;
    setPendingMessages(next);
    setPendingMessageActionId(pendingMessageId);
    setOperationError(null);
    try {
      setPendingMessages(await agentClient.reorderConversationPendingMessages({
        conversationId: session.id,
        pendingMessageIds: next.map((message) => message.id),
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
        dismissedSubagentApprovalIdsRef.current.add(tool.id);
        setSubagentApprovals((current) => current.filter(
          (approval) => approval.tool.id !== tool.id,
        ));
      } catch (error) {
        const errorCode = error instanceof AgentClientError
          ? error.code
          : parseSerializedAgentError(error)?.code;
        if (errorCode === "APPROVAL_EXPIRED") {
          dismissedSubagentApprovalIdsRef.current.add(tool.id);
          setSubagentApprovals((current) => current.filter(
            (approval) => approval.tool.id !== tool.id,
          ));
          await Promise.all([
            loadTimeline(),
            onRefreshSessions?.(),
          ]);
          return;
        }
        setApprovalErrors((current) => ({
          ...current,
          [tool.id]: getUserErrorMessage(error, "无法提交文件变更决定"),
        }));
      } finally {
        setApprovingToolId(null);
      }
    },
    [agentClient, approvingToolId, loadTimeline, onRefreshSessions],
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
  const shouldShowStopButton = groupChat === null && isRunning && !isEditingComposerMessage;
  const subagentConversationIds = useMemo(
    () => new Set([session, ...relatedSessions]
      .filter((candidate) => candidate.threadKind === "subagent")
      .map((candidate) => candidate.id)),
    [relatedSessions, session],
  );
  let displayTimeline = groupRunActivities(
    projectSubagentMessagesForParentTimeline(timeline, subagentConversationIds),
  );
  const activityRunId = modelActivity?.runId;
  if (activityRunId != null && activityRunId === activeRunId
    && !displayTimeline.some(item => item.kind === "run_activity" && item.runIds.includes(activityRunId))) {
    displayTimeline.splice(getModelActivityInsertIndex(displayTimeline, activityRunId, modelActivity?.anchorTimelineItemId ?? null), 0, {
      id: `run-activity:${activityRunId}`, kind: "run_activity", runId: activityRunId,
      runIds: [activityRunId], items: [], durationMs: null, streaming: false,
    });
    displayTimeline = combineAutomaticContinuationDurations(displayTimeline);
  }
  const htmlDeliveries = htmlPresentationDeliveries(timeline, displayTimeline, activeRunId);
  const imageDeliveries = imageGenerationDeliveries(timeline, displayTimeline);
  const artifacts = useMemo(() => conversationArtifacts(timeline, agentClient, { cacheTtlMs: CONVERSATION_WORKSPACE_CACHE_TTL_MS, onResize: handleHtmlGalleryResize }), [timeline, agentClient, handleHtmlGalleryResize]);
  const artifactContents = useMemo(() => new Map([...artifacts].map(([ref, artifact]) => [ref, artifact.content])), [artifacts]);
  const referencedArtifactTools = new Set(displayTimeline.flatMap(item => item.kind !== "message" || item.role !== "assistant" ? []
    : (item.continuationMessages ?? [item]).flatMap(message => [...standaloneArtifactReferences(message.content, message.status === "streaming")]
      .flatMap(ref => artifacts.has(ref) ? [artifacts.get(ref)!.toolId] : []))));
  const hasHtmlGallery = [...htmlDeliveries.values()].some(deliveries => deliveries.some(delivery => "pages" in delivery));
  const locateQuestion = async (question: UserQuestion): Promise<void> => {
    try {
      const visibleTool = question.conversationId === session.id
        ? questionToolForAnswer(timeline, question) : null;
      const tool = visibleTool ?? questionToolForAnswer(
        await agentClient.listConversationTimeline({ conversationId: question.conversationId }), question,
      );
      if (tool === null) throw new Error("Question tool not found");
      onLocateConversationItem?.(question.conversationId, tool.id);
    } catch { setOperationError("无法定位这条提问。"); }
  };
  const queuedMessages = pendingMessages.filter((message) => message.deliveryMode === "queue");
  // Pending records are durable sent input, but are not a model/timer boundary until consumed.
  const sentSteerMessages = pendingMessages.filter((message) => message.deliveryMode === "steer"
    && !timeline.some((item) => item.id === message.id));
  const forceableCompactionId = forceableContextCompactionId(timeline, activeRunId);
  const displayRunProgresses = useMemo(() => runProgresses.map((progress) =>
    scopeRunProgressToLatestInput(progress, timeline)), [runProgresses, timeline]);
  const runningContextCompactionRunIds = new Set(
    displayTimeline.flatMap((item) =>
      item.kind === "tool" && isRunningContextCompaction(item) && item.runId !== null
        ? [item.runId]
        : [],
    ),
  );
  const latestInputIndex = getConversationRunProgressInsertIndex(displayTimeline,
    displayRunProgresses.find(progress => progress.runId === activeRunId)?.anchorTimelineItemId ?? null);
  const currentRunActivityIndex = activeRunId === null && displayRunProgresses.some(progress => progress.runId === null)
    ? -1 : displayTimeline.findLastIndex((item, index) =>
    index >= latestInputIndex && item.kind === "run_activity"
    && (activeRunId === null ? item.streaming
      : item.runIds.includes(activeRunId) && !runningContextCompactionRunIds.has(activeRunId)));
  useEffect(() => {
    if (locateTimelineItem === null || isLoadingTimeline
      || locatedTimelineLoadRequestRef.current === locateTimelineItem.requestId) return;
    locatedTimelineLoadRequestRef.current = locateTimelineItem.requestId;
    void revealTimelineSearchResult({ conversationId: session.id, itemId: locateTimelineItem.id });
  }, [isLoadingTimeline, locateTimelineItem, revealTimelineSearchResult, session.id]);

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
  const latestRunItem = activeRunId === null ? undefined : timeline.findLast((item) => item.runId === activeRunId
    && (item.kind === "tool" || (item.kind === "message" && item.role === "assistant"
      && stripLeadingThinkingSummary(item.content).trim().length > 0)));
  const currentToolId = latestRunItem?.kind === "tool" ? latestRunItem.id : null;
  const tailRunId = activeRunId ?? modelActivity?.runId ?? null;
  const tailActivity = displayTimeline[currentRunActivityIndex];
  const tailTool = tailActivity?.kind === "run_activity" ? tailActivity.items.findLast(item =>
    item.kind === "tool" && item.runId === tailRunId
    && (item.status === "running" || item.status === "awaiting_approval")) : undefined;
  const tailWorkPhase = tailTool?.kind === "tool"
    ? tailTool.status === "awaiting_approval" ? "waiting" : toolWorkPhase(tailTool.name)
    : latestRunItem?.kind === "message" && latestRunItem.status === "streaming"
      ? "writing" : "thinking";
  const showWorkTail = (displayRunProgresses.length > 0 || modelActivity !== null || currentRunActivityIndex >= 0)
    && (tailRunId === null || !runningContextCompactionRunIds.has(tailRunId));
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
    for (const progress of displayRunProgresses) {
      const inputIndex = getConversationRunProgressInsertIndex(
        displayTimeline,
        progress.anchorTimelineItemId,
      );
      const insertIndex = progress.runId === activeRunId && currentRunActivityIndex >= inputIndex
        ? currentRunActivityIndex
        : progress.runId === null || !displayTimeline.some(item => "runId" in item && item.runId === progress.runId)
          ? displayTimeline.length : inputIndex;
      const items = progressByIndex.get(insertIndex) ?? [];
      items.push(progress);
      progressByIndex.set(insertIndex, items);
    }
    return progressByIndex;
  }, [displayTimeline, displayRunProgresses, activeRunId, currentRunActivityIndex]);
  const modelActivityInsertIndex = modelActivity === null
    ? -1
    : Math.max(modelActivity.runId === activeRunId ? currentRunActivityIndex : -1, getModelActivityInsertIndex(
        displayTimeline,
        modelActivity.runId,
        displayRunProgresses.find((progress) => progress.runId === modelActivity.runId)
          ?.anchorTimelineItemId
          ?? modelActivity.anchorTimelineItemId,
      ));
  const showModelActivityIndicator = modelActivity !== null && (
    (modelActivity.preview?.trim().length ?? 0) > 0
    || !displayRunProgresses.some(progress => progress.runId === modelActivity.runId
      || (modelActivity.runId === null && progress.runId === activeRunId))
  );
  const canChangeProject =
    !compact
    && !isLoadingTimeline
    && displayTimeline.length === 0
    && draftAttachments.length === 0
    && !isEndedSubagent
    && onAddProject !== undefined
    && onSessionUpdated !== undefined;
  const canChangeAgent =
    groupChat !== null || (!isLoadingTimeline
    && session.agentId === null
    && !isEndedSubagent
    && !teamManaged);
  const changeSummaries = useMemo(() => conversationChangeSummaries(timeline), [timeline]);
  const activeFileChanges = activeRunId === null ? undefined : changeSummaries.get(activeRunId);
  const changeCards = conversationChangeAnchors(changeSummaries, displayTimeline, activeRunId);
  const openChangeReview = (runId: string | null, path?: string): void => {
    useWorkbenchUiStore.getState().openConversationReview({ conversationId: session.id, runId, path: path ?? null });
  };
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
  const toolConversations = useMemo(() => ({
    avatars: conversationAgentAvatars,
    sessions: new Map([...relatedSessions, session].map((candidate) => [candidate.id, candidate])),
    open: onOpenTeamConversation === undefined && onSessionSelected === undefined
      ? undefined
      : (target: ProjectSession) => {
        if (target.id === session.id) return;
        if (onOpenTeamConversation !== undefined) onOpenTeamConversation(target, session.id);
        else onSessionSelected?.(target.id);
      },
  }), [conversationAgentAvatars, onOpenTeamConversation, onSessionSelected, relatedSessions, session]);

  const referenceTeamId = groupChat?.instanceId;
  const richReferenceWorkspaceId = referenceTeamId === undefined ? session.id : teamChatTabId(referenceTeamId);
  const resolveReferences = useCallback((ids: string[]) => agentClient.resolveChatReferences(referenceTeamId === undefined
    ? { conversationId: session.id, ids } : { teamInstanceId: referenceTeamId, ids }), [agentClient, referenceTeamId, session.id]);
  const openReference = useCallback((reference: ChatReference): void => {
    if (reference.kind === "task") {
      useWorkbenchUiStore.getState().openTaskList({ workspaceId: richReferenceWorkspaceId, taskId: reference.id,
        scope: reference.teamInstanceId === null ? { conversationId: reference.ownerConversationId } : { teamInstanceId: reference.teamInstanceId } });
    } else if (reference.sourceKind === "group") useWorkbenchUiStore.getState().openTeamChat({ instanceId: reference.containerId, messageId: reference.id });
    else onLocateConversationItem?.(reference.containerId, reference.id);
  }, [onLocateConversationItem, richReferenceWorkspaceId]);
  const renderReferenceAvatar = useCallback((reference: Extract<ChatReference, { kind: "message" }>): ReactNode => {
    const id = reference.senderConversationId;
    if (id == null) return undefined;
    const avatar = conversationAgentAvatars.get(id);
    return avatar === undefined ? <SubagentAvatar icon={null} seed={id} size="compact" /> : <AgentAvatar avatar={avatar} size="compact" />;
  }, [conversationAgentAvatars]);

  return (
    <ChatReferenceScope scopeKey={richReferenceWorkspaceId} resolve={resolveReferences} onOpen={openReference} renderMessageAvatar={renderReferenceAvatar}>
    <ConversationImagePreviewScope client={agentClient} conversationId={session.id} timeline={timeline} rootPath={project?.rootPath ?? session.workspaceRootPath}>
    <AgentMarkdownWorkspaceScope onOpenFile={onOpenProjectFile}>
    <HtmlPreviewScope client={agentClient} conversationId={session.id}>
    <ToolConversationContext.Provider value={toolConversations}>
    <section
      className="conversation-workspace"
      aria-labelledby={headingId}
      data-compact={String(compact)}
      onInputCapture={markVisibleResult}
      onKeyDownCapture={markVisibleResult}
      onPointerDownCapture={markVisibleResult}
      onWheelCapture={markVisibleResult}
    >
      {groupChat !== null ? null : <header className="conversation-workspace__header">
        <ConversationPath session={session} sessions={relatedSessions} project={project} agents={agentProfiles}
          teams={teams} instances={teamInstances} headingId={headingId} onLocateProject={onLocateProject} onLocateSession={onLocateSession} />
        <TaskListLauncher agentClient={agentClient} scope={{ conversationId: session.id }} workspaceId={session.id} active={active} />
        {compact ? null : (
          <ConversationHeaderControls
            active={active}
            agentClient={agentClient}
            conversationId={session.id}
            project={project}
            subagents={subagentSessions}
            onDeleteSubagent={async (subagent) => {
              try {
                await agentClient.deleteConversation({ conversationId: subagent.id });
                await onRefreshSessions?.();
              } catch (error) {
                const errorCode = error instanceof AgentClientError
                  ? error.code
                  : parseSerializedAgentError(error)?.code;
                if (errorCode !== "ARTIFACT_NOT_FOUND") {
                  throw error;
                }
                await onRefreshSessions?.();
              }
            }}
            {...(onOpenGitReview === undefined ? {} : { onOpenGitReview })}
            onOpenSubagent={(subagent) => onOpenTeamConversation?.(subagent, session.id)}
          />
        )}
      </header>}

      <div
        className="conversation-workspace__surface"
      >
        {groupChat !== null ? <>
          {selectedAgent === undefined ? null : <TeamChatCoordinatorControl agentClient={agentClient} teamInstanceId={groupChat.instanceId}
            agent={selectedAgent} activity={groupActivity} active={active} />}
          <TeamChatPanel agentClient={agentClient} teamInstanceId={groupChat.instanceId} active={active} composerClearance={composerOverlayHeight}
          onCoordinatorLoaded={loadGroupOwner} onActivityLoaded={setGroupActivity} editingMessageId={editingMessageId}
          {...(groupChat.onOpenFile === undefined ? {} : { onOpenFile: groupChat.onOpenFile })}
          onReplyMessage={message => { setGroupReply(message); queueMicrotask(() => composerRef.current?.focus()); }}
          onEditMessage={message => {
            setGroupReply(null); setEditingMessageId(message.id); setEditingPendingMessageId(null); setEditingAttachments([]); setComposerValue(message.content);
            setSelectedConversationMentions(relatedSessions.filter(item => message.recipientConversationIds.includes(item.id)));
            setSelectedTeamMentions([]); setSelectedProjectFileMentions([]); setOperationError(null);
            queueMicrotask(() => composerRef.current?.focus());
          }}
          {...(groupChat.focusMessageId === undefined ? {} : { focusMessageId: groupChat.focusMessageId })}
          onOpenConversation={(conversation, messageId) => onOpenTeamConversation?.({ ...conversation, pinOrder: conversation.pinOrder ?? null }, undefined, messageId)} /></> : <>
        <ConversationFindBar
          active={active}
          containerRef={messagesRef}
          revision={timeline}
          onReveal={revealTimelineSearchResult}
          search={searchConversationTimeline}
        />
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
          className={hasHtmlGallery ? "conversation-workspace__messages justify-end-safe" : "conversation-workspace__messages"}
          aria-label="对话记录"
          onClickCapture={handleTimelineDisclosureInteraction}
          onScroll={handleMessagesScroll}
        >
          {isLoadingOlderTimeline ? (
            <div className="conversation-workspace__history-loading" role="status">
              <Spinner aria-hidden="true" size={14} />
              <span>正在加载更早记录</span>
            </div>
          ) : null}
          {isLoadingTimeline ? (
            <LoadingState label="正在加载对话" className="flex-1 self-stretch" />
          ) : displayTimeline.length === 0 && runProgresses.length === 0 && modelActivity === null ? (
            <div className="conversation-workspace__blank">等待任务</div>
          ) : (
            <ImageGenerationVisibilityProvider><ToolDisclosureContext.Provider value={toolDisclosureChoices}>
              <ToolRevealContext.Provider value={locateTimelineItem}>
              {displayTimeline.map((item, index) => {
                const answerQuestion = item.kind === "message" ? questionForAnswer(item, userQuestions) : null;
                const deliveries = (htmlDeliveries.get(item.id) ?? []).filter(delivery => !referencedArtifactTools.has(delivery.id));
                const images = (imageDeliveries.get(item.id) ?? []).filter(image => !referencedArtifactTools.has(image.id));
                const changes = changeCards.get(item.id) ?? [];
                const beforeMessage = deliveries.length === 0 && images.length === 0 ? null : (
                  <div className="chat-message-group gap-[5px]" data-role="assistant">
                    {images.map(image => <GeneratedImagesResult key={image.id} agentClient={agentClient} item={image} />)}
                    {deliveries.map(delivery => <HtmlDeliveryPreview key={delivery.id} delivery={delivery} cacheTtlMs={CONVERSATION_WORKSPACE_CACHE_TTL_MS} onResize={handleHtmlGalleryResize} />)}
                  </div>
                );
                const afterMessage = changes.length === 0 ? null : (
                  <div className="chat-message-group gap-[5px]" data-role="assistant">
                    {changes.map(change => <ConversationChangesCard key={change.runId} summary={change.summary} onReview={path => openChangeReview(change.runId, path)} />)}
                  </div>
                );
                return (
                <Fragment key={item.id}>
                  {(runDurationsByInsertIndex.get(index) ?? []).map((durationMs, durationIndex) => (
                    <div
                      className="conversation-run-duration"
                      key={`${item.id}:duration:${durationIndex}`}
                    >
                      <span>用时 {formatRunDuration(0, durationMs)}</span>
                    </div>
                  ))}
                  {(runProgressesByInsertIndex.get(index) ?? [])
                    .filter((progress) =>
                      (progress.runId === null || !runningContextCompactionRunIds.has(progress.runId))
                      && (!showModelActivityIndicator || modelActivity?.runId !== progress.runId)
                      && (
                        item.kind !== "run_activity"
                        || progress.runId === null
                        || !item.runIds.includes(progress.runId)
                      )
                    )
                    .map((progress) => (
                      <RunProgressIndicator key={progress.runId ?? "pending"} startedAt={progress.startedAt} />
                    ))}
                  {modelActivity !== null && showModelActivityIndicator
                    && modelActivityInsertIndex === index
                    && item.kind !== "tool_batch"
                    && item.kind !== "run_activity" ? (
                    <ModelActivityIndicator activity={modelActivity} />
                  ) : null}
                  {repeatedAssistantFailureMessageIds.has(item.id) ? null : (
                    <div
                      className="contents"
                      data-conversation-timeline-item={item.kind === "message"
                        && item.continuationMessages !== undefined ? undefined : item.id}
                    >
                      {item.kind === "message" ? beforeMessage : null}
                      <MarkdownArtifactScope artifacts={item.kind === "message" && item.role === "assistant" ? artifactContents : undefined}>
                      <TimelineItem
                        agentClient={agentClient}
                        afterMessage={item.kind === "message" ? afterMessage : null}
                        item={item}
                        sourceConversations={relatedSessions}
                        questionAnswer={answerQuestion}
                        onLocateQuestion={locateQuestion}
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
                        isCurrentActivity={index === currentRunActivityIndex}
                        latestActiveToolId={latestActiveToolId}
                        currentToolId={currentToolId}
                        modelActivity={modelActivity !== null
                          && modelActivityInsertIndex === index
                          && (item.kind === "tool_batch" || item.kind === "run_activity")
                          ? modelActivity
                          : null}
                        runProgress={item.kind === "run_activity"
                          ? runProgressesByInsertIndex.get(index)?.find((progress) =>
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
                          && !isEndedSubagent}
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
                        {...(onOpenTeamConversation === undefined ? {} : {
                          onOpenSubagent: (conversationId: string) => {
                            const conversation = relatedSessions.find(
                              (candidate) => candidate.id === conversationId,
                            );
                            if (conversation !== undefined) {
                              onOpenTeamConversation(conversation, session.id);
                            }
                          },
                        })}
                        onOpenProjectFile={onOpenProjectFile}
                        onSessionSelected={onSessionSelected}
                        liveToolOutputs={liveToolOutputs}
                      />
                      </MarkdownArtifactScope>
                    </div>
                  )}
                  {item.kind === "message" ? null : <>{beforeMessage}{afterMessage}</>}
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
              ); })}
              {(runProgressesByInsertIndex.get(displayTimeline.length) ?? [])
                .filter((progress) =>
                  (progress.runId === null || !runningContextCompactionRunIds.has(progress.runId))
                  && (!showModelActivityIndicator || modelActivity?.runId !== progress.runId)
                )
                .map((progress) => (
                  <RunProgressIndicator key={progress.runId ?? "pending"} startedAt={progress.startedAt} />
                ))}
              {modelActivity !== null && showModelActivityIndicator && modelActivityInsertIndex === displayTimeline.length ? (
                <ModelActivityIndicator activity={modelActivity} />
              ) : null}
              {showWorkTail ? (
                <div className="conversation-work-tail chat-message-group text-[var(--app-muted-foreground)]" role="status" aria-label="正在处理">
                  <ConversationWorkIndicator runId={tailRunId} fallback={tailWorkPhase} size={15} showLabel />
                </div>
              ) : null}
              </ToolRevealContext.Provider>
            </ToolDisclosureContext.Provider></ImageGenerationVisibilityProvider>
          )}
          {sentSteerMessages.map((message) => (
            <div className="chat-message-group" data-role="user" data-sent-steer={message.id} key={message.id}>
              <PendingMessageAttachmentPreviews agentClient={agentClient}
                attachmentIds={message.attachmentIds} conversationId={message.conversationId}
                sent />
              {message.content.length > 0 ? (
                <article className="chat-message" data-role="user" data-status="completed">
                  <p>{message.content}</p>
                </article>
              ) : null}
              <div className="chat-message__meta">
                <time dateTime={message.createdAt} title={formatConversationDateTime(message.createdAt)}>
                  {formatConversationTime(message.createdAt)}
                </time>
              </div>
            </div>
          ))}
          {operationError !== null ? <ConversationErrorItem content={operationError} /> : null}
          <div
            aria-hidden="true"
            className="w-full shrink-0"
            data-conversation-composer-clearance
            style={{ height: `${composerOverlayHeight}px` }}
          />
        </div>

        </>}
        {groupChat === null && isScrolledAwayFromBottom ? (
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

          {groupChat !== null ? null : taskList !== null ? (
            <ConversationTaskListPanel
              active={active}
              allowClose={teamManaged || !isEndedSubagent}
              fileChanges={activeFileChanges}
              onOpenReview={path => openChangeReview(activeRunId, path)}
              isActioning={taskListAction !== null || isEndedSubagent}
              isRunActive={isRunning}
              lastRunStatus={session.lastRunStatus}
              taskList={taskList}
              onClose={() => void handleCloseTaskList()}
            />
          ) : activeFileChanges !== undefined ? <div className="mx-auto mb-[5px] max-w-full"><ConversationChangesBadge summary={activeFileChanges} onReview={path => openChangeReview(activeRunId, path)} /></div> : null}

          {groupChat === null && queuedMessages.length > 0 ? (
            <ConversationPendingMessageQueue
              agentClient={agentClient}
              actioningMessageId={pendingMessageActionId}
              editingMessageId={editingPendingMessageId}
              messages={queuedMessages}
              paused={pendingQueuePaused}
              onTogglePaused={async () => {
                if (pendingMessageActionId !== null) return;
                setPendingMessageActionId("queue-state");
                try {
                  setPendingQueuePaused(await agentClient.setConversationPendingQueuePaused({
                    conversationId: session.id, paused: !pendingQueuePaused,
                  }));
                } catch (error) {
                  setOperationError(getUserErrorMessage(error, "无法更改队列状态。"));
                } finally { setPendingMessageActionId(null); }
              }}
              onDelete={handleDeletePendingMessage}
              onEdit={handleEditPendingMessage}
              onReorder={handleReorderPendingMessages}
              onPromote={handlePromotePendingMessage}
            />
          ) : null}

          {groupChat === null && subagentApprovals.length > 0 ? (
            <SubagentApprovalQueue
              approvalErrors={approvalErrors}
              approvals={subagentApprovals}
              approvingToolId={approvingToolId}
              onChangeApproval={handleChangeApproval}
              {...(onOpenTeamConversation === undefined && onSessionSelected === undefined
                ? {}
                : {
                    onOpenSubagent: (conversationId: string) => {
                      const conversation = relatedSessions.find(
                        (candidate) => candidate.id === conversationId,
                      );
                      if (conversation !== undefined && onOpenTeamConversation !== undefined) {
                        onOpenTeamConversation(conversation, session.id);
                        return;
                      }
                      onSessionSelected?.(conversationId);
                    },
                  })}
            />
          ) : null}

          {groupChat === null ? <UserQuestionPanel key={session.id} agentClient={agentClient} conversationId={session.id} active={active} /> : null}
          {groupChat !== null && operationError !== null ? <p role="alert" className="mx-auto mb-[5px] w-full max-w-[var(--conversation-content-max-width)] text-[var(--app-destructive)]">{operationError}</p> : null}
          <form className="conversation-workspace__composer" onSubmit={(event) => void handleSubmit(event)}>
          <div className="conversation-workspace__composer-surface">
            {groupChat !== null && groupReply !== null ? <div className="flex min-w-0 items-center gap-[5px] border-b border-[var(--app-border)] px-2 py-[5px] text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]" role="status">
              <MessageSquareText size={14} className="shrink-0" />
              <div className="min-w-0 flex-1"><MessageReferenceQuote senderName={groupReply.senderName} content={groupReply.content}
                avatar={groupReply.senderConversationId === null ? undefined : renderReferenceAvatar({ kind: "message", id: groupReply.id, sourceKind: "group", containerId: groupChat.instanceId,
                  senderName: groupReply.senderName, senderConversationId: groupReply.senderConversationId, content: groupReply.content, createdAt: groupReply.createdAt })}
                onOpen={() => useWorkbenchUiStore.getState().openTeamChat({ instanceId: groupChat.instanceId, messageId: groupReply.id })} /></div>
              <IconButton label="取消引用回复" size="compact" onClick={() => setGroupReply(null)}><X size={14} /></IconButton>
            </div> : null}
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
            {isEndedSubagent ? (
              <div className="conversation-workspace__readonly" role="status">
                <Bot aria-hidden="true" size={14} />
                <span>Subagent 已结束，可查看完整过程</span>
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
            <div className="conversation-workspace__composer-input">
              {
                mentionQuery !== null
                && mentionOptions.length > 0
              ? (
                <div className="conversation-mention-menu" role="listbox" aria-label={groupChat === null ? "引用对话或文件" : "选择群成员"}>
                  {mentionOptions.map((option, index) => {
                    const member = option.kind === "conversation" ? option.member : undefined;
                    const memberAvatar = member === undefined ? undefined : conversationAgentAvatars.get(member.conversationId);
                    const child = option.kind === "conversation"
                      ? relatedSessions.find((candidate) => candidate.id === option.value.id)
                      : undefined;
                    const projectName = option.kind === "conversation"
                      ? projects.find(
                        (candidate) => candidate.id === option.value.projectId,
                      )?.name
                      : null;
                    return (
                      <Fragment key={option.kind === "conversation" || option.kind === "team" || option.kind === "all"
                        ? `${option.kind}:${option.value.id}` : `${option.kind}:${option.value.path}`}>
                      {index > 0 && (groupChat !== null || mentionOptions[index - 1]?.kind === option.kind) ? null : (
                        <div role="presentation" className="px-2 py-1 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
                          {member === undefined ? MENTION_GROUPS[option.kind] : "群成员"}
                        </div>
                      )}
                      <button
                        aria-selected={index === mentionSelectionIndex}
                        className={index === mentionSelectionIndex ? "is-selected" : undefined}
                        data-option-index={index}
                        data-group-member={member?.conversationId}
                        key={option.kind === "conversation" || option.kind === "team" || option.kind === "all"
                          ? `${option.kind}:${option.value.id}`
                          : `${option.kind}:${option.value.path}`}
                        role="option"
                        type="button"
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={handleMentionOptionClick}
                      >
                        {member !== undefined ? (
                          <div data-member-avatar className="flex h-5 w-5 items-center justify-center">
                            {memberAvatar === undefined ? <SubagentAvatar icon={null} seed={member.conversationId} size="compact" />
                              : <AgentAvatar avatar={memberAvatar} size="compact" />}
                          </div>
                        ) : option.kind === "team" || option.kind === "all" ? (
                          <UsersRound aria-hidden="true" size={15} />
                        ) : option.kind === "conversation" ? (
                          child?.parentConversationId != null ? (
                            <SubagentAvatar icon={child.avatarIcon} seed={child.id} size="compact" />
                          ) : <MessageSquareText aria-hidden="true" size={15} />
                        ) : option.kind === "directory" ? (
                          <Folder aria-hidden="true" size={15} />
                        ) : (
                          <FileTypeIcon path={option.value.path} size={15} />
                        )}
                        <span>
                          <strong title={option.kind === "conversation" ? option.value.title : option.value.name}>{option.kind === "conversation"
                            ? option.value.title
                            : option.kind === "team" ? option.value.name : option.value.name}</strong>
                          <small>{member !== undefined ? member.role : option.kind === "conversation"
                            ? `${projectName ?? "临时对话"} · ${threadKindLabel(option.value.threadKind)}`
                            : option.kind === "all" ? "通知所有当前群成员并请求回复" : option.kind === "team"
                              ? option.value.scope === "global"
                                ? "全局团队"
                                : option.value.scope === "project"
                                  ? "项目团队"
                                  : "对话团队"
                            : `${option.kind === "directory" ? "目录" : "文件"} · ${option.value.path}`}</small>
                        </span>
                      </button>
                      </Fragment>
                    );
                  })}
                </div>
              ) : slashQuery !== null ? (
                <div className="conversation-mention-menu" role="listbox" aria-label="斜杠命令">
                  {slashOptions.length === 0 ? (
                    <p>没有匹配的命令</p>
                  ) : slashOptions.map((option, index) => (
                    <Fragment key={`${option.kind}:${option.kind === "skill" ? option.value.id : option.value.name}`}>
                    {slashOptions[index - 1]?.kind === option.kind ? null : (
                      <div role="presentation" className="px-2 py-1 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
                        {option.kind === "skill" ? "技能" : "指令"}
                      </div>
                    )}
                    <button
                      title={option.value.description}
                      aria-selected={index === mentionSelectionIndex}
                      className={[index === mentionSelectionIndex ? "is-selected" : "", option.kind === "skill" ? "grid-cols-[18px_minmax(0,1fr)_auto]!" : ""].join(" ")}
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
                        <strong>/{option.value.name}{option.kind === "command" ? ` · ${option.value.title}` : ""}</strong>
                        <small>{option.kind === "skill"
                          ? `Skill · ${option.value.description || "使用这个 Skill 处理任务"}`
                          : option.value.description}</small>
                      </span>
                      {option.kind === "skill" ? <small className="ml-auto shrink-0 whitespace-nowrap text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">{option.value.origin === "system" ? "系统" : "个人"}</small> : null}
                    </button>
                    </Fragment>
                  ))}
                </div>
              ) : null}
              <QueryTextarea
                onFocus={composerHistory.onFocus}
                textareaRef={composerRef}
                aria-label="输入任务"
                query={mentionQuery ?? slashQuery}
                references={composerReferences}
                renderReferenceIcon={(range) => {
                  const label = composerValue.slice(range.start, range.end);
                  if (label === "/compact") return <ArchiveRestore size={12} aria-hidden="true" />;
                  if (label === "/plan") return <ListTodo size={12} aria-hidden="true" />;
                  if (label === "/review") return <FileSearch size={12} aria-hidden="true" />;
                  if (label === "/test") return <Terminal size={12} aria-hidden="true" />;
                  if (label.startsWith("/")) return <Sparkles size={12} aria-hidden="true" />;
                  if (groupChat !== null && label === "@全体成员") return <UsersRound size={12} aria-hidden="true" />;
                  if (selectedTeamMentions.some((item) => `@${item.name}` === label)) return <UsersRound size={12} aria-hidden="true" />;
                  const file = activeProjectFileMentions.find((item) => `@${item.path}` === label);
                  if (file !== undefined) return <FileTypeIcon path={file.path} size={12} />;
                  const reference = selectedConversationMentions.find((item) => `@${item.title}` === label);
                  if (groupChat !== null && reference !== undefined) {
                    const avatar = conversationAgentAvatars.get(reference.id);
                    return <span className="inline-flex shrink-0 scale-[0.65]">{avatar === undefined
                      ? <SubagentAvatar icon={null} seed={reference.id} size="compact" />
                      : <AgentAvatar avatar={avatar} size="compact" />}</span>;
                  }
                  const child = relatedSessions.find((item) => item.id === reference?.id && item.parentConversationId !== null);
                  if (child !== undefined) return <span className="inline-flex shrink-0 scale-[0.65]"><SubagentAvatar icon={child.avatarIcon} seed={child.id} size="compact" /></span>;
                  return <MessageSquareText size={12} aria-hidden="true" />;
                }}
                onReferenceDelete={(range) => {
                  changeComposerValue(composerValue.slice(0, range.start) + composerValue.slice(range.end), range.start);
                  setMentionQuery(null);
                  setSlashQuery(null);
                  queueMicrotask(() => composerRef.current?.setSelectionRange(range.start, range.start));
                }}
                disabled={isSending || pendingMessageActionId !== null || isModelUnavailable || isEndedSubagent}
                placeholder={isEndedSubagent
                  ? "Subagent 已结束，可查看完整过程"
                  : isModelUnavailable
                  ? "请先在设置中配置模型"
                  : selectedAgent === undefined
                    ? "输入任务"
                    : `向 ${selectedAgent.name} 输入任务`}
                rows={2}
                value={composerValue}
                onValueChange={changeComposerValue}
                onClick={(event) => {
                  const nextMentionQuery = findMentionQuery(
                    composerValue,
                    event.currentTarget.selectionStart,
                  );
                  setMentionQuery(nextMentionQuery);
                  setSlashQuery(nextMentionQuery === null
                    ? findSlashQuery(
                      composerValue,
                      event.currentTarget.selectionStart,
                    )
                    : null);
                  setMentionSelectionIndex(0);
                }}
                onKeyDown={(event) => { if (!composerHistory.onKeyDown(event)) handleComposerKeyDown(event); }}
                onPaste={handlePasteAttachments}
              />
            </div>
            <div className="conversation-workspace__composer-toolbar">
              <div className="conversation-workspace__composer-options">
                <IconButton
                  disabled={
                    isMockRuntime
                    || isSending
                    || isEndedSubagent
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
                    <Spinner aria-hidden="true" size={16} />
                  ) : (
                    <Paperclip aria-hidden="true" size={16} />
                  )}
                </IconButton>
                {project === null && !isMockRuntime && onSessionUpdated !== undefined ? (
                  <span className="conversation-workspace__workspace-control">
                    <IconButton
                      disabled={isRunning || isSending || isChangingWorkspace || isEndedSubagent}
                      label={session.workspaceRootPath === null ? "添加工作目录" : "更换工作目录"}
                      size="compact"
                      type="button"
                      variant="quiet"
                      onClick={() => void handleSelectWorkspace()}
                    >
                      <FolderPlus aria-hidden="true" size={16} />
                    </IconButton>
                    {session.workspaceRootPath === null ? null : (
                      <>
                        <button
                          className="conversation-workspace__workspace-path"
                          disabled={isRunning || isSending || isChangingWorkspace || isEndedSubagent}
                          title={session.workspaceRootPath}
                          type="button"
                          onClick={() => void handleSelectWorkspace()}
                        >
                          <Folder aria-hidden="true" className="shrink-0" size={16} />
                          <span>{fileNameFromPath(session.workspaceRootPath)}</span>
                        </button>
                        <IconButton
                          disabled={isRunning || isSending || isChangingWorkspace || isEndedSubagent}
                          label="移除工作目录"
                          size="compact"
                          type="button"
                          variant="quiet"
                          onClick={() => void handleClearWorkspace()}
                        >
                          <X aria-hidden="true" size={16} />
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
                      saveConversationAgentSelection(groupChat?.instanceId ?? session.id, agentId);
                    }}
                  >
                    <TooltipAnchor side="top" disabled={!canChangeAgent}
                      content={canChangeAgent
                        ? `当前 Agent：${selectedAgent.name}`
                        : `对话已由 ${selectedAgent.name} 接管`}>
                      <SelectTrigger aria-label="对话 Agent" aria-description={`当前 Agent：${selectedAgent.name}`} showIndicator={false}
                        className="conversation-workspace__composer-select conversation-workspace__composer-select--agent size-8! justify-center! px-0!">
                        <AgentAvatar avatar={selectedAgent.avatar} size="toolbar" />
                      </SelectTrigger>
                    </TooltipAnchor>
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
                <ConversationPermissionSelect value={permissionMode}
                  disabled={isEndedSubagent || isSavingTeamPermission} busy={isSavingCoordinationMode}
                  deferred={teamManaged && activeRunId !== null} onChange={selectPermissionMode} />
                {!teamManaged && session.parentConversationId == null && session.teamId == null ? (
                  <IconButton
                    type="button"
                    label="快速协作"
                    tooltipSide="top"
                    size="compact"
                    variant="quiet"
                    aria-pressed={coordinationMode === "parallel_queue"}
                    disabled={isSavingCoordinationMode || (coordinationMode === "direct" && activeRunId !== null)}
                    tooltip={`快速协作（${coordinationMode === "parallel_queue" ? "已开启" : "已关闭"}）：使用完全访问权限；新消息进入持久队列，主对话协调子代理并跟踪结果。请在当前执行结束后开启。`}
                    className="aria-pressed:bg-[var(--app-hover)] aria-pressed:text-[var(--app-foreground)]"
                    onClick={() => void toggleCoordinationMode()}
                  >
                    <UsersRound aria-hidden="true" size={16} />
                  </IconButton>
                ) : null}
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
                    align="center"
                    ariaLabel="对话模型列表"
                    className="model-profile-picker--conversation"
                    defaultContextCompression={contextCompressionConfiguration}
                    models={modelOptions}
                    providerFilter
                    selectedModelId={activeModel?.modelId ?? null}
                    selectedProviderId={activeModel?.providerId ?? null}
                    side="top"
                    trigger={
                      <button
                        aria-label="模型"
                        className="conversation-workspace__composer-select conversation-workspace__composer-select--model"
                        disabled={isEndedSubagent || activeModelKey.length === 0}
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
                    disabled={isEndedSubagent || activeModelKey.length === 0}
                    fallbackOption={session.modelSelection?.reasoning ?? null}
                    modelId={activeModel?.modelId ?? null}
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
                        || isAddingAttachments
                        || pendingMessageActionId !== null
                        || isModelUnavailable
                        || isEndedSubagent
                      )
                  }
                  label={shouldShowStopButton
                    ? isCancelling ? "正在停止任务" : "停止任务"
                    : isEndedSubagent
                      ? "Subagent 已结束"
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
                      <Spinner aria-hidden="true" size={16} />
                    ) : (
                      <Square aria-hidden="true" size={16} />
                    )
                  ) : isSending ? (
                    <Spinner aria-hidden="true" size={16} />
                  ) : (
                    <ArrowUp aria-hidden="true" size={16} strokeWidth={2.25} />
                  )}
                </IconButton>
              </div>
            </div>
          </div>
          {showContextUsage && active ? (
            <ProviderCacheStatus
              key={usageConversationId}
              usage={lastProviderUsage?.conversationId === usageConversationId
                ? lastProviderUsage.usage
                : null}
            />
          ) : null}
          </form>
        </div>
      </div>
    </section>
    </ToolConversationContext.Provider>
    </HtmlPreviewScope>
    </AgentMarkdownWorkspaceScope>
    </ConversationImagePreviewScope>
    </ChatReferenceScope>
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
  const match = beforeCursor.match(/(?:^|\s)\/([^\s/]*)$/u);
  if (match === null) return null;
  return {
    end: cursor,
    query: match[1] ?? "",
    start: cursor - (match[1]?.length ?? 0) - 1,
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
    case "agent_message.received":
      updateTimeline((current) => upsertTimelineItem(
        completeStreamingAssistantMessages(current),
        event.message,
      ));
      return;
    case "model.request_started":
      updateTimeline(completeStreamingAssistantMessages);
      beginRunProgress(
        setRunProgresses,
        event.runId,
        timelineRef.current.at(-1)?.id ?? null,
      );
      setModelActivity((current) => current?.runId === event.runId && current.preview?.trim()
        ? current : {
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
      return;
    case "assistant.reasoning_delta": {
      if (event.kind === "content") {
        setModelActivity((current) => current?.runId === event.runId ? null : current);
        updateTimeline((current) => appendAssistantReasoningDelta(current, event));
        return;
      }
      if (event.delta.length === 0) return;
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
      if (event.type === "tool.started") {
        setModelActivity((current) => current?.runId === event.runId ? null : current);
      }
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
          ...(event.startedAt === undefined ? {} : { startedAt: event.startedAt }),
          ...(event.completedAt === undefined ? {} : { completedAt: event.completedAt }),
          [event.stream]: event.reset ? event.delta : `${previous[event.stream]}${event.delta}`,
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
      className="conversation-model-activity flex items-start gap-[5px]"
      data-has-preview={String(hasPreview)}
      data-status={activity.status}
      role="status"
    >
      <span className="conversation-model-activity__label min-w-0" title={label}>{label}</span>
    </div>
  );
}

function RunElapsedLabel({ startedAt, durationMs = 0 }: { startedAt: number; durationMs?: number }): ReactElement {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);
  return <span>已处理 {formatRunDuration(0, Math.max(0, now - startedAt) + durationMs)}</span>;
}

function RunProgressIndicator({ startedAt }: { startedAt: number }): ReactElement {
  return (
    <div
      aria-label="正在处理"
      className="conversation-run-progress flex items-center gap-[5px]"
      role="status"
    >
      <RunElapsedLabel startedAt={startedAt} />
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
  sent = false,
}: {
  agentClient: AgentClient;
  attachmentIds: readonly string[];
  conversationId: string;
  sent?: boolean;
}): ReactElement | null {
  const openPreview = useMediaPreview();
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
            aria-label={sent ? "预览图片" : "预览待发送图片"}
            className="conversation-pending-queue__attachment-preview"
            key={attachmentId}
            type="button"
            onClick={() => openPreview({
              imageKey: attachmentId,
              alt: sent ? "图片" : "待发送图片",
              src: previewUrl,
              title: sent ? "图片" : "待发送图片",
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
  paused,
  onTogglePaused,
  onDelete,
  onEdit,
  onReorder,
  onPromote,
}: {
  agentClient: AgentClient;
  actioningMessageId: string | null;
  editingMessageId: string | null;
  messages: readonly ConversationPendingMessage[];
  paused: boolean;
  onTogglePaused: () => Promise<void>;
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
        <div className="ml-auto flex items-center gap-[5px]">
          {paused ? <small className="text-[var(--app-muted-foreground)]">已暂停</small> : null}
          <IconButton disabled={actioningMessageId !== null} label={paused ? "继续队列（本轮完成后依次发送）" : "暂停队列"} size="compact" onClick={() => void onTogglePaused()}>
            {paused ? <Play aria-hidden="true" size={14} /> : <Pause aria-hidden="true" size={14} />}
          </IconButton>
        </div>
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
                if (actioningMessageId !== null) {
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
                draggable={actioningMessageId === null}
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
              <span className="conversation-pending-queue__actions">
                {isActioning ? (
                  <Spinner aria-hidden="true" size={14} />
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
            <div className="flex min-w-0 items-center">
              <button
                aria-label={`在侧边打开 Subagent 审批来源：${approval.childTitle}`}
                className="flex min-w-0 flex-1 items-center gap-[5px] rounded-[var(--app-radius-small)] px-1 py-0.5 text-left hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] disabled:cursor-default disabled:hover:bg-transparent"
                disabled={onOpenSubagent === undefined}
                title={`打开 Subagent：${approval.childTitle}`}
                type="button"
                onClick={() => onOpenSubagent?.(approval.childConversationId)}
              >
                <SubagentAvatar
                  icon={approval.childAvatarIcon}
                  seed={approval.childConversationId}
                  size="compact"
                />
                <span className="max-w-[40%] shrink-0 truncate font-medium">
                  {approval.childTitle}
                </span>
                <span aria-hidden="true" className="shrink-0 text-[var(--app-muted-foreground)]">·</span>
                <span className="min-w-0 flex-1 truncate text-[var(--app-muted-foreground)]">
                  {toolActivityLabel(approval.tool)}
                </span>
              </button>
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
                {isApproving ? <Spinner size={13} /> : <Check aria-hidden="true" size={13} />}
                {isApproving ? "提交中" : "允许一次"}
              </button>
              {isExternalRead ? null : (
                <button
                  className="inline-flex min-h-7 items-center gap-1 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-transparent px-2 text-[var(--app-foreground)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={isApproving}
                  title="当前对话后续遇到完全相同的命令或同一工具与路径时自动允许"
                  type="button"
                  onClick={() => void onChangeApproval(approval.tool, true, "session")}
                >
                  <Check aria-hidden="true" size={13} />
                  本对话允许
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
  active,
  allowClose = true,
  fileChanges,
  isActioning,
  isRunActive,
  lastRunStatus,
  taskList,
  onClose,
  onOpenReview,
}: {
  active: boolean;
  allowClose?: boolean;
  fileChanges: TaskFileChangeSummary | undefined;
  onOpenReview: (path?: string) => void;
  isActioning: boolean;
  isRunActive: boolean;
  lastRunStatus: ProjectSession["lastRunStatus"];
  taskList: ConversationTaskList;
  onClose: () => void;
}): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const runningCount = taskList.tasks.filter((task) => task.status === "running").length;
  const blockedIndex = taskList.tasks.findIndex((task) => task.status === "blocked");
  const failedIndex = taskList.tasks.findIndex((task) => task.status === "failed");
  const completedCount = taskList.tasks.filter((task) => task.status === "completed").length;
  const isCompleted = completedCount === taskList.tasks.length;
  const inactiveRunningStatus = runningCount === 0 || isRunActive
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
  const summaryId = `conversation-task-list-${taskList.conversationId}`;
  return (
    <div
      className="conversation-task-list"
      data-has-changes={fileChanges !== undefined}
      data-expanded={String(expanded)}
      data-status={summaryStatus}
    >
      <Popover open={active && expanded} onOpenChange={setExpanded}>
      <div className="conversation-task-list__body">
        {active && expanded ? (
          <PopoverContent className="conversation-task-list__details w-max min-w-[min(var(--radix-popover-trigger-width),var(--radix-popover-content-available-width))] max-w-[min(560px,var(--radix-popover-content-available-width))]" id={summaryId} role="list" side="top" align="center" sideOffset={5}
            onOpenAutoFocus={(event) => event.preventDefault()} onCloseAutoFocus={(event) => event.preventDefault()}
            onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()}>
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
                      <Spinner aria-hidden="true" size={15} />
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
          </PopoverContent>
        ) : null}
        <PopoverAnchor asChild>
        <div className="conversation-task-list__summary-control">
          <PopoverTrigger asChild>
          <button
            aria-controls={summaryId}
            aria-expanded={expanded}
            className="conversation-task-list__summary"
            type="button"
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
            ) : runningCount > 0 ? (
              <Spinner aria-hidden="true" className="conversation-task-list__summary-status" size={15} />
            ) : (
              <ListTodo aria-hidden="true" size={15} strokeWidth={1.9} />
            )}
            <span className="shrink-0">{`${completedCount}/${taskList.tasks.length} 已完成`}</span>
            <span className="conversation-task-list__summary-divider" aria-hidden="true">·</span>
            <span className="min-w-0 truncate">{
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
                          : runningCount > 0
                            ? `${runningCount} 项进行中`
                            : "任务清单"
            }</span>
            {expanded ? <ChevronUp aria-hidden="true" className="conversation-task-list__chevron" size={15} />
              : <ChevronDown aria-hidden="true" className="conversation-task-list__chevron" size={15} />}
          </button>
          </PopoverTrigger>
          {fileChanges !== undefined ? <ConversationChangesBadge summary={fileChanges} joined onReview={onOpenReview} /> : null}
        </div>
        </PopoverAnchor>
      </div>
      </Popover>
      {allowClose ? <IconButton
        className="conversation-task-list__action"
        disabled={isActioning}
        label="关闭任务清单"
        size="compact"
        variant="quiet"
        onClick={onClose}
      >
        {isActioning ? (
          <Spinner aria-hidden="true" size={14} />
        ) : (
          <X aria-hidden="true" size={15} />
        )}
      </IconButton> : null}
    </div>
  );
}

function ReasoningDisclosure({
  children,
  streaming,
  reveal = false,
}: {
  children: ReactNode;
  streaming: boolean;
  reveal?: boolean;
}): ReactElement {
  const contentId = useId();
  const [isExpanded, setIsExpanded] = useState(streaming || reveal);

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
      <AgentMarkdown content={content} streaming={streaming} />
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
  afterMessage,
  item,
  sourceConversations,
  questionAnswer,
  onLocateQuestion,
  agentAvatar,
  agentAvatarSeed,
  teamManaged,
  activeRunId,
  isCurrentActivity,
  latestActiveToolId,
  currentToolId,
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
  onOpenSubagent,
  onOpenProjectFile,
  onSessionSelected,
  liveToolOutputs,
}: {
  agentClient: AgentClient;
  afterMessage?: ReactNode;
  item: TimelineDisplayItem;
  sourceConversations: readonly Pick<ConversationSummary, "id" | "title" | "agentId" | "avatarIcon">[];
  questionAnswer: UserQuestion | null;
  onLocateQuestion: (question: UserQuestion) => Promise<void>;
  agentAvatar: AgentProfile["avatar"] | null;
  agentAvatarSeed: string | null;
  teamManaged: boolean;
  activeRunId: string | null;
  isCurrentActivity: boolean;
  latestActiveToolId: string | null;
  currentToolId: string | null;
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
  onOpenSubagent?: (conversationId: string) => void;
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
        key={item.id}
        item={item}
        teamManaged={teamManaged}
        activeRunId={activeRunId}
        isCurrentActivity={isCurrentActivity}
        latestActiveToolId={latestActiveToolId}
        currentToolId={currentToolId}
        modelActivity={modelActivity}
        runProgress={runProgress}
        approvalErrors={approvalErrors}
        approvingToolId={approvingToolId}
        onOpenSubagent={onOpenSubagent}
        onOpenProjectFile={onOpenProjectFile}
        onChangeApproval={onChangeApproval}
        liveToolOutputs={liveToolOutputs}
      />
    );
  }

  if (item.kind === "tool_batch") {
    return (
      <ToolBatchTimelineItem
        agentClient={agentClient}
        key={item.id}
        item={item}
        teamManaged={teamManaged}
        activeRunId={activeRunId}
        latestActiveToolId={latestActiveToolId}
        currentToolId={currentToolId}
        modelActivity={modelActivity}
        approvalErrors={approvalErrors}
        approvingToolId={approvingToolId}
        onOpenSubagent={onOpenSubagent}
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
        key={item.id}
        item={item}
        teamManaged={teamManaged}
        latestActiveToolId={latestActiveToolId}
        approvalActionable={item.runId === activeRunId}
        approvalError={approvalErrors[item.id] ?? null}
        isApproving={approvingToolId === item.id}
        onOpenSubagent={onOpenSubagent}
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
          <TeamChatSourceContent content={item.content} />
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
  const canEdit = item.role === "user" && item.groupSource === undefined && questionAnswer === null && item.id === latestUserMessageId;
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
      {item.role === "user" ? <TeamChatSourceHeader content={item.content} source={item.groupSource} conversations={sourceConversations} onOpenConversation={onSessionSelected} /> : null}
      {item.role === "user" ? messageAttachments : null}
      {hasMessageBody ? (
        <ChatMessageBubble role={item.role} status={item.status}>
          {questionAnswer === null ? null : (
            <button type="button" onClick={() => void onLocateQuestion(questionAnswer)}
              title={`跳到提问：${questionAnswer.questions.map((prompt) => prompt.question).join("；")}`}
              className="flex max-w-full min-w-0 items-center gap-[5px] rounded-[var(--app-radius-small)] border-0 bg-[var(--app-status-info-bg)] px-2 py-1 text-left text-[length:var(--app-font-size-control)] font-medium text-[var(--app-status-info-fg)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
              <MessageCircleQuestion aria-hidden="true" size={14} className="shrink-0" />
              <span className="min-w-0 truncate">提问：{questionAnswer.questions.map((prompt) => prompt.question).join("；")}</span>
            </button>
          )}
          {item.role === "assistant" && item.status === "failed" ? (
            <ConversationErrorContent content={item.content} />
          ) : item.role === "assistant" ? (
            <>
              {item.continuationMessages !== undefined ? item.continuationMessages.map((message) => (
                <div key={message.id} data-conversation-timeline-item={message.id}>
                  <AgentMarkdown content={stripLeadingThinkingSummary(message.content)} streaming={message.status === "streaming"} />
                </div>
              )) : <>
              {renderedReasoningContent.length > 0 ? (
                <AssistantReasoningBlock
                  content={renderedReasoningContent}
                  key={item.status}
                  streaming={item.status === "streaming"}
                />
              ) : null}
              {renderedMessageContent.length > 0
                ? <AgentMarkdown content={renderedMessageContent} streaming={item.status === "streaming"} />
                : null}
              </>}
            </>
          ) : questionAnswer !== null ? (
            <UserMessageContent content={questionAnswer.questions.map((prompt) =>
              questionAnswer.questions.length === 1
                ? questionAnswer.answers?.[prompt.id] ?? ""
                : `${prompt.title}：${questionAnswer.answers?.[prompt.id] ?? ""}`,
            ).join("\n\n")} />
          ) : (
            renderedMessageContent.length > 0 ? <TeamChatSourceContent content={renderedMessageContent} source={item.groupSource} /> : null
          )}
        </ChatMessageBubble>
      ) : null}
      {item.role === "assistant" ? messageAttachments : null}
      {afterMessage}
      {showMessageMeta ? <ChatMessageMeta role={item.role} content={item.content} createdAt={item.createdAt}
        completedAt={canShowCompletionTime ? item.completedAt ?? null : null} copied={copied} editing={editing}
        {...(canCopyMessage ? { onCopy: () => void onCopyMessage(item) } : {})}
        {...(canEdit ? { onEdit: () => onEditMessage(item) } : {})}>
        {item.role === "assistant" && canForkMessage ? <IconButton disabled={isForking}
          label={isForking ? "正在创建分支对话" : "从此回复创建分支对话"} size="compact" type="button" variant="quiet" onClick={() => void onForkMessage(item)}>
          {isForking ? <Spinner aria-hidden="true" size={14} /> : <GitFork aria-hidden="true" size={14} />}
        </IconButton> : null}
      </ChatMessageMeta> : null}
    </div>
  );
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
  | ToolBatchProjection;

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
  isCurrentActivity,
  latestActiveToolId,
  currentToolId,
  modelActivity,
  runProgress,
  approvalErrors,
  approvingToolId,
  onOpenSubagent,
  onOpenProjectFile,
  onChangeApproval,
  liveToolOutputs,
}: {
  agentClient: AgentClient;
  item: RunActivityProjection;
  teamManaged: boolean;
  activeRunId: string | null;
  isCurrentActivity: boolean;
  latestActiveToolId: string | null;
  currentToolId: string | null;
  modelActivity: ModelActivity | null;
  runProgress: RunProgress | null;
  approvalErrors: Readonly<Record<string, string>>;
  approvingToolId: string | null;
  onOpenSubagent: ((conversationId: string) => void) | undefined;
  onOpenProjectFile: ((path: string) => void) | undefined;
  onChangeApproval: (
    tool: ConversationToolItem,
    approved: boolean,
    scope?: ApproveToolChangeInput["scope"],
  ) => Promise<void>;
  liveToolOutputs: Readonly<Record<string, LiveToolOutput>>;
}): ReactElement {
  const isActive = activeRunId !== null && item.runIds.includes(activeRunId);
  const isInProgress = isCurrentActivity && (isActive || runProgress !== null || item.streaming);
  const reveal = useContext(ToolRevealContext);
  const disclosureChoices = useContext(ToolDisclosureContext);
  const revealThisRun = item.items.some((entry) => entry.kind === "tool" && entry.id === reveal?.id);
  const [expandedChoice, setIsExpanded] = useToolDisclosure(item.id, [], isInProgress);
  const isExpanded = isInProgress || expandedChoice;
  useEffect(() => { if (revealThisRun) setIsExpanded(true); }, [reveal?.requestId, revealThisRun, setIsExpanded]);
  useEffect(() => {
    if (!isInProgress && !revealThisRun && !disclosureChoices?.has(item.id)) setIsExpanded(false);
  }, [isInProgress, revealThisRun, disclosureChoices, item.id, setIsExpanded]);
  const contentId = useId();
  const [fallbackStartedAt] = useState(() => Date.now());
  const label = isInProgress
    ? <RunElapsedLabel startedAt={runProgress?.startedAt ?? fallbackStartedAt} durationMs={item.durationMs ?? 0} />
    : item.durationMs === null ? "已处理" : `用时 ${formatRunDuration(0, item.durationMs)}`;
  const displayItems = groupRunActivityItems(item.items);
  const hasReasoning = displayItems.some((entry) => entry.kind === "activity_reasoning");
  const reasoningStreaming = displayItems.some((entry) =>
    entry.kind === "activity_reasoning" && entry.streaming
  );
  const currentModelActivity = isActive && modelActivity?.runId != null && item.runIds.includes(modelActivity.runId)
    ? modelActivity : null;
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
          <AgentMarkdown content={entry.content} streaming={isInProgress && entry.streaming} />
        </div>
      );
    }
    if (entry.kind === "activity_progress") {
      return (
        <div
          className="py-[5px] text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]"
          key={entry.id}
        >
          <AgentMarkdown content={entry.content} streaming={isInProgress && entry.streaming} />
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
          key={entry.id}
          latestActiveToolId={latestActiveToolId}
          currentToolId={currentToolId}
          liveToolOutputs={liveToolOutputs}
          modelActivity={entry.tools.some(tool => tool.id === currentToolId) ? currentModelActivity : null}
          onChangeApproval={onChangeApproval}
          onOpenSubagent={onOpenSubagent}
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
        key={entry.id}
        latestActiveToolId={latestActiveToolId}
        liveOutput={liveToolOutputs[entry.id]}
        onChangeApproval={onChangeApproval}
        onOpenSubagent={onOpenSubagent}
        onOpenProjectFile={onOpenProjectFile}
        teamManaged={teamManaged}
        variant="activity"
      />
    );
  });
  return (
    <section
      className="conversation-run-activity flex w-full min-w-0 flex-col"
      data-status={hasFailure ? "failed" : isInProgress ? "running" : "completed"}
    >
      <button
        aria-controls={contentId}
        aria-expanded={isExpanded}
        disabled={isInProgress}
        className="flex w-full min-w-0 items-center gap-[5px] border-0 border-b border-solid border-[var(--app-border)] bg-transparent px-0 py-[6px] text-left text-[length:var(--app-font-size-body)] font-normal text-[var(--app-muted-foreground)] hover:text-[var(--app-foreground)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-2"
        title={isInProgress ? "推理完成后可收起工作过程" : toggleLabel}
        type="button"
        onClick={() => setIsExpanded((current) => !current)}
      >
        <span className="min-w-0 truncate" aria-live={isInProgress ? "polite" : undefined}>{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={`shrink-0 transition-transform ${isExpanded ? "rotate-90" : ""}`}
          size={15}
        />
      </button>
      {isExpanded ? (
        <div className="flex min-w-0 flex-col gap-[5px] pt-[5px]" id={contentId}>
          {hasReasoning ? (
            <ReasoningDisclosure key={revealThisRun ? reveal?.requestId : "normal"} streaming={isInProgress && reasoningStreaming} reveal={revealThisRun}>
              {activityContent}
            </ReasoningDisclosure>
          ) : (
            <>
              {activityContent}
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
  currentToolId,
  modelActivity,
  approvalErrors,
  approvingToolId,
  onOpenSubagent,
  onOpenProjectFile,
  onChangeApproval,
  liveToolOutputs,
}: {
  agentClient: AgentClient;
  item: Extract<TimelineDisplayItem, { kind: "tool_batch" }>;
  teamManaged: boolean;
  activeRunId: string | null;
  latestActiveToolId: string | null;
  currentToolId: string | null;
  modelActivity: ModelActivity | null;
  approvalErrors: Readonly<Record<string, string>>;
  approvingToolId: string | null;
  onOpenSubagent: ((conversationId: string) => void) | undefined;
  onOpenProjectFile: ((path: string) => void) | undefined;
  onChangeApproval: (
    tool: ConversationToolItem,
    approved: boolean,
    scope?: ApproveToolChangeInput["scope"],
  ) => Promise<void>;
  liveToolOutputs: Readonly<Record<string, LiveToolOutput>>;
}): ReactElement {
  const [isExpanded, setIsExpanded] = useToolDisclosure(item.id, item.tools.map((tool) => tool.id));
  const reveal = useContext(ToolRevealContext);
  const revealThisBatch = item.tools.some((tool) => tool.id === reveal?.id);
  useEffect(() => { if (revealThisBatch) setIsExpanded(true); }, [reveal?.requestId, revealThisBatch, setIsExpanded]);
  const hasFailure = item.tools.some((tool) =>
    toolItemHasFailure(tool) || approvalErrors[tool.id] !== undefined
  );
  const currentTool = item.tools.find((tool) => tool.id === currentToolId);
  const isCurrentBatch = currentTool !== undefined && currentTool.runId === activeRunId;
  const hasReasoningSummary = Boolean(modelActivity?.preview?.trim());
  const label = hasReasoningSummary && modelActivity !== null ? modelActivityLabel(modelActivity)
    : isCurrentBatch ? (toolBatchCurrentToolLabel([currentTool], teamManaged) ?? toolActivityLabel(currentTool, teamManaged))
    : toolBatchLabel(item.tools, teamManaged);
  const toggleLabel = isExpanded ? "收起本轮工具调用" : "展开本轮工具调用";
  const headerLabel = label;

  return (
    <section className="tool-activity-batch" data-status={hasFailure ? "failed" : undefined}>
      <header className="tool-activity-batch__header">
        <span className="tool-activity-batch__identity">
          <button
            aria-expanded={isExpanded}
            aria-label={`${toggleLabel}：${headerLabel}`}
            className="inline-flex min-w-0 flex-[0_1_auto] cursor-pointer items-center gap-[7px] overflow-hidden border-0 bg-transparent p-0 text-left text-[var(--app-muted-foreground)] transition-colors hover:text-[var(--app-foreground)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1 [font:inherit]"
            title={headerLabel}
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
          >
            {hasReasoningSummary ? null : <ToolTypeIcon name={representativeToolName(item.tools)} />}
            <span className="min-w-0 truncate" aria-live={isCurrentBatch || modelActivity !== null ? "polite" : undefined}>{label}</span>
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
              key={tool.id}
              item={tool}
              teamManaged={teamManaged}
              latestActiveToolId={latestActiveToolId}
              approvalActionable={tool.runId === activeRunId}
              approvalError={approvalErrors[tool.id] ?? null}
              isApproving={approvingToolId === tool.id}
              onOpenSubagent={onOpenSubagent}
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
  approvalActionable,
  approvalError,
  isApproving,
  variant = "card",
  onOpenSubagent,
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
  onOpenSubagent: ((conversationId: string) => void) | undefined;
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
  const [isExpanded, setIsExpanded] = useToolDisclosure(item.id);
  const reveal = useContext(ToolRevealContext);
  const element = useRef<HTMLElement>(null);
  useEffect(() => {
    if (reveal?.id !== item.id) return;
    setIsExpanded(true);
    const timer = window.setTimeout(() => element.current?.scrollIntoView?.({ behavior: "smooth", block: "center" }), 0);
    return () => window.clearTimeout(timer);
  }, [item.id, reveal?.id, reveal?.requestId, setIsExpanded]);
  const [isRawCallOpen, setIsRawCallOpen] = useState(false);
  const canExpand = approvalError !== null || toolHasDisplayableDetails(item);
  const detailsLabel = isExpanded ? "收起调用详情" : "展开调用详情";

  return (
    <article
      ref={element}
      className={variant === "activity" ? "tool-activity-row" : "tool-timeline-item"}
      data-status={effectiveStatus}
    >
      <header className="tool-timeline-item__header">
        <span className="tool-timeline-item__identity">
          {item.name === "spawn_subagent" ? null : <ToolTypeIcon name={item.name} />}
          <ToolActivityLabel
            canExpand={canExpand}
            effectiveStatus={effectiveStatus}
            item={item}
            isExpanded={isExpanded}
            teamManaged={teamManaged}
            onOpenSubagent={onOpenSubagent}
            onOpenProjectFile={onOpenProjectFile}
            onToggle={() => setIsExpanded((current) => !current)}
          />
          {isCommand ? <CommandExecutionStatus execution={commandExecutionState(effectiveStatus, item.result, liveOutput, item.createdAt)} showDuration={!isExpanded} />
            : effectiveStatus === "running" ? <ToolExecutionTimer startedAt={Date.parse(item.createdAt)} /> : null}
          {!isCommand && effectiveStatus !== "completed" && effectiveStatus !== "running" ? (
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
          {canExpand ? <button
            aria-expanded={isExpanded}
            aria-label={detailsLabel}
            className="tool-timeline-item__toggle"
            title={detailsLabel}
            type="button"
            onClick={() => setIsExpanded((current) => !current)}
          >
            <ChevronRight aria-hidden="true" size={15} />
          </button> : null}
        </span>
      </header>
      {canExpand && isExpanded ? (
        <ToolDetail
          agentClient={agentClient}
          item={item}
          teamManaged={teamManaged}
          onOpenSubagent={onOpenSubagent}
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
            {item.name === "generate_images" ? "等待确认后生成图片" : terminalApprovalLabel ?? (isExternalRead
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
              {isApproving ? <Spinner size={14} /> : <Check aria-hidden="true" size={14} />}
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
                本对话允许
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

function ToolExecutionTimer({ startedAt }: { startedAt: number }): ReactElement {
  const startedAtRef = useRef<number>(0);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);

  useEffect(() => {
    startedAtRef.current = Number.isFinite(startedAt) ? startedAt : Date.now();
    const updateElapsed = (): void => {
      setElapsedSeconds(Math.max(0, Math.floor((Date.now() - startedAtRef.current) / 1_000)));
    };
    updateElapsed();
    const timerId = window.setInterval(updateElapsed, 1_000);
    return () => window.clearInterval(timerId);
  }, [startedAt]);

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
    case "computer_use":
    case "browser_control":
    case "present_html":
      return <Globe2 aria-hidden="true" size={15} />;
    case "read_attachment":
      return <Paperclip aria-hidden="true" size={15} />;
    case "request_user_input":
      return <MessageCircleQuestion aria-hidden="true" size={15} />;
    case "view_attachments":
    case "view_image":
    case "generate_images":
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

function ToolActivityLabel({
  canExpand,
  effectiveStatus,
  item,
  isExpanded,
  teamManaged,
  onOpenSubagent,
  onOpenProjectFile,
  onToggle,
}: {
  canExpand: boolean;
  effectiveStatus: ConversationToolItem["status"];
  item: ConversationToolItem;
  isExpanded: boolean;
  teamManaged: boolean;
  onOpenSubagent: ((conversationId: string) => void) | undefined;
  onOpenProjectFile: ((path: string) => void) | undefined;
  onToggle: () => void;
}): ReactElement {
  const summary = fileChangeSummary(item);
  const label = toolActivityLabel(item, teamManaged);
  const targets = toolConversationTargets(item);
  const toggleLabel = isExpanded ? "收起调用详情" : "展开调用详情";
  const toggleClassName = "min-w-0 flex-[0_1_auto] cursor-pointer overflow-hidden border-0 bg-transparent p-0 text-left text-ellipsis whitespace-nowrap text-[var(--app-muted-foreground)] transition-colors hover:text-[var(--app-foreground)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1 [font:inherit]";
  const fileLinkClassName = "inline-flex min-w-0 cursor-pointer items-center gap-1 overflow-hidden border-0 bg-transparent p-0 text-inherit transition-colors hover:text-[var(--app-accent)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-2 [font:inherit]";
  if (targets.length > 0) {
    const completed = effectiveStatus === "completed";
    const action = item.name === "send_agent_message"
      ? completed ? "消息已发送" : "发送消息"
      : item.name === "read_agent_conversation"
        ? completed ? "已读取对话" : "读取对话"
        : completed ? "消息等待结束" : "等待消息";
    return <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-[5px]">{targets.map(target => <ToolConversationIdentity key={target.id} target={target} action={action} />)}</span>;
  }
  const spawnedSubagent = spawnSubagentActivity(item, effectiveStatus);
  if (spawnedSubagent !== null) {
    const canOpen = spawnedSubagent.childConversationId !== null
      && onOpenSubagent !== undefined;
    const Identity = canOpen || canExpand ? "button" : "span";
    return (
      <Identity
        {...(canOpen || !canExpand ? {} : { "aria-expanded": isExpanded })}
        aria-label={!canExpand && !canOpen ? `${spawnedSubagent.name} ${spawnedSubagent.action}` : canOpen
          ? `在侧边打开 Subagent 对话：${spawnedSubagent.name}`
          : `${toggleLabel}：${spawnedSubagent.name}`}
        className="inline-flex min-w-0 flex-[0_1_auto] cursor-pointer items-center gap-[6px] overflow-hidden border-0 bg-transparent p-0 text-left text-[var(--app-muted-foreground)] transition-colors hover:text-[var(--app-foreground)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1 [font:inherit]"
        title={!canExpand && !canOpen ? undefined : canOpen ? `在侧边打开 ${spawnedSubagent.name}` : toggleLabel}
        {...(canOpen || canExpand ? { type: "button" as const } : {})}
        onClick={() => {
          if (
            spawnedSubagent.childConversationId !== null
            && onOpenSubagent !== undefined
          ) {
            onOpenSubagent(spawnedSubagent.childConversationId);
            return;
          }
          if (canExpand) onToggle();
        }}
      >
        <SubagentAvatar
          icon={spawnedSubagent.avatarIcon}
          seed={spawnedSubagent.childConversationId ?? item.id}
          size="compact"
        />
        <span className="min-w-0 truncate font-medium text-[var(--app-foreground)]">
          {spawnedSubagent.name}
        </span>
        <span className="shrink-0 text-[var(--app-muted-foreground)]">
          {spawnedSubagent.action}
        </span>
      </Identity>
    );
  }
  if (summary === null) {
    if (!canExpand) return <span className="tool-timeline-item__label-text min-w-0 truncate">{label}</span>;
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
      {canExpand ? <button
        aria-expanded={isExpanded}
        aria-label={`${toggleLabel}：${label}`}
        className={toggleClassName}
        title={toggleLabel}
        type="button"
        onClick={onToggle}
      >
        <span className="tool-timeline-item__label-text">{summary.action}</span>
      </button> : <span className="tool-timeline-item__label-text">{summary.action}</span>}
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
