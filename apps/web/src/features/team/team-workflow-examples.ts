import type {
  WorkflowDefinition,
  WorkflowNodeAction,
  WorkflowNodeDefinition,
  WorkflowNodeKind,
} from "./team-workflow-simulator.js";

const solution = stage({
  agentRoles: ["Team Lead", "产品方案 Agent"],
  description: "澄清目标、边界与验收标准，形成可执行方案。",
  id: "solution",
  inputContract: ["用户任务", "项目上下文", "约束与优先级"],
  kind: "solution",
  mockAgents: ["Team Lead"],
  mockOutput: "方案已确认：目标、非目标、验收标准和实施顺序完整。",
  name: "方案",
  outputContract: ["方案摘要", "验收标准", "风险清单"],
});

const architecture = stage({
  agentRoles: ["架构 Agent", "Team Lead"],
  description: "确定模块边界、数据流、接口和迁移策略。",
  id: "architecture",
  inputContract: ["方案摘要", "验收标准", "现有系统约束"],
  kind: "architecture",
  mockAgents: ["架构 Agent"],
  mockOutput: "架构已确定：模块边界、状态机、接口合同和实施风险已记录。",
  name: "架构",
  outputContract: ["架构决策", "模块边界", "接口合同"],
});

const delivery = stage({
  agentRoles: ["Team Lead"],
  description: "汇总变更、测试、评审和遗留风险，生成用户可验收的交付包。",
  id: "delivery",
  inputContract: ["评审结论", "测试证据", "变更摘要"],
  kind: "delivery",
  mockAgents: ["Team Lead"],
  mockOutput: "交付包已生成：包含变更、测试证据、评审结论和验收操作。",
  name: "交付",
  outputContract: ["交付摘要", "验证证据", "用户验收入口"],
});

const intake = stage({
  actions: [],
  agentRoles: ["Team Lead"],
  description: "收集用户需求；被 Team Lead 领取前允许继续修改。",
  id: "intake",
  inputContract: ["用户需求", "项目范围"],
  kind: "solution",
  mockAgents: ["Team Lead"],
  mockOutput: "需求已领取并锁定，进入方案阶段。",
  name: "需求池",
  outputContract: ["需求快照", "项目上下文"],
});

const userAcceptance = stage({
  actions: [],
  agentRoles: ["用户"],
  description: "用户逐项检查结果，可通过或携带补充要求退回返工。",
  id: "user-acceptance",
  inputContract: ["实现结果", "测试证据", "评审结论"],
  kind: "review",
  mockAgents: ["用户"],
  mockOutput: "用户逐项验收通过，并选择后续收尾动作。",
  name: "用户验收",
  outputContract: ["验收决定", "返工要求", "收尾授权"],
});

const finalization = stage({
  agentRoles: ["Team Lead"],
  description: "按用户授权执行提交、创建 PR 或确认完成，形成最终记录。",
  id: "finalization",
  inputContract: ["验收决定", "收尾授权"],
  kind: "delivery",
  mockAgents: ["Team Lead"],
  mockOutput: "最终交付包已生成，收尾动作完成，任务进入最终状态。",
  name: "收尾完成",
  outputContract: ["提交或 PR", "最终状态", "交付记录"],
});

export const TEAM_WORKFLOW_EXAMPLES: readonly WorkflowDefinition[] = [
  {
    description: "简洁团队闭环：需求、方案、开发，测试与评审并行，汇合后由用户验收。",
    edges: edges([
      ["intake", "solution"],
      ["solution", "development"],
      ["development", "testing"],
      ["development", "review"],
      ["testing", "user-acceptance"],
      ["review", "user-acceptance"],
      ["user-acceptance", "finalization"],
    ]),
    id: "team-task-lifecycle",
    name: "团队任务闭环",
    nodes: [
      intake,
      solution,
      stage({
        agentRoles: ["开发 Agent"],
        assignmentPolicy: "expand_if_busy",
        description: "按方案实施；现有 Agent 不足时允许申请临时成员。",
        id: "development",
        inputContract: ["方案摘要", "验收标准"],
        kind: "development",
        maxAgents: 3,
        mockAgents: ["开发 Agent"],
        mockOutput: "开发完成，代码变更和实现说明已交接。",
        name: "开发",
        outputContract: ["代码变更", "实现说明"],
      }),
      stage({
        actions: [scriptAction("lifecycle-test", "运行验证", "pnpm test")],
        agentRoles: ["测试 Agent"],
        description: "验证自动化检查和关键用户路径。",
        id: "testing",
        inputContract: ["代码变更", "验收标准"],
        kind: "testing",
        mockAgents: ["测试 Agent"],
        mockOutput: "自动化和关键路径验证通过。",
        name: "测试",
        outputContract: ["测试证据", "失败记录"],
      }),
      stage({
        agentRoles: ["Review Agent"],
        description: "与测试并行检查正确性、范围和风险。",
        id: "review",
        inputContract: ["代码变更", "方案摘要"],
        kind: "review",
        mockAgents: ["Review Agent"],
        mockOutput: "评审通过，没有阻断问题。",
        name: "评审",
        outputContract: ["评审结论", "风险清单"],
      }),
      userAcceptance,
      finalization,
    ],
  },
  {
    description: "适合常规功能开发，完整经过方案、架构、开发、测试、双人评审和交付。",
    edges: chain(["solution", "architecture", "development", "testing", "review", "delivery"]),
    id: "standard-development",
    name: "标准研发规划",
    nodes: [
      solution,
      architecture,
      stage({
        actions: [
          modelAction("development-plan", "拆分实现任务", "根据架构合同拆分改动，逐项实现并说明风险。"),
          scriptAction("development-check", "运行开发检查", "pnpm --filter @agent/web typecheck"),
        ],
        agentRoles: ["开发 Agent"],
        assignmentPolicy: "expand_if_busy",
        description: "按模块拆分开发任务；空闲成员不足时允许创建临时开发 Agent。",
        executionMode: "parallel",
        id: "development",
        inputContract: ["架构决策", "接口合同", "验收标准"],
        kind: "development",
        maxAgents: 3,
        minAgents: 2,
        mockAgents: ["开发 Agent", "临时开发 Agent #1"],
        mockOutput: "开发完成：核心实现和配套测试已提交，变更清单可供验证。",
        name: "开发",
        outputContract: ["代码变更", "单元测试", "开发说明"],
        simulationDecision: "expand",
      }),
      stage({
        actions: [scriptAction("test-suite", "运行测试套件", "pnpm --filter @agent/web test")],
        agentRoles: ["测试 Agent"],
        description: "执行单元、集成和关键桌面场景验证。",
        executionMode: "parallel",
        id: "testing",
        inputContract: ["代码变更", "验收标准", "开发说明"],
        kind: "testing",
        maxAgents: 2,
        mockAgents: ["测试 Agent"],
        mockOutput: "测试通过：自动化检查和关键桌面路径均已验证。",
        name: "测试",
        outputContract: ["测试报告", "失败记录", "复现证据"],
      }),
      stage({
        agentRoles: ["代码评审 Agent", "架构 Agent"],
        description: "两名评审者分别检查实现正确性和架构一致性。",
        executionMode: "quorum",
        id: "review",
        inputContract: ["代码变更", "测试报告", "架构决策"],
        kind: "review",
        maxAgents: 2,
        minAgents: 2,
        mockAgents: ["代码评审 Agent", "架构 Agent"],
        mockOutput: "评审通过：两名评审者均确认实现和测试满足验收标准。",
        name: "双人评审",
        outputContract: ["评审结论", "修改意见", "放行决定"],
      }),
      delivery,
    ],
  },
  {
    description: "适合范围明确的缺陷修复；复用空闲开发 Agent，测试繁忙时进入等待队列。",
    edges: chain(["diagnosis", "fix", "regression", "review", "delivery"]),
    id: "hotfix",
    name: "快速修复规划",
    nodes: [
      stage({
        agentRoles: ["Team Lead", "问题分析 Agent"],
        description: "复现问题并锁定根因，避免直接猜测修复。",
        id: "diagnosis",
        inputContract: ["问题描述", "错误信息", "复现环境"],
        kind: "solution",
        mockAgents: ["问题分析 Agent"],
        mockOutput: "根因已定位：状态恢复覆盖了对话级选择。",
        name: "定位根因",
        outputContract: ["复现步骤", "根因", "修复边界"],
      }),
      stage({
        agentRoles: ["开发 Agent"],
        description: "由空闲开发 Agent 完成最小范围修复。",
        id: "fix",
        inputContract: ["根因", "修复边界"],
        kind: "development",
        mockAgents: ["开发 Agent"],
        mockOutput: "最小修复已完成，并补充了失败复现测试。",
        name: "实施修复",
        outputContract: ["代码变更", "复现测试"],
      }),
      stage({
        agentRoles: ["测试 Agent"],
        assignmentPolicy: "wait_if_busy",
        description: "当前测试 Agent 忙时不盲目扩容，等待其释放后执行回归。",
        id: "regression",
        inputContract: ["代码变更", "复现测试"],
        kind: "testing",
        mockAgents: ["测试 Agent"],
        mockOutput: "缺陷复现测试和相关回归全部通过。",
        name: "回归测试",
        outputContract: ["回归结果", "风险说明"],
        simulationDecision: "wait",
      }),
      stage({
        agentRoles: ["代码评审 Agent"],
        description: "确认改动保持最小范围且没有引入状态竞态。",
        id: "review",
        inputContract: ["代码变更", "回归结果"],
        kind: "review",
        mockAgents: ["代码评审 Agent"],
        mockOutput: "评审通过：修改范围和回归证据符合要求。",
        name: "修复评审",
        outputContract: ["评审结论", "放行决定"],
      }),
      delivery,
    ],
  },
  {
    description: "适合跨模块功能；开发阶段扩充多个 Agent，集成节点等待共享环境释放。",
    edges: edges([
      ["solution", "architecture"],
      ["architecture", "frontend-development"],
      ["architecture", "backend-development"],
      ["architecture", "test-fixtures"],
      ["frontend-development", "integration"],
      ["backend-development", "integration"],
      ["test-fixtures", "integration"],
      ["integration", "testing"],
      ["testing", "review"],
      ["review", "delivery"],
    ]),
    id: "large-feature",
    name: "大型功能规划",
    nodes: [
      stage({
        ...solution,
        description: "由两个方案 Agent 并行产出方案，再由 Team Lead 合并。",
        executionMode: "parallel",
        maxAgents: 2,
        minAgents: 2,
        mockAgents: ["方案 Agent A", "方案 Agent B"],
        mockOutput: "两套方案已比较并合并，复杂功能的范围和里程碑明确。",
        name: "并行方案",
      }),
      architecture,
      stage({
        agentRoles: ["前端 Agent"],
        assignmentPolicy: "expand_if_busy",
        description: "实现执行规划画布、任务节点配置和运行状态展示。",
        id: "frontend-development",
        inputContract: ["架构决策", "模块边界", "接口合同"],
        kind: "development",
        maxAgents: 2,
        mockAgents: ["前端 Agent", "临时前端 Agent"],
        mockOutput: "前端分支完成：画布和节点配置已实现。",
        name: "前端开发",
        outputContract: ["前端变更", "交互说明"],
        simulationDecision: "expand",
      }),
      stage({
        agentRoles: ["后端 Agent"],
        description: "实现任务依赖图、调度约束与持久化合同。",
        id: "backend-development",
        inputContract: ["架构决策", "接口合同"],
        kind: "development",
        mockAgents: ["后端 Agent"],
        mockOutput: "后端分支完成：任务依赖图和运行合同已实现。",
        name: "后端开发",
        outputContract: ["后端变更", "状态机合同"],
      }),
      stage({
        actions: [scriptAction("fixture-check", "构建测试夹具", "pnpm --filter @agent/web test")],
        agentRoles: ["测试开发 Agent"],
        description: "与开发并行准备模拟数据、状态机和回归夹具。",
        id: "test-fixtures",
        inputContract: ["验收标准", "接口合同"],
        kind: "testing",
        mockAgents: ["测试开发 Agent"],
        mockOutput: "测试分支完成：并行、等待和汇总夹具已准备。",
        name: "测试夹具",
        outputContract: ["测试夹具", "回归场景"],
      }),
      stage({
        agentRoles: ["集成 Agent"],
        assignmentPolicy: "wait_if_busy",
        description: "共享集成环境被占用时等待，不创建重复环境和无效 Agent。",
        id: "integration",
        inputContract: ["模块变更", "接口合同", "测试夹具"],
        kind: "testing",
        mockAgents: ["集成 Agent"],
        mockOutput: "模块已集成，接口、迁移和桌面运行链路验证通过。",
        name: "集成验证",
        outputContract: ["集成报告", "兼容性结果"],
        simulationDecision: "wait",
      }),
      stage({
        agentRoles: ["测试 Agent", "体验测试 Agent"],
        description: "自动化测试和用户场景测试并行执行。",
        executionMode: "parallel",
        id: "testing",
        inputContract: ["集成报告", "验收标准"],
        kind: "testing",
        maxAgents: 2,
        minAgents: 2,
        mockAgents: ["测试 Agent", "体验测试 Agent"],
        mockOutput: "自动化和用户场景测试完成，没有阻断问题。",
        name: "全量测试",
        outputContract: ["测试矩阵", "桌面验收证据"],
      }),
      stage({
        agentRoles: ["代码评审 Agent", "架构 Agent"],
        description: "实现和架构双重评审，任一拒绝都会退回开发。",
        executionMode: "quorum",
        id: "review",
        inputContract: ["全部变更", "测试矩阵", "架构决策"],
        kind: "review",
        maxAgents: 2,
        minAgents: 2,
        mockAgents: ["代码评审 Agent", "架构 Agent"],
        mockOutput: "双重评审通过，功能可以进入交付。",
        name: "发布评审",
        outputContract: ["评审结论", "风险清单", "放行决定"],
      }),
      delivery,
    ],
  },
] as const;

function stage(
  input: Partial<WorkflowNodeDefinition> & Pick<
    WorkflowNodeDefinition,
    | "agentRoles"
    | "description"
    | "id"
    | "inputContract"
    | "kind"
    | "mockAgents"
    | "mockOutput"
    | "name"
    | "outputContract"
  >,
): WorkflowNodeDefinition {
  return {
    assignmentPolicy: "reuse",
    executionMode: "single",
    maxAgents: 1,
    minAgents: 1,
    simulationDecision: "reuse",
    ...input,
    actions: input.actions ?? [defaultAction(input.id, input.kind, input.description)],
  };
}

function defaultAction(id: string, kind: WorkflowNodeKind, description: string): WorkflowNodeAction {
  if (kind === "testing") {
    return scriptAction(`${id}-script`, "执行验证脚本", "pnpm test");
  }
  return modelAction(`${id}-model`, "调用负责模型", description);
}

function modelAction(id: string, label: string, prompt: string): WorkflowNodeAction {
  return {
    id,
    kind: "model",
    label,
    modelId: "gpt-5.6-terra",
    prompt,
    providerId: "OpenAI",
    reasoningEffort: "high",
  };
}

function scriptAction(id: string, label: string, script: string): WorkflowNodeAction {
  return {
    id,
    kind: "script",
    label,
    runtime: "powershell",
    script,
  };
}

function chain(nodeIds: readonly string[]): WorkflowDefinition["edges"] {
  return edges(nodeIds.slice(0, -1).map((nodeId, index) => [nodeId, nodeIds[index + 1]!] as const));
}

function edges(pairs: readonly (readonly [string, string])[]): WorkflowDefinition["edges"] {
  return pairs.map(([fromNodeId, toNodeId]) => ({
    fromNodeId,
    id: `${fromNodeId}-${toNodeId}`,
    toNodeId,
  }));
}
