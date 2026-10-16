import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";
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

  it.each([0, 12])("keeps the last usable height with a %ipx root margin when a cached frame has no rendered width", async (rootMargin) => {
    vi.useFakeTimers();
    try {
      let width = 0;
      const events = new Map<string, () => void>();
      const postMessage = vi.fn();
      const prependStyle = vi.fn<(style: { textContent: string }) => void>();
      const surface = () => {
        const properties = new Map<string, string>();
        return {
          style: { setProperty: (name: string, value: string) => properties.set(name, value), getPropertyValue: (name: string) => properties.get(name) ?? "", getPropertyPriority: () => "", removeProperty: (name: string) => properties.delete(name) },
          get scrollHeight() { return width === 0 ? 0 : 480; },
          get offsetHeight() { return width === 0 ? 0 : 480; },
          getBoundingClientRect: () => ({ top: 0, width, height: width === 0 ? 0 : 480 }),
        };
      };
      const script = htmlPreviewDocument("<p>preview</p>", "preview-id").match(/<script data-aster-preview-resize>([\s\S]*?)<\/script>/u)?.[1];
      expect(script).toBeDefined();
      const body = surface(), root = surface();
      runInNewContext(script!, {
        innerWidth: 720, innerHeight: 320, scrollY: 0, setTimeout, clearTimeout,
        window: { parent: { postMessage }, addEventListener: (name: string, listener: () => void) => events.set(name, listener) },
        document: { readyState: "complete", head: { prepend: prependStyle }, createElement: () => ({ textContent: "" }), body, documentElement: root, fonts: { ready: Promise.resolve(), addEventListener() {} } },
        getComputedStyle: (node: typeof root) => ({ marginBottom: node === root ? String(rootMargin) : "0", paddingBottom: "0", borderBottomWidth: "0" }),
        ResizeObserver: class { observe() {} }, MutationObserver: class { observe() {} },
      });
      await vi.advanceTimersByTimeAsync(60);
      expect(prependStyle.mock.calls[0]?.[0].textContent).toContain(":where(body) { display: flow-root; margin: 0; }");
      expect(prependStyle.mock.calls[0]?.[0].textContent).toContain("scrollbar-width: thin");
      expect(postMessage).not.toHaveBeenCalled();
      width = 720;
      events.get("load")?.();
      await vi.advanceTimersByTimeAsync(60);
      expect(postMessage).toHaveBeenCalledWith({ type: "html-preview.resize", id: "preview-id", height: 480 + rootMargin }, "*");
      postMessage.mockClear();
      width = 0;
      events.get("load")?.();
      await vi.advanceTimersByTimeAsync(60);
      expect(postMessage).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
