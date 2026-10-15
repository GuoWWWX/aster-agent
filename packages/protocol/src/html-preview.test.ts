import { describe, expect, it } from "vitest";
import { htmlPreviewRequestSchema, htmlPreviewSchema, htmlPreviewResizeMessageSchema, presentHtmlInputSchema, htmlPresentationResultSchema } from "./html-preview.js";
const id = "00000000-0000-4000-8000-000000000001";
describe("HTML preview contracts", () => {
  it("only accepts relative HTML presentation entries and stores no preview URL", () => {
    expect(presentHtmlInputSchema.parse({ path: "examples/演示.htm" })).toEqual({ path: "examples/演示.htm" });
    for (const path of ["", "../demo.html", "/demo.html", "C:/demo.html", "https://example.com/demo.html", "a\\demo.html", "a.html\nb.html", "demo.txt"]) {
      expect(presentHtmlInputSchema.safeParse({ path }).success).toBe(false);
    }
    expect(presentHtmlInputSchema.safeParse({ path: "demo.html", workspaceRoot: "C:/" }).success).toBe(false);
    const result = { ok: true, value: { presentation: { kind: "html", path: "demo.html" } } };
    expect(htmlPresentationResultSchema.safeParse(result).success).toBe(true);
    expect(htmlPresentationResultSchema.safeParse({ ...result, url: "http://127.0.0.1:1234/" }).success).toBe(false);
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
