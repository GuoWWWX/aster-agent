import { z } from "zod";
import { agentPermissionToolSchema, type AgentPermissionTool } from "@agent/protocol";
import type { ModelMessageAttachment } from "../model/model-contracts.js";
import { type ModelMessage, type ModelToolCall } from "../model/model-contracts.js";
import { type SkillSnapshotRef } from "./skill-runtime.js";
import { parseToolArguments } from "../model/tool-arguments.js";

export class ToolCallLimitError extends Error {
  public readonly code = "TOOL_CALL_LIMIT_EXCEEDED";

  public constructor(
    count: number,
    limit: number,
  ) {
    super(
      `模型本轮一次返回了 ${count} 个工具调用，超过单轮可处理数量 ${limit}。请分批调用工具后重试。`,
    );
    this.name = "ToolCallLimitError";
  }
}

export class ModelToolCallValidationError extends Error {
  public readonly code = "MODEL_TOOL_CALLS_INVALID";

  public constructor(message: string) {
    super(message);
    this.name = "ModelToolCallValidationError";
  }
}

export class ToolApprovalExpiredError extends Error {
  public readonly code = "APPROVAL_EXPIRED";

  public constructor() {
    super("This tool approval is no longer pending.");
    this.name = "ToolApprovalExpiredError";
  }
}

export function chunkToolCalls(
  toolCalls: readonly ModelToolCall[],
  chunkSize: number,
): ModelToolCall[][] {
  const chunks: ModelToolCall[][] = [];
  for (let start = 0; start < toolCalls.length; start += chunkSize) {
    chunks.push([...toolCalls.slice(start, start + chunkSize)]);
  }
  return chunks;
}

export type ToolApprovalInterrupt = {
  conversationId: string;
  kind: "tool_approval";
  pattern: string;
  permissionTool: AgentPermissionTool;
  runId: string;
  toolId: string;
};

export type ToolApprovalResume = {
  approved: boolean;
};

export type LangChainToolResultEnvelope = {
  activeSkills: SkillSnapshotRef[];
  content: string;
  isError: boolean;
  marker: "agent-tool-result-v1";
  modelAttachments?: ModelMessageAttachment[] | undefined;
  status?: "rejected" | undefined;
  successful: boolean;
};

export type CachedGraphToolResult = {
  envelope: LangChainToolResultEnvelope;
  message: ModelMessage;
};

export function isToolApprovalInterrupt(value: unknown): value is ToolApprovalInterrupt {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.kind === "tool_approval"
    && typeof record.conversationId === "string"
    && typeof record.pattern === "string"
    && agentPermissionToolSchema.safeParse(record.permissionTool).success
    && typeof record.runId === "string"
    && typeof record.toolId === "string";
}

export function hasToolNodeMessages(value: unknown): value is { messages: unknown[] } {
  return typeof value === "object"
    && value !== null
    && "messages" in value
    && Array.isArray(value.messages);
}

export function toolCallIdFromConfig(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("toolCall" in value)) return undefined;
  const toolCall = value.toolCall;
  if (typeof toolCall !== "object" || toolCall === null || !("id" in toolCall)) return undefined;
  return typeof toolCall.id === "string" ? toolCall.id : undefined;
}

export function parseToolArgumentsOrEmpty(rawArguments: string): Record<string, unknown> {
  try {
    return parseToolArguments(rawArguments);
  } catch {
    // The project handler owns the structured malformed-JSON error. ToolNode
    // still needs an object-shaped value to invoke that handler.
    return {};
  }
}

const langChainToolResultEnvelopeSchema = z
  .object({
    activeSkills: z.array(z.object({
      contentHash: z.string().min(1),
      id: z.string().min(1),
      version: z.string().min(1),
    }).strict()),
    content: z.string(),
    isError: z.boolean(),
    marker: z.literal("agent-tool-result-v1"),
    modelAttachments: z.array(z.object({
      readPath: z.string().optional(),
      contextTokens: z.number().int().nonnegative(),
      data: z.string().nullable(),
      id: z.string().min(1),
      kind: z.literal("image"),
      mimeType: z.string().min(1),
      name: z.string().min(1),
      projectPath: z.string().nullable(),
      readState: z.enum(["full", "metadata_only", "preview"]),
      source: z.enum(["browser", "project", "upload", "computer", "generated"]),
      truncated: z.boolean(),
    }).strict()).max(4).optional(),
    status: z.literal("rejected").optional(),
    successful: z.boolean(),
  })
  .strict();

export function parseLangChainToolResult(content: unknown): LangChainToolResultEnvelope {
  const serialized = typeof content === "string" ? content : JSON.stringify(content);
  return langChainToolResultEnvelopeSchema.parse(JSON.parse(serialized));
}
