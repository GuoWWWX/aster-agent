import baseSystemPromptSource from "./base-system.md";
import browserUseSkillSource from "./browser-use-skill.md";
import contextCompactionPromptSource from "./context-compaction.md";
import imageViewSkillSource from "./skills/image-view/SKILL.md";
import codeReviewSkillSource from "./skills/code-review/SKILL.md";
import debuggingSkillSource from "./skills/debugging/SKILL.md";

function normalizePrompt(source: string): string {
  return source.trim().replace(/\r\n/gu, "\n");
}

export const BASE_SYSTEM_PROMPT = normalizePrompt(baseSystemPromptSource);
export const BROWSER_USE_SKILL = normalizePrompt(browserUseSkillSource);
export const SYSTEM_SKILLS = [BROWSER_USE_SKILL, imageViewSkillSource, codeReviewSkillSource, debuggingSkillSource].map(normalizePrompt);
export const CONTEXT_COMPACTION_PROMPT = normalizePrompt(contextCompactionPromptSource);
