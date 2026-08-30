import type {
  ConversationMessageItem,
  ConversationRunEvent,
  ConversationTimelineItem,
} from "@agent/protocol";

export function shouldApplyTimelineLoad(
  requestId: number,
  latestRequestId: number,
  requestRevision: number,
  latestRevision: number,
): boolean {
  return requestId === latestRequestId && requestRevision === latestRevision;
}

export function completeStreamingAssistantMessages(
  timeline: ConversationTimelineItem[],
  exceptMessageId?: string,
): ConversationTimelineItem[] {
  let changed = false;
  const next = timeline.map((item) => {
    if (
      item.kind !== "message"
      || item.role !== "assistant"
      || item.status !== "streaming"
      || item.id === exceptMessageId
    ) {
      return item;
    }
    changed = true;
    return { ...item, status: "completed" as const };
  });
  return changed ? next : timeline;
}

export function appendAssistantDelta(
  timeline: ConversationTimelineItem[],
  event: Extract<ConversationRunEvent, { type: "assistant.delta" }>,
): ConversationTimelineItem[] {
  const finalizedTimeline = completeStreamingAssistantMessages(timeline, event.messageId);
  const existing = finalizedTimeline.find(
    (item): item is ConversationMessageItem =>
      item.kind === "message" && item.id === event.messageId && item.role === "assistant",
  );
  if (existing === undefined) {
    return [
      ...finalizedTimeline,
      {
        attachments: [],
        completedAt: null,
        content: event.delta,
        conversationId: event.conversationId,
        createdAt: new Date().toISOString(),
        durationMs: null,
        id: event.messageId,
        kind: "message",
        modelId: event.modelId,
        role: "assistant",
        runId: event.runId,
        status: "streaming",
      },
    ];
  }

  return finalizedTimeline.map((item) =>
    item.id === existing.id && item.kind === "message"
      ? { ...item, content: `${item.content}${event.delta}`, status: "streaming" }
      : item,
  );
}

export function appendAssistantReasoningDelta(
  timeline: ConversationTimelineItem[],
  event: Extract<ConversationRunEvent, { type: "assistant.reasoning_delta" }>,
): ConversationTimelineItem[] {
  if (event.kind !== "content") return timeline;

  const finalizedTimeline = completeStreamingAssistantMessages(timeline, event.messageId);
  const existing = finalizedTimeline.find(
    (item): item is ConversationMessageItem =>
      item.kind === "message" && item.id === event.messageId && item.role === "assistant",
  );
  if (existing === undefined) {
    return [
      ...finalizedTimeline,
      {
        attachments: [],
        completedAt: null,
        content: "",
        conversationId: event.conversationId,
        createdAt: new Date().toISOString(),
        durationMs: null,
        id: event.messageId,
        kind: "message",
        modelId: event.modelId,
        reasoningContent: event.delta,
        role: "assistant",
        runId: event.runId,
        status: "streaming",
      },
    ];
  }

  return finalizedTimeline.map((item) =>
    item.id === existing.id && item.kind === "message"
      ? {
          ...item,
          reasoningContent: event.reset
            ? event.delta
            : `${item.reasoningContent ?? ""}${event.delta}`,
          status: "streaming",
        }
      : item,
  );
}
