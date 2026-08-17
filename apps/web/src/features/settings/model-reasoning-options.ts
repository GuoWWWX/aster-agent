import {
  DEFAULT_MODEL_CATALOG,
  isGemini3ReasoningModel,
  isReasoningOptionSupportedByApiFormat,
  modelReasoningOptionKey,
  resolveModelCatalogRule,
  resolveModelContextWindow,
  type ModelApiFormat,
  type ModelCatalog,
  type ModelReasoningOption,
} from "@agent/protocol";

type ModelReasoningEffort = Extract<ModelReasoningOption, { kind: "effort" }>["value"];

const EFFORT_DISPLAY_NAMES = {
  high: "高",
  low: "低",
  max: "最高",
  medium: "中",
  minimal: "极低",
  none: "无",
  xhigh: "极高",
} as const satisfies Record<ModelReasoningEffort, string>;

function effortOptions(
  efforts: readonly ModelReasoningEffort[],
): ModelReasoningOption[] {
  return efforts.map((value) => ({
    displayName: EFFORT_DISPLAY_NAMES[value],
    enabled: true,
    kind: "effort" as const,
    value,
  }));
}

export function reasoningOptionApiValue(option: ModelReasoningOption): string {
  return String(option.value);
}

export function reasoningOptionDisplayName(option: ModelReasoningOption): string {
  if (option.displayName !== undefined) return option.displayName;
  if (option.kind === "effort") return EFFORT_DISPLAY_NAMES[option.value];
  if (option.kind === "custom_effort") return "自定义";
  if (option.value === -1) return "动态";
  if (option.value === 0) return "关闭";
  return `${option.value} tokens`;
}

export function reasoningOptionLabel(option: ModelReasoningOption): string {
  return `${reasoningOptionDisplayName(option)} | ${reasoningOptionApiValue(option)}`;
}

export function defaultModelContextWindow(
  modelId = "",
  catalog: ModelCatalog = DEFAULT_MODEL_CATALOG,
): number {
  return resolveModelContextWindow(catalog, modelId);
}

export function defaultReasoningOptions(
  apiFormat: ModelApiFormat,
  modelId = "",
  catalog: ModelCatalog = DEFAULT_MODEL_CATALOG,
): ModelReasoningOption[] {
  const catalogOptions = resolveModelCatalogRule(catalog, modelId)?.reasoningOptions
    ?.filter((option) => isReasoningOptionSupportedByApiFormat(apiFormat, option, modelId));
  if (catalogOptions !== undefined && catalogOptions.length > 0) {
    return catalogOptions.map((option) => ({ ...option }));
  }
  if (apiFormat === "openai-chat-completions") {
    return effortOptions(["low", "medium", "high"]);
  }
  if (apiFormat === "openai-responses") {
    return effortOptions(["none", "low", "medium", "high"]);
  }
  if (apiFormat === "anthropic-messages") {
    return [
      { displayName: "轻度", enabled: true, kind: "token_budget", value: 1_024 },
      { displayName: "标准", enabled: true, kind: "token_budget", value: 2_048 },
      { displayName: "深度", enabled: true, kind: "token_budget", value: 4_096 },
      { displayName: "极深", enabled: true, kind: "token_budget", value: 8_191 },
    ];
  }
  if (isGemini3ReasoningModel(modelId)) {
    return effortOptions(["low", "high"]);
  }
  return [
    { displayName: "关闭", enabled: true, kind: "token_budget", value: 0 },
    { displayName: "轻度", enabled: true, kind: "token_budget", value: 1_024 },
    { displayName: "深度", enabled: true, kind: "token_budget", value: 4_096 },
    { displayName: "极深", enabled: true, kind: "token_budget", value: 8_192 },
  ];
}

export function reorderReasoningOptions(
  options: readonly ModelReasoningOption[],
  sourceKey: string,
  targetKey: string,
): ModelReasoningOption[] {
  const sourceIndex = options.findIndex((option) => modelReasoningOptionKey(option) === sourceKey);
  const targetIndex = options.findIndex((option) => modelReasoningOptionKey(option) === targetKey);
  if (sourceIndex < 0 || targetIndex < 0 || sourceIndex === targetIndex) return [...options];
  const next = [...options];
  const [source] = next.splice(sourceIndex, 1);
  if (source === undefined) return [...options];
  next.splice(targetIndex, 0, source);
  return next;
}

export { modelReasoningOptionKey };
