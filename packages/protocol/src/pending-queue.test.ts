import { describe, expect, it } from "vitest";

import { pendingQueuePausedResponseSchema, setPendingQueuePausedIpcArgumentsSchema } from "./ipc.js";

describe("pending queue control", () => {
  const conversationId = "00000000-0000-4000-8000-000000000001";

  it.each([true, false])("accepts a boolean pause state: %s", (paused) => {
    expect(setPendingQueuePausedIpcArgumentsSchema.parse([{ conversationId, paused }]))
      .toEqual([{ conversationId, paused }]);
    expect(pendingQueuePausedResponseSchema.parse(paused)).toBe(paused);
  });

  it("rejects missing, string and extra fields", () => {
    for (const input of [{ conversationId }, { conversationId, paused: "false" },
      { conversationId, paused: false, runId: conversationId }]) {
      expect(setPendingQueuePausedIpcArgumentsSchema.safeParse([input]).success).toBe(false);
    }
  });
});
