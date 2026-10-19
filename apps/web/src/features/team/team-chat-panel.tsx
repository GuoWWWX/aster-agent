import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";
import type { ConversationSummary, PostTeamChatInput, TeamChatMember, TeamChatMessage, TeamChatActivity } from "@agent/protocol";
import { ExternalLink, MessageSquareReply, Workflow, UsersRound } from "lucide-react";
import type { AgentClient } from "../../runtime/agent-client.js";
import { AgentMarkdown, AgentMarkdownWorkspaceScope } from "../../components/markdown/agent-markdown.js";
import { HtmlPreviewCard, HtmlPreviewScope } from "../../components/html-preview/html-preview-card.js";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { ChatMessageBubble } from "../chat/chat-message-bubble.js";
import { ChatMessageMeta } from "../chat/chat-message-meta.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { UserMessageContent } from "../chat/user-message-content.js";
import { MessageReferenceQuote } from "../../components/markdown/message-reference-quote.js";
import { AgentAvatar, SubagentAvatar } from "./agent-avatar.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";

const deliveryLabels = { pending: "待处理", delivered: "已送达", consumed: "处理中", completed: "处理结束", failed: "处理失败", cancelled: "已取消" };

export function TeamChatPanel({ agentClient, teamInstanceId, onOpenConversation, focusMessageId, active = true, composerClearance = 0,
  onEditMessage, onReplyMessage, onOpenFile, editingMessageId, onCoordinatorLoaded, onActivityLoaded }: {
  agentClient: AgentClient; teamInstanceId: string; focusMessageId?: string; active?: boolean; composerClearance?: number;
  onOpenConversation: (conversation: ConversationSummary, messageId?: string) => void;
  onEditMessage?: (message: TeamChatMessage) => void; editingMessageId?: string | null;
  onReplyMessage?: (message: TeamChatMessage) => void;
  onOpenFile?: (conversationId: string, path: string) => void;
  onCoordinatorLoaded?: (coordinator: PostTeamChatInput["coordinator"] | null) => void;
  onActivityLoaded?: (activity: TeamChatActivity | null) => void;
}): ReactElement {
  const [messages, setMessages] = useState<TeamChatMessage[]>([]); const [members, setMembers] = useState<TeamChatMember[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const agents = useAgentDirectoryStore(state => state.agents);
  const navigationTarget = useWorkbenchUiStore(state => state.teamChatTarget);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null);
  const viewport = useRef<HTMLDivElement>(null);
  const messageList = useRef<HTMLOListElement>(null);
  const atBottom = useRef(focusMessageId === undefined); const hasLoaded = useRef(false);
  const revealedMessage = useRef<string | undefined>(undefined);
  const revealedNavigation = useRef<typeof navigationTarget>(null);
  const latestOwnSequence = useRef<number | null>(null);
  const loadVersion = useRef(0);
  const needsRefresh = useRef(true);
  const load = useCallback(async (beforeSequence?: number) => {
    if (beforeSequence === undefined) needsRefresh.current = true;
    const version = ++loadVersion.current;
    try {
      const page = await agentClient.readTeamChat({ teamInstanceId, ...(beforeSequence === undefined ? {} : { beforeSequence }) });
      if (version !== loadVersion.current) return;
      if (!hasLoaded.current) onCoordinatorLoaded?.(page.coordinator ?? null);
      onActivityLoaded?.(page.activity ?? null);
      setMessages(previous => [...new Map([...previous, ...page.messages].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence));
      if (beforeSequence !== undefined || !hasLoaded.current) setCursor(page.nextBeforeSequence);
      hasLoaded.current = true;
      if (beforeSequence === undefined) needsRefresh.current = false;
      if (active && beforeSequence === undefined && atBottom.current && page.messages.length > 0 && document.visibilityState === "visible") {
        await agentClient.markTeamChatRead({ teamInstanceId, throughSequence: page.messages.at(-1)!.sequence });
      }
      setError(null);
    } catch (reason) { if (version === loadVersion.current) setError(reason instanceof Error ? reason.message : "群聊加载失败"); }
  // Existing pages are retained when new messages arrive; pagination owns the older cursor.
  }, [agentClient, teamInstanceId, active, onCoordinatorLoaded, onActivityLoaded]);
  useEffect(() => {
    let disposed = false;
    void Promise.all([agentClient.getTeamChatMembers({ teamInstanceId }), agentClient.listConversationHierarchy()]).then(([roster, hierarchy]) => {
      if (!disposed) { setMembers(roster); setConversations(hierarchy); }
    }).catch(reason => { if (!disposed) setError(String(reason)); });
    return () => { disposed = true; };
  }, [agentClient, teamInstanceId]);
  useEffect(() => {
    if (active && (!hasLoaded.current || needsRefresh.current)) void Promise.resolve().then(() => load());
    return () => { loadVersion.current += 1; };
  }, [load, active]);
  useEffect(() => agentClient.onConversationRunEvent(event => {
    if (event.type === "collaboration.changed" && event.reason === "read") return;
    if (event.type !== "collaboration.changed" && event.type !== "run.finished" && event.type !== "run.started") return;
    const memberEvent = members.some(member => member.conversationId === event.conversationId);
    const relevant = event.type === "collaboration.changed"
      ? event.teamInstanceId === teamInstanceId || (event.teamInstanceId === undefined && memberEvent)
      : memberEvent;
    if (!relevant) return;
    if (!active) { needsRefresh.current = true; return; }
    if (event.type === "collaboration.changed") {
      if (event.teamInstanceId === teamInstanceId || (event.teamInstanceId === undefined && memberEvent)) void load();
    } else if (memberEvent) {
      void load();
    }
  }), [agentClient, load, teamInstanceId, members, active]);
  useLayoutEffect(() => {
    if (!active) return;
    const messageId = focusMessageId ?? (navigationTarget?.instanceId === teamInstanceId ? navigationTarget.messageId : undefined);
    if (messageId !== undefined && navigationTarget?.instanceId === teamInstanceId && revealedNavigation.current !== navigationTarget) {
      revealedNavigation.current = navigationTarget;
      revealedMessage.current = undefined;
    }
    const ownSequence = messages.findLast(message => message.senderConversationId === null)?.sequence ?? null;
    if (ownSequence !== null && latestOwnSequence.current !== null && ownSequence > latestOwnSequence.current) {
      atBottom.current = true;
      revealedMessage.current = focusMessageId;
    }
    latestOwnSequence.current = ownSequence;
    if (messageId !== undefined && revealedMessage.current !== messageId) {
      atBottom.current = false;
      const target = viewport.current?.querySelector(`[data-group-message="${CSS.escape(messageId)}"]`);
      if (target) { target.scrollIntoView({ block: "center" }); revealedMessage.current = messageId; return; }
      if (cursor !== null) { void Promise.resolve().then(() => load(cursor)); return; }
    }
    if (atBottom.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [messages, focusMessageId, navigationTarget, teamInstanceId, cursor, load, active, composerClearance]);
  useLayoutEffect(() => {
    if (!active || messageList.current === null || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      if (atBottom.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight;
    });
    observer.observe(messageList.current);
    return () => observer.disconnect();
  }, [active]);

  const openProcess = async (conversationId: string, runId: string | null) => {
    try {
      const conversation = (await agentClient.listConversationHierarchy()).find(item => item.id === conversationId);
      if (!conversation) throw new Error("成员对话已删除");
      let timeline = await agentClient.listConversationTimelinePage({ conversationId, limit: 100 });
      let source = timeline.items.find(item => "runId" in item && item.runId === runId);
      while (source === undefined && runId !== null && timeline.nextBeforeSequence !== null) {
        timeline = await agentClient.listConversationTimelinePage({ conversationId, beforeSequence: timeline.nextBeforeSequence, limit: 100 });
        source = timeline.items.find(item => "runId" in item && item.runId === runId);
      }
      onOpenConversation(conversation, source?.id);
    } catch (reason) { setError(String(reason)); }
  };
  const memberReferences = (message: TeamChatMessage) => {
    const references = new Map<string, { member: TeamChatMember; conversation: ConversationSummary }>();
    for (const id of message.recipientConversationIds) {
      const member = members.find(item => item.conversationId === id);
      const conversation = conversations.find(item => item.id === id);
      if (member === undefined || conversation === undefined) continue;
      references.set(`@${conversation.title}`, { member, conversation });
      references.set(`@${member.name}`, { member, conversation });
    }
    const result = [...references].map(([label, { member, conversation }]) => {
      const avatar = agents.find(item => item.id === conversation.agentId)?.avatar
        ?? (conversation.avatarIcon ? { kind: "icon" as const, icon: conversation.avatarIcon } : null);
      return { label, content: <button type="button" aria-label={`打开成员 ${member.name} 的对话`} title={`打开 ${member.name} 的对话`}
          onClick={() => onOpenConversation(conversation)}
          className="inline-flex max-w-full items-center gap-[5px] rounded-[var(--app-radius-small)] align-middle text-[var(--app-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
          {avatar === null ? <SubagentAvatar icon={null} seed={member.conversationId} size="compact" /> : <AgentAvatar avatar={avatar} size="compact" />}
          <span className="min-w-0 truncate">@{member.name}</span>
        </button> };
    });
    if (message.allMembers) result.push({ label: "@全体成员", content: <button type="button" className="inline-flex items-center gap-[5px] align-middle text-[var(--app-accent)] hover:underline"
      onClick={() => useWorkbenchUiStore.getState().openTeamChatDetails({ instanceId: teamInstanceId, section: "info" })}><UsersRound size={14} />@全体成员</button> });
    return result;
  };
  const superseded = new Set(messages.flatMap(message => message.supersedesId ? [message.supersedesId] : []));
  const latestUserId = messages.findLast(message => message.senderConversationId === null)?.id;
  const copyMessage = async (message: TeamChatMessage) => {
    try { await navigator.clipboard.writeText(message.content); setCopiedMessageId(message.id); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "复制失败"); }
  };
  return <section aria-label="团队群聊" className="flex min-h-0 min-w-0 flex-1 flex-col gap-[5px] text-[length:var(--app-font-size-control)]">
    {error === null ? null : <p role="alert" className="m-0 text-[var(--app-destructive)]">{error}<button type="button" onClick={() => void load()} className="ml-2 underline">重试读取</button></p>}
    <div ref={viewport} role="log" aria-label="群消息" className="conversation-workspace__messages" style={{ scrollPaddingBottom: composerClearance }} onScroll={() => { const element = viewport.current; if (element) { atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 32; const last = messages.at(-1); if (active && atBottom.current && last && document.visibilityState === "visible") void agentClient.markTeamChatRead({ teamInstanceId, throughSequence: last.sequence }).catch(reason => setError(String(reason))); } }}>
      {cursor === null ? null : <button type="button" className="my-2 underline" onClick={() => void load(cursor)}>加载更早消息</button>}
      {messages.length === 0 ? <p className="text-[var(--app-muted-foreground)]">暂无群消息。可以直接提问，或输入 @ 选择需要回答的成员。</p> : null}
      <ol ref={messageList} data-group-message-list className="m-0 flex list-none flex-col gap-5 p-0">{messages.filter(message => !superseded.has(message.id)).map(message => {
        const role = message.senderConversationId === null ? "user" : "assistant";
        const references = memberReferences(message);
        const conversation = conversations.find(item => item.id === message.senderConversationId);
        const agent = agents.find(item => item.id === conversation?.agentId);
        const avatar = agent?.avatar ?? (conversation?.avatarIcon ? { kind: "icon" as const, icon: conversation.avatarIcon } : null);
        const replySource = message.replyToId === null ? undefined : messages.find(item => item.id === message.replyToId);
        const replyConversation = conversations.find(item => item.id === replySource?.senderConversationId);
        const replyAvatar = agents.find(item => item.id === replyConversation?.agentId)?.avatar
          ?? (replyConversation?.avatarIcon ? { kind: "icon" as const, icon: replyConversation.avatarIcon } : null);
        const showReplyQuote = message.replyToId !== null && (role === "user" || replySource === undefined || messages.filter(item =>
          item.sequence > replySource.sequence && item.sequence < message.sequence && item.rootMessageId !== message.rootMessageId).length >= 4);
        return <li key={message.id} data-group-message={message.id} data-role={role} className="chat-message-group">
        {role === "user" ? null : <div data-group-sender className="mb-[5px] flex min-w-0 items-center gap-[5px] text-[var(--app-muted-foreground)]">
          <span aria-label={`${message.senderName}图标`}>{avatar === null ? <SubagentAvatar icon={null} seed={message.senderConversationId!} size="compact" /> : <AgentAvatar avatar={avatar} size="compact" />}</span>
          <strong className="min-w-0 truncate">{message.senderName}</strong>
        </div>}
        <ChatMessageBubble role={role} enclosed={role === "assistant"}>
          {showReplyQuote ? <MessageReferenceQuote senderName={replySource?.senderName ?? "较早的群消息"} content={replySource?.content ?? "点击查看原消息"}
            avatar={replySource?.senderConversationId == null ? undefined : replyAvatar === null
              ? <SubagentAvatar icon={null} seed={replySource.senderConversationId} size="compact" /> : <AgentAvatar avatar={replyAvatar} size="compact" />}
            onOpen={() => useWorkbenchUiStore.getState().openTeamChat({ instanceId: teamInstanceId, messageId: message.replyToId! })} /> : null}
          {role === "user" ? <UserMessageContent content={message.content} inlineReferences={references} />
            : <AgentMarkdownWorkspaceScope onOpenFile={onOpenFile === undefined ? undefined : path => onOpenFile(message.fileReferences?.find(file => file.path === path)?.conversationId ?? message.senderConversationId!, path)}>
              <HtmlPreviewScope client={agentClient} conversationId={message.senderConversationId!}><AgentMarkdown content={message.content} inlineReferences={references} /></HtmlPreviewScope>
            </AgentMarkdownWorkspaceScope>}
          {message.fileReferences?.map(file => <GroupFileReference key={file.path} file={file} agentClient={agentClient} active={active}
            senderName={members.find(member => member.conversationId === file.conversationId)?.name ?? "原作者"} onOpenFile={onOpenFile} />)}
        </ChatMessageBubble>
        <ChatMessageMeta role={role} content={message.content} createdAt={message.createdAt} completedAt={message.createdAt}
          copied={copiedMessageId === message.id} editing={editingMessageId === message.id} onCopy={() => void copyMessage(message)}
          {...(role === "user" && message.id === latestUserId && onEditMessage !== undefined
            && message.coordinator?.status !== "pending" && !message.deliveries.some(delivery => ["consumed", "delivered"].includes(delivery.status))
            ? { onEdit: () => onEditMessage(message) } : {})}>
          {onReplyMessage === undefined || role === "user" ? null : <IconButton label={`回复 ${message.senderName} 的消息`} size="compact" variant="quiet" onClick={() => onReplyMessage(message)}><MessageSquareReply size={14} /></IconButton>}
          {message.sourceRunId && message.senderConversationId ? <IconButton label="查看工作过程" size="compact" type="button" variant="quiet"
            onClick={() => void openProcess(message.senderConversationId!, message.sourceRunId)}><ExternalLink aria-hidden="true" size={14} /></IconButton> : null}
          {message.coordinator != null ? <IconButton label="查看协调过程" size="compact" variant="quiet"
            onClick={() => useWorkbenchUiStore.getState().openTeamChatCoordination({ instanceId: teamInstanceId, agentId: message.coordinator!.agentId, ...(message.coordinator!.userMessageId === undefined ? {} : { timelineItemId: message.coordinator!.userMessageId }), messageId: message.id, sequence: message.sequence })}><Workflow size={14} /></IconButton> : null}
        </ChatMessageMeta>
        {message.coordinator?.status === "failed" || message.coordinator?.status === "pending" || message.coordinator?.status === "paused" ? <div className="flex flex-wrap items-center gap-[5px] text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">
          {message.coordinator.status === "paused" ? <span>协调已暂停</span> : null}
          {message.coordinator.status === "failed" ? <span className="text-[var(--app-destructive)]">{message.coordinator.error ?? "协调失败"}</span> : null}
          <button type="button" className="hover:underline" onClick={() => { void agentClient.resumeTeamChatDelivery({ id: message.id }).then(() => load()).catch(reason => setError(String(reason))); }}>{message.coordinator.status === "failed" ? "重试协调" : "继续协调"}</button>
        </div> : null}
        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">{message.deliveries.filter(delivery => delivery.status !== "completed" && delivery.status !== "consumed" && delivery.status !== "delivered").map(delivery => <span key={delivery.id}>
          @{members.find(member => member.conversationId === delivery.conversationId)?.name ?? "成员"} · {deliveryLabels[delivery.status]}
          {delivery.error ? <span className="ml-1 text-[var(--app-destructive)]">{delivery.error}</span> : null}
          {delivery.runId ? <button type="button" className="ml-1 hover:underline" onClick={() => void openProcess(delivery.conversationId, delivery.runId)}>过程</button> : null}
          {delivery.status === "pending" && delivery.error ? <button type="button" className="ml-1 hover:underline" onClick={() => { void agentClient.resumeTeamChatDelivery({ id: delivery.id }).then(() => load()).catch(reason => setError(String(reason))); }}>继续投递</button> : null}
          {delivery.status === "pending" ? <button type="button" className="ml-1 hover:underline" onClick={() => { void agentClient.cancelTeamChatDelivery({ id: delivery.id }).then(() => load()).catch(reason => setError(String(reason))); }}>取消投递</button> : null}
        </span>)}</div>
      </li>; })}</ol>
      <div aria-hidden="true" className="w-full shrink-0" style={{ height: `${composerClearance}px` }} />
    </div>
  </section>;
}

function GroupFileReference({ file, agentClient, active, senderName, onOpenFile }: {
  file: NonNullable<TeamChatMessage["fileReferences"]>[number]; agentClient: AgentClient; active: boolean; senderName: string;
  onOpenFile: ((conversationId: string, path: string) => void) | undefined;
}): ReactElement {
  const [preview, setPreview] = useState(false);
  const visual = /\.html?$/iu.test(file.path);
  return <div className="mt-[5px] flex min-w-0 flex-col gap-[5px] border-t border-[var(--app-border)] pt-[5px]" data-group-file-source={file.conversationId}>
    <button type="button" disabled={onOpenFile === undefined} aria-label={`打开原始成果 ${file.path}`} onClick={() => onOpenFile?.(file.conversationId, file.path)}
      className="inline-flex min-w-0 items-center gap-[5px] text-left text-[var(--app-accent)] hover:underline"><FileTypeIcon path={file.path} size={14} /><span className="min-w-0 truncate">{file.path.split("/").at(-1)}</span></button>
    <span className="truncate text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">成果来源：{senderName}</span>
    {visual ? <button type="button" className="self-start text-[var(--app-accent)] hover:underline" aria-expanded={preview} onClick={() => setPreview(value => !value)}>{preview ? "收起预览" : "预览页面"}</button> : null}
    {visual && preview ? <HtmlPreviewScope client={agentClient} conversationId={file.conversationId}><HtmlPreviewCard embedded suspended={!active} source={{ kind: "file", path: file.path }} /></HtmlPreviewScope> : null}
  </div>;
}
