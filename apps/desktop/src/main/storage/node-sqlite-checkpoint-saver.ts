import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";

import {
  BaseCheckpointSaver,
  WRITES_IDX_MAP,
  getCheckpointId,
  type ChannelVersions,
  type Checkpoint,
  type CheckpointListOptions,
  type CheckpointMetadata,
  type CheckpointTuple,
  type PendingWrite,
} from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

import { DatabaseMigrationRunner } from "./database-migration-runner.js";

type SqliteModule = typeof import("node:sqlite");
type SqliteDatabase = InstanceType<SqliteModule["DatabaseSync"]>;
type DatabaseRow = Record<string, unknown>;

const requireNodeBuiltin = createRequire(__filename);
const { DatabaseSync } = requireNodeBuiltin("node:sqlite") as SqliteModule;

const MAX_KEY_LENGTH = 512;

function asString(row: DatabaseRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`Checkpoint column ${key} is invalid.`);
  return value;
}

function asNullableString(row: DatabaseRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Checkpoint column ${key} is invalid.`);
  return value;
}

function asBytes(row: DatabaseRow, key: string): Uint8Array {
  const value = row[key];
  if (value instanceof Uint8Array) return new Uint8Array(value);
  throw new Error(`Checkpoint column ${key} is not a blob.`);
}

function configurableRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
  return value as Record<string, unknown>;
}

function configurableValue(config: RunnableConfig, key: string): string | undefined {
  const value = configurableRecord(config.configurable)?.[key];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Checkpoint config ${key} must be a string.`);
  return value;
}

function requiredThreadId(config: RunnableConfig): string {
  const threadId = configurableValue(config, "thread_id");
  if (threadId === undefined || threadId.length === 0) {
    throw new Error("LangGraph Checkpoint requires configurable.thread_id.");
  }
  return safeKey("thread_id", threadId);
}

function checkpointNamespace(config: RunnableConfig): string {
  const namespace = configurableValue(config, "checkpoint_ns") ?? "";
  return safeKey("checkpoint_ns", namespace, true);
}

function safeKey(name: string, value: string, allowEmpty = false): string {
  if ((!allowEmpty && value.length === 0) || value.length > MAX_KEY_LENGTH) {
    throw new Error(`Checkpoint ${name} is empty or too long.`);
  }
  return value;
}

function checkpointConfig(
  threadId: string,
  namespace: string,
  checkpointId: string,
): RunnableConfig {
  return {
    configurable: {
      checkpoint_id: checkpointId,
      checkpoint_ns: namespace,
      thread_id: threadId,
    },
  };
}

function parentConfig(
  row: DatabaseRow,
  threadId: string,
  namespace: string,
): RunnableConfig | undefined {
  const parentId = asNullableString(row, "parent_checkpoint_id");
  return parentId === undefined
    ? undefined
    : checkpointConfig(threadId, namespace, safeKey("parent_checkpoint_id", parentId));
}

function transaction(database: SqliteDatabase, operation: () => void): void {
  database.exec("BEGIN IMMEDIATE;");
  try {
    operation();
    database.exec("COMMIT;");
  } catch (error) {
    try {
      database.exec("ROLLBACK;");
    } catch (rollbackError) {
      throw new Error("LangGraph Checkpoint transaction could not be rolled back.", {
        cause: rollbackError,
      });
    }
    throw error;
  }
}

/** A node:sqlite-backed LangGraph saver that avoids native better-sqlite3 bindings. */
export class NodeSqliteCheckpointSaver extends BaseCheckpointSaver {
  private readonly database: SqliteDatabase;

  private closed = false;

  public constructor(databasePath: string) {
    super();
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
    if (databasePath !== ":memory:") this.database.exec("PRAGMA journal_mode = WAL;");
    try {
      new DatabaseMigrationRunner(this.database).run([
        {
          name: "langgraph-checkpoint-v1",
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
                PRIMARY KEY (thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx),
                FOREIGN KEY (thread_id, checkpoint_ns, checkpoint_id)
                  REFERENCES langgraph_checkpoints(thread_id, checkpoint_ns, checkpoint_id)
                  ON DELETE CASCADE
              );
              CREATE INDEX IF NOT EXISTS langgraph_checkpoint_writes_order
                ON langgraph_checkpoint_writes(thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx);
            `);
          },
          version: 1,
        },
      ]);
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }

  public async getTuple(config: RunnableConfig): Promise<CheckpointTuple | undefined> {
    const threadId = requiredThreadId(config);
    const namespace = checkpointNamespace(config);
    const requestedId = getCheckpointId(config);
    const row = requestedId.length > 0
      ? this.database.prepare(
        `SELECT * FROM langgraph_checkpoints
         WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?`,
      ).get(threadId, namespace, safeKey("checkpoint_id", requestedId)) as DatabaseRow | undefined
      : this.database.prepare(
        `SELECT * FROM langgraph_checkpoints
         WHERE thread_id = ? AND checkpoint_ns = ?
         ORDER BY checkpoint_id DESC LIMIT 1`,
      ).get(threadId, namespace) as DatabaseRow | undefined;
    if (row === undefined) return undefined;
    return this.toTuple(row, threadId, namespace);
  }

  public async *list(
    config: RunnableConfig,
    options: CheckpointListOptions = {},
  ): AsyncGenerator<CheckpointTuple> {
    const requestedThreadId = configurableValue(config, "thread_id");
    const requestedNamespace = configurableValue(config, "checkpoint_ns");
    const requestedCheckpointId = configurableValue(config, "checkpoint_id");
    if (requestedThreadId !== undefined) safeKey("thread_id", requestedThreadId);
    if (requestedNamespace !== undefined) safeKey("checkpoint_ns", requestedNamespace, true);
    if (requestedCheckpointId !== undefined) safeKey("checkpoint_id", requestedCheckpointId);
    const beforeId = options.before === undefined
      ? undefined
      : configurableValue(options.before, "checkpoint_id");
    if (beforeId !== undefined) {
      if (typeof beforeId !== "string") throw new Error("Checkpoint before ID must be a string.");
      safeKey("before_checkpoint_id", beforeId);
    }

    const conditions: string[] = [];
    const values: string[] = [];
    if (requestedThreadId !== undefined) {
      conditions.push("thread_id = ?");
      values.push(requestedThreadId);
    }
    if (requestedNamespace !== undefined) {
      conditions.push("checkpoint_ns = ?");
      values.push(requestedNamespace);
    }
    if (requestedCheckpointId !== undefined) {
      conditions.push("checkpoint_id = ?");
      values.push(requestedCheckpointId);
    }
    if (beforeId !== undefined) {
      conditions.push("checkpoint_id < ?");
      values.push(beforeId);
    }
    const where = conditions.length === 0 ? "" : `WHERE ${conditions.join(" AND ")}`;
    const rows = this.database.prepare(
      `SELECT * FROM langgraph_checkpoints ${where} ORDER BY checkpoint_id DESC`,
    ).all(...values) as DatabaseRow[];
    let remaining = options.limit;
    for (const row of rows) {
      if (remaining !== undefined && remaining <= 0) break;
      const metadata = await this.deserialize(asString(row, "metadata_type"), asBytes(row, "metadata_blob")) as CheckpointMetadata;
      const metadataRecord = metadata as unknown as Record<string, unknown>;
      if (options.filter !== undefined && !Object.entries(options.filter).every(([key, value]) => metadataRecord[key] === value)) {
        continue;
      }
      yield await this.toTuple(row, asString(row, "thread_id"), asString(row, "checkpoint_ns"));
      if (remaining !== undefined) remaining -= 1;
    }
  }

  public async put(
    config: RunnableConfig,
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
    _newVersions: ChannelVersions,
  ): Promise<RunnableConfig> {
    void _newVersions;
    const threadId = requiredThreadId(config);
    const namespace = checkpointNamespace(config);
    const checkpointId = safeKey("checkpoint_id", checkpoint.id);
    const [[checkpointType, checkpointBlob], [metadataType, metadataBlob]] = await Promise.all([
      this.serialize(checkpoint),
      this.serialize(metadata),
    ]);
    const parentId = configurableValue(config, "checkpoint_id");
    const now = new Date().toISOString();
    transaction(this.database, () => {
      this.database.prepare(
        `INSERT INTO langgraph_checkpoints
           (thread_id, checkpoint_ns, checkpoint_id, parent_checkpoint_id,
            checkpoint_type, checkpoint_blob, metadata_type, metadata_blob, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id) DO UPDATE SET
           parent_checkpoint_id = excluded.parent_checkpoint_id,
           checkpoint_type = excluded.checkpoint_type,
           checkpoint_blob = excluded.checkpoint_blob,
           metadata_type = excluded.metadata_type,
           metadata_blob = excluded.metadata_blob,
           created_at = excluded.created_at`,
      ).run(
        threadId,
        namespace,
        checkpointId,
        parentId === undefined ? null : safeKey("parent_checkpoint_id", parentId),
        checkpointType,
        checkpointBlob,
        metadataType,
        metadataBlob,
        now,
      );
    });
    return checkpointConfig(threadId, namespace, checkpointId);
  }

  public async putWrites(
    config: RunnableConfig,
    writes: PendingWrite[],
    taskId: string,
  ): Promise<void> {
    const threadId = requiredThreadId(config);
    const namespace = checkpointNamespace(config);
    const checkpointId = configurableValue(config, "checkpoint_id");
    if (checkpointId === undefined) throw new Error("LangGraph writes require checkpoint_id.");
    safeKey("checkpoint_id", checkpointId);
    safeKey("task_id", taskId);
    const serialized = await Promise.all(writes.map(async ([channel, value], index) => {
      const [valueType, valueBlob] = await this.serialize(value);
      const mappedIndex = WRITES_IDX_MAP[channel] ?? index;
      return { channel, mappedIndex, valueBlob, valueType };
    }));
    transaction(this.database, () => {
      const statement = this.database.prepare(
        `INSERT INTO langgraph_checkpoint_writes
           (thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx,
            channel, value_type, value_blob, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx) DO NOTHING`,
      );
      const now = new Date().toISOString();
      for (const write of serialized) {
        statement.run(
          threadId,
          namespace,
          checkpointId,
          taskId,
          write.mappedIndex,
          write.channel,
          write.valueType,
          write.valueBlob,
          now,
        );
      }
    });
  }

  public deleteThread(threadId: string): Promise<void> {
    const safeThreadId = safeKey("thread_id", threadId);
    transaction(this.database, () => {
      this.database.prepare("DELETE FROM langgraph_checkpoints WHERE thread_id = ?").run(safeThreadId);
    });
    return Promise.resolve();
  }

  public deleteThreads(threadIds: readonly string[]): Promise<void> {
    const safeThreadIds = [...new Set(threadIds)].map((threadId) => safeKey("thread_id", threadId));
    if (safeThreadIds.length === 0) return Promise.resolve();
    transaction(this.database, () => {
      const statement = this.database.prepare("DELETE FROM langgraph_checkpoints WHERE thread_id = ?");
      for (const threadId of safeThreadIds) statement.run(threadId);
    });
    return Promise.resolve();
  }

  private async toTuple(
    row: DatabaseRow,
    threadId: string,
    namespace: string,
  ): Promise<CheckpointTuple> {
    const checkpointId = safeKey("checkpoint_id", asString(row, "checkpoint_id"));
    const checkpoint = await this.deserialize(
      asString(row, "checkpoint_type"),
      asBytes(row, "checkpoint_blob"),
    ) as Checkpoint;
    const metadata = await this.deserialize(
      asString(row, "metadata_type"),
      asBytes(row, "metadata_blob"),
    ) as CheckpointMetadata;
    const writes = this.database.prepare(
      `SELECT task_id, channel, value_type, value_blob
       FROM langgraph_checkpoint_writes
       WHERE thread_id = ? AND checkpoint_ns = ? AND checkpoint_id = ?
       ORDER BY task_id ASC, write_idx ASC`,
    ).all(threadId, namespace, checkpointId) as DatabaseRow[];
    const pendingWrites = await Promise.all(writes.map(async (write) => [
      asString(write, "task_id"),
      asString(write, "channel"),
      await this.deserialize(asString(write, "value_type"), asBytes(write, "value_blob")),
    ] as [string, string, unknown]));
    const parent = parentConfig(row, threadId, namespace);
    return {
      config: checkpointConfig(threadId, namespace, checkpointId),
      checkpoint,
      metadata,
      ...(parent === undefined ? {} : { parentConfig: parent }),
      ...(pendingWrites.length === 0 ? {} : { pendingWrites }),
    };
  }

  private async serialize(value: unknown): Promise<[string, Uint8Array]> {
    return this.serde.dumpsTyped(value);
  }

  private async deserialize(type: string, value: Uint8Array): Promise<unknown> {
    return this.serde.loadsTyped(type, value);
  }
}
