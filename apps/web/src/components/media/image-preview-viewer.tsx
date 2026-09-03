import { ChevronLeft, ChevronRight, Maximize2, ZoomIn, ZoomOut } from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type ReactElement,
  type SyntheticEvent,
} from "react";

import { cn } from "../../lib/cn.js";
import { IconButton } from "../ui/icon-button.js";

const MIN_ZOOM_PERCENT = 5;
const MAX_ZOOM_PERCENT = 800;
const BUTTON_ZOOM_FACTOR = 1.2;
const WHEEL_ZOOM_SENSITIVITY = 0.001;
const NAVIGATION_REVEAL_WIDTH = 96;

type ImageDragState = {
  pointerId: number;
  startClientX: number;
  startClientY: number;
  startScrollLeft: number;
  startScrollTop: number;
};

function clampZoomPercent(value: number): number {
  return Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, value));
}

function renderedZoomPercent(image: HTMLImageElement): number {
  const renderedWidth = image.getBoundingClientRect().width;
  if (image.naturalWidth <= 0 || renderedWidth <= 0) return 100;
  return clampZoomPercent(renderedWidth / image.naturalWidth * 100);
}

export function ImagePreviewViewer({
  appearance = "panel",
  currentIndex,
  dataUrl,
  fileName,
  hasNext,
  hasPrevious,
  total,
  onNext,
  onPrevious,
}: {
  appearance?: "overlay" | "panel";
  currentIndex: number;
  dataUrl: string;
  fileName: string;
  hasNext: boolean;
  hasPrevious: boolean;
  total: number;
  onNext: () => void;
  onPrevious: () => void;
}): ReactElement {
  const [naturalSize, setNaturalSize] = useState({ height: 0, width: 0 });
  const [isDraggingImage, setIsDraggingImage] = useState(false);
  const [revealedNavigation, setRevealedNavigation] = useState<"next" | "previous" | null>(null);
  const [zoomPercent, setZoomPercent] = useState<number | null>(null);
  const imageDragStateRef = useRef<ImageDragState | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomPercentRef = useRef<number | null>(null);

  const commitZoomPercent = (value: number | null): void => {
    zoomPercentRef.current = value;
    setZoomPercent(value);
  };

  useEffect(() => {
    const image = imageRef.current;
    if (!image) return undefined;
    const handleWheelZoom = (event: WheelEvent): void => {
      const viewport = viewportRef.current;
      if (!event.ctrlKey || !viewport || event.deltaY === 0) return;
      const imageRect = image.getBoundingClientRect();
      if (image.naturalWidth <= 0 || imageRect.width <= 0 || imageRect.height <= 0) return;

      event.preventDefault();
      const deltaPixels = event.deltaMode === 1
        ? event.deltaY * 16
        : event.deltaMode === 2
          ? event.deltaY * viewport.clientHeight
          : event.deltaY;
      const wheelFactor = Math.max(
        1 / BUTTON_ZOOM_FACTOR,
        Math.min(BUTTON_ZOOM_FACTOR, Math.exp(-deltaPixels * WHEEL_ZOOM_SENSITIVITY)),
      );
      const current = zoomPercentRef.current ?? renderedZoomPercent(image);
      const next = clampZoomPercent(current * wheelFactor);
      if (Math.abs(next - current) < 0.01) return;

      const anchorX = (event.clientX - imageRect.left) / imageRect.width;
      const anchorY = (event.clientY - imageRect.top) / imageRect.height;
      zoomPercentRef.current = next;
      setZoomPercent(next);
      requestAnimationFrame(() => {
        const nextImageRect = image.getBoundingClientRect();
        viewport.scrollLeft += nextImageRect.left + nextImageRect.width * anchorX - event.clientX;
        viewport.scrollTop += nextImageRect.top + nextImageRect.height * anchorY - event.clientY;
      });
    };

    image.addEventListener("wheel", handleWheelZoom, { passive: false });
    return () => image.removeEventListener("wheel", handleWheelZoom);
  }, []);

  const adjustZoom = (direction: -1 | 1): void => {
    const current = zoomPercentRef.current
      ?? (imageRef.current ? renderedZoomPercent(imageRef.current) : 100);
    commitZoomPercent(clampZoomPercent(current * (direction > 0 ? BUTTON_ZOOM_FACTOR : 1 / BUTTON_ZOOM_FACTOR)));
  };

  const handleKeyboardNavigation = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.key === "ArrowLeft" && hasPrevious) {
      event.preventDefault();
      onPrevious();
    } else if (event.key === "ArrowRight" && hasNext) {
      event.preventDefault();
      onNext();
    }
  };

  const handleImageLoad = (event: SyntheticEvent<HTMLImageElement>): void => {
    setNaturalSize({ height: event.currentTarget.naturalHeight, width: event.currentTarget.naturalWidth });
  };

  const handleImagePointerDown = (event: PointerEvent<HTMLImageElement>): void => {
    const viewport = viewportRef.current;
    if (
      event.button !== 0
      || viewport === null
      || (
        viewport.scrollWidth <= viewport.clientWidth
        && viewport.scrollHeight <= viewport.clientHeight
      )
    ) {
      return;
    }
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    imageDragStateRef.current = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startScrollLeft: viewport.scrollLeft,
      startScrollTop: viewport.scrollTop,
    };
    setIsDraggingImage(true);
  };

  const handleImagePointerMove = (event: PointerEvent<HTMLImageElement>): void => {
    const drag = imageDragStateRef.current;
    const viewport = viewportRef.current;
    if (drag === null || viewport === null || drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    viewport.scrollLeft = drag.startScrollLeft - (event.clientX - drag.startClientX);
    viewport.scrollTop = drag.startScrollTop - (event.clientY - drag.startClientY);
  };

  const finishImageDrag = (event: PointerEvent<HTMLImageElement>): void => {
    const drag = imageDragStateRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    imageDragStateRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsDraggingImage(false);
  };

  const handleNavigationPointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    const bounds = event.currentTarget.getBoundingClientRect();
    const pointerX = event.clientX - bounds.left;
    const revealWidth = Math.min(NAVIGATION_REVEAL_WIDTH, bounds.width * 0.2);
    const next = pointerX <= revealWidth
      ? "previous"
      : pointerX >= bounds.width - revealWidth
        ? "next"
        : null;
    setRevealedNavigation((current) => current === next ? current : next);
  };

  const imageStyle = zoomPercent !== null && naturalSize.width > 0 && naturalSize.height > 0
    ? {
        height: `${naturalSize.height * zoomPercent / 100}px`,
        maxHeight: "none",
        maxWidth: "none",
        width: `${naturalSize.width * zoomPercent / 100}px`,
      }
    : undefined;
  const overlay = appearance === "overlay";
  const controls = (
    <div className={cn(
      "flex min-w-0 items-center gap-1",
      overlay && "rounded-full border border-white/10 bg-black/65 px-2 py-1 text-zinc-100 shadow-xl backdrop-blur-md",
    )}>
      <IconButton disabled={zoomPercent === MIN_ZOOM_PERCENT} label="缩小图片" size="compact" variant="quiet" onClick={() => adjustZoom(-1)}>
        <ZoomOut aria-hidden="true" size={16} />
      </IconButton>
      <span aria-live="polite" className={cn("min-w-12 text-center text-[length:var(--app-font-size-caption)] tabular-nums", overlay ? "text-zinc-200" : "text-[var(--app-muted-foreground)]")}>
        {zoomPercent === null ? "适应" : `${Math.round(zoomPercent)}%`}
      </span>
      <IconButton disabled={zoomPercent === MAX_ZOOM_PERCENT} label="放大图片" size="compact" variant="quiet" onClick={() => adjustZoom(1)}>
        <ZoomIn aria-hidden="true" size={16} />
      </IconButton>
      <button
        aria-label="显示图片实际大小"
        className={cn(
          "h-8 rounded-[var(--app-radius)] px-2 text-[length:var(--app-font-size-caption)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]",
          overlay ? "text-zinc-200 hover:bg-white/10 hover:text-white" : "text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] hover:text-[var(--app-foreground)]",
        )}
        type="button"
        onClick={() => commitZoomPercent(100)}
      >
        1:1
      </button>
      <IconButton label="使图片适应窗口" size="compact" variant="quiet" onClick={() => commitZoomPercent(null)}>
        <Maximize2 aria-hidden="true" size={15} />
      </IconButton>
    </div>
  );

  return (
    <section aria-label={`${fileName} 图片查看器`} className={cn("relative flex min-h-0 flex-1 flex-col", overlay ? "bg-transparent" : "bg-[var(--app-panel)]")}>
      {overlay ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-4 z-20 flex justify-center px-16">
          <div className="pointer-events-auto flex items-center gap-2">
            {total > 1 ? <span className="rounded-full bg-black/65 px-3 py-2 text-xs tabular-nums text-zinc-200 backdrop-blur-md">{currentIndex + 1} / {Math.max(1, total)}</span> : null}
            {controls}
          </div>
        </div>
      ) : (
        <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-[var(--app-border)] px-2 py-1">
          <span aria-live="polite" className="min-w-12 px-1 text-center text-[length:var(--app-font-size-caption)] tabular-nums text-[var(--app-muted-foreground)]">
            {currentIndex + 1} / {Math.max(1, total)}
          </span>
          <div className="ml-auto">{controls}</div>
        </div>
      )}
      <div
        className="relative min-h-0 flex-1"
        data-image-navigation-zone="true"
        onPointerLeave={() => setRevealedNavigation(null)}
        onPointerMove={handleNavigationPointerMove}
      >
        <div
          ref={viewportRef}
          className={cn(
            "h-full min-h-0 overflow-auto p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-focus-ring)]",
            overlay ? "bg-transparent" : "bg-[var(--app-canvas)]",
          )}
          role="group"
          tabIndex={0}
          onKeyDown={handleKeyboardNavigation}
        >
          <div className="flex h-max min-h-full w-max min-w-full items-center justify-center">
            <img
              ref={imageRef}
              alt={fileName}
              className={cn(
                "select-none touch-none",
                zoomPercent === null
                  ? "block max-h-full max-w-full cursor-grab object-contain"
                  : "block shrink-0 cursor-grab object-contain",
                isDraggingImage && "cursor-grabbing",
                overlay && "drop-shadow-2xl",
              )}
              draggable={false}
              src={dataUrl}
              style={imageStyle}
              onDoubleClick={() => commitZoomPercent(zoomPercentRef.current === null ? 100 : null)}
              onLoad={handleImageLoad}
              onPointerCancel={finishImageDrag}
              onPointerDown={handleImagePointerDown}
              onPointerMove={handleImagePointerMove}
              onPointerUp={finishImageDrag}
            />
          </div>
        </div>
        {hasPrevious ? (
          <IconButton
            className={cn(
              "absolute left-3 top-1/2 z-10 size-10 -translate-y-1/2 rounded-full border border-white/15 bg-black/55 text-zinc-200 shadow-lg backdrop-blur-sm transition-opacity hover:bg-black/75 hover:text-white focus-visible:pointer-events-auto focus-visible:opacity-100",
              revealedNavigation === "previous" ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
            )}
            data-image-navigation="previous"
            label="上一张图片"
            variant="quiet"
            onClick={onPrevious}
          >
            <ChevronLeft aria-hidden="true" size={20} />
          </IconButton>
        ) : null}
        {hasNext ? (
          <IconButton
            className={cn(
              "absolute right-3 top-1/2 z-10 size-10 -translate-y-1/2 rounded-full border border-white/15 bg-black/55 text-zinc-200 shadow-lg backdrop-blur-sm transition-opacity hover:bg-black/75 hover:text-white focus-visible:pointer-events-auto focus-visible:opacity-100",
              revealedNavigation === "next" ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0",
            )}
            data-image-navigation="next"
            label="下一张图片"
            variant="quiet"
            onClick={onNext}
          >
            <ChevronRight aria-hidden="true" size={20} />
          </IconButton>
        ) : null}
      </div>
    </section>
  );
}
