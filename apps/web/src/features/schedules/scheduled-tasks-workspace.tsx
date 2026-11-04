import { Spinner } from "../../components/ui/loading.js";
import { CalendarClock, Clock3, FileText, Folder, History, Pause, Play, Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement, type FormEvent } from "react";
import type { ProjectSummary, SaveScheduledTaskInput, ScheduledTask } from "@agent/protocol";
import { IconButton } from "../../components/ui/icon-button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "../../components/ui/dialog.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";

const CONTROL = "h-8 min-w-0 w-full rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-2 text-[length:var(--app-font-size-body)]";
const BUTTON = "inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-3 text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)] disabled:opacity-50";
const DAYS = ["日", "一", "二", "三", "四", "五", "六"];
const dateLabel = (at: string | null): string => at === null ? "—" : new Date(at).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
export function recurrenceLabel(task: Pick<ScheduledTask, "recurrence">): string {
  const recurrence = task.recurrence;
  return recurrence.kind === "once" ? `单次 · ${dateLabel(recurrence.at)}` : recurrence.kind === "daily"
    ? `每天 · ${recurrence.time}` : `每周${recurrence.weekdays.map((day) => DAYS[day]).join("、")} · ${recurrence.time}`;
}
function newTask(): SaveScheduledTaskInput {
  return { name: "", prompt: "", projectId: null, agentId: null, permissionMode: "ask_before_changes", enabled: true,
    recurrence: { kind: "daily", time: "09:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } };
}
function taskInput(task: ScheduledTask): SaveScheduledTaskInput {
  const { id, name, prompt, projectId, agentId, permissionMode, enabled, recurrence } = task;
  return { id, name, prompt, projectId, agentId, permissionMode, enabled, recurrence };
}

export function ScheduledTasksWorkspace({ agentClient, projects, onOpenConversation }: {
  agentClient: AgentClient; projects: readonly ProjectSummary[];
  onOpenConversation: (id: string, projectId: string | null) => void;
}): ReactElement {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<SaveScheduledTaskInput | null>(null);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<ScheduledTask | null>(null);
  const revision = useRef(0);
  const agents = useAgentDirectoryStore((state) => state.agents);
  const selected = tasks.find((task) => task.id === selectedId) ?? null;
  const activeRun = selected?.executions.some((execution) => execution.status === "running") ?? false;
  const visible = tasks.filter((task) => `${task.name} ${task.prompt}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
  useEffect(() => {
    let alive = true;
    let inFlight = false;
    const refresh = async (): Promise<void> => {
      if (inFlight) return;
      inFlight = true;
      const requestedRevision = revision.current;
      try { const next = await agentClient.listScheduledTasks(); if (alive && requestedRevision === revision.current) { setTasks(next); setLoaded(true); } }
      catch (reason) { if (alive) setError(getUserErrorMessage(reason, "无法加载定时任务。")); }
      finally { inFlight = false; }
    };
    void refresh();
    void agentClient.getRuntimeInfo().then((info) => { if (alive) setDesktop(info.capabilities.mode === "desktop"); })
      .catch((reason) => { if (alive) setError(getUserErrorMessage(reason, "无法连接桌面服务。")); });
    const timer = setInterval(() => void refresh(), 10_000);
    return () => { alive = false; clearInterval(timer); };
  }, [agentClient]);
  async function perform(action: () => Promise<void>): Promise<void> {
    if (busy) return;
    revision.current++;
    setBusy(true); setError(null);
    try { await action(); } catch (reason) { setError(getUserErrorMessage(reason, "操作失败，请重试。")); } finally { revision.current++; setBusy(false); }
  }
  const create = (): void => { setSelectedId(null); setDraft(newTask()); setError(null); };
  const updateDraft = (changes: Partial<SaveScheduledTaskInput>): void => setDraft((current) => current === null ? current : { ...current, ...changes });
  function submit(event: FormEvent): void {
    event.preventDefault(); if (draft === null) return;
    if (draft.recurrence.kind === "weekly" && draft.recurrence.weekdays.length === 0) { setError("请选择至少一个执行日。"); return; }
    if (draft.enabled && draft.recurrence.kind === "once" && Date.parse(draft.recurrence.at) <= Date.now()) { setError("请选择未来的执行时间。"); return; }
    void perform(async () => {
      const saved = await agentClient.saveScheduledTask(draft);
      setTasks((current) => current.some((task) => task.id === saved.id) ? current.map((task) => task.id === saved.id ? saved : task) : [...current, saved]);
      setSelectedId(saved.id); setDraft(null);
    });
  }
  const statusLabel = { running: "执行中", completed: "已完成", failed: "失败", cancelled: "已取消" };
  return (
    <div data-feature="scheduled-tasks" className="flex min-h-0 min-w-0 flex-1 gap-[5px] bg-[var(--app-canvas)] @container/schedules">
      <aside className="flex w-[280px] shrink-0 flex-col overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] @max-[760px]/schedules:w-[220px]" aria-label="定时任务列表">
        <header className="flex h-[50px] shrink-0 items-center justify-between gap-2 border-b border-[var(--app-border)] px-3">
          <h1 className="flex min-w-0 items-center gap-2 text-[length:var(--app-font-size-title)] font-semibold"><CalendarClock size={17} />定时任务</h1>
          <IconButton label="新建定时任务" size="compact" disabled={busy} onClick={create}><Plus size={16} /></IconButton>
        </header>
        <div className="shrink-0 px-3 py-2"><label className="flex h-8 items-center gap-2 rounded-[var(--app-radius)] border border-[var(--app-border)] px-2"><Search size={14} className="shrink-0 text-[var(--app-muted-foreground)]" /><input aria-label="搜索定时任务" placeholder="搜索任务" className="min-w-0 w-full bg-transparent text-[length:var(--app-font-size-control)] outline-none" value={query} onChange={(event) => setQuery(event.target.value)} /></label></div>
        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          {visible.map((task) => <div key={task.id} className="group/directory relative" data-active={selectedId === task.id}><button type="button" aria-pressed={selectedId === task.id} disabled={busy}
            onClick={() => { setSelectedId(task.id); setDraft(null); setError(null); }}
            className={`mb-1 flex w-full min-w-0 flex-col gap-1 rounded-[var(--app-radius)] px-3 py-2 text-left hover:bg-[var(--app-hover)] ${selectedId === task.id ? "bg-[var(--app-selection)] text-[var(--app-selection-foreground)]" : ""}`}>
            <span className="flex w-full min-w-0 items-center gap-2"><Clock3 size={14} className="shrink-0" /><span className="truncate text-[length:var(--app-font-size-body)] font-medium">{task.name}</span></span>
            <span className="w-full truncate pl-[22px] text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">{task.executions[0]?.status === "running" ? "执行中" : task.enabled ? "已启用" : "已暂停"} · {recurrenceLabel(task)}</span>
          </button><span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 opacity-0 group-hover/directory:pointer-events-auto group-hover/directory:opacity-100 group-has-[:focus-visible]/directory:pointer-events-auto group-has-[:focus-visible]/directory:opacity-100"><IconButton label={`删除定时任务 ${task.name}`} variant="destructive" size="compact" className="bg-[var(--app-hover)] group-data-[active=true]/directory:bg-[var(--app-selection)]" disabled={busy || task.executions.some((execution) => execution.status === "running")} onClick={() => setDeleting(task)}><Trash2 size={14} /></IconButton></span></div>)}
          {loaded && visible.length === 0 ? <p className="px-3 py-6 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{query ? "没有匹配的任务" : "暂无定时任务"}</p> : null}
        </div>
        <footer className="flex h-[44px] shrink-0 items-center border-t border-[var(--app-border)] px-3 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">共 {tasks.length} 项</footer>
      </aside>
      <section className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)]" aria-label="定时任务详情">
        {error !== null ? <div role="alert" className="flex items-center justify-between gap-2 border-b border-[var(--app-border)] bg-[var(--app-status-danger-bg)] px-4 py-2 text-[length:var(--app-font-size-body)] text-[var(--app-status-danger-fg)]">{error}<IconButton label="关闭错误" onClick={() => setError(null)}><X size={14} /></IconButton></div> : null}
        {draft !== null ? <form onSubmit={submit} className="flex min-h-0 flex-1 flex-col">
          <header className="flex h-[50px] shrink-0 items-center justify-between gap-3 border-b border-[var(--app-border)] px-4">
            <h2 className="text-[length:var(--app-font-size-title)] font-semibold">{draft.id ? "编辑定时任务" : "新建定时任务"}</h2>
            <div className="flex gap-[5px]"><button type="button" className={BUTTON} disabled={busy} onClick={() => setDraft(null)}>取消</button><button type="submit" className={`${BUTTON} border-transparent bg-[var(--app-primary-action)]! text-[var(--app-primary-action-foreground)]`} disabled={busy}>{busy ? <><Spinner size={14} />保存中…</> : "保存"}</button></div>
          </header>
          <fieldset disabled={busy} className="min-h-0 flex-1 overflow-y-auto p-5">
            <div className="mx-auto grid w-full max-w-[720px] gap-5">
              <label className="grid gap-2 text-[length:var(--app-font-size-body)]">名称<input required maxLength={120} className={CONTROL} value={draft.name} placeholder="例如：每日项目巡检" onChange={(event) => updateDraft({ name: event.target.value })} /></label>
              <label className="grid gap-2 text-[length:var(--app-font-size-body)]">任务指令<textarea required maxLength={30000} className={`${CONTROL} h-auto min-h-[140px] resize-y py-2`} value={draft.prompt} placeholder="描述要完成的工作和结果要求" onChange={(event) => updateDraft({ prompt: event.target.value })} /></label>
              <div className="grid grid-cols-2 gap-4 @max-[760px]/schedules:grid-cols-1">
                <div className="grid gap-2"><label id="schedule-project-label">项目</label><Select value={draft.projectId ?? "none"} onValueChange={(value) => updateDraft({ projectId: value === "none" ? null : value })}><SelectTrigger aria-labelledby="schedule-project-label"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="none">临时对话</SelectItem>{projects.map((project) => <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>)}</SelectContent></Select></div>
                <div className="grid gap-2"><label id="schedule-agent-label">执行 Agent</label><Select value={draft.agentId ?? "default"} onValueChange={(value) => updateDraft({ agentId: value === "default" ? null : value })}><SelectTrigger aria-labelledby="schedule-agent-label"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="default">默认 Agent</SelectItem>{agents.filter((agent) => agent.enabled && !agent.isDefault).map((agent) => <SelectItem key={agent.id} value={agent.id}>{agent.name}</SelectItem>)}</SelectContent></Select></div>
              </div>
              <div className="grid gap-2"><label id="schedule-frequency-label">执行频率</label><Select value={draft.recurrence.kind} onValueChange={(kind) => {
                const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
                updateDraft({ recurrence: kind === "once" ? { kind: "once", at: new Date(Date.now() + 3600000).toISOString() } : kind === "weekly" ? { kind: "weekly", time: "09:00", timezone, weekdays: [1] } : { kind: "daily", time: "09:00", timezone } });
              }}><SelectTrigger aria-labelledby="schedule-frequency-label"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="once">单次</SelectItem><SelectItem value="daily">每天</SelectItem><SelectItem value="weekly">每周</SelectItem></SelectContent></Select></div>
              {draft.recurrence.kind === "once" ? <label className="grid gap-2">执行时间<input required type="datetime-local" className={CONTROL} value={(() => { const date = new Date(draft.recurrence.at); return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); })()} onChange={(event) => { if (event.target.value) updateDraft({ recurrence: { kind: "once", at: new Date(event.target.value).toISOString() } }); }} /></label> : <>
                <label className="grid gap-2">执行时间<input required type="time" className={CONTROL} value={draft.recurrence.time} onChange={(event) => { if (draft.recurrence.kind !== "once") updateDraft({ recurrence: { ...draft.recurrence, time: event.target.value } }); }} /></label>
                {draft.recurrence.kind === "weekly" ? <div className="grid gap-2"><span>每周</span><div className="flex flex-wrap gap-[5px]">{DAYS.map((day, index) => <button key={day} type="button" aria-label={`星期${day}`} aria-pressed={draft.recurrence.kind === "weekly" && draft.recurrence.weekdays.includes(index)} className={`${BUTTON} aria-pressed:bg-[var(--app-selection)]`} onClick={() => {
                  if (draft.recurrence.kind !== "weekly") return;
                  const days = draft.recurrence.weekdays;
                  updateDraft({ recurrence: { ...draft.recurrence, weekdays: days.includes(index) ? days.filter((value) => value !== index) : [...days, index].sort() } });
                }}>{day}</button>)}</div></div> : null}
                <p className="text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">时区：{draft.recurrence.timezone}</p>
              </>}
              <div className="grid gap-2"><label id="schedule-permission-label">工具权限</label><Select value={draft.permissionMode} onValueChange={(value) => updateDraft({ permissionMode: value === "read_only" ? "read_only" : value === "full_access" ? "full_access" : "ask_before_changes" })}><SelectTrigger aria-labelledby="schedule-permission-label"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="ask_before_changes">修改前询问</SelectItem><SelectItem value="read_only">只读</SelectItem><SelectItem value="full_access">完全访问</SelectItem></SelectContent></Select></div>
              <label className="flex items-center gap-2"><input type="checkbox" checked={draft.enabled} onChange={(event) => updateDraft({ enabled: event.target.checked })} />启用计划</label>
            </div>
          </fieldset>
        </form> : selected !== null ? <>
          <header className="flex min-h-[50px] shrink-0 flex-wrap items-center justify-between gap-2 border-b border-[var(--app-border)] px-4 py-2">
            <h2 className="min-w-0 truncate text-[length:var(--app-font-size-title)] font-semibold">{selected.name}</h2>
            <div className="flex gap-[5px]"><button className={BUTTON} disabled={busy || activeRun || !desktop} onClick={() => void perform(async () => { const task = await agentClient.runScheduledTask({ id: selected.id }); setTasks((items) => items.map((item) => item.id === task.id ? task : item)); })}><Play size={14} />立即执行</button>
              <IconButton label={selected.enabled ? "暂停计划" : "启用计划"} disabled={busy} onClick={() => void perform(async () => { const task = await agentClient.saveScheduledTask({ ...taskInput(selected), enabled: !selected.enabled }); setTasks((items) => items.map((item) => item.id === task.id ? task : item)); })}>{selected.enabled ? <Pause size={15} /> : <Play size={15} />}</IconButton>
              <button className={BUTTON} disabled={busy} onClick={() => setDraft(taskInput(selected))}>编辑</button></div>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-5"><div className="mx-auto grid max-w-[840px] gap-6">
            <dl className="grid grid-cols-2 gap-x-5 gap-y-4 text-[length:var(--app-font-size-body)] @max-[760px]/schedules:grid-cols-1">
              <div><dt className="mb-1 flex items-center gap-2 text-[var(--app-muted-foreground)]"><Folder size={14} />项目</dt><dd>{projects.find((project) => project.id === selected.projectId)?.name ?? (selected.projectId === null ? "临时对话" : "项目已移除")}</dd></div>
              <div><dt className="mb-1 text-[var(--app-muted-foreground)]">执行 Agent</dt><dd>{agents.find((agent) => agent.id === selected.agentId)?.name ?? (selected.agentId === null ? "默认 Agent" : "Agent 已移除")}</dd></div>
              <div><dt className="mb-1 text-[var(--app-muted-foreground)]">执行计划</dt><dd>{recurrenceLabel(selected)}{selected.recurrence.kind !== "once" ? ` · ${selected.recurrence.timezone}` : ""}</dd></div>
              <div><dt className="mb-1 text-[var(--app-muted-foreground)]">下次执行</dt><dd>{selected.enabled ? dateLabel(selected.nextRunAt) : "已暂停"}</dd></div>
            </dl>
            <section><h3 className="mb-3 flex items-center gap-2 font-medium"><FileText size={16} />任务指令</h3><p className="whitespace-pre-wrap break-words rounded-[var(--app-radius)] bg-[var(--app-panel-subtle)] p-4 text-[length:var(--app-font-size-body)] leading-6">{selected.prompt}</p></section>
            <section><h3 className="mb-3 flex items-center gap-2 font-medium"><History size={16} />执行记录<span className="text-[length:var(--app-font-size-control)] font-normal text-[var(--app-muted-foreground)]">最近 20 次</span></h3>
              {selected.executions.length === 0 ? <p className="text-[length:var(--app-font-size-body)] text-[var(--app-muted-foreground)]">尚未执行</p> : <ul className="divide-y divide-[var(--app-border)]">{selected.executions.map((execution) => <li key={execution.id} className="flex flex-wrap items-center gap-3 py-3 text-[length:var(--app-font-size-body)]"><span className={execution.status === "failed" ? "text-[var(--app-status-danger-fg)]" : ""}>{statusLabel[execution.status]}</span><time className="text-[var(--app-muted-foreground)]">{dateLabel(execution.startedAt)}</time>{execution.error ? <span className="min-w-0 break-words text-[var(--app-muted-foreground)]">{execution.error}</span> : null}{execution.conversationId ? <button className={`${BUTTON} ml-auto`} disabled={busy} onClick={() => void perform(async () => { const conversation = (await agentClient.listConversationHierarchy()).find((item) => item.id === execution.conversationId); if (conversation === undefined) throw new Error("结果对话已归档或删除。"); onOpenConversation(conversation.id, conversation.projectId); })}>查看对话</button> : null}</li>)}</ul>}
            </section>
          </div></div>
        </> : <div className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6"><div className="w-full max-w-[620px]">
          <div className="mb-8"><CalendarClock size={32} className="mb-4 text-[var(--app-muted-foreground)]" /><h2 className="mb-2 text-[length:var(--app-font-size-page-title)] font-semibold">安排任务</h2><p className="text-[length:var(--app-font-size-body)] text-[var(--app-muted-foreground)]">按计划执行重复工作，结果保存在对话中。</p></div>
          <div className="grid grid-cols-2 gap-[5px] @max-[760px]/schedules:grid-cols-1">{[{ name: "每日项目巡检", prompt: "检查项目近期变更、测试状态和待处理问题，汇总需要关注的事项。" }, { name: "每周工作回顾", prompt: "回顾本周项目进展，整理完成事项、遗留问题和下一步建议。" }].map((template) => <button key={template.name} onClick={() => { setSelectedId(null); setDraft({ ...newTask(), ...template, ...(template.name === "每周工作回顾" ? { recurrence: { kind: "weekly", weekdays: [5], time: "17:00", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } } : {}) }); }} className="rounded-[var(--app-radius)] border border-[var(--app-border)] p-4 text-left hover:bg-[var(--app-hover)]"><span className="mb-2 block text-[length:var(--app-font-size-body)] font-medium">{template.name}</span><span className="block text-[length:var(--app-font-size-control)] leading-5 text-[var(--app-muted-foreground)]">{template.prompt}</span></button>)}</div>
        </div></div>}
        <footer className="shrink-0 border-t border-[var(--app-border)] px-4 py-2 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{desktop ? "应用运行时执行；关闭期间跳过；任务未结束时不重复触发。" : "浏览器预览可配置任务，定时执行请使用桌面应用。"}</footer>
      </section>
      <Dialog open={deleting !== null} onOpenChange={(open) => { if (!open && !busy) setDeleting(null); }}><DialogContent className="gap-4 p-5"><DialogTitle>删除定时任务</DialogTitle><DialogDescription>删除“{deleting?.name}”及其计划，已生成的结果对话会保留。</DialogDescription><div className="flex justify-end gap-[5px]"><button className={BUTTON} disabled={busy} onClick={() => setDeleting(null)}>取消</button><button className={`${BUTTON} text-[var(--app-destructive)]`} disabled={busy} onClick={() => { if (deleting === null) return; void perform(async () => { await agentClient.deleteScheduledTask({ id: deleting.id }); setTasks((items) => items.filter((task) => task.id !== deleting.id)); if (selectedId === deleting.id) setSelectedId(null); setDeleting(null); }); }}>删除</button></div></DialogContent></Dialog>
    </div>
  );
}
