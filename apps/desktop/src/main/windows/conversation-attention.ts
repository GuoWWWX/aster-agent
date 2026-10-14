import type { ConversationRunEvent, ConversationSummary, UserQuestion } from "@agent/protocol";

const listeners = new Set<(event?: ConversationRunEvent) => void>();
export function publishConversationAttentionEvent(event?: ConversationRunEvent): void {
  for (const listener of listeners) listener(event);
}
export function subscribeConversationAttention(listener: (event?: ConversationRunEvent) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

type AttentionPort = {
  conversations(): ConversationSummary[];
  questions(): UserQuestion[];
  result(conversationId: string, runId: string): string | null;
  badge(count: number): void;
  notify(title: string, body: string, conversationId: string): void;
  onError(error: unknown): void;
};

/** Native attention follows durable read state, including acknowledgements from the renderer. */
export class ConversationAttention {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private lastCount = -1;
  public constructor(private readonly port: AttentionPort) { this.refresh(); }
  public handle(event?: ConversationRunEvent): void {
    if (event === undefined) { this.refresh(); return; }
    if (event.type !== "conversation.updated" && event.type !== "run.finished" && event.type !== "user_question.updated") return;
    this.safely(() => {
      this.refresh();
      if (event.type === "run.finished" && event.status === "completed") {
        this.schedule(event.runId, () => {
          const conversation = this.port.conversations().find((item) => item.id === event.conversationId);
          if (!conversation || conversation.isArchived || conversation.parentConversationId !== null || !conversation.hasUnreadResult) return;
          const body = notificationPreview(this.port.result(conversation.id, event.runId) ?? "对话已完成。");
          this.port.notify(conversation.title, body, conversation.id);
        });
      }
      if (event.type === "user_question.updated" && event.reason === "created") {
        this.schedule(event.question.id, () => {
          const question = this.port.questions().find((item) => item.id === event.question.id);
          const conversation = this.port.conversations().find((item) => item.id === event.conversationId);
          if (!question || question.viewed || question.status !== "pending" || !conversation || conversation.isArchived) return;
          const title = question.conversationId === conversation.id ? conversation.title : `${conversation.title} · ${question.sourceTitle}`;
          this.port.notify(title, notificationPreview(question.questions.map((prompt) => prompt.question).join("\n")), conversation.id);
        });
      }
    });
  }
  public dispose(): void {
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
  private refresh(): void {
    this.safely(() => {
      const visible = new Set(this.port.conversations().filter((item) => !item.isArchived && item.parentConversationId === null).map((item) => item.id));
      const unread = new Set(this.port.conversations().filter((item) => visible.has(item.id) && item.hasUnreadResult).map((item) => item.id));
      for (const question of this.port.questions()) if (visible.has(question.displayConversationId) && question.status === "pending" && !question.viewed) unread.add(question.displayConversationId);
      if (this.lastCount === unread.size) return;
      this.port.badge(unread.size); this.lastCount = unread.size;
    });
  }
  private schedule(id: string, action: () => void): void {
    if (this.timers.has(id)) return;
    // Allow a focused, visible conversation to acknowledge the new content first.
    this.timers.set(id, setTimeout(() => {
      this.timers.delete(id); this.safely(action);
    }, 350));
  }
  private safely(action: () => void): void {
    try { action(); } catch (error) { this.port.onError(error); }
  }
}

export function notificationPreview(value: string): string {
  return value.replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/giu, " ")
    .replace(/[`*_>#]+/gu, " ").replace(/\s+/gu, " ").trim().slice(0, 300);
}
