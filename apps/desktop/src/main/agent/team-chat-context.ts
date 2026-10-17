import type { TeamChatMessage } from "@agent/protocol";

/** A bounded public transcript, with identities relative to the receiving Agent. */
export function teamChatContext(messages: readonly TeamChatMessage[], receiverId: string | null,
  source: TeamChatMessage, maxCharacters = 12_000) {
  const replaced = new Set(messages.flatMap(message => message.supersedesId ? [message.supersedesId] : []));
  const candidates = messages.filter(message => message.sequence < source.sequence && !replaced.has(message.id));
  const priority = [...candidates].sort((a, b) => {
    const rank = (message: TeamChatMessage) => message.id === source.replyToId ? 2 : message.rootMessageId === source.rootMessageId ? 1 : 0;
    return rank(b) - rank(a) || b.sequence - a.sequence;
  });
  const selected = []; let remaining = Math.max(0, maxCharacters - 2);
  for (const message of priority) {
    if (selected.length >= 16 || remaining < 300) break;
    const content = message.content.slice(0, Math.min(2000, remaining - 220));
    const item = { messageId: message.id, sequence: message.sequence, senderConversationId: message.senderConversationId,
      recipientConversationIds: message.recipientConversationIds, replyToId: message.replyToId, rootMessageId: message.rootMessageId,
      senderName: message.senderConversationId === null ? "用户" : message.senderName,
      perspective: message.senderConversationId === null ? "user" : message.senderConversationId === receiverId ? "self" : "member",
      content, excerpted: content.length < message.content.length };
    let size = JSON.stringify(item).length;
    while (size > remaining && item.content.length > 0) {
      item.content = item.content.slice(0, Math.max(0, item.content.length - (size - remaining)));
      item.excerpted = true; size = JSON.stringify(item).length;
    }
    if (size > remaining) continue;
    selected.push(item); remaining -= size + 1;
  }
  return selected.sort((a, b) => a.sequence - b.sequence);
}
