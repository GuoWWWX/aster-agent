import { beforeEach, describe, expect, it } from "vitest";

import { useWorkbenchUiStore } from "./workbench-ui-store.js";

describe("workbench prompt workspace", () => {
  beforeEach(() => {
    useWorkbenchUiStore.setState({
      agentPromptWorkspaceTarget: null,
      configurationWorkspaceTarget: null,
      isFilePanelOpen: false,
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
      isFilePanelOpen: true,
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
      isFilePanelOpen: true,
    });
  });
});
