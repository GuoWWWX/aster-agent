import {
  GitBranch,
  LayoutDashboard,
  Radio,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState, type ReactElement } from "react";
import type { ProjectSummary, TeamWorkItemView } from "@agent/protocol";

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
import {
  TEAM_WORKERS,
  type TeamWorkItemPrototype,
} from "./team-runtime-prototype.js";
import {
  matchesWorkItemFilter,
} from "./team-work-item-lifecycle.js";
import {
  WorkItemInbox,
  type WorkItemFilter,
} from "./team-work-item-inbox.js";
import { WorkItemLifecyclePanel } from "./team-work-item-lifecycle-panel.js";
import { TeamWorkItemBoard } from "./team-work-item-board.js";
import { TeamLiveExecutionPanel } from "./team-live-execution-panel.js";
import { WorkflowDesigner } from "./team-workflow-designer.js";
import "./team-workflow.css";
import "./team-workspace.css";

type TeamWorkspaceView = "board" | "planning" | "runtime";

export function TeamWorkspace({
  agentClient,
  projects,
}: {
  agentClient: AgentClient;
  projects: readonly ProjectSummary[];
}): ReactElement {
  const teams = useAgentDirectoryStore((state) => state.teams);
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id ?? "");
  const [runtimeItems, setRuntimeItems] = useState<TeamWorkItemView[]>([]);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState("");
  const [selectedProjectId, setSelectedProjectId] = useState(projects[0]?.id ?? "");
  const [filter, setFilter] = useState<WorkItemFilter>("all");
  const [draft, setDraft] = useState("");
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
  const filteredWorkItems = useMemo(
    () => workItems.filter((item) => matchesWorkItemFilter(item, filter)),
    [filter, workItems],
  );

  const loadWorkItems = useCallback(async (): Promise<void> => {
    if (selectedTeam === undefined) return;
    try {
      const items = await agentClient.listTeamWorkItems({ teamId: selectedTeam.id });
      setRuntimeItems(items);
      setSelectedWorkItemId((current) => (
        items.some((item) => item.id === current) ? current : items[0]?.id ?? ""
      ));
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "团队任务加载失败。");
    }
  }, [agentClient, selectedTeam]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadWorkItems(), 0);
    return () => window.clearTimeout(timeout);
  }, [loadWorkItems]);

  useEffect(() => agentClient.onConversationRunEvent((event) => {
    const conversationId = event.type === "conversation.updated"
      ? event.conversation.id
      : event.conversationId;
    if (!runtimeItems.some((item) => item.executionConversationId === conversationId)) return;
    window.setTimeout(() => void loadWorkItems(), 0);
  }), [agentClient, loadWorkItems, runtimeItems]);

  if (selectedTeam === undefined) return <EmptyTeamWorkspace />;

  const queuedCount = workItems.filter((item) => item.status === "queued").length;
  const processingCount = workItems.filter((item) => matchesWorkItemFilter(item, "processing")).length;
  const acceptanceCount = workItems.filter((item) => item.status === "awaiting_acceptance").length;
  const completedCount = workItems.filter((item) => item.status === "completed").length;
  const temporaryCount = TEAM_WORKERS.filter((worker) => worker.kind === "temporary").length;

  const submitWorkItem = async (): Promise<void> => {
    const requirement = draft.trim();
    if (
      requirement.length === 0
      || selectedTeam === undefined
      || selectedProjectId.length === 0
      || isSubmitting
    ) return;
    setIsSubmitting(true);
    try {
      const created = await agentClient.submitTeamWorkItem({
        acceptanceCriteria: [
          "执行结果覆盖用户需求",
          "相关验证通过",
          "风险和未决事项已说明",
        ],
        permissionMode: "ask_before_changes",
        priority: "normal",
        projectId: selectedProjectId,
        requirement,
        teamId: selectedTeam.id,
        title: requirement.split(/\r?\n/u)[0]?.slice(0, 120) || "新团队需求",
      });
      setSelectedWorkItemId(created.id);
      setFilter("all");
      setDraft("");
      setError(null);
      await loadWorkItems();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "需求投递失败。");
    } finally {
      setIsSubmitting(false);
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
      <header className="workspace-page-header team-command-header">
        <div>
          <p className="workspace-page-eyebrow">团队控制台</p>
          <h1 id="team-workspace-heading">{selectedTeam.name}</h1>
          <p className="workspace-page-description">
            持续接收项目任务，由管理 Agent 规划路径、调度成员并汇总交付。
          </p>
        </div>
        <div className="team-command-header__controls">
          <span className="team-live-badge" data-active={selectedTeam.enabled}>
            <Radio aria-hidden="true" size={12} />
            {selectedTeam.enabled ? "自动调度中" : "团队已停用"}
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
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger aria-label="选择团队任务项目" className="team-runtime-select">
              <SelectValue placeholder="选择项目" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((project) => (
                <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </header>

      <div className="team-prototype-notice" role="note">
        <div><Sparkles aria-hidden="true" size={13} />已连接真实团队 Runtime；任务会调用所选模型并在授权项目中执行。</div>
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
      </div>
      {error === null ? null : <div className="team-runtime-error" role="alert">{error}</div>}

      {view === "board" ? (
        <div className="team-command-layout team-command-layout--board">
          <TeamWorkItemBoard
            items={workItems}
            onCreate={() => {
              setFilter("all");
              setView("runtime");
            }}
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
        <div className="team-command-layout">
          <WorkItemInbox
            allowQueuedEditing={false}
            acceptanceCount={acceptanceCount}
            completedCount={completedCount}
            draft={draft}
            editingItemId={null}
            filter={filter}
            items={filteredWorkItems}
            processingCount={processingCount}
            queuedCount={queuedCount}
            selectedId={selectedWorkItem?.id ?? null}
            onCancelEdit={() => undefined}
            onDraftChange={setDraft}
            onEdit={() => undefined}
            onFilterChange={setFilter}
            onSelect={setSelectedWorkItemId}
            onSubmit={() => void submitWorkItem()}
          />
          {selectedWorkItem === null ? (
            <main className="team-command-panel team-runtime-empty">未选择任务</main>
          ) : isLifecyclePanelStatus(selectedWorkItem.status) ? (
            <WorkItemLifecyclePanel
              key={`${selectedWorkItem.id}-${selectedWorkItem.status}-${selectedWorkItem.acceptanceRound}`}
              item={selectedWorkItem}
              onApprove={(_action, acceptedCriteria) => void acceptWorkItem(acceptedCriteria)}
              onClaim={() => void loadWorkItems()}
              onFinishFinalization={() => void loadWorkItems()}
              onRequestRework={(request) => void requestRework(request)}
            />
          ) : (
            <TeamLiveExecutionPanel key={`${selectedWorkItem.id}-${selectedWorkItem.acceptanceRound}`} item={selectedWorkItem} />
          )}
          <TeamOperations temporaryCount={temporaryCount} workers={TEAM_WORKERS} item={selectedWorkItem} />
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
      actor: event.type === "accepted" || event.type === "rework_requested" ? "用户" : "Team Lead",
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
    source: "direct",
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

function formatWorkItemTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
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
