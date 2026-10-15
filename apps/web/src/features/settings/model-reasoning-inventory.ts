/** Public chat/reasoning IDs checked on 2026-10-15. This is a searchable
 * reference inventory, not an account's available-model response or effort data.
 * Keep it independent of the frozen legacy migration defaults in protocol.
 */
export const MODEL_REASONING_INVENTORY: Record<string, { sourceUrls: string[]; note: string; modelIds: string[] }> = {
  openai: {
    sourceUrls: ["https://developers.openai.com/api/docs/models/all", "https://developers.openai.com/api/docs/deprecations"],
    note: "包含 GPT、GPT-5.3 Codex、o 系列及日期快照；o1/o1-pro/o3-mini/o4-mini 预定 2026-10-23 退役。已退役的旧 Codex 不列为当前型号。专用研究、受限授权、音频及图片生成端点未混入通用对话目录。",
    modelIds: ["gpt-6.1-sol", "gpt-6-astra", "gpt-6-sol", "gpt-6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna", "gpt-5.6",
      "gpt-5.5", "gpt-5.5-pro", "gpt-5.4", "gpt-5.4-pro", "gpt-5.4-mini", "gpt-5.4-nano", "gpt-5.2", "gpt-5.2-pro", "gpt-5.1", "gpt-5", "gpt-5-mini", "gpt-5-nano", "gpt-5-pro",
      "gpt-5.3-codex", "o1", "o1-pro", "o3", "o3-pro", "o3-mini", "o4-mini", "gpt-5-2025-08-07", "gpt-5-mini-2025-08-07", "gpt-5-nano-2025-08-07", "gpt-5-pro-2025-10-06", "o3-2025-04-16", "o3-pro-2025-06-10", "o1-2024-12-17", "o1-pro-2025-03-19", "o3-mini-2025-01-31", "o4-mini-2025-04-16"],
  },
  anthropic: {
    sourceUrls: ["https://platform.claude.com/docs/en/models/overview", "https://platform.claude.com/docs/en/about-claude/model-deprecations"],
    note: "包含 Fable、Mythos、Opus、Sonnet、Haiku。Mythos Preview 已弃用；Sonnet 4.5 预定 2026-11-30 退役。已退役的 3.x、Opus 4/4.1、Sonnet 4 不列为当前型号。",
    modelIds: ["claude-fable-5-1", "claude-fable-5", "claude-mythos-5-1", "claude-mythos-5", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5", "claude-sonnet-5", "claude-haiku-5-5",
      "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-4-6", "claude-mythos-preview", "claude-opus-4-5", "claude-opus-4-5-20251101", "claude-sonnet-4-5", "claude-sonnet-4-5-20250929", "claude-haiku-4-5", "claude-haiku-4-5-20251001"],
  },
  google: {
    sourceUrls: ["https://ai.google.dev/gemini-api/docs/models"],
    note: "2.5 系列目前限既有用户访问；3 Pro 为兼容配置。Live、TTS、转写及不适用当前对话适配器的生成端点另属专用接口。",
    modelIds: ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-pro-preview", "gemini-3.1-flash-lite", "gemini-3-flash-preview", "gemini-3-pro-preview", "gemini-3.1-flash-lite-image", "gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.5-flash-lite"],
  },
  deepseek: {
    sourceUrls: ["https://api-docs.deepseek.com/quick_start/pricing/"],
    note: "deepseek-flash 当前为 V4.1 Flash，deepseek-v4-pro 为 V4 Pro 0813。两个旧 Flash 名称仍接受请求，但已转到当前 Flash，不代表独立在售模型。",
    modelIds: ["deepseek-flash", "deepseek-v4-pro", "deepseek-v4-flash", "deepseek-v4-flash-vision-exp"],
  },
  moonshot: {
    sourceUrls: ["https://platform.kimi.ai/docs/models"],
    note: "当前 K3、K2.7 Code、K2.6；已退役的 K2.5、早期 K2、moonshot-v1 不列为当前型号。",
    modelIds: ["kimi-k3", "kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2.6"],
  },
  zhipu: {
    sourceUrls: ["https://docs.z.ai/guides/overview/overview"],
    note: "按 Z.ai 当前公开对话目录核对；旧型号沿用服务默认，不套用 5.2/5.3 的档位。",
    modelIds: ["glm-5.3", "glm-5.3-flash", "glm-5.3-flashx", "glm-5.2", "glm-5.1", "glm-5", "glm-4.7", "glm-4.6"],
  },
  xai: {
    sourceUrls: ["https://docs.x.ai/developers/models", "https://docs.x.ai/developers/model-capabilities/text/reasoning"],
    note: "当前推荐 Grok 4.7；保留 4.6、4.5、4.3 的兼容配置，不把多 Agent 并发数量作为推理档位。",
    modelIds: ["grok-4.7", "grok-4.6", "grok-4.5", "grok-4.3"],
  },
  qwen: {
    sourceUrls: ["https://www.alibabacloud.com/help/en/model-studio/text-generation-model", "https://www.alibabacloud.com/en/notice/model_studio_notice_on_the_postponed_retirement_of_selected_legacy_models_7d0", "https://www.alibabacloud.com/help/en/model-studio/model-pricing", "https://www.alibabacloud.com/help/en/model-studio/models"],
    note: "包含商业、开源、VL、Omni、Next、Coder 与快照 ID；Omni 仅指普通 Chat 文本交互，实时音频端点不在此列。部分旧型号延期退役，可用范围随地域与账户变化。扩展开关与预算不当作标准 effort。",
    modelIds: ["qwen3.8-max", "qwen3.8-max-0902", "qwen3.8-flash", "qwen3.7-plus", "qwen3.7-flash", "qwen3.7-max", "qwen3.7-max-preview", "qwen3.7-max-2026-06-08", "qwen3.7-max-2026-05-20", "qwen3.7-max-2026-05-17", "qwen3.6-plus", "qwen3.6-flash", "qwen3.6-flash-2026-04-16", "qwen3.5-plus", "qwen3.5-flash",
      "qwen3.5-397b-a17b", "qwen3.5-122b-a10b", "qwen3.5-27b", "qwen3.5-35b-a3b", "qwen3-max-2026-01-23", "qwen3-max-2025-09-23", "qwen3-235b-a22b", "qwen3-235b-a22b-thinking-2507", "qwen3-235b-a22b-instruct-2507", "qwen3-32b", "qwen3-30b-a3b", "qwen3-30b-a3b-thinking-2507", "qwen3-30b-a3b-instruct-2507", "qwen3-14b", "qwen3-8b", "qwen3-4b", "qwen3-1.7b", "qwen3-0.6b",
      "qwen3-vl-flash-2026-01-22", "qwen3-vl-flash-2025-10-15", "qwen3-vl-235b-a22b-instruct", "qwen3-vl-235b-a22b-thinking", "qwen3-vl-32b-thinking", "qwen3-vl-32b-instruct", "qwen3-vl-30b-a3b-thinking", "qwen3-vl-30b-a3b-instruct", "qwen3-vl-8b-thinking", "qwen3-vl-8b-instruct", "qwen3-next-80b-a3b-instruct", "qwen3-next-80b-a3b-thinking",
      "qwen3-coder-plus", "qwen3-coder-plus-2025-09-23", "qwen3-coder-plus-2025-07-22", "qwen3-coder-flash", "qwen3-coder-flash-2025-07-28", "qwen3-coder-next", "qwen3-coder-30b-a3b-instruct", "qwen3-coder-480b-a35b-instruct", "qwen3.8-omni-flash", "qwen3.5-omni-plus", "qwen-plus", "qwen-turbo"],
  },
  minimax: {
    sourceUrls: ["https://platform.minimax.io/docs/guides/models-intro"],
    note: "M3.1 Flash Preview 暂限 M Plan / MiniMax Code；M2.5/M2.7 家族预定 2026-11-18 退役。",
    modelIds: ["MiniMax-M3.1-Flash-Preview", "MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"],
  },
};
