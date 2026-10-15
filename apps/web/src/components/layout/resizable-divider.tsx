import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";
import { flushSync } from "react-dom";
import { advancePanelDrag, type PanelDrag } from "@agent/protocol";

import { cn } from "../../lib/cn.js";
import { emitLivePanelResize, NATIVE_PANEL_RESIZE_EVENT, type NativePanelResizeDetail } from "./live-panel-resize.js";
import "./resizable-divider.css";

export const RESIZABLE_PANEL_COLLAPSE_THRESHOLD = 24;

export type ResizeDirection = "from-start" | "from-end";

export function clampResizablePanelWidth(
  width: number,
  min: number,
  max: number,
): number {
  return Math.min(max, Math.max(min, Math.round(width)));
}

export function getResizedPanelWidth(
  baseWidth: number,
  delta: number,
  direction: ResizeDirection,
): number {
  return direction === "from-start" ? baseWidth + delta : baseWidth - delta;
}

export type ResizeCollapseTransition = "collapse" | "expand" | null;

export function getResizeCollapseTransition(
  width: number,
  min: number,
  threshold: number,
  isCollapsed: boolean,
): ResizeCollapseTransition {
  if (!isCollapsed && width <= min - threshold) return "collapse";
  if (isCollapsed && width >= min + threshold) return "expand";
  return null;
}

type ResizableDividerProps = {
  ariaLabel: string;
  className?: string;
  collapsed?: boolean;
  collapseThreshold?: number;
  collapsible?: boolean;
  defaultSize?: number;
  keyboardStep?: number;
  direction: ResizeDirection;
  liveResizeId?: string;
  max: number;
  min: number;
  onCollapsedChange: (isCollapsed: boolean) => void;
  onDraggingChange?: (isDragging: boolean) => void;
  onResize: (width: number) => void;
  size: number;
};

/** A zero-layout divider with a full-height gap hit area and hover-only indicator. */
export function ResizableDivider({
  ariaLabel,
  className,
  collapsed = false,
  collapseThreshold = RESIZABLE_PANEL_COLLAPSE_THRESHOLD,
  collapsible = true,
  defaultSize,
  keyboardStep = 16,
  direction,
  liveResizeId,
  max,
  min,
  onCollapsedChange,
  onDraggingChange,
  onResize,
  size,
}: ResizableDividerProps): ReactElement {
  const isDraggingRef = useRef(false);
  const cleanupRef = useRef<(() => void) | null>(null);

  useEffect(
    () => () => cleanupRef.current?.(),
    [],
  );

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>): void {
    if (event.button !== 0) return;

    event.preventDefault();
    const divider = event.currentTarget;
    const dragId = crypto.randomUUID();
    let drag: PanelDrag = { base: collapsed ? min : size, size: collapsed ? min : size,
      origin: event.clientX, min, max, threshold: collapseThreshold, collapsed, collapsible, direction };
    let latestWidth = drag.size;
    let latestPointerX = event.clientX;

    isDraggingRef.current = true;
    divider.setPointerCapture(event.pointerId);
    divider.dataset.resizing = "true";
    onDraggingChange?.(true);
    document.body.dataset.resizingPanel = "true";
    document.body.dataset.resizingPanelCollapsed = String(collapsed);
    if (liveResizeId !== undefined) {
      emitLivePanelResize({ id: liveResizeId, phase: "start", size: latestWidth, dragId, drag, pointerX: latestPointerX });
    }

    const stop = (): void => {
      isDraggingRef.current = false;
      delete divider.dataset.resizing;
      delete document.body.dataset.resizingPanel;
      delete document.body.dataset.resizingPanelCollapsed;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      window.removeEventListener(NATIVE_PANEL_RESIZE_EVENT, nativeMove);
      if (divider.hasPointerCapture(event.pointerId)) divider.releasePointerCapture(event.pointerId);
      cleanupRef.current = null;
      onDraggingChange?.(false);
      if (liveResizeId !== undefined) {
        emitLivePanelResize({ id: liveResizeId, phase: "end", size: latestWidth, dragId, drag, pointerX: latestPointerX });
      }
    };

    const move = (moveEvent: Pick<PointerEvent, "clientX">, native = false): void => {
      if (!isDraggingRef.current) return;
      latestPointerX = moveEvent.clientX;
      const next = advancePanelDrag(drag, latestPointerX);
      const collapsedChanged = next.collapsed !== drag.collapsed;
      drag = next;
      latestWidth = drag.size;
      document.body.dataset.resizingPanelCollapsed = String(drag.collapsed);
      flushSync(() => {
        onResize(latestWidth);
        if (collapsedChanged) onCollapsedChange(drag.collapsed);
      });
      if (liveResizeId !== undefined) {
        emitLivePanelResize({ id: liveResizeId, phase: "move", size: latestWidth, dragId, drag, pointerX: latestPointerX, native });
      }
    };
    const nativeMove = (nativeEvent: Event): void => {
      const detail = (nativeEvent as CustomEvent<NativePanelResizeDetail>).detail;
      if (detail.id !== dragId) return;
      move({ clientX: detail.pointerX }, true);
      if (detail.phase === "end") stop();
    };

    cleanupRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
    window.addEventListener(NATIVE_PANEL_RESIZE_EVENT, nativeMove);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = keyboardStep;
    const grow = direction === "from-start" ? step : -step;

    if (event.key === "Home") {
      event.preventDefault();
      onResize(defaultSize ?? min);
      return;
    }

    if (event.key === "End") {
      event.preventDefault();
      onResize(max);
      return;
    }

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const amount = event.key === "ArrowRight" ? grow : -grow;
      onResize(clampResizablePanelWidth(size + amount, min, max));
    }
  }

  return (
    <div
      aria-label={ariaLabel}
      aria-orientation="vertical"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={size}
      className={cn("resizable-divider", className)}
      data-collapsed={String(collapsed)}
      data-direction={direction}
      role="separator"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onDoubleClick={defaultSize === undefined ? undefined : () => onResize(defaultSize)}
    >
      <span aria-hidden="true" className="resizable-divider__grip" />
    </div>
  );
}
