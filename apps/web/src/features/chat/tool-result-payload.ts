import { redactErrorIdentifiers } from "@agent/protocol";

export function formatToolPayload(payload: string): string {
  try {
    return JSON.stringify(redactAgentErrorId(JSON.parse(payload) as unknown), null, 2);
  } catch {
    return payload;
  }
}

function redactAgentErrorId(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactAgentErrorId);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      key === "agentError"
        ? redactAgentErrorObject(nestedValue)
        : redactAgentErrorId(nestedValue),
    ]),
  );
}

function redactAgentErrorObject(value: unknown): unknown {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return value;

  return redactAgentErrorValue(value);
}

function redactAgentErrorValue(value: unknown): unknown {
  if (typeof value === "string") return redactErrorIdentifiers(value);
  if (Array.isArray(value)) return value.map(redactAgentErrorValue);
  if (value === null || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== "id")
      .map(([key, nestedValue]) => [key, redactAgentErrorValue(nestedValue)]),
  );
}

export function parseToolPayload(payload: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(payload) as unknown;
    return parsed !== null && typeof parsed === "object" ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

export function parseToolValue(payload: string): Record<string, unknown> | null {
  const parsed = parseToolPayload(payload);
  const value = parsed?.value;
  return value !== null && typeof value === "object" ? value as Record<string, unknown> : null;
}

export function parseToolError(payload: string): string | null {
  const error = parseToolPayload(payload)?.error;
  return typeof error === "string" && error.length > 0 ? error : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
