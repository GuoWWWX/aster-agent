import {
  AlertCircle,
  CheckCircle2,
  CircleDotDashed,
  Clock3,
  GitBranch,
  ListTodo,
  MessageSquareText,
  Play,
  Radio,
  UsersRound,
} from "lucide-react";
import { useState, type ReactElement } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import {
  useAgentDirectoryStore,
  type AgentProfile,
} from "../../stores/agent-directory-store.js";
import { AgentAvatar } from "./agent-avatar.js";
import { TASK_FIXTURES, type TaskFixture } from "./team-fixtures.js";
import "./team-workspace.css";

type RuntimeAgentState = "active" | "blocked" | "done" | "waiting";

type RuntimeActivity = {
  assignment: string;
  detail: string;
  state: RuntimeAgentState;
  updatedAt: string;
};

type RuntimeEvent = {
  actor: string;
  detail: string;
  id: string;
  time: string;
  type: "assignment" | "completion" | "message" | "status";
};

type TeamRuntimeFixture = {
  events: RuntimeEvent[];
  progress: number;
  project: string;
  summary: string;
  taskIds: string[];
  workItem: string;
};

const AGENT_RUNTIME: Record<string, RuntimeActivity> = {
  "team-lead": {
    assignment: "协调实现与复核",
    detail: "正在汇总页面边界，并跟进两个并行任务。",
    state: "active",
    updatedAt: "刚刚",
  },
  explorer: {
    assignment: "核对现有页面与状态来源",
    detail: "已定位团队配置、任务夹具和对话入口。",
    state: "done",
    updatedAt: "2 分钟前",
  },
  implementer: {
    assignment: "实现团队运行态工作台",
    detail: "正在接入 Agent 名册、WorkItem 和协作事件。",
    state: "active",
    updatedAt: "刚刚",
  },
  reviewer: {
    assignment: "等待界面进入复核",
    detail: "依赖运行态页面完成后执行响应式与回归检查。",
    state: "waiting",
    updatedAt: "5 分钟前",
  },
};

const DEFAULT_RUNTIME: TeamRuntimeFixture = {
  events: [
    { actor: "Team Lead", detail: "将运行态页面实现分配给 Implementer。", id: "event-1", time: "14:32", type: "assignment" },
    { actor: "Explorer", detail: "完成现有团队配置和任务数据边界核对。", id: "event-2", time: "14:30", type: "completion" },
    { actor: "Implementer", detail: "开始构建团队成员状态和工作项视图。", id: "event-3", time: "14:27", type: "status" },
    { actor: "Team Lead", detail: "确认配置入口迁移到设置，团队页只展示执行过程。", id: "event-4", time: "14:24", type: "message" },
  ],
  progress: 62,
  project: "Aster",
  summary: "将 Agent 与团队配置迁入设置，并建立可观察每个 Agent 工作状态的团队运行页。",
  taskIds: ["workbench-ui", "mcp-poc", "ui-review"],
  workItem: "调整 Agent 与团队的信息架构",
};

const RELEASE_RUNTIME: TeamRuntimeFixture = {
  events: [
    { actor: "Reviewer", detail: "发现响应式复核仍依赖当前界面实现。", id: "release-1", time: "13:18", type: "status" },
    { actor: "Team Lead", detail: "发布复核组已接收工作项。", id: "release-2", time: "13:12", type: "assignment" },
  ],
  progress: 35,
  project: "Aster",
  summary: "检查本轮界面调整的构建结果、响应式表现和关键交互。",
  taskIds: ["ui-review"],
  workItem: "发布前界面复核",
};

const TEAM_RUNTIME: Record<string, TeamRuntimeFixture> = {
  "default-team": DEFAULT_RUNTIME,
  "release-review-team": RELEASE_RUNTIME,
};

const AGENT_STATE_LABEL: Record<RuntimeAgentState, string> = {
  active: "工作中",
  blocked: "受阻",
  done: "已完成",
  waiting: "等待中",
};

const TASK_STATUS_LABEL: Record<TaskFixture["status"], string> = {
  blocked: "受阻",
  completed: "已完成",
  inbox: "已接收",
  planned: "待开始",
  running: "进行中",
};

export function TeamWorkspace(): ReactElement {
  const agents = useAgentDirectoryStore((state) => state.agents);
  const teams = useAgentDirectoryStore((state) => state.teams);
  const [selectedTeamId, setSelectedTeamId] = useState(teams[0]?.id ?? "");
  const selectedTeam = teams.find((team) => team.id === selectedTeamId) ?? teams[0];

  if (selectedTeam === undefined) {
    return <EmptyTeamWorkspace />;
  }

  const runtime = TEAM_RUNTIME[selectedTeam.id] ?? {
    ...DEFAULT_RUNTIME,
    events: [],
    progress: 0,
    summary: selectedTeam.description || "该团队当前没有运行中的工作项。",
    taskIds: [],
    workItem: "等待新的工作项",
  };
  const members = selectedTeam.memberIds
    .map((memberId) => agents.find((agent) => agent.id === memberId))
    .filter((agent): agent is AgentProfile => agent !== undefined);
  const tasks = runtime.taskIds
    .map((taskId) => TASK_FIXTURES.find((task) => task.id === taskId))
    .filter((task): task is TaskFixture => task !== undefined);
  const activeCount = members.filter(
    (agent) => runtimeActivityFor(agent).state === "active",
  ).length;
  const blockedCount = tasks.filter((task) => task.status === "blocked").length;

  return (
    <section className="team-workspace" aria-labelledby="team-workspace-heading">
      <header className="workspace-page-header team-runtime-header">
        <div>
          <p className="workspace-page-eyebrow">团队运行态</p>
          <h1 id="team-workspace-heading">{selectedTeam.name}</h1>
          <p className="workspace-page-description">{runtime.workItem}</p>
        </div>
        <div className="team-runtime-header__controls">
          <span className="team-live-badge" data-active={selectedTeam.enabled}>
            <Radio aria-hidden="true" size={12} />
            {selectedTeam.enabled ? "运行中" : "已停用"}
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

      <div className="team-runtime-summary" aria-label="团队运行概况">
        <RuntimeMetric icon={UsersRound} label="团队成员" value={String(members.length)} />
        <RuntimeMetric icon={Play} label="正在工作" value={String(activeCount)} tone="active" />
        <RuntimeMetric icon={ListTodo} label="当前任务" value={String(tasks.length)} />
        <RuntimeMetric icon={AlertCircle} label="受阻任务" value={String(blockedCount)} tone={blockedCount > 0 ? "blocked" : "neutral"} />
      </div>

      <div className="team-runtime-layout">
        <section className="team-runtime-panel team-roster-panel" aria-labelledby="team-roster-heading">
          <PanelHeading id="team-roster-heading" label="Agent 状态" meta={`${members.length} 名成员`} />
          <div className="team-runtime-roster">
            {members.map((agent) => (
              <AgentRuntimeRow key={agent.id} agent={agent} activity={runtimeActivityFor(agent)} />
            ))}
          </div>
        </section>

        <section className="team-runtime-panel team-work-panel" aria-labelledby="team-work-heading">
          <PanelHeading id="team-work-heading" label="当前 WorkItem" meta={runtime.project} />
          <div className="team-workitem">
            <div className="team-workitem__heading">
              <div>
                <span>进行中</span>
                <h2>{runtime.workItem}</h2>
              </div>
              <strong>{runtime.progress}%</strong>
            </div>
            <p>{runtime.summary}</p>
            <div className="team-progress-track" aria-label={`工作项进度 ${runtime.progress}%`}>
              <span style={{ width: `${runtime.progress}%` }} />
            </div>
          </div>
          <div className="team-task-list" aria-label="工作项任务">
            {tasks.length === 0 ? (
              <div className="team-runtime-empty"><Clock3 aria-hidden="true" size={18} />尚未拆分任务</div>
            ) : tasks.map((task) => <RuntimeTaskRow key={task.id} task={task} />)}
          </div>
        </section>

        <aside className="team-runtime-panel team-event-panel" aria-labelledby="team-event-heading">
          <PanelHeading id="team-event-heading" label="协作动态" meta="最近事件" />
          <div className="team-event-list">
            {runtime.events.length === 0 ? (
              <div className="team-runtime-empty"><MessageSquareText aria-hidden="true" size={18} />暂无协作动态</div>
            ) : runtime.events.map((event) => <RuntimeEventRow key={event.id} event={event} />)}
          </div>
        </aside>
      </div>
    </section>
  );
}

function runtimeActivityFor(agent: AgentProfile): RuntimeActivity {
  return AGENT_RUNTIME[agent.id] ?? {
    assignment: "等待 Team Lead 分配",
    detail: "当前没有正在执行的任务。",
    state: "waiting",
    updatedAt: "暂无活动",
  };
}

function AgentRuntimeRow({
  activity,
  agent,
}: {
  activity: RuntimeActivity;
  agent: AgentProfile;
}): ReactElement {
  return (
    <article className="team-agent-runtime" data-state={activity.state}>
      <AgentAvatar avatar={agent.avatar} status={activity.state === "active" ? "running" : agent.status} />
      <div className="team-agent-runtime__body">
        <div className="team-agent-runtime__identity">
          <strong>{agent.name}</strong>
          <span data-state={activity.state}>{AGENT_STATE_LABEL[activity.state]}</span>
        </div>
        <p>{activity.assignment}</p>
        <small>{activity.detail}</small>
        <time>{activity.updatedAt}</time>
      </div>
    </article>
  );
}

function RuntimeTaskRow({ task }: { task: TaskFixture }): ReactElement {
  const Icon = task.status === "completed"
    ? CheckCircle2
    : task.status === "running"
      ? Play
      : task.status === "blocked"
        ? AlertCircle
        : CircleDotDashed;

  return (
    <article className="team-runtime-task" data-status={task.status}>
      <span className="team-runtime-task__icon"><Icon aria-hidden="true" size={14} /></span>
      <div>
        <strong>{task.title}</strong>
        <span>{task.assignee}</span>
      </div>
      <small>{TASK_STATUS_LABEL[task.status]}</small>
    </article>
  );
}

function RuntimeEventRow({ event }: { event: RuntimeEvent }): ReactElement {
  const Icon = event.type === "completion"
    ? CheckCircle2
    : event.type === "assignment"
      ? GitBranch
      : event.type === "message"
        ? MessageSquareText
        : Radio;

  return (
    <article className="team-runtime-event" data-type={event.type}>
      <span><Icon aria-hidden="true" size={13} /></span>
      <div>
        <p><strong>{event.actor}</strong>{event.detail}</p>
        <time>{event.time}</time>
      </div>
    </article>
  );
}

function PanelHeading({ id, label, meta }: { id: string; label: string; meta: string }): ReactElement {
  return (
    <header className="team-runtime-panel__heading">
      <h2 id={id}>{label}</h2>
      <span>{meta}</span>
    </header>
  );
}

function RuntimeMetric({
  icon: Icon,
  label,
  tone = "neutral",
  value,
}: {
  icon: typeof UsersRound;
  label: string;
  tone?: "active" | "blocked" | "neutral";
  value: string;
}): ReactElement {
  return (
    <div className="team-runtime-metric" data-tone={tone}>
      <Icon aria-hidden="true" size={15} />
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function EmptyTeamWorkspace(): ReactElement {
  return (
    <section className="team-workspace team-workspace--empty" aria-label="团队运行态">
      <UsersRound aria-hidden="true" size={24} />
      <h1>还没有团队</h1>
      <p>请先在设置中创建 Agent 和团队。</p>
    </section>
  );
}
