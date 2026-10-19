import { getUserErrorMessage } from "../../runtime/index.js";
import { type AutoSaveState } from "./use-queued-auto-save.js";

export function autoSaveStateLabel(state: AutoSaveState): string | null {
  switch (state) {
    case "failed":
      return "自动保存失败";
    case "invalid":
      return "等待配置完成后自动保存";
    case "pending":
      return "即将自动保存";
    case "saving":
      return "正在自动保存";
    case "saved":
      return "已自动保存";
    case "idle":
      return null;
  }
}

export function nextConfigurationId(prefix: string, ids: readonly string[]): string {
  const used = new Set(ids);
  let suffix = 1;
  while (used.has(`${prefix}-${suffix}`)) suffix += 1;
  return `${prefix}-${suffix}`;
}

export function configurationParseError(reason: unknown): string {
  if (reason !== null && typeof reason === "object" && "issues" in reason) {
    const issues = (reason as { issues?: { message?: unknown }[] }).issues;
    const message = issues?.[0]?.message;
    if (typeof message === "string") return message;
  }
  return reason instanceof Error ? reason.message : "JSON 配置无效。";
}

export function errorMessage(reason: unknown): string {
  return getUserErrorMessage(reason, "配置操作失败。");
}
