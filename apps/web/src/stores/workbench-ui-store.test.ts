import { beforeEach, describe, expect, it } from "vitest";

import {
  resolveActiveSettingsWorkspaceTarget,
  useWorkbenchUiStore,
} from "./workbench-ui-store.js";

describe("workbench prompt workspace", () => {
  beforeEach(() => {
    useWorkbenchUiStore.setState({
      agentPromptWorkspaceTarget: null,
      configurationWorkspaceTarget: null,
      isFilePanelOpen: false,
      isSettingsFilePanelOpen: false,
    });
  });

  it("opens an Agent prompt in the right workspace", () => {
    useWorkbenchUiStore.getState().openAgentPromptWorkspace({
      agentId: "agent-1",
      title: "实现 Agent 提示词",
    });

    expect(useWorkbenchUiStore.getState()).toMatchObject({
      agentPromptWorkspaceTarget: {
        agentId: "agent-1",
        title: "实现 Agent 提示词",
      },
      configurationWorkspaceTarget: null,
      isFilePanelOpen: false,
      isSettingsFilePanelOpen: true,
    });
  });

  it("replaces the prompt target when a configuration file opens", () => {
    useWorkbenchUiStore.getState().openAgentPromptWorkspace({
      agentId: "agent-1",
      title: "实现 Agent 提示词",
    });
    useWorkbenchUiStore.getState().openConfigurationWorkspace({
      configurationId: "skill-1",
      kind: "skill",
      title: "代码审查",
    });

    expect(useWorkbenchUiStore.getState()).toMatchObject({
      agentPromptWorkspaceTarget: null,
      configurationWorkspaceTarget: {
        configurationId: "skill-1",
        kind: "skill",
        title: "代码审查",
      },
      isFilePanelOpen: false,
      isSettingsFilePanelOpen: true,
    });
  });

  it("clears a closed settings workspace so it cannot reopen automatically", () => {
    useWorkbenchUiStore.getState().openAgentPromptWorkspace({
      agentId: "agent-1",
      title: "实现 Agent 提示词",
    });
    useWorkbenchUiStore.getState().closeAgentPromptWorkspace("agent-1");

    expect(useWorkbenchUiStore.getState().agentPromptWorkspaceTarget).toBeNull();

    useWorkbenchUiStore.getState().openConfigurationWorkspace({
      configurationId: "skill-1",
      kind: "skill",
      title: "代码审查",
    });
    useWorkbenchUiStore.getState().closeConfigurationWorkspace({
      configurationId: "skill-1",
      kind: "skill",
    });

    expect(useWorkbenchUiStore.getState().configurationWorkspaceTarget).toBeNull();
  });

  it("only activates a settings workspace in its owning settings section", () => {
    const agentTarget = { agentId: "agent-1", title: "实现 Agent 提示词" };
    const skillTarget = { configurationId: "skill-1", kind: "skill" as const, title: "代码审查" };

    expect(resolveActiveSettingsWorkspaceTarget(
      "settings",
      "agents",
      agentTarget,
      null,
    )).toEqual({ kind: "agent-prompt", target: agentTarget });
    expect(resolveActiveSettingsWorkspaceTarget(
      "settings",
      "skills",
      null,
      skillTarget,
    )).toEqual({ kind: "configuration", target: skillTarget });
    expect(resolveActiveSettingsWorkspaceTarget(
      "settings",
      "mcp",
      null,
      skillTarget,
    )).toBeNull();
    expect(resolveActiveSettingsWorkspaceTarget(
      "conversations",
      "agents",
      agentTarget,
      null,
    )).toBeNull();
  });
});
