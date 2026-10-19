import { isReasoningOptionEnabled, isReasoningOptionSupportedByApiFormat, type ModelReasoningOption } from "@agent/protocol";
import type { ModelConfiguration } from "./model-contracts.js";

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
