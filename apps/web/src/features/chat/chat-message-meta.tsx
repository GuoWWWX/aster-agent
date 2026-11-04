import type { ReactElement, ReactNode } from "react";
import { Check, Copy, Pencil } from "lucide-react";
import { IconButton } from "../../components/ui/icon-button.js";

export function ChatMessageMeta({ role, content, createdAt, completedAt, copied = false, editing = false, onCopy, onEdit, children }: {
  role: "user" | "assistant"; content: string; createdAt: string; completedAt?: string | null;
  copied?: boolean; editing?: boolean; onCopy?: () => void; onEdit?: () => void; children?: ReactNode;
}): ReactElement {
  return <div className="chat-message__meta">
    {role === "user" ? <time dateTime={createdAt} title={formatConversationDateTime(createdAt)}>{formatConversationTime(createdAt)}</time> : null}
    {onCopy === undefined ? null : <IconButton disabled={content.length === 0}
      label={copied ? role === "user" ? "已复制消息" : "已复制完整回复" : role === "user" ? "复制消息" : "复制完整回复"}
      size="compact" type="button" variant="quiet" onClick={onCopy}>
      {copied ? <Check aria-hidden="true" size={14} /> : <Copy aria-hidden="true" size={14} />}
    </IconButton>}
    {role !== "user" || onEdit === undefined ? null : <IconButton disabled={editing} label={editing ? "正在编辑" : "编辑并重新生成"}
      size="compact" type="button" variant={editing ? "selected" : "quiet"} onClick={onEdit}><Pencil aria-hidden="true" size={14} /></IconButton>}
    {children}
    {role === "assistant" && completedAt != null ? <time dateTime={completedAt} title={formatConversationDateTime(completedAt)}>{formatConversationTime(completedAt)}</time> : null}
  </div>;
}

export function formatConversationTime(createdAt: string, now = new Date()): string {
  const timestamp = new Date(createdAt); if (Number.isNaN(timestamp.getTime())) return "";
  const sameDay = (date: Date) => timestamp.getFullYear() === date.getFullYear() && timestamp.getMonth() === date.getMonth() && timestamp.getDate() === date.getDate();
  const clock = formatLocalClock(timestamp); if (sameDay(now)) return clock;
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1); if (sameDay(yesterday)) return `昨天 ${clock}`;
  return `${timestamp.getFullYear() === now.getFullYear() ? "" : `${timestamp.getFullYear()}年`}${timestamp.getMonth() + 1}月${timestamp.getDate()}日 ${clock}`;
}
export function formatConversationDateTime(createdAt: string): string {
  const timestamp = new Date(createdAt); if (Number.isNaN(timestamp.getTime())) return "";
  return `${timestamp.getFullYear()}年${timestamp.getMonth() + 1}月${timestamp.getDate()}日 ${formatLocalClock(timestamp)}`;
}
function formatLocalClock(timestamp: Date): string {
  return `${String(timestamp.getHours()).padStart(2, "0")}:${String(timestamp.getMinutes()).padStart(2, "0")}`;
}
