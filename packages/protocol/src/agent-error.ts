import { z } from "zod";

export const agentErrorCodeSchema = z.enum([
  "VALIDATION_FAILED",
  "CAPABILITY_UNAVAILABLE",
  "WORKSPACE_REQUIRED",
  "PATH_OUTSIDE_WORKSPACE",
  "FILE_CHANGED",
  "APPROVAL_REJECTED",
  "PROCESS_TIMEOUT",
  "PROCESS_CANCELLED",
  "PROCESS_FAILED",
  "MODEL_CONFIGURATION_INVALID",
  "MODEL_AUTH_FAILED",
  "MODEL_RATE_LIMITED",
  "MODEL_TIMEOUT",
  "MODEL_PROVIDER_UNAVAILABLE",
  "MODEL_RESPONSE_INVALID",
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

export function formatAgentError(error: AgentError): string {
  return `${error.message}（错误编号：${error.id}）`;
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
