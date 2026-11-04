import { describe, expect, it } from "vitest";
import { compactProviderReplayState } from "./provider-replay-state.js";
import type { ModelProviderState } from "./model-contracts.js";

describe("compactProviderReplayState", () => {
  it("omits echoed settings while retaining identity, encrypted reasoning and usage", () => {
    const metadata = {
      id: "response-1", model_provider: "openai", instructions: "rules".repeat(20_000),
      tools: [{ description: "tool".repeat(20_000) }],
      output: [{ type: "reasoning", encrypted_content: "encrypted-state" }],
      usage: { details: "repeated stats" }, vendor_extension: "preserved",
    };
    const state: ModelProviderState = {
      apiFormat: "openai-responses", baseUrl: "https://example.test", modelId: "test-model",
      payload: { version: 2, responseMetadata: metadata, additionalKwargs: { reasoning: { encrypted_content: "reasoning-state" } }, content: "answer" },
      usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 },
    };
    const compact = compactProviderReplayState(state);
    expect(compact).toMatchObject({ usage: state.usage, payload: { content: "answer",
      additionalKwargs: { reasoning: { encrypted_content: "reasoning-state" } },
      responseMetadata: { id: "response-1", output: metadata.output, vendor_extension: "preserved" } } });
    expect(JSON.stringify(compact).length).toBeLessThan(1_000);
    expect(metadata.instructions.length).toBe(100_000);
    expect(compactProviderReplayState(compact)).toBe(compact);
  });

  it("retains raw usage when normalized usage is unavailable and leaves other formats unchanged", () => {
    const state: ModelProviderState = {
      apiFormat: "openai-responses", baseUrl: "https://example.test", modelId: "test-model",
      payload: { version: 2, responseMetadata: { instructions: "request rules", usage: { output_tokens: 5 } } },
    };
    expect(compactProviderReplayState(state).payload).toMatchObject({ responseMetadata: { usage: { output_tokens: 5 } } });
    const other = { ...state, apiFormat: "anthropic-messages" as const };
    expect(compactProviderReplayState(other)).toBe(other);
  });
});
