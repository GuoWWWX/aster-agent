import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, expect, it } from "vitest";
import { ThreadLog } from "./thread-log.js";
import { ThreadLogReader } from "./thread-log-reader.js";
import { ThreadLogTimeline } from "./thread-log-timeline.js";
import { restoreThreadLogReadIndexes } from "./thread-log-read-index.js";

let directory: string, workerPath: string;
beforeAll(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "conversation-reader-"));
  workerPath = path.join(directory, "worker.cjs");
  await build({ entryPoints: [fileURLToPath(new URL("./thread-log-reader-worker.ts", import.meta.url))], outfile: workerPath,
    platform: "node", format: "cjs", bundle: true,
    alias: { "@agent/protocol": fileURLToPath(new URL("../../../../../packages/protocol/src/index.ts", import.meta.url)) } });
});
afterAll(async () => { await rm(directory, { recursive: true, force: true }); });

it("keeps the event loop responsive, deduplicates reads, and transfers indexes without message bodies", async () => {
  const log = new ThreadLog(path.join(directory, "history"));
  const id = randomUUID(), runId = randomUUID();
  for (let i = 0; i < 440; i++) log.append(id, { type: "user_message", payload: { messageId: randomUUID(), runId, content: `private-body-${i}:` + "x".repeat(190_000) } });
  log.append(id, { type: "context_checkpoint", payload: { summary: "Earlier messages", coveredThroughContextSequence: 439 } });
  const reader = new ThreadLogReader(workerPath);
  let ticks = 0;
  const heartbeat = setInterval(() => ticks++, 5);
  try {
    const first = reader.read(log, id);
    expect(reader.read(log, id)).toBe(first);
    const snapshot = await first;
    expect(ticks).toBeGreaterThan(1);
    expect(JSON.stringify(snapshot)).not.toContain("private-body");
    const timeline = new ThreadLogTimeline(log);
    expect(restoreThreadLogReadIndexes(log, timeline, id, snapshot!)).toBe(true);
    const context = log.readUncoveredContext(id);
    expect(context?.messages).toHaveLength(1);
    expect(context?.messages.at(-1)?.content).toContain("private-body-439:");
    expect(timeline.page({ conversationId: id, limit: 20 }).items).toHaveLength(20);
  } finally { clearInterval(heartbeat); await reader.dispose(); }
}, 15_000);

it("settles active and queued reads on shutdown, rejects new reads and releases the worker", async () => {
  const log = new ThreadLog(path.join(directory, "shutdown"));
  const ids = [randomUUID(), randomUUID()];
  for (const id of ids) log.append(id, { type: "user_message", payload: { messageId: randomUUID(), runId: randomUUID(), content: "message" } });
  const reader = new ThreadLogReader(workerPath);
  const outcomes = Promise.allSettled(ids.map(id => reader.read(log, id)));
  await reader.dispose();
  expect((await outcomes).map(result => result.status)).toEqual(["rejected", "rejected"]);
  await expect(reader.read(log, ids[0]!)).rejects.toThrow("stopped");
});
