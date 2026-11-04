import { expect, it } from "vitest";
import { conversationRunEventSchema, conversationStreamSubscriptionSchema } from "./conversation.js";

const conversationId = "00000000-0000-4000-8000-000000000001";

it("accepts an empty stream scope and bounds valid conversation subscriptions", () => {
  expect(conversationStreamSubscriptionSchema.parse([])).toEqual([]);
  expect(conversationStreamSubscriptionSchema.parse([conversationId])).toEqual([conversationId]);
  expect(conversationStreamSubscriptionSchema.parse(Array(100).fill(conversationId))).toHaveLength(100);
  for (const value of [["invalid"], Array(1_001).fill(conversationId), { conversationId }]) {
    expect(conversationStreamSubscriptionSchema.safeParse(value).success).toBe(false);
  }
});

it("accepts legacy text deltas and explicit snapshot replacement while rejecting invalid reset flags", () => {
  const event = { type: "assistant.delta", conversationId, runId: conversationId,
    messageId: conversationId, modelId: "model", delta: "restored output" };
  expect(conversationRunEventSchema.parse(event)).toEqual(event);
  expect(conversationRunEventSchema.parse({ ...event, reset: true })).toMatchObject({ reset: true });
  expect(conversationRunEventSchema.safeParse({ ...event, reset: "true" }).success).toBe(false);
});
