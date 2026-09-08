import { existsSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

import {
  applicationSettingsSchema,
  DEFAULT_APPLICATION_SETTINGS,
  type AgentTeam,
  type ApplicationSettings,
} from "@agent/protocol";
import { readJsonConfiguration, writeJsonConfiguration } from "./json-configuration-file.js";
import { SettingsJsoncFile } from "./settings-jsonc-file.js";

export class ApplicationSettingsStore {
  private readonly listeners = new Set<(configuration: ApplicationSettings) => void>();
  private readonly configurationPath: string | null;
  private readonly legacyConfigurationPath: string | null;
  private readonly settings: SettingsJsoncFile | null;

  public constructor(configuration: string | SettingsJsoncFile, legacyConfigurationPath?: string) {
    this.configurationPath = typeof configuration === "string" ? configuration : null;
    this.legacyConfigurationPath = legacyConfigurationPath ?? null;
    this.settings = typeof configuration === "string" ? null : configuration;
  }

  public onChanged(listener: (configuration: ApplicationSettings) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public ensureFile(): void {
    if (this.settings !== null) {
      this.settings.ensureFile();
      const initial = this.legacyConfigurationPath !== null
        && existsSync(this.legacyConfigurationPath)
        ? readJsonConfiguration(
            this.legacyConfigurationPath,
            applicationSettingsSchema,
            DEFAULT_APPLICATION_SETTINGS,
          )
        : DEFAULT_APPLICATION_SETTINGS;
      const missingSections = [
        { key: "general", value: initial.general },
        { key: "appearance", value: initial.appearance },
        { key: "permissionPolicies", value: initial.permissionPolicies },
        { key: "agents", value: initial.agentDirectory.agents },
        { key: "teams", value: initial.agentDirectory.teams },
      ].filter(({ key }) => !this.settings?.has(key));
      if (missingSections.length > 0) this.settings.writeValues(missingSections);
      const current = this.getConfiguration();
      const migrated = migrateLegacyDefaultDevelopmentTeam(current);
      if (migrated !== current) this.saveConfiguration(migrated);
      return;
    }
    if (this.configurationPath === null) throw new Error("Application settings path is missing.");
    if (!existsSync(this.configurationPath)) {
      this.saveConfiguration(DEFAULT_APPLICATION_SETTINGS);
      return;
    }
    const current = this.getConfiguration();
    const migrated = migrateLegacyDefaultDevelopmentTeam(current);
    if (migrated !== current) this.saveConfiguration(migrated);
  }

  public getConfiguration(): ApplicationSettings {
    if (this.settings !== null) {
      return applicationSettingsSchema.parse({
        agentDirectory: {
          agents: this.settings.readValue("agents")
            ?? DEFAULT_APPLICATION_SETTINGS.agentDirectory.agents,
          teams: this.settings.readValue("teams")
            ?? DEFAULT_APPLICATION_SETTINGS.agentDirectory.teams,
        },
        appearance: this.settings.readValue("appearance")
          ?? DEFAULT_APPLICATION_SETTINGS.appearance,
        general: this.settings.readValue("general")
          ?? DEFAULT_APPLICATION_SETTINGS.general,
        permissionPolicies: this.settings.readValue("permissionPolicies")
          ?? DEFAULT_APPLICATION_SETTINGS.permissionPolicies,
        version: 1,
      });
    }
    if (this.configurationPath === null) throw new Error("Application settings path is missing.");
    return readJsonConfiguration(
      this.configurationPath,
      applicationSettingsSchema,
      DEFAULT_APPLICATION_SETTINGS,
    );
  }

  public saveConfiguration(input: ApplicationSettings): ApplicationSettings {
    const parsed = applicationSettingsSchema.parse(input);
    let saved: ApplicationSettings;
    if (this.settings === null) {
      if (this.configurationPath === null) throw new Error("Application settings path is missing.");
      saved = writeJsonConfiguration(this.configurationPath, applicationSettingsSchema, parsed);
    } else {
      this.settings.writeValues([
        { key: "general", value: parsed.general },
        { key: "appearance", value: parsed.appearance },
        { key: "permissionPolicies", value: parsed.permissionPolicies },
        { key: "agents", value: parsed.agentDirectory.agents },
        { key: "teams", value: parsed.agentDirectory.teams },
      ]);
      saved = structuredClone(parsed);
    }
    for (const listener of this.listeners) {
      try {
        listener(structuredClone(saved));
      } catch (error) {
        console.error("Application settings change listener failed.", error);
      }
    }
    return saved;
  }
}

const LEGACY_DEFAULT_DEVELOPMENT_TEAM: AgentTeam = {
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
};

const LEGACY_TEAM_LEAD_INSTRUCTIONS =
  "保持主对话所有权；简单任务直接完成，只有可独立验收或可并行的工作才委派。";

function migrateLegacyDefaultDevelopmentTeam(
  configuration: ApplicationSettings,
): ApplicationSettings {
  const legacyTeamIndex = configuration.agentDirectory.teams.findIndex((team) =>
    isLegacyDefaultDevelopmentTeam(team)
  );
  if (legacyTeamIndex < 0) return configuration;
  const nextDefaultTeam = DEFAULT_APPLICATION_SETTINGS.agentDirectory.teams.find(
    (team) => team.id === "default-team",
  );
  if (nextDefaultTeam === undefined) return configuration;
  const existingAgentIds = new Set(configuration.agentDirectory.agents.map((agent) => agent.id));
  const addedAgents = DEFAULT_APPLICATION_SETTINGS.agentDirectory.agents.filter((agent) =>
    nextDefaultTeam.memberIds.includes(agent.id) && !existingAgentIds.has(agent.id)
  );
  const legacyTeam = configuration.agentDirectory.teams[legacyTeamIndex];
  if (legacyTeam === undefined) return configuration;
  const migratedTeam: AgentTeam = {
    ...structuredClone(nextDefaultTeam),
    enabled: legacyTeam.enabled,
    maxWorkers: legacyTeam.maxWorkers,
    name: legacyTeam.name,
    projectScope: legacyTeam.projectScope,
    description: legacyTeam.description === LEGACY_DEFAULT_DEVELOPMENT_TEAM.description
      ? nextDefaultTeam.description
      : legacyTeam.description,
  };
  return applicationSettingsSchema.parse({
    ...configuration,
    agentDirectory: {
      agents: configuration.agentDirectory.agents.map((agent) =>
        agent.id === "team-lead" && agent.instructions === LEGACY_TEAM_LEAD_INSTRUCTIONS
          ? structuredClone(DEFAULT_APPLICATION_SETTINGS.agentDirectory.agents.find(
              (candidate) => candidate.id === "team-lead",
            ) ?? agent)
          : agent
      ).concat(structuredClone(addedAgents)),
      teams: configuration.agentDirectory.teams.map((team, index) =>
        index === legacyTeamIndex ? migratedTeam : team
      ),
    },
  });
}

function isLegacyDefaultDevelopmentTeam(team: AgentTeam): boolean {
  return team.id === LEGACY_DEFAULT_DEVELOPMENT_TEAM.id
    && team.leadAgentId === LEGACY_DEFAULT_DEVELOPMENT_TEAM.leadAgentId
    && team.instructions === LEGACY_DEFAULT_DEVELOPMENT_TEAM.instructions
    && isDeepStrictEqual(team.memberIds, LEGACY_DEFAULT_DEVELOPMENT_TEAM.memberIds)
    && isDeepStrictEqual(
      team.memberConfigurations,
      LEGACY_DEFAULT_DEVELOPMENT_TEAM.memberConfigurations,
    );
}
