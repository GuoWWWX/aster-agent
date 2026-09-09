import { describe, expect, it, vi } from "vitest";
vi.mock("electron", () => ({ Menu: { buildFromTemplate: vi.fn() } }));
import { textContextMenuItems } from "./text-context-menu.js";

const editFlags = {
  canUndo: false, canRedo: false, canCut: true, canCopy: true,
  canPaste: true, canDelete: true, canSelectAll: true, canEditRichly: false,
};

describe("text context menu", () => {
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
