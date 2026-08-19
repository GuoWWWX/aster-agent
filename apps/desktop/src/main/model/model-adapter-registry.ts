import type { ModelApiFormat } from "@agent/protocol";

import { LangChainModelAdapter } from "./langchain-model-adapter.js";
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
  ["anthropic-messages", (request) => new LangChainModelAdapter("anthropic-messages", request)],
  ["google-gemini", (request) => new LangChainModelAdapter("google-gemini", request)],
  ["openai-chat-completions", (request) => new LangChainModelAdapter("openai-chat-completions", request)],
  ["openai-responses", (request) => new LangChainModelAdapter("openai-responses", request)],
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
