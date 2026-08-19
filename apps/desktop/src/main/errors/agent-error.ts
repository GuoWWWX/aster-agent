import { randomUUID } from "node:crypto";

import {
  agentErrorSchema,
  type AgentError,
  type AgentErrorCode,
} from "@agent/protocol";

type MainErrorContext = {
  operation: string;
  redactValues?: readonly string[];
};

type ErrorClassification = {
  code: AgentErrorCode;
  message: string;
  retryable: boolean;
};

const DEFAULT_ERRORS: Record<AgentErrorCode, Omit<ErrorClassification, "code">> = {
  APPROVAL_REJECTED: { message: "操作未获批准。", retryable: false },
  ARTIFACT_NOT_FOUND: { message: "请求的文件或记录不存在。", retryable: false },
  CAPABILITY_UNAVAILABLE: { message: "当前环境不支持这项能力。", retryable: false },
  CONFLICT: { message: "当前状态不允许执行这项操作，请刷新后重试。", retryable: false },
  FILE_CHANGED: { message: "文件已发生变化，请重新读取后再修改。", retryable: true },
  INTERNAL_ERROR: { message: "软件内部发生错误，请重试。", retryable: false },
  IPC_FAILED: { message: "桌面服务通信失败，请重试。", retryable: true },
  MODEL_AUTH_FAILED: { message: "模型认证失败，请检查 API Key 和服务地址。", retryable: false },
  MODEL_CONFIGURATION_INVALID: { message: "模型配置无效，请在设置中检查供应商和模型。", retryable: false },
  MODEL_PROVIDER_UNAVAILABLE: { message: "模型服务暂时不可用，自动重试仍未成功，请稍后再试。", retryable: true },
  MODEL_RATE_LIMITED: { message: "模型额度不足或请求过于频繁，请检查余额后重试。", retryable: true },
  MODEL_RESPONSE_INVALID: { message: "模型返回了无法处理的响应，请重试或切换模型。", retryable: true },
  MODEL_TIMEOUT: { message: "模型请求超时，请检查网络后重试。", retryable: true },
  NETWORK_UNAVAILABLE: { message: "网络连接失败，请检查网络和模型服务地址。", retryable: true },
  PATH_OUTSIDE_WORKSPACE: { message: "目标路径超出了当前项目目录。", retryable: false },
  PERMISSION_DENIED: { message: "没有权限执行这项操作。", retryable: false },
  PROCESS_CANCELLED: { message: "操作已取消。", retryable: false },
  PROCESS_FAILED: { message: "命令执行失败，请查看命令输出。", retryable: false },
  PROCESS_TIMEOUT: { message: "命令执行超时。", retryable: true },
  STORAGE_FAILED: { message: "本地数据保存失败，请重试。", retryable: true },
  VALIDATION_FAILED: { message: "提交的数据无效，请检查后重试。", retryable: false },
  WORKSPACE_REQUIRED: { message: "这项操作需要先为对话绑定项目目录。", retryable: false },
};

function errorMessage(reason: unknown): string {
  if (reason instanceof Error) return reason.message;
  return typeof reason === "string" ? reason : "";
}

function errorStatus(reason: unknown): number | null {
  if (reason === null || typeof reason !== "object") return null;
  const status = (reason as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

function errorCode(reason: unknown): string | null {
  if (reason === null || typeof reason !== "object") return null;
  const code = (reason as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

function validationFailureMessage(reason: unknown): string | null {
  if (
    reason === null
    || typeof reason !== "object"
    || !Array.isArray((reason as { issues?: unknown }).issues)
  ) {
    return null;
  }
  const issue = (reason as { issues: unknown[] }).issues[0];
  if (issue === null || typeof issue !== "object") return null;
  const record = issue as { message?: unknown; path?: unknown };
  if (typeof record.message !== "string" || record.message.length === 0) return null;
  const path = Array.isArray(record.path)
    ? record.path.filter((part): part is string | number =>
        typeof part === "string" || typeof part === "number"
      ).join(".")
    : "";
  const message = path.length === 0
    ? `提交的数据无效：${record.message}`
    : `提交的数据无效：字段 ${path} ${record.message}`;
  return sanitizeSensitiveText(message).slice(0, 1_000);
}

export function sanitizeSensitiveText(
  value: string,
  redactValues: readonly string[] = [],
): string {
  let sanitized = value;
  for (const secret of redactValues) {
    if (secret.length > 0) sanitized = sanitized.replaceAll(secret, "[redacted]");
  }
  return sanitized
    .replace(/\bBearer\s+\S+/giu, "Bearer [redacted]")
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/gu, "[redacted]")
    .slice(0, 4_000);
}

function classificationForCode(code: AgentErrorCode): ErrorClassification {
  return { code, ...DEFAULT_ERRORS[code] };
}

function providerErrorDetail(
  message: string,
  status: number | null,
  code: AgentErrorCode,
): string | null {
  if (status === null || !code.startsWith("MODEL_")) return null;
  const detail = message.replace(/^Model request failed \(\d+\):\s*/iu, "").trim();
  return detail.length === 0 ? null : detail.slice(0, 600);
}

function technicalErrorDetail(
  reason: unknown,
  message: string,
  code: AgentErrorCode,
): string | null {
  if (code !== "NETWORK_UNAVAILABLE" && code !== "INTERNAL_ERROR") return null;
  const errorName = reason instanceof Error && reason.name !== "Error" ? reason.name : null;
  const cause = reason instanceof Error ? reason.cause : null;
  const causeCode = errorCode(cause);
  const causeMessage = errorMessage(cause).trim();
  const primaryMessage = errorName === null ? message : `${errorName}: ${message}`;
  const values = [primaryMessage, causeCode, causeMessage].filter(
    (value): value is string => value !== null && value.length > 0,
  );
  const detail = [...new Set(values)].join(" | ");
  return detail.length === 0 ? null : detail.slice(0, 600);
}

function classifyError(reason: unknown, message: string): ErrorClassification {
  const status = errorStatus(reason);
  const name = reason instanceof Error ? reason.name : "";
  const nodeCode = errorCode(reason);

  if (name === "AbortError" || /\b(?:abort|cancel(?:led|ed)?)\b/iu.test(message)) {
    return classificationForCode("PROCESS_CANCELLED");
  }
  if (nodeCode === "TOOL_ARGUMENTS_INVALID") {
    return classificationForCode("VALIDATION_FAILED");
  }
  if (nodeCode === "FILE_CHANGED") return classificationForCode("FILE_CHANGED");
  if (nodeCode === "PROJECT_OPERATION_CONFLICT") return classificationForCode("CONFLICT");
  if (name === "ZodError" || (reason !== null && typeof reason === "object" && "issues" in reason)) {
    return classificationForCode("VALIDATION_FAILED");
  }
  if (name === "ModelRequestError" || status !== null) {
    if (status === 401 || status === 403) return classificationForCode("MODEL_AUTH_FAILED");
    if (status === 402 || status === 429) return classificationForCode("MODEL_RATE_LIMITED");
    if (status === 408 || status === 504) return classificationForCode("MODEL_TIMEOUT");
    if (status !== null && status >= 500) return classificationForCode("MODEL_PROVIDER_UNAVAILABLE");
    return classificationForCode("MODEL_RESPONSE_INVALID");
  }
  if (reason instanceof TypeError && /fetch|network|socket|connect|econn/iu.test(message)) {
    return classificationForCode("NETWORK_UNAVAILABLE");
  }
  if (/model provider.+unavailable/iu.test(message)) {
    return classificationForCode("MODEL_PROVIDER_UNAVAILABLE");
  }
  if (/decrypting the ciphertext|safeStorage.+decrypt/iu.test(message)) {
    return classificationForCode("MODEL_CONFIGURATION_INVALID");
  }
  if (/模型.+(?:未返回|无法处理)|model.+(?:incomplete|invalid response)/iu.test(message)) {
    return classificationForCode("MODEL_RESPONSE_INVALID");
  }
  if (nodeCode === "ENOENT") return classificationForCode("ARTIFACT_NOT_FOUND");
  if (nodeCode === "EACCES" || nodeCode === "EPERM") {
    return classificationForCode("PERMISSION_DENIED");
  }
  if (nodeCode?.startsWith("SQLITE") === true || /\b(?:database|sqlite)\b/iu.test(message)) {
    return classificationForCode("STORAGE_FAILED");
  }
  if (/outside (?:the )?(?:registered )?(?:project root|workspace)/iu.test(message)) {
    return classificationForCode("PATH_OUTSIDE_WORKSPACE");
  }
  if (/workspace|required for (?:file changes|command execution)|temporary conversations cannot access project tools/iu.test(message)) {
    return classificationForCode("WORKSPACE_REQUIRED");
  }
  if (/file (?:was |has )?(?:changed|created after)|no longer awaiting approval/iu.test(message)) {
    return classificationForCode("FILE_CHANGED");
  }
  if (/approval.+reject/iu.test(message)) return classificationForCode("APPROVAL_REJECTED");
  if (/timed? out|timeout/iu.test(message)) return classificationForCode("PROCESS_TIMEOUT");
  if (/model.+(?:not configured|disabled)|no model provider|provider.+no configured models/iu.test(message)) {
    return classificationForCode("MODEL_CONFIGURATION_INVALID");
  }
  if (/credential (?:encryption|decryption) is unavailable|capability.+unavailable/iu.test(message)) {
    return classificationForCode("CAPABILITY_UNAVAILABLE");
  }
  if (/module not found/iu.test(message)) {
    return classificationForCode("INTERNAL_ERROR");
  }
  if (/not found|does not exist|找不到|不存在/iu.test(message)) {
    return classificationForCode("ARTIFACT_NOT_FOUND");
  }
  if (/expected \d+ exact matches|patch does not apply|target file already exists/iu.test(message)) {
    return classificationForCode("VALIDATION_FAILED");
  }
  if (/apply_patch|unified diff|补丁/iu.test(message)) {
    return classificationForCode("VALIDATION_FAILED");
  }
  if (/already|cannot|must include|duplicate|no active|is closed/iu.test(message)) {
    return classificationForCode("CONFLICT");
  }
  if (/invalid|not valid JSON|cannot be empty|must be|exceed|at most|只能|不能超过|无效/iu.test(message)) {
    return classificationForCode("VALIDATION_FAILED");
  }
  if (/attachment.+readable text/iu.test(message)) {
    return classificationForCode("VALIDATION_FAILED");
  }

  return classificationForCode("INTERNAL_ERROR");
}

export function toMainAgentError(
  reason: unknown,
  context: MainErrorContext,
): AgentError {
  const existing = agentErrorSchema.safeParse(reason);
  if (existing.success) return existing.data;

  const sanitizedMessage = sanitizeSensitiveText(
    errorMessage(reason),
    context.redactValues,
  );
  const classification = classifyError(reason, sanitizedMessage);
  const status = errorStatus(reason);
  const providerMessage = providerErrorDetail(sanitizedMessage, status, classification.code);
  const technicalMessage = technicalErrorDetail(reason, sanitizedMessage, classification.code);
  const userMessage = classification.code === "VALIDATION_FAILED"
    ? validationFailureMessage(reason) ?? (
      /[\u3400-\u9fff]/u.test(sanitizedMessage)
        ? sanitizedMessage.slice(0, 1_000)
        : classification.message
    )
    : /[\u3400-\u9fff]/u.test(sanitizedMessage)
      ? sanitizedMessage.slice(0, 1_000)
      : classification.message;

  return agentErrorSchema.parse({
    code: classification.code,
    details: {
      operation: context.operation,
      ...(status === null ? {} : { status }),
      ...(providerMessage === null ? {} : { providerMessage }),
      ...(technicalMessage === null ? {} : { technicalMessage }),
    },
    id: randomUUID(),
    message: userMessage,
    retryable: classification.retryable,
  });
}

export function reportMainError(
  error: AgentError,
  reason: unknown,
  redactValues: readonly string[] = [],
): void {
  const stack = reason instanceof Error ? reason.stack : String(reason);
  const operation = typeof error.details?.operation === "string"
    ? error.details.operation
    : "unknown";
  console.error(
    `[${error.id}] ${error.code} (${operation})`,
    sanitizeSensitiveText(stack ?? error.message, redactValues),
  );
}
