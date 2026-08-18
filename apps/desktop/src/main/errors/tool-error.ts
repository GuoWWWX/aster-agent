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

export function toolErrorContent(reason: unknown, operation: string): string {
  const agentError = toMainAgentError(reason, { operation });
  if (agentError.code === "INTERNAL_ERROR" || agentError.code === "STORAGE_FAILED") {
    reportMainError(agentError, reason);
  }
  const issues = validationIssues(reason);
  return JSON.stringify({
    agentError,
    error: formatAgentError(agentError),
    ok: false,
    ...(agentError.code === "VALIDATION_FAILED"
      ? {
          recovery: {
            action: "fix_arguments",
            instruction: "根据 issues 修正本次工具参数后重试；不要重复提交相同参数。",
            issues,
            retryable: true,
          },
        }
      : {}),
  });
}
