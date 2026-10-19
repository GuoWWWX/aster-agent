import type { DatabaseSync } from "node:sqlite";
import { type DatabaseRow, asNullableString } from "./database-row.js";

export function migrateSchemaV1(database: DatabaseSync): void {
  database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        workspace_root_path TEXT,
        selected_provider_id TEXT,
        selected_model_id TEXT,
        selected_reasoning_json TEXT,
        permission_mode TEXT NOT NULL DEFAULT 'ask_before_changes',
        thread_kind TEXT NOT NULL DEFAULT 'agent',
        agent_id TEXT,
        avatar_icon TEXT,
        agent_name TEXT,
        agent_role TEXT,
        agent_is_default INTEGER NOT NULL DEFAULT 0,
        agent_instructions TEXT,
        team_id TEXT,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        has_unread_result INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
         is_pinned INTEGER NOT NULL DEFAULT 0,
         pin_order INTEGER,
         sort_order INTEGER NOT NULL DEFAULT 0,
         deletion_pending INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS conversations_project_updated
        ON conversations(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS runs_conversation_status
        ON runs(conversation_id, status);

      CREATE TABLE IF NOT EXISTS conversation_timeline (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        run_id TEXT,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        run_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls_json TEXT NOT NULL,
        tool_call_id TEXT,
        attachment_ids_json TEXT NOT NULL DEFAULT '[]',
        provider_state_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_pending_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        delivery_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        consumed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS conversation_pending_messages_pending_order
        ON conversation_pending_messages(conversation_id, status, sort_order, sequence);

      CREATE TABLE IF NOT EXISTS conversation_attachments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id TEXT,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        project_path TEXT,
        stored_path TEXT NOT NULL,
        extracted_text_path TEXT,
        pending_message_id TEXT,
        context_tokens INTEGER NOT NULL,
        truncated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS conversation_attachments_conversation_message
        ON conversation_attachments(conversation_id, message_id, created_at);

      CREATE TABLE IF NOT EXISTS conversation_task_lists (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_agent_messages (
        id TEXT PRIMARY KEY,
        sender_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        target_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );

      CREATE INDEX IF NOT EXISTS conversation_agent_messages_target_status
        ON conversation_agent_messages(target_conversation_id, status, created_at);

      CREATE TABLE IF NOT EXISTS subagent_tasks (
        id TEXT PRIMARY KEY,
        parent_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        child_conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        source_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        target_run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        result_message_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS subagent_tasks_parent_status
        ON subagent_tasks(parent_conversation_id, status, created_at);

      CREATE TABLE IF NOT EXISTS conversation_context_checkpoints (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        covered_through_sequence INTEGER NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_turn_summaries (
        run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        covered_through_sequence INTEGER NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS conversation_turn_summaries_boundary
        ON conversation_turn_summaries(conversation_id, covered_through_sequence DESC);

      CREATE TABLE IF NOT EXISTS conversation_deletion_tasks (
        id TEXT PRIMARY KEY,
        root_conversation_id TEXT NOT NULL UNIQUE,
        conversation_ids_json TEXT NOT NULL,
        file_paths_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS conversation_deletion_tasks_status
        ON conversation_deletion_tasks(status, updated_at);
    `);
  migrateProjectManagementState(database);
  migrateNullableConversationProject(database);
  migrateConversationParent(database);
  migrateConversationIdentity(database);
  migrateConversationUnreadResult(database);
  migrateConversationManagementState(database);
  migrateConversationArchivedAt(database);
  migrateConversationWorkspace(database);
  migrateModelMessageAttachments(database);
  migrateModelMessageProviderState(database);
  migratePendingMessageAttachments(database);
  migrateConversationDeletionPending(database);
}

function migrateConversationDeletionPending(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(conversations)")
    .all() as DatabaseRow[];
  if (!columns.some((column) => column.name === "deletion_pending")) {
    database.exec(
      "ALTER TABLE conversations ADD COLUMN deletion_pending INTEGER NOT NULL DEFAULT 0",
    );
  }
}

function migrateProjectManagementState(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(projects)")
    .all() as DatabaseRow[];
  if (!columns.some((column) => column.name === "is_pinned")) {
    database.exec(
      "ALTER TABLE projects ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!columns.some((column) => column.name === "sort_order")) {
    database.exec("ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
    database.exec("UPDATE projects SET sort_order = rowid - 1");
  }
}

function migrateNullableConversationProject(database: DatabaseSync): void {
  const row = database
    .prepare(
      "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversations'"
    )
    .get() as DatabaseRow | undefined;
  const definition = row === undefined ? null : asNullableString(row, "sql");

  if (definition === null || !definition.includes("project_id TEXT NOT NULL")) {
    return;
  }

  database.exec(`
      CREATE TABLE conversations_migrated (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO conversations_migrated (id, project_id, title, created_at, updated_at)
        SELECT id, project_id, title, created_at, updated_at FROM conversations;
      DROP TABLE conversations;
      ALTER TABLE conversations_migrated RENAME TO conversations;
      CREATE INDEX conversations_project_updated
        ON conversations(project_id, updated_at DESC);
    `);
}

function migrateConversationParent(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(conversations)")
    .all() as DatabaseRow[];
  if (!columns.some((column) => column.name === "parent_conversation_id")) {
    database.exec(
      "ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE"
    );
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS conversations_parent_created ON conversations(parent_conversation_id, created_at ASC)"
  );
}

function migrateConversationIdentity(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(conversations)")
    .all() as DatabaseRow[];
  const columnNames = new Set(columns.map((column) => column.name));
  if (!columnNames.has("thread_kind")) {
    database.exec(
      "ALTER TABLE conversations ADD COLUMN thread_kind TEXT NOT NULL DEFAULT 'agent'"
    );
  }
  for (const column of [
    "agent_id",
    "agent_name",
    "agent_role",
    "agent_instructions",
    "team_id"
  ]) {
    if (!columnNames.has(column)) {
      database.exec(`ALTER TABLE conversations ADD COLUMN ${column} TEXT`);
    }
  }
  if (!columnNames.has("agent_is_default")) {
    database.exec(
      "ALTER TABLE conversations ADD COLUMN agent_is_default INTEGER NOT NULL DEFAULT 0"
    );
  }
  database.exec(`
      UPDATE conversations
      SET thread_kind = CASE
        WHEN parent_conversation_id IS NOT NULL THEN 'subagent'
        ELSE 'agent'
      END
      WHERE thread_kind = 'standard'
    `);
  database.exec(`
      UPDATE conversations
      SET thread_kind = 'agent'
      WHERE parent_conversation_id IS NOT NULL
        AND thread_kind = 'subagent'
        AND NOT EXISTS (
          SELECT 1 FROM subagent_tasks
          WHERE subagent_tasks.child_conversation_id = conversations.id
        )
    `);
  database.exec(
    "CREATE INDEX IF NOT EXISTS conversations_team_kind ON conversations(team_id, thread_kind)"
  );
}

function migrateConversationUnreadResult(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(conversations)")
    .all() as DatabaseRow[];
  if (!columns.some((column) => column.name === "has_unread_result")) {
    database.exec(
      "ALTER TABLE conversations ADD COLUMN has_unread_result INTEGER NOT NULL DEFAULT 0"
    );
  }
}

function migrateConversationManagementState(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(conversations)")
    .all() as DatabaseRow[];
  if (!columns.some((column) => column.name === "is_archived")) {
    database.exec(
      "ALTER TABLE conversations ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!columns.some((column) => column.name === "is_pinned")) {
    database.exec(
      "ALTER TABLE conversations ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"
    );
  }
  if (!columns.some((column) => column.name === "pin_order")) {
    database.exec("ALTER TABLE conversations ADD COLUMN pin_order INTEGER");
    database.exec(`
        UPDATE conversations
        SET pin_order = (
          SELECT COUNT(*)
          FROM conversations AS earlier
          WHERE earlier.is_pinned = 1
            AND (
              earlier.updated_at > conversations.updated_at
              OR (
                earlier.updated_at = conversations.updated_at
                AND earlier.rowid >= conversations.rowid
              )
            )
        )
        WHERE is_pinned = 1
      `);
  }
  if (!columns.some((column) => column.name === "sort_order")) {
    database.exec(
      "ALTER TABLE conversations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
    );
    database.exec(`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY project_id, is_pinned, is_archived, parent_conversation_id
                   ORDER BY
                     CASE WHEN is_pinned = 1 THEN pin_order END ASC,
                     CASE WHEN is_pinned = 0 THEN updated_at END DESC,
                     rowid DESC
                 ) - 1 AS position
          FROM conversations
        )
        UPDATE conversations
        SET sort_order = (
          SELECT position FROM ranked WHERE ranked.id = conversations.id
        )
      `);
  }
}

function migrateConversationWorkspace(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(conversations)")
    .all() as DatabaseRow[];
  if (!columns.some((column) => column.name === "workspace_root_path")) {
    database.exec("ALTER TABLE conversations ADD COLUMN workspace_root_path TEXT");
  }
}

function migrateConversationArchivedAt(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(conversations)")
    .all() as DatabaseRow[];
  if (!columns.some((column) => column.name === "archived_at")) {
    database.exec("ALTER TABLE conversations ADD COLUMN archived_at TEXT");
  }

  database
    .prepare(
      "UPDATE conversations SET archived_at = ? WHERE is_archived = 1 AND archived_at IS NULL"
    )
    .run(new Date().toISOString());
}

function migrateModelMessageAttachments(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(model_messages)")
    .all() as DatabaseRow[];
  if (!columns.some((column) => column.name === "attachment_ids_json")) {
    database.exec(
      "ALTER TABLE model_messages ADD COLUMN attachment_ids_json TEXT NOT NULL DEFAULT '[]'"
    );
  }
}

function migrateModelMessageProviderState(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(model_messages)")
    .all() as DatabaseRow[];
  if (!columns.some((column) => column.name === "provider_state_json")) {
    database.exec("ALTER TABLE model_messages ADD COLUMN provider_state_json TEXT");
  }
}

function migratePendingMessageAttachments(database: DatabaseSync): void {
  const columns = database
    .prepare("PRAGMA table_info(conversation_attachments)")
    .all() as DatabaseRow[];
  if (!columns.some((column) => column.name === "pending_message_id")) {
    database.exec(
      "ALTER TABLE conversation_attachments ADD COLUMN pending_message_id TEXT"
    );
  }
  database.exec(
    "CREATE INDEX IF NOT EXISTS conversation_attachments_pending_message ON conversation_attachments(pending_message_id)"
  );
}
