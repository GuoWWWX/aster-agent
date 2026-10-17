import { expect, it } from "vitest";
import { chatReferenceSchema } from "./task-context.js";

const reference = { kind: "message", id: crypto.randomUUID(), sourceKind: "group", containerId: crypto.randomUUID(),
  senderName: "前端开发", content: "原成果已完成", createdAt: new Date().toISOString() };

it("reads legacy message references without sender identity", () => {
  expect(chatReferenceSchema.parse(reference)).toEqual(reference);
});
it.each([null, crypto.randomUUID()])("accepts an attributed message sender (%s)", senderConversationId => {
  expect(chatReferenceSchema.parse({ ...reference, senderConversationId })).toMatchObject({ senderConversationId });
});
it("rejects an invalid sender identity", () => {
  expect(chatReferenceSchema.safeParse({ ...reference, senderConversationId: "wrong-id" }).success).toBe(false);
});
