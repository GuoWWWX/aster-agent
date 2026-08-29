import {
  AgentDatabase,
  type PreparedConversationCreation,
  type ThreadLogAttachmentPathResolver,
  type ThreadLogLegacySnapshot,
  type ThreadLogProjectionCursor,
} from "./agent-database.js";
import { ThreadLog, type ThreadLogEvent } from "./thread-log.js";
import { conversationAgentBindingSchema, conversationSummarySchema } from "@agent/protocol";
import { z } from "zod";

const conversationCreatedPayloadSchema = z.object({
  agent: conversationAgentBindingSchema.nullable(),
  conversation: conversationSummarySchema,
}).strict();

export type ThreadLogProjectionResult = {
  cursor: ThreadLogProjectionCursor | null;
  projectedEventCount: number;
};

export type ThreadLogProjectionVerification = {
  indexedEventCount: number;
  isConsistent: boolean;
  logEventCount: number;
};

/**
 * Incrementally indexes ThreadLog events in SQLite. Selected write-ahead
 * events first materialize their SQLite view from JSONL; all remaining
 * migration events stay SQLite-first and can still be recovered from rich
 * ThreadLog facts without overwriting live business rows.
 */
export class EventProjector {
  public constructor(
    private readonly database: AgentDatabase,
    private readonly threadLog: ThreadLog,
    private readonly attachmentPathResolver: ThreadLogAttachmentPathResolver | null = null,
  ) {}

  public projectConversation(conversationId: string): ThreadLogProjectionResult {
    const log = this.threadLog.read(conversationId);
    if (log === null) {
      return {
        cursor: this.database.getThreadLogProjectionCursor(conversationId),
        projectedEventCount: 0,
      };
    }
    this.projectConversationCreationIfNeeded(conversationId, log.events);
    if (this.attachmentPathResolver !== null) {
      this.database.projectThreadLogAttachmentReferences(
        conversationId,
        log.events,
        this.attachmentPathResolver,
      );
    }
    this.restoreLegacySnapshotIfPresent(conversationId, log.events);
    this.database.restoreThreadLogBusinessEvents(conversationId, log.events);
    const cursor = this.database.getThreadLogProjectionCursor(conversationId);
    const events = log.events.filter((event) => event.sequence > (cursor?.lastSequence ?? 0));
    // A prior process may have appended a write-ahead event and crashed before
    // its SQLite view or cursor was committed. Re-materialize every unindexed
    // write-ahead event even when older business rows already exist.
    this.database.projectThreadLogBusinessEvents(conversationId, events);
    const nextCursor = this.database.projectThreadLogEvents(conversationId, events);
    return { cursor: nextCursor, projectedEventCount: events.length };
  }

  public projectEvent(
    conversationId: string,
    event: ThreadLogEvent,
  ): ThreadLogProjectionResult {
    if (!this.database.hasConversation(conversationId)) {
      return this.projectConversation(conversationId);
    }
    const cursor = this.database.getThreadLogProjectionCursor(conversationId);
    if (event.sequence !== (cursor?.lastSequence ?? 0) + 1) {
      return this.projectConversation(conversationId);
    }
    const nextCursor = this.database.projectThreadLogEvents(conversationId, [event]);
    return { cursor: nextCursor, projectedEventCount: 1 };
  }

  /**
   * Projects a write-ahead business event after it has been durably appended
   * to JSONL. The event index is advanced only after the SQLite materialized
   * view succeeds, so a later startup can safely retry the same event.
   */
  public projectBusinessEvent(
    conversationId: string,
    event: ThreadLogEvent,
  ): ThreadLogProjectionResult {
    if (!this.database.hasConversation(conversationId)) {
      return this.projectConversation(conversationId);
    }
    const cursor = this.database.getThreadLogProjectionCursor(conversationId);
    if (event.sequence !== (cursor?.lastSequence ?? 0) + 1) {
      return this.projectConversation(conversationId);
    }
    this.database.projectThreadLogBusinessEvents(conversationId, [event]);
    const nextCursor = this.database.projectThreadLogEvents(conversationId, [event]);
    return { cursor: nextCursor, projectedEventCount: 1 };
  }

  public projectAllConversationLogs(): ThreadLogProjectionResult[] {
    const knownConversationIds = this.listKnownConversationIds();
    this.projectMissingConversationCreations(knownConversationIds);
    const pending = new Set(knownConversationIds);
    const results: ThreadLogProjectionResult[] = [];
    let lastError: unknown;
    while (pending.size > 0) {
      let projectedThisPass = 0;
      for (const conversationId of [...pending]) {
        try {
          results.push(this.projectConversation(conversationId));
          pending.delete(conversationId);
          projectedThisPass += 1;
        } catch (error) {
          lastError = error;
        }
      }
      if (projectedThisPass === 0) {
        throw lastError instanceof Error
          ? lastError
          : new Error("ThreadLog recovery could not resolve Conversation dependencies.");
      }
    }
    return results;
  }

  public verifyConversation(conversationId: string): ThreadLogProjectionVerification {
    const logEvents = this.threadLog.read(conversationId)?.events ?? [];
    const indexedEvents = this.database.listProjectedThreadLogEvents(conversationId);
    const isConsistent =
      logEvents.length === indexedEvents.length
      && logEvents.every((event, index) => {
        const indexed = indexedEvents[index];
        return indexed !== undefined
          && event.eventId === indexed.eventId
          && event.sequence === indexed.sequence
          && event.type === indexed.type
          && event.createdAt === indexed.createdAt
          && JSON.stringify(event.payload) === JSON.stringify(indexed.payload);
      });
    return {
      indexedEventCount: indexedEvents.length,
      isConsistent,
      logEventCount: logEvents.length,
    };
  }

  public verifyAllConversationLogs(): ThreadLogProjectionVerification[] {
    return this.listKnownConversationIds()
      .map((conversationId) => this.verifyConversation(conversationId));
  }

  private projectConversationCreationIfNeeded(
    conversationId: string,
    events: readonly ThreadLogEvent[],
  ): boolean {
    if (this.database.hasConversation(conversationId)) return false;
    const created = events[0];
    if (created?.type !== "conversation_created") {
      throw new Error("ThreadLog is missing its required conversation_created event.");
    }
    const payload = conversationCreatedPayloadSchema.parse(created.payload);
    if (payload.conversation.id !== conversationId) {
      throw new Error("ThreadLog conversation_created payload does not match its filename.");
    }
    const creation = {
      agent: payload.agent,
      conversation: payload.conversation,
    } satisfies PreparedConversationCreation;
    this.database.projectConversationCreated(creation);
    return true;
  }

  private restoreLegacySnapshotIfPresent(
    conversationId: string,
    events: readonly ThreadLogEvent[],
  ): void {
    const event = events.find((candidate) => candidate.type === "legacy_snapshot_imported");
    if (event === undefined) return;
    const payload = event.payload as Partial<ThreadLogLegacySnapshot>;
    if (
      !Array.isArray(payload.modelMessages)
      || !Array.isArray(payload.runs)
      || !Array.isArray(payload.timeline)
      || !(payload.checkpoint === null || typeof payload.checkpoint === "object")
    ) {
      throw new Error("ThreadLog legacy snapshot payload is invalid.");
    }
    this.database.restoreThreadLogLegacySnapshot(conversationId, {
      checkpoint: payload.checkpoint,
      modelMessages: payload.modelMessages,
      runs: payload.runs,
      timeline: payload.timeline,
    });
  }

  private listKnownConversationIds(): string[] {
    const projectableConversationIds = this.database.listProjectableConversationIds();
    const projectableIdSet = new Set(projectableConversationIds);
    const persistedConversationIds = new Set(this.database.listAllConversationIds());
    return [...new Set([
      ...projectableConversationIds,
      ...this.threadLog.listConversationIds().filter((conversationId) =>
        !persistedConversationIds.has(conversationId) || projectableIdSet.has(conversationId),
      ),
    ])].sort();
  }

  /** Resolve all Conversation metadata first so cross-thread Agent messages can
   * be restored without depending on filesystem enumeration order. */
  private projectMissingConversationCreations(conversationIds: readonly string[]): void {
    const pending = new Set(conversationIds.filter((conversationId) => !this.database.hasConversation(conversationId)));
    let lastError: unknown;
    while (pending.size > 0) {
      let projectedThisPass = 0;
      for (const conversationId of [...pending]) {
        const log = this.threadLog.read(conversationId);
        if (log === null) {
          pending.delete(conversationId);
          continue;
        }
        try {
          this.projectConversationCreationIfNeeded(conversationId, log.events);
          pending.delete(conversationId);
          projectedThisPass += 1;
        } catch (error) {
          lastError = error;
        }
      }
      if (projectedThisPass === 0) {
        throw lastError instanceof Error
          ? lastError
          : new Error("ThreadLog recovery could not create Conversation metadata.");
      }
    }
  }
}
