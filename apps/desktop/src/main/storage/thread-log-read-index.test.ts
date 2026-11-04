import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm, appendFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ThreadLog } from "./thread-log.js";
import { ThreadLogTimeline } from "./thread-log-timeline.js";
import { buildThreadLogReadIndexes, restoreThreadLogReadIndexes } from "./thread-log-read-index.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true }))); });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "read-index-"));
  directories.push(directory);
  const log = new ThreadLog(directory);
  const id = randomUUID(), runId = randomUUID();
  for (let i = 0; i < 300; i++) log.append(id, { type: "user_message", payload: { messageId: randomUUID(), runId, content: `message ${i}` } });
  return { directory, log, id, runId };
}

it("builds both indexes in one scan and restores complete pages and model history without rescanning bodies", async () => {
  const { directory, log, id } = await fixture();
  const reader = new ThreadLog(directory, { readOnly: true });
  const scan = vi.spyOn(reader, "scan");
  const snapshot = buildThreadLogReadIndexes(reader, id);
  expect(snapshot).not.toBeNull();
  expect(scan).toHaveBeenCalledTimes(1);
  const timeline = new ThreadLogTimeline(log);
  expect(restoreThreadLogReadIndexes(log, timeline, id, snapshot!)).toBe(true);
  const reread = vi.spyOn(log, "scan");
  expect(timeline.page({ conversationId: id, limit: 20 }).items).toHaveLength(20);
  expect(log.readUncoveredContext(id)?.messages).toHaveLength(300);
  expect(reread.mock.calls.every(call => call[2]?.sequence === 300)).toBe(true);
});

it("rejects a stale snapshot and keeps append, replacement and compression semantics", async () => {
  const { directory, log, id, runId } = await fixture();
  const snapshot = buildThreadLogReadIndexes(new ThreadLog(directory, { readOnly: true }), id)!;
  log.append(id, { type: "run_superseded", payload: { runId } });
  const timeline = new ThreadLogTimeline(log);
  expect(restoreThreadLogReadIndexes(log, timeline, id, snapshot)).toBe(false);
  const latest = buildThreadLogReadIndexes(new ThreadLog(directory, { readOnly: true }), id)!;
  expect(restoreThreadLogReadIndexes(log, timeline, id, latest)).toBe(true);
  expect(timeline.page({ conversationId: id, limit: 20 }).items).toEqual([]);
  expect(log.readUncoveredContext(id)?.messages).toEqual([]);
  log.append(id, { type: "user_message", payload: { messageId: randomUUID(), runId: randomUUID(), content: "new" } });
  expect(log.readUncoveredContext(id)?.messages[0]?.content).toBe("new");
});

it("never repairs or migrates files in a read-only worker", async () => {
  const { directory, log, id } = await fixture();
  await appendFile(log.getPath(id), '{"broken":');
  const before = await readFile(log.getPath(id));
  const reader = new ThreadLog(directory, { readOnly: true });
  expect(() => buildThreadLogReadIndexes(reader, id)).toThrow();
  expect(() => reader.append(id, { type: "user_message", payload: { content: "No write" } })).toThrow("Read-only");
  expect(() => reader.quarantine(id)).toThrow("Read-only");
  await expect(reader.deleteConversations([id])).rejects.toThrow("Read-only");
  expect(await readFile(log.getPath(id))).toEqual(before);
});

it("appends after loading without a synchronous scan to find the last sequence", async () => {
  const { directory, id } = await fixture();
  const snapshot = buildThreadLogReadIndexes(new ThreadLog(directory, { readOnly: true }), id)!;
  const main = new ThreadLog(directory);
  expect(restoreThreadLogReadIndexes(main, new ThreadLogTimeline(main), id, snapshot)).toBe(true);
  const scan = vi.spyOn(main, "scan");
  const event = main.append(id, { type: "user_message", payload: { content: "New message" } });
  expect(event.sequence).toBe(301);
  expect(scan).not.toHaveBeenCalled();
});
