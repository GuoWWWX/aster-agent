import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { NATIVE_OVERLAY_CHANNEL } from "@agent/protocol";

const electron = vi.hoisted(() => ({ exposeInMainWorld: vi.fn(), send: vi.fn(), on: vi.fn(), removeListener: vi.fn() }));
vi.mock("electron", () => ({ contextBridge: electron, ipcRenderer: electron }));
import "./native-overlay.js";

describe("native overlay preload", () => {
  it("keeps Node-only protocol barrel dependencies outside the sandboxed preload", () => {
    const source = readFileSync(new URL("./native-overlay.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from\s*["']@agent\/protocol["']/u);
  });
  it("exposes only a validated region-update bridge", () => {
    expect(electron.exposeInMainWorld).toHaveBeenCalledOnce();
    const [name, bridge] = electron.exposeInMainWorld.mock.calls[0] as [string, {
      update(input: unknown): void;
      onParentFocus(listener: () => void): () => void;
      onResizePointer(listener: (pointer: unknown) => void): () => void;
    }];
    expect(name).toBe("nativeOverlay");
    expect(Object.keys(bridge)).toEqual(["update", "onParentFocus", "onResizePointer"]);
    const input = { regions: [{ x: 1, y: 2, width: 300, height: 150 }], interactive: true };
    bridge.update(input);
    expect(electron.send).toHaveBeenCalledWith(NATIVE_OVERLAY_CHANNEL, input);
    electron.send.mockClear();
    expect(() => bridge.update({ regions: [], interactive: true, channel: "application" })).toThrow();
    expect(electron.send).not.toHaveBeenCalled();
    const listener = vi.fn();
    const unsubscribe = bridge.onParentFocus(listener);
    const notify = electron.on.mock.calls[0]?.[1] as () => void;
    notify();
    expect(listener).toHaveBeenCalledExactlyOnceWith();
    unsubscribe();
    expect(electron.removeListener.mock.calls).toEqual(electron.on.mock.calls);
    const pointerListener = vi.fn();
    const stopPointer = bridge.onResizePointer(pointerListener);
    const relay = electron.on.mock.calls.at(-1)?.[1] as (event: unknown, pointer: unknown) => void;
    relay({}, { phase: "move", x: 400, y: 200 });
    relay({}, { phase: "move", x: Number.NaN, y: 200 });
    expect(pointerListener).toHaveBeenCalledExactlyOnceWith({ phase: "move", x: 400, y: 200 });
    stopPointer();
    expect(electron.removeListener.mock.calls).toEqual(electron.on.mock.calls);
  });
});
