import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import type { UserQuestion } from "@agent/protocol";
import { AgentDatabase } from "../storage/agent-database.js";
import { UserQuestionService } from "./user-question-service.js";

function fixture() {
  const database = new AgentDatabase(":memory:");
  const root = database.createConversation(null);
  const child = database.forkConversation(root.id, "subagent");
  const records = new Map<string, UserQuestion>();
  const receipts = new Set<string>();
  const deliver = vi.fn((question: UserQuestion, id: string) => { receipts.add(`${question.id}:${id}`); });
  const service = new UserQuestionService({
    conversation: (id) => database.getConversation(id),
    list: (id) => [...records.values()].filter((q) => id === undefined || q.conversationId === id || q.displayConversationId === id),
    get: (id) => { const value = records.get(id); if (!value) throw new Error("Missing question"); return value; },
    save: (q) => { records.set(q.id, structuredClone(q)); },
    delivered: (id, owner) => receipts.has(`${id}:${owner}`), validateAttachments: () => undefined, deliver,
  });
  const emit = vi.fn();
  const request = (owner = root.id, toolCallId = randomUUID()) => service.request({ conversationId: owner, runId: randomUUID(), toolCallId,
    questions: [{ id: "scope", title: "范围", question: "选择范围？", options: [] }] }, emit);
  return { service, root, child, records, receipts, deliver, request, emit, close: () => database.close() };
}

describe("UserQuestionService", () => {
  it("returns immediately, surfaces child questions in the root and delivers each answer once", () => {
    const f = fixture();
    const q = f.request(f.child.id);
    expect(q).toMatchObject({ displayConversationId: f.root.id, status: "pending", deliveryComplete: false });
    expect(f.deliver).not.toHaveBeenCalled();
    const result = f.service.answer({ questionId: q.id, answers: { scope: "整个项目" } }, f.emit);
    expect(result.deliveryComplete).toBe(true);
    expect(f.deliver.mock.calls.map((call) => call[1])).toEqual([f.child.id, f.root.id]);
    f.service.answer({ questionId: q.id, answers: { scope: "整个项目" } }, f.emit);
    expect(f.deliver).toHaveBeenCalledTimes(2);
    expect(() => f.service.answer({ questionId: q.id, answers: { scope: "别的" } }, f.emit)).toThrow("回答已提交");
    f.close();
  });
  it("recovers a partial delivery without replaying the already queued owner input", () => {
    const f = fixture(); const q = f.request(f.child.id);
    f.deliver.mockImplementationOnce((question, id) => { f.receipts.add(`${question.id}:${id}`); });
    f.deliver.mockImplementationOnce(() => { throw new Error("queue failed"); });
    expect(() => f.service.answer({ questionId: q.id, answers: { scope: "全部" } }, f.emit)).toThrow("queue failed");
    expect(f.records.get(q.id)).toMatchObject({ status: "answered", deliveryComplete: false });
    f.service.resumeUndelivered(f.emit, vi.fn());
    expect(f.deliver.mock.calls.map((call) => call[1])).toEqual([f.child.id, f.root.id, f.root.id]);
    expect(f.records.get(q.id)?.deliveryComplete).toBe(true);
    f.service.resumeUndelivered(f.emit, vi.fn()); expect(f.deliver).toHaveBeenCalledTimes(3); f.close();
  });
  it("persists answer attachments and rejects changed attachments during an idempotent retry", () => {
    const f = fixture(); const q = f.request(f.child.id); const attachmentId = randomUUID();
    f.deliver.mockImplementationOnce(() => { throw new Error("retry delivery"); });
    expect(() => f.service.answer({ questionId: q.id, answers: { scope: "参考截图" }, attachmentIds: [attachmentId] }, f.emit)).toThrow("retry delivery");
    expect(f.records.get(q.id)?.answerAttachmentIds).toEqual([attachmentId]);
    expect(() => f.service.answer({ questionId: q.id, answers: { scope: "参考截图" }, attachmentIds: [randomUUID()] }, f.emit)).toThrow("回答已提交");
    expect(f.service.answer({ questionId: q.id, answers: { scope: "参考截图" } }, f.emit).deliveryComplete).toBe(true);
    expect(f.deliver.mock.calls[1]?.[0].answerAttachmentIds).toEqual([attachmentId]); f.close();
  });
  it("waits for all answers without polling and supports cancellation, timeout and scope checks", async () => {
    const f = fixture(); const first = f.request(); const second = f.request();
    const completed = vi.fn();
    const waiting = f.service.wait(f.root.id, [first.id, second.id], "all", undefined, new AbortController().signal).then(completed);
    f.service.answer({ questionId: first.id, answers: { scope: "A" } }, f.emit);
    await Promise.resolve(); expect(completed).not.toHaveBeenCalled();
    f.service.cancelForConversation(f.root.id, f.emit); await waiting;
    expect(completed).toHaveBeenCalledWith(expect.objectContaining({ status: "resolved" }));
    expect(() => f.service.answer({ questionId: second.id, answers: { scope: "B" } }, f.emit)).toThrow("已取消");
    const third = f.request();
    await expect(f.service.wait(f.root.id, [third.id], "any", 1, new AbortController().signal)).resolves.toMatchObject({ status: "timed_out" });
    expect(() => f.service.wait(f.child.id, [third.id], "any", 1, new AbortController().signal)).toThrow("其他对话");
    const abort = new AbortController(); const interrupted = f.service.wait(f.root.id, [third.id], "any", undefined, abort.signal); abort.abort();
    await expect(interrupted).resolves.toMatchObject({ status: "interrupted" }); f.close();
  });
  it("deduplicates a retried tool call and rejects incomplete answers", () => {
    const f = fixture(); const q = f.request();
    const again = f.service.request({ conversationId: q.conversationId, runId: q.runId, toolCallId: q.toolCallId, questions: q.questions }, f.emit);
    expect(again.id).toBe(q.id); expect(f.records.size).toBe(1);
    expect(() => f.service.answer({ questionId: q.id, answers: {} }, f.emit)).toThrow("每一个"); f.close();
  });
});
