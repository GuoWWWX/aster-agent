import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { constants, deflate, inflate } from "node:zlib";

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
import { LANGGRAPH_CHECKPOINT_BLOBS_SCHEMA } from "./langgraph-checkpoint-schema.js";

type SqliteModule = typeof import("node:sqlite");
type SqliteDatabase = InstanceType<SqliteModule["DatabaseSync"]>;
type DatabaseRow = Record<string, unknown>;
type CheckpointWrite = { operation: () => void; resolve: () => void; reject: (error: unknown) => void };

const requireNodeBuiltin = createRequire(__filename);
const { DatabaseSync } = requireNodeBuiltin("node:sqlite") as SqliteModule;

const MAX_KEY_LENGTH = 512;
const MAX_NAMESPACE_LENGTH = 8_192;
const COMPRESSION_THRESHOLD = 64 * 1024;
const COMPRESSED_TYPE_PREFIX = "deflate:";
const VERSIONED_TYPE_PREFIX = "channels-v1:";
const CHANNEL_REFERENCE_TYPE = "channel-ref-v1";
const compress = promisify(deflate);
const decompress = promisify(inflate);

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
  return safeKey("checkpoint_ns", namespace, true, MAX_NAMESPACE_LENGTH);
}

function safeKey(
  name: string,
  value: string,
  allowEmpty = false,
  maxLength = MAX_KEY_LENGTH,
): string {
  if ((!allowEmpty && value.length === 0) || value.length > maxLength) {
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
  private readonly channelContent = new Map<string, Map<string, { hash: string; version: string }>>();
  private readonly checkpointWrites: CheckpointWrite[] = [];
  private checkpointWriteTimer: NodeJS.Immediate | undefined;

  public constructor(
    databasePath: string,
    options: { initializeSchema?: boolean } = {},
  ) {
    super();
    if (databasePath !== ":memory:") {
      mkdirSync(path.dirname(path.resolve(databasePath)), { recursive: true });
    }
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
    if (databasePath !== ":memory:") this.database.exec("PRAGMA journal_mode = WAL;");
    try {
      if (options.initializeSchema === false) {
        this.assertSchemaExists();
      } else {
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
        {
          name: "langgraph-writes-before-checkpoint",
          up: (database) => {
            database.exec(`
              DROP TABLE IF EXISTS langgraph_checkpoint_writes_v2;
              CREATE TABLE langgraph_checkpoint_writes_v2 (
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
              INSERT INTO langgraph_checkpoint_writes_v2
                (thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx,
                 channel, value_type, value_blob, created_at)
              SELECT thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx,
                     channel, value_type, value_blob, created_at
              FROM langgraph_checkpoint_writes;
              DROP TABLE langgraph_checkpoint_writes;
              ALTER TABLE langgraph_checkpoint_writes_v2 RENAME TO langgraph_checkpoint_writes;
              CREATE INDEX langgraph_checkpoint_writes_order
                ON langgraph_checkpoint_writes(
                  thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx
                );
            `);
          },
          version: 2,
        },
        {
          name: "langgraph-versioned-channel-blobs",
          version: 3,
          up: database => { database.exec(LANGGRAPH_CHECKPOINT_BLOBS_SCHEMA); },
        },
        ]);
      }
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  private assertSchemaExists(): void {
    const rows = this.database.prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN (
         'langgraph_checkpoints', 'langgraph_checkpoint_writes', 'langgraph_checkpoint_blobs'
       )`,
    ).all() as DatabaseRow[];
    const tableNames = new Set(rows.map((row) => asString(row, "name")));
    if (
      !tableNames.has("langgraph_checkpoints")
      || !tableNames.has("langgraph_checkpoint_writes")
      || !tableNames.has("langgraph_checkpoint_blobs")
    ) {
      throw new Error("The unified Aster database is missing LangGraph checkpoint tables.");
    }
  }

  public close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.checkpointWriteTimer !== undefined) clearImmediate(this.checkpointWriteTimer);
    for (const write of this.checkpointWrites.splice(0)) write.reject(new Error("Checkpoint saver is closed."));
    this.channelContent.clear();
    this.database.close();
  }

  /** Concurrent Runs share a durable commit, after giving IPC and timers a turn. */
  private writeCheckpoint(operation: () => void): Promise<void> {
    if (this.closed) return Promise.reject(new Error("Checkpoint saver is closed."));
    return new Promise((resolve, reject) => {
      this.checkpointWrites.push({ operation, resolve, reject });
      this.checkpointWriteTimer ??= setImmediate(() => {
        this.checkpointWriteTimer = undefined;
        const writes = this.checkpointWrites.splice(0);
        const failures = new Map<CheckpointWrite, unknown>();
        try {
          transaction(this.database, () => {
            for (const write of writes) {
              this.database.exec("SAVEPOINT checkpoint_write;");
              try {
                write.operation();
                this.database.exec("RELEASE checkpoint_write;");
              } catch (error) {
                this.database.exec("ROLLBACK TO checkpoint_write; RELEASE checkpoint_write;");
                failures.set(write, error);
              }
            }
          });
        } catch (error) {
          for (const write of writes) write.reject(error);
          return;
        }
        for (const write of writes) {
          if (failures.has(write)) write.reject(failures.get(write));
          else write.resolve();
        }
      });
    });
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
    if (requestedNamespace !== undefined) {
      safeKey("checkpoint_ns", requestedNamespace, true, MAX_NAMESPACE_LENGTH);
    }
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
    const [stored, [metadataType, metadataBlob]] = await Promise.all([
      this.serializeCheckpoint(threadId, namespace, checkpoint),
      this.serialize(metadata),
    ]);
    const parentId = configurableValue(config, "checkpoint_id");
    const now = new Date().toISOString();
    await this.writeCheckpoint(() => {
      const insertBlob = this.database.prepare(
        `INSERT OR IGNORE INTO langgraph_checkpoint_blobs
         (thread_id, checkpoint_ns, channel, version, value_type, value_blob)
         VALUES (?, ?, ?, ?, ?, ?)`,
      );
      for (const blob of stored.blobs) {
        insertBlob.run(threadId, namespace, blob.channel, blob.version, blob.type, blob.value);
      }
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
        `${VERSIONED_TYPE_PREFIX}${stored.type}`,
        stored.value,
        metadataType,
        metadataBlob,
        now,
      );
    });
    const content = this.channelContent.get(threadId) ?? new Map<string, { hash: string; version: string }>();
    for (const blob of stored.blobs) {
      content.set(JSON.stringify([namespace, blob.channel]), { hash: blob.hash, version: blob.sourceVersion });
    }
    this.channelContent.set(threadId, content);
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
      const serialized = await this.serializeChannel(threadId, namespace, channel, value);
      const mappedIndex = WRITES_IDX_MAP[channel] ?? index;
      return { channel, mappedIndex, valueBlob: serialized.value, valueType: serialized.type };
    }));
    await this.writeCheckpoint(() => {
      const statement = this.database.prepare(
        `INSERT INTO langgraph_checkpoint_writes
           (thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx,
            channel, value_type, value_blob, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx) DO UPDATE SET
           channel = excluded.channel,
           value_type = excluded.value_type,
           value_blob = excluded.value_blob,
           created_at = excluded.created_at
         WHERE excluded.write_idx < 0`,
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

  public async deleteThread(threadId: string): Promise<void> {
    const safeThreadId = safeKey("thread_id", threadId);
    await this.writeCheckpoint(() => {
      this.database.prepare("DELETE FROM langgraph_checkpoint_writes WHERE thread_id = ?").run(safeThreadId);
      this.database.prepare("DELETE FROM langgraph_checkpoints WHERE thread_id = ?").run(safeThreadId);
      this.database.prepare("DELETE FROM langgraph_checkpoint_blobs WHERE thread_id = ?").run(safeThreadId);
    });
    this.channelContent.delete(safeThreadId);
  }

  public async deleteThreads(threadIds: readonly string[]): Promise<void> {
    const safeThreadIds = [...new Set(threadIds)].map((threadId) => safeKey("thread_id", threadId));
    if (safeThreadIds.length === 0) return;
    await this.writeCheckpoint(() => {
      const deleteWrites = this.database.prepare(
        "DELETE FROM langgraph_checkpoint_writes WHERE thread_id = ?",
      );
      const deleteCheckpoints = this.database.prepare(
        "DELETE FROM langgraph_checkpoints WHERE thread_id = ?",
      );
      const deleteBlobs = this.database.prepare("DELETE FROM langgraph_checkpoint_blobs WHERE thread_id = ?");
      for (const threadId of safeThreadIds) {
        deleteWrites.run(threadId);
        deleteCheckpoints.run(threadId);
        deleteBlobs.run(threadId);
      }
    });
    for (const threadId of safeThreadIds) this.channelContent.delete(threadId);
  }

  private async toTuple(
    row: DatabaseRow,
    threadId: string,
    namespace: string,
  ): Promise<CheckpointTuple> {
    const checkpointId = safeKey("checkpoint_id", asString(row, "checkpoint_id"));
    const checkpointType = asString(row, "checkpoint_type");
    const versioned = checkpointType.startsWith(VERSIONED_TYPE_PREFIX);
    const checkpoint = await this.deserialize(
      versioned ? checkpointType.slice(VERSIONED_TYPE_PREFIX.length) : checkpointType,
      asBytes(row, "checkpoint_blob"),
    ) as Checkpoint & { _aster_channel_refs?: unknown };
    if (versioned) {
      const references = configurableRecord(checkpoint._aster_channel_refs);
      if (references === undefined) throw new Error("Checkpoint channel references are invalid.");
      const channels = await Promise.all(Object.entries(references).map(async ([channel, version]) => {
        if (typeof version !== "string") throw new Error("Checkpoint channel version is invalid.");
        const blob = this.database.prepare(
          `SELECT value_type, value_blob FROM langgraph_checkpoint_blobs
           WHERE thread_id = ? AND checkpoint_ns = ? AND channel = ? AND version = ?`,
        ).get(threadId, namespace, channel, version) as DatabaseRow | undefined;
        if (blob === undefined) throw new Error("Checkpoint channel data is missing.");
        return [channel, await this.deserializeChannel(threadId, namespace, channel, blob)] as const;
      }));
      checkpoint.channel_values = { ...checkpoint.channel_values, ...Object.fromEntries(channels) };
      delete checkpoint._aster_channel_refs;
    }
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
      await this.deserializeChannel(threadId, namespace, asString(write, "channel"), write),
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
    const [type, bytes] = await this.serde.dumpsTyped(value);
    return this.compressSerialized(type, bytes);
  }

  private async compressSerialized(type: string, bytes: Uint8Array): Promise<[string, Uint8Array]> {
    if (bytes.byteLength < COMPRESSION_THRESHOLD) return [type, bytes];
    // Repeated graph snapshots contain the same history. Compress outside the
    // Main event loop before SQLite journals and copies those pages again.
    const compressed = await compress(bytes, { level: constants.Z_BEST_SPEED });
    return compressed.byteLength < bytes.byteLength
      ? [`${COMPRESSED_TYPE_PREFIX}${type}`, compressed]
      : [type, bytes];
  }

  private async serializeCheckpoint(threadId: string, namespace: string, checkpoint: Checkpoint) {
    const inline = { ...checkpoint.channel_values };
    const references = new Map<string, string>();
    const existing = this.database.prepare(
      `SELECT 1 FROM langgraph_checkpoint_blobs
       WHERE thread_id = ? AND checkpoint_ns = ? AND channel = ? AND version = ?`,
    );
    const candidates = await Promise.all(Object.entries(checkpoint.channel_values).map(async ([channel, value]) => {
      const channelVersion = checkpoint.channel_versions[channel];
      if (channelVersion === undefined) return null;
      const version = JSON.stringify(channelVersion);
      references.set(channel, version);
      delete inline[channel];
      if (existing.get(threadId, namespace, channel, version) !== undefined) return null;
      const serialized = await this.serializeChannel(threadId, namespace, channel, value, version);
      return { channel, version, ...serialized, sourceVersion: serialized.sourceVersion ?? version };
    }));
    const [type, value] = await this.serialize({
      ...checkpoint,
      channel_values: inline,
      _aster_channel_refs: Object.fromEntries(references),
    });
    return { type, value, blobs: candidates.filter(blob => blob !== null) };
  }

  private async serializeChannel(threadId: string, namespace: string, channel: string, value: unknown, version?: string) {
    const [type, bytes] = await this.serde.dumpsTyped(value);
    const hash = createHash("sha256").update(type).update(bytes).digest("hex");
    const known = this.channelContent.get(threadId)?.get(JSON.stringify([namespace, channel]));
    if (known?.hash === hash) {
      return { type: CHANNEL_REFERENCE_TYPE, value: Buffer.from(known.version), hash, sourceVersion: known.version };
    }
    const [storedType, storedBytes] = await this.compressSerialized(type, bytes);
    return { type: storedType, value: storedBytes, hash, sourceVersion: version };
  }

  private async deserializeChannel(threadId: string, namespace: string, channel: string, blob: DatabaseRow): Promise<unknown> {
    if (asString(blob, "value_type") !== CHANNEL_REFERENCE_TYPE) {
      return this.deserialize(asString(blob, "value_type"), asBytes(blob, "value_blob"));
    }
    const source = this.database.prepare(
      `SELECT value_type, value_blob FROM langgraph_checkpoint_blobs
       WHERE thread_id = ? AND checkpoint_ns = ? AND channel = ? AND version = ?`,
    ).get(threadId, namespace, channel, new TextDecoder().decode(asBytes(blob, "value_blob"))) as DatabaseRow | undefined;
    if (source === undefined || asString(source, "value_type") === CHANNEL_REFERENCE_TYPE) {
      throw new Error("Checkpoint channel reference is invalid.");
    }
    return this.deserialize(asString(source, "value_type"), asBytes(source, "value_blob"));
  }

  private async deserialize(type: string, value: Uint8Array): Promise<unknown> {
    if (type.startsWith(COMPRESSED_TYPE_PREFIX)) {
      const bytes = await decompress(value);
      return this.serde.loadsTyped(
        type.slice(COMPRESSED_TYPE_PREFIX.length),
        new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      );
    }
    return this.serde.loadsTyped(type, value);
  }
}
