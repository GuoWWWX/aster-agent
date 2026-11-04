/** Settings accept Token counts, or decimal K/M using decimal (1000) units. */
export function parseModelContextWindow(value: string): number | null {
  const trimmed = value.trim();
  if (trimmed === "") return 0;
  const match = /^(\d+(?:\.\d*)?|\.\d+)\s*([km])?$/iu.exec(trimmed);
  if (match === null) return null;
  const multiplier = match[2]?.toLocaleLowerCase() === "m" ? 1_000_000
    : match[2]?.toLocaleLowerCase() === "k" ? 1_000 : 1;
  const tokens = Math.round(Number(match[1]) * multiplier);
  return Number.isFinite(tokens) && tokens <= 10_000_000 ? tokens : null;
}

export function formatModelContextWindow(tokens: number): string {
  if (tokens > 0 && tokens % 1_000_000 === 0) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000) return `${tokens / 1_000}K`;
  return String(tokens);
}
