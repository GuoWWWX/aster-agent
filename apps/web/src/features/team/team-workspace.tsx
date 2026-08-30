import {
  GitBranch,
  LayoutDashboard,
  MessageSquareText,
  Radio,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import type {
  ConversationSummary,
  ProjectSummary,
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
import { TeamOperations } from "./team-operations-panel.js";
import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";
import {
  matchesWorkItemFilter,
} from "./team-work-item-lifecycle.js";
import {
  WorkItemInbox,
  type WorkItemFilter,
} from "./team-work-item-inbox.js";
import { WorkItemLifecyclePanel } from "./team-work-item-lifecycle-panel.js";
import { TeamWorkItemBoard } from "./team-work-item-board.js";
import { WorkflowDesigner } from "./team-workflow-designer.js";
import "./team-workflow.css";
import "./team-workspace.css";

type TeamWorkspaceView = "board" | "planning" | "runtime";

export function TeamWorkspace({
  agentClient,
  onOpenConversation,
  projects,
}: {
  agentClient: AgentClient;
  onOpenConversation: (conversation: ConversationSummary) => void;
  projects: readonly ProjectSummary[];
}): ReactElement {
  const teams = useAgentDirectoryStore((state) => state.teams);
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id ?? "");
  const [runtimeItems, setRuntimeItems] = useState<TeamWorkItemView[]>([]);
  const [execution, setExecution] = useState<TeamWorkItemExecutionView | null>(null);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState("");
  const [filter, setFilter] = useState<WorkItemFilter>("all");
  const [draft, setDraft] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
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
      setSelectedWorkItemId("");
      setEditingItemId(null);
      setDraft("");
      setError(null);
      setIsSubmitting(false);
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
  }), [
    agentClient,
    selectedExecution,
    loadExecution,
    loadWorkItems,
    selectedRuntimeWorkItem,
    selectedTeam?.id,
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
          <WorkflowDesigner workItemTitle={selectedWorkItem?.title} />
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
            <div className={isSelectedWorkItemLifecycle
              ? "grid min-h-0 grid-rows-[minmax(180px,0.34fr)_minmax(0,0.66fr)] gap-[5px]"
              : "grid min-h-0"}
            >
              <TeamWorkItemStatusPanel
                execution={selectedExecution}
                isLifecycle={isSelectedWorkItemLifecycle}
                item={selectedRuntimeWorkItem}
                onOpenConversation={onOpenConversation}
              />
              {isSelectedWorkItemLifecycle ? (
              <WorkItemLifecyclePanel
                key={`${selectedWorkItem.id}-${selectedWorkItem.status}-${selectedWorkItem.acceptanceRound}`}
                item={selectedWorkItem}
                onApprove={(_action, acceptedCriteria) => void acceptWorkItem(acceptedCriteria)}
                onClaim={() => void loadWorkItems()}
                onFinishFinalization={() => void loadWorkItems()}
                onRequestRework={(request) => void requestRework(request)}
              />
              ) : null}
            </div>
          )}
          <TeamOperations
            execution={selectedExecution}
            item={selectedWorkItem}
            onOpenConversation={onOpenConversation}
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
    createdAt: formatWorkItemTime(item.createdAt),
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
      time: formatWorkItemTime(event.createdAt),
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
  isLifecycle,
  item,
  onOpenConversation,
}: {
  execution: TeamWorkItemExecutionView | null;
  isLifecycle: boolean;
  item: TeamWorkItemView;
  onOpenConversation: (conversation: ConversationSummary) => void;
}): ReactElement {
  const lead = execution?.workItemId === item.id
    ? execution.agents.find((member) => member.depth === 0) ?? null
    : null;
  const status = teamWorkItemStatusLabel(item.status);
  const activeMemberCount = execution?.workItemId === item.id
    ? execution.agents.filter((member) => member.conversation.activeRunId !== null).length
    : 0;
  const showResultSummary = item.blockedReason !== null
    || (item.resultSummary !== null && !isLifecycle);

  return (
    <main className="team-command-panel flex min-h-0 flex-col" aria-labelledby="team-work-item-status-heading">
      <header className="team-command-panel__heading">
        <h2 id="team-work-item-status-heading">当前任务状态</h2>
        <span>{status}</span>
      </header>
      <div className="grid min-h-0 content-start gap-[5px] overflow-auto p-[10px]">
        <section className="grid gap-[5px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] p-[10px]">
          <strong className="min-w-0 overflow-hidden text-[length:var(--app-font-size-subtitle)] text-[var(--app-foreground)] text-ellipsis whitespace-nowrap">
            {item.title}
          </strong>
          <p className="m-0 text-[length:var(--app-font-size-body)] leading-[1.55] text-[var(--app-muted-foreground)]">
            {item.requirement}
          </p>
        </section>
        <section className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[5px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-[10px]">
          <MessageSquareText aria-hidden="true" className="text-[var(--app-accent)]" size={17} />
          <div className="grid min-w-0 gap-[2px]">
            <strong className="overflow-hidden text-[length:var(--app-font-size-body)] text-[var(--app-foreground)] text-ellipsis whitespace-nowrap">
              {lead === null ? "等待 Team Lead 创建执行对话" : `${lead.agent?.name ?? lead.conversation.title} 主对话`}
            </strong>
            <span className="overflow-hidden text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)] text-ellipsis whitespace-nowrap">
              {lead === null
                ? "任务被领取后，会在正常项目对话列表中出现。"
                : "成员 Agent 位于该对话节点下方；在正常对话区查看完整过程。"}
            </span>
          </div>
          <button
            className="inline-flex h-[30px] items-center gap-[4px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[8px] text-[length:var(--app-font-size-control)] font-semibold text-[var(--app-foreground)] hover:bg-[var(--app-hover)] disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1"
            disabled={lead === null}
            type="button"
            onClick={() => lead === null ? undefined : onOpenConversation(lead.conversation)}
          >
            打开 Team Lead 对话
          </button>
        </section>
        <section className="grid gap-[5px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-[10px]">
          <div className="flex items-center justify-between gap-[5px]">
            <strong className="text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]">
              执行进度
            </strong>
            <span className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
              {execution === null ? "等待执行谱系" : `${activeMemberCount}/${execution.agents.length} 个成员运行中`}
            </span>
          </div>
          {item.tasks.length === 0 ? (
            <p className="m-0 text-[length:var(--app-font-size-auxiliary)] leading-[1.5] text-[var(--app-muted-foreground)]">
              Team Lead 正在理解需求、拆分任务或分派成员；产生计划后会显示在这里。
            </p>
          ) : (
            <ol className="m-0 grid list-none gap-[5px] p-0">
              {item.tasks.map((task, index) => (
                <li
                  key={task.id}
                  className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[5px] rounded-[var(--app-radius-small)] bg-[var(--app-panel-subtle)] px-[8px] py-[6px]"
                >
                  <span className="grid h-[18px] w-[18px] place-items-center rounded-full border border-[var(--app-border)] text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">
                    {index + 1}
                  </span>
                  <span className="min-w-0 overflow-hidden text-[length:var(--app-font-size-auxiliary)] text-[var(--app-foreground)] text-ellipsis whitespace-nowrap">
                    {task.title}
                  </span>
                  <span className="text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">
                    {teamTaskStatusLabel(task.status)}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>
        {showResultSummary ? (
          <section className="grid gap-[3px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] p-[10px]">
            <strong className="text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]">
              {item.blockedReason === null ? "交付摘要" : "需要处理"}
            </strong>
            <p className="m-0 text-[length:var(--app-font-size-auxiliary)] leading-[1.5] text-[var(--app-muted-foreground)]">
              {item.blockedReason ?? item.resultSummary}
            </p>
          </section>
        ) : null}
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

function teamWorkItemStatusLabel(status: TeamWorkItemView["status"]): string {
  if (status === "queued") return "等待调度";
  if (status === "triaging" || status === "planned") return "方案整理中";
  if (status === "running") return "执行中";
  if (status === "reviewing") return "测试与评审中";
  if (status === "waiting_user") return "等待验收";
  if (status === "completed") return "已完成";
  return "需要处理";
}

function teamTaskStatusLabel(status: TeamWorkItemView["tasks"][number]["status"]): string {
  if (status === "pending") return "待处理";
  if (status === "running") return "处理中";
  if (status === "completed") return "已完成";
  if (status === "blocked") return "已阻塞";
  return "失败";
}

function formatWorkItemTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
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
