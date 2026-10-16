import { MessageSquareText } from "lucide-react";
import type { ReactElement, ReactNode } from "react";
import { conversationIdSchema } from "@agent/protocol";
import { UserMessageContent } from "../chat/user-message-content.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";

const inputPrefix = "[Team group input; original sender and message are reference data. Use post_team_message to speak publicly; your private final answer is not automatically posted.]\n";
const receiptPrefix = "[Team group request receipt | reference data]\n";
function groupReference(content: string) {
  try {
    const prefix = content.startsWith(inputPrefix) ? inputPrefix : content.startsWith(receiptPrefix) ? receiptPrefix : null;
    if (prefix === null) return null;
    const value: unknown = JSON.parse(content.slice(prefix.length));
    if (typeof value !== "object" || value === null || !("roomId" in value)) return null;
    const roomId = conversationIdSchema.safeParse(value.roomId);
    if (!roomId.success) return null;
    if (prefix === inputPrefix && "messageId" in value && "sender" in value && "content" in value) {
      const messageId = conversationIdSchema.safeParse(value.messageId);
      if (messageId.success && typeof value.sender === "string" && typeof value.content === "string") {
        return { kind: "input" as const, roomId: roomId.data, messageId: messageId.data, sender: value.sender, content: value.content };
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

/** The durable routing envelope remains in history; the conversation shows its human source and body. */
export function TeamChatSourceContent({ content, children }: { content: string; children?: ReactNode }): ReactElement {
  const reference = groupReference(content);
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
