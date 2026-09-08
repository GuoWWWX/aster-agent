import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readTextLines } from "./read-text-lines.js";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
async function fixture(content: string | Buffer) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-line-read-"));
  roots.push(root);
  const file = path.join(root, "input.txt");
  await writeFile(file, content);
  return file;
}

describe("bounded text line reads", () => {
  it.each([
    { content: "", start: 1, end: 400, expected: "", total: 1, next: null, last: 1 },
    { content: "a\r\nb\r\n", start: 1, end: 400, expected: "a\nb\n", total: 3, next: null, last: 3 },
    { content: "a\nb", start: 2, end: 2, expected: "b", total: 2, next: null, last: 2 },
    { content: "a\n", start: 1, end: 1, expected: "a", total: 2, next: 2, last: 1 },
    { content: "a\nb\n", start: 1, end: 1, expected: "a", total: null, next: 2, last: 1 },
    { content: "a\n", start: 2, end: 3, expected: "", total: 2, next: null, last: 2 },
  ])("preserves line boundaries: $start-$end in $content", async (sample) => {
    const result = await readTextLines(await fixture(sample.content), sample.start, sample.end, new AbortController().signal);
    expect(result).toEqual({ content: sample.expected, startLine: sample.start,
      endLine: sample.last, totalLines: sample.total, nextStartLine: sample.next });
  });

  it("handles UTF-8 and CRLF split across chunks", async () => {
    const text = `${"x".repeat(65535)}中文\r\n下一行`;
    const result = await readTextLines(await fixture(text), 1, 2, new AbortController().signal);
    expect(result.content).toBe(text.replaceAll("\r\n", "\n"));
    expect(result.totalLines).toBe(2);
  });

  it("bounds selected bytes, but skips an oversized preceding line without retaining it", async () => {
    const file = await fixture(`${"x".repeat(300_000)}\n目标行\n`);
    await expect(readTextLines(file, 1, 1, new AbortController().signal)).rejects.toMatchObject({
      code: "TOOL_ARGUMENTS_INVALID", issues: [expect.objectContaining({ path: ["endLine"] })],
    });
    expect((await readTextLines(file, 2, 2, new AbortController().signal)).content).toBe("目标行");
  });

  it("stops at the range without decoding or scanning a later binary tail", async () => {
    const file = await fixture(Buffer.concat([Buffer.from("head\n"), Buffer.alloc(500_000, 255)]));
    expect((await readTextLines(file, 1, 1, new AbortController().signal)).content).toBe("head");
  });

  it.each([Buffer.from([255]), Buffer.from("a\0b")])("rejects non-text selected bytes", async (bytes) => {
    await expect(readTextLines(await fixture(bytes), 1, 1, new AbortController().signal))
      .rejects.toMatchObject({ code: "TOOL_ARGUMENTS_INVALID" });
  });

  it("reports a start beyond EOF and releases the handle on failure", async () => {
    const file = await fixture("one");
    await expect(readTextLines(file, 2, 2, new AbortController().signal)).rejects.toMatchObject({
      issues: [expect.objectContaining({ path: ["startLine"], message: "File has 1 lines. Choose startLine between 1 and 1." })],
    });
    await rm(file);
  });

  it("honors cancellation before opening", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readTextLines("not-opened", 1, 1, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
