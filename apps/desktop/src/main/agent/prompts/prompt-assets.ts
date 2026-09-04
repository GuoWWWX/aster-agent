import baseSystemPromptSource from "./base-system.md";
import browserUseSkillSource from "./browser-use-skill.md";
import contextCompactionPromptSource from "./context-compaction.md";

function normalizePrompt(source: string): string {
  return source.trim().replace(/\r\n/gu, "\n");
}

export const BASE_SYSTEM_PROMPT = normalizePrompt(baseSystemPromptSource);
export const BROWSER_USE_SKILL = normalizePrompt(browserUseSkillSource);
export const CONTEXT_COMPACTION_PROMPT = normalizePrompt(contextCompactionPromptSource);
