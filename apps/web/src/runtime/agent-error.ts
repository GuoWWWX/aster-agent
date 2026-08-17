import {
  AgentClientError,
  formatAgentError,
  parseSerializedAgentError,
} from "@agent/protocol";

export function getUserErrorMessage(reason: unknown, fallback: string): string {
  if (reason instanceof AgentClientError) return reason.message;

  const serialized = parseSerializedAgentError(reason);
  if (serialized !== null) return formatAgentError(serialized);

  if (reason instanceof Error) {
    const message = reason.message.trim();
    if (message.length === 0 || /Error invoking remote method/iu.test(message)) {
      return fallback;
    }
    return message.slice(0, 1_000);
  }

  return fallback;
}
