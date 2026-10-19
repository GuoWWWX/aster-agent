import { describe, expect, it } from "vitest";
import { codeBlockPreviewReferenceSchema, htmlPreviewRequestSchema, htmlPreviewSchema, htmlPreviewResizeMessageSchema, presentHtmlInputSchema, presentHtmlToolInputSchema, htmlPresentationResultSchema } from "./html-preview.js";
const id = "00000000-0000-4000-8000-000000000001";
describe("HTML preview contracts", () => {
  it("accepts reference-based inspection without source copies or mandatory viewport parameters", () => {
    const input = { action: "inspect", sourceRef: "latest", frames: 3, intervalMs: 650 };
    const parsed = presentHtmlToolInputSchema.parse(input);
    expect(parsed.width).toBeUndefined();
    expect(parsed.height).toBeUndefined();
    expect(parsed.frames).toBe(3);
    expect(parsed.intervalMs).toBe(650);
    for (const extra of [{ code: "<p>copy</p>" }, { language: "react" }, { frames: 4 }, { intervalMs: 2001 }, { width: 0 }]) {
      expect(presentHtmlToolInputSchema.safeParse({ ...input, ...extra }).success).toBe(false);
    }
    const pages = [{ title: "A", kind: "file", path: "a.html" }, { title: "B", kind: "file", path: "b.html" }];
    expect(presentHtmlToolInputSchema.safeParse({ pages }).success).toBe(true);
    expect(presentHtmlToolInputSchema.safeParse({ pages: [{ title: "A", kind: "code", html: "x" }, pages[1]] }).success).toBe(false);
    expect(presentHtmlToolInputSchema.safeParse({ action: "inspect", pages }).success).toBe(false);
  });
  it("uses the same precise original fence identity for inspection and display", () => {
    const sourceRef = `codeblock:${id}:2`;
    const value = { sourceRef, displayRef: sourceRef, language: "react", inspected: true };
    expect(codeBlockPreviewReferenceSchema.safeParse({ ok: true, value }).success).toBe(true);
    expect(codeBlockPreviewReferenceSchema.safeParse({ ok: true, value: { ...value, displayRef: `codeblock:${id}:1` } }).success).toBe(false);
    expect(htmlPreviewRequestSchema.safeParse({ kind: "reference", conversationId: id, sourceRef }).success).toBe(true);
    expect(htmlPreviewRequestSchema.safeParse({ kind: "reference", conversationId: id, sourceRef: "latest" }).success).toBe(false);
    expect(htmlPreviewRequestSchema.safeParse({ kind: "reference", conversationId: id, sourceRef, html: "copy" }).success).toBe(false);
  });
  it("allows an opaque source reference as the only preview source", () => {
    expect(presentHtmlInputSchema.parse({ action: "inspect", sourceRef: `artifact:${id}`, frames: 3 })).toMatchObject({ sourceRef: `artifact:${id}`, frames: 3 });
    for (const input of [{ sourceRef: "file:///a.html" }, { sourceRef: `artifact:${id}`, code: "x" }, { sourceRef: `artifact:${id}`, path: "a.html" }]) {
      expect(presentHtmlInputSchema.safeParse(input).success).toBe(false);
    }
  });
  it("accepts only opaque optional artifact references without changing legacy payloads", () => {
    const presentation = { kind: "html", path: "demo.html" };
    expect(htmlPresentationResultSchema.parse({ ok: true, value: { presentation, displayRef: `artifact:${id}` } }).value.displayRef).toBe(`artifact:${id}`);
    for (const displayRef of ["", "artifact:../demo.html", "file:///demo.html", "https://example.com"]) {
      expect(htmlPresentationResultSchema.safeParse({ ok: true, value: { presentation, displayRef } }).success).toBe(false);
    }
  });
  it("accepts bounded component previews and multi-phase inspection without widening workspace paths", () => {
    for (const language of ["html", "react", "vue"]) {
      expect(htmlPreviewRequestSchema.safeParse({ kind: "code", conversationId: id, html: "example", language }).success).toBe(true);
      expect(presentHtmlInputSchema.parse({ action: "inspect", code: "example", language, frames: 3 })).toMatchObject({ frames: 3, width: 1280 });
      expect(htmlPresentationResultSchema.safeParse({ ok: true, value: { presentation: { kind: "code", html: "example", language } } }).success).toBe(true);
    }
    for (const input of [{ code: "x", language: "svelte" }, { code: "x", path: "a.html" }, { action: "inspect", code: "x", frames: 4 }, { action: "inspect", code: "x", width: 0 }]) {
      expect(presentHtmlInputSchema.safeParse(input).success).toBe(false);
    }
  });
  it("only accepts relative HTML presentation entries and stores no preview URL", () => {
    expect(presentHtmlInputSchema.parse({ path: "examples/演示.htm" })).toMatchObject({ path: "examples/演示.htm", action: "present", language: "html" });
    for (const path of ["", "../demo.html", "/demo.html", "C:/demo.html", "https://example.com/demo.html", "a\\demo.html", "a.html\nb.html", "demo.txt"]) {
      expect(presentHtmlInputSchema.safeParse({ path }).success).toBe(false);
    }
    expect(presentHtmlInputSchema.safeParse({ path: "demo.html", workspaceRoot: "C:/" }).success).toBe(false);
    const result = { ok: true, value: { presentation: { kind: "html", path: "demo.html" } } };
    expect(htmlPresentationResultSchema.safeParse(result).success).toBe(true);
    expect(htmlPresentationResultSchema.safeParse({ ...result, url: "http://127.0.0.1:1234/" }).success).toBe(false);
  });
  it("bounds inspection interactions without allowing scripts, external keys or off-viewport clicks", () => {
    expect(presentHtmlInputSchema.parse({ action: "inspect", code: "x", actions: [{ action: "key", key: "Tab" }, { action: "click", x: 10, y: 20 }] }).actions).toHaveLength(2);
    for (const input of [{ actions: [{ action: "key", key: "F12" }] }, { actions: [{ action: "click", x: 1280, y: 0 }] },
      { actions: Array.from({ length: 13 }, () => ({ action: "key", key: "Tab" })) }, { actions: [{ action: "eval", code: "x" }] }, { action: "present", actions: [{ action: "key", key: "Tab" }] }]) {
      expect(presentHtmlInputSchema.safeParse({ action: "inspect", code: "x", ...input }).success).toBe(false);
    }
  });
  it("accepts bounded sources and rejects renderer supplied workspace roots", () => {
    expect(htmlPreviewRequestSchema.parse({ kind: "file", conversationId: id, path: " demo.html " })).toMatchObject({ path: "demo.html" });
    for (const input of [
      { kind: "file", conversationId: id, path: "demo.html", workspaceRoot: "C:/" },
      { kind: "code", conversationId: id, html: "" },
      { kind: "code", conversationId: "invalid", html: "<p>test</p>" },
      { kind: "browser", conversationId: id, id: "invalid" },
    ]) expect(htmlPreviewRequestSchema.safeParse(input).success).toBe(false);
  });
  it("accepts named comparison pages from files or inline fragments without changing single-page inputs", () => {
    const pages = [{ title: "清爽版", kind: "code", html: "<div>方案 A</div>" }, { title: "紧凑版", kind: "file", path: "pages/b.html" }];
    expect(presentHtmlInputSchema.safeParse({ pages }).success).toBe(true);
    expect(htmlPresentationResultSchema.safeParse({ ok: true, value: { presentation: { kind: "html_gallery", pages } } }).success).toBe(true);
    for (const input of [{}, { path: "demo.html", pages }, { pages: [] }, { pages: pages.slice(0, 1) },
      { pages: Array.from({ length: 13 }, () => pages[0]) },
      { pages: [{ ...pages[0], title: "" }, pages[1]] },
      { pages: [pages[0], { ...pages[1], path: "../outside.html" }] },
      { pages: [{ ...pages[0], html: "x".repeat(500_001) }, { ...pages[0], html: "x".repeat(500_001) }] },
      { pages: [{ ...pages[0], path: "demo.html" }, pages[1]] },
    ]) expect(presentHtmlInputSchema.safeParse(input).success).toBe(false);
  });
  it("only returns loopback HTTP origins", () => {
    const preview = { id, title: "示例", source: "test", url: "http://127.0.0.1:1234/token/index.html" };
    expect(htmlPreviewSchema.safeParse(preview).success).toBe(true);
    for (const url of ["https://example.com/", "file:///C:/demo.html", "http://user@127.0.0.1/", "http://localhost/"]) {
      expect(htmlPreviewSchema.safeParse({ ...preview, url }).success).toBe(false);
    }
  });
  it("bounds untrusted sandbox height reports", () => {
    const message = { type: "html-preview.resize", id, height: 720 };
    expect(htmlPreviewResizeMessageSchema.safeParse(message).success).toBe(true);
    for (const height of [0, -1, 1.5, NaN, Infinity, 20_001, "720"]) {
      expect(htmlPreviewResizeMessageSchema.safeParse({ ...message, height }).success).toBe(false);
    }
    expect(htmlPreviewResizeMessageSchema.safeParse({ ...message, id: "invalid" }).success).toBe(false);
    expect(htmlPreviewResizeMessageSchema.safeParse({ ...message, bridge: true }).success).toBe(false);
  });
});
