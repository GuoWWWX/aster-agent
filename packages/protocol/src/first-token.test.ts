import { describe, expect, it } from "vitest";

import { conversationRunEventSchema } from "./conversation.js";

describe("first-token event", () => {
  it.each([0, 250, -1, 1.5, Number.POSITIVE_INFINITY])("validates latency %s", (latencyMs) => {
    expect(conversationRunEventSchema.safeParse({
      conversationId: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000002",
      latencyMs,
      type: "model.first_token_received",
    }).success).toBe(Number.isInteger(latencyMs) && latencyMs >= 0);
  });
});
