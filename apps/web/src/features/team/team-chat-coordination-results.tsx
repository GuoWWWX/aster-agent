import { useEffect, useState, type ReactElement } from "react";
import { ExternalLink, Workflow, X } from "lucide-react";
import type { ConversationSummary, TeamChatMember, TeamChatPage } from "@agent/protocol";
import { IconButton } from "../../components/ui/icon-button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";
import { LoadingState } from "../../components/ui/loading.js";
import type { AgentClient } from "../../runtime/agent-client.js";
import { getUserErrorMessage } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { formatConversationTime } from "../chat/chat-message-meta.js";
import { AgentAvatar, SubagentAvatar } from "./agent-avatar.js";

const coordinationLabels = { pending: "正在协调", completed: "已分流", failed: "协调失败", cancelled: "已取消", paused: "已暂停" };

export function TeamChatCoordinationResults({ agentClient, teamInstanceId, active }: {
  agentClient: AgentClient; teamInstanceId: string; active: boolean;
}): ReactElement {
  const [open, setOpen] = useState(false);
  return <Popover open={open && active} onOpenChange={setOpen}>
    <PopoverTrigger asChild><button type="button" aria-label="查看协调结果" title="查看协调结果"
      className="inline-flex shrink-0 items-center gap-[5px] rounded-[var(--app-radius)] px-2 py-1 text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
      <Workflow size={14} /><span>协调结果</span>
    </button></PopoverTrigger>
    <PopoverContent side="bottom" align="end" className="flex w-[420px] max-w-[calc(100vw-20px)] flex-col overflow-hidden rounded-[var(--app-radius-large)] border border-[var(--app-border)] bg-[var(--app-panel)] text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] shadow-lg">
      <CoordinationResults agentClient={agentClient} teamInstanceId={teamInstanceId} onClose={() => setOpen(false)} />
    </PopoverContent>
  </Popover>;
}

function CoordinationResults({ agentClient, teamInstanceId, onClose }: {
  agentClient: AgentClient; teamInstanceId: string; onClose: () => void;
}): ReactElement {
  const [page, setPage] = useState<TeamChatPage | null>(null);
  const [members, setMembers] = useState<TeamChatMember[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const agents = useAgentDirectoryStore(state => state.agents);
  useEffect(() => {
    let disposed = false; let reading = false; let readAgain = false;
    const load = async (): Promise<void> => {
      if (disposed) return;
      if (reading) { readAgain = true; return; }
      reading = true;
      try {
        const [latest, roster, hierarchy] = await Promise.all([agentClient.readTeamChat({ teamInstanceId, limit: 50 }), agentClient.getTeamChatMembers({ teamInstanceId }), agentClient.listConversationHierarchy()]);
        if (!disposed) { setPage(latest); setMembers(roster); setConversations(hierarchy); setError(null); }
      } catch (reason) {
        if (!disposed) setError(getUserErrorMessage(reason, "协调结果读取失败，请重试"));
      } finally {
        reading = false;
        if (readAgain && !disposed) { readAgain = false; void load(); }
      }
    };
    void Promise.resolve().then(load);
    const unsubscribe = agentClient.onConversationRunEvent(event => {
      if (event.type === "collaboration.changed" && event.teamInstanceId === teamInstanceId) void load();
    });
    return () => { disposed = true; unsubscribe(); };
  }, [agentClient, teamInstanceId, revision]);
  const openConversation = (message?: TeamChatPage["messages"][number]): void => {
    const coordinator = message?.coordinator;
    useWorkbenchUiStore.getState().openTeamChatCoordination({ instanceId: teamInstanceId,
      ...(coordinator === undefined || coordinator === null ? {} : { agentId: coordinator.agentId }),
      ...(message === undefined ? {} : { messageId: message.id, sequence: message.sequence }),
      ...(coordinator?.userMessageId === undefined ? {} : { timelineItemId: coordinator.userMessageId }),
    });
    onClose();
  };
  const superseded = new Set(page?.messages.flatMap(message => message.supersedesId ? [message.supersedesId] : []));
  const messages = page?.messages.filter(message => message.coordinator != null && !superseded.has(message.id)).toReversed() ?? [];
  return <section aria-label="协调结果" className="flex min-h-0 flex-col">
    <header className="flex shrink-0 items-center gap-[5px] border-b border-[var(--app-border)] px-3 py-[5px]">
      <strong className="min-w-0 flex-1">协调结果</strong>
      <button type="button" className="inline-flex items-center gap-[5px] rounded-[var(--app-radius)] px-2 py-1 text-[var(--app-accent)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]" onClick={() => openConversation()}><ExternalLink size={14} />完整对话</button>
      <IconButton label="关闭协调结果" size="compact" onClick={onClose}><X size={14} /></IconButton>
    </header>
    <div className="max-h-[min(520px,60vh)] min-h-0 overflow-y-auto overscroll-contain p-3">
      {error === null ? null : <p role="alert" className="mb-[5px] break-words text-[var(--app-destructive)]">{error}
        <button type="button" aria-label="重试读取协调结果" className="ml-[5px] underline" onClick={() => setRevision(value => value + 1)}>重试读取</button></p>}
      {page === null && error === null ? <LoadingState label="正在读取协调结果" /> : null}
      {page !== null && messages.length === 0 ? <p className="text-[var(--app-muted-foreground)]">暂无协调结果</p> : null}
      <ol className="m-0 flex list-none flex-col gap-[5px] p-0">{messages.map(message => {
        const coordinator = message.coordinator!;
        const agent = agents.find(item => item.id === coordinator.agentId);
        const detailsHint = `查看完整协调过程 · ${message.intent === "notify" ? "仅通知" : coordinationLabels[coordinator.status]} · ${formatConversationTime(message.createdAt)}`;
        return <li key={message.id} className="min-w-0 rounded-[var(--app-radius)] border border-[var(--app-border)] p-2">
          <div className="mb-[5px] flex min-w-0 items-center gap-[5px] text-[var(--app-muted-foreground)]">
            {agent === undefined ? <Workflow size={14} className="shrink-0" /> : <AgentAvatar avatar={agent.avatar} size="compact" />}
            <span className="min-w-0 flex-1 truncate">{agent?.name ?? "群聊归属 Agent"}</span>
            <IconButton label="查看这条消息的完整协调对话" tooltip={detailsHint} aria-description={detailsHint} size="compact"
              className={coordinator.status === "failed" ? "text-[var(--app-destructive)]" : "text-[var(--app-accent)]"}
              onClick={() => openConversation(message)}><ExternalLink size={14} /></IconButton>
          </div>
          <p className="m-0 line-clamp-2 break-words font-medium" title={message.content}>{message.content}</p>
          {coordinator.error === null ? null : <p className="my-[5px] break-words text-[var(--app-destructive)]">{coordinator.error}</p>}
          {message.recipientConversationIds.length === 0 ? null : <ul className="mb-0 mt-[5px] flex list-none flex-wrap items-center gap-[5px] p-0" aria-label="接收成员">{message.recipientConversationIds.map(id => {
            const member = members.find(item => item.conversationId === id);
            const conversation = conversations.find(item => item.id === id);
            const profile = agents.find(item => item.id === conversation?.agentId);
            const name = member?.name ?? "已移除成员";
            return <li key={id} className="min-w-0 max-w-full">
              <span role="img" tabIndex={0} aria-label={name}
                className="group inline-flex max-w-full items-center rounded-[var(--app-radius)] align-middle text-[var(--app-accent)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
                {profile ? <AgentAvatar avatar={profile.avatar} size="compact" /> : <SubagentAvatar icon={conversation?.avatarIcon ?? null} seed={id} size="compact" />}
                <span className="max-w-0 truncate opacity-0 transition-[max-width,opacity,margin] duration-150 group-hover:ml-[5px] group-hover:max-w-40 group-hover:opacity-100 group-focus-visible:ml-[5px] group-focus-visible:max-w-40 group-focus-visible:opacity-100 motion-reduce:transition-none">{name}</span>
              </span>
            </li>;
          })}</ul>}
          {message.deliveries.filter(delivery => delivery.error).map(delivery => <p key={delivery.id} className="mb-0 mt-[5px] break-words text-[var(--app-destructive)]">{members.find(member => member.conversationId === delivery.conversationId)?.name ?? "已移除成员"}：{delivery.error}</p>)}
        </li>;
      })}</ol>
      {page?.nextBeforeSequence == null ? null : <p className="mb-0 mt-2 text-[var(--app-muted-foreground)]">显示最近 50 条群消息中的协调结果。查看更早记录请打开完整对话。</p>}
    </div>
  </section>;
}
