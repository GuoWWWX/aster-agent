import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HtmlPreviewServer } from "./html-preview-server.js";

const conversationId = "00000000-0000-4000-8000-000000000001";
describe("HTML preview server", () => {
  it("reads a referenced original assistant fence within its conversation without requiring workspace files", async () => {
    const code = "<h1>Original fence</h1>";
    const ref = `codeblock:${conversationId}:1`;
    const instance = new HtmlPreviewServer(() => Promise.reject(new Error("No workspace expected")), (owner, reference) =>
      owner === conversationId && reference === ref ? { code, language: "html" } : null);
    try {
      const preview = await instance.create({ kind: "reference", conversationId, sourceRef: ref });
      expect(preview.source).toBe(code);
      expect(await (await fetch(preview.url)).text()).toContain("Original fence");
      await expect(instance.create({ kind: "reference", conversationId: "00000000-0000-4000-8000-000000000002", sourceRef: ref })).rejects.toThrow("找不到");
      instance.release(preview.id, conversationId);
      await expect(fetch(preview.url)).rejects.toThrow();
    } finally { instance.dispose(); }
  });
  let root: string;
  let server: HtmlPreviewServer;
  beforeEach(async () => {
    root = await mkdtemp(path.join(os.tmpdir(), "aster-html-"));
    server = new HtmlPreviewServer(() => Promise.resolve(root));
    await mkdir(path.join(root, "pages"));
    await writeFile(path.join(root, "pages/demo.html"), '<link rel="stylesheet" href="../style.css"><script src="../app.js"></script><h1>示例</h1>');
    await writeFile(path.join(root, "style.css"), "h1{color:red}");
    await writeFile(path.join(root, "app.js"), "window.demo=true");
  });
  afterEach(async () => { server.dispose(); await rm(root, { recursive: true, force: true }); });

  it("serves a snapshot, relative assets and sandbox headers; reopening reads edits", async () => {
    const preview = await server.create({ kind: "file", conversationId, path: "pages/demo.html" });
    const response = await fetch(preview.url);
    const document = await response.text();
    expect(document.replace(/<script data-aster-preview-resize>[\s\S]*?<\/script>/u, "")).toBe("<!doctype html>\n" + preview.source);
    expect(preview.source).not.toContain("data-aster-preview-resize");
    expect(preview.source).not.toContain("<!doctype");
    expect(response.headers.get("content-security-policy")).toContain("sandbox allow-scripts;");
    expect(response.headers.get("content-security-policy")).not.toContain("allow-same-origin");
    expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await (await fetch(new URL("../style.css", preview.url))).text()).toBe("h1{color:red}");
    expect((await fetch(new URL("../app.js", preview.url))).headers.get("content-type")).toBe("text/javascript");
    expect(await (await fetch(preview.url, { method: "HEAD" })).text()).toBe("");
    await writeFile(path.join(root, "pages/demo.html"), "<h1>已修改</h1>");
    expect(await (await fetch(preview.url)).text()).toBe(document);
    expect((await server.create({ kind: "file", conversationId, path: "pages/demo.html" })).source).toBe("<h1>已修改</h1>");
  });

  it("blocks wrong tokens, writes, secrets, traversal and symlink escapes", async () => {
    const preview = await server.create({ kind: "file", conversationId, path: "pages/demo.html" });
    await writeFile(path.join(root, "secret.json"), '{"secret":true}');
    await mkdir(path.join(root, ".private"));
    await writeFile(path.join(root, ".private/leak.js"), "secret");
    const outside = await mkdtemp(path.join(os.tmpdir(), "aster-outside-"));
    try {
      await writeFile(path.join(outside, "leak.js"), "outside");
      await symlink(outside, path.join(root, "linked"), "junction");
      for (const relative of ["../secret.json", "../.private/leak.js", "../linked/leak.js", "../%2e%2e%5csecret.js", "../style.css%3Asecret"]) {
        expect((await fetch(new URL(relative, preview.url))).status).toBe(404);
      }
      expect((await fetch(new URL("/wrong/pages/demo.html", preview.url))).status).toBe(404);
      expect((await fetch(preview.url, { method: "POST" })).status).toBe(403);
      await expect(server.create({ kind: "file", conversationId, path: "../outside.html" })).rejects.toThrow();
      await expect(server.create({ kind: "file", conversationId, path: "style.css" })).rejects.toThrow("HTML");
    } finally { await rm(outside, { recursive: true, force: true }); }
  });

  it("keeps browser references alive and restricts ownership", async () => {
    const preview = await server.create({ kind: "code", conversationId, html: "<button>测试</button>" });
    expect(() => server.get(preview.id, "other")).toThrow();
    expect(() => server.release(preview.id, "other")).toThrow();
    server.retain(preview.id, conversationId);
    server.release(preview.id, conversationId);
    expect((await fetch(preview.url)).status).toBe(200);
    server.release(preview.id, conversationId);
    expect(() => server.get(preview.id, conversationId)).toThrow();
    await expect(fetch(preview.url)).rejects.toThrow();
    server.release(preview.id, conversationId);
  });

  it("bounds UTF-8 content and rejects binary HTML", async () => {
    await expect(server.create({ kind: "code", conversationId, html: "中".repeat(400_000) })).rejects.toThrow("过大");
    await writeFile(path.join(root, "large.html"), "x".repeat(1_000_001));
    await expect(server.create({ kind: "file", conversationId, path: "large.html" })).rejects.toThrow("1 MB");
    await writeFile(path.join(root, "binary.html"), "x\0y");
    await expect(server.create({ kind: "file", conversationId, path: "binary.html" })).rejects.toThrow("格式");
  });

  it("closes all origins and rejects work that finishes after shutdown", async () => {
    const preview = await server.create({ kind: "code", conversationId, html: "test" });
    const pending = server.create({ kind: "file", conversationId, path: "pages/demo.html" });
    server.dispose();
    await expect(pending).rejects.toThrow("关闭");
    await expect(server.create({ kind: "code", conversationId, html: "test" })).rejects.toThrow("关闭");
    await expect(fetch(preview.url)).rejects.toThrow();
  });

  it("can create fresh previews after the main window reopens", async () => {
    const pending = server.create({ kind: "file", conversationId, path: "pages/demo.html" });
    server.closeAll();
    await expect(pending).rejects.toThrow("关闭");
    const preview = await server.create({ kind: "code", conversationId, html: "reopened" });
    expect(await (await fetch(preview.url)).text()).toContain("reopened");
  });
});
