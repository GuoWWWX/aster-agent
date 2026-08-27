import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  renameSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { z } from "zod";

import type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";

const threadLogEventTypeSchema = z.enum([
 "agent_message",
  "agent_message_read",
 "assistant_message",
  "conversation_created",
  "context_checkpoint",
  "legacy_snapshot_imported",
  "pending_message_cancelled",
  "pending_messages_updated",
  "run_queued",
  "run_created",
  "run_replaced",
  "run_terminal",
 "run_started",
 "run_finished",
 "run_superseded",
  "subagent_task_completed",
 "subagent_task_created",
  "task_list_updated",
  "tool_approval_decided",
  "tool_approval_requested",
  "tool_call_requested",
  "tool_execution_prepared",
  "tool_result",
  "user_message",
  "user_message_replaced",
]);

const threadLogPayloadSchema = z.record(z.string(), z.unknown());

export const threadLogHeaderSchema = z.object({
  conversationId: z.string().uuid(),
  createdAt: z.string().datetime(),
  type: z.literal("thread_header"),
  version: z.literal(1),
}).strict();

export const threadLogEventSchema = z.object({
  conversationId: z.string().uuid(),
  createdAt: z.string().datetime(),
  eventId: z.string().uuid(),
  payload: threadLogPayloadSchema,
  sequence: z.number().int().positive(),
  type: threadLogEventTypeSchema,
  version: z.literal(1),
}).strict();

export type ThreadLogEvent = z.infer<typeof threadLogEventSchema>;
export type ThreadLogEventInput = {
  payload: Record<string, unknown>;
  type: z.infer<typeof threadLogEventTypeSchema>;
};
export type ThreadLogRead = {
  events: ThreadLogEvent[];
  header: z.infer<typeof threadLogHeaderSchema>;
};

/** A model-visible message reconstructed from the canonical ThreadLog. */
export type ThreadLogContextMessage = {
  attachmentIds: string[];
  content: string;
  providerState?: ModelProviderState;
  role: "assistant" | "tool" | "user";
  runId: string | null;
  sequence: number;
  toolCallId: string | null;
  toolCalls: ModelToolCall[];
};

export type ThreadLogContextCheckpoint = {
  coveredThroughSequence: number;
  createdAt: string;
  summary: string;
  updatedAt: string;
};

export type ThreadLogContext = {
  checkpoint: ThreadLogContextCheckpoint | null;
  messages: ThreadLogContextMessage[];
};

/**
 * A per-conversation append-only JSONL file. During the migration SQLite still
 * owns normal business writes, while ThreadLog owns model-context replay and
 * supplies recovery data for a missing SQLite projection.
 */
export class ThreadLog {
  private readonly lastSequenceByConversation = new Map<string, number>();

  /**
   * Context compilation is much more frequent than durable-log reads. Keep
   * the parsed append-only log in memory for this process; `read()` remains
   * a fresh disk read for repair and diagnostics.
   */
  private readonly contextReadCache = new Map<string, ThreadLogRead>();

  private readonly contextSnapshotCache = new Map<string, ThreadLogContext>();

  public constructor(private readonly conversationsRootPath: string) {}

  public append(conversationId: string, input: ThreadLogEventInput): ThreadLogEvent {
    const parsedConversationId = z.string().uuid().parse(conversationId);
    const lastSequence = this.getLastSequence(parsedConversationId);
    const event = threadLogEventSchema.parse({
      conversationId: parsedConversationId,
      createdAt: new Date().toISOString(),
      eventId: randomUUID(),
      payload: input.payload,
      sequence: lastSequence + 1,
      type: input.type,
      version: 1,
    });
    const logPath = this.getPath(parsedConversationId);
    const prefix = this.endsWithNewline(logPath) ? "" : "\n";
    appendFileSync(logPath, `${prefix}${JSON.stringify(event)}\n`, "utf8");
    this.lastSequenceByConversation.set(parsedConversationId, event.sequence);
    const cached = this.contextReadCache.get(parsedConversationId);
    if (cached !== undefined) cached.events.push(event);
    const context = this.contextSnapshotCache.get(parsedConversationId);
    if (context !== undefined) {
      if (event.type === "legacy_snapshot_imported") {
        // Legacy import is the only event that can replace an entire prior
        // history snapshot. It is a one-time migration path, so replaying it
        // once is preferable to maintaining a separate mutation algorithm.
        this.contextSnapshotCache.delete(parsedConversationId);
      } else {
        applyContextEvent(context, event);
      }
    }
    return event;
  }

  /**
   * Writes one logical event at most once, using a caller-owned durable ID in
   * the payload. This is intentionally narrow: it protects messages whose
   * SQLite write and ThreadLog append cannot share one filesystem transaction.
   */
  public appendIfMissing(
    conversationId: string,
    input: ThreadLogEventInput,
    uniquePayloadField: string,
  ): ThreadLogEvent | null {
    const uniqueValue = input.payload[uniquePayloadField];
    if (typeof uniqueValue !== "string" || uniqueValue.length === 0) {
      throw new Error(`ThreadLog unique payload field ${uniquePayloadField} must be a non-empty string.`);
    }
    const existing = this.readForContext(z.string().uuid().parse(conversationId));
    if (existing?.events.some((event) =>
      event.type === input.type && event.payload[uniquePayloadField] === uniqueValue,
    ) === true) {
      return null;
    }
    return this.append(conversationId, input);
  }

  public getPath(conversationId: string): string {
    const parsedConversationId = z.string().uuid().parse(conversationId);
    return path.join(this.conversationsRootPath, `${parsedConversationId}.jsonl`);
  }

  public hasConversation(conversationId: string): boolean {
    return existsSync(this.getPath(conversationId));
  }

  /**
   * Preserves an unreadable log for inspection and makes its conversation
   * eligible for a SQLite snapshot import. This is intentionally not a repair
   * in place: a non-terminal malformed line has no trustworthy replay point.
   */
  public quarantine(conversationId: string): string | null {
    const parsedConversationId = z.string().uuid().parse(conversationId);
    const logPath = this.getPath(parsedConversationId);
    if (!existsSync(logPath)) return null;
    const quarantinedPath = `${logPath}.corrupt-${Date.now()}-${randomUUID()}`;
    renameSync(logPath, quarantinedPath);
    this.lastSequenceByConversation.delete(parsedConversationId);
    this.contextReadCache.delete(parsedConversationId);
    this.contextSnapshotCache.delete(parsedConversationId);
    return quarantinedPath;
  }

  public listConversationIds(): string[] {
    if (!existsSync(this.conversationsRootPath)) return [];
    return readdirSync(this.conversationsRootPath, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) return [];
      const conversationId = entry.name.slice(0, -".jsonl".length);
      return z.string().uuid().safeParse(conversationId).success ? [conversationId] : [];
    });
  }

  public read(conversationId: string): ThreadLogRead | null {
    const parsedConversationId = z.string().uuid().parse(conversationId);
    const logPath = this.getPath(parsedConversationId);
    if (!existsSync(logPath)) return null;
    const log = this.readExisting(parsedConversationId, logPath);
    this.lastSequenceByConversation.set(
      parsedConversationId,
      log.events.at(-1)?.sequence ?? 0,
    );
    return log;
  }

  /**
   * Reconstructs only the model-visible history from the JSONL event stream.
   * The result is cached until this process appends another event. SQLite is
   * intentionally not used as the chronological history source here.
   */
  public readContext(conversationId: string): ThreadLogContext | null {
    const parsedConversationId = z.string().uuid().parse(conversationId);
    const cachedSnapshot = this.contextSnapshotCache.get(parsedConversationId);
    if (cachedSnapshot !== undefined) return cachedSnapshot;
    const log = this.readForContext(parsedConversationId);
    if (log === null) return null;
    const context = reconstructContext(log.events);
    this.contextSnapshotCache.set(parsedConversationId, context);
    return context;
  }

  private getLastSequence(conversationId: string): number {
    const cached = this.lastSequenceByConversation.get(conversationId);
    if (cached !== undefined) return cached;
    return this.readOrCreate(conversationId).events.at(-1)?.sequence ?? 0;
  }

  private readForContext(conversationId: string): ThreadLogRead | null {
    const cached = this.contextReadCache.get(conversationId);
    if (cached !== undefined) return cached;
    const log = this.read(conversationId);
    if (log !== null) this.contextReadCache.set(conversationId, log);
    return log;
  }

  private readOrCreate(conversationId: string): ThreadLogRead {
    const existing = this.read(conversationId);
    if (existing !== null) return existing;

    mkdirSync(this.conversationsRootPath, { recursive: true, mode: 0o700 });
    const header = threadLogHeaderSchema.parse({
      conversationId,
      createdAt: new Date().toISOString(),
      type: "thread_header",
      version: 1,
    });
    writeFileSync(this.getPath(conversationId), `${JSON.stringify(header)}\n`, "utf8");
    this.lastSequenceByConversation.set(conversationId, 0);
    return { events: [], header };
  }

  private readExisting(conversationId: string, logPath: string): ThreadLogRead {
    const content = readFileSync(logPath, "utf8");
    const lines = content.split("\n");
    const nonTerminalLines = content.endsWith("\n") ? lines.slice(0, -1) : lines;
    if (nonTerminalLines.length === 0 || nonTerminalLines[0] === "") {
      throw new Error(`ThreadLog has no valid header: ${logPath}`);
    }

    let header: z.infer<typeof threadLogHeaderSchema> | undefined;
    const events: ThreadLogEvent[] = [];
    let lastValidLineIndex = -1;
    for (const [index, rawLine] of nonTerminalLines.entries()) {
      try {
        if (index === 0) {
          header = threadLogHeaderSchema.parse(JSON.parse(rawLine));
          if (header.conversationId !== conversationId) {
            throw new Error("ThreadLog header conversationId does not match its filename.");
          }
        } else {
          const event = threadLogEventSchema.parse(JSON.parse(rawLine));
          if (event.conversationId !== conversationId) {
            throw new Error("ThreadLog event conversationId does not match its filename.");
          }
          const expectedSequence = (events.at(-1)?.sequence ?? 0) + 1;
          if (event.sequence !== expectedSequence) {
            throw new Error(`ThreadLog event sequence must be ${expectedSequence}.`);
          }
          events.push(event);
        }
        lastValidLineIndex = index;
      } catch (error) {
        if (index !== nonTerminalLines.length - 1) throw error;
        const recoveredContent = nonTerminalLines
          .slice(0, lastValidLineIndex + 1)
          .join("\n");
        writeFileSync(logPath, recoveredContent.length === 0 ? "" : `${recoveredContent}\n`, "utf8");
        break;
      }
    }
    if (header === undefined) throw new Error(`ThreadLog has no valid header: ${logPath}`);
    return { events, header };
  }

  private endsWithNewline(logPath: string): boolean {
    const descriptor = openSync(logPath, "r");
    try {
      const size = fstatSync(descriptor).size;
      if (size === 0) return false;
      const lastByte = Buffer.allocUnsafe(1);
      readSync(descriptor, lastByte, 0, 1, size - 1);
      return lastByte[0] === 0x0a;
    } finally {
      closeSync(descriptor);
    }
  }
}

function reconstructContext(events: readonly ThreadLogEvent[]): ThreadLogContext {
  const context: ThreadLogContext = { checkpoint: null, messages: [] };
  for (const event of events) {
    applyContextEvent(context, event);
  }
  return context;
}

function applyContextEvent(context: ThreadLogContext, event: ThreadLogEvent): void {
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
    }
    return;
  }

  if (event.type === "run_replaced") {
    const supersededRunId = event.payload.previousRunId;
    if (typeof supersededRunId === "string" && supersededRunId.length > 0) {
      const beforeCount = context.messages.length;
      context.messages = context.messages.filter((message) => message.runId !== supersededRunId);
      if (context.messages.length !== beforeCount) context.checkpoint = null;
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
      context.checkpoint = {
        coveredThroughSequence: context.messages.at(-1)?.sequence ?? 0,
        createdAt: event.createdAt,
        summary,
        updatedAt: event.createdAt,
      };
    }
  }
}

function contextMessageForEvent(
  event: ThreadLogEvent,
  sequence: number,
): ThreadLogContextMessage | null {
  if (event.type === "agent_message") {
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

function readLegacyContextMessages(payload: Record<string, unknown>): ThreadLogContextMessage[] {
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

function readNullableString(value: unknown): string | null {
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
