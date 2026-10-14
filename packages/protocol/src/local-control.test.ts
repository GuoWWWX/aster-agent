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

  it.each([
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
