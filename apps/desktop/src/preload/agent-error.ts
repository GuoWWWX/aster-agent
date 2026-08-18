import {
  AgentClientError,
  parseSerializedAgentError,
} from "../../../../packages/protocol/src/agent-error.js";

export function toAgentClientError(reason: unknown): AgentClientError {
  const parsed = parseSerializedAgentError(reason);
  if (parsed !== null) return new AgentClientError(parsed);

  return new AgentClientError({
    code: "IPC_FAILED",
    id: crypto.randomUUID(),
    message: "桌面服务通信失败，请重试。",
    retryable: true,
  });
}
