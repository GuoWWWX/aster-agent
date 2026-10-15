import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { NATIVE_OVERLAY_FRAME_NAME } from "@agent/protocol";
const openExternal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const application = vi.hoisted(() => ({ isPackaged: false, getAppPath: () => "C:/aster" }));
vi.mock("electron", () => ({ app: application, shell: { openExternal } }));
import { applyRendererSecurityPolicy, externalHttpUrl, getNativeOverlayUrl } from "./renderer-policy.js";

describe("renderer web links", () => {
  function rendererTarget() {
    return applyRendererSecurityPolicy({ webContents: { setWindowOpenHandler: vi.fn(), on: vi.fn(), session: {
      setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(),
    } } } as unknown as BrowserWindow);
  }
  it("defaults unpackaged Electron to Vite rather than silently loading dist", () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", undefined);
    vi.stubEnv("ASTER_START_MODE", undefined);
    try {
      const target = rendererTarget();
      expect(target.kind).toBe("url");
      expect(target.value.toString()).toBe("http://127.0.0.1:5173/");
    } finally { vi.unstubAllEnvs(); }
  });
  it("uses static assets only for explicit preview or a packaged application", () => {
    vi.stubEnv("ASTER_START_MODE", "preview");
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:5174");
    try {
      expect(rendererTarget()).toEqual({ kind: "file", value: path.resolve("C:/aster", "../web/dist/index.html") });
      application.isPackaged = true;
      expect(rendererTarget()).toEqual({ kind: "file", value: path.join("C:/aster", "renderer/index.html") });
    } finally { application.isPackaged = false; vi.unstubAllEnvs(); }
  });
  it.each(["http://localhost:5173/", "https://example.com/a?q=1", "http://[::1]:8080/"])("permits %s", (url) => {
    expect(externalHttpUrl(url)).toBe(url);
  });
  it.each(["file:///C:/test", "javascript:alert(1)", "data:text/html,x", "https://user:secret@example.com", "https://", "https://exa\\mple.com", "https://exam\nple.com"])("blocks %s", (url) => {
    expect(externalHttpUrl(url)).toBeNull();
  });
  it("opens only validated links externally, never a privileged app window", () => {
    const setWindowOpenHandler = vi.fn();
    const window = { webContents: { setWindowOpenHandler, on: vi.fn(), session: {
      setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(),
    } } } as unknown as BrowserWindow;
    applyRendererSecurityPolicy(window);
    const handler = setWindowOpenHandler.mock.calls[0]?.[0] as (input: { url: string }) => { action: string };
    expect(handler({ url: "https://example.com/" })).toEqual({ action: "deny" });
    expect(openExternal).toHaveBeenCalledWith("https://example.com/");
    openExternal.mockClear();
    expect(handler({ url: "file:///C:/x" })).toEqual({ action: "deny" });
    expect(openExternal).not.toHaveBeenCalled();
  });
  it("allows only the exact internal overlay URL with its reserved frame name", () => {
    vi.stubEnv("ELECTRON_RENDERER_URL", "http://127.0.0.1:5178/");
    vi.stubEnv("ASTER_START_MODE", undefined);
    try {
      const allowWindow = vi.fn(() => ({ action: "allow" as const }));
      const setWindowOpenHandler = vi.fn();
      const window = { webContents: { setWindowOpenHandler, on: vi.fn(), session: {
        setPermissionCheckHandler: vi.fn(), setPermissionRequestHandler: vi.fn(),
      } } } as unknown as BrowserWindow;
      applyRendererSecurityPolicy(window, { allowWindow });
      const handler = setWindowOpenHandler.mock.calls[0]?.[0] as (input: { url: string; frameName: string }) => { action: string };
      const url = "http://127.0.0.1:5178/native-overlay.html";
      expect(handler({ url, frameName: NATIVE_OVERLAY_FRAME_NAME })).toEqual({ action: "allow" });
      expect(allowWindow).toHaveBeenCalledExactlyOnceWith(url);
      for (const input of [
        { url, frameName: "other" },
        { url: `${url}?unexpected`, frameName: NATIVE_OVERLAY_FRAME_NAME },
        { url: "https://example.com/native-overlay.html", frameName: NATIVE_OVERLAY_FRAME_NAME },
      ]) expect(handler(input)).toEqual({ action: "deny" });
      expect(allowWindow).toHaveBeenCalledOnce();
    } finally { vi.unstubAllEnvs(); }
  });
  it("resolves the overlay host beside Vite and packaged renderer entry points", () => {
    expect(getNativeOverlayUrl({ kind: "url", value: new URL("http://localhost:5173/app/index.html?dev=1") }))
      .toBe("http://localhost:5173/app/native-overlay.html");
    expect(getNativeOverlayUrl({ kind: "file", value: path.resolve("C:/aster/renderer/index.html") }))
      .toBe(pathToFileURL(path.resolve("C:/aster/renderer/native-overlay.html")).href);
  });
});
