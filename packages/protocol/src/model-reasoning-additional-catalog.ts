import type { ModelReasoningProvider, ModelReasoningRule } from "./model-reasoning-catalog.js";
import type { ModelReasoningOption } from "./conversation.js";

/** Official service documentation checked 2026-10-15. Discovery registries are
 * not used as effort defaults: their host-specific mappings may differ. */
export const ADDITIONAL_MODEL_REASONING_PROVIDERS: ModelReasoningProvider[] = [
  { id: "mistral", name: "Mistral AI", icon: "mistral", apiFormats: ["openai-chat-completions"], sourceUrl: "https://docs.mistral.ai/studio/conversations/reasoning" },
  { id: "meta", name: "Meta Muse", icon: "meta", apiFormats: ["openai-chat-completions", "openai-responses"], sourceUrl: "https://dev.meta.ai/docs/reasoning" },
  { id: "stepfun", name: "阶跃星辰 StepFun", icon: "auto", apiFormats: ["openai-chat-completions", "anthropic-messages"], sourceUrl: "https://platform.stepfun.ai/docs/en/step-plan/integrations/reasoning-api" },
  { id: "xiaomi", name: "小米 MiMo", icon: "auto", apiFormats: ["openai-chat-completions", "anthropic-messages"], sourceUrl: "https://mimo.mi.com/docs/en-US/quick-start/usage-guide/other/deep-thinking" },
  { id: "longcat", name: "美团 LongCat", icon: "auto", apiFormats: ["openai-chat-completions", "anthropic-messages"], sourceUrl: "https://longcat.chat/platform/docs/" },
  { id: "cohere", name: "Cohere", icon: "auto", apiFormats: ["openai-chat-completions"], sourceUrl: "https://docs.cohere.com/docs/compatibility-api" },
];

const labels = { none: "无", minimal: "极低", low: "低", medium: "中", high: "高", xhigh: "极高", max: "最高" } as const;
const efforts = (values: (keyof typeof labels)[]): ModelReasoningOption[] => values.map(value => ({ kind: "effort", value, displayName: labels[value], enabled: true }));
const definitions = [
  { providerId: "mistral", key: "mistral-hybrid", name: "Mistral Large 4 / Medium 3.5 / Small 4", matches: ["mistral-large-4", "mistral-large-4-0", "mistral-medium-3-5", "mistral-medium-latest", "mistral-small-2603", "mistral-small-latest"], options: efforts(["none", "high"]), note: "原厂 Chat 的 reasoning_effort 只有 none/high。旧 Magistral 已退役，不当作最新在售型号。" },
  { providerId: "meta", key: "muse-standard-max", name: "Muse Wonder 1.0 / Spark 1.3", matches: ["muse-wonder-1.0", "muse-spark-1.3"], options: efforts(["minimal", "low", "medium", "high", "xhigh", "max"]), note: "原厂 Chat/Responses 支持 max；none 会返回 400。Wonder Full 属于 Muse Code 的独立模式。" },
  { providerId: "meta", key: "muse-spark", name: "Muse Spark 1.1 / 1.2 / Contributor", matches: ["muse-spark-1.1", "muse-spark-1.2", "muse-spark-1.2-contributor", "muse-spark-1.3-contributor"], options: efforts(["minimal", "low", "medium", "high", "xhigh"]), note: "Contributor 变体不继承普通 Spark 1.3 的 max；不能关闭推理。" },
  { providerId: "stepfun", key: "step-three-levels", name: "Step 5 Preview / 3.7 Flash", matches: ["step-5-preview", "step-3.7-flash"], options: efforts(["low", "medium", "high"]), note: "Chat 发送 reasoning_effort，Messages 发送 output_config.effort；需使用对应服务端点。" },
  { providerId: "stepfun", key: "step-flash-2603", name: "Step 3.5 Flash 2603", matches: ["step-3.5-flash-2603"], options: efforts(["low", "high"]), note: "2603 版本只有 low/high，不套用 Step 5 的 medium。" },
  { providerId: "stepfun", key: "step-flash-default", name: "Step 3.5 Flash（服务默认）", matches: ["step-3.5-flash"], options: [], note: "基础版本与 2603 分开；本目录默认不指定 effort。" },
  { providerId: "xiaomi", key: "mimo-thinking", name: "MiMo V2.6 / V2.5（思考开关）", matches: ["mimo-v2.6-*", "mimo-v2.5", "mimo-v2.5-pro"], options: [], note: "原厂使用 thinking.type enabled/disabled，并非固定 effort 档位，本应用此处沿用服务默认。V2.5/V2.5-Pro 官方预告 2026-10-21 退役。" },
  { providerId: "longcat", key: "longcat-thinking", name: "LongCat 2.5 Preview / 2.0（服务默认）", matches: ["LongCat-2.5-Preview", "LongCat-2.0"], options: [], note: "已核实 Chat/Messages 型号；默认不指定 effort，不把思考开关当作标准推理档位。" },
  { providerId: "cohere", key: "cohere-reasoning", name: "Command A+ / A Reasoning / North Mini Code", matches: ["command-a-plus-05-2026", "command-a-reasoning-08-2025", "north-mini-code-1-0"], options: [], note: "使用 Cohere 的 OpenAI 兼容端点；原生 thinking 开关及预算不等同于标准 effort，此处沿用服务默认。" },
];

export const ADDITIONAL_MODEL_REASONING_RULES: ModelReasoningRule[] = definitions.flatMap(definition => {
  const provider = ADDITIONAL_MODEL_REASONING_PROVIDERS.find(item => item.id === definition.providerId)!;
  return provider.apiFormats.map(apiFormat => ({ id: `${definition.key}-${apiFormat}`, modelKey: definition.key,
    providerId: provider.id, name: definition.name, matches: definition.matches, matchMode: definition.matches.some(value => value.includes("*")) ? "glob" as const : "exact" as const,
    apiFormat, options: definition.options, note: definition.note, sourceUrl: provider.sourceUrl! }));
});
