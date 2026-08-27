import { AgentDatabase, type ThreadLogLegacySnapshot } from "./agent-database.js";
import { EventProjector } from "./event-projector.js";
import { ThreadLog } from "./thread-log.js";

export type ThreadLogLegacyImportResult = {
  importedConversationIds: string[];
  skippedConversationIds: string[];
};

export type ThreadLogCorruptionRecoveryResult = {
  quarantinedConversationIds: string[];
};

function hasPersistedConversationHistory(snapshot: ThreadLogLegacySnapshot): boolean {
  return snapshot.checkpoint !== null
    || snapshot.modelMessages.length > 0
    || snapshot.runs.length > 0
    || snapshot.timeline.length > 0;
}

/**
 * One-time bridge for SQLite-first conversations. A presence check makes the
 * import O(number of conversations) on first migration and O(1) per existing
 * conversation on later startups.
 */
export class ThreadLogLegacyImporter {
  public constructor(
    private readonly database: AgentDatabase,
    private readonly threadLog: ThreadLog,
    private readonly eventProjector: EventProjector,
  ) {}

  public importMissingConversationLogs(): ThreadLogLegacyImportResult {
    const importedConversationIds: string[] = [];
    const skippedConversationIds: string[] = [];
    const relationConversationIds = this.relationshipConversationIds();
    for (const conversationId of this.database.listAllConversationIds()) {
      if (!this.importConversationIfMissing(conversationId, relationConversationIds.has(conversationId))) {
        skippedConversationIds.push(conversationId);
        continue;
      }
      importedConversationIds.push(conversationId);
    }
    return { importedConversationIds, skippedConversationIds };
  }

  /**
   * A malformed non-terminal JSONL line cannot be replayed safely. Preserve
   * that file, reset only its SQLite-derived index, then seed a replacement
   * log from the durable SQLite history so the Conversation remains usable.
   */
  public recoverUnreadableConversationLogs(): ThreadLogCorruptionRecoveryResult {
    const quarantinedConversationIds: string[] = [];
    const relationConversationIds = this.relationshipConversationIds();
    for (const conversationId of this.database.listAllConversationIds()) {
      try {
        this.threadLog.read(conversationId);
      } catch {
        this.threadLog.quarantine(conversationId);
        this.database.resetThreadLogProjection(conversationId);
        this.importConversationIfMissing(conversationId, relationConversationIds.has(conversationId));
        quarantinedConversationIds.push(conversationId);
      }
    }
    return { quarantinedConversationIds };
  }

  public importConversationIfMissing(conversationId: string, preserveChildRelation = false): boolean {
    if (this.threadLog.hasConversation(conversationId)) return false;
    const snapshot = this.database.exportThreadLogLegacySnapshot(conversationId);
    if (!preserveChildRelation && !hasPersistedConversationHistory(snapshot)) return false;
    this.threadLog.append(conversationId, {
      payload: {
        agent: snapshot.agent,
        conversation: snapshot.conversation,
      },
      type: "conversation_created",
    });
    this.threadLog.append(conversationId, {
      payload: {
        checkpoint: snapshot.checkpoint,
        importedAt: new Date().toISOString(),
        modelMessages: snapshot.modelMessages,
        runs: snapshot.runs,
        timeline: snapshot.timeline,
      },
      type: "legacy_snapshot_imported",
    });
    this.eventProjector.projectConversation(conversationId);
    return true;
  }

  private relationshipConversationIds(): ReadonlySet<string> {
    const relationshipConversationIds = new Set<string>();
    for (const conversationId of this.database.listAllConversationIds()) {
      const parentConversationId = this.database.getConversation(conversationId).parentConversationId;
      if (parentConversationId === null) continue;
      relationshipConversationIds.add(conversationId);
      relationshipConversationIds.add(parentConversationId);
    }
    return relationshipConversationIds;
  }
}
