import type { ConversationMessageItem, ConversationTimelineItem, ConversationToolItem, UserQuestion } from "@agent/protocol";

/** Match the durable answer text produced by UserQuestionService, including older messages. */
export function questionForAnswer(message: ConversationMessageItem, questions: readonly UserQuestion[]): UserQuestion | null {
  if (message.role !== "user" || !message.content.startsWith("用户回答了")) return null;
  return questions.filter((question) => {
    if (question.status !== "answered" || (message.conversationId !== question.displayConversationId
      && message.conversationId !== question.conversationId)) return false;
    if (question.answeredAt !== null && Date.parse(question.answeredAt) > Date.parse(message.createdAt)) return false;
    const prefix = message.conversationId === question.conversationId
      ? "用户回答了你发起的提问。"
      : `用户回答了子代理「${question.sourceTitle}」的提问，回答也已送回该代理。`;
    const body = question.questions.map((prompt) =>
      `${prompt.title}\n${prompt.question}\n用户回答：${question.answers?.[prompt.id] ?? ""}`,
    ).join("\n\n");
    return message.content === `${prefix}\n\n${body}`;
  }).sort((left, right) => (right.answeredAt ?? "").localeCompare(left.answeredAt ?? ""))[0] ?? null;
}

export function questionToolForAnswer(timeline: readonly ConversationTimelineItem[], question: UserQuestion): ConversationToolItem | null {
  return timeline.find((item): item is ConversationToolItem => {
    if (item.kind !== "tool" || item.name !== "request_user_input" || item.runId !== question.runId) return false;
    if (item.result === null || item.result === undefined) return false;
    try {
      const result: unknown = JSON.parse(item.result);
      return typeof result === "object" && result !== null && "questionId" in result && result.questionId === question.id;
    } catch { return false; }
  }) ?? null;
}
