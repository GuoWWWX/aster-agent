import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph-checkpoint";

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
