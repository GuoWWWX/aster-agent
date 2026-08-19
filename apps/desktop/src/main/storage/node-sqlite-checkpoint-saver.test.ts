import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Checkpoint, CheckpointMetadata } from "@langchain/langgraph-checkpoint";

import { NodeSqliteCheckpointSaver } from "./node-sqlite-checkpoint-saver.js";

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

    await saver.deleteThread("run-2");
    await expect(saver.getTuple({ configurable: { thread_id: "run-2" } })).resolves.toBeUndefined();
    saver.close();
  });

  it("rejects missing or unsafe thread identifiers", async () => {
    const saver = new NodeSqliteCheckpointSaver(":memory:");
    await expect(saver.getTuple({ configurable: {} })).rejects.toThrow("thread_id");
    await expect(saver.getTuple({ configurable: { thread_id: "" } })).rejects.toThrow();
    saver.close();
  });
});
