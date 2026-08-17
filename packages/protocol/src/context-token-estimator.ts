const CJK_CHARACTER_PATTERN = /[\u3400-\u9fff\uf900-\ufaff]/g;

/**
 * Shared, deliberately conservative estimate for models with unknown tokenizers.
 * CJK text generally consumes more tokens per character than Latin prose/code.
 */
export const CONTEXT_MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateContextTokens(content: string): number {
  if (content.length === 0) {
    return 0;
  }

  const cjkCharacters = (content.match(CJK_CHARACTER_PATTERN) ?? []).length;
  const otherCharacters = content.length - cjkCharacters;

  return Math.ceil(cjkCharacters * 1.1 + otherCharacters * 0.28);
}
