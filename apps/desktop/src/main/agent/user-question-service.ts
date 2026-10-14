import { randomUUID } from "node:crypto";
import { answerUserQuestionInputSchema, userQuestionSchema, type AnswerUserQuestionInput, type ConversationRunEvent, type ConversationSummary, type UserQuestion, type UserQuestionPrompt } from "@agent/protocol";

type Emit = (event: ConversationRunEvent) => void;
type QuestionPort = {
  conversation(id: string): ConversationSummary;
  list(conversationId?: string): UserQuestion[];
  get(id: string): UserQuestion;
  save(question: UserQuestion): void;
  delivered(id: string, conversationId: string): boolean;
  deliver(question: UserQuestion, conversationId: string, content: string, emit: Emit): void;
};

/** Questions are durable user input requests; requesting one never waits. */
export class UserQuestionService {
  private readonly waiters = new Set<() => void>();
  public constructor(private readonly port: QuestionPort) {}
  public list(conversationId?: string): UserQuestion[] { return this.port.list(conversationId); }
  public request(input: { conversationId: string; runId: string; toolCallId: string; questions: UserQuestionPrompt[] }, emit: Emit): UserQuestion {
    const existing = this.port.list().find((question) => question.runId === input.runId && question.toolCallId === input.toolCallId);
    if (existing !== undefined) return existing;
    const owner = this.port.conversation(input.conversationId);
    let root = owner;
    const visited = new Set<string>();
    while (root.parentConversationId !== null) {
      if (visited.has(root.id)) throw new Error("Conversation ancestry is cyclic.");
      visited.add(root.id); root = this.port.conversation(root.parentConversationId);
    }
    if (this.port.list(root.id).filter((question) => question.status === "pending").length >= 10) throw new Error("请先处理已有的提问（最多 10 组）。");
    const question = userQuestionSchema.parse({ ...input, id: randomUUID(), displayConversationId: root.id, sourceTitle: owner.title.slice(0, 200), teamWorkItemId: owner.teamWorkItemId,
      createdAt: new Date().toISOString(), answeredAt: null, answers: null, status: "pending", viewed: false });
    this.update(question, "created", emit);
    return question;
  }
  public answer(rawInput: AnswerUserQuestionInput, emit: Emit): UserQuestion {
    const input = answerUserQuestionInputSchema.parse(rawInput);
    let question = this.port.get(input.questionId);
    if (question.status === "cancelled") throw new Error("该提问已取消。");
    const expected = question.questions.map((prompt) => prompt.id).sort();
    if (JSON.stringify(Object.keys(input.answers).sort()) !== JSON.stringify(expected)) throw new Error("请回答这组提问中的每一个问题。");
    if (question.status === "answered") {
      if (expected.some((id) => question.answers?.[id] !== input.answers[id])) throw new Error("回答已提交，请通过对话发送补充内容。");
    } else {
      question = { ...question, answers: input.answers, answeredAt: new Date().toISOString(), viewed: true, status: "answered" };
      this.update(question, "answered", emit);
    }
    this.deliverAnswer(question, emit);
    return this.port.get(question.id);
  }
  public markViewed(id: string, emit: Emit): UserQuestion {
    const question = this.port.get(id);
    if (!question.viewed) this.update({ ...question, viewed: true }, "viewed", emit);
    return this.port.get(id);
  }
  public cancelForConversation(conversationId: string, emit: Emit): void {
    for (const question of this.port.list(conversationId)) {
      if (question.status === "pending") this.update({ ...question, status: "cancelled", viewed: true }, "cancelled", emit);
    }
  }
  public resumeUndelivered(emit: Emit, onError: (error: unknown) => void): void {
    for (const question of this.port.list()) {
      if (question.status !== "answered" || question.deliveryComplete) continue;
      try { this.deliverAnswer(question, emit); } catch (error) { onError(error); }
    }
  }
  public wait(conversationId: string, ids: string[], waitFor: "any" | "all", timeoutMs: number | undefined, signal: AbortSignal): Promise<{ status: "resolved" | "timed_out" | "interrupted"; questions: UserQuestion[] }> {
    const read = (): UserQuestion[] => ids.map((id) => {
      const question = this.port.get(id);
      if (question.conversationId !== conversationId && question.displayConversationId !== conversationId) throw new Error("不能等待其他对话的提问。");
      return question;
    });
    read();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const cleanup = (): void => { this.waiters.delete(check); signal.removeEventListener("abort", interrupted); if (timer !== undefined) clearTimeout(timer); };
      const finish = (status: "resolved" | "timed_out" | "interrupted"): void => {
        cleanup();
        try { resolve({ status, questions: read() }); } catch (error) { reject(error instanceof Error ? error : new Error(String(error))); }
      };
      const interrupted = (): void => finish("interrupted");
      const check = (): void => {
        try {
          const records = read(); const settled = (question: UserQuestion): boolean => question.status !== "pending";
          if (waitFor === "all" ? records.every(settled) : records.some(settled)) finish("resolved");
        } catch (error) { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); }
      };
      this.waiters.add(check); signal.addEventListener("abort", interrupted, { once: true });
      if (timeoutMs !== undefined) timer = setTimeout(() => finish("timed_out"), timeoutMs);
      if (signal.aborted) interrupted(); else check();
    });
  }
  private update(question: UserQuestion, reason: "created" | "answered" | "viewed" | "cancelled", emit: Emit): void {
    this.port.save(userQuestionSchema.parse(question));
    emit({ type: "user_question.updated", conversationId: question.displayConversationId, question, reason });
    for (const check of [...this.waiters]) check();
  }
  private deliverAnswer(question: UserQuestion, emit: Emit): void {
    const body = question.questions.map((prompt) => `${prompt.title}\n${prompt.question}\n用户回答：${question.answers?.[prompt.id] ?? ""}`).join("\n\n");
    for (const id of new Set([question.conversationId, question.displayConversationId])) {
      if (this.port.delivered(question.id, id)) continue;
      const prefix = id === question.conversationId ? "用户回答了你发起的提问。" : `用户回答了子代理「${question.sourceTitle}」的提问，回答也已送回该代理。`;
      this.port.deliver(question, id, `${prefix}\n\n${body}`, emit);
    }
    if (!question.deliveryComplete) this.update({ ...question, deliveryComplete: true }, "answered", emit);
  }
}
