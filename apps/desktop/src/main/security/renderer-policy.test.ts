import { describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
const openExternal = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock("electron", () => ({ app: { getAppPath: () => "C:/aster" }, shell: { openExternal } }));
import { applyRendererSecurityPolicy, externalHttpUrl } from "./renderer-policy.js";

describe("renderer web links", () => {
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
});
