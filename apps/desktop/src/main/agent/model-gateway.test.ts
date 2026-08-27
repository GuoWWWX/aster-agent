import { describe, expect, it } from "vitest";

import { ModelGateway } from "./model-gateway.js";

describe("ModelGateway", () => {
  it("delegates a provider request without changing its streaming callbacks", async () => {
    const received: string[] = [];
    const gateway = new ModelGateway({
      completeTurn(input) {
        input.onTextDelta("hello");
        received.push(input.configuration.modelId, input.messages[0]?.content ?? "");
        return Promise.resolve({ content: "hello", finishReason: "stop" as const, toolCalls: [] });
      },
    });
    const result = await gateway.completeTurn({
      configuration: {
        apiKey: "key",
        apiFormat: "openai-chat-completions",
        baseUrl: "https://example.invalid",
        modelId: "test-model",
        reasoningOptions: [],
      },
      maxOutputTokens: 128,
      messages: [{ attachments: [], content: "input", role: "user", toolCallId: null, toolCalls: [] }],
      onTextDelta: (delta) => received.push(delta),
      reasoning: undefined,
      signal: new AbortController().signal,
      tools: [],
    });

    expect(result.content).toBe("hello");
    expect(received).toEqual(["hello", "test-model", "input"]);
  });
});
