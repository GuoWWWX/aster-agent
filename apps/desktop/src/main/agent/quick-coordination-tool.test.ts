import { describe, expect, it, vi } from "vitest";
import { AgentDatabase } from "../storage/agent-database.js";
import { QuickCoordinationTool } from "./quick-coordination-tool.js";

describe("quick coordination queue tools", () => {
  it("previews paged requests without consuming them or exposing unlimited message bodies", () => {
    const db = new AgentDatabase(":memory:");
    try {
      const conversation = db.createConversation(null);
      const run = db.createRunWithUserMessage(conversation.id, "current", "test");
      for (let index = 0; index < 3; index++) db.enqueuePendingMessage({ conversationId: conversation.id, content: `${index}:${"a".repeat(1_100)}` });
      const claim = vi.fn(() => []);
      const result = new QuickCoordinationTool(db).execute({ conversationId: conversation.id, runId: run.runId,
        toolName: "list_pending_messages", arguments: JSON.stringify({ offset: 1, limit: 1 }), signal: new AbortController().signal, claim });
      expect(JSON.parse(result.content)).toMatchObject({ ok: true, value: { total: 3, nextOffset: 2, messages: [{ truncated: true }] } });
      expect(JSON.parse(result.content)).toHaveProperty("value.messages.0.content.length", 1_000);
      expect(db.listPendingMessages(conversation.id)).toHaveLength(3);
      expect(claim).not.toHaveBeenCalled();
    } finally { db.close(); }
  });

  it.each(["failed_spawn", "notification", "steer", "unrelated_recipient"])("does not accept %s as a current task handoff", mode => {
    const db = new AgentDatabase(":memory:");
    try {
      const parent = db.createConversation(null);
      const target = mode === "unrelated_recipient" ? db.createConversation(null) : db.forkConversation(parent.id, "subagent");
      const run = db.createRunWithUserMessage(parent.id, "arrange me", "test");
      db.appendToolStarted({ id: crypto.randomUUID(), batchId: null, conversationId: parent.id, runId: run.runId, createdAt: new Date().toISOString(),
        kind: "tool", name: mode === "failed_spawn" ? "spawn_subagent" : "send_agent_message", status: mode === "failed_spawn" ? "failed" : "completed",
        arguments: JSON.stringify({ conversationIds: [target.id], content: "work", ...(mode === "notification" ? { expectReply: false } : {}),
          ...(mode === "steer" ? { deliveryMode: "steer" } : {}) }), result: "{}", diff: null });
      const claim = vi.fn(() => []);
      const result = new QuickCoordinationTool(db).execute({ conversationId: parent.id, runId: run.runId, toolName: "claim_pending_messages",
        arguments: JSON.stringify({ pendingMessageIds: [crypto.randomUUID()] }), signal: new AbortController().signal, claim });
      expect(result.isError).toBe(true);
      expect(claim).not.toHaveBeenCalled();
    } finally { db.close(); }
  });

  it.each([{}, { pendingMessageIds: [] }, { pendingMessageIds: ["invalid"] },
    { pendingMessageIds: Array(2).fill("00000000-0000-4000-8000-000000000001") }])("rejects invalid claim arguments: %j", args => {
    const db = new AgentDatabase(":memory:");
    try {
      const conversation = db.createConversation(null);
      const claim = vi.fn(() => []);
      expect(new QuickCoordinationTool(db).execute({ conversationId: conversation.id, runId: crypto.randomUUID(), toolName: "claim_pending_messages",
        arguments: JSON.stringify(args), signal: new AbortController().signal, claim }).isError).toBe(true);
      expect(claim).not.toHaveBeenCalled();
    } finally { db.close(); }
  });
});
