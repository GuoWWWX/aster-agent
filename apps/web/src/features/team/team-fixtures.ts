export type TaskFixture = {
  assignee: string;
  dependencies: string[];
  id: string;
  priority: "high" | "normal" | "low";
  project: string;
  status: "inbox" | "planned" | "running" | "blocked" | "completed";
  summary: string;
  title: string;
};

export const TASK_FIXTURES: readonly TaskFixture[] = [
  {
    assignee: "Team Lead",
    dependencies: [],
    id: "workbench-ui",
    priority: "high",
    project: "Aster",
    status: "running",
    summary: "整理 Agent 工作台的首批界面、布局和交互基线。",
    title: "建立团队工作台界面",
  },
  {
    assignee: "未分配",
    dependencies: ["建立团队工作台界面"],
    id: "model-center",
    priority: "normal",
    project: "Aster",
    status: "planned",
    summary: "配置模型 Provider、协议、窗口和 Agent 模型策略。",
    title: "接入模型中心",
  },
  {
    assignee: "Explorer",
    dependencies: [],
    id: "mcp-poc",
    priority: "normal",
    project: "Aster",
    status: "inbox",
    summary: "建立本地 MCP 固定服务的连接与能力发现验证。",
    title: "验证 MCP Client 基线",
  },
  {
    assignee: "Reviewer",
    dependencies: ["建立团队工作台界面"],
    id: "ui-review",
    priority: "low",
    project: "Aster",
    status: "blocked",
    summary: "等待页面骨架稳定后进行 UI、响应式和回归审查。",
    title: "复核界面迁移质量",
  },
] as const;
