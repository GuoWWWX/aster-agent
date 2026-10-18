import { useEffect, useState, type ReactElement } from "react";
import { MonitorCog, Plus, ShieldCheck, Square, Trash2 } from "lucide-react";
import { computerUseConfigurationSchema, DEFAULT_COMPUTER_USE_CONFIGURATION, type ComputerUseConfiguration, type ComputerUseStatus } from "@agent/protocol";
import { LoadingState } from "../../components/ui/loading.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import { SettingsConfigurationGroup } from "./settings-configuration-card.js";
import { SettingsSectionHeader } from "./settings-section-header.js";
import { useQueuedAutoSave } from "./use-queued-auto-save.js";
const errorMessage = (reason: unknown): string => getUserErrorMessage(reason, "电脑控制操作失败。");

export function ComputerUseSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const [draft, setDraft] = useState<ComputerUseConfiguration>(structuredClone(DEFAULT_COMPUTER_USE_CONFIGURATION));
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let disposed = false;
    void Promise.all([agentClient.getComputerUseConfiguration(), agentClient.getComputerUseStatus()]).then(([configuration, nextStatus]) => {
      if (disposed) return;
      setDraft(configuration); setStatus(nextStatus); setLoaded(true);
    }, (reason: unknown) => { if (!disposed) setError(errorMessage(reason)); });
    return () => { disposed = true; };
  }, [agentClient]);
  useEffect(() => {
    if (!loaded) return undefined;
    let disposed = false;
    const timer = window.setInterval(() => {
      void agentClient.getComputerUseStatus().then((value) => { if (!disposed) setStatus(value); }, (reason: unknown) => { if (!disposed) setError(errorMessage(reason)); });
    }, 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [agentClient, loaded]);
  const save = useQueuedAutoSave({
    revision, value: draft,
    validate: (value) => { const parsed = computerUseConfigurationSchema.safeParse(value); return parsed.success ? parsed.data : null; },
    save: (value) => agentClient.saveComputerUseConfiguration(value),
    onSaved: () => setStatus((value) => value === null ? value : { ...value, running: false, elevated: false }),
    onError: (reason) => setError(errorMessage(reason)),
  });
  const update = (value: ComputerUseConfiguration): void => { setDraft(value); setRevision((value) => value + 1); setError(null); };
  const addApplication = async (): Promise<void> => {
    setBusy(true); setError(null);
    try {
      const application = await agentClient.chooseComputerApplication();
      if (application === null) return;
      if (draft.applications.some((value) => value.executablePath.toLowerCase() === application.executablePath.toLowerCase())) {
        setError("该软件已经在授权列表中。"); return;
      }
      update({ ...draft, applications: [...draft.applications, application] });
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const control = async (start: boolean): Promise<void> => {
    setBusy(true); setError(null);
    try {
      if (!(await save.flush())) return;
      if (start) setStatus(await agentClient.startComputerUse());
      else { await agentClient.stopComputerUse(); setStatus(await agentClient.getComputerUseStatus()); }
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  if (!loaded && error === null) return <LoadingState label="加载电脑控制设置" />;
  return <SettingsSectionHeader title="电脑控制" eyebrow="Computer use · Windows 软件操作" bodyClassName="settings-section__body--general">
    {error !== null ? <p role="alert" className="break-words text-[var(--app-destructive)]">{error}</p> : null}
    {!loaded ? null : <>
      <SettingsConfigurationGroup title="电脑控制" icon={MonitorCog} cardClassName="p-0">
        <div className="settings-general-row"><div><h4>启用电脑控制</h4><p>默认关闭；添加允许操作的软件后，点击“启动控制”开始使用。控制期间屏幕四角显示蓝色边框，正常使用鼠标和键盘不会退出，在任意软件中按 Esc 立即退出。</p></div>
          <label className="settings-switch"><input aria-label="启用电脑控制" type="checkbox" checked={draft.enabled} disabled={busy || status?.supported === false} onChange={(event) => update({ ...draft, enabled: event.target.checked })} /><span aria-hidden="true" /></label></div>
        <div className="settings-general-row"><div><h4>控制进程</h4><p aria-live="polite">{status?.supported === false ? "当前环境不支持，请在 Windows 桌面版使用。" : status?.running ? status.elevated ? "运行中 · 管理员权限" : "运行中 · 普通权限" : "未启动"}</p></div>
          <div className="flex shrink-0 gap-[5px]">
            <button className="settings-secondary-button" type="button" disabled={busy || !draft.enabled || status?.supported === false || status?.running} onClick={() => void control(true)}>{busy ? "处理中…" : "启动控制"}</button>
            <IconButton label="停止电脑控制" disabled={busy || !status?.running} onClick={() => void control(false)}><Square size={15} /></IconButton>
          </div></div>
      </SettingsConfigurationGroup>
      <SettingsConfigurationGroup title="操作权限" icon={MonitorCog} cardClassName="p-0">
        <div className="settings-general-row"><div><h4 id="computer-applications">授权软件</h4><p>按软件的可执行文件授权。未列入或已关闭的软件不能被查看和操作。</p></div>
          <button className="settings-secondary-button shrink-0" type="button" disabled={busy || status?.supported === false || draft.applications.length >= 100} onClick={() => void addApplication()}><Plus size={15} aria-hidden="true" />添加软件</button></div>
        {draft.applications.length === 0 ? <p className="m-0 px-[18px] pb-4 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">尚未授权任何软件</p> : <ul className="m-0 min-w-0 list-none border-t border-[var(--app-border)] p-0">{draft.applications.map((application) => <li key={application.id} className="settings-general-row">
          <div className="min-w-0"><h4 className="break-words">{application.name}</h4><p className="break-all">{application.executablePath}</p></div>
          <div className="flex shrink-0 items-center gap-[5px]">
            <label className="settings-switch"><input type="checkbox" aria-label={`允许控制 ${application.name}`} checked={application.enabled} disabled={busy} onChange={(event) => update({ ...draft, applications: draft.applications.map((value) => value.id === application.id ? { ...value, enabled: event.target.checked } : value) })} /><span aria-hidden="true" /></label>
            <IconButton label={`移除 ${application.name} 的授权`} disabled={busy} onClick={() => update({ ...draft, applications: draft.applications.filter((value) => value.id !== application.id) })}><Trash2 size={15} /></IconButton>
          </div>
        </li>)}</ul>}
      </SettingsConfigurationGroup>
      <SettingsConfigurationGroup title="管理员权限" icon={ShieldCheck} cardClassName="p-0">
        <div className="settings-general-row"><div><h4>以管理员权限启动控制进程</h4><p>需要操作管理员窗口时开启，再点击“启动控制”并确认 Windows UAC。仅控制进程提权，关闭后不会保留管理员会话。</p></div>
          <label className="settings-switch"><input aria-label="管理员模式" type="checkbox" checked={draft.administrator} disabled={busy || status?.supported === false} onChange={(event) => update({ ...draft, administrator: event.target.checked })} /><span aria-hidden="true" /></label></div>
        <p className="px-[18px] pb-4 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">修改权限会停止控制进程。管理员模式不扩大软件授权范围，也不能操作 UAC 安全桌面。</p>
      </SettingsConfigurationGroup>
      <p aria-live="polite" className="m-0 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{save.state === "saving" || save.state === "pending" ? "正在保存…" : save.state === "saved" ? "已保存" : save.state === "failed" ? "保存失败" : "设置自动保存"}</p>
    </>}
  </SettingsSectionHeader>;
}
