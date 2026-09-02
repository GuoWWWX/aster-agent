import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type SyntheticEvent,
} from "react";

import { IconButton } from "../../components/ui/icon-button.js";

const MIN_ZOOM_PERCENT = 5;
const MAX_ZOOM_PERCENT = 800;
const BUTTON_ZOOM_FACTOR = 1.2;
const WHEEL_ZOOM_SENSITIVITY = 0.001;

function clampZoomPercent(value: number): number {
  return Math.max(MIN_ZOOM_PERCENT, Math.min(MAX_ZOOM_PERCENT, value));
}

function renderedZoomPercent(image: HTMLImageElement): number {
  const renderedWidth = image.getBoundingClientRect().width;
  if (image.naturalWidth <= 0 || renderedWidth <= 0) {
    return 100;
  }
  return clampZoomPercent(renderedWidth / image.naturalWidth * 100);
}

export function ProjectImageViewer({
  currentIndex,
  dataUrl,
  fileName,
  hasNext,
  hasPrevious,
  total,
  onNext,
  onPrevious,
}: {
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
  const [zoomPercent, setZoomPercent] = useState<number | null>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const viewportRef = useRef<HTMLDivElement>(null);
  const zoomPercentRef = useRef<number | null>(null);

  const commitZoomPercent = (value: number | null): void => {
    zoomPercentRef.current = value;
    setZoomPercent(value);
  };

  useEffect(() => {
    const image = imageRef.current;
    if (!image) {
      return undefined;
    }

    const handleWheelZoom = (event: WheelEvent): void => {
      const viewport = viewportRef.current;
      if (!viewport || event.deltaY === 0) {
        return;
      }

      const imageRect = image.getBoundingClientRect();
      if (image.naturalWidth <= 0 || imageRect.width <= 0 || imageRect.height <= 0) {
        return;
      }

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
      if (Math.abs(next - current) < 0.01) {
        return;
      }

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
    const factor = direction > 0 ? BUTTON_ZOOM_FACTOR : 1 / BUTTON_ZOOM_FACTOR;
    commitZoomPercent(clampZoomPercent(current * factor));
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
    setNaturalSize({
      height: event.currentTarget.naturalHeight,
      width: event.currentTarget.naturalWidth,
    });
  };

  const imageStyle = zoomPercent !== null && naturalSize.width > 0 && naturalSize.height > 0
    ? {
        height: `${naturalSize.height * zoomPercent / 100}px`,
        maxHeight: "none",
        maxWidth: "none",
        width: `${naturalSize.width * zoomPercent / 100}px`,
      }
    : undefined;

  return (
    <section
      aria-label={`${fileName} 图片查看器`}
      className="flex min-h-0 flex-1 flex-col bg-[var(--app-panel)]"
    >
      <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1 border-b border-[var(--app-border)] px-2 py-1">
        <div className="flex min-w-0 items-center px-1">
          <span
            aria-live="polite"
            className="min-w-12 text-center text-[length:var(--app-font-size-caption)] tabular-nums text-[var(--app-muted-foreground)]"
          >
            {currentIndex + 1} / {Math.max(1, total)}
          </span>
        </div>
        <div className="ml-auto flex min-w-0 items-center gap-1">
          <IconButton
            disabled={zoomPercent === MIN_ZOOM_PERCENT}
            label="缩小图片"
            size="compact"
            variant="quiet"
            onClick={() => adjustZoom(-1)}
          >
            <ZoomOut aria-hidden="true" size={16} />
          </IconButton>
          <span
            aria-live="polite"
            className="min-w-12 text-center text-[length:var(--app-font-size-caption)] tabular-nums text-[var(--app-muted-foreground)]"
          >
            {zoomPercent === null ? "适应" : `${Math.round(zoomPercent)}%`}
          </span>
          <IconButton
            disabled={zoomPercent === MAX_ZOOM_PERCENT}
            label="放大图片"
            size="compact"
            variant="quiet"
            onClick={() => adjustZoom(1)}
          >
            <ZoomIn aria-hidden="true" size={16} />
          </IconButton>
          <button
            aria-label="显示图片实际大小"
            className="h-8 rounded-[var(--app-radius)] px-2 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)] transition-colors hover:bg-[var(--app-hover)] hover:text-[var(--app-foreground)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
            type="button"
            onClick={() => commitZoomPercent(100)}
          >
            1:1
          </button>
          <IconButton
            label="使图片适应窗口"
            size="compact"
            variant="quiet"
            onClick={() => commitZoomPercent(null)}
          >
            <Maximize2 aria-hidden="true" size={15} />
          </IconButton>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        <div
          ref={viewportRef}
          className="h-full min-h-0 overflow-auto bg-[var(--app-canvas)] p-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-focus-ring)]"
          role="group"
          tabIndex={0}
          onKeyDown={handleKeyboardNavigation}
        >
          <div className="flex min-h-full min-w-full items-center justify-center">
            <img
              ref={imageRef}
              alt={fileName}
              className={zoomPercent === null ? "block max-h-full max-w-full object-contain" : "block shrink-0 object-contain"}
              draggable={false}
              src={dataUrl}
              style={imageStyle}
              onDoubleClick={() => commitZoomPercent(zoomPercentRef.current === null ? 100 : null)}
              onLoad={handleImageLoad}
            />
          </div>
        </div>
        {hasPrevious ? (
          <IconButton
            className="absolute left-2 top-1/2 z-10 size-9 -translate-y-1/2 rounded-full border border-[var(--app-border)] bg-[var(--app-panel-subtle)] text-[var(--app-muted-foreground)] shadow-sm hover:bg-[var(--app-panel)] hover:text-[var(--app-foreground)]"
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
            className="absolute right-2 top-1/2 z-10 size-9 -translate-y-1/2 rounded-full border border-[var(--app-border)] bg-[var(--app-panel-subtle)] text-[var(--app-muted-foreground)] shadow-sm hover:bg-[var(--app-panel)] hover:text-[var(--app-foreground)]"
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
