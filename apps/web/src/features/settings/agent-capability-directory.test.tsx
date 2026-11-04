// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type IntegrationConfiguration } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { SettingsWorkspace } from "./settings-workspace.js";

const configuration: IntegrationConfiguration = {
  version: 1, skillDirectories: [],
  mcpServers: [{ id: "real-mcp", name: "Actual MCP", enabled: true, scope: "user", transport: "stdio", command: "node", args: [], env: {}, headers: {}, url: null }],
  skills: [
    { id: "real-skill", name: "Actual skill", description: "User skill", origin: "personal", enabled: true, scope: "user", entryPath: "C:/skills/actual/SKILL.md", mcpDependencies: [], version: "1" },
    { id: "system-skill", name: "System skill", description: "Built-in", origin: "system", enabled: true, scope: "user", entryPath: "C:/system/SKILL.md", mcpDependencies: [], version: "1" },
    { id: "disabled-skill", name: "Disabled skill", description: "Disabled", enabled: false, scope: "project", entryPath: "C:/project/SKILL.md", mcpDependencies: [], version: "1" },
  ],
};
let root: Root | null = null;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  const agent = useAgentDirectoryStore.getState().agents[0]!;
  useAgentDirectoryStore.getState().updateAgent(agent.id, { capabilityScope: "custom", skillIds: [], mcpServerIds: [] });
  useWorkbenchUiStore.setState({ activeActivity: "settings", settingsSection: "agents", configurationWorkspaceRevision: 0 });
});
afterEach(() => {
  act(() => root?.unmount()); root = null;
  document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
});

async function render(client: MockAgentClient) {
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<TooltipProvider><SettingsWorkspace agentClient={client} /></TooltipProvider>); await Promise.resolve(); });
  await act(async () => {
    [...container.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(button => button.textContent?.includes("Agent"))!.click();
    for (let count = 0; count < 20; count++) await Promise.resolve();
  });
  return container;
}

async function settle(): Promise<void> {
  for (let count = 0; count < 20; count++) await Promise.resolve();
}

function checkbox(container: HTMLElement, label: string): HTMLInputElement | null {
  return [...container.querySelectorAll("label")].find(item => item.textContent?.includes(label))?.querySelector('input[type="checkbox"]') ?? null;
}

it("uses configured Skill and MCP identities instead of the example catalogs", async () => {
  const client = new MockAgentClient(); await client.saveIntegrationConfiguration(structuredClone(configuration));
  const saveIntegrations = vi.spyOn(client, "saveIntegrationConfiguration");
  const discover = vi.spyOn(client, "discoverSkillDocuments");
  const container = await render(client);
  expect(checkbox(container, "Actual skill")).not.toBeNull();
  expect(checkbox(container, "System skill")).not.toBeNull();
  expect(checkbox(container, "Actual MCP")).not.toBeNull();
  expect(checkbox(container, "代码审查")).toBeNull();
  expect(container.textContent).toContain("MCP 配置待接入运行时");
  act(() => { checkbox(container, "Actual skill")!.click(); checkbox(container, "Actual MCP")!.click(); });
  expect(useAgentDirectoryStore.getState().agents[0]).toMatchObject({ skillIds: ["real-skill"], mcpServerIds: ["real-mcp"] });
  expect(saveIntegrations).not.toHaveBeenCalled();
  expect(discover).not.toHaveBeenCalled();
});

it("retains disabled and missing selected references until the user removes them", async () => {
  const client = new MockAgentClient(); await client.saveIntegrationConfiguration(structuredClone(configuration));
  const agent = useAgentDirectoryStore.getState().agents[0]!;
  useAgentDirectoryStore.getState().updateAgent(agent.id, { skillIds: ["disabled-skill", "missing-skill"], mcpServerIds: ["missing-mcp"] });
  const container = await render(client);
  expect(checkbox(container, "Disabled skill")?.checked).toBe(true);
  expect(checkbox(container, "Disabled skill")?.disabled).toBe(false);
  expect(checkbox(container, "missing-skill")?.checked).toBe(true);
  expect(checkbox(container, "missing-mcp")?.checked).toBe(true);
  expect(useAgentDirectoryStore.getState().agents[0]?.skillIds).toEqual(["disabled-skill", "missing-skill"]);
  act(() => { checkbox(container, "Disabled skill")!.click(); checkbox(container, "missing-skill")!.click(); checkbox(container, "missing-mcp")!.click(); });
  expect(checkbox(container, "Disabled skill")?.disabled).toBe(true);
  expect(useAgentDirectoryStore.getState().agents[0]).toMatchObject({ skillIds: [], mcpServerIds: [] });
});

it("does not mark selected references missing before the first directory request succeeds", async () => {
  const client = new MockAgentClient(); const agent = useAgentDirectoryStore.getState().agents[0]!;
  useAgentDirectoryStore.getState().updateAgent(agent.id, { skillIds: ["real-skill", "missing-skill"] });
  let finish!: (value: IntegrationConfiguration) => void;
  vi.spyOn(client, "getIntegrationConfiguration").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const container = await render(client);
  expect(container.querySelector('[role="status"]')?.textContent).toContain("正在读取能力目录");
  expect(container.textContent).not.toContain("未登记");
  expect(useAgentDirectoryStore.getState().agents[0]?.skillIds).toEqual(["real-skill", "missing-skill"]);
  await act(async () => { finish(structuredClone(configuration)); await settle(); });
  expect(checkbox(container, "Actual skill")?.checked).toBe(true);
  expect(checkbox(container, "missing-skill")?.checked).toBe(true);
  expect(container.textContent).toContain("未登记的 Skill（missing-skill）");
});

it("shows a directory error without replacing saved selections and retries metadata only", async () => {
  const client = new MockAgentClient(); await client.saveIntegrationConfiguration(structuredClone(configuration));
  const agent = useAgentDirectoryStore.getState().agents[0]!;
  useAgentDirectoryStore.getState().updateAgent(agent.id, { skillIds: ["real-skill"] });
  const read = vi.spyOn(client, "getIntegrationConfiguration").mockRejectedValueOnce(new Error("Directory unavailable"));
  const container = await render(client);
  expect(container.querySelector('[role="alert"]')).not.toBeNull();
  expect(useAgentDirectoryStore.getState().agents[0]?.skillIds).toEqual(["real-skill"]);
  await act(async () => { container.querySelector<HTMLButtonElement>('button[aria-label="重新读取能力目录"]')!.click(); await settle(); });
  expect(read).toHaveBeenCalledTimes(2);
  expect(container.querySelector('[role="alert"]')).toBeNull();
  expect(checkbox(container, "Actual skill")?.checked).toBe(true);
});

it("uses the current Agent's selections when a directory request finishes after switching Agents", async () => {
  const client = new MockAgentClient();
  const store = useAgentDirectoryStore.getState(); const firstId = store.agents[0]!.id;
  const secondId = store.addAgent();
  store.updateAgent(secondId, { name: "Second capability owner", capabilityScope: "custom", skillIds: ["system-skill"], mcpServerIds: [] });
  let finish!: (value: IntegrationConfiguration) => void;
  const read = vi.spyOn(client, "getIntegrationConfiguration").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const container = await render(client);
  expect(container.querySelector('[role="status"]')?.textContent).toContain("正在读取能力目录");
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button.agent-directory-row")].find(button => button.textContent?.includes("Second capability owner"))!.click());
  await act(async () => { finish(structuredClone(configuration)); await settle(); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(checkbox(container, "System skill")?.checked).toBe(true);
  expect(checkbox(container, "Actual skill")?.checked).toBe(false);
  act(() => checkbox(container, "Actual skill")!.click());
  expect(useAgentDirectoryStore.getState().agents.find(agent => agent.id === firstId)?.skillIds).toEqual([]);
  expect(useAgentDirectoryStore.getState().agents.find(agent => agent.id === secondId)?.skillIds).toEqual(["system-skill", "real-skill"]);
});

it("refreshes metadata on focus and configuration changes and releases the focus listener on leave", async () => {
  const client = new MockAgentClient(); await client.saveIntegrationConfiguration(structuredClone(configuration));
  const read = vi.spyOn(client, "getIntegrationConfiguration");
  const container = await render(client);
  expect(read).toHaveBeenCalledTimes(1);
  await client.saveIntegrationConfiguration({ ...structuredClone(configuration), skills: [] });
  read.mockClear();
  await act(async () => { window.dispatchEvent(new Event("focus")); await settle(); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(checkbox(container, "Actual skill")).toBeNull();
  await client.saveIntegrationConfiguration(structuredClone(configuration));
  read.mockClear();
  await act(async () => { useWorkbenchUiStore.setState({ configurationWorkspaceRevision: 1 }); await settle(); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(checkbox(container, "Actual skill")).not.toBeNull();
  act(() => { root?.unmount(); root = null; });
  window.dispatchEvent(new Event("focus"));
  expect(read).toHaveBeenCalledTimes(1);
});

it("does not load the custom directory while the Agent inherits capabilities", async () => {
  const client = new MockAgentClient(); const agentId = useAgentDirectoryStore.getState().agents[0]!.id;
  useAgentDirectoryStore.getState().updateAgent(agentId, { capabilityScope: "inherit_all" });
  const read = vi.spyOn(client, "getIntegrationConfiguration");
  const container = await render(client);
  await act(async () => { window.dispatchEvent(new Event("focus")); await settle(); });
  expect(read).not.toHaveBeenCalled();
  expect(container.textContent).toContain("继承当前启用的 Skill");
  await act(async () => { useAgentDirectoryStore.getState().updateAgent(agentId, { capabilityScope: "custom" }); await settle(); });
  expect(read).toHaveBeenCalledTimes(1);
});
