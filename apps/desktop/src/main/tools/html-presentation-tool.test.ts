import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HtmlPresentationTool } from "./html-presentation-tool.js";

describe("HTML presentation tool", () => {
  let root: string;
  let tool: HtmlPresentationTool;
  const conversationId = "00000000-0000-4000-8000-000000000001";
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "aster-html-presentation-"));
    await mkdir(path.join(root, "pages"));
    await writeFile(path.join(root, "pages/demo.html"), "<h1>最终交付</h1>");
    tool = new HtmlPresentationTool(() => Promise.resolve(root));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const signal = (): AbortSignal => new AbortController().signal;

  it("returns a durable file reference without copying source, writing files or starting a preview", async () => {
    expect(tool.getDefinitions()).toEqual([expect.objectContaining({ name: "present_html" })]);
    const result = await tool.execute(conversationId, '{"path":"pages/demo.html"}', signal());
    expect(result).toMatchObject({ kind: "completed", isError: false });
    expect(JSON.parse(result.content)).toEqual({ ok: true, value: { presentation: { kind: "html", path: "pages/demo.html" } } });
    expect(result.content).not.toContain(root);
    expect(result.content).not.toContain("<h1>");
    expect(await readFile(path.join(root, "pages/demo.html"), "utf8")).toBe("<h1>最终交付</h1>");
  });

  it("rejects invalid arguments before resolving a workspace", async () => {
    const resolve = vi.fn(() => Promise.resolve(root));
    tool = new HtmlPresentationTool(resolve);
    for (const raw of ["{", '{"path":"../outside.html"}', '{"path":"pages/demo.html","root":"C:/"}', '{"path":"app.ts"}']) {
      expect((await tool.execute(conversationId, raw, signal())).isError).toBe(true);
    }
    expect(resolve).not.toHaveBeenCalled();
  });

  it("rejects missing, hidden, binary, oversized and symlink-escaped files", async () => {
    const outside = await mkdtemp(path.join(os.tmpdir(), "aster-html-outside-"));
    try {
      await writeFile(path.join(outside, "demo.html"), "outside");
      await symlink(outside, path.join(root, "linked"), "junction");
      await mkdir(path.join(root, ".private"));
      await writeFile(path.join(root, ".private/demo.html"), "hidden");
      await writeFile(path.join(root, "binary.html"), "a\0b");
      await writeFile(path.join(root, "large.html"), "x".repeat(1_000_001));
      for (const entry of ["missing.html", ".private/demo.html", "binary.html", "large.html", "linked/demo.html"]) {
        expect((await tool.execute(conversationId, JSON.stringify({ path: entry }), signal())).isError).toBe(true);
      }
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it("does not deliver a successful result after cancellation", async () => {
    const controller = new AbortController();
    tool = new HtmlPresentationTool(() => { controller.abort(); return Promise.resolve(root); });
    expect((await tool.execute(conversationId, '{"path":"pages/demo.html"}', controller.signal)).isError).toBe(true);
    expect((await tool.execute(conversationId, '{"path":"pages/demo.html"}', controller.signal)).isError).toBe(true);
  });
});
