import { randomUUID } from "node:crypto";
import * as fs from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi, type MockInstance } from "vitest";
import { ThreadLog } from "./thread-log.js";

vi.mock("node:fs", async original => ({ ...await original<typeof import("node:fs")>() }));
const directories: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

async function fixture(count = 80) {
  const root = await mkdtemp(path.join(os.tmpdir(), "covered-search-"));
  directories.push(root);
  const log = new ThreadLog(root);
  const id = randomUUID();
  for (let index = 0; index < count; index += 1) log.append(id, { type: "user_message", payload: {
    content: `${index === 2 || index === 17 ? "needle " : ""}entry ${index} ${"ordinary ".repeat(20)}`,
    runId: `run-${index}`, attachmentIds: [],
  } });
  log.append(id, { type: "context_checkpoint", payload: { coveredThroughContextSequence: count, summary: "covered" } });
  log.readUncoveredContext(id);
  return { log, id };
}

function recordReads(read: MockInstance<typeof fs.readSync>): number {
  // Incremental scans probe EOF with a large requested buffer but return zero bytes.
  return read.mock.results.filter(result => result.type === "return" && typeof result.value === "number" && result.value > 64).length;
}

it("reuses matching locations without rereading every covered message or retaining mutable results", async () => {
  const { log, id } = await fixture();
  const expected = log.searchCoveredContext(id, "needle");
  expect(expected.map(message => message.runId)).toEqual(["run-2", "run-17"]);
  const read = vi.spyOn(fs, "readSync");
  const result = log.searchCoveredContext(id, "NEEDLE needle");
  expect(result).toEqual(expected);
  expect(recordReads(read)).toBeLessThanOrEqual(2);
  result[0]!.content = "consumer mutation";
  result[0]!.attachmentIds.push("consumer-id");
  expect(log.searchCoveredContext(id, "needle")).toEqual(expected);
});

it("remembers a no-match query without loading covered bodies again", async () => {
  const { log, id } = await fixture();
  expect(log.searchCoveredContext(id, "absentword")).toEqual([]);
  const read = vi.spyOn(fs, "readSync");
  expect(log.searchCoveredContext(id, "absentword")).toEqual([]);
  expect(recordReads(read)).toBe(0);
});

it("reuses an unchanged covered prefix after new uncovered content but refreshes at the next checkpoint", async () => {
  const { log, id } = await fixture();
  const expected = log.searchCoveredContext(id, "needle");
  log.append(id, { type: "user_message", payload: { content: "needle new tail", runId: "new-tail" } });
  log.readUncoveredContext(id);
  const read = vi.spyOn(fs, "readSync");
  expect(log.searchCoveredContext(id, "needle")).toEqual(expected);
  expect(recordReads(read)).toBeLessThanOrEqual(2);
  log.append(id, { type: "context_checkpoint", payload: { coveredThroughContextSequence: 81, summary: "new boundary" } });
  expect(log.searchCoveredContext(id, "needle").map(message => message.runId))
    .toEqual(["run-2", "run-17", "new-tail"]);
});

it("changes query results, removes superseded runs and preserves search result order", async () => {
  const { log, id } = await fixture();
  expect(log.searchCoveredContext(id, "needle")).toHaveLength(2);
  expect(log.searchCoveredContext(id, "entry 3").length).toBeGreaterThan(0);
  expect(log.searchCoveredContext(id, "needle")).toHaveLength(2);
  log.append(id, { type: "run_superseded", payload: { runId: "run-17" } });
  expect(log.searchCoveredContext(id, "needle")).toEqual([]);
  log.append(id, { type: "context_checkpoint", payload: { coveredThroughContextSequence: 79, summary: "recompiled" } });
  expect(log.searchCoveredContext(id, "needle").map(message => message.runId)).toEqual(["run-2"]);
});

it("discards search locations after an external rewrite or deletion of the source", async () => {
  const { log, id } = await fixture();
  expect(log.searchCoveredContext(id, "needle")).toHaveLength(2);
  const replacementRoot = await mkdtemp(path.join(os.tmpdir(), "covered-replacement-"));
  directories.push(replacementRoot);
  const replacement = new ThreadLog(replacementRoot);
  replacement.append(id, { type: "user_message", payload: { content: "needle replacement", runId: "replacement" } });
  replacement.append(id, { type: "context_checkpoint", payload: { coveredThroughContextSequence: 1, summary: "replacement" } });
  await writeFile(log.getPath(id), await readFile(replacement.getPath(id)));
  expect(log.searchCoveredContext(id, "needle").map(message => message.runId)).toEqual(["replacement"]);
  await log.deleteConversations([id]);
  expect(log.searchCoveredContext(id, "needle")).toEqual([]);
});

it("keeps the existing 1000-candidate and 24-result bounds", async () => {
  const { log, id } = await fixture(1005);
  expect(log.searchCoveredContext(id, "needle").map(message => message.runId)).toEqual(["run-17"]);
  const matches = log.searchCoveredContext(id, "ordinary");
  expect(matches).toHaveLength(24);
  expect(matches[0]?.runId).toBe("run-981");
  expect(matches.at(-1)?.runId).toBe("run-1004");
  expect(log.searchCoveredContext(id, "ordinary")).toEqual(matches);
});
