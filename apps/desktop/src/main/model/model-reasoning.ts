import { isReasoningOptionEnabled, isReasoningOptionSupportedByApiFormat, modelReasoningOptionKey, type ModelReasoningOption } from "@agent/protocol";
import type { ModelConfiguration } from "./model-contracts.js";

export function resolveConfiguredReasoning(reasoning: ModelReasoningOption | undefined, configuration: ModelConfiguration): ModelReasoningOption | undefined {
  if (reasoning === undefined) return undefined;
  const key = modelReasoningOptionKey(reasoning);
  const option = configuration.reasoningOptions.find(candidate => modelReasoningOptionKey(candidate) === key);
  if (option === undefined) throw new Error("The selected reasoning option is not configured for this model.");
  if (!isReasoningOptionEnabled(option)) throw new Error("The selected reasoning option is disabled for this model.");
  if (!isReasoningOptionSupportedByApiFormat(configuration.apiFormat, option, configuration.modelId)) {
    throw new Error("The selected reasoning option is incompatible with this model API format.");
  }
  return option;
}

/** Background requests use an enabled configured level, never an invented provider value. */
export function lowestConfiguredReasoning(configuration: ModelConfiguration): ModelReasoningOption | undefined {
  const options = configuration.reasoningOptions.filter(option => isReasoningOptionEnabled(option)
    && isReasoningOptionSupportedByApiFormat(configuration.apiFormat, option, configuration.modelId));
  const levels = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
  for (const level of levels) {
    const option = options.find(option => option.kind !== "token_budget" && option.value === level);
    if (option) return option;
  }
  const budgets = options.filter(option => option.kind === "token_budget" && option.value >= 0);
  return budgets.toSorted((left, right) => Number(left.value) - Number(right.value))[0] ?? options[0];
}
