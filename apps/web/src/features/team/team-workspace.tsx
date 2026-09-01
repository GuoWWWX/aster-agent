import {
  GitBranch,
  LayoutDashboard,
  MessageSquareText,
  Radio,
  Send,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type {
  ConversationSummary,
  ProjectSummary,
  TeamCollaborationProjection,
  TeamWorkItemExecutionView,
  TeamWorkItemView,
} from "@agent/protocol";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import type { AgentClient } from "../../runtime/agent-client.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { TeamOperations } from "./team-operations-panel.js";
import { AgentAvatar } from "./agent-avatar.js";
import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";
import {
  matchesWorkItemFilter,
} from "./team-work-item-lifecycle.js";
import {
  WorkItemInbox,
  type WorkItemFilter,
} from "./team-work-item-inbox.js";
import { WorkItemLifecyclePanel } from "./team-work-item-lifecycle-panel.js";
import { formatTeamWorkItemTime } from "./team-work-item-time.js";
import { TeamWorkItemBoard } from "./team-work-item-board.js";
import {
  applyCollaborationAssistantDelta,
  CollaborationGraph,
} from "./collaboration/collaboration-graph.js";
import "./team-workflow.css";
import "./team-workspace.css";

type TeamWorkspaceView = "board" | "planning" | "runtime";

function toProjectSession(conversation: ConversationSummary): ProjectSession {
  return {
    activeSubagentCount: conversation.activeSubagentCount,
    activeRunId: conversation.activeRunId,
    agentId: conversation.agentId,
    avatarIcon: conversation.avatarIcon ?? null,
    hasUnreadResult: conversation.hasUnreadResult,
    id: conversation.id,
    isArchived: conversation.isArchived,
    isPinned: conversation.isPinned,
    lastRunStatus: conversation.lastRunStatus,
    modelSelection: conversation.modelSelection,
    parentConversationId: conversation.parentConversationId,
    pinOrder: conversation.pinOrder ?? null,
    projectId: conversation.projectId,
    teamId: conversation.teamId,
    teamWorkItemId: conversation.teamWorkItemId,
    threadKind: conversation.threadKind,
    title: conversation.title,
    workspaceRootPath: conversation.workspaceRootPath,
    ...(conversation.subagentTaskStatus === undefined ? {} : {
      subagentTaskStatus: conversation.subagentTaskStatus,
    }),
  };
}

export function TeamWorkspace({
  agentClient,
  onOpenConversation,
  onNavigateToConversation,
  projects,
}: {
  agentClient: AgentClient;
  onOpenConversation: (conversation: ProjectSession, sourceConversationId?: string) => void;
  onNavigateToConversation?: (conversationId: string) => void;
  projects: readonly ProjectSummary[];
}): ReactElement {
  const teams = useAgentDirectoryStore((state) => state.teams);
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id ?? "");
  const [runtimeItems, setRuntimeItems] = useState<TeamWorkItemView[]>([]);
  const [execution, setExecution] = useState<TeamWorkItemExecutionView | null>(null);
  const [collaborationProjections, setCollaborationProjections] = useState<
    ReadonlyMap<string, TeamCollaborationProjection>
  >(new Map());
  const [selectedWorkItemId, setSelectedWorkItemId] = useState("");
  const [filter, setFilter] = useState<WorkItemFilter>("all");
  const [draft, setDraft] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [publishingWorkItemId, setPublishingWorkItemId] = useState<string | null>(null);
  const [view, setView] = useState<TeamWorkspaceView>("board");
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];
  const workItems = useMemo(
    () => runtimeItems.map((item) => toPrototypeWorkItem(item, projects)),
    [projects, runtimeItems],
  );
  const selectedWorkItem = workItems.find((item) => item.id === selectedWorkItemId)
    ?? workItems[0]
    ?? null;
  const selectedRuntimeWorkItem = runtimeItems.find((item) => item.id === selectedWorkItemId)
    ?? runtimeItems[0]
    ?? null;
  const isSelectedWorkItemLifecycle = selectedWorkItem !== null
    && isLifecyclePanelStatus(selectedWorkItem.status);
  const selectedExecution = execution?.workItemId === selectedRuntimeWorkItem?.id
    ? execution
    : null;
  const selectedCollaborationProjection = selectedRuntimeWorkItem === null
    ? null
    : collaborationProjections.get(selectedRuntimeWorkItem.id) ?? null;
  const activeTeamIdRef = useRef<string | null>(selectedTeam?.id ?? null);
  const workItemsRequestIdRef = useRef(0);
  const workItemMutationRequestIdRef = useRef(0);
  const activeExecutionWorkItemIdRef = useRef<string | null>(null);
  const executionRequestIdRef = useRef(0);
  const filteredWorkItems = useMemo(
    () => workItems.filter((item) => matchesWorkItemFilter(item, filter)),
    [filter, workItems],
  );

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setSelectedTeamId((current) => (
        teams.some((team) => team.id === current) ? current : teams[0]?.id ?? ""
      ));
    });
    return () => {
      cancelled = true;
    };
  }, [teams]);

  useEffect(() => {
    activeTeamIdRef.current = selectedTeam?.id ?? null;
    workItemsRequestIdRef.current += 1;
    workItemMutationRequestIdRef.current += 1;
    executionRequestIdRef.current += 1;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setRuntimeItems([]);
      setExecution(null);
      setCollaborationProjections(new Map());
      setSelectedWorkItemId("");
      setEditingItemId(null);
      setDraft("");
      setError(null);
      setIsSubmitting(false);
      setPublishingWorkItemId(null);
    });
    return () => {
      cancelled = true;
    };
  }, [selectedTeam?.id]);

  useEffect(() => {
    activeExecutionWorkItemIdRef.current = selectedRuntimeWorkItem?.id ?? null;
    executionRequestIdRef.current += 1;
  }, [selectedRuntimeWorkItem?.id]);

  const loadWorkItems = useCallback(async (): Promise<void> => {
    const teamId = selectedTeam?.id;
    const requestId = ++workItemsRequestIdRef.current;
    if (teamId === undefined) return;
    try {
      const items = await agentClient.listTeamWorkItems({ teamId });
      if (
        requestId !== workItemsRequestIdRef.current
        || activeTeamIdRef.current !== teamId
      ) return;
      setRuntimeItems(items);
      setSelectedWorkItemId((current) => (
        items.some((item) => item.id === current) ? current : items[0]?.id ?? ""
      ));
      setError(null);
      const projectionEntries = await Promise.all(items.map(async (item) => {
        try {
          const projection = await agentClient.getTeamCollaborationProjection(item.id);
          return [item.id, projection] as const;
        } catch {
          return null;
        }
      }));
      if (
        requestId !== workItemsRequestIdRef.current
        || activeTeamIdRef.current !== teamId
      ) return;
      setCollaborationProjections(new Map(
        projectionEntries.filter((entry): entry is readonly [string, TeamCollaborationProjection] => (
          entry !== null
        )),
      ));
    } catch (reason) {
      if (
        requestId !== workItemsRequestIdRef.current
        || activeTeamIdRef.current !== teamId
      ) return;
      setError(reason instanceof Error ? reason.message : "团队任务加载失败。");
    }
  }, [agentClient, selectedTeam]);

  const loadExecution = useCallback(async (): Promise<void> => {
    const workItemId = selectedRuntimeWorkItem?.id;
    const requestId = ++executionRequestIdRef.current;
    if (workItemId === undefined) {
      setExecution(null);
      return;
    }
    try {
      const nextExecution = await agentClient.getTeamWorkItemExecution(workItemId);
      if (
        requestId !== executionRequestIdRef.current
        || activeExecutionWorkItemIdRef.current !== workItemId
      ) return;
      setExecution(nextExecution);
    } catch (reason) {
      if (
        requestId !== executionRequestIdRef.current
        || activeExecutionWorkItemIdRef.current !== workItemId
      ) return;
      setExecution(null);
      setError(reason instanceof Error ? reason.message : "团队成员执行谱系加载失败。");
    }
  }, [agentClient, selectedRuntimeWorkItem?.id]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadWorkItems(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadWorkItems]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadExecution(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadExecution]);

  useEffect(() => agentClient.onConversationRunEvent((event) => {
    if (event.type === "assistant.delta") {
      if (view === "board" || selectedRuntimeWorkItem === null) return;
      setCollaborationProjections((current) => {
        const projection = current.get(selectedRuntimeWorkItem.id);
        if (projection === undefined) return current;
        const updated = applyCollaborationAssistantDelta(
          projection,
          event,
          selectedRuntimeWorkItem.id,
        );
        if (updated === projection) return current;
        const next = new Map(current);
        next.set(selectedRuntimeWorkItem.id, updated);
        return next;
      });
      return;
    }
    if (
      event.type !== "conversation.updated"
      && event.type !== "run.started"
      && event.type !== "run.finished"
      && event.type !== "task_list.updated"
      && event.type !== "tool.completed"
    ) return;
    const conversationId = event.type === "conversation.updated"
      ? event.conversation.id
      : event.conversationId;
    const executionConversationIds = new Set([
      selectedRuntimeWorkItem?.executionConversationId,
      ...(selectedExecution?.agents.map((member) => member.conversation.id) ?? []),
    ]);
    const isAwaitingExecutionDiscovery = selectedRuntimeWorkItem !== null
      && (selectedRuntimeWorkItem.status === "queued"
        || selectedRuntimeWorkItem.status === "running"
        || selectedRuntimeWorkItem.status === "reviewing")
      && (selectedExecution === null || selectedExecution.agents.length === 0);
    const canDiscoverExecution = isAwaitingExecutionDiscovery && (
      event.type === "run.started"
      || event.type === "run.finished"
      || (event.type === "conversation.updated" && event.conversation.teamId === selectedTeam?.id)
    );
    const isSelectedExecutionConversation = event.type === "conversation.updated"
      && event.conversation.teamWorkItemId === selectedRuntimeWorkItem?.id;
    if (
      !executionConversationIds.has(conversationId)
      && !isSelectedExecutionConversation
      && !canDiscoverExecution
    ) return;
    void loadWorkItems();
    void loadExecution();
    if (event.type === "run.finished") {
      window.setTimeout(() => {
        void loadWorkItems();
        void loadExecution();
      }, 100);
    }
  }), [
    agentClient,
    selectedExecution,
    loadExecution,
    loadWorkItems,
    selectedRuntimeWorkItem,
    selectedTeam?.id,
    view,
  ]);

  if (selectedTeam === undefined) return <EmptyTeamWorkspace />;

  const queuedCount = workItems.filter((item) => item.status === "queued").length;
  const processingCount = workItems.filter((item) => matchesWorkItemFilter(item, "processing")).length;
  const acceptanceCount = workItems.filter((item) => item.status === "awaiting_acceptance").length;
  const completedCount = workItems.filter((item) => item.status === "completed").length;

  const submitWorkItem = async (): Promise<void> => {
    const requirement = draft.trim();
    if (requirement.length === 0 || isSubmitting) return;
    const teamId = selectedTeam?.id ?? null;
    const mutationRequestId = ++workItemMutationRequestIdRef.current;
    const canApplyMutation = (): boolean => (
      mutationRequestId === workItemMutationRequestIdRef.current
      && activeTeamIdRef.current === teamId
    );
    setIsSubmitting(true);
    try {
      if (editingItemId !== null) {
        const updated = await agentClient.updateTeamWorkItem({
          requirement,
          title: workItemTitleFromRequirement(requirement),
          workItemId: editingItemId,
        });
        if (!canApplyMutation()) return;
        setSelectedWorkItemId(updated.id);
        setEditingItemId(null);
        setDraft("");
        setError(null);
        await loadWorkItems();
        return;
      }
      return;
    } catch (reason) {
      if (!canApplyMutation()) return;
      setError(reason instanceof Error ? reason.message : "需求投递失败。");
    } finally {
      if (canApplyMutation()) setIsSubmitting(false);
    }
  };

  const requestRework = async (request: string): Promise<void> => {
    const workItemId = selectedWorkItem?.id;
    if (workItemId === undefined) return;
    try {
      await agentClient.requestTeamWorkItemRework({ feedback: request, workItemId });
      setFilter("processing");
      await loadWorkItems();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "返工请求提交失败。");
    }
  };

  const publishWorkItem = async (): Promise<void> => {
    const workItemId = selectedRuntimeWorkItem?.id;
    if (workItemId === undefined || publishingWorkItemId !== null) return;
    setPublishingWorkItemId(workItemId);
    try {
      const updated = await agentClient.publishTeamWorkItem({ workItemId });
      setRuntimeItems((current) => current.map((item) => item.id === updated.id ? updated : item));
      setError(null);
      await loadWorkItems();
      await loadExecution();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "任务发布失败。");
    } finally {
      setPublishingWorkItemId((current) => current === workItemId ? null : current);
    }
  };

  const acceptWorkItem = async (acceptedCriteria: readonly string[]): Promise<void> => {
    const workItemId = selectedWorkItem?.id;
    if (workItemId === undefined) return;
    try {
      await agentClient.acceptTeamWorkItem({ acceptedCriteria: [...acceptedCriteria], workItemId });
      setFilter("completed");
      await loadWorkItems();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "验收操作失败。");
    }
  };

  return (
    <section className="team-workspace" aria-labelledby="team-workspace-heading">
      <header className="team-command-header">
        <div>
          <h1 id="team-workspace-heading">{selectedTeam.name}</h1>
          <p className="team-command-header__description">
            持续接收项目任务，由管理 Agent 规划路径、调度成员并汇总交付。
          </p>
        </div>
        <div className="team-command-header__controls">
          <span className="team-live-badge" data-active={selectedTeam.enabled}>
            <Radio aria-hidden="true" size={12} />
            {selectedTeam.enabled ? "自动分发中" : "团队已停用"}
          </span>
          <Select value={selectedTeam.id} onValueChange={setSelectedTeamId}>
            <SelectTrigger aria-label="选择要查看的团队" className="team-runtime-select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {teams.map((team) => (
                <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="team-workspace__toolbar">
        <div className="team-view-switcher" role="tablist" aria-label="团队页面模式">
          <button aria-selected={view === "board"} role="tab" type="button" onClick={() => setView("board")}>
            <LayoutDashboard aria-hidden="true" size={12} />需求看板
          </button>
          <button aria-selected={view === "runtime"} role="tab" type="button" onClick={() => setView("runtime")}>
            <Radio aria-hidden="true" size={12} />任务与验收
          </button>
          <button aria-selected={view === "planning"} role="tab" type="button" onClick={() => setView("planning")}>
            <GitBranch aria-hidden="true" size={12} />执行规划
          </button>
        </div>
        <div className="team-runtime-note" role="note">
          <Sparkles aria-hidden="true" size={13} />
          已连接真实团队 Runtime；任务会调用所选模型并在授权项目中执行。
        </div>
      </div>
      {error === null ? null : <div className="team-runtime-error" role="alert">{error}</div>}

      {view === "board" ? (
        <div className="team-command-layout team-command-layout--board">
          <TeamWorkItemBoard
            items={workItems}
            onOpen={(workItemId) => {
              setSelectedWorkItemId(workItemId);
              setFilter("all");
              setView("runtime");
            }}
          />
        </div>
      ) : view === "planning" ? (
        <div className="team-command-layout team-command-layout--designer">
          {selectedCollaborationProjection === null ? (
            <div className="team-command-panel team-runtime-empty">选择任务后查看真实协作计划与通信</div>
          ) : (
            <CollaborationGraph
              projection={selectedCollaborationProjection}
              title={selectedWorkItem?.title ?? "Agent 协作计划与实时通信"}
              variant="full"
              onOpenConversation={(conversationId) => {
                const conversation = selectedExecution?.agents.find(
                  (participant) => participant.conversation.id === conversationId,
                )?.conversation;
                if (conversation !== undefined) {
                  onOpenConversation(
                    toProjectSession(conversation),
                    selectedRuntimeWorkItem?.sourceConversationId ?? undefined,
                  );
                }
              }}
              {...(onNavigateToConversation === undefined ? {} : { onNavigateToConversation })}
            />
          )}
        </div>
      ) : (
        <div className="team-command-layout team-command-layout--execution">
          <WorkItemInbox
            allowQueuedEditing
            acceptanceCount={acceptanceCount}
            completedCount={completedCount}
            draft={draft}
            editingItemId={editingItemId}
            filter={filter}
            items={filteredWorkItems}
            processingCount={processingCount}
            queuedCount={queuedCount}
            selectedId={selectedWorkItem?.id ?? null}
            onCancelEdit={() => {
              setEditingItemId(null);
              setDraft("");
            }}
            onDraftChange={setDraft}
            onEdit={(workItemId) => {
              const item = runtimeItems.find((candidate) => candidate.id === workItemId);
              if (item === undefined || item.status !== "queued") return;
              setSelectedWorkItemId(item.id);
              setEditingItemId(item.id);
              setDraft(item.requirement);
            }}
            onFilterChange={setFilter}
            onSelect={setSelectedWorkItemId}
            onSaveEdit={() => void submitWorkItem()}
          />
          {selectedWorkItem === null ? (
            <main className="team-command-panel team-runtime-empty">未选择任务</main>
          ) : selectedRuntimeWorkItem === null ? (
            <main className="team-command-panel team-runtime-empty">无法加载真实执行状态</main>
          ) : (
            <div
              aria-label="任务详情"
              className="relative grid min-h-0 grid-rows-[145px_minmax(220px,280px)_minmax(320px,1fr)] gap-[5px] overflow-hidden"
              data-team-runtime-layout="details"
            >
              <TeamWorkItemStatusPanel
                execution={selectedExecution}
                isPublishing={publishingWorkItemId === selectedRuntimeWorkItem.id}
                item={selectedRuntimeWorkItem}
                onPublish={() => void publishWorkItem()}
                projection={selectedCollaborationProjection}
                onOpenConversation={onOpenConversation}
                {...(onNavigateToConversation === undefined ? {} : { onNavigateToConversation })}
              />
              <div className="grid min-h-0" data-team-runtime-card="progress">
                {isSelectedWorkItemLifecycle ? (
                  <WorkItemLifecyclePanel
                    key={`${selectedWorkItem.id}-${selectedWorkItem.status}-${selectedWorkItem.acceptanceRound}`}
                    item={selectedWorkItem}
                    onApprove={(_action, acceptedCriteria) => void acceptWorkItem(acceptedCriteria)}
                    onClaim={() => void loadWorkItems()}
                    onFinishFinalization={() => void loadWorkItems()}
                    onRequestRework={(request) => void requestRework(request)}
                  />
                ) : (
                  <ExecutionProgressPanel execution={selectedExecution} item={selectedRuntimeWorkItem} />
                )}
              </div>
            </div>
          )}
          <TeamOperations
            execution={selectedExecution}
            item={selectedWorkItem}
            onOpenConversation={(conversation) => onOpenConversation(
              toProjectSession(conversation),
              selectedRuntimeWorkItem?.sourceConversationId ?? undefined,
            )}
          />
        </div>
      )}
    </section>
  );
}

function toPrototypeWorkItem(
  item: TeamWorkItemView,
  projects: readonly ProjectSummary[],
): TeamWorkItemPrototype {
  const status = prototypeStatus(item.status);
  return {
    acceptance: item.acceptanceCriteria.length === 0
      ? ["执行结果覆盖用户需求", "相关验证通过", "风险和未决事项已说明"]
      : item.acceptanceCriteria,
    acceptedCriteria: item.acceptedCriteria,
    acceptanceRound: item.revision,
    createdAt: item.createdAt,
    delivery: item.resultSummary === null ? null : {
      changedFiles: 0,
      commits: 0,
      summary: item.resultSummary,
      tests: item.tasks.filter((task) => task.status === "completed").map((task) => task.title),
    },
    events: item.events.map((event) => ({
      actor: event.type === "accepted" || event.type === "rework_requested" || event.type === "updated"
        ? "用户"
        : "Team Lead",
      detail: event.detail,
      id: event.id,
      time: formatTeamWorkItemTime(event.createdAt),
      type: event.type === "accepted" || event.type === "rework_requested"
        ? "review"
        : event.type === "failed" || event.type === "blocked"
          ? "status"
          : event.type === "review_ready"
            ? "completion"
            : "assignment",
    })),
    finalizationAction: status === "completed" ? "complete" : null,
    id: item.id,
    nextAction: nextAction(item),
    plan: item.tasks.length === 0
      ? "Agent 正在检查项目并决定是否需要拆分任务或委派成员。"
      : item.tasks.map((task) => task.title).join(" → "),
    priority: item.priority,
    project: projects.find((project) => project.id === item.projectId)?.name ?? "未知项目",
    reworkRequest: item.events.filter((event) => event.type === "rework_requested").at(-1)?.detail ?? null,
    source: item.sourceConversationId === null ? "direct" : "conversation",
    status,
    tasks: item.tasks.map((task) => ({
      agent: "团队 Agent",
      id: task.id,
      result: task.reason ?? (task.status === "completed" ? "已完成" : "等待运行时更新"),
      role: task.title.includes("评审") ? "reviewer" : task.title.includes("测试") ? "tester" : "developer",
      status: task.status === "pending"
        ? "queued"
        : task.status === "running"
          ? "running"
          : task.status === "completed"
            ? "completed"
            : "blocked",
      title: task.title,
    })),
    title: item.title,
  };
}

function TeamWorkItemStatusPanel({
  execution,
  isPublishing,
  item,
  onNavigateToConversation,
  projection,
  onOpenConversation,
  onPublish,
}: {
  execution: TeamWorkItemExecutionView | null;
  isPublishing: boolean;
  item: TeamWorkItemView;
  onNavigateToConversation?: (conversationId: string) => void;
  projection: TeamCollaborationProjection | null;
  onOpenConversation: (conversation: ProjectSession, sourceConversationId?: string) => void;
  onPublish: () => void;
}): ReactElement {
  const lead = execution?.workItemId === item.id
    ? execution.agents.find((member) => member.depth === 0) ?? null
    : null;
  const [isRequirementOpen, setIsRequirementOpen] = useState(false);
  const status = teamWorkItemStatusLabel(item.status);
  const priority = workItemPriorityLabel(item.priority);
  const canPublish = isPublishableWorkItemStatus(item.status);
  const publishAction = canPublish ? (
    <button
      className="ml-[5px] inline-flex h-[26px] shrink-0 items-center gap-[4px] rounded-[var(--app-radius-small)] bg-[var(--app-accent)] px-[8px] text-[length:var(--app-font-size-control)] font-semibold text-white shadow-sm hover:brightness-95 disabled:cursor-wait disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1"
      disabled={isPublishing}
      type="button"
      onClick={onPublish}
    >
      <Send aria-hidden="true" className={isPublishing ? "animate-pulse" : undefined} size={13} />
      {isPublishing ? "发布中" : item.status === "queued" ? "发布处理" : "重新发布"}
    </button>
  ) : null;

  return (
    <>
      <section
        aria-labelledby="team-work-item-requirement-heading"
        className="team-command-panel grid min-h-0 grid-rows-[40px_minmax(0,1fr)]"
        data-team-runtime-card="requirement"
      >
        <header className="team-command-panel__heading">
          <h2 id="team-work-item-requirement-heading">用户需求</h2>
          <div className="flex min-w-0 items-center gap-[5px]">
            <span className="rounded-[var(--app-radius-small)] bg-[var(--app-selection)] px-[5px] py-[2px] font-semibold text-[var(--app-selection-foreground)]">{status}</span>
            <span className="rounded-[var(--app-radius-small)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[5px] py-[2px] font-semibold text-[var(--app-foreground)]">{priority}</span>
            <time className="truncate text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">创建于 {formatTeamWorkItemTime(item.createdAt)}</time>
          </div>
        </header>
        <div aria-label="用户需求" className="grid min-h-0 grid-rows-[32px_minmax(0,1fr)] gap-[5px] px-[10px] py-[8px]">
          <div className="flex min-w-0 items-center justify-between border-b border-[var(--app-border)] pb-[5px]">
            <span className="flex min-w-0 items-center gap-[5px] text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">
              <span data-team-lead-avatar="true"><AgentAvatar avatar={{ icon: lead?.conversation.avatarIcon ?? "sparkles", kind: "icon" }} size="compact" /></span>
              <span className="truncate">Team Lead 主对话：{lead?.agent?.name ?? "等待创建"}</span>
            </span>
            <div className="flex shrink-0 items-center gap-[5px]">
              <button className="inline-flex h-[28px] items-center rounded-[var(--app-radius)] px-[8px] text-[length:var(--app-font-size-control)] font-semibold text-[var(--app-accent)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1" type="button" onClick={() => setIsRequirementOpen(true)}>查看完整需求</button>
              <button aria-label={lead === null ? "等待 Team Lead 创建执行对话" : "打开 Team Lead 对话"} className="inline-flex h-[28px] items-center gap-[4px] rounded-[var(--app-radius)] border border-[var(--app-accent)] bg-[var(--app-panel)] px-[8px] text-[length:var(--app-font-size-control)] font-semibold text-[var(--app-accent)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1" disabled={lead === null} type="button" onClick={() => lead === null ? undefined : onOpenConversation(toProjectSession(lead.conversation), item.sourceConversationId ?? undefined)}>
                <MessageSquareText aria-hidden="true" size={14} />打开对话
              </button>
            </div>
          </div>
          <p className="m-0 line-clamp-2 self-start text-[length:var(--app-font-size-body)] leading-[1.5] font-medium text-[var(--app-foreground)]" title={item.requirement}>{item.requirement}</p>
        </div>
      </section>
      <div aria-label="协作与执行" className="grid min-h-0" data-team-runtime-card="collaboration">
        {projection === null ? (
          <div className="team-command-panel grid min-h-0 grid-rows-[38px_minmax(0,1fr)] overflow-hidden">
            <header className="flex min-w-0 items-center justify-between border-b border-[var(--app-border)] px-[10px]">
              <strong className="text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]">协作计划与通信</strong>
              <div className="flex items-center text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
                <span>尚未发布计划 · 0 条消息</span>
                {publishAction}
              </div>
            </header>
            <div className="team-runtime-empty">Team Lead 领取任务后，这里会显示计划路线和真实通信。</div>
          </div>
        ) : (
          <CollaborationGraph
            headerAction={publishAction}
            projection={projection}
            title="协作计划与通信"
            variant="embedded"
            onOpenConversation={(conversationId) => {
              const conversation = execution?.agents.find((participant) => participant.conversation.id === conversationId)?.conversation;
              if (conversation !== undefined) onOpenConversation(toProjectSession(conversation), item.sourceConversationId ?? undefined);
            }}
            {...(onNavigateToConversation === undefined ? {} : { onNavigateToConversation })}
          />
        )}
      </div>
      {isRequirementOpen ? (
        <div className="absolute inset-0 z-30 grid place-items-center bg-black/20 p-[20px] backdrop-blur-[1px]">
          <button aria-label="关闭完整用户需求" className="absolute inset-0 cursor-default" type="button" onClick={() => setIsRequirementOpen(false)} />
          <section aria-label="完整用户需求" aria-modal="true" className="relative z-10 grid max-h-[80%] w-[min(540px,90%)] grid-rows-[40px_minmax(0,1fr)] overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] shadow-xl" role="dialog">
            <header className="flex items-center justify-between border-b border-[var(--app-border)] px-[10px]">
              <strong className="text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]">用户需求</strong>
              <button aria-label="关闭完整用户需求" className="h-[28px] rounded-[var(--app-radius-small)] px-[8px] text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)]" type="button" onClick={() => setIsRequirementOpen(false)}>关闭</button>
            </header>
            <p className="m-0 overflow-auto whitespace-pre-wrap p-[12px] text-[length:var(--app-font-size-body)] leading-[1.6] text-[var(--app-foreground)]">{item.requirement}</p>
          </section>
        </div>
      ) : null}
    </>
  );
}

function ExecutionProgressPanel({
  execution,
  item,
}: {
  execution: TeamWorkItemExecutionView | null;
  item: TeamWorkItemView;
}): ReactElement {
  const activeMemberCount = execution?.workItemId === item.id
    ? execution.agents.filter((member) => member.conversation.activeRunId !== null).length
    : 0;
  const summary = item.blockedReason ?? item.resultSummary;

  return (
    <main className="team-command-panel grid min-h-0 grid-rows-[40px_minmax(0,1fr)]" aria-labelledby="team-execution-progress-heading">
      <header className="team-command-panel__heading">
        <h2 id="team-execution-progress-heading">执行进度</h2>
        <span>{execution === null ? "等待执行谱系" : `${activeMemberCount}/${execution.agents.length} 个成员运行中`}</span>
      </header>
      <div className="grid min-h-0 content-start gap-[10px] overflow-auto p-[10px]">
        {summary === null ? null : (
          <section className="grid gap-[3px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-[10px] py-[8px]">
            <strong className={item.blockedReason === null ? "text-[var(--app-foreground)]" : "text-[var(--app-destructive)]"}>{item.blockedReason === null ? "阶段结果" : "需要处理"}</strong>
            <p className="m-0 line-clamp-3 text-[length:var(--app-font-size-auxiliary)] leading-[1.5] text-[var(--app-muted-foreground)]">{summary}</p>
          </section>
        )}
        <ol className="m-0 grid list-none gap-[5px] p-0">
          {item.tasks.length === 0 ? (
            <li className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">Team Lead 正在理解需求、拆分任务或分派成员。</li>
          ) : item.tasks.map((task, index) => (
            <li key={task.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[8px] rounded-[var(--app-radius-small)] border border-[var(--app-border)] px-[8px] py-[7px]">
              <span className="grid h-[20px] w-[20px] place-items-center rounded-full bg-[var(--app-panel-subtle)] text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{index + 1}</span>
              <span className="truncate text-[length:var(--app-font-size-auxiliary)] text-[var(--app-foreground)]">{task.title}</span>
              <span className="text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{teamTaskStatusLabel(task.status)}</span>
            </li>
          ))}
        </ol>
      </div>
    </main>
  );
}

function prototypeStatus(status: TeamWorkItemView["status"]): TeamWorkItemPrototype["status"] {
  if (status === "inbox" || status === "queued") return "queued";
  if (status === "triaging" || status === "planned") return "planning";
  if (status === "running") return "executing";
  if (status === "reviewing") return "reviewing";
  if (status === "waiting_user") return "awaiting_acceptance";
  if (status === "completed") return "completed";
  return "blocked";
}

function nextAction(item: TeamWorkItemView): string {
  if (item.status === "waiting_user") return "等待用户逐项验收，或提交返工要求。";
  if (item.status === "completed") return "工作项已完成。";
  if (item.status === "failed" || item.status === "blocked") {
    return item.blockedReason ?? "任务需要人工处理后才能继续。";
  }
  if (item.status === "queued") return "等待团队调度容量。";
  return "团队正在执行、验证并整理交付结果。";
}

function isPublishableWorkItemStatus(status: TeamWorkItemView["status"]): boolean {
  return status === "queued"
    || status === "blocked"
    || status === "failed"
    || status === "cancelled";
}

function teamWorkItemStatusLabel(status: TeamWorkItemView["status"]): string {
  if (status === "queued") return "等待调度";
  if (status === "triaging" || status === "planned") return "方案整理中";
  if (status === "running") return "执行中";
  if (status === "reviewing") return "测试与评审中";
  if (status === "waiting_user") return "等待验收";
  if (status === "completed") return "已完成";
  return "需要处理";
}

function workItemPriorityLabel(priority: TeamWorkItemView["priority"]): "P1" | "P2" | "P3" {
  if (priority === "high") return "P1";
  if (priority === "normal") return "P2";
  return "P3";
}

function teamTaskStatusLabel(status: TeamWorkItemView["tasks"][number]["status"]): string {
  if (status === "pending") return "待处理";
  if (status === "running") return "处理中";
  if (status === "completed") return "已完成";
  if (status === "blocked") return "已阻塞";
  return "失败";
}

function workItemTitleFromRequirement(requirement: string): string {
  return requirement.split(/\r?\n/u)[0]?.slice(0, 120) || "新团队需求";
}

function isLifecyclePanelStatus(status: TeamWorkItemPrototype["status"]): boolean {
  return status === "queued"
    || status === "awaiting_acceptance"
    || status === "finalizing"
    || status === "completed";
}

function EmptyTeamWorkspace(): ReactElement {
  return (
    <section className="team-workspace team-workspace--empty" aria-label="团队控制台">
      <UsersRound aria-hidden="true" size={24} />
      <h1>还没有团队</h1>
      <p>请先在设置中创建 Agent 和团队。</p>
    </section>
  );
}
