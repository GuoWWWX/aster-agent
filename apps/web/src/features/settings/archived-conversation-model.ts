import {
  ARCHIVED_CONVERSATION_RETENTION_DAYS,
  type ConversationSummary,
} from "@agent/protocol";

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1_000;

export function getArchivedConversations(
  conversations: readonly ConversationSummary[],
): ConversationSummary[] {
  return conversations
    .filter((conversation) => conversation.isArchived)
    .sort((left, right) => archiveTime(right) - archiveTime(left));
}

export function getArchivedConversationDaysRemaining(
  archivedAt: string | null,
  now = Date.now(),
): number {
  if (archivedAt === null) return ARCHIVED_CONVERSATION_RETENTION_DAYS;
  const archivedTime = Date.parse(archivedAt);
  if (!Number.isFinite(archivedTime)) return ARCHIVED_CONVERSATION_RETENTION_DAYS;
  const expiresAt = archivedTime
    + ARCHIVED_CONVERSATION_RETENTION_DAYS * DAY_IN_MILLISECONDS;
  return Math.max(0, Math.ceil((expiresAt - now) / DAY_IN_MILLISECONDS));
}

function archiveTime(conversation: ConversationSummary): number {
  return Date.parse(conversation.archivedAt ?? conversation.updatedAt);
}
