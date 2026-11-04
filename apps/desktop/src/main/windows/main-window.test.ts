import { describe, expect, it, vi } from "vitest";
import path from "node:path";

const electronState = vi.hoisted(() => ({ appPath: "", isPackaged: false }));

vi.mock("electron", () => ({
  app: {
    getAppPath: () => electronState.appPath,
    get isPackaged() { return electronState.isPackaged; },
  },
  BrowserWindow: class MockBrowserWindow {
    public webContents = { on: vi.fn() };
    public constructor(public readonly options: Record<string, unknown>) {}
  },
}));

import { createMainWindow } from "./main-window.js";

describe("createMainWindow", () => {
  it.each([false, true])("loads the application icon in packaged mode=%s", (isPackaged) => {
    electronState.appPath = path.resolve("fixture", "desktop-app");
    electronState.isPackaged = isPackaged;
    try {
      const window = createMainWindow() as unknown as { options: Record<string, unknown> };
      const iconDirectory = isPackaged ? "renderer" : "../web/public";
      expect(window.options.icon).toBe(path.resolve(electronState.appPath, iconDirectory, "aster-logo.png"));
    } finally {
      electronState.isPackaged = false;
    }
  });

  it("keeps frames and timers active when native notifications or overlays cover the window", () => {
    const window = createMainWindow() as unknown as { options: Record<string, unknown> };
    expect(window.options.webPreferences).toMatchObject({ backgroundThrottling: false });
  });
  it("allows width and height to resize independently", () => {
    const window = createMainWindow() as unknown as {
      options: Record<string, unknown>;
      setAspectRatio?: unknown;
    };

    expect(window.options).toMatchObject({
      height: 1080,
      minHeight: 720,
      minWidth: 960,
      width: 1440,
    });
    expect(window.setAspectRatio).toBeUndefined();
  });
});
