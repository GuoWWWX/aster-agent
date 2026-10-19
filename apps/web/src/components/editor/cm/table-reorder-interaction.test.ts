// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MarkdownTable } from "./markdown-table.js";
import { createTableReorderInteraction } from "./table-reorder-interaction.js";

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function fixture(dirty = false) {
  const model: MarkdownTable = { rows: [["A", "B"], ["1", "2"]], alignments: ["none", "none"] };
  const wrapper = document.createElement("div");
  wrapper.tabIndex = 0;
  wrapper.innerHTML = '<table><thead><tr><th data-table-column="0"><span class="mk-cm-table-cell-content">A</span></th><th data-table-column="1">B</th></tr></thead></table>';
  const table = wrapper.querySelector("table")!;
  document.body.append(wrapper);
  vi.spyOn(table, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 200, 50));
  table.querySelectorAll("th").forEach((cell, index) => {
    vi.spyOn(cell, "getBoundingClientRect").mockReturnValue(new DOMRect(index * 100, 0, 100, 30));
  });
  const commit = vi.fn();
  const replaceTable = vi.fn();
  const updateSelection = vi.fn();
  const interaction = createTableReorderInteraction({
    table, wrapper, getTable: () => model, isDirty: () => dirty, commit, replaceTable, updateSelection,
  });
  const pointer = (clientX: number) => new PointerEvent("pointerdown", {
    pointerId: 1, clientX, clientY: 15, bubbles: true, cancelable: true,
  });
  return { interaction, pointer, commit, replaceTable };
}

describe("table reorder interaction", () => {
  it("commits the existing dirty draft before starting a drag", () => {
    const { interaction, pointer, commit, replaceTable } = fixture(true);
    interaction.beginReorderDrag("column", 0, pointer(10));
    expect(commit).toHaveBeenCalledOnce();
    expect(replaceTable).not.toHaveBeenCalled();
    expect(document.querySelector(".mk-table-drag-ghost")).toBeNull();
  });

  it("reorders the selected column at the insertion position and removes its visual preview", () => {
    const { interaction, pointer, replaceTable } = fixture();
    interaction.beginReorderDrag("column", 0, pointer(10));
    interaction.finishReorderDrag(pointer(190));
    expect(replaceTable).toHaveBeenCalledWith(
      { rows: [["B", "A"], ["2", "1"]], alignments: ["none", "none"] },
      { kind: "column", index: 1 },
    );
    expect(document.querySelector(".mk-table-drag-ghost")).toBeNull();
    expect(document.querySelector(".mk-table-drop-indicator")).toBeNull();
  });

  it("removes both drag overlays when the owning Widget is destroyed mid-drag", () => {
    const { interaction, pointer, replaceTable } = fixture();
    interaction.beginReorderDrag("column", 0, pointer(10));
    expect(document.querySelector(".mk-table-drop-indicator")).not.toBeNull();
    interaction.clearDragPreview();
    expect(document.querySelector(".mk-table-drag-ghost")).toBeNull();
    expect(document.querySelector(".mk-table-drop-indicator")).toBeNull();
    expect(replaceTable).not.toHaveBeenCalled();
  });
});
