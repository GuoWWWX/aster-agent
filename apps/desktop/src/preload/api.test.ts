import { beforeEach, describe, expect, it, vi } from "vitest";

import { IPC_CHANNELS } from "@agent/protocol";

const electronMocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  on: vi.fn(),
  removeListener: vi.fn(),
  send: vi.fn(),
}));

vi.mock("electron", () => ({
  ipcRenderer: electronMocks,
}));

import { createDesktopBridge } from "./api.js";

describe("Desktop preload bridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sends managed browser bounds without waiting for an invoke round trip", async () => {
    const bridge = createDesktopBridge();
    const input = {
      height: 600,
      sessionId: "00000000-0000-4000-8000-000000000001",
      visible: true,
      width: 900,
      x: 400,
      y: 80,
    };

    await bridge.setManagedBrowserBounds(input);

    expect(electronMocks.send).toHaveBeenCalledWith(
      IPC_CHANNELS.managedBrowserSetBounds,
      input,
    );
    expect(electronMocks.invoke).not.toHaveBeenCalled();
  });
});
