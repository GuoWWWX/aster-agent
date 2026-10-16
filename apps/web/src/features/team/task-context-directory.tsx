import { taskContextStatusSchema } from "@agent/protocol";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ChevronDown, ChevronRight, ListTree, Pencil, Plus, X } from "lucide-react";
import type { ConversationSummary, ListTaskContextsInput, TaskContext, TaskContextDetail, TaskSource } from "@agent/protocol";
import type { AgentClient } from "../../runtime/agent-client.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";

export const taskContextStatusLabels: Record<TaskContext["status"], string> = {
  pending: "待处理", running: "进行中", blocked: "受阻", completed: "已完成", failed: "失败", cancelled: "已取消",
};
const inputClass = "min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-canvas)] px-2 py-1 text-[length:var(--app-font-size-control)]";

export function TaskContextDirectory({ agentClient, conversationId, teamInstanceId, onOpenConversation }: {
  agentClient: AgentClient; conversationId?: string; teamInstanceId?: string;
  onOpenConversation: (conversation: ConversationSummary, messageId?: string) => void;
}): ReactElement {
  const [query, setQuery] = useState(""); const [status, setStatus] = useState("all");
  const [tasks, setTasks] = useState<TaskContext[]>([]); const [cursor, setCursor] = useState<string | null>(null);
  const [detail, setDetail] = useState<TaskContextDetail | null>(null); const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ title: "", goal: "", summary: "", decisions: "", nextStep: "", status: "running" as TaskContext["status"] });
  const [unclassified, setUnclassified] = useState<TaskSource[]>([]); const [newSource, setNewSource] = useState<TaskSource | null>(null);
  const [mergeTarget, setMergeTarget] = useState(""); const [owner, setOwner] = useState(conversationId ?? "");
  const [busy, setBusy] = useState(false); const [error, setError] = useState<string | null>(null);
  const version = useRef(0);
  const load = useCallback(async (beforeId?: string) => {
    const request = ++version.current;
    try {
      const filter: ListTaskContextsInput = { query, ...(conversationId === undefined ? {} : { conversationId }),
        ...(teamInstanceId === undefined ? {} : { teamInstanceId }), ...(beforeId === undefined ? {} : { beforeId }) };
      const selected = Object.entries(taskContextStatusLabels).find(([key]) => key === status);
      if (selected !== undefined) filter.status = taskContextStatusSchema.parse(selected[0]);
      const page = await agentClient.listTaskContexts(filter);
      if (request !== version.current) return;
      setTasks(previous => beforeId === undefined ? page.items : [...new Map([...previous, ...page.items].map(task => [task.id, task])).values()]); setUnclassified(page.unclassified); setCursor(page.nextBeforeId); setError(null);
    } catch (reason) { if (request === version.current) setError(reason instanceof Error ? reason.message : "任务目录加载失败"); }
  }, [agentClient, conversationId, teamInstanceId, query, status]);
  useEffect(() => { void Promise.resolve().then(() => load()); return () => { version.current += 1; }; }, [load]);
  useEffect(() => agentClient.onConversationRunEvent(event => {
    if (event.type === "collaboration.changed" || event.type === "run.finished") void load();
  }), [agentClient, load]);
  useEffect(() => {
    if (teamInstanceId === undefined) return;
    let disposed = false;
    void agentClient.getTeamChatMembers({ teamInstanceId }).then(members => {
      if (!disposed) setOwner(members.find(member => member.isLead)?.conversationId ?? "");
    }).catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; };
  }, [agentClient, teamInstanceId]);

  const open = async (task: TaskContext) => {
    if (detail?.task.id === task.id) { setDetail(null); setEditing(false); return; }
    try { setDetail(await agentClient.getTaskContext({ id: task.id })); setEditing(false); setMergeTarget(""); }
    catch (reason) { setError(String(reason)); }
  };
  const edit = (task?: TaskContext) => {
    setForm(task === undefined ? { title: "", goal: "", summary: "", decisions: "", nextStep: "", status: "running" }
      : { title: task.title, goal: task.goal, summary: task.summary, decisions: task.decisions, nextStep: task.nextStep, status: task.status });
    if (task === undefined) setDetail(null); setEditing(true);
  };
  const save = async () => {
    if (busy || !owner) return; setBusy(true);
    try {
      const task = await agentClient.updateTaskContext({ ...form, conversationId: detail?.task.ownerConversationId ?? owner,
        ...(detail === null ? {} : { id: detail.task.id, expectedRevision: detail.task.revision }), ...(newSource === null ? {} : { source: newSource }), requestId: crypto.randomUUID() });
      setDetail(await agentClient.getTaskContext({ id: task.id })); setEditing(false); setNewSource(null); await load();
    } catch (reason) { setError(String(reason)); } finally { setBusy(false); }
  };
  const openSource = async (source: TaskSource) => {
    if (source.kind === "group") { useWorkbenchUiStore.getState().openTeamChat({ instanceId: source.containerId, messageId: source.messageId }); return; }
    try {
      const target = (await agentClient.listConversationHierarchy()).find(item => item.id === source.containerId);
      if (target === undefined) throw new Error("来源对话已删除"); onOpenConversation(target, source.messageId);
    } catch (reason) { setError(String(reason)); }
  };
  return <section aria-label="任务上下文目录" className="flex min-h-0 min-w-0 flex-1 flex-col gap-[5px] text-[length:var(--app-font-size-control)]">
    <div className="flex shrink-0 items-center gap-[5px]">
      <input className={`${inputClass} flex-1`} aria-label="搜索任务上下文" placeholder="搜索任务目标" value={query} onChange={event => setQuery(event.target.value)} />
      <Select value={status} onValueChange={setStatus}><SelectTrigger aria-label="任务状态" className="w-28"><SelectValue /></SelectTrigger><SelectContent>
        <SelectItem value="all">全部状态</SelectItem>{Object.entries(taskContextStatusLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}
      </SelectContent></Select>
      <button type="button" aria-label="新增任务上下文" title="新增任务" disabled={!owner} onClick={() => { setNewSource(null); edit(); }} className="rounded-[var(--app-radius)] p-1 hover:bg-[var(--app-hover)]"><Plus size={16} /></button>
    </div>
    {error === null ? null : <p role="alert" className="m-0 text-[var(--app-destructive)]">{error}<button type="button" className="ml-2 underline" onClick={() => void load()}>重新读取</button></p>}
    <div className="min-h-0 flex-1 overflow-auto">
      {unclassified.length === 0 ? null : <details className="mb-2 text-[var(--app-muted-foreground)]"><summary>最近 {unclassified.length} 条输入尚未关联任务（含无需归档的日常消息）</summary><ul className="m-0 list-none p-0">{unclassified.map(source => <li key={source.messageId} className="flex items-center gap-[5px]"><button type="button" onClick={() => void openSource(source)} className="hover:underline">查看原消息</button><button type="button" disabled={detail === null} onClick={() => { if (detail !== null) void agentClient.linkTaskContext({ id: detail.task.id, source }).then(async () => { setDetail(await agentClient.getTaskContext({ id: detail.task.id })); await load(); }).catch(reason => setError(String(reason))); }}>关联到展开任务</button><button type="button" onClick={() => { edit(); setNewSource(source); }}>创建任务</button></li>)}</ul></details>}
      {tasks.length === 0 && !editing ? <p className="text-[var(--app-muted-foreground)]">暂无任务上下文。Agent 处理新目标时会创建记录，后续进展更新同一任务。</p> : null}
      <ul className="m-0 grid list-none gap-[5px] p-0">{tasks.map(task => <li key={task.id} className="min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] p-2">
        <button type="button" onClick={() => void open(task)} aria-expanded={detail?.task.id === task.id} className="flex w-full min-w-0 items-center gap-[5px] text-left">
          {detail?.task.id === task.id ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<span className="min-w-0 flex-1 truncate font-semibold">{task.title}</span><span className="shrink-0 text-[var(--app-muted-foreground)]">{task.workItemStatus === "reviewing" ? "待验收" : task.workItemStatus === "waiting_user" ? "等待用户" : taskContextStatusLabels[task.status]}</span>
        </button><p className="my-1 whitespace-pre-wrap break-words text-[var(--app-muted-foreground)]">{task.summary || task.goal}</p>
        <time className="text-[var(--app-subtle-foreground)]" dateTime={task.updatedAt}>{new Date(task.updatedAt).toLocaleString()}</time>
        {detail?.task.id !== task.id ? null : <div className="mt-2 border-t border-[var(--app-border)] pt-2">
          <div className="flex items-center gap-[5px]"><span className="flex-1">目标：{detail.task.goal}</span>{task.workItemId === null ? <button type="button" aria-label="编辑任务上下文" onClick={() => edit(detail.task)}><Pencil size={14} /></button> : <span className="text-[var(--app-muted-foreground)]">由工作项维护状态</span>}</div>
          {detail.task.decisions ? <p className="whitespace-pre-wrap">有效决定：{detail.task.decisions}</p> : null}
          {detail.task.nextStep ? <p className="whitespace-pre-wrap">下一步：{detail.task.nextStep}</p> : null}
          <ul className="m-0 list-none space-y-1 p-0">{detail.sources.map(source => <li key={`${source.kind}:${source.containerId}:${source.messageId}`} className="flex min-w-0 items-center gap-[5px]">
            <button type="button" disabled={!source.available} onClick={() => void openSource(source)} className="min-w-0 flex-1 truncate text-left hover:underline disabled:text-[var(--app-muted-foreground)]">{source.kind === "group" ? "群聊" : source.title} · {source.purpose}{source.available ? "" : " · 原始记录已删除"}</button>
            <button type="button" aria-label="解除消息关联" title="解除关联" onClick={() => { void agentClient.linkTaskContext({ id: task.id, source: { kind: source.kind, containerId: source.containerId, messageId: source.messageId, runId: source.runId, purpose: source.purpose }, remove: true }).then(() => agentClient.getTaskContext({ id: task.id })).then(setDetail).catch(reason => setError(String(reason))); }}><X size={12} /></button>
          </li>)}</ul>
          {detail.nextBeforeSourceSequence === null ? null : <button type="button" className="my-1 underline" onClick={() => { void agentClient.getTaskContext({ id: task.id, beforeSourceSequence: detail.nextBeforeSourceSequence! }).then(page => setDetail(previous => previous?.task.id === page.task.id ? { ...page, sources: [...previous.sources, ...page.sources] } : previous)).catch(reason => setError(String(reason))); }}>加载更早关联消息</button>}
          {detail.sources.length === 0 ? <p className="text-[var(--app-muted-foreground)]">尚无关联消息。</p> : null}
          {task.workItemId !== null ? null : <div className="mt-2 flex items-center gap-[5px]"><Select value={mergeTarget} onValueChange={setMergeTarget}><SelectTrigger aria-label="归并到其他任务" className="min-w-0 flex-1"><SelectValue placeholder="选择同目标的任务进行归并" /></SelectTrigger><SelectContent>{tasks.filter(item => item.id !== task.id && item.workItemId === null).map(item => <SelectItem key={item.id} value={item.id}>{item.title}</SelectItem>)}</SelectContent></Select>
            <button type="button" disabled={!mergeTarget || busy} onClick={() => { setBusy(true); void agentClient.mergeTaskContexts({ id: detail.task.id, intoId: mergeTarget, expectedRevision: detail.task.revision }).then(() => { setDetail(null); return load(); }).catch(reason => setError(String(reason))).finally(() => setBusy(false)); }}>确认归并</button></div>}
        </div>}
      </li>)}</ul>
      {cursor === null ? null : <button type="button" className="my-2 underline" onClick={() => void load(cursor)}>加载更早任务</button>}
      {!editing ? null : <form aria-label="编辑任务记录" onSubmit={event => { event.preventDefault(); void save(); }} className="mt-2 grid gap-[5px] border-t border-[var(--app-border)] pt-2">
        {([['title', '任务名称'], ['goal', '任务目标与完成条件'], ['summary', '当前结论'], ['decisions', '有效决定与约束'], ['nextStep', '下一步']] as const).map(([field, label]) => <label key={field} className="grid gap-1">{label}<textarea className={inputClass} required={field === "title" || field === "goal"} aria-label={label} rows={field === "title" ? 1 : 2} value={form[field]} onChange={event => setForm(previous => ({ ...previous, [field]: event.target.value }))} /></label>)}
        <Select value={form.status} onValueChange={value => { const found = Object.keys(taskContextStatusLabels).find(key => key === value); if (found) setForm(previous => ({ ...previous, status: taskContextStatusSchema.parse(found) })); }}><SelectTrigger aria-label="修改任务状态"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(taskContextStatusLabels).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select>
        <div className="flex gap-2"><button type="submit" disabled={busy} className="rounded-[var(--app-radius)] bg-[var(--app-accent)] px-3 py-1 text-[var(--app-accent-foreground)]">保存</button><button type="button" onClick={() => setEditing(false)}>取消</button></div>
      </form>}
    </div>
  </section>;
}

export function ConversationTaskDirectory(props: { agentClient: AgentClient; conversationId: string; onOpenConversation: (conversation: ConversationSummary, messageId?: string) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  return <div className="mb-[5px] min-w-0"><button type="button" aria-expanded={open} onClick={() => setOpen(value => !value)} className="inline-flex items-center gap-[5px] rounded-[var(--app-radius)] px-2 py-1 text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)]"><ListTree size={14} />任务上下文{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}</button>
    {open ? <div className="flex h-64 min-h-0 border-t border-[var(--app-border)] p-2"><TaskContextDirectory {...props} /></div> : null}
  </div>;
}
