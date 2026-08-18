import { z, type ZodType } from "zod";

export type ToolArgumentIssue = {
  code: string;
  message: string;
  path: Array<string | number>;
};

/** Stable boundary error for provider-produced tool arguments. */
export class ToolArgumentsError extends Error {
  public readonly code = "TOOL_ARGUMENTS_INVALID";

  public constructor(
    message: string,
    public readonly issues: readonly ToolArgumentIssue[],
  ) {
    super(message);
    this.name = "ToolArgumentsError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function modelToolParameters(schema: ZodType): Record<string, unknown> {
  const parameters: Record<string, unknown> = {
    ...z.toJSONSchema(schema, { io: "input" }),
  };
  delete parameters.$schema;
  if (parameters.type !== "object") {
    throw new Error("Tool parameters must use an object schema.");
  }
  return parameters;
}

export function parseToolArguments(value: string): Record<string, unknown> {
  const normalized = value.trim();
  if (normalized.length === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(normalized);
  } catch {
    throw new ToolArgumentsError("Tool arguments are not valid JSON.", [
      {
        code: "invalid_json",
        message: "Tool arguments must be valid JSON.",
        path: [],
      },
    ]);
  }
  if (!isRecord(parsed)) {
    throw new ToolArgumentsError("Tool arguments must be a JSON object.", [
      {
        code: "invalid_type",
        message: "Tool arguments must be a JSON object.",
        path: [],
      },
    ]);
  }
  return parsed;
}
