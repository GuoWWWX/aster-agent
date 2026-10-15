import { describe, expect, it } from "vitest";
import { htmlPreviewDocument } from "./html-preview-document.js";

describe("preview height instrumentation", () => {
  it("preserves the authored source and doctype and inserts before restrictive metadata", () => {
    const source = '<!doctype html><!-- <head> decoy --><html><head><meta http-equiv="Content-Security-Policy" content="script-src none"><title>页面</title></head><body><svg viewBox="0 0 10 10"></svg></body></html>';
    const document = htmlPreviewDocument(source, "00000000-0000-4000-8000-000000000001");
    expect(document.startsWith('<!doctype html><!-- <head> decoy --><html><head><script data-aster-preview-resize>')).toBe(true);
    expect(document.replace(/<script data-aster-preview-resize>[\s\S]*?<\/script>/u, "")).toBe(source);
    expect(document).toContain("window.parent === window");
    expect(document).toContain("html-preview.resize");
    expect(document).toContain("maxHeight = 20000");
  });

  it.each(['<!doctype html><p>fragment</p>', '<svg viewBox="0 0 10 10"></svg>'])("handles fragments without an explicit head", source => {
    const document = htmlPreviewDocument(source, "00000000-0000-4000-8000-000000000001");
    expect(document.replace(/<script data-aster-preview-resize>[\s\S]*?<\/script>/u, "")).toBe(source);
    if (source.startsWith("<!doctype")) expect(document.startsWith("<!doctype html><script")).toBe(true);
  });
});
