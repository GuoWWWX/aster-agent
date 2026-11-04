import { taskContextStatusSchema, type ConversationSummary, type TaskContext, type TaskContextDetail, type TaskContextPage, type TaskContextScope } from "@agent/protocol";
import { useEffect, useRef, useState, type ReactElement } from "react";
import { ArrowLeft, ArrowUpRight, Bot, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Circle, CircleHelp, ListTodo, LoaderCircle, MessageSquare, PanelRightOpen, Search } from "lucide-react";
import { IconButton } from "../../components/ui/icon-button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import { LoadingState } from "../../components/ui/loading.js";
import type { AgentClient } from "../../runtime/agent-client.js";
import { getUserErrorMessage } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { UserMessageContent } from "../chat/user-message-content.js";
import { formatConversationTime } from "../chat/chat-message-meta.js";

export const taskContextStatusLabels: Record<TaskContext["status"], string> = {
  pending: "待开始", running: "进行中", blocked: "受阻", completed: "已完成", failed: "失败", cancelled: "已取消",
};
const pageSize = 5;
const linkClass = "inline-flex min-w-0 items-center gap-[5px] text-[var(--app-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]";
type Source = TaskContextDetail["sources"][number];
type DirectoryProps = { agentClient: AgentClient; scope: TaskContextScope; active?: boolean };

function useTaskPage({ agentClient, scope, active = true }: DirectoryProps) {
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [cursors, setCursors] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState<TaskContextPage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [revision, refresh] = useState(0);
  const [loading, setLoading] = useState(false);
  const dirty = useRef(true);
  const changeVersion = useRef(0);
  const currentPage = useRef<TaskContextPage | null>(null);
  const loadedRequest = useRef<string | null>(null);
  const conversationId = scope.conversationId; const teamInstanceId = scope.teamInstanceId;
  useEffect(() => {
    if (query.trim() === search) return;
    const timer = window.setTimeout(() => { setSearch(query.trim()); setCursors([undefined]); }, 200);
    return () => window.clearTimeout(timer);
  }, [query, search]);
  useEffect(() => {
    if (!active) return;
    const key = JSON.stringify([conversationId, teamInstanceId, search, cursors, revision]);
    if (loadedRequest.current === key && !dirty.current) return;
    let disposed = false;
    const version = changeVersion.current;
    void Promise.resolve().then(async () => {
      if (disposed) return;
      setLoading(true);
      try {
        const result = await agentClient.listTaskContexts({ ...(conversationId === undefined ? {} : { conversationId }),
          ...(teamInstanceId === undefined ? {} : { teamInstanceId }), query: search, limit: pageSize,
          ...(cursors.at(-1) === undefined ? {} : { beforeId: cursors.at(-1)! }) });
        if (!disposed) { setPage(result); currentPage.current = result; setError(null); dirty.current = changeVersion.current !== version; loadedRequest.current = key; }
      } catch (reason) { if (!disposed) setError(getUserErrorMessage(reason, "任务列表读取失败")); }
      finally { if (!disposed) setLoading(false); }
    });
    return () => { disposed = true; };
  }, [agentClient, conversationId, teamInstanceId, search, cursors, active, revision]);
  useEffect(() => {
    let timer: number | undefined;
    const unsubscribe = agentClient.onConversationRunEvent(event => {
      if (event.type !== "collaboration.changed") return;
      const ownerChanged = currentPage.current?.items.some(task => task.ownerConversationId === event.conversationId) ?? false;
      const relevant = teamInstanceId === undefined ? event.conversationId === conversationId || ownerChanged
        : event.teamInstanceId === teamInstanceId || (event.teamInstanceId === undefined && ownerChanged);
      if (!relevant) return;
      dirty.current = true; changeVersion.current += 1;
      if (active) { window.clearTimeout(timer); timer = window.setTimeout(() => refresh(value => value + 1), 200); }
    });
    return () => { unsubscribe(); window.clearTimeout(timer); };
  }, [agentClient, conversationId, teamInstanceId, active]);
  return { query, setQuery, page, error, loading, pageNumber: cursors.length,
    reload: () => refresh(value => value + 1),
    previous: () => setCursors(values => values.slice(0, -1)),
    next: () => { if (page?.nextBeforeId) setCursors(values => [...values, page.nextBeforeId!]); } };
}
type TaskPage = ReturnType<typeof useTaskPage>;

function updateTaskStatus(agentClient: AgentClient, task: TaskContext, status: TaskContext["status"]): Promise<TaskContext> {
  if (task.workItemId !== null) return Promise.reject(new Error("请在团队任务的验收流程中确认此任务"));
  return agentClient.updateTaskContext({ id: task.id, conversationId: task.ownerConversationId, expectedRevision: task.revision,
    title: task.title, goal: task.goal, summary: task.summary, decisions: task.decisions, nextStep: task.nextStep, status, requestId: crypto.randomUUID() });
}

function TaskStatus({ task }: { task: TaskContext }): ReactElement {
  const label = task.completionRequested || task.workItemStatus === "reviewing" ? "待验收" : taskContextStatusLabels[task.status];
  return <span className={task.status === "completed" ? "text-[var(--app-status-success-fg)]" : task.completionRequested ? "text-[var(--app-status-warning-fg)]" : task.status === "running" ? "text-[var(--app-accent)]" : "text-[var(--app-muted-foreground)]"}>{label}</span>;
}
function TaskRows({ agentClient, data, selectedId, onSelect }: { agentClient: AgentClient; data: TaskPage; selectedId?: string | null; onSelect: (task: TaskContext) => void }): ReactElement {
  const saving = useRef(false);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const complete = async (task: TaskContext): Promise<void> => {
    if (saving.current || task.status === "completed" || task.workItemId !== null) return;
    saving.current = true; setSavingId(task.id); setSaveError(null);
    try { await updateTaskStatus(agentClient, task, "completed"); }
    catch (reason) { setSaveError(getUserErrorMessage(reason, "任务状态更新失败，请重新读取后重试")); }
    finally { saving.current = false; setSavingId(null); data.reload(); }
  };
  return <><div className="relative m-3 shrink-0"><Search size={15} aria-hidden="true" className="absolute left-2 top-2 text-[var(--app-muted-foreground)]" />
    <input aria-label="搜索任务或用户消息" placeholder="搜索任务或用户消息" value={data.query} onChange={event => data.setQuery(event.target.value)} className="h-8 w-full min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] pl-8 pr-2 outline-none focus:border-[var(--app-focus-ring)]" /></div>
    {data.error ? <p role="alert" className="mx-3 text-[var(--app-destructive)]">{data.error}<button type="button" onClick={data.reload} className="ml-2 underline">重试</button></p> : null}
    {saveError ? <p role="alert" className="mx-3 text-[var(--app-destructive)]">{saveError}</p> : null}
    {data.page === null && !data.error ? <LoadingState label="正在读取任务列表" /> : null}
    <ul aria-label="任务" aria-busy={data.loading} className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0">{data.page?.items.map(task => <li key={task.id}>
      <div className={`flex min-w-0 items-start gap-2 border-l-2 px-3 py-3 hover:bg-[var(--app-hover)] ${selectedId === task.id ? "border-[var(--app-accent)] bg-[var(--app-selection)]" : "border-transparent"}`}>
      <button type="button" aria-pressed={selectedId === task.id} onClick={() => onSelect(task)} className="flex min-w-0 flex-1 items-start gap-2 text-left focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
        {task.status === "completed" ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-[var(--app-status-success-fg)]" /> : task.completionRequested ? <CircleHelp size={16} className="mt-0.5 shrink-0 text-[var(--app-status-warning-fg)]" /> : <Circle size={16} className="mt-0.5 shrink-0 text-[var(--app-muted-foreground)]" />}
        <span className="min-w-0 flex-1"><strong className="block min-w-0 break-words font-medium">{task.title}</strong>
          <span className="mt-1 block text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{task.userMessageCount ?? 0} 条用户消息 · {formatConversationTime(task.updatedAt)}</span></span>
      </button>
      <button type="button" aria-label={`确认完成任务：${task.title}`} title={task.workItemId !== null ? "请在团队任务的验收流程中确认此任务" : task.status === "completed" ? "已完成" : "点击确认完成"}
        disabled={savingId !== null || data.loading || task.status === "completed" || task.workItemId !== null} aria-busy={savingId === task.id}
        onClick={() => void complete(task)} className="inline-flex shrink-0 items-center gap-[5px] rounded-[var(--app-radius-small)] text-[length:var(--app-font-size-caption)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] disabled:cursor-default disabled:no-underline">
        {savingId === task.id ? <LoaderCircle size={12} className="animate-spin motion-reduce:animate-none" /> : null}<TaskStatus task={task} />
      </button></div></li>)}</ul>
    {data.page?.items.length === 0 ? <p className="px-3 text-[var(--app-muted-foreground)]">{data.query ? "没有匹配的任务" : "暂无任务"}</p> : null}
    <footer className="flex shrink-0 items-center gap-1 border-t border-[var(--app-border)] px-3 py-[5px] text-[var(--app-muted-foreground)]">
      <span className="min-w-0 flex-1">共 {data.page?.total ?? data.page?.items.length ?? 0} 项</span>
      <IconButton label="上一页任务" disabled={data.pageNumber === 1 || data.loading} onClick={data.previous}><ChevronLeft size={14} /></IconButton>
      <span>{data.pageNumber} / {Math.max(data.pageNumber, Math.ceil((data.page?.total ?? 0) / pageSize), 1)}</span>
      <IconButton label="下一页任务" disabled={!data.page?.nextBeforeId || data.loading} onClick={data.next}><ChevronRight size={14} /></IconButton>
    </footer></>;
}

export function TaskListLauncher({ agentClient, scope, workspaceId, active = true }: DirectoryProps & { workspaceId: string }): ReactElement {
  const [open, setOpen] = useState(false);
  const data = useTaskPage({ agentClient, scope, active: active && open });
  const openSidebar = (taskId?: string): void => { useWorkbenchUiStore.getState().openTaskList({ workspaceId, scope, ...(taskId === undefined ? {} : { taskId }) }); setOpen(false); };
  return <Popover open={open && active} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" aria-label="查看任务列表" className="inline-flex shrink-0 items-center gap-[5px] rounded-[var(--app-radius)] px-2 py-1 text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)]"><ListTodo size={14} />任务列表<ChevronDown size={12} /></button></PopoverTrigger>
    <PopoverContent side="bottom" align="end" className="flex w-[400px] max-w-[calc(100vw-20px)] flex-col overflow-hidden rounded-[var(--app-radius-large)] border border-[var(--app-border)] bg-[var(--app-panel)] text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] shadow-lg">
      <header className="flex items-center gap-2 border-b border-[var(--app-border)] px-3 py-2"><strong className="flex-1 font-medium">任务列表</strong><button type="button" className={linkClass} onClick={() => openSidebar()}><PanelRightOpen size={14} />在侧边打开</button></header>
      <div className="flex max-h-[min(480px,65vh)] min-h-0 flex-col"><TaskRows agentClient={agentClient} data={data} onSelect={task => openSidebar(task.id)} /></div>
    </PopoverContent>
  </Popover>;
}

export function TaskListWorkspace({ agentClient, scope, active = true, requestedTaskId, requestId, onOpenConversation }: DirectoryProps & {
  requestedTaskId?: string; requestId?: string;
  onOpenConversation: (conversation: ConversationSummary, messageId?: string) => void;
}): ReactElement {
  const data = useTaskPage({ agentClient, scope, active });
  const [chosenId, setSelectedId] = useState<string | null>(requestedTaskId ?? null);
  const selectedId = chosenId ?? data.page?.items[0]?.id ?? null;
  const [previousRequest, setPreviousRequest] = useState({ requestedTaskId, requestId });
  const [detail, setDetail] = useState<TaskContextDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [allowCompletion, setAllowCompletion] = useState<boolean | null>(null);
  const [detailRevision, reloadDetail] = useState(0);
  const [showDetail, setShowDetail] = useState(requestedTaskId !== undefined);
  const conversationId = scope.conversationId; const teamInstanceId = scope.teamInstanceId;
  const detailsVersion = useRef(0);
  if (previousRequest.requestedTaskId !== requestedTaskId || previousRequest.requestId !== requestId) {
    setPreviousRequest({ requestedTaskId, requestId });
    if (requestedTaskId !== undefined) { setSelectedId(requestedTaskId); setShowDetail(true); }
  }
  useEffect(() => {
    if (!active) return;
    let disposed = false;
    void agentClient.getTaskCompletionPolicy({ ...(conversationId === undefined ? {} : { conversationId }), ...(teamInstanceId === undefined ? {} : { teamInstanceId }) }).then(policy => { if (!disposed) setAllowCompletion(policy.allowAgentCompletion); }).catch(reason => { if (!disposed) setError(getUserErrorMessage(reason, "完成权限读取失败")); });
    return () => { disposed = true; };
  }, [agentClient, conversationId, teamInstanceId, active]);
  useEffect(() => {
    if (selectedId === null || !active) return;
    const version = ++detailsVersion.current;
    void agentClient.getTaskContext({ id: selectedId, limit: 50 }).then(value => { if (version === detailsVersion.current) { setDetail(value); setError(null); } }).catch(reason => { if (version === detailsVersion.current) setError(getUserErrorMessage(reason, "任务读取失败")); });
    return () => { detailsVersion.current += 1; };
  }, [agentClient, selectedId, active, detailRevision, data.page]);
  const task = detail?.task.id === selectedId ? detail.task : null;
  const saveStatus = async (status: TaskContext["status"]): Promise<void> => {
    if (task === null || busy) return;
    setBusy(true);
    try {
      await updateTaskStatus(agentClient, task, status);
      data.reload(); reloadDetail(value => value + 1);
    } catch (reason) { setError(getUserErrorMessage(reason, "任务状态更新失败，请重新读取后重试")); }
    finally { setBusy(false); }
  };
  const openSource = async (source: Source): Promise<void> => {
    if (source.kind === "group") { useWorkbenchUiStore.getState().openTeamChat({ instanceId: source.containerId, messageId: source.messageId }); return; }
    try {
      const conversation = (await agentClient.listConversationHierarchy()).find(item => item.id === source.containerId);
      if (conversation === undefined) throw new Error("来源对话已删除");
      onOpenConversation(conversation, source.messageId);
    } catch (reason) { setError(getUserErrorMessage(reason, "无法定位原消息")); }
  };
  const sources = detail?.task.id === selectedId ? detail.sources.filter(source => source.role === "user" || !source.available) : [];
  const groups = [...new Set(sources.map(source => `${source.kind}:${source.containerId}`))].map(key => sources.filter(source => `${source.kind}:${source.containerId}` === key));
  return <section aria-label="任务列表工作区" className="@container flex h-full min-h-0 w-full min-w-0 flex-1 flex-col bg-[var(--app-panel)] text-[length:var(--app-font-size-control)] text-[var(--app-foreground)]">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-[var(--app-border)] px-4 py-3">
      <span className="inline-flex items-center gap-2 font-medium"><ListTodo size={16} />任务列表</span>
      <label className="flex cursor-pointer items-center gap-2 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]" title="仅作用于本对话或本群聊。关闭时，Agent 提交完成结果后仍需你确认。">
        允许 Agent 自动确认完成<span className="relative inline-flex shrink-0"><input aria-label="允许 Agent 自动确认完成" type="checkbox" role="switch" checked={allowCompletion ?? false} disabled={allowCompletion === null || busy}
          className="peer sr-only" onChange={event => { const checked = event.target.checked; setBusy(true); void agentClient.setTaskCompletionPolicy({ ...scope, allowAgentCompletion: checked }).then(policy => setAllowCompletion(policy.allowAgentCompletion)).catch(reason => setError(getUserErrorMessage(reason, "完成权限保存失败"))).finally(() => setBusy(false)); }} /><span aria-hidden="true" className="h-[18px] w-8 rounded-full bg-[var(--app-border)] after:absolute after:left-[3px] after:top-[3px] after:size-3 after:rounded-full after:bg-[var(--app-muted-foreground)] after:transition-transform peer-checked:bg-[var(--app-accent)] peer-checked:after:translate-x-[14px] peer-checked:after:bg-[var(--app-accent-foreground)] peer-focus-visible:ring-2 peer-focus-visible:ring-[var(--app-focus-ring)] peer-disabled:opacity-50" /></span>
      </label>
    </header>
    {error ? <p role="alert" className="m-0 flex shrink-0 gap-2 px-4 py-2 text-[var(--app-destructive)]">{error}<button type="button" className="shrink-0 underline" onClick={() => { data.reload(); reloadDetail(value => value + 1); }}>重新读取</button></p> : null}
    <div className="grid min-h-0 min-w-0 flex-1 grid-cols-1 @min-[640px]:grid-cols-[minmax(220px,30%)_minmax(0,1fr)]">
      <nav aria-label="选择任务" className={`${showDetail ? "hidden @min-[640px]:flex" : "flex"} min-h-0 min-w-0 flex-col border-r border-[var(--app-border)]`}><TaskRows agentClient={agentClient} data={data} selectedId={selectedId} onSelect={item => { setSelectedId(item.id); setShowDetail(true); }} /></nav>
      <article aria-label="任务详情" className={`${showDetail ? "flex" : "hidden @min-[640px]:flex"} min-h-0 min-w-0 flex-col overflow-y-auto p-4 @min-[800px]:p-5`}>
        <button type="button" className={`${linkClass} mb-3 shrink-0 self-start @min-[640px]:hidden`} onClick={() => setShowDetail(false)}><ArrowLeft size={14} />返回任务列表</button>
        {task === null ? <p className="text-[var(--app-muted-foreground)]">{selectedId === null ? "选择一个任务，查看目标、进展和关联消息" : error ? "任务暂时无法读取" : "正在读取任务…"}</p> : <>
          <div className="mb-4 flex min-w-0 shrink-0 flex-wrap items-start gap-3"><div className="min-w-0 flex-1 basis-full @min-[800px]:basis-auto"><h2 className="m-0 break-words text-[length:var(--app-font-size-title)] font-semibold">{task.title}</h2><p className="mb-0 mt-2 inline-flex items-center gap-[5px] text-[var(--app-muted-foreground)]"><Bot size={14} />{task.completedBy === "user" ? "由你确认完成" : task.completedBy === "agent" ? "Agent 已确认完成" : task.completionRequested ? "Agent 已提交，等待你确认" : "最近更新"} · {formatConversationTime(task.updatedAt)}</p></div>
            <div className="flex flex-wrap items-center gap-2"><Select value={task.status} disabled={busy || task.workItemId !== null} onValueChange={value => { void saveStatus(taskContextStatusSchema.parse(value)); }}><SelectTrigger aria-label="修改任务状态" className="w-28"><SelectValue /></SelectTrigger><SelectContent>{Object.entries(taskContextStatusLabels).map(([value, label]) => <SelectItem key={value} value={value}>{label}</SelectItem>)}</SelectContent></Select>
              <button type="button" disabled={busy || task.status === "completed" || task.workItemId !== null} onClick={() => void saveStatus("completed")} className="inline-flex h-8 items-center gap-[5px] rounded-[var(--app-radius)] bg-[var(--app-accent)] px-3 text-[var(--app-accent-foreground)] disabled:opacity-50"><Check size={14} />{task.status === "completed" ? "已完成" : "确认完成"}</button></div>
          </div>
          {task.workItemId !== null ? <p className="mb-3 mt-0 text-[var(--app-muted-foreground)]">此任务由团队工作项维护，请在团队任务中验收。</p> : null}
          <dl className="m-0 grid shrink-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-3 border-b border-[var(--app-border)] pb-4"><dt className="text-[var(--app-muted-foreground)]">目标</dt><dd className="m-0 whitespace-pre-wrap break-words">{task.goal}</dd><dt className="text-[var(--app-muted-foreground)]">进展</dt><dd className="m-0 whitespace-pre-wrap break-words">{task.summary || "暂无进展记录"}</dd>{task.nextStep ? <><dt className="text-[var(--app-muted-foreground)]">下一步</dt><dd className="m-0 whitespace-pre-wrap break-words">{task.nextStep}</dd></> : null}{task.decisions ? <><dt className="text-[var(--app-muted-foreground)]">约束</dt><dd className="m-0 whitespace-pre-wrap break-words">{task.decisions}</dd></> : null}</dl>
          <h3 className="mb-3 mt-5 inline-flex shrink-0 items-center gap-2 text-[length:var(--app-font-size-control)] font-semibold"><MessageSquare size={16} />关联用户消息 · {task.userMessageCount ?? sources.length} 条</h3>
          {groups.length === 0 ? <p className="text-[var(--app-muted-foreground)]">尚无关联的用户消息</p> : groups.map(group => <details open key={`${group[0]!.kind}:${group[0]!.containerId}`} className="mb-4 shrink-0"><summary className="cursor-pointer break-words py-2 text-[var(--app-muted-foreground)]">{group[0]!.title} · {group.length} 条</summary><ul className="m-0 flex list-none flex-col gap-[5px] p-0">{group.map(source => <li key={source.messageId} className="rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] p-3">
            <div className="mb-2 flex items-center gap-2 text-[var(--app-muted-foreground)]"><span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--app-selection)] text-[var(--app-accent)]">你</span><strong className="flex-1 font-medium">你</strong>{source.createdAt ? <time dateTime={source.createdAt}>{formatConversationTime(source.createdAt)}</time> : null}</div>
            <div className="whitespace-pre-wrap break-words [&_p]:m-0"><UserMessageContent content={source.content ?? "原消息已不可用"} /></div>
            <div className="mt-2 flex justify-end"><button type="button" disabled={!source.available} className={`${linkClass} disabled:text-[var(--app-muted-foreground)]`} onClick={() => void openSource(source)}><ArrowUpRight size={14} />定位原消息</button></div>
          </li>)}</ul></details>)}
          {detail?.nextBeforeSourceSequence == null ? null : <button type="button" disabled={busy} className={`${linkClass} self-start`} onClick={() => { const version = detailsVersion.current; setBusy(true); void agentClient.getTaskContext({ id: task.id, beforeSourceSequence: detail.nextBeforeSourceSequence!, limit: 50 }).then(page => { if (version === detailsVersion.current) setDetail(previous => previous?.task.id === page.task.id ? { ...page, sources: [...previous.sources, ...page.sources] } : previous); }).catch(reason => setError(getUserErrorMessage(reason, "关联消息读取失败"))).finally(() => setBusy(false)); }}>加载更早关联消息</button>}
        </>}
      </article>
    </div>
  </section>;
}

export function TaskContextDirectory({ agentClient, conversationId, teamInstanceId, onOpenConversation }: {
  agentClient: AgentClient; conversationId?: string; teamInstanceId?: string;
  onOpenConversation: (conversation: ConversationSummary, messageId?: string) => void;
}): ReactElement {
  return <TaskListWorkspace agentClient={agentClient} scope={teamInstanceId === undefined ? { conversationId: conversationId! } : { teamInstanceId }} onOpenConversation={onOpenConversation} />;
}
