import { describe, expect, it } from "vitest";
import { conversationTypeLabel, toolConversationTarget } from "./tool-conversation-identity.js";

describe("collaboration tool targets", () => {
  const base = { arguments: "{}", conversationId: "current", result: null };
  const result = JSON.stringify({ ok: true, value: { message: {
    conversationId: "recipient", senderConversationId: "sender", senderTitle: "审查助手",
  } } });

  it("uses the recipient for send and the sender for receive", () => {
    expect(toolConversationTarget({ ...base, name: "send_agent_message", result })).toEqual({ id: "recipient" });
    expect(toolConversationTarget({ ...base, name: "wait_for_agent_message", result })).toEqual({ id: "sender", title: "审查助手" });
  });

  it.each(["send_agent_message", "read_agent_conversation", "wait_for_agent_message"])(
    "resolves %s before a result exists or after a failure", (name) => {
      expect(toolConversationTarget({ ...base, name, arguments: '{"conversationId":"child"}', result: '{"ok":false}' })).toEqual({ id: "child" });
    },
  );

  it("reads the current conversation only when the read target is omitted", () => {
    expect(toolConversationTarget({ ...base, name: "read_agent_conversation" })).toEqual({ id: "current" });
    expect(toolConversationTarget({ ...base, name: "wait_for_agent_message" })).toBeNull();
    expect(toolConversationTarget({ ...base, name: "send_agent_message", arguments: "invalid" })).toBeNull();
    expect(toolConversationTarget({ ...base, name: "read_file" })).toBeNull();
  });

  it("retains the filtered target on timeout without inventing an unfiltered sender", () => {
    const timeout = JSON.stringify({ ok: true, value: { message: null, status: "timeout" } });
    expect(toolConversationTarget({ ...base, name: "wait_for_agent_message", result: timeout })).toBeNull();
    expect(toolConversationTarget({ ...base, name: "wait_for_agent_message", arguments: '{"conversationId":"child"}', result: timeout })).toEqual({ id: "child" });
  });
});

describe("target conversation types", () => {
  const base = { threadKind: "agent" as const, parentConversationId: null, projectId: null, teamId: null };
  it("distinguishes all existing conversation categories, prioritizing Subagent identity", () => {
    expect(conversationTypeLabel(base)).toBe("临时对话");
    expect(conversationTypeLabel({ ...base, projectId: "project" })).toBe("对话");
    expect(conversationTypeLabel({ ...base, parentConversationId: "parent" })).toBe("侧边对话");
    expect(conversationTypeLabel({ ...base, teamId: "team" })).toBe("团队成员");
    expect(conversationTypeLabel({ ...base, threadKind: "team_lead" })).toBe("团队负责人");
    expect(conversationTypeLabel({ ...base, teamId: "team", threadKind: "subagent" })).toBe("Subagent");
  });
});
