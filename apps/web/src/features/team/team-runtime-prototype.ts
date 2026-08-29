export type TeamWorkItemStatus =
  | "queued"
  | "planning"
  | "executing"
  | "reviewing"
  | "blocked"
  | "awaiting_acceptance"
  | "reworking"
  | "finalizing"
  | "completed";

export type TeamFinalizationAction = "commit" | "merge" | "complete";

export type TeamTaskStatus = "queued" | "running" | "reviewing" | "blocked" | "completed";

export type TeamTaskPrototype = {
  agent: string;
  id: string;
  result: string;
  role: "lead" | "developer" | "reviewer" | "tester";
  status: TeamTaskStatus;
  title: string;
};

export type TeamEventPrototype = {
  actor: string;
  detail: string;
  id: string;
  time: string;
  type: "assignment" | "capacity" | "completion" | "review" | "status";
};

export type TeamDeliveryPrototype = {
  changedFiles: number;
  commits: number;
  summary: string;
  tests: string[];
};

export type TeamWorkItemPrototype = {
  acceptance: string[];
  acceptedCriteria: string[];
  acceptanceRound: number;
  createdAt: string;
  delivery: TeamDeliveryPrototype | null;
  events: TeamEventPrototype[];
  id: string;
  nextAction: string;
  plan: string;
  priority: "high" | "normal" | "low";
  project: string;
  source: "conversation" | "direct";
  status: TeamWorkItemStatus;
  tasks: TeamTaskPrototype[];
  title: string;
  finalizationAction: TeamFinalizationAction | null;
  reworkRequest: string | null;
};

export type TeamWorkerPrototype = {
  assignment: string;
  id: string;
  kind: "standing" | "temporary";
  name: string;
  role: string;
  status: "active" | "idle" | "reviewing" | "waiting";
};

export const TEAM_WORK_ITEMS: readonly TeamWorkItemPrototype[] = [
  {
    acceptance: ["管理 Agent 输出明确方案", "开发、测试和评审节点均可追踪"],
    acceptedCriteria: [],
    acceptanceRound: 1,
    createdAt: "刚刚",
    delivery: null,
    events: [
      { actor: "用户", detail: "需求已发送到团队，领取前仍可修改。", id: "queued-1", time: "刚刚", type: "status" },
    ],
    id: "queued-lifecycle-example",
    nextAction: "等待 Team Lead 领取并锁定需求版本。",
    plan: "尚未开始规划。",
    priority: "normal",
    project: "Aster",
    source: "direct",
    status: "queued",
    tasks: [],
    title: "完善团队任务的用户验收闭环",
    finalizationAction: null,
    reworkRequest: null,
  },
  {
    acceptance: [
      "新对话继承最近一次主动选择的模型与推理强度",
      "侧边对话创建时继承主对话配置，之后允许独立修改",
      "切换对话不会出现模型选择闪烁或被默认值覆盖",
    ],
    acceptedCriteria: [],
    acceptanceRound: 1,
    createdAt: "今天 14:18",
    delivery: null,
    events: [
      { actor: "Team Lead", detail: "完成任务边界分析并拆成 4 个可验收步骤。", id: "model-1", time: "14:21", type: "status" },
      { actor: "Team Lead", detail: "将状态持久化交给开发 Agent。", id: "model-2", time: "14:24", type: "assignment" },
      { actor: "开发 Agent", detail: "开始修改模型选择与对话恢复链路。", id: "model-3", time: "14:27", type: "status" },
      { actor: "Team Lead", detail: "开发队列达到上限，临时扩充 1 名测试 Agent。", id: "model-4", time: "14:31", type: "capacity" },
    ],
    id: "model-selection-continuity",
    nextAction: "开发完成后自动进入测试和代码评审。",
    plan: "先固定模型选择的唯一数据源，再处理主对话、侧边对话和新建对话的继承顺序，最后补充切换与恢复测试。",
    priority: "high",
    project: "Aster",
    source: "conversation",
    status: "executing",
    tasks: [
      { agent: "Team Lead", id: "model-plan", result: "已输出实现方案和验收边界", role: "lead", status: "completed", title: "分析模型选择状态来源" },
      { agent: "开发 Agent", id: "model-impl", result: "正在修改持久化和恢复逻辑", role: "developer", status: "running", title: "实现对话级模型选择连续性" },
      { agent: "临时测试 Agent", id: "model-test", result: "等待开发分支进入可测试状态", role: "tester", status: "queued", title: "补充切换与重启恢复测试" },
      { agent: "Review Agent", id: "model-review", result: "依赖开发和自动化测试结果", role: "reviewer", status: "queued", title: "审查状态覆盖和竞态风险" },
    ],
    title: "完善全局模型选择与对话继承",
    finalizationAction: null,
    reworkRequest: null,
  },
  {
    acceptance: [
      "桌面应用能够在独立端口启动",
      "主对话和侧边对话切换保持即时响应",
      "过期缓存按既定保活策略重新加载",
    ],
    acceptedCriteria: [],
    acceptanceRound: 1,
    createdAt: "今天 11:06",
    delivery: null,
    events: [
      { actor: "Team Lead", detail: "确认需要使用桌面端而不是浏览器预览。", id: "desktop-1", time: "11:09", type: "status" },
      { actor: "开发 Agent", detail: "正在整理桌面启动和空闲端口探测。", id: "desktop-2", time: "11:18", type: "assignment" },
      { actor: "测试 Agent", detail: "等待桌面构建产物。", id: "desktop-3", time: "11:24", type: "review" },
    ],
    id: "desktop-cache-verification",
    nextAction: "等待桌面构建完成后执行人工验收。",
    plan: "复用桌面开发启动链路，先探测空闲端口，再验证缓存命中、超时淘汰和重新加载状态。",
    priority: "normal",
    project: "Aster",
    source: "direct",
    status: "reviewing",
    tasks: [
      { agent: "开发 Agent", id: "desktop-build", result: "桌面构建已完成", role: "developer", status: "completed", title: "准备桌面开发构建" },
      { agent: "测试 Agent", id: "desktop-test", result: "正在验证十个对话的缓存切换", role: "tester", status: "reviewing", title: "验证对话缓存和端口启动" },
      { agent: "Review Agent", id: "desktop-review", result: "等待测试证据", role: "reviewer", status: "queued", title: "确认回归结果" },
    ],
    title: "验证桌面端对话缓存效果",
    finalizationAction: null,
    reworkRequest: null,
  },
  {
    acceptance: [
      "工作树基于最新远程开发分支",
      "任务管理方案和当前实现边界有明确记录",
      "页面原型能够表达持续接单、扩缩容和交付流程",
    ],
    acceptedCriteria: [],
    acceptanceRound: 1,
    createdAt: "今天 15:02",
    delivery: null,
    events: [
      { actor: "Team Lead", detail: "任务已进入团队收件箱。", id: "team-1", time: "15:02", type: "status" },
      { actor: "Team Lead", detail: "正在核对 Team、Task、Subagent 和运行态页面。", id: "team-2", time: "15:06", type: "assignment" },
    ],
    id: "team-task-management",
    nextAction: "等待你确认页面流程后进入真实 Runtime 实现。",
    plan: "先制作可交互页面确认信息架构；通过后再实现 WorkItem、Task、调度、扩缩容和交付包的持久化闭环。",
    priority: "high",
    project: "Aster",
    source: "conversation",
    status: "planning",
    tasks: [
      { agent: "Team Lead", id: "team-research", result: "已完成现状与目标架构对照", role: "lead", status: "completed", title: "研究团队任务管理链路" },
      { agent: "开发 Agent", id: "team-prototype", result: "正在实现运行工作台原型", role: "developer", status: "running", title: "制作团队控制台页面" },
      { agent: "Review Agent", id: "team-feedback", result: "等待用户确认页面方向", role: "reviewer", status: "blocked", title: "确认交互与信息密度" },
    ],
    title: "研究团队任务下发与管理",
    finalizationAction: null,
    reworkRequest: null,
  },
  {
    acceptance: [
      "Lint、Typecheck、Test 和 Build 全部通过",
      "关键行为具备自动化回归证据",
      "变更摘要和人工验证步骤完整",
    ],
    acceptedCriteria: [],
    acceptanceRound: 1,
    createdAt: "昨天 18:40",
    delivery: {
      changedFiles: 12,
      commits: 3,
      summary: "模型选择连续性已经完成开发、测试和评审，可创建 PR 交付。",
      tests: ["pnpm lint", "pnpm typecheck", "pnpm test", "pnpm build"],
    },
    events: [
      { actor: "开发 Agent", detail: "提交实现并附带定向测试。", id: "delivery-1", time: "昨天 19:12", type: "completion" },
      { actor: "测试 Agent", detail: "完成自动化回归，所有检查通过。", id: "delivery-2", time: "昨天 19:28", type: "completion" },
      { actor: "Review Agent", detail: "评审通过，没有阻断问题。", id: "delivery-3", time: "昨天 19:41", type: "review" },
      { actor: "Team Lead", detail: "生成交付摘要，等待用户验收。", id: "delivery-4", time: "昨天 19:44", type: "completion" },
    ],
    id: "acceptance-example",
    nextAction: "等待用户验收；确认后可创建 PR。",
    plan: "任务已经完成全部流水线。",
    priority: "normal",
    project: "Aster",
    source: "direct",
    status: "awaiting_acceptance",
    tasks: [
      { agent: "开发 Agent", id: "delivery-dev", result: "实现完成", role: "developer", status: "completed", title: "完成开发" },
      { agent: "测试 Agent", id: "delivery-test", result: "回归通过", role: "tester", status: "completed", title: "执行自动化测试" },
      { agent: "Review Agent", id: "delivery-review", result: "评审通过", role: "reviewer", status: "completed", title: "完成代码评审" },
    ],
    title: "等待用户验收的交付示例",
    finalizationAction: null,
    reworkRequest: null,
  },
  {
    acceptance: [
      "需求清单已逐项确认",
      "自动化检查全部通过",
      "变更已经合入开发分支",
    ],
    acceptedCriteria: [
      "需求清单已逐项确认",
      "自动化检查全部通过",
      "变更已经合入开发分支",
    ],
    acceptanceRound: 2,
    createdAt: "周一 16:20",
    delivery: {
      changedFiles: 8,
      commits: 1,
      summary: "用户完成第二轮验收，团队已按要求创建并合并 PR。",
      tests: ["pnpm lint", "pnpm typecheck", "pnpm test"],
    },
    events: [
      { actor: "用户", detail: "逐项验收通过，并要求创建合并请求。", id: "complete-1", time: "周一 17:12", type: "review" },
      { actor: "Team Lead", detail: "合并请求已完成，任务进入最终状态。", id: "complete-2", time: "周一 17:18", type: "completion" },
    ],
    id: "completed-example",
    nextAction: "任务已经结束，无待处理动作。",
    plan: "任务已完成全部执行、验收与收尾流程。",
    priority: "low",
    project: "Aster",
    source: "direct",
    status: "completed",
    tasks: [
      { agent: "Team Lead", id: "complete-close", result: "PR 已合并", role: "lead", status: "completed", title: "完成任务收尾" },
    ],
    title: "已完成任务的最终状态示例",
    finalizationAction: "merge",
    reworkRequest: "请补充窄窗口下的验收截图。",
  },
] as const;

export const TEAM_WORKERS: readonly TeamWorkerPrototype[] = [
  { assignment: "规划任务、调度成员、汇总交付", id: "team-lead", kind: "standing", name: "Team Lead", role: "管理 Agent", status: "active" },
  { assignment: "实现模型选择连续性", id: "implementer", kind: "standing", name: "开发 Agent", role: "主开发", status: "active" },
  { assignment: "复核实现边界和竞态", id: "reviewer", kind: "standing", name: "Review Agent", role: "代码评审", status: "waiting" },
  { assignment: "验证桌面缓存和恢复", id: "tester", kind: "standing", name: "测试 Agent", role: "质量保障", status: "reviewing" },
  { assignment: "补充模型切换回归测试", id: "temporary-test-1", kind: "temporary", name: "临时测试 Agent #1", role: "弹性成员", status: "active" },
];
