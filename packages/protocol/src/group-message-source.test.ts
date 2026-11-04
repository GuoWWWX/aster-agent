import { expect, it } from "vitest";
import { conversationMessageItemSchema } from "./conversation.js";

it("retains validated group provenance and keeps ordinary legacy messages compatible", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const message = { id, conversationId: id, kind: "message", runId: null, role: "user",
    content: "Team Lead：\n已交付", createdAt: new Date().toISOString(), modelId: null, status: "completed" };
  expect(conversationMessageItemSchema.parse(message).groupSource).toBeUndefined();
  const groupSource = { teamInstanceId: id, messageId: id, senderConversationId: id, senderName: "Team Lead" };
  expect(conversationMessageItemSchema.parse({ ...message, groupSource }).groupSource).toEqual(groupSource);
  expect(conversationMessageItemSchema.safeParse({ ...message, groupSource: { ...groupSource, senderConversationId: "wrong-id" } }).success).toBe(false);
});
