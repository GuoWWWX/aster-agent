import type { ModelApiFormat } from "@agent/protocol";

import { AiSdkModelAdapter } from "./ai-sdk-model-adapter.js";
import {
  OpenAiChatCompletionsAdapter,
} from "./openai-compatible-adapter.js";
import {
  AnthropicMessagesAdapter,
  GoogleGeminiAdapter,
  OpenAiResponsesAdapter,
} from "./model-protocol-adapter.js";
import type {
  CompleteTurnInput,
  ModelProviderAdapter,
  ModelTurnResult,
} from "./model-contracts.js";

export type ModelAdapterFactory = (
  request: typeof fetch,
) => ModelProviderAdapter;

export type ModelAdapterFactories = ReadonlyMap<ModelApiFormat, ModelAdapterFactory>;

const DEFAULT_FACTORIES: ModelAdapterFactories = new Map<ModelApiFormat, ModelAdapterFactory>([
  ["anthropic-messages", (request) => new AiSdkModelAdapter(
    "anthropic-messages",
    request,
    new AnthropicMessagesAdapter(request),
  )],
  ["google-gemini", (request) => new AiSdkModelAdapter(
    "google-gemini",
    request,
    new GoogleGeminiAdapter(request),
  )],
  ["openai-chat-completions", (request) => new AiSdkModelAdapter(
    "openai-chat-completions",
    request,
    new OpenAiChatCompletionsAdapter(request),
  )],
  ["openai-responses", (request) => new AiSdkModelAdapter(
    "openai-responses",
    request,
    new OpenAiResponsesAdapter(request),
  )],
]);

export class ModelAdapterRegistry implements ModelProviderAdapter {
  public constructor(
    private readonly request: typeof fetch = fetch,
    private readonly factories: ModelAdapterFactories = DEFAULT_FACTORIES,
  ) {}

  public completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    const factory = this.factories.get(input.configuration.apiFormat);
    if (factory === undefined) {
      throw new Error(`No model adapter is registered for ${input.configuration.apiFormat}.`);
    }
    return factory(this.request).completeTurn(input);
  }
}
