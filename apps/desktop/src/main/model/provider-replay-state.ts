import type { ModelProviderState } from "./model-contracts.js";

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Responses echoes request configuration; it is not assistant state for replay. */
export function compactProviderReplayState(state: ModelProviderState): ModelProviderState {
  if (state.apiFormat !== "openai-responses" || !record(state.payload) || state.payload.version !== 2) return state;
  const metadata = state.payload.responseMetadata;
  if (!record(metadata)) return state;
  if (!("instructions" in metadata) && !("tools" in metadata) && !(state.usage !== undefined && "usage" in metadata)) return state;
  const responseMetadata = { ...metadata };
  delete responseMetadata.instructions;
  delete responseMetadata.tools;
  if (state.usage !== undefined) delete responseMetadata.usage;
  return { ...state, payload: { ...state.payload, responseMetadata } };
}
