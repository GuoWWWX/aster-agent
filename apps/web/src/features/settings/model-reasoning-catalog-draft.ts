import { DEFAULT_MODEL_REASONING_PROVIDERS, DEFAULT_MODEL_REASONING_RULES,
  type ModelApiFormat, type ModelCatalog, type ModelReasoningMatchMode, type ModelReasoningProvider, type ModelReasoningRule } from "@agent/protocol";

export const REASONING_API_FORMATS: { value: ModelApiFormat; label: string }[] = [
  { value: "openai-chat-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-gemini", label: "Google Gemini" },
];

export type ReasoningCatalogDraft = ModelCatalog & {
  reasoningProviders: ModelReasoningProvider[];
  reasoningRules: ModelReasoningRule[];
};

/** Upgrade the earlier flat catalog in the editor without writing until Save. */
export function createReasoningCatalogDraft(catalog: ModelCatalog): ReasoningCatalogDraft {
  const providers = structuredClone(catalog.reasoningProviders ?? DEFAULT_MODEL_REASONING_PROVIDERS);
  const rules = structuredClone(catalog.reasoningRules ?? DEFAULT_MODEL_REASONING_RULES).map(rule => {
    const builtin = DEFAULT_MODEL_REASONING_RULES.find(candidate => candidate.id === rule.id);
    const providerId = rule.providerId ?? builtin?.providerId ?? "custom";
    if (!providers.some(provider => provider.id === providerId)) {
      providers.push({ id: providerId, name: "自定义供应商", icon: "auto", apiFormats: REASONING_API_FORMATS.map(format => format.value) });
    }
    return { ...rule, providerId, modelKey: rule.modelKey ?? builtin?.modelKey ?? rule.id };
  });
  return { ...catalog, reasoningProviders: providers, reasoningRules: rules };
}

export type ReasoningCatalogModel = {
  key: string;
  providerId: string;
  name: string;
  matches: string[];
  matchMode: ModelReasoningMatchMode;
  rules: ModelReasoningRule[];
};

export function reasoningCatalogModels(rules: ModelReasoningRule[]): ReasoningCatalogModel[] {
  const models: ReasoningCatalogModel[] = [];
  for (const rule of rules) {
    if (rule.modelKey === undefined || rule.providerId === undefined) continue;
    const model = models.find(candidate => candidate.key === rule.modelKey && candidate.providerId === rule.providerId);
    if (model !== undefined) model.rules.push(rule);
    else models.push({ key: rule.modelKey, providerId: rule.providerId, name: rule.name, matches: rule.matches, matchMode: rule.matchMode ?? "glob", rules: [rule] });
  }
  return models;
}
