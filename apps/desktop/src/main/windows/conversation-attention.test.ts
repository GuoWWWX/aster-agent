import { randomUUID } from "node:crypto";
import { inflateSync } from "node:zlib";
import { afterEach, describe, expect, it, vi } from "vitest";
import { userQuestionSchema } from "@agent/protocol";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationAttention, notificationPreview } from "./conversation-attention.js";
import { unreadBadgePng } from "./unread-badge.js";

afterEach(() => vi.useRealTimers());
describe("ConversationAttention", () => {
  it("counts conversations once, ignores child completion and suppresses content acknowledged in the foreground", () => {
    vi.useFakeTimers();
    const database = new AgentDatabase(":memory:");
    const root = { ...database.createConversation(null), hasUnreadResult: true };
    const child = { ...database.forkConversation(root.id, "subagent"), hasUnreadResult: true };
    const question = userQuestionSchema.parse({ id: randomUUID(), conversationId: child.id, displayConversationId: root.id, runId: randomUUID(), toolCallId: "ask", sourceTitle: "测试代理",
      questions: [{ id: "scope", title: "范围", question: "需要覆盖哪些页面？" }], status: "pending", answers: null, createdAt: new Date().toISOString(), answeredAt: null, viewed: false });
    const badge = vi.fn(); const notify = vi.fn();
    const attention = new ConversationAttention({ conversations: () => [root, child], questions: () => [question], result: () => "**已完成**\n检查。", badge, notify, onError: vi.fn() });
    expect(badge).toHaveBeenLastCalledWith(1);
    const event = { type: "run.finished" as const, conversationId: root.id, runId: randomUUID(), status: "completed" as const, error: null };
    attention.handle(event); root.hasUnreadResult = false; question.viewed = true;
    attention.handle({ type: "conversation.updated", conversation: root });
    vi.advanceTimersByTime(350); expect(notify).not.toHaveBeenCalled(); expect(badge).toHaveBeenLastCalledWith(0);
    root.hasUnreadResult = true; attention.handle({ ...event, runId: randomUUID() });
    attention.handle({ ...event, conversationId: child.id, runId: randomUUID() });
    vi.advanceTimersByTime(350); expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenLastCalledWith(root.title, "已完成 检查。", root.id);
    question.viewed = false; attention.handle({ type: "user_question.updated", conversationId: root.id, question, reason: "created" });
    vi.advanceTimersByTime(350); expect(notify).toHaveBeenLastCalledWith(`${root.title} · 测试代理`, "需要覆盖哪些页面？", root.id);
    attention.dispose(); database.close();
  });
  it("contains OS failures and disposes pending notifications", () => {
    vi.useFakeTimers(); const database = new AgentDatabase(":memory:"); const conversation = { ...database.createConversation(null), hasUnreadResult: true };
    const error = vi.fn(); const notify = vi.fn();
    const attention = new ConversationAttention({ conversations: () => [conversation], questions: () => [], result: () => "done", badge: () => { throw new Error("OS unavailable"); }, notify, onError: error });
    expect(error).toHaveBeenCalledTimes(1);
    attention.handle({ type: "run.finished", conversationId: conversation.id, runId: randomUUID(), status: "completed", error: null });
    attention.dispose(); vi.runAllTimers(); expect(notify).not.toHaveBeenCalled(); database.close();
  });
  it("produces bounded previews and decodable transparent number badges", () => {
    expect(notificationPreview(`<think>private</think> **完成** ${"x".repeat(500)}`)).toHaveLength(300);
    for (const count of [1, 12, 99, 100]) {
      const png = unreadBadgePng(count);
      expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
      expect(png.readUInt32BE(16)).toBe(32); expect(png.readUInt32BE(20)).toBe(32);
      const idatOffset = png.indexOf("IDAT"); const length = png.readUInt32BE(idatOffset - 4);
      const pixels = inflateSync(png.subarray(idatOffset + 4, idatOffset + 4 + length));
      expect(pixels).toHaveLength(32 * 129); expect(pixels[4]).toBe(0);
      expect(pixels.includes(255)).toBe(true);
    }
    expect(unreadBadgePng(1)).not.toEqual(unreadBadgePng(12));
  });
});
