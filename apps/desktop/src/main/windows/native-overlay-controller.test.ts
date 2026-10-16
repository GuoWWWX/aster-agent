import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BrowserWindow } from "electron";
import { NATIVE_OVERLAY_BLUR_CHANNEL, NATIVE_OVERLAY_CHANNEL, NATIVE_OVERLAY_FRAME_NAME } from "@agent/protocol";

const electron = vi.hoisted(() => ({ on: vi.fn(), removeListener: vi.fn(), appOn: vi.fn(), appRemoveListener: vi.fn(), cursor: { x: 0, y: 0 } }));
vi.mock("electron", () => ({
  ipcMain: { on: electron.on, removeListener: electron.removeListener },
  app: { on: electron.appOn, removeListener: electron.appRemoveListener },
  screen: { getCursorScreenPoint: () => electron.cursor },
}));
import { NativeOverlayController } from "./native-overlay-controller.js";

class FakeContents extends EventEmitter {
  public isFocused = vi.fn(() => false);
  public mainFrame = {};
  public zoom = 1;
  public getZoomFactor = vi.fn(() => this.zoom);
  public setZoomFactor = vi.fn((zoom: number) => { this.zoom = zoom; });
  public setWindowOpenHandler = vi.fn();
  public send = vi.fn();
}

class FakeWindow extends EventEmitter {
  public webContents = new FakeContents();
  public contentView = { children: [] as { webContents: FakeContents }[] };
  public bounds = { x: 20, y: 30, width: 1200, height: 800 };
  public destroyed = false;
  public focused = false;
  public shown = true;
  public minimized = false;
  public getContentBounds = vi.fn(() => this.bounds);
  public isDestroyed = vi.fn(() => this.destroyed);
  public isFocused = vi.fn(() => this.focused);
  public isVisible = vi.fn(() => this.shown);
  public isMinimized = vi.fn(() => this.minimized);
  public setBounds = vi.fn();
  public setShape = vi.fn();
  public setIgnoreMouseEvents = vi.fn();
  public setFocusable = vi.fn();
  public showInactive = vi.fn();
  public focus = vi.fn();
  public hide = vi.fn();
  public destroy = vi.fn(() => { this.destroyed = true; this.emit("closed"); });
}

const HOST = "http://127.0.0.1:5178/native-overlay.html";
const originalPlatform = process.platform;
const controllers: NativeOverlayController[] = [];
beforeEach(() => { Object.defineProperty(process, "platform", { value: "win32" }); });
function fixture() {
  const parent = new FakeWindow();
  const child = new FakeWindow();
  const controller = new NativeOverlayController(parent as unknown as BrowserWindow);
  controllers.push(controller);
  const receive = electron.on.mock.calls.at(-1)?.[1] as (...args: unknown[]) => void;
  const open = () => {
    const response = controller.allowWindow(HOST);
    parent.webContents.emit("did-create-window", child, { url: HOST, frameName: NATIVE_OVERLAY_FRAME_NAME });
    return response;
  };
  const update = (input: unknown, sender: unknown = child.webContents, senderFrame: unknown = child.webContents.mainFrame) => {
    receive({ sender, senderFrame }, input);
  };
  return { parent, child, controller, open, update, receive };
}
afterEach(() => {
  for (const controller of controllers.splice(0)) controller.dispose();
  vi.clearAllMocks();
  vi.useRealTimers();
  Object.defineProperty(process, "platform", { value: originalPlatform });
});

describe("native overlay host", () => {
  it("releases tooltip mouse interception without a DOM move or blank click, including after selecting text", () => {
    vi.useFakeTimers();
    const { parent, child, controller, open, update } = fixture();
    parent.webContents.zoom = 2;
    electron.cursor = { x: 40, y: 60 };
    open();
    const input = { regions: [{ x: 100, y: 50, width: 200, height: 60 }], interactive: false, tooltipOnly: true };
    update(input);
    expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    expect(child.focus).not.toHaveBeenCalled();
    electron.cursor = { x: 260, y: 170 };
    vi.advanceTimersByTime(16);
    expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(child.webContents.send).toHaveBeenLastCalledWith("native_overlay.tooltip_pointer", { x: 120, y: 70 });
    update({ ...input, interactive: true });
    child.focused = true;
    electron.cursor = { x: 40, y: 60 };
    vi.advanceTimersByTime(16);
    expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(true, { forward: true });
    expect(parent.focus).toHaveBeenCalledOnce();
    update({ regions: [], interactive: false });
    expect(vi.getTimerCount()).toBe(0);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("stops cursor tracking for ordinary overlays and releases an active tracker on destruction", () => {
    vi.useFakeTimers();
    const { child, controller, open, update } = fixture();
    electron.cursor = { x: 120, y: 130 };
    open();
    const input = { regions: [{ x: 90, y: 90, width: 100, height: 60 }], interactive: false, tooltipOnly: true };
    update(input);
    expect(vi.getTimerCount()).toBe(1);
    update({ ...input, tooltipOnly: false, interactive: true });
    expect(vi.getTimerCount()).toBe(0);
    expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    update(input);
    expect(vi.getTimerCount()).toBe(1);
    controller.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(["parent", "child"] as const)("releases %s after Electron invalidates the window's webContents getter", (target) => {
    const { parent, child, controller, open } = fixture();
    open();
    const window = target === "parent" ? parent : child;
    const contents = window.webContents;
    Object.defineProperty(window, "webContents", { get: () => {
      if (window.destroyed) throw new Error("Object has been destroyed");
      return contents;
    } });
    expect(() => window.destroy()).not.toThrow();
    expect(contents.eventNames()).toEqual([]);
    if (target === "child") expect(controller.allowWindow(HOST).action).toBe("allow");
  });
  it("forwards each native browser mouse move before release without covering or hiding the page", () => {
    const { parent, child, open, update } = fixture();
    const guest = new FakeContents();
    parent.contentView.children.push({ webContents: guest });
    parent.webContents.zoom = 2;
    open();
    update({ regions: [], interactive: false, resizing: true });
    const preventDefault = vi.fn();
    for (const globalX of [400, 480, 360]) {
      guest.emit("before-mouse-event", { preventDefault }, { type: "mouseMove", globalX, globalY: 230 });
      expect(child.webContents.send).toHaveBeenLastCalledWith("native_overlay.resize_pointer", { phase: "move", x: (globalX - 20) / 2, y: 100 });
    }
    expect(child.showInactive).not.toHaveBeenCalled();
    guest.emit("before-mouse-event", { preventDefault }, { type: "mouseUp", button: "left", globalX: 360, globalY: 230 });
    expect(child.webContents.send).toHaveBeenLastCalledWith("native_overlay.resize_pointer", { phase: "end", x: 170, y: 100 });
    expect(guest.listenerCount("before-mouse-event")).toBe(0);
    expect(parent.webContents.listenerCount("before-mouse-event")).toBe(0);
  });
  it("does not create a full-window input host on platforms without native window shapes", () => {
    const { controller } = fixture();
    Object.defineProperty(process, "platform", { value: "darwin" });
    expect(controller.allowWindow(HOST)).toEqual({ action: "deny" });
    Object.defineProperty(process, "platform", { value: "linux" });
    expect(controller.allowWindow(HOST).action).toBe("allow");
  });
  it("creates only a transparent child with a dedicated isolated preload", () => {
    const { parent, child, controller, open } = fixture();
    expect(open()).toMatchObject({ action: "allow", overrideBrowserWindowOptions: {
      parent,
      x: 20, y: 30, width: 1200, height: 800,
      frame: false, transparent: true, show: false, skipTaskbar: true, hasShadow: false,
      resizable: false, thickFrame: false, backgroundColor: "#00000000",
      webPreferences: { nodeIntegration: false, sandbox: true, contextIsolation: true, webSecurity: true, webviewTag: false, backgroundThrottling: false },
    } });
    const options = controller.allowWindow(HOST);
    expect(options).toEqual({ action: "deny" });
    expect(child.hide).toHaveBeenCalled();
    const openHandler = child.webContents.setWindowOpenHandler.mock.calls[0]?.[0] as () => { action: string };
    expect(openHandler()).toEqual({ action: "deny" });
  });

  it("accepts bounded regions only from the current child main frame", () => {
    const { parent, child, open, update } = fixture();
    open();
    const input = { regions: [{ x: 10, y: 20, width: 300, height: 100 }], interactive: true };
    update(input, parent.webContents, parent.webContents.mainFrame);
    update(input, child.webContents, {});
    update({ ...input, unexpected: true });
    update({ ...input, regions: [{ x: -1, y: 0, width: 300, height: 100 }] });
    expect(child.showInactive).not.toHaveBeenCalled();
    update(input);
    expect(child.showInactive).toHaveBeenCalledOnce();
    expect(child.focus).toHaveBeenCalledOnce();
    expect(child.setFocusable).toHaveBeenLastCalledWith(true);
    expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    if (process.platform !== "darwin") expect(child.setShape).toHaveBeenLastCalledWith(input.regions);
  });

  it("matches parent zoom and clips native shapes while preserving pointer input without stealing keyboard focus", () => {
    const { parent, child, open, update } = fixture();
    parent.webContents.zoom = 2;
    const response = open();
    expect(response.overrideBrowserWindowOptions?.webPreferences?.preload).toMatch(/[/\\]preload[/\\]native-overlay\.cjs$/u);
    update({ regions: [{ x: 500, y: 350, width: 200, height: 200 }, { x: 700, y: 0, width: 10, height: 10 }], interactive: false });
    expect(child.webContents.setZoomFactor).toHaveBeenCalledWith(2);
    if (process.platform !== "darwin") expect(child.setShape).toHaveBeenLastCalledWith([{ x: 1000, y: 700, width: 200, height: 100 }]);
    expect(child.setFocusable).toHaveBeenLastCalledWith(false);
    expect(child.setIgnoreMouseEvents).toHaveBeenLastCalledWith(false);
    expect(child.showInactive).toHaveBeenCalledOnce();
    expect(child.focus).not.toHaveBeenCalled();
  });

  it("tracks moving/resizing the parent and focuses only on a new interactive opening", () => {
    const { parent, child, open, update } = fixture();
    open();
    const input = { regions: [{ x: 1, y: 2, width: 300, height: 100 }], interactive: true };
    update(input);
    update(input);
    parent.bounds = { x: 50, y: 60, width: 900, height: 700 };
    parent.emit("move"); parent.emit("resize");
    expect(child.setBounds).toHaveBeenLastCalledWith(parent.bounds);
    expect(child.setBounds).toHaveBeenCalledTimes(2);
    expect(child.focus).toHaveBeenCalledOnce();
    expect(child.showInactive).toHaveBeenCalledOnce();
    update({ regions: [], interactive: false });
    update(input);
    expect(child.showInactive).toHaveBeenCalledTimes(2);
    expect(child.focus).toHaveBeenCalledTimes(2);
    expect(child.setBounds).toHaveBeenCalledTimes(2);
  });

  it("hides empty regions and hidden/minimized parents without retaining a native rectangle", () => {
    const { parent, child, open, update } = fixture();
    open();
    const input = { regions: [{ x: 1, y: 2, width: 300, height: 100 }], interactive: true };
    update(input);
    child.focused = true;
    update({ regions: [], interactive: false });
    expect(parent.focus).toHaveBeenCalledOnce();
    expect(child.hide).toHaveBeenCalledTimes(2);
    parent.minimized = true;
    update(input);
    expect(child.hide).toHaveBeenCalledTimes(3);
    parent.minimized = false; parent.shown = false; parent.emit("hide");
    expect(child.hide).toHaveBeenCalledTimes(4);
  });

  it("denies host navigation, redirects, nested frames and additional windows", () => {
    const { child, open } = fixture();
    open();
    const event = { preventDefault: vi.fn() };
    child.webContents.emit("will-navigate", event, HOST);
    expect(event.preventDefault).not.toHaveBeenCalled();
    child.webContents.emit("will-navigate", event, "https://example.com");
    child.webContents.emit("will-redirect", event, `${HOST}?unexpected`);
    child.webContents.emit("will-frame-navigate", { ...event, isMainFrame: false, url: HOST });
    expect(event.preventDefault).toHaveBeenCalledTimes(3);
  });

  it("notifies outside clicks on the parent without closing overlays when another app gains focus", () => {
    vi.useFakeTimers();
    const { parent, child, open, update } = fixture();
    open(); update({ regions: [{ x: 1, y: 2, width: 300, height: 100 }], interactive: true });
    child.emit("blur"); vi.runAllTimers();
    expect(child.webContents.send).not.toHaveBeenCalled();
    parent.focused = true; parent.emit("focus");
    vi.runAllTimers();
    expect(child.webContents.send).toHaveBeenCalledExactlyOnceWith(NATIVE_OVERLAY_BLUR_CHANNEL);
    child.webContents.send.mockClear();
    update({ regions: [], interactive: false });
    child.emit("blur"); vi.runAllTimers(); parent.emit("focus");
    vi.runAllTimers();
    expect(child.webContents.send).not.toHaveBeenCalled();
  });

  it("releases crashed children and rejects stale messages before allowing a replacement", () => {
    const { parent, child, controller, open, update } = fixture();
    open();
    child.webContents.emit("render-process-gone");
    expect(child.destroy).toHaveBeenCalledOnce();
    expect(child.webContents.eventNames()).toEqual([]);
    expect(child.eventNames()).toEqual([]);
    const next = new FakeWindow();
    expect(controller.allowWindow(HOST).action).toBe("allow");
    parent.webContents.emit("did-create-window", next, { url: HOST, frameName: NATIVE_OVERLAY_FRAME_NAME });
    update({ regions: [{ x: 1, y: 2, width: 300, height: 100 }], interactive: true });
    expect(next.showInactive).not.toHaveBeenCalled();
  });

  it("does not dismiss a new opening from a blur queued while the previous overlay was hidden", () => {
    vi.useFakeTimers();
    const { parent, child, open, update } = fixture();
    open();
    const input = { regions: [{ x: 100, y: 100, width: 300, height: 100 }], interactive: true };
    update(input);
    update({ regions: [], interactive: false });
    child.emit("blur");
    update(input);
    parent.focused = true;
    vi.runAllTimers();
    parent.emit("focus");
    vi.runAllTimers();
    expect(child.webContents.send).not.toHaveBeenCalled();
  });

  it("leaves Renderer clicks to Radix instead of racing them with Escape", () => {
    vi.useFakeTimers();
    const { parent, child, open, update } = fixture();
    open();
    update({ regions: [{ x: 100, y: 100, width: 300, height: 100 }], interactive: true });
    child.emit("blur");
    parent.focused = true;
    parent.emit("focus");
    parent.webContents.isFocused.mockReturnValue(true);
    vi.runAllTimers();
    expect(child.webContents.send).not.toHaveBeenCalled();
    parent.webContents.isFocused.mockReturnValue(false);
    parent.emit("focus"); vi.runAllTimers();
    expect(child.webContents.send).not.toHaveBeenCalled();
  });

  it("cancels a pending blur when the overlay regains focus", () => {
    vi.useFakeTimers();
    const { parent, child, open, update } = fixture();
    open();
    update({ regions: [{ x: 100, y: 100, width: 300, height: 100 }], interactive: true });
    child.emit("blur"); child.emit("focus");
    parent.focused = true;
    parent.emit("focus"); vi.runAllTimers();
    expect(child.webContents.send).not.toHaveBeenCalled();
  });

  it("releases the previous document's host on parent navigation but preserves it for frames and same-document changes", () => {
    const { parent, child, controller, open, update } = fixture();
    open();
    parent.webContents.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
    parent.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: true });
    expect(child.destroy).not.toHaveBeenCalled();
    expect(controller.allowWindow(HOST)).toEqual({ action: "deny" });
    parent.webContents.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
    expect(child.destroy).toHaveBeenCalledOnce();
    expect(child.webContents.eventNames()).toEqual([]);
    const next = new FakeWindow();
    expect(controller.allowWindow(HOST).action).toBe("allow");
    parent.webContents.emit("did-create-window", next, { url: HOST, frameName: NATIVE_OVERLAY_FRAME_NAME });
    expect(next.setBounds).toHaveBeenCalledExactlyOnceWith(parent.bounds);
    update({ regions: [{ x: 1, y: 2, width: 100, height: 100 }], interactive: true });
    expect(next.showInactive).not.toHaveBeenCalled();
  });

  it("unregisters every listener and destroys the child exactly once on parent close", () => {
    const { parent, child, controller, open } = fixture();
    open(); parent.emit("closed"); controller.dispose();
    expect(child.destroy).toHaveBeenCalledOnce();
    expect(parent.eventNames()).toEqual([]);
    expect(parent.webContents.eventNames()).toEqual([]);
    expect(child.eventNames()).toEqual([]);
    expect(child.webContents.eventNames()).toEqual([]);
    expect(electron.on).toHaveBeenCalledExactlyOnceWith(NATIVE_OVERLAY_CHANNEL, expect.any(Function));
    expect(electron.removeListener.mock.calls).toEqual(electron.on.mock.calls);
    expect(electron.appRemoveListener.mock.calls).toEqual(electron.appOn.mock.calls);
    expect(controller.allowWindow(HOST)).toEqual({ action: "deny" });
  });
});
