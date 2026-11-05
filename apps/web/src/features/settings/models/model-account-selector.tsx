import { useEffect, useState, type ReactElement } from "react";
import type { AccountConnection, ModelRuntimeStatus } from "@agent/protocol";
import type { AgentClient } from "../../../runtime/index.js";
import { useWorkbenchUiStore } from "../../../stores/workbench-ui-store.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select.js";
import { errorMessage } from "../configuration-state.js";

type Account = AccountConnection & { kind: string; providerName: string };

export function ModelAccountSelector({ agentClient, selectedProviderId, onModelsChanged }: {
  agentClient: AgentClient;
  selectedProviderId: string | null;
  onModelsChanged: (status: ModelRuntimeStatus, providerId: string) => void;
}): ReactElement {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    async function load(): Promise<void> {
      if (agentClient.providerAccounts === undefined) return;
      const result = await agentClient.providerAccounts({ action: "providers" });
      if (result.action !== "providers") return;
      const groups = await Promise.all(result.providers.map(async (provider) => {
        const list = await agentClient.providerAccounts!({ action: "list", kind: provider.kind });
        return list.action === "list" ? list.connections.filter((account) => account.connected)
          .map((account) => ({ ...account, kind: provider.kind, providerName: provider.name })) : [];
      }));
      if (!cancelled) setAccounts(groups.flat());
    }
    void load().catch((reason: unknown) => { if (!cancelled) setError(errorMessage(reason)); });
    return () => { cancelled = true; };
  }, [agentClient]);

  async function select(providerId: string): Promise<void> {
    const account = accounts.find((item) => item.providerId === providerId);
    if (account === undefined || agentClient.providerAccounts === undefined) return;
    setBusy(true); setError(null);
    try {
      const result = await agentClient.providerAccounts({ action: "sync", kind: account.kind, providerId });
      if (result.action === "sync") onModelsChanged(result.status, providerId);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  return (
    <div className="grid min-w-0 gap-[5px]">
      <div className="flex min-w-0 items-center gap-[5px]">
        <Select disabled={busy || accounts.length === 0} value={accounts.some((account) => account.providerId === selectedProviderId) ? selectedProviderId! : ""} onValueChange={(id) => void select(id)}>
          <SelectTrigger aria-label="授权账号" className="settings-select-trigger min-w-0 flex-1"><SelectValue placeholder="选择已授权账号" /></SelectTrigger>
          <SelectContent>{accounts.map((account) => <SelectItem key={account.providerId} value={account.providerId}>{account.providerName} · {account.email ?? account.label}</SelectItem>)}</SelectContent>
        </Select>
        <button className="settings-secondary-button" type="button" onClick={() => useWorkbenchUiStore.getState().setSettingsSection("accounts")}>账号管理</button>
      </div>
      {busy ? <span role="status">正在同步模型…</span> : null}
      {error === null ? null : <p role="alert" className="text-[var(--app-destructive)]">{error}</p>}
    </div>
  );
}
