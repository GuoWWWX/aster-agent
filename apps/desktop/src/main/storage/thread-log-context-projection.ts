import { z } from "zod";
import type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";
import type { ThreadLogContext, ThreadLogContextCheckpoint, ThreadLogContextMessage, ThreadLogEvent } from "./thread-log-contracts.js";

export function applyContextEvent(context: ThreadLogContext, event: ThreadLogEvent): void {
  if (event.type === "agent_messages_consumed") {
    for (const message of readQueuedAgentContext(event)) context.messages.push({ ...message, sequence: context.messages.length + 1 });
    return;
  }
  if (event.type === "legacy_snapshot_imported") {
    const legacyMessages = readLegacyContextMessages(event.payload);
    const sequenceOffset = context.messages.length;
    for (const [index, message] of legacyMessages.entries()) {
      context.messages.push({ ...message, sequence: sequenceOffset + index + 1 });
    }
    const legacyCheckpoint = readLegacyCheckpoint(event.payload, event.createdAt);
    if (legacyCheckpoint !== null) {
      context.checkpoint = {
        ...legacyCheckpoint,
        coveredThroughSequence: Math.min(
          context.messages.length,
          sequenceOffset + legacyMessages.filter(
            (message) => message.sequence <= legacyCheckpoint.coveredThroughSequence,
          ).length,
        ),
      };
    }
    return;
  }

  if (event.type === "run_superseded") {
    const supersededRunId = event.payload.runId;
    if (typeof supersededRunId !== "string" || supersededRunId.length === 0) return;
    const beforeCount = context.messages.length;
    context.messages = context.messages.filter((message) => message.runId !== supersededRunId);
    if (context.messages.length !== beforeCount) {
      // A checkpoint may summarize the superseded branch. Retaining it would
      // reintroduce edited-away content into the next model request.
      context.checkpoint = null;
      renumberContextMessages(context);
    }
    return;
  }

  if (event.type === "run_replaced") {
    const supersededRunId = event.payload.previousRunId;
    if (typeof supersededRunId === "string" && supersededRunId.length > 0) {
      const beforeCount = context.messages.length;
      context.messages = context.messages.filter((message) => message.runId !== supersededRunId);
      if (context.messages.length !== beforeCount) {
        context.checkpoint = null;
        renumberContextMessages(context);
      }
    }
    const replacement = contextMessageForEvent(event, context.messages.length + 1);
    if (replacement !== null) context.messages.push(replacement);
    return;
  }

  const message = contextMessageForEvent(event, context.messages.length + 1);
  if (message !== null) {
    context.messages.push(message);
    return;
  }

  if (event.type === "context_checkpoint") {
    const summary = event.payload.summary;
    if (typeof summary === "string" && summary.trim().length > 0) {
      const coveredThroughContextSequence = event.payload.coveredThroughContextSequence;
      context.checkpoint = {
        coveredThroughSequence:
          typeof coveredThroughContextSequence === "number"
          && Number.isSafeInteger(coveredThroughContextSequence)
          && coveredThroughContextSequence > 0
            ? coveredThroughContextSequence
            : context.messages.at(-1)?.sequence ?? 0,
        createdAt: event.createdAt,
        summary,
        updatedAt: event.createdAt,
      };
    }
  }
}

function renumberContextMessages(context: ThreadLogContext): void {
  context.messages = context.messages.map((message, index) => ({
    ...message,
    sequence: index + 1,
  }));
}

export function contextMessageForEvent(
  event: ThreadLogEvent,
  sequence: number,
): ThreadLogContextMessage | null {
  if (event.type === "group_message") {
    const message = z.object({ role: z.enum(["user", "assistant"]), content: z.string() }).parse(event.payload.message);
    return { attachmentIds: [], content: message.content, role: message.role, runId: null, sequence, toolCallId: null, toolCalls: [] };
  }
  if (event.type === "agent_message") {
    if (isRecord(event.payload.message) && event.payload.message.deliveryMode === "queue") return null;
    const content = typeof event.payload.modelContent === "string"
      ? event.payload.modelContent
      : event.payload.content;
    if (typeof content !== "string") return null;
    return {
      attachmentIds: [],
      content,
      role: "user",
      runId: readNullableString(event.payload.runId),
      sequence,
      toolCallId: null,
      toolCalls: [],
    };
  }

  if (
    event.type === "run_queued"
    || event.type === "run_replaced"
    || event.type === "user_message"
    || event.type === "user_message_replaced"
  ) {
    const content = typeof event.payload.modelContent === "string"
      ? event.payload.modelContent
      : event.payload.content;
    if (typeof content !== "string") return null;
    return {
      attachmentIds: readStringArray(event.payload.attachmentIds),
      content,
      role: "user",
      runId: readNullableString(event.payload.runId),
      sequence,
      toolCallId: null,
      toolCalls: [],
    };
  }

  if (event.type === "assistant_message") {
    const content = event.payload.content;
    if (typeof content !== "string") return null;
    const providerState = readProviderState(event.payload.providerState);
    return {
      attachmentIds: [],
      content,
      ...(providerState === undefined ? {} : { providerState }),
      role: "assistant",
      runId: readNullableString(event.payload.runId),
      sequence,
      toolCallId: null,
      toolCalls: readToolCalls(event.payload.toolCalls),
    };
  }

  if (event.type === "run_terminal") {
    const assistantKind = event.payload.assistantKind;
    if (assistantKind !== "turn" && assistantKind !== "cancelled") return null;
    const content = event.payload.content;
    if (typeof content !== "string") return null;
    const providerState = readProviderState(event.payload.providerState);
    return {
      attachmentIds: [],
      content,
      ...(providerState === undefined ? {} : { providerState }),
      role: "assistant",
      runId: readNullableString(event.payload.runId),
      sequence,
      toolCallId: null,
      toolCalls: [],
    };
  }

  if (event.type === "tool_result") {
    const content = event.payload.content;
    const toolCallId = event.payload.toolCallId;
    if (typeof content !== "string" || typeof toolCallId !== "string" || toolCallId.length === 0) {
      return null;
    }
    return {
      attachmentIds: [],
      content,
      role: "tool",
      runId: readNullableString(event.payload.runId),
      sequence,
      toolCallId,
      toolCalls: [],
    };
  }

  return null;
}

export function readQueuedAgentContext(event: ThreadLogEvent): ThreadLogContextMessage[] {
  if (event.payload.queuedMessages === undefined) return [];
  const queued = z.array(z.object({ messageId: z.string().uuid(), modelContent: z.string() }).strict()).max(50).parse(event.payload.queuedMessages);
  const ids = readStringArray(event.payload.messageIds);
  return queued.map((message, index) => {
    if (!ids.includes(message.messageId)) throw new Error("Queued context must belong to the consumed message batch.");
    return { attachmentIds: [], content: message.modelContent, role: "user", runId: readNullableString(event.payload.runId),
      sequence: index + 1, toolCallId: null, toolCalls: [] };
  });
}

export function readLegacyContextMessages(payload: Record<string, unknown>): ThreadLogContextMessage[] {
  if (!Array.isArray(payload.modelMessages)) return [];
  const messages: ThreadLogContextMessage[] = [];
  for (const value of payload.modelMessages) {
    if (!isRecord(value)) continue;
    const role = value.role;
    const content = value.content;
    const sequence = value.sequence;
    if (
      (role !== "assistant" && role !== "tool" && role !== "user")
      || typeof content !== "string"
      || typeof sequence !== "number"
      || !Number.isSafeInteger(sequence)
      || sequence <= 0
    ) {
      continue;
    }
    const toolCallId = role === "tool" ? readNullableString(value.toolCallId) : null;
    const providerState = role === "assistant" ? readProviderState(value.providerState) : undefined;
    messages.push({
      attachmentIds: readStringArray(value.attachmentIds),
      content,
      ...(providerState === undefined ? {} : { providerState }),
      role,
      runId: readNullableString(value.runId),
      sequence,
      toolCallId,
      toolCalls: role === "assistant" ? readToolCalls(value.toolCalls) : [],
    });
  }
  return messages;
}

function readLegacyCheckpoint(
  payload: Record<string, unknown>,
  fallbackTimestamp: string,
): ThreadLogContextCheckpoint | null {
  if (!isRecord(payload.checkpoint)) return null;
  const coveredThroughSequence = payload.checkpoint.coveredThroughSequence;
  const summary = payload.checkpoint.summary;
  if (
    typeof coveredThroughSequence !== "number"
    || !Number.isSafeInteger(coveredThroughSequence)
    || typeof summary !== "string"
    || summary.trim().length === 0
  ) {
    return null;
  }
  return {
    coveredThroughSequence,
    createdAt: typeof payload.checkpoint.createdAt === "string"
      ? payload.checkpoint.createdAt
      : fallbackTimestamp,
    summary,
    updatedAt: typeof payload.checkpoint.updatedAt === "string"
      ? payload.checkpoint.updatedAt
      : fallbackTimestamp,
  };
}

function readToolCalls(value: unknown): ModelToolCall[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const argumentsValue = entry.arguments;
    const id = entry.id;
    const name = entry.name;
    return typeof argumentsValue === "string" && typeof id === "string" && typeof name === "string"
      ? [{ arguments: argumentsValue, id, name }]
      : [];
  });
}

function readProviderState(value: unknown): ModelProviderState | undefined {
  if (!isRecord(value)) return undefined;
  if (
    typeof value.apiFormat !== "string"
    || typeof value.baseUrl !== "string"
    || typeof value.modelId !== "string"
    || !("payload" in value)
  ) {
    return undefined;
  }
  return value as ModelProviderState;
}

export function readNullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
