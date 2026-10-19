import { Database, Globe2, PlugZap, Terminal } from "lucide-react";
import { SettingsSectionHeader } from "../components/settings-section-header.js";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { type McpServerConfiguration, mcpServerConfigurationListSchema } from "@agent/protocol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { type AgentClient } from "../../../runtime/index.js";
import { useWorkbenchUiStore } from "../../../stores/workbench-ui-store.js";
import {
  SettingsConfigurationCard,
  SettingsConfigurationGroup,
} from "../components/settings-configuration-card.js";
import {
  type ConfigurationEditorMode,
  ConfigurationModeSwitch,
  ConfigurationStatus,
  ConfigurationList,
  ConfigurationEmpty,
  ConfigurationEditorHeader,
  ConfigurationField,
  ScopeField,
  KeyValueEditor,
  ConfigurationEditorFooter,
  JsonConfigurationEditor,
} from "../integrations/configuration-editor.js";
import { useIntegrationConfiguration } from "../integrations/use-integration-configuration.js";
import { nextConfigurationId, configurationParseError } from "../configuration-state.js";

export function McpSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const state = useIntegrationConfiguration(agentClient);
  const [mode, setMode] = useState<ConfigurationEditorMode>("visual");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [json, setJson] = useState("[]");
  const appliedJsonRef = useRef<string | null>(null);
  const configurationWorkspaceRevision = useWorkbenchUiStore(
    (current) => current.configurationWorkspaceRevision,
  );
  const openConfigurationWorkspace = useWorkbenchUiStore(
    (current) => current.openConfigurationWorkspace,
  );
  const configuration = state.configuration;
  const reload = state.reload;
  const updateConfiguration = state.update;
  const setConfigurationError = state.setError;
  const servers = configuration?.mcpServers ?? [];
  const selected = servers.find((server) => server.id === selectedId) ?? servers[0] ?? null;

  function changeMode(nextMode: ConfigurationEditorMode): void {
    if (nextMode === mode) return;
    if (nextMode === "json" && configuration !== null) {
      const value = JSON.stringify(configuration.mcpServers, null, 2);
      appliedJsonRef.current = JSON.stringify(configuration.mcpServers);
      setJson(value);
    }
    if (nextMode === "visual" && !applyJson()) {
      return;
    }
    setConfigurationError(null);
    setMode(nextMode);
  }

  function updateServer(update: Partial<McpServerConfiguration>): void {
    if (configuration === null || selected === null) return;
    updateConfiguration({
      ...configuration,
      mcpServers: configuration.mcpServers.map((server) =>
        server.id === selected.id ? { ...server, ...update } : server,
      ),
    });
  }

  function addServer(): void {
    if (configuration === null) return;
    const id = nextConfigurationId("mcp", servers.map((server) => server.id));
    const server: McpServerConfiguration = {
      args: [],
      command: "npx",
      enabled: true,
      env: {},
      headers: {},
      id,
      name: "新 MCP Server",
      scope: "user",
      transport: "stdio",
      url: null,
    };
    updateConfiguration({ ...configuration, mcpServers: [...servers, server] });
    setSelectedId(id);
  }

  function applyJson(): boolean {
    if (configuration === null) return false;
    try {
      const parsed = mcpServerConfigurationListSchema.parse(JSON.parse(json));
      appliedJsonRef.current = JSON.stringify(parsed);
      updateConfiguration({ ...configuration, mcpServers: parsed });
      setSelectedId(parsed[0]?.id ?? null);
      setJson(JSON.stringify(parsed, null, 2));
      return true;
    } catch (reason) {
      setConfigurationError(configurationParseError(reason));
      return false;
    }
  }

  function deleteServer(id: string): void {
    if (configuration === null) return;
    const remaining = servers.filter((server) => server.id !== id);
    updateConfiguration({ ...configuration, mcpServers: remaining });
    if (selected?.id === id) setSelectedId(remaining[0]?.id ?? null);
    useWorkbenchUiStore.getState().closeConfigurationWorkspace({ configurationId: id, kind: "mcp" });
  }

  async function openFileWorkspace(): Promise<void> {
    if (selected === null) return;
    if (!await state.flush()) return;
    openConfigurationWorkspace({
      configurationId: selected.id,
      kind: "mcp",
      title: selected.name.trim() || selected.id,
    });
  }

  useEffect(() => {
    if (configurationWorkspaceRevision === 0) return;
    void reload().then((next) => {
      if (next === null) return;
      appliedJsonRef.current = JSON.stringify(next.mcpServers);
      setJson(JSON.stringify(next.mcpServers, null, 2));
      setSelectedId((current) => (
        next.mcpServers.some((server) => server.id === current)
          ? current
          : next.mcpServers[0]?.id ?? null
      ));
    });
  }, [configurationWorkspaceRevision, reload]);

  useEffect(() => {
    if (mode !== "json" || configuration === null) return undefined;
    const timer = window.setTimeout(() => {
      try {
        const parsed = mcpServerConfigurationListSchema.parse(JSON.parse(json));
        const serialized = JSON.stringify(parsed);
        if (serialized === appliedJsonRef.current) return;
        appliedJsonRef.current = serialized;
        updateConfiguration({ ...configuration, mcpServers: parsed });
        setSelectedId(parsed[0]?.id ?? null);
        setConfigurationError(null);
      } catch {
        // Keep the current visual configuration while the JSON draft is incomplete.
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [configuration, json, mode, setConfigurationError, setSelectedId, updateConfiguration]);

  return (
    <SettingsSectionHeader
      action={(
        <div className="settings-section-actions">
          <ConfigurationModeSwitch mode={mode} onChange={changeMode} />
        </div>
      )}
      bodyClassName="settings-section__body--flush"
      eyebrow="Tools · Resources · Prompts"
      title="MCP"
    >
      {mode === "json" ? (
        <JsonConfigurationEditor
          error={state.error}
          saveState={state.autoSaveState}
          label="MCP JSON 配置"
          value={json}
          onChange={(value) => {
            setJson(value);
            setConfigurationError(null);
          }}
          onCommit={applyJson}
        />
      ) : configuration === null ? (
        <ConfigurationStatus error={state.error} />
      ) : (
        <div className="settings-integration-manager settings-integration-manager--mcp">
          <ConfigurationList
            actionLabel="添加 MCP Server"
            emptyLabel="暂无 MCP Server"
            headingLabel="MCP Server"
            icon={PlugZap}
            items={servers.map((server) => ({
              enabled: server.enabled,
              id: server.id,
              name: server.name,
              summary: server.transport === "stdio" ? server.command ?? "stdio" : server.url ?? "HTTP",
            }))}
            selectedId={selected?.id ?? null}
            onAdd={addServer}
            onDelete={deleteServer}
            onSelect={setSelectedId}
          />
          {selected === null ? (
            <ConfigurationEmpty icon={PlugZap} label="添加 MCP Server" onAdd={addServer} />
          ) : (
            <section className="settings-integration-editor">
              <ConfigurationEditorHeader
                enabled={selected.enabled}
                fileActionLabel="编辑配置文件"
                icon={PlugZap}
                name={selected.name}
                onOpenFile={() => void openFileWorkspace()}
                onToggle={(enabled) => updateServer({ enabled })}
              />
              <SettingsConfigurationCard aria-label="MCP 基本配置">
                <div className="settings-field-grid">
                  <ConfigurationField configPath="name" label="名称">
                    <input value={selected.name} onChange={(event) => updateServer({ name: event.target.value })} />
                  </ConfigurationField>
                  <ConfigurationField configPath="id" label="ID">
                    <input value={selected.id} onChange={(event) => {
                      const id = event.target.value;
                      setSelectedId(id);
                      updateServer({ id });
                    }} />
                  </ConfigurationField>
                  <ConfigurationField configPath="transport" label="传输方式">
                    <Select value={selected.transport} onValueChange={(transport) => updateServer({
                      command: transport === "stdio" ? selected.command ?? "npx" : null,
                      transport: transport as McpServerConfiguration["transport"],
                      url: transport === "streamable-http" ? selected.url ?? "" : null,
                    })}>
                      <SelectTrigger className="settings-select-trigger"><SelectValue /></SelectTrigger>
                      <SelectContent align="start">
                        <SelectItem value="stdio">stdio</SelectItem>
                        <SelectItem value="streamable-http">Streamable HTTP</SelectItem>
                      </SelectContent>
                    </Select>
                  </ConfigurationField>
                  <ScopeField configPath="scope" scope={selected.scope} onChange={(scope) => updateServer({ scope })} />
                </div>
              </SettingsConfigurationCard>
              <SettingsConfigurationGroup icon={selected.transport === "stdio" ? Terminal : Globe2} title={selected.transport === "stdio" ? "启动参数" : "连接地址"}>
                <div className="settings-field-grid">
                  {selected.transport === "stdio" ? (
                    <ConfigurationField className="settings-field--wide" configPath="command" label="命令">
                      <input value={selected.command ?? ""} onChange={(event) => updateServer({ command: event.target.value })} />
                    </ConfigurationField>
                  ) : (
                    <ConfigurationField className="settings-field--wide" configPath="url" label="URL">
                      <input value={selected.url ?? ""} onChange={(event) => updateServer({ url: event.target.value })} />
                    </ConfigurationField>
                  )}
                  {selected.transport === "stdio" ? (
                    <ConfigurationField className="settings-field--wide" configPath="args" label="参数">
                      <textarea value={selected.args.join("\n")} onChange={(event) => updateServer({ args: event.target.value.split(/\r?\n/).filter(Boolean) })} />
                    </ConfigurationField>
                  ) : null}
                </div>
              </SettingsConfigurationGroup>
              <SettingsConfigurationGroup icon={Database} title={selected.transport === "stdio" ? "环境变量" : "请求头"}>
                {selected.transport === "stdio" ? (
                  <KeyValueEditor configPath="env" label="环境变量" value={selected.env} onChange={(env) => updateServer({ env })} />
                ) : (
                  <KeyValueEditor configPath="headers" label="请求头" value={selected.headers} onChange={(headers) => updateServer({ headers })} />
                )}
              </SettingsConfigurationGroup>
              <ConfigurationEditorFooter
                error={state.error}
                saveState={state.autoSaveState}
              />
            </section>
          )}
        </div>
      )}
    </SettingsSectionHeader>
  );
}
