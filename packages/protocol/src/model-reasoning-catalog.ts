import { z } from "zod";
import { ADDITIONAL_MODEL_REASONING_PROVIDERS, ADDITIONAL_MODEL_REASONING_RULES } from "./model-reasoning-additional-catalog.js";
import { isValidModelReasoningRegex } from "./model-reasoning-matcher.js";
import { modelApiFormatSchema, modelProviderIconSchema, modelReasoningOptionSchema, isReasoningOptionSupportedByApiFormat, modelReasoningOptionKey, type ModelReasoningOption } from "./conversation.js";

export const modelReasoningProviderSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  icon: modelProviderIconSchema,
  sourceUrl: z.string().max(2000).url().refine(value => /^https?:\/\//iu.test(value)).optional(),
  imageDataUrl: z.string().max(350_000).regex(/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u).optional(),
  apiFormats: z.array(modelApiFormatSchema).min(1).max(4)
    .refine(values => new Set(values).size === values.length, "Protocols must be unique."),
}).strict();
export type ModelReasoningProvider = z.infer<typeof modelReasoningProviderSchema>;

export const DEFAULT_MODEL_REASONING_PROVIDERS: ModelReasoningProvider[] = [
  { id: "openai", name: "OpenAI", icon: "openai", apiFormats: ["openai-chat-completions", "openai-responses"], sourceUrl: "https://developers.openai.com/api/docs/guides/reasoning" },
  { id: "anthropic", name: "Anthropic", icon: "anthropic", apiFormats: ["anthropic-messages"], sourceUrl: "https://platform.claude.com/docs/en/build-with-claude/effort" },
  { id: "google", name: "Google", icon: "google", apiFormats: ["google-gemini", "openai-chat-completions"], sourceUrl: "https://ai.google.dev/gemini-api/docs/thinking" },
  { id: "deepseek", name: "DeepSeek", icon: "deepseek", apiFormats: ["openai-chat-completions", "openai-responses", "anthropic-messages"], sourceUrl: "https://api-docs.deepseek.com/guides/thinking_mode/" },
  { id: "moonshot", name: "Moonshot", icon: "moonshot", apiFormats: ["openai-chat-completions"], sourceUrl: "https://platform.kimi.ai/docs/guide/use-thinking-models" },
  { id: "zhipu", name: "智谱", icon: "zhipu", apiFormats: ["openai-chat-completions"], sourceUrl: "https://docs.z.ai/guides/overview/concept-param" },
  { id: "xai", name: "xAI", icon: "xai", apiFormats: ["openai-chat-completions", "openai-responses"], sourceUrl: "https://docs.x.ai/developers/model-capabilities/text/reasoning" },
  { id: "qwen", name: "通义千问", icon: "qwen", apiFormats: ["openai-chat-completions"], sourceUrl: "https://www.alibabacloud.com/help/en/model-studio/deep-thinking" },
  { id: "minimax", name: "MiniMax", icon: "minimax", apiFormats: ["openai-chat-completions", "openai-responses", "anthropic-messages"], sourceUrl: "https://platform.minimax.io/docs/guides/text-generation" },
  ...ADDITIONAL_MODEL_REASONING_PROVIDERS,
];

export const modelReasoningRuleSchema = z.object({
  id: z.string().trim().min(1).max(100),
  name: z.string().trim().min(1).max(200),
  providerId: z.string().trim().min(1).max(100).optional(),
  modelKey: z.string().trim().min(1).max(100).optional(),
  matchMode: z.enum(["exact", "glob", "regex"]).optional(),
  matches: z.array(z.string().trim().min(1).max(200)).min(1).max(20),
  apiFormat: modelApiFormatSchema,
  options: z.array(modelReasoningOptionSchema).max(16),
  note: z.string().max(1000).optional(),
  sourceUrl: z.string().url().refine(value => /^https?:\/\//iu.test(value)).optional(),
}).strict().superRefine((rule, context) => {
  if (rule.matchMode === "regex") rule.matches.forEach((pattern, index) => {
    if (!isValidModelReasoningRegex(pattern)) context.addIssue({ code: "custom", path: ["matches", index], message: "Invalid RE2 regular expression." });
  });
  const keys = new Set<string>();
  rule.options.forEach((option, index) => {
    const key = modelReasoningOptionKey(option);
    if (keys.has(key) || !isReasoningOptionSupportedByApiFormat(rule.apiFormat, option)) {
      context.addIssue({ code: "custom", path: ["options", index], message: "Duplicate or protocol-incompatible reasoning option." });
    }
    keys.add(key);
  });
});

export type ModelReasoningRule = z.infer<typeof modelReasoningRuleSchema>;

const names = { none: "无", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" } as const;
function efforts(values: readonly (keyof typeof names)[]): ModelReasoningOption[] {
  return values.map(value => ({ kind: "effort", value, displayName: names[value], enabled: true }));
}
function budgets(values: number[]): ModelReasoningOption[] {
  return values.map(value => ({ kind: "token_budget", value, enabled: true,
    displayName: value === -1 ? "动态" : value === 0 ? "关闭" : `${value} tokens` }));
}

const openaiSource = "https://developers.openai.com/api/docs/guides/latest-model";
const claudeSource = "https://platform.claude.com/docs/en/build-with-claude/effort";
const geminiSource = "https://ai.google.dev/gemini-api/docs/generate-content/thinking";
type Seed = Omit<ModelReasoningRule, "id" | "apiFormat"> & { id: string; formats: ModelReasoningRule["apiFormat"][] };
const openaiFormats = ["openai-chat-completions", "openai-responses"] as const;

/** Verified against the linked official API documentation on 2026-10-15.
 * Empty options mean automatic/provider-controlled thinking, not no reasoning.
 */
const seeds: Seed[] = [
  { id: "gpt6", name: "OpenAI GPT-6 / GPT-6.1", matches: ["gpt-6-*", "gpt-6.1-*"], formats: [...openaiFormats],
    options: efforts(["low", "medium", "high", "xhigh", "max"]), sourceUrl: openaiSource,
    note: "不支持 none/minimal；GPT-6.1 Sol 的工具调用应使用 Responses。ultra 不是 reasoning.effort 档位。" },
  { id: "gpt6-luna", name: "GPT-6 Luna", matches: ["gpt-6-luna"], formats: [...openaiFormats],
    options: efforts(["none", "low", "medium", "high", "xhigh", "max"]), sourceUrl: "https://developers.openai.com/api/docs/models/gpt-6-luna" },
  { id: "gpt56", name: "OpenAI GPT-5.6", matches: ["gpt-5.6", "gpt-5.6-*"], formats: [...openaiFormats],
    options: efforts(["none", "low", "medium", "high", "xhigh", "max"]), sourceUrl: openaiSource },
  { id: "gpt55", name: "OpenAI GPT-5.5", matches: ["gpt-5.5", "gpt-5.5-20*"], formats: [...openaiFormats],
    options: efforts(["none", "low", "medium", "high", "xhigh"]), sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.5" },
  { id: "gpt54", name: "OpenAI GPT-5.2 / 5.4", matches: ["gpt-5.2", "gpt-5.2-20*", "gpt-5.4", "gpt-5.4-20*", "gpt-5.4-mini*", "gpt-5.4-nano*"], formats: [...openaiFormats],
    options: efforts(["none", "low", "medium", "high", "xhigh"]), sourceUrl: openaiSource },
  { id: "gpt-pro", name: "OpenAI GPT-5.2 / 5.4 Pro", matches: ["gpt-5.2-pro*", "gpt-5.4-pro*"], formats: ["openai-responses"],
    options: efforts(["medium", "high", "xhigh"]), sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5.4-pro" },
  { id: "gpt5-pro", name: "GPT-5 Pro", matches: ["gpt-5-pro"], formats: ["openai-responses"], options: efforts(["high"]), sourceUrl: "https://developers.openai.com/api/docs/models/gpt-5-pro" },
  { id: "o3-pro", name: "o3-pro", matches: ["o3-pro"], formats: ["openai-responses"], options: [], sourceUrl: "https://developers.openai.com/api/docs/models/o3-pro", note: "高计算量 Pro 模型；该型号页未单独列出可调档位，默认不指定。" },
  { id: "o1-pro", name: "o1-pro（服务默认）", matches: ["o1-pro", "o1-pro-20*"], formats: ["openai-responses"], options: [], sourceUrl: "https://developers.openai.com/api/docs/models/o1-pro", note: "旧 Pro 型号；本目录未核实可调 effort，沿用服务默认。官方计划 2026-10-23 退役。" },
  { id: "gpt5", name: "OpenAI GPT-5 / Mini / Nano", matches: ["gpt-5", "gpt-5-20*", "gpt-5-mini*", "gpt-5-nano*"], formats: [...openaiFormats],
    options: efforts(["minimal", "low", "medium", "high"]), sourceUrl: openaiSource },
  { id: "gpt51", name: "OpenAI GPT-5.1", matches: ["gpt-5.1", "gpt-5.1-20*"], formats: [...openaiFormats],
    options: efforts(["none", "low", "medium", "high"]), sourceUrl: openaiSource },
  { id: "codex", name: "OpenAI GPT-5.3 Codex", matches: ["gpt-5.3-codex"], formats: ["openai-responses"],
    options: efforts(["low", "medium", "high", "xhigh"]), sourceUrl: openaiSource },
  { id: "o-series", name: "OpenAI o1 / o3 / o4-mini", matches: ["o1", "o1-20*", "o3", "o3-20*", "o3-mini*", "o4-mini*"], formats: [...openaiFormats],
    options: efforts(["low", "medium", "high"]), sourceUrl: "https://developers.openai.com/api/docs/guides/reasoning" },
  { id: "claude-adaptive", name: "Claude Opus 4.6 / Sonnet 4.6 / Mythos Preview", matches: ["claude-opus-4-6*", "claude-sonnet-4-6*", "claude-mythos-preview*"], formats: ["anthropic-messages"],
    options: efforts(["low", "medium", "high", "max"]), sourceUrl: claudeSource },
  { id: "claude-latest", name: "Claude 5 / Opus 4.7–4.8", matches: ["claude-opus-5*", "claude-sonnet-5*", "claude-haiku-5-5*", "claude-fable-5*", "claude-mythos-5*", "claude-opus-4-7*", "claude-opus-4-8*"], formats: ["anthropic-messages"],
    options: efforts(["low", "medium", "high", "xhigh", "max"]), sourceUrl: claudeSource },
  { id: "claude-budget", name: "Claude 3.7 / 4 / 4.5（预算）", matches: ["claude-3-7-sonnet*", "claude-sonnet-4-20*", "claude-opus-4-20*", "claude-opus-4-1*", "claude-sonnet-4-5*", "claude-haiku-4-5*", "claude-opus-4-5*"], formats: ["anthropic-messages"],
    options: budgets([1024, 2048, 4096, 8191]), sourceUrl: "https://platform.claude.com/docs/en/build-with-claude/thinking",
    note: "budget_tokens 为数值预算，不是厂商定义的轻度/深度档位；当前应用每轮输出上限 8192，预算须低于该值。" },
  { id: "gemini3-pro", name: "Gemini 3 Pro", matches: ["gemini-3-pro*"], formats: ["google-gemini", "openai-chat-completions"], options: efforts(["low", "high"]), sourceUrl: geminiSource },
  { id: "gemini-medium", name: "Gemini 3.1 Pro / 3.8 Flash / 4 Argon", matches: ["gemini-3.1-pro*", "gemini-3.8-flash*", "gemini-4-argon*"], formats: ["google-gemini", "openai-chat-completions"], options: efforts(["low", "medium", "high"]), sourceUrl: geminiSource },
  { id: "gemini-flash", name: "Gemini 3 Flash / 3.6 Flash / Flash-Lite", matches: ["gemini-3-flash*", "gemini-3.6-flash*", "gemini-3.1-flash-lite*", "gemini-3.5-flash-lite*", "gemini-robotics-er-2*"], formats: ["google-gemini", "openai-chat-completions"], options: efforts(["minimal", "low", "medium", "high"]), sourceUrl: geminiSource },
  { id: "gemini-image", name: "Gemini 3.1 Flash-Lite Image", matches: ["gemini-3.1-flash-lite-image*"], formats: ["google-gemini", "openai-chat-completions"], options: efforts(["minimal", "high"]), sourceUrl: geminiSource },
  { id: "gemini25-pro", name: "Gemini 2.5 Pro（预算）", matches: ["gemini-2.5-pro*"], formats: ["google-gemini"], options: budgets([-1, 128, 1024, 4096, 8192, 32768]), sourceUrl: geminiSource, note: "预算 128–32768；不能关闭思考。" },
  { id: "gemini25-flash", name: "Gemini 2.5 Flash / Flash-Lite（预算）", matches: ["gemini-2.5-flash*"], formats: ["google-gemini"], options: budgets([-1, 0, 1024, 4096, 8192, 24576]), sourceUrl: geminiSource },
  { id: "deepseek", name: "DeepSeek V4 / V4.1", matches: ["deepseek-v4*", "deepseek-flash"], formats: ["anthropic-messages"], options: efforts(["low", "high", "max"]), sourceUrl: "https://api-docs.deepseek.com/guides/thinking_mode/", note: "默认 high；其他兼容别名会被映射，不作为独立档位。" },
  { id: "deepseek-chat", name: "DeepSeek Chat", matches: ["deepseek-v4*", "deepseek-flash"], formats: ["openai-chat-completions"], options: efforts(["none", "low", "high", "max"]), sourceUrl: "https://api-docs.deepseek.com/api/create-chat-completion/", note: "当前 Chat API 参数参考明确接受 none 关闭；low/high/max 是实际推理档位。" },
  { id: "deepseek-responses", name: "DeepSeek Responses（可关闭）", matches: ["deepseek-v4*", "deepseek-flash"], formats: ["openai-responses"], options: efforts(["none", "low", "high", "max"]), sourceUrl: "https://api-docs.deepseek.com/guides/thinking_mode/" },
  { id: "kimi3", name: "Kimi K3", matches: ["kimi-k3*"], formats: ["openai-chat-completions"], options: efforts(["low", "high", "max"]), sourceUrl: "https://platform.kimi.ai/docs/guide/use-thinking-models", note: "思考常开，默认 max。K2.x 的开关不等于 effort 档位。" },
  { id: "glm", name: "GLM 5.2 / 5.3", matches: ["glm-5.2*", "glm-5.3*"], formats: ["openai-chat-completions"], options: efforts(["low", "high", "max"]), sourceUrl: "https://docs.z.ai/guides/overview/concept-param" },
  { id: "grok43", name: "Grok 4.3", matches: ["grok-4.3*"], formats: [...openaiFormats], options: efforts(["none", "low", "medium", "high"]), sourceUrl: "https://docs.x.ai/developers/model-capabilities/text/reasoning" },
  { id: "grok45", name: "Grok 4.5", matches: ["grok-4.5*"], formats: [...openaiFormats], options: efforts(["low", "medium", "high"]), sourceUrl: "https://docs.x.ai/developers/model-capabilities/text/reasoning" },
  { id: "grok46", name: "Grok 4.6 / 4.7", matches: ["grok-4.6*", "grok-4.7*"], formats: [...openaiFormats], options: efforts(["low", "medium", "high", "xhigh"]), sourceUrl: "https://docs.x.ai/developers/model-capabilities/text/reasoning" },
  ...([
    { id: "qwen", name: "Qwen", matches: ["qwen*"], sourceUrl: "https://www.alibabacloud.com/help/en/model-studio/deep-thinking" },
    { id: "kimi2", name: "Kimi K2", matches: ["kimi-k2*"], sourceUrl: "https://platform.kimi.ai/docs/guide/use-thinking-models" },
    { id: "minimax2", name: "MiniMax M2", matches: ["minimax-m2*"], sourceUrl: "https://platform.minimax.io/docs/guides/text-generation" },
  ].map(seed => ({ ...seed, formats: ["openai-chat-completions"] as ModelReasoningRule["apiFormat"][], options: [], note: "沿用服务默认。扩展开关与预算不等于标准 effort 档位。" }))),
  { id: "minimax31", name: "MiniMax M3.1 Flash Preview", matches: ["minimax-m3.1-flash-preview*"], formats: [...openaiFormats, "anthropic-messages"], options: efforts(["low", "medium", "high", "xhigh", "max"]), sourceUrl: "https://platform.minimax.io/docs/guides/text-generation", note: "思考常开，默认 max；不同协议分别发送 effort 对应字段。" },
  { id: "minimax3", name: "MiniMax M3", matches: ["minimax-m3"], formats: [...openaiFormats, "anthropic-messages"], options: [], sourceUrl: "https://platform.minimax.io/docs/guides/models-intro", note: "固定 effort 档位尚未在此型号文档中单独列明，沿用服务默认。" },
  { id: "glm-legacy", name: "GLM", matches: ["glm-5.1", "glm-5", "glm-4.7", "glm-4.6"], formats: ["openai-chat-completions"], options: [], sourceUrl: "https://docs.z.ai/guides/overview/overview", note: "旧型号不套用 5.2/5.3 的 effort 档位，沿用服务默认。" },
  { id: "gemini-compatible", name: "Gemini 2.5 Pro OpenAI 兼容接口", matches: ["gemini-2.5-pro*"], formats: ["openai-chat-completions"], options: efforts(["low", "medium", "high"]), sourceUrl: "https://ai.google.dev/gemini-api/docs/openai", note: "Google 官方 OpenAI 兼容接口将 low/medium/high 映射为数值预算；不能关闭 Pro 思考。" },
  { id: "gemini-compatible-flash", name: "Gemini 2.5 Flash OpenAI 兼容接口", matches: ["gemini-2.5-flash*"], formats: ["openai-chat-completions"], options: efforts(["none", "low", "medium", "high"]), sourceUrl: "https://ai.google.dev/gemini-api/docs/openai" },
];

/** Concrete public text/chat model IDs checked against the vendor model lists.
 * Live, TTS, embedding and image-only endpoints do not use this chat adapter.
 */
const modelIdsBySeed: Record<string, string[]> = {
  gpt6: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol"],
  "gpt6-luna": ["gpt-6-luna"],
  gpt56: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6"],
  gpt55: ["gpt-5.5"],
  gpt54: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.2"],
  "gpt-pro": ["gpt-5.5-pro", "gpt-5.4-pro", "gpt-5.2-pro"],
  "gpt5-pro": ["gpt-5-pro"], "o3-pro": ["o3-pro"],
  gpt5: ["gpt-5", "gpt-5-mini", "gpt-5-nano"],
  gpt51: ["gpt-5.1"], codex: ["gpt-5.3-codex", "gpt-5.2-codex"], "o-series": ["o1", "o3", "o3-mini", "o4-mini"],
  "claude-latest": ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-mythos-5-1", "claude-opus-5", "claude-sonnet-5", "claude-fable-5", "claude-mythos-5", "claude-opus-4-8", "claude-opus-4-7"],
  "claude-adaptive": ["claude-opus-4-6", "claude-sonnet-4-6", "claude-mythos-preview"],
  "claude-budget": ["claude-opus-4-5", "claude-sonnet-4-5", "claude-haiku-4-5"],
  "gemini3-pro": ["gemini-3-pro-preview"],
  "gemini-medium": ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.1-pro-preview"],
  "gemini-flash": ["gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite", "gemini-3-flash-preview"],
  "gemini-image": ["gemini-3.1-flash-lite-image"],
  "gemini25-pro": ["gemini-2.5-pro"], "gemini-compatible": ["gemini-2.5-pro"],
  "gemini25-flash": ["gemini-2.5-flash", "gemini-2.5-flash-lite"], "gemini-compatible-flash": ["gemini-2.5-flash", "gemini-2.5-flash-lite"],
  deepseek: ["deepseek-flash", "deepseek-v4-pro"], "deepseek-chat": ["deepseek-flash", "deepseek-v4-pro"], "deepseek-responses": ["deepseek-flash", "deepseek-v4-pro"],
  kimi3: ["kimi-k3"], kimi2: ["kimi-k2.6", "kimi-k2.7-code", "kimi-k2.7-code-highspeed"],
  glm: ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx", "glm-5.2"],
  "glm-legacy": ["glm-5.1", "glm-5", "glm-4.7", "glm-4.6"],
  grok43: ["grok-4.3"], grok45: ["grok-4.5"], grok46: ["grok-4.7", "grok-4.6"],
  qwen: ["qwen3.8-max", "qwen3.8-flash", "qwen3.7-max", "qwen3.7-plus", "qwen3.7-flash", "qwen3.6-plus", "qwen3.6-flash", "qwen3.5-plus", "qwen3.5-flash", "qwen3-coder-plus", "qwen3-coder-flash", "qwen-plus", "qwen-turbo"],
  minimax31: ["MiniMax-M3.1-Flash-Preview"], minimax3: ["MiniMax-M3"],
  minimax2: ["MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"],
};

function providerForSeed(id: string): string {
  return id.startsWith("claude") ? "anthropic"
    : id.startsWith("gemini") ? "google"
    : id.startsWith("deepseek") ? "deepseek"
    : id.startsWith("kimi") ? "moonshot"
    : id.startsWith("glm") ? "zhipu"
    : id.startsWith("grok") ? "xai"
    : id.startsWith("minimax") ? "minimax"
    : id === "qwen" ? "qwen" : "openai";
}

/** The previous exact defaults are also the compatibility/migration baseline. */
export const LEGACY_EXACT_MODEL_REASONING_RULES: ModelReasoningRule[] = seeds.flatMap(({ formats, ...seed }) => {
  const providerId = providerForSeed(seed.id);
  return (modelIdsBySeed[seed.id] ?? []).flatMap(modelId => formats.map(apiFormat => {
    const datedAliases: Record<string, string> = { "claude-opus-4-5": "claude-opus-4-5-20251101", "claude-sonnet-4-5": "claude-sonnet-4-5-20250929", "claude-haiku-4-5": "claude-haiku-4-5-20251001" };
    return modelReasoningRuleSchema.parse({ ...seed, name: modelId, matches: [modelId, ...(datedAliases[modelId] ? [datedAliases[modelId]] : [])],
      matchMode: "exact", providerId, modelKey: modelId, id: `${modelId}-${apiFormat}`, apiFormat });
  }));
});

type Group = { id: string; name: string; seeds: string[]; matchMode: "glob" | "exact"; matches: string[]; note?: string };
const groups: Group[] = [
  { id: "gpt-sol", name: "GPT-6 Sol / GPT-5.6 Sol、Terra", seeds: ["gpt56"], matchMode: "glob", matches: ["gpt-*-*sol", "gpt-*-*sol-*", "gpt-5.6", "gpt-5.6-20*", "gpt-5.6-terra*"],
    note: "这里配置直接 API 的 effort 参数。Codex 中的 Ultra 是子代理并行运行模式，不是可直接发送的 effort 值。" },
  { id: "gpt-luna", name: "GPT-6 / GPT-5.6 Luna", seeds: ["gpt6-luna"], matchMode: "glob", matches: ["gpt-*-*luna", "gpt-*-*luna-*"],
    note: "Luna 在 Codex 中最高为 Max，不支持 Ultra。直接 API 的档位与 Sol 相同，但两者分别维护。" },
  { id: "gpt6", name: "GPT-6.1 Sol / GPT Astra", seeds: ["gpt6"], matchMode: "glob", matches: ["gpt-*-*astra", "gpt-*-*astra-*", "gpt-6.1-sol*"],
    note: "直接 API 不支持 none/minimal；GPT-6.1 Sol 工具调用使用 Responses。Codex 的 Ultra 为子代理并行运行模式，不是 API effort 值。" },
  { id: "gpt52-55", name: "GPT-5.5 / 5.4 / 5.2（含 5.4 Mini、Nano）", seeds: ["gpt55", "gpt54"], matchMode: "glob", matches: ["gpt-5.5", "gpt-5.5-20*", "gpt-5.4", "gpt-5.4-20*", "gpt-5.4-mini*", "gpt-5.4-nano*", "gpt-5.2", "gpt-5.2-20*"] },
  { id: "gpt-pro", name: "GPT-5.5 / 5.4 / 5.2 Pro", seeds: ["gpt-pro"], matchMode: "glob", matches: ["gpt-5.5-pro*", "gpt-5.4-pro*", "gpt-5.2-pro*"] },
  { id: "codex", name: "GPT-5.3 / 5.2 Codex", seeds: ["codex"], matchMode: "glob", matches: ["gpt-5.3-codex*", "gpt-5.2-codex*"] },
  { id: "gpt51", name: "GPT-5.1", seeds: ["gpt51"], matchMode: "glob", matches: ["gpt-5.1", "gpt-5.1-20*"] },
  { id: "gpt5", name: "GPT-5 / Mini、Nano", seeds: ["gpt5"], matchMode: "glob", matches: ["gpt-5", "gpt-5-20*", "gpt-5-mini*", "gpt-5-nano*"] },
  { id: "gpt5-pro", name: "GPT-5 Pro", seeds: ["gpt5-pro"], matchMode: "glob", matches: ["gpt-5-pro*"] },
  { id: "o-series", name: "o4-mini / o3、o3-mini / o1", seeds: ["o-series"], matchMode: "glob", matches: ["o4-mini*", "o3", "o3-20*", "o3-mini*", "o1", "o1-20*"] },
  { id: "o3-pro", name: "o3-pro", seeds: ["o3-pro"], matchMode: "glob", matches: ["o3-pro", "o3-pro-20*"] },
  { id: "o1-pro", name: "o1-pro（服务默认）", seeds: ["o1-pro"], matchMode: "glob", matches: ["o1-pro", "o1-pro-20*"] },
  { id: "claude-latest", name: "Claude 5.5 / Fable、Mythos 5.1、5 / Opus 4.8、4.7", seeds: ["claude-latest"], matchMode: "glob", matches: ["claude-opus-5*", "claude-sonnet-5*", "claude-haiku-5-5*", "claude-fable-5*", "claude-mythos-5*", "claude-opus-4-8*", "claude-opus-4-7*"] },
  { id: "claude-adaptive", name: "Claude 4.6 Opus、Sonnet / Mythos Preview", seeds: ["claude-adaptive"], matchMode: "glob", matches: ["claude-opus-4-6*", "claude-sonnet-4-6*", "claude-mythos-preview*"] },
  { id: "claude-budget", name: "Claude 4.5 Opus、Sonnet、Haiku（预算）", seeds: ["claude-budget"], matchMode: "glob", matches: ["claude-opus-4-5*", "claude-sonnet-4-5*", "claude-haiku-4-5*"] },
  { id: "gemini-medium", name: "Gemini 4 Argon / 3.8 Flash / 3.1 Pro", seeds: ["gemini-medium"], matchMode: "glob", matches: ["gemini-4-argon*", "gemini-3.8-flash*", "gemini-3.1-pro*"] },
  { id: "gemini-flash", name: "Gemini 3.6 Flash / 3.5、3.1 Flash-Lite / 3 Flash", seeds: ["gemini-flash"], matchMode: "glob", matches: ["gemini-3.6-flash*", "gemini-3.5-flash-lite*", "gemini-3.1-flash-lite*", "gemini-3-flash*"] },
  { id: "gemini-image", name: "Gemini 3.1 Flash-Lite Image", seeds: ["gemini-image"], matchMode: "glob", matches: ["gemini-3.1-flash-lite-image*"] },
  { id: "gemini3-pro", name: "Gemini 3 Pro", seeds: ["gemini3-pro"], matchMode: "glob", matches: ["gemini-3-pro", "gemini-3-pro-preview*"] },
  { id: "gemini25-pro", name: "Gemini 2.5 Pro", seeds: ["gemini25-pro", "gemini-compatible"], matchMode: "glob", matches: ["gemini-2.5-pro", "gemini-2.5-pro-preview*"] },
  { id: "gemini25-flash", name: "Gemini 2.5 Flash / Flash-Lite", seeds: ["gemini25-flash", "gemini-compatible-flash"], matchMode: "glob", matches: ["gemini-2.5-flash", "gemini-2.5-flash-preview*", "gemini-2.5-flash-lite*"] },
  { id: "deepseek", name: "DeepSeek V4.1 Flash / V4 Pro", seeds: ["deepseek", "deepseek-chat", "deepseek-responses"], matchMode: "glob", matches: ["deepseek-flash*", "deepseek-v4-pro*", "deepseek-v4-flash*"] },
  { id: "kimi3", name: "Kimi K3", seeds: ["kimi3"], matchMode: "glob", matches: ["kimi-k3*"] },
  { id: "kimi2", name: "Kimi K2.7 Code / K2.6（服务默认）", seeds: ["kimi2"], matchMode: "glob", matches: ["kimi-k2.7-code*", "kimi-k2.6*"] },
  { id: "glm", name: "GLM 5.3（含 Flash、FlashX）/ 5.2", seeds: ["glm"], matchMode: "glob", matches: ["glm-5.3*", "glm-5.2*"] },
  { id: "glm-legacy", name: "GLM 5.1 / 5 / 4.7、4.6（服务默认）", seeds: ["glm-legacy"], matchMode: "glob", matches: ["glm-5.1*", "glm-5", "glm-4.7*", "glm-4.6*"] },
  { id: "grok46", name: "Grok 4.7 / 4.6", seeds: ["grok46"], matchMode: "glob", matches: ["grok-4.7*", "grok-4.6*"] },
  { id: "grok45", name: "Grok 4.5", seeds: ["grok45"], matchMode: "glob", matches: ["grok-4.5*"] },
  { id: "grok43", name: "Grok 4.3", seeds: ["grok43"], matchMode: "glob", matches: ["grok-4.3*"] },
  { id: "qwen", name: "Qwen 3.8–3 / VL、Next、Coder / Plus、Turbo（服务默认）", seeds: ["qwen"], matchMode: "glob", matches: ["qwen3.8-*", "qwen3.7-*", "qwen3.6-*", "qwen3.5-*", "qwen3-*", "qwen-plus*", "qwen-turbo*"] },
  { id: "minimax31", name: "MiniMax M3.1 Flash Preview", seeds: ["minimax31"], matchMode: "glob", matches: ["MiniMax-M3.1-Flash-Preview*"] },
  { id: "minimax3", name: "MiniMax M3（服务默认）", seeds: ["minimax3"], matchMode: "exact", matches: ["MiniMax-M3"] },
  { id: "minimax2", name: "MiniMax M2.x（服务默认）", seeds: ["minimax2"], matchMode: "glob", matches: ["MiniMax-M2*"] },
];

export const DEFAULT_MODEL_REASONING_RULES: ModelReasoningRule[] = [...groups.flatMap(group => {
  const rules: ModelReasoningRule[] = [];
  for (const seedId of group.seeds) {
    const seed = seeds.find(item => item.id === seedId);
    if (seed === undefined) throw new Error(`Missing reasoning seed: ${seedId}`);
    const { formats, ...source } = seed;
    for (const apiFormat of formats) {
      const existing = rules.find(rule => rule.apiFormat === apiFormat);
      if (existing !== undefined) {
        if (JSON.stringify(existing.options) !== JSON.stringify(seed.options)) throw new Error(`Incompatible reasoning group: ${group.id}`);
        continue;
      }
      rules.push(modelReasoningRuleSchema.parse({ ...source, id: `${group.id}-${apiFormat}`, modelKey: group.id,
        name: group.name, providerId: providerForSeed(seedId), matchMode: group.matchMode, matches: group.matches,
        note: group.note ?? source.note, apiFormat }));
    }
  }
  return rules;
}), ...ADDITIONAL_MODEL_REASONING_RULES.map(rule => modelReasoningRuleSchema.parse(rule))];
