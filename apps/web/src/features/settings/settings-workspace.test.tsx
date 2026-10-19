// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mcpServerConfigurationSchema, saveModelConfigurationInputSchema } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useApplicationSettingsStore } from "../../stores/application-settings-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { SettingsWorkspace } from "./settings-workspace.js";

let root: Root | null = null;
const initialDirectory = useAgentDirectoryStore.getState();

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class {
    observe(): void {}
    disconnect(): void {}
  });
  useWorkbenchUiStore.setState({
    activeActivity: "settings",
    configurationWorkspaceRevision: 0,
    configurationWorkspaceTarget: null,
    isSettingsFilePanelOpen: false,
    settingsNavigationWidth: 240,
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
  it("shows system skills as read-only while retaining their preview and enablement", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "skills" });
    const client = new MockAgentClient();
    await client.createSkillDocument();
    const configuration = await client.getIntegrationConfiguration();
    await client.saveIntegrationConfiguration({ ...configuration, skills: configuration.skills.map(skill => ({ ...skill, origin: "system" })) });
    const container = await renderSettings(client);
    expect(container.textContent).toContain("系统技能 · 只读");
    expect(container.querySelector('section[aria-label="Skill 文档预览"]')?.textContent).toContain("Agent 应遵循");
    expect(container.querySelector('.settings-skill-fields [role="combobox"]')).toBeNull();
    expect([...container.querySelectorAll<HTMLInputElement>('.settings-skill-fields input')].every(input => input.readOnly)).toBe(true);
    expect(container.querySelector<HTMLInputElement>('input[aria-label="停用配置"]')).not.toBeNull();
    await act(async () => { clickButton(container, "查看文档"); await Promise.resolve(); });
    expect(useWorkbenchUiStore.getState().isSettingsFilePanelOpen).toBe(true);
  });

  it("deletes a provider through its directory row and resets the empty editor", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "models" });
    const client = new MockAgentClient();
    await client.saveModelConfiguration({ apiKey: "test-key", apiFormat: "openai-chat-completions", baseUrl: "https://example.test/v1", providerName: "Delete me", models: [{ contextWindow: 0, displayName: "Test", modelId: "test", reasoningOptions: [] }] });
    const container = await renderSettings(client);
    await act(async () => { clickButton(container, "删除供应商 Delete me"); await Promise.resolve(); });
    expect(await client.getModelStatus()).toMatchObject({ configured: false, models: [] });
    expect(container.querySelector<HTMLInputElement>('[name="providerName"]')?.value).toBe("");
    expect(container.textContent).toContain("共 0 家供应商");
  });

  it("deletes an unselected MCP row without changing the selected server", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "mcp" });
    const client = new MockAgentClient();
    const configuration = await client.getIntegrationConfiguration();
    await client.saveIntegrationConfiguration({ ...configuration, mcpServers: ["first", "second"].map((id) => mcpServerConfigurationSchema.parse({ id, name: id, transport: "stdio", command: "npx", args: [], enabled: true, env: {}, headers: {}, scope: "user", url: null })) });
    const container = await renderSettings(client);
    await act(async () => { clickButton(container, "删除 second"); await Promise.resolve(); });
    expect(container.querySelector('.settings-integration-list__item[data-active="true"]')?.textContent).toContain("first");
    expect(container.textContent).toContain("共 1 项");
  });

  it("asks before deleting a Skill package and closes its editor after confirmation", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "skills" });
    const client = new MockAgentClient();
    const document = await client.createSkillDocument();
    const remove = vi.spyOn(client, "deleteSkillDocument");
    const container = await renderSettings(client);
    const skill = (await client.getIntegrationConfiguration()).skills[0]!;
    useWorkbenchUiStore.getState().openConfigurationWorkspace({ configurationId: skill.id, kind: "skill", title: skill.name });
    act(() => clickButton(container, `删除 ${skill.name}`));
    expect(remove).not.toHaveBeenCalled();
    expect(document.entryPath).toContain("SKILL.md");
    expect(globalThis.document.querySelector('[role="dialog"]')?.textContent).toContain("所有文件");
    act(() => clickButton(globalThis.document.body, "取消"));
    expect(remove).not.toHaveBeenCalled();
    act(() => clickButton(container, `删除 ${skill.name}`));
    await act(async () => { clickButton(globalThis.document.body, "删除目录和文件"); await Promise.resolve(); });
    expect(remove).toHaveBeenCalledExactlyOnceWith({ entryPath: document.entryPath });
    expect((await client.getIntegrationConfiguration()).skills).toEqual([]);
    expect(useWorkbenchUiStore.getState().configurationWorkspaceTarget).toBeNull();
    expect(container.textContent).toContain("暂无 Skill");
  });
  it("does not restore a late password response after browser data is cleared", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "browser" });
    const client = new MockAgentClient();
    vi.spyOn(client, "getBrowserSavedPasswords").mockResolvedValue([{ origin: "https://example.test", username: "sample-user" }]);
    let resolvePassword: (value: string) => void = () => undefined;
    vi.spyOn(client, "revealBrowserPassword").mockReturnValue(new Promise((resolve) => { resolvePassword = resolve; }));
    const container = await renderSettings(client);
    act(() => clickButton(container, "查看 https://example.test 的密码"));
    await act(async () => { clickButton(container, "清除浏览数据"); await Promise.resolve(); });
    await act(async () => { resolvePassword("late-secret"); await Promise.resolve(); });
    expect(container.querySelector('[aria-label="https://example.test 的密码"]')).toBeNull();
    expect(container.textContent).toContain("还没有已保存的密码");
  });
  it("displays the resolved default download directory and reveals passwords only on request", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "browser" });
    const client = new MockAgentClient();
    vi.spyOn(client, "getBrowserDefaultDownloadDirectory").mockResolvedValue("E:\\Downloads");
    vi.spyOn(client, "getBrowserSavedPasswords").mockResolvedValue([{ origin: "https://example.test", username: "sample-user" }]);
    const reveal = vi.spyOn(client, "revealBrowserPassword").mockResolvedValue("sample-secret");
    const container = await renderSettings(client);
    expect(container.textContent).toContain("E:\\Downloads");
    expect(container.textContent).toContain("sample-user");
    expect(reveal).not.toHaveBeenCalled();
    const field = (): HTMLInputElement | null => container.querySelector('[aria-label="https://example.test 的密码"]');
    expect(field()?.type).toBe("password");
    expect(field()?.value).not.toBe("sample-secret");
    await act(async () => { clickButton(container, "查看 https://example.test 的密码"); await Promise.resolve(); });
    expect(reveal).toHaveBeenCalledExactlyOnceWith({ origin: "https://example.test" });
    expect(field()?.type).toBe("text");
    expect(field()?.value).toBe("sample-secret");
    act(() => clickButton(container, "隐藏 https://example.test 的密码"));
    expect(field()?.type).toBe("password");
    expect(field()?.value).not.toBe("sample-secret");
    await act(async () => { clickButton(container, "清除浏览数据"); await Promise.resolve(); });
    expect(container.textContent).toContain("还没有已保存的密码");
    expect(field()).toBeNull();
  });
  it("saves the selected download directory and password preference, and keeps defaults when selection is cancelled", async () => {
    vi.useFakeTimers();
    try {
      useWorkbenchUiStore.setState({ settingsSection: "browser" });
      const client = new MockAgentClient();
      const choose = vi.spyOn(client, "chooseBrowserDownloadDirectory").mockResolvedValue("D:\\Downloads");
      const save = vi.spyOn(client, "saveBrowserConfiguration");
      const container = await renderSettings(client);
      const password = container.querySelector<HTMLInputElement>('[aria-label="保存并自动填充密码"]');
      expect(password?.checked).toBe(true);
      await act(async () => { clickButton(container, "选择目录"); await Promise.resolve(); });
      act(() => password?.click());
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ downloadDirectory: "D:\\Downloads", savePasswords: false }));
      act(() => clickButton(container, "恢复默认"));
      await act(async () => { await vi.advanceTimersByTimeAsync(500); });
      expect(save).toHaveBeenLastCalledWith(expect.objectContaining({ downloadDirectory: "", savePasswords: false }));
      choose.mockResolvedValue(null);
      await act(async () => { clickButton(container, "选择目录"); await Promise.resolve(); });
      expect(container.textContent).toContain("C:\\Users\\demo\\Downloads");
    } finally { vi.useRealTimers(); }
  });
  it("resets only typography while preserving the chosen theme and panel widths", async () => {
    useWorkbenchUiStore.setState({
      settingsSection: "appearance", themeMode: "dark", uiFontSize: 16,
      chatFontSize: 18, codeFontSize: 15, settingsNavigationWidth: 310,
    });
    const container = await renderSettings(new MockAgentClient());
    expect(container.querySelector('[aria-label="界面字号"]')?.textContent).toContain("16 px");
    act(() => clickButton(container, "恢复默认字号"));
    expect(useWorkbenchUiStore.getState()).toMatchObject({
      uiFontSize: 13, chatFontSize: 13, codeFontSize: 11,
      themeMode: "dark", settingsNavigationWidth: 310,
    });
  });

  it("exposes existing tool policies and updates the selected policy through the settings control", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "permissions" });
    const container = await renderSettings(new MockAgentClient());
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="命令与终端权限"]');
    expect(trigger).not.toBeNull();
    expect(container.querySelectorAll('button[aria-label$="权限"]')).toHaveLength(6);
    const previous = useApplicationSettingsStore.getState().permissionPolicies["command-run"];
    const scrollIntoView = vi.fn();
    vi.stubGlobal("ResizeObserver", class { observe(): void {} disconnect(): void {} });
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    await act(async () => {
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await Promise.resolve();
    });
    const disabledOption = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((option) => option.textContent === "禁用");
    expect(disabledOption).toBeDefined();
    act(() => disabledOption?.click());
    expect(useApplicationSettingsStore.getState().permissionPolicies["command-run"]).toBe("unavailable");
    act(() => useApplicationSettingsStore.getState().setPermissionPolicy("command-run", previous));
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  });

  it("filters navigation without switching the open settings page", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "general" });
    const container = await renderSettings(new MockAgentClient());
    const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索设置"]');
    expect(search).not.toBeNull();
    function searchFor(value: string): void {
      act(() => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, value);
        search?.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
    searchFor("agent");
    expect([...container.querySelectorAll(".settings-navigation__item")].map((item) => item.textContent)).toEqual(["Agent 与团队"]);
    expect(useWorkbenchUiStore.getState().settingsSection).toBe("general");
    expect(container.querySelector(".settings-section__header h2")?.textContent).toBe("常规设置");
    searchFor("没有此分区");
    expect(container.querySelector('.settings-navigation [role="status"]')?.textContent).toBe("无匹配的设置");
    searchFor("");
    expect(container.querySelectorAll(".settings-navigation__item")).toHaveLength(12);
    expect(useWorkbenchUiStore.getState().settingsSection).toBe("general");
  });

  it("finds specific settings across sections and locates the clicked result after loading", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "general" });
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: scrollIntoView });
    try {
      const container = await renderSettings(new MockAgentClient());
      const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索设置"]');
      function searchFor(value: string): void {
        act(() => {
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, value);
          search?.dispatchEvent(new Event("input", { bubbles: true }));
        });
      }
      searchFor("下载目录");
      const result = container.querySelector<HTMLButtonElement>('[aria-label="浏览器：下载目录"]');
      expect(result).not.toBeNull();
      expect(useWorkbenchUiStore.getState().settingsSection).toBe("general");
      await act(async () => { result?.click(); await Promise.resolve(); });
      expect(useWorkbenchUiStore.getState().settingsSection).toBe("browser");
      expect(container.querySelector('[data-settings-search-highlight]')?.textContent).toContain("下载目录");
      expect(scrollIntoView).toHaveBeenCalled();
      searchFor("字号");
      expect(container.querySelector('[aria-label="外观：界面字号"]')).not.toBeNull();
      expect(container.querySelector('[aria-label="终端：字号"]')).not.toBeNull();
      searchFor("API KEY");
      expect(container.querySelector('[aria-label="模型配置：API Key"]')).not.toBeNull();
      searchFor("");
      expect(container.querySelectorAll(".settings-navigation__item")).toHaveLength(12);
    } finally {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    }
  });

  it("opens the Agent tab again when the same search result is clicked after changing tabs", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "general" });
    const container = await renderSettings(new MockAgentClient());
    const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索设置"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "Agent 角色");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const result = container.querySelector<HTMLButtonElement>('[aria-label="Agent 与团队：Agent 角色"]');
    await act(async () => { result?.click(); await Promise.resolve(); });
    expect(container.querySelector('[data-settings-search-highlight] [aria-label="角色"]')).not.toBeNull();
    const teamTab = container.querySelector<HTMLButtonElement>('[role="tab"]');
    act(() => teamTab?.click());
    expect(container.querySelector('[aria-label="角色"]')).toBeNull();
    await act(async () => { result?.click(); await Promise.resolve(); });
    expect(container.querySelector('[data-settings-search-highlight] [aria-label="角色"]')).not.toBeNull();
  });

  it("waits for a configuration to exist instead of creating one through search", async () => {
    useWorkbenchUiStore.setState({ settingsSection: "general" });
    const client = new MockAgentClient();
    await client.saveIntegrationConfiguration({ mcpServers: [], skillDirectories: [], skills: [], version: 1 });
    const save = vi.spyOn(client, "saveIntegrationConfiguration");
    const container = await renderSettings(client);
    const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索设置"]');
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(search, "MCP 环境变量");
      search?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => { clickButton(container, "MCP：环境变量"); await Promise.resolve(); });
    expect(useWorkbenchUiStore.getState().settingsSection).toBe("mcp");
    expect(save).not.toHaveBeenCalled();
    expect(container.querySelector('.settings-content [role="status"]')?.textContent).toContain("选择或创建");
    await act(async () => { clickButton(container, "添加 MCP Server"); await Promise.resolve(); });
    expect(container.querySelector('[data-settings-search-highlight]')?.getAttribute("data-config-path")).toBe("env");
  });

  it.each([
    ["200500", 200500],
    ["200.5K", 200500],
    ["200.5k", 200500],
    ["1.5M", 1500000],
    ["1.5m", 1500000],
  ])("accepts context window %s and saves integer Token counts", async (value, tokens) => {
    const client = new MockAgentClient();
    await client.saveModelConfiguration(saveModelConfigurationInputSchema.parse({
      apiKey: "example-key", apiFormat: "openai-responses", baseUrl: "https://example.com/v1",
      providerName: "Example", models: [{ modelId: "example-model", displayName: "Example model", contextWindow: 128000, reasoningOptions: [] }],
    }));
    const save = vi.spyOn(client, "saveModelConfiguration");
    useWorkbenchUiStore.setState({ settingsSection: "models" });
    const container = await renderSettings(client);
    const input = container.querySelector<HTMLInputElement>('input[aria-label="example-model的上下文窗口"]');
    expect(input?.value).toBe("128K");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await vi.waitFor(() => expect(save).toHaveBeenCalled(), { timeout: 2000 });
    });
    expect(save.mock.calls.at(-1)?.[0].models[0]?.contextWindow).toBe(tokens);
  });

  it("keeps model connection status and actions in the collapsed title", async () => {
    const client = new MockAgentClient();
    await client.saveModelConfiguration(saveModelConfigurationInputSchema.parse({
      apiKey: "example-key", apiFormat: "openai-responses", baseUrl: "https://example.com/v1",
      providerName: "Example", models: [{ modelId: "example-model", displayName: "Example model", contextWindow: 128000, reasoningOptions: [] }],
    }));
    useWorkbenchUiStore.setState({ settingsSection: "models" });
    const container = await renderSettings(client);
    const disclosure = container.querySelector<HTMLDetailsElement>(".settings-model-disclosure");
    const summary = disclosure?.querySelector("summary");
    expect(disclosure?.open).toBe(false);
    expect(summary?.querySelector(".settings-model-connection-status")).not.toBeNull();
    expect(summary?.querySelector('[aria-label="测试 Example model"]')).not.toBeNull();
    expect(summary?.querySelector('[aria-label="删除 Example model"]')).not.toBeNull();
    act(() => summary?.querySelector<HTMLButtonElement>('[aria-label="测试 Example model"]')?.click());
    expect(disclosure?.open).toBe(false);
  });

  it("resizes only the settings menu and resets it to its default width", async () => {
    const container = await renderSettings(new MockAgentClient());
    const divider = container.querySelector<HTMLElement>('[aria-label="调整设置菜单宽度"]');
    expect(divider).not.toBeNull();
    const projectWidth = useWorkbenchUiStore.getState().projectNavigatorWidth;
    act(() => { divider?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true })); });
    expect(useWorkbenchUiStore.getState().settingsNavigationWidth).toBe(250);
    act(() => { divider?.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true })); });
    expect(useWorkbenchUiStore.getState().settingsNavigationWidth).toBe(360);
    act(() => { divider?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true })); });
    expect(useWorkbenchUiStore.getState().settingsNavigationWidth).toBe(240);
    expect(useWorkbenchUiStore.getState().projectNavigatorWidth).toBe(projectWidth);
  });

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
