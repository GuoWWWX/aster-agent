// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mcpServerConfigurationSchema } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { SettingsWorkspace } from "./settings-workspace.js";

let root: Root | null = null;
const initialDirectory = useAgentDirectoryStore.getState();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useWorkbenchUiStore.setState({
    activeActivity: "settings",
    configurationWorkspaceRevision: 0,
    configurationWorkspaceTarget: null,
    isSettingsFilePanelOpen: false,
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  useAgentDirectoryStore.setState(initialDirectory);
});

async function renderSettings(client: MockAgentClient): Promise<HTMLDivElement> {
  const container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<TooltipProvider><SettingsWorkspace agentClient={client} /></TooltipProvider>);
    await Promise.resolve();
  });
  return container;
}

function clickButton(container: HTMLElement, label: string): void {
  const button = [...container.querySelectorAll("button")].find((candidate) => (
    candidate.getAttribute("aria-label") === label || candidate.textContent?.trim() === label
  ));
  expect(button, label).toBeDefined();
  button?.click();
}

describe("SettingsWorkspace", () => {
  it("opens the selected MCP in the sidebar and refreshes its form after a file save", async () => {
    const client = new MockAgentClient();
    const server = mcpServerConfigurationSchema.parse({
      args: [], command: "npx", enabled: true, env: {}, headers: {}, id: "mcp-1",
      name: "Example MCP", scope: "user", transport: "stdio", url: null,
    });
    await client.saveIntegrationConfiguration({ mcpServers: [server], skillDirectories: [], skills: [], version: 1 });
    useWorkbenchUiStore.setState({ settingsSection: "mcp" });
    const container = await renderSettings(client);
    act(() => clickButton(container, "编辑配置文件"));
    expect(useWorkbenchUiStore.getState()).toMatchObject({
      activeActivity: "settings", settingsSection: "mcp", isSettingsFilePanelOpen: true,
      configurationWorkspaceTarget: { configurationId: server.id, kind: "mcp", title: server.name },
    });
    await client.writeConfigurationWorkspaceFile({
      configurationId: server.id, kind: "mcp", path: "mcp.json",
      content: JSON.stringify({ ...server, name: "Updated MCP" }),
    });
    await act(async () => {
      useWorkbenchUiStore.getState().notifyConfigurationWorkspaceChanged();
      await Promise.resolve();
    });
    expect(container.querySelector<HTMLInputElement>('[data-config-path="name"] input')?.value).toBe("Updated MCP");
  });

  it("opens the selected Skill document in the sidebar without leaving Skill settings", async () => {
    const client = new MockAgentClient();
    const document = await client.createSkillDocument();
    const skill = (await client.getIntegrationConfiguration()).skills[0]!;
    useWorkbenchUiStore.setState({ settingsSection: "skills" });
    const container = await renderSettings(client);
    act(() => clickButton(container, "编辑文档"));
    expect(useWorkbenchUiStore.getState()).toMatchObject({
      settingsSection: "skills", isSettingsFilePanelOpen: true,
      configurationWorkspaceTarget: { configurationId: skill.id, kind: "skill", title: skill.name },
    });
    expect(container.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(document.entryPath);
  });

  it("keeps the team directory creation action available when no teams exist", async () => {
    useAgentDirectoryStore.setState({ teams: [] });
    useWorkbenchUiStore.setState({ settingsSection: "agents" });
    const container = await renderSettings(new MockAgentClient());
    act(() => clickButton(container, "创建团队"));
    expect(useAgentDirectoryStore.getState().teams).toHaveLength(1);
    expect(container.querySelector('.team-configuration-pane')).not.toBeNull();
  });
});
