import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { HtmlPresentationTool, resolveHtmlPresentationSource } from "./html-presentation-tool.js";
import { ToolArgumentsError } from "../model/tool-arguments.js";
import { htmlPresentationResultSchema } from "@agent/protocol";

function deliveryValue(content: string) {
  const { displayRef, sourceRef, ...value } = htmlPresentationResultSchema.parse(JSON.parse(content)).value;
  expect(displayRef).toMatch(/^artifact:[0-9a-f-]{36}$/u);
  expect(sourceRef).toMatch(/^artifact:[0-9a-f-]{36}$/u);
  return value;
}

describe("HTML presentation tool", () => {
  it("reuses inspected source for another viewport and final delivery without resending code", async () => {
    const cid = "00000000-0000-4000-8000-000000000001";
    const code = "export default () => <button>Count</button>";
    const inspect = vi.fn().mockResolvedValue({ kind: "completed", isError: false, content: '{"ok":true,"value":{"inspected":true}}' });
    const history: { name: string; status: "completed"; arguments: string; result: string }[] = [];
    const reader = vi.fn((owner: string, ref: string) => owner === cid ? resolveHtmlPresentationSource(history, ref) : null);
    const presenter = new HtmlPresentationTool(() => Promise.reject(new Error("No workspace needed")), { inspect }, reader);
    const argumentsValue = JSON.stringify({ action: "inspect", code, language: "react" });
    const sourceRef = "artifact:00000000-0000-4000-8000-000000000003";
    history.push({ name: "present_html", status: "completed", arguments: argumentsValue, result: JSON.stringify({ ok: true, value: { inspected: true, sourceRef } }) });
    const first = await presenter.execute(cid, JSON.stringify({ action: "inspect", sourceRef }), new AbortController().signal);
    expect(z.object({ value: z.object({ sourceRef: z.string() }) }).parse(JSON.parse(first.content)).value.sourceRef).toBe(sourceRef);
    expect(sourceRef).toMatch(/^artifact:[0-9a-f-]{36}$/u);
    const restored = new HtmlPresentationTool(() => Promise.reject(new Error("No workspace needed")), { inspect }, reader);
    const next = await restored.execute(cid, JSON.stringify({ action: "inspect", sourceRef, width: 420, frames: 3 }), new AbortController().signal);
    expect(next.isError).toBe(false);
    expect(JSON.parse(next.content)).toMatchObject({ value: { sourceRef, language: "react" } });
    expect(inspect.mock.calls[1]?.[0]).toMatchObject({ width: 420, frames: 3, source: { kind: "code", html: code, language: "react", conversationId: cid } });
    const final = await restored.execute(cid, JSON.stringify({ sourceRef }), new AbortController().signal);
    expect(JSON.parse(final.content)).toMatchObject({ value: { sourceRef, presentation: { kind: "code", html: code, language: "react" } } });
    expect((await presenter.execute("00000000-0000-4000-8000-000000000002", JSON.stringify({ sourceRef }), new AbortController().signal)).isError).toBe(true);
    expect((await presenter.execute(cid, JSON.stringify({ sourceRef, code }), new AbortController().signal)).isError).toBe(true);
    expect((await restored.execute(cid, JSON.stringify({ action: "inspect", sourceRef }), new AbortController().signal, false)).isError).toBe(true);
    expect(inspect).toHaveBeenCalledTimes(2);
  });

  it("reports invalid component source as correctable arguments instead of an internal service failure", async () => {
    const presenter = new HtmlPresentationTool(() => Promise.resolve("unused"), { inspect: vi.fn().mockRejectedValue(new ToolArgumentsError("Invalid JSX", [{ code: "preview_compile", path: ["code"], message: "line 3: unexpected token" }])) },
      () => ({ code: "invalid", language: "react", sourceRef: "codeblock:00000000-0000-4000-8000-000000000001:1" }));
    const result = await presenter.execute("00000000-0000-4000-8000-000000000001", JSON.stringify({ action: "inspect", sourceRef: "latest" }), new AbortController().signal);
    expect(result.isError).toBe(true);
    expect(JSON.parse(result.content)).toMatchObject({ agentError: { code: "VALIDATION_FAILED" }, recovery: { action: "fix_arguments", issues: [{ path: ["code"], message: "line 3: unexpected token" }] } });
    expect(result.content).not.toContain('"presentation"');
  });
  it("advertises only final delivery to roles without inspection permission", () => {
    const tool = new HtmlPresentationTool(() => Promise.resolve("unused"));
    expect(tool.getDefinitions(false)[0]?.parameters).toMatchObject({ properties: { action: { const: "present" } } });
    expect(tool.getDefinitions(false)[0]?.description).toContain("execution member verify");
    expect(tool.getDefinitions(true)[0]?.parameters).toMatchObject({ properties: { action: { enum: ["present", "inspect"] } } });
  });
  it("inspects through the existing preview port, restricts coordinator execution and delivers component source separately", async () => {
    const inspect = vi.fn().mockResolvedValue({ kind: "completed", isError: false, content: '{"ok":true,"value":{"inspected":true}}', modelAttachments: [] });
    const code = "export default ()=> <button>React</button>";
    const sourceRef = "codeblock:00000000-0000-4000-8000-000000000001:1";
    const presenter = new HtmlPresentationTool(() => Promise.reject(new Error("No workspace required")), { inspect }, () => ({ code, language: "react", sourceRef }));
    const args = { action: "inspect", sourceRef, frames: 2 };
    expect((await presenter.execute("00000000-0000-4000-8000-000000000001", JSON.stringify(args), new AbortController().signal)).content).not.toContain('"presentation"');
    expect(inspect).toHaveBeenCalledOnce(); expect(inspect.mock.calls[0]?.[0]).toMatchObject({ frames: 2, source: { kind: "code", language: "react" } });
    expect((await presenter.execute("00000000-0000-4000-8000-000000000001", JSON.stringify(args), new AbortController().signal, false)).isError).toBe(true);
    expect(inspect).toHaveBeenCalledOnce();
    const result = await presenter.execute("00000000-0000-4000-8000-000000000001", JSON.stringify({ sourceRef }), new AbortController().signal);
    expect(JSON.parse(result.content)).toMatchObject({ value: { displayRef: sourceRef, language: "react" } });
    expect(result.content).not.toContain(code);
  });
  let root: string;
  let tool: HtmlPresentationTool;
  const conversationId = "00000000-0000-4000-8000-000000000001";
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "aster-html-presentation-"));
    await mkdir(path.join(root, "pages"));
    await writeFile(path.join(root, "pages/demo.html"), "<h1>最终交付</h1>");
    await writeFile(path.join(root, "pages/demo2.html"), "<h1>第二方案</h1>");
    tool = new HtmlPresentationTool(() => Promise.resolve(root));
  });
  afterEach(async () => { await rm(root, { recursive: true, force: true }); });
  const signal = (): AbortSignal => new AbortController().signal;

  it("returns a durable file reference without copying source, writing files or starting a preview", async () => {
    expect(tool.getDefinitions()).toEqual([expect.objectContaining({ name: "present_html" })]);
    const result = await tool.execute(conversationId, '{"path":"pages/demo.html"}', signal());
    expect(result).toMatchObject({ kind: "completed", isError: false });
    expect(deliveryValue(result.content)).toEqual({ presentation: { kind: "html", path: "pages/demo.html" } });
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

  it("rejects redundant raw inline alternatives without resolving a workspace or creating files", async () => {
    const resolve = vi.fn(() => Promise.resolve(root));
    tool = new HtmlPresentationTool(resolve);
    const pages = [{ title: "A", kind: "code", html: "<div>A</div>" }, { title: "B", kind: "code", html: "<button>B</button>" }];
    const result = await tool.execute(conversationId, JSON.stringify({ pages }), signal());
    expect(result.isError).toBe(true);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("validates every referenced file before delivering a file comparison", async () => {
    const pages = [{ title: "文件方案", kind: "file", path: "pages/demo.html" }, { title: "第二方案", kind: "file", path: "pages/demo2.html" }];
    const result = await tool.execute(conversationId, JSON.stringify({ pages }), signal());
    expect(result.isError).toBe(false);
    expect(deliveryValue(result.content)).toEqual({ presentation: { kind: "html_gallery", pages } });
    const failed = await tool.execute(conversationId, JSON.stringify({ pages: [...pages, { title: "缺失", kind: "file", path: "missing.html" }] }), signal());
    expect(failed.isError).toBe(true);
    expect(failed.content).not.toContain('"presentation"');
    const escaped = await tool.execute(conversationId, JSON.stringify({ pages: [pages[1], { title: "越界", kind: "file", path: "../demo.html" }] }), signal());
    expect(escaped.isError).toBe(true);
  });

  it("bounds referenced UTF-8 source bytes and checks cancellation", async () => {
    tool = new HtmlPresentationTool(() => Promise.resolve(root), null, () => ({ code: "汉".repeat(400_000), language: "html", sourceRef: `codeblock:${conversationId}:1` }));
    expect((await tool.execute(conversationId, JSON.stringify({ sourceRef: "latest" }), signal())).isError).toBe(true);
    const controller = new AbortController(); controller.abort();
    await expect(tool.execute(conversationId, JSON.stringify({ sourceRef: "latest" }), controller.signal)).rejects.toMatchObject({ name: "AbortError" });
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
    await expect(tool.execute(conversationId, '{"path":"pages/demo.html"}', controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    await expect(tool.execute(conversationId, '{"path":"pages/demo.html"}', controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
