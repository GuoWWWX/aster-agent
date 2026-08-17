import {
  DEFAULT_AGENT_DIRECTORY_CONFIGURATION,
  type AgentDirectoryConfiguration,
  type AgentProfile,
  type AgentTeam,
  type AgentTeamMemberConfiguration,
} from "@agent/protocol";
import { create } from "zustand";

export type {
  AgentAvatar,
  AgentAvatarIcon,
  AgentCapabilityScope,
  AgentDirectoryConfiguration,
  AgentModelStrategy,
  AgentProfile,
  AgentStatus,
  AgentTeam,
  AgentTeamMemberConfiguration,
} from "@agent/protocol";

export const AVAILABLE_SKILLS = [
  { id: "code-review", name: "代码审查" },
  { id: "browser", name: "浏览器验证" },
  { id: "documents", name: "文档处理" },
  { id: "release", name: "发布检查" },
] as const;

export const AVAILABLE_MCP_SERVERS = [
  { id: "openai-docs", name: "OpenAI Docs" },
  { id: "browser-tools", name: "Browser Tools" },
  { id: "figma", name: "Figma" },
  { id: "project-knowledge", name: "项目知识库" },
] as const;

type AgentDirectoryState = AgentDirectoryConfiguration & {
  addAgent: () => string;
  addAgentToTeam: (teamId: string, agentId: string) => void;
  addTeam: () => string;
  hydrate: (configuration: AgentDirectoryConfiguration) => void;
  removeAgentFromTeam: (teamId: string, agentId: string) => void;
  updateAgent: (agentId: string, patch: Partial<AgentProfile>) => void;
  updateTeam: (teamId: string, patch: Partial<AgentTeam>) => void;
  updateTeamMemberConfiguration: (
    teamId: string,
    agentId: string,
    patch: Partial<AgentTeamMemberConfiguration>,
  ) => void;
};

export const useAgentDirectoryStore = create<AgentDirectoryState>()((set) => ({
  ...structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION),
  hydrate: (configuration) => set(structuredClone(configuration)),
  addAgent: () => {
    const id = crypto.randomUUID();
    set((state) => ({
      agents: [...state.agents, {
        avatar: { icon: "bot", kind: "icon" },
        capabilityScope: "inherit_all",
        description: "",
        enabled: true,
        id,
        instructions: "",
        isDefault: false,
        mcpServerIds: [],
        model: "当前对话模型",
        modelStrategy: "inherit",
        name: "未命名 Agent",
        role: "待配置角色",
        skillIds: [],
        status: "standby",
      }],
    }));
    return id;
  },
  addAgentToTeam: (teamId, agentId) => set((state) => ({
    teams: state.teams.map((team) => team.id === teamId && !team.memberIds.includes(agentId)
      ? { ...team, memberIds: [...team.memberIds, agentId] }
      : team),
  })),
  addTeam: () => {
    const id = crypto.randomUUID();
    set((state) => {
      const defaultAgentId = state.agents.find((agent) => agent.isDefault)?.id
        ?? state.agents[0]?.id
        ?? "";
      return {
        teams: [...state.teams, {
          description: "",
          enabled: true,
          id,
          instructions: "",
          leadAgentId: defaultAgentId,
          maxWorkers: 3,
          memberConfigurations: {},
          memberIds: defaultAgentId.length === 0 ? [] : [defaultAgentId],
          name: "新团队",
          projectScope: "all",
        }],
      };
    });
    return id;
  },
  removeAgentFromTeam: (teamId, agentId) => set((state) => ({
    teams: state.teams.map((team) => team.id === teamId && team.leadAgentId !== agentId
      ? {
          ...team,
          memberConfigurations: Object.fromEntries(
            Object.entries(team.memberConfigurations).filter(([id]) => id !== agentId),
          ),
          memberIds: team.memberIds.filter((id) => id !== agentId),
        }
      : team),
  })),
  updateAgent: (agentId, patch) => set((state) => ({
    agents: state.agents.map((agent) => agent.id === agentId
      ? { ...agent, ...patch, id: agent.id, isDefault: agent.isDefault }
      : agent),
  })),
  updateTeam: (teamId, patch) => set((state) => ({
    teams: state.teams.map((team) => team.id === teamId
      ? { ...team, ...patch, id: team.id }
      : team),
  })),
  updateTeamMemberConfiguration: (teamId, agentId, patch) => set((state) => ({
    teams: state.teams.map((team) => team.id === teamId && team.memberIds.includes(agentId)
      ? {
          ...team,
          memberConfigurations: {
            ...team.memberConfigurations,
            [agentId]: {
              instructions: "",
              role: "",
              ...team.memberConfigurations[agentId],
              ...patch,
            },
          },
        }
      : team),
  })),
}));
