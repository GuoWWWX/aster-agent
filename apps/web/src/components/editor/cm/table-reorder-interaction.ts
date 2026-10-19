import { reorderTableColumn, reorderTableRow, type MarkdownTable, type TableSelection } from "./markdown-table.js";

/** Owns table row/column drag previews; the Widget keeps event registration and source commits. */
export function createTableReorderInteraction({ table, wrapper, getTable, isDirty, commit, replaceTable, updateSelection }: {
  table: HTMLTableElement;
  wrapper: HTMLElement;
  getTable: () => MarkdownTable;
  isDirty: () => boolean;
  commit: () => void;
  replaceTable: (next: MarkdownTable, nextSelection?: TableSelection) => void;
  updateSelection: (selection: TableSelection) => void;
}) {
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
      clearDropIndicator();
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
          reorderTableColumn(getTable(), completed.source, target),
          { kind: "column", index: target },
        );
      } else {
        replaceTable(
          reorderTableRow(getTable(), completed.source, target),
          { kind: "row", index: target },
        );
      }
    };
    const cancelReorderDrag = (event: PointerEvent) => finishReorderDrag(event, true);
    const beginReorderDrag = (kind: "column" | "row", index: number, event: PointerEvent) => {
      event.preventDefault();
      event.stopPropagation();
      if (isDirty()) {
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

  return { beginReorderDrag, updateReorderDrag, finishReorderDrag, cancelReorderDrag, clearDragPreview };
}
