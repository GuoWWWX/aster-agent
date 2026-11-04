import type { CompleteTurnInput, ModelProviderAdapter } from "./model-contracts.js";
import { lowestConfiguredReasoning, resolveConfiguredReasoning } from "./model-reasoning.js";
import { ModelResponseError } from "./model-request-error.js";

export type ModelGatewayRequest = Parameters<ModelProviderAdapter["completeTurn"]>[0];
export type ModelGatewayResponse = ReturnType<ModelProviderAdapter["completeTurn"]>;
type BackgroundPurpose = "title" | "summary" | "approval" | "connection_test";
type BackgroundRequest = Omit<CompleteTurnInput, "reasoning" | "tools" | "maxOutputTokens"> & { purpose: BackgroundPurpose };
const backgroundOutputTokens: Record<BackgroundPurpose, number> = { title: 512, summary: 2048, approval: 320, connection_test: 64 };

/** Provider boundary: no Run, tool, persistence, or IPC responsibilities. */
export class ModelGateway {
  public constructor(private readonly adapter: ModelProviderAdapter) {}

  public async completeTurn(input: ModelGatewayRequest): ModelGatewayResponse {
    input.signal.throwIfAborted();
    const reasoning = resolveConfiguredReasoning(input.reasoning, input.configuration);
    return this.adapter.completeTurn({ ...input, reasoning });
  }

  public async completeBackgroundTurn({ purpose, ...input }: BackgroundRequest): ModelGatewayResponse {
    const reasoning = lowestConfiguredReasoning(input.configuration);
    const base = backgroundOutputTokens[purpose];
    const maxOutputTokens = reasoning?.kind === "token_budget" && reasoning.value > 0
      ? Math.max(base, reasoning.value + 128)
      : reasoning === undefined || (reasoning.kind === "token_budget" ? reasoning.value === 0 : reasoning.value === "none")
        ? base : Math.max(base, 1024);
    const result = await this.completeTurn({ ...input, reasoning, maxOutputTokens, tools: [] });
    if (result.toolCalls.length > 0) throw new ModelResponseError("A background model request returned unexpected Agent tool calls.");
    return result;
  }
}
