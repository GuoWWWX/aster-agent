import { Spinner } from "../../components/ui/loading.js";
import { ConversationWorkIndicator } from "./conversation-work-state.js";
import { Check, ChevronDown, MessageSquareText, Search, ShieldAlert, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNativeOverlayContainer } from "../../components/ui/native-overlay-provider.js";
import {
  AgentClientError,
  parseSerializedAgentError,
  type ApproveToolChangeInput,
  type ConversationRunEvent,
  type ConversationToolItem,
  type ProjectSummary,
  type TeamInstanceView,
} from "@agent/protocol";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { ConversationIdentityIcon, conversationIdentity } from "./conversation-identity.js";
import { useTeamChatActivity } from "./use-team-chat-activity.js";
import { formatConversationTime, formatConversationDateTime } from "./chat-message-meta.js";
import type { ProjectSession } from "../projects/project-session-model.js";

type LiveTool = Pick<ConversationToolItem, "conversationId" | "runId" | "status">
  & Partial<Pick<ConversationToolItem, "name" | "createdAt">>;
type LiveTools = Record<string, LiveTool>;
type ApprovalNotice = { conversationId: string; runId: string; toolId: string; tool: LiveTool };

type ApprovalScope = ApproveToolChangeInput["scope"];

function canApproveForSession(tool: LiveTool | undefined): boolean {
  return tool?.name !== undefined && tool.name !== "read_external_file";
}

function toolApprovalLabel(tool: LiveTool | undefined): string {
  if (tool?.name === undefined) return "审批";
  if (tool.name === "run_command") return "命令";
  if (tool.name === "read_external_file") return "读取文件";
  if (tool.name === "delete_file") return "删除文件";
  return "文件变更";
}

export function updateActivityTools(tools: LiveTools, event: ConversationRunEvent): LiveTools {
  if (event.type === "run.finished") return Object.fromEntries(Object.entries(tools).filter(([, tool]) => tool.runId !== event.runId));
  if (event.type !== "tool.started" && event.type !== "tool.completed" && event.type !== "tool.approval_requested") return tools;
  const next = { ...tools };
  if (event.tool.status === "running" || event.tool.status === "awaiting_approval") next[event.tool.id] = {
    conversationId: event.conversationId,
    runId: event.runId,
    status: event.tool.status,
    name: event.tool.name,
    createdAt: event.tool.createdAt,
  };
  else delete next[event.tool.id];
  return next;
}

function resolveConversationRoot<T extends Pick<ProjectSession, "id" | "parentConversationId"> & Partial<Pick<ProjectSession, "teamId" | "teamWorkItemId" | "threadKind">>>(
  session: T,
  byId: ReadonlyMap<string, T>,
): T {
  let root = session;
  const visited = new Set<string>();
  while (root.parentConversationId !== null && !visited.has(root.id)) {
    visited.add(root.id);
    if (root.teamId != null && root.teamWorkItemId == null && root.threadKind !== "subagent") break;
    const parent = byId.get(root.parentConversationId);
    if (parent === undefined) break;
    root = parent;
  }
  return root;
}

export function conversationActivityRows(sessions: readonly ProjectSession[], tools: LiveTools) {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  sessions = [...byId.values()];
  const families = new Map<string, ProjectSession[]>();
  for (const session of sessions) {
    const root = resolveConversationRoot(session, byId);
    // Subagents are intentionally omitted from ordinary unread/running rows.
    // Their pending approvals are merged into the root below instead.
    if (session.coordinationTeamInstanceId !== undefined || session.isArchived || session.threadKind === "subagent"
      || root.coordinationTeamInstanceId !== undefined || root.isArchived || root.threadKind === "subagent"
      || (root.parentConversationId !== null && root.teamId === null)) continue;
    const family = families.get(root.id) ?? [];
    family.push(session);
    families.set(root.id, family);
  }

  const approvalsByRoot = new Map<string, {
    conversationId: string;
    toolId: string;
    updatedAt: string;
  }>();
  for (const [toolId, tool] of Object.entries(tools)) {
    if (tool.status !== "awaiting_approval") continue;
    const source = byId.get(tool.conversationId);
    if (source === undefined || source.isArchived) continue;
    const root = resolveConversationRoot(source, byId);
    if (root.coordinationTeamInstanceId !== undefined || root.isArchived || root.threadKind === "subagent") continue;
    const current = approvalsByRoot.get(root.id);
    const updatedAt = (tool.createdAt ?? "") > (source.updatedAt ?? "") ? tool.createdAt! : source.updatedAt ?? "";
    if (current === undefined || updatedAt > current.updatedAt) {
      approvalsByRoot.set(root.id, { conversationId: source.id, toolId, updatedAt });
    }
  }

  return Array.from(families, ([id, members]) => ({ session: byId.get(id)!, members })).flatMap(({ session, members }) => {
    const live = Object.values(tools).filter((tool) => members.some((member) => tool.conversationId === member.id && tool.runId === member.activeRunId));
    const approval = approvalsByRoot.get(session.id);
    const waiting = approval !== undefined || live.some((tool) => tool.status === "awaiting_approval");
    const hasUnreadResult = members.some((member) => member.hasUnreadResult);
    const unreadSession = session.hasUnreadResult ? session : members.filter((member) => member.hasUnreadResult)
      .sort((left, right) => (right.updatedAt ?? "").localeCompare(left.updatedAt ?? ""))[0];
    const group = waiting ? "待处理" : hasUnreadResult ? "未读" : members.some((member) => member.activeRunId !== null) ? "进行中" : null;
    if (group === null) return [];
    const updatedAt = members.reduce((latest, member) => (member.updatedAt ?? "") > latest ? member.updatedAt! : latest, approval?.updatedAt ?? "");
    const fallbackApproval = Object.entries(tools).find(([, tool]) => tool.status === "awaiting_approval"
      && members.some((member) => tool.conversationId === member.id && tool.runId === member.activeRunId));
    const approvalToolId = approval?.toolId ?? fallbackApproval?.[0];
    return [{ session, group, hasUnreadResult, unreadSession, updatedAt, approvalToolId, status: waiting ? "等待审批" : hasUnreadResult
      ? members.some((member) => member.hasUnreadResult && member.lastRunStatus === "failed") ? "运行失败，待查看" : "有新回复"
      : live.some((tool) => tool.status === "running") ? "执行工具" : "正在处理" }];
  }).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function ConversationActivity({ agentClient, sessions, projects, teamInstances = [], onSelect }: {
  agentClient: AgentClient; sessions: readonly ProjectSession[]; projects: readonly ProjectSummary[]; teamInstances?: readonly TeamInstanceView[];
  onSelect: (id: string, timelineItemId?: string, ownerConversationId?: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const agents = useAgentDirectoryStore(state => state.agents);
  const nativeOverlayContainer = useNativeOverlayContainer();
  const [query, setQuery] = useState("");
  const [tools, setTools] = useState<LiveTools>({});
  const [loadError, setLoadError] = useState(false);
  const [retry, setRetry] = useState(0);
  const { sessions: groupSessions, loadError: groupLoadError } = useTeamChatActivity(agentClient, teamInstances, open, retry);
  const [approvalNotice, setApprovalNotice] = useState<ApprovalNotice | null>(null);
  const [approvingToolIds, setApprovingToolIds] = useState<ReadonlySet<string>>(() => new Set());
  const [approvalErrors, setApprovalErrors] = useState<Record<string, string>>({});
  const pendingHydrations = useRef(new Map<string, ConversationRunEvent[]>());
  const runKey = JSON.stringify(sessions.filter((session) => !session.isArchived && session.activeRunId !== null)
    .map((session) => [session.id, session.activeRunId]));
  useEffect(() => agentClient.onConversationRunEvent((event) => {
    if (event.type === "tool.started" || event.type === "tool.completed" || event.type === "tool.approval_requested" || event.type === "run.finished") {
      pendingHydrations.current.get(event.conversationId)?.push(event);
      setTools((current) => updateActivityTools(current, event));
      if (event.type === "tool.approval_requested") {
        setApprovalNotice({
          conversationId: event.conversationId,
          runId: event.runId,
          toolId: event.tool.id,
          tool: {
            conversationId: event.conversationId,
            runId: event.runId,
            status: event.tool.status,
            name: event.tool.name,
            createdAt: event.tool.createdAt,
          },
        });
      } else if (event.type === "run.finished") {
        setApprovalNotice((current) => current?.runId === event.runId ? null : current);
      } else if (event.tool.status !== "awaiting_approval") {
        setApprovalNotice((current) => current?.toolId === event.tool.id ? null : current);
      }
    }
  }), [agentClient]);
  useEffect(() => {
    if (approvalNotice === null) return undefined;
    const timeout = window.setTimeout(() => setApprovalNotice(null), 10_000);
    return () => window.clearTimeout(timeout);
  }, [approvalNotice]);
  useEffect(() => {
    let disposed = false;
    // Hydrate only live runs. Page backwards to their boundary; never download every conversation's history.
    const runs: [string, string][] = JSON.parse(runKey) as [string, string][];
    let nextIndex = 0;
    const hydrate = async (): Promise<void> => {
      while (nextIndex < runs.length && !disposed) {
        const [conversationId, runId] = runs[nextIndex++]!;
        const events: ConversationRunEvent[] = [];
        pendingHydrations.current.set(conversationId, events);
        let beforeSequence: number | undefined;
        const found: LiveTools = {};
        try {
          while (!disposed) {
            const page = await agentClient.listConversationTimelinePage({ conversationId, limit: 50,
              ...(beforeSequence === undefined ? {} : { beforeSequence }) });
            for (const item of page.items) {
              if (item.kind === "tool" && item.runId === runId
                && (item.status === "running" || item.status === "awaiting_approval")) found[item.id] = {
                conversationId,
                runId,
                status: item.status,
                name: item.name,
                createdAt: item.createdAt,
              };
            }
            if (!page.hasMore || page.nextBeforeSequence === null || page.nextBeforeSequence === beforeSequence
              || page.items.some((item) => "runId" in item && item.runId !== null && item.runId !== runId)) break;
            beforeSequence = page.nextBeforeSequence;
          }
          if (!disposed) {
            const hydrated = events.reduce(updateActivityTools, found);
            setTools((current) => ({ ...Object.fromEntries(Object.entries(current).filter(([, tool]) => tool.conversationId !== conversationId)), ...hydrated }));
          }
        } catch {
          if (!disposed) setLoadError(true);
        } finally {
          if (pendingHydrations.current.get(conversationId) === events) pendingHydrations.current.delete(conversationId);
        }
      }
    };
    void Promise.all(Array.from({ length: Math.min(4, runs.length) }, hydrate));
    return () => { disposed = true; };
  }, [agentClient, runKey, retry]);
  const rows = conversationActivityRows([...sessions, ...groupSessions], tools);
  const unreadCount = rows.filter((row) => row.group === "未读").length;
  const rowApprovalToolIds = new Set(rows.flatMap((row) => row.approvalToolId === undefined ? [] : [row.approvalToolId]));
  const liveApprovalTools = Object.entries(tools)
    .filter(([, tool]) => tool.status === "awaiting_approval")
    .sort(([, left], [, right]) => (right.createdAt ?? "").localeCompare(left.createdAt ?? ""));
  // Keep the top-level indicator useful while the session tree is still loading.
  // A Subagent approval can arrive before its child session is projected into the navigator.
  const sessionsById = new Map(sessions.map(session => [session.id, session]));
  const representedRoots = new Set(rows.filter(row => row.approvalToolId !== undefined).map(row => row.session.id));
  const unresolvedByConversation = new Map<string, typeof liveApprovalTools[number]>();
  for (const entry of liveApprovalTools) {
    const [toolId, tool] = entry;
    const source = sessionsById.get(tool.conversationId);
    if (rowApprovalToolIds.has(toolId) || (source !== undefined && (source.isArchived
      || source.coordinationTeamInstanceId !== undefined || representedRoots.has(resolveConversationRoot(source, sessionsById).id)))) continue;
    if (!unresolvedByConversation.has(tool.conversationId)) unresolvedByConversation.set(tool.conversationId, entry);
  }
  const unresolvedApprovalTools = [...unresolvedByConversation.values()];
  const approvalCount = rows.filter((row) => row.group === "待处理").length + unresolvedApprovalTools.length;
  const attentionCount = rows.filter((row) => row.group === "未读" || row.group === "待处理").length + unresolvedApprovalTools.length;
  const projectNames = new Map(projects.map((project) => [project.id, project.name]));
  const filtered = rows.filter(({ session }) => `${conversationIdentity(session, agents, teamInstances, sessions).title} ${projectNames.get(session.projectId ?? "") ?? ""}`.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const approvalNoticeSession = approvalNotice === null ? undefined : (() => {
    const byId = new Map(sessions.map((session) => [session.id, session]));
    const source = byId.get(approvalNotice.conversationId);
    return source === undefined ? undefined : resolveConversationRoot(source, byId);
  })();
  const openApproval = async (conversationId: string, toolId: string): Promise<void> => {
    const currentById = new Map(sessions.map((session) => [session.id, session]));
    const currentSource = currentById.get(conversationId);
    if (currentSource !== undefined) {
      onSelect(resolveConversationRoot(currentSource, currentById).id, toolId);
      return;
    }
    try {
      const hierarchy = await agentClient.listConversationHierarchy();
      const hierarchyById = new Map(hierarchy.map((session) => [session.id, session]));
      const source = hierarchyById.get(conversationId);
      onSelect(source === undefined ? conversationId : resolveConversationRoot(source, hierarchyById).id, toolId);
    } catch {
      onSelect(conversationId, toolId);
    }
  };
  const approveActivityTool = async (
    toolId: string,
    tool: LiveTool | undefined,
    scope: ApprovalScope,
  ): Promise<void> => {
    if (tool === undefined || approvingToolIds.has(toolId)) return;
    if (scope === "session" && !canApproveForSession(tool)) return;
    setApprovingToolIds((current) => new Set(current).add(toolId));
    setApprovalErrors((current) => {
      if (!(toolId in current)) return current;
      const next = { ...current };
      delete next[toolId];
      return next;
    });
    try {
      await agentClient.approveToolChange({ approved: true, runId: tool.runId, scope, toolId });
      // The runtime emits tool.started after accepting the decision. Reflect the
      // state immediately as well so a remote/non-current conversation does not
      // keep showing a stale approval while that event is in flight.
      setTools((current) => current[toolId] === undefined ? current : {
        ...current,
        [toolId]: { ...current[toolId], status: "running" },
      });
      setApprovalNotice((current) => current?.toolId === toolId ? null : current);
    } catch (error) {
      const errorCode = error instanceof AgentClientError
        ? error.code
        : parseSerializedAgentError(error)?.code;
      if (errorCode === "APPROVAL_EXPIRED") {
        setTools((current) => {
          if (!(toolId in current)) return current;
          const next = { ...current };
          delete next[toolId];
          return next;
        });
        setApprovalNotice((current) => current?.toolId === toolId ? null : current);
        return;
      }
      setApprovalErrors((current) => ({
        ...current,
        [toolId]: getUserErrorMessage(error, "无法提交审批，请打开来源对话重试"),
      }));
    } finally {
      setApprovingToolIds((current) => {
        if (!current.has(toolId)) return current;
        const next = new Set(current);
        next.delete(toolId);
        return next;
      });
    }
  };
  const unresolvedApprovalItems = unresolvedApprovalTools.map(([toolId, tool]) => ({
    toolId,
    tool,
    session: (() => {
      const byId = new Map(sessions.map((session) => [session.id, session]));
      const source = byId.get(tool.conversationId);
      return source === undefined ? undefined : resolveConversationRoot(source, byId);
    })(),
  }));
  return <>
    <span className="inline-flex items-center gap-0.5">
    <Popover open={open} onOpenChange={(value) => { setOpen(value); if (!value) setQuery(""); }}>
    <PopoverTrigger asChild>
      <button type="button" title={approvalCount > 0 ? `有 ${approvalCount} 个审批待处理` : "对话动态"}
        aria-label={approvalCount > 0 ? `对话动态，${attentionCount} 个待处理，其中 ${approvalCount} 个审批` : `对话动态，${unreadCount} 个未读`} data-app-drag-region="false"
        className="flex h-8 shrink-0 items-center gap-1 rounded-[var(--app-radius)] px-2 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)]">
        <MessageSquareText size={15} />{approvalCount > 0 ? <ShieldAlert size={14} aria-label="有待处理审批" className="text-[var(--app-accent)]" /> : null}<span className="max-[700px]:hidden">对话动态</span>
        {attentionCount > 0 ? <span className={approvalCount > 0
          ? "rounded-full bg-[var(--app-selection)] px-1.5 text-[var(--app-accent)]"
          : "rounded-full bg-[var(--app-accent)] px-1.5 text-[var(--app-accent-foreground)]"}>{attentionCount}</span> : null}
        <ChevronDown size={12} />
      </button>
    </PopoverTrigger>
    <PopoverContent side="bottom" align="end" sideOffset={5} aria-label="对话动态列表"
      className="w-[340px] max-w-[calc(100vw-20px)] rounded-[var(--app-radius-large)] border border-[var(--app-border)] bg-[var(--app-panel)] p-2 text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] shadow-lg">
      <label className="app-search-field"><Search size={14} /><input aria-label="搜索动态对话" placeholder="搜索对话或项目" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
      {loadError || groupLoadError ? <p role="status" className="py-1 text-[var(--app-muted-foreground)]">部分动态暂不可用 <button type="button" className="text-[var(--app-accent)]" onClick={() => { setLoadError(false); setRetry((value) => value + 1); }}>重试</button></p> : null}
      <div className="max-h-[min(480px,65vh)] overflow-y-auto">
        {(["待处理", "未读", "进行中"] as const).map((group) => {
          const items = filtered.filter((row) => row.group === group);
          const showUnresolvedApprovals = group === "待处理" && unresolvedApprovalItems.length > 0;
          return items.length === 0 && !showUnresolvedApprovals ? null : <section key={group} aria-label={group}>
            <h3 className="my-1 bg-[var(--app-panel-subtle)] px-2 py-1 text-[length:var(--app-font-size-control)]">{group} · {items.length + (showUnresolvedApprovals ? unresolvedApprovalItems.length : 0)}</h3>
            {items.map(({ session, status, updatedAt, unreadSession, approvalToolId }) => {
              const identity = conversationIdentity(session, agents, teamInstances, sessions);
              return (
              <div key={session.id} className="rounded-[var(--app-radius)] px-2 py-1 hover:bg-[var(--app-hover)]">
                <div className="flex items-center gap-1">
                  <button type="button" aria-label={`${identity.title}，${status}`} onClick={() => {
                    setOpen(false); setQuery("");
                    if (approvalToolId !== undefined) onSelect(session.id, approvalToolId);
                    else if (unreadSession !== undefined && unreadSession.id !== session.id) onSelect(unreadSession.id, undefined, session.id);
                    else onSelect(session.id);
                  }}
                    className="flex min-w-0 flex-1 items-center gap-2 py-1 text-left">
                    {group === "进行中" ? <ConversationWorkIndicator runId={session.activeRunId} size={14} />
                      : <span aria-label={status} className={`size-1.5 shrink-0 rounded-full ${group === "待处理" ? "bg-[var(--app-accent)]"
                        : status === "运行失败，待查看" ? "bg-[var(--app-status-danger-fg)]" : "bg-[var(--app-status-success-fg)]"}`} />}
                    <ConversationIdentityIcon session={session} identity={identity} />
                    <span className="min-w-0 flex-1 truncate font-medium">{identity.title}</span>
                    {updatedAt ? <time className="shrink-0 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]"
                      dateTime={updatedAt} title={formatConversationDateTime(updatedAt)}>{formatConversationTime(updatedAt)}</time> : null}
                    {group === "待处理" ? <span className="shrink-0 rounded-[var(--app-radius-small)] bg-[var(--app-selection)] px-1.5 py-0.5 text-[length:var(--app-font-size-caption)] text-[var(--app-accent)]">审批</span> : null}
                  </button>
                  {group === "待处理" && approvalToolId !== undefined ? (
                    <ActivityApprovalActions
                      toolId={approvalToolId}
                      tool={tools[approvalToolId]}
                      isApproving={approvingToolIds.has(approvalToolId)}
                      onApprove={(scope) => void approveActivityTool(approvalToolId, tools[approvalToolId], scope)}
                    />
                  ) : null}
                </div>
                {approvalToolId !== undefined && approvalErrors[approvalToolId] !== undefined ? (
                  <p className="px-1 pb-1 text-[length:var(--app-font-size-caption)] text-[var(--app-status-danger-fg)]" role="status">{approvalErrors[approvalToolId]}</p>
                ) : null}
              </div>
            ); })}
            {showUnresolvedApprovals ? unresolvedApprovalItems.map(({ toolId, tool, session }) => (
              <div key={toolId} className="rounded-[var(--app-radius)] px-2 py-1 hover:bg-[var(--app-hover)]">
                <div className="flex items-start gap-1">
                  <button type="button"
                    onClick={() => { setOpen(false); setQuery(""); void openApproval(tool.conversationId, toolId); }}
                    className="flex min-w-0 flex-1 items-start gap-2 py-1 text-left">
                    <ShieldAlert size={14} className="mt-0.5 shrink-0 text-[var(--app-accent)]" />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium">{session?.title ?? "Subagent 审批"}</span>
                      <span className="block truncate text-[var(--app-muted-foreground)]">等待审批 · 正在同步对话</span></span>
                    <span className="shrink-0 rounded-[var(--app-radius-small)] bg-[var(--app-selection)] px-1.5 py-0.5 text-[length:var(--app-font-size-caption)] text-[var(--app-accent)]">审批</span>
                  </button>
                  <ActivityApprovalActions
                    toolId={toolId}
                    tool={tool}
                    isApproving={approvingToolIds.has(toolId)}
                    onApprove={(scope) => void approveActivityTool(toolId, tool, scope)}
                  />
                </div>
                {approvalErrors[toolId] !== undefined ? <p className="px-1 pb-1 text-[length:var(--app-font-size-caption)] text-[var(--app-status-danger-fg)]" role="status">{approvalErrors[toolId]}</p> : null}
              </div>
            )) : null}
          </section>;
        })}
        {filtered.length === 0 && unresolvedApprovalItems.length === 0 ? <p className="px-2 py-5 text-[var(--app-muted-foreground)]">{query ? "没有匹配的对话" : "暂无需要关注的对话"}</p> : null}
      </div>
    </PopoverContent>
    </Popover>
    {liveApprovalTools[0] === undefined ? null : (
      <ActivityApprovalActions
        compact
        toolId={liveApprovalTools[0][0]}
        tool={liveApprovalTools[0][1]}
        isApproving={approvingToolIds.has(liveApprovalTools[0][0])}
        onApprove={(scope) => void approveActivityTool(liveApprovalTools[0]![0], liveApprovalTools[0]![1], scope)}
      />
    )}
    {approvalNotice !== null ? createPortal(
      <div role="alert" data-app-drag-region="false" data-native-view-overlay="" data-native-overlay-interactive="false"
        className="fixed right-3 top-12 z-[110] flex w-[min(360px,calc(100vw-24px))] items-start gap-2 rounded-[var(--app-radius-large)] border border-[var(--app-border)] bg-[var(--app-panel)] p-2 shadow-xl">
        <button type="button" className="flex min-w-0 flex-1 items-start gap-2 rounded-[var(--app-radius)] p-1 text-left hover:bg-[var(--app-hover)]"
          onClick={() => { const notice = approvalNotice; setApprovalNotice(null); void openApproval(notice.conversationId, notice.toolId); }}>
          <ShieldAlert size={17} className="mt-0.5 shrink-0 text-[var(--app-accent)]" />
          <span className="min-w-0 flex-1"><span className="block font-medium">需要权限审批</span>
            <span className="block truncate text-[var(--app-muted-foreground)]">{approvalNoticeSession?.title ?? "Subagent 对话"} · 点击查看审批</span>
            {approvalErrors[approvalNotice.toolId] !== undefined ? <span className="mt-1 block text-[length:var(--app-font-size-caption)] text-[var(--app-status-danger-fg)]" role="status">{approvalErrors[approvalNotice.toolId]}</span> : null}</span>
        </button>
        <ActivityApprovalActions
          toolId={approvalNotice.toolId}
          tool={tools[approvalNotice.toolId] ?? approvalNotice.tool}
          isApproving={approvingToolIds.has(approvalNotice.toolId)}
          onApprove={(scope) => void approveActivityTool(
            approvalNotice.toolId,
            tools[approvalNotice.toolId] ?? approvalNotice.tool,
            scope,
          )}
        />
        <button type="button" aria-label="关闭审批提示" className="rounded-[var(--app-radius-small)] p-1 text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] hover:text-[var(--app-foreground)]"
          onClick={() => setApprovalNotice(null)}><X size={14} /></button>
      </div>,
      nativeOverlayContainer ?? document.body,
    ) : null}
    </span>
  </>;
}

function ActivityApprovalActions({
  compact = false,
  toolId,
  tool,
  isApproving,
  onApprove,
}: {
  compact?: boolean;
  toolId: string;
  tool: LiveTool | undefined;
  isApproving: boolean;
  onApprove: (scope: ApprovalScope) => void;
}) {
  if (tool === undefined) return null;
  const buttonClass = compact
    ? "rounded-[var(--app-radius-small)] bg-[var(--app-selection)] p-1 text-[var(--app-accent)] outline-none transition-colors hover:bg-[var(--app-selection)] focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)] disabled:cursor-wait disabled:opacity-60"
    : "rounded-[var(--app-radius-small)] p-1 text-[var(--app-accent)] outline-none transition-colors hover:bg-[var(--app-selection)] focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)] disabled:cursor-wait disabled:opacity-60";
  return (
    <span
      aria-label={`${toolApprovalLabel(tool)}审批快捷操作`}
      className={compact ? "flex shrink-0 items-center gap-0.5" : "ml-1 flex shrink-0 items-center gap-0.5"}
      data-tool-id={toolId}
      data-app-drag-region="false"
      role="group"
      onClick={(event) => event.stopPropagation()}
    >
      <button
        aria-label="允许一次"
        className={buttonClass}
        disabled={isApproving}
        title="允许一次"
        type="button"
        onClick={() => onApprove("once")}
      >
        {isApproving ? <Spinner aria-hidden="true" size={14} /> : <Check aria-hidden="true" size={14} />}
      </button>
      {canApproveForSession(tool) ? (
        <button
          aria-label="本对话允许"
          className={buttonClass}
          disabled={isApproving}
          title="本对话允许"
          type="button"
          onClick={() => onApprove("session")}
        >
          <ShieldCheck aria-hidden="true" size={14} />
        </button>
      ) : null}
    </span>
  );
}
