import { KeyRound } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import type { ChatGptConnection, ModelRuntimeStatus } from "@agent/protocol";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../../../components/ui/dialog.js";
import type { AgentClient } from "../../../runtime/index.js";
import { errorMessage } from "../configuration-state.js";
import { SettingsConfigurationGroup } from "../components/settings-configuration-card.js";

const WELCOME_KEY = "aster.chatgpt-plan-welcome-shown";

function welcomeShown(): boolean {
  try { return window.localStorage.getItem(WELCOME_KEY) === "true"; } catch { return false; }
}

export function ChatGptProviderPanel({ agentClient, onModelsChanged }: {
  agentClient: AgentClient;
  onModelsChanged: (status: ModelRuntimeStatus, providerId: string) => void;
}): ReactElement | null {
  const [connections, setConnections] = useState<ChatGptConnection[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [welcomeOpen, setWelcomeOpen] = useState(false);
  const available = agentClient.listChatGptConnections !== undefined && agentClient.connectChatGpt !== undefined
    && agentClient.disconnectChatGpt !== undefined && agentClient.syncChatGptModels !== undefined;

  useEffect(() => {
    let cancelled = false;
    if (agentClient.listChatGptConnections !== undefined) {
      void agentClient.listChatGptConnections().then((items) => {
        if (!cancelled) setConnections(items);
      }).catch((reason: unknown) => { if (!cancelled) setMessage(errorMessage(reason)); });
    }
    return () => { cancelled = true; };
  }, [agentClient]);

  if (!available) return null;

  async function refresh(): Promise<void> {
    if (agentClient.listChatGptConnections !== undefined) setConnections(await agentClient.listChatGptConnections());
  }

  async function sync(providerId: string): Promise<void> {
    if (agentClient.syncChatGptModels === undefined) return;
    const status = await agentClient.syncChatGptModels(providerId);
    onModelsChanged(status, providerId);
  }

  async function perform(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setMessage(null);
    try { await action(); } catch (reason) { setMessage(errorMessage(reason)); }
    finally { await refresh().catch(() => undefined); setBusy(false); }
  }

  async function connect(providerId?: string): Promise<void> {
    if (agentClient.connectChatGpt === undefined) return;
    const connection = await agentClient.connectChatGpt(providerId);
    await refresh();
    if (!connection.planEnabled) {
      setMessage("已登录，但尚未授权使用 ChatGPT 套餐。可选择启用套餐或使用其他供应商。");
      return;
    }
    if (!welcomeShown()) setWelcomeOpen(true);
    await sync(connection.providerId);
  }

  function dismissWelcome(): void {
    setWelcomeOpen(false);
    try { window.localStorage.setItem(WELCOME_KEY, "true"); } catch { /* The current session can continue. */ }
  }

  return (
    <SettingsConfigurationGroup icon={KeyRound} title="ChatGPT 登录授权">
      <div className="grid min-w-0 gap-3 text-[length:var(--app-font-size-control)]">
        <p className="text-[var(--app-muted-foreground)]">使用符合条件的 ChatGPT 套餐调用模型。登录和授权在 OpenAI 页面完成。</p>
        <div className="flex flex-wrap items-center gap-2">
          <button className="settings-secondary-button" data-oai-siwc-button="" disabled={busy} type="button" onClick={() => void perform(() => connect())}>
            Continue with ChatGPT
          </button>
          <a className="text-[var(--app-accent)] underline" href="https://chatgpt.com/settings/usage" rel="noreferrer" target="_blank">管理用量</a>
        </div>
        {connections.map((connection) => (
          <div key={connection.providerId} className="flex min-w-0 flex-wrap items-center gap-2 border-t border-[var(--app-border)] pt-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{connection.label}{connection.email === null ? "" : ` · ${connection.email}`}</div>
              <div className="text-[var(--app-muted-foreground)]">{connection.connected ? "已授权使用 ChatGPT 套餐" : connection.signedIn ? "已登录，尚未授权使用 ChatGPT 套餐" : "未连接"}</div>
            </div>
            <button className="settings-secondary-button" disabled={busy} type="button" onClick={() => void perform(() => connect(connection.providerId))}>
              {connection.connected ? "重新授权" : connection.signedIn ? "启用套餐" : "登录"}
            </button>
            {connection.connected ? <button className="settings-secondary-button" disabled={busy} type="button" onClick={() => void perform(() => sync(connection.providerId))}>同步模型</button> : null}
            {connection.signedIn ? (
              <button className="settings-secondary-button" disabled={busy} type="button" onClick={() => void perform(async () => {
                const revoked = await agentClient.disconnectChatGpt?.(connection.providerId);
                if (revoked === false) setMessage("已在本机断开，但未能确认远端撤销；可在 ChatGPT 设置中断开应用。");
              })}>断开</button>
            ) : null}
          </div>
        ))}
        {busy ? <p role="status">正在处理，请在浏览器中完成授权。</p> : null}
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
