import { KeyRound } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import type { AccountProvider, ProviderAccountRequest, ProviderAccountResponse, AccountConnection, ModelRuntimeStatus } from "@agent/protocol";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog.js";
import type { AgentClient } from "../../../runtime/index.js";
import { errorMessage } from "../configuration-state.js";
import { SettingsConfigurationGroup } from "../components/settings-configuration-card.js";

const WELCOME_KEY = "aster.chatgpt-plan-welcome-shown";

function welcomeShown(): boolean {
  try { return window.localStorage.getItem(WELCOME_KEY) === "true"; } catch { return false; }
}

function ProviderAccountPanel({ agentClient, onModelsChanged, provider }: {
  provider: AccountProvider;
  agentClient: AgentClient;
  onModelsChanged: (status: ModelRuntimeStatus, providerId: string) => void;
}): ReactElement | null {
  const [connections, setConnections] = useState<AccountConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const available = agentClient.providerAccounts !== undefined;
  async function request(input: ProviderAccountRequest): Promise<ProviderAccountResponse> {
    if (agentClient.providerAccounts === undefined) throw new Error("账号服务不可用。");
    return agentClient.providerAccounts(input);
  }

  useEffect(() => {
    let cancelled = false;
    if (agentClient.providerAccounts !== undefined) {
      void agentClient.providerAccounts({ action: "list", kind: provider.kind }).then((result) => {
        if (!cancelled && result.action === "list") setConnections(result.connections);
      }).catch((reason: unknown) => { if (!cancelled) setMessage(errorMessage(reason)); });
    }
    return () => { cancelled = true; };
  }, [agentClient, provider.kind]);

  if (!available) return null;

  async function refresh(): Promise<void> {
    const result = await request({ action: "list", kind: provider.kind });
    if (result.action === "list") setConnections(result.connections);
  }

  async function sync(providerId: string): Promise<void> {
    const result = await request({ action: "sync", kind: provider.kind, providerId });
    if (result.action === "sync") onModelsChanged(result.status, providerId);
  }

  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setMessage(null);
    try { await action(); } catch (reason) { setMessage(errorMessage(reason)); }
    finally { await refresh().catch(() => undefined); setBusy(false); }
  }

  async function connect(providerId?: string): Promise<void> {
    const connection = await request({ action: "connect", kind: provider.kind, ...(providerId === undefined ? {} : { providerId }) });
    if (connection.action !== "connect") throw new Error("登录结果无效，请重试。");
    await refresh();
    if (!connection.authorized) {
      setMessage("已登录，请完成使用授权。");
      return;
    }
    if (provider.kind === "chatgpt" && !welcomeShown()) setWelcomeOpen(true);
    await sync(connection.providerId);
  }

  function dismissWelcome(): void {
    setWelcomeOpen(false);
    try { window.localStorage.setItem(WELCOME_KEY, "true"); } catch { /* The current session can continue. */ }
  }

  return (
    <SettingsConfigurationGroup icon={KeyRound} title={`${provider.name} 账号`}>
      <div className="grid min-w-0 gap-3 text-[length:var(--app-font-size-control)]">
        <div className="flex flex-wrap items-center gap-2">
          <button className="settings-secondary-button" data-oai-siwc-button={provider.kind === "chatgpt" ? "" : undefined} disabled={busy} type="button" onClick={() => void perform(() => connect())}>
            {provider.signInLabel}
          </button>
          {provider.usageUrl === null ? null : <a className="text-[var(--app-accent)] underline" href={provider.usageUrl} rel="noreferrer" target="_blank">管理用量</a>}
        </div>
        {connections.map((connection) => (
          <div key={connection.providerId} className="flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--app-border)] pt-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{connection.label}{connection.email === null ? "" : ` · ${connection.email}`}</div>
              <div className="text-[var(--app-muted-foreground)]">{connection.connected ? "已连接" : connection.signedIn ? "待授权" : "未连接"}</div>
            </div>
            <button className="settings-secondary-button" disabled={busy} type="button" onClick={() => void perform(() => connect(connection.providerId))}>
              {connection.connected ? "重新授权" : connection.signedIn ? "启用套餐" : "登录"}
            </button>
            {connection.connected ? <button className="settings-secondary-button" disabled={busy} type="button" onClick={() => void perform(() => sync(connection.providerId))}>同步模型</button> : null}
            {connection.signedIn ? (
              <button className="settings-secondary-button" disabled={busy} type="button" onClick={() => void perform(async () => {
                const result = await request({ action: "disconnect", kind: provider.kind, providerId: connection.providerId });
                if (result.action === "disconnect" && !result.revoked) setMessage("已断开，请在账号设置中确认撤销授权。");
              })}>断开</button>
            ) : null}
          </div>
        ))}
        {busy ? <p role="status">正在处理…</p> : null}
        {message === null ? null : <p className="text-[var(--app-destructive)]" role="alert">{message}</p>}
      </div>
      <Dialog open={welcomeOpen} onOpenChange={(open) => { if (!open) dismissWelcome(); }}>
        <DialogContent className="gap-4 border border-[var(--app-border)] p-4">
          <DialogHeader>
            <DialogTitle>正在使用 ChatGPT 套餐</DialogTitle>
            <DialogDescription>此应用中的合格模型请求将使用你的 ChatGPT 套餐或可用额度。你可以在 ChatGPT 设置中查看和管理用量。</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <a className="settings-secondary-button" href="https://chatgpt.com/settings/usage" rel="noreferrer" target="_blank" onClick={(event) => {
              event.preventDefault();
              window.open("https://chatgpt.com/settings/usage", "_blank", "noopener,noreferrer");
            }}>管理用量</a>
            <button className="settings-secondary-button" type="button" onClick={dismissWelcome}>知道了</button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsConfigurationGroup>
  );
}

export function ProviderAccountsPanel(props: {
  agentClient: AgentClient;
  onModelsChanged: (status: ModelRuntimeStatus, providerId: string) => void;
}): ReactElement | null {
  const [providers, setProviders] = useState<AccountProvider[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (props.agentClient.providerAccounts !== undefined) {
      void props.agentClient.providerAccounts({ action: "providers" }).then((result) => {
        if (!cancelled && result.action === "providers") setProviders(result.providers);
      }).catch((reason: unknown) => { if (!cancelled) setError(errorMessage(reason)); });
    }
    return () => { cancelled = true; };
  }, [props.agentClient]);
  if (error !== null) return <p role="alert">{error}</p>;
  return <>{providers.map((provider) => <ProviderAccountPanel key={provider.kind} {...props} provider={provider} />)}</>;
}
