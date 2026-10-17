import { describe, expect, it } from "vitest";
import { localControlCommandSchema } from "./local-control.js";

const conversationId = "00000000-0000-4000-8000-000000000001";

describe("local control commands", () => {
  it("accepts creation, bounded history and Queue/Steer using existing contracts", () => {
    expect(localControlCommandSchema.parse({ command: "conversations.create", input: {} }))
      .toEqual({ command: "conversations.create", input: {} });
    expect(localControlCommandSchema.parse({ command: "conversations.read", input: { conversationId } }))
      .toMatchObject({ input: { conversationId } });
    expect(localControlCommandSchema.parse({ command: "messages.send", input: { conversationId, content: "hello", deliveryMode: "steer" } }))
      .toMatchObject({ input: { deliveryMode: "steer" } });
  });

  it("accepts group posts, bounded history and member queries using the group contracts", () => {
    expect(localControlCommandSchema.parse({ command: "team_chat.post", input: { teamInstanceId: conversationId, content: "hello", requestId: "test-group-request" } }))
      .toMatchObject({ input: { intent: "request", recipientConversationIds: [] } });
    for (const command of ["team_chat.read", "team_chat.members"]) {
      expect(localControlCommandSchema.parse({ command, input: { teamInstanceId: conversationId } })).toMatchObject({ input: { teamInstanceId: conversationId } });
    }
  });

  it.each([
    { command: "team_chat.post", input: { teamInstanceId: conversationId, content: "hello", requestId: "request", senderConversationId: conversationId } },
    { command: "team_chat.post", input: { teamInstanceId: conversationId, content: "hello", requestId: "request", recipientConversationIds: ["invalid"] } },
    { command: "team_chat.read", input: { teamInstanceId: conversationId, limit: 51 } },
    { command: "user_questions.answer", input: { questionId: "invalid", answers: { scope: "yes" } } },
    { command: "approvals.resolve", input: { runId: conversationId, toolId: conversationId, approved: "true" } },
    { command: "background_commands.stop", input: { conversationId, commandId: "invalid" } },
    { command: "models.status", input: { includeSecrets: true } },
    { command: "unknown", input: {} },
    { command: "conversations.create", input: { workspaceRootPath: "C:/" } },
    { command: "messages.send", input: { conversationId, content: " " } },
    { command: "messages.send", input: { conversationId, content: "hello", agent: {} } },
    { command: "messages.send", input: { conversationId: "invalid", content: "hello" } },
    { command: "conversations.read", input: { conversationId, limit: 10000 } },
    { command: "runs.cancel", input: { conversationId, extra: true } },
  ])("rejects invalid or unsupported inputs: %j", (command) => {
    expect(localControlCommandSchema.safeParse(command).success).toBe(false);
  });
});
