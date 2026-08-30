import { formatAgentError } from "@agent/protocol";

import {
  reportMainError,
  sanitizeSensitiveText,
  toMainAgentError,
} from "./agent-error.js";

type ToolValidationIssue = {
  code: string;
  message: string;
  path: Array<string | number>;
};

type ToolRecovery = {
  action: "fix_arguments" | "recreate_terminal" | "reread_and_rebuild_change";
  instruction: string;
  issues?: ToolValidationIssue[];
  retryable: boolean;
};

type ToolErrorOptions = {
  code?: string;
  recovery?: ToolRecovery;
  value?: unknown;
};

const MAX_ISSUE_CODE_LENGTH = 80;
const MAX_ISSUE_PATH_PARTS = 16;
const MAX_ISSUE_PATH_TEXT_LENGTH = 120;

function boundedIssueText(value: string, limit: number): string {
  const printable = [...sanitizeSensitiveText(value)]
    .filter((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code >= 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
    })
    .join("");
  return printable.slice(0, limit);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function validationIssues(reason: unknown): ToolValidationIssue[] {
  const record = isRecord(reason) ? reason : null;
  const issues = record?.issues;
  if (!Array.isArray(issues)) return [];

  return issues.flatMap((value) => {
    const issue = isRecord(value) ? value : null;
    if (issue === null || typeof issue.message !== "string") return [];
    const path = Array.isArray(issue.path)
      ? issue.path.filter((part): part is string | number =>
          typeof part === "string" || typeof part === "number"
        )
        .slice(0, MAX_ISSUE_PATH_PARTS)
        .map((part) => typeof part === "string"
          ? boundedIssueText(part, MAX_ISSUE_PATH_TEXT_LENGTH)
          : part)
      : [];
    const code = typeof issue.code === "string"
      ? boundedIssueText(issue.code, MAX_ISSUE_CODE_LENGTH)
      : "custom";
    return [{
      code,
      message: boundedIssueText(issue.message, 300),
      path,
    }];
  }).slice(0, 8);
}

export function toolErrorContent(
  reason: unknown,
  operation: string,
  options: ToolErrorOptions = {},
): string {
  const agentError = toMainAgentError(reason, { operation });
  if (agentError.code === "INTERNAL_ERROR" || agentError.code === "STORAGE_FAILED") {
    reportMainError(agentError, reason);
  }
  const issues = validationIssues(reason);
  const recovery = options.recovery
    ?? (agentError.code === "VALIDATION_FAILED"
      ? {
          action: "fix_arguments" as const,
          instruction: "根据 issues 修正本次工具参数后重试；不要重复提交相同参数。",
          issues,
          retryable: true,
        }
      : agentError.code === "FILE_CHANGED"
        ? {
            action: "reread_and_rebuild_change" as const,
            instruction: "本次文件变更已作废，不能排队或重试相同参数。先调用 read_file 读取最新文件内容，再基于最新内容重新生成变更。",
            retryable: true,
          }
        : undefined);
  return JSON.stringify({
    agentError,
    ...(options.code === undefined ? {} : { code: options.code }),
    error: formatAgentError(agentError),
    ok: false,
    ...(options.value === undefined ? {} : { value: options.value }),
    ...(recovery === undefined ? {} : { recovery }),
  });
}
