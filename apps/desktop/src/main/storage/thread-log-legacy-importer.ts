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
    for (const conversationId of this.database.listProjectableConversationIds()) {
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
    for (const conversationId of this.database.listProjectableConversationIds()) {
      if (this.eventProjector.isConversationProjectionCurrent(conversationId)) continue;
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
    const creation = this.threadLog.readFirstEvent(conversationId, "conversation_created");
    if (creation !== null
      && this.threadLog.readFirstEvent(conversationId, "legacy_snapshot_imported") !== null) return false;
    const snapshot = this.database.exportThreadLogLegacySnapshot(conversationId);
    if (creation === null) this.threadLog.append(conversationId, {
      payload: {
        agent: snapshot.agent,
        conversation: snapshot.conversation,
      },
      type: "conversation_created",
    });
    this.threadLog.append(conversationId, {
      payload: {
        agentMessages: snapshot.agentMessages,
        attachmentRefs: snapshot.attachmentRefs,
        checkpoint: snapshot.checkpoint,
        importedAt: new Date().toISOString(),
        modelMessages: snapshot.modelMessages,
        pendingMessages: snapshot.pendingMessages,
        runs: snapshot.runs,
        subagentTasks: snapshot.subagentTasks,
        taskList: snapshot.taskList,
        timeline: snapshot.timeline,
        turnSummaries: snapshot.turnSummaries,
      },
      type: "legacy_snapshot_imported",
    });
    this.eventProjector.projectConversation(conversationId);
    return true;
  }

}
