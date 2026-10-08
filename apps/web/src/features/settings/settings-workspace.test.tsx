// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  vi.restoreAllMocks();
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
    act(() => container.querySelector<HTMLButtonElement>('.settings-integration-list__item')?.click());
    expect(useWorkbenchUiStore.getState().isSettingsFilePanelOpen).toBe(false);
    await act(async () => {
      clickButton(container, "编辑配置文件");
      await Promise.resolve();
    });
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
    act(() => container.querySelector<HTMLButtonElement>('.settings-integration-list__item')?.click());
    expect(useWorkbenchUiStore.getState().isSettingsFilePanelOpen).toBe(false);
    await act(async () => {
      clickButton(container, "编辑文档");
      await Promise.resolve();
    });
    expect(useWorkbenchUiStore.getState()).toMatchObject({
      settingsSection: "skills", isSettingsFilePanelOpen: true,
      configurationWorkspaceTarget: { configurationId: skill.id, kind: "skill", title: skill.name },
    });
    expect(container.querySelector<HTMLInputElement>('input[readonly]')?.value).toBe(document.entryPath);
    await client.createSkillDocument();
    await act(async () => {
      useWorkbenchUiStore.getState().notifyConfigurationWorkspaceChanged();
      await Promise.resolve();
    });
    await act(async () => {
      container.querySelectorAll<HTMLButtonElement>('.settings-integration-list__item')[1]?.click();
      await Promise.resolve();
    });
    expect(useWorkbenchUiStore.getState().configurationWorkspaceTarget?.configurationId).toBe(skill.id);
    await act(async () => { clickButton(container, "编辑文档"); await Promise.resolve(); });
    expect(useWorkbenchUiStore.getState().configurationWorkspaceTarget).toMatchObject({
      configurationId: "new-skill-2", kind: "skill", title: "new-skill-2",
    });
  });

  it("waits for pending form changes before opening an MCP file", async () => {
    const client = new MockAgentClient();
    const server = mcpServerConfigurationSchema.parse({
      args: [], command: "npx", enabled: true, env: {}, headers: {}, id: "mcp-1",
      name: "Example MCP", scope: "user", transport: "stdio", url: null,
    });
    await client.saveIntegrationConfiguration({ mcpServers: [server], skillDirectories: [], skills: [], version: 1 });
    const saveConfiguration = client.saveIntegrationConfiguration.bind(client);
    let finishSave!: () => void;
    const saveGate = new Promise<void>((resolve) => { finishSave = resolve; });
    const save = vi.spyOn(client, "saveIntegrationConfiguration").mockImplementation(async (configuration) => {
      await saveGate;
      return saveConfiguration(configuration);
    });
    useWorkbenchUiStore.setState({ settingsSection: "mcp" });
    const container = await renderSettings(client);
    act(() => container.querySelector<HTMLInputElement>('input[aria-label="停用配置"]')?.click());
    await act(async () => {
      clickButton(container, "编辑配置文件");
      await Promise.resolve();
    });
    expect(save).toHaveBeenCalledOnce();
    expect(useWorkbenchUiStore.getState().configurationWorkspaceTarget).toBeNull();
    await act(async () => {
      finishSave();
      await saveGate;
    });
    expect(useWorkbenchUiStore.getState().configurationWorkspaceTarget?.configurationId).toBe(server.id);
    expect((await client.getIntegrationConfiguration()).mcpServers[0]?.enabled).toBe(false);
  });

  it("keeps the configuration save error visible instead of opening stale MCP content", async () => {
    const client = new MockAgentClient();
    const server = mcpServerConfigurationSchema.parse({
      args: [], command: "npx", enabled: true, env: {}, headers: {}, id: "mcp-1",
      name: "Example MCP", scope: "user", transport: "stdio", url: null,
    });
    await client.saveIntegrationConfiguration({ mcpServers: [server], skillDirectories: [], skills: [], version: 1 });
    vi.spyOn(client, "saveIntegrationConfiguration").mockRejectedValue(new Error("配置保存失败"));
    useWorkbenchUiStore.setState({ settingsSection: "mcp" });
    const container = await renderSettings(client);
    act(() => container.querySelector<HTMLInputElement>('input[aria-label="停用配置"]')?.click());
    await act(async () => {
      clickButton(container, "编辑配置文件");
      await Promise.resolve();
    });
    expect(useWorkbenchUiStore.getState().configurationWorkspaceTarget).toBeNull();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("配置保存失败");
  });

  it("keeps the team directory creation action available when no teams exist", async () => {
    useAgentDirectoryStore.setState({ teams: [] });
    useWorkbenchUiStore.setState({ settingsSection: "agents" });
    const container = await renderSettings(new MockAgentClient());
    act(() => clickButton(container, "创建团队"));
    expect(useAgentDirectoryStore.getState().teams).toHaveLength(1);
    expect(container.querySelector('.team-configuration-pane')).not.toBeNull();
  });

  it("previews the selected Skill body and refreshes it after a sidebar save", async () => {
    const client = new MockAgentClient();
    await client.createSkillDocument();
    await client.createSkillDocument();
    useWorkbenchUiStore.setState({ settingsSection: "skills" });
    const container = await renderSettings(client);
    const preview = () => container.querySelector('section[aria-label="Skill 文档预览"]');
    expect(preview()?.querySelector("h1")?.textContent).toBe("Instructions");
    expect(preview()?.textContent).toContain("在这里编写 Agent 应遵循的工作流程。");
    expect(preview()?.textContent).not.toContain("name: new-skill");
    await client.writeConfigurationWorkspaceFile({
      configurationId: "new-skill-2", kind: "skill", path: "SKILL.md",
      content: '---\nname: new-skill-2\ndescription: "代码审查流程"\n---\n\n# 审查步骤\n\n先阅读 **差异**。',
    });
    await act(async () => {
      useWorkbenchUiStore.getState().notifyConfigurationWorkspaceChanged();
      await Promise.resolve();
    });
    act(() => container.querySelectorAll<HTMLButtonElement>('.settings-integration-list__item')[1]?.click());
    expect(preview()?.querySelector("h1")?.textContent).toBe("审查步骤");
    expect(preview()?.querySelector("strong")?.textContent).toBe("差异");
    expect(preview()?.textContent).toContain("代码审查流程");
    expect(useWorkbenchUiStore.getState().isSettingsFilePanelOpen).toBe(false);
  });
});
