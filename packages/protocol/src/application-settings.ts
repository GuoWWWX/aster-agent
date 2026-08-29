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
      instructions: "保持主对话所有权；简单任务直接完成，只有可独立验收或可并行的工作才委派。",
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
      description: "面向所有项目的默认开发团队，按任务需要启动少量成员。",
      enabled: true,
      id: "default-team",
      instructions: "围绕当前工作项协作；Team Lead 保持主任务所有权，成员只处理明确分配的边界，并返回可验证结果。",
      leadAgentId: "team-lead",
      maxWorkers: 3,
      memberConfigurations: {
        explorer: {
          instructions: "优先核对当前项目的代码和配置事实，结论需要带准确文件位置。",
          role: "项目事实调查",
        },
        reviewer: {
          instructions: "等待实现完成后再开始复核，优先报告行为回归和缺失验证。",
          role: "独立质量复核",
        },
      },
      memberIds: ["team-lead", "explorer", "implementer", "reviewer"],
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
