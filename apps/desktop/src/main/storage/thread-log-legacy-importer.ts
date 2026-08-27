import { AgentDatabase } from "./agent-database.js";
import { EventProjector } from "./event-projector.js";
import { ThreadLog } from "./thread-log.js";

export type ThreadLogLegacyImportResult = {
  importedConversationIds: string[];
  skippedConversationIds: string[];
};

export type ThreadLogCorruptionRecoveryResult = {
  quarantinedConversationIds: string[];
};

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
    for (const conversationId of this.database.listAllConversationIds()) {
      if (!this.importConversationIfMissing(conversationId)) {
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
    for (const conversationId of this.database.listAllConversationIds()) {
      try {
        this.threadLog.read(conversationId);
      } catch {
        this.threadLog.quarantine(conversationId);
        this.database.resetThreadLogProjection(conversationId);
        this.importConversationIfMissing(conversationId);
        quarantinedConversationIds.push(conversationId);
      }
    }
    return { quarantinedConversationIds };
  }

  public importConversationIfMissing(conversationId: string): boolean {
    if (this.threadLog.hasConversation(conversationId)) return false;
    const snapshot = this.database.exportThreadLogLegacySnapshot(conversationId);
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
}
