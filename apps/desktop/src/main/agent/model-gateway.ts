import type { ModelProviderAdapter } from "../model/model-contracts.js";

export type ModelGatewayRequest = Parameters<ModelProviderAdapter["completeTurn"]>[0];
export type ModelGatewayResponse = ReturnType<ModelProviderAdapter["completeTurn"]>;

/** Provider boundary: no Run, tool, persistence, or IPC responsibilities. */
export class ModelGateway {
  public constructor(private readonly adapter: ModelProviderAdapter) {}

  public completeTurn(input: ModelGatewayRequest): ModelGatewayResponse {
    return this.adapter.completeTurn(input);
  }
}
