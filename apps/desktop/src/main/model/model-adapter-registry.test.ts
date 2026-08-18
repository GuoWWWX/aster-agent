import { describe, expect, it } from "vitest";
import type { ModelApiFormat } from "@agent/protocol";

import {
  ModelAdapterRegistry,
  type ModelAdapterFactory,
} from "./model-adapter-registry.js";
import type {
  CompleteTurnInput,
  ModelProviderAdapter,
  ModelTurnResult,
} from "./model-contracts.js";

const formats: ModelApiFormat[] = [
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
  "google-gemini",
];

function inputFor(apiFormat: ModelApiFormat): CompleteTurnInput {
  return {
    configuration: {
      apiFormat,
      apiKey: "test-key",
      baseUrl: "https://example.test/v1",
      modelId: "test-model",
      reasoningOptions: [],
    },
    maxOutputTokens: 64,
    messages: [],
    onTextDelta: () => undefined,
    reasoning: undefined,
    signal: AbortSignal.timeout(1_000),
    tools: [],
  };
}

const result: ModelTurnResult = {
  content: "ok",
  finishReason: "stop",
  toolCalls: [],
};

describe("ModelAdapterRegistry", () => {
  it("routes every supported API format to its own adapter strategy", async () => {
    const calls: ModelApiFormat[] = [];
    const adapter = (apiFormat: ModelApiFormat): ModelProviderAdapter => ({
      completeTurn: () => {
        calls.push(apiFormat);
        return Promise.resolve(result);
      },
    });
    const factories = new Map<ModelApiFormat, ModelAdapterFactory>([
      ["anthropic-messages", () => adapter("anthropic-messages")],
      ["google-gemini", () => adapter("google-gemini")],
      ["openai-chat-completions", () => adapter("openai-chat-completions")],
      ["openai-responses", () => adapter("openai-responses")],
    ]);
    const registry = new ModelAdapterRegistry(fetch, factories);

    for (const format of formats) {
      await registry.completeTurn(inputFor(format));
    }

    expect(calls).toEqual(formats);
  });

  it("does not share adapter instances between turns", async () => {
    const instances: ModelProviderAdapter[] = [];
    const factories = new Map<ModelApiFormat, ModelAdapterFactory>([
      ["openai-chat-completions", () => {
        const instance: ModelProviderAdapter = {
          completeTurn: () => Promise.resolve(result),
        };
        instances.push(instance);
        return instance;
      }],
    ]);
    const registry = new ModelAdapterRegistry(fetch, factories);

    await registry.completeTurn(inputFor("openai-chat-completions"));
    await registry.completeTurn(inputFor("openai-chat-completions"));

    expect(instances).toHaveLength(2);
    expect(instances[0]).not.toBe(instances[1]);
  });

  it("fails predictably when the configured API format has no registered adapter", () => {
    const registry = new ModelAdapterRegistry(fetch, new Map());

    expect(() => registry.completeTurn(inputFor("openai-chat-completions"))).toThrow(
      "No model adapter is registered for openai-chat-completions.",
    );
  });
});
