import { createReadonlyTableView } from "./table-readonly-view.js";
import { redo, undo } from "@codemirror/commands";
import { EditorView, WidgetType } from "@codemirror/view";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ArrowDownToLine,
  ArrowLeft,
  ArrowLeftToLine,
  ArrowRight,
  ArrowRightToLine,
  ArrowUpToLine,
  ClipboardPaste,
  Code2,
  Columns3,
  Copy,
  GripHorizontal,
  GripVertical,
  Rows3,
  Scissors,
  Table2,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { TableWidthModeIcon } from "../table-width-mode-icon.js";
import {
  applyTableOperation,
  clearTableSelection,
  pasteTableTsv,
  reorderTableColumn,
  reorderTableRow,
  serializeMarkdownTable,
  tableOperationFocus,
  tableCellPointerSelection,
  tableSelectionBounds,
  tableSelectionCoversWholeTable,
  tableSelectionToTsv,
  type MarkdownTable,
  type TableOperation,
  type TableSelection,
} from "./markdown-table.js";
import { TableCellCompositionGuard } from "./table-cell-edit.js";
import { setTableWidthModeEffect, tableContextChangeEvent, type TableWidthMode } from "./table-display-settings.js";
import { renderTableInlineMarkdown } from "./table-inline-renderer.js";
import { measuredBlockWidget, iconMarkup } from "./widget-dom.js";
import { editTableSourceEffect, selectWholeTableEffect } from "./widget-effects.js";

export { editMermaidSourceEffect, editTableSourceEffect, selectWholeTableEffect } from "./widget-effects.js";
export { MarkdownMathWidget, MarkdownBreakWidget, CopyCodeWidget, BulletWidget, OrderedListWidget, TaskCheckboxWidget } from "./text-widgets.js";
export { refreshLiveMermaidTheme, MermaidWidget } from "./mermaid-widget.js";
export { MarkdownImageWidget } from "./image-widget.js";
export { MarkdownLinkIconWidget, MarkdownWikilinkWidget, MarkdownCalloutIconWidget, MarkdownFrontmatterWidget } from "./inline-widgets.js";

function tableWidthModeIconMarkup(mode: TableWidthMode): string {
  return renderToStaticMarkup(createElement(TableWidthModeIcon, { mode, width: 16, height: 16 }));
}

/** GFM 表格的可编辑渲染态 widget。草稿只在提交时一次性写回 Markdown。 */
export class TableWidget extends WidgetType {
  private readonly cleanups = new WeakMap<HTMLElement, () => void>();
  constructor(
    private readonly model: MarkdownTable,
    private readonly source: string,
    private readonly tableFrom: number,
    private readonly tableTo: number,
    private readonly widthMode: TableWidthMode,
    private readonly documentSelectedRows: readonly number[],
    private readonly selectedFromToolbar: boolean,
    private readonly editable: boolean,
  ) {
    super();
  }

  override eq(other: TableWidget): boolean {
    return this.hasSameRenderedTable(other)
      && other.documentSelectedRows.length === this.documentSelectedRows.length
      && other.documentSelectedRows.every((row, index) => row === this.documentSelectedRows[index]);
  }

  override updateDOM(dom: HTMLElement, _view: EditorView, previous: TableWidget): boolean {
    if (!this.hasSameRenderedTable(previous)) return false;
    const cleanup = previous.cleanups.get(dom);
    if (cleanup) {
      this.cleanups.set(dom, cleanup);
      previous.cleanups.delete(dom);
    }
    if (!this.selectedFromToolbar) this.applyDocumentSelectedRows(dom);
    return true;
  }

  private hasSameRenderedTable(other: TableWidget): boolean {
    return other.source === this.source
      && other.tableFrom === this.tableFrom
      && other.tableTo === this.tableTo
      && other.widthMode === this.widthMode
      && other.selectedFromToolbar === this.selectedFromToolbar
      && other.editable === this.editable;
  }

  private applyDocumentSelectedRows(dom: HTMLElement): void {
    const selectedRows = new Set(this.documentSelectedRows);
    dom.querySelectorAll<HTMLElement>("th[data-table-row], td[data-table-row]").forEach((element) => {
      element.classList.toggle("mk-table-selected", selectedRows.has(Number(element.dataset.tableRow)));
    });
  }

  /** 阅读模式只保留表格渲染，不能进入单元格、拖拽或源码操作。 */
  private createReadonlyDOM(view: EditorView): HTMLElement {
    const rendered = createReadonlyTableView(view, {
      model: this.model, tableFrom: this.tableFrom, tableTo: this.tableTo, widthMode: this.widthMode,
      applyDocumentSelectedRows: element => this.applyDocumentSelectedRows(element),
    });
    this.cleanups.set(rendered.element, rendered.dispose);
    return rendered.element;
  }

  override toDOM(view: EditorView): HTMLElement {
    if (!this.editable) return this.createReadonlyDOM(view);
    const wrapper = document.createElement("div");
    wrapper.className = "mk-cm-table-wrapper";
    wrapper.dataset.tableFrom = String(this.tableFrom);
    wrapper.tabIndex = 0;
    const container = measuredBlockWidget(wrapper, "table");
    wrapper.addEventListener("pointerdown", (event) => event.stopPropagation());
    const announceTableContext = () => {
      (view.dom.parentElement ?? view.dom).dispatchEvent(new CustomEvent(tableContextChangeEvent, {
        bubbles: true,
        detail: { tableFrom: this.tableFrom },
      }));
    };
    wrapper.addEventListener("pointerdown", announceTableContext, true);
    wrapper.addEventListener("focusin", announceTableContext);

    let cellDrag: {
      pointerId: number;
      anchor: { row: number; column: number };
      focus: { row: number; column: number };
      dragged: boolean;
    } | null = null;

    const extendDocumentSelectionThroughRow = (event: MouseEvent) => {
      if ((event.buttons & 1) === 0 || cellDrag) return;
      const cell = document.elementFromPoint(event.clientX, event.clientY)
        ?.closest<HTMLElement>("th[data-table-row], td[data-table-row]");
      if (!cell || !wrapper.contains(cell)) return;
      const renderedRow = Number(cell.dataset.tableRow);
      if (!Number.isInteger(renderedRow) || renderedRow < 0) return;

      queueMicrotask(() => {
        const selection = view.state.selection.main;
        if (selection.empty || (selection.anchor > this.tableFrom && selection.anchor < this.tableTo)) return;
        const sourceLineIndex = renderedRow === 0 ? 0 : renderedRow + 1;
        const firstLine = view.state.doc.lineAt(this.tableFrom);
        const sourceLineNumber = firstLine.number + sourceLineIndex;
        if (sourceLineNumber > view.state.doc.lines) return;
        const sourceLine = view.state.doc.line(sourceLineNumber);
        const head = selection.anchor <= this.tableFrom ? sourceLine.to : sourceLine.from;
        if (selection.head !== head) view.dispatch({ selection: { anchor: selection.anchor, head } });
      });
    };

    let draft: MarkdownTable = {
      rows: this.model.rows.map((row) => [...row]),
      alignments: [...this.model.alignments],
      ...(this.model.columnWeights ? { columnWeights: [...this.model.columnWeights] } : {}),
    };
    let dirty = false;
    const composition = new TableCellCompositionGuard();
    const animationFrameIds = new Set<number>();
    const scheduleFrame = (callback: FrameRequestCallback) => {
      const id = requestAnimationFrame((time) => {
        animationFrameIds.delete(id);
        callback(time);
      });
      animationFrameIds.add(id);
    };
    let active: { row: number; column: number } | null = null;
    let selection: TableSelection | null = null;
    let wholeTableSelected = false;
    let clearingToolbarSelection = false;
    const clearSelectedFromToolbar = () => {
      if (!this.selectedFromToolbar || clearingToolbarSelection) return;
      clearingToolbarSelection = true;
      scheduleFrame(() => view.dispatch({ effects: selectWholeTableEffect.of(null) }));
    };
    // 默认按表格内容收缩，避免只有少量列时无意义地铺满编辑区。
    let wrapsContent = this.widthMode === "content";

    const focusCell = (row: number, column: number, selectAll = false) => {
      scheduleFrame(() => {
        const current = view.dom.querySelector<HTMLTextAreaElement>(
          `.mk-cm-table-wrapper[data-table-from="${this.tableFrom}"] .mk-cm-table-input[data-table-row="${row}"][data-table-column="${column}"]`,
        );
        if (!current) return;
        current.hidden = false;
        current.parentElement?.querySelector<HTMLElement>(".mk-cm-table-cell-content")?.classList.add("is-editing");
        current.focus();
        if (selectAll) {
          current.select();
        } else {
          const len = current.value.length;
          current.setSelectionRange(len, len);
        }
      });
    };

    const commit = (focus?: { row: number; column: number }) => {
      const previous = active;
      if (!dirty) {
        if (focus) focusCell(focus.row, focus.column, true);
        else if (previous) {
          const input = wrapper.querySelector<HTMLTextAreaElement>(`.mk-cm-table-input[data-table-row="${previous.row}"][data-table-column="${previous.column}"]`);
          if (input) input.hidden = true;
          input?.parentElement?.querySelector<HTMLElement>(".mk-cm-table-cell-content")?.classList.remove("is-editing");
        }
        return;
      }
      const insert = serializeMarkdownTable(draft);
      dirty = false;
      if (insert !== this.source) view.dispatch({ changes: { from: this.tableFrom, to: this.tableTo, insert } });
      if (focus) focusCell(focus.row, focus.column);
    };

    const cancel = () => {
      draft = {
        rows: this.model.rows.map((row) => [...row]),
        alignments: [...this.model.alignments],
        ...(this.model.columnWeights ? { columnWeights: [...this.model.columnWeights] } : {}),
      };
      dirty = false;
      wrapper.querySelectorAll<HTMLTextAreaElement>(".mk-cm-table-input").forEach((input) => {
        const row = Number(input.dataset.tableRow);
        const column = Number(input.dataset.tableColumn);
        input.value = draft.rows[row]?.[column] ?? "";
        input.hidden = true;
        input.parentElement?.querySelector<HTMLElement>(".mk-cm-table-cell-content")?.classList.remove("is-editing");
      });
      active = null;
    };

    const refreshToolbar = () => {
      const column = selection?.kind === "column" ? selection.index : -1;
      const row = selection?.kind === "row" ? selection.index : -1;
      columnTools.hidden = column < 0;
      rowTools.hidden = row < 0;
      moveColumnLeftButton.disabled = column <= 0;
      moveColumnRightButton.disabled = column < 0 || column >= draft.alignments.length - 1;
      deleteColumnButton.disabled = column < 0 || draft.alignments.length <= 1;
      insertRowAboveButton.disabled = row < 0;
      deleteRowButton.disabled = row < 0 || draft.rows.length <= 1;
    };

    const updateSelection = (next: TableSelection, selectWholeTable = false) => {
      if (next.kind === "range") {
        const bounds = tableSelectionBounds(draft, next);
        const isWholeRow = bounds.top === bounds.bottom
          && bounds.left === 0
          && bounds.right === draft.alignments.length - 1;
        const isWholeColumn = bounds.left === bounds.right
          && bounds.top === 0
          && bounds.bottom === draft.rows.length - 1;
        selection = isWholeRow && !isWholeColumn
          ? { kind: "row", index: bounds.top }
          : isWholeColumn && !isWholeRow
            ? { kind: "column", index: bounds.left }
            : next;
      } else {
        selection = next;
      }
      wholeTableSelected = selectWholeTable;
      if (!selectWholeTable) clearSelectedFromToolbar();
      wrapper.classList.toggle("is-toolbar-selected", wholeTableSelected);
      wrapper.querySelectorAll(".mk-table-selected").forEach((element) => element.classList.remove("mk-table-selected"));
      const bounds = tableSelectionBounds(draft, selection);
      wrapper.querySelectorAll<HTMLElement>("th[data-table-row][data-table-column], td[data-table-row][data-table-column]").forEach((element) => {
        const row = Number(element.dataset.tableRow);
        const column = Number(element.dataset.tableColumn);
        if (row >= bounds.top && row <= bounds.bottom && column >= bounds.left && column <= bounds.right) {
          element.classList.add("mk-table-selected");
        }
      });
      refreshToolbar();
    };

    const clearSelection = () => {
      selection = null;
      wholeTableSelected = false;
      wrapper.classList.remove("is-toolbar-selected");
      clearSelectedFromToolbar();
      wrapper.querySelectorAll(".mk-table-selected").forEach((element) => element.classList.remove("mk-table-selected"));
      refreshToolbar();
    };

    const cellAtPoint = (x: number, y: number) => {
      const target = document.elementFromPoint(x, y)
        ?.closest<HTMLElement>("th[data-table-row][data-table-column], td[data-table-row][data-table-column]");
      if (!target || !wrapper.contains(target)) return null;
      const row = Number(target.dataset.tableRow);
      const column = Number(target.dataset.tableColumn);
      return Number.isInteger(row) && Number.isInteger(column) ? { row, column } : null;
    };
    const updateCellDrag = (event: PointerEvent) => {
      if (!cellDrag || event.pointerId !== cellDrag.pointerId) return;
      const next = cellAtPoint(event.clientX, event.clientY);
      if (!next || (next.row === cellDrag.focus.row && next.column === cellDrag.focus.column)) return;
      cellDrag.focus = next;
      const dragged = next.row !== cellDrag.anchor.row || next.column !== cellDrag.anchor.column;
      cellDrag.dragged = cellDrag.dragged || dragged;
      updateSelection({ kind: "range", anchor: cellDrag.anchor, focus: next });
    };
    const finishCellDrag = (event: PointerEvent, cancelled = false) => {
      if (!cellDrag || event.pointerId !== cellDrag.pointerId) return;
      if (!cancelled) updateCellDrag(event);
      const completed = cellDrag;
      cellDrag = null;
      if (completed.dragged) wrapper.focus({ preventScroll: true });
      else if (!cancelled) {
        focusCell(completed.anchor.row, completed.anchor.column);
      }
    };
    const cancelCellDrag = (event: PointerEvent) => finishCellDrag(event, true);
    wrapper.addEventListener("pointermove", updateCellDrag);

    const dispatchOperation = (operation: TableOperation, focus: { row: number; column: number }) => {
      const next = applyTableOperation(draft, operation);
      const insert = serializeMarkdownTable(next);
      view.dispatch({ changes: { from: this.tableFrom, to: this.tableTo, insert } });
      const nextFocus = tableOperationFocus(draft, operation, focus);
      focusCell(nextFocus.row, nextFocus.column);
    };

    const makeButton = (label: string, icon: LucideIcon | string, onClick: () => void, disabled = false) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "mk-table-tool-button";
      button.dataset.tooltip = label;
      button.setAttribute("aria-label", label);
      button.disabled = disabled;
      button.innerHTML = typeof icon === "string" ? icon : iconMarkup(icon);
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        event.stopPropagation();
      });
      button.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      });
      return button;
    };

    const toolbar = document.createElement("div");
    toolbar.className = "mk-table-toolbar";
    toolbar.setAttribute("role", "toolbar");
    toolbar.setAttribute("aria-label", "表格操作");

    const showTableSource = () => {
      const insert = serializeMarkdownTable(draft);
      view.dispatch({
        ...(dirty && insert !== this.source ? { changes: { from: this.tableFrom, to: this.tableTo, insert } } : {}),
        selection: { anchor: this.tableFrom },
        effects: editTableSourceEffect.of(this.tableFrom),
        scrollIntoView: true,
      });
      view.focus();
    };
    const selectWholeTable = () => {
      view.dispatch({ effects: selectWholeTableEffect.of(this.tableFrom) });
    };
    const sourceButton = makeButton("编辑 Markdown 源码", Code2, showTableSource);
    const selectTableButton = makeButton("选中整张表格", Table2, selectWholeTable);
    toolbar.append(selectTableButton);

    const columnTools = document.createElement("div");
    columnTools.className = "mk-table-toolbar-group";
    columnTools.dataset.tools = "column";
    const columnIndex = () => selection?.kind === "column" ? selection.index : -1;
    const insertColumnLeftButton = makeButton("在左侧插入列", ArrowLeftToLine, () => dispatchOperation(
        { type: "insert-column", index: columnIndex(), side: "left" },
        { row: 0, column: columnIndex() },
      ));
    const insertColumnRightButton = makeButton("在右侧插入列", ArrowRightToLine, () => dispatchOperation(
        { type: "insert-column", index: columnIndex(), side: "right" },
        { row: 0, column: columnIndex() + 1 },
      ));
    const moveColumnLeftButton = makeButton("向左移动列", ArrowLeft, () => dispatchOperation(
        { type: "move-column", index: columnIndex(), direction: "left" },
        { row: 0, column: columnIndex() - 1 },
      ));
    const moveColumnRightButton = makeButton("向右移动列", ArrowRight, () => dispatchOperation(
        { type: "move-column", index: columnIndex(), direction: "right" },
        { row: 0, column: columnIndex() + 1 },
      ));
    const deleteColumnButton = makeButton("删除列", Trash2, () => dispatchOperation(
        { type: "delete-column", index: columnIndex() },
        { row: 0, column: Math.min(columnIndex(), draft.alignments.length - 2) },
      ));
    columnTools.append(
      insertColumnLeftButton,
      insertColumnRightButton,
      moveColumnLeftButton,
      moveColumnRightButton,
      deleteColumnButton,
    );

    const rowTools = document.createElement("div");
    rowTools.className = "mk-table-toolbar-group";
    rowTools.dataset.tools = "row";
    const rowIndex = () => selection?.kind === "row" ? selection.index : -1;
    const insertRowAboveButton = makeButton("在上方插入行", ArrowUpToLine, () => dispatchOperation(
        { type: "insert-row", index: rowIndex(), side: "above" },
        { row: rowIndex(), column: 0 },
      ));
    const insertRowBelowButton = makeButton("在下方插入行", ArrowDownToLine, () => dispatchOperation(
        { type: "insert-row", index: rowIndex(), side: "below" },
        { row: rowIndex() + 1, column: 0 },
      ));
    const deleteRowButton = makeButton("删除行", Trash2, () => dispatchOperation(
        { type: "delete-row", index: rowIndex() },
        { row: Math.max(0, Math.min(rowIndex(), draft.rows.length - 2)), column: 0 },
      ));
    rowTools.append(
      insertRowAboveButton,
      insertRowBelowButton,
      deleteRowButton,
    );
    const toolbarEnd = document.createElement("div");
    toolbarEnd.className = "mk-table-toolbar-end";
    const currentTableWidthMode = () => wrapsContent ? "content" : "window";
    const nextTableWidthMode = () => currentTableWidthMode() === "content" ? "window" : "content";
    const currentTableWidthModeLabel = () => currentTableWidthMode() === "window" ? "根据窗口调整布局" : "根据内容调整布局";
    const nextTableWidthModeLabel = () => nextTableWidthMode() === "window" ? "根据窗口调整布局" : "根据内容调整布局";
    const tableWidthModeTooltip = () => `当前：${currentTableWidthModeLabel()}；点击切换为${nextTableWidthModeLabel()}`;
    const wrapButton = makeButton(tableWidthModeTooltip(), tableWidthModeIconMarkup(currentTableWidthMode()), () => {
      const nextMode = nextTableWidthMode();
      wrapsContent = nextMode === "content";
      wrapper.classList.toggle("is-wrap", wrapsContent);
      const label = tableWidthModeTooltip();
      wrapButton.dataset.tooltip = label;
      wrapButton.setAttribute("aria-label", label);
      wrapButton.innerHTML = tableWidthModeIconMarkup(currentTableWidthMode());
      view.dispatch({
        effects: setTableWidthModeEffect.of({ scope: "table", tableFrom: this.tableFrom, mode: nextMode }),
      });
      announceTableContext();
      scheduleFrame(positionDragHandles);
    });
    wrapButton.classList.add("mk-table-width-mode-button");
    wrapper.classList.toggle("is-wrap", wrapsContent);
    toolbarEnd.append(wrapButton, sourceButton);
    toolbar.append(columnTools, rowTools, toolbarEnd);
    refreshToolbar();
    wrapper.append(toolbar);

    const table = document.createElement("table");
    table.className = "mk-cm-table";
    const displayWeights = draft.columnWeights?.map((weight) => Math.max(3, weight)) ?? [];
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
    const tableScroll = document.createElement("div");
    tableScroll.className = "mk-cm-table-scroll";
    const columnDragLayer = document.createElement("div");
    columnDragLayer.className = "mk-table-column-drag-layer";
    const rowDragLayer = document.createElement("div");
    rowDragLayer.className = "mk-table-row-drag-layer";
    const columnElements = new Map<number, HTMLTableCellElement>();
    const rowElements = new Map<number, HTMLTableRowElement>();
    const columnDragHandles = new Map<number, HTMLButtonElement>();
    const rowDragHandles = new Map<number, HTMLButtonElement>();
    const columnHandleHideTimers = new Map<number, number>();
    const rowHandleHideTimers = new Map<number, number>();

    const setColumnDragHandleVisible = (column: number, visible: boolean) => {
      const handle = columnDragHandles.get(column);
      if (!handle || handle.hidden) return;
      const pending = columnHandleHideTimers.get(column);
      if (pending !== undefined) window.clearTimeout(pending);
      if (visible) {
        handle.classList.add("is-visible");
        return;
      }
      columnHandleHideTimers.set(column, window.setTimeout(() => {
        if (!handle.matches(":hover")) handle.classList.remove("is-visible");
      }, 120));
    };

    const setRowDragHandleVisible = (row: number, visible: boolean) => {
      const handle = rowDragHandles.get(row);
      if (!handle || handle.hidden) return;
      const pending = rowHandleHideTimers.get(row);
      if (pending !== undefined) window.clearTimeout(pending);
      if (visible) {
        handle.classList.add("is-visible");
        return;
      }
      rowHandleHideTimers.set(row, window.setTimeout(() => {
        if (!handle.matches(":hover")) handle.classList.remove("is-visible");
      }, 120));
    };

    const positionColumnDragHandles = () => {
      const wrapperBounds = wrapper.getBoundingClientRect();
      const scrollBounds = tableScroll.getBoundingClientRect();
      columnDragHandles.forEach((handle, column) => {
        const columnElement = columnElements.get(column);
        if (!columnElement) return;
        const columnBounds = columnElement.getBoundingClientRect();
        const isVisible = columnBounds.right > scrollBounds.left && columnBounds.left < scrollBounds.right;
        handle.hidden = !isVisible;
        if (!isVisible) handle.classList.remove("is-visible");
        handle.style.left = `${Math.round(columnBounds.left - wrapperBounds.left + columnBounds.width / 2)}px`;
        handle.style.top = `${Math.round(scrollBounds.top - wrapperBounds.top - 10)}px`;
      });
    };

    const positionRowDragHandles = () => {
      const wrapperBounds = wrapper.getBoundingClientRect();
      const scrollBounds = tableScroll.getBoundingClientRect();
      rowDragHandles.forEach((handle, row) => {
        const rowElement = rowElements.get(row);
        if (!rowElement) return;
        const rowBounds = rowElement.getBoundingClientRect();
        const isVisible = rowBounds.right > scrollBounds.left && rowBounds.left < scrollBounds.right;
        handle.hidden = !isVisible;
        if (!isVisible) handle.classList.remove("is-visible");
        handle.style.top = `${Math.round(rowBounds.top - wrapperBounds.top + rowBounds.height / 2)}px`;
      });
    };
    const positionDragHandles = () => {
      positionColumnDragHandles();
      positionRowDragHandles();
    };
    const dragHandleResizeObserver = new ResizeObserver(positionDragHandles);

    let contextMenu: HTMLElement | null = null;
    const closeContextMenu = () => {
      contextMenu?.remove();
      contextMenu = null;
    };

    const selected = () => selection ?? {
      kind: "cell" as const,
      anchor: active ?? { row: 0, column: 0 },
      focus: active ?? { row: 0, column: 0 },
    };
    const selectionOrigin = () => {
      const bounds = tableSelectionBounds(draft, selected());
      return { row: bounds.top, column: bounds.left };
    };
    const selectionIsWholeTable = () => tableSelectionCoversWholeTable(draft, selected());
    const selectionClipboardText = () => selectionIsWholeTable()
      ? serializeMarkdownTable(draft)
      : tableSelectionToTsv(draft, selected());
    const removeWholeTable = () => {
      view.dispatch({
        changes: { from: this.tableFrom, to: this.tableTo, insert: "" },
        selection: { anchor: this.tableFrom },
        scrollIntoView: true,
      });
      view.focus();
    };
    const replaceTable = (next: MarkdownTable, nextSelection?: TableSelection) => {
      draft = next;
      dirty = false;
      if (nextSelection) selection = nextSelection;
      view.dispatch({
        changes: { from: this.tableFrom, to: this.tableTo, insert: serializeMarkdownTable(next) },
      });
      const origin = nextSelection ? tableSelectionBounds(next, nextSelection) : null;
      if (origin) focusCell(origin.top, origin.left);
    };

    let reorderDrag: {
      pointerId: number;
      kind: "column" | "row";
      source: number;
      placement: number | null;
      ghost: HTMLElement;
      offsetX: number;
      offsetY: number;
    } | null = null;
    let dropIndicator: HTMLElement | null = null;
    const dragSourceElements = (kind: "column" | "row", index: number) => kind === "column"
      ? Array.from(table.querySelectorAll<HTMLElement>(`th[data-table-column="${index}"], td[data-table-column="${index}"]`))
      : Array.from(table.querySelectorAll<HTMLElement>(`tr:has([data-table-row="${index}"])`));
    const setDragSource = (kind: "column" | "row", index: number, active: boolean) => {
      dragSourceElements(kind, index).forEach((element) => element.classList.toggle("mk-table-drag-source", active));
    };
    const createDragGhost = (kind: "column" | "row", index: number, event: PointerEvent) => {
      const sourceElements = kind === "column"
        ? Array.from(table.querySelectorAll<HTMLTableCellElement>(`thead th[data-table-column="${index}"]`)).slice(0, 1)
        : Array.from(table.querySelectorAll<HTMLTableCellElement>(`tr:has([data-table-row="${index}"]) > th, tr:has([data-table-row="${index}"]) > td`));
      const firstRect = sourceElements[0]?.getBoundingClientRect();
      if (!firstRect) return null;

      const ghost = document.createElement("div");
      ghost.className = `mk-table-drag-ghost mk-table-drag-ghost--${kind}`;
      ghost.style.width = kind === "column"
        ? `${firstRect.width}px`
        : `${sourceElements.reduce((total, element) => total + element.getBoundingClientRect().width, 0)}px`;
      sourceElements.forEach((element) => {
        const rect = element.getBoundingClientRect();
        const cell = document.createElement("div");
        cell.className = "mk-table-drag-ghost-cell";
        cell.style.width = kind === "row" ? `${rect.width}px` : "100%";
        cell.style.height = `${rect.height}px`;
        const content = element.querySelector<HTMLElement>(".mk-cm-table-cell-content")?.cloneNode(true);
        if (content instanceof HTMLElement) {
          content.removeAttribute("tabindex");
          cell.append(content);
        } else {
          cell.textContent = element.textContent;
        }
        ghost.append(cell);
      });
      document.body.append(ghost);
      return {
        ghost,
        offsetX: event.clientX - firstRect.left,
        offsetY: event.clientY - firstRect.top,
      };
    };
    const positionDragGhost = (event: PointerEvent) => {
      if (!reorderDrag) return;
      reorderDrag.ghost.style.transform = `translate3d(${Math.round(event.clientX - reorderDrag.offsetX)}px, ${Math.round(event.clientY - reorderDrag.offsetY)}px, 0)`;
    };
    const clearDragPreview = () => {
      if (reorderDrag) {
        setDragSource(reorderDrag.kind, reorderDrag.source, false);
        reorderDrag.ghost.remove();
      }
    };
    const clearDropIndicator = () => {
      dropIndicator?.remove();
      dropIndicator = null;
    };
    const columnPlacementAt = (x: number, y: number) => {
      const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th[data-table-column]"));
      const bounds = table.getBoundingClientRect();
      if (headers.length === 0 || y < bounds.top || y > bounds.bottom) return null;
      for (let index = 0; index < headers.length; index++) {
        const rect = headers[index]?.getBoundingClientRect();
        if (!rect) continue;
        if (x < rect.left + rect.width / 2) return index;
      }
      return headers.length;
    };
    const rowPlacementAt = (x: number, y: number) => {
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("thead tr, tbody tr"));
      const bounds = table.getBoundingClientRect();
      if (rows.length === 0 || x < bounds.left || x > bounds.right) return null;
      for (let index = 0; index < rows.length; index++) {
        const rect = rows[index]?.getBoundingClientRect();
        if (!rect) continue;
        if (y < rect.top + rect.height / 2) return index;
      }
      return rows.length;
    };
    const showDropIndicator = (kind: "column" | "row", placement: number) => {
      clearDropIndicator();
      const indicator = document.createElement("div");
      indicator.className = `mk-table-drop-indicator mk-table-drop-indicator--${kind}`;
      const tableBounds = table.getBoundingClientRect();
      if (kind === "column") {
        const headers = Array.from(table.querySelectorAll<HTMLTableCellElement>("thead th[data-table-column]"));
        const target = headers[Math.min(placement, headers.length - 1)];
        if (!target) return;
        const targetBounds = target.getBoundingClientRect();
        indicator.style.left = `${Math.round(placement >= headers.length ? targetBounds.right : targetBounds.left) - 1}px`;
        indicator.style.top = `${Math.round(tableBounds.top)}px`;
        indicator.style.height = `${Math.round(tableBounds.height)}px`;
        document.body.append(indicator);
        dropIndicator = indicator;
        return;
      }
      const rows = Array.from(table.querySelectorAll<HTMLTableRowElement>("thead tr, tbody tr"));
      const target = rows[Math.min(placement, rows.length - 1)];
      if (!target) return;
      const targetBounds = target.getBoundingClientRect();
      indicator.style.left = `${Math.round(tableBounds.left)}px`;
      indicator.style.top = `${Math.round(placement >= rows.length ? targetBounds.bottom : targetBounds.top) - 1}px`;
      indicator.style.width = `${Math.round(tableBounds.width)}px`;
      document.body.append(indicator);
      dropIndicator = indicator;
    };
    const updateReorderDrag = (event: PointerEvent) => {
      if (!reorderDrag || event.pointerId !== reorderDrag.pointerId) return;
      positionDragGhost(event);
      const placement = reorderDrag.kind === "column"
        ? columnPlacementAt(event.clientX, event.clientY)
        : rowPlacementAt(event.clientX, event.clientY);
      if (placement === null) {
        if (reorderDrag.placement !== null) clearDropIndicator();
        reorderDrag.placement = null;
        return;
      }
      if (placement === reorderDrag.placement) return;
      reorderDrag.placement = placement;
      showDropIndicator(reorderDrag.kind, placement);
    };
    const finishReorderDrag = (event: PointerEvent, cancelled = false) => {
      if (!reorderDrag || event.pointerId !== reorderDrag.pointerId) return;
      updateReorderDrag(event);
      const completed = reorderDrag;
      clearDragPreview();
      reorderDrag = null;
      clearDropIndicator();
      if (cancelled || completed.placement === null) return;

      // 落点是插入位置，移除源行列后需要折算成最终索引。
      const target = completed.placement - (completed.placement > completed.source ? 1 : 0);
      if (target === completed.source) return;
      if (completed.kind === "column") {
        replaceTable(
          reorderTableColumn(draft, completed.source, target),
          { kind: "column", index: target },
        );
      } else {
        replaceTable(
          reorderTableRow(draft, completed.source, target),
          { kind: "row", index: target },
        );
      }
    };
    const cancelReorderDrag = (event: PointerEvent) => finishReorderDrag(event, true);
    const beginReorderDrag = (kind: "column" | "row", index: number, event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (dirty) {
        commit();
        return;
      }
      const preview = createDragGhost(kind, index, event);
      if (!preview) return;
      reorderDrag = {
        pointerId: event.pointerId,
        kind,
        source: index,
        placement: index,
        ...preview,
      };
      setDragSource(kind, index, true);
      updateSelection(kind === "column" ? { kind, index } : { kind, index });
      positionDragGhost(event);
      showDropIndicator(kind, index);
      wrapper.focus({ preventScroll: true });
    };
    const copySelection = async () => {
      await navigator.clipboard.writeText(selectionClipboardText());
    };
    const cutSelection = async () => {
      await copySelection();
      if (selectionIsWholeTable()) {
        removeWholeTable();
        return;
      }
      replaceTable(clearTableSelection(draft, selected()), selected());
    };
    const pasteSelection = async () => {
      const text = await navigator.clipboard.readText();
      if (!text) return;
      const result = pasteTableTsv(draft, selectionOrigin(), text);
      replaceTable(result.table, result.selection);
    };

    const openContextMenu = (row: number, column: number, x: number, y: number) => {
      closeContextMenu();
      const currentBounds = selection ? tableSelectionBounds(draft, selection) : null;
      if (!currentBounds
        || row < currentBounds.top || row > currentBounds.bottom
        || column < currentBounds.left || column > currentBounds.right) {
        updateSelection({ kind: "cell", anchor: { row, column }, focus: { row, column } });
      }

      const menu = document.createElement("div");
      menu.className = "mk-table-context-menu";
      menu.setAttribute("role", "menu");
      const separator = () => {
        const element = document.createElement("div");
        element.className = "mk-table-context-separator";
        element.setAttribute("role", "separator");
        menu.append(element);
      };
      const item = (label: string, icon: LucideIcon, action: () => void | Promise<void>, disabled = false) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "mk-table-context-item";
        button.setAttribute("role", "menuitem");
        button.disabled = disabled;
        button.innerHTML = `${iconMarkup(icon)}<span>${label}</span>`;
        button.addEventListener("click", () => {
          closeContextMenu();
          void action();
        });
        menu.append(button);
      };

      item("剪切", Scissors, cutSelection);
      item("复制", Copy, copySelection);
      item("粘贴", ClipboardPaste, pasteSelection);
      separator();
      item("选中当前行", Rows3, () => updateSelection({ kind: "row", index: row }));
      item("选中当前列", Columns3, () => updateSelection({ kind: "column", index: column }));
      separator();
      item("在上方插入行", ArrowUpToLine, () => dispatchOperation(
        { type: "insert-row", index: row, side: "above" },
        { row, column },
      ));
      item("在下方插入行", ArrowDownToLine, () => dispatchOperation(
        { type: "insert-row", index: row, side: "below" },
        { row: row + 1, column },
      ));
      item("在左侧插入列", ArrowLeftToLine, () => dispatchOperation(
        { type: "insert-column", index: column, side: "left" },
        { row, column },
      ));
      item("在右侧插入列", ArrowRightToLine, () => dispatchOperation(
        { type: "insert-column", index: column, side: "right" },
        { row, column: column + 1 },
      ));
      separator();
      item("向左移动列", ArrowLeft, () => dispatchOperation(
        { type: "move-column", index: column, direction: "left" },
        { row, column: column - 1 },
      ), column <= 0);
      item("向右移动列", ArrowRight, () => dispatchOperation(
        { type: "move-column", index: column, direction: "right" },
        { row, column: column + 1 },
      ), column >= draft.alignments.length - 1);
      item("删除当前行", Trash2, () => dispatchOperation(
        { type: "delete-row", index: row },
        { row: Math.min(row, draft.rows.length - 2), column },
      ), draft.rows.length <= 1);
      item("删除当前列", Trash2, () => dispatchOperation(
        { type: "delete-column", index: column },
        { row, column: Math.min(column, draft.alignments.length - 2) },
      ), draft.alignments.length <= 1);

      document.body.append(menu);
      const width = menu.offsetWidth;
      const height = menu.offsetHeight;
      menu.style.left = `${Math.max(6, Math.min(x, window.innerWidth - width - 6))}px`;
      menu.style.top = `${Math.max(6, Math.min(y, window.innerHeight - height - 6))}px`;
      contextMenu = menu;
      menu.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    };

    const hasNativeInputSelection = (event: ClipboardEvent) => {
      const input = event.target instanceof HTMLInputElement ? event.target : null;
      return Boolean(input && input.selectionStart !== input.selectionEnd);
    };
    wrapper.addEventListener("copy", (event) => {
      if (hasNativeInputSelection(event)) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", selectionClipboardText());
    });
    wrapper.addEventListener("cut", (event) => {
      if (hasNativeInputSelection(event)) return;
      event.preventDefault();
      event.clipboardData?.setData("text/plain", selectionClipboardText());
      if (selectionIsWholeTable()) {
        removeWholeTable();
        return;
      }
      replaceTable(clearTableSelection(draft, selected()), selected());
    });
    wrapper.addEventListener("paste", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!text) return;
      event.preventDefault();
      const result = pasteTableTsv(draft, selectionOrigin(), text);
      replaceTable(result.table, result.selection);
    });
    wrapper.addEventListener("keydown", (event) => {
      if (event.target instanceof HTMLInputElement) return;
      if ((event.key === "Delete" || event.key === "Backspace") && selection) {
        event.preventDefault();
        replaceTable(clearTableSelection(draft, selection), selection);
      } else if (event.key === "Escape") {
        closeContextMenu();
      }
    });

    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      const insideContextMenu = Boolean(contextMenu?.contains(target));
      const insideTableWidthControls = target instanceof Element
        && Boolean(target.closest("[data-mk-table-width-controls]"));
      if (contextMenu && !insideContextMenu) closeContextMenu();
      if (!wrapper.contains(target) && !insideContextMenu && !insideTableWidthControls) {
        clearSelection();
        // 此时仍处在 pointerdown 捕获阶段。提前 blur/commit 会重建表格 DOM，
        // 让 CodeMirror 随后的坐标换算落到下一行；交给浏览器的正常焦点切换提交即可。
      }
    };
    const closeOnScroll = () => closeContextMenu();
    const revealColumnDragHandle = (event: PointerEvent) => {
      if (!(event.target instanceof Element)) return;
      const columnCell = event.target.closest<HTMLTableCellElement>("th[data-table-column]");
      if (!columnCell || !table.contains(columnCell)) return;
      setColumnDragHandleVisible(Number(columnCell.dataset.tableColumn), true);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer, true);
    document.addEventListener("pointermove", extendDocumentSelectionThroughRow, true);
    document.addEventListener("mousemove", extendDocumentSelectionThroughRow, true);
    document.addEventListener("pointermove", updateReorderDrag, true);
    document.addEventListener("pointerup", finishCellDrag, true);
    document.addEventListener("pointercancel", cancelCellDrag, true);
    document.addEventListener("pointerup", finishReorderDrag, true);
    document.addEventListener("pointercancel", cancelReorderDrag, true);
    window.addEventListener("scroll", closeOnScroll, true);
    wrapper.addEventListener("pointerover", revealColumnDragHandle);
    this.cleanups.set(container, () => {
      closeContextMenu();
      clearDragPreview();
      animationFrameIds.forEach((id) => cancelAnimationFrame(id));
      animationFrameIds.clear();
      dragHandleResizeObserver.disconnect();
      columnDragHandles.forEach((_, column) => {
        const pending = columnHandleHideTimers.get(column);
        if (pending !== undefined) window.clearTimeout(pending);
      });
      rowDragHandles.forEach((_, row) => {
        const pending = rowHandleHideTimers.get(row);
        if (pending !== undefined) window.clearTimeout(pending);
      });
      document.removeEventListener("pointerdown", closeOnOutsidePointer, true);
      document.removeEventListener("pointermove", extendDocumentSelectionThroughRow, true);
      document.removeEventListener("mousemove", extendDocumentSelectionThroughRow, true);
      document.removeEventListener("pointermove", updateReorderDrag, true);
      document.removeEventListener("pointerup", finishCellDrag, true);
      document.removeEventListener("pointercancel", cancelCellDrag, true);
      document.removeEventListener("pointerup", finishReorderDrag, true);
      document.removeEventListener("pointercancel", cancelReorderDrag, true);
      window.removeEventListener("scroll", closeOnScroll, true);
      wrapper.removeEventListener("pointerdown", announceTableContext, true);
      wrapper.removeEventListener("focusin", announceTableContext);
      wrapper.removeEventListener("pointerover", revealColumnDragHandle);
      tableScroll.removeEventListener("scroll", positionDragHandles);
    });

    const buildInput = (row: number, column: number) => {
      const cell = document.createElement("div");
      cell.className = "mk-cm-table-cell";
      const alignment = draft.alignments[column] ?? "none";
      const rendered = renderTableInlineMarkdown(draft.rows[row]?.[column] ?? "");
      rendered.dataset.tableRow = String(row);
      rendered.dataset.tableColumn = String(column);
      rendered.tabIndex = 0;
      rendered.setAttribute("aria-label", `第 ${row + 1} 行，第 ${column + 1} 列`);
      if (alignment !== "none") {
        rendered.style.textAlign = alignment;
      }

      const input = document.createElement("textarea");
      input.className = "mk-cm-table-input";
      input.hidden = true;
      input.value = draft.rows[row]?.[column] ?? "";
      input.dataset.tableRow = String(row);
      input.dataset.tableColumn = String(column);
      input.setAttribute("aria-label", `第 ${row + 1} 行，第 ${column + 1} 列`);
      if (alignment !== "none") {
        input.style.textAlign = alignment;
      }
      input.addEventListener("focus", () => {
        active = { row, column };
        updateSelection({ kind: "cell", anchor: { row, column }, focus: { row, column } });
      });
      input.addEventListener("pointerdown", (event) => {
        if (active && (active.row !== row || active.column !== column) && dirty) {
          event.preventDefault();
          event.stopPropagation();
          commit({ row, column });
        }
      });
      input.addEventListener("input", () => {
        if (!composition.acceptsInput) {
          input.value = draft.rows[row]?.[column] ?? "";
          return;
        }
        draft.rows[row]![column] = input.value;
        dirty = true;
      });
      input.addEventListener("compositionstart", () => composition.start());
      input.addEventListener("compositionend", () => {
        if (composition.end() === "cancelled") {
          input.value = draft.rows[row]?.[column] ?? "";
          return;
        }
        draft.rows[row]![column] = input.value;
        dirty = true;
        if (document.activeElement !== input) commit();
      });
      input.addEventListener("keydown", (event) => {
        event.stopPropagation();
        const modifier = event.ctrlKey || event.metaKey;
        if (!dirty && modifier && event.key.toLowerCase() === "z") {
          event.preventDefault();
          (event.shiftKey ? redo : undo)(view);
          focusCell(row, column);
        } else if (!dirty && modifier && event.key.toLowerCase() === "y") {
          event.preventDefault();
          redo(view);
          focusCell(row, column);
        } else if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !composition.composing && !event.isComposing) {
          event.preventDefault();
          input.blur();
        } else if (event.key === "Escape") {
          event.preventDefault();
          composition.cancel();
          cancel();
          input.blur();
        }
      });
      input.addEventListener("blur", () => {
        if (!composition.composing) commit();
        if (active?.row === row && active.column === column) active = null;
      });

      rendered.addEventListener("pointerdown", (event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        if (active && (active.row !== row || active.column !== column) && dirty) {
          commit({ row, column });
          return;
        }
        const current = selection;
        const nextSelection = tableCellPointerSelection(current, { row, column }, event.shiftKey);
        if (nextSelection.kind === "range") {
          updateSelection(nextSelection);
          rendered.focus();
          return;
        }

        const anchor = { row, column };
        cellDrag = { pointerId: event.pointerId, anchor, focus: anchor, dragged: false };
        updateSelection(nextSelection);
      });
      rendered.addEventListener("keydown", (event) => {
        if (event.key === "Enter" || event.key === "F2") {
          event.preventDefault();
          focusCell(row, column);
        } else if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
          event.preventDefault();
          const rect = rendered.getBoundingClientRect();
          openContextMenu(row, column, rect.left + 8, rect.top + 8);
        }
      });
      rendered.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(row, column, event.clientX, event.clientY);
      });
      input.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        event.stopPropagation();
        openContextMenu(row, column, event.clientX, event.clientY);
      });
      cell.append(rendered, input);
      return cell;
    };

    const buildDragHandle = (kind: "column" | "row", index: number) => {
      const handle = document.createElement("button");
      handle.type = "button";
      handle.className = `mk-table-${kind}-drag-handle`;
      handle.dataset.tooltip = kind === "column" ? "拖动列" : "拖动行";
      handle.setAttribute("aria-label", kind === "column" ? `拖动第 ${index + 1} 列` : `拖动第 ${index + 1} 行`);
      handle.innerHTML = iconMarkup(kind === "column" ? GripHorizontal : GripVertical);
      handle.addEventListener("pointerdown", (event) => beginReorderDrag(kind, index, event));
      if (kind === "column") {
        handle.addEventListener("pointerenter", () => setColumnDragHandleVisible(index, true));
        handle.addEventListener("pointerleave", () => setColumnDragHandleVisible(index, false));
      } else {
        handle.addEventListener("pointerenter", () => setRowDragHandleVisible(index, true));
        handle.addEventListener("pointerleave", () => setRowDragHandleVisible(index, false));
      }
      return handle;
    };

    const buildRow = (rowIndex: number, isHeader: boolean): HTMLTableRowElement => {
      const tr = document.createElement("tr");
      draft.rows[rowIndex]?.forEach((_, colIndex) => {
        const el = document.createElement(isHeader ? "th" : "td");
        el.dataset.tableRow = String(rowIndex);
        el.dataset.tableColumn = String(colIndex);
        const alignment = draft.alignments[colIndex] ?? "none";
        if (alignment !== "none") {
          el.style.textAlign = alignment;
        }
        const weight = draft.columnWeights?.[colIndex];
        if (weight !== undefined) {
          el.style.minWidth = `${Math.max(72, Math.min(320, weight * 24))}px`;
        }
        el.append(buildInput(rowIndex, colIndex));
        if (isHeader) {
          const columnHandle = buildDragHandle("column", colIndex);
          columnElements.set(colIndex, el);
          columnDragHandles.set(colIndex, columnHandle);
          columnDragLayer.append(columnHandle);
          el.addEventListener("pointerenter", () => setColumnDragHandleVisible(colIndex, true));
          el.addEventListener("pointerleave", () => setColumnDragHandleVisible(colIndex, false));
        }
        if (colIndex === 0) {
          const rowHandle = buildDragHandle("row", rowIndex);
          rowDragHandles.set(rowIndex, rowHandle);
          rowDragLayer.append(rowHandle);
          el.addEventListener("pointerenter", () => setRowDragHandleVisible(rowIndex, true));
          el.addEventListener("pointerleave", () => setRowDragHandleVisible(rowIndex, false));
        }
        tr.appendChild(el);
      });
      rowElements.set(rowIndex, tr);
      return tr;
    };

    if (draft.rows.length > 0) {
      const thead = document.createElement("thead");
      thead.appendChild(buildRow(0, true));
      table.appendChild(thead);
    }

    if (draft.rows.length > 1) {
      const tbody = document.createElement("tbody");
      for (let i = 1; i < draft.rows.length; i++) {
        tbody.appendChild(buildRow(i, false));
      }
      table.appendChild(tbody);
    }

    tableScroll.appendChild(table);
    wrapper.append(tableScroll, columnDragLayer, rowDragLayer);
    tableScroll.addEventListener("scroll", positionDragHandles);
    dragHandleResizeObserver.observe(wrapper);
    scheduleFrame(positionDragHandles);
    if (this.selectedFromToolbar) {
      updateSelection({
        kind: "range",
        anchor: { row: 0, column: 0 },
        focus: {
          row: draft.rows.length - 1,
          column: Math.max(draft.alignments.length, ...draft.rows.map((row) => row.length)) - 1,
        },
      }, this.selectedFromToolbar);
      if (this.selectedFromToolbar) scheduleFrame(() => wrapper.focus({ preventScroll: true }));
    } else if (this.documentSelectedRows.length > 0) {
      this.applyDocumentSelectedRows(wrapper);
    }
    return container;
  }

  override destroy(dom: HTMLElement): void {
    this.cleanups.get(dom)?.();
    this.cleanups.delete(dom);
  }

  override ignoreEvent(): boolean {
    return true;
  }
}
