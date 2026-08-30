import { z } from "zod";

import { agentAvatarSchema } from "./agent-avatar.js";
import type { AgentAvatar, AgentAvatarIcon } from "./agent-avatar.js";
import {
  conversationMessageDeliveryModeSchema,
  conversationPermissionModeSchema,
} from "./conversation.js";

const configurationIdSchema = z
  .string()
  .trim()
  .min(1)
  .max(80)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const agentModelStrategySchema = z.enum(["auto", "fixed", "inherit"]);
export const agentCapabilityScopeSchema = z.enum(["custom", "inherit_all"]);
export const agentStatusSchema = z.enum(["running", "sleeping", "standby"]);

/** Tool surfaces that can create an Agent-scoped allow rule. */
export const agentPermissionToolSchema = z.enum([
  "apply_patch",
  "browser_control",
  "delete_file",
  "external_read",
  "replace_in_file",
  "run_command",
  "write_file",
]);

export const agentPermissionRuleSchema = z
  .object({
    pattern: z.string().trim().min(1).max(4_000),
    tool: agentPermissionToolSchema,
  })
  .strict()
  .superRefine((rule, context) => {
    const wildcardIndex = rule.pattern.indexOf("*");
    if (wildcardIndex >= 0 && wildcardIndex !== rule.pattern.length - 1) {
      context.addIssue({
        code: "custom",
        message: "通配符只能出现在规则末尾。",
        path: ["pattern"],
      });
    }
    if (wildcardIndex >= 0 && !rule.pattern.endsWith("*")) {
      context.addIssue({
        code: "custom",
        message: "通配符只能作为末尾字符。",
        path: ["pattern"],
      });
    }
  });

export const agentPermissionsSchema = z
  .object({
    allow: z.array(agentPermissionRuleSchema).max(200),
  })
  .strict();

export const agentProfileSchema = z.object({
  avatar: agentAvatarSchema,
  capabilityScope: agentCapabilityScopeSchema,
  description: z.string().max(2_000),
  enabled: z.boolean(),
  id: configurationIdSchema,
  instructions: z.string().max(16_000),
  isDefault: z.boolean(),
  mcpServerIds: z.array(configurationIdSchema).max(100),
  model: z.string().max(300),
  modelStrategy: agentModelStrategySchema,
  name: z.string().trim().min(1).max(120),
  permissions: agentPermissionsSchema.default({ allow: [] }),
  role: z.string().max(300),
  skillIds: z.array(configurationIdSchema).max(100),
  status: agentStatusSchema,
}).strict();

export const agentTeamMemberConfigurationSchema = z.object({
  instructions: z.string().max(16_000),
  role: z.string().max(300),
}).strict();

export const agentTeamSchema = z.object({
  description: z.string().max(2_000),
  enabled: z.boolean(),
  id: configurationIdSchema,
  instructions: z.string().max(16_000),
  leadAgentId: configurationIdSchema,
  maxWorkers: z.number().int().min(1).max(32),
  memberConfigurations: z.record(configurationIdSchema, agentTeamMemberConfigurationSchema),
  memberIds: z.array(configurationIdSchema).min(1).max(100),
  name: z.string().trim().min(1).max(120),
  projectScope: z.enum(["all", "selected"]),
}).strict();

function validateUniqueIds<T extends { id: string }>(
  items: readonly T[],
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  items.forEach((item, index) => {
    if (seen.has(item.id)) {
      context.addIssue({
        code: "custom",
        message: `配置 ID ${item.id} 重复。`,
        path: [index, "id"],
      });
    }
    seen.add(item.id);
  });
}

export const agentDirectoryConfigurationSchema = z.object({
  agents: z.array(agentProfileSchema).max(100),
  teams: z.array(agentTeamSchema).max(100),
}).strict().superRefine((configuration, context) => {
  validateUniqueIds(configuration.agents, context);
  validateUniqueIds(configuration.teams, context);
  const agentIds = new Set(configuration.agents.map((agent) => agent.id));
  configuration.teams.forEach((team, index) => {
    if (!agentIds.has(team.leadAgentId) || !team.memberIds.includes(team.leadAgentId)) {
      context.addIssue({
        code: "custom",
        message: "团队负责人必须是团队成员。",
        path: ["teams", index, "leadAgentId"],
      });
    }
    team.memberIds.forEach((memberId, memberIndex) => {
      if (!agentIds.has(memberId)) {
        context.addIssue({
          code: "custom",
          message: "团队成员必须引用已配置的 Agent。",
          path: ["teams", index, "memberIds", memberIndex],
        });
      }
    });
    Object.keys(team.memberConfigurations).forEach((memberId) => {
      if (!team.memberIds.includes(memberId)) {
        context.addIssue({
          code: "custom",
          message: "成员配置只能属于团队成员。",
          path: ["teams", index, "memberConfigurations", memberId],
        });
      }
    });
  });
});

export const permissionPolicySchema = z.enum(["allow", "ask", "unavailable"]);

export const applicationPermissionPoliciesSchema = z.object({
  "browser-control": permissionPolicySchema.default("ask"),
  "command-run": permissionPolicySchema,
  "git-write": permissionPolicySchema,
  "patch-write": permissionPolicySchema,
  "workspace-read": permissionPolicySchema,
  "workspace-search": permissionPolicySchema,
}).strict();

export const applicationAppearanceConfigurationSchema = z.object({
  filePanelOpen: z.boolean(),
  filePanelWidth: z.number().int().min(320).max(960),
  projectNavigatorOpen: z.boolean(),
  projectNavigatorWidth: z.number().int().min(220).max(420),
  themeMode: z.enum(["light", "dark"]),
}).strict();

export const conversationSendShortcutSchema = z.enum(["enter", "ctrl_enter"]);

export const applicationGeneralConfigurationSchema = z.object({
  defaultPermissionMode: conversationPermissionModeSchema.default("ask_before_changes"),
  defaultMessageDeliveryMode: conversationMessageDeliveryModeSchema,
  sendShortcut: conversationSendShortcutSchema.default("enter"),
  showContextUsage: z.boolean().default(true),
}).strict();

export const applicationSettingsSchema = z.object({
  agentDirectory: agentDirectoryConfigurationSchema,
  appearance: applicationAppearanceConfigurationSchema,
  general: applicationGeneralConfigurationSchema.default({
    defaultPermissionMode: "ask_before_changes",
    defaultMessageDeliveryMode: "queue",
    sendShortcut: "enter",
    showContextUsage: true,
  }),
  permissionPolicies: applicationPermissionPoliciesSchema,
  version: z.literal(1),
}).strict();

export type { AgentAvatar, AgentAvatarIcon };
export type AgentModelStrategy = z.infer<typeof agentModelStrategySchema>;
export type AgentCapabilityScope = z.infer<typeof agentCapabilityScopeSchema>;
export type AgentStatus = z.infer<typeof agentStatusSchema>;
export type AgentPermissionTool = z.infer<typeof agentPermissionToolSchema>;
export type AgentPermissionRule = z.infer<typeof agentPermissionRuleSchema>;
export type AgentPermissions = z.infer<typeof agentPermissionsSchema>;
export type AgentProfile = z.infer<typeof agentProfileSchema>;
export type AgentTeamMemberConfiguration = z.infer<typeof agentTeamMemberConfigurationSchema>;
export type AgentTeam = z.infer<typeof agentTeamSchema>;
export type AgentDirectoryConfiguration = z.infer<typeof agentDirectoryConfigurationSchema>;
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;
export type ApplicationPermissionPolicies = z.infer<typeof applicationPermissionPoliciesSchema>;
export type ApplicationAppearanceConfiguration = z.infer<typeof applicationAppearanceConfigurationSchema>;
export type ApplicationGeneralConfiguration = z.infer<typeof applicationGeneralConfigurationSchema>;
export type ConversationSendShortcut = z.infer<typeof conversationSendShortcutSchema>;
export type ApplicationSettings = z.infer<typeof applicationSettingsSchema>;

export const DEFAULT_AGENT_DIRECTORY_CONFIGURATION: AgentDirectoryConfiguration = {
  agents: [
    {
      avatar: { icon: "bot", kind: "icon" },
      capabilityScope: "inherit_all",
      description: "新对话未指定角色时使用，负责通用问答、实现和验证。",
      enabled: true,
      id: "default-agent",
      instructions: "直接处理用户任务；先核对项目事实，只做完成目标所需的最小改动，并给出验证结果。",
      isDefault: true,
      mcpServerIds: [],
      model: "当前对话模型",
      modelStrategy: "inherit",
      name: "默认 Agent",
      permissions: { allow: [] },
      role: "通用执行",
      skillIds: [],
      status: "standby",
    },
    {
      avatar: { icon: "sparkles", kind: "icon" },
      capabilityScope: "inherit_all",
      description: "接收团队对话，拆分任务、调度成员并汇总最终结果。",
      enabled: true,
      id: "team-lead",
      instructions: "保持工作项所有权，先分诊再委派；每个团队工作项至少交给一位持久专业成员处理，自己负责边界、调度、验收和汇总，不替代成员完成专业实现。",
      isDefault: false,
      mcpServerIds: [],
      model: "当前对话模型",
      modelStrategy: "inherit",
      name: "Team Lead",
      permissions: { allow: [] },
      role: "接单、调度与汇总",
      skillIds: [],
      status: "running",
    },
    {
      avatar: { icon: "clipboard-check", kind: "icon" },
      capabilityScope: "inherit_all",
      description: "澄清需求、边界和验收条件，把模糊目标整理成可执行任务。",
      enabled: true,
      id: "requirements-analyst",
      instructions: "先核对用户目标和项目事实；输出明确范围、非目标、验收条件与待确认问题，不擅自扩大需求。",
      isDefault: false,
      mcpServerIds: [],
      model: "当前对话模型",
      modelStrategy: "inherit",
      name: "需求分析师",
      permissions: { allow: [] },
      role: "需求澄清与验收定义",
      skillIds: [],
      status: "standby",
    },
    {
      avatar: { icon: "workflow", kind: "icon" },
      capabilityScope: "inherit_all",
      description: "分析现有系统边界，给出最小可行的技术方案和风险控制。",
      enabled: true,
      id: "solution-architect",
      instructions: "基于现有代码和约束设计最小方案；明确模块边界、接口、数据流、风险和验证点，避免为未来场景过度设计。",
      isDefault: false,
      mcpServerIds: [],
      model: "当前对话模型",
      modelStrategy: "inherit",
      name: "架构师",
      permissions: { allow: [] },
      role: "技术方案与架构边界",
      skillIds: [],
      status: "standby",
    },
    {
      avatar: { icon: "palette", kind: "icon" },
      capabilityScope: "inherit_all",
      description: "负责界面、交互和前端状态实现，并验证真实用户路径。",
      enabled: true,
      id: "frontend-engineer",
      instructions: "遵循现有设计系统和前端架构；完成界面、交互、状态与相关测试，关注主路径、边界状态和回归。",
      isDefault: false,
      mcpServerIds: [],
      model: "当前对话模型",
      modelStrategy: "inherit",
      name: "前端开发",
      permissions: { allow: [] },
      role: "前端实现与交互验证",
      skillIds: [],
      status: "standby",
    },
    {
      avatar: { icon: "server-cog", kind: "icon" },
      capabilityScope: "inherit_all",
      description: "负责运行时、接口、数据和持久化实现，并维护安全边界。",
      enabled: true,
      id: "backend-engineer",
      instructions: "遵循现有后端边界和数据合同；完成最小实现、错误处理与相关测试，不绕过权限、状态机或持久化约束。",
      isDefault: false,
      mcpServerIds: [],
      model: "当前对话模型",
      modelStrategy: "inherit",
      name: "后端开发",
      permissions: { allow: [] },
      role: "后端实现与数据安全",
      skillIds: [],
      status: "standby",
    },
    {
      avatar: { icon: "test-tube", kind: "icon" },
      capabilityScope: "inherit_all",
      description: "根据验收条件设计并执行测试，提供可复现的质量结论。",
      enabled: true,
      id: "qa-engineer",
      instructions: "先复现再验证；覆盖需求主路径、修改边界和高风险回归，清楚区分已执行证据、未验证项与阻断问题。",
      isDefault: false,
      mcpServerIds: [],
      model: "当前对话模型",
      modelStrategy: "inherit",
      name: "测试工程师",
      permissions: { allow: [] },
      role: "测试设计与质量验收",
      skillIds: [],
      status: "standby",
    },
    {
      avatar: { icon: "compass", kind: "icon" },
      capabilityScope: "custom",
      description: "只读搜索代码和资料，返回带文件位置的事实摘要。",
      enabled: true,
      id: "explorer",
      instructions: "保持只读；优先搜索和定向读取，不提出未经证据支持的修改。",
      isDefault: false,
      mcpServerIds: ["openai-docs", "project-knowledge"],
      model: "团队自动选择",
      modelStrategy: "auto",
      name: "Explorer",
      permissions: { allow: [] },
      role: "搜索与事实核对",
      skillIds: ["code-review"],
      status: "standby",
    },
    {
      avatar: { icon: "hammer", kind: "icon" },
      capabilityScope: "inherit_all",
      description: "在明确文件边界内完成实现，并运行与改动相符的验证。",
      enabled: true,
      id: "implementer",
      instructions: "遵循现有项目风格；控制改动范围，完成后运行最接近真实行为的验证。",
      isDefault: false,
      mcpServerIds: [],
      model: "当前对话模型",
      modelStrategy: "inherit",
      name: "Implementer",
      permissions: { allow: [] },
      role: "实现与验证",
      skillIds: [],
      status: "sleeping",
    },
    {
      avatar: { icon: "shield", kind: "icon" },
      capabilityScope: "custom",
      description: "检查正确性、行为回归和测试缺口，不承担主实现。",
      enabled: true,
      id: "reviewer",
      instructions: "结论以可复现问题为先；按严重程度输出，并给出准确文件位置。",
      isDefault: false,
      mcpServerIds: ["openai-docs"],
      model: "团队自动选择",
      modelStrategy: "auto",
      name: "Reviewer",
      permissions: { allow: [] },
      role: "风险与质量审查",
      skillIds: ["code-review", "browser"],
      status: "standby",
    },
  ],
  teams: [
    {
      description: "由负责人、需求、架构、前端、后端和测试组成的小型开发团队，按任务复杂度选择短路径或完整协作。",
      enabled: true,
      id: "default-team",
      instructions: "围绕当前工作项协作。Team Lead 必须先分诊，并让每个工作项至少委派一位专业成员；简单任务只走一位最匹配成员的短路径，常规任务按需要组合需求、架构、开发和测试，复杂跨端任务才并行前后端并在最后交给测试。成员只处理明确边界并返回可验证结果，Team Lead 负责验收与汇总。",
      leadAgentId: "team-lead",
      maxWorkers: 3,
      memberConfigurations: {
        "team-lead": {
          instructions: "禁止不经成员委派就直接完成工作项；至少等待一位专业成员返回结果后才能最终汇总。",
          role: "任务分诊、调度与交付",
        },
        "requirements-analyst": {
          instructions: "需求不清或验收条件缺失时优先介入；范围清楚的简单任务无需重复产出长文档。",
          role: "需求澄清与验收定义",
        },
        "solution-architect": {
          instructions: "跨模块、数据合同或高风险变更时介入；局部小改只给出必要边界，不制造额外流程。",
          role: "技术方案与架构边界",
        },
        "frontend-engineer": {
          instructions: "负责用户界面、交互、前端状态和对应测试，完成后返回变更位置与验证证据。",
          role: "前端实现与交互验证",
        },
        "backend-engineer": {
          instructions: "负责运行时、接口、数据、工具和持久化实现，完成后返回变更位置与验证证据。",
          role: "后端实现与数据安全",
        },
        "qa-engineer": {
          instructions: "在存在代码变更、回归风险或明确验收要求时介入，独立核对实现结果并给出已执行证据。",
          role: "测试设计与质量验收",
        },
      },
      memberIds: [
        "team-lead",
        "requirements-analyst",
        "solution-architect",
        "frontend-engineer",
        "backend-engineer",
        "qa-engineer",
      ],
      name: "默认团队",
      projectScope: "all",
    },
    {
      description: "复用现有 Agent 进行发布前检查，不固定绑定某个项目。",
      enabled: true,
      id: "release-review-team",
      instructions: "只执行发布前检查，不修改业务实现；所有结论必须能够追溯到构建、测试或发布证据。",
      leadAgentId: "team-lead",
      maxWorkers: 2,
      memberConfigurations: {
        reviewer: {
          instructions: "重点检查构建产物、回归测试和未验证风险。",
          role: "发布审查",
        },
      },
      memberIds: ["team-lead", "explorer", "reviewer"],
      name: "发布复核组",
      projectScope: "all",
    },
  ],
};

export const DEFAULT_APPLICATION_SETTINGS: ApplicationSettings = {
  agentDirectory: structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION),
  appearance: {
    filePanelOpen: true,
    filePanelWidth: 520,
    projectNavigatorOpen: true,
    projectNavigatorWidth: 288,
    themeMode: "light",
  },
  general: {
    defaultPermissionMode: "ask_before_changes",
    defaultMessageDeliveryMode: "queue",
    sendShortcut: "enter",
    showContextUsage: true,
  },
  permissionPolicies: {
    "browser-control": "ask",
    "command-run": "ask",
    "git-write": "unavailable",
    "patch-write": "ask",
    "workspace-read": "allow",
    "workspace-search": "allow",
  },
  version: 1,
};
