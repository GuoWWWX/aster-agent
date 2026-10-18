import { BookOpenText, MessageSquareText } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { conversationIdSchema, type ConversationMessageItem, type ConversationSummary } from "@agent/protocol";
import { UserMessageContent } from "../chat/user-message-content.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { TooltipAnchor } from "../../components/ui/tooltip.js";
import { AgentAvatar, SubagentAvatar } from "./agent-avatar.js";

const receiptPrefix = "[Team group request receipt | reference data]\n";
export function groupReference(content: string) {
  try {
    // Model instructions can change; the envelope marker and validated source identify the display.
    const prefix = content.startsWith(receiptPrefix) ? receiptPrefix : /^\[Team group input;[^\r\n]*\]\r?\n/u.exec(content)?.[0] ?? null;
    if (prefix === null) return null;
    const value: unknown = JSON.parse(content.slice(prefix.length));
    if (typeof value !== "object" || value === null || !("roomId" in value)) return null;
    const roomId = conversationIdSchema.safeParse(value.roomId);
    if (!roomId.success) return null;
    if (prefix !== receiptPrefix && "messageId" in value && "sender" in value && "content" in value) {
      const messageId = conversationIdSchema.safeParse(value.messageId);
      if (messageId.success && typeof value.sender === "string" && typeof value.content === "string") {
        const senderId = "senderConversationId" in value ? conversationIdSchema.safeParse(value.senderConversationId) : null;
        const context: { senderName: string; content: string; perspective: string }[] = [];
        const rawContext: readonly unknown[] = "groupContext" in value && Array.isArray(value.groupContext) ? value.groupContext : [];
        for (const item of rawContext.slice(0, 16)) {
          if (typeof item === "object" && item !== null && "senderName" in item && "content" in item
            && typeof item.senderName === "string" && typeof item.content === "string") context.push({ senderName: item.senderName,
            content: item.content.slice(0, 2000), perspective: "perspective" in item && typeof item.perspective === "string" ? item.perspective : "member" });
        }
        return { kind: "input" as const, roomId: roomId.data, messageId: messageId.data, sender: value.sender, content: value.content,
          senderConversationId: senderId?.success ? senderId.data : null, context,
          summary: "groupSummary" in value && typeof value.groupSummary === "string" ? value.groupSummary.slice(0, 2000) : "" };
      }
    } else if (prefix === receiptPrefix && "originalMessageId" in value && "status" in value && "publicMessageIds" in value) {
      const messageId = conversationIdSchema.safeParse(value.originalMessageId);
      const status = value.status;
      if (messageId.success && (status === "completed" || status === "failed" || status === "cancelled") && Array.isArray(value.publicMessageIds)) {
        return { kind: "receipt" as const, roomId: roomId.data, originalMessageId: messageId.data, status, publicMessageCount: value.publicMessageIds.length };
      }
    }
  } catch { /* Ordinary text, including pasted malformed envelopes, stays unchanged. */ }
  return null;
}

export function TeamChatSourceHeader({ content, source, conversations, onOpenConversation }: {
  content: string; source?: ConversationMessageItem["groupSource"]; conversations: readonly Pick<ConversationSummary, "id" | "title" | "agentId" | "avatarIcon">[];
  onOpenConversation: ((id: string) => void) | undefined;
}): ReactElement | null {
  const agents = useAgentDirectoryStore(state => state.agents);
  const reference = groupReference(content);
  const name = source?.senderName ?? (reference?.kind === "input" && reference.sender !== "user" ? reference.sender : null);
  const senderId = source?.senderConversationId ?? (reference?.kind === "input" ? reference.senderConversationId : null);
  const conversation = conversations.find(item => item.id === senderId || (senderId === null && name !== null && (item.title === name || item.title.startsWith(`${name} ·`))));
  const agent = agents.find(item => item.id === conversation?.agentId || item.name === name);
  const hasContext = reference?.kind === "input" && (reference.context.length > 0 || reference.summary.length > 0);
  if ((name === null || source?.senderConversationId === null) && !hasContext) return null;
  return <div className="mb-[5px] flex min-w-0 flex-col items-end gap-[5px]" data-group-source-header>
    {name === null || source?.senderConversationId === null ? null : <button type="button" aria-label={`打开来源对话 ${name}`}
      disabled={conversation === undefined || onOpenConversation === undefined} onClick={() => { if (conversation) onOpenConversation?.(conversation.id); }}
      className="inline-flex min-w-0 max-w-full items-center gap-[5px] rounded-[var(--app-radius)] text-[length:var(--app-font-size-control)] text-[var(--app-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
      {agent ? <AgentAvatar avatar={agent.avatar} size="compact" /> : <SubagentAvatar icon={conversation?.avatarIcon ?? null} seed={senderId ?? name} size="compact" />}
      <span className="min-w-0 truncate">{name}</span>
    </button>}
    {hasContext ? <TooltipAnchor side="left" contentClassName="max-h-[min(400px,70vh)] max-w-[min(440px,85vw)] overflow-auto"
      content={<div className="flex flex-col gap-[5px] whitespace-pre-wrap break-words text-left">
        <strong>随消息带入的群聊参考上下文</strong>
        {reference.context.map((item, index) => <p key={index} className="m-0"><strong>{item.perspective === "self" ? `${item.senderName}（本人此前发言）` : item.perspective === "user" ? "用户" : item.senderName}</strong>：{item.content}</p>)}
        {reference.summary ? <p className="m-0">讨论摘要：{reference.summary}</p> : null}
      </div>}>
      <button type="button" aria-label="查看带入的群聊上下文" className="inline-flex items-center gap-[5px] rounded-[var(--app-radius)] bg-[var(--app-panel-subtle)] px-2 py-1 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
        <BookOpenText size={13} />群聊上下文 · {reference.context.length} 条
      </button>
    </TooltipAnchor> : null}
  </div>;
}

/** The durable routing envelope remains in history; the conversation shows its human source and body. */
export function TeamChatSourceContent({ content, children, source }: { content: string; children?: ReactNode; source?: ConversationMessageItem["groupSource"] }): ReactElement {
  const reference = groupReference(content);
  if (source !== undefined) {
    const prefix = `${source.senderName}：\n`;
    return <UserMessageContent content={content.startsWith(prefix) ? content.slice(prefix.length) : content} />;
  }
  if (reference === null) return <>{children ?? <UserMessageContent content={content} />}</>;
  const messageId = reference.kind === "input" ? reference.messageId : reference.originalMessageId;
  const label = reference.kind === "input" ? `群聊消息 · ${reference.sender === "user" ? "你" : reference.sender}`
    : ({ completed: "群聊委派已完成", failed: "群聊委派失败", cancelled: "群聊委派已取消" }[reference.status]);
  return <div className="min-w-0">
    <button type="button" className="mb-[5px] inline-flex items-center gap-[5px] text-[length:var(--app-font-size-auxiliary)] text-[var(--app-accent)] hover:underline"
      onClick={() => useWorkbenchUiStore.getState().openTeamChat({ instanceId: reference.roomId, messageId })}>
      <MessageSquareText aria-hidden="true" size={13} />{label}
    </button>
    <UserMessageContent content={reference.kind === "input" ? reference.content : `${reference.publicMessageCount} 条公开回复，点击返回群聊查看。`} />
  </div>;
}
