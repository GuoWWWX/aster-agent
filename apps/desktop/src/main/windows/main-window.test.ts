import { describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  BrowserWindow: class MockBrowserWindow {
    public constructor(public readonly options: Record<string, unknown>) {}
  },
}));

import { createMainWindow } from "./main-window.js";

describe("createMainWindow", () => {
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
