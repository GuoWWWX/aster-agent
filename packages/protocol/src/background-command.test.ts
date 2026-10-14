import { expect, it } from "vitest";
import { readBackgroundCommandInputSchema } from "./background-command.js";
it("bounds command output reads and requires conversation and command identities", () => {
  const input = { conversationId: "00000000-0000-4000-8000-000000000001", commandId: "00000000-0000-4000-8000-000000000002" };
  expect(readBackgroundCommandInputSchema.parse(input)).toEqual(input);
  for (const maxChars of [0, 64001, 1.5]) expect(readBackgroundCommandInputSchema.safeParse({ ...input, maxChars }).success).toBe(false);
  expect(readBackgroundCommandInputSchema.safeParse({ ...input, maxChars: 64000 }).success).toBe(true);
});
