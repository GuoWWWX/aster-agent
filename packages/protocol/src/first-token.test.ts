import { describe, expect, it } from "vitest";

import { conversationRunEventSchema } from "./conversation.js";

describe("first-token event", () => {
  it.each([undefined, 0, 1200, -1, 1.5, Number.POSITIVE_INFINITY])("validates optional request input estimate %s", (estimatedInputTokens) => {
    expect(conversationRunEventSchema.safeParse({
      conversationId: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000002",
      type: "model.request_started",
      ...(estimatedInputTokens === undefined ? {} : { estimatedInputTokens }),
    }).success).toBe(estimatedInputTokens === undefined || Number.isInteger(estimatedInputTokens) && estimatedInputTokens >= 0);
  });
  it.each([0, 250, -1, 1.5, Number.POSITIVE_INFINITY])("validates latency %s", (latencyMs) => {
    expect(conversationRunEventSchema.safeParse({
      conversationId: "00000000-0000-4000-8000-000000000001",
      runId: "00000000-0000-4000-8000-000000000002",
      latencyMs,
      type: "model.first_token_received",
    }).success).toBe(Number.isInteger(latencyMs) && latencyMs >= 0);
  });
});
