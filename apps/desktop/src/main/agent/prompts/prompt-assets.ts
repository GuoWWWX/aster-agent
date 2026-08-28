import baseSystemPromptSource from "./base-system.md";
import contextCompactionPromptSource from "./context-compaction.md";

function normalizePrompt(source: string): string {
  return source.trim().replace(/\r\n/gu, "\n");
}

export const BASE_SYSTEM_PROMPT = normalizePrompt(baseSystemPromptSource);
export const CONTEXT_COMPACTION_PROMPT = normalizePrompt(contextCompactionPromptSource);
