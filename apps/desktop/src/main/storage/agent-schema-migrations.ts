import type { DatabaseSync } from "node:sqlite";
import { DatabaseMigrationRunner } from "./database-migration-runner.js";
import { type DatabaseRow, asString } from "./database-row.js";
import { migrateSchemaV1 } from "./legacy-agent-schema.js";
import { quoteSqliteIdentifier } from "./sqlite-schema-identifiers.js";
import { COLLABORATION_SCHEMA } from "./collaboration-store.js";
import { LANGGRAPH_CHECKPOINT_BLOBS_SCHEMA } from "./langgraph-checkpoint-schema.js";

export function migrateAgentDatabaseSchema(
  database: DatabaseSync,
  isJsonlConversationStorageFinalized: () => boolean,
): void {
  new DatabaseMigrationRunner(database).run([
    {
      name: "agent-database-initial",
      up: () => migrateSchemaV1(database),
      version: 1,
    },
    {
      name: "agent-run-execution-snapshot",
      up: (database) => {
        const columns = database
          .prepare("PRAGMA table_info(runs)")
          .all() as DatabaseRow[];
        if (!columns.some((column) => column.name === "execution_snapshot_json")) {
          database.exec(
            "ALTER TABLE runs ADD COLUMN execution_snapshot_json TEXT",
          );
        }
      },
      version: 2,
    },
    {
      name: "agent-context-message-search",
      up: (database) => {
        database.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS model_message_search USING fts5(
              conversation_id UNINDEXED,
              sequence UNINDEXED,
              search_text,
              tokenize = 'trigram'
            );

            CREATE TRIGGER IF NOT EXISTS model_messages_search_after_insert
            AFTER INSERT ON model_messages
            BEGIN
              INSERT INTO model_message_search(conversation_id, sequence, search_text)
              VALUES (new.conversation_id, new.sequence,
                new.content || char(10) || new.tool_calls_json);
            END;

            CREATE TRIGGER IF NOT EXISTS model_messages_search_after_delete
            AFTER DELETE ON model_messages
            BEGIN
              DELETE FROM model_message_search
              WHERE rowid IN (
                SELECT rowid FROM model_message_search
                WHERE conversation_id = old.conversation_id
                  AND sequence = old.sequence
              );
            END;

            CREATE TRIGGER IF NOT EXISTS model_messages_search_after_update
            AFTER UPDATE OF conversation_id, content, tool_calls_json ON model_messages
            BEGIN
              DELETE FROM model_message_search
              WHERE rowid IN (
                SELECT rowid FROM model_message_search
                WHERE conversation_id = old.conversation_id
                  AND sequence = old.sequence
              );
              INSERT INTO model_message_search(conversation_id, sequence, search_text)
              VALUES (new.conversation_id, new.sequence,
                new.content || char(10) || new.tool_calls_json);
            END;

            DELETE FROM model_message_search;
            INSERT INTO model_message_search(conversation_id, sequence, search_text)
            SELECT conversation_id, sequence, content || char(10) || tool_calls_json
            FROM model_messages;
          `);
      },
      version: 3,
    },
    {
      name: "agent-thread-log-event-index",
      up: (database) => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS thread_log_event_index (
              event_id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              sequence INTEGER NOT NULL,
              type TEXT NOT NULL,
              created_at TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              UNIQUE(conversation_id, sequence)
            );

            CREATE INDEX IF NOT EXISTS thread_log_event_index_conversation_type
              ON thread_log_event_index(conversation_id, type, sequence);

            CREATE TABLE IF NOT EXISTS thread_log_projection_cursors (
              conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
              last_event_sequence INTEGER NOT NULL,
              last_event_id TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
          `);
      },
      version: 4,
    },
    {
      name: "agent-team-relationships",
      up: (database) => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS teams (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT NOT NULL,
              enabled INTEGER NOT NULL,
              lead_agent_id TEXT NOT NULL,
              instructions TEXT NOT NULL,
              max_workers INTEGER NOT NULL,
              project_scope TEXT NOT NULL,
              coordinator_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS team_members (
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              agent_id TEXT NOT NULL,
              member_index INTEGER NOT NULL,
              role TEXT NOT NULL,
              instructions TEXT NOT NULL,
              PRIMARY KEY (team_id, agent_id),
              UNIQUE(team_id, member_index)
            );

            CREATE INDEX IF NOT EXISTS team_members_agent
              ON team_members(agent_id, team_id);
          `);
      },
      version: 5,
    },
    {
      name: "agent-plugin-catalog",
      up: (database) => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS plugin_catalog (
              id TEXT PRIMARY KEY,
              root_path TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              version TEXT NOT NULL,
              content_hash TEXT NOT NULL,
              manifest_json TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS plugin_catalog_enabled
              ON plugin_catalog(enabled, name COLLATE NOCASE, id);
          `);
      },
      version: 6,
    },
    {
      name: "conversation-model-selection",
      up: (database) => {
        const columns = database
          .prepare("PRAGMA table_info(conversations)")
          .all() as DatabaseRow[];
        const columnNames = new Set(columns.map((column) => column.name));
        if (!columnNames.has("selected_provider_id")) {
          database.exec("ALTER TABLE conversations ADD COLUMN selected_provider_id TEXT");
        }
        if (!columnNames.has("selected_model_id")) {
          database.exec("ALTER TABLE conversations ADD COLUMN selected_model_id TEXT");
        }
        if (!columnNames.has("selected_reasoning_json")) {
          database.exec("ALTER TABLE conversations ADD COLUMN selected_reasoning_json TEXT");
        }
      },
      version: 7,
    },
    {
      name: "conversation-avatar-icon",
      up: (database) => {
        const columns = database
          .prepare("PRAGMA table_info(conversations)")
          .all() as DatabaseRow[];
        if (!columns.some((column) => column.name === "avatar_icon")) {
          database.exec("ALTER TABLE conversations ADD COLUMN avatar_icon TEXT");
        }
      },
      version: 8,
    },
    {
      name: "team-work-items",
      up: (database) => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS team_work_items (
              id TEXT PRIMARY KEY,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              requirement TEXT NOT NULL,
              acceptance_criteria_json TEXT NOT NULL,
              priority TEXT NOT NULL CHECK(priority IN ('high', 'normal', 'low')),
              status TEXT NOT NULL CHECK(status IN (
                'inbox', 'triaging', 'needs_clarification', 'planned', 'queued', 'running',
                'waiting_user', 'blocked', 'reviewing', 'completed', 'failed', 'cancelled'
              )),
              revision INTEGER NOT NULL,
              permission_mode TEXT NOT NULL,
              model_selection_json TEXT NOT NULL,
              execution_conversation_id TEXT UNIQUE REFERENCES conversations(id) ON DELETE SET NULL,
              active_run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE SET NULL,
              result_summary TEXT,
              blocked_reason TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              completed_at TEXT
            );

            CREATE INDEX IF NOT EXISTS team_work_items_team_status
              ON team_work_items(team_id, status, priority, created_at);
            CREATE INDEX IF NOT EXISTS team_work_items_project_status
              ON team_work_items(project_id, status, created_at);

            CREATE TABLE IF NOT EXISTS team_work_item_events (
              id TEXT PRIMARY KEY,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              work_item_id TEXT NOT NULL REFERENCES team_work_items(id) ON DELETE CASCADE,
              sequence INTEGER NOT NULL,
              type TEXT NOT NULL,
              detail TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(team_id, sequence)
            );

            CREATE INDEX IF NOT EXISTS team_work_item_events_work_item
              ON team_work_item_events(work_item_id, sequence);
          `);
      },
      version: 9,
    },
    {
      name: "team-work-item-acceptance",
      up: (database) => {
        const columns = database.prepare("PRAGMA table_info(team_work_items)").all() as DatabaseRow[];
        if (!columns.some((column) => column.name === "accepted_criteria_json")) {
          database.exec("ALTER TABLE team_work_items ADD COLUMN accepted_criteria_json TEXT NOT NULL DEFAULT '[]'");
        }
      },
      version: 10,
    },
    {
      name: "team-work-item-source-conversation",
      up: (database) => {
        const columns = database.prepare("PRAGMA table_info(team_work_items)").all() as DatabaseRow[];
        if (!columns.some((column) => column.name === "source_conversation_id")) {
          database.exec(
            "ALTER TABLE team_work_items ADD COLUMN source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL",
          );
        }
        database.exec(
          "CREATE INDEX IF NOT EXISTS team_work_items_source_conversation ON team_work_items(source_conversation_id)",
        );
      },
      version: 11,
    },
    {
      name: "team-durable-member-conversations",
      up: (database) => {
        database.exec(`
            CREATE TABLE team_work_items_next (
              id TEXT PRIMARY KEY,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              requirement TEXT NOT NULL,
              acceptance_criteria_json TEXT NOT NULL,
              priority TEXT NOT NULL CHECK(priority IN ('high', 'normal', 'low')),
              status TEXT NOT NULL CHECK(status IN (
                'inbox', 'triaging', 'needs_clarification', 'planned', 'queued', 'running',
                'waiting_user', 'blocked', 'reviewing', 'completed', 'failed', 'cancelled'
              )),
              revision INTEGER NOT NULL,
              permission_mode TEXT NOT NULL,
              model_selection_json TEXT NOT NULL,
              execution_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
              active_run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE SET NULL,
              result_summary TEXT,
              blocked_reason TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              completed_at TEXT,
              accepted_criteria_json TEXT NOT NULL DEFAULT '[]',
              source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL
            );

            INSERT INTO team_work_items_next (
              id, team_id, project_id, title, requirement, acceptance_criteria_json,
              priority, status, revision, permission_mode, model_selection_json,
              execution_conversation_id, active_run_id, result_summary, blocked_reason,
              created_at, updated_at, completed_at, accepted_criteria_json, source_conversation_id
            )
            SELECT
              id, team_id, project_id, title, requirement, acceptance_criteria_json,
              priority, status, revision, permission_mode, model_selection_json,
              execution_conversation_id, active_run_id, result_summary, blocked_reason,
              created_at, updated_at, completed_at, accepted_criteria_json, source_conversation_id
            FROM team_work_items;

            DROP TABLE team_work_items;
            ALTER TABLE team_work_items_next RENAME TO team_work_items;

            CREATE INDEX team_work_items_team_status
              ON team_work_items(team_id, status, priority, created_at);
            CREATE INDEX team_work_items_project_status
              ON team_work_items(project_id, status, created_at);
            CREATE INDEX team_work_items_source_conversation
              ON team_work_items(source_conversation_id);

            CREATE TABLE IF NOT EXISTS team_execution_conversations (
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              source_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
              scope_key TEXT NOT NULL,
              conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (team_id, scope_key)
            );

            CREATE INDEX IF NOT EXISTS team_execution_conversations_source
              ON team_execution_conversations(source_conversation_id, team_id);

            CREATE TABLE IF NOT EXISTS team_member_conversations (
              team_execution_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              agent_id TEXT NOT NULL,
              conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (team_execution_conversation_id, agent_id)
            );

            CREATE INDEX IF NOT EXISTS team_member_conversations_member
              ON team_member_conversations(conversation_id);

            CREATE TABLE IF NOT EXISTS team_work_item_member_assignments (
              id TEXT PRIMARY KEY,
              work_item_id TEXT NOT NULL REFERENCES team_work_items(id) ON DELETE CASCADE,
              member_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              message_id TEXT NOT NULL UNIQUE REFERENCES conversation_agent_messages(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS team_work_item_member_assignments_work_item
              ON team_work_item_member_assignments(work_item_id, created_at);

            INSERT OR IGNORE INTO team_execution_conversations (
              team_id, project_id, source_conversation_id, scope_key, conversation_id, created_at, updated_at
            )
            SELECT
              team_id,
              project_id,
              source_conversation_id,
              CASE
                WHEN source_conversation_id IS NULL THEN 'project:' || project_id
                ELSE 'conversation:' || source_conversation_id
              END,
              execution_conversation_id,
              created_at,
              updated_at
            FROM team_work_items
            WHERE execution_conversation_id IS NOT NULL
            ORDER BY updated_at DESC, rowid DESC;
          `);
      },
      version: 12,
    },
    {
      name: "team-work-item-execution-scope",
      up: (database) => {
        const columns = database.prepare("PRAGMA table_info(team_work_items)").all() as DatabaseRow[];
        if (!columns.some((column) => column.name === "execution_scope")) {
          database.exec(
            "ALTER TABLE team_work_items ADD COLUMN execution_scope TEXT NOT NULL DEFAULT 'conversation' CHECK(execution_scope IN ('project', 'conversation'))",
          );
          database.exec(
            "UPDATE team_work_items SET execution_scope = 'project' WHERE source_conversation_id IS NULL",
          );
        }
      },
      version: 13,
    },
    {
      name: "team-instance-names",
      up: (database) => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS team_instances (
              id TEXT PRIMARY KEY,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              scope TEXT NOT NULL CHECK(scope IN ('global', 'project', 'conversation')),
              project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
              source_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              root_conversation_id TEXT UNIQUE REFERENCES conversations(id) ON DELETE SET NULL,
              archived_at TEXT,
              deleted_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS team_instances_owner
              ON team_instances(scope, project_id, source_conversation_id, archived_at, deleted_at);
            CREATE INDEX IF NOT EXISTS team_instances_team
              ON team_instances(team_id, archived_at, deleted_at);

            INSERT OR IGNORE INTO team_instances (
              id, team_id, scope, project_id, source_conversation_id, name,
              root_conversation_id, archived_at, deleted_at, created_at, updated_at
            )
            SELECT
              coordinator_conversation_id,
              id,
              'global',
              NULL,
              NULL,
              name,
              coordinator_conversation_id,
              NULL,
              NULL,
              created_at,
              updated_at
            FROM teams
            WHERE coordinator_conversation_id IS NOT NULL;

            INSERT OR IGNORE INTO team_instances (
              id, team_id, scope, project_id, source_conversation_id, name,
              root_conversation_id, archived_at, deleted_at, created_at, updated_at
            )
            SELECT
              binding.conversation_id,
              binding.team_id,
              CASE WHEN binding.source_conversation_id IS NULL THEN 'project' ELSE 'conversation' END,
              binding.project_id,
              binding.source_conversation_id,
              teams.name,
              binding.conversation_id,
              NULL,
              NULL,
              binding.created_at,
              binding.updated_at
            FROM team_execution_conversations AS binding
            JOIN teams ON teams.id = binding.team_id;

            INSERT OR IGNORE INTO team_instances (
              id, team_id, scope, project_id, source_conversation_id, name,
              root_conversation_id, archived_at, deleted_at, created_at, updated_at
            )
            SELECT
              MIN(work_item.id),
              work_item.team_id,
              CASE WHEN work_item.execution_scope = 'conversation' THEN 'conversation' ELSE 'project' END,
              work_item.project_id,
              CASE WHEN work_item.execution_scope = 'conversation'
                THEN work_item.source_conversation_id ELSE NULL END,
              teams.name,
              NULL,
              NULL,
              NULL,
              MIN(work_item.created_at),
              MAX(work_item.updated_at)
            FROM team_work_items AS work_item
            JOIN teams ON teams.id = work_item.team_id
            WHERE NOT EXISTS (
              SELECT 1 FROM team_instances AS instance
              WHERE instance.team_id = work_item.team_id
                AND instance.project_id = work_item.project_id
                AND instance.scope = CASE
                  WHEN work_item.execution_scope = 'conversation' THEN 'conversation' ELSE 'project' END
                AND (
                  (work_item.execution_scope = 'project' AND instance.source_conversation_id IS NULL)
                  OR instance.source_conversation_id = work_item.source_conversation_id
                )
            )
            GROUP BY
              work_item.team_id,
              work_item.project_id,
              work_item.execution_scope,
              CASE WHEN work_item.execution_scope = 'conversation'
                THEN work_item.source_conversation_id ELSE NULL END;
          `);

        const workItemColumns = database.prepare("PRAGMA table_info(team_work_items)").all() as DatabaseRow[];
        if (!workItemColumns.some((column) => column.name === "team_instance_id")) {
          database.exec("ALTER TABLE team_work_items ADD COLUMN team_instance_id TEXT");
        }
        database.exec(`
            UPDATE team_work_items
            SET team_instance_id = (
              SELECT instance.id
              FROM team_instances AS instance
              WHERE instance.team_id = team_work_items.team_id
                AND instance.project_id = team_work_items.project_id
                AND instance.scope = CASE
                  WHEN team_work_items.execution_scope = 'conversation' THEN 'conversation' ELSE 'project' END
                AND (
                  (team_work_items.execution_scope = 'project' AND instance.source_conversation_id IS NULL)
                  OR instance.source_conversation_id = team_work_items.source_conversation_id
                )
              ORDER BY instance.created_at ASC
              LIMIT 1
            )
            WHERE team_instance_id IS NULL;

            CREATE INDEX IF NOT EXISTS team_work_items_instance_status
              ON team_work_items(team_instance_id, status, created_at);

            CREATE TABLE team_execution_conversations_next (
              team_instance_id TEXT NOT NULL REFERENCES team_instances(id) ON DELETE CASCADE,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
              source_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
              scope_key TEXT NOT NULL,
              conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (team_instance_id, scope_key)
            );

            INSERT INTO team_execution_conversations_next (
              team_instance_id, team_id, project_id, source_conversation_id,
              scope_key, conversation_id, created_at, updated_at
            )
            SELECT
              instance.id,
              binding.team_id,
              binding.project_id,
              binding.source_conversation_id,
              binding.scope_key,
              binding.conversation_id,
              binding.created_at,
              binding.updated_at
            FROM team_execution_conversations AS binding
            JOIN team_instances AS instance
              ON instance.root_conversation_id = binding.conversation_id;

            DROP TABLE team_execution_conversations;
            ALTER TABLE team_execution_conversations_next RENAME TO team_execution_conversations;

            CREATE INDEX team_execution_conversations_source
              ON team_execution_conversations(source_conversation_id, team_id);
            CREATE INDEX team_execution_conversations_instance
              ON team_execution_conversations(team_instance_id, project_id, source_conversation_id);
          `);
      },
      version: 14,
    },
    {
      name: "project-team-navigator-visibility",
      up: (database) => {
        const columns = database
          .prepare("PRAGMA table_info(projects)")
          .all() as DatabaseRow[];
        if (!columns.some((column) => column.name === "show_teams_in_navigator")) {
          database.exec(`
              ALTER TABLE projects
              ADD COLUMN show_teams_in_navigator INTEGER NOT NULL DEFAULT 0;
            `);
        }
      },
      version: 15,
    },
    {
      name: "team-instance-sort-order",
      up: (database) => {
        const columns = database
          .prepare("PRAGMA table_info(team_instances)")
          .all() as DatabaseRow[];
        if (!columns.some((column) => column.name === "sort_order")) {
          database.exec(
            "ALTER TABLE team_instances ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
          );
        }
        const rows = database.prepare(
          `SELECT id FROM team_instances
             WHERE scope IN ('global', 'project') AND deleted_at IS NULL
             ORDER BY created_at ASC, rowid ASC`,
        ).all() as DatabaseRow[];
        const update = database.prepare(
          "UPDATE team_instances SET sort_order = ? WHERE id = ?",
        );
        rows.forEach((row, index) => update.run(index, asString(row, "id")));
      },
      version: 16,
    },
    {
      name: "team-collaboration-plans",
      up: (database) => {
        const messageColumns = database
          .prepare("PRAGMA table_info(conversation_agent_messages)")
          .all() as DatabaseRow[];
        if (!messageColumns.some((column) => column.name === "work_item_id")) {
          database.exec(`
              ALTER TABLE conversation_agent_messages
              ADD COLUMN work_item_id TEXT REFERENCES team_work_items(id) ON DELETE SET NULL;
            `);
        }
        database.exec(`
            CREATE INDEX IF NOT EXISTS conversation_agent_messages_work_item
              ON conversation_agent_messages(work_item_id, created_at);

            CREATE TABLE IF NOT EXISTS team_collaboration_plans (
              id TEXT PRIMARY KEY,
              work_item_id TEXT NOT NULL REFERENCES team_work_items(id) ON DELETE CASCADE,
              revision INTEGER NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('active', 'superseded')),
              created_by_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              reason TEXT NOT NULL,
              created_at TEXT NOT NULL,
              activated_at TEXT NOT NULL,
              superseded_at TEXT,
              UNIQUE(work_item_id, revision)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS team_collaboration_plans_active
              ON team_collaboration_plans(work_item_id) WHERE status = 'active';

            CREATE TABLE IF NOT EXISTS team_collaboration_plan_nodes (
              id TEXT PRIMARY KEY,
              plan_id TEXT NOT NULL REFERENCES team_collaboration_plans(id) ON DELETE CASCADE,
              stable_agent_id TEXT,
              conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
              kind TEXT NOT NULL CHECK(kind IN ('team_lead', 'standing', 'ephemeral', 'placeholder')),
              name_snapshot TEXT NOT NULL,
              role_snapshot TEXT NOT NULL,
              position_x REAL NOT NULL,
              position_y REAL NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS team_collaboration_plan_nodes_plan
              ON team_collaboration_plan_nodes(plan_id, created_at);

            CREATE TABLE IF NOT EXISTS team_collaboration_plan_routes (
              id TEXT PRIMARY KEY,
              plan_id TEXT NOT NULL REFERENCES team_collaboration_plans(id) ON DELETE CASCADE,
              from_node_id TEXT NOT NULL REFERENCES team_collaboration_plan_nodes(id) ON DELETE CASCADE,
              to_node_id TEXT NOT NULL REFERENCES team_collaboration_plan_nodes(id) ON DELETE CASCADE,
              purposes_json TEXT NOT NULL,
              optional INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              UNIQUE(plan_id, from_node_id, to_node_id)
            );

            CREATE INDEX IF NOT EXISTS team_collaboration_plan_routes_plan
              ON team_collaboration_plan_routes(plan_id, created_at);
          `);
      },
      version: 17,
    },
    {
      name: "team-collaboration-output-snapshots",
      up: (database) => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS team_work_item_collaboration_outputs (
              work_item_id TEXT NOT NULL REFERENCES team_work_items(id) ON DELETE CASCADE,
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
              content TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (work_item_id, conversation_id)
            );

            CREATE INDEX IF NOT EXISTS team_work_item_collaboration_outputs_work_item
              ON team_work_item_collaboration_outputs(work_item_id, updated_at);
          `);
      },
      version: 18,
    },
    {
      name: "team-work-item-soft-delete",
      up: (database) => {
        const columns = database.prepare("PRAGMA table_info(team_work_items)").all() as DatabaseRow[];
        if (!columns.some((column) => column.name === "deleted_at")) {
          database.exec("ALTER TABLE team_work_items ADD COLUMN deleted_at TEXT");
        }
        database.exec(`
            CREATE INDEX IF NOT EXISTS team_work_items_visible_status
              ON team_work_items(team_id, deleted_at, status, created_at);
          `);
      },
      version: 19,
    },
    {
      name: "conversation-turn-summaries",
      up: (database) => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS conversation_turn_summaries (
              run_id TEXT PRIMARY KEY REFERENCES runs(id) ON DELETE CASCADE,
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              covered_through_sequence INTEGER NOT NULL,
              summary TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS conversation_turn_summaries_boundary
              ON conversation_turn_summaries(conversation_id, covered_through_sequence DESC);
          `);
      },
      version: 20,
    },
    {
      name: "subagent-pixel-avatar-identity",
      up: (database) => {
        database.exec(`
            UPDATE conversations
            SET avatar_icon = NULL
            WHERE thread_kind = 'subagent';
          `);
      },
      version: 21,
    },
    {
      name: "unified-langgraph-checkpoint-storage",
      up: (database) => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS langgraph_checkpoints (
              thread_id TEXT NOT NULL,
              checkpoint_ns TEXT NOT NULL,
              checkpoint_id TEXT NOT NULL,
              parent_checkpoint_id TEXT,
              checkpoint_type TEXT NOT NULL,
              checkpoint_blob BLOB NOT NULL,
              metadata_type TEXT NOT NULL,
              metadata_blob BLOB NOT NULL,
              created_at TEXT NOT NULL,
              PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id)
            );
            CREATE INDEX IF NOT EXISTS langgraph_checkpoints_thread_order
              ON langgraph_checkpoints(thread_id, checkpoint_ns, checkpoint_id DESC);

            CREATE TABLE IF NOT EXISTS langgraph_checkpoint_writes (
              thread_id TEXT NOT NULL,
              checkpoint_ns TEXT NOT NULL,
              checkpoint_id TEXT NOT NULL,
              task_id TEXT NOT NULL,
              write_idx INTEGER NOT NULL,
              channel TEXT NOT NULL,
              value_type TEXT NOT NULL,
              value_blob BLOB NOT NULL,
              created_at TEXT NOT NULL,
              PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx)
            );
            CREATE INDEX IF NOT EXISTS langgraph_checkpoint_writes_order
              ON langgraph_checkpoint_writes(
                thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx
              );
          `);
      },
      version: 22,
    },
    {
      name: "plugin-settings-jsonc",
      up: (database) => {
        database.exec("DROP TABLE IF EXISTS plugin_catalog;");
      },
      version: 23,
    },
    {
      name: "conversation-permission-mode",
      up: (database) => {
        const columns = database.prepare("PRAGMA table_info(conversations)").all() as DatabaseRow[];
        if (!columns.some((column) => column.name === "permission_mode")) {
          database.exec(
            "ALTER TABLE conversations ADD COLUMN permission_mode TEXT NOT NULL DEFAULT 'ask_before_changes'",
          );
        }
      },
      version: 24,
    },
    {
      name: "one-time-storage-imports",
      up: (database) => {
        database.exec(`
            CREATE TABLE IF NOT EXISTS storage_imports (
              source_kind TEXT NOT NULL,
              source_identity TEXT NOT NULL,
              completed_at TEXT NOT NULL,
              PRIMARY KEY (source_kind, source_identity)
            );
          `);
      },
      version: 25,
    },
    {
      name: "conversation-timeline-search",
      up: (database) => {
        database.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS conversation_timeline_search USING fts5(
              search_text,
              conversation_id UNINDEXED,
              item_id UNINDEXED,
              sequence UNINDEXED,
              tokenize = 'trigram'
            );

            CREATE TRIGGER IF NOT EXISTS conversation_timeline_search_insert
            AFTER INSERT ON conversation_timeline
            WHEN new.kind IN ('message', 'agent_message')
            BEGIN
              INSERT INTO conversation_timeline_search(
                search_text, conversation_id, item_id, sequence
              ) VALUES (
                json_extract(new.payload_json, '$.content'),
                new.conversation_id,
                new.id,
                new.sequence
              );
            END;

            CREATE TRIGGER IF NOT EXISTS conversation_timeline_search_delete
            AFTER DELETE ON conversation_timeline
            BEGIN
              DELETE FROM conversation_timeline_search WHERE sequence = old.sequence;
            END;

            CREATE TRIGGER IF NOT EXISTS conversation_timeline_search_update
            AFTER UPDATE OF payload_json, kind, conversation_id ON conversation_timeline
            BEGIN
              DELETE FROM conversation_timeline_search WHERE sequence = old.sequence;
              INSERT INTO conversation_timeline_search(
                search_text, conversation_id, item_id, sequence
              )
              SELECT
                json_extract(new.payload_json, '$.content'),
                new.conversation_id,
                new.id,
                new.sequence
              WHERE new.kind IN ('message', 'agent_message');
            END;

            DELETE FROM conversation_timeline_search;
            INSERT INTO conversation_timeline_search(
              search_text, conversation_id, item_id, sequence
            )
            SELECT
              json_extract(payload_json, '$.content'),
              conversation_id,
              id,
              sequence
            FROM conversation_timeline
            WHERE kind IN ('message', 'agent_message');
          `);
      },
      version: 26,
    },
    {
      name: "conversation-history-pagination-indexes",
      up: (database) => {
        database.exec(`
            CREATE INDEX IF NOT EXISTS conversation_timeline_conversation_sequence
              ON conversation_timeline(conversation_id, sequence DESC);
            CREATE INDEX IF NOT EXISTS model_messages_conversation_sequence
              ON model_messages(conversation_id, sequence DESC);
            CREATE INDEX IF NOT EXISTS model_messages_run_sequence
              ON model_messages(run_id, sequence ASC);
          `);
      },
      version: 27,
    },
    {
      name: "thread-log-projection-source-signature",
      up: (database) => {
        const columns = database
          .prepare("PRAGMA table_info(thread_log_projection_cursors)")
          .all() as DatabaseRow[];
        const columnNames = new Set(columns.map((column) => column.name));
        if (!columnNames.has("source_size_bytes")) {
          database.exec(
            "ALTER TABLE thread_log_projection_cursors ADD COLUMN source_size_bytes INTEGER",
          );
        }
        if (!columnNames.has("source_modified_at_ms")) {
          database.exec(
            "ALTER TABLE thread_log_projection_cursors ADD COLUMN source_modified_at_ms REAL",
          );
        }
      },
      version: 28,
    },
    {
      name: "team-independent-work-items",
      up: (database) => {
        const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'team_work_items'").get() as DatabaseRow;
        const indexes = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'team_work_items' AND sql IS NOT NULL").all() as DatabaseRow[];
        const columns = (database.prepare("PRAGMA table_info(team_work_items)").all() as DatabaseRow[])
          .map(column => quoteSqliteIdentifier(asString(column, "name"))).join(", ");
        const sql = asString(table, "sql")
          .replace(/^(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)(?:team_work_items|"team_work_items")/iu, "$1team_work_items_independent")
          .replace(/\bproject_id\s+TEXT\s+NOT\s+NULL/iu, "project_id TEXT");
        database.exec(sql);
        database.exec(`INSERT INTO team_work_items_independent (${columns}) SELECT ${columns} FROM team_work_items`);
        database.exec("DROP TABLE team_work_items; ALTER TABLE team_work_items_independent RENAME TO team_work_items;");
        for (const index of indexes) database.exec(asString(index, "sql"));
      },
      version: 29,
    },
    {
      name: "team-role-worker-replicas",
      up: (database) => {
        const table = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'team_member_conversations'").get() as DatabaseRow;
        const indexes = database.prepare("SELECT sql FROM sqlite_master WHERE type = 'index' AND tbl_name = 'team_member_conversations' AND sql IS NOT NULL").all() as DatabaseRow[];
        const sql = asString(table, "sql")
          .replace(/^(CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?)(?:team_member_conversations|"team_member_conversations")/iu, "$1team_member_conversations_replicas")
          .replace(/conversation_id\s+TEXT\s+NOT\s+NULL\s+UNIQUE/iu, "conversation_id TEXT NOT NULL PRIMARY KEY")
          .replace(/,\s*PRIMARY KEY\s*\(team_execution_conversation_id,\s*agent_id\)/iu, "");
        database.exec(sql);
        database.exec("INSERT INTO team_member_conversations_replicas SELECT * FROM team_member_conversations;");
        database.exec("DROP TABLE team_member_conversations; ALTER TABLE team_member_conversations_replicas RENAME TO team_member_conversations;");
        for (const index of indexes) database.exec(asString(index, "sql"));
        database.exec(`CREATE INDEX IF NOT EXISTS team_member_conversations_role ON team_member_conversations(team_execution_conversation_id, agent_id);
            CREATE TABLE IF NOT EXISTS team_instance_worker_counts (
              team_instance_id TEXT NOT NULL REFERENCES team_instances(id) ON DELETE CASCADE,
              agent_id TEXT NOT NULL, worker_count INTEGER NOT NULL CHECK(worker_count BETWEEN 1 AND 8),
              PRIMARY KEY(team_instance_id, agent_id)
            );`);
      },
      version: 30,
    },
    {
      name: "conversation-parallel-queue-mode",
      up: (database) => {
        // JSONL storage recreates this column in the TEMP projection at startup.
        if (isJsonlConversationStorageFinalized()) return;
        const columns = database.prepare("PRAGMA table_info(conversations)").all() as DatabaseRow[];
        if (!columns.some(column => column.name === "coordination_mode")) {
          database.exec("ALTER TABLE conversations ADD COLUMN coordination_mode TEXT NOT NULL DEFAULT 'direct' CHECK(coordination_mode IN ('direct','parallel_queue'));");
        }
      },
      version: 31,
    },
    { name: "task-context-directory-and-team-chat", version: 32,
      up: database => { database.exec(COLLABORATION_SCHEMA); } },
    { name: "team-chat-run-provenance-and-receipts", version: 33, up: database => {
      database.exec("CREATE TABLE IF NOT EXISTS team_chat_run_sources (run_id TEXT NOT NULL, message_id TEXT NOT NULL, PRIMARY KEY(run_id, message_id))");
      const columns = database.prepare("PRAGMA table_info(team_chat_deliveries)").all() as DatabaseRow[];
      if (!columns.some(column => column.name === "receipt_recorded")) database.exec("ALTER TABLE team_chat_deliveries ADD COLUMN receipt_recorded INTEGER NOT NULL DEFAULT 0");
    } },
    { name: "langgraph-versioned-channel-blobs", version: 34,
      up: database => { database.exec(LANGGRAPH_CHECKPOINT_BLOBS_SCHEMA); } },
    { name: "task-completion-policies", version: 35, up: database => {
      database.exec("CREATE TABLE IF NOT EXISTS task_completion_policies (scope_key TEXT PRIMARY KEY, allow_agent_completion INTEGER NOT NULL CHECK(allow_agent_completion IN (0,1)))");
    } },
  ]);
}
