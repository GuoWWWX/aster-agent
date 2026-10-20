import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ThreadLog } from "./thread-log.js";
import { ThreadLogTimeline } from "./thread-log-timeline.js";
import { conversationToolItemSchema } from "@agent/protocol";

vi.mock("node:fs", async (importOriginal) => ({ ...await importOriginal<typeof import("node:fs")>() }));

const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

it("uses one read-only descriptor for a page and closes it on success or a stale read", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "timeline-page-descriptor-"));
  directories.push(directory);
  const log = new ThreadLog(directory);
  const conversationId = randomUUID();
  for (let i = 0; i < 120; i++) log.append(conversationId, {
    type: "user_message", payload: { messageId: randomUUID(), runId: randomUUID(), content: `message ${i}` },
  });
  const timeline = new ThreadLogTimeline(log);
  await timeline.warm(conversationId);
  const open = vi.spyOn(fs, "openSync");
  const close = vi.spyOn(fs, "closeSync");
  expect(timeline.page({ conversationId, limit: 120 }).items).toHaveLength(120);
  expect(open).toHaveBeenCalledExactlyOnceWith(log.getPath(conversationId), "r");
  expect(close).toHaveBeenCalledExactlyOnceWith(open.mock.results[0]?.value);
  open.mockClear(); close.mockClear();
  vi.spyOn(fs, "readSync").mockReturnValue(0);
  expect(() => timeline.page({ conversationId, limit: 120 })).toThrow("no longer available");
  expect(open).toHaveBeenCalledTimes(1);
  expect(close).toHaveBeenCalledExactlyOnceWith(open.mock.results[0]?.value);
});

it("yields between bounded index batches", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "timeline-cooperative-"));
  directories.push(directory);
  const log = new ThreadLog(directory);
  const conversationId = randomUUID();
  const runId = randomUUID();
  for (let i = 0; i < 260; i++) log.append(conversationId, {
    type: "user_message", payload: { messageId: randomUUID(), runId, content: `${i}` },
  });
  const scan = vi.spyOn(log, "scan");
  let yielded = false;
  setImmediate(() => { yielded = true; });
  const timeline = new ThreadLogTimeline(log);
  await timeline.warm(conversationId);
  expect(yielded).toBe(true);
  expect(scan).toHaveBeenCalledTimes(3);
  expect(scan.mock.calls.at(-1)?.[2]).toMatchObject({ sequence: 256 });
  expect(timeline.page({ conversationId, limit: 20 }).items[0]).toMatchObject({ content: "240" });
  expect(scan).toHaveBeenCalledTimes(3);
});

it("finishes six simultaneous cold loads and reuses each member's timeline index", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "timeline-concurrent-"));
  directories.push(directory);
  const log = new ThreadLog(directory);
  const ids = Array.from({ length: 6 }, () => randomUUID());
  for (const id of ids) for (let i = 0; i < 260; i++) log.append(id, {
    type: "user_message", payload: { messageId: randomUUID(), runId: randomUUID(), content: `${i}` },
  });
  const scan = vi.spyOn(log, "scan");
  const timeline = new ThreadLogTimeline(log);
  await Promise.all(ids.map((id) => timeline.warm(id)));
  expect(scan).toHaveBeenCalledTimes(18);
  scan.mockClear();
  for (const conversationId of ids) expect(timeline.page({ conversationId, limit: 20 }).items).toHaveLength(20);
  expect(scan).not.toHaveBeenCalled();
});

it("updates the approved tool in place and only expires approvals at run completion", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "timeline-approval-"));
  directories.push(directory);
  const log = new ThreadLog(directory);
  const conversationId = randomUUID();
  const runId = randomUUID();
  const tool = conversationToolItemSchema.parse({
    id: randomUUID(), conversationId, runId, kind: "tool", name: "run_command",
    arguments: "{}", createdAt: new Date().toISOString(), result: null, diff: null, status: "running",
  });
  log.append(conversationId, { type: "tool_call_requested", payload: { tool } });
  log.append(conversationId, { type: "tool_approval_requested", payload: { toolId: tool.id } });
  const timeline = new ThreadLogTimeline(log);
  expect(timeline.page({ conversationId, limit: 20 }).items[0]).toMatchObject({ status: "awaiting_approval" });
  log.append(conversationId, { type: "tool_approval_decided", payload: { tool } });
  expect(timeline.page({ conversationId, limit: 20 }).items).toMatchObject([{ id: tool.id, status: "running" }]);
  log.append(conversationId, { type: "tool_result", payload: { tool: { ...tool, status: "completed", result: "ok" } } });
  log.append(conversationId, { type: "run_finished", payload: { runId, status: "completed" } });
  expect(timeline.page({ conversationId, limit: 20 }).items).toMatchObject([{ id: tool.id, status: "completed", result: "ok" }]);
  const read = vi.spyOn(log, "readRecord");
  expect([...timeline.messages(conversationId, undefined, true)]).toEqual([]);
  expect(read).not.toHaveBeenCalled();
});

it("reads a page by stable file locations without hydrating full history", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "timeline-offsets-"));
  directories.push(directory);
  const log = new ThreadLog(directory);
  const id = randomUUID();
  const runId = randomUUID();
  for (let i = 0; i < 60; i++) log.append(id, {
    type: "user_message", payload: { messageId: randomUUID(), runId, content: `消息 ${i}` },
  });
  const timeline = new ThreadLogTimeline(log);
  const read = vi.spyOn(log, "readRecord");
  const reader = vi.spyOn(log, "withRecordReader");
  const fullRead = vi.spyOn(log, "read");
  const scan = vi.spyOn(log, "scan");
  const first = timeline.page({ conversationId: id, limit: 20 });
  expect(first.items.map((item) => "content" in item ? item.content : "")).toEqual(
    Array.from({ length: 20 }, (_, i) => `消息 ${i + 40}`),
  );
  expect(first.nextBeforeSequence).toBe(41);
  expect(reader).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
  expect(fullRead).not.toHaveBeenCalled();
  log.append(id, { type: "assistant_message", payload: {
    messageId: randomUUID(), runId, content: "新回复", modelId: "demo",
  } });
  const older = timeline.page({ conversationId: id, limit: 20, beforeSequence: 41 });
  expect(scan.mock.calls.at(-1)?.[2]).toMatchObject({ sequence: 60 });
  expect(older.items[0]).toMatchObject({ content: "消息 20" });
  expect(older.nextBeforeSequence).toBe(21);
  const oldest = timeline.page({ conversationId: id, limit: 20, beforeSequence: 21 });
  expect(oldest.hasMore).toBe(false);
  expect(oldest.nextBeforeSequence).toBeNull();
  read.mockClear(); reader.mockClear();
  const middleId = older.items[10]!.id;
  const middle = timeline.page({ conversationId: id, aroundItemId: middleId, limit: 20 });
  expect(middle.items).toContainEqual(expect.objectContaining({ id: middleId }));
  expect(reader).toHaveBeenCalledTimes(1);
  expect(read).not.toHaveBeenCalled();
  expect(middle.nextAfterSequence).toBe(40);
  const forward = timeline.page({ conversationId: id, afterSequence: middle.nextAfterSequence!, limit: 20 });
  expect(forward.items[0]).toMatchObject({ content: "消息 40" });
  expect(forward.nextAfterSequence).toBe(60);
  expect(timeline.page({ conversationId: id, afterSequence: 60, limit: 20 }).nextAfterSequence).toBeNull();
  const file = log.getPath(id);
  await writeFile(file, (await readFile(file, "utf8")).replace('消息 0"', '文件外部修改后的消息 0"'), "utf8");
  expect(timeline.page({ conversationId: id, limit: 20, beforeSequence: 21 }).items[0]).toMatchObject({
    content: "文件外部修改后的消息 0",
  });
  expect(scan.mock.calls.at(-1)?.[2]).toBeUndefined();
});
