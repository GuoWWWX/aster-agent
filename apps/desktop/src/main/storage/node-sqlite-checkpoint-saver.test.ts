import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph-checkpoint";
import type { RunnableConfig } from "@langchain/core/runnables";

import { NodeSqliteCheckpointSaver } from "./node-sqlite-checkpoint-saver.js";
import { AgentDatabase } from "./agent-database.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })),
  );
});

function checkpoint(id: string, value: string): Checkpoint {
  return {
    channel_values: { value },
    channel_versions: { value: id },
    id,
    ts: new Date().toISOString(),
    v: 4,
    versions_seen: { node: { value: id } },
  };
}

const metadata: CheckpointMetadata = {
  parents: {},
  source: "loop",
  step: 1,
};

describe("NodeSqliteCheckpointSaver", () => {
  it("yields and shares one durable commit across concurrent recovery writes", async () => {
    const saver = new NodeSqliteCheckpointSaver(":memory:");
    const commits = vi.spyOn(DatabaseSync.prototype, "exec");
    let yielded = false;
    setImmediate(() => { yielded = true; });
    try {
      const configs = await Promise.all(Array.from({ length: 6 }, (_, index) => saver.put(
        { configurable: { thread_id: `parallel-${index}` } },
        checkpoint("00000000000000000000000001", `member-${index}`), metadata, {},
      )));
      expect(yielded).toBe(true);
      expect(commits.mock.calls.filter(([sql]) => sql === "COMMIT;")).toHaveLength(1);
      for (const [index, config] of configs.entries()) {
        expect((await saver.getTuple(config))?.checkpoint.channel_values).toEqual({ value: `member-${index}` });
      }
    } finally {
      commits.mockRestore(); saver.close();
    }
  });

  it("rolls back a rejected member independently of other writes in the same commit", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-parallel-checkpoints-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "checkpoints.sqlite");
    const saver = new NodeSqliteCheckpointSaver(databasePath);
    const raw = new DatabaseSync(databasePath);
    raw.exec("CREATE TRIGGER reject_member BEFORE INSERT ON langgraph_checkpoints WHEN NEW.thread_id = 'bad' BEGIN SELECT RAISE(ABORT, 'member rejected'); END;");
    const outcomes = await Promise.allSettled(["first", "bad", "last"].map(thread_id => saver.put(
      { configurable: { thread_id } }, checkpoint("00000000000000000000000001", thread_id), metadata, {},
    )));
    expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    expect(raw.prepare("SELECT count(*) AS count FROM langgraph_checkpoint_blobs WHERE thread_id = 'bad'").get()?.count).toBe(0);
    raw.close(); saver.close();
    const reopened = new NodeSqliteCheckpointSaver(databasePath);
    for (const thread_id of ["first", "last"]) {
      expect((await reopened.getTuple({ configurable: { thread_id } }))?.checkpoint.channel_values).toEqual({ value: thread_id });
    }
    reopened.close();
  });

  it("rejects an uncommitted batch when the saver closes", async () => {
    const saver = new NodeSqliteCheckpointSaver(":memory:");
    const pending = saver.put({ configurable: { thread_id: "closing" } }, checkpoint("1", "value"), metadata, {});
    const outcome = expect(pending).rejects.toThrow();
    // Serialization completes in microtasks; the durable batch is still queued.
    for (let index = 0; index < 20; index += 1) await Promise.resolve();
    saver.close();
    await outcome;
  });

  it("uses checkpoint tables created by the unified Aster database migration", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-unified-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "db.sqlite");
    const database = new AgentDatabase(databasePath);
    const saver = new NodeSqliteCheckpointSaver(databasePath, { initializeSchema: false });

    await saver.put(
      { configurable: { checkpoint_ns: "", thread_id: "unified-thread" } },
      checkpoint("00000000000000000000000001", "unified"),
      {} as CheckpointMetadata,
      {},
    );

    expect((await saver.getTuple({
      configurable: { checkpoint_ns: "", thread_id: "unified-thread" },
    }))?.checkpoint.channel_values).toEqual({ value: "unified" });
    saver.close();
    database.close();
  });

  it("persists checkpoints and pending writes across a reopen", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-langgraph-saver-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "checkpoints.sqlite");
    const first = new NodeSqliteCheckpointSaver(databasePath);
    const config = await first.put(
      { configurable: { thread_id: "run-1" } },
      checkpoint("00000000000000000000000001", "first"),
      metadata,
      { value: 1 },
    );
    await first.putWrites(config, [["value", { result: "pending" }]], "task-1");
    first.close();

    const reopened = new NodeSqliteCheckpointSaver(databasePath);
    const tuple = await reopened.getTuple({ configurable: { thread_id: "run-1" } });
    expect(tuple?.checkpoint.channel_values).toEqual({ value: "first" });
    expect(tuple?.pendingWrites).toEqual([["task-1", "value", { result: "pending" }]]);
    reopened.close();
  });

  it("stores large recovery state compactly and restores mixed old and new checkpoints", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-compact-checkpoints-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "checkpoints.sqlite");
    const saver = new NodeSqliteCheckpointSaver(databasePath);
    const legacy = await saver.put(
      { configurable: { thread_id: "large-run" } },
      checkpoint("00000000000000000000000001", "old uncompressed state"),
      metadata,
      {},
    );
    const history = "Previously completed conversation and tool output.\n".repeat(30_000);
    const config = await saver.put(
      legacy,
      checkpoint("00000000000000000000000002", history),
      { ...metadata, step: 2 },
      { value: 2 },
    );
    await saver.putWrites(config, [["tool-result", { output: history }]], "large-tool");
    saver.close();

    const raw = new DatabaseSync(databasePath);
    const checkpointBytes = raw.prepare(
      "SELECT length(checkpoint_blob) AS bytes FROM langgraph_checkpoints WHERE checkpoint_id = ?",
    ).get("00000000000000000000000002")?.bytes;
    const pendingBytes = raw.prepare(
      "SELECT length(value_blob) AS bytes FROM langgraph_checkpoint_writes WHERE task_id = ?",
    ).get("large-tool")?.bytes;
    raw.close();
    expect(checkpointBytes).toBeLessThan(Buffer.byteLength(history) / 10);
    expect(pendingBytes).toBeLessThan(Buffer.byteLength(history) / 10);

    const reopened = new NodeSqliteCheckpointSaver(databasePath);
    expect((await reopened.getTuple(legacy))?.checkpoint.channel_values).toEqual({ value: "old uncompressed state" });
    const restored = await reopened.getTuple(config);
    expect(restored?.checkpoint.channel_values).toEqual({ value: history });
    expect(restored?.pendingWrites).toEqual([["large-tool", "tool-result", { output: history }]]);
    const filtered = [];
    for await (const tuple of reopened.list({ configurable: { thread_id: "large-run" } }, { filter: { step: 2 } })) {
      filtered.push(tuple);
    }
    expect(filtered).toHaveLength(1);
    expect(filtered[0]?.checkpoint.channel_values).toEqual({ value: history });
    await reopened.deleteThread("large-run");
    expect(await reopened.getTuple(config)).toBeUndefined();
    reopened.close();
  });

  it("restores binary pending writes without converting them to JSON", async () => {
    const saver = new NodeSqliteCheckpointSaver(":memory:");
    const config = await saver.put(
      { configurable: { thread_id: "binary-run" } },
      checkpoint("00000000000000000000000001", "ready"),
      metadata,
      {},
    );
    const bytes = new Uint8Array(128_000).fill(42);
    await saver.putWrites(config, [["binary", bytes]], "binary-task");
    expect((await saver.getTuple(config))?.pendingWrites).toEqual([["binary-task", "binary", bytes]]);
    saver.close();
  });

  it("reuses unchanged channel versions while preserving each recoverable checkpoint", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-versioned-checkpoints-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "checkpoints.sqlite");
    const saver = new NodeSqliteCheckpointSaver(databasePath);
    const history = "Stable conversation history\n".repeat(40_000);
    let config: RunnableConfig = { configurable: { thread_id: "versioned-run" } };
    for (let step = 1; step <= 12; step += 1) {
      config = await saver.put(config, {
        ...checkpoint(String(step).padStart(26, "0"), history),
        channel_values: { value: history, step },
        channel_versions: { value: step, step },
      }, { ...metadata, step }, step === 1 ? { value: 1, step } : { step });
    }
    await saver.putWrites(config, [["value", history]], "repeated-history");
    saver.close();
    const raw = new DatabaseSync(databasePath);
    const historyVersions = raw.prepare(
      "SELECT count(*) AS count FROM langgraph_checkpoint_blobs WHERE thread_id=? AND channel=? AND value_type <> 'channel-ref-v1'",
    ).get("versioned-run", "value")?.count;
    const manifestBytes = raw.prepare("SELECT sum(length(checkpoint_blob)) AS bytes FROM langgraph_checkpoints").get()?.bytes;
    const pendingBytes = raw.prepare("SELECT length(value_blob) AS bytes FROM langgraph_checkpoint_writes WHERE task_id='repeated-history'").get()?.bytes;
    raw.close();
    expect(historyVersions).toBe(1);
    expect(manifestBytes).toBeLessThan(16_384);
    expect(pendingBytes).toBeLessThan(128);
    const reopened = new NodeSqliteCheckpointSaver(databasePath);
    const restored = [];
    for await (const tuple of reopened.list({ configurable: { thread_id: "versioned-run" } })) restored.push(tuple);
    expect(restored).toHaveLength(12);
    expect(restored[0]?.pendingWrites).toEqual([["repeated-history", "value", history]]);
    expect(restored.map(tuple => tuple.checkpoint.channel_values)).toEqual(
      Array.from({ length: 12 }, (_, index) => ({ value: history, step: 12 - index })),
    );
    await reopened.deleteThread("versioned-run");
    reopened.close();
    const cleaned = new DatabaseSync(databasePath);
    const remaining = cleaned.prepare("SELECT count(*) AS count FROM langgraph_checkpoint_blobs").get()?.count;
    cleaned.close();
    expect(remaining).toBe(0);
  });

  it("rolls back channel data with a failed checkpoint and permits a clean retry", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-checkpoint-rollback-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "checkpoints.sqlite");
    const saver = new NodeSqliteCheckpointSaver(databasePath);
    const raw = new DatabaseSync(databasePath);
    raw.exec("CREATE TRIGGER reject_checkpoint BEFORE INSERT ON langgraph_checkpoints BEGIN SELECT RAISE(ABORT, 'test checkpoint rejection'); END;");
    const config = { configurable: { thread_id: "rollback-run" } };
    const state = checkpoint("00000000000000000000000001", "recoverable history");
    await expect(saver.put(config, state, metadata, {})).rejects.toThrow("test checkpoint rejection");
    expect(raw.prepare("SELECT count(*) AS count FROM langgraph_checkpoint_blobs").get()?.count).toBe(0);
    raw.exec("DROP TRIGGER reject_checkpoint;");
    await saver.put(config, state, metadata, {});
    expect((await saver.getTuple(config))?.checkpoint.channel_values).toEqual(state.channel_values);
    raw.close();
    saver.close();
  });

  it("accepts pending writes before LangGraph persists their checkpoint", async () => {
    const saver = new NodeSqliteCheckpointSaver(":memory:");
    const config = {
      configurable: {
        checkpoint_id: "00000000000000000000000001",
        checkpoint_ns: "",
        thread_id: "interrupt-run",
      },
    };

    await expect(saver.putWrites(
      config,
      [["__interrupt__", { reason: "approval" }]],
      "approval-task",
    )).resolves.toBeUndefined();
    await saver.put(
      { configurable: { thread_id: "interrupt-run" } },
      checkpoint("00000000000000000000000001", "waiting"),
      metadata,
      { value: 1 },
    );

    await expect(saver.getTuple(config)).resolves.toMatchObject({
      pendingWrites: [["approval-task", "__interrupt__", { reason: "approval" }]],
    });
    saver.close();
  });

  it("upgrades unified v33 storage without rewriting legacy checkpoint payloads", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-checkpoint-upgrade-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "db.sqlite");
    const current = new AgentDatabase(databasePath);
    current.close();
    const old = new DatabaseSync(databasePath);
    old.exec("DROP TABLE langgraph_checkpoint_blobs; DROP TABLE task_completion_policies; DELETE FROM schema_migrations WHERE version>=34;");
    old.prepare("INSERT INTO langgraph_checkpoints VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(
      "legacy-run", "", "00000000000000000000000001", null,
      "json", Buffer.from(JSON.stringify(checkpoint("00000000000000000000000001", "preserved history"))),
      "json", Buffer.from(JSON.stringify(metadata)), new Date().toISOString(),
    );
    old.close();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const database = new AgentDatabase(databasePath);
      const saver = new NodeSqliteCheckpointSaver(databasePath, { initializeSchema: false });
      expect((await saver.getTuple({ configurable: { thread_id: "legacy-run" } }))?.checkpoint.channel_values)
        .toEqual({ value: "preserved history" });
      saver.close();
      database.close();
    }
  });

  it("imports versioned standalone checkpoints with their channel blobs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-versioned-import-"));
    temporaryDirectories.push(directory);
    const legacyPath = path.join(directory, "checkpoints.sqlite");
    const legacy = new NodeSqliteCheckpointSaver(legacyPath);
    const config = await legacy.put({ configurable: { thread_id: "imported-run" } },
      checkpoint("00000000000000000000000001", "original context"), metadata, {});
    legacy.close();
    const databasePath = path.join(directory, "db.sqlite");
    const database = new AgentDatabase(databasePath);
    database.importLegacyCheckpointDatabases([legacyPath]);
    database.importLegacyCheckpointDatabases([legacyPath]);
    const saver = new NodeSqliteCheckpointSaver(databasePath, { initializeSchema: false });
    expect((await saver.getTuple(config))?.checkpoint.channel_values).toEqual({ value: "original context" });
    saver.close();
    database.close();
  });

  it("replaces LangGraph special writes when the same task resumes again", async () => {
    const saver = new NodeSqliteCheckpointSaver(":memory:");
    const config = await saver.put(
      { configurable: { thread_id: "approval-resume-run" } },
      checkpoint("00000000000000000000000001", "waiting"),
      metadata,
      { value: 1 },
    );

    await saver.putWrites(config, [["__resume__", false]], "approval-task");
    await saver.putWrites(config, [["__resume__", true]], "approval-task");

    await expect(saver.getTuple(config)).resolves.toMatchObject({
      pendingWrites: [["approval-task", "__resume__", true]],
    });
    saver.close();
  });

  it("migrates the v1 writes table so interrupts can be stored before checkpoints", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-langgraph-saver-v1-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "checkpoints.sqlite");
    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      PRAGMA foreign_keys = ON;
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (1, 'langgraph-checkpoint-v1', '2026-09-05T00:00:00.000Z');
      CREATE TABLE langgraph_checkpoints (
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
      CREATE INDEX langgraph_checkpoints_thread_order
        ON langgraph_checkpoints(thread_id, checkpoint_ns, checkpoint_id DESC);
      CREATE TABLE langgraph_checkpoint_writes (
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
      CREATE INDEX langgraph_checkpoint_writes_order
        ON langgraph_checkpoint_writes(
          thread_id, checkpoint_ns, checkpoint_id, task_id, write_idx
        );
    `);
    legacy.close();

    const saver = new NodeSqliteCheckpointSaver(databasePath);
    await expect(saver.putWrites({
      configurable: {
        checkpoint_id: "00000000000000000000000002",
        checkpoint_ns: "",
        thread_id: "migrated-interrupt-run",
      },
    }, [["__interrupt__", true]], "approval-task")).resolves.toBeUndefined();
    saver.close();

    const migrated = new DatabaseSync(databasePath);
    expect(migrated.prepare(
      "SELECT version, name FROM schema_migrations ORDER BY version",
    ).all()).toEqual([
      { name: "langgraph-checkpoint-v1", version: 1 },
      { name: "langgraph-writes-before-checkpoint", version: 2 },
      { name: "langgraph-versioned-channel-blobs", version: 3 },
    ]);
    expect(migrated.prepare("PRAGMA foreign_key_list(langgraph_checkpoint_writes)").all())
      .toEqual([]);
    migrated.close();
  });

  it("lists newest checkpoints, applies filters, and deletes a whole thread", async () => {
    const saver = new NodeSqliteCheckpointSaver(":memory:");
    await saver.put(
      { configurable: { thread_id: "run-2" } },
      checkpoint("00000000000000000000000001", "first"),
      { ...metadata, step: 1 },
      {},
    );
    await saver.put(
      { configurable: { thread_id: "run-2", checkpoint_id: "00000000000000000000000001" } },
      checkpoint("00000000000000000000000002", "second"),
      { ...metadata, step: 2 },
      {},
    );
    const listed = [];
    for await (const tuple of saver.list(
      { configurable: { thread_id: "run-2" } },
      { filter: { step: 2 } },
    )) listed.push(tuple);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.checkpoint.channel_values).toEqual({ value: "second" });

    await saver.putWrites(
      {
        configurable: {
          checkpoint_id: "00000000000000000000000002",
          thread_id: "run-2",
        },
      },
      [["tool-result", "stale"]],
      "tool-task",
    );

    await saver.deleteThread("run-2");
    await expect(saver.getTuple({ configurable: { thread_id: "run-2" } })).resolves.toBeUndefined();

    const recreated = await saver.put(
      { configurable: { thread_id: "run-2" } },
      checkpoint("00000000000000000000000002", "recreated"),
      metadata,
      {},
    );
    await expect(saver.getTuple(recreated)).resolves.not.toHaveProperty("pendingWrites");
    saver.close();
  });

  it("rejects missing or unsafe thread identifiers", async () => {
    const saver = new NodeSqliteCheckpointSaver(":memory:");
    await expect(saver.getTuple({ configurable: {} })).rejects.toThrow("thread_id");
    await expect(saver.getTuple({ configurable: { thread_id: "" } })).rejects.toThrow();
    saver.close();
  });

  it("accepts nested LangGraph checkpoint namespaces longer than ordinary identifiers", async () => {
    const saver = new NodeSqliteCheckpointSaver(":memory:");
    const namespace = Array.from(
      { length: 12 },
      (_, index) => `middleware-${index}:00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
    ).join("|");
    expect(namespace.length).toBeGreaterThan(512);

    const config = await saver.put(
      { configurable: { checkpoint_ns: namespace, thread_id: "nested-run" } },
      checkpoint("00000000000000000000000001", "nested"),
      metadata,
      {},
    );

    await expect(saver.getTuple(config)).resolves.toMatchObject({
      checkpoint: { channel_values: { value: "nested" } },
    });
    await expect(saver.getTuple({
      configurable: { checkpoint_ns: "x".repeat(8_193), thread_id: "nested-run" },
    })).rejects.toThrow("checkpoint_ns");
    saver.close();
  });
});
