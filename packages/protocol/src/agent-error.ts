import { z } from "zod";

export const agentErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "CAPABILITY_UNAVAILABLE",
  "WORKSPACE_REQUIRED",
  "PATH_OUTSIDE_WORKSPACE",
  "FILE_CHANGED",
  "APPROVAL_REJECTED",
  "APPROVAL_EXPIRED",
  "PROCESS_TIMEOUT",
  "PROCESS_CANCELLED",
  "PROCESS_FAILED",
  "MODEL_CONFIGURATION_INVALID",
  "MODEL_AUTH_FAILED",
  "MODEL_RATE_LIMITED",
  "MODEL_TIMEOUT",
  "MODEL_PROVIDER_UNAVAILABLE",
  "MODEL_RESPONSE_INVALID",
  "MODEL_RUN_LIMIT_REACHED",
  "NETWORK_UNAVAILABLE",
  "STORAGE_FAILED",
  "ARTIFACT_NOT_FOUND",
  "PERMISSION_DENIED",
  "CONFLICT",
  "IPC_FAILED",
  "INTERNAL_ERROR",
]);

export const agentErrorSchema = z
  .object({
    code: agentErrorCodeSchema,
    details: z.record(z.string(), z.unknown()).optional(),
    id: z.uuid(),
    message: z.string().min(1).max(1_000),
    retryable: z.boolean(),
  })
  .strict();

export type AgentErrorCode = z.infer<typeof agentErrorCodeSchema>;
export type AgentError = z.infer<typeof agentErrorSchema>;

const SERIALIZED_AGENT_ERROR_PREFIX = "AGENT_ERROR:";

export class AgentClientError extends Error {
  public readonly code: AgentErrorCode;
  public readonly details: Record<string, unknown> | undefined;
  public readonly errorId: string;
  public readonly retryable: boolean;

  public constructor(public readonly agentError: AgentError) {
    super(formatAgentError(agentError));
    this.name = "AgentClientError";
    this.code = agentError.code;
    this.details = agentError.details;
    this.errorId = agentError.id;
    this.retryable = agentError.retryable;
  }
}

const ERROR_INSTANCE_ID_PATTERN = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;
const ERROR_REQUEST_ID_PATTERN = /\b(?:request|trace|correlation|instance)[\s_-]*id\s*[:=]?\s*[A-Za-z0-9._-]+/giu;

export function redactErrorIdentifiers(value: string): string {
  return value
    .replace(ERROR_REQUEST_ID_PATTERN, "")
    .replace(ERROR_INSTANCE_ID_PATTERN, "")
    .replace(/[ \t]*[,，;；:：][ \t]*(?=$|[。.!！?？])/gu, "")
    .replace(/[ \t]{2,}/gu, " ")
    .replace(/[ \t]+([,.;：])/gu, "$1")
    .replace(/[ \t]+([。.!！?？])/gu, "$1")
    .trim();
}

export function formatAgentError(error: AgentError): string {
  const message = redactErrorIdentifiers(error.message);
  const status = error.details?.status;
  const providerMessage = typeof error.details?.providerMessage === "string"
    ? redactErrorIdentifiers(error.details.providerMessage)
    : error.details?.providerMessage;
  const technicalMessage = typeof error.details?.technicalMessage === "string"
    ? redactErrorIdentifiers(error.details.technicalMessage)
    : error.details?.technicalMessage;
  const providerDetail =
    typeof status === "number" && Number.isInteger(status)
      ? `HTTP ${status}${typeof providerMessage === "string" && providerMessage.length > 0
        ? `：${providerMessage}`
        : ""}`
      : typeof providerMessage === "string" && providerMessage.length > 0
        ? providerMessage
        : null;
  const technicalDetail = typeof technicalMessage === "string" && technicalMessage.length > 0
    ? technicalMessage
    : null;
  const detail = providerDetail === null
    ? technicalDetail === null
      ? null
      : error.code === "NETWORK_UNAVAILABLE"
        ? `网络错误详情：${technicalDetail}`
        : `内部错误详情：${technicalDetail}`
    : `接口错误：${providerDetail}`;
  return detail === null ? message : `${message} ${detail}`;
}

export function serializeAgentError(error: AgentError): string {
  const parsed = agentErrorSchema.parse(error);
  return `${SERIALIZED_AGENT_ERROR_PREFIX}${encodeURIComponent(JSON.stringify(parsed))}`;
}

export function parseSerializedAgentError(reason: unknown): AgentError | null {
  const message = reason instanceof Error
    ? reason.message
    : typeof reason === "string"
      ? reason
      : "";
  const prefixIndex = message.indexOf(SERIALIZED_AGENT_ERROR_PREFIX);
  if (prefixIndex < 0) return null;

  const encoded = message
    .slice(prefixIndex + SERIALIZED_AGENT_ERROR_PREFIX.length)
    .split(/\s/u, 1)[0];
  if (encoded === undefined || encoded.length === 0) return null;

  try {
    const decoded = JSON.parse(decodeURIComponent(encoded)) as unknown;
    const parsed = agentErrorSchema.safeParse(decoded);
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
