import { randomUUID } from "node:crypto";
import {
  appendFileSync,
  closeSync,
  existsSync,
  fstatSync,
  ftruncateSync,
  mkdirSync,
  openSync,
  readdirSync,
  readSync,
  renameSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { rm, rmdir } from "node:fs/promises";
import path from "node:path";

import { z } from "zod";

import type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";

const THREAD_LOG_READ_CHUNK_BYTES = 256 * 1_024;
const THREAD_LOG_CONTEXT_CACHE_LIMIT = 4;
const THREAD_LOG_CONTEXT_CACHE_BYTES = 16 * 1_024 * 1_024;

const threadLogEventTypeSchema = z.enum([
 "agent_message",
  "agent_message_read",
 "assistant_message",
  "conversation_created",
  "conversation_properties_changed",
  "conversation_result_viewed",
  "conversation_execution_paused",
  "agent_messages_consumed",
  "state_checkpoint",
  "context_checkpoint",
  "legacy_snapshot_imported",
  "model_retry_updated",
  "pending_message_cancelled",
  "pending_messages_updated",
  "run_queued",
  "run_created",
  "run_replaced",
  "run_terminal",
 "run_started",
 "run_finished",
 "run_superseded",
 "runtime_activity_updated",
  "subagent_task_completed",
  "subagent_task_created",
  "subagent_task_ended",
  "task_list_updated",
  "turn_summary_updated",
  "tool_approval_decided",
  "tool_approval_auto_reviewed",
  "tool_approval_expired",
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

export type ThreadLogSourceSignature = {
  modifiedAtMs: number;
  sizeBytes: number;
};

export type ThreadLogRecordLocation = { offset: number; length: number };
export type ThreadLogScanCursor = {
  header: z.infer<typeof threadLogHeaderSchema>;
  offset: number;
  sequence: number;
  generation: number;
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

type ContextLocation = { record: ThreadLogRecordLocation; legacyIndex: number };
type ContextIndex = {
  context: ThreadLogContext;
  locations: ContextLocation[];
  cursor: ThreadLogScanCursor | null;
};

/**
 * The append-only durable source for one Conversation. SQLite TEMP tables may
 * index this file while the app is running, but db.sqlite does not own or
 * persist Conversation state after the one-time legacy import.
 */
export class ThreadLog {
  private readonly observedSources = new Map<string, { signature: string; generation: number }>();
  private readonly lastSequenceByConversation = new Map<string, number>();

  private readonly uniqueEventCache = new Map<string, {
    cursor: ThreadLogScanCursor | null; values: Set<string>;
  }>();

  private readonly contextSnapshotCache = new Map<string, ThreadLogContext>();
  private readonly contextSnapshotBytes = new WeakMap<ThreadLogContext, number>();
  private readonly contextIndexes = new Map<string, ContextIndex>();

  public constructor(private readonly conversationsRootPath: string) {
    this.migrateLegacyLayout();
  }

  public append(conversationId: string, input: ThreadLogEventInput): ThreadLogEvent {
    const parsedConversationId = z.string().uuid().parse(conversationId);
    this.observeSource(parsedConversationId);
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
    const observed = this.observedSources.get(parsedConversationId);
    this.observedSources.set(parsedConversationId, {
      signature: this.sourceKey(parsedConversationId), generation: observed?.generation ?? 0,
    });
    this.lastSequenceByConversation.set(parsedConversationId, event.sequence);
    const context = this.contextSnapshotCache.get(parsedConversationId);
    if (context !== undefined) {
      if (event.type === "legacy_snapshot_imported") {
        // Legacy import is the only event that can replace an entire prior
        // history snapshot. It is a one-time migration path, so replaying it
        // once is preferable to maintaining a separate mutation algorithm.
        this.contextSnapshotCache.delete(parsedConversationId);
      } else {
        const previousLength = context.messages.length;
        const previousCheckpointBytes = context.checkpoint === null ? 0 : retainedValueBytes(context.checkpoint);
        applyContextEvent(context, event);
        const bytes = event.type === "run_replaced" || event.type === "run_superseded"
          ? retainedContextBytes(context)
          : (this.contextSnapshotBytes.get(context) ?? 0)
            + context.messages.slice(previousLength).reduce((sum, message) => sum + retainedValueBytes(message), 0)
            - previousCheckpointBytes + (context.checkpoint === null ? 0 : retainedValueBytes(context.checkpoint));
        this.contextSnapshotBytes.set(context, bytes);
        this.trimContextCache();
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
    const key = `${z.string().uuid().parse(conversationId)}/${input.type}/${uniquePayloadField}`;
    const cached = this.uniqueEventCache.get(key);
    const after = cached?.cursor != null && this.canContinueScan(conversationId, cached.cursor)
      ? cached.cursor : undefined;
    const values = after === undefined ? new Set<string>() : cached!.values;
    const cursor = this.scan(conversationId, (event) => {
      const value = event.payload[uniquePayloadField];
      if (event.type === input.type && typeof value === "string") values.add(value);
    }, after);
    setBoundedCacheEntry(this.uniqueEventCache, key, { cursor, values }, THREAD_LOG_CONTEXT_CACHE_LIMIT);
    if (values.has(uniqueValue)) return null;
    return this.append(conversationId, input);
  }

  public getPath(conversationId: string): string {
    const parsedConversationId = z.string().uuid().parse(conversationId);
    return path.join(
      this.conversationsRootPath,
      parsedConversationId,
      "conversation.jsonl",
    );
  }

  public hasConversation(conversationId: string): boolean {
    return existsSync(this.getPath(conversationId));
  }

  public getSourceSignature(conversationId: string): ThreadLogSourceSignature | null {
    const logPath = this.getPath(conversationId);
    try {
      const metadata = statSync(logPath);
      return {
        modifiedAtMs: metadata.mtimeMs,
        sizeBytes: metadata.size,
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  public async deleteConversations(conversationIds: readonly string[]): Promise<void> {
    for (const conversationId of conversationIds) {
      const parsedConversationId = z.string().uuid().parse(conversationId);
      const logPath = this.getPath(parsedConversationId);
      const conversationDirectory = path.dirname(logPath);
      if (existsSync(conversationDirectory)) {
        for (const entry of readdirSync(conversationDirectory, { withFileTypes: true })) {
          if (!entry.isFile() || !isOwnedThreadLogFile(entry.name)) continue;
          await rm(path.join(conversationDirectory, entry.name), { force: true });
        }
        await rmdir(conversationDirectory).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT" && error.code !== "ENOTEMPTY" && error.code !== "EEXIST") {
            throw error;
          }
        });
      }
      this.lastSequenceByConversation.delete(parsedConversationId);
      this.observeSource(parsedConversationId);
      for (const key of this.uniqueEventCache.keys()) {
        if (key.startsWith(`${parsedConversationId}/`)) this.uniqueEventCache.delete(key);
      }
      this.contextSnapshotCache.delete(parsedConversationId);
      this.contextIndexes.delete(parsedConversationId);
    }
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
    this.observeSource(parsedConversationId);
    this.contextSnapshotCache.delete(parsedConversationId);
    return quarantinedPath;
  }

  public listConversationIds(): string[] {
    if (!existsSync(this.conversationsRootPath)) return [];
    return readdirSync(this.conversationsRootPath, { withFileTypes: true }).flatMap((entry) => {
      if (!entry.isDirectory() || !z.string().uuid().safeParse(entry.name).success) return [];
      return existsSync(this.getPath(entry.name)) ? [entry.name] : [];
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

  public readFirstEvent(conversationId: string, type?: ThreadLogEvent["type"]): ThreadLogEvent | null {
    const id = z.string().uuid().parse(conversationId);
    if (!existsSync(this.getPath(id))) return null;
    let first: ThreadLogEvent | null = null;
    this.readExisting(id, this.getPath(id), (event) => {
      if (type !== undefined && event.type !== type) return;
      first = event;
      return false;
    });
    return first;
  }

  /** Find a complete startup checkpoint in a bounded tail; older logs use normal replay. */
  public readLatestStateCheckpoint(conversationId: string): { event: ThreadLogEvent; cursor: ThreadLogScanCursor } | null {
    const logPath = this.getPath(conversationId);
    if (!existsSync(logPath)) return null;
    const generation = this.observeSource(conversationId);
    const { header } = this.readExisting(conversationId, logPath, () => false);
    const descriptor = openSync(logPath, "r");
    try {
      const size = fstatSync(descriptor).size;
      const minimum = Math.max(0, size - 8 * 1_024 * 1_024);
      let position = size;
      let pending: Buffer = Buffer.alloc(0);
      while (position > minimum) {
        const length = Math.min(THREAD_LOG_READ_CHUNK_BYTES, position - minimum);
        position -= length;
        const chunk = Buffer.allocUnsafe(length);
        let consumed = 0;
        while (consumed < length) {
          const count = readSync(descriptor, chunk, consumed, length - consumed, position + consumed);
          if (count === 0) throw new Error("ThreadLog checkpoint is no longer available.");
          consumed += count;
        }
        const bytes = Buffer.concat([chunk, pending]);
        let end = bytes.length;
        for (let newline = bytes.lastIndexOf(0x0a); newline >= 0; newline = bytes.lastIndexOf(0x0a, newline - 1)) {
          const line = bytes.subarray(newline + 1, end);
          if (line.includes('"state_checkpoint"') && position + end < size) {
            const event = threadLogEventSchema.parse(JSON.parse(line.toString("utf8")));
            if (event.conversationId !== conversationId) throw new Error("ThreadLog checkpoint belongs to another conversation.");
            if (event.type === "state_checkpoint") return { event, cursor: {
              header, offset: position + end + 1, sequence: event.sequence, generation,
            } };
          }
          end = newline;
          if (newline === 0) break;
        }
        pending = Buffer.from(bytes.subarray(0, end));
      }
      return null;
    } finally { closeSync(descriptor); }
  }

  /** Visit records without retaining their payloads after the callback returns. */
  public scan(
    conversationId: string,
    visit: (event: ThreadLogEvent, location: ThreadLogRecordLocation) => void,
    after?: ThreadLogScanCursor,
    maxRecords = Infinity,
  ): ThreadLogScanCursor | null {
    const id = z.string().uuid().parse(conversationId);
    const logPath = this.getPath(id);
    if (!existsSync(logPath)) return null;
    const generation = this.observeSource(id);
    if (after !== undefined && after.generation !== generation) {
      throw new Error("ThreadLog changed outside the append stream; rebuild its index.");
    }
    let sequence = after?.sequence ?? 0;
    let count = 0;
    let offset = after?.offset ?? 0;
    const result = this.readExisting(id, logPath, (event, location) => {
      sequence = event.sequence;
      offset = location.offset + location.length + 1;
      visit(event, location);
      if (++count >= maxRecords) return false;
    }, after);
    if (offset >= statSync(logPath).size) this.lastSequenceByConversation.set(id, sequence);
    return this.endsWithNewline(logPath)
      ? { header: result.header, offset: count === 0 && after === undefined ? statSync(logPath).size : offset, sequence, generation }
      : null;
  }

  public canContinueScan(conversationId: string, cursor: ThreadLogScanCursor): boolean {
    return cursor.generation === this.observeSource(conversationId);
  }

  private sourceKey(conversationId: string): string {
    const source = this.getSourceSignature(conversationId);
    return `${source?.sizeBytes}:${source?.modifiedAtMs}`;
  }

  private observeSource(conversationId: string): number {
    const signature = this.sourceKey(conversationId);
    const previous = this.observedSources.get(conversationId);
    const generation = (previous?.generation ?? 0) + Number(previous !== undefined && previous.signature !== signature);
    if (previous !== undefined && previous.signature !== signature) {
      this.lastSequenceByConversation.delete(conversationId);
      this.contextSnapshotCache.delete(conversationId);
    }
    this.observedSources.set(conversationId, { signature, generation });
    return generation;
  }

  public readRecord(conversationId: string, location: ThreadLogRecordLocation): ThreadLogEvent {
    if (!Number.isSafeInteger(location.offset) || location.offset < 0
      || !Number.isSafeInteger(location.length) || location.length <= 0) {
      throw new Error("Invalid ThreadLog record location.");
    }
    const descriptor = openSync(this.getPath(conversationId), "r");
    try {
      const bytes = Buffer.allocUnsafe(location.length);
      let consumed = 0;
      while (consumed < bytes.length) {
        const count = readSync(descriptor, bytes, consumed, bytes.length - consumed, location.offset + consumed);
        if (count === 0) throw new Error("ThreadLog record is no longer available.");
        consumed += count;
      }
      const event = threadLogEventSchema.parse(JSON.parse(bytes.toString("utf8")));
      if (event.conversationId !== conversationId) throw new Error("ThreadLog record belongs to another conversation.");
      return event;
    } finally {
      closeSync(descriptor);
    }
  }

  /**
   * Reconstructs only the model-visible history from the JSONL event stream.
   * The result is cached until this process appends another event. SQLite is
   * intentionally not used as the chronological history source here.
   */
  public readContext(conversationId: string): ThreadLogContext | null {
    const parsedConversationId = z.string().uuid().parse(conversationId);
    this.observeSource(parsedConversationId);
    const cachedSnapshot = this.contextSnapshotCache.get(parsedConversationId);
    if (cachedSnapshot !== undefined) {
      touchCacheEntry(this.contextSnapshotCache, parsedConversationId, cachedSnapshot);
      return cachedSnapshot;
    }
    if (!this.hasConversation(parsedConversationId)) return null;
    const context: ThreadLogContext = { checkpoint: null, messages: [] };
    this.scan(parsedConversationId, (event) => applyContextEvent(context, event));
    this.contextSnapshotBytes.set(context, retainedContextBytes(context));
    setBoundedCacheEntry(
      this.contextSnapshotCache,
      parsedConversationId,
      context,
      THREAD_LOG_CONTEXT_CACHE_LIMIT,
    );
    this.trimContextCache();
    return context;
  }

  /** Compilation needs only the uncompressed suffix; historical bodies stay on disk. */
  public readUncoveredContext(conversationId: string): (ThreadLogContext & { totalMessageCount: number }) | null {
    const index = this.contextIndex(conversationId);
    if (index === null) return null;
    const covered = index.context.checkpoint?.coveredThroughSequence ?? 0;
    return {
      totalMessageCount: index.context.messages.length,
      checkpoint: index.context.checkpoint === null ? null : { ...index.context.checkpoint },
      messages: [...this.readContextLocations(conversationId, index,
        index.context.messages.flatMap((message, position) => message.sequence > covered ? [position] : []))],
    };
  }

  /** Read one execution by file offsets, without materializing other runs' bodies. */
  public readRunContext(conversationId: string, runId: string): ThreadLogContextMessage[] {
    z.string().uuid().parse(runId);
    const index = this.contextIndex(conversationId);
    if (index === null) return [];
    return [...this.readContextLocations(conversationId, index,
      index.context.messages.flatMap((message, position) => message.runId === runId ? [position] : []))];
  }

  /** Usage excludes opaque provider payloads and never materializes message bodies. */
  public readProviderUsageStates(conversationId: string): ModelProviderState[] | null {
    const index = this.contextIndex(conversationId);
    return index === null ? null : structuredClone(index.context.messages.flatMap((message) =>
      message.providerState === undefined ? [] : [message.providerState]));
  }

  public searchCoveredContext(conversationId: string, query: string): ThreadLogContextMessage[] {
    const words = query.toLowerCase().match(/[\p{L}\p{N}_./-]{2,}/gu) ?? [];
    const terms = [...new Set(words.flatMap((word) => /^[\p{Script=Han}]+$/u.test(word)
      ? [word, ...Array.from({ length: Math.max(0, word.length - 1) }, (_, offset) => word.slice(offset, offset + 2))]
      : [word]))].slice(0, 24);
    if (terms.length === 0) return [];
    const index = this.contextIndex(conversationId);
    if (index === null) return [];
    const covered = index.context.checkpoint?.coveredThroughSequence ?? 0;
    const positions = index.context.messages.flatMap((message, position) =>
      message.sequence <= covered && message.role !== "tool" ? [position] : []).slice(-1_000).reverse();
    const matches: ThreadLogContextMessage[] = [];
    for (const message of this.readContextLocations(conversationId, index, positions)) {
      const text = message.content.toLowerCase();
      const hit = terms.map((term) => text.indexOf(term)).find((offset) => offset >= 0) ?? -1;
      if (hit >= 0) {
        const start = Math.max(0, hit - 1_000);
        const match = { ...message, content: `${start > 0 ? "…" : ""}${message.content.slice(start, start + 4_000)}${start + 4_000 < message.content.length ? "…" : ""}`, toolCalls: [] };
        delete match.providerState;
        matches.push(match);
        if (matches.length === 24) break;
      }
    }
    return matches.reverse();
  }

  private contextIndex(conversationId: string): ContextIndex | null {
    const id = z.string().uuid().parse(conversationId);
    if (!this.hasConversation(id)) return null;
    let index = this.contextIndexes.get(id);
    if (index === undefined || index.cursor === null || !this.canContinueScan(id, index.cursor)) {
      index = { context: { checkpoint: null, messages: [] }, locations: [], cursor: null };
    }
    const target = index;
    try {
      target.cursor = this.scan(id, (event, record) => {
        const replaced = event.type === "run_superseded" ? event.payload.runId
          : event.type === "run_replaced" ? event.payload.previousRunId : undefined;
        if (typeof replaced === "string" && replaced.length > 0) {
          target.locations = target.locations.filter((_, position) => target.context.messages[position]?.runId !== replaced);
        }
        const oldLength = target.locations.length;
        applyContextEvent(target.context, event);
        for (let position = oldLength; position < target.context.messages.length; position += 1) {
          const message = target.context.messages[position]!;
          target.locations.push({ record, legacyIndex: position - oldLength });
          message.content = "";
          message.toolCalls = [];
          if (message.providerState?.usage !== undefined || message.providerState?.firstTokenLatencyMs !== undefined) {
            message.providerState = { ...message.providerState, payload: null };
          } else {
            delete message.providerState;
          }
        }
      }, target.cursor ?? undefined);
    } catch (error) {
      // A failed incremental scan must not retain partially applied events.
      this.contextIndexes.delete(id);
      throw error;
    }
    setBoundedCacheEntry(this.contextIndexes, id, target, THREAD_LOG_CONTEXT_CACHE_LIMIT);
    return target;
  }

  private *readContextLocations(conversationId: string, index: ContextIndex, positions: readonly number[]): IterableIterator<ThreadLogContextMessage> {
    let previousOffset = -1;
    let recordMessages: ThreadLogContextMessage[] = [];
    for (const position of positions) {
      const location = index.locations[position]!;
      if (location.record.offset !== previousOffset) {
        const event = this.readRecord(conversationId, location.record);
        const message = contextMessageForEvent(event, 1);
        recordMessages = event.type === "legacy_snapshot_imported" ? readLegacyContextMessages(event.payload)
          : message === null ? [] : [message];
        previousOffset = location.record.offset;
      }
      const message = recordMessages[location.legacyIndex];
      if (message === undefined) throw new Error("ThreadLog context location is no longer available.");
      yield { ...message, sequence: index.context.messages[position]!.sequence };
    }
  }

  private trimContextCache(): void {
    let bytes = [...this.contextSnapshotCache.values()]
      .reduce((sum, context) => sum + (this.contextSnapshotBytes.get(context) ?? 0), 0);
    for (const [id, context] of this.contextSnapshotCache) {
      if (bytes <= THREAD_LOG_CONTEXT_CACHE_BYTES) break;
      bytes -= this.contextSnapshotBytes.get(context) ?? 0;
      this.contextSnapshotCache.delete(id);
    }
  }

  private getLastSequence(conversationId: string): number {
    const cached = this.lastSequenceByConversation.get(conversationId);
    if (cached !== undefined) return cached;
    if (!this.hasConversation(conversationId)) return this.readOrCreate(conversationId).events.length;
    let sequence = 0;
    this.scan(conversationId, (event) => { sequence = event.sequence; });
    return sequence;
  }

  private readOrCreate(conversationId: string): ThreadLogRead {
    const existing = this.read(conversationId);
    if (existing !== null) return existing;

    mkdirSync(path.dirname(this.getPath(conversationId)), { recursive: true, mode: 0o700 });
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

  private readExisting(
    conversationId: string,
    logPath: string,
    visit?: (event: ThreadLogEvent, location: ThreadLogRecordLocation) => void | false,
    after?: ThreadLogScanCursor,
  ): ThreadLogRead {
    let header = after?.header;
    const events: ThreadLogEvent[] = [];
    let lineIndex = after === undefined ? 0 : 1;
    let completedByteCount = after?.offset ?? 0;
    let lastSequence = after?.sequence ?? 0;
    const descriptor = openSync(logPath, "r+");
    const parseLine = (rawLine: string, recoverableFinalLine: boolean): boolean => {
      let value: unknown;
      try {
        value = JSON.parse(rawLine);
      } catch (error) {
        if (!recoverableFinalLine) throw error;
        ftruncateSync(descriptor, completedByteCount);
        return false;
      }
      if (lineIndex === 0) {
        header = threadLogHeaderSchema.parse(value);
        if (header.conversationId !== conversationId) {
          throw new Error("ThreadLog header conversationId does not match its filename.");
        }
      } else {
        const event = threadLogEventSchema.parse(value);
        if (event.conversationId !== conversationId) {
          throw new Error("ThreadLog event conversationId does not match its filename.");
        }
        const expectedSequence = lastSequence + 1;
        if (event.sequence !== expectedSequence) {
          throw new Error(`ThreadLog event sequence must be ${expectedSequence}.`);
        }
        lastSequence = event.sequence;
        if (visit === undefined) events.push(event);
        else if (visit(event, { offset: completedByteCount, length: Buffer.byteLength(rawLine, "utf8") }) === false) return false;
      }
      lineIndex += 1;
      return true;
    };

    try {
      const chunk = Buffer.allocUnsafe(THREAD_LOG_READ_CHUNK_BYTES);
      let pendingChunks: Buffer[] = [];
      let pendingByteCount = 0;
      let byteCount: number;
      let readPosition = after?.offset ?? 0;
      do {
        byteCount = readSync(descriptor, chunk, 0, chunk.length, readPosition);
        readPosition += byteCount;
        if (byteCount === 0) break;
        const next = Buffer.from(chunk.subarray(0, byteCount));
        let lineStart = 0;
        let newlineIndex = next.indexOf(0x0a, lineStart);
        while (newlineIndex >= 0) {
          const tail = next.subarray(lineStart, newlineIndex);
          const lineByteCount = pendingByteCount + tail.length;
          const rawLine = pendingChunks.length === 0
            ? tail.toString("utf8")
            : Buffer.concat([...pendingChunks, tail], lineByteCount).toString("utf8");
          if (!parseLine(rawLine, false)) {
            if (header === undefined) throw new Error("ThreadLog has no valid header.");
            return { events, header };
          }
          completedByteCount += lineByteCount + 1;
          pendingChunks = [];
          pendingByteCount = 0;
          lineStart = newlineIndex + 1;
          newlineIndex = next.indexOf(0x0a, lineStart);
        }
        if (lineStart < next.length) {
          const tail = Buffer.from(next.subarray(lineStart));
          pendingChunks.push(tail);
          pendingByteCount += tail.length;
        }
      } while (byteCount > 0);
      if (pendingByteCount > 0) {
        parseLine(Buffer.concat(pendingChunks, pendingByteCount).toString("utf8"), true);
      }
    } finally {
      closeSync(descriptor);
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

  private migrateLegacyLayout(): void {
    if (!existsSync(this.conversationsRootPath)) return;
    for (const entry of readdirSync(this.conversationsRootPath, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.endsWith(".jsonl")) continue;
      const conversationId = entry.name.slice(0, -".jsonl".length);
      if (!z.string().uuid().safeParse(conversationId).success) continue;
      const legacyPath = path.join(this.conversationsRootPath, entry.name);
      const targetPath = this.getPath(conversationId);
      mkdirSync(path.dirname(targetPath), { recursive: true, mode: 0o700 });
      if (existsSync(targetPath)) {
        renameSync(legacyPath, `${targetPath}.legacy-${Date.now()}-${randomUUID()}`);
      } else {
        renameSync(legacyPath, targetPath);
      }
    }
  }
}

function touchCacheEntry<K, V>(cache: Map<K, V>, key: K, value: V): void {
  cache.delete(key);
  cache.set(key, value);
}

function setBoundedCacheEntry<K, V>(
  cache: Map<K, V>,
  key: K,
  value: V,
  limit: number,
): void {
  touchCacheEntry(cache, key, value);
  while (cache.size > limit) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) return;
    cache.delete(oldestKey);
  }
}

function isOwnedThreadLogFile(fileName: string): boolean {
  return fileName === "conversation.jsonl"
    || fileName.startsWith("conversation.jsonl.corrupt-")
    || fileName.startsWith("conversation.jsonl.legacy-");
}

// Conservative UTF-16 payload estimate, including per-object/array overhead.
// This bounds retained cache data, not the caller's live request allocation.
function retainedValueBytes(value: unknown): number {
  return JSON.stringify(value).length * 2 + 256;
}

function retainedContextBytes(context: ThreadLogContext): number {
  return context.messages.reduce((sum, message) => sum + retainedValueBytes(message), 0)
    + (context.checkpoint === null ? 0 : retainedValueBytes(context.checkpoint));
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
