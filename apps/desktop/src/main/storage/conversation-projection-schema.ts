import type { DatabaseSync } from "node:sqlite";

export function createVolatileConversationProjectionSchema(database: DatabaseSync): void {
  database.exec(`
      CREATE TEMP TABLE conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT,
        parent_conversation_id TEXT,
        workspace_root_path TEXT,
        selected_provider_id TEXT,
        selected_model_id TEXT,
        selected_reasoning_json TEXT,
        permission_mode TEXT NOT NULL DEFAULT 'ask_before_changes',
        coordination_mode TEXT NOT NULL DEFAULT 'direct',
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
      CREATE INDEX temp.conversations_project_updated
        ON conversations(project_id, updated_at DESC);
      CREATE INDEX temp.conversations_parent_created
        ON conversations(parent_conversation_id, created_at ASC);
      CREATE INDEX temp.conversations_team_kind
        ON conversations(team_id, thread_kind);

      CREATE TEMP TABLE runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        model_id TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        execution_snapshot_json TEXT
      );
      CREATE INDEX temp.runs_conversation_status
        ON runs(conversation_id, status);

      CREATE TEMP TABLE conversation_timeline (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        run_id TEXT,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX temp.conversation_timeline_conversation_sequence
        ON conversation_timeline(conversation_id, sequence DESC);
      CREATE INDEX temp.conversation_timeline_run_sequence
        ON conversation_timeline(run_id, sequence DESC);

      CREATE TEMP TABLE model_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        run_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls_json TEXT NOT NULL,
        tool_call_id TEXT,
        attachment_ids_json TEXT NOT NULL DEFAULT '[]',
        provider_state_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX temp.model_messages_conversation_sequence
        ON model_messages(conversation_id, sequence DESC);
      CREATE INDEX temp.model_messages_run_sequence
        ON model_messages(run_id, sequence ASC);

      CREATE TEMP TABLE conversation_pending_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL,
        delivery_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        consumed_at TEXT
      );
      CREATE INDEX temp.conversation_pending_messages_pending_order
        ON conversation_pending_messages(conversation_id, status, sort_order, sequence);

      CREATE TEMP TABLE conversation_attachments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
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
      CREATE INDEX temp.conversation_attachments_conversation_message
        ON conversation_attachments(conversation_id, message_id, created_at);

      CREATE TEMP TABLE conversation_agent_messages (
        id TEXT PRIMARY KEY,
        sender_conversation_id TEXT NOT NULL,
        target_conversation_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT,
        work_item_id TEXT
      );
      CREATE INDEX temp.conversation_agent_messages_target_status
        ON conversation_agent_messages(target_conversation_id, status, created_at);
      CREATE INDEX temp.conversation_agent_messages_work_item
        ON conversation_agent_messages(work_item_id, created_at);

      CREATE TEMP TABLE subagent_tasks (
        id TEXT PRIMARY KEY,
        parent_conversation_id TEXT NOT NULL,
        child_conversation_id TEXT NOT NULL UNIQUE,
        source_run_id TEXT NOT NULL,
        target_run_id TEXT UNIQUE,
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
      CREATE INDEX temp.subagent_tasks_parent_status
        ON subagent_tasks(parent_conversation_id, status, created_at);

      CREATE TEMP TABLE conversation_context_checkpoints (
        conversation_id TEXT PRIMARY KEY,
        covered_through_sequence INTEGER NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TEMP TABLE conversation_turn_summaries (
        run_id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        covered_through_sequence INTEGER NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX temp.conversation_turn_summaries_boundary
        ON conversation_turn_summaries(conversation_id, covered_through_sequence DESC);

    `);
}
