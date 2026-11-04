import { ChevronDown, ChevronRight, MessageSquareText } from "lucide-react";
import { useEffect, useState, type ReactElement } from "react";
import type { TeamCollaborationProjection, TeamWorkItemView } from "@agent/protocol";
import type { AgentClient } from "../../runtime/agent-client.js";
import { formatTeamWorkItemTime } from "./team-work-item-time.js";

const taskStatusLabels: Record<TeamWorkItemView["status"], string> = {
  inbox: "收件箱", triaging: "整理中", needs_clarification: "待澄清", planned: "已规划",
  queued: "排队中", running: "执行中", waiting_user: "待验收", blocked: "受阻",
  reviewing: "检查中", completed: "已完成", failed: "失败", cancelled: "已取消",
};
const memberStatusLabels: Record<TeamCollaborationProjection["nodes"][number]["runStatus"], string> = {
  idle: "空闲", queued: "排队中", running: "执行中", completed: "已完成", failed: "失败", blocked: "受阻",
};

/** A task is the grouping key; messages and rework update the same entry. */
export function TeamTaskTimeline({ items, agentClient, onOpenTask, onOpenMember }: {
  items: readonly TeamWorkItemView[];
  agentClient: AgentClient;
  onOpenTask: (id: string) => void;
  onOpenMember: (workItemId: string, conversationId: string) => void;
}): ReactElement {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [projection, setProjection] = useState<TeamCollaborationProjection | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [memberId, setMemberId] = useState("");
  const [limit, setLimit] = useState(20);
  const expandedUpdatedAt = items.find(item => item.id === expanded)?.updatedAt;
  useEffect(() => {
    if (expanded === null) return;
    let disposed = false;
    void Promise.resolve().then(async () => {
      if (disposed) return;
      setLoading(true);
      setError(null);
      setProjection(null);
      const value = await agentClient.getTeamCollaborationProjection(expanded);
      if (!disposed) setProjection(value);
    }).catch(reason => {
      if (!disposed) setError(reason instanceof Error ? reason.message : "成员摘要读取失败。");
    }).finally(() => {
      if (!disposed) setLoading(false);
    });
    return () => { disposed = true; };
  }, [agentClient, expanded, expandedUpdatedAt, retry]);
  const ordered = [...items].filter(item => memberId.length === 0 || item.participantConversationIds?.includes(memberId))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
  return <section aria-label="团队任务时间线" className="min-h-0 overflow-auto rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-3">
    <header className="mb-3 flex flex-wrap items-center gap-[5px] text-[length:var(--app-font-size-control)]">
      <span className="flex-1 text-[var(--app-muted-foreground)]">按任务汇总成员、时间和结果；多轮对话与返工保留在同一任务内。</span>
      {memberId.length === 0 ? null : <button type="button" className="rounded-[var(--app-radius)] px-2 py-1 hover:bg-[var(--app-hover)]" onClick={() => setMemberId("")}>查看全部成员</button>}
    </header>
    {ordered.length === 0 ? <p className="text-[var(--app-muted-foreground)]">暂无任务记录。可在上方新建任务，或在对话中 @团队。</p> : null}
    <ol className="m-0 grid list-none gap-[5px] p-0">
      {ordered.slice(0, limit).map(item => <li key={item.id} className="rounded-[var(--app-radius)] border border-[var(--app-border)] p-2">
        <div className="flex min-w-0 flex-wrap items-center gap-[5px]">
          <button type="button" aria-expanded={expanded === item.id} aria-label={`查看任务摘要 ${item.title}`} className="flex min-w-0 flex-1 items-center gap-[5px] text-left" onClick={() => setExpanded(expanded === item.id ? null : item.id)}>
            {expanded === item.id ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
            <span className="truncate font-semibold">{item.title}</span>
          </button>
          <time dateTime={item.createdAt} className="shrink-0 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{formatTeamWorkItemTime(item.createdAt)}</time>
          <button type="button" className="shrink-0 rounded-[var(--app-radius)] px-2 py-1 text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)]" onClick={() => onOpenTask(item.id)}>打开任务</button>
        </div>
        <p className="my-1 whitespace-pre-wrap break-words text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{(item.resultSummary ?? item.blockedReason ?? item.requirement).slice(0, 1000)}</p>
        <p className="m-0 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{item.instanceName ?? "团队"} · {taskStatusLabels[item.status]} · 第 {item.revision} 轮 · 更新于 {formatTeamWorkItemTime(item.updatedAt)}</p>
        {expanded !== item.id ? null : <div className="mt-2 grid gap-[5px] border-t border-[var(--app-border)] pt-2">
          {loading ? <p role="status">正在读取成员摘要…</p> : null}
          {error === null ? null : <p role="status" className="text-[var(--app-destructive)]">{error}<button type="button" className="ml-2 underline" onClick={() => setRetry(current => current + 1)}>重试</button></p>}
          {(projection?.workItemId === item.id ? projection.nodes : []).filter(node => node.conversationId !== null && item.participantConversationIds?.includes(node.conversationId)).map(node => <div key={node.id} className="grid gap-1 rounded-[var(--app-radius)] bg-[var(--app-panel-subtle)] p-2 text-[length:var(--app-font-size-control)]">
            <div className="flex flex-wrap items-center gap-[5px]">
              <button type="button" className="inline-flex items-center gap-1 font-semibold hover:underline" onClick={() => onOpenMember(item.id, node.conversationId!)}><MessageSquareText size={13} />{node.name}</button>
              <span className="text-[var(--app-muted-foreground)]">{node.role} · {memberStatusLabels[node.runStatus]}</span>
              <button type="button" className="ml-auto hover:underline" onClick={() => setMemberId(node.conversationId!)}>只看此成员的任务</button>
            </div>
            <p className="m-0 whitespace-pre-wrap break-words">{node.latestOutput ?? "尚无已记录的结果，可打开成员对话查看进度。"}</p>
          </div>)}
        </div>}
      </li>)}
    </ol>
    {ordered.length <= limit ? null : <button type="button" className="mt-2 rounded-[var(--app-radius)] px-2 py-1 hover:bg-[var(--app-hover)]" onClick={() => setLimit(current => current + 20)}>显示更早任务</button>}
  </section>;
}
