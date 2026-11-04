import { DEFAULT_APPLICATION_SETTINGS, type ApplicationSettings } from "@agent/protocol";
import type { BrowserWindow, Event } from "electron";
import { describe, expect, it, vi } from "vitest";
import type { ApplicationSettingsStore } from "../settings/application-settings-store.js";
import { WindowCloseController } from "./window-close-controller.js";

const native = vi.hoisted(() => ({
  quit: vi.fn(), message: vi.fn(), menus: [] as { label: string; click: () => void }[][],
  trays: [] as { destroy: ReturnType<typeof vi.fn>; on: ReturnType<typeof vi.fn> }[],
}));

vi.mock("electron", () => ({
  app: { getAppPath: () => "desktop", isPackaged: false, quit: native.quit },
  dialog: { showMessageBox: native.message },
  nativeImage: { createFromPath: () => ({ isEmpty: () => false }) },
  Menu: { buildFromTemplate: (items: { label: string; click: () => void }[]) => { native.menus.push(items); return items; } },
  Tray: class {
    public destroy = vi.fn();
    public on = vi.fn();
    public constructor() { native.trays.push(this); }
    public setToolTip() {}
    public setContextMenu() {}
  },
}));

function fixture(behavior: "hide" | "ask" | "quit") {
  native.quit.mockReset(); native.message.mockReset(); native.menus.length = 0; native.trays.length = 0;
  let current: ApplicationSettings = structuredClone(DEFAULT_APPLICATION_SETTINGS);
  current.general.closeBehavior = behavior;
  let onClose: ((event: Event) => void) | undefined;
  const window = { on: (_event: string, listener: (event: Event) => void) => { onClose = listener; },
    hide: vi.fn(), show: vi.fn(), focus: vi.fn(), restore: vi.fn(), isDestroyed: () => false, isMinimized: () => false };
  const settings = { getConfiguration: () => current,
    saveConfiguration: vi.fn((next: ApplicationSettings) => { current = next; return next; }) };
  const report = vi.fn();
  const controller = new WindowCloseController(window as unknown as BrowserWindow, settings as unknown as ApplicationSettingsStore, report);
  const close = () => { const event = { preventDefault: vi.fn() }; onClose?.(event as unknown as Event); return event; };
  return { close, controller, settings, window, report, current: () => current };
}

describe("window close behavior", () => {
  it("hides by default and restores or exits through the tray menu", () => {
    const item = fixture("hide");
    expect(item.close().preventDefault).toHaveBeenCalledOnce();
    expect(item.window.hide).toHaveBeenCalledOnce();
    expect(native.trays).toHaveLength(1);
    native.menus[0]?.[0]?.click();
    expect(item.window.show).toHaveBeenCalledOnce();
    expect(item.window.focus).toHaveBeenCalledOnce();
    native.menus[0]?.[1]?.click();
    expect(native.quit).toHaveBeenCalledOnce();
    item.controller.beginQuit();
    expect(native.trays[0]?.destroy).toHaveBeenCalledOnce();
    expect(item.close().preventDefault).not.toHaveBeenCalled();
  });

  it("asks and remembers an explicit exit choice", async () => {
    const item = fixture("ask");
    native.message.mockResolvedValue({ response: 1, checkboxChecked: true });
    item.close(); item.close();
    await vi.waitFor(() => expect(native.quit).toHaveBeenCalledOnce());
    expect(native.message).toHaveBeenCalledOnce();
    expect(item.current().general.closeBehavior).toBe("quit");
    expect(item.settings.saveConfiguration).toHaveBeenCalledOnce();
  });

  it("can hide for one time without changing the saved preference", async () => {
    const item = fixture("ask");
    native.message.mockResolvedValue({ response: 0, checkboxChecked: false });
    item.close();
    await vi.waitFor(() => expect(item.window.hide).toHaveBeenCalledOnce());
    expect(item.current().general.closeBehavior).toBe("ask");
    expect(item.settings.saveConfiguration).not.toHaveBeenCalled();
  });

  it("keeps the window open when the close dialog is cancelled", async () => {
    const item = fixture("ask");
    native.message.mockResolvedValue({ response: 2, checkboxChecked: true });
    item.close();
    await vi.waitFor(() => expect(native.message).toHaveBeenCalledOnce());
    expect(item.window.hide).not.toHaveBeenCalled();
    expect(native.quit).not.toHaveBeenCalled();
    expect(item.settings.saveConfiguration).not.toHaveBeenCalled();
  });
});
