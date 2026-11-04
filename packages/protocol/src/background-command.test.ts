import { expect, it } from "vitest";
import { readBackgroundCommandInputSchema } from "./background-command.js";
import { conversationRunEventSchema } from "./conversation.js";
it("bounds command output reads and requires conversation and command identities", () => {
  const input = { conversationId: "00000000-0000-4000-8000-000000000001", commandId: "00000000-0000-4000-8000-000000000002" };
  expect(readBackgroundCommandInputSchema.parse(input)).toEqual(input);
  for (const maxChars of [0, 64001, 1.5]) expect(readBackgroundCommandInputSchema.safeParse({ ...input, maxChars }).success).toBe(false);
  expect(readBackgroundCommandInputSchema.safeParse({ ...input, maxChars: 64000 }).success).toBe(true);
});

it("accepts legacy output events and validates optional process timing", () => {
  const event = { type: "tool.output_delta", conversationId: "00000000-0000-4000-8000-000000000001",
    commandId: "00000000-0000-4000-8000-000000000002", runId: "00000000-0000-4000-8000-000000000003",
    toolId: "00000000-0000-4000-8000-000000000004", delta: "", stream: "stdout", done: false,
    exitCode: null, status: "running", timedOut: false, truncated: false };
  expect(conversationRunEventSchema.safeParse(event).success).toBe(true);
  expect(conversationRunEventSchema.safeParse({ ...event, startedAt: "2026-10-16T00:00:00Z", completedAt: null }).success).toBe(true);
  expect(conversationRunEventSchema.safeParse({ ...event, startedAt: "invalid" }).success).toBe(false);
  expect(conversationRunEventSchema.safeParse({ ...event, completedAt: 123 }).success).toBe(false);
});
