import { useEffect, useRef, useState, type ReactElement } from "react";
import { AppWindow, MonitorCog, Plus, ShieldCheck, ShieldOff, Square, Trash2 } from "lucide-react";
import { computerUseConfigurationSchema, DEFAULT_COMPUTER_USE_CONFIGURATION, type ComputerApplicationIcons, type ComputerUseConfiguration, type ComputerUseStatus } from "@agent/protocol";
import { LoadingState } from "../../components/ui/loading.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import { SettingsConfigurationGroup } from "./components/settings-configuration-card.js";
import { SettingsSectionHeader } from "./components/settings-section-header.js";
import { useQueuedAutoSave } from "./use-queued-auto-save.js";
const errorMessage = (reason: unknown): string => getUserErrorMessage(reason, "电脑控制操作失败。");

export function ComputerUseSettings({ agentClient }: { agentClient: AgentClient }): ReactElement {
  const [draft, setDraft] = useState<ComputerUseConfiguration>(structuredClone(DEFAULT_COMPUTER_USE_CONFIGURATION));
  const [status, setStatus] = useState<ComputerUseStatus | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [icons, setIcons] = useState<ComputerApplicationIcons>({});
  const loadedIcons = useRef<string | null>(null);
  const baseline = useRef<ComputerUseConfiguration>(structuredClone(DEFAULT_COMPUTER_USE_CONFIGURATION));
  const currentRevision = useRef(0);
  useEffect(() => {
    let disposed = false;
    void Promise.all([agentClient.getComputerUseConfiguration(), agentClient.getComputerUseStatus()]).then(([configuration, nextStatus]) => {
      if (disposed) return;
      baseline.current = configuration; setDraft(configuration); setStatus(nextStatus); setLoaded(true);
    }, (reason: unknown) => { if (!disposed) setError(errorMessage(reason)); });
    return () => { disposed = true; };
  }, [agentClient]);
  const save = useQueuedAutoSave({
    revision, value: draft,
    validate: (value) => { const parsed = computerUseConfigurationSchema.safeParse(value); return parsed.success ? parsed.data : null; },
    save: (value) => agentClient.saveComputerUseConfiguration(value, baseline.current.applications),
    onSaved: (value, savedRevision) => {
      if (savedRevision === currentRevision.current) { baseline.current = value; setDraft(value); }
      setStatus((value) => value === null ? value : { ...value, running: false, elevated: false });
    },
    onError: (reason) => setError(errorMessage(reason)),
  });
  useEffect(() => {
    if (!loaded || busy || (save.state !== "idle" && save.state !== "saved")) return undefined;
    let disposed = false;
    const timer = window.setInterval(() => {
      void Promise.all([agentClient.getComputerUseStatus(), agentClient.getComputerUseConfiguration()]).then(([value, configuration]) => {
        if (!disposed) { baseline.current = configuration; setStatus(value); setDraft(configuration); }
      }, (reason: unknown) => { if (!disposed) setError(errorMessage(reason)); });
    }, 3000);
    return () => { disposed = true; window.clearInterval(timer); };
  }, [agentClient, loaded, busy, save.state, revision]);
  const iconKey = [...draft.applications, ...draft.blockedApplications].map((value) => `${value.id}:${value.executablePath}`).join("|");
  useEffect(() => {
    if (!loaded || (save.state !== "idle" && save.state !== "saved") || loadedIcons.current === iconKey) return undefined;
    let disposed = false;
    void agentClient.getComputerUseApplicationIcons().then((value) => { if (!disposed) { setIcons(value); loadedIcons.current = iconKey; } }, (reason: unknown) => { if (!disposed) setError(errorMessage(reason)); });
    return () => { disposed = true; };
  }, [agentClient, loaded, iconKey, save.state]);
  const update = (value: ComputerUseConfiguration): void => { currentRevision.current++; setDraft(value); setRevision(currentRevision.current); setError(null); };
  const addApplication = async (list: "applications" | "blockedApplications"): Promise<void> => {
    setBusy(true); setError(null);
    try {
      const application = await agentClient.chooseComputerApplication();
      if (application === null) return;
      if (draft[list].some((value) => value.executablePath.toLowerCase() === application.executablePath.toLowerCase())) {
        setError(list === "applications" ? "该软件已经在永久授权列表中。" : "该软件已经在黑名单中。"); return;
      }
      update({ ...draft, [list]: [...draft[list], application] });
    } catch (reason) { setError(errorMessage(reason)); } finally { setBusy(false); }
  };
  const applicationList = (list: "applications" | "blockedApplications"): ReactElement => draft[list].length === 0
    ? <p className="m-0 px-[18px] pb-4 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{list === "applications" ? "尚未授权任何软件" : "黑名单为空"}</p>
    : <ul className="m-0 min-w-0 list-none border-t border-[var(--app-border)] p-0">{draft[list].map((application) => <li key={application.id} className="settings-general-row">
      <div className="flex min-w-0 items-center gap-3">
        {icons[application.id] ? <img src={icons[application.id] ?? undefined} alt="" className="size-8 shrink-0 object-contain" /> : <AppWindow aria-hidden="true" size={32} className="shrink-0 text-[var(--app-muted-foreground)]" />}
        <div className="min-w-0"><h4 className="break-words">{application.name}</h4><p className="break-all">{application.executablePath}</p></div>
      </div>
      <div className="flex shrink-0 items-center gap-[5px]">
        <label className="settings-switch"><input type="checkbox" aria-label={`${list === "applications" ? "允许" : "禁止"}控制 ${application.name}`} checked={application.enabled} disabled={busy} onChange={(event) => update({ ...draft, [list]: draft[list].map((value) => value.id === application.id ? { ...value, enabled: event.target.checked } : value) })} /><span aria-hidden="true" /></label>
        <IconButton label={list === "applications" ? `移除 ${application.name} 的授权` : `从黑名单移除 ${application.name}`} disabled={busy} onClick={() => update({ ...draft, [list]: draft[list].filter((value) => value.id !== application.id) })}><Trash2 size={15} /></IconButton>
      </div>
    </li>)}</ul>;
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
        <div className="settings-general-row"><div><h4>启用电脑控制</h4><p>默认关闭；点击“启动控制”后，按软件授权规则操作。控制期间屏幕四角显示蓝色边框，正常使用鼠标和键盘不会退出，在任意软件中按 Esc 立即退出。</p></div>
          <label className="settings-switch"><input aria-label="启用电脑控制" type="checkbox" checked={draft.enabled} disabled={busy || status?.supported === false} onChange={(event) => update({ ...draft, enabled: event.target.checked })} /><span aria-hidden="true" /></label></div>
        <div className="settings-general-row"><div><h4>控制进程</h4><p aria-live="polite">{status?.supported === false ? "当前环境不支持，请在 Windows 桌面版使用。" : status?.running ? status.elevated ? "运行中 · 管理员权限" : "运行中 · 普通权限" : "未启动"}</p></div>
          <div className="flex shrink-0 gap-[5px]">
            <button className="settings-secondary-button" type="button" disabled={busy || !draft.enabled || status?.supported === false || status?.running} onClick={() => void control(true)}>{busy ? "处理中…" : "启动控制"}</button>
            <IconButton label="停止电脑控制" disabled={busy || !status?.running} onClick={() => void control(false)}><Square size={15} /></IconButton>
          </div></div>
      </SettingsConfigurationGroup>
      <SettingsConfigurationGroup title="操作权限" icon={MonitorCog} cardClassName="p-0">
        <div className="settings-general-row"><div><h4>软件授权模式</h4><p>逐个授权时，首次访问软件会询问“仅本次允许”或“永久允许”。仅本次授权在停止控制后失效；黑名单在所有模式下均优先禁止访问。对话的操作审批仍按原设置执行。</p></div>
          <Select value={draft.accessMode} disabled={busy || status?.supported === false} onValueChange={(value) => { if (value === "ask" || value === "all") update({ ...draft, accessMode: value }); }}>
            <SelectTrigger aria-label="软件授权模式" className="settings-general-select w-[170px] max-w-full"><SelectValue /></SelectTrigger>
            <SelectContent align="end"><SelectItem value="ask">逐个软件授权</SelectItem><SelectItem value="all">允许所有软件</SelectItem></SelectContent>
          </Select></div>
        <div className="settings-general-row"><div><h4 id="computer-applications">永久授权</h4><p>首次访问时选择“永久允许”的软件会显示在这里，也可手动添加。逐个授权模式下，关闭后会重新询问；禁止访问请加入黑名单。</p></div>
          <button className="settings-secondary-button shrink-0" type="button" disabled={busy || status?.supported === false || draft.applications.length >= 100} onClick={() => void addApplication("applications")}><Plus size={15} aria-hidden="true" />添加软件</button></div>
        {applicationList("applications")}
      </SettingsConfigurationGroup>
      <SettingsConfigurationGroup title="黑名单" icon={ShieldOff} cardClassName="p-0">
        <div className="settings-general-row"><div><h4>禁止控制的软件</h4><p>即使开启“允许所有软件”或曾经授权，黑名单中的软件也不能被查看或操作。</p></div>
          <button className="settings-secondary-button shrink-0" type="button" disabled={busy || status?.supported === false || draft.blockedApplications.length >= 100} onClick={() => void addApplication("blockedApplications")}><Plus size={15} aria-hidden="true" />添加黑名单</button></div>
        {applicationList("blockedApplications")}
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
