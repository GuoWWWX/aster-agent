import {
  GitBranch,
  LayoutDashboard,
  Radio,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { TeamOperations } from "./team-operations-panel.js";
import {
  TEAM_WORK_ITEMS,
  TEAM_WORKERS,
  type TeamEventPrototype,
  type TeamFinalizationAction,
  type TeamWorkItemPrototype,
} from "./team-runtime-prototype.js";
import {
  matchesWorkItemFilter,
  transitionWorkItem,
  type WorkItemLifecycleAction,
} from "./team-work-item-lifecycle.js";
import {
  WorkItemInbox,
  type WorkItemFilter,
} from "./team-work-item-inbox.js";
import { WorkItemLifecyclePanel } from "./team-work-item-lifecycle-panel.js";
import { TeamWorkItemBoard } from "./team-work-item-board.js";
import { WorkflowDesigner } from "./team-workflow-designer.js";
import { WorkflowRuntimePanel } from "./team-workflow-runtime-panel.js";
import "./team-workflow.css";
import "./team-workspace.css";

type TeamWorkspaceView = "board" | "planning" | "runtime";

export function TeamWorkspace(): ReactElement {
  const teams = useAgentDirectoryStore((state) => state.teams);
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id ?? "");
  const [workItems, setWorkItems] = useState<TeamWorkItemPrototype[]>(() => [...TEAM_WORK_ITEMS]);
  const [selectedWorkItemId, setSelectedWorkItemId] = useState(TEAM_WORK_ITEMS[0]?.id ?? "");
  const [filter, setFilter] = useState<WorkItemFilter>("all");
  const [draft, setDraft] = useState("");
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [view, setView] = useState<TeamWorkspaceView>("board");
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];
  const selectedWorkItem = workItems.find((item) => item.id === selectedWorkItemId)
    ?? workItems[0]
    ?? null;
  const filteredWorkItems = useMemo(
    () => workItems.filter((item) => matchesWorkItemFilter(item, filter)),
    [filter, workItems],
  );

  if (selectedTeam === undefined) return <EmptyTeamWorkspace />;

  const queuedCount = workItems.filter((item) => item.status === "queued").length;
  const processingCount = workItems.filter((item) => matchesWorkItemFilter(item, "processing")).length;
  const acceptanceCount = workItems.filter((item) => item.status === "awaiting_acceptance").length;
  const completedCount = workItems.filter((item) => item.status === "completed").length;
  const temporaryCount = TEAM_WORKERS.filter((worker) => worker.kind === "temporary").length;

  const submitWorkItem = (): void => {
    const title = draft.trim();
    if (title.length === 0) return;
    if (editingItemId !== null) {
      setWorkItems((current) => current.map((item) => item.id === editingItemId && item.status === "queued"
        ? {
            ...item,
            events: [...item.events, createLifecycleEvent("用户", "更新了待执行需求。", "status")],
            title,
          }
        : item));
      setEditingItemId(null);
      setDraft("");
      return;
    }
    const created = createPrototypeWorkItem(title);
    setWorkItems((current) => [created, ...current]);
    setSelectedWorkItemId(created.id);
    setFilter("queued");
    setDraft("");
  };

  const editWorkItem = (id: string): void => {
    const item = workItems.find((candidate) => candidate.id === id);
    if (item === undefined || item.status !== "queued") return;
    setSelectedWorkItemId(id);
    setEditingItemId(id);
    setDraft(item.title);
  };

  const cancelEdit = (): void => {
    setEditingItemId(null);
    setDraft("");
  };

  const applyLifecycleAction = (action: WorkItemLifecycleAction): void => {
    if (selectedWorkItem === null) return;
    if (transitionWorkItem(selectedWorkItem, action) === selectedWorkItem) return;
    setWorkItems((current) => current.map((item) => {
      if (item.id !== selectedWorkItem.id) return item;
      const transitioned = transitionWorkItem(item, action);
      if (transitioned === item) return item;
      const event = lifecycleActionEvent(action);
      return { ...transitioned, events: [...item.events, event] };
    }));
    if (action.type === "claim" || action.type === "request_rework" || action.type === "approve") {
      setFilter("processing");
    } else if (action.type === "execution_completed") {
      setFilter("acceptance");
    } else {
      setFilter("completed");
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
        </div>
      </header>

      <div className="team-prototype-notice" role="note">
        <div><Sparkles aria-hidden="true" size={13} />当前为确定性模拟，不会调用真实模型或修改项目。</div>
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
            acceptanceCount={acceptanceCount}
            completedCount={completedCount}
            draft={draft}
            editingItemId={editingItemId}
            filter={filter}
            items={filteredWorkItems}
            processingCount={processingCount}
            queuedCount={queuedCount}
            selectedId={selectedWorkItem?.id ?? null}
            onCancelEdit={cancelEdit}
            onDraftChange={setDraft}
            onEdit={editWorkItem}
            onFilterChange={setFilter}
            onSelect={setSelectedWorkItemId}
            onSubmit={submitWorkItem}
          />
          {selectedWorkItem === null ? (
            <main className="team-command-panel team-runtime-empty">未选择任务</main>
          ) : isLifecyclePanelStatus(selectedWorkItem.status) ? (
            <WorkItemLifecyclePanel
              key={`${selectedWorkItem.id}-${selectedWorkItem.status}-${selectedWorkItem.acceptanceRound}`}
              item={selectedWorkItem}
              onApprove={(action: TeamFinalizationAction, acceptedCriteria) => applyLifecycleAction({ acceptedCriteria, action, type: "approve" })}
              onClaim={() => applyLifecycleAction({ type: "claim" })}
              onFinishFinalization={() => applyLifecycleAction({ type: "finalization_completed" })}
              onRequestRework={(request) => applyLifecycleAction({ request, type: "request_rework" })}
            />
          ) : (
            <WorkflowRuntimePanel
              key={`${selectedWorkItem.id}-${selectedWorkItem.acceptanceRound}`}
              workItemTitle={selectedWorkItem.title}
              onComplete={() => applyLifecycleAction({ type: "execution_completed" })}
            />
          )}
          <TeamOperations temporaryCount={temporaryCount} workers={TEAM_WORKERS} item={selectedWorkItem} />
        </div>
      )}
    </section>
  );
}

function createPrototypeWorkItem(title: string): TeamWorkItemPrototype {
  const id = `prototype-${Date.now()}`;
  return {
    acceptance: [
      "执行结果覆盖用户发送的需求",
      "开发、测试和内部评审证据完整",
      "交付摘要、风险和后续动作说明清楚",
    ],
    acceptedCriteria: [],
    acceptanceRound: 1,
    createdAt: "刚刚",
    delivery: null,
    events: [{
      actor: "Team Lead",
      detail: "任务已通过团队控制台进入收件箱，等待规划。",
      id: `${id}-received`,
      time: "刚刚",
      type: "status",
    }],
    id,
    nextAction: "管理 Agent 将分析任务、确认项目边界并决定是否拆分。",
    plan: "等待管理 Agent 输出针对性方案。",
    priority: "normal",
    project: "Aster",
    source: "direct",
    status: "queued",
    tasks: [],
    title,
    finalizationAction: null,
    reworkRequest: null,
  };
}

function isLifecyclePanelStatus(status: TeamWorkItemPrototype["status"]): boolean {
  return status === "queued"
    || status === "awaiting_acceptance"
    || status === "finalizing"
    || status === "completed";
}

function lifecycleActionEvent(action: WorkItemLifecycleAction): TeamEventPrototype {
  if (action.type === "claim") {
    return createLifecycleEvent("Team Lead", "已领取需求并锁定当前版本，开始制定执行方案。", "assignment");
  }
  if (action.type === "execution_completed") {
    return createLifecycleEvent("Team Lead", "内部执行和评审完成，已提交给用户逐项验收。", "completion");
  }
  if (action.type === "request_rework") {
    return createLifecycleEvent("用户", `验收未通过并要求返工：${action.request.trim()}`, "review");
  }
  if (action.type === "approve") {
    const label: Record<TeamFinalizationAction, string> = {
      commit: "提交当前分支",
      complete: "仅确认完成",
      merge: "创建并合并 PR",
    };
    return createLifecycleEvent("用户", `逐项验收通过，并授权：${label[action.action]}。`, "review");
  }
  return createLifecycleEvent("Team Lead", "用户授权的收尾动作已完成，任务进入最终状态。", "completion");
}

function createLifecycleEvent(
  actor: string,
  detail: string,
  type: TeamEventPrototype["type"],
): TeamEventPrototype {
  return {
    actor,
    detail,
    id: `lifecycle-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    time: "刚刚",
    type,
  };
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
