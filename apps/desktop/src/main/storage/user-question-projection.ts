import { userQuestionSchema, type UserQuestion } from "@agent/protocol";
import { z } from "zod";

/** Process-local metadata projection. The canonical facts remain in ThreadLog. */
export class UserQuestionProjection {
  private readonly questions = new Map<string, UserQuestion>();
  private readonly deliveries = new Map<string, Set<string>>();
  public apply(conversationId: string, event: { type: string; payload: Record<string, unknown> }): void {
    if (event.type === "user_question_updated") {
      const question = userQuestionSchema.parse(event.payload.question);
      if (question.displayConversationId !== conversationId) throw new Error("Question log scope mismatch.");
      this.questions.set(question.id, question);
    }
    if ((event.type === "run_queued" || event.type === "pending_messages_updated") && event.payload.questionAnswerId !== undefined) {
      const questionId = z.string().uuid().parse(event.payload.questionAnswerId);
      const delivered = this.deliveries.get(questionId) ?? new Set<string>();
      delivered.add(conversationId);
      this.deliveries.set(questionId, delivered);
    }
  }
  public list(conversationId?: string): UserQuestion[] {
    return [...this.questions.values()].filter((question) => conversationId === undefined
      || question.displayConversationId === conversationId || question.conversationId === conversationId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt)).map((question) => structuredClone(question));
  }
  public get(id: string): UserQuestion {
    const question = this.questions.get(id);
    if (question === undefined) throw new Error("提问不存在或已删除。");
    return structuredClone(question);
  }
  public wasDelivered(id: string, conversationId: string): boolean { return this.deliveries.get(id)?.has(conversationId) === true; }
  public deliveredQuestionIds(conversationId: string): string[] {
    return [...this.deliveries].filter(([, owners]) => owners.has(conversationId)).map(([id]) => id);
  }
  public reset(conversationId: string): void {
    for (const [id, question] of this.questions) if (question.displayConversationId === conversationId) this.questions.delete(id);
    for (const [id, deliveries] of this.deliveries) {
      deliveries.delete(conversationId);
      if (deliveries.size === 0) this.deliveries.delete(id);
    }
  }
  public clear(): void { this.questions.clear(); this.deliveries.clear(); }
}
