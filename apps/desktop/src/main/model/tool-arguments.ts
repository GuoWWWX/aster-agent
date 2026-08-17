function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseToolArguments(value: string): Record<string, unknown> {
  const normalized = value.trim();
  if (normalized.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new Error("Tool arguments are not valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new Error("Tool arguments must be a JSON object.");
  }
  return parsed;
}
