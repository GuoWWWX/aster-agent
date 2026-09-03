export type ConversationTabCloseResult = {
  nextActiveId: string | null;
  openIds: string[];
};

export function openConversationTab(
  openIds: readonly string[],
  conversationId: string,
): string[] {
  return openIds.includes(conversationId) ? [...openIds] : [...openIds, conversationId];
}

export function closeConversationTab(
  openIds: readonly string[],
  conversationId: string,
  activeConversationId: string | null,
): ConversationTabCloseResult {
  const closedIndex = openIds.indexOf(conversationId);
  const remaining = openIds.filter((id) => id !== conversationId);
  if (conversationId !== activeConversationId) {
    return { nextActiveId: activeConversationId, openIds: remaining };
  }
  if (remaining.length === 0) {
    return { nextActiveId: null, openIds: remaining };
  }
  return {
    nextActiveId: remaining[Math.min(Math.max(closedIndex, 0), remaining.length - 1)] ?? null,
    openIds: remaining,
  };
}
