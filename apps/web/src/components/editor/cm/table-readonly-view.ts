import type { EditorView } from "@codemirror/view";
import { renderTableInlineMarkdown } from "./table-inline-renderer.js";
import {
  serializeMarkdownTable,
  tableCellPointerSelection,
  tableSelectionBounds,
  tableSelectionCoversWholeTable,
  tableSelectionToTsv,
  type MarkdownTable,
  type TableSelection,
} from "./markdown-table.js";
import type { TableWidthMode } from "./table-display-settings.js";
import { measuredBlockWidget } from "./widget-dom.js";

/** Owns the read-only table's DOM listeners; its Widget owns when the returned disposer runs. */
export function createReadonlyTableView(
  view: EditorView,
  { model, tableFrom, tableTo, widthMode, applyDocumentSelectedRows }: {
    model: MarkdownTable;
    tableFrom: number;
    tableTo: number;
    widthMode: TableWidthMode;
    applyDocumentSelectedRows: (element: HTMLElement) => void;
  },
): { element: HTMLElement; dispose: () => void } {
    const wrapper = document.createElement("div");
    wrapper.className = "mk-cm-table-wrapper mk-cm-table-wrapper--readonly";
    wrapper.dataset.tableFrom = String(tableFrom);
    wrapper.tabIndex = 0;
    wrapper.classList.toggle("is-wrap", widthMode === "content");
    const container = measuredBlockWidget(wrapper, "table");

    const tableScroll = document.createElement("div");
    tableScroll.className = "mk-cm-table-scroll";
    const table = document.createElement("table");
    table.className = "mk-cm-table";
    // One/two-dash separators are grammar compatibility, not narrower columns.
    const displayWeights = model.columnWeights?.map((weight) => Math.max(3, weight)) ?? [];
    const hasDistinctWeights = displayWeights.some((weight) => weight !== displayWeights[0]);
    if (hasDistinctWeights) {
      const colgroup = document.createElement("colgroup");
      const totalWeight = displayWeights.reduce((sum, w) => sum + w, 0);
      displayWeights.forEach((weight) => {
        const col = document.createElement("col");
        if (totalWeight > 0) {
          col.style.width = `${((weight / totalWeight) * 100).toFixed(2)}%`;
        }
        colgroup.append(col);
      });
      table.append(colgroup);
    }
    const buildRow = (rowIndex: number, isHeader: boolean) => {
      const row = document.createElement("tr");
      model.rows[rowIndex]?.forEach((cell, columnIndex) => {
        const element = document.createElement(isHeader ? "th" : "td");
        element.dataset.tableRow = String(rowIndex);
        element.dataset.tableColumn = String(columnIndex);
        const alignment = model.alignments[columnIndex] ?? "none";
        if (alignment !== "none") {
          element.style.textAlign = alignment;
        }
        const weight = model.columnWeights?.[columnIndex];
        if (weight !== undefined) {
          element.style.minWidth = `${Math.max(72, Math.min(320, weight * 24))}px`;
        }
        const content = renderTableInlineMarkdown(cell);
        content.removeAttribute("tabindex");
        if (alignment !== "none") {
          content.style.textAlign = alignment;
        }
        element.append(content);
        row.append(element);
      });
      return row;
    };

    if (model.rows.length > 0) {
      const head = document.createElement("thead");
      head.append(buildRow(0, true));
      table.append(head);
    }
    if (model.rows.length > 1) {
      const body = document.createElement("tbody");
      for (let rowIndex = 1; rowIndex < model.rows.length; rowIndex += 1) {
        body.append(buildRow(rowIndex, false));
      }
      table.append(body);
    }
    tableScroll.append(table);
    wrapper.append(tableScroll);
    applyDocumentSelectedRows(wrapper);
    let dragAnchor: number | null = null;
    let finishFrame: number | null = null;
    let cellSelection: TableSelection | null = null;
    let cellDrag: {
      pointerId: number;
      anchor: { row: number; column: number };
      focus: { row: number; column: number };
    } | null = null;
    const clearCellSelection = () => {
      cellSelection = null;
      wrapper.querySelectorAll(".mk-table-selected").forEach((element) => element.classList.remove("mk-table-selected"));
    };
    const applyCellSelection = (next: TableSelection) => {
      cellSelection = next;
      wrapper.querySelectorAll(".mk-table-selected").forEach((element) => element.classList.remove("mk-table-selected"));
      const bounds = tableSelectionBounds(model, next);
      wrapper.querySelectorAll<HTMLElement>("th[data-table-row][data-table-column], td[data-table-row][data-table-column]").forEach((element) => {
        const row = Number(element.dataset.tableRow);
        const column = Number(element.dataset.tableColumn);
        if (row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right) {
          element.classList.add("mk-table-selected");
        }
      });
    };
    const cellAtPoint = (x: number, y: number) => {
      const element = document.elementFromPoint(x, y)
        ?.closest<HTMLElement>("th[data-table-row][data-table-column], td[data-table-row][data-table-column]");
      if (!element || !wrapper.contains(element)) return null;
      const row = Number(element.dataset.tableRow);
      const column = Number(element.dataset.tableColumn);
      return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
    };
    const beginCellSelection = (event: PointerEvent) => {
      if (event.button !== 0) return;
      const cell = cellAtPoint(event.clientX, event.clientY);
      if (!cell) return;
      event.preventDefault();
      event.stopPropagation();
      // 表格内开始拖选时使用和编辑模式一致的单元格选区，不再同时扩展正文行选区。
      dragAnchor = null;
      const nextSelection = tableCellPointerSelection(cellSelection, cell, event.shiftKey);
      if (nextSelection.kind === "range") {
        applyCellSelection(nextSelection);
      } else {
        cellDrag = { pointerId: event.pointerId, anchor: cell, focus: cell };
        applyCellSelection(nextSelection);
      }
      wrapper.focus({ preventScroll: true });
    };
    const updateCellSelection = (event: PointerEvent) => {
      if (!cellDrag || event.pointerId !== cellDrag.pointerId) return;
      const cell = cellAtPoint(event.clientX, event.clientY);
      if (!cell || (cell.row === cellDrag.focus.row && cell.column === cellDrag.focus.column)) return;
      cellDrag.focus = cell;
      applyCellSelection({ kind: "range", anchor: cellDrag.anchor, focus: cell });
    };
    const finishCellSelection = (event: PointerEvent) => {
      if (!cellDrag || event.pointerId !== cellDrag.pointerId) return;
      updateCellSelection(event);
      cellDrag = null;
    };
    const cancelCellSelection = (event: PointerEvent) => {
      if (cellDrag?.pointerId === event.pointerId) cellDrag = null;
    };
    const clearCellSelectionOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !wrapper.contains(event.target)) clearCellSelection();
    };
    const renderedRowAtPoint = (event: MouseEvent) => {
      const cell = document.elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("th[data-table-row], td[data-table-row]");
      if (!cell || !wrapper.contains(cell)) return null;
      const renderedRow = Number(cell.dataset.tableRow);
      return Number.isInteger(renderedRow) && renderedRow >= 0 ? renderedRow : null;
    };
    const applyDocumentSelection = (renderedRow: number, anchor: number) => {
      if (anchor > tableFrom && anchor < tableTo) return;
      const sourceLineIndex = renderedRow === 0 ? 0 : renderedRow + 1;
      const firstLine = view.state.doc.lineAt(tableFrom);
      const sourceLineNumber = firstLine.number + sourceLineIndex;
      if (sourceLineNumber > view.state.doc.lines) return;
      const sourceLine = view.state.doc.line(sourceLineNumber);
      const head = anchor <= tableFrom ? sourceLine.to : sourceLine.from;
      const selection = view.state.selection.main;
      if (selection.anchor !== anchor || selection.head !== head) view.dispatch({ selection: { anchor, head } });
    };
    const captureDocumentSelectionAnchor = (event: MouseEvent) => {
      dragAnchor = null;
      if (event.button !== 0 || !(event.target instanceof Node) || !view.dom.contains(event.target)) return;
      if (event.target instanceof Element) {
        const cell = event.target.closest("th[data-table-row][data-table-column], td[data-table-row][data-table-column]");
        if (cell && wrapper.contains(cell)) return;
      }
      dragAnchor = view.posAtCoords({ x: event.clientX, y: event.clientY });
    };
    const extendDocumentSelectionThroughRow = (event: MouseEvent) => {
      if ((event.buttons & 1) === 0 || dragAnchor === null) return;
      const renderedRow = renderedRowAtPoint(event);
      if (renderedRow === null) return;
      const anchor = dragAnchor;
      queueMicrotask(() => applyDocumentSelection(renderedRow, anchor));
    };
    const finishDocumentSelection = (event: MouseEvent) => {
      if (event.button !== 0 || dragAnchor === null) return;
      const renderedRow = renderedRowAtPoint(event);
      const anchor = dragAnchor;
      dragAnchor = null;
      if (renderedRow === null) return;
      if (finishFrame !== null) cancelAnimationFrame(finishFrame);
      finishFrame = requestAnimationFrame(() => {
        finishFrame = null;
        applyDocumentSelection(renderedRow, anchor);
      });
    };
    document.addEventListener("pointerdown", captureDocumentSelectionAnchor, true);
    document.addEventListener("mousedown", captureDocumentSelectionAnchor, true);
    document.addEventListener("pointerdown", clearCellSelectionOutside, true);
    document.addEventListener("pointermove", extendDocumentSelectionThroughRow, true);
    document.addEventListener("mousemove", extendDocumentSelectionThroughRow, true);
    document.addEventListener("pointerup", finishDocumentSelection, true);
    document.addEventListener("mouseup", finishDocumentSelection, true);
    table.addEventListener("pointerdown", beginCellSelection);
    table.addEventListener("pointermove", updateCellSelection);
    document.addEventListener("pointerup", finishCellSelection, true);
    document.addEventListener("pointercancel", cancelCellSelection, true);
    wrapper.addEventListener("copy", (event) => {
      if (!cellSelection) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", tableSelectionCoversWholeTable(model, cellSelection)
        ? serializeMarkdownTable(model)
        : tableSelectionToTsv(model, cellSelection));
    });
    wrapper.addEventListener("keydown", (event) => {
      if (event.key === "Escape") clearCellSelection();
    });
    const dispose = () => {
      document.removeEventListener("pointerdown", captureDocumentSelectionAnchor, true);
      document.removeEventListener("mousedown", captureDocumentSelectionAnchor, true);
      document.removeEventListener("pointerdown", clearCellSelectionOutside, true);
      document.removeEventListener("pointermove", extendDocumentSelectionThroughRow, true);
      document.removeEventListener("mousemove", extendDocumentSelectionThroughRow, true);
      document.removeEventListener("pointerup", finishDocumentSelection, true);
      document.removeEventListener("mouseup", finishDocumentSelection, true);
      table.removeEventListener("pointerdown", beginCellSelection);
      table.removeEventListener("pointermove", updateCellSelection);
      document.removeEventListener("pointerup", finishCellSelection, true);
      document.removeEventListener("pointercancel", cancelCellSelection, true);
      if (finishFrame !== null) cancelAnimationFrame(finishFrame);
    };
    return { element: container, dispose };
}
