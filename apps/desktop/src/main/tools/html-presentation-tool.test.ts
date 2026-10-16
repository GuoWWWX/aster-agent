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

  it("delivers named inline alternatives without resolving a workspace or creating files", async () => {
    const resolve = vi.fn(() => Promise.resolve(root));
    tool = new HtmlPresentationTool(resolve);
    const pages = [{ title: "A", kind: "code", html: "<div>A</div>" }, { title: "B", kind: "code", html: "<button>B</button>" }];
    const result = await tool.execute(conversationId, JSON.stringify({ pages }), signal());
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual({ ok: true, value: { presentation: { kind: "html_gallery", pages } } });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("validates every referenced file before delivering a mixed comparison", async () => {
    const pages = [{ title: "文件方案", kind: "file", path: "pages/demo.html" }, { title: "片段方案", kind: "code", html: "<div>B</div>" }];
    const result = await tool.execute(conversationId, JSON.stringify({ pages }), signal());
    expect(result.isError).toBe(false);
    expect(JSON.parse(result.content)).toEqual({ ok: true, value: { presentation: { kind: "html_gallery", pages } } });
    const failed = await tool.execute(conversationId, JSON.stringify({ pages: [...pages, { title: "缺失", kind: "file", path: "missing.html" }] }), signal());
    expect(failed.isError).toBe(true);
    expect(failed.content).not.toContain('"presentation"');
    const escaped = await tool.execute(conversationId, JSON.stringify({ pages: [pages[1], { title: "越界", kind: "file", path: "../demo.html" }] }), signal());
    expect(escaped.isError).toBe(true);
  });

  it("bounds combined inline UTF-8 bytes and checks cancellation for an inline delivery", async () => {
    const pages = [{ title: "A", kind: "code", html: "汉".repeat(200_000) }, { title: "B", kind: "code", html: "字".repeat(200_000) }];
    expect((await tool.execute(conversationId, JSON.stringify({ pages }), signal())).isError).toBe(true);
    const controller = new AbortController(); controller.abort();
    expect((await tool.execute(conversationId, JSON.stringify({ pages: pages.map(page => ({ ...page, html: "<div>内容</div>" })) }), controller.signal)).isError).toBe(true);
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
