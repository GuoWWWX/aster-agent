import {
  ArrowRight,
  CheckCircle2,
  CircleDotDashed,
  Inbox,
  ListTodo,
  Play,
  ShieldAlert,
} from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";

import type { ProjectSummary } from "@agent/protocol";

import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { TASK_FIXTURES, type TaskFixture } from "../team/team-fixtures.js";
import "./task-workspace.css";

type TaskFilter = "all" | TaskFixture["status"];

const FILTERS: ReadonlyArray<{ id: TaskFilter; label: string }> = [
  { id: "all", label: "全部" },
  { id: "inbox", label: "收件箱" },
  { id: "planned", label: "已规划" },
  { id: "running", label: "进行中" },
  { id: "blocked", label: "受阻" },
];

const STATUS_LABEL: Record<TaskFixture["status"], string> = {
  blocked: "受阻",
  completed: "已完成",
  inbox: "已接收",
  planned: "已规划",
  running: "进行中",
};

const PRIORITY_LABEL: Record<TaskFixture["priority"], string> = {
  high: "高优先级",
  low: "低优先级",
  normal: "普通优先级",
};

const DEFAULT_TASK: TaskFixture =
  TASK_FIXTURES.at(0) ?? missingTaskFixture();

function missingTaskFixture(): never {
  throw new Error("Task fixtures must include at least one task.");
}

export function TaskWorkspace({
  activeProject,
}: {
  activeProject: ProjectSummary | null;
}): ReactElement {
  const [activeFilter, setActiveFilter] = useState<TaskFilter>("all");
  const [selectedTaskId, setSelectedTaskId] = useState(DEFAULT_TASK.id);
  const setActiveActivity = useWorkbenchUiStore((state) => state.setActiveActivity);
  const visibleTasks = useMemo(
    () =>
      activeFilter === "all"
        ? TASK_FIXTURES
        : TASK_FIXTURES.filter((task) => task.status === activeFilter),
    [activeFilter],
  );
  const selectedTask =
    visibleTasks.find((task) => task.id === selectedTaskId) ?? visibleTasks[0] ?? null;

  return (
    <section className="task-workspace" aria-labelledby="task-workspace-heading">
      <header className="workspace-page-header">
        <div>
          <p className="workspace-page-eyebrow">任务收件箱</p>
          <h1 id="task-workspace-heading">持续任务</h1>
          <p className="workspace-page-description">
            新任务先进入 WorkItem；只有复杂任务才拆成可恢复、可分配的 Task 列表。
          </p>
        </div>
        <div className="workspace-page-actions">
          <span className="workspace-mode-badge">{activeProject?.name ?? "未选择项目"}</span>
          <button
            className="workspace-outline-button"
            type="button"
            onClick={() => setActiveActivity("conversations")}
          >
            投递任务
            <ArrowRight aria-hidden="true" size={15} />
          </button>
        </div>
      </header>

      <div className="task-summary-strip" aria-label="任务概况">
        <TaskSummary icon={Inbox} label="已接收" value="1" />
        <TaskSummary icon={Play} label="进行中" value="1" />
        <TaskSummary icon={CircleDotDashed} label="待规划" value="1" />
        <TaskSummary icon={ShieldAlert} label="需要处理" value="1" />
      </div>

      <div className="task-workspace__content">
        <section className="task-list-panel" aria-label="任务列表">
          <div className="task-filter-bar" role="tablist" aria-label="任务状态筛选">
            {FILTERS.map((filter) => {
              const count =
                filter.id === "all"
                  ? TASK_FIXTURES.length
                  : TASK_FIXTURES.filter((task) => task.status === filter.id).length;

              return (
                <button
                  key={filter.id}
                  aria-selected={activeFilter === filter.id}
                  className="task-filter"
                  role="tab"
                  type="button"
                  onClick={() => setActiveFilter(filter.id)}
                >
                  <span>{filter.label}</span>
                  <span>{count}</span>
                </button>
              );
            })}
          </div>

          <div className="task-list" role="listbox" aria-label="当前任务">
            {visibleTasks.length === 0 ? (
              <div className="task-list__empty">
                <ListTodo aria-hidden="true" size={20} />
                当前筛选下没有任务。
              </div>
            ) : (
              visibleTasks.map((task) => (
                <button
                  key={task.id}
                  aria-selected={task.id === selectedTask?.id}
                  className="task-row"
                  data-selected={task.id === selectedTask?.id}
                  role="option"
                  type="button"
                  onClick={() => setSelectedTaskId(task.id)}
                >
                  <TaskStateIcon status={task.status} />
                  <span className="task-row__content">
                    <span className="task-row__titleline">
                      <strong>{task.title}</strong>
                      <span data-priority={task.priority}>
                        {PRIORITY_LABEL[task.priority]}
                      </span>
                    </span>
                    <span>{task.project}</span>
                  </span>
                </button>
              ))
            )}
          </div>
        </section>

        <aside className="task-detail-panel" aria-label="任务详情">
          {selectedTask === null ? (
            <TaskEmptyDetail />
          ) : (
            <TaskDetail task={selectedTask} />
          )}
        </aside>
      </div>
    </section>
  );
}

function TaskSummary({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Inbox;
  label: string;
  value: string;
}): ReactElement {
  return (
    <div className="task-summary">
      <Icon aria-hidden="true" size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function TaskStateIcon({ status }: { status: TaskFixture["status"] }): ReactElement {
  const Icon =
    status === "completed"
      ? CheckCircle2
      : status === "running"
        ? Play
        : status === "blocked"
          ? ShieldAlert
          : status === "inbox"
            ? Inbox
            : CircleDotDashed;

  return (
    <span className="task-state-icon" data-status={status} aria-hidden="true">
      <Icon size={15} strokeWidth={1.8} />
    </span>
  );
}

function TaskDetail({ task }: { task: TaskFixture }): ReactElement {
  return (
    <div className="task-detail">
      <div className="task-detail__heading">
        <TaskStateIcon status={task.status} />
        <div>
          <p className="workspace-page-eyebrow">{task.project}</p>
          <h2>{task.title}</h2>
        </div>
      </div>

      <p className="task-detail__summary">{task.summary}</p>

      <dl className="task-detail__facts">
        <div>
          <dt>状态</dt>
          <dd data-status={task.status}>{STATUS_LABEL[task.status]}</dd>
        </div>
        <div>
          <dt>优先级</dt>
          <dd>{PRIORITY_LABEL[task.priority]}</dd>
        </div>
        <div>
          <dt>执行者</dt>
          <dd>{task.assignee}</dd>
        </div>
        <div>
          <dt>主项目</dt>
          <dd>{task.project}</dd>
        </div>
      </dl>

      <section className="task-detail__dependencies" aria-labelledby="task-dependencies-heading">
        <h3 id="task-dependencies-heading">依赖与下一步</h3>
        {task.dependencies.length === 0 ? (
          <p>没有前置依赖，可由 Team Lead 直接受理或委派。</p>
        ) : (
          <ul>
            {task.dependencies.map((dependency) => (
              <li key={dependency}>{dependency}</li>
            ))}
          </ul>
        )}
      </section>

      <p className="task-detail__note">
        当前为确定性界面夹具。Task、审批、依赖和执行证据将在 Runtime 接入后从同一任务投影读取。
      </p>
    </div>
  );
}

function TaskEmptyDetail(): ReactElement {
  return (
    <div className="task-detail-empty">
      <ListTodo aria-hidden="true" size={22} />
      <p>选择一个任务查看状态、依赖和项目边界。</p>
    </div>
  );
}
