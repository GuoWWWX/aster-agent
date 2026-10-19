import { ConversationRunEventRepository, RUN_STATUS_TRANSITIONS, prepareAssistantTurn, prepareAssistantFailure } from "./conversation-run-event-repository.js";
import { ConversationAttachmentMetadataRepository } from "./conversation-attachment-metadata-repository.js";
import { TeamCollaborationProjectionReader } from "./team-collaboration-projection-reader.js";
import { ContextSummaryRepository } from "./context-summary-repository.js";
import { ConversationHistoryRepository } from "./conversation-history-repository.js";
import { migrateAgentDatabaseSchema } from "./agent-schema-migrations.js";
import { quoteSqliteIdentifier } from "./sqlite-schema-identifiers.js";
import { createVolatileConversationProjectionSchema } from "./conversation-projection-schema.js";
import { randomUUID } from "node:crypto";
import { imageGenerationResultSchema } from "@agent/protocol";
import { UserQuestionProjection } from "./user-question-projection.js";
import { type UserQuestion } from "@agent/protocol";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { CollaborationStore } from "./collaboration-store.js";
import { TeamChatJournal } from "./team-chat-journal.js";
import { z } from "zod";
import { agentAvatarIconSchema, addTeamWorkItemCommentInputSchema, deleteTeamWorkItemInputSchema, agentDirectoryConfigurationSchema, conversationAgentBindingSchema, conversationModelSelectionSchema, conversationAgentMessageItemSchema, conversationMessageItemSchema, conversationModelRetryItemSchema, conversationPendingMessageSchema, conversationPermissionModeSchema, conversationRunStatusSchema, conversationSearchInputSchema, conversationSearchResponseSchema, sendConversationMessageInputSchema, conversationSummarySchema, conversationTaskListSchema, conversationTimelineItemSchema, conversationToolItemSchema, projectSummarySchema, createTeamInstanceInputSchema, listTeamInstancesInputSchema, renameTeamInstanceInputSchema, setTeamInstanceArchivedInputSchema, submitTeamWorkItemInputSchema, updateTeamWorkItemInputSchema, updateTeamWorkItemPermissionInputSchema, teamWorkItemEventSchema, teamWorkItemExecutionViewSchema, teamWorkItemViewSchema, setTeamCollaborationPlanInputSchema, teamInstanceViewSchema, conversationAttachmentSchema, type AcceptTeamWorkItemInput, type AddTeamWorkItemCommentInput, type DeleteTeamWorkItemInput, type AgentDirectoryConfiguration, type ConversationAttachment, type ConversationAgentMessageItem, type ConversationMessageItem, type ConversationModelRetryItem, type ConversationModelSelection, type ConversationPendingMessage, type ConversationRunStatus, type ConversationRunFileChange, type ConversationSearchInput, type ConversationSearchResult, type ConversationAgentBinding, type ConversationSummary, type ConversationTask, type ConversationTaskList, type ConversationTimelineItem, type ConversationTimelinePage, type ConversationTimelinePageInput, type ConversationToolItem, type CreateConversationInput, type CreateTeamInstanceInput, type ListTeamInstancesInput, type ProjectSummary, type RenameTeamInstanceInput, type SendConversationMessageInput, type SubmitTeamWorkItemInput, type UpdateTeamWorkItemInput, type UpdateTeamWorkItemPermissionInput, type TeamWorkItemEvent, type TeamWorkItemExecutionView, type TeamWorkItemStatus, type TeamWorkItemView, type TeamInstanceView, type SetTeamCollaborationPlanInput, type TeamCollaborationProjection } from "@agent/protocol";
import type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";
import { conversationPropertiesChangedPayloadSchema, conversationMutablePropertiesSchema, type ConversationPropertiesChangedPayload } from "./conversation-properties-event.js";
import { type StoredModelMessage, type StoredConversationAttachment, type ConversationAttachmentStoragePaths, type StoredPendingMessage, type CancelledPendingMessageAttachmentCleanup, type PreparedPendingMessage, type PreparedPendingMessageConsumption, type StoredContextMessage, type ConversationContextCheckpoint, type ConversationTurnSummary, conversationTurnSummarySchema, type ThreadLogProjectionEvent, type ThreadLogProjectionCursor, type ThreadLogAttachmentPathResolver, type TeamDirectoryRecord, type TeamMemberRecord, type PreparedConversationCreation, type ThreadLogLegacySnapshot, type ThreadLogLegacyRun, type ConversationDeletionTask, type SendAgentMessageInput, type SubagentTask, type RunCreation, type PreparedRunWithUserMessage, type PreparedLatestUserMessageReplacement, type CompleteRunInput, threadLogSubagentTaskSchema, threadLogPendingMessagesSchema, threadLogStartupStateSchema, type CompletedRun, runExecutionSnapshotSchema, type RunExecutionSnapshot, type QueuedRunRecovery, type LatestUserMessageReplacementSource, type ReplaceLatestUserMessageInput, type UserTimelineRecord, type UserModelMessageRecord, type AgentMessageRunCreation } from "./conversation-storage-contracts.js";
import { runFileChangesFromTool, agentMessageModelContent, subagentResultSummaryContent } from "./agent-message-content.js";
import { type DatabaseRow, asString, asNullableString, asBoolean, asNumber, parseJson, parseStoredStringArray } from "./database-row.js";
import { collaborationOutputExcerpt } from "./collaboration-row-mappers.js";
import { likePattern, conversationSearchSnippet } from "./context-search.js";
import { readProjectionString, readProjectionIsoDate, readProjectionTimelineMessage, readProjectionTool, readProjectionAgentMessage, readProjectionToolCalls, readProjectionProviderState, threadLogUserMessage, threadLogTerminalAssistant } from "./thread-log-projection-readers.js";
import { toConversationDeletionTask, toConversation, toSubagentTask, toProject, toStoredPendingMessage, toPublicConversationAttachment } from "./conversation-row-mappers.js";

export type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";

const toolScreenshotPayloadSchema = z.object({ ok: z.literal(true), value: z.object({ image: conversationAttachmentSchema }).passthrough() });

function toolGeneratedImages(item: ConversationTimelineItem): ConversationAttachment[] {
  if (item.kind !== "tool" || item.name !== "generate_images" || item.result === null) return [];
  try {
    const result = imageGenerationResultSchema.safeParse(JSON.parse(item.result));
    return result.success ? result.data.value.images.filter(image => image.source === "generated" && image.conversationId === item.conversationId && image.messageId === item.id) : [];
  } catch { return []; }
}

function toolScreenshotImage(item: ConversationTimelineItem): ConversationAttachment | null {
  if (item.kind !== "tool" || (item.name !== "browser_control" && item.name !== "computer_use") || item.result === null) return null;
  try {
    const result = toolScreenshotPayloadSchema.safeParse(JSON.parse(item.result));
    if (!result.success) return null;
    const image = result.data.value.image;
    const source = item.name === "computer_use" ? "computer" : "browser";
    return image.source === source && image.conversationId === item.conversationId && image.messageId === item.id ? image : null;
  } catch { return null; }
}

function remapToolScreenshot(item: ConversationToolItem, conversationId: string, toolId: string, ids: Map<string, string>): string {
  const result = toolScreenshotPayloadSchema.parse(JSON.parse(item.result!));
  const id = ids.get(result.value.image.id);
  if (id === undefined) throw new Error("Forked browser image could not be mapped.");
  return JSON.stringify({ ...result, value: { ...result.value, image: { ...result.value.image, id, conversationId, messageId: toolId } } });
}

type TaskListTaskInput = Pick<ConversationTask, "status" | "title"> & {
  reason?: ConversationTask["reason"] | undefined;
};

const RUNNING_STATUSES = ["queued", "running"] as const;

type SqliteModule = typeof import("node:sqlite");

type SqliteDatabase = InstanceType<SqliteModule["DatabaseSync"]>;

const JSONL_CONVERSATION_STORAGE_IMPORT_KIND = "jsonl-conversation-storage";

const JSONL_CONVERSATION_STORAGE_IMPORT_IDENTITY = "conversation-jsonl-v1";

const PERSISTED_CONVERSATION_TABLES = [
  "conversation_timeline_search",
  "model_message_search",
  "thread_log_projection_cursors",
  "thread_log_event_index",
  "conversation_turn_summaries",
  "conversation_context_checkpoints",
  "subagent_tasks",
  "conversation_agent_messages",
  "conversation_task_lists",
  "conversation_attachments",
  "conversation_pending_messages",
  "model_messages",
  "conversation_timeline",
  "runs",
  "conversations",
] as const;

const TEAM_TABLES_WITH_CONVERSATION_REFERENCES = [
  "teams",
  "team_work_items",
  "team_execution_conversations",
  "team_member_conversations",
  "team_work_item_member_assignments",
  "team_instances",
  "team_collaboration_plans",
  "team_collaboration_plan_nodes",
  "team_work_item_collaboration_outputs",
] as const;

function terminalReceiptSummary(result: string | null): string | null {
  if (result === null || result.length <= 1_000) return result;
  return `${result.slice(0, 920)}\n[总结已截断；完整输出保留在本轮 JSONL，可按 runId 读取]`;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Keep this builtin dynamic so tsup does not drop the `node:` prefix in CJS.
const requireNodeBuiltin = createRequire(__filename);

const { DatabaseSync } = requireNodeBuiltin("node:sqlite") as SqliteModule;

function teamExecutionScopeKey(projectId: string | null, sourceConversationId: string | null): string {
  return sourceConversationId === null
    ? projectId === null ? "global" : `project:${projectId}`
    : `conversation:${sourceConversationId}`;
}

function serializeRunExecutionSnapshot(
  snapshot: RunExecutionSnapshot | undefined,
): string | null {
  if (snapshot === undefined) return null;
  return JSON.stringify(runExecutionSnapshotSchema.parse(snapshot));
}

function parseRunExecutionSnapshot(
  value: string | null,
): RunExecutionSnapshot | null {
  if (value === null) return null;
  return runExecutionSnapshotSchema.parse(
    parseJson<unknown>(value, "Run execution snapshot"),
  );
}

const teamWorkItemExecutionTreeCte = `WITH RECURSIVE team_execution_tree(work_item_id, conversation_id) AS (
  SELECT id, execution_conversation_id
  FROM team_work_items
  WHERE execution_conversation_id IS NOT NULL
  UNION
  SELECT team_execution_tree.work_item_id, team_member_conversations.conversation_id
  FROM team_execution_tree
  JOIN team_member_conversations
    ON team_member_conversations.team_execution_conversation_id = team_execution_tree.conversation_id
  UNION
  SELECT team_execution_tree.work_item_id, subagent_tasks.child_conversation_id
  FROM team_execution_tree
  JOIN subagent_tasks
    ON subagent_tasks.parent_conversation_id = team_execution_tree.conversation_id
), team_execution_tree_projection AS (
  SELECT team_execution_tree.conversation_id,
    (
      SELECT candidate.work_item_id
      FROM team_execution_tree AS candidate
      JOIN team_work_items AS candidate_work_item
        ON candidate_work_item.id = candidate.work_item_id
      WHERE candidate.conversation_id = team_execution_tree.conversation_id
      ORDER BY CASE candidate_work_item.status
        WHEN 'running' THEN 0
        WHEN 'reviewing' THEN 1
        WHEN 'waiting_user' THEN 2
        WHEN 'planned' THEN 3
        WHEN 'queued' THEN 4
        ELSE 5
      END,
      candidate_work_item.updated_at DESC,
      candidate_work_item.rowid DESC
      LIMIT 1
    ) AS work_item_id
  FROM team_execution_tree
  GROUP BY team_execution_tree.conversation_id
)`;

export class AgentDatabase {
  private readonly userQuestions = new UserQuestionProjection();
  private readonly projectionCursors = new Map<string, ThreadLogProjectionCursor>();
  private readonly executionPaused = new Set<string>();
  private readonly terminalResults = new Map<string, string | null>();
  private readonly taskLists = new Map<string, ConversationTaskList>();
  private taskListRollback: Map<string, ConversationTaskList | undefined> | null = null;
  private readonly projectionEvents = new Map<string, ThreadLogProjectionEvent[]>();
  private readonly projectionEventOwners = new Map<string, string>();
  private readonly database: SqliteDatabase;
  private readonly history: ConversationHistoryRepository;
  private readonly contextSummaries: ContextSummaryRepository;
  private readonly collaborationProjection: TeamCollaborationProjectionReader;
  private readonly attachmentMetadata: ConversationAttachmentMetadataRepository;
  private readonly runEvents: ConversationRunEventRepository;
  private readonly databasePath: string;
  private volatileConversationProjectionActive = false;
  public readonly collaboration: CollaborationStore;

  public constructor(databasePath: string, teamChatJournal?: TeamChatJournal) {
    this.databasePath = databasePath;
    this.database = new DatabaseSync(databasePath);
    this.history = new ConversationHistoryRepository(this.database);
    this.contextSummaries = new ContextSummaryRepository(this.database);
    this.collaborationProjection = new TeamCollaborationProjectionReader(this.database);
    this.attachmentMetadata = new ConversationAttachmentMetadataRepository(this.database);
    this.runEvents = new ConversationRunEventRepository(this.database);
    this.database.exec("PRAGMA foreign_keys = ON;");
    if (databasePath !== ":memory:") {
      this.database.exec("PRAGMA journal_mode = WAL;");
    }
    try {
      migrateAgentDatabaseSchema(this.database, () => this.isJsonlConversationStorageFinalized());
      this.collaboration = new CollaborationStore(this.database, {
        conversation: id => this.getConversation(id), team: id => this.getTeamInstance(id),
        teamForConversation: id => this.getTeamInstanceForConversation(id),
        members: id => {
          const roots = this.database.prepare("SELECT conversation_id FROM team_execution_conversations WHERE team_instance_id = ?").all(id);
          const ids = new Set(roots.map(row => String(row.conversation_id)));
          const main = this.getTeamInstance(id).rootConversationId; if (main !== null) ids.add(main);
          return [...ids].flatMap(root => [this.getConversation(root), ...this.listTeamMemberConversations(root)]);
        }, binding: id => this.getConversationAgentBinding(id),
        sourceExists: source => this.listTimeline(source.containerId).some(item => item.id === source.messageId),
        message: (conversationId, messageId) => {
          const message = this.getTimelineItem(conversationId, messageId);
          return message?.kind === "message" ? { content: message.content, role: message.role, createdAt: message.createdAt } : null;
        },
        outcome: (id, runId) => this.getConversationRunOutcome(id, runId),
        isExecutionPaused: id => this.isConversationExecutionPaused(id),
      }, teamChatJournal ?? new TeamChatJournal(databasePath === ":memory:" ? null : path.join(path.dirname(databasePath), "team-chats")));
      if (this.isJsonlConversationStorageFinalized()) {
        this.activateVolatileConversationProjection();
      }
      this.interruptUnfinishedRuns();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  public close(): void {
    this.userQuestions.clear();
    this.database.close();
    this.executionPaused.clear();
    this.terminalResults.clear();
    this.projectionCursors.clear();
    this.taskLists.clear();
    this.projectionEvents.clear();
    this.projectionEventOwners.clear();
  }

  public isOpen(): boolean { return this.database.isOpen; }

  public listUserQuestions(conversationId?: string): UserQuestion[] {
    return this.userQuestions.list(conversationId).filter((question) =>
      this.hasConversation(question.displayConversationId) && this.hasConversation(question.conversationId));
  }
  public getUserQuestion(id: string): UserQuestion {
    const question = this.userQuestions.get(id);
    this.getConversation(question.conversationId);
    this.getConversation(question.displayConversationId);
    return question;
  }
  public wasUserQuestionAnswerDelivered(id: string, conversationId: string): boolean {
    return this.userQuestions.wasDelivered(id, conversationId);
  }
  public applyUserQuestionProjectionEvent(conversationId: string, event: { type: string; payload: Record<string, unknown> }): void {
    this.userQuestions.apply(conversationId, event);
  }

  /**
   * Conversation JSONL files are the only durable source after finalization.
   * These TEMP tables are a process-local query projection and disappear when
   * the database connection closes; db.sqlite never receives subsequent
   * Conversation/message/Run writes.
   */
  public activateVolatileConversationProjection(): void {
    if (this.volatileConversationProjectionActive) return;
    this.database.exec("PRAGMA temp_store = MEMORY;");
    createVolatileConversationProjectionSchema(this.database);
    this.volatileConversationProjectionActive = true;
  }

  public isJsonlConversationStorageFinalized(): boolean {
    const importsTable = this.database.prepare(
      `SELECT 1 AS present FROM main.sqlite_master
       WHERE type = 'table' AND name = 'storage_imports'`,
    ).get();
    if (importsTable === undefined) return false;
    return this.database.prepare(
      `SELECT 1 AS present FROM main.storage_imports
       WHERE source_kind = ? AND source_identity = ?`,
    ).get(
      JSONL_CONVERSATION_STORAGE_IMPORT_KIND,
      JSONL_CONVERSATION_STORAGE_IMPORT_IDENTITY,
    ) !== undefined;
  }

  /**
   * Completes the one-time SQLite-to-JSONL cutover after every legacy
   * Conversation has been exported and successfully replayed into the TEMP
   * projection. Team tables retain Conversation identifiers as ordinary TEXT
   * references because their targets now live in JSONL, outside SQLite.
   */
  public finalizeJsonlConversationStorage(): void {
    if (this.isJsonlConversationStorageFinalized()) return;
    if (!this.volatileConversationProjectionActive) {
      throw new Error("Volatile Conversation projection must be active before finalization.");
    }

    this.database.exec("PRAGMA foreign_keys = OFF;");
    try {
      this.database.exec("BEGIN IMMEDIATE;");
      for (const tableName of TEAM_TABLES_WITH_CONVERSATION_REFERENCES) {
        this.rebuildPersistentTableWithoutConversationForeignKeys(tableName);
      }
      for (const tableName of PERSISTED_CONVERSATION_TABLES) {
        this.database.exec(`DROP TABLE IF EXISTS main.${quoteSqliteIdentifier(tableName)};`);
      }
      this.database.prepare(
        `INSERT INTO main.storage_imports (source_kind, source_identity, completed_at)
         VALUES (?, ?, ?)`,
      ).run(
        JSONL_CONVERSATION_STORAGE_IMPORT_KIND,
        JSONL_CONVERSATION_STORAGE_IMPORT_IDENTITY,
        new Date().toISOString(),
      );
      this.database.exec("COMMIT;");
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    } finally {
      this.database.exec("PRAGMA foreign_keys = ON;");
    }

    const foreignKeyViolations = this.database.prepare("PRAGMA main.foreign_key_check;").all();
    if (foreignKeyViolations.length > 0) {
      throw new Error("JSONL Conversation storage migration left invalid SQLite relationships.");
    }
    if (this.databasePath !== ":memory:") {
      this.database.exec("PRAGMA wal_checkpoint(TRUNCATE);");
      this.database.exec("VACUUM;");
    }
  }

  private rebuildPersistentTableWithoutConversationForeignKeys(tableName: string): void {
    const row = this.database.prepare(
      `SELECT sql FROM main.sqlite_master WHERE type = 'table' AND name = ?`,
    ).get(tableName) as DatabaseRow | undefined;
    if (row === undefined) return;
    const originalSql = asNullableString(row, "sql");
    if (originalSql === null || !/\bREFERENCES\s+(conversations|runs|conversation_agent_messages)\b/i.test(originalSql)) {
      return;
    }

    const replacementName = `__jsonl_${tableName}`;
    const createPrefix = new RegExp(
      `^(CREATE\\s+TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?)` +
      `(?:${escapeRegExp(tableName)}|"${escapeRegExp(tableName)}"|\\[${escapeRegExp(tableName)}\\])`,
      "i",
    );
    const createSql = originalSql
      .replace(createPrefix, `$1${quoteSqliteIdentifier(replacementName)}`)
      .replace(
        /\s+REFERENCES\s+(?:conversations|runs|conversation_agent_messages)\s*\([^)]*\)(?:\s+ON\s+DELETE\s+(?:CASCADE|SET\s+NULL|RESTRICT|NO\s+ACTION))?/gi,
        "",
      );
    if (createSql === originalSql) {
      throw new Error(`Could not detach Conversation foreign keys from ${tableName}.`);
    }

    const columns = this.database.prepare(
      `PRAGMA main.table_info(${quoteSqliteIdentifier(tableName)})`,
    ).all() as DatabaseRow[];
    const columnList = columns
      .map((column) => quoteSqliteIdentifier(asString(column, "name")))
      .join(", ");
    const indexes = this.database.prepare(
      `SELECT sql FROM main.sqlite_master
       WHERE type = 'index' AND tbl_name = ? AND sql IS NOT NULL
       ORDER BY name ASC`,
    ).all(tableName) as DatabaseRow[];

    this.database.exec(`DROP TABLE IF EXISTS main.${quoteSqliteIdentifier(replacementName)};`);
    this.database.exec(createSql);
    this.database.exec(
      `INSERT INTO main.${quoteSqliteIdentifier(replacementName)} (${columnList})
       SELECT ${columnList} FROM main.${quoteSqliteIdentifier(tableName)};`,
    );
    this.database.exec(`DROP TABLE main.${quoteSqliteIdentifier(tableName)};`);
    this.database.exec(
      `ALTER TABLE main.${quoteSqliteIdentifier(replacementName)}
       RENAME TO ${quoteSqliteIdentifier(tableName)};`,
    );
    for (const index of indexes) {
      this.database.exec(asString(index, "sql"));
    }
  }

  /**
   * Imports the former standalone LangGraph databases into db.sqlite.
   * INSERT OR IGNORE makes startup migration repeatable without replacing
   * checkpoints that have already been written to the unified database.
   */
  public importLegacyCheckpointDatabases(databasePaths: readonly string[]): void {
    for (const databasePath of databasePaths) {
      if (!existsSync(databasePath)) continue;
      if (
        this.databasePath !== ":memory:"
        && path.resolve(databasePath) === path.resolve(this.databasePath)
      ) continue;
      const sourceIdentity = path.resolve(databasePath);
      const alreadyImported = this.database.prepare(
        `SELECT 1 AS present FROM storage_imports
         WHERE source_kind = 'langgraph-checkpoints' AND source_identity = ?`,
      ).get(sourceIdentity);
      if (alreadyImported !== undefined) continue;

      this.database.prepare("ATTACH DATABASE ? AS legacy_checkpoints").run(databasePath);
      try {
        const rows = this.database.prepare(
          `SELECT name FROM legacy_checkpoints.sqlite_master
           WHERE type = 'table' AND name IN (
             'langgraph_checkpoints', 'langgraph_checkpoint_writes', 'langgraph_checkpoint_blobs'
           )`,
        ).all() as DatabaseRow[];
        const tableNames = new Set(rows.map((row) => asString(row, "name")));
        if (
          !tableNames.has("langgraph_checkpoints")
          || !tableNames.has("langgraph_checkpoint_writes")
        ) {
          throw new Error(`Legacy checkpoint database has an incompatible schema: ${databasePath}`);
        }

        this.withTransaction(() => {
          this.database.exec(`
            INSERT OR IGNORE INTO langgraph_checkpoints (
              thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
              checkpoint_type, checkpoint_blob, metadata_type, metadata_blob, created_at
            )
            SELECT
              thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
              checkpoint_type, checkpoint_blob, metadata_type, metadata_blob, created_at
            FROM legacy_checkpoints.langgraph_checkpoints;

            INSERT OR IGNORE INTO langgraph_checkpoint_writes (
              thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx,
              channel, value_type, value_blob, created_at
            )
            SELECT
              thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx,
              channel, value_type, value_blob, created_at
            FROM legacy_checkpoints.langgraph_checkpoint_writes;
          `);
          if (tableNames.has("langgraph_checkpoint_blobs")) {
            this.database.exec(`
              INSERT OR IGNORE INTO langgraph_checkpoint_blobs
                (thread_id, checkpoint_ns, channel, version, value_type, value_blob)
              SELECT thread_id, checkpoint_ns, channel, version, value_type, value_blob
              FROM legacy_checkpoints.langgraph_checkpoint_blobs;
            `);
          }
          this.database.prepare(
            `INSERT INTO storage_imports (source_kind, source_identity, completed_at)
             VALUES ('langgraph-checkpoints', ?, ?)`,
          ).run(sourceIdentity, new Date().toISOString());
        });
      } finally {
        this.database.exec("DETACH DATABASE legacy_checkpoints;");
      }
    }
  }

  /**
   * Bootstrap calls this after rebuilding the volatile projection from
   * ThreadLog. Runs that had reached the model/tool execution boundary must
   * never be replayed automatically after a process stop.
   */
  public interruptRecoveredThreadLogRuns(): {
    conversationId: string;
    event: import("./thread-log.js").ThreadLogEventInput;
  }[] {
    const events: ReturnType<AgentDatabase["interruptRecoveredThreadLogRuns"]> = [];
    // A child may have durably finished before its parent receipt was appended.
    const recoverableTasks = this.database.prepare("SELECT target_run_id FROM subagent_tasks WHERE status IN ('queued', 'running') AND target_run_id IS NOT NULL").all() as DatabaseRow[];
    for (const task of recoverableTasks) {
      const runId = asString(task, "target_run_id");
      const conversationId = this.getRunConversationId(runId);
      if (conversationId === null) continue;
      const run = this.getConversationRunOutcome(conversationId, runId);
      if (run !== null && (run.status === "completed" || run.status === "failed" || run.status === "cancelled")) {
        const completed = this.completeSubagentTaskByRun({ targetRunId: runId, status: run.status, result: run.result, error: run.error });
        if (completed !== null) events.push({ conversationId: completed.parentConversationId,
          event: { type: "subagent_task_completed", payload: { task: completed } } });
      }
    }
    const runs = this.database.prepare(
      "SELECT id, conversation_id FROM runs WHERE status IN ('queued', 'running')",
    ).all() as DatabaseRow[];
    const tasks = this.database.prepare(
      "SELECT id FROM subagent_tasks WHERE status IN ('queued', 'running')",
    ).all() as DatabaseRow[];
    this.interruptUnfinishedRuns();
    for (const row of runs) {
      const runId = asString(row, "id");
      const conversationId = asString(row, "conversation_id");
      const run = this.database.prepare("SELECT status, error FROM runs WHERE id = ?").get(runId) as DatabaseRow;
      if (run.status !== "failed") continue;
      events.push({ conversationId, event: {
        type: "run_finished", payload: { runId, status: "failed", error: run.error, result: null },
      } });
      const timeline = this.database.prepare(
        "SELECT payload_json FROM conversation_timeline WHERE run_id = ? AND kind IN ('tool', 'model_retry')",
      ).all(runId) as DatabaseRow[];
      for (const item of timeline) {
        const value = parseJson(asString(item, "payload_json"), "recovered timeline item");
        const tool = conversationToolItemSchema.safeParse(value);
        if (tool.success && tool.data.status === "cancelled") events.push({ conversationId, event: {
          type: "tool_approval_expired", payload: { tool: tool.data },
        } });
        const retry = conversationModelRetryItemSchema.safeParse(value);
        if (retry.success && retry.data.status === "failed") events.push({ conversationId, event: {
          type: "model_retry_updated", payload: { retry: retry.data },
        } });
      }
    }
    for (const row of tasks) {
      const task = this.getSubagentTask(asString(row, "id"));
      events.push({ conversationId: task.parentConversationId, event: {
        type: "subagent_task_completed", payload: { task },
      } });
      if (task.resultMessageId === null) continue;
      const stored = this.database.prepare(
        "SELECT payload_json FROM conversation_timeline WHERE id = ?",
      ).get(task.resultMessageId) as DatabaseRow | undefined;
      if (stored === undefined) continue;
      const message = conversationAgentMessageItemSchema.parse(parseJson(asString(stored, "payload_json"), "recovered result"));
      events.push({ conversationId: task.parentConversationId, event: {
        type: "agent_message", payload: { message, content: message.content, modelContent: agentMessageModelContent(message) },
      } });
    }
    // A yielded ToolCall is complete while its process receipt is still
    // running. After restart that process session can no longer be controlled.
    const commands = this.database.prepare(
      `SELECT payload_json FROM conversation_timeline
       WHERE kind = 'tool' AND json_extract(payload_json, '$.name') = 'run_command'`,
    ).all() as DatabaseRow[];
    for (const row of commands) {
      const current = conversationToolItemSchema.parse(parseJson(asString(row, "payload_json"), "command tool"));
      if (current.result === null) continue;
      let receipt: unknown;
      try { receipt = JSON.parse(current.result); } catch { continue; }
      const parsed = z.object({ value: z.object({ status: z.literal("running") }).passthrough() }).passthrough().safeParse(receipt);
      if (!parsed.success) continue;
      const tool = conversationToolItemSchema.parse({
        ...current,
        status: "cancelled",
        result: JSON.stringify({ ...parsed.data, ok: false, value: {
          ...parsed.data.value, status: "cancelled", completedAt: new Date().toISOString(), exitCode: null,
          error: "Command session was interrupted by application shutdown; it will not be replayed automatically.",
        } }),
      });
      this.updateTool(tool);
      events.push({ conversationId: tool.conversationId, event: {
        type: "runtime_activity_updated", payload: { tool, toolId: tool.id, runId: tool.runId, writeAhead: true },
      } });
    }
    return events;
  }

  public listProjects(): ProjectSummary[] {
    const rows = this.database
      .prepare(
        "SELECT id, name, root_path, is_pinned, show_teams_in_navigator FROM projects ORDER BY is_pinned DESC, sort_order ASC, created_at ASC"
      )
      .all() as DatabaseRow[];
    return rows.map(toProject);
  }

  public saveProject(project: ProjectSummary): void {
    const validated = projectSummarySchema.parse(project);
    this.database
      .prepare(
        `INSERT INTO projects (
           id, name, root_path, is_pinned, show_teams_in_navigator, sort_order, created_at
         )
         SELECT ?, ?, ?, ?, ?, COALESCE(MAX(sort_order), -1) + 1, ? FROM projects WHERE true
         ON CONFLICT(root_path) DO UPDATE SET
           name = excluded.name,
           is_pinned = excluded.is_pinned,
           show_teams_in_navigator = excluded.show_teams_in_navigator`
      )
      .run(
        validated.id,
        validated.name,
        validated.rootPath,
        Number(validated.isPinned ?? false),
        Number(validated.showTeamsInNavigator ?? false),
        new Date().toISOString()
      );
  }

  public reorderProjects(projectIds: readonly string[]): void {
    if (new Set(projectIds).size !== projectIds.length) {
      throw new Error("Project order contains duplicate identifiers.");
    }
    const placeholders = projectIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(`SELECT id, is_pinned FROM projects WHERE id IN (${placeholders})`)
      .all(...projectIds) as DatabaseRow[];
    const pinned = rows[0]?.is_pinned;
    if (
      rows.length !== projectIds.length
      || (pinned !== 0 && pinned !== 1)
      || rows.some((row) => row.is_pinned !== pinned)
    ) {
      throw new Error("Projects can only be reordered inside one pin group.");
    }
    const countRow = this.database
      .prepare("SELECT COUNT(*) AS count FROM projects WHERE is_pinned = ?")
      .get(pinned) as DatabaseRow;
    if (Number(countRow.count) !== projectIds.length) {
      throw new Error("Project reorder must include the complete pin group.");
    }
    this.withTransaction(() => {
      const update = this.database.prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
      projectIds.forEach((projectId, index) => update.run(index, projectId));
    });
  }

  public deleteProject(projectId: string): void {
    const activeRun = this.database
      .prepare(
        `SELECT 1 AS present
         FROM runs
         JOIN conversations ON conversations.id = runs.conversation_id
         WHERE conversations.project_id = ? AND runs.status IN ('queued', 'running')
         LIMIT 1`
      )
      .get(projectId);
    if (activeRun !== undefined) {
      throw new Error("A project with running conversations cannot be removed.");
    }
    const result = this.database
      .prepare("DELETE FROM projects WHERE id = ?")
      .run(projectId);
    if (result.changes !== 1) {
      throw new Error("Project was not found.");
    }
  }

  public listConversations(): ConversationSummary[] {
    const rows = this.database
      .prepare(
        `${teamWorkItemExecutionTreeCte}
         SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            selected_provider_id, selected_model_id, selected_reasoning_json, permission_mode, coordination_mode,
            thread_kind, agent_id, avatar_icon, team_id, title, created_at, conversations.updated_at,
            conversations.archived_at,
            conversations.has_unread_result, conversations.is_archived,
            conversations.is_pinned, conversations.pin_order,
           (SELECT id FROM runs
            WHERE conversation_id = conversations.id
              AND status IN ('queued', 'running')
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS active_run_id,
           (SELECT status FROM runs
            WHERE conversation_id = conversations.id
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_run_status
          ,(SELECT COUNT(*) FROM subagent_tasks
            WHERE parent_conversation_id = conversations.id
              AND (
                status IN ('queued', 'running')
                OR EXISTS (
                  SELECT 1 FROM runs AS active_subagent_runs
                  WHERE active_subagent_runs.conversation_id = subagent_tasks.child_conversation_id
                    AND active_subagent_runs.status IN ('queued', 'running')
                )
              )) AS active_subagent_count
           ,(SELECT status FROM subagent_tasks
             WHERE child_conversation_id = conversations.id LIMIT 1) AS subagent_task_status
           ,team_execution_tree_projection.work_item_id AS team_work_item_id
          FROM conversations
          LEFT JOIN team_execution_tree_projection
            ON team_execution_tree_projection.conversation_id = conversations.id
         WHERE parent_conversation_id IS NULL AND deletion_pending = 0
         ORDER BY conversations.is_pinned DESC, conversations.sort_order ASC,
                  conversations.updated_at DESC`
      )
      .all() as DatabaseRow[];
    return rows.map(toConversation);
  }

  /**
   * Return the complete conversation hierarchy in one projection query.
   *
   * The renderer uses this during navigator/activity startup. Calling
   * listConversationForks once per node turns a large project into hundreds
   * of synchronous IPC/SQLite round trips and can delay live approval state.
   */
  public listConversationHierarchy(): ConversationSummary[] {
    const rows = this.database
      .prepare(
        `${teamWorkItemExecutionTreeCte}
         SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            selected_provider_id, selected_model_id, selected_reasoning_json, permission_mode, coordination_mode,
            thread_kind, agent_id, avatar_icon, team_id, title, created_at, conversations.updated_at,
            conversations.archived_at,
            conversations.has_unread_result, conversations.is_archived,
            conversations.is_pinned, conversations.pin_order,
           (SELECT id FROM runs
            WHERE conversation_id = conversations.id
              AND status IN ('queued', 'running')
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS active_run_id,
           (SELECT status FROM runs
            WHERE conversation_id = conversations.id
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_run_status
          ,(SELECT COUNT(*) FROM subagent_tasks
            WHERE parent_conversation_id = conversations.id
              AND (
                status IN ('queued', 'running')
                OR EXISTS (
                  SELECT 1 FROM runs AS active_subagent_runs
                  WHERE active_subagent_runs.conversation_id = subagent_tasks.child_conversation_id
                    AND active_subagent_runs.status IN ('queued', 'running')
                )
              )) AS active_subagent_count
           ,(SELECT status FROM subagent_tasks
             WHERE child_conversation_id = conversations.id LIMIT 1) AS subagent_task_status
           ,team_execution_tree_projection.work_item_id AS team_work_item_id
         FROM conversations
         LEFT JOIN team_execution_tree_projection
           ON team_execution_tree_projection.conversation_id = conversations.id
         WHERE conversations.deletion_pending = 0
         ORDER BY conversations.is_pinned DESC, conversations.sort_order ASC,
                  conversations.updated_at DESC, conversations.created_at ASC`
      )
      .all() as DatabaseRow[];
    return rows.map(row => {
      const conversation = toConversation(row);
      const room = this.collaboration?.coordinatorRoom(conversation.id);
      return { ...conversation, ...(room == null ? {} : { coordinationTeamInstanceId: room.teamInstanceId }) };
    });
  }

  public listAgentConversations(): ConversationSummary[] {
    const rows = this.database
      .prepare(
        `SELECT id FROM conversations
         WHERE is_archived = 0 AND deletion_pending = 0
         ORDER BY updated_at DESC, rowid DESC`
      )
      .all() as DatabaseRow[];
    return rows.map((row) => this.getConversation(asString(row, "id")));
  }

  public listAllConversationIds(): string[] {
    const rows = this.database
      .prepare("SELECT id FROM conversations ORDER BY created_at ASC, rowid ASC")
      .all() as DatabaseRow[];
    return rows.map((row) => asString(row, "id"));
  }

  /**
   * Background projection must not revive a Conversation already owned by a
   * persisted deletion task. Keep listAllConversationIds() inclusive for
   * deletion/recovery workflows and use this narrower query at that boundary.
   */
  public listProjectableConversationIds(): string[] {
    const rows = this.database
      .prepare(
        "SELECT id FROM conversations WHERE deletion_pending = 0 ORDER BY created_at ASC, rowid ASC",
      )
      .all() as DatabaseRow[];
    return rows.map((row) => asString(row, "id"));
  }

  public getConversation(conversationId: string): ConversationSummary {
    const row = this.database
      .prepare(
        `WITH RECURSIVE execution_ancestors(conversation_id) AS (
           SELECT ?
           UNION
           SELECT members.team_execution_conversation_id
           FROM execution_ancestors
           JOIN team_member_conversations AS members
             ON members.conversation_id = execution_ancestors.conversation_id
           UNION
           SELECT tasks.parent_conversation_id
           FROM execution_ancestors
           JOIN subagent_tasks AS tasks
             ON tasks.child_conversation_id = execution_ancestors.conversation_id
         )
         SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            selected_provider_id, selected_model_id, selected_reasoning_json, permission_mode, coordination_mode,
            thread_kind, agent_id, avatar_icon, team_id, title, created_at, conversations.updated_at,
            conversations.archived_at,
            conversations.has_unread_result, conversations.is_archived,
            conversations.is_pinned, conversations.pin_order,
           (SELECT id FROM runs
            WHERE conversation_id = conversations.id
              AND status IN ('queued', 'running')
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS active_run_id,
           (SELECT status FROM runs
            WHERE conversation_id = conversations.id
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_run_status
          ,(SELECT COUNT(*) FROM subagent_tasks
            WHERE parent_conversation_id = conversations.id
              AND (
                status IN ('queued', 'running')
                OR EXISTS (
                  SELECT 1 FROM runs AS active_subagent_runs
                  WHERE active_subagent_runs.conversation_id = subagent_tasks.child_conversation_id
                    AND active_subagent_runs.status IN ('queued', 'running')
                )
              )) AS active_subagent_count
           ,(SELECT status FROM subagent_tasks
             WHERE child_conversation_id = conversations.id LIMIT 1) AS subagent_task_status
           ,(SELECT id FROM team_work_items
             WHERE execution_conversation_id IN (SELECT conversation_id FROM execution_ancestors)
             ORDER BY CASE status
               WHEN 'running' THEN 0 WHEN 'reviewing' THEN 1 WHEN 'waiting_user' THEN 2
               WHEN 'planned' THEN 3 WHEN 'queued' THEN 4 ELSE 5
             END, updated_at DESC, rowid DESC
             LIMIT 1) AS team_work_item_id
         FROM conversations
         WHERE conversations.id = ? AND deletion_pending = 0`
      )
      .get(conversationId, conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("Conversation was not found.");
    }
    const room = this.collaboration?.coordinatorRoom(conversationId);
    return { ...toConversation(row), ...(room == null ? {} : { coordinationTeamInstanceId: room.teamInstanceId }) };
  }

  /**
   * Mirrors declarative Team configuration into relational tables. Team member
   * links remain queryable without duplicating any member conversation history.
   */
  public syncTeamDirectory(rawDirectory: AgentDirectoryConfiguration): void {
    const directory = agentDirectoryConfigurationSchema.parse(rawDirectory);
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const retainedIds = new Set(directory.teams.map((team) => team.id));
      for (const team of directory.teams) {
        this.database
          .prepare(
            `INSERT INTO teams (
              id, name, description, enabled, lead_agent_id, instructions,
              max_workers, project_scope, coordinator_conversation_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              enabled = excluded.enabled,
              lead_agent_id = excluded.lead_agent_id,
              instructions = excluded.instructions,
              max_workers = excluded.max_workers,
              project_scope = excluded.project_scope,
              updated_at = excluded.updated_at`,
          )
          .run(
            team.id,
            team.name,
            team.description,
            Number(team.enabled),
            team.leadAgentId,
            team.instructions,
            team.maxWorkers,
            team.projectScope,
            now,
            now,
          );
        this.database.prepare("DELETE FROM team_members WHERE team_id = ?").run(team.id);
        for (const [index, agentId] of team.memberIds.entries()) {
          const member = team.memberConfigurations[agentId];
          this.database
            .prepare(
              `INSERT INTO team_members (team_id, agent_id, member_index, role, instructions)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(team.id, agentId, index, member?.role ?? "", member?.instructions ?? "");
        }
      }
      const removedTeamIds = (this.database
        .prepare("SELECT id FROM teams")
        .all() as DatabaseRow[])
        .map((row) => asString(row, "id"))
        .filter((teamId) => !retainedIds.has(teamId));
      for (const teamId of removedTeamIds) {
        const workItem = this.database
          .prepare("SELECT id FROM team_work_items WHERE team_id = ? LIMIT 1")
          .get(teamId);
        if (workItem !== undefined) {
          throw new Error("Cannot remove a Team that still has WorkItems; resolve or archive them first.");
        }
      }
      if (retainedIds.size === 0) {
        this.database.exec("DELETE FROM teams");
      } else {
        this.database
          .prepare(`DELETE FROM teams WHERE id NOT IN (${[...retainedIds].map(() => "?").join(", ")})`)
          .run(...retainedIds);
      }
    });
  }

  public listTeams(): TeamDirectoryRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, description, enabled, lead_agent_id, instructions,
                max_workers, project_scope, coordinator_conversation_id, updated_at
         FROM teams ORDER BY name COLLATE NOCASE ASC, id ASC`,
      )
      .all() as DatabaseRow[];
    return rows.map((row) => ({
      coordinatorConversationId: asNullableString(row, "coordinator_conversation_id"),
      description: asString(row, "description"),
      enabled: asBoolean(row, "enabled"),
      id: asString(row, "id"),
      instructions: asString(row, "instructions"),
      leadAgentId: asString(row, "lead_agent_id"),
      maxWorkers: asNumber(row, "max_workers"),
      name: asString(row, "name"),
      projectScope: asString(row, "project_scope") === "selected" ? "selected" : "all",
      updatedAt: asString(row, "updated_at"),
    }));
  }

  public listTeamMembers(teamId: string): TeamMemberRecord[] {
    const team = this.database.prepare("SELECT id FROM teams WHERE id = ?").get(teamId);
    if (team === undefined) throw new Error("Team was not found.");
    const rows = this.database
      .prepare(
        `SELECT team_id, agent_id, role, instructions
         FROM team_members WHERE team_id = ? ORDER BY member_index ASC`,
      )
      .all(teamId) as DatabaseRow[];
    return rows.map((row) => ({
      agentId: asString(row, "agent_id"),
      instructions: asString(row, "instructions"),
      role: asString(row, "role"),
      teamId: asString(row, "team_id"),
    }));
  }

  public getTeamCoordinatorConversationId(teamId: string): string | null {
    const row = this.database
      .prepare("SELECT coordinator_conversation_id FROM teams WHERE id = ?")
      .get(teamId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Team was not found.");
    return asNullableString(row, "coordinator_conversation_id");
  }

  public setTeamCoordinatorConversation(teamId: string, conversationId: string): void {
    const team = this.database.prepare("SELECT id FROM teams WHERE id = ?").get(teamId);
    if (team === undefined) throw new Error("Team was not found.");
    const conversation = this.getConversation(conversationId);
    if (conversation.teamId !== teamId || conversation.threadKind !== "team_lead") {
      throw new Error("Team coordinator must be a Team Lead conversation bound to the same Team.");
    }
    this.database
      .prepare("UPDATE teams SET coordinator_conversation_id = ?, updated_at = ? WHERE id = ?")
      .run(conversationId, new Date().toISOString(), teamId);
  }

  public listTeamInstances(rawInput: Partial<ListTeamInstancesInput> = {}): TeamInstanceView[] {
    const input = listTeamInstancesInputSchema.parse(rawInput);
    const clauses = ["deleted_at IS NULL"];
    const values: string[] = [];
    if (!input.includeArchived) clauses.push("archived_at IS NULL");
    if (input.projectId !== undefined) {
      clauses.push("project_id = ?");
      values.push(input.projectId);
    }
    if (input.sourceConversationId !== undefined) {
      clauses.push("source_conversation_id = ?");
      values.push(input.sourceConversationId);
    }
    const rows = this.database.prepare(
      `SELECT * FROM team_instances
       WHERE ${clauses.join(" AND ")}
       ORDER BY CASE WHEN scope IN ('global', 'project') THEN sort_order ELSE 0 END ASC,
                created_at ASC, rowid ASC`,
    ).all(...values) as DatabaseRow[];
    return rows.map((row) => this.toTeamInstance(row));
  }

  public getTeamInstance(teamInstanceId: string): TeamInstanceView {
    const row = this.database.prepare(
      "SELECT * FROM team_instances WHERE id = ? AND deleted_at IS NULL",
    ).get(teamInstanceId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Team instance was not found.");
    return this.toTeamInstance(row);
  }

  public createTeamInstance(rawInput: CreateTeamInstanceInput): TeamInstanceView {
    const input = createTeamInstanceInputSchema.parse(rawInput);
    const team = this.database.prepare("SELECT name FROM teams WHERE id = ?").get(input.teamId) as DatabaseRow | undefined;
    if (team === undefined) throw new Error("The selected Team template is not available.");
    if (input.projectId !== undefined) {
      const project = this.database.prepare("SELECT id FROM projects WHERE id = ?").get(input.projectId);
      if (project === undefined) throw new Error("Team instance project was not found.");
    }
    if (input.sourceConversationId !== undefined) {
      const source = this.getConversation(input.sourceConversationId);
      if (source.projectId !== input.projectId) {
        throw new Error("The Team instance source must belong to its project.");
      }
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const sortOrder = input.scope === "conversation"
      ? 0
      : Number((this.database.prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
         FROM team_instances
         WHERE scope IN ('global', 'project') AND deleted_at IS NULL`,
      ).get() as DatabaseRow).next_sort_order);
    const name = this.allocateTeamInstanceName({
      baseName: input.name ?? asString(team, "name"),
      projectId: input.projectId ?? null,
      scope: input.scope,
      sourceConversationId: input.sourceConversationId ?? null,
    });
    this.database.prepare(
      `INSERT INTO team_instances (
        id, team_id, scope, project_id, source_conversation_id, name,
        root_conversation_id, sort_order, archived_at, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?)`,
    ).run(
      id,
      input.teamId,
      input.scope,
      input.projectId ?? null,
      input.sourceConversationId ?? null,
      name,
      sortOrder,
      now,
      now,
    );
    return this.getTeamInstance(id);
  }

  public setTeamInstanceRoot(teamInstanceId: string, conversationId: string): TeamInstanceView {
    const instance = this.getTeamInstance(teamInstanceId);
    const conversation = this.getConversation(conversationId);
    if (
      conversation.teamId !== instance.teamId
      || conversation.threadKind !== "team_lead"
      || conversation.projectId !== instance.projectId
      || conversation.parentConversationId !== instance.sourceConversationId
    ) {
      throw new Error("Team instance root does not match its owner and Team template.");
    }
    const now = new Date().toISOString();
    const result = this.database.prepare(
      `UPDATE team_instances SET root_conversation_id = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(conversationId, now, teamInstanceId);
    if (result.changes !== 1) throw new Error("Team instance root could not be saved.");
    return this.getTeamInstance(teamInstanceId);
  }

  public renameTeamInstance(rawInput: RenameTeamInstanceInput): TeamInstanceView {
    const input = renameTeamInstanceInputSchema.parse(rawInput);
    const current = this.getTeamInstance(input.teamInstanceId);
    if (input.projectId !== undefined && current.scope === "conversation") {
      throw new Error("A conversation Team retains its source conversation project.");
    }
    const projectId = input.projectId === undefined ? current.projectId : input.projectId;
    if (projectId !== null) this.assertProjectExists(projectId);
    const scope = current.scope === "conversation"
      ? current.scope
      : projectId === null ? "global" : "project";
    const associationChanged = projectId !== current.projectId || scope !== current.scope;
    if (associationChanged && this.hasActiveTeamInstanceWork(current.id)) {
      throw new Error("A Team instance with active work cannot change its project.");
    }
    const name = this.allocateTeamInstanceName({
      baseName: input.name,
      excludeTeamInstanceId: current.id,
      projectId,
      scope,
      sourceConversationId: current.sourceConversationId,
    });
    const now = new Date().toISOString();
    this.withTransaction(() => {
      if (associationChanged && current.rootConversationId !== null) {
        const participantIds = [
          current.rootConversationId,
          ...this.listTeamMemberConversations(current.rootConversationId)
            .map((conversation) => conversation.id),
        ];
        for (const conversationId of participantIds) {
          this.setConversationProject(conversationId, projectId);
        }
        this.database.prepare(
          "DELETE FROM team_execution_conversations WHERE team_instance_id = ?",
        ).run(current.id);
        if (scope === "project") {
          this.database.prepare(
            `INSERT INTO team_execution_conversations (
              team_instance_id, team_id, project_id, source_conversation_id,
              scope_key, conversation_id, created_at, updated_at
            ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
          ).run(
            current.id,
            current.teamId,
            projectId,
            teamExecutionScopeKey(projectId, null),
            current.rootConversationId,
            now,
            now,
          );
          this.database.prepare(
            `UPDATE teams SET coordinator_conversation_id = NULL, updated_at = ?
             WHERE id = ? AND coordinator_conversation_id = ?`,
          ).run(now, current.teamId, current.rootConversationId);
        }
      }
      this.database.prepare(
        `UPDATE team_instances
         SET name = ?, scope = ?, project_id = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      ).run(name, scope, projectId, now, current.id);
    });
    return this.getTeamInstance(current.id);
  }

  public reorderTeamInstances(teamInstanceIds: readonly string[]): TeamInstanceView[] {
    if (new Set(teamInstanceIds).size !== teamInstanceIds.length) {
      throw new Error("Team instance order contains duplicate identifiers.");
    }
    const rows = this.database.prepare(
      `SELECT id FROM team_instances
       WHERE scope IN ('global', 'project')
         AND archived_at IS NULL
         AND deleted_at IS NULL`,
    ).all() as DatabaseRow[];
    const existingIds = new Set(rows.map((row) => asString(row, "id")));
    if (
      teamInstanceIds.length !== existingIds.size
      || teamInstanceIds.some((teamInstanceId) => !existingIds.has(teamInstanceId))
    ) {
      throw new Error("Team instance reorder must include every visible Team.");
    }
    this.withTransaction(() => {
      const update = this.database.prepare(
        "UPDATE team_instances SET sort_order = ?, updated_at = ? WHERE id = ?",
      );
      const now = new Date().toISOString();
      teamInstanceIds.forEach((teamInstanceId, index) => update.run(index, now, teamInstanceId));
    });
    return this.listTeamInstances({ includeArchived: false });
  }

  public setTeamInstanceArchived(
    rawInput: { archived: boolean; teamInstanceId: string },
  ): TeamInstanceView {
    const input = setTeamInstanceArchivedInputSchema.parse(rawInput);
    const current = this.getTeamInstance(input.teamInstanceId);
    if (input.archived && this.hasActiveTeamInstanceWork(current.id)) {
      throw new Error("A Team instance with active work cannot be archived.");
    }
    const now = new Date().toISOString();
    this.database.prepare(
      `UPDATE team_instances SET archived_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(input.archived ? now : null, now, current.id);
    return this.getTeamInstance(current.id);
  }

  public deleteTeamInstance(teamInstanceId: string): void {
    const current = this.getTeamInstance(teamInstanceId);
    if (this.hasActiveTeamInstanceWork(current.id)) {
      throw new Error("A Team instance with active work cannot be deleted.");
    }
    this.collaboration.cancelRoom(current.id);
    const now = new Date().toISOString();
    this.database.prepare(
      `UPDATE team_instances SET archived_at = COALESCE(archived_at, ?), deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(now, now, now, current.id);
  }

  private hasActiveTeamInstanceWork(teamInstanceId: string): boolean {
    return this.database.prepare(
      `SELECT 1 FROM team_work_items
       WHERE team_instance_id = ? AND status IN ('queued', 'planned', 'running', 'reviewing')
       LIMIT 1`,
    ).get(teamInstanceId) !== undefined;
  }

  private allocateTeamInstanceName(input: {
    baseName: string;
    excludeTeamInstanceId?: string;
    projectId: string | null;
    scope: TeamInstanceView["scope"];
    sourceConversationId: string | null;
  }): string {
    const baseName = input.baseName.trim().slice(0, 120);
    if (baseName.length === 0) throw new Error("Team instance name cannot be empty.");
    const rows = this.database.prepare(
      `SELECT id, name FROM team_instances
       WHERE deleted_at IS NULL AND archived_at IS NULL
         AND (
           scope = 'global'
           OR (? IS NOT NULL AND scope = 'project' AND project_id = ?)
           OR (? IS NOT NULL AND scope = 'conversation' AND source_conversation_id = ?)
         )`,
    ).all(
      input.projectId,
      input.projectId,
      input.sourceConversationId,
      input.sourceConversationId,
    ) as DatabaseRow[];
    const names = new Set(rows.flatMap((row) =>
      asString(row, "id") === input.excludeTeamInstanceId
        ? []
        : [asString(row, "name").toLocaleLowerCase()]
    ));
    if (!names.has(baseName.toLocaleLowerCase())) return baseName;
    for (let suffix = 1; suffix < 10_000; suffix += 1) {
      const marker = ` (${suffix})`;
      const candidate = `${baseName.slice(0, Math.max(1, 120 - marker.length))}${marker}`;
      if (!names.has(candidate.toLocaleLowerCase())) return candidate;
    }
    throw new Error("A unique Team instance name could not be allocated.");
  }

  /**
   * Resolves the durable Team Lead conversation for one source Conversation.
   * WorkItems remain independent records, but repeated requests from this
   * source enter the same Team Lead and member audit trail.
   */
  public getTeamExecutionConversation(input: {
    projectId: string | null;
    sourceConversationId: string | null;
    teamId: string;
    teamInstanceId?: string;
  }): ConversationSummary | null {
    const scopeKey = teamExecutionScopeKey(input.projectId, input.sourceConversationId);
    const row = input.teamInstanceId === undefined
      ? this.database.prepare(
        `SELECT conversation_id FROM team_execution_conversations
         WHERE team_id = ? AND scope_key = ? ORDER BY created_at ASC LIMIT 1`,
      ).get(input.teamId, scopeKey) as DatabaseRow | undefined
      : this.database.prepare(
        `SELECT conversation_id FROM team_execution_conversations
         WHERE team_instance_id = ? AND scope_key = ?`,
      ).get(input.teamInstanceId, scopeKey) as DatabaseRow | undefined;
    return row === undefined ? null : this.getConversation(asString(row, "conversation_id"));
  }

  public bindTeamExecutionConversation(input: {
    conversationId: string;
    projectId: string | null;
    sourceConversationId: string | null;
    teamId: string;
    teamInstanceId?: string;
  }): ConversationSummary {
    const source = input.sourceConversationId === null
      ? null
      : this.getConversation(input.sourceConversationId);
    if (source !== null && source.projectId !== input.projectId) {
      throw new Error("The Team execution source must belong to the selected project.");
    }
    const conversation = this.getConversation(input.conversationId);
    if (
      conversation.projectId !== input.projectId
      || conversation.teamId !== input.teamId
      || conversation.threadKind !== "team_lead"
      || conversation.parentConversationId !== input.sourceConversationId
    ) {
      throw new Error("Team execution conversation does not match its Team and source.");
    }
    const scopeKey = teamExecutionScopeKey(input.projectId, input.sourceConversationId);
    const teamInstanceId = input.teamInstanceId ?? this.resolveLegacyTeamInstanceId({
      projectId: input.projectId,
      sourceConversationId: input.sourceConversationId,
      teamId: input.teamId,
    });
    const instance = this.getTeamInstance(teamInstanceId);
    if (instance.teamId !== input.teamId || instance.isArchived) {
      throw new Error("Team execution instance is unavailable or uses another Team template.");
    }
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO team_execution_conversations (
        team_instance_id, team_id, project_id, source_conversation_id,
        scope_key, conversation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(team_instance_id, scope_key) DO NOTHING`,
    ).run(
      teamInstanceId,
      input.teamId,
      input.projectId,
      input.sourceConversationId,
      scopeKey,
      input.conversationId,
      now,
      now,
    );
    const bound = this.getTeamExecutionConversation({ ...input, teamInstanceId });
    if (bound === null) throw new Error("Team execution conversation could not be persisted.");
    return bound;
  }

  private resolveLegacyTeamInstanceId(input: {
    projectId: string | null;
    sourceConversationId: string | null;
    teamId: string;
  }): string {
    const row = this.database.prepare(
      `SELECT id FROM team_instances
       WHERE team_id = ? AND project_id IS ? AND deleted_at IS NULL
         AND scope = ?
         AND ((? IS NULL AND source_conversation_id IS NULL) OR source_conversation_id = ?)
       ORDER BY created_at ASC LIMIT 1`,
    ).get(
      input.teamId,
      input.projectId,
      input.projectId === null ? "global" : input.sourceConversationId === null ? "project" : "conversation",
      input.sourceConversationId,
      input.sourceConversationId,
    ) as DatabaseRow | undefined;
    if (row !== undefined) return asString(row, "id");
    return this.createTeamInstance({
      ...(input.projectId === null ? {} : { projectId: input.projectId }),
      scope: input.projectId === null ? "global" : input.sourceConversationId === null ? "project" : "conversation",
      ...(input.sourceConversationId === null
        ? {}
        : { sourceConversationId: input.sourceConversationId }),
      teamId: input.teamId,
    }).id;
  }

  public listTeamMemberConversations(teamExecutionConversationId: string): ConversationSummary[] {
    this.getConversation(teamExecutionConversationId);
    const rows = this.database.prepare(
      `SELECT conversation_id FROM team_member_conversations
       WHERE team_execution_conversation_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    ).all(teamExecutionConversationId) as DatabaseRow[];
    return rows.map((row) => this.getConversation(asString(row, "conversation_id")));
  }

  public getTeamInstanceForConversation(conversationId: string): TeamInstanceView | null {
    const leadId = this.getTeamExecutionConversationIdForParticipant(conversationId);
    if (leadId === null) return null;
    const row = this.database.prepare(`
      SELECT id FROM team_instances WHERE root_conversation_id = ? AND deleted_at IS NULL
      UNION SELECT team_instance_id AS id FROM team_execution_conversations WHERE conversation_id = ?
      LIMIT 1
    `).get(leadId, leadId) as DatabaseRow | undefined;
    return row === undefined ? null : this.getTeamInstance(asString(row, "id"));
  }

  /** One entry per durable task, regardless of how many messages or rework Runs it contains. */
  public getTeamTaskContext(conversationId: string, input: {
    beforeWorkItemId?: string | undefined;
    memberConversationId?: string | undefined;
    limit: number;
  }) {
    const instance = this.getTeamInstanceForConversation(conversationId);
    if (instance === null || instance.isArchived) throw new Error("当前对话不属于可用的团队实例。");
    if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 20) throw new Error("每次最多读取 20 条团队任务摘要。");
    if (input.memberConversationId !== undefined && this.getTeamInstanceForConversation(input.memberConversationId)?.id !== instance.id) {
      throw new Error("所选成员不属于当前团队。");
    }
    const before = input.beforeWorkItemId === undefined ? null : this.getTeamWorkItem(input.beforeWorkItemId);
    if (before !== null && before.teamInstanceId !== instance.id) throw new Error("任务游标不属于当前团队。");
    const rows = this.database.prepare(`
      SELECT id FROM team_work_items
      WHERE team_instance_id = ? AND deleted_at IS NULL
        AND (? IS NULL OR created_at < ? OR (created_at = ? AND id < ?))
        AND (? IS NULL OR execution_conversation_id = ? OR EXISTS (
          SELECT 1 FROM team_work_item_member_assignments assignments
          WHERE assignments.work_item_id = team_work_items.id AND assignments.member_conversation_id = ?
        ))
      ORDER BY created_at DESC, id DESC LIMIT ?
    `).all(instance.id, before?.createdAt ?? null, before?.createdAt ?? null, before?.createdAt ?? null, before?.id ?? null,
      input.memberConversationId ?? null, input.memberConversationId ?? null, input.memberConversationId ?? null, input.limit + 1) as DatabaseRow[];
    const tasks = [];
    for (const row of rows.slice(0, input.limit)) {
      const item = this.getTeamWorkItem(asString(row, "id"));
      const projection = this.getTeamCollaborationProjection(item.id);
      const entry = {
        id: item.id, title: item.title, projectId: item.projectId, status: item.status,
        createdAt: item.createdAt, updatedAt: item.updatedAt,
        summary: (item.resultSummary ?? item.blockedReason ?? item.requirement).slice(0, 600),
        participants: projection.nodes.filter(node => node.conversationId !== null && item.participantConversationIds?.includes(node.conversationId)).slice(0, 8).map(node => ({
          conversationId: node.conversationId, name: node.name, role: node.role, status: node.runStatus,
          summary: node.latestOutput, runId: node.latestOutputRunId,
        })),
      };
      if (tasks.length > 0 && JSON.stringify([...tasks, entry]).length > 16_000) break;
      tasks.push(entry);
    }
    return { teamInstanceId: instance.id, name: instance.name, tasks,
      nextBeforeWorkItemId: rows.length > tasks.length ? tasks.at(-1)?.id ?? null : null };
  }

  public bindTeamMemberConversation(input: {
    agentId: string;
    conversationId: string;
    teamExecutionConversationId: string;
    replica?: boolean;
  }): ConversationSummary {
    const lead = this.getConversation(input.teamExecutionConversationId);
    const member = this.getConversation(input.conversationId);
    if (
      lead.threadKind !== "team_lead"
      || lead.teamId === null
      || member.threadKind !== "agent"
      || member.teamId !== lead.teamId
      || member.parentConversationId !== lead.id
      || member.agentId !== input.agentId
    ) {
      throw new Error("Team member conversation does not match its Team Lead.");
    }
    const now = new Date().toISOString();
    if (input.replica !== true) {
      const existing = this.listTeamMemberConversations(lead.id).find(conversation => conversation.agentId === input.agentId && !conversation.isArchived);
      if (existing !== undefined) return existing;
    }
    this.database.prepare(
      `INSERT INTO team_member_conversations (
        team_execution_conversation_id, team_id, agent_id, conversation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO NOTHING`,
    ).run(lead.id, lead.teamId, input.agentId, member.id, now, now);
    const row = this.database.prepare(
      `SELECT conversation_id FROM team_member_conversations
       WHERE team_execution_conversation_id = ? AND agent_id = ?`,
    ).get(lead.id, input.agentId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Team member conversation could not be persisted.");
    return this.getConversation(member.id);
  }

  public getTeamWorkerCount(teamInstanceId: string, agentId: string): number {
    const row = this.database.prepare("SELECT worker_count FROM team_instance_worker_counts WHERE team_instance_id = ? AND agent_id = ?")
      .get(teamInstanceId, agentId) as DatabaseRow | undefined;
    return row === undefined ? 1 : asNumber(row, "worker_count");
  }

  public setTeamWorkerCount(teamInstanceId: string, agentId: string, count: number): void {
    this.getTeamInstance(teamInstanceId);
    if (!Number.isSafeInteger(count) || count < 1 || count > 8) throw new Error("每个岗位支持 1–8 位成员。");
    this.database.prepare(`INSERT INTO team_instance_worker_counts (team_instance_id, agent_id, worker_count)
      VALUES (?, ?, ?) ON CONFLICT(team_instance_id, agent_id) DO UPDATE SET worker_count = excluded.worker_count`)
      .run(teamInstanceId, agentId, count);
  }

  public getTeamExecutionConversationIdForParticipant(conversationId: string): string | null {
    const asLead = this.database.prepare(
      "SELECT conversation_id FROM team_execution_conversations WHERE conversation_id = ?",
    ).get(conversationId) as DatabaseRow | undefined;
    if (asLead !== undefined) return asString(asLead, "conversation_id");
    const asInstanceRoot = this.database.prepare(
      `SELECT root_conversation_id FROM team_instances
       WHERE root_conversation_id = ? AND deleted_at IS NULL`,
    ).get(conversationId) as DatabaseRow | undefined;
    if (asInstanceRoot !== undefined) return asString(asInstanceRoot, "root_conversation_id");
    const asMember = this.database.prepare(
      `SELECT team_execution_conversation_id FROM team_member_conversations
       WHERE conversation_id = ?`,
    ).get(conversationId) as DatabaseRow | undefined;
    return asMember === undefined
      ? null
      : asString(asMember, "team_execution_conversation_id");
  }

  public isTeamMemberConversation(conversationId: string): boolean {
    return this.database.prepare(
      "SELECT 1 FROM team_member_conversations WHERE conversation_id = ? LIMIT 1",
    ).get(conversationId) !== undefined;
  }

  public areTeamExecutionParticipants(
    firstConversationId: string,
    secondConversationId: string,
  ): boolean {
    const first = this.getTeamExecutionConversationIdForParticipant(firstConversationId);
    const second = this.getTeamExecutionConversationIdForParticipant(secondConversationId);
    return first !== null && first === second;
  }

  public recordTeamMemberAssignment(input: {
    message: ConversationAgentMessageItem;
    workItemId: string;
  }): void {
    const workItem = this.getTeamWorkItem(input.workItemId);
    if (workItem.status !== "running" || workItem.executionConversationId === null) return;
    const senderLeadId = this.getTeamExecutionConversationIdForParticipant(
      input.message.senderConversationId,
    );
    const targetLeadId = this.getTeamExecutionConversationIdForParticipant(input.message.conversationId);
    if (
      senderLeadId === null
      || senderLeadId !== workItem.executionConversationId
      || targetLeadId !== senderLeadId
      || !this.isTeamMemberConversation(input.message.conversationId)
    ) return;
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO team_work_item_member_assignments (
        id, work_item_id, member_conversation_id, message_id, title, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO NOTHING`,
    ).run(
      randomUUID(),
      input.workItemId,
      input.message.conversationId,
      input.message.id,
      input.message.content.replaceAll(/\s+/gu, " ").slice(0, 300) || "团队成员任务",
      now,
    );
  }

  public createTeamWorkItem(
    rawInput: SubmitTeamWorkItemInput,
    modelSelection: ConversationModelSelection,
  ): TeamWorkItemView {
    const input = submitTeamWorkItemInputSchema.parse(rawInput);
    this.getTeamCoordinatorConversationId(input.teamId);
    if (input.projectId !== null && this.database.prepare("SELECT id FROM projects WHERE id = ?").get(input.projectId) === undefined) {
      throw new Error("Team WorkItem project was not found.");
    }
    const sourceConversation = input.sourceConversationId === undefined
      ? null
      : this.getConversation(input.sourceConversationId);
    if (sourceConversation !== null) {
      if (sourceConversation.projectId !== input.projectId) {
        throw new Error("The source conversation must belong to the Team WorkItem project.");
      }
      if (sourceConversation.threadKind !== "agent" || sourceConversation.teamWorkItemId !== null) {
        throw new Error("Only a normal project conversation can submit a Team WorkItem.");
      }
    }
    const instance = this.resolveTeamInstanceForWorkItem(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.withTransaction(() => {
      this.database.prepare(
        `INSERT INTO team_work_items (
          id, team_id, team_instance_id, project_id, title, requirement, acceptance_criteria_json,
          priority, status, revision, permission_mode, model_selection_json,
          execution_conversation_id, active_run_id, result_summary, blocked_reason,
          source_conversation_id, execution_scope, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL)`,
      ).run(
        id,
        input.teamId,
        instance.id,
        input.projectId,
        input.title,
        input.requirement,
        JSON.stringify(input.acceptanceCriteria),
        input.priority,
        input.permissionMode,
        JSON.stringify(modelSelection),
        sourceConversation?.id ?? null,
        input.executionScope,
        now,
        now,
      );
      this.appendTeamWorkItemEvent(input.teamId, id, "received", "需求已进入团队收件箱。", now);
      this.appendTeamWorkItemEvent(input.teamId, id, "scheduled", "需求已进入调度队列。", now);
    });
    return this.getTeamWorkItem(id);
  }

  private resolveTeamInstanceForWorkItem(
    input: ReturnType<typeof submitTeamWorkItemInputSchema.parse>,
  ): TeamInstanceView {
    if (input.teamInstanceId !== undefined) {
      const instance = this.getTeamInstance(input.teamInstanceId);
      if (instance.teamId !== input.teamId || instance.isArchived) {
        throw new Error("The selected Team instance is unavailable or uses another Team template.");
      }
      if (instance.scope === "project" && instance.projectId !== input.projectId) {
        throw new Error("The selected Team instance belongs to another project.");
      }
      if (
        instance.scope === "conversation"
        && (
          input.executionScope !== "conversation"
          || instance.sourceConversationId !== (input.sourceConversationId ?? null)
        )
      ) {
        throw new Error("The selected conversation Team instance belongs to another conversation.");
      }
      if (instance.scope !== "conversation" && input.executionScope === "conversation") {
        throw new Error("Conversation isolation requires a conversation Team instance.");
      }
      return instance;
    }

    const scope = input.projectId === null ? "global" : input.executionScope === "conversation" ? "conversation" : "project";
    const sourceConversationId = scope === "conversation"
      ? input.sourceConversationId ?? null
      : null;
    const existing = this.listTeamInstances({ includeArchived: false })
      .find((instance) =>
        instance.teamId === input.teamId
        && instance.scope === scope
        && instance.projectId === input.projectId
        && instance.sourceConversationId === sourceConversationId
      );
    if (existing !== undefined) return existing;
    return this.createTeamInstance({
      ...(input.instanceName === undefined ? {} : { name: input.instanceName }),
      ...(input.projectId === null ? {} : { projectId: input.projectId }),
      scope,
      ...(sourceConversationId === null ? {} : { sourceConversationId }),
      teamId: input.teamId,
    });
  }

  public updateTeamWorkItem(rawInput: UpdateTeamWorkItemInput): TeamWorkItemView {
    const input = updateTeamWorkItemInputSchema.parse(rawInput);
    const current = this.getTeamWorkItem(input.workItemId);
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET title = ?, requirement = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      ).run(input.title, input.requirement, now, input.workItemId);
      if (result.changes !== 1) {
        throw new Error("Team WorkItem was deleted before the edit could be saved.");
      }
      this.appendTeamWorkItemEvent(
        current.teamId,
        input.workItemId,
        "updated",
        current.status === "running"
          ? "用户更新了任务标题和需求内容；补充指令将发送给当前执行。"
          : "用户更新了任务标题和需求内容。",
        now,
      );
    });
    return this.getTeamWorkItem(input.workItemId);
  }

  public deleteTeamWorkItem(rawInput: DeleteTeamWorkItemInput): TeamWorkItemView {
    const input = deleteTeamWorkItemInputSchema.parse(rawInput);
    const current = this.getTeamWorkItem(input.workItemId);
    const deletedAt = this.database.prepare(
      "SELECT deleted_at FROM team_work_items WHERE id = ?",
    ).get(input.workItemId) as DatabaseRow;
    if (asNullableString(deletedAt, "deleted_at") !== null) return current;
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET status = CASE
               WHEN status IN ('waiting_user', 'completed') THEN status
               ELSE 'cancelled'
             END,
             active_run_id = NULL, deleted_at = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      ).run(now, now, input.workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem could not be deleted.");
      this.appendTeamWorkItemEvent(
        current.teamId,
        input.workItemId,
        "deleted",
        "用户已从任务看板删除该任务；历史执行记录继续保留。",
        now,
      );
    });
    return this.getTeamWorkItem(input.workItemId);
  }

  public startTeamWorkItemGuidance(workItemId: string, runId: string): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status !== "running" || current.executionConversationId === null) {
      throw new Error("Only a running Team WorkItem can start a revision guidance Run.");
    }
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET active_run_id = ?, updated_at = ?
         WHERE id = ? AND status = 'running' AND active_run_id IS NULL
           AND deleted_at IS NULL`,
      ).run(runId, now, workItemId);
      if (result.changes !== 1) {
        throw new Error("Team WorkItem changed before revision guidance could start.");
      }
      this.appendTeamWorkItemEvent(
        current.teamId,
        workItemId,
        "run_started",
        "Team Lead 正在处理用户修改后的任务内容。",
        now,
      );
    });
    return this.getTeamWorkItem(workItemId);
  }

  /**
   * Requeues a terminal, non-replayable Team WorkItem only after an explicit
   * user action. Its earlier execution remains available in history while the
   * WorkItem releases the old execution binding for a fresh Run.
   */
  public publishTeamWorkItem(workItemId: string): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status === "queued") return current;
    if (
      current.status !== "blocked"
      && current.status !== "failed"
      && current.status !== "cancelled"
    ) {
      throw new Error("Only a queued, blocked, failed, or cancelled Team WorkItem can be published.");
    }
    if (current.activeRunId !== null) {
      throw new Error("The Team WorkItem still has an active Run and cannot be published again.");
    }
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET status = 'queued', execution_conversation_id = NULL, active_run_id = NULL,
             result_summary = NULL, accepted_criteria_json = '[]', blocked_reason = NULL,
             completed_at = NULL, revision = revision + 1, updated_at = ?
         WHERE id = ? AND status IN ('blocked', 'failed', 'cancelled') AND active_run_id IS NULL`,
      ).run(now, workItemId);
      if (result.changes !== 1) {
        throw new Error("Team WorkItem changed before it could be published.");
      }
      this.appendTeamWorkItemEvent(
        current.teamId,
        workItemId,
        "scheduled",
        "用户已重新发布任务，等待团队调度。",
        now,
      );
    });
    return this.getTeamWorkItem(workItemId);
  }

  /**
   * Changes the policy future Team Runs inherit without retroactively changing
   * an in-flight Run or approving an already displayed tool request.
   */
  public updateTeamWorkItemPermission(
    rawInput: UpdateTeamWorkItemPermissionInput,
  ): TeamWorkItemView {
    const input = updateTeamWorkItemPermissionInputSchema.parse(rawInput);
    const current = this.getTeamWorkItem(input.workItemId);
    if (current.status === "completed" || current.status === "cancelled" || current.status === "failed") {
      throw new Error("A completed Team WorkItem cannot change its execution permission.");
    }
    if (current.permissionMode === input.permissionMode) return current;
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET permission_mode = ?, updated_at = ?
         WHERE id = ?`,
      ).run(input.permissionMode, now, input.workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem permission could not be saved.");
      this.appendTeamWorkItemEvent(
        current.teamId,
        input.workItemId,
        "updated",
        "用户更新了团队执行权限；当前 Run 保持原策略，后续执行将使用新策略。",
        now,
      );
    });
    return this.getTeamWorkItem(input.workItemId);
  }

  /**
   * Keeps a managed member Conversation visually and behaviorally aligned with
   * an ordinary Conversation without letting a renderer rewrite an active Run.
   */
  public updateTeamWorkItemModelSelection(
    workItemId: string,
    conversationId: string,
    rawSelection: ConversationModelSelection,
  ): ConversationSummary {
    const selection = conversationModelSelectionSchema.parse(rawSelection);
    const workItem = this.getTeamWorkItem(workItemId);
    if (workItem.status === "completed" || workItem.status === "cancelled" || workItem.status === "failed") {
      throw new Error("A completed Team WorkItem cannot change its execution model.");
    }
    const conversation = this.getConversation(conversationId);
    if (!this.isConversationInTeamWorkItemExecution(conversation.id, workItemId)) {
      throw new Error("The Conversation is not owned by the requested Team WorkItem.");
    }
    const workItemSelectionMatches = workItem.modelSelection.providerId === selection.providerId
      && workItem.modelSelection.modelId === selection.modelId
      && JSON.stringify(workItem.modelSelection.reasoning) === JSON.stringify(selection.reasoning);
    const conversationSelectionMatches = conversation.modelSelection?.providerId === selection.providerId
      && conversation.modelSelection.modelId === selection.modelId
      && JSON.stringify(conversation.modelSelection.reasoning) === JSON.stringify(selection.reasoning);
    if (workItemSelectionMatches && conversationSelectionMatches) return conversation;

    const now = new Date().toISOString();
    this.withTransaction(() => {
      const workItemUpdate = this.database.prepare(
        `UPDATE team_work_items
         SET model_selection_json = ?, updated_at = ?
         WHERE id = ?`,
      ).run(JSON.stringify(selection), now, workItemId);
      if (workItemUpdate.changes !== 1) throw new Error("Team WorkItem model could not be saved.");
      const conversationUpdate = this.database.prepare(
        `UPDATE conversations
         SET selected_provider_id = ?, selected_model_id = ?, selected_reasoning_json = ?,
             updated_at = ?
         WHERE id = ? AND deletion_pending = 0`,
      ).run(
        selection.providerId,
        selection.modelId,
        selection.reasoning === null ? null : JSON.stringify(selection.reasoning),
        now,
        conversationId,
      );
      if (conversationUpdate.changes !== 1) {
        throw new Error("Team member Conversation model could not be saved.");
      }
      this.appendTeamWorkItemEvent(
        workItem.teamId,
        workItemId,
        "updated",
        "用户更新了团队执行模型和思考程度；当前 Run 保持原快照，后续执行将使用新选择。",
        now,
      );
    });
    return this.getConversation(conversationId);
  }

  public getTeamWorkItem(workItemId: string): TeamWorkItemView {
    const row = this.database
      .prepare("SELECT * FROM team_work_items WHERE id = ?")
      .get(workItemId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Team WorkItem was not found.");
    return this.toTeamWorkItem(row);
  }

  public isManagedTeamWorkItemConversation(conversationId: string): boolean {
    return this.getTeamExecutionConversationIdForParticipant(conversationId) !== null
      || this.database
        .prepare("SELECT 1 FROM team_work_items WHERE execution_conversation_id = ? LIMIT 1")
        .get(conversationId) !== undefined;
  }

  /** Whether a Conversation belongs below a WorkItem's Team Lead execution root. */
  public isTeamWorkItemExecutionTreeConversation(conversationId: string): boolean {
    return this.database.prepare(
      `${teamWorkItemExecutionTreeCte}
       SELECT 1 FROM team_execution_tree
       WHERE conversation_id = ?
       LIMIT 1`,
    ).get(conversationId) !== undefined;
  }

  private isConversationInTeamWorkItemExecution(
    conversationId: string,
    workItemId: string,
  ): boolean {
    return this.database.prepare(
      `${teamWorkItemExecutionTreeCte}
       SELECT 1 FROM team_execution_tree
       WHERE conversation_id = ? AND work_item_id = ?
       LIMIT 1`,
    ).get(conversationId, workItemId) !== undefined;
  }

  /**
   * Returns the running WorkItem that owns a Team Lead execution Conversation.
   * AgentRuntime uses this only while delivering a Subagent result so the
   * follow-up consolidation Run retains the WorkItem's frozen execution policy.
   */
  public getRunningTeamWorkItemByExecutionConversation(
    conversationId: string,
  ): TeamWorkItemView | null {
    const row = this.database.prepare(
      `SELECT * FROM team_work_items
       WHERE execution_conversation_id = ? AND status = 'running'
       LIMIT 1`,
    ).get(conversationId) as DatabaseRow | undefined;
    return row === undefined ? null : this.toTeamWorkItem(row);
  }

  /**
   * Returns the running WorkItem for either its Team Lead Conversation or one
   * of its persisted delegated member Conversations.
   */
  public getRunningTeamWorkItemByExecutionTreeConversation(
    conversationId: string,
  ): TeamWorkItemView | null {
    const row = this.database.prepare(
      `${teamWorkItemExecutionTreeCte}
       SELECT team_work_items.*
       FROM team_work_items
       INNER JOIN team_execution_tree
         ON team_execution_tree.work_item_id = team_work_items.id
       WHERE team_execution_tree.conversation_id = ?
         AND team_work_items.status = 'running'
       LIMIT 1`,
    ).get(conversationId) as DatabaseRow | undefined;
    return row === undefined ? null : this.toTeamWorkItem(row);
  }

  public listTeamWorkItems(
    input: { projectId?: string | undefined; teamId?: string | undefined } = {},
  ): TeamWorkItemView[] {
    const clauses: string[] = ["deleted_at IS NULL"];
    const values: string[] = [];
    if (input.teamId !== undefined) {
      clauses.push("team_id = ?");
      values.push(input.teamId);
    }
    if (input.projectId !== undefined) {
      clauses.push("project_id = ?");
      values.push(input.projectId);
    }
    const rows = this.database.prepare(
      `SELECT * FROM team_work_items WHERE ${clauses.join(" AND ")}
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                created_at ASC, rowid ASC`,
    ).all(...values) as DatabaseRow[];
    return rows.map((row) => this.toTeamWorkItem(row));
  }

  /**
   * Reads the durable Team Lead and member conversations for one WorkItem.
   * Member participation is proved by the Team mapping and each routed Agent
   * message is retained as an assignment record; ordinary side chats are not
   * included merely because they share a parent Conversation.
   */
  public getTeamWorkItemExecution(workItemId: string): TeamWorkItemExecutionView {
    const workItemRow = this.database.prepare(
      "SELECT execution_conversation_id FROM team_work_items WHERE id = ?",
    ).get(workItemId) as DatabaseRow | undefined;
    if (workItemRow === undefined) throw new Error("Team WorkItem was not found.");
    const executionConversationId = asNullableString(workItemRow, "execution_conversation_id");
    const projectableConversationIds = new Set(this.listProjectableConversationIds());
    if (
      executionConversationId === null
      || !projectableConversationIds.has(executionConversationId)
    ) {
      return teamWorkItemExecutionViewSchema.parse({ agents: [], workItemId });
    }

    const assignments = new Map(
      (this.database.prepare(
        `SELECT member_conversation_id, message_id, title
         FROM team_work_item_member_assignments
         WHERE work_item_id = ?
         ORDER BY created_at DESC, rowid DESC`,
      ).all(workItemId) as DatabaseRow[]).map((row) => [
        asString(row, "member_conversation_id"),
        {
          id: asString(row, "message_id"),
          title: asString(row, "title"),
        },
      ]),
    );
    const agents: TeamWorkItemExecutionView["agents"] = [];
    const visitedConversationIds = new Set<string>();
    const pending = [{
      conversationId: executionConversationId,
      delegation: null as TeamWorkItemExecutionView["agents"][number]["delegation"],
      depth: 0,
    }];

    while (pending.length > 0) {
      const current = pending.shift();
      if (current === undefined || visitedConversationIds.has(current.conversationId)) continue;
      visitedConversationIds.add(current.conversationId);
      if (!projectableConversationIds.has(current.conversationId)) continue;
      const conversation = this.getConversation(current.conversationId);
      agents.push({
        agent: this.getConversationAgentBinding(conversation.id),
        conversation,
        delegation: current.delegation,
        depth: current.depth,
      });

      const persistentMembers = this.listTeamMemberConversations(conversation.id);
      for (const member of persistentMembers) {
        const assignment = assignments.get(member.id);
        pending.push({
          conversationId: member.id,
          delegation: assignment === undefined
            ? null
            : {
              id: assignment.id,
              status: member.activeRunId !== null ? "running" : member.lastRunStatus ?? "queued",
              title: assignment.title,
            },
          depth: current.depth + 1,
        });
      }
      for (const task of this.listSubagentTasks(conversation.id)) {
        pending.push({
          conversationId: task.childConversationId,
          delegation: {
            id: task.id,
            status: task.status,
            title: task.title,
          },
          depth: current.depth + 1,
        });
      }
    }

    return teamWorkItemExecutionViewSchema.parse({ agents, workItemId });
  }

  /**
   * Publishes a complete collaboration-plan revision for the running WorkItem
   * owned by the calling Team Lead. Routes are advisory: message delivery does
   * not consult this table and therefore remains available for plan deviations.
   */
  public setTeamCollaborationPlan(
    rawInput: SetTeamCollaborationPlanInput,
  ): TeamCollaborationProjection {
    const input = setTeamCollaborationPlanInputSchema.parse(rawInput);
    const workItem = this.getRunningTeamWorkItemByExecutionTreeConversation(
      input.createdByConversationId,
    );
    if (
      workItem === null
      || workItem.executionConversationId !== input.createdByConversationId
      || this.getConversation(input.createdByConversationId).threadKind !== "team_lead"
    ) {
      throw new Error("Only the current WorkItem Team Lead can publish its collaboration plan.");
    }

    const execution = this.getTeamWorkItemExecution(workItem.id);
    const participants = new Map(
      execution.agents.map((participant) => [participant.conversation.id, participant]),
    );
    for (const route of input.routes) {
      if (
        !participants.has(route.fromConversationId)
        || !participants.has(route.toConversationId)
      ) {
        throw new Error("Collaboration routes may reference only participants in the current WorkItem.");
      }
    }
    const plannedConversationIds = new Set<string>([input.createdByConversationId]);
    for (const route of input.routes) {
      plannedConversationIds.add(route.fromConversationId);
      plannedConversationIds.add(route.toConversationId);
    }
    const plannedParticipants = execution.agents.filter((participant) => (
      plannedConversationIds.has(participant.conversation.id)
    ));

    const now = new Date().toISOString();
    const planId = randomUUID();
    this.withTransaction(() => {
      const revisionRow = this.database.prepare(
        "SELECT COALESCE(MAX(revision), 0) AS revision FROM team_collaboration_plans WHERE work_item_id = ?",
      ).get(workItem.id) as DatabaseRow;
      const revision = asNumber(revisionRow, "revision") + 1;
      this.database.prepare(
        `UPDATE team_collaboration_plans
         SET status = 'superseded', superseded_at = ?
         WHERE work_item_id = ? AND status = 'active'`,
      ).run(now, workItem.id);
      this.database.prepare(
        `INSERT INTO team_collaboration_plans (
          id, work_item_id, revision, status, created_by_conversation_id,
          reason, created_at, activated_at, superseded_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, NULL)`,
      ).run(
        planId,
        workItem.id,
        revision,
        input.createdByConversationId,
        input.reason,
        now,
        now,
      );

      const participantsByDepth = new Map<number, typeof plannedParticipants>();
      for (const participant of plannedParticipants) {
        const depthParticipants = participantsByDepth.get(participant.depth) ?? [];
        depthParticipants.push(participant);
        participantsByDepth.set(participant.depth, depthParticipants);
      }
      const nodeIds = new Map<string, string>();
      const insertNode = this.database.prepare(
        `INSERT INTO team_collaboration_plan_nodes (
          id, plan_id, stable_agent_id, conversation_id, kind, name_snapshot,
          role_snapshot, position_x, position_y, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const participant of plannedParticipants) {
        const siblings = participantsByDepth.get(participant.depth) ?? [participant];
        const siblingIndex = Math.max(0, siblings.findIndex(
          (candidate) => candidate.conversation.id === participant.conversation.id,
        ));
        const nodeId = randomUUID();
        nodeIds.set(participant.conversation.id, nodeId);
        insertNode.run(
          nodeId,
          planId,
          participant.agent?.id ?? null,
          participant.conversation.id,
          participant.depth === 0
            ? "team_lead"
            : participant.conversation.threadKind === "subagent" ? "ephemeral" : "standing",
          participant.agent?.name ?? participant.conversation.title,
          participant.agent?.role ?? (participant.depth === 0 ? "Team Lead" : "团队成员"),
          120 + participant.depth * 240,
          90 + siblingIndex * 120,
          now,
        );
      }

      const insertRoute = this.database.prepare(
        `INSERT INTO team_collaboration_plan_routes (
          id, plan_id, from_node_id, to_node_id, purposes_json, optional, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)`,
      );
      for (const route of input.routes) {
        const fromNodeId = nodeIds.get(route.fromConversationId);
        const toNodeId = nodeIds.get(route.toConversationId);
        if (fromNodeId === undefined || toNodeId === undefined) {
          throw new Error("A collaboration-plan participant disappeared while publishing the plan.");
        }
        insertRoute.run(
          randomUUID(),
          planId,
          fromNodeId,
          toNodeId,
          JSON.stringify([route.purpose]),
          now,
        );
      }
    });

    return this.getTeamCollaborationProjection(workItem.id);
  }

  /** Associates an already committed Agent message with its running WorkItem. */
  public recordTeamCollaborationMessage(input: {
    message: ConversationAgentMessageItem;
    workItemId: string;
  }): void {
    if (
      !this.isConversationInTeamWorkItemExecution(
        input.message.senderConversationId,
        input.workItemId,
      )
      || !this.isConversationInTeamWorkItemExecution(
        input.message.conversationId,
        input.workItemId,
      )
    ) return;
    this.database.prepare(
      "UPDATE conversation_agent_messages SET work_item_id = ? WHERE id = ? AND work_item_id IS NULL",
    ).run(input.workItemId, input.message.id);
  }

  /** Persists the last visible Assistant excerpt for exactly one WorkItem participant. */
  public recordTeamCollaborationOutput(input: {
    content: string;
    conversationId: string;
    runId: string;
    workItemId: string;
  }): void {
    if (!this.isConversationInTeamWorkItemExecution(input.conversationId, input.workItemId)) {
      return;
    }
    const content = collaborationOutputExcerpt(input.content);
    if (content === null) return;
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO team_work_item_collaboration_outputs
         (work_item_id, conversation_id, run_id, content, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(work_item_id, conversation_id) DO UPDATE SET
         run_id = excluded.run_id,
         content = excluded.content,
         updated_at = excluded.updated_at`,
    ).run(input.workItemId, input.conversationId, input.runId, content, now);
  }

  /** Builds the single renderer projection from persisted plan and message facts. */
  public getTeamCollaborationProjection(workItemId: string): TeamCollaborationProjection {
    const workItem = this.getTeamWorkItem(workItemId);
    const execution = this.getTeamWorkItemExecution(workItemId);
    return this.collaborationProjection.read(workItem, execution);
  }

  /**
   * Claims a queued WorkItem before its first Team Lead Run is written. This
   * makes a process stop between Conversation creation and Run scheduling
   * recover as a blocked WorkItem instead of creating or replaying a second
   * execution root on the next launch.
   */
  public reserveTeamWorkItemExecution(
    workItemId: string,
    conversationId: string,
  ): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status !== "queued" || current.executionConversationId !== null) {
      throw new Error("Only an unclaimed queued Team WorkItem can reserve an execution Conversation.");
    }
    this.getConversation(conversationId);
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET execution_conversation_id = ?, status = 'planned', updated_at = ?
         WHERE id = ? AND status = 'queued' AND execution_conversation_id IS NULL`,
      ).run(conversationId, now, workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem changed before its execution Conversation could be reserved.");
      this.appendTeamWorkItemEvent(
        current.teamId,
        workItemId,
        "planned",
        "Team Lead 执行对话已创建，等待首个 Run 调度。",
        now,
      );
    });
    return this.getTeamWorkItem(workItemId);
  }

  public startTeamWorkItem(
    workItemId: string,
    conversationId: string,
    runId: string,
  ): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status !== "queued" && current.status !== "planned") {
      throw new Error("Only queued Team WorkItems can start.");
    }
    if (
      current.executionConversationId !== null
      && current.executionConversationId !== conversationId
    ) {
      throw new Error("Team WorkItem execution Conversation changed before its Run could start.");
    }
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET execution_conversation_id = ?, active_run_id = ?, status = 'running', updated_at = ?
         WHERE id = ? AND status IN ('queued', 'planned')
           AND (execution_conversation_id IS NULL OR execution_conversation_id = ?)`,
      ).run(conversationId, runId, now, workItemId, conversationId);
      if (result.changes !== 1) throw new Error("Team WorkItem changed before it could start.");
      this.appendTeamWorkItemEvent(current.teamId, workItemId, "run_started", "团队执行对话已启动。", now);
    });
    return this.getTeamWorkItem(workItemId);
  }

  /**
   * Starts the Team Lead's next coordination Run after a member result while
   * retaining the WorkItem's frozen execution policy.
   */
  public createTeamWorkItemContinuationRun(input: {
    conversationId: string;
    executionSnapshot?: RunExecutionSnapshot;
    modelId: string;
    workItemId: string;
  }): AgentMessageRunCreation {
    const current = this.getTeamWorkItem(input.workItemId);
    if (
      current.status !== "running"
      || current.executionConversationId !== input.conversationId
      || current.activeRunId !== null
    ) {
      throw new Error("The Team WorkItem is not ready for a coordination Run.");
    }
    this.getConversation(input.conversationId);
    this.assertNoActiveRun(input.conversationId);
    const now = new Date().toISOString();
    const runId = randomUUID();

    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs
             (id, conversation_id, model_id, status, error, created_at, updated_at,
              execution_snapshot_json)
           VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`
        )
        .run(
          runId,
          input.conversationId,
          input.modelId,
          now,
          now,
          serializeRunExecutionSnapshot(input.executionSnapshot),
        );
      this.database
        .prepare(
          "UPDATE conversations SET updated_at = ?, has_unread_result = 0 WHERE id = ?"
        )
        .run(now, input.conversationId);
      const result = this.database
        .prepare(
          `UPDATE team_work_items
           SET active_run_id = ?, updated_at = ?
           WHERE id = ? AND status = 'running'
             AND execution_conversation_id = ? AND active_run_id IS NULL`,
        )
        .run(runId, now, input.workItemId, input.conversationId);
      if (result.changes !== 1) {
        throw new Error("The Team WorkItem changed before coordination could start.");
      }
      this.appendTeamWorkItemEvent(
        current.teamId,
        input.workItemId,
        "run_started",
        "团队成员消息已送达，正在继续协调执行。",
        now,
      );
    });

    return {
      conversation: this.getConversation(input.conversationId),
      runId,
    };
  }

  public failTeamWorkItemBeforeRun(workItemId: string, error: string): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status !== "queued" && current.status !== "planned") return current;
    const now = new Date().toISOString();
    const detail = error.trim().slice(0, 4_000) || "团队执行对话启动失败。";
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items SET status = 'failed', blocked_reason = ?, updated_at = ?
         WHERE id = ? AND status IN ('queued', 'planned')`,
      ).run(detail, now, workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem changed before start failure was recorded.");
      this.appendTeamWorkItemEvent(current.teamId, workItemId, "failed", detail, now);
    });
    return this.getTeamWorkItem(workItemId);
  }

  /** Records a non-replayable managed execution failure without changing its history. */
  public blockTeamWorkItem(workItemId: string, reason: string): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status !== "running") return current;
    const now = new Date().toISOString();
    const detail = reason.trim().slice(0, 4_000) || "团队执行需要人工处理。";
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET active_run_id = NULL, status = 'blocked', blocked_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'running'`,
      ).run(detail, now, workItemId);
      if (result.changes !== 1) {
        throw new Error("The Team WorkItem changed before it could be blocked.");
      }
      this.appendTeamWorkItemEvent(current.teamId, workItemId, "blocked", detail, now);
    });
    return this.getTeamWorkItem(workItemId);
  }

  public finishTeamWorkItemRun(input: {
    conversationId: string;
    error: string | null;
    resultSummary: string | null;
    runId: string;
    status: "cancelled" | "completed" | "failed";
    workItemId: string;
  }): TeamWorkItemView {
    const current = this.getTeamWorkItem(input.workItemId);
    if (
      current.activeRunId !== input.runId
      || current.executionConversationId !== input.conversationId
    ) return current;
    const activeSubagentCount = input.status === "completed"
      ? this.countActiveSubagentTasksInExecutionTree(input.conversationId)
      : 0;
    const activeMemberCount = input.status === "completed"
      ? this.countActiveTeamMemberRuns(input.conversationId)
      : 0;
    const unreadAgentMessageCount = input.status === "completed"
      ? this.listUnreadAgentMessages(input.conversationId).length
      : 0;
    const now = new Date().toISOString();
    if (activeSubagentCount > 0 || activeMemberCount > 0 || unreadAgentMessageCount > 0) {
      this.withTransaction(() => {
        const result = this.database.prepare(
          `UPDATE team_work_items
           SET active_run_id = NULL, result_summary = NULL, blocked_reason = NULL, updated_at = ?
           WHERE id = ? AND status = 'running' AND active_run_id = ?`,
        ).run(now, input.workItemId, input.runId);
        if (result.changes !== 1) {
          throw new Error("Team WorkItem run changed before it could await Subagents.");
        }
        this.appendTeamWorkItemEvent(
          current.teamId,
          input.workItemId,
        "task_updated",
          activeMemberCount > 0
            ? `Team Lead 已完成当前步骤，正在等待 ${activeMemberCount} 位团队成员交付。`
            : activeSubagentCount > 0
            ? `Team Lead 已完成当前步骤，正在等待 ${activeSubagentCount} 个旧版一次性任务交付。`
            : `正在等待 Team Lead 汇总 ${unreadAgentMessageCount} 条已送达的成员结果。`,
          now,
        );
      });
      return this.getTeamWorkItem(input.workItemId);
    }
    const nextStatus: TeamWorkItemStatus = input.status === "completed"
      ? "waiting_user"
      : input.status === "cancelled"
        ? "cancelled"
        : "failed";
    const eventType = input.status === "completed"
      ? "review_ready"
      : input.status === "cancelled"
        ? "cancelled"
        : "failed";
    const detail = input.status === "completed"
      ? "负责人已提交结果，等待用户验收；实际验证以成员回执与执行记录为准。"
      : input.error ?? (input.status === "cancelled" ? "执行已取消。" : "执行失败。");
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET active_run_id = NULL, status = ?, result_summary = ?, blocked_reason = ?, updated_at = ?
         WHERE id = ? AND active_run_id = ?`,
      ).run(
        nextStatus,
        input.resultSummary,
        input.status === "failed" ? detail : null,
        now,
        input.workItemId,
        input.runId,
      );
      if (result.changes !== 1) throw new Error("Team WorkItem run changed before it finished.");
      this.appendTeamWorkItemEvent(current.teamId, input.workItemId, eventType, detail, now);
    });
    return this.getTeamWorkItem(input.workItemId);
  }

  private countActiveTeamMemberRuns(teamExecutionConversationId: string): number {
    const row = this.database.prepare(
      `SELECT COUNT(*) AS count
       FROM team_member_conversations
       INNER JOIN runs
         ON runs.conversation_id = team_member_conversations.conversation_id
        AND runs.status IN ('queued', 'running')
       WHERE team_member_conversations.team_execution_conversation_id = ?`,
    ).get(teamExecutionConversationId) as DatabaseRow;
    return asNumber(row, "count");
  }

  public startTeamWorkItemRework(workItemId: string, runId: string, feedback: string): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (
      (current.status !== "waiting_user" && current.status !== "completed")
      || current.executionConversationId === null
    ) {
      throw new Error("Only a WorkItem waiting for acceptance or already completed can be reworked.");
    }
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET active_run_id = ?, status = 'running', revision = revision + 1,
             result_summary = NULL, accepted_criteria_json = '[]', blocked_reason = NULL,
             completed_at = NULL, updated_at = ?
         WHERE id = ? AND status IN ('waiting_user', 'completed')`,
      ).run(runId, now, workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem changed before rework started.");
      this.appendTeamWorkItemEvent(
        current.teamId,
        workItemId,
        "rework_requested",
        `用户要求返工：${feedback.slice(0, 1_500)}`,
        now,
      );
    });
    return this.getTeamWorkItem(workItemId);
  }

  public addTeamWorkItemComment(rawInput: AddTeamWorkItemCommentInput): TeamWorkItemView {
    const input = addTeamWorkItemCommentInputSchema.parse(rawInput);
    const current = this.getTeamWorkItem(input.workItemId);
    const now = new Date().toISOString();
    this.withTransaction(() => {
      this.appendTeamWorkItemEvent(
        current.teamId,
        input.workItemId,
        "commented",
        input.content,
        now,
      );
      this.database.prepare(
        "UPDATE team_work_items SET updated_at = ? WHERE id = ?",
      ).run(now, input.workItemId);
    });
    return this.getTeamWorkItem(input.workItemId);
  }

  public acceptTeamWorkItem(input: AcceptTeamWorkItemInput): TeamWorkItemView {
    const current = this.getTeamWorkItem(input.workItemId);
    if (current.status !== "waiting_user") {
      throw new Error("Only a WorkItem waiting for user acceptance can be completed.");
    }
    if (
      current.acceptanceCriteria.length !== input.acceptedCriteria.length
      || current.acceptanceCriteria.some((criterion) => !input.acceptedCriteria.includes(criterion))
    ) {
      throw new Error("Every acceptance criterion must be explicitly confirmed before completion.");
    }
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET status = 'completed', accepted_criteria_json = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'waiting_user'`,
      ).run(JSON.stringify(input.acceptedCriteria), now, now, input.workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem changed before acceptance.");
      this.appendTeamWorkItemEvent(current.teamId, input.workItemId, "accepted", "用户已逐项验收通过，工作项已完成。", now);
    });
    return this.getTeamWorkItem(input.workItemId);
  }

  public blockInterruptedTeamWorkItems(): number {
    const rows = this.database.prepare(
      `SELECT id, team_id, status, execution_conversation_id
       FROM team_work_items
       WHERE execution_conversation_id IS NOT NULL`,
    ).all() as DatabaseRow[];
    if (rows.length === 0) return 0;
    const now = new Date().toISOString();
    let blockedCount = 0;
    this.withTransaction(() => {
      for (const row of rows) {
        const id = asString(row, "id");
        const teamId = asString(row, "team_id");
        const status = asString(row, "status");
        const executionConversationId = asString(row, "execution_conversation_id");
        const interruptedRuns = this.database.prepare(
          `UPDATE runs
           SET status = 'failed', error = ?, updated_at = ?
           WHERE conversation_id = ? AND status IN ('queued', 'running')`,
        ).run(
          "Application stopped before the managed Team WorkItem Run finished; it was not resumed.",
          now,
          executionConversationId,
        );
        if (interruptedRuns.changes > 0) {
          this.database.prepare(
            "UPDATE conversations SET has_unread_result = 1 WHERE id = ?",
          ).run(executionConversationId);
        }
        if (!["triaging", "planned", "running", "reviewing"].includes(status)) continue;
        this.database.prepare(
          `UPDATE team_work_items
           SET active_run_id = NULL, status = 'blocked', blocked_reason = ?, updated_at = ?
           WHERE id = ? AND status IN ('triaging', 'planned', 'running', 'reviewing')`,
        ).run("应用在执行过程中退出；为避免重放文件或命令副作用，任务已阻塞。", now, id);
        this.appendTeamWorkItemEvent(
          teamId,
          id,
          "blocked",
          "应用重启后未自动重放副作用，任务需要人工确认。",
          now,
        );
        blockedCount += 1;
      }
    });
    return blockedCount;
  }

  private appendTeamWorkItemEvent(
    teamId: string,
    workItemId: string,
    type: TeamWorkItemEvent["type"],
    detail: string,
    createdAt: string,
  ): void {
    const row = this.database.prepare(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM team_work_item_events WHERE team_id = ?",
    ).get(teamId) as DatabaseRow;
    const event = teamWorkItemEventSchema.parse({
      createdAt,
      detail,
      id: randomUUID(),
      sequence: asNumber(row, "next_sequence"),
      type,
    });
    this.database.prepare(
      `INSERT INTO team_work_item_events
       (id, team_id, work_item_id, sequence, type, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(event.id, teamId, workItemId, event.sequence, event.type, event.detail, event.createdAt);
  }

  private toTeamWorkItem(row: DatabaseRow): TeamWorkItemView {
    const executionConversationId = asNullableString(row, "execution_conversation_id");
    const teamInstanceId = asNullableString(row, "team_instance_id");
    const instanceRow = teamInstanceId === null
      ? undefined
      : this.database.prepare("SELECT * FROM team_instances WHERE id = ?")
        .get(teamInstanceId) as DatabaseRow | undefined;
    const instance = instanceRow === undefined ? null : this.toTeamInstance(instanceRow);
    const participantConversationIds = executionConversationId === null
      ? []
      : [
        executionConversationId,
        ...(this.database.prepare(
          `SELECT DISTINCT member_conversation_id
           FROM team_work_item_member_assignments
           WHERE work_item_id = ?
           ORDER BY created_at ASC, rowid ASC`,
        ).all(asString(row, "id")) as DatabaseRow[])
          .map((participant) => asString(participant, "member_conversation_id")),
      ];
    // Keep the full append-only audit trail in SQLite, while bounding the
    // renderer/IPC projection to the protocol's 200-event contract.
    const eventRows = this.database.prepare(
      `SELECT id, sequence, type, detail, created_at
       FROM (
         SELECT id, sequence, type, detail, created_at
         FROM team_work_item_events
         WHERE work_item_id = ?
         ORDER BY sequence DESC
         LIMIT 200
       )
       ORDER BY sequence ASC`,
    ).all(asString(row, "id")) as DatabaseRow[];
    const tasks = executionConversationId === null
      || !this.isConversationProjectable(executionConversationId)
      ? []
      : this.getTaskList(executionConversationId)?.tasks ?? [];
    return teamWorkItemViewSchema.parse({
      acceptanceCriteria: parseJson(asString(row, "acceptance_criteria_json"), "Team WorkItem acceptance criteria"),
      acceptedCriteria: parseJson(asString(row, "accepted_criteria_json"), "Team WorkItem accepted criteria"),
      activeRunId: asNullableString(row, "active_run_id"),
      blockedReason: asNullableString(row, "blocked_reason"),
      completedAt: asNullableString(row, "completed_at"),
      createdAt: asString(row, "created_at"),
      events: eventRows.map((eventRow) => ({
        createdAt: asString(eventRow, "created_at"),
        detail: asString(eventRow, "detail"),
        id: asString(eventRow, "id"),
        sequence: asNumber(eventRow, "sequence"),
        type: asString(eventRow, "type"),
      })),
      executionConversationId,
      executionScope: asString(row, "execution_scope"),
      id: asString(row, "id"),
      ...(instance === null ? {} : { instanceName: instance.name }),
      modelSelection: parseJson(asString(row, "model_selection_json"), "Team WorkItem model selection"),
      participantConversationIds,
      permissionMode: asString(row, "permission_mode"),
      priority: asString(row, "priority"),
      projectId: asNullableString(row, "project_id"),
      requirement: asString(row, "requirement"),
      resultSummary: asNullableString(row, "result_summary"),
      revision: asNumber(row, "revision"),
      sourceConversationId: asNullableString(row, "source_conversation_id"),
      status: asString(row, "status"),
      tasks,
      teamId: asString(row, "team_id"),
      ...(teamInstanceId === null ? {} : { teamInstanceId }),
      title: asString(row, "title"),
      updatedAt: asString(row, "updated_at"),
    });
  }

  private toTeamInstance(row: DatabaseRow): TeamInstanceView {
    return teamInstanceViewSchema.parse({
      createdAt: asString(row, "created_at"),
      id: asString(row, "id"),
      isArchived: asNullableString(row, "archived_at") !== null,
      name: asString(row, "name"),
      projectId: asNullableString(row, "project_id"),
      rootConversationId: asNullableString(row, "root_conversation_id"),
      scope: asString(row, "scope"),
      sourceConversationId: asNullableString(row, "source_conversation_id"),
      teamId: asString(row, "team_id"),
      updatedAt: asString(row, "updated_at"),
    });
  }

  private isConversationProjectable(conversationId: string): boolean {
    return this.database
      .prepare(
        "SELECT 1 AS present FROM conversations WHERE id = ? AND deletion_pending = 0 LIMIT 1",
      )
      .get(conversationId) !== undefined;
  }

  public createConversation(
    projectId: string | null,
    options: Omit<CreateConversationInput, "projectId"> = {}
  ): ConversationSummary {
    return this.persistPreparedConversation(this.prepareConversationCreation(projectId, options));
  }

  public prepareConversationCreation(
    projectId: string | null,
    options: Omit<CreateConversationInput, "projectId"> = {},
  ): PreparedConversationCreation {
    if (projectId !== null) {
      this.assertProjectExists(projectId);
    }
    const parent = options.parentConversationId === undefined
      ? null
      : this.getConversation(options.parentConversationId);
    if (parent !== null) {
      if (parent.isArchived) {
        throw new Error("A Team execution conversation cannot have an archived parent.");
      }
      const isTeamLeadFromSource = options.threadKind === "team_lead"
        && parent.projectId === projectId
        && parent.parentConversationId === null
        && parent.threadKind === "agent"
        && parent.teamWorkItemId === null;
      const isPersistentMemberFromLead = options.threadKind === "agent"
        && parent.projectId === projectId
        && parent.threadKind === "team_lead"
        && parent.teamId !== null
        && options.teamId === parent.teamId;
      if (!isTeamLeadFromSource && !isPersistentMemberFromLead) {
        throw new Error("A Team execution child must be either a Team Lead or one of its persistent members.");
      }
    }
    const countRow = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM conversations
         WHERE project_id IS ? AND parent_conversation_id IS NULL AND deletion_pending = 0`
      )
      .get(projectId) as DatabaseRow;
    const count = Number(countRow.count);
    const now = new Date().toISOString();
    const agent = options.agent ?? null;
    const conversation = conversationSummarySchema.parse({
      activeSubagentCount: 0,
      activeRunId: null,
      agentId: agent?.id ?? null,
      archivedAt: null,
      avatarIcon: agent?.avatarIcon ?? null,
      createdAt: now,
      hasUnreadResult: false,
      id: randomUUID(),
      lastRunStatus: null,
      modelSelection: options.modelSelection ?? null,
      parentConversationId: parent?.id ?? null,
      permissionMode: "ask_before_changes",
      coordinationMode: "direct",
      pinOrder: null,
      projectId,
      subagentTaskStatus: null,
      teamId: options.teamId ?? null,
      teamWorkItemId: null,
      threadKind: options.threadKind ?? "agent",
      title: count === 0 ? "新会话" : `新会话 ${count + 1}`,
      updatedAt: now,
      workspaceRootPath: null
    });
    return { agent, conversation };
  }

  public projectConversationCreated(
    creation: PreparedConversationCreation,
  ): ConversationSummary {
    if (this.hasConversation(creation.conversation.id)) {
      return this.getConversation(creation.conversation.id);
    }
    this.assertProjectExistsWhenPresent(creation.conversation.projectId);
    return this.persistPreparedConversation(creation);
  }

  public hasConversation(conversationId: string): boolean {
    return this.database
      .prepare("SELECT 1 AS present FROM conversations WHERE id = ? LIMIT 1")
      .get(conversationId) !== undefined;
  }

  private persistPreparedConversation(
    creation: PreparedConversationCreation,
  ): ConversationSummary {
    const { agent, conversation } = creation;
    this.database
        .prepare(
          `INSERT INTO conversations
            (id, project_id, parent_conversation_id, workspace_root_path,
             selected_provider_id, selected_model_id, selected_reasoning_json,
             permission_mode, coordination_mode,
             thread_kind, agent_id, avatar_icon, agent_name, agent_role, agent_is_default,
             agent_instructions, team_id, title, created_at, updated_at, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
        )
        .run(
          conversation.id,
          conversation.projectId,
          conversation.parentConversationId,
          conversation.workspaceRootPath,
          conversation.modelSelection?.providerId ?? null,
          conversation.modelSelection?.modelId ?? null,
          conversation.modelSelection === null || conversation.modelSelection.reasoning === null
            ? null
            : JSON.stringify(conversation.modelSelection.reasoning),
          conversation.permissionMode ?? "ask_before_changes",
          conversation.coordinationMode ?? "direct",
          conversation.threadKind,
          conversation.agentId,
          conversation.avatarIcon ?? null,
          agent?.name ?? null,
          agent?.role ?? null,
          Number(agent?.isDefault ?? false),
          agent?.instructions ?? null,
          conversation.teamId,
          conversation.title,
          conversation.createdAt,
          conversation.updatedAt
        );
    return conversation;
  }

  private assertProjectExistsWhenPresent(projectId: string | null): void {
    if (projectId !== null) this.assertProjectExists(projectId);
  }

  public bindConversationAgent(
    conversationId: string,
    rawAgent: ConversationAgentBinding
  ): ConversationSummary {
    const agent = conversationAgentBindingSchema.parse(rawAgent);
    const conversation = this.getConversation(conversationId);
    if (conversation.agentId !== null && conversation.agentId !== agent.id && conversation.coordinationTeamInstanceId === undefined) {
      throw new Error("This conversation is already bound to another Agent.");
    }
    this.database
      .prepare(
        `UPDATE conversations
         SET thread_kind = ?, agent_id = ?, avatar_icon = ?, agent_name = ?, agent_role = ?,
             agent_is_default = ?, agent_instructions = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        conversation.threadKind,
        agent.id,
        agent.avatarIcon ?? null,
        agent.name,
        agent.role,
        Number(agent.isDefault),
        agent.instructions,
        new Date().toISOString(),
        conversationId
      );
    return this.getConversation(conversationId);
  }

  public getConversationAgentBinding(
    conversationId: string
  ): ConversationAgentBinding | null {
    const row = this.database
      .prepare(
        `SELECT agent_id, avatar_icon, agent_name, agent_role, agent_is_default, agent_instructions
         FROM conversations WHERE id = ? AND deletion_pending = 0`
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("Conversation was not found.");
    }
    const id = asNullableString(row, "agent_id");
    if (id === null) return null;
    const avatarIcon = asNullableString(row, "avatar_icon");
    return conversationAgentBindingSchema.parse({
      ...(avatarIcon === null ? {} : { avatarIcon }),
      id,
      instructions: asNullableString(row, "agent_instructions") ?? "",
      isDefault: asBoolean(row, "agent_is_default"),
      name: asNullableString(row, "agent_name") ?? id,
      role: asNullableString(row, "agent_role") ?? ""
    });
  }

  public setConversationAvatarIcon(
    conversationId: string,
    rawAvatarIcon: unknown,
  ): ConversationSummary {
    const avatarIcon = agentAvatarIconSchema.nullable().parse(rawAvatarIcon);
    this.getConversation(conversationId);
    this.database
      .prepare("UPDATE conversations SET avatar_icon = ?, updated_at = ? WHERE id = ?")
      .run(avatarIcon, new Date().toISOString(), conversationId);
    return this.getConversation(conversationId);
  }

  public listConversationWorkspaces(): Array<{
    conversationId: string;
    rootPath: string;
  }> {
    const rows = this.database
      .prepare(
        `SELECT id, workspace_root_path
         FROM conversations
         WHERE project_id IS NULL AND workspace_root_path IS NOT NULL
           AND deletion_pending = 0
         ORDER BY created_at ASC, rowid ASC`
      )
      .all() as DatabaseRow[];
    return rows.map((row) => ({
      conversationId: asString(row, "id"),
      rootPath: asString(row, "workspace_root_path")
    }));
  }

  public setConversationWorkspaceRoot(
    conversationId: string,
    rootPath: string | null
  ): ConversationSummary {
    const conversation = this.getConversation(conversationId);
    if (conversation.projectId !== null) {
      throw new Error("Project conversations already use their project root.");
    }
    this.assertNoActiveRun(conversationId);
    if (rootPath !== null && rootPath.trim().length === 0) {
      throw new Error("Conversation workspace path cannot be empty.");
    }
    this.database
      .prepare(
        "UPDATE conversations SET workspace_root_path = ?, updated_at = ? WHERE id = ?"
      )
      .run(rootPath, new Date().toISOString(), conversationId);
    return this.getConversation(conversationId);
  }

  public setConversationModelSelection(
    conversationId: string,
    rawSelection: ConversationModelSelection,
  ): ConversationSummary {
    const selection = conversationModelSelectionSchema.parse(rawSelection);
    const conversation = this.getConversation(conversationId);
    if (conversation.teamWorkItemId !== null) {
      throw new Error("Managed Team WorkItem conversations use the WorkItem's frozen model selection.");
    }
    this.database
      .prepare(
        `UPDATE conversations
         SET selected_provider_id = ?, selected_model_id = ?, selected_reasoning_json = ?,
             updated_at = ?
         WHERE id = ? AND deletion_pending = 0`
      )
      .run(
        selection.providerId,
        selection.modelId,
        selection.reasoning === null ? null : JSON.stringify(selection.reasoning),
        new Date().toISOString(),
        conversationId,
      );
    return this.getConversation(conversationId);
  }

  public getConversationSortOrder(conversationId: string): number {
    const row = this.database
      .prepare(
        "SELECT sort_order FROM conversations WHERE id = ? AND deletion_pending = 0",
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Conversation was not found.");
    return asNumber(row, "sort_order");
  }

  public setConversationPermissionMode(
    conversationId: string,
    rawPermissionMode: unknown,
    rawCoordinationMode?: unknown,
  ): ConversationSummary {
    const permissionMode = conversationPermissionModeSchema.parse(rawPermissionMode);
    const conversation = this.getConversation(conversationId);
    const requestedMode = conversationSummarySchema.shape.coordinationMode.parse(rawCoordinationMode);
    const coordinationMode = permissionMode !== "full_access" ? "direct"
      : requestedMode ?? conversation.coordinationMode ?? "direct";
    if (rawCoordinationMode === "parallel_queue" && permissionMode !== "full_access") throw new Error("快速协作模式需要完全访问权限。");
    if (coordinationMode === "parallel_queue" && (conversation.threadKind !== "agent" || conversation.parentConversationId !== null || conversation.teamId !== null || conversation.isArchived)) {
      throw new Error("快速协作模式仅适用于普通主对话。");
    }
    if (coordinationMode === "parallel_queue" && conversation.coordinationMode !== "parallel_queue" && conversation.activeRunId !== null) {
      throw new Error("请在当前执行结束后启用快速协作模式。");
    }
    if (conversation.permissionMode === permissionMode && conversation.coordinationMode === coordinationMode) return conversation;
    this.database
      .prepare(
        `UPDATE conversations
         SET permission_mode = ?, coordination_mode = ?, updated_at = ?
         WHERE id = ? AND deletion_pending = 0`,
      )
      .run(permissionMode, coordinationMode ?? "direct", new Date().toISOString(), conversationId);
    return this.getConversation(conversationId);
  }

  public forkConversation(
    sourceConversationId: string,
    kind: "side" | "sibling" | "subagent" = "subagent",
    throughMessageId?: string,
  ): ConversationSummary {
    const source = this.getConversation(sourceConversationId);
    const forkBoundary = throughMessageId === undefined
      ? null
      : this.resolveForkBoundary(sourceConversationId, throughMessageId);
    if (kind === "sibling" && forkBoundary === null) {
      throw new Error("A sibling conversation requires an assistant message boundary.");
    }
    const throughModelMessageSequence = forkBoundary?.modelMessageSequence ?? null;
    const inheritedAgent = kind === "subagent"
      ? null
      : this.getConversationAgentBinding(sourceConversationId);
    const countRow = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM conversations
         WHERE parent_conversation_id = ? AND deletion_pending = 0`
      )
      .get(sourceConversationId) as DatabaseRow;
    const count = Number(countRow.count);
    const now = new Date().toISOString();
    const parentConversationId = kind === "sibling" ? null : sourceConversationId;
    const conversation = conversationSummarySchema.parse({
      activeSubagentCount: 0,
      activeRunId: null,
      agentId: inheritedAgent?.id ?? null,
      archivedAt: null,
      avatarIcon: inheritedAgent?.avatarIcon ?? null,
      createdAt: now,
      hasUnreadResult: false,
      id: randomUUID(),
      lastRunStatus: null,
      modelSelection: source.modelSelection,
      parentConversationId,
      permissionMode: source.permissionMode ?? "ask_before_changes",
      coordinationMode: "direct",
      pinOrder: null,
      projectId: source.projectId,
      subagentTaskStatus: null,
      teamId: source.teamId,
      teamWorkItemId: null,
      threadKind: kind === "subagent" ? "subagent" : "agent",
      title: kind === "sibling"
        ? this.createSiblingForkTitle(source)
        : count === 0 ? "侧边聊天" : `侧边聊天 ${count + 1}`,
      updatedAt: now,
      workspaceRootPath: source.workspaceRootPath
    });

    return this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO conversations
             (id, project_id, parent_conversation_id, workspace_root_path,
              selected_provider_id, selected_model_id, selected_reasoning_json,
              permission_mode,
              thread_kind, agent_id, avatar_icon, agent_name, agent_role, agent_is_default,
              agent_instructions, team_id, title, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          conversation.id,
          conversation.projectId,
          parentConversationId,
          conversation.workspaceRootPath,
          conversation.modelSelection?.providerId ?? null,
          conversation.modelSelection?.modelId ?? null,
          conversation.modelSelection === null || conversation.modelSelection.reasoning === null
            ? null
            : JSON.stringify(conversation.modelSelection.reasoning),
          conversation.permissionMode ?? "ask_before_changes",
          conversation.threadKind,
          inheritedAgent?.id ?? null,
          inheritedAgent?.avatarIcon ?? null,
          inheritedAgent?.name ?? null,
          inheritedAgent?.role ?? null,
          Number(inheritedAgent?.isDefault ?? false),
          inheritedAgent?.instructions ?? null,
          conversation.teamId,
          conversation.title,
          conversation.createdAt,
          conversation.updatedAt
        );

      const sourceCheckpoint = kind === "subagent"
        ? null
        : this.getContextCheckpoint(sourceConversationId);
      const allSourceMessages: DatabaseRow[] = kind === "subagent"
        ? []
        : this.database
            .prepare(
              `SELECT sequence, run_id, role, content, tool_calls_json, tool_call_id,
                      attachment_ids_json, provider_state_json, created_at
               FROM model_messages
               WHERE conversation_id = ?
                 ${throughModelMessageSequence === null ? "" : "AND sequence <= ?"}
               ORDER BY sequence ASC`,
            )
            .all(
              sourceConversationId,
              ...(throughModelMessageSequence === null ? [] : [throughModelMessageSequence]),
            );
      const sourceMessages = kind === "side" && sourceCheckpoint !== null
        ? allSourceMessages.filter(
            (message) => asNumber(message, "sequence") >= sourceCheckpoint.coveredThroughSequence,
          )
        : allSourceMessages;
      const sourceTimelineItems = kind === "sibling" && forkBoundary !== null
        ? (this.database
            .prepare(
              `SELECT payload_json FROM conversation_timeline
               WHERE conversation_id = ? AND sequence <= ?
               ORDER BY sequence ASC`,
            )
            .all(
              sourceConversationId,
              forkBoundary.timelineSequence,
            ) as DatabaseRow[]).map((row) => conversationTimelineItemSchema.parse(
              parseJson(asString(row, "payload_json"), "timeline item"),
            ))
        : [];
      const timelineItemIdMap = new Map(
        sourceTimelineItems.map((item) => [item.id, randomUUID()]),
      );
      const runIdMap = new Map<string, string>();
      if (kind === "sibling") {
        for (const sourceRunId of [
          ...sourceMessages.map((message) => asNullableString(message, "run_id")),
          ...sourceTimelineItems.map((item) => item.runId),
        ]) {
          if (sourceRunId !== null && !runIdMap.has(sourceRunId)) {
            runIdMap.set(sourceRunId, randomUUID());
          }
        }
      }
      const forkedRunId = (sourceRunId: string | null): string | null => {
        if (sourceRunId === null || kind !== "sibling") return null;
        const copiedRunId = runIdMap.get(sourceRunId);
        if (copiedRunId === undefined) {
          throw new Error("Forked conversation Run identifier could not be mapped.");
        }
        return copiedRunId;
      };
      const inheritedAttachmentIds = new Set(
        sourceMessages.flatMap((message) => parseJson<string[]>(
          asString(message, "attachment_ids_json"),
          "model message attachment identifiers",
        )),
      );
      const screenshotIds = new Set(sourceTimelineItems.flatMap((item) => {
        const image = toolScreenshotImage(item);
        return [...(image === null ? [] : [image.id]), ...toolGeneratedImages(item).map(image => image.id)];
      }));
      const sourceAttachments = this.attachmentMetadata.listSent(sourceConversationId)
        .filter((attachment) => inheritedAttachmentIds.has(attachment.id) || screenshotIds.has(attachment.id));
      const attachmentIdMap = new Map<string, string>();
      const insertAttachment = this.database.prepare(
        `INSERT INTO conversation_attachments
           (id, conversation_id, message_id, source, kind, name, mime_type,
            size_bytes, project_path, stored_path, extracted_text_path,
            context_tokens, truncated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const attachment of sourceAttachments) {
        const copiedId = randomUUID();
        attachmentIdMap.set(attachment.id, copiedId);
        insertAttachment.run(
          copiedId,
          conversation.id,
          attachment.messageId === null
            ? null
            : timelineItemIdMap.get(attachment.messageId) ?? null,
          attachment.source,
          attachment.kind,
          attachment.name,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.projectPath,
          attachment.storedPath,
          attachment.extractedTextPath,
          attachment.contextTokens,
          Number(attachment.truncated),
          attachment.createdAt
        );
      }

      // Visible fork history is an independent snapshot. IDs are remapped so later
      // edits and forks operate only on the new conversation.
      const generatedToolResults = new Map<string, string>();
      for (const sourceItem of sourceTimelineItems) {
        const copiedId = timelineItemIdMap.get(sourceItem.id);
        if (copiedId === undefined) {
          throw new Error("Forked timeline item identifier could not be mapped.");
        }
        if (sourceItem.kind === "message") {
          this.runEvents.insertTimelineItem({
            ...sourceItem,
            attachments: sourceItem.attachments.flatMap((attachment) => {
              const copiedAttachmentId = attachmentIdMap.get(attachment.id);
              return copiedAttachmentId === undefined
                ? []
                : [{
                    ...attachment,
                    id: copiedAttachmentId,
                    messageId: copiedId,
                  }];
            }),
            conversationId: conversation.id,
            id: copiedId,
            runId: forkedRunId(sourceItem.runId),
          });
          continue;
        }
        if (sourceItem.kind === "agent_message") {
          this.runEvents.insertTimelineItem({
            ...sourceItem,
            conversationId: conversation.id,
            id: copiedId,
            readAt: sourceItem.readAt ?? now,
            runId: forkedRunId(sourceItem.runId),
            status: "read",
            taskId: null,
          });
          continue;
        }
        const copiedRunId = forkedRunId(sourceItem.runId);
        if (copiedRunId === null) {
          throw new Error("Forked tool Run identifier could not be mapped.");
        }
        this.runEvents.insertTimelineItem({
          ...sourceItem,
          conversationId: conversation.id,
          id: copiedId,
          ...(sourceItem.kind === "tool" && toolGeneratedImages(sourceItem).length > 0 ? { result: (() => {
            const result = imageGenerationResultSchema.parse(JSON.parse(sourceItem.result!));
            const content = JSON.stringify({ ...result, value: { ...result.value, images: result.value.images.map(image => ({ ...image, id: attachmentIdMap.get(image.id), conversationId: conversation.id, messageId: copiedId })) } });
            generatedToolResults.set(sourceItem.result!, content);
            return content;
          })() } : {}),
          ...(sourceItem.kind === "tool" && toolScreenshotImage(sourceItem) !== null ? {
            result: remapToolScreenshot(sourceItem, conversation.id, copiedId, attachmentIdMap),
          } : {}),
          runId: copiedRunId,
        });
      }

      const forkedMessageSequences = new Map<number, number>();
      const insertMessage = this.database.prepare(
         `INSERT INTO model_messages
            (id, conversation_id, run_id, role, content, tool_calls_json,
             tool_call_id, attachment_ids_json, provider_state_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const message of sourceMessages) {
        const result = insertMessage.run(
          randomUUID(),
          conversation.id,
          forkedRunId(asNullableString(message, "run_id")),
          asString(message, "role"),
          generatedToolResults.get(asString(message, "content")) ?? asString(message, "content"),
          asString(message, "tool_calls_json"),
          asNullableString(message, "tool_call_id"),
          JSON.stringify(
            parseJson<string[]>(
              asString(message, "attachment_ids_json"),
              "model message attachment identifiers"
            ).flatMap((attachmentId) => {
              const copiedId = attachmentIdMap.get(attachmentId);
              return copiedId === undefined ? [] : [copiedId];
            })
          ),
          asNullableString(message, "provider_state_json"),
          asString(message, "created_at")
        );
        const forkedSequence = Number(result.lastInsertRowid);
        if (!Number.isSafeInteger(forkedSequence) || forkedSequence <= 0) {
          throw new Error("Forked conversation message sequence is invalid.");
        }
        forkedMessageSequences.set(asNumber(message, "sequence"), forkedSequence);
      }

      if (
        sourceCheckpoint !== null
        && (
          throughModelMessageSequence === null
          || sourceCheckpoint.coveredThroughSequence <= throughModelMessageSequence
        )
      ) {
        const forkedCoveredThroughSequence = forkedMessageSequences.get(
          sourceCheckpoint.coveredThroughSequence
        );
        if (forkedCoveredThroughSequence === undefined) {
          throw new Error("Forked conversation checkpoint could not be mapped.");
        }
        this.saveContextCheckpoint(
          conversation.id,
          forkedCoveredThroughSequence,
          sourceCheckpoint.summary
        );
      }

      return conversation;
    });
  }

  private createSiblingForkTitle(source: ConversationSummary): string {
    const siblingRows = this.database
      .prepare(
        `SELECT title FROM conversations
         WHERE project_id IS ? AND parent_conversation_id IS NULL
           AND deletion_pending = 0`,
      )
      .all(source.projectId) as DatabaseRow[];
    const prefix = `${source.title} (`;
    let highestSuffix = 0;
    for (const row of siblingRows) {
      const title = asString(row, "title");
      if (!title.startsWith(prefix) || !title.endsWith(")")) continue;
      const suffix = title.slice(prefix.length, -1);
      if (!/^[1-9]\d*$/.test(suffix)) continue;
      highestSuffix = Math.max(highestSuffix, Number(suffix));
    }
    return `${source.title} (${highestSuffix + 1})`;
  }

  private resolveForkBoundary(
    sourceConversationId: string,
    throughMessageId: string,
  ): { modelMessageSequence: number; timelineSequence: number } {
    const timelineRow = this.database
      .prepare(
        `SELECT sequence, run_id, payload_json
         FROM conversation_timeline
         WHERE id = ? AND conversation_id = ? AND kind = 'message'`,
      )
      .get(throughMessageId, sourceConversationId) as DatabaseRow | undefined;
    if (timelineRow === undefined) {
      throw new Error("The fork message was not found in the source conversation.");
    }
    const targetMessage = conversationMessageItemSchema.parse(
      parseJson(asString(timelineRow, "payload_json"), "conversation message"),
    );
    if (targetMessage.role !== "assistant" || targetMessage.status !== "completed") {
      throw new Error("A conversation can only be forked from a completed assistant message.");
    }
    const runId = asNullableString(timelineRow, "run_id");
    if (runId === null) {
      throw new Error("The fork message is not associated with a model run.");
    }

    const assistantTimelineRows = this.database
      .prepare(
        `SELECT payload_json
         FROM conversation_timeline
         WHERE conversation_id = ? AND run_id = ? AND kind = 'message' AND sequence <= ?
         ORDER BY sequence ASC`,
      )
      .all(
        sourceConversationId,
        runId,
        asNumber(timelineRow, "sequence"),
      ) as DatabaseRow[];
    const targetAssistantIndex = assistantTimelineRows
      .map((row) => conversationMessageItemSchema.parse(
        parseJson(asString(row, "payload_json"), "conversation message"),
      ))
      .filter((message) => message.role === "assistant" && message.status === "completed")
      .findIndex((message) => message.id === throughMessageId);
    if (targetAssistantIndex < 0) {
      throw new Error("The fork message could not be mapped to its model context.");
    }

    const assistantModelRows = this.database
      .prepare(
        `SELECT sequence, content
         FROM model_messages
         WHERE conversation_id = ? AND run_id = ? AND role = 'assistant' AND content <> ''
         ORDER BY sequence ASC`,
      )
      .all(sourceConversationId, runId) as DatabaseRow[];
    const targetModelRow = assistantModelRows[targetAssistantIndex];
    if (
      targetModelRow === undefined
      || asString(targetModelRow, "content") !== targetMessage.content
    ) {
      throw new Error("The fork message could not be mapped to its model context.");
    }
    const targetModelSequence = asNumber(targetModelRow, "sequence");
    const laterRunMessage = this.database
      .prepare(
        `SELECT 1 AS present
         FROM model_messages
         WHERE conversation_id = ? AND run_id = ? AND sequence > ?
         LIMIT 1`,
      )
      .get(sourceConversationId, runId, targetModelSequence);
    if (laterRunMessage !== undefined) {
      throw new Error("A conversation can only be forked from the final assistant reply in a run.");
    }
    return {
      modelMessageSequence: targetModelSequence,
      timelineSequence: asNumber(timelineRow, "sequence"),
    };
  }

  public listConversationForks(sourceConversationId: string): ConversationSummary[] {
    this.getConversation(sourceConversationId);
    const rows = this.database
      .prepare(
        `${teamWorkItemExecutionTreeCte}
         SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            selected_provider_id, selected_model_id, selected_reasoning_json, permission_mode, coordination_mode,
            thread_kind, agent_id, avatar_icon, team_id, title, created_at, conversations.updated_at,
            conversations.archived_at,
            conversations.has_unread_result, conversations.is_archived,
            conversations.is_pinned, conversations.pin_order,
           (SELECT id FROM runs
            WHERE conversation_id = conversations.id
              AND status IN ('queued', 'running')
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS active_run_id,
           (SELECT status FROM runs
            WHERE conversation_id = conversations.id
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_run_status
          ,(SELECT COUNT(*) FROM subagent_tasks
            WHERE parent_conversation_id = conversations.id
              AND (
                status IN ('queued', 'running')
                OR EXISTS (
                  SELECT 1 FROM runs AS active_subagent_runs
                  WHERE active_subagent_runs.conversation_id = subagent_tasks.child_conversation_id
                    AND active_subagent_runs.status IN ('queued', 'running')
                )
              )) AS active_subagent_count
           ,(SELECT status FROM subagent_tasks
             WHERE child_conversation_id = conversations.id LIMIT 1) AS subagent_task_status
           ,team_execution_tree_projection.work_item_id AS team_work_item_id
         FROM conversations
         LEFT JOIN team_execution_tree_projection
           ON team_execution_tree_projection.conversation_id = conversations.id
         WHERE parent_conversation_id = ? AND deletion_pending = 0
         ORDER BY conversations.created_at ASC`
      )
      .all(sourceConversationId) as DatabaseRow[];
    return rows.map(toConversation);
  }

  public isConversationFork(conversationId: string): boolean {
    const row = this.database
      .prepare(
        `SELECT parent_conversation_id FROM conversations
         WHERE id = ? AND deletion_pending = 0`
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("Conversation was not found.");
    }
    return asNullableString(row, "parent_conversation_id") !== null
      && !this.isManagedTeamWorkItemConversation(conversationId);
  }

  public renameConversation(
    conversationId: string,
    title: string
  ): ConversationSummary {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?"
      )
      .run(title, now, conversationId);
    if (result.changes !== 1) {
      throw new Error("Conversation was not found.");
    }
    return this.getConversation(conversationId);
  }

  public setConversationProject(
    conversationId: string,
    projectId: string | null
  ): ConversationSummary {
    const conversation = this.getConversation(conversationId);
    if (conversation.teamWorkItemId !== null) {
      throw new Error("Managed Team WorkItem conversations retain their WorkItem project binding.");
    }
    if (conversation.projectId === projectId) {
      return conversation;
    }
    this.assertNoActiveRun(conversationId);
    if (projectId !== null) {
      this.assertProjectExists(projectId);
    }

    const nextSortOrder = conversation.isPinned
      ? null
      : Number((this.database
          .prepare(
            `SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order
             FROM conversations
             WHERE project_id IS ? AND is_pinned = 0 AND is_archived = 0
               AND parent_conversation_id IS NULL AND id <> ?
               AND deletion_pending = 0`
          )
          .get(projectId, conversationId) as DatabaseRow).sort_order);

    this.database
      .prepare(
        `UPDATE conversations
         SET project_id = ?,
             workspace_root_path = CASE WHEN ? IS NULL THEN workspace_root_path ELSE NULL END,
             sort_order = COALESCE(?, sort_order),
             updated_at = ?
         WHERE id = ?`
      )
      .run(projectId, projectId, nextSortOrder, new Date().toISOString(), conversationId);
    return this.getConversation(conversationId);
  }

  public setConversationArchived(
    conversationId: string,
    archived: boolean
  ): ConversationSummary {
    const conversation = this.getConversation(conversationId);
    if (archived && conversation.teamWorkItemId !== null) {
      throw new Error("Managed Team WorkItem conversations are retained by their WorkItem lifecycle.");
    }
    if (archived && (
      conversation.activeRunId !== null || conversation.activeSubagentCount > 0
    )) {
      throw new Error("A running conversation or Subagent cannot be archived.");
    }
    if (conversation.isArchived === archived) {
      return conversation;
    }
    this.database
      .prepare("UPDATE conversations SET is_archived = ?, archived_at = ? WHERE id = ?")
      .run(archived ? 1 : 0, archived ? new Date().toISOString() : null, conversationId);
    return this.getConversation(conversationId);
  }

  public listExpiredArchivedConversationRootIds(cutoffIso: string): string[] {
    const rows = this.database
      .prepare(
        `SELECT id, parent_conversation_id, is_archived, archived_at
         FROM conversations
         WHERE deletion_pending = 0`
      )
      .all() as DatabaseRow[];
    const byId = new Map(rows.map((row) => [asString(row, "id"), row]));
    const expiredIds = new Set(rows.flatMap((row) => {
      const archivedAt = asNullableString(row, "archived_at");
      return asBoolean(row, "is_archived")
        && archivedAt !== null
        && archivedAt <= cutoffIso
        ? [asString(row, "id")]
        : [];
    }));
    return [...expiredIds].filter((conversationId) => {
      let parentId = asNullableString(byId.get(conversationId)!, "parent_conversation_id");
      const visited = new Set<string>();
      while (parentId !== null && !visited.has(parentId)) {
        if (expiredIds.has(parentId)) return false;
        visited.add(parentId);
        const parent = byId.get(parentId);
        parentId = parent === undefined
          ? null
          : asNullableString(parent, "parent_conversation_id");
      }
      return true;
    });
  }

  public setConversationPinned(
    conversationId: string,
    pinned: boolean
  ): ConversationSummary {
    const conversation = this.getConversation(conversationId);
    if (conversation.isPinned === pinned) {
      return conversation;
    }
    if (pinned) {
      this.database
        .prepare(
          `UPDATE conversations
           SET is_pinned = 1,
               pin_order = (SELECT COALESCE(MAX(pin_order), 0) + 1
                            FROM conversations WHERE deletion_pending = 0),
               sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1
                             FROM conversations
                             WHERE is_pinned = 1 AND is_archived = 0
                               AND parent_conversation_id IS NULL
                               AND deletion_pending = 0)
           WHERE id = ? AND deletion_pending = 0`
        )
        .run(conversationId);
    } else {
      this.database
        .prepare("UPDATE conversations SET is_pinned = 0, pin_order = NULL WHERE id = ?")
        .run(conversationId);
    }
    return this.getConversation(conversationId);
  }

  public reorderConversations(conversationIds: readonly string[]): void {
    if (new Set(conversationIds).size !== conversationIds.length) {
      throw new Error("Conversation order contains duplicate identifiers.");
    }
    const placeholders = conversationIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(
        `SELECT id, project_id, is_pinned, is_archived, parent_conversation_id
         FROM conversations
         WHERE id IN (${placeholders}) AND deletion_pending = 0`
      )
      .all(...conversationIds) as DatabaseRow[];
    const first = rows[0];
    const firstPinned = first === undefined ? null : asBoolean(first, "is_pinned");
    const firstProjectId = first === undefined ? null : asNullableString(first, "project_id");
    if (
      first === undefined
      || rows.length !== conversationIds.length
      || rows.some((row) => row.is_archived !== 0 || row.parent_conversation_id !== null)
      || rows.some((row) => asBoolean(row, "is_pinned") !== firstPinned)
      || (
        firstPinned === false
        && rows.some((row) => asNullableString(row, "project_id") !== firstProjectId)
      )
    ) {
      throw new Error("Conversations can only be reordered inside one visible group.");
    }
    const countRow = firstPinned === true
      ? this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM conversations
             WHERE is_pinned = 1 AND is_archived = 0 AND parent_conversation_id IS NULL
               AND deletion_pending = 0`
          )
          .get() as DatabaseRow
      : this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM conversations
             WHERE project_id IS ? AND is_pinned = 0 AND is_archived = 0
               AND parent_conversation_id IS NULL AND deletion_pending = 0`
          )
          .get(firstProjectId) as DatabaseRow;
    if (Number(countRow.count) !== conversationIds.length) {
      throw new Error("Conversation reorder must include the complete visible group.");
    }
    this.withTransaction(() => {
      const update = this.database.prepare(
        "UPDATE conversations SET sort_order = ? WHERE id = ?"
      );
      conversationIds.forEach((conversationId, index) => update.run(index, conversationId));
    });
  }

  public markConversationResultViewed(conversationId: string): ConversationSummary {
    this.getConversation(conversationId);
    this.database
      .prepare("UPDATE conversations SET has_unread_result = 0 WHERE id = ?")
      .run(conversationId);
    return this.getConversation(conversationId);
  }

  public isConversationExecutionPaused(conversationId: string): boolean {
    return this.executionPaused.has(conversationId);
  }

  public setConversationExecutionPaused(conversationId: string, paused: boolean): void {
    this.getConversation(conversationId);
    if (paused) this.executionPaused.add(conversationId);
    else this.executionPaused.delete(conversationId);
  }

  public getRunConversationId(runId: string): string | null {
    const row = this.database.prepare("SELECT conversation_id FROM runs WHERE id = ?").get(runId) as DatabaseRow | undefined;
    return row === undefined ? null : asString(row, "conversation_id");
  }

  public getConversationRunOutcome(conversationId: string, runId?: string) {
    const row = (runId === undefined
      ? this.database.prepare("SELECT id, status, error, updated_at FROM runs WHERE conversation_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 1").get(conversationId)
      : this.database.prepare("SELECT id, status, error, updated_at FROM runs WHERE conversation_id = ? AND id = ?").get(conversationId, runId)) as DatabaseRow | undefined;
    if (row === undefined) return null;
    const id = asString(row, "id");
    const status = conversationRunStatusSchema.parse(row.status);
    const progress = this.database.prepare(`SELECT id, kind, json_extract(payload_json, '$.status') AS status,
      length(json_extract(payload_json, '$.content')) AS content_length,
      length(json_extract(payload_json, '$.result')) AS result_length
      FROM conversation_timeline WHERE run_id = ? ORDER BY sequence DESC LIMIT 8`).all(id);
    const awaitingApproval = this.database.prepare(`SELECT 1 FROM conversation_timeline
      WHERE run_id = ? AND kind = 'tool' AND json_extract(payload_json, '$.status') = 'awaiting_approval' LIMIT 1`).get(id) !== undefined;
    let result = this.terminalResults.get(id) ?? null;
    if (status === "completed" && !this.terminalResults.has(id)) {
      const final = this.database.prepare(`SELECT json_extract(payload_json, '$.content') AS content
        FROM conversation_timeline WHERE run_id = ? AND kind = 'message'
          AND json_extract(payload_json, '$.role') = 'assistant' AND json_extract(payload_json, '$.status') = 'completed'
        ORDER BY sequence DESC LIMIT 1`).get(id) as DatabaseRow | undefined;
      result = final === undefined ? null : asNullableString(final, "content");
    }
    return {
      runId: id, status, error: asNullableString(row, "error"),
      result: status === "completed" ? result : null, awaitingApproval,
      progress: JSON.stringify([row.updated_at, ...progress]),
    };
  }

  private materializeCollaborationControl(conversationId: string, event: ThreadLogProjectionEvent): boolean {
    if (event.type === "conversation_execution_paused") {
      this.setConversationExecutionPaused(conversationId, z.boolean().parse(event.payload.paused));
      return true;
    }
    if (event.type === "agent_messages_consumed") {
      const payload = z.object({ runId: z.string().uuid(), messageIds: z.array(z.string().uuid()).max(50),
        queuedMessages: z.array(z.object({ messageId: z.string().uuid(), modelContent: z.string() }).strict()).max(50).optional(),
      }).strict().parse(event.payload);
      if (this.getRunConversationId(payload.runId) !== conversationId) throw new Error("Result batch Run does not belong to the conversation.");
      for (const id of payload.messageIds) this.markThreadLogAgentMessageRead(conversationId, id, event.createdAt, payload.runId);
      return true;
    }
    return false;
  }

  public createConversationDeletionTask(conversationId: string): ConversationDeletionTask {
    const existingTask = this.listIncompleteConversationDeletionTasks().find((task) =>
      task.conversationIds.includes(conversationId)
    );
    if (existingTask !== undefined) return existingTask;

    const conversation = this.getConversation(conversationId);
    if (conversation.teamWorkItemId !== null) {
      throw new Error("Managed Team WorkItem conversations are retained by their WorkItem lifecycle.");
    }
    if (this.isTeamMemberConversation(conversationId)) {
      throw new Error("Team member conversations are retained by their Team lifecycle.");
    }
    const conversationRows = this.database
      .prepare(
        `WITH RECURSIVE conversation_tree(id, depth) AS (
           SELECT id, 0 FROM conversations WHERE id = ?
           UNION ALL
           SELECT conversations.id, conversation_tree.depth + 1
           FROM conversations
           JOIN conversation_tree
             ON conversations.parent_conversation_id = conversation_tree.id
         )
         SELECT conversations.id, conversations.deletion_pending
         FROM conversations
         JOIN conversation_tree ON conversation_tree.id = conversations.id
         ORDER BY conversation_tree.depth ASC, conversations.rowid ASC`
      )
      .all(conversationId) as DatabaseRow[];
    if (conversationRows.length === 0) throw new Error("Conversation was not found.");
    if (conversationRows.some((row) => asBoolean(row, "deletion_pending"))) {
      throw new Error("A child conversation is already pending deletion.");
    }
    const conversationIds = conversationRows.map((row) => asString(row, "id"));
    const placeholders = conversationIds.map(() => "?").join(", ");
    const activeRun = this.database
      .prepare(
        `SELECT 1 AS present FROM runs
         WHERE conversation_id IN (${placeholders})
           AND status IN ('queued', 'running')
         LIMIT 1`
      )
      .get(...conversationIds);
    if (activeRun !== undefined) {
      throw new Error("A running conversation cannot be deleted.");
    }
    const fileRows = this.database
      .prepare(
        `SELECT stored_path, extracted_text_path
         FROM conversation_attachments
         WHERE conversation_id IN (${placeholders})`
      )
      .all(...conversationIds) as DatabaseRow[];
    const filePaths = [...new Set(fileRows.flatMap((row) => [
      asString(row, "stored_path"),
      ...(asNullableString(row, "extracted_text_path") === null
        ? []
        : [asString(row, "extracted_text_path")]),
    ]))];
    const now = new Date().toISOString();
    const task: ConversationDeletionTask = {
      conversationIds,
      createdAt: now,
      filePaths,
      id: randomUUID(),
      lastError: null,
      retryCount: 0,
      rootConversationId: conversationId,
      status: "pending",
      updatedAt: now,
    };

    return this.withTransaction(() => {
      this.database.prepare(
        `INSERT INTO conversation_deletion_tasks
           (id, root_conversation_id, conversation_ids_json, file_paths_json,
            status, retry_count, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        task.id,
        task.rootConversationId,
        JSON.stringify(task.conversationIds),
        JSON.stringify(task.filePaths),
        task.status,
        task.retryCount,
        task.lastError,
        task.createdAt,
        task.updatedAt,
      );
      const result = this.database.prepare(
        `UPDATE conversations SET deletion_pending = 1
         WHERE id IN (${placeholders}) AND deletion_pending = 0`,
      ).run(...conversationIds);
      if (result.changes !== conversationIds.length) {
        throw new Error("Conversation deletion state changed while creating the task.");
      }
      return task;
    });
  }

  public listRunIdsForConversations(conversationIds: readonly string[]): string[] {
    if (conversationIds.length === 0) return [];
    const placeholders = conversationIds.map(() => "?").join(", ");
    const rows = this.database.prepare(
      `SELECT id FROM runs WHERE conversation_id IN (${placeholders}) ORDER BY created_at ASC, rowid ASC`,
    ).all(...conversationIds) as DatabaseRow[];
    return rows.map((row) => asString(row, "id"));
  }

  public listQueuedRunRecoveries(): QueuedRunRecovery[] {
    const rows = this.database.prepare(
      `SELECT runs.id, runs.conversation_id, runs.model_id,
              runs.execution_snapshot_json,
              model_messages.content, model_messages.attachment_ids_json
       FROM runs
       JOIN model_messages
         ON model_messages.run_id = runs.id
        AND model_messages.role = 'user'
       WHERE runs.status = 'queued'
       ORDER BY runs.created_at ASC, runs.rowid ASC, model_messages.sequence ASC`,
    ).all() as DatabaseRow[];
    const seen = new Set<string>();
    return rows.flatMap((row) => {
      const runId = asString(row, "id");
      if (seen.has(runId)) return [];
      seen.add(runId);
      return [{
        attachmentIds: parseStoredStringArray(
          asString(row, "attachment_ids_json"),
          "queued Run attachment identifiers",
        ),
        content: asString(row, "content"),
        conversationId: asString(row, "conversation_id"),
        executionSnapshot: parseRunExecutionSnapshot(
          asNullableString(row, "execution_snapshot_json"),
        ),
        modelId: asString(row, "model_id"),
        runId,
      }];
    });
  }

  public listIncompleteConversationDeletionTasks(): ConversationDeletionTask[] {
    const rows = this.database.prepare(
      `SELECT id, root_conversation_id, conversation_ids_json, file_paths_json,
              status, retry_count, last_error, created_at, updated_at
       FROM conversation_deletion_tasks
       ORDER BY created_at ASC, rowid ASC`,
    ).all() as DatabaseRow[];
    return rows.map(toConversationDeletionTask);
  }

  public cancelPendingConversationDeletion(taskId: string): void {
    const task = this.getConversationDeletionTask(taskId);
    if (task === null || task.status !== "pending" || task.retryCount !== 0) {
      throw new Error("Conversation cleanup has already started.");
    }
    this.withTransaction(() => {
      const placeholders = task.conversationIds.map(() => "?").join(", ");
      this.database.prepare(`UPDATE conversations SET deletion_pending = 0 WHERE id IN (${placeholders})`)
        .run(...task.conversationIds);
      this.database.prepare("DELETE FROM conversation_deletion_tasks WHERE id = ?").run(taskId);
    });
  }

  public beginConversationDeletionTask(taskId: string): ConversationDeletionTask | null {
    const now = new Date().toISOString();
    const result = this.database.prepare(
      `UPDATE conversation_deletion_tasks
       SET status = 'running', retry_count = retry_count + 1,
           last_error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(now, taskId);
    if (result.changes === 0) return null;
    return this.getConversationDeletionTask(taskId);
  }

  public failConversationDeletionTask(taskId: string, error: string): void {
    this.database.prepare(
      `UPDATE conversation_deletion_tasks
       SET status = 'failed', last_error = ?, updated_at = ?
       WHERE id = ?`,
    ).run(error.slice(0, 4_000), new Date().toISOString(), taskId);
  }

  public completeConversationDeletionTask(taskId: string): void {
    const task = this.getConversationDeletionTask(taskId);
    if (task === null) return;
    const placeholders = task.conversationIds.map(() => "?").join(", ");
    const runIds = this.listRunIdsForConversations(task.conversationIds);
    const runPlaceholders = runIds.map(() => "?").join(", ");
    const agentMessageIds = (this.database.prepare(
      `SELECT id FROM conversation_agent_messages
       WHERE sender_conversation_id IN (${placeholders})
          OR target_conversation_id IN (${placeholders})`,
    ).all(...task.conversationIds, ...task.conversationIds) as DatabaseRow[])
      .map((row) => asString(row, "id"));
    const messagePlaceholders = agentMessageIds.map(() => "?").join(", ");
    this.withTransaction(() => {
      this.database.prepare(
        `UPDATE teams SET coordinator_conversation_id = NULL
         WHERE coordinator_conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds);
      this.database.prepare(
        `UPDATE team_work_items
         SET source_conversation_id = CASE
               WHEN source_conversation_id IN (${placeholders}) THEN NULL
               ELSE source_conversation_id END,
             execution_conversation_id = CASE
               WHEN execution_conversation_id IN (${placeholders}) THEN NULL
               ELSE execution_conversation_id END
         WHERE source_conversation_id IN (${placeholders})
            OR execution_conversation_id IN (${placeholders})`,
      ).run(
        ...task.conversationIds,
        ...task.conversationIds,
        ...task.conversationIds,
        ...task.conversationIds,
      );
      if (runIds.length > 0) {
        this.database.prepare(
          `UPDATE team_work_items SET active_run_id = NULL
           WHERE active_run_id IN (${runPlaceholders})`,
        ).run(...runIds);
        this.database.prepare(
          `DELETE FROM team_work_item_collaboration_outputs
           WHERE run_id IN (${runPlaceholders})`,
        ).run(...runIds);
      }
      this.database.prepare(
        `DELETE FROM team_execution_conversations
         WHERE source_conversation_id IN (${placeholders})
            OR conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds, ...task.conversationIds);
      this.database.prepare(
        `DELETE FROM team_member_conversations
         WHERE team_execution_conversation_id IN (${placeholders})
            OR conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds, ...task.conversationIds);
      this.database.prepare(
        `DELETE FROM team_work_item_member_assignments
         WHERE member_conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds);
      if (agentMessageIds.length > 0) {
        this.database.prepare(
          `DELETE FROM team_work_item_member_assignments
           WHERE message_id IN (${messagePlaceholders})`,
        ).run(...agentMessageIds);
      }
      this.database.prepare(
        `DELETE FROM team_instances WHERE source_conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds);
      this.database.prepare(
        `UPDATE team_instances SET root_conversation_id = NULL
         WHERE root_conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds);
      this.database.prepare(
        `DELETE FROM team_collaboration_plans
         WHERE created_by_conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds);
      this.database.prepare(
        `UPDATE team_collaboration_plan_nodes SET conversation_id = NULL
         WHERE conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds);
      this.database.prepare(
        `DELETE FROM team_work_item_collaboration_outputs
         WHERE conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds);

      this.database.prepare(
        `DELETE FROM conversation_agent_messages
         WHERE sender_conversation_id IN (${placeholders})
            OR target_conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds, ...task.conversationIds);
      this.database.prepare(
        `DELETE FROM subagent_tasks
         WHERE parent_conversation_id IN (${placeholders})
            OR child_conversation_id IN (${placeholders})`,
      ).run(...task.conversationIds, ...task.conversationIds);
      for (const id of task.conversationIds) { this.collaboration.cancelPending(id); this.writeTaskListProjection(id, null); }
      for (const tableName of [
        "conversation_timeline",
        "model_messages",
        "conversation_pending_messages",
        "conversation_attachments",
        "conversation_context_checkpoints",
        "conversation_turn_summaries",
        "runs",
      ]) {
        this.database.prepare(
          `DELETE FROM ${quoteSqliteIdentifier(tableName)}
           WHERE conversation_id IN (${placeholders})`,
        ).run(...task.conversationIds);
      }
      this.database.prepare(
        `DELETE FROM conversations WHERE id IN (${placeholders})`,
      ).run(...task.conversationIds);
      this.database.prepare("DELETE FROM conversation_deletion_tasks WHERE id = ?")
        .run(task.id);
    });
    for (const runId of runIds) this.terminalResults.delete(runId);
    for (const id of task.conversationIds) {
      this.executionPaused.delete(id);
      this.clearThreadLogProjection(id);
    }
  }

  private getConversationDeletionTask(taskId: string): ConversationDeletionTask | null {
    const row = this.database.prepare(
      `SELECT id, root_conversation_id, conversation_ids_json, file_paths_json,
              status, retry_count, last_error, created_at, updated_at
       FROM conversation_deletion_tasks WHERE id = ?`,
    ).get(taskId) as DatabaseRow | undefined;
    return row === undefined ? null : toConversationDeletionTask(row);
  }

  public createConversationAttachment(input: StoredConversationAttachment): ConversationAttachment {
    if (input.messageId !== null) throw new Error("A new conversation attachment must be a draft.");
    return this.insertConversationAttachment(input);
  }

  /** Tool images use the existing timeline-owner column and never become user drafts. */
  public createToolImageAttachment(input: StoredConversationAttachment): ConversationAttachment {
    if (
      input.kind !== "image"
      || input.messageId === null
      || !this.attachmentMetadata.hasToolImageOwner(input.conversationId, input.messageId)
    ) {
      throw new Error("Image owner must be a tool in this conversation.");
    }
    return this.insertConversationAttachment(input);
  }

  private insertConversationAttachment(input: StoredConversationAttachment): ConversationAttachment {
    this.getConversation(input.conversationId);
    return this.attachmentMetadata.insertConversationAttachment(input);
  }

  public listDraftConversationAttachments(conversationId: string): ConversationAttachment[] {
    this.getConversation(conversationId);
    const contextAttachmentIds = new Set(
      this.listContextAttachmentIds(conversationId),
    );
    // Side forks inherit model context without copying the visible timeline. Their
    // copied attachments therefore have no message_id, but they are not drafts.
    return this.attachmentMetadata.listUnbound(conversationId)
      .filter((attachment) => !contextAttachmentIds.has(attachment.id))
      .map(toPublicConversationAttachment);
  }

  public getConversationAttachment(
    conversationId: string,
    attachmentId: string
  ): StoredConversationAttachment {
    return this.attachmentMetadata.getConversationAttachment(conversationId, attachmentId);
  }

  public listConversationAttachmentsByIds(
    conversationId: string,
    attachmentIds: readonly string[]
  ): StoredConversationAttachment[] {
    return this.attachmentMetadata.listConversationAttachmentsByIds(conversationId, attachmentIds);
  }

  public listConversationAttachmentStoragePaths(): ConversationAttachmentStoragePaths[] {
    return this.attachmentMetadata.listConversationAttachmentStoragePaths();
  }

  public updateConversationAttachmentStoragePaths(input: {
    extractedTextPath: string | null;
    id: string;
    storedPath: string;
  }): void {
    return this.attachmentMetadata.updateConversationAttachmentStoragePaths(input);
  }

  /** Returns renderer-safe immutable attachment references for ThreadLog events. */
  public listThreadLogAttachmentReferences(
    conversationId: string,
    attachmentIds: readonly string[],
  ): ConversationAttachment[] {
    return this.listConversationAttachmentsByIds(conversationId, attachmentIds)
      .map(toPublicConversationAttachment);
  }

  public removeDraftConversationAttachment(
    conversationId: string,
    attachmentId: string
  ): StoredConversationAttachment {
    return this.attachmentMetadata.removeDraftConversationAttachment(conversationId, attachmentId);
  }

  public isConversationAttachmentFileReferencedByActiveConversation(filePath: string): boolean {
    return this.attachmentMetadata.isConversationAttachmentFileReferencedByActiveConversation(filePath);
  }

  public isConversationAttachmentFileReferencedOutside(
    filePath: string,
    excludedAttachmentIds: readonly string[],
  ): boolean {
    return this.attachmentMetadata.isConversationAttachmentFileReferencedOutside(filePath, excludedAttachmentIds);
  }

  public createSubagentTask(input: {
    childConversationId: string;
    parentConversationId: string;
    sourceRunId: string;
    task: string;
    title: string;
  }): SubagentTask {
    const parent = this.getConversation(input.parentConversationId);
    const child = this.getConversation(input.childConversationId);
    if (child.parentConversationId !== parent.id) {
      throw new Error("The Subagent conversation does not belong to the parent conversation.");
    }
    const sourceRun = this.database
      .prepare("SELECT conversation_id FROM runs WHERE id = ?")
      .get(input.sourceRunId) as DatabaseRow | undefined;
    if (sourceRun === undefined || asString(sourceRun, "conversation_id") !== parent.id) {
      throw new Error("The Subagent task source run does not belong to the parent conversation.");
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO subagent_tasks
           (id, parent_conversation_id, child_conversation_id, source_run_id,
            target_run_id, title, task, status, result, error, result_message_id,
            created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, 'queued', NULL, NULL, NULL, ?, ?, NULL)`
      )
      .run(
        id,
        parent.id,
        child.id,
        input.sourceRunId,
        input.title,
        input.task,
        now,
        now
      );
    return this.getSubagentTask(id);
  }

  public assignSubagentTaskRun(taskId: string, targetRunId: string): SubagentTask {
    const task = this.getSubagentTask(taskId);
    const run = this.database
      .prepare("SELECT conversation_id FROM runs WHERE id = ?")
      .get(targetRunId) as DatabaseRow | undefined;
    if (run === undefined || asString(run, "conversation_id") !== task.childConversationId) {
      throw new Error("The Subagent run does not belong to the task conversation.");
    }
    const now = new Date().toISOString();
    const update = this.database
      .prepare(
        `UPDATE subagent_tasks
         SET target_run_id = ?, status = 'running', updated_at = ?
         WHERE id = ? AND status = 'queued' AND target_run_id IS NULL`
      )
      .run(targetRunId, now, taskId);
    if (update.changes !== 1) throw new Error("The Subagent task has already started.");
    return this.getSubagentTask(taskId);
  }

  public getSubagentTask(taskId: string): SubagentTask {
    const row = this.database
      .prepare("SELECT * FROM subagent_tasks WHERE id = ?")
      .get(taskId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Subagent task was not found.");
    return toSubagentTask(row);
  }

  public listSubagentTasks(parentConversationId: string): SubagentTask[] {
    this.getConversation(parentConversationId);
    const rows = this.database
      .prepare(
        `SELECT * FROM subagent_tasks
         WHERE parent_conversation_id = ? ORDER BY created_at ASC`
      )
      .all(parentConversationId) as DatabaseRow[];
    return rows.map(toSubagentTask);
  }

  public endSubagent(parentConversationId: string, childConversationId: string): SubagentTask {
    return this.withTransaction(() => {
      const task = this.database
        .prepare(
          `SELECT * FROM subagent_tasks
           WHERE parent_conversation_id = ? AND child_conversation_id = ? LIMIT 1`,
        )
        .get(parentConversationId, childConversationId) as DatabaseRow | undefined;
      if (task === undefined) {
        throw new Error("The Subagent conversation does not belong to this parent conversation.");
      }
      const current = toSubagentTask(task);
      if (current.status === "ended") return current;
      const child = this.getConversation(childConversationId);
      if (child.activeRunId !== null || current.status === "queued" || current.status === "running") {
        throw new Error("A running Subagent cannot be ended.");
      }
      if (this.listPendingMessages(childConversationId).length > 0
        || this.listUnreadAgentMessages(childConversationId).some(message => message.deliveryMode === "queue")) {
        throw new Error("A Subagent with pending assignments cannot be ended.");
      }
      const now = new Date().toISOString();
      const update = this.database.prepare(
        `UPDATE subagent_tasks SET status = 'ended', updated_at = ?
         WHERE id = ? AND status NOT IN ('queued', 'running', 'ended')`,
      ).run(now, current.id);
      if (update.changes !== 1) {
        throw new Error("The Subagent state changed before it could be ended.");
      }
      this.database.prepare(
        "UPDATE conversations SET updated_at = ? WHERE id = ?",
      ).run(now, childConversationId);
      return this.getSubagentTask(current.id);
    });
  }

  public listRunFileChanges(
    conversationId: string,
    runId: string,
  ): ConversationRunFileChange[] {
    const run = this.database.prepare(
      "SELECT 1 AS present FROM runs WHERE id = ? AND conversation_id = ?",
    ).get(runId, conversationId);
    if (run === undefined) throw new Error("The Run does not belong to the conversation.");
    const rows = this.database.prepare(
      `SELECT payload_json FROM conversation_timeline
       WHERE conversation_id = ? AND run_id = ? AND kind = 'tool'
       ORDER BY sequence ASC`,
    ).all(conversationId, runId) as DatabaseRow[];
    const changesByPath = new Map<string, ConversationRunFileChange>();
    for (const row of rows) {
      const parsed = conversationToolItemSchema.safeParse(
        parseJson(asString(row, "payload_json"), "tool timeline item"),
      );
      if (!parsed.success) continue;
      for (const change of runFileChangesFromTool(parsed.data)) {
        changesByPath.set(change.path, change);
      }
    }
    return [...changesByPath.values()].slice(0, 50);
  }

  /** Counts queued/running tasks across an execution tree, including nested delegation. */
  public countActiveSubagentTasksInExecutionTree(rootConversationId: string): number {
    this.getConversation(rootConversationId);
    const row = this.database.prepare(
      `WITH RECURSIVE execution_tree(conversation_id) AS (
         SELECT ?
         UNION
         SELECT task.child_conversation_id
         FROM subagent_tasks AS task
         JOIN execution_tree AS parent
           ON parent.conversation_id = task.parent_conversation_id
       )
       SELECT COUNT(*) AS count
       FROM subagent_tasks
       WHERE parent_conversation_id IN (SELECT conversation_id FROM execution_tree)
         AND (
           status IN ('queued', 'running')
           OR EXISTS (
             SELECT 1 FROM runs AS active_subagent_runs
             WHERE active_subagent_runs.conversation_id = subagent_tasks.child_conversation_id
               AND active_subagent_runs.status IN ('queued', 'running')
           )
         )`,
    ).get(rootConversationId) as DatabaseRow;
    return asNumber(row, "count");
  }

  /** A Subagent terminal Run also has a cross-Conversation delivery fact.
   * It stays on the existing atomic completion path until that two-log
   * transaction has its own write-ahead contract. */
  public hasSubagentTaskForTargetRun(runId: string): boolean {
    return this.database
      .prepare("SELECT 1 AS present FROM subagent_tasks WHERE target_run_id = ? LIMIT 1")
      .get(runId) !== undefined;
  }

  public listUndeliveredSubagentTasks(): SubagentTask[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM subagent_tasks
         WHERE status IN ('completed', 'failed', 'cancelled')
           AND result_message_id IS NULL
         ORDER BY completed_at ASC, created_at ASC`
      )
      .all() as DatabaseRow[];
    return rows.map(toSubagentTask);
  }

  public completeSubagentTaskByRun(input: {
    error: string | null;
    result: string | null;
    status: "completed" | "failed" | "cancelled";
    targetRunId: string;
  }): SubagentTask | null {
    return this.withTransaction(() => this.completeSubagentTaskByRunInTransaction(input));
  }

  public deliverSubagentTaskResult(taskId: string, autoWake = true): ConversationAgentMessageItem | null {
    return this.withTransaction(() => this.deliverSubagentTaskResultInTransaction(taskId, autoWake));
  }

  private completeSubagentTaskByRunInTransaction(input: {
    error: string | null;
    result: string | null;
    status: "completed" | "failed" | "cancelled";
    targetRunId: string;
  }): SubagentTask | null {
    const row = this.database
      .prepare("SELECT id FROM subagent_tasks WHERE target_run_id = ?")
      .get(input.targetRunId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    const taskId = asString(row, "id");
    const current = this.getSubagentTask(taskId);
    if (current.status !== "queued" && current.status !== "running") return current;
    const now = new Date().toISOString();
    const update = this.database
      .prepare(
        `UPDATE subagent_tasks
         SET status = ?, result = ?, error = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND status IN ('queued', 'running')`
      )
      .run(input.status, input.result, input.error, now, now, taskId);
    if (update.changes !== 1) {
      throw new Error("The Subagent task changed before completion could be committed.");
    }
    return this.getSubagentTask(taskId);
  }

  private deliverSubagentTaskResultInTransaction(
    taskId: string,
    autoWake = true,
  ): ConversationAgentMessageItem | null {
    const task = this.getSubagentTask(taskId);
    if (
      task.resultMessageId !== null
      || (task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled")
    ) {
      return null;
    }
    const sender = this.getConversation(task.childConversationId);
    const target = this.getConversation(task.parentConversationId);
    const now = new Date().toISOString();
    const fullContent = task.status === "completed"
      ? task.result?.trim() || "Subagent 本轮执行已结束，未提供总结。可按 conversationId 和 runId 读取本轮记录，或要求该 Subagent 补充说明；结束不代表任务已验收。"
      : task.status === "cancelled"
        ? `Subagent 任务已取消：${task.error?.trim() || "未提供原因。"}`
        : `Subagent 任务失败：${task.error?.trim() || "未提供错误信息。"}`;
    const content = subagentResultSummaryContent({
      content: fullContent,
      status: task.status,
    });
    const message = conversationAgentMessageItemSchema.parse({
      ...(autoWake ? {} : { autoWake: false }),
      executionStatus: task.status,
      summaryStatus: task.result?.trim() ? "provided" : "missing",
      executionError: task.error,
      content,
      conversationId: target.id,
      createdAt: now,
      fileChanges: task.targetRunId === null
        ? []
        : this.listRunFileChanges(sender.id, task.targetRunId),
      id: randomUUID(),
      kind: "agent_message",
      messageType: "task_result",
      readAt: null,
      runId: task.targetRunId,
      senderConversationId: sender.id,
      senderTitle: sender.title,
      status: "unread",
      taskId: task.id
    });

    this.persistAgentMessage(message, false);
    const update = this.database
      .prepare(
        `UPDATE subagent_tasks SET result_message_id = ?, updated_at = ?
         WHERE id = ? AND result_message_id IS NULL`
      )
      .run(message.id, now, task.id);
    if (update.changes !== 1) {
      throw new Error("The Subagent result changed before delivery could be committed.");
    }
    return message;
  }

  public getTimelineItem(conversationId: string, id: string): ConversationTimelineItem | null {
    this.getConversation(conversationId);
    const row = this.database.prepare(`SELECT t.payload_json, r.created_at AS run_created_at,
      r.status AS run_status, r.updated_at AS run_completed_at FROM conversation_timeline t
      LEFT JOIN runs r ON r.id = t.run_id WHERE t.conversation_id = ? AND t.id = ?`).get(conversationId, id);
    return row === undefined ? null : this.toConversationTimelineItem(row);
  }

  public listTimeline(conversationId: string, runId?: string): ConversationTimelineItem[] {
    this.getConversation(conversationId);
    const rows = this.database
      .prepare(
        `SELECT conversation_timeline.payload_json,
                runs.created_at AS run_created_at,
                runs.status AS run_status,
                runs.updated_at AS run_completed_at
         FROM conversation_timeline
         LEFT JOIN runs ON runs.id = conversation_timeline.run_id
         WHERE conversation_timeline.conversation_id = ?
           AND (? IS NULL OR conversation_timeline.run_id = ?)
         ORDER BY conversation_timeline.sequence ASC`
      )
      .all(conversationId, runId ?? null, runId ?? null) as DatabaseRow[];
    return rows.map((row) => this.toConversationTimelineItem(row));
  }

  public listTimelinePage(input: ConversationTimelinePageInput): ConversationTimelinePage {
    this.getConversation(input.conversationId);
    const rows = this.database
      .prepare(
        `SELECT conversation_timeline.sequence, conversation_timeline.payload_json,
                runs.created_at AS run_created_at,
                runs.status AS run_status,
                runs.updated_at AS run_completed_at
         FROM conversation_timeline
         LEFT JOIN runs ON runs.id = conversation_timeline.run_id
         WHERE conversation_timeline.conversation_id = ?
           AND (? IS NULL OR conversation_timeline.sequence < ?)
         ORDER BY conversation_timeline.sequence DESC
         LIMIT ?`,
      )
      .all(
        input.conversationId,
        input.beforeSequence ?? null,
        input.beforeSequence ?? null,
        input.limit + 1,
      ) as DatabaseRow[];
    const hasMore = rows.length > input.limit;
    const selectedRows = rows.slice(0, input.limit);
    const oldestSelectedRow = selectedRows.at(-1);
    return {
      hasMore,
      items: selectedRows
        .map((row) => this.toConversationTimelineItem(row))
        .reverse(),
      nextBeforeSequence: hasMore
        && oldestSelectedRow !== undefined
        ? asNumber(oldestSelectedRow, "sequence")
        : null,
    };
  }

  private toConversationTimelineItem(row: DatabaseRow): ConversationTimelineItem {
    const item = conversationTimelineItemSchema.parse(
      parseJson(asString(row, "payload_json"), "timeline item"),
    );
    if (item.kind === "agent_message") {
      return this.withCurrentAgentMessageSenderTitle(item);
    }
    const hasRunDuration = (item.kind === "message" && item.role === "assistant" && item.runId !== null)
      || (item.kind === "model_retry" && item.status !== "retrying");
    if (!hasRunDuration) return item;

    const runStatus = asNullableString(row, "run_status");
    const runCreatedAt = asNullableString(row, "run_created_at");
    const runCompletedAt = asNullableString(row, "run_completed_at");
    if (
      runStatus === null
      || runCreatedAt === null
      || runCompletedAt === null
      || (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled")
    ) {
      return item;
    }

    return conversationTimelineItemSchema.parse({
      ...item,
      completedAt: runCompletedAt,
      durationMs: Math.max(0, Date.parse(runCompletedAt) - Date.parse(runCreatedAt)),
    });
  }

  public sendAgentMessage(input: SendAgentMessageInput): ConversationAgentMessageItem {
    return this.sendAgentMessages([input])[0]!;
  }

  public sendAgentMessages(inputs: SendAgentMessageInput[]): ConversationAgentMessageItem[] {
    const messages = inputs.map(input => this.createAgentMessage(input));
    this.withTransaction(() => {
      for (const message of messages) this.persistAgentMessage(message);
    });
    return messages;
  }

  private createAgentMessage(input: SendAgentMessageInput): ConversationAgentMessageItem {
    const sender = this.getConversation(input.senderConversationId);
    const target = this.getConversation(input.targetConversationId);
    if (sender.id === target.id) {
      throw new Error("An Agent cannot send a message to its own conversation.");
    }
    if (target.isArchived && input.messageType !== "agent_result") {
      throw new Error("An archived conversation cannot receive Agent messages.");
    }
    if (target.subagentTaskStatus === "ended") {
      throw new Error("An ended Subagent conversation is read-only.");
    }
    const now = new Date().toISOString();
    const message = conversationAgentMessageItemSchema.parse({
      content: input.content,
      conversationId: target.id,
      ...(input.executionStatus === undefined ? {} : { executionStatus: input.executionStatus }),
      ...(input.summaryStatus === undefined ? {} : { summaryStatus: input.summaryStatus }),
      ...(input.executionError === undefined ? {} : { executionError: input.executionError }),
      createdAt: now,
      fileChanges: input.fileChanges ?? [],
      id: input.id ?? randomUUID(),
      kind: "agent_message",
      ...(input.autoWake === false ? { autoWake: false } : {}),
      ...(input.deliveryMode === undefined ? {} : { deliveryMode: input.deliveryMode }),
      messageType: input.messageType ?? "message",
      readAt: null,
      replyInstruction: input.replyInstruction ?? null,
      runId: input.runId,
      senderConversationId: sender.id,
      senderTitle: this.agentMessageSenderTitle(sender),
      status: "unread",
      taskId: input.taskId ?? null
    });

    return message;
  }

  private persistAgentMessage(
    message: ConversationAgentMessageItem,
    includeInTimeline = true
  ): void {
    this.database
      .prepare(
        `INSERT INTO conversation_agent_messages
           (id, sender_conversation_id, target_conversation_id, status,
            payload_json, created_at, read_at)
         VALUES (?, ?, ?, 'unread', ?, ?, NULL)`
      )
      .run(
        message.id,
        message.senderConversationId,
        message.conversationId,
        JSON.stringify(message),
        message.createdAt
      );
    if (includeInTimeline) this.runEvents.insertTimelineItem(message);
    if (message.deliveryMode !== "queue") this.runEvents.insertModelMessage({
      attachmentIds: [], content: agentMessageModelContent(message),
      conversationId: message.conversationId, role: "user", runId: null,
      toolCallId: null, toolCalls: [],
    });
    this.database
      .prepare(
        `UPDATE conversations
         SET updated_at = ?, has_unread_result = 1
         WHERE id = ?`
      )
      .run(message.createdAt, message.conversationId);
  }

  public listUnreadAgentMessages(
    conversationId: string,
    senderConversationId?: string
  ): ConversationAgentMessageItem[] {
    this.getConversation(conversationId);
    const rows = senderConversationId === undefined
      ? this.database
          .prepare(
            `SELECT payload_json FROM conversation_agent_messages
             WHERE target_conversation_id = ? AND status = 'unread'
             ORDER BY created_at ASC LIMIT 50`
          )
          .all(conversationId) as DatabaseRow[]
      : this.database
          .prepare(
            `SELECT payload_json FROM conversation_agent_messages
             WHERE target_conversation_id = ? AND sender_conversation_id = ?
               AND status = 'unread'
             ORDER BY created_at ASC LIMIT 50`
          )
          .all(conversationId, senderConversationId) as DatabaseRow[];
    return rows.map((row) => this.withCurrentAgentMessageSenderTitle(
      conversationAgentMessageItemSchema.parse(
        parseJson(asString(row, "payload_json"), "Agent message")
      ),
    ));
  }

  public listConversationIdsWithUnreadAgentMessages(): string[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT target_conversation_id
         FROM conversation_agent_messages
         WHERE status = 'unread' ORDER BY created_at ASC`
      )
      .all() as DatabaseRow[];
    return rows.map((row) => asString(row, "target_conversation_id"));
  }

  /** Recover replies from durable consumption facts, including a crash before receipt delivery. */
  public listAgentReplyRecoveries(): { trigger: ConversationAgentMessageItem; runId: string }[] {
    const messages = (this.database.prepare("SELECT payload_json FROM conversation_agent_messages").all() as DatabaseRow[])
      .map((row) => conversationAgentMessageItemSchema.parse(parseJson(asString(row, "payload_json"), "Agent message")));
    const delivered = new Set(messages.filter((message) => message.messageType === "agent_result")
      .map((message) => `${message.senderConversationId}:${message.runId}:${message.conversationId}`));
    const pending = new Map<string, { trigger: ConversationAgentMessageItem; runId: string }>();
    for (const trigger of messages) {
      const runId = trigger.consumedByRunId;
      if (trigger.messageType !== "message" || runId === undefined || !this.hasConversation(trigger.senderConversationId)) continue;
      const key = `${trigger.conversationId}:${runId}:${trigger.senderConversationId}`;
      if (delivered.has(key)) continue;
      const row = this.database.prepare("SELECT status FROM runs WHERE id = ? AND conversation_id = ?").get(runId, trigger.conversationId) as DatabaseRow | undefined;
      if (row !== undefined && (row.status === "completed" || row.status === "failed" || row.status === "cancelled")) pending.set(key, { trigger, runId });
    }
    return [...pending.values()];
  }

  public markAgentMessagesRead(messageIds: readonly string[], consumedByRunId?: string): void {
    if (messageIds.length === 0) return;
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const readStoredMessage = this.database.prepare(
        "SELECT payload_json FROM conversation_agent_messages WHERE id = ?"
      );
      const updateStoredMessage = this.database.prepare(
        `UPDATE conversation_agent_messages
         SET status = 'read', payload_json = ?, read_at = ? WHERE id = ?`
      );
      const updateTimeline = this.database.prepare(
        "UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'agent_message'"
      );
      for (const messageId of messageIds) {
        const row = readStoredMessage.get(messageId) as DatabaseRow | undefined;
        if (row === undefined) continue;
        const current = conversationAgentMessageItemSchema.parse(
          parseJson(asString(row, "payload_json"), "Agent message")
        );
        if (current.status === "read") continue;
        const read = conversationAgentMessageItemSchema.parse({
          ...current,
          ...(consumedByRunId === undefined ? {} : { consumedByRunId }),
          readAt: now,
          status: "read"
        });
        updateStoredMessage.run(JSON.stringify(read), now, messageId);
        updateTimeline.run(JSON.stringify(read), messageId);
        if (current.deliveryMode === "queue") this.runEvents.insertModelMessage({
          attachmentIds: [], content: agentMessageModelContent(read),
          conversationId: read.conversationId, role: "user", runId: consumedByRunId ?? null,
          toolCallId: null, toolCalls: [],
        });
      }
    });
  }

  public getTaskList(conversationId: string): ConversationTaskList | null {
    this.getConversation(conversationId);
    if (this.volatileConversationProjectionActive) {
      const taskList = this.taskLists.get(conversationId);
      return taskList === undefined || taskList.status === "closed" ? null : structuredClone(taskList);
    }
    const row = this.database
      .prepare(
        "SELECT payload_json FROM conversation_task_lists WHERE conversation_id = ?"
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    const taskList = conversationTaskListSchema.parse(
      parseJson(asString(row, "payload_json"), "conversation task list")
    );
    if (taskList.status === "closed") {
      this.database
        .prepare("DELETE FROM conversation_task_lists WHERE conversation_id = ?")
        .run(conversationId);
      return null;
    }
    return taskList;
  }

  public createTaskList(
    conversationId: string,
    tasks: ReadonlyArray<TaskListTaskInput>
  ): ConversationTaskList {
    this.getConversation(conversationId);
    const previous = this.getTaskList(conversationId);
    if (previous?.status === "active") {
      throw new Error("An active task list already exists for this conversation.");
    }
    return this.saveActiveTaskList(conversationId, tasks, null);
  }

  public updateTaskList(
    conversationId: string,
    tasks: ReadonlyArray<TaskListTaskInput>
  ): ConversationTaskList {
    this.getConversation(conversationId);
    const previous = this.getTaskList(conversationId);
    return this.saveActiveTaskList(conversationId, tasks, previous);
  }

  public closeTaskList(conversationId: string): void {
    this.deleteTaskList(conversationId);
  }

  public deleteTaskList(conversationId: string): void {
    this.getConversation(conversationId);
    const now = new Date().toISOString();
    this.withTransaction(() => {
      if (this.getTaskList(conversationId) === null) {
        throw new Error("Task list was not found.");
      }
      this.writeTaskListProjection(conversationId, null);
      this.runEvents.touchConversation(conversationId, now);
    });
  }

  private saveActiveTaskList(
    conversationId: string,
    tasks: ReadonlyArray<TaskListTaskInput>,
    previous: ConversationTaskList | null
  ): ConversationTaskList {
    const now = new Date().toISOString();
    const taskList = conversationTaskListSchema.parse({
      closedAt: null,
      conversationId,
      createdAt: previous?.createdAt ?? now,
      status: "active",
      tasks: tasks.map((task, index) => ({
        id:
          previous?.tasks[index]?.title === task.title
            ? previous.tasks[index].id
            : randomUUID(),
        reason: task.reason ?? null,
        status: task.status,
        title: task.title
      })),
      updatedAt: now
    });
    this.persistTaskList(taskList, now);
    return taskList;
  }

  private persistTaskList(taskList: ConversationTaskList, now: string): void {
    this.withTransaction(() => {
      this.writeTaskListProjection(taskList.conversationId, taskList);
      this.runEvents.touchConversation(taskList.conversationId, now);
    });
  }

  private writeTaskListProjection(conversationId: string, taskList: ConversationTaskList | null): void {
    if (this.volatileConversationProjectionActive) {
      if (this.taskListRollback !== null && !this.taskListRollback.has(conversationId)) {
        this.taskListRollback.set(conversationId, this.taskLists.get(conversationId));
      }
      if (taskList === null) this.taskLists.delete(conversationId);
      else this.taskLists.set(conversationId, structuredClone(taskList));
      return;
    }
    // Pre-cutover databases still need their original table for the one-time JSONL export.
    if (taskList === null) {
      this.database.prepare("DELETE FROM conversation_task_lists WHERE conversation_id = ?").run(conversationId);
    } else {
      this.database.prepare(
        `INSERT INTO conversation_task_lists (conversation_id, payload_json, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET payload_json = excluded.payload_json, updated_at = excluded.updated_at`,
      ).run(conversationId, JSON.stringify(taskList), taskList.updatedAt);
    }
  }

  public enqueuePendingMessage(rawInput: SendConversationMessageInput): ConversationPendingMessage {
    const prepared = this.preparePendingMessage(rawInput);
    this.projectPreparedPendingMessage(prepared);
    return prepared.message;
  }

  /** Validate and assign a stable pending-message ID without SQLite writes. */
  public preparePendingMessage(rawInput: SendConversationMessageInput): PreparedPendingMessage {
    const input = sendConversationMessageInputSchema.parse(rawInput);
    this.getConversation(input.conversationId);
    const deliveryMode = input.deliveryMode ?? "queue";
    const attachmentIds = input.attachmentIds ?? [];
    const attachments = this.listConversationAttachmentsByIds(
      input.conversationId,
      attachmentIds
    );
    if (attachments.some(
      (attachment) => attachment.messageId !== null || attachment.pendingMessageId !== null
    )) {
      throw new Error("Only unqueued draft attachments can be added to a pending message.");
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const storedInput = { ...input, deliveryMode };
    const message = conversationPendingMessageSchema.parse({
      attachmentIds,
      content: input.content,
      conversationId: input.conversationId,
      createdAt: now,
      deliveryMode,
      id,
      referencedConversationIds: input.referencedConversationIds ?? [],
      referencedProjectPaths: input.referencedProjectPaths ?? []
    });

    return { input: storedInput, message };
  }

  /** Insert one pending message and reserve its already-stored attachments. */
  public projectPreparedPendingMessage(prepared: PreparedPendingMessage): void {
    const input = sendConversationMessageInputSchema.parse(prepared.input);
    const message = conversationPendingMessageSchema.parse(prepared.message);
    if (input.conversationId !== message.conversationId) {
      throw new Error("Prepared pending message belongs to another conversation.");
    }
    this.getConversation(message.conversationId);
    const attachmentIds = message.attachmentIds;
    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO conversation_pending_messages
             (id, conversation_id, delivery_mode, status, payload_json, sort_order,
              created_at, updated_at, consumed_at)
           SELECT ?, ?, ?, 'pending', ?, COALESCE(MAX(sort_order), -1) + 1, ?, ?, NULL
           FROM conversation_pending_messages
           WHERE conversation_id = ? AND status = 'pending'`
        )
        .run(
          message.id,
          message.conversationId,
          message.deliveryMode,
          JSON.stringify(input),
          message.createdAt,
          message.createdAt,
          message.conversationId,
        );
      if (attachmentIds.length > 0) {
        const placeholders = attachmentIds.map(() => "?").join(", ");
        const result = this.database
          .prepare(
            `UPDATE conversation_attachments SET pending_message_id = ?
             WHERE conversation_id = ? AND message_id IS NULL
               AND (pending_message_id IS NULL OR pending_message_id = ?)
               AND id IN (${placeholders})`
          )
          .run(message.id, message.conversationId, message.id, ...attachmentIds);
        if (result.changes !== attachmentIds.length) {
          throw new Error("One or more conversation attachments are no longer available.");
        }
      }
      this.runEvents.touchConversation(message.conversationId, message.createdAt);
    });
  }

  public listPendingMessages(conversationId: string): ConversationPendingMessage[] {
    return this.listPendingMessageRecords(conversationId).map((record) => record.message);
  }

  public listPendingMessageRecords(
    conversationId: string,
    deliveryMode?: "queue" | "steer"
  ): StoredPendingMessage[] {
    this.getConversation(conversationId);
    const rows = this.database
      .prepare(
        `SELECT id, conversation_id, delivery_mode, payload_json, created_at
         FROM conversation_pending_messages
         WHERE conversation_id = ? AND status = 'pending'
           AND (? IS NULL OR delivery_mode = ?)
         ORDER BY sort_order ASC, sequence ASC`
      )
      .all(conversationId, deliveryMode ?? null, deliveryMode ?? null) as DatabaseRow[];
    return rows.map(toStoredPendingMessage);
  }

  public getNextPendingMessageRecord(conversationId: string): StoredPendingMessage | null {
    this.getConversation(conversationId);
    const row = this.database
      .prepare(
        `SELECT id, conversation_id, delivery_mode, payload_json, created_at
         FROM conversation_pending_messages
         WHERE conversation_id = ? AND status = 'pending'
         ORDER BY CASE delivery_mode WHEN 'steer' THEN 0 ELSE 1 END,
                  sort_order ASC, sequence ASC
         LIMIT 1`
      )
      .get(conversationId) as DatabaseRow | undefined;
    return row === undefined ? null : toStoredPendingMessage(row);
  }

  public listConversationIdsWithPendingMessages(): string[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT pending.conversation_id
         FROM conversation_pending_messages AS pending
         WHERE pending.status = 'pending'
           AND NOT EXISTS (
             SELECT 1 FROM runs
             WHERE runs.conversation_id = pending.conversation_id
               AND runs.status IN ('queued', 'running')
           )
         ORDER BY pending.conversation_id ASC`
      )
      .all() as DatabaseRow[];
    return rows.map((row) => asString(row, "conversation_id"));
  }

  public promotePendingMessage(pendingMessageId: string): ConversationPendingMessage[] {
    const record = this.getPendingMessageRecord(pendingMessageId);
    const input = { ...record.input, deliveryMode: "steer" as const };
    const result = this.database
      .prepare(
        `UPDATE conversation_pending_messages
         SET delivery_mode = 'steer', payload_json = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(JSON.stringify(input), new Date().toISOString(), pendingMessageId);
    if (result.changes !== 1) throw new Error("Pending conversation message was not found.");
    return this.listPendingMessages(record.message.conversationId);
  }

  public updatePendingMessage(
    pendingMessageId: string,
    content: string
  ): ConversationPendingMessage[] {
    const record = this.getPendingMessageRecord(pendingMessageId);
    const input = sendConversationMessageInputSchema.parse({ ...record.input, content });
    const result = this.database
      .prepare(
        `UPDATE conversation_pending_messages SET payload_json = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(JSON.stringify(input), new Date().toISOString(), pendingMessageId);
    if (result.changes !== 1) throw new Error("Pending conversation message was not found.");
    return this.listPendingMessages(record.message.conversationId);
  }

  public reorderPendingMessages(
    conversationId: string,
    pendingMessageIds: readonly string[]
  ): ConversationPendingMessage[] {
    const current = this.listPendingMessages(conversationId).map((message) => message.id);
    if (
      current.length !== pendingMessageIds.length
      || current.some((id) => !pendingMessageIds.includes(id))
      || new Set(pendingMessageIds).size !== pendingMessageIds.length
    ) {
      throw new Error("Pending message reorder must include the complete queue.");
    }
    this.withTransaction(() => {
      const update = this.database.prepare(
        `UPDATE conversation_pending_messages SET sort_order = ?, updated_at = ?
         WHERE id = ? AND conversation_id = ? AND status = 'pending'`
      );
      const now = new Date().toISOString();
      pendingMessageIds.forEach((id, index) => update.run(index, now, id, conversationId));
    });
    return this.listPendingMessages(conversationId);
  }

  public deletePendingMessage(pendingMessageId: string): ConversationPendingMessage[] {
    const record = this.getPendingMessageRecord(pendingMessageId);
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database
        .prepare(
          `UPDATE conversation_pending_messages
           SET status = 'cancelled', consumed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`
        )
        .run(now, now, pendingMessageId);
      if (result.changes !== 1) throw new Error("Pending conversation message was not found.");
      this.runEvents.touchConversation(record.message.conversationId, now);
    });
    return this.listPendingMessages(record.message.conversationId);
  }

  public searchConversations(input: ConversationSearchInput): ConversationSearchResult[] {
    const parsed = conversationSearchInputSchema.parse(input);
    const rows = this.database.prepare(
        `SELECT conversation_timeline.sequence, conversation_timeline.payload_json,
                conversations.title AS conversation_title,
                conversations.project_id,
                conversations.parent_conversation_id,
                conversations.thread_kind
         FROM conversation_timeline
         JOIN conversations ON conversations.id = conversation_timeline.conversation_id
         WHERE conversations.deletion_pending = 0
           AND conversations.is_archived = 0
           AND conversation_timeline.kind IN ('message', 'agent_message')
           AND json_extract(conversation_timeline.payload_json, '$.content') LIKE ? ESCAPE '\\'
           AND (? IS NULL OR conversation_timeline.conversation_id = ?)
           AND (? IS NULL OR conversation_timeline.sequence < ?)
         ORDER BY conversation_timeline.sequence DESC
         LIMIT ?`,
      ).all(
        likePattern(parsed.query),
        parsed.conversationId ?? null,
        parsed.conversationId ?? null,
        parsed.beforeSequence ?? null,
        parsed.beforeSequence ?? null,
        parsed.limit,
      ) as DatabaseRow[];

    return conversationSearchResponseSchema.parse(rows.flatMap((row) => {
      const item = conversationTimelineItemSchema.parse(
        parseJson(asString(row, "payload_json"), "conversation search timeline item"),
      );
      if (item.kind !== "message" && item.kind !== "agent_message") return [];
      return [{
        content: conversationSearchSnippet(item.content, parsed.query),
        conversationId: item.conversationId,
        conversationTitle: asString(row, "conversation_title"),
        createdAt: item.createdAt,
        itemId: item.id,
        parentConversationId: asNullableString(row, "parent_conversation_id"),
        projectId: asNullableString(row, "project_id"),
        role: item.kind === "agent_message" ? "agent" : item.role,
        sequence: asNumber(row, "sequence"),
        threadKind: asString(row, "thread_kind"),
      }];
    }));
  }

  public listCancelledPendingMessageAttachmentCleanups(
    pendingMessageId?: string,
  ): CancelledPendingMessageAttachmentCleanup[] {
    const rows = this.database
      .prepare(
        `SELECT id, conversation_id, payload_json
         FROM conversation_pending_messages
         WHERE status = 'cancelled'
           AND (? IS NULL OR id = ?)
         ORDER BY sequence ASC`,
      )
      .all(pendingMessageId ?? null, pendingMessageId ?? null) as DatabaseRow[];
    return rows.flatMap((row) => {
      const id = asString(row, "id");
      const conversationId = asString(row, "conversation_id");
      const input = sendConversationMessageInputSchema.parse(
        parseJson(asString(row, "payload_json"), "cancelled pending conversation message"),
      );
      const attachmentIds = [...new Set(input.attachmentIds ?? [])];
      if (attachmentIds.length === 0) return [];
      const contextAttachmentIds = new Set(
        this.listContextAttachmentIds(conversationId),
      );
      const attachments = this.attachmentMetadata
        .listCancelledPendingAttachments(conversationId, attachmentIds, id)
        .filter((attachment) => !contextAttachmentIds.has(attachment.id));
      return attachments.length === 0
        ? []
        : [{ attachments, conversationId, pendingMessageId: id }];
    });
  }

  public completeCancelledPendingMessageAttachmentCleanup(
    pendingMessageId: string,
    attachmentIds: readonly string[],
  ): void {
    if (attachmentIds.length === 0) return;
    const placeholders = attachmentIds.map(() => "?").join(", ");
    this.withTransaction(() => {
      const pending = this.database
        .prepare(
          `SELECT status FROM conversation_pending_messages
           WHERE id = ?`,
        )
        .get(pendingMessageId) as DatabaseRow | undefined;
      if (pending === undefined || asString(pending, "status") !== "cancelled") {
        throw new Error("Pending conversation message is not cancelled.");
      }
      this.database
        .prepare(
          `DELETE FROM conversation_attachments
           WHERE id IN (${placeholders})
             AND message_id IS NULL
             AND (pending_message_id = ? OR pending_message_id IS NULL)`,
        )
        .run(...attachmentIds, pendingMessageId);
    });
  }

  public consumePendingMessageIntoRun(
    pendingMessageId: string,
    runId: string,
    modelContent: string
  ): ConversationMessageItem {
    const prepared = this.preparePendingMessageConsumption(
      pendingMessageId,
      runId,
      modelContent,
    );
    this.projectPreparedPendingMessageConsumption(prepared);
    return prepared.userMessage;
  }

  /** Construct a Steer user message before its JSONL write-ahead event. */
  public preparePendingMessageConsumption(
    pendingMessageId: string,
    runId: string,
    modelContent: string,
  ): PreparedPendingMessageConsumption {
    const record = this.getPendingMessageRecord(pendingMessageId);
    const conversation = this.getConversation(record.message.conversationId);
    if (conversation.activeRunId !== runId) {
      throw new Error("Pending message can only steer its active conversation run.");
    }
    const messageId = pendingMessageId;
    const attachments = this.listConversationAttachmentsByIds(
      record.message.conversationId,
      record.message.attachmentIds
    );
    if (attachments.some((attachment) => attachment.pendingMessageId !== pendingMessageId)) {
      throw new Error("A queued attachment is no longer reserved for this message.");
    }
    const message = conversationMessageItemSchema.parse({
      attachments: attachments.map((attachment) => ({
        ...toPublicConversationAttachment(attachment),
        messageId
      })),
      content: record.message.content,
      conversationId: record.message.conversationId,
      createdAt: new Date().toISOString(),
      id: messageId,
      kind: "message",
      modelId: null,
      role: "user",
      runId,
      status: "completed"
    });

    return { modelContent, pendingMessageId, userMessage: message };
  }

  /** Commit a Steer user message; an event ID makes write-ahead replay idempotent. */
  public projectPreparedPendingMessageConsumption(
    prepared: PreparedPendingMessageConsumption,
    eventId?: string,
  ): void {
    this.withTransaction(() => {
      this.projectPreparedPendingMessageConsumptionInTransaction(prepared, eventId);
    });
  }

  private projectPreparedPendingMessageConsumptionInTransaction(
    prepared: PreparedPendingMessageConsumption,
    eventId?: string,
  ): void {
    const message = conversationMessageItemSchema.parse(prepared.userMessage);
    const record = this.getPendingMessageRecord(prepared.pendingMessageId);
    if (
      message.role !== "user"
      || message.conversationId !== record.message.conversationId
      || message.runId === null
    ) {
      throw new Error("Prepared pending message consumption is invalid.");
    }
    const conversation = this.getConversation(message.conversationId);
    if (conversation.activeRunId !== message.runId) {
      throw new Error("Pending message can only steer its active conversation run.");
    }
    this.consumePendingRecord(prepared.pendingMessageId);
    this.runEvents.insertTimelineItem(message);
    this.bindPendingAttachmentsToMessage(
      prepared.pendingMessageId,
      message.id,
      message.attachments.length,
    );
    if (eventId === undefined) {
      this.runEvents.insertModelMessage({
        attachmentIds: record.message.attachmentIds,
        content: prepared.modelContent,
        conversationId: message.conversationId,
        role: "user",
        runId: message.runId,
        toolCallId: null,
        toolCalls: []
      });
    } else {
      this.runEvents.insertThreadLogModelMessage({
        attachmentIds: record.message.attachmentIds,
        content: prepared.modelContent,
        conversationId: message.conversationId,
        createdAt: message.createdAt,
        eventId,
        role: "user",
        runId: message.runId,
        toolCallId: null,
        toolCalls: [],
      });
    }
    this.runEvents.touchConversation(message.conversationId, message.createdAt);
  }

  public createRunFromPendingMessage(
    pendingMessageId: string,
    modelId: string,
    modelContent: string,
    executionSnapshot?: RunExecutionSnapshot,
  ): RunCreation {
    const prepared = this.prepareRunFromPendingMessage(
      pendingMessageId,
      modelId,
      modelContent,
      executionSnapshot,
    );
    this.projectPreparedRunWithUserMessage(prepared);
    return {
      conversation: this.getConversation(prepared.conversationId),
      runId: prepared.runId,
      userMessage: prepared.userMessage,
    };
  }

  /** Validates a queued user input without consuming it or creating its Run. */
  public prepareRunFromPendingMessage(
    pendingMessageId: string,
    modelId: string,
    modelContent: string,
    executionSnapshot?: RunExecutionSnapshot,
  ): PreparedRunWithUserMessage {
    const record = this.getPendingMessageRecord(pendingMessageId);
    const conversation = this.getConversation(record.message.conversationId);
    this.assertNoActiveRun(record.message.conversationId);
    const runId = randomUUID();
    const messageId = pendingMessageId;
    const now = new Date().toISOString();
    const attachments = this.listConversationAttachmentsByIds(
      record.message.conversationId,
      record.message.attachmentIds
    );
    if (attachments.some((attachment) => attachment.pendingMessageId !== pendingMessageId)) {
      throw new Error("A queued attachment is no longer reserved for this message.");
    }
    const message = conversationMessageItemSchema.parse({
      attachments: attachments.map((attachment) => ({
        ...toPublicConversationAttachment(attachment),
        messageId
      })),
      content: record.message.content,
      conversationId: record.message.conversationId,
      createdAt: now,
      id: messageId,
      kind: "message",
      modelId: null,
      role: "user",
      runId,
      status: "completed"
    });
    const userMessageCount = this.countUserMessages(record.message.conversationId);
    const nextTitle = userMessageCount === 0 && !this.hasStableTeamParticipantTitle(conversation) && /^新会话(?: \d+)?$/u.test(conversation.title)
      ? this.createTitleFromMessage(
          record.message.content || attachments[0]?.name || "新会话"
        )
      : conversation.title;

    return {
      attachmentIds: [...record.message.attachmentIds],
      conversationId: record.message.conversationId,
      executionSnapshot,
      modelContent,
      modelId,
      nextTitle,
      pendingMessageId,
      runCreatedAt: now,
      runId,
      userMessage: message,
    };
  }

  public createRunForAgentMessage(
    conversationId: string,
    modelId: string,
    executionSnapshot?: RunExecutionSnapshot,
  ): AgentMessageRunCreation {
    this.getConversation(conversationId);
    this.assertNoActiveRun(conversationId);
    const now = new Date().toISOString();
    const runId = randomUUID();

    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs
             (id, conversation_id, model_id, status, error, created_at, updated_at,
              execution_snapshot_json)
           VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`
        )
        .run(
          runId,
          conversationId,
          modelId,
          now,
          now,
          serializeRunExecutionSnapshot(executionSnapshot),
        );
      this.database
        .prepare(
          "UPDATE conversations SET updated_at = ?, has_unread_result = 0 WHERE id = ?"
        )
        .run(now, conversationId);
    });

    return {
      conversation: this.getConversation(conversationId),
      runId,
    };
  }

  public createRunWithUserMessage(
    conversationId: string,
    content: string,
    modelId: string,
    attachmentIds: readonly string[] = [],
    modelContent = content,
    executionSnapshot?: RunExecutionSnapshot,
    titleOverride?: string,
  ): RunCreation {
    const prepared = this.prepareRunWithUserMessage(
      conversationId,
      content,
      modelId,
      attachmentIds,
      modelContent,
      executionSnapshot,
      titleOverride,
    );
    this.projectPreparedRunWithUserMessage(prepared);
    return {
      conversation: this.getConversation(prepared.conversationId),
      runId: prepared.runId,
      userMessage: prepared.userMessage,
    };
  }

  /**
   * Validates and assigns stable IDs for a user turn without writing SQLite.
   * This lets the runtime durably append one `run_queued` event before the
   * SQLite projection is created.
   */
  public prepareRunWithUserMessage(
    conversationId: string,
    content: string,
    modelId: string,
    attachmentIds: readonly string[] = [],
    modelContent = content,
    executionSnapshot?: RunExecutionSnapshot,
    titleOverride?: string,
  ): PreparedRunWithUserMessage {
    const conversation = this.getConversation(conversationId);
    this.assertNoActiveRun(conversationId);
    const now = new Date().toISOString();
    const runId = randomUUID();
    const attachments = this.listConversationAttachmentsByIds(conversationId, attachmentIds);
    if (attachments.some(
      (attachment) => attachment.messageId !== null || attachment.pendingMessageId !== null
    )) {
      throw new Error("Only draft attachments can be sent.");
    }
    const messageId = randomUUID();
    const message = conversationMessageItemSchema.parse({
      attachments: attachments.map((attachment) => ({
        contextTokens: attachment.contextTokens,
        conversationId: attachment.conversationId,
        createdAt: attachment.createdAt,
        id: attachment.id,
        kind: attachment.kind,
        messageId,
        mimeType: attachment.mimeType,
        name: attachment.name,
        projectPath: attachment.projectPath,
        sizeBytes: attachment.sizeBytes,
        source: attachment.source,
        truncated: attachment.truncated
      })),
      content,
      conversationId,
      createdAt: now,
      id: messageId,
      kind: "message",
      modelId: null,
      role: "user",
      runId,
      status: "completed"
    });
    const userMessageCount = this.countUserMessages(conversationId);
    const nextTitle = this.hasStableTeamParticipantTitle(conversation)
      ? conversation.title
      : titleOverride ?? (userMessageCount === 0 && /^新会话(?: \d+)?$/u.test(conversation.title)
          ? this.createTitleFromMessage(content || attachments[0]?.name || "新会话")
          : conversation.title);

    return {
      attachmentIds: [...attachmentIds],
      conversationId,
      executionSnapshot,
      modelContent,
      modelId,
      nextTitle,
      pendingMessageId: null,
      runCreatedAt: now,
      runId,
      userMessage: message,
    };
  }

  /** Materializes an already validated initial user turn into SQLite. */
  public projectPreparedRunWithUserMessage(
    prepared: PreparedRunWithUserMessage,
  ): void {
    this.getConversation(prepared.conversationId);
    this.assertNoActiveRun(prepared.conversationId);
    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs
             (id, conversation_id, model_id, status, error, created_at, updated_at,
              execution_snapshot_json)
           VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`
        )
        .run(
          prepared.runId,
          prepared.conversationId,
          prepared.modelId,
          prepared.runCreatedAt,
          prepared.runCreatedAt,
          serializeRunExecutionSnapshot(prepared.executionSnapshot),
        );
      if (prepared.pendingMessageId !== null) {
        const pending = this.getPendingMessageRecord(prepared.pendingMessageId);
        if (
          pending.message.conversationId !== prepared.conversationId
          || pending.message.content !== prepared.userMessage.content
        ) {
          throw new Error("Queued conversation message changed before its Run was created.");
        }
        this.consumePendingRecord(prepared.pendingMessageId);
      }
      this.runEvents.insertTimelineItem(prepared.userMessage);
      if (prepared.pendingMessageId !== null) {
        this.bindPendingAttachmentsToMessage(
          prepared.pendingMessageId,
          prepared.userMessage.id,
          prepared.attachmentIds.length,
        );
      } else if (prepared.attachmentIds.length > 0) {
        const placeholders = prepared.attachmentIds.map(() => "?").join(", ");
        const result = this.database
          .prepare(
            `UPDATE conversation_attachments SET message_id = ?
             WHERE conversation_id = ? AND message_id IS NULL
               AND pending_message_id IS NULL AND id IN (${placeholders})`
          )
          .run(
            prepared.userMessage.id,
            prepared.conversationId,
            ...prepared.attachmentIds,
          );
        if (result.changes !== prepared.attachmentIds.length) {
          throw new Error("One or more conversation attachments are no longer drafts.");
        }
      }
      this.runEvents.insertModelMessage({
        attachmentIds: prepared.attachmentIds,
        content: prepared.modelContent,
        conversationId: prepared.conversationId,
        role: "user",
        runId: prepared.runId,
        toolCallId: null,
        toolCalls: []
      });
      this.database
        .prepare(
          "UPDATE conversations SET title = ?, updated_at = ?, has_unread_result = 0 WHERE id = ?"
        )
        .run(
          prepared.nextTitle,
          prepared.runCreatedAt,
          prepared.conversationId,
        );
    });
  }

  public getLatestUserMessageReplacementSource(
    conversationId: string,
    messageId: string,
  ): LatestUserMessageReplacementSource {
    this.getConversation(conversationId);
    const timelineRecord = this.getLatestUserTimelineRecord(conversationId);
    if (timelineRecord === null || timelineRecord.message.id !== messageId) {
      throw new Error("Only the latest sent user message can be edited.");
    }
    const runId = timelineRecord.message.runId;
    if (runId === null) throw new Error("The selected user message is not associated with a run.");
    const modelRecord = this.getLatestUserModelMessageRecord(conversationId, runId);
    if (modelRecord === null) {
      throw new Error("The selected user message is missing from the model context.");
    }
    const timelineAttachmentIds = timelineRecord.message.attachments.map(
      (attachment) => attachment.id,
    );
    if (
      timelineAttachmentIds.length !== modelRecord.attachmentIds.length
      || timelineAttachmentIds.some((id, index) => id !== modelRecord.attachmentIds[index])
    ) {
      throw new Error("The selected user message attachments are inconsistent.");
    }
    return {
      message: timelineRecord.message,
      modelContent: modelRecord.content,
    };
  }

  /**
   * Creates the immutable replacement facts before a `run_replaced` event is
   * appended. No SQLite row is changed by this method.
   */
  public prepareLatestUserMessageReplacement(
    input: ReplaceLatestUserMessageInput,
  ): PreparedLatestUserMessageReplacement {
    const conversation = this.getConversation(input.conversationId);
    this.assertNoActiveRun(input.conversationId);
    const source = this.getLatestUserMessageReplacementSource(
      input.conversationId,
      input.messageId,
    );
    const previousRunId = source.message.runId;
    if (previousRunId === null) {
      throw new Error("The selected user message is not associated with a run.");
    }
    const attachments = this.listLatestUserMessageReplacementAttachments(
      input.conversationId,
      source.message.id,
      input.attachmentIds,
    );
    const runId = randomUUID();
    const now = new Date().toISOString();
    const userMessage = conversationMessageItemSchema.parse({
      ...source.message,
      attachments: attachments.map((attachment) => ({
        ...toPublicConversationAttachment(attachment),
        messageId: source.message.id,
      })),
      content: input.content,
      createdAt: now,
      runId,
    });
    const nextTitle = this.countUserMessages(input.conversationId) === 1
      && !this.hasStableTeamParticipantTitle(conversation)
      ? this.createTitleFromMessage(
          input.content || userMessage.attachments[0]?.name || "新会话",
        )
      : conversation.title;
    return {
      conversationId: input.conversationId,
      executionSnapshot: input.executionSnapshot,
      modelContent: input.modelContent,
      modelId: input.modelId,
      nextTitle,
      previousRunId,
      runCreatedAt: now,
      runId,
      userMessage,
    };
  }

  public replaceLatestUserMessage(input: ReplaceLatestUserMessageInput): RunCreation {
    const now = new Date().toISOString();
    const runId = randomUUID();
    let replacement: ConversationMessageItem | null = null;

    this.withTransaction(() => {
      const conversation = this.getConversation(input.conversationId);
      this.assertNoActiveRun(input.conversationId);
      const timelineRecord = this.getLatestUserTimelineRecord(input.conversationId);
      if (timelineRecord === null || timelineRecord.message.id !== input.messageId) {
        throw new Error("Only the latest sent user message can be edited.");
      }
      const oldRunId = timelineRecord.message.runId;
      if (oldRunId === null) {
        throw new Error("The selected user message is not associated with a run.");
      }
      const modelRecord = this.getLatestUserModelMessageRecord(input.conversationId, oldRunId);
      if (modelRecord === null) {
        throw new Error("The selected user message is missing from the model context.");
      }
      const attachments = this.listLatestUserMessageReplacementAttachments(
        input.conversationId,
        timelineRecord.message.id,
        input.attachmentIds,
      );
      const message = conversationMessageItemSchema.parse({
        ...timelineRecord.message,
        attachments: attachments.map((attachment) => ({
          ...toPublicConversationAttachment(attachment),
          messageId: timelineRecord.message.id,
        })),
        content: input.content,
        createdAt: now,
        runId,
      });

      this.database.prepare(
        `DELETE FROM conversation_timeline
         WHERE conversation_id = ? AND run_id = ? AND sequence > ?`,
      ).run(input.conversationId, oldRunId, timelineRecord.sequence);
      this.database.prepare(
        `DELETE FROM model_messages
         WHERE conversation_id = ? AND run_id = ? AND sequence > ?`,
      ).run(input.conversationId, oldRunId, modelRecord.sequence);
      const timelineUpdate = this.database.prepare(
        `UPDATE conversation_timeline
         SET run_id = ?, payload_json = ?, created_at = ?
         WHERE id = ? AND conversation_id = ? AND run_id = ?`,
      ).run(
        runId,
        JSON.stringify(message),
        now,
        input.messageId,
        input.conversationId,
        oldRunId,
      );
      if (timelineUpdate.changes !== 1) {
        throw new Error("The latest user timeline message could not be replaced.");
      }
      const modelUpdate = this.database.prepare(
        `UPDATE model_messages
         SET run_id = ?, content = ?, attachment_ids_json = ?, created_at = ?
         WHERE id = ? AND conversation_id = ? AND run_id = ?`,
      ).run(
        runId,
        input.modelContent,
        JSON.stringify(input.attachmentIds),
        now,
        modelRecord.id,
        input.conversationId,
        oldRunId,
      );
      if (modelUpdate.changes !== 1) {
        throw new Error("The latest user model message could not be replaced.");
      }
      const draftAttachmentIds = attachments
        .filter((attachment) => attachment.messageId === null)
        .map((attachment) => attachment.id);
      if (draftAttachmentIds.length > 0) {
        const placeholders = draftAttachmentIds.map(() => "?").join(", ");
        const attachmentUpdate = this.database.prepare(
          `UPDATE conversation_attachments SET message_id = ?
           WHERE conversation_id = ? AND message_id IS NULL
             AND pending_message_id IS NULL AND id IN (${placeholders})`,
        ).run(input.messageId, input.conversationId, ...draftAttachmentIds);
        if (attachmentUpdate.changes !== draftAttachmentIds.length) {
          throw new Error("One or more replacement attachments are no longer drafts.");
        }
      }
      this.database.prepare(
        `DELETE FROM conversation_context_checkpoints
         WHERE conversation_id = ? AND covered_through_sequence >= ?`,
      ).run(input.conversationId, modelRecord.sequence);
      this.database.prepare(
        `INSERT INTO runs
           (id, conversation_id, model_id, status, error, created_at, updated_at,
            execution_snapshot_json)
         VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`,
      ).run(
        runId,
        input.conversationId,
        input.modelId,
        now,
        now,
        serializeRunExecutionSnapshot(input.executionSnapshot),
      );
      const nextTitle = this.countUserMessages(input.conversationId) === 1
        && !this.hasStableTeamParticipantTitle(conversation)
        ? this.createTitleFromMessage(
            input.content || message.attachments[0]?.name || "新会话",
          )
        : conversation.title;
      this.database.prepare(
        `UPDATE conversations
         SET title = ?, updated_at = ?, has_unread_result = 0
         WHERE id = ?`,
      ).run(nextTitle, now, input.conversationId);
      replacement = message;
    });

    if (replacement === null) throw new Error("The latest user message could not be replaced.");
    return {
      conversation: this.getConversation(input.conversationId),
      runId,
      userMessage: replacement,
    };
  }

  public markRunRunning(runId: string): void {
    this.updateRun(runId, "running", null);
  }

  public finishRun(
    runId: string,
    status: "completed" | "failed" | "cancelled",
    error: string | null
  ): void {
    this.updateRun(runId, status, error);
  }

  public completeRun(input: CompleteRunInput): CompletedRun {
    if (input.assistant?.kind === "failure" && input.status !== "failed") {
      throw new Error("A failed Assistant message requires a failed Run.");
    }
    if (input.assistant?.kind === "turn" && input.status !== "completed") {
      throw new Error("A final Assistant turn requires a completed Run.");
    }
    if (input.assistant?.kind === "cancelled" && input.status !== "cancelled") {
      throw new Error("A partial Assistant message requires a cancelled Run.");
    }

    return this.withTransaction(() => {
      const runConversationId = this.runEvents.updateRunInTransaction(
        input.runId,
        input.status,
        input.error,
      );
      if (runConversationId !== input.conversationId) {
        throw new Error("The Run does not belong to the conversation.");
      }
      this.terminalResults.set(input.runId, terminalReceiptSummary(input.result));

      const assistantMessage = this.runEvents.appendTerminalAssistant(input);

      const subagentTask = this.completeSubagentTaskByRunInTransaction({
        error: input.error,
        result: input.result,
        status: input.status,
        targetRunId: input.runId,
      });
      const subagentResultMessage = subagentTask === null
        ? null
        : this.deliverSubagentTaskResultInTransaction(subagentTask.id);
      return { assistantMessage, subagentResultMessage, subagentTask };
    });
  }

  public appendAssistantTurn(input: {
    content: string;
    conversationId: string;
    messageId: string;
    modelId: string;
    providerState?: ModelProviderState;
    reasoningContent?: string;
    runId: string;
    toolCalls: ModelToolCall[];
  }): ConversationMessageItem | null {
    const prepared = prepareAssistantTurn(input);
    this.withTransaction(() => this.runEvents.appendAssistantTurn(prepared));
    return prepared.message;
  }

  public appendAssistantFailure(input: {
    content: string;
    conversationId: string;
    messageId: string;
    modelId: string;
    runId: string;
  }): ConversationMessageItem {
    const prepared = prepareAssistantFailure(input);
    this.withTransaction(() => this.runEvents.appendAssistantFailure(prepared));
    return prepared.message;
  }

  public appendToolStarted(tool: ConversationToolItem): void {
    this.runEvents.appendToolStarted(tool);
  }

  public upsertModelRetry(retry: ConversationModelRetryItem): void {
    const validated = conversationModelRetryItemSchema.parse(retry);
    this.getConversation(validated.conversationId);
    this.withTransaction(() => {
      this.runEvents.upsertModelRetryInTransaction(validated);
      this.runEvents.touchConversation(validated.conversationId, validated.updatedAt);
    });
  }

  public updateTool(tool: ConversationToolItem): void {
    this.runEvents.updateTool(tool);
  }

  /** Persist a runtime-owned timeline activity without adding a model-visible ToolMessage. */
  public upsertRuntimeActivity(tool: ConversationToolItem): void {
    const validated = conversationToolItemSchema.parse(tool);
    this.getConversation(validated.conversationId);
    this.withTransaction(() => this.runEvents.upsertRuntimeActivity(validated));
  }

  /**
   * A Run cannot leave an actionable approval behind after it reaches a
   * terminal state. Returning the updated rows lets AgentRuntime write the
   * same fact to ThreadLog for recovery.
   */
  public expirePendingToolApprovalsForRun(runId: string): ConversationToolItem[] {
    return this.withTransaction(() => this.runEvents.expirePendingToolApprovalsForRunInTransaction(runId));
  }

  public completeTool(input: {
    providerCallId: string;
    result: string;
    tool: ConversationToolItem;
  }): void {
    const tool = conversationToolItemSchema.parse(input.tool);
    this.withTransaction(() => this.runEvents.completeTool(input, tool));
  }

  public listModelMessages(conversationId: string): StoredModelMessage[] {
    return this.listContextMessages(conversationId).map((message) => ({
      attachmentIds: message.attachmentIds,
      content: message.content,
      ...(message.providerState === undefined ? {} : { providerState: message.providerState }),
      role: message.role,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls
    }));
  }

  public listContextMessages(conversationId: string): StoredContextMessage[] {
    return this.history.listContextMessages(conversationId);
  }

  /** Provider usage UI does not need message bodies or tool payloads. */
  public listAssistantProviderStates(conversationId: string): ModelProviderState[] {
    this.getConversation(conversationId);
    return this.history.listAssistantProviderStates(conversationId);
  }

  public listContextAttachmentIds(conversationId: string): string[] {
    this.getConversation(conversationId);
    return this.history.listContextAttachmentIds(conversationId);
  }

  public getLatestConversationRequestContent(conversationId: string): string | null {
    this.getConversation(conversationId);
    return this.history.getLatestConversationRequestContent(conversationId);
  }

  public getLatestCompletedAssistantContent(conversationId: string): string | null {
    this.getConversation(conversationId);
    return this.history.getLatestCompletedAssistantContent(conversationId);
  }

  /**
   * Read a bounded newest-first window without materializing the whole
   * conversation. Results are returned in chronological order so callers can
   * pass them directly to context formatting code.
   */
  public listContextMessagesPage(input: {
    afterSequence?: number;
    beforeSequence?: number;
    conversationId: string;
    limit: number;
  }): StoredContextMessage[] {
    this.getConversation(input.conversationId);
    return this.history.listContextMessagesPage(input);
  }

  public countContextMessages(input: {
    afterSequence?: number;
    beforeSequence?: number;
    conversationId: string;
  }): number {
    this.getConversation(input.conversationId);
    return this.history.countContextMessages(input);
  }

  /**
   * ContextCompiler uses the JSONL history as its chronological source. This
   * bounded lookup supplies the volatile sequence needed to omit the current
   * query without loading the whole materialized history on every model turn.
   */
  public getLatestContextUserMessage(conversationId: string): StoredContextMessage | null {
    return this.history.getLatestContextUserMessage(conversationId);
  }

  /** Translate a ThreadLog-local message position to the volatile timeline sequence. */
  public resolveContextCheckpointSequence(
    conversationId: string,
    contextSequence: number,
  ): number {
    this.getConversation(conversationId);
    return this.history.resolveContextCheckpointSequence(conversationId, contextSequence);
  }

  public searchContextMessages(input: {
    beforeSequence?: number;
    conversationId: string;
    excludeSequences?: readonly number[];
    limit?: number;
    query: string;
  }): StoredContextMessage[] {
    this.getConversation(input.conversationId);
    return this.history.searchContextMessages(input);
  }

  public getContextCheckpoint(conversationId: string): ConversationContextCheckpoint | null {
    return this.contextSummaries.getContextCheckpoint(conversationId);
  }

  public saveContextCheckpoint(
    conversationId: string,
    coveredThroughSequence: number,
    summary: string
  ): ConversationContextCheckpoint {
    return this.projectPreparedContextCheckpoint(
      this.prepareContextCheckpoint(conversationId, coveredThroughSequence, summary),
    );
  }

  /** Validate a checkpoint before the JSONL write-ahead boundary. */
  public prepareContextCheckpoint(
    conversationId: string,
    coveredThroughSequence: number,
    summary: string,
  ): ConversationContextCheckpoint {
    this.getConversation(conversationId);
    return this.contextSummaries.prepareContextCheckpoint(conversationId, coveredThroughSequence, summary);
  }

  /** Materialize a previously validated checkpoint using its durable times. */
  public projectPreparedContextCheckpoint(
    checkpoint: ConversationContextCheckpoint,
  ): ConversationContextCheckpoint {
    this.getConversation(checkpoint.conversationId);
    return this.contextSummaries.projectPreparedContextCheckpoint(checkpoint);
  }

  public getThreadLogProjectionCursor(
    conversationId: string,
  ): ThreadLogProjectionCursor | null {
    this.getConversation(conversationId);
    const cursor = this.projectionCursors.get(conversationId);
    return cursor === undefined ? null : { ...cursor };
  }

  public markThreadLogProjectionCurrent(
    conversationId: string,
    source: { modifiedAtMs: number; sizeBytes: number },
  ): ThreadLogProjectionCursor {
    this.getConversation(conversationId);
    if (
      !Number.isFinite(source.modifiedAtMs)
      || !Number.isSafeInteger(source.sizeBytes)
      || source.sizeBytes < 0
    ) {
      throw new Error("ThreadLog source signature is invalid.");
    }
    const current = this.projectionCursors.get(conversationId);
    if (current === undefined) throw new Error("ThreadLog projection cursor does not exist.");
    const next = { ...current, sourceSizeBytes: source.sizeBytes, sourceModifiedAtMs: source.modifiedAtMs, updatedAt: new Date().toISOString() };
    this.projectionCursors.set(conversationId, next);
    return { ...next };
  }

  public getLatestRunExecutionSnapshot(conversationId: string): RunExecutionSnapshot | null {
    this.getConversation(conversationId);
    const row = this.database.prepare(
      `SELECT execution_snapshot_json FROM runs
       WHERE conversation_id = ? AND execution_snapshot_json IS NOT NULL
       ORDER BY created_at DESC, rowid DESC LIMIT 1`,
    ).get(conversationId) as DatabaseRow | undefined;
    return row === undefined
      ? null
      : parseRunExecutionSnapshot(asNullableString(row, "execution_snapshot_json"));
  }

  public getProjectedThreadLogEventId(
    conversationId: string,
    sequence: number,
  ): string | null {
    this.getConversation(conversationId);
    if (!Number.isSafeInteger(sequence) || sequence < 1) {
      throw new Error("ThreadLog event sequence must be a positive integer.");
    }
    const events = this.projectionEvents.get(conversationId);
    const first = events?.[0]?.sequence ?? 1;
    return events?.[sequence - first]?.eventId ?? null;
  }

  /** Clears only the derived event index before a Conversation log is rebuilt. */
  public resetThreadLogProjection(conversationId: string): void {
    this.userQuestions.reset(conversationId);
    this.getConversation(conversationId);
    this.clearThreadLogProjection(conversationId);
  }

  private clearThreadLogProjection(conversationId: string): void {
    for (const event of this.projectionEvents.get(conversationId) ?? []) this.projectionEventOwners.delete(event.eventId);
    this.projectionEvents.delete(conversationId);
    this.projectionCursors.delete(conversationId);
  }

  /**
   * Materializes the append-only log into its idempotent event index. Selected
   * write-ahead facts have already updated their business projection before
   * this cursor advances; all other events remain shadow-log metadata.
   */
  public projectThreadLogEvents(
    conversationId: string,
    events: readonly ThreadLogProjectionEvent[],
    source?: { modifiedAtMs: number; sizeBytes: number },
  ): ThreadLogProjectionCursor | null {
    this.getConversation(conversationId);
    if (events.length === 0) return this.getThreadLogProjectionCursor(conversationId);
    if (
      source !== undefined
      && (
        !Number.isFinite(source.modifiedAtMs)
        || !Number.isSafeInteger(source.sizeBytes)
        || source.sizeBytes < 0
      )
    ) {
      throw new Error("ThreadLog source signature is invalid.");
    }

    const current = this.getThreadLogProjectionCursor(conversationId);
    let expectedSequence = (current?.lastSequence ?? 0) + 1;
    for (const event of events) {
      if (
        !Number.isSafeInteger(event.sequence)
        || event.sequence !== expectedSequence
        || event.eventId.trim().length === 0
        || event.type.trim().length === 0
        || Number.isNaN(Date.parse(event.createdAt))
      ) {
        throw new Error("ThreadLog projection events are not a valid ordered sequence.");
      }
      expectedSequence += 1;
    }

    const lastEvent = events.at(-1);
    if (lastEvent === undefined) throw new Error("ThreadLog projection events are empty.");
    const eventIds = new Set<string>();
    for (const event of events) {
      if (eventIds.has(event.eventId) || this.projectionEventOwners.has(event.eventId)) {
        throw new Error("ThreadLog eventId conflicts with an existing event index row.");
      }
      eventIds.add(event.eventId);
    }
    const stored = structuredClone(events);
    for (const event of stored) this.userQuestions.apply(conversationId, event);
    const currentEvents = this.projectionEvents.get(conversationId) ?? [];
    for (const event of stored) {
      currentEvents.push(event);
      this.projectionEventOwners.set(event.eventId, conversationId);
    }
    this.projectionEvents.set(conversationId, currentEvents);
    this.projectionCursors.set(conversationId, {
      conversationId, lastSequence: lastEvent.sequence, lastEventId: lastEvent.eventId,
      sourceSizeBytes: source?.sizeBytes ?? null, sourceModifiedAtMs: source?.modifiedAtMs ?? null,
      updatedAt: new Date().toISOString(),
    });
    return this.getThreadLogProjectionCursor(conversationId);
  }

  public listProjectedThreadLogEvents(conversationId: string): ThreadLogProjectionEvent[] {
    this.getConversation(conversationId);
    return structuredClone(this.projectionEvents.get(conversationId) ?? []);
  }

  /**
   * Recreates AttachmentStore metadata from renderer-safe references already
   * carried by durable message and pending-queue events. The resolver is
   * supplied by AttachmentStore so JSONL never contains a managed absolute
   * path or extracted text.
   */
  public projectThreadLogAttachmentReferences(
    conversationId: string,
    events: readonly ThreadLogProjectionEvent[],
    resolvePaths: ThreadLogAttachmentPathResolver,
  ): void {
    this.getConversation(conversationId);
    const byId = new Map<string, ConversationAttachment>();
    for (const event of events) {
      if (event.type === "legacy_snapshot_imported" && Array.isArray(event.payload.timeline)) {
        for (const item of event.payload.timeline) {
          const tool = conversationToolItemSchema.safeParse(item);
          const image = tool.success ? toolScreenshotImage(tool.data) : null;
          for (const generated of tool.success ? toolGeneratedImages(tool.data) : []) if (generated.conversationId === conversationId) byId.set(generated.id, generated);
          if (image !== null && image.conversationId === conversationId) byId.set(image.id, image);
          const message = conversationMessageItemSchema.safeParse(item);
          if (!message.success) continue;
          for (const attachment of message.data.attachments) {
            // Legacy forks can display their parent's attachments. Restore each
            // attachment from its owner's log, never reassign its ownership.
            if (attachment.conversationId !== conversationId) continue;
            byId.set(attachment.id, attachment);
          }
        }
      }
      const message = threadLogUserMessage(event.payload, conversationId, event.createdAt);
      if (message !== null) {
        for (const attachment of message.attachments) {
          byId.set(attachment.id, attachment);
        }
      }
      const references = z.array(conversationAttachmentSchema).safeParse(
        event.payload.attachmentRefs,
      );
      if (!references.success) continue;
      for (const attachment of references.data) {
        if (attachment.conversationId !== conversationId) {
          throw new Error("ThreadLog attachment reference belongs to another Conversation.");
        }
        byId.set(attachment.id, attachment);
      }
    }
    if (byId.size === 0) return;

    this.withTransaction(() => {
      const insert = this.database.prepare(
        `INSERT OR IGNORE INTO conversation_attachments
           (id, conversation_id, message_id, source, kind, name, mime_type,
            size_bytes, project_path, stored_path, extracted_text_path,
            context_tokens, truncated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const attachment of byId.values()) {
        const paths = resolvePaths(attachment);
        insert.run(
          attachment.id,
          attachment.conversationId,
          attachment.messageId,
          attachment.source,
          attachment.kind,
          attachment.name,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.projectPath,
          paths.storedPath,
          paths.extractedTextPath,
          attachment.contextTokens,
          Number(attachment.truncated),
          attachment.createdAt,
        );
      }
    });
  }

  /**
   * Materializes write-ahead business events into the volatile query view.
   */
  public projectThreadLogBusinessEvents(
    conversationId: string,
    events: readonly ThreadLogProjectionEvent[],
  ): boolean {
    this.getConversation(conversationId);
    if (events.length === 0 || events.some((event) => event.type === "legacy_snapshot_imported")) {
      return false;
    }
    let projected = false;
    this.withTransaction(() => {
      for (const event of events) {
        if (this.materializeCollaborationControl(conversationId, event)) {
          projected = true;
          continue;
        }
        if (event.type === "conversation_result_viewed") {
          this.markConversationResultViewed(conversationId);
          projected = true;
          continue;
        }
        if (event.type === "conversation_properties_changed") {
          this.materializeThreadLogConversationProperties(conversationId, event.payload);
          projected = true;
          continue;
        }
        if (event.type === "run_queued") {
          this.materializeThreadLogQueuedRun(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "run_replaced") {
          this.materializeThreadLogReplacedRun(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "run_terminal") {
          this.materializeThreadLogTerminalRun(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "run_started" && event.payload.writeAhead === true) {
          this.materializeThreadLogStartedRun(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "assistant_message" && event.payload.writeAhead === true) {
          this.materializeThreadLogAssistantMessage(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "tool_call_requested" && event.payload.writeAhead === true) {
          this.materializeThreadLogToolStarted(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "tool_result" && event.payload.writeAhead === true) {
          this.materializeThreadLogToolResult(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "model_retry_updated" && event.payload.writeAhead === true) {
          this.materializeThreadLogModelRetry(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "runtime_activity_updated" && event.payload.writeAhead === true) {
          this.materializeThreadLogRuntimeActivity(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "context_checkpoint" && event.payload.writeAhead === true) {
          this.materializeThreadLogContextCheckpoint(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "pending_messages_updated" && event.payload.writeAhead === true) {
          this.materializeThreadLogPendingMessages(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "pending_message_cancelled" && event.payload.writeAhead === true) {
          this.materializeThreadLogPendingMessageCancellation(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "user_message" && event.payload.writeAhead === true) {
          this.materializeThreadLogPendingMessageConsumption(conversationId, event);
          projected = true;
        }
      }
    });
    return projected;
  }

  /**
   * Replays the latest durable mutable-property snapshot even when message and
   * run projections already exist. Conversation metadata must remain fully
   * recoverable from its JSONL source.
   */
  public restoreThreadLogConversationProperties(
    conversationId: string,
    events: readonly ThreadLogProjectionEvent[],
  ): boolean {
    const propertyEvents = events.filter(
      (event) => event.type === "conversation_properties_changed",
    );
    if (propertyEvents.length === 0) return false;
    const latestPropertyEvent = propertyEvents.at(-1);
    if (latestPropertyEvent === undefined) return false;
    const payload = structuredClone(
      conversationPropertiesChangedPayloadSchema.parse(latestPropertyEvent.payload),
    );
    for (const event of events) {
      if (event.sequence <= latestPropertyEvent.sequence) continue;
      if (event.type !== "run_queued" && event.type !== "run_replaced") continue;
      const title = readProjectionString(event.payload, "title");
      if (title === null) continue;
      payload.properties.title = title;
      payload.properties.updatedAt = readProjectionIsoDate(event.payload, "createdAt")
        ?? event.createdAt;
    }
    this.withTransaction(() => {
      this.materializeThreadLogConversationProperties(conversationId, payload);
    });
    return true;
  }

  public restoreConversationPropertySnapshot(
    conversationId: string,
    payload: ConversationPropertiesChangedPayload,
  ): void {
    this.withTransaction(() => {
      this.materializeThreadLogConversationProperties(conversationId, payload);
    });
  }

  private materializeThreadLogConversationProperties(
    conversationId: string,
    rawPayload: unknown,
  ): void {
    const payload = conversationPropertiesChangedPayloadSchema.parse(rawPayload);
    const { agent, properties } = payload;
    if ((agent?.id ?? null) !== properties.agentId) {
      throw new Error("ThreadLog Conversation Agent snapshot does not match agentId.");
    }
    this.assertProjectExistsWhenPresent(properties.projectId);
    const selection = properties.modelSelection;
    const result = this.database
      .prepare(
        `UPDATE conversations
         SET project_id = ?, workspace_root_path = ?,
             selected_provider_id = ?, selected_model_id = ?, selected_reasoning_json = ?,
             permission_mode = ?, coordination_mode = COALESCE(?, coordination_mode),
             agent_id = ?, avatar_icon = ?, agent_name = ?, agent_role = ?,
             agent_is_default = ?, agent_instructions = ?, title = ?,
             is_archived = ?, archived_at = ?, is_pinned = ?, pin_order = ?,
             sort_order = COALESCE(?, sort_order), updated_at = ?
         WHERE id = ? AND deletion_pending = 0`,
      )
      .run(
        properties.projectId,
        properties.workspaceRootPath,
        selection?.providerId ?? null,
        selection?.modelId ?? null,
        selection?.reasoning === null || selection === null
          ? null
          : JSON.stringify(selection.reasoning),
        properties.permissionMode,
        properties.coordinationMode ?? null,
        properties.agentId,
        properties.avatarIcon ?? null,
        agent?.name ?? null,
        agent?.role ?? null,
        Number(agent?.isDefault ?? false),
        agent?.instructions ?? null,
        properties.title,
        Number(properties.isArchived),
        properties.archivedAt,
        Number(properties.isPinned),
        properties.pinOrder ?? null,
        properties.sortOrder ?? null,
        properties.updatedAt,
        conversationId,
      );
    if (result.changes !== 1) {
      throw new Error("ThreadLog Conversation property target was not found.");
    }
  }

  /**
   * Rebuilds the local query/UI projection of a post-migration ThreadLog when
   * the Conversation metadata exists but its mutable business rows do not.
   *
   * This is deliberately recovery-only: normal writes still use the existing
   * business transaction and append the same event stream for verification.
   * A legacy snapshot takes precedence because it is the only lossless source
   * for Conversations created before the richer v1 event payloads existed.
   */
  public restoreThreadLogBusinessEvents(
    conversationId: string,
    events: readonly ThreadLogProjectionEvent[],
    replayIntoExistingState = false,
    skipUnavailableDependencies = false,
  ): boolean {
    this.getConversation(conversationId);
    if (events.some((event) => event.type === "legacy_snapshot_imported")) return false;
    const existing = this.database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM runs WHERE conversation_id = ?) AS run_count,
           (SELECT COUNT(*) FROM conversation_timeline WHERE conversation_id = ?) AS timeline_count,
           (SELECT COUNT(*) FROM model_messages WHERE conversation_id = ?) AS message_count,
           (SELECT COUNT(*) FROM conversation_agent_messages WHERE target_conversation_id = ?) AS agent_message_count`,
      )
      .get(conversationId, conversationId, conversationId, conversationId) as DatabaseRow;
    if (
      !replayIntoExistingState && (asNumber(existing, "timeline_count") > 0
      || asNumber(existing, "message_count") > 0)
    ) {
      return false;
    }

    const startedTools = new Map<string, ConversationToolItem>();
    this.withTransaction(() => {
      for (const event of events) {
        const payload = event.payload;
        if (this.materializeCollaborationControl(conversationId, event)) continue;
        if (event.type === "conversation_result_viewed") {
          this.markConversationResultViewed(conversationId);
          continue;
        }
        if (event.type === "conversation_properties_changed") {
          this.materializeThreadLogConversationProperties(conversationId, payload);
          continue;
        }
        if (event.type === "run_queued") {
          this.materializeThreadLogQueuedRun(conversationId, event);
          continue;
        }

        if (event.type === "run_replaced") {
          this.materializeThreadLogReplacedRun(conversationId, event);
          continue;
        }

        if (event.type === "run_terminal") {
          this.materializeThreadLogTerminalRun(conversationId, event);
          continue;
        }

        if (event.type === "run_started") {
          this.materializeThreadLogStartedRun(conversationId, event);
          continue;
        }

        if (event.type === "run_created") {
          const runId = readProjectionString(payload, "runId");
          const modelId = readProjectionString(payload, "modelId");
          if (runId === null || modelId === null) continue;
          const executionSnapshot = runExecutionSnapshotSchema.safeParse(payload.executionSnapshot);
          this.database
            .prepare(
              `INSERT OR IGNORE INTO runs
                 (id, conversation_id, model_id, status, error, created_at, updated_at,
                  execution_snapshot_json)
               VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`,
            )
            .run(
              runId,
              conversationId,
              modelId,
              readProjectionIsoDate(payload, "createdAt") ?? event.createdAt,
              event.createdAt,
              executionSnapshot.success
                ? serializeRunExecutionSnapshot(executionSnapshot.data)
                : null,
            );
          continue;
        }

        if (event.type === "group_message") {
          const message = conversationMessageItemSchema.parse(payload.message);
          if (message.conversationId !== conversationId || message.runId !== null) throw new Error("Group context belongs to another conversation.");
          message.groupSource = conversationMessageItemSchema.shape.groupSource.parse({ teamInstanceId: payload.teamInstanceId,
            messageId: payload.groupMessageId, senderConversationId: payload.senderConversationId ?? null, senderName: payload.senderName ?? "用户" });
          this.runEvents.insertThreadLogTimeline(message);
          this.runEvents.insertThreadLogModelMessage({ attachmentIds: [], content: message.content, conversationId, eventId: event.eventId,
            role: message.role, runId: null, toolCallId: null, toolCalls: [], createdAt: message.createdAt });
          continue;
        }
        if (
          (event.type === "user_message" || event.type === "user_message_replaced")
          && event.payload.writeAhead !== true
        ) {
          const message = threadLogUserMessage(payload, conversationId, event.createdAt);
          if (message === null) continue;
          if (event.type === "user_message_replaced") {
            const supersededRunId = readProjectionString(payload, "previousRunId");
            if (supersededRunId !== null) {
              this.database
                .prepare("DELETE FROM conversation_timeline WHERE conversation_id = ? AND run_id = ?")
                .run(conversationId, supersededRunId);
              this.database
                .prepare("DELETE FROM model_messages WHERE conversation_id = ? AND run_id = ?")
                .run(conversationId, supersededRunId);
            }
          }
          this.runEvents.insertThreadLogTimeline(message);
          this.runEvents.insertThreadLogModelMessage({
            attachmentIds: message.attachments.map((attachment) => attachment.id),
            content: readProjectionString(payload, "modelContent") ?? message.content,
            conversationId,
            eventId: event.eventId,
            role: "user",
            runId: message.runId,
            toolCallId: null,
            toolCalls: [],
            createdAt: message.createdAt,
          });
          this.runEvents.touchConversation(conversationId, message.createdAt);
          continue;
        }

        if (event.type === "assistant_message") {
          this.materializeThreadLogAssistantMessage(conversationId, event);
          continue;
        }

        if (event.type === "model_retry_updated") {
          this.materializeThreadLogModelRetry(conversationId, event);
          continue;
        }

        if (event.type === "tool_call_requested") {
          const tool = readProjectionTool(payload, "tool");
          if (tool === null) continue;
          startedTools.set(tool.id, tool);
          this.runEvents.insertThreadLogTimeline(tool);
          continue;
        }

        if (event.type === "tool_result") {
          const tool = readProjectionTool(payload, "tool")
            ?? startedTools.get(readProjectionString(payload, "toolId") ?? "")
            ?? null;
          if (tool !== null) {
            this.database
              .prepare("UPDATE conversation_timeline SET payload_json = ?, created_at = ? WHERE id = ?")
              .run(JSON.stringify(tool), tool.createdAt, tool.id);
            this.runEvents.insertThreadLogTimeline(tool);
          }
          const content = readProjectionString(payload, "content");
          const runId = readProjectionString(payload, "runId");
          const toolCallId = readProjectionString(payload, "toolCallId");
          if (content !== null && toolCallId !== null) {
            this.runEvents.insertThreadLogModelMessage({
              attachmentIds: [],
              content,
              conversationId,
              createdAt: tool?.createdAt ?? event.createdAt,
              eventId: event.eventId,
              role: "tool",
              runId,
              toolCallId,
              toolCalls: [],
            });
          }
          continue;
        }

        if (event.type === "tool_approval_requested") {
          const toolId = readProjectionString(payload, "toolId");
          if (toolId !== null) this.runEvents.markThreadLogToolAwaitingApproval(conversationId, toolId);
          continue;
        }

        if (event.type === "tool_approval_decided") {
          const tool = readProjectionTool(payload, "tool");
          if (tool !== null && tool.status === "running") {
            this.runEvents.markThreadLogToolRunning(conversationId, tool);
          }
          continue;
        }

        if (event.type === "tool_approval_expired") {
          const tool = readProjectionTool(payload, "tool");
          if (tool !== null && tool.status === "cancelled") {
            this.runEvents.expireThreadLogToolApproval(conversationId, tool);
          }
          continue;
        }

        if (event.type === "agent_message") {
          const message = readProjectionAgentMessage(payload, "message");
          if (message === null) continue;
          if (!this.hasConversation(message.senderConversationId)) {
            // Keep startup resilient when an archived/deleted child
            // conversation is no longer present locally.
            if (!skipUnavailableDependencies) {
              throw new Error("ThreadLog Agent message source conversation is unavailable.");
            }
            continue;
          }
          const storedMessage = this.database.prepare(
            "SELECT 1 AS present FROM conversation_agent_messages WHERE id = ?",
          ).get(message.id);
          if (storedMessage === undefined) {
            this.persistAgentMessage(message);
          } else {
            this.runEvents.insertThreadLogTimeline(message);
            if (message.deliveryMode !== "queue") this.runEvents.insertThreadLogModelMessage({
              attachmentIds: [],
              content: agentMessageModelContent(message),
              conversationId,
              createdAt: message.createdAt,
              eventId: event.eventId,
              role: "user",
              runId: null,
              toolCallId: null,
              toolCalls: [],
            });
          }
          if (message.messageType === "task_result" && message.taskId !== null) {
            const linked = this.database
              .prepare(
                `UPDATE subagent_tasks
                 SET result_message_id = ?, updated_at = ?
                 WHERE id = ?
                   AND parent_conversation_id = ?
                   AND child_conversation_id = ?
                   AND result_message_id IS NULL`,
              )
              .run(
                message.id,
                message.createdAt,
                message.taskId,
                conversationId,
                message.senderConversationId,
              );
            if (linked.changes !== 1) {
              const task = this.database
                .prepare(
                  `SELECT result_message_id FROM subagent_tasks
                   WHERE id = ?
                     AND parent_conversation_id = ?
                     AND child_conversation_id = ?`,
                )
                .get(
                  message.taskId,
                  conversationId,
                  message.senderConversationId,
                ) as DatabaseRow | undefined;
              if (task === undefined || asNullableString(task, "result_message_id") !== message.id) {
                // The task may have been deleted independently. Do not let a
                // stale result event prevent unrelated conversations loading.
                if (!skipUnavailableDependencies) {
                  throw new Error("ThreadLog Subagent result message has no matching task.");
                }
                continue;
              }
            }
          }
          continue;
        }

        if (event.type === "agent_message_read") {
          const messageId = readProjectionString(payload, "messageId");
          if (messageId !== null) {
            try {
              this.markThreadLogAgentMessageRead(conversationId, messageId, event.createdAt);
            } catch (error) {
              if (!skipUnavailableDependencies) throw error;
            }
          }
          continue;
        }

        if (event.type === "pending_messages_updated") {
          const snapshot = threadLogPendingMessagesSchema.safeParse({
            pendingMessages: payload.pendingMessages,
          });
          if (snapshot.success) {
            this.replaceThreadLogPendingMessages(conversationId, snapshot.data.pendingMessages);
          }
          continue;
        }

        if (event.type === "pending_message_cancelled") {
          if (payload.writeAhead === true) {
            this.materializeThreadLogPendingMessageCancellation(conversationId, event);
          }
          continue;
        }

        if (event.type === "task_list_updated") {
          if (payload.taskList === null) {
            this.writeTaskListProjection(conversationId, null);
            continue;
          }
          const taskList = conversationTaskListSchema.safeParse(payload.taskList);
          if (!taskList.success || taskList.data.conversationId !== conversationId) continue;
          this.writeTaskListProjection(conversationId, taskList.data);
          continue;
        }

        if (event.type === "user_message" && event.payload.writeAhead === true) {
          this.materializeThreadLogPendingMessageConsumption(conversationId, event);
          continue;
        }

        if (event.type === "turn_summary_updated") {
          const turnSummary = conversationTurnSummarySchema.safeParse(payload.turnSummary);
          if (!turnSummary.success || turnSummary.data.conversationId !== conversationId) continue;
          this.database.prepare(
            `INSERT INTO conversation_turn_summaries
               (run_id, conversation_id, covered_through_sequence, summary, created_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT(run_id) DO UPDATE SET
               covered_through_sequence = excluded.covered_through_sequence,
               summary = excluded.summary`,
          ).run(
            turnSummary.data.runId,
            turnSummary.data.conversationId,
            turnSummary.data.coveredThroughSequence,
            turnSummary.data.summary,
            turnSummary.data.createdAt,
          );
          continue;
        }

        if (
          event.type === "subagent_task_created"
          || event.type === "subagent_task_completed"
          || event.type === "subagent_task_ended"
        ) {
          const task = threadLogSubagentTaskSchema.safeParse(payload.task);
          if (!task.success || task.data.parentConversationId !== conversationId) continue;
          if (
            !this.hasConversation(task.data.childConversationId)
            || !this.runExists(task.data.sourceRunId)
            || (task.data.targetRunId !== null && !this.runExists(task.data.targetRunId))
          ) {
            // A deleted/partial Subagent history must not prevent the rest of
            // the conversation (and the desktop) from starting. Keep the
            // event in ThreadLog for inspection, but omit the orphaned
            // relational projection until its dependencies can be restored.
            if (!skipUnavailableDependencies) {
              throw new Error("ThreadLog Subagent task dependencies are unavailable.");
            }
            continue;
          }
          this.database
            .prepare(
              `INSERT INTO subagent_tasks
                 (id, parent_conversation_id, child_conversation_id, source_run_id,
                  target_run_id, title, task, status, result, error, result_message_id,
                  created_at, updated_at, completed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 target_run_id = excluded.target_run_id,
                 status = excluded.status,
                 result = excluded.result,
                 error = excluded.error,
                 result_message_id = COALESCE(excluded.result_message_id, subagent_tasks.result_message_id),
                 updated_at = excluded.updated_at,
                 completed_at = excluded.completed_at`,
            )
            .run(
              task.data.id,
              task.data.parentConversationId,
              task.data.childConversationId,
              task.data.sourceRunId,
              task.data.targetRunId,
              task.data.title,
              task.data.task,
              task.data.status,
              task.data.result,
              task.data.error,
              task.data.resultMessageId,
              task.data.createdAt,
              task.data.updatedAt,
              task.data.completedAt,
            );
          // Parent history can contain an old running task after the child has
          // already finished. Rehydration must preserve the child's durable Run.
          this.database.prepare(
            `UPDATE subagent_tasks
             SET status = runs.status,
                 result = COALESCE(subagent_tasks.result, ?),
                 error = runs.error,
                 updated_at = runs.updated_at,
                 completed_at = runs.updated_at
             FROM runs
             WHERE subagent_tasks.id = ?
               AND subagent_tasks.target_run_id = runs.id
               AND subagent_tasks.child_conversation_id = runs.conversation_id
               AND subagent_tasks.status IN ('queued', 'running')
               AND runs.status IN ('completed', 'failed', 'cancelled')`,
          ).run(
            task.data.targetRunId === null ? null : this.terminalResults.get(task.data.targetRunId) ?? null,
            task.data.id,
          );
          continue;
        }

        if (event.type === "runtime_activity_updated") {
          this.materializeThreadLogRuntimeActivity(conversationId, event);
          continue;
        }

        if (event.type === "context_checkpoint") {
          const coveredThroughSequence = typeof payload.coveredThroughContextSequence === "number"
            ? this.resolveContextCheckpointSequence(conversationId, payload.coveredThroughContextSequence)
            : payload.coveredThroughSequence;
          const summary = readProjectionString(payload, "summary");
          if (
            typeof coveredThroughSequence === "number"
            && Number.isSafeInteger(coveredThroughSequence)
            && coveredThroughSequence > 0
            && summary !== null
          ) {
            this.database
              .prepare(
                `INSERT INTO conversation_context_checkpoints
                   (conversation_id, covered_through_sequence, summary, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(conversation_id) DO UPDATE SET
                   covered_through_sequence = excluded.covered_through_sequence,
                   summary = excluded.summary,
                   updated_at = excluded.updated_at`,
              )
              .run(
                conversationId,
                coveredThroughSequence,
                summary,
                readProjectionIsoDate(payload, "createdAt") ?? event.createdAt,
                readProjectionIsoDate(payload, "updatedAt") ?? event.createdAt,
              );
          }
          continue;
        }

        if (event.type === "run_finished") {
          const runId = readProjectionString(payload, "runId");
          const status = conversationRunStatusSchema.safeParse(payload.status);
          if (runId === null || !status.success || status.data === "queued" || status.data === "running") {
            continue;
          }
          this.terminalResults.set(runId, terminalReceiptSummary(readProjectionString(payload, "result")));
          this.database
            .prepare("UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
            .run(status.data, readProjectionString(payload, "error"), event.createdAt, runId);
          this.database
            .prepare("UPDATE conversations SET has_unread_result = ?, updated_at = ? WHERE id = ?")
            .run(Number(status.data === "completed" || status.data === "failed"), event.createdAt, conversationId);
          this.database
            .prepare(
              `UPDATE subagent_tasks
               SET status = ?, result = ?, error = ?, updated_at = ?, completed_at = ?
               WHERE target_run_id = ?`,
            )
            .run(
              status.data,
              readProjectionString(payload, "result"),
              readProjectionString(payload, "error"),
              event.createdAt,
              event.createdAt,
              runId,
            );
        }
      }
      this.runEvents.expirePendingToolApprovalsForTerminalRunsInTransaction();
      this.runEvents.interruptRunningToolsForTerminalRunsInTransaction();
    });
    return true;
  }

  /** Insert the initial Run and its user turn from one atomic ThreadLog event. */
  private materializeThreadLogQueuedRun(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const payload = event.payload;
    const runId = readProjectionString(payload, "runId");
    const modelId = readProjectionString(payload, "modelId");
    const message = threadLogUserMessage(payload, conversationId, event.createdAt);
    if (runId === null || modelId === null || message === null || message.runId !== runId) {
      throw new Error("ThreadLog queued Run event is invalid.");
    }
    const executionSnapshot = runExecutionSnapshotSchema.safeParse(payload.executionSnapshot);
    const runCreatedAt = readProjectionIsoDate(payload, "createdAt") ?? event.createdAt;
    this.database
      .prepare(
        `INSERT OR IGNORE INTO runs
           (id, conversation_id, model_id, status, error, created_at, updated_at,
            execution_snapshot_json)
         VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`,
      )
      .run(
        runId,
        conversationId,
        modelId,
        runCreatedAt,
        runCreatedAt,
        executionSnapshot.success ? serializeRunExecutionSnapshot(executionSnapshot.data) : null,
      );
    this.runEvents.insertThreadLogTimeline(message);
    const pendingMessageId = readProjectionString(payload, "pendingMessageId");
    if (pendingMessageId === null) {
      this.bindThreadLogMessageAttachments(message);
    } else {
      this.consumeThreadLogPendingRecord(pendingMessageId, event.createdAt);
      this.bindThreadLogPendingAttachmentsToMessage(pendingMessageId, message.id);
    }
    this.runEvents.insertThreadLogModelMessage({
      attachmentIds: message.attachments.map((attachment) => attachment.id),
      content: readProjectionString(payload, "modelContent") ?? message.content,
      conversationId,
      createdAt: message.createdAt,
      eventId: event.eventId,
      role: "user",
      runId,
      toolCallId: null,
      toolCalls: [],
    });
    const title = readProjectionString(payload, "title");
    if (title === null) {
      this.runEvents.touchConversation(conversationId, message.createdAt);
      return;
    }
    this.database
      .prepare(
        "UPDATE conversations SET title = ?, updated_at = ?, has_unread_result = 0 WHERE id = ?",
      )
      .run(title, message.createdAt, conversationId);
  }

  /** Replace the latest user turn and start its replacement Run from one event. */
  private materializeThreadLogReplacedRun(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const payload = event.payload;
    const previousRunId = readProjectionString(payload, "previousRunId");
    const runId = readProjectionString(payload, "runId");
    const modelId = readProjectionString(payload, "modelId");
    const message = threadLogUserMessage(payload, conversationId, event.createdAt);
    if (
      previousRunId === null
      || runId === null
      || modelId === null
      || message === null
      || message.runId !== runId
    ) {
      throw new Error("ThreadLog replaced Run event is invalid.");
    }
    const executionSnapshot = runExecutionSnapshotSchema.safeParse(payload.executionSnapshot);
    const runCreatedAt = readProjectionIsoDate(payload, "createdAt") ?? event.createdAt;
    this.database
      .prepare("DELETE FROM conversation_timeline WHERE conversation_id = ? AND run_id = ?")
      .run(conversationId, previousRunId);
    this.database
      .prepare("DELETE FROM model_messages WHERE conversation_id = ? AND run_id = ?")
      .run(conversationId, previousRunId);
    this.database
      .prepare("DELETE FROM conversation_context_checkpoints WHERE conversation_id = ?")
      .run(conversationId);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO runs
           (id, conversation_id, model_id, status, error, created_at, updated_at,
            execution_snapshot_json)
         VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`,
      )
      .run(
        runId,
        conversationId,
        modelId,
        runCreatedAt,
        runCreatedAt,
        executionSnapshot.success ? serializeRunExecutionSnapshot(executionSnapshot.data) : null,
    );
    this.runEvents.insertThreadLogTimeline(message);
    this.bindThreadLogMessageAttachments(message);
    this.runEvents.insertThreadLogModelMessage({
      attachmentIds: message.attachments.map((attachment) => attachment.id),
      content: readProjectionString(payload, "modelContent") ?? message.content,
      conversationId,
      createdAt: message.createdAt,
      eventId: event.eventId,
      role: "user",
      runId,
      toolCallId: null,
      toolCalls: [],
    });
    const title = readProjectionString(payload, "title");
    if (title === null) {
      this.runEvents.touchConversation(conversationId, message.createdAt);
      return;
    }
    this.database
      .prepare(
        "UPDATE conversations SET title = ?, updated_at = ?, has_unread_result = 0 WHERE id = ?",
      )
      .run(title, message.createdAt, conversationId);
  }

  /** Materialize a checkpoint without letting its coverage move backwards. */
  private materializeThreadLogContextCheckpoint(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const contextSequence = event.payload.coveredThroughContextSequence;
    const coveredThroughSequence = typeof contextSequence === "number"
      ? this.resolveContextCheckpointSequence(conversationId, contextSequence)
      : event.payload.coveredThroughSequence;
    const summary = readProjectionString(event.payload, "summary");
    if (
      typeof coveredThroughSequence !== "number"
      || !Number.isSafeInteger(coveredThroughSequence)
      || coveredThroughSequence <= 0
      || summary === null
    ) {
      throw new Error("ThreadLog write-ahead checkpoint is invalid.");
    }
    this.projectPreparedContextCheckpoint({
      conversationId,
      coveredThroughSequence,
      createdAt: readProjectionIsoDate(event.payload, "createdAt") ?? event.createdAt,
      summary,
      updatedAt: readProjectionIsoDate(event.payload, "updatedAt") ?? event.createdAt,
    });
  }

  /** Replace the pending-input projection from one durable queue snapshot. */
  private materializeThreadLogPendingMessages(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const snapshot = threadLogPendingMessagesSchema.safeParse({
      pendingMessages: event.payload.pendingMessages,
    });
    if (!snapshot.success) {
      throw new Error("ThreadLog write-ahead pending message snapshot is invalid.");
    }
    this.replaceThreadLogPendingMessages(
      conversationId,
      snapshot.data.pendingMessages,
      true,
    );
  }

  /** Preserve a cancelled pending-message audit row and its retryable attachment cleanup marker. */
  private materializeThreadLogPendingMessageCancellation(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const pendingMessageId = readProjectionString(event.payload, "pendingMessageId");
    if (pendingMessageId === null) {
      throw new Error("ThreadLog pending message cancellation is invalid.");
    }
    const row = this.database
      .prepare(
        "SELECT status FROM conversation_pending_messages WHERE id = ? AND conversation_id = ?",
      )
      .get(pendingMessageId, conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("ThreadLog pending message cancellation has no pending message.");
    }
    const currentStatus = asString(row, "status");
    if (currentStatus === "pending") {
      this.database
        .prepare(
          `UPDATE conversation_pending_messages
           SET status = 'cancelled', consumed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(event.createdAt, event.createdAt, pendingMessageId);
    } else if (currentStatus !== "cancelled") {
      throw new Error("ThreadLog pending message cancellation state is invalid.");
    }
    this.runEvents.touchConversation(conversationId, event.createdAt);
  }

  /** Restore a committed Steer message without changing its Run's current state. */
  private materializeThreadLogPendingMessageConsumption(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const pendingMessageId = readProjectionString(event.payload, "pendingMessageId");
    const message = threadLogUserMessage(event.payload, conversationId, event.createdAt);
    const modelContent = readProjectionString(event.payload, "modelContent");
    if (pendingMessageId === null || message === null || modelContent === null
      || message.runId === null
      || message.runId !== readProjectionString(event.payload, "runId")
      || this.getRunConversationId(message.runId) !== conversationId) {
      throw new Error("ThreadLog write-ahead pending message consumption is invalid.");
    }
    const pending = this.database.prepare(
      "SELECT conversation_id FROM conversation_pending_messages WHERE id = ?",
    ).get(pendingMessageId) as DatabaseRow | undefined;
    if (pending !== undefined && asString(pending, "conversation_id") !== conversationId) {
      throw new Error("ThreadLog pending message belongs to another Conversation.");
    }
    // This event is a committed historical fact, not a new live Steer request.
    // Startup/LRU hydration can retain the Run's terminal state while rebuilding
    // its messages; replay must neither require an active Run nor reactivate it.
    this.consumeThreadLogPendingRecord(pendingMessageId, message.createdAt);
    this.runEvents.insertThreadLogTimeline(message);
    this.bindThreadLogPendingAttachmentsToMessage(pendingMessageId, message.id);
    this.runEvents.insertThreadLogModelMessage({
      attachmentIds: message.attachments.map((attachment) => attachment.id),
      content: modelContent,
      conversationId,
      createdAt: message.createdAt,
      eventId: event.eventId,
      role: "user",
      runId: message.runId,
      toolCallId: null,
      toolCalls: [],
    });
    this.runEvents.touchConversation(conversationId, message.createdAt);
  }

  private materializeThreadLogModelRetry(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const parsed = conversationModelRetryItemSchema.safeParse(event.payload.retry);
    if (!parsed.success || parsed.data.conversationId !== conversationId) {
      throw new Error("ThreadLog model retry update is invalid.");
    }
    this.runEvents.upsertModelRetryInTransaction(parsed.data);
    this.runEvents.touchConversation(conversationId, parsed.data.updatedAt);
  }

  public listContextMessagesForRun(runId: string, conversationId?: string): StoredContextMessage[] {
    if (conversationId !== undefined && this.getRunConversationId(runId) !== conversationId) return [];
    return this.history.listContextMessagesForRun(runId);
  }

  public getLatestConversationTurnSummary(
    conversationId: string,
    coveredThroughSequence: number,
  ): ConversationTurnSummary | null {
    this.getConversation(conversationId);
    return this.contextSummaries.getLatestConversationTurnSummary(conversationId, coveredThroughSequence);
  }

  public getConversationTurnSummary(runId: string): ConversationTurnSummary | null {
    return this.contextSummaries.getConversationTurnSummary(runId);
  }

  public saveConversationTurnSummary(input: {
    conversationId: string;
    coveredThroughSequence: number;
    runId: string;
    summary: string;
  }): ConversationTurnSummary {
    this.getConversation(input.conversationId);
    return this.contextSummaries.saveConversationTurnSummary(input);
  }

  /** Runtime activities are durable UI audit rows, never model-context messages. */
  private materializeThreadLogRuntimeActivity(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const tool = readProjectionTool(event.payload, "tool");
    if (tool === null || tool.conversationId !== conversationId) {
      throw new Error("ThreadLog runtime activity update is invalid.");
    }
    this.runEvents.insertThreadLogTimeline(tool);
    this.database
      .prepare(
        `UPDATE conversation_timeline SET payload_json = ?, created_at = ?
         WHERE id = ? AND conversation_id = ? AND kind = 'tool'`,
      )
      .run(JSON.stringify(tool), tool.createdAt, tool.id, conversationId);
    this.runEvents.touchConversation(conversationId, event.createdAt);
  }

  /** Persist the Tool timeline item before its handler is allowed to run. */
  private materializeThreadLogToolStarted(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const tool = readProjectionTool(event.payload, "tool");
    if (tool === null || tool.conversationId !== conversationId) {
      throw new Error("ThreadLog write-ahead Tool start is invalid.");
    }
    this.runEvents.insertThreadLogTimeline(tool);
  }

  /** Persist one completed Tool row and its model-visible result together. */
  private materializeThreadLogToolResult(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const tool = readProjectionTool(event.payload, "tool");
    const content = readProjectionString(event.payload, "content");
    const toolCallId = readProjectionString(event.payload, "toolCallId");
    if (
      tool === null
      || tool.conversationId !== conversationId
      || content === null
      || toolCallId === null
    ) {
      throw new Error("ThreadLog write-ahead Tool result is invalid.");
    }
    this.runEvents.insertThreadLogTimeline(tool);
    this.database
      .prepare("UPDATE conversation_timeline SET payload_json = ?, created_at = ? WHERE id = ? AND kind = 'tool'")
      .run(JSON.stringify(tool), tool.createdAt, tool.id);
    this.runEvents.insertThreadLogModelMessage({
      attachmentIds: [],
      content,
      conversationId,
      createdAt: tool.createdAt,
      eventId: event.eventId,
      role: "tool",
      runId: tool.runId,
      toolCallId,
      toolCalls: [],
    });
    this.runEvents.touchConversation(conversationId, tool.createdAt);
  }

  /** Materialize an Assistant model turn before its tool calls can execute. */
  private materializeThreadLogAssistantMessage(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const payload = event.payload;
    const content = readProjectionString(payload, "content");
    const runId = readProjectionString(payload, "runId");
    if (content === null || runId === null) {
      if (payload.writeAhead === true) {
        throw new Error("ThreadLog write-ahead Assistant message is invalid.");
      }
      return;
    }
    const storedTimelineMessage = readProjectionTimelineMessage(payload, "timelineMessage");
    const messageId = readProjectionString(payload, "messageId");
    const modelId = readProjectionString(payload, "modelId");
    const reasoningContent = readProjectionString(payload, "reasoningContent");
    const timelineMessage = storedTimelineMessage
      ?? (content.length === 0 && reasoningContent === null
        ? null
        : messageId !== null && modelId !== null
          ? conversationMessageItemSchema.parse({
              content,
              conversationId,
              createdAt: event.createdAt,
              id: messageId,
              kind: "message",
              modelId,
              ...(reasoningContent === null ? {} : { reasoningContent }),
              role: "assistant",
              runId,
              status: "completed",
            })
          : null);
    if (
      payload.writeAhead === true
      && (content.length > 0 || reasoningContent !== null)
      && timelineMessage === null
    ) {
      throw new Error("ThreadLog write-ahead Assistant timeline message is invalid.");
    }
    const providerState = readProjectionProviderState(payload);
    this.runEvents.insertThreadLogModelMessage({
      attachmentIds: [],
      content,
      conversationId,
      createdAt: timelineMessage?.createdAt ?? event.createdAt,
      eventId: event.eventId,
      ...(providerState === undefined ? {} : { providerState }),
      role: "assistant",
      runId,
      toolCallId: null,
      toolCalls: readProjectionToolCalls(payload),
    });
    if (timelineMessage !== null) {
      this.runEvents.insertThreadLogTimeline(timelineMessage);
      this.runEvents.touchConversation(conversationId, timelineMessage.createdAt);
    }
  }

  /** Advance a queued Run through its durable model/tool execution boundary. */
  private materializeThreadLogStartedRun(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const runId = readProjectionString(event.payload, "runId");
    if (runId === null) throw new Error("ThreadLog started Run event is invalid.");
    const row = this.database
      .prepare("SELECT conversation_id, status FROM runs WHERE id = ?")
      .get(runId) as DatabaseRow | undefined;
    if (row === undefined || asString(row, "conversation_id") !== conversationId) {
      throw new Error("ThreadLog started Run does not belong to the conversation.");
    }
    const currentStatus = conversationRunStatusSchema.parse(asString(row, "status"));
    if (currentStatus === "running") return;
    if (currentStatus === "completed" || currentStatus === "failed" || currentStatus === "cancelled") {
      // Recovery may have already replayed this Run's later terminal event
      // before the projector advances its independent event-index cursor.
      return;
    }
    if (currentStatus !== "queued") {
      throw new Error("ThreadLog started Run state transition is invalid.");
    }
    this.database
      .prepare("UPDATE runs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'")
      .run(event.createdAt, runId);
  }

  /** Materialize a terminal Run before delivering its collaboration receipt. */
  private materializeThreadLogTerminalRun(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const payload = event.payload;
    const runId = readProjectionString(payload, "runId");
    const status = conversationRunStatusSchema.safeParse(payload.status);
    if (
      runId === null
      || !status.success
      || status.data === "queued"
      || status.data === "running"
    ) {
      throw new Error("ThreadLog terminal Run event is invalid.");
    }
    const row = this.database
      .prepare("SELECT conversation_id, status FROM runs WHERE id = ?")
      .get(runId) as DatabaseRow | undefined;
    if (row === undefined || asString(row, "conversation_id") !== conversationId) {
      throw new Error("ThreadLog terminal Run does not belong to the conversation.");
    }
    this.terminalResults.set(runId, terminalReceiptSummary(readProjectionString(payload, "result")));
    const currentStatus = conversationRunStatusSchema.parse(asString(row, "status"));
    if (currentStatus !== status.data) {
      if (!RUN_STATUS_TRANSITIONS[currentStatus].includes(status.data)) {
        throw new Error("ThreadLog terminal Run state transition is invalid.");
      }
      this.database
        .prepare("UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status = ?")
        .run(status.data, readProjectionString(payload, "error"), event.createdAt, runId, currentStatus);
    }

    const assistant = threadLogTerminalAssistant(payload);
    if (assistant !== null) {
      const timelineMessage = assistant.kind === "turn" || assistant.kind === "cancelled"
        ? assistant.content.length === 0 && (assistant.reasoningContent?.length ?? 0) === 0
          ? null
          : conversationMessageItemSchema.parse({
              content: assistant.content,
              conversationId,
              createdAt: event.createdAt,
              id: assistant.messageId,
               kind: "message",
               modelId: assistant.modelId,
               ...(assistant.reasoningContent === undefined
                 ? {}
                 : { reasoningContent: assistant.reasoningContent }),
               role: "assistant",
              runId,
              status: assistant.kind === "turn" ? "completed" : "cancelled",
            })
        : conversationMessageItemSchema.parse({
            content: assistant.content,
            conversationId,
            createdAt: event.createdAt,
            id: assistant.messageId,
            kind: "message",
            modelId: assistant.modelId,
            role: "assistant",
            runId,
            status: "failed",
          });
      if (assistant.kind !== "failure") {
        this.runEvents.insertThreadLogModelMessage({
          attachmentIds: [],
          content: assistant.content,
          conversationId,
          createdAt: event.createdAt,
          eventId: event.eventId,
          ...(assistant.providerState === undefined ? {} : { providerState: assistant.providerState }),
          role: "assistant",
          runId,
          toolCallId: null,
          toolCalls: [],
        });
      }
      if (timelineMessage !== null) this.runEvents.insertThreadLogTimeline(timelineMessage);
    }
    this.database
      .prepare("UPDATE conversations SET has_unread_result = ?, updated_at = ? WHERE id = ?")
      .run(Number(status.data === "completed" || status.data === "failed"), event.createdAt, conversationId);
  }


  /**
   * Existing attachment snapshots are already stored under ASTER_HOME. The
   * log only references their immutable IDs, so replay can re-bind drafts
   * without ever serializing a managed absolute path into JSONL.
   */
  private bindThreadLogMessageAttachments(message: ConversationMessageItem): void {
    const attachmentIds = message.attachments.map((attachment) => attachment.id);
    if (attachmentIds.length === 0) return;
    const placeholders = attachmentIds.map(() => "?").join(", ");
    this.database
      .prepare(
        `UPDATE conversation_attachments SET message_id = ?
         WHERE conversation_id = ? AND message_id IS NULL
           AND pending_message_id IS NULL AND id IN (${placeholders})`,
      )
      .run(message.id, message.conversationId, ...attachmentIds);
  }

  /** Idempotently consumes a queued input when its atomic Run event is replayed. */
  private consumeThreadLogPendingRecord(pendingMessageId: string, consumedAt: string): void {
    this.database
      .prepare(
        `UPDATE conversation_pending_messages
         SET status = 'consumed', consumed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(consumedAt, consumedAt, pendingMessageId);
  }

  /** The pending snapshot may be absent in a partial recovery; binding zero rows is safe. */
  private bindThreadLogPendingAttachmentsToMessage(
    pendingMessageId: string,
    messageId: string,
  ): void {
    this.database
      .prepare(
        `UPDATE conversation_attachments SET message_id = ?, pending_message_id = NULL
         WHERE pending_message_id = ? AND message_id IS NULL`,
      )
      .run(messageId, pendingMessageId);
  }

  private runExists(runId: string): boolean {
    return this.database
      .prepare("SELECT 1 AS present FROM runs WHERE id = ? LIMIT 1")
      .get(runId) !== undefined;
  }

  private markThreadLogAgentMessageRead(
    conversationId: string,
    messageId: string,
    readAt: string,
    consumedByRunId?: string,
  ): void {
    const row = this.database
      .prepare(
        `SELECT payload_json FROM conversation_agent_messages
         WHERE id = ? AND target_conversation_id = ?`,
      )
      .get(messageId, conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("ThreadLog Agent message read event has no matching message.");
    }
    const current = conversationAgentMessageItemSchema.parse(
      parseJson(asString(row, "payload_json"), "Agent message"),
    );
    if (current.status === "read") return;
    const read = conversationAgentMessageItemSchema.parse({
      ...current,
      ...(consumedByRunId === undefined ? {} : { consumedByRunId }),
      readAt,
      status: "read",
    });
    this.database
      .prepare(
        `UPDATE conversation_agent_messages
         SET status = 'read', payload_json = ?, read_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(read), readAt, messageId);
    this.database
      .prepare(
        "UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'agent_message'",
      )
      .run(JSON.stringify(read), messageId);
    if (current.deliveryMode === "queue") this.runEvents.insertModelMessage({
      attachmentIds: [], content: agentMessageModelContent(read),
      conversationId, role: "user", runId: consumedByRunId ?? null,
      toolCallId: null, toolCalls: [],
    });
  }

  private replaceThreadLogPendingMessages(
    conversationId: string,
    pendingMessages: readonly StoredPendingMessage[],
    requireAttachmentBindings = false,
  ): void {
    if (pendingMessages.some((record) =>
      record.message.conversationId !== conversationId
      || record.input.conversationId !== conversationId
      || (record.input.deliveryMode ?? "queue") !== record.message.deliveryMode,
    )) {
      throw new Error("ThreadLog pending message snapshot belongs to another Conversation.");
    }
    this.database
      .prepare(
        "DELETE FROM conversation_pending_messages WHERE conversation_id = ? AND status = 'pending'",
      )
      .run(conversationId);
    this.database
      .prepare(
        `UPDATE conversation_attachments SET pending_message_id = NULL
         WHERE conversation_id = ? AND message_id IS NULL AND pending_message_id IS NOT NULL`,
      )
      .run(conversationId);
    const insert = this.database.prepare(
      `INSERT INTO conversation_pending_messages
         (id, conversation_id, delivery_mode, status, payload_json, sort_order,
          created_at, updated_at, consumed_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, NULL)`,
    );
    for (const [index, record] of pendingMessages.entries()) {
      if (!requireAttachmentBindings) {
        const retained = this.database.prepare(
          "SELECT status FROM conversation_pending_messages WHERE id = ? AND conversation_id = ?",
        ).get(record.message.id, conversationId) as DatabaseRow | undefined;
        // LRU eviction keeps consumption/cancellation facts. An older queue
        // snapshot must not recreate these rows or resurrect their attachments.
        if (retained !== undefined && asString(retained, "status") !== "pending") continue;
      }
      insert.run(
        record.message.id,
        conversationId,
        record.message.deliveryMode,
        JSON.stringify({ ...record.input, deliveryMode: record.message.deliveryMode }),
        index,
        record.message.createdAt,
        record.message.createdAt,
      );
      const attachmentIds = record.message.attachmentIds;
      if (attachmentIds.length === 0) continue;
      const placeholders = attachmentIds.map(() => "?").join(", ");
      const result = this.database
        .prepare(
          `UPDATE conversation_attachments SET pending_message_id = ?
           WHERE conversation_id = ? AND message_id IS NULL
             AND pending_message_id IS NULL AND id IN (${placeholders})`,
        )
        .run(record.message.id, conversationId, ...attachmentIds);
      if (requireAttachmentBindings && result.changes !== attachmentIds.length) {
        throw new Error("ThreadLog pending message attachment binding is incomplete.");
      }
    }
  }


  public exportThreadLogLegacySnapshot(conversationId: string, includeHistory = true): ThreadLogLegacySnapshot {
    const attachmentIds = (this.database.prepare(
      `SELECT id FROM conversation_attachments
       WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`,
    ).all(conversationId) as DatabaseRow[]).map((row) => asString(row, "id"));
    const agentMessages = (this.database.prepare(
      `SELECT payload_json, work_item_id FROM conversation_agent_messages
       WHERE target_conversation_id = ? ORDER BY created_at ASC, rowid ASC`,
    ).all(conversationId) as DatabaseRow[]).map((row) => ({
      message: conversationAgentMessageItemSchema.parse(
        parseJson(asString(row, "payload_json"), "Agent message"),
      ),
      workItemId: asNullableString(row, "work_item_id"),
    }));
    const turnSummaries = includeHistory ? (this.database.prepare(
      `SELECT conversation_id, run_id, covered_through_sequence, summary, created_at
       FROM conversation_turn_summaries
       WHERE conversation_id = ? ORDER BY covered_through_sequence ASC`,
    ).all(conversationId) as DatabaseRow[]).map((row) => ({
      conversationId: asString(row, "conversation_id"),
      coveredThroughSequence: asNumber(row, "covered_through_sequence"),
      createdAt: asString(row, "created_at"),
      runId: asString(row, "run_id"),
      summary: asString(row, "summary"),
    })) : [];
    return {
      agent: this.getConversationAgentBinding(conversationId),
      agentMessages,
      attachmentRefs: this.listThreadLogAttachmentReferences(conversationId, attachmentIds),
      checkpoint: includeHistory ? this.getContextCheckpoint(conversationId) : null,
      conversation: this.getConversation(conversationId),
      modelMessages: includeHistory ? this.listContextMessages(conversationId) : [],
      pendingMessages: this.listPendingMessageRecords(conversationId),
      runs: this.listThreadLogLegacyRuns(conversationId),
      subagentTasks: this.listSubagentTasks(conversationId),
      taskList: this.getTaskList(conversationId),
      timeline: includeHistory ? this.listTimeline(conversationId) : [],
      turnSummaries,
    };
  }

  public exportThreadLogStartupState(conversationId: string): Record<string, unknown> | null {
    if (this.getConversation(conversationId).activeRunId !== null) return null;
    const snapshot = this.exportThreadLogLegacySnapshot(conversationId, false);
    // Queued inputs and active children require the ordinary recovery path.
    if (snapshot.pendingMessages.length > 0 || snapshot.subagentTasks.some((task) => task.status === "queued" || task.status === "running")) return null;
    return threadLogStartupStateSchema.parse({ ...snapshot, format: 2,
      userQuestions: this.userQuestions.list(conversationId).filter((question) => question.displayConversationId === conversationId),
      deliveredQuestionIds: this.userQuestions.deliveredQuestionIds(conversationId),
      terminalResults: snapshot.runs.filter((run) => this.terminalResults.has(run.id))
        .map((run) => ({ runId: run.id, result: this.terminalResults.get(run.id) ?? null })),
      executionPaused: this.isConversationExecutionPaused(conversationId), sortOrder: this.getConversationSortOrder(conversationId) });
  }

  public restoreThreadLogStartupState(conversationId: string, event: ThreadLogProjectionEvent): void {
    const state = threadLogStartupStateSchema.parse(event.payload);
    if (event.type !== "state_checkpoint" || state.conversation.id !== conversationId
      || state.conversation.activeRunId !== null || state.runs.some((run) => run.status === "queued" || run.status === "running")
      || state.agentMessages.some((record) => record.message.conversationId !== conversationId)
      || state.subagentTasks.some((task) => task.parentConversationId !== conversationId)) {
      throw new Error("ThreadLog startup checkpoint is not a valid inactive conversation state.");
    }
    this.restoreThreadLogLegacySnapshot(conversationId, state);
    for (const question of state.userQuestions) this.userQuestions.apply(conversationId, { type: "user_question_updated", payload: { question } });
    for (const questionAnswerId of state.deliveredQuestionIds) this.userQuestions.apply(conversationId, { type: "run_queued", payload: { questionAnswerId } });
    for (const result of state.terminalResults) {
      if (this.getRunConversationId(result.runId) !== conversationId) throw new Error("Terminal result belongs to another conversation.");
      this.terminalResults.set(result.runId, result.result);
    }
    this.setConversationExecutionPaused(conversationId, state.executionPaused);
    this.restoreConversationPropertySnapshot(conversationId, conversationPropertiesChangedPayloadSchema.parse({
      agent: state.agent, changed: ["title"], properties: conversationMutablePropertiesSchema.strip().parse({ ...state.conversation, sortOrder: state.sortOrder }),
    }));
    this.database.prepare("UPDATE conversations SET has_unread_result = ? WHERE id = ?")
      .run(Number(state.conversation.hasUnreadResult), conversationId);
    this.projectionCursors.set(conversationId, {
      conversationId, lastSequence: event.sequence, lastEventId: event.eventId,
      sourceSizeBytes: null, sourceModifiedAtMs: null, updatedAt: event.createdAt,
    });
  }

  public canRestoreThreadLogStartupState(conversationId: string, event: ThreadLogProjectionEvent): boolean {
    const result = threadLogStartupStateSchema.safeParse(event.payload);
    if (!result.success || event.type !== "state_checkpoint") return false;
    const state = result.data;
    return state.conversation.id === conversationId && state.conversation.activeRunId === null
      && state.runs.every((run) => run.status !== "queued" && run.status !== "running")
      && state.agentMessages.every((record) => record.message.conversationId === conversationId)
      && state.subagentTasks.every((task) => task.parentConversationId === conversationId)
      && state.userQuestions.every((question) => question.displayConversationId === conversationId)
      && state.attachmentRefs.every((attachment) => attachment.conversationId === conversationId);
  }

  public restoreThreadLogLegacySnapshot(
    conversationId: string,
    snapshot: Omit<ThreadLogLegacySnapshot, "agent" | "attachmentRefs" | "conversation">,
  ): void {
    this.getConversation(conversationId);
    if (
      this.listContextMessages(conversationId).length > 0
      || this.listTimeline(conversationId).length > 0
    ) {
      return;
    }
    this.withTransaction(() => {
      for (const run of snapshot.runs) {
        this.database
          .prepare(
            `INSERT OR IGNORE INTO runs
               (id, conversation_id, model_id, status, error, created_at, updated_at,
                execution_snapshot_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            run.id,
            conversationId,
            run.modelId,
            run.status,
            run.error,
            run.createdAt,
            run.updatedAt,
            run.executionSnapshotJson,
          );
      }
      for (const message of snapshot.modelMessages) {
        this.runEvents.insertModelMessage({
          attachmentIds: message.attachmentIds,
          content: message.content,
          conversationId,
          ...(message.providerState === undefined ? {} : { providerState: message.providerState }),
          role: message.role,
          runId: message.runId,
          toolCallId: message.toolCallId,
          toolCalls: message.toolCalls,
        });
      }
      for (const item of snapshot.timeline) this.runEvents.insertTimelineItem(item);
      this.replaceThreadLogPendingMessages(conversationId, snapshot.pendingMessages, true);
      this.writeTaskListProjection(conversationId, snapshot.taskList);
      for (const task of snapshot.subagentTasks) {
        this.database.prepare(
          `INSERT INTO subagent_tasks
             (id, parent_conversation_id, child_conversation_id, source_run_id,
              target_run_id, title, task, status, result, error, result_message_id,
              created_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(id) DO UPDATE SET
             target_run_id = excluded.target_run_id,
             status = excluded.status,
             result = excluded.result,
             error = excluded.error,
             result_message_id = excluded.result_message_id,
             updated_at = excluded.updated_at,
             completed_at = excluded.completed_at`
        ).run(
          task.id,
          task.parentConversationId,
          task.childConversationId,
          task.sourceRunId,
          task.targetRunId,
          task.title,
          task.task,
          task.status,
          task.result,
          task.error,
          task.resultMessageId,
          task.createdAt,
          task.updatedAt,
          task.completedAt,
        );
      }
      for (const record of snapshot.agentMessages) {
        const message = record.message;
        this.database.prepare(
          `INSERT OR IGNORE INTO conversation_agent_messages
             (id, sender_conversation_id, target_conversation_id, status,
              payload_json, created_at, read_at, work_item_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(
          message.id,
          message.senderConversationId,
          message.conversationId,
          message.status,
          JSON.stringify(message),
          message.createdAt,
          message.readAt,
          record.workItemId,
        );
      }
      for (const summary of snapshot.turnSummaries) {
        this.database.prepare(
          `INSERT INTO conversation_turn_summaries
             (run_id, conversation_id, covered_through_sequence, summary, created_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(run_id) DO UPDATE SET
             covered_through_sequence = excluded.covered_through_sequence,
             summary = excluded.summary`
        ).run(
          summary.runId,
          summary.conversationId,
          summary.coveredThroughSequence,
          summary.summary,
          summary.createdAt,
        );
      }
      if (snapshot.checkpoint !== null) {
        const originalIndex = snapshot.modelMessages.findIndex(
          (message) => message.sequence === snapshot.checkpoint?.coveredThroughSequence,
        );
        const restoredMessage = this.listContextMessages(conversationId)[originalIndex];
        if (restoredMessage !== undefined) {
          this.saveContextCheckpoint(
            conversationId,
            restoredMessage.sequence,
            snapshot.checkpoint.summary,
          );
        }
      }
    });
  }

  private listThreadLogLegacyRuns(conversationId: string): ThreadLogLegacyRun[] {
    const rows = this.database
      .prepare(
        `SELECT id, model_id, status, error, created_at, updated_at, execution_snapshot_json
         FROM runs WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(conversationId) as DatabaseRow[];
    return rows.map((row) => ({
      createdAt: asString(row, "created_at"),
      error: asNullableString(row, "error"),
      executionSnapshotJson: asNullableString(row, "execution_snapshot_json"),
      id: asString(row, "id"),
      modelId: asString(row, "model_id"),
      status: conversationRunStatusSchema.parse(asString(row, "status")),
      updatedAt: asString(row, "updated_at"),
    }));
  }

  /** Drop heavyweight history rows while retaining current Conversation state. */
  public clearVolatileConversationHistory(conversationId: string): void {
    this.getConversation(conversationId);
    this.withTransaction(() => {
      this.database.prepare(
        "DELETE FROM conversation_timeline WHERE conversation_id = ?",
      ).run(conversationId);
      this.database.prepare(
        "DELETE FROM model_messages WHERE conversation_id = ?",
      ).run(conversationId);
      this.database.prepare(
        "DELETE FROM conversation_turn_summaries WHERE conversation_id = ?",
      ).run(conversationId);
    });
    this.clearThreadLogProjection(conversationId);
  }

  private interruptUnfinishedRuns(): void {
    this.withTransaction(() => {
      const interruptedRunError = "Application stopped before the run finished.";
      const taskRows = this.database
        .prepare(
          `SELECT id FROM subagent_tasks
           WHERE status IN ('queued', 'running')`
        )
        .all() as DatabaseRow[];
      const now = new Date().toISOString();
      this.database.exec(
        `UPDATE conversations
         SET has_unread_result = 1
         WHERE id IN (SELECT conversation_id FROM runs WHERE status IN ('queued', 'running'))`
      );
      this.database
        .prepare(
          `UPDATE runs
           SET status = 'failed', error = ?, updated_at = ?
           WHERE status = 'running'
              OR (
                status = 'queued'
                AND (
                  NOT EXISTS (
                    SELECT 1 FROM model_messages
                    WHERE model_messages.run_id = runs.id
                      AND model_messages.role = 'user'
                  )
                  OR id IN (
                    SELECT target_run_id FROM subagent_tasks WHERE target_run_id IS NOT NULL
                  )
                  OR EXISTS (
                    SELECT 1 FROM team_work_items
                    WHERE team_work_items.execution_conversation_id = runs.conversation_id
                  )
                  OR EXISTS (
                    SELECT 1 FROM conversations
                    WHERE conversations.id = runs.conversation_id
                      AND conversations.thread_kind = 'subagent'
                  )
                )
              )`
        )
        .run(interruptedRunError, now);
      const interruptedRunRows = this.database
        .prepare(
          `SELECT id FROM runs
           WHERE status = 'failed' AND error = ?`,
        )
        .all(interruptedRunError) as DatabaseRow[];
      if (interruptedRunRows.length > 0) {
        const interruptedRunIds = interruptedRunRows.map((row) => asString(row, "id"));
        const placeholders = interruptedRunIds.map(() => "?").join(", ");
        const retryRows = this.database
          .prepare(
            `SELECT payload_json FROM conversation_timeline
             WHERE kind = 'model_retry' AND run_id IN (${placeholders})`,
          )
          .all(...interruptedRunIds) as DatabaseRow[];
        for (const row of retryRows) {
          const retry = conversationModelRetryItemSchema.parse(
            parseJson(asString(row, "payload_json"), "model retry timeline item"),
          );
          if (retry.status !== "retrying") continue;
          this.runEvents.upsertModelRetryInTransaction({
            ...retry,
            retryInMs: null,
            status: "failed",
            updatedAt: now,
          });
        }
      }
      this.runEvents.expirePendingToolApprovalsForTerminalRunsInTransaction();
      this.database
        .prepare(
          `UPDATE subagent_tasks
           SET status = 'failed', error = 'Application stopped before the Subagent finished.',
               updated_at = ?, completed_at = ?
           WHERE status IN ('queued', 'running')`
        )
        .run(now, now);
      for (const row of taskRows) {
        this.deliverSubagentTaskResultInTransaction(asString(row, "id"), false);
      }
      this.runEvents.interruptRunningToolsForTerminalRunsInTransaction();
    });
  }

  private assertProjectExists(projectId: string): void {
    const project = this.database
      .prepare("SELECT 1 AS present FROM projects WHERE id = ?")
      .get(projectId);
    if (project === undefined) {
      throw new Error("Project was not found.");
    }
  }

  private assertNoActiveRun(conversationId: string): void {
    const placeholders = RUNNING_STATUSES.map(() => "?").join(", ");
    const row = this.database
      .prepare(
        `SELECT id FROM runs
         WHERE conversation_id = ? AND status IN (${placeholders}) LIMIT 1`
      )
      .get(conversationId, ...RUNNING_STATUSES);
    if (row !== undefined) {
      throw new Error("This conversation already has an active run.");
    }
  }

  private getLatestUserTimelineRecord(conversationId: string): UserTimelineRecord | null {
    const rows = this.database.prepare(
      `SELECT sequence, payload_json FROM conversation_timeline
       WHERE conversation_id = ? AND kind = 'message'
       ORDER BY sequence DESC`,
    ).all(conversationId) as DatabaseRow[];
    for (const row of rows) {
      const message = conversationMessageItemSchema.parse(
        parseJson(asString(row, "payload_json"), "conversation message"),
      );
      if (message.role === "user") {
        return { message, sequence: asNumber(row, "sequence") };
      }
    }
    return null;
  }

  private getLatestUserModelMessageRecord(
    conversationId: string,
    runId: string,
  ): UserModelMessageRecord | null {
    const row = this.database.prepare(
      `SELECT id, sequence, content, attachment_ids_json FROM model_messages
       WHERE conversation_id = ? AND run_id = ? AND role = 'user'
       ORDER BY sequence DESC LIMIT 1`,
    ).get(conversationId, runId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    return {
      attachmentIds: parseStoredStringArray(
        asString(row, "attachment_ids_json"),
        "model message attachment identifiers",
      ),
      content: asString(row, "content"),
      id: asString(row, "id"),
      sequence: asNumber(row, "sequence"),
    };
  }

  private listLatestUserMessageReplacementAttachments(
    conversationId: string,
    messageId: string,
    attachmentIds: readonly string[],
  ): StoredConversationAttachment[] {
    const attachments = this.listConversationAttachmentsByIds(conversationId, attachmentIds);
    if (attachments.some((attachment) => (
      attachment.pendingMessageId !== null
      || (attachment.messageId !== null && attachment.messageId !== messageId)
    ))) {
      throw new Error("A replacement can only use its original attachments or current drafts.");
    }
    return attachments;
  }

  public countUserMessages(conversationId: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM model_messages
         WHERE conversation_id = ? AND role = 'user'`
      )
      .get(conversationId) as DatabaseRow;
    return Number(row.count);
  }

  private hasStableTeamParticipantTitle(conversation: ConversationSummary): boolean {
    return conversation.teamId !== null
      && this.getTeamExecutionConversationIdForParticipant(conversation.id) !== null;
  }

  private agentMessageSenderTitle(conversation: ConversationSummary): string {
    const teamExecutionConversationId = this.getTeamExecutionConversationIdForParticipant(
      conversation.id,
    );
    if (teamExecutionConversationId === null) return conversation.title;
    const agent = this.getConversationAgentBinding(conversation.id);
    if (agent === null) return conversation.title;
    const instanceRow = this.database.prepare(
      `SELECT name FROM team_instances
       WHERE root_conversation_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
    ).get(teamExecutionConversationId) as DatabaseRow | undefined;
    if (instanceRow === undefined) return agent.name;
    return `${agent.name} · ${asString(instanceRow, "name")}`.slice(0, 200);
  }

  private withCurrentAgentMessageSenderTitle(
    message: ConversationAgentMessageItem,
  ): ConversationAgentMessageItem {
    const senderIsReadable = this.database
      .prepare(
        `SELECT 1 AS present FROM conversations
         WHERE id = ? AND deletion_pending = 0 LIMIT 1`,
      )
      .get(message.senderConversationId) !== undefined;
    if (!senderIsReadable) return message;
    const senderTitle = this.agentMessageSenderTitle(
      this.getConversation(message.senderConversationId),
    );
    if (senderTitle === message.senderTitle) return message;
    return conversationAgentMessageItemSchema.parse({ ...message, senderTitle });
  }

  public getPendingMessageRecord(pendingMessageId: string): StoredPendingMessage {
    const row = this.database
      .prepare(
        `SELECT id, conversation_id, delivery_mode, payload_json, created_at
         FROM conversation_pending_messages
         WHERE id = ? AND status = 'pending'`
      )
      .get(pendingMessageId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Pending conversation message was not found.");
    return toStoredPendingMessage(row);
  }

  private consumePendingRecord(pendingMessageId: string): void {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE conversation_pending_messages
         SET status = 'consumed', consumed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(now, now, pendingMessageId);
    if (result.changes !== 1) throw new Error("Pending conversation message was already consumed.");
  }

  private bindPendingAttachmentsToMessage(
    pendingMessageId: string,
    messageId: string,
    expectedCount: number
  ): void {
    if (expectedCount === 0) return;
    const result = this.database
      .prepare(
        `UPDATE conversation_attachments
         SET message_id = ?, pending_message_id = NULL
         WHERE pending_message_id = ? AND message_id IS NULL`
      )
      .run(messageId, pendingMessageId);
    if (result.changes !== expectedCount) {
      throw new Error("One or more queued attachments could not be sent.");
    }
  }

  private createTitleFromMessage(content: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    return Array.from(normalized.slice(0, 40)).slice(0, 20).join("");
  }

  private updateRun(
    runId: string,
    status: ConversationRunStatus,
    error: string | null,
  ): void {
    this.withTransaction(() => this.runEvents.updateRunInTransaction(runId, status, error));
  }


  private withTransaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE;");
    this.taskListRollback = this.volatileConversationProjectionActive ? new Map() : null;
    try {
      const result = operation();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      for (const [id, previous] of this.taskListRollback ?? []) {
        if (previous === undefined) this.taskLists.delete(id);
        else this.taskLists.set(id, previous);
      }
      throw error;
    } finally {
      this.taskListRollback = null;
    }
  }
}

export { type StoredModelMessage } from "./conversation-storage-contracts.js";
export { type StoredConversationAttachment } from "./conversation-storage-contracts.js";
export { type ConversationAttachmentStoragePaths } from "./conversation-storage-contracts.js";
export { type StoredPendingMessage } from "./conversation-storage-contracts.js";
export { type CancelledPendingMessageAttachmentCleanup } from "./conversation-storage-contracts.js";
export { type PreparedPendingMessage } from "./conversation-storage-contracts.js";
export { type PreparedPendingMessageConsumption } from "./conversation-storage-contracts.js";
export { type StoredContextMessage } from "./conversation-storage-contracts.js";
export { type ConversationContextCheckpoint } from "./conversation-storage-contracts.js";
export { type ConversationTurnSummary } from "./conversation-storage-contracts.js";
export { type ThreadLogProjectionEvent } from "./conversation-storage-contracts.js";
export { type ThreadLogProjectionCursor } from "./conversation-storage-contracts.js";
export { type ThreadLogAttachmentPathResolver } from "./conversation-storage-contracts.js";
export { type TeamDirectoryRecord } from "./conversation-storage-contracts.js";
export { type TeamMemberRecord } from "./conversation-storage-contracts.js";
export { type TeamExecutionConversationRecord } from "./conversation-storage-contracts.js";
export { type PreparedConversationCreation } from "./conversation-storage-contracts.js";
export { type ThreadLogLegacySnapshot } from "./conversation-storage-contracts.js";
export { type ThreadLogLegacyAgentMessage } from "./conversation-storage-contracts.js";
export { type ThreadLogLegacyRun } from "./conversation-storage-contracts.js";
export { type ConversationDeletionTaskStatus } from "./conversation-storage-contracts.js";
export { type ConversationDeletionTask } from "./conversation-storage-contracts.js";
export { type SendAgentMessageInput } from "./conversation-storage-contracts.js";
export { agentMessageModelContent } from "./agent-message-content.js";
export { type SubagentTaskStatus } from "./conversation-storage-contracts.js";
export { type SubagentTask } from "./conversation-storage-contracts.js";
export { type PreparedRunWithUserMessage } from "./conversation-storage-contracts.js";
export { type PreparedLatestUserMessageReplacement } from "./conversation-storage-contracts.js";
export { type CompleteRunInput } from "./conversation-storage-contracts.js";
export { type CompletedRun } from "./conversation-storage-contracts.js";
export { type RunExecutionSnapshot } from "./conversation-storage-contracts.js";
export { type QueuedRunRecovery } from "./conversation-storage-contracts.js";
export { type LatestUserMessageReplacementSource } from "./conversation-storage-contracts.js";
export { contextSearchTerms } from "./context-search.js";
export { distinctiveContextTerms } from "./context-search.js";
export { rankStrongContextMatches } from "./context-search.js";
