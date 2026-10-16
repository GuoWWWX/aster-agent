import { RE2JS } from "re2js";

export type ModelReasoningMatchMode = "exact" | "glob" | "regex";

export function isValidModelReasoningRegex(pattern: string): boolean {
  try { RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE); return true; }
  catch { return false; }
}

/** Same non-backtracking regex semantics in Main and Renderer. */
export function modelReasoningPatternMatches(pattern: string, modelId: string, mode: ModelReasoningMatchMode = "glob"): boolean {
  const full = modelId.trim();
  const short = full.split("/").at(-1) ?? full;
  if (mode === "exact") return [full, short].some(value => value.toLocaleLowerCase() === pattern.trim().toLocaleLowerCase());
  if (mode === "regex") {
    try { const regex = RE2JS.compile(pattern, RE2JS.CASE_INSENSITIVE); return regex.test(full) || regex.test(short); }
    catch { return false; }
  }
  const escaped = pattern.trim().replace(/[.+?^${}()|[\]\\]/g, "\\$&").replaceAll("*", ".*");
  const regex = new RegExp(`^${escaped}$`, "iu");
  return regex.test(full) || regex.test(short);
}
