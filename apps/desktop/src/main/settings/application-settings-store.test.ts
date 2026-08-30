import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { DEFAULT_APPLICATION_SETTINGS, type ApplicationSettings } from "@agent/protocol";

import { ApplicationSettingsStore } from "./application-settings-store.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("ApplicationSettingsStore", () => {
  it("creates and reads the reusable application defaults", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-app-settings-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "application-settings.json");
    const store = new ApplicationSettingsStore(configurationPath);

    store.ensureFile();

    expect(store.getConfiguration()).toEqual(DEFAULT_APPLICATION_SETTINGS);
    expect(JSON.parse(await readFile(configurationPath, "utf8"))).toEqual(
      DEFAULT_APPLICATION_SETTINGS,
    );
  });

  it("persists general, Agent, permission and appearance edits atomically", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-app-settings-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "application-settings.json");
    const store = new ApplicationSettingsStore(configurationPath);
    const configuration = {
      ...structuredClone(DEFAULT_APPLICATION_SETTINGS),
      appearance: {
        ...DEFAULT_APPLICATION_SETTINGS.appearance,
        themeMode: "dark" as const,
      },
      general: {
        ...DEFAULT_APPLICATION_SETTINGS.general,
        defaultMessageDeliveryMode: "steer" as const,
      },
      permissionPolicies: {
        ...DEFAULT_APPLICATION_SETTINGS.permissionPolicies,
        "command-run": "allow" as const,
      },
    };

    expect(store.saveConfiguration(configuration)).toEqual(configuration);
    expect(store.getConfiguration()).toEqual(configuration);
    expect(JSON.parse(await readFile(configurationPath, "utf8"))).toEqual(configuration);
  });

  it("notifies listeners after the persisted configuration is replaced", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-app-settings-"));
    temporaryDirectories.push(directory);
    const store = new ApplicationSettingsStore(path.join(directory, "application-settings.json"));
    const received: ApplicationSettings[] = [];
    const unsubscribe = store.onChanged((configuration) => received.push(configuration));

    const saved = store.saveConfiguration(structuredClone(DEFAULT_APPLICATION_SETTINGS));

    expect(received).toEqual([saved]);
    unsubscribe();
    store.saveConfiguration({
      ...saved,
      general: { ...saved.general, sendShortcut: "ctrl_enter" },
    });
    expect(received).toHaveLength(1);
  });

  it("adds the queue default when reading settings saved before general options existed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-app-settings-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "application-settings.json");
    const store = new ApplicationSettingsStore(configurationPath);
    const legacyConfiguration = {
      agentDirectory: DEFAULT_APPLICATION_SETTINGS.agentDirectory,
      appearance: DEFAULT_APPLICATION_SETTINGS.appearance,
      permissionPolicies: DEFAULT_APPLICATION_SETTINGS.permissionPolicies,
      version: 1,
    };
    await writeFile(configurationPath, JSON.stringify(legacyConfiguration), "utf8");

    expect(store.getConfiguration().general).toEqual(
      DEFAULT_APPLICATION_SETTINGS.general,
    );
  });

  it("upgrades only the untouched legacy default development team", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-app-settings-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "application-settings.json");
    const store = new ApplicationSettingsStore(configurationPath);
    const legacy = structuredClone(DEFAULT_APPLICATION_SETTINGS);
    legacy.appearance.themeMode = "dark";
    legacy.agentDirectory.agents = legacy.agentDirectory.agents.filter((agent) =>
      ![
        "requirements-analyst",
        "solution-architect",
        "frontend-engineer",
        "backend-engineer",
        "qa-engineer",
      ].includes(agent.id)
    );
    legacy.agentDirectory.teams[0] = {
      description: "面向所有项目的默认开发团队，按任务需要启动少量成员。",
      enabled: true,
      id: "default-team",
      instructions: "围绕当前工作项协作；Team Lead 保持主任务所有权，成员只处理明确分配的边界，并返回可验证结果。",
      leadAgentId: "team-lead",
      maxWorkers: 5,
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
      projectScope: "selected",
    };
    const legacyLead = legacy.agentDirectory.agents.find((agent) => agent.id === "team-lead");
    if (legacyLead === undefined) throw new Error("Team Lead fixture is unavailable.");
    legacyLead.instructions = "保持主对话所有权；简单任务直接完成，只有可独立验收或可并行的工作才委派。";
    await writeFile(configurationPath, JSON.stringify(legacy), "utf8");

    store.ensureFile();

    const upgraded = store.getConfiguration();
    expect(upgraded.appearance.themeMode).toBe("dark");
    expect(upgraded.agentDirectory.teams.find((team) => team.id === "default-team"))
      .toMatchObject({
        memberIds: DEFAULT_APPLICATION_SETTINGS.agentDirectory.teams.find(
          (team) => team.id === "default-team",
        )?.memberIds,
        maxWorkers: 5,
        projectScope: "selected",
      });
    expect(upgraded.agentDirectory.agents.map((agent) => agent.id)).toEqual(
      expect.arrayContaining([
        "requirements-analyst",
        "solution-architect",
        "frontend-engineer",
        "backend-engineer",
        "qa-engineer",
      ]),
    );
    expect(upgraded.agentDirectory.agents.find((agent) => agent.id === "team-lead")?.instructions)
      .toContain("每个团队工作项至少交给一位持久专业成员");
  });

  it("preserves a customized default team instead of replacing it", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-app-settings-"));
    temporaryDirectories.push(directory);
    const configurationPath = path.join(directory, "application-settings.json");
    const store = new ApplicationSettingsStore(configurationPath);
    const customized = structuredClone(DEFAULT_APPLICATION_SETTINGS);
    const defaultTeam = customized.agentDirectory.teams.find((team) => team.id === "default-team");
    if (defaultTeam === undefined) throw new Error("Default Team fixture is unavailable.");
    defaultTeam.instructions = "保留用户自己的团队规则。";
    await writeFile(configurationPath, JSON.stringify(customized), "utf8");

    store.ensureFile();

    expect(store.getConfiguration().agentDirectory.teams.find(
      (team) => team.id === "default-team",
    )?.instructions).toBe("保留用户自己的团队规则。");
  });
});
