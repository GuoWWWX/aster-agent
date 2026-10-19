import { describe, expect, it, vi } from "vitest";
import { PreviewInspector } from "./preview-inspector.js";

function fixture() {
  const previews = { create: vi.fn().mockResolvedValue({ id: "preview", url: "http://127.0.0.1:1234/token/index.html" }), release: vi.fn() };
  const browser = { open: vi.fn().mockResolvedValue({ sessionId: "session", title: "Preview", url: "http://127.0.0.1:1234/token/index.html", zoomPercent: 100, isLoading: false, canGoBack: false, canGoForward: false }),
    observe: vi.fn().mockResolvedValue({ text: "0", title: "Preview", elements: [], viewport: { width: 800, height: 600 } }),
    capture: vi.fn().mockResolvedValue({ data: "aGVsbG8=", width: 800, height: 600, mimeType: "image/jpeg" }), interact: vi.fn().mockResolvedValue(undefined), close: vi.fn() };
  return { previews, browser, inspector: new PreviewInspector(previews, browser) };
}
const input = () => ({ source: { kind: "code" as const, html: "<button>0</button>", conversationId: "00000000-0000-4000-8000-000000000001" }, width: 800, height: 600, frames: 3, intervalMs: 100, signal: new AbortController().signal });
describe("preview inspection", () => {
  it("renders one hidden page for multiple frames and returns vision input without final delivery", async () => {
    const f = fixture(); const result = await f.inspector.inspect(input());
    expect(f.browser.open).toHaveBeenCalledTimes(1); expect(f.browser.open.mock.calls[0]?.[1]).toMatchObject({ isolated: true, background: { width: 800, height: 600 } });
    expect(f.browser.capture).toHaveBeenCalledTimes(3); expect(result.modelAttachments).toHaveLength(3);
    expect(result.modelAttachments?.map(image => image.id).every((id, i, ids) => ids.indexOf(id) === i)).toBe(true);
    expect(result.content).not.toContain('"presentation"'); expect(result.content).not.toContain("aGVsbG8=");
    expect(result.content).not.toContain("http://"); expect(result.content).not.toContain('"elements"');
    expect(f.browser.close).toHaveBeenCalledOnce(); expect(f.previews.release).toHaveBeenCalledOnce();
  });
  it("reuses the managed interaction port for a bounded sequence before observation and capture", async () => {
    const f = fixture(); await f.inspector.inspect({ ...input(), frames: 1, actions: [{ action: "key", key: "Tab" }, { action: "key", key: "Enter" }, { action: "click", x: 30, y: 40 }] });
    expect(f.browser.interact.mock.calls.map(call => call[0] as unknown)).toEqual([
      { sessionId: "session", kind: "key", key: "Tab", modifiers: [] },
      { sessionId: "session", kind: "key", key: "Enter", modifiers: [] },
      { sessionId: "session", kind: "click", x: 30, y: 40, button: "left", clickCount: 1 },
    ]);
    expect(f.browser.interact.mock.invocationCallOrder.at(-1)).toBeLessThan(f.browser.observe.mock.invocationCallOrder[0]!);
    expect(f.browser.capture).toHaveBeenCalledTimes(2);
    expect(f.browser.observe.mock.invocationCallOrder[0]).toBeLessThan(f.browser.capture.mock.invocationCallOrder[1]!);
  });
  it("releases the browser and preview on capture failure", async () => {
    const f = fixture(); f.browser.capture.mockRejectedValue(new Error("capture failed"));
    await expect(f.inspector.inspect(input())).rejects.toThrow("capture failed");
    expect(f.browser.close).toHaveBeenCalledOnce(); expect(f.previews.release).toHaveBeenCalledOnce();
  });
  it("does not open or capture after cancellation", async () => {
    const f = fixture(), controller = new AbortController(); controller.abort();
    await expect(f.inspector.inspect({ ...input(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.previews.create).not.toHaveBeenCalled(); expect(f.browser.open).not.toHaveBeenCalled();
  });
  it("discards a final capture that arrives after cancellation", async () => {
    const f = fixture(), controller = new AbortController();
    f.browser.capture.mockImplementation(() => {
      controller.abort();
      return Promise.resolve({ data: "aGVsbG8=", width: 800, height: 600, mimeType: "image/jpeg" });
    });
    await expect(f.inspector.inspect({ ...input(), frames: 1, signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.browser.close).toHaveBeenCalledOnce(); expect(f.previews.release).toHaveBeenCalledOnce();
  });
  it("releases the preview when opening the browser fails", async () => {
    const f = fixture(); f.browser.open.mockRejectedValue(new Error("open failed"));
    await expect(f.inspector.inspect(input())).rejects.toThrow("open failed");
    expect(f.browser.close).not.toHaveBeenCalled(); expect(f.previews.release).toHaveBeenCalledOnce();
  });
  it("does not open a browser when cancelled during compilation", async () => {
    const f = fixture(), controller = new AbortController();
    f.previews.create.mockImplementation(() => { controller.abort(); return Promise.resolve({ id: "preview", url: "http://127.0.0.1:1234/token/index.html" }); });
    await expect(f.inspector.inspect({ ...input(), signal: controller.signal })).rejects.toMatchObject({ name: "AbortError" });
    expect(f.browser.open).not.toHaveBeenCalled(); expect(f.previews.release).toHaveBeenCalledOnce();
  });
});
