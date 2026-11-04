import {
  conversationAgentMessageItemSchema,
  conversationMessageItemSchema,
  modelApiFormatSchema,
  conversationToolItemSchema,
  type ConversationAgentMessageItem,
  type ConversationMessageItem,
  type ConversationToolItem,
} from "@agent/protocol";
import type {
  ModelProviderState,
  ModelProviderTokenUsage,
  ModelToolCall,
} from "../model/model-contracts.js";

export function readProjectionString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

export function readProjectionIsoDate(payload: Record<string, unknown>, key: string): string | null {
  const value = readProjectionString(payload, key);
  return value !== null && !Number.isNaN(Date.parse(value)) ? value : null;
}

export function readProjectionTimelineMessage(
  payload: Record<string, unknown>,
  key: string,
): ConversationMessageItem | null {
  const parsed = conversationMessageItemSchema.safeParse(payload[key]);
  return parsed.success ? parsed.data : null;
}

export function readProjectionTool(
  payload: Record<string, unknown>,
  key: string,
): ConversationToolItem | null {
  const parsed = conversationToolItemSchema.safeParse(payload[key]);
  return parsed.success ? parsed.data : null;
}

export function readProjectionAgentMessage(
  payload: Record<string, unknown>,
  key: string,
): ConversationAgentMessageItem | null {
  const parsed = conversationAgentMessageItemSchema.safeParse(payload[key]);
  return parsed.success ? parsed.data : null;
}

export function readProjectionToolCalls(payload: Record<string, unknown>): ModelToolCall[] {
  const value = payload.toolCalls;
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isProjectionRecord(candidate)) return [];
    return typeof candidate.arguments === "string"
      && typeof candidate.id === "string"
      && typeof candidate.name === "string"
      ? [{ arguments: candidate.arguments, id: candidate.id, name: candidate.name }]
      : [];
  });
}

export function readProjectionProviderState(
  payload: Record<string, unknown>,
): ModelProviderState | undefined {
  const value = payload.providerState;
  if (
    !isProjectionRecord(value)
    || typeof value.baseUrl !== "string"
    || typeof value.modelId !== "string"
    || !("payload" in value)
  ) {
    return undefined;
  }
  const apiFormat = modelApiFormatSchema.safeParse(value.apiFormat);
  const usage = readProjectionProviderTokenUsage(value.usage);
  const firstTokenLatencyMs = readProjectionTokenCount(value.firstTokenLatencyMs);
  const generationDurationMs = readProjectionTokenCount(value.generationDurationMs);
  return apiFormat.success
    ? {
        apiFormat: apiFormat.data,
        baseUrl: value.baseUrl,
        modelId: value.modelId,
        payload: value.payload,
        ...(firstTokenLatencyMs === undefined ? {} : { firstTokenLatencyMs }),
        ...(generationDurationMs === undefined ? {} : { generationDurationMs }),
        ...(usage === undefined ? {} : { usage }),
      }
    : undefined;
}

function readProjectionProviderTokenUsage(
  value: unknown,
): ModelProviderTokenUsage | undefined {
  if (!isProjectionRecord(value)) return undefined;
  const inputTokens = readProjectionTokenCount(value.inputTokens);
  const outputTokens = readProjectionTokenCount(value.outputTokens);
  const totalTokens = readProjectionTokenCount(value.totalTokens);
  if (inputTokens === undefined || outputTokens === undefined || totalTokens === undefined) {
    return undefined;
  }
  const cachedInputTokens = readProjectionTokenCount(value.cachedInputTokens);
  const cacheCreationInputTokens = readProjectionTokenCount(value.cacheCreationInputTokens);
  return {
    ...(cacheCreationInputTokens === undefined ? {} : { cacheCreationInputTokens }),
    ...(cachedInputTokens === undefined ? {} : { cachedInputTokens }),
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

function readProjectionTokenCount(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : undefined;
}

export function threadLogUserMessage(
  payload: Record<string, unknown>,
  conversationId: string,
  createdAt: string,
): ConversationMessageItem | null {
  const parsedMessage = conversationMessageItemSchema.safeParse(payload.message);
  if (parsedMessage.success) {
    return parsedMessage.data.role === "user" && parsedMessage.data.conversationId === conversationId
      ? parsedMessage.data
      : null;
  }
  const messageId = readProjectionString(payload, "messageId");
  const content = readProjectionString(payload, "content");
  const runId = readProjectionString(payload, "runId");
  if (messageId === null || content === null || runId === null) return null;
  const attachmentIds = Array.isArray(payload.attachmentIds)
    ? payload.attachmentIds.filter((attachmentId): attachmentId is string => typeof attachmentId === "string")
    : [];
  return conversationMessageItemSchema.safeParse({
    attachments: attachmentIds.map((id) => ({
      contextTokens: 0,
      conversationId,
      createdAt,
      id,
      kind: "file",
      messageId,
      mimeType: "application/octet-stream",
      name: id,
      projectPath: null,
      sizeBytes: 0,
      source: "upload",
      truncated: false,
    })),
    content,
    conversationId,
    createdAt,
    id: messageId,
    kind: "message",
    modelId: null,
    role: "user",
    runId,
    status: "completed",
  }).data ?? null;
}

export function threadLogTerminalAssistant(payload: Record<string, unknown>): {
  content: string;
  kind: "turn" | "failure" | "cancelled";
  messageId: string;
  modelId: string;
  providerState?: ModelProviderState;
  reasoningContent?: string;
} | null {
  const kind = payload.assistantKind;
  if (kind === null || kind === undefined) return null;
  if (kind !== "turn" && kind !== "failure" && kind !== "cancelled") {
    throw new Error("ThreadLog terminal assistant kind is invalid.");
  }
  const content = readProjectionString(payload, "content");
  const messageId = readProjectionString(payload, "messageId");
  const modelId = readProjectionString(payload, "modelId");
  if (content === null || messageId === null || modelId === null) {
    throw new Error("ThreadLog terminal assistant payload is invalid.");
  }
  const providerState = readProjectionProviderState(payload);
  const reasoningContent = readProjectionString(payload, "reasoningContent");
  return {
    content,
    kind,
    messageId,
    modelId,
    ...(providerState === undefined ? {} : { providerState }),
    ...(reasoningContent === null ? {} : { reasoningContent }),
  };
}

function isProjectionRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
