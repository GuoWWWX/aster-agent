import { z } from "zod";

import { modelReasoningOptionSchema } from "./conversation.js";

const modelCatalogPatternSchema = z.string().trim().min(1).max(200);

export const modelCatalogRuleSchema = z.object({
  contextWindow: z.number().int().min(1).max(10_000_000),
  id: z.string().trim().min(1).max(100),
  matches: z.array(modelCatalogPatternSchema).min(1).max(20),
  name: z.string().trim().min(1).max(200),
  reasoningOptions: z.array(modelReasoningOptionSchema).max(16).optional(),
}).strict();

export const modelCatalogSchema = z.object({
  defaultContextWindow: z.number().int().min(1).max(10_000_000),
  models: z.array(modelCatalogRuleSchema).max(500),
  version: z.literal(1),
}).strict();

export type ModelCatalog = z.infer<typeof modelCatalogSchema>;
export type ModelCatalogRule = z.infer<typeof modelCatalogRuleSchema>;

const GPT_5_6_REASONING_OPTIONS = [
  { displayName: "无", enabled: true, kind: "effort", value: "none" },
  { displayName: "低", enabled: true, kind: "effort", value: "low" },
  { displayName: "中", enabled: true, kind: "effort", value: "medium" },
  { displayName: "高", enabled: true, kind: "effort", value: "high" },
  { displayName: "极高", enabled: true, kind: "effort", value: "xhigh" },
  { displayName: "最高", enabled: true, kind: "effort", value: "max" },
] as const;

/**
 * Seeded into the user-editable model-catalog.json on first desktop launch.
 * Values are intentionally limited to mainstream text/chat model identifiers;
 * providers can expose additional models and users can add local rules.
 */
export const DEFAULT_MODEL_CATALOG = modelCatalogSchema.parse({
  defaultContextWindow: 128_000,
  models: [
    {
      contextWindow: 1_050_000,
      id: "openai-gpt-5.6",
      matches: ["gpt-5.6", "gpt-5.6-*"],
      name: "OpenAI GPT-5.6",
      reasoningOptions: GPT_5_6_REASONING_OPTIONS,
    },
    {
      contextWindow: 1_050_000,
      id: "openai-gpt-5.5",
      matches: ["gpt-5.5", "gpt-5.5-pro"],
      name: "OpenAI GPT-5.5",
    },
    {
      contextWindow: 1_050_000,
      id: "openai-gpt-5.4-large",
      matches: ["gpt-5.4", "gpt-5.4-pro"],
      name: "OpenAI GPT-5.4",
    },
    {
      contextWindow: 400_000,
      id: "openai-gpt-5.4-small",
      matches: ["gpt-5.4-mini", "gpt-5.4-nano"],
      name: "OpenAI GPT-5.4 Mini/Nano",
    },
    {
      contextWindow: 400_000,
      id: "openai-gpt-5.3-codex",
      matches: ["gpt-5.3-codex"],
      name: "OpenAI GPT-5.3 Codex",
    },
    {
      contextWindow: 128_000,
      id: "openai-gpt-5.3-chat",
      matches: ["gpt-5.3-chat-latest", "gpt-5.3-codex-spark"],
      name: "OpenAI GPT-5.3 Chat",
    },
    {
      contextWindow: 400_000,
      id: "openai-gpt-5.2",
      matches: ["gpt-5.2", "gpt-5.2-pro"],
      name: "OpenAI GPT-5.2",
    },
    {
      contextWindow: 128_000,
      id: "openai-gpt-5.2-chat",
      matches: ["gpt-5.2-chat-latest"],
      name: "OpenAI GPT-5.2 Chat",
    },
    {
      contextWindow: 400_000,
      id: "openai-gpt-5-family",
      matches: ["gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-pro", "gpt-5.1"],
      name: "OpenAI GPT-5",
    },
    {
      contextWindow: 1_047_576,
      id: "openai-gpt-4.1",
      matches: ["gpt-4.1", "gpt-4.1-*"],
      name: "OpenAI GPT-4.1",
    },
    {
      contextWindow: 128_000,
      id: "openai-gpt-4o",
      matches: ["gpt-4o", "gpt-4o-*", "chatgpt-4o-latest"],
      name: "OpenAI GPT-4o",
    },
    {
      contextWindow: 128_000,
      id: "openai-gpt-4-turbo",
      matches: ["gpt-4-turbo", "gpt-4-turbo-*"],
      name: "OpenAI GPT-4 Turbo",
    },
    {
      contextWindow: 8_192,
      id: "openai-gpt-4",
      matches: ["gpt-4"],
      name: "OpenAI GPT-4",
    },
    {
      contextWindow: 200_000,
      id: "openai-o-series",
      matches: ["o1", "o1-*", "o3", "o3-*", "o4", "o4-*"],
      name: "OpenAI o-series",
    },
    {
      contextWindow: 16_385,
      id: "openai-gpt-3.5-turbo",
      matches: ["gpt-3.5-turbo", "gpt-3.5-turbo-*"],
      name: "OpenAI GPT-3.5 Turbo",
    },
    {
      contextWindow: 1_000_000,
      id: "anthropic-claude-million",
      matches: [
        "claude-fable-5*",
        "claude-opus-4-6*",
        "claude-opus-4-7*",
        "claude-opus-4-8*",
        "claude-opus-5*",
        "claude-sonnet-4-5*",
        "claude-sonnet-4-6*",
        "claude-sonnet-5*",
      ],
      name: "Anthropic Claude 1M",
    },
    {
      contextWindow: 200_000,
      id: "anthropic-claude-200k",
      matches: [
        "claude-haiku-4-5*",
        "claude-opus-4-5*",
        "claude-3*",
      ],
      name: "Anthropic Claude 200K",
    },
    {
      contextWindow: 1_048_576,
      id: "google-gemini-million",
      matches: [
        "gemini-2.0-flash",
        "gemini-2.5-flash",
        "gemini-2.5-flash-lite",
        "gemini-2.5-pro",
        "gemini-3-flash-preview",
        "gemini-3.1-flash-lite",
        "gemini-3.1-flash-lite-preview",
        "gemini-3.1-pro-preview*",
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.6-flash",
        "gemini-3.7-flash",
        "gemini-flash-latest",
        "gemini-flash-lite-latest",
      ],
      name: "Google Gemini 1M",
    },
    {
      contextWindow: 1_000_000,
      id: "deepseek-million",
      matches: ["deepseek-chat", "deepseek-reasoner", "deepseek-v4-*"],
      name: "DeepSeek 1M",
    },
    {
      contextWindow: 1_000_000,
      id: "qwen-million",
      matches: [
        "qwen-flash",
        "qwen-plus",
        "qwen-turbo",
        "qwen3-coder-flash",
        "qwen3.5-plus",
        "qwen3.6-flash",
        "qwen3.6-plus",
        "qwen3.7-max",
        "qwen3.7-plus",
        "qwen3.8-max",
      ],
      name: "Qwen 1M",
    },
    {
      contextWindow: 1_048_576,
      id: "qwen3-coder-plus",
      matches: ["qwen3-coder-plus"],
      name: "Qwen3 Coder Plus",
    },
    {
      contextWindow: 262_144,
      id: "qwen-262k",
      matches: [
        "qwen3-coder-30b-a3b-instruct",
        "qwen3-coder-480b-a35b-instruct",
        "qwen3-max",
        "qwen3.5-122b-a10b",
        "qwen3.5-27b",
        "qwen3.5-35b-a3b",
        "qwen3.5-397b-a17b",
        "qwen3.6-27b",
        "qwen3.6-35b-a3b",
      ],
      name: "Qwen 262K",
    },
    {
      contextWindow: 131_072,
      id: "qwen-131k",
      matches: ["qwen3-8b", "qwen3-14b", "qwen3-32b", "qwen3-235b-a22b"],
      name: "Qwen 131K",
    },
    {
      contextWindow: 32_768,
      id: "qwen-max",
      matches: ["qwen-max"],
      name: "Qwen Max",
    },
    {
      contextWindow: 1_048_576,
      id: "moonshot-kimi-k3",
      matches: ["kimi-k3"],
      name: "Moonshot Kimi K3",
    },
    {
      contextWindow: 262_144,
      id: "moonshot-kimi-k2",
      matches: ["kimi-k2.5", "kimi-k2.6", "kimi-k2.7-code*", "kimi-k2-thinking*", "kimi-k2-turbo-preview"],
      name: "Moonshot Kimi K2",
    },
    {
      contextWindow: 131_072,
      id: "moonshot-kimi-k2-0711",
      matches: ["kimi-k2-0711-preview"],
      name: "Moonshot Kimi K2 0711",
    },
    {
      contextWindow: 128_000,
      id: "moonshot-v1-128k",
      matches: ["moonshot-v1-128k"],
      name: "Moonshot v1 128K",
    },
    {
      contextWindow: 32_768,
      id: "moonshot-v1-32k",
      matches: ["moonshot-v1-32k"],
      name: "Moonshot v1 32K",
    },
    {
      contextWindow: 8_192,
      id: "moonshot-v1-8k",
      matches: ["moonshot-v1-8k"],
      name: "Moonshot v1 8K",
    },
    {
      contextWindow: 1_000_000,
      id: "zhipu-glm-5.2",
      matches: ["glm-5.2"],
      name: "Zhipu GLM-5.2",
    },
    {
      contextWindow: 204_800,
      id: "zhipu-glm-4.6-plus",
      matches: ["glm-4.6", "glm-4.7", "glm-5", "glm-5.1", "glm-5v-turbo"],
      name: "Zhipu GLM 200K",
    },
    {
      contextWindow: 200_000,
      id: "zhipu-glm-4.7-flash",
      matches: ["glm-4.7-flash", "glm-4.7-flashx"],
      name: "Zhipu GLM-4.7 Flash",
    },
    {
      contextWindow: 131_072,
      id: "zhipu-glm-4.5",
      matches: ["glm-4.5", "glm-4.5-air", "glm-4.5-flash"],
      name: "Zhipu GLM-4.5",
    },
    {
      contextWindow: 1_000_000,
      id: "zhipu-glm-4-long",
      matches: ["glm-4-long"],
      name: "Zhipu GLM-4 Long",
    },
    {
      contextWindow: 1_000_000,
      id: "minimax-m3",
      matches: ["minimax-m3"],
      name: "MiniMax M3",
    },
    {
      contextWindow: 204_800,
      id: "minimax-m2-latest",
      matches: ["minimax-m2.1", "minimax-m2.5*", "minimax-m2.7*"],
      name: "MiniMax M2.1+",
    },
    {
      contextWindow: 196_608,
      id: "minimax-m2",
      matches: ["minimax-m2"],
      name: "MiniMax M2",
    },
    {
      contextWindow: 262_144,
      id: "mistral-large-latest",
      matches: ["mistral-large-latest", "mistral-large-2512", "mistral-medium-latest", "mistral-medium-2508", "mistral-medium-2604"],
      name: "Mistral Large/Medium 262K",
    },
    {
      contextWindow: 256_000,
      id: "mistral-small-latest",
      matches: ["mistral-small-latest", "mistral-small-2603", "codestral-latest"],
      name: "Mistral Small/Codestral 256K",
    },
    {
      contextWindow: 262_144,
      id: "mistral-devstral",
      matches: ["devstral-latest", "devstral-2512", "devstral-medium-latest", "labs-devstral-small-2512"],
      name: "Mistral Devstral 262K",
    },
    {
      contextWindow: 128_000,
      id: "mistral-128k",
      matches: ["mistral-nemo", "ministral-3b-latest", "ministral-8b-latest", "magistral-small"],
      name: "Mistral 128K",
    },
    {
      contextWindow: 1_000_000,
      id: "xai-grok-million",
      matches: ["grok-4.20-*", "grok-4.3"],
      name: "xAI Grok 1M",
    },
    {
      contextWindow: 500_000,
      id: "xai-grok-500k",
      matches: ["grok-4.5", "grok-4.6"],
      name: "xAI Grok 500K",
    },
    {
      contextWindow: 256_000,
      id: "cohere-command-a",
      matches: ["command-a-03-2025", "command-a-reasoning-08-2025", "north-mini-code-1-0"],
      name: "Cohere Command A",
    },
    {
      contextWindow: 128_000,
      id: "cohere-command-r",
      matches: ["command-r-08-2024", "command-r-plus-08-2024", "command-r7b-*"],
      name: "Cohere Command R",
    },
    {
      contextWindow: 10_000_000,
      id: "meta-llama-4-scout",
      matches: ["llama-4-scout*"],
      name: "Meta Llama 4 Scout",
    },
    {
      contextWindow: 1_000_000,
      id: "meta-llama-4-maverick",
      matches: ["llama-4-maverick*"],
      name: "Meta Llama 4 Maverick",
    },
    {
      contextWindow: 131_072,
      id: "meta-llama-3",
      matches: ["llama-3.1*", "llama-3.2*", "llama-3.3*"],
      name: "Meta Llama 3",
    },
  ],
  version: 1,
});

function normalizeModelId(value: string): string {
  return value.trim().toLocaleLowerCase();
}

export function modelCatalogPatternMatches(pattern: string, modelId: string): boolean {
  const normalizedPattern = normalizeModelId(pattern);
  const normalizedModelId = normalizeModelId(modelId);
  if (normalizedPattern.length === 0 || normalizedModelId.length === 0) return false;
  const matcher = new RegExp(
    `^${normalizedPattern
      .replace(/[.+?^${}()|[\]\\]/g, "\\$&")
      .replaceAll("*", ".*")}$`,
  );
  const trailingModelId = normalizedModelId.split("/").at(-1) ?? normalizedModelId;
  return matcher.test(normalizedModelId) || matcher.test(trailingModelId);
}

export function resolveModelCatalogRule(
  catalog: ModelCatalog,
  modelId: string,
): ModelCatalogRule | undefined {
  for (let index = catalog.models.length - 1; index >= 0; index -= 1) {
    const rule = catalog.models[index];
    if (rule?.matches.some((pattern) => modelCatalogPatternMatches(pattern, modelId))) {
      return rule;
    }
  }
  return undefined;
}

export function resolveModelContextWindow(catalog: ModelCatalog, modelId: string): number {
  return resolveModelCatalogRule(catalog, modelId)?.contextWindow
    ?? catalog.defaultContextWindow;
}
