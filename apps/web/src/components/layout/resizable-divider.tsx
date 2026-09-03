import {
  useEffect,
  useRef,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

import { cn } from "../../lib/cn.js";
import { emitLivePanelResize } from "./live-panel-resize.js";
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
    let baseWidth = collapsed ? min : size;
    let latestWidth = baseWidth;
    let origin = event.clientX;
    let collapsedDuringDrag = collapsed;

    isDraggingRef.current = true;
    divider.setPointerCapture(event.pointerId);
    divider.dataset.resizing = "true";
    onDraggingChange?.(true);
    document.body.dataset.resizingPanel = "true";
    if (liveResizeId !== undefined) {
      emitLivePanelResize({ id: liveResizeId, phase: "start", size: baseWidth });
    }

    const stop = (): void => {
      isDraggingRef.current = false;
      delete divider.dataset.resizing;
      delete document.body.dataset.resizingPanel;
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      cleanupRef.current = null;
      onDraggingChange?.(false);
      if (liveResizeId !== undefined) {
        emitLivePanelResize({ id: liveResizeId, phase: "end", size: latestWidth });
      }
    };

    const move = (moveEvent: PointerEvent): void => {
      if (!isDraggingRef.current) return;

      const nextWidth = getResizedPanelWidth(
        baseWidth,
        moveEvent.clientX - origin,
        direction,
      );

      const transition = getResizeCollapseTransition(
        nextWidth,
        min,
        collapseThreshold,
        collapsedDuringDrag,
      );
      if (transition === "collapse") {
        latestWidth = min;
        onResize(min);
        if (liveResizeId !== undefined) {
          emitLivePanelResize({ id: liveResizeId, phase: "move", size: latestWidth });
        }
        collapsedDuringDrag = true;
        onCollapsedChange(true);
        return;
      }

      if (transition === "expand") {
        latestWidth = min;
        onResize(min);
        if (liveResizeId !== undefined) {
          emitLivePanelResize({ id: liveResizeId, phase: "move", size: latestWidth });
        }
        collapsedDuringDrag = false;
        origin = moveEvent.clientX;
        baseWidth = min;
        onCollapsedChange(false);
        return;
      }

      if (collapsedDuringDrag) {
        return;
      }

      latestWidth = clampResizablePanelWidth(nextWidth, min, max);
      onResize(latestWidth);
      if (liveResizeId !== undefined) {
        emitLivePanelResize({ id: liveResizeId, phase: "move", size: latestWidth });
      }
    };

    cleanupRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    const step = 16;
    const grow = direction === "from-start" ? step : -step;

    if (event.key === "Home") {
      event.preventDefault();
      onResize(min);
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
      className={cn("resizable-divider", className)}
      data-collapsed={String(collapsed)}
      data-direction={direction}
      role="separator"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
    >
      <span aria-hidden="true" className="resizable-divider__grip" />
    </div>
  );
}
