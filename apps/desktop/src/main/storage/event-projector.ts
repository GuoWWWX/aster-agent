import {
  AgentDatabase,
  type PreparedConversationCreation,
  type ThreadLogAttachmentPathResolver,
  type ThreadLogLegacySnapshot,
  type ThreadLogProjectionCursor,
} from "./agent-database.js";
import {
  ThreadLog,
  type ThreadLogEvent,
  type ThreadLogRead,
} from "./thread-log.js";
import {
  conversationAgentBindingSchema,
  conversationSummarySchema,
  type ConversationSearchInput,
  type ConversationSearchResult,
} from "@agent/protocol";
import { z } from "zod";
import { setImmediate } from "node:timers/promises";
import { ThreadLogTimeline } from "./thread-log-timeline.js";
import type { ConversationTimelineItem, ConversationTimelinePageInput, ConversationTimelinePage } from "@agent/protocol";

const conversationCreatedPayloadSchema = z.object({
  legacyImport: z.literal(true).optional(),
  agent: conversationAgentBindingSchema.nullable(),
  conversation: conversationSummarySchema,
}).strict();

const HYDRATED_CONVERSATION_HISTORY_LIMIT = 4;

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
 * Rebuilds and incrementally updates the process-local query projection from
 * canonical ThreadLog events. The projection uses SQLite TEMP tables for the
 * existing query surface and is never written to db.sqlite.
 */
export class EventProjector {
  private readonly hydratedConversationIds = new Map<string, true>();
  private readonly timeline: ThreadLogTimeline;

  public constructor(
    private readonly database: AgentDatabase,
    private readonly threadLog: ThreadLog,
    private readonly attachmentPathResolver: ThreadLogAttachmentPathResolver | null = null,
  ) { this.timeline = new ThreadLogTimeline(threadLog); }

  public listTimelinePage(input: ConversationTimelinePageInput): ConversationTimelinePage {
    this.database.getConversation(input.conversationId);
    return this.timeline.page(input);
  }

  public async prepareTimeline(conversationId: string): Promise<void> {
    this.database.getConversation(conversationId);
    await this.timeline.warm(conversationId);
  }

  public listTimeline(conversationId: string): ConversationTimelineItem[] {
    this.database.getConversation(conversationId);
    return [...this.timeline.messages(conversationId)].reverse().map(({ item }) => item);
  }

  public projectConversation(conversationId: string): ThreadLogProjectionResult {
    const log = this.threadLog.read(conversationId);
    if (log === null) {
      if (
        this.database.hasConversation(conversationId)
        && this.database.getThreadLogProjectionCursor(conversationId) !== null
      ) {
        this.database.resetThreadLogProjection(conversationId);
      }
      return {
        cursor: this.database.getThreadLogProjectionCursor(conversationId),
        projectedEventCount: 0,
      };
    }
    const result = this.projectConversationFromLog(conversationId, log);
    if (!this.verifyConversationEvents(conversationId, log.events).isConsistent) {
      throw new Error("ThreadLog event index is inconsistent with its JSONL source.");
    }
    const current = this.markProjectionCurrent(conversationId, result);
    this.touchHydratedConversation(conversationId);
    return current;
  }

  /** Rehydrate an evicted timeline only when a caller actually needs it. */
  public ensureConversationHistoryProjected(conversationId: string): void {
    if (this.hydratedConversationIds.has(conversationId)) {
      this.touchHydratedConversation(conversationId);
      return;
    }
    if (this.database.getConversation(conversationId).activeRunId !== null) {
      // Active histories were never eligible for startup/LRU eviction. Mark a
      // conversation first seen through a live event without resetting state
      // that may not yet have reached its next JSONL audit event.
      this.touchHydratedConversation(conversationId);
      return;
    }
    this.database.clearVolatileConversationHistory(conversationId);
    this.projectConversation(conversationId);
    this.evictExcessConversationHistories(conversationId);
  }

  /** Keep startup state small; old pages are restored on first access. */
  public releaseInactiveConversationHistories(): void {
    for (const conversationId of this.database.listAllConversationIds()) {
      const conversation = this.database.getConversation(conversationId);
      if (conversation.activeRunId !== null) continue;
      this.database.clearVolatileConversationHistory(conversationId);
      this.hydratedConversationIds.delete(conversationId);
    }
  }

  public async searchConversations(input: ConversationSearchInput): Promise<ConversationSearchResult[]> {
    const conversationIds = input.conversationId === undefined
      ? this.database.listProjectableConversationIds()
      : [input.conversationId];
    const matches: ConversationSearchResult[] = [];
    const needle = input.query.toLocaleLowerCase();
    for (const conversationId of conversationIds) {
      const conversation = this.database.getConversation(conversationId);
      if (conversation.isArchived) continue;
      await this.timeline.warm(conversationId);
      let count = 0;
      let visited = 0;
      for (const { item, sequence } of this.timeline.messages(conversationId, input.beforeSequence, true)) {
        if (++visited % 64 === 0) await setImmediate();
        if (item.kind !== "message" && item.kind !== "agent_message") continue;
        const position = item.content.toLocaleLowerCase().indexOf(needle);
        if (position < 0) continue;
        const start = Math.max(0, position - 100);
        matches.push({
          content: item.content.slice(start, start + 320),
          conversationId, conversationTitle: conversation.title,
          createdAt: item.createdAt, itemId: item.id,
          parentConversationId: conversation.parentConversationId,
          projectId: conversation.projectId,
          role: item.kind === "agent_message" ? "agent" : item.role,
          sequence, threadKind: conversation.threadKind,
        });
        if (++count >= input.limit) break;
      }
      matches.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
      matches.length = Math.min(matches.length, input.limit);
    }
    return matches
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, input.limit);
  }

  public isConversationProjectionCurrent(conversationId: string): boolean {
    if (!this.database.hasConversation(conversationId)) return false;
    const cursor = this.database.getThreadLogProjectionCursor(conversationId);
    const source = this.threadLog.getSourceSignature(conversationId);
    return cursor !== null
      && source !== null
      && cursor.sourceSizeBytes === source.sizeBytes
      && cursor.sourceModifiedAtMs === source.modifiedAtMs;
  }

  private projectConversationFromLog(
    conversationId: string,
    log: ThreadLogRead,
  ): ThreadLogProjectionResult {
    this.resetStaleProjectionIfNeeded(conversationId, log.events);
    this.projectConversationCreationIfNeeded(conversationId, log.events);
    if (this.attachmentPathResolver !== null) {
      this.database.projectThreadLogAttachmentReferences(
        conversationId,
        log.events,
        this.attachmentPathResolver,
      );
    }
    this.restoreLegacySnapshotIfPresent(conversationId, log.events);
    this.database.restoreThreadLogConversationProperties(conversationId, log.events);
    const importedSequence = log.events.find((event) => event.type === "legacy_snapshot_imported")?.sequence ?? 0;
    const businessEvents = importedSequence === 0 ? log.events : log.events.filter((event) => event.sequence > importedSequence);
    const restored = this.database.restoreThreadLogBusinessEvents(conversationId, businessEvents,
      importedSequence > 0 && this.database.getThreadLogProjectionCursor(conversationId) === null);
    const cursor = this.database.getThreadLogProjectionCursor(conversationId);
    const events = log.events.filter((event) => event.sequence > (cursor?.lastSequence ?? 0));
    // A prior process may have appended a write-ahead event and crashed before
    // its volatile view or cursor was updated. Re-materialize every unindexed
    // write-ahead event even when older business rows already exist.
    if (!restored) this.database.projectThreadLogBusinessEvents(conversationId, events.filter((event) => event.sequence > importedSequence));
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
    const source = this.threadLog.getSourceSignature(conversationId) ?? undefined;
    const nextCursor = this.database.projectThreadLogEvents(conversationId, [event], source);
    this.touchHydratedConversation(conversationId);
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
    const source = this.threadLog.getSourceSignature(conversationId) ?? undefined;
    const nextCursor = this.database.projectThreadLogEvents(conversationId, [event], source);
    this.touchHydratedConversation(conversationId);
    return { cursor: nextCursor, projectedEventCount: 1 };
  }

  public projectAllConversationLogs(options: { releaseHistory?: boolean } = {}): ThreadLogProjectionResult[] {
    const knownConversationIds = this.listKnownConversationIds();
    this.projectMissingConversationCreations(knownConversationIds);
    const pending = new Set(knownConversationIds);
    const results: ThreadLogProjectionResult[] = [];
    let lastError: unknown;
    while (pending.size > 0) {
      let projectedThisPass = 0;
      for (const conversationId of [...pending]) {
        try {
          if (options.releaseHistory === true) {
            results.push(this.projectStartupConversation(conversationId));
            pending.delete(conversationId);
            projectedThisPass += 1;
            continue;
          }
          if (this.isConversationProjectionCurrent(conversationId)) {
            results.push({
              cursor: this.database.getThreadLogProjectionCursor(conversationId),
              projectedEventCount: 0,
            });
            pending.delete(conversationId);
            projectedThisPass += 1;
            continue;
          }
          const log = this.threadLog.read(conversationId);
          if (log === null) {
            if (
              this.database.hasConversation(conversationId)
              && this.database.getThreadLogProjectionCursor(conversationId) !== null
            ) {
              this.database.resetThreadLogProjection(conversationId);
            }
            results.push({
              cursor: this.database.getThreadLogProjectionCursor(conversationId),
              projectedEventCount: 0,
            });
          } else {
            const result = this.projectConversationFromLog(conversationId, log);
            if (!this.verifyConversationEvents(conversationId, log.events).isConsistent) {
              throw new Error("ThreadLog event index is inconsistent with its JSONL source.");
            }
            results.push(this.markProjectionCurrent(conversationId, result));
            this.touchHydratedConversation(conversationId);
          }
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

  /** Startup reads bounded event batches, releasing each inactive history immediately. */
  private projectStartupConversation(conversationId: string): ThreadLogProjectionResult {
    this.database.resetThreadLogProjection(conversationId);
    const candidate = this.threadLog.readLatestStateCheckpoint(conversationId);
    const checkpoint = candidate !== null && this.database.canRestoreThreadLogStartupState(conversationId, candidate.event)
      ? candidate : null;
    if (checkpoint !== null) {
      if (this.attachmentPathResolver !== null) this.database.projectThreadLogAttachmentReferences(
        conversationId, [checkpoint.event], this.attachmentPathResolver,
      );
      this.database.restoreThreadLogStartupState(conversationId, checkpoint.event);
    }
    let batch: ThreadLogEvent[] = [];
    let bytes = 0;
    let count = 0;
    const importedSequence = checkpoint === null
      ? this.threadLog.readFirstEvent(conversationId, "legacy_snapshot_imported")?.sequence ?? 0 : 0;
    const flush = () => {
      if (batch.length === 0) return;
      if (this.attachmentPathResolver !== null) {
        this.database.projectThreadLogAttachmentReferences(conversationId, batch, this.attachmentPathResolver);
      }
      this.restoreLegacySnapshotIfPresent(conversationId, batch);
      const business = batch.filter((event) => event.type !== "legacy_snapshot_imported"
        && event.sequence > importedSequence);
      this.database.restoreThreadLogConversationProperties(conversationId, business);
      this.database.restoreThreadLogBusinessEvents(conversationId, business, true);
      this.database.projectThreadLogEvents(conversationId, batch);
      count += batch.length;
      batch = [];
      bytes = 0;
    };
    this.threadLog.scan(conversationId, (event, location) => {
      // A legacy snapshot is a complete historical baseline. Keep it separate
      // so following events cannot be skipped by snapshot precedence.
      if (event.type === "legacy_snapshot_imported") flush();
      batch.push(event);
      bytes += location.length;
      if (event.type === "legacy_snapshot_imported" || batch.length >= 128 || bytes >= 1_048_576) flush();
    }, checkpoint?.cursor);
    flush();
    const result = this.markProjectionCurrent(conversationId, {
      cursor: this.database.getThreadLogProjectionCursor(conversationId), projectedEventCount: count,
    });
    if (this.database.getConversation(conversationId).activeRunId === null) {
      this.database.clearVolatileConversationHistory(conversationId);
      this.hydratedConversationIds.delete(conversationId);
    } else this.touchHydratedConversation(conversationId);
    return result;
  }

  /** Append compact restart state in the canonical log, never a separate index file. */
  public checkpointInactiveConversations(): void {
    for (const id of this.listKnownConversationIds()) {
      const state = this.database.exportThreadLogStartupState(id);
      if (state === null) continue;
      const serialized = JSON.stringify(state);
      // Large collaboration/attachment registries stay on the streaming path.
      if (Buffer.byteLength(serialized, "utf8") > 1_048_576) continue;
      const previous = this.threadLog.readLatestStateCheckpoint(id);
      if (previous !== null && JSON.stringify(previous.event.payload) === serialized) continue;
      this.threadLog.append(id, { type: "state_checkpoint", payload: state });
    }
  }

  public verifyConversation(conversationId: string): ThreadLogProjectionVerification {
    const logEvents = this.threadLog.read(conversationId)?.events ?? [];
    return this.verifyConversationEvents(conversationId, logEvents);
  }

  private verifyConversationEvents(
    conversationId: string,
    logEvents: readonly ThreadLogEvent[],
  ): ThreadLogProjectionVerification {
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

  private markProjectionCurrent(
    conversationId: string,
    result: ThreadLogProjectionResult,
  ): ThreadLogProjectionResult {
    if (result.cursor === null) return result;
    const source = this.threadLog.getSourceSignature(conversationId);
    if (source === null) return result;
    return {
      cursor: this.database.markThreadLogProjectionCurrent(conversationId, source),
      projectedEventCount: result.projectedEventCount,
    };
  }

  private touchHydratedConversation(conversationId: string): void {
    this.hydratedConversationIds.delete(conversationId);
    this.hydratedConversationIds.set(conversationId, true);
  }

  private evictExcessConversationHistories(protectedConversationId: string): void {
    while (this.hydratedConversationIds.size > HYDRATED_CONVERSATION_HISTORY_LIMIT) {
      const candidate = this.hydratedConversationIds.keys().next().value;
      if (candidate === undefined) return;
      this.hydratedConversationIds.delete(candidate);
      if (candidate === protectedConversationId) {
        this.touchHydratedConversation(candidate);
        continue;
      }
      if (this.database.getConversation(candidate).activeRunId !== null) continue;
      this.database.clearVolatileConversationHistory(candidate);
    }
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
    const created = events.find((event) => event.type === "conversation_created");
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

  private resetStaleProjectionIfNeeded(
    conversationId: string,
    events: readonly ThreadLogEvent[],
  ): void {
    if (!this.database.hasConversation(conversationId)) return;
    const cursor = this.database.getThreadLogProjectionCursor(conversationId);
    if (cursor === null) return;
    const firstEvent = events[0];
    const indexedFirstEventId = this.database.getProjectedThreadLogEventId(conversationId, 1);
    const indexedTail = events[cursor.lastSequence - 1];
    if (
      firstEvent?.eventId === indexedFirstEventId
      && indexedTail?.eventId === cursor.lastEventId
    ) return;
    this.database.resetThreadLogProjection(conversationId);
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
      agentMessages: Array.isArray(payload.agentMessages) ? payload.agentMessages : [],
      checkpoint: payload.checkpoint,
      modelMessages: payload.modelMessages,
      pendingMessages: Array.isArray(payload.pendingMessages) ? payload.pendingMessages : [],
      runs: payload.runs,
      subagentTasks: Array.isArray(payload.subagentTasks) ? payload.subagentTasks : [],
      taskList: payload.taskList === undefined ? null : payload.taskList,
      timeline: payload.timeline,
      turnSummaries: Array.isArray(payload.turnSummaries) ? payload.turnSummaries : [],
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
  private projectMissingConversationCreations(
    conversationIds: readonly string[],
  ): void {
    const pending = new Set(conversationIds.filter((conversationId) => !this.database.hasConversation(conversationId)));
    let lastError: unknown;
    while (pending.size > 0) {
      let projectedThisPass = 0;
      for (const conversationId of [...pending]) {
        const creation = this.threadLog.readFirstEvent(conversationId, "conversation_created");
        if (creation === null) {
          throw new Error(`ThreadLog ${conversationId} is missing its required conversation_created event.`);
        }
        try {
          this.projectConversationCreationIfNeeded(conversationId, [creation]);
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
