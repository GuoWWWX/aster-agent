import {
  conversationTimelineItemSchema,
  type ConversationTimelineItem,
  type ConversationTimelinePage,
  type ConversationTimelinePageInput,
} from "@agent/protocol";
import { ThreadLog, type ThreadLogEvent, type ThreadLogRecordLocation, type ThreadLogScanCursor } from "./thread-log.js";
import { setImmediate } from "node:timers/promises";

type Entry = {
  id: string;
  runId: string | null;
  sequence: number;
  location: ThreadLogRecordLocation;
  slot: number;
  patch: Record<string, unknown>;
  kind: ConversationTimelineItem["kind"];
  status: string | undefined;
};
type Index = { signature: string; entries: Entry[]; items: Map<string, Entry>; cursor: ThreadLogScanCursor | null; sequence: number };

/** Keeps record locations, never message bodies, between page requests. */
export class ThreadLogTimeline {
  private readonly indexes = new Map<string, Index>();
  private warmQueue: Promise<void> = Promise.resolve();

  public constructor(private readonly log: ThreadLog) {}

  public warm(conversationId: string): Promise<void> {
    // Do not let concurrent cold builds evict each other's partial progress.
    const operation = this.warmQueue.then(async () => {
      while (this.index(conversationId, 128).signature === "partial") await setImmediate();
    });
    this.warmQueue = operation.catch(() => undefined);
    return operation;
  }

  public page(input: ConversationTimelinePageInput): ConversationTimelinePage {
    const index = this.index(input.conversationId);
    const entries = index.entries;
    let end = input.beforeSequence === undefined ? entries.length : lowerBound(entries, input.beforeSequence);
    let start = Math.max(0, end - input.limit);
    if (input.afterSequence !== undefined) {
      start = lowerBound(entries, input.afterSequence + 1);
      end = Math.min(entries.length, start + input.limit);
    } else if (input.aroundItemId !== undefined) {
      const target = index.items.get(input.aroundItemId);
      if (target === undefined) throw new Error("Conversation timeline item was not found.");
      start = Math.max(0, lowerBound(entries, target.sequence) - Math.floor(input.limit / 2));
      end = Math.min(entries.length, start + input.limit);
    }
    const selected = entries.slice(start, end);
    const read = this.reader(input.conversationId);
    return {
      hasMore: start > 0,
      items: selected.map(read),
      nextBeforeSequence: start > 0 ? selected[0]?.sequence ?? null : null,
      nextAfterSequence: end < entries.length ? selected.at(-1)?.sequence ?? null : null,
    };
  }

  public *messages(conversationId: string, beforeSequence?: number, messagesOnly = false): Generator<{
    item: ConversationTimelineItem; sequence: number;
  }> {
    const entries = this.index(conversationId).entries;
    const read = this.reader(conversationId);
    for (let i = (beforeSequence === undefined ? entries.length : lowerBound(entries, beforeSequence)) - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry !== undefined && messagesOnly && entry.kind !== "message" && entry.kind !== "agent_message") continue;
      if (entry !== undefined) yield { item: read(entry), sequence: entry.sequence };
    }
  }

  private reader(conversationId: string): (entry: Entry) => ConversationTimelineItem {
    let offset = -1;
    let decoded: ConversationTimelineItem[] = [];
    return (entry) => {
      if (offset !== entry.location.offset) {
        decoded = timelineItems(this.log.readRecord(conversationId, entry.location));
        offset = entry.location.offset;
      }
      const item = decoded[entry.slot];
      if (item === undefined || item.id !== entry.id) throw new Error("ThreadLog timeline location is stale.");
      return conversationTimelineItemSchema.parse({ ...item, ...entry.patch });
    };
  }

  private index(conversationId: string, maxRecords = Infinity): Index {
    const source = this.log.getSourceSignature(conversationId);
    const signature = `${source?.sizeBytes}:${source?.modifiedAtMs}`;
    const cached = this.indexes.get(conversationId);
    if (cached?.signature === signature) return cached;
    const incremental = cached?.cursor !== null && cached?.cursor !== undefined
      && source !== null && source.sizeBytes > cached.cursor.offset
      && this.log.canContinueScan(conversationId, cached.cursor);
    const items = incremental ? cached.items : new Map<string, Entry>();
    let sequence = incremental ? cached.sequence : 0;
    const cursor = this.log.scan(conversationId, (event, location) => {
      const removedRun = event.type === "run_superseded" ? event.payload.runId
        : event.type === "run_replaced" || event.type === "user_message_replaced" ? event.payload.previousRunId : undefined;
      if (typeof removedRun === "string") {
        for (const [id, entry] of items) if (entry.runId === removedRun) items.delete(id);
      }
      for (const [slot, item] of timelineItems(event).entries()) {
        const previous = items.get(item.id);
        items.set(item.id, {
          id: item.id, runId: item.runId, sequence: previous?.sequence ?? ++sequence,
          location, slot, patch: {}, kind: item.kind, status: "status" in item ? item.status : undefined,
        });
      }
      if (event.type === "tool_approval_requested" && typeof event.payload.toolId === "string") {
        const entry = items.get(event.payload.toolId);
        if (entry !== undefined) {
          entry.patch.status = "awaiting_approval";
          entry.status = "awaiting_approval";
        }
      }
      if (event.type === "agent_message_read" && typeof event.payload.messageId === "string") {
        const entry = items.get(event.payload.messageId);
        if (entry !== undefined) entry.patch = { status: "read", readAt: event.createdAt };
      }
      if (event.type === "run_terminal" || event.type === "run_finished") {
        for (const entry of items.values()) {
          if (entry.runId === event.payload.runId && entry.kind === "tool" && entry.status === "awaiting_approval") {
            entry.status = "cancelled";
            entry.patch = { status: "cancelled", result: "审批已失效：所属运行已经结束。" };
          }
        }
      }
    }, incremental ? cached.cursor ?? undefined : undefined, maxRecords);
    const partial = cursor !== null && source !== null && cursor.offset < source.sizeBytes;
    const result = {
      signature: partial ? "partial" : signature, cursor, sequence, items,
      entries: partial ? [] : [...items.values()].sort((a, b) => a.sequence - b.sequence),
    };
    this.indexes.delete(conversationId);
    this.indexes.set(conversationId, result);
    while (this.indexes.size > 4) {
      const first = this.indexes.keys().next().value;
      if (first !== undefined) this.indexes.delete(first);
    }
    return result;
  }
}

function lowerBound(entries: Entry[], sequence: number): number {
  let low = 0;
  let high = entries.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if ((entries[middle]?.sequence ?? Infinity) < sequence) low = middle + 1;
    else high = middle;
  }
  return low;
}

function timelineItems(event: ThreadLogEvent): ConversationTimelineItem[] {
  const p = event.payload;
  if (event.type === "legacy_snapshot_imported") {
    return Array.isArray(p.timeline) ? p.timeline.map((item) => conversationTimelineItemSchema.parse(item)) : [];
  }
  const candidate = p.timelineMessage ?? p.message ?? p.tool ?? p.retry;
  const parsed = conversationTimelineItemSchema.safeParse(candidate);
  if (parsed.success) return [parsed.data];
  const isUser = ["run_queued", "run_replaced", "user_message", "user_message_replaced"].includes(event.type);
  const isAssistant = event.type === "assistant_message" || event.type === "run_terminal";
  if ((!isUser && !isAssistant) || typeof p.messageId !== "string" || typeof p.content !== "string") return [];
  if (isAssistant && p.content.length === 0 && typeof p.reasoningContent !== "string") return [];
  return [conversationTimelineItemSchema.parse({
    id: p.messageId, conversationId: event.conversationId, runId: p.runId,
    createdAt: event.createdAt, kind: "message", role: isUser ? "user" : "assistant",
    content: p.content, modelId: isUser ? null : p.modelId,
    status: p.assistantKind === "failure" ? "failed" : p.assistantKind === "cancelled" ? "cancelled" : "completed",
    ...(typeof p.reasoningContent === "string" ? { reasoningContent: p.reasoningContent } : {}),
  })];
}
