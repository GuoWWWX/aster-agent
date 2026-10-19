import { describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { BrowserWindow, ContextMenuParams, MenuItemConstructorOptions } from "electron";
const menu = vi.hoisted(() => ({ build: vi.fn<(items: MenuItemConstructorOptions[]) => { popup: ReturnType<typeof vi.fn> }>(() => ({ popup: vi.fn() })) }));
vi.mock("electron", () => ({ Menu: { buildFromTemplate: menu.build } }));
import { installTextContextMenu, textContextMenuItems } from "./text-context-menu.js";

const editFlags = {
  canUndo: false, canRedo: false, canCut: true, canCopy: true,
  canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false,
};

describe("text context menu", () => {
  it("copies image pixels at the clicked position and releases the native listener", () => {
    const contents = Object.assign(new EventEmitter(), { copyImageAt: vi.fn(), isDestroyed: () => false });
    const window = { webContents: contents } as unknown as BrowserWindow;
    const dispose = installTextContextMenu(window);
    contents.emit("context-menu", {}, { mediaType: "image", hasImageContents: true, x: 34, y: 56,
      isEditable: false, selectionText: "", editFlags });
    const items = menu.build.mock.calls.at(-1)?.[0];
    expect(items?.map(item => item.label)).toEqual(["复制图片"]);
    items?.[0]?.click?.({} as Electron.MenuItem, window, {});
    expect(contents.copyImageAt).toHaveBeenCalledWith(34, 56);
    contents.emit("context-menu", {}, { mediaType: "image", hasImageContents: false,
      isEditable: false, selectionText: "", editFlags } satisfies Partial<ContextMenuParams>);
    expect(menu.build.mock.calls.at(-1)?.[0]).toBe(items);
    dispose();
    expect(contents.listenerCount("context-menu")).toBe(0);
  });
  it("offers only copy for selected read-only text", () => {
    expect(textContextMenuItems({ isEditable: false, selectionText: "hello", editFlags }))
      .toEqual([{ label: "复制", role: "copy", enabled: true }]);
  });
  it("does not show an unrelated menu on empty read-only surfaces", () => {
    expect(textContextMenuItems({ isEditable: false, selectionText: "", editFlags })).toEqual([]);
  });
  it("offers cut, copy and paste for editable text", () => {
    expect(textContextMenuItems({ isEditable: true, selectionText: "hello", editFlags }))
      .toEqual([
        { label: "剪切", role: "cut", enabled: true },
        { label: "复制", role: "copy", enabled: true },
        { label: "粘贴", role: "paste", enabled: true },
      ]);
  });
  it("honors Chromium edit permissions for empty or protected fields", () => {
    const items = textContextMenuItems({ isEditable: true, selectionText: "", editFlags: {
      ...editFlags, canCopy: false, canCut: false, canPaste: false,
    } });
    expect(items.every((item) => item.enabled === false)).toBe(true);
  });
});
