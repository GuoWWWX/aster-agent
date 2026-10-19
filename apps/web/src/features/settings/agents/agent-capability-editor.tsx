import { Boxes, Layers3, RefreshCw, Sparkles, type LucideIcon } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import type { AgentCapabilityScope, AgentProfile, IntegrationConfiguration } from "@agent/protocol";

import { IconButton } from "../../../components/ui/icon-button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select.js";
import type { AgentClient } from "../../../runtime/index.js";
import { useWorkbenchUiStore } from "../../../stores/workbench-ui-store.js";
import { SettingsConfigurationGroup } from "../components/settings-configuration-card.js";
import { errorMessage } from "../configuration-state.js";

type CapabilityItem = { id: string; name: string; enabled: boolean; description: string; detail: string };
const SCOPE_LABELS = { user: "个人", team: "团队", project: "项目" } as const;

/** Only metadata is needed here; reading Skill documents would load every source file. */
function useCapabilityDirectory(agentClient: AgentClient, enabled: boolean) {
  const configurationRevision = useWorkbenchUiStore(state => state.configurationWorkspaceRevision);
  const [retryRevision, setRetryRevision] = useState(0);
  const [directory, setDirectory] = useState<{ configuration: IntegrationConfiguration; mcp: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let requestId = 0;
    function refresh(): void {
      const currentRequest = ++requestId;
      setLoading(true);
      setError(null);
      void Promise.all([agentClient.getIntegrationConfiguration(), agentClient.getCapabilities()]).then(
        ([configuration, capabilities]) => {
          if (active && currentRequest === requestId) setDirectory({ configuration, mcp: capabilities.mcp });
        },
        (reason: unknown) => {
          if (active && currentRequest === requestId) setError(errorMessage(reason));
        },
      ).finally(() => {
        if (active && currentRequest === requestId) setLoading(false);
      });
    }
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      active = false;
      window.removeEventListener("focus", refresh);
    };
  }, [agentClient, enabled, configurationRevision, retryRevision]);

  return { directory, error, loading, retry: () => setRetryRevision(value => value + 1) };
}

export function AgentCapabilityEditor({ agent, agentClient, onUpdate }: {
  agent: AgentProfile;
  agentClient: AgentClient;
  onUpdate: (patch: Partial<AgentProfile>) => void;
}): ReactElement {
  const state = useCapabilityDirectory(agentClient, agent.capabilityScope === "custom");
  const skills: CapabilityItem[] = (state.directory?.configuration.skills ?? []).map(skill => ({
    id: skill.id, name: skill.name, enabled: skill.enabled, description: skill.entryPath,
    detail: `${skill.origin === "system" ? "系统" : SCOPE_LABELS[skill.scope]}${skill.enabled ? "" : " · 已停用"}`,
  }));
  const mcpServers: CapabilityItem[] = (state.directory?.configuration.mcpServers ?? []).map(server => ({
    id: server.id, name: server.name, enabled: server.enabled, description: server.url ?? server.command ?? server.transport,
    detail: `${SCOPE_LABELS[server.scope]}${server.enabled ? "" : " · 已停用"}`,
  }));

  function toggleId(key: "mcpServerIds" | "skillIds", id: string): void {
    const current = agent[key];
    onUpdate({ [key]: current.includes(id) ? current.filter(candidate => candidate !== id) : [...current, id] });
  }

  return (
    <SettingsConfigurationGroup icon={Layers3} title="Skill 与 MCP">
      <div className="management-policy-section__heading justify-end">
        <Select value={agent.capabilityScope} onValueChange={value => onUpdate({ capabilityScope: value as AgentCapabilityScope })}>
          <SelectTrigger className="capability-scope-select"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit_all">继承全部</SelectItem>
            <SelectItem value="custom">自定义范围</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {agent.capabilityScope === "inherit_all" ? (
        <div className="capability-inherited-note">
          <Layers3 aria-hidden="true" size={15} />
          继承当前启用的 Skill、插件和 MCP 配置；实际可用性以运行时为准。
        </div>
      ) : (
        <>
          {state.loading ? <p className="m-0 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]" role="status">正在读取能力目录…</p> : null}
          {state.error === null ? null : (
            <div className="flex min-w-0 items-center gap-[5px]">
              <p className="settings-operation-error min-w-0" role="alert">{state.error}</p>
              <IconButton label="重新读取能力目录" size="compact" onClick={state.retry}><RefreshCw aria-hidden="true" size={14} /></IconButton>
            </div>
          )}
          {state.directory === null ? null : (
            <div className="capability-picker-grid">
              <CapabilityGroup icon={Sparkles} items={skills} kind="Skill" label="Skills" selectedIds={agent.skillIds} onToggle={id => toggleId("skillIds", id)} />
              <CapabilityGroup icon={Boxes} items={mcpServers} kind="MCP" label="MCP Servers" selectedIds={agent.mcpServerIds} onToggle={id => toggleId("mcpServerIds", id)} />
            </div>
          )}
          {state.directory === null ? null : (
            <p className="m-0 text-[length:var(--app-font-size-auxiliary)] leading-normal text-[var(--app-muted-foreground)]">
              {state.directory.mcp ? "能力还受启用状态和对话范围限制。" : "MCP 配置待接入运行时；此处仅保存选择。Skill 仍受启用状态和对话范围限制。"}
            </p>
          )}
        </>
      )}
    </SettingsConfigurationGroup>
  );
}

function CapabilityGroup({ icon: Icon, items, kind, label, onToggle, selectedIds }: {
  icon: LucideIcon;
  items: readonly CapabilityItem[];
  kind: string;
  label: string;
  onToggle: (id: string) => void;
  selectedIds: string[];
}): ReactElement {
  const knownIds = new Set(items.map(item => item.id));
  const visibleItems = [...items, ...selectedIds.filter(id => !knownIds.has(id)).map(id => ({
    id, name: `未登记的 ${kind}（${id}）`, enabled: false, description: "目录中未找到，取消勾选可移除此引用。", detail: "不可用",
  }))];
  return (
    <fieldset className="capability-group content-start">
      <legend><Icon aria-hidden="true" size={13} />{label}</legend>
      {visibleItems.length === 0 ? <span className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">暂无配置</span> : null}
      {visibleItems.map(item => (
        <label key={item.id} title={item.description}>
          <input checked={selectedIds.includes(item.id)} className="shrink-0" disabled={!item.enabled && !selectedIds.includes(item.id)} type="checkbox" onChange={() => onToggle(item.id)} />
          <span className="min-w-0 truncate">{item.name}</span>
          <small className="ml-auto shrink-0 text-[length:var(--app-font-size-caption)]">{item.detail}</small>
        </label>
      ))}
    </fieldset>
  );
}
