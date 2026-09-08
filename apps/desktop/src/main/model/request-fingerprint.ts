import { createHash } from "node:crypto";

/** Local diagnostics only; never replay these fields to the provider. */
export type RequestFingerprint = {
  version: 1;
  bodyHash: string;
  bodyBytes: number;
  systemHash: string;
  toolsHash: string;
  settingsHash: string;
  messageCount: number;
  messageHashes: string[];
};

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value) ?? "null").digest("hex");
}

export function requestFingerprint(body: unknown): RequestFingerprint | undefined {
  // Do not clone streams or parse large image requests just for diagnostics.
  if (typeof body !== "string" || body.length > 4 * 1024 * 1024) return undefined;
  const bodyBytes = Buffer.byteLength(body);
  if (bodyBytes > 4 * 1024 * 1024) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return undefined;
  const fields: Record<string, unknown> = { ...parsed };
  const messages = fields.messages ?? fields.input;
  if (!Array.isArray(messages)) return undefined;
  const settings = Object.fromEntries([
    "model", "reasoning", "reasoning_effort", "thinking", "temperature", "top_p",
    "max_tokens", "max_completion_tokens", "max_output_tokens", "tool_choice", "parallel_tool_calls",
  ].map((key) => [key, fields[key] ?? null]));
  return {
    version: 1,
    bodyHash: createHash("sha256").update(body).digest("hex"),
    bodyBytes,
    systemHash: hash(fields.system ?? fields.instructions ?? null),
    toolsHash: hash(fields.tools ?? []),
    settingsHash: hash(settings),
    messageCount: messages.length,
    messageHashes: messages.slice(0, 32).map(hash),
  };
}
