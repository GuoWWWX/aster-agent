import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { userQuestionSchema } from "@agent/protocol";
import { UserQuestionProjection } from "./user-question-projection.js";

describe("UserQuestionProjection", () => {
  it("rehydrates questions and atomic input delivery receipts regardless of log order", () => {
    const root = randomUUID(); const child = randomUUID();
    const q = userQuestionSchema.parse({ id: randomUUID(), conversationId: child, displayConversationId: root, runId: randomUUID(), toolCallId: "ask", sourceTitle: "Agent",
      questions: [{ id: "scope", title: "范围", question: "哪些页面？" }], status: "pending", answers: null, createdAt: new Date().toISOString(), answeredAt: null, viewed: false });
    const projection = new UserQuestionProjection();
    projection.apply(child, { type: "run_queued", payload: { questionAnswerId: q.id } });
    projection.apply(root, { type: "user_question_updated", payload: { question: q } });
    expect(projection.wasDelivered(q.id, child)).toBe(true);
    expect(projection.list(root)).toEqual([q]); expect(projection.list(child)).toEqual([q]);
    const clone = projection.get(q.id); clone.viewed = true; expect(projection.get(q.id).viewed).toBe(false);
    expect(() => projection.apply(child, { type: "user_question_updated", payload: { question: q } })).toThrow("scope mismatch");
    projection.reset(child); expect(projection.wasDelivered(q.id, child)).toBe(false); expect(projection.list(root)).toHaveLength(1);
    projection.reset(root); expect(projection.list()).toEqual([]);
  });
});
