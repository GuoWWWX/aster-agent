import { ImageIcon, Loader2 } from "lucide-react";
import { useEffect, useRef, useState, type WheelEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog.js";
import { cn } from "../../lib/cn.js";
import { svgDataUrl } from "../../lib/svg-image.js";
import { ImagePreviewViewer } from "./image-preview-viewer.js";

export { svgDataUrl };

const minZoom = 0.25;
const maxZoom = 4;
const mediaPreviewRequestEvent = "md-king:open-media-preview";

type MediaPreviewRequest = {
  src: string;
  alt?: string;
  title?: string;
};

function clampZoom(value: number) {
  return Math.min(maxZoom, Math.max(minZoom, value));
}

export function requestMediaPreview(request: MediaPreviewRequest) {
  window.dispatchEvent(new CustomEvent<MediaPreviewRequest>(mediaPreviewRequestEvent, { detail: request }));
}

export function ImageViewer({ src, alt, className, paper = false }: { src: string; alt?: string; className?: string; paper?: boolean }) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [naturalSize, setNaturalSize] = useState<{ width: number; height: number }>();

  useEffect(() => {
    // Reset transient viewport state when the requested image changes.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZoom(1);
    setNaturalSize(undefined);
  }, [src]);

  useEffect(() => {
    const node = viewportRef.current;
    if (!node) return undefined;
    const update = () => setViewport({ width: node.clientWidth, height: node.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  function handleWheel(event: WheelEvent<HTMLDivElement>) {
    if (!event.ctrlKey) return;
    event.preventDefault();
    setZoom((current) => clampZoom(Number((current * (event.deltaY < 0 ? 1.1 : 0.9)).toFixed(3))));
  }

  const fitScale = naturalSize && viewport.width > 0 && viewport.height > 0
    ? Math.min(Math.max(1, viewport.width - 32) / naturalSize.width, Math.max(1, viewport.height - 32) / naturalSize.height)
    : 1;
  const imageWidth = naturalSize ? Math.max(1, naturalSize.width * fitScale * zoom) : undefined;
  const imageHeight = naturalSize ? Math.max(1, naturalSize.height * fitScale * zoom) : undefined;
  const canvasWidth = Math.max(viewport.width, (imageWidth ?? 0) + 32);
  const canvasHeight = Math.max(viewport.height, (imageHeight ?? 0) + 32);
  // 适配尺寸下出现滚动条会反过来挤压 clientWidth/clientHeight，触发尺寸重算并闪烁。
  // 仅在用户放大图片后开放双轴滚动。
  const allowPan = zoom > 1;

  return (
    <div
      ref={viewportRef}
      className={cn("min-h-0 min-w-0", paper ? "bg-white dark:bg-[#202020]" : "bg-slate-50 dark:bg-zinc-900", allowPan ? "overflow-auto" : "overflow-hidden", className)}
      onWheel={handleWheel}
      aria-label={alt ? `${alt}，图片查看器` : "图片查看器"}
    >
      <div
        className="box-border flex items-center justify-center p-4"
        style={{ minWidth: "100%", minHeight: "100%", width: canvasWidth || undefined, height: canvasHeight || undefined }}
      >
        <img
          src={src}
          alt={alt ?? ""}
          className="block max-w-none shrink-0 object-contain"
          style={{ width: imageWidth, height: imageHeight }}
          onLoad={(event) => setNaturalSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
        />
      </div>
    </div>
  );
}

export function ImageDocumentViewer({ src, alt, path }: { src?: string; alt: string; path?: string }) {
  const label = path || alt;
  return (
    <section className="mk-card flex h-full min-h-[360px] min-w-0 max-w-full flex-1 flex-col overflow-hidden rounded-[5px] max-[760px]:min-h-[300px]">
      <header className="flex h-8 shrink-0 min-w-0 items-center gap-1.5 border-b border-slate-200 px-3 text-xs dark:border-zinc-800">
        <ImageIcon className="size-3.5 shrink-0 text-slate-400 dark:text-zinc-500" />
        <span className="truncate font-semibold text-slate-700 dark:text-zinc-200" title={label}>{label}</span>
      </header>
      {src ? <ImageViewer src={src} alt={alt} paper className="h-full flex-1" /> : (
        <div className="flex h-full min-h-0 flex-1 items-center justify-center bg-white text-slate-400 dark:bg-[#202020] dark:text-zinc-500">
          <Loader2 className="size-5 animate-spin" aria-label="正在加载图片" />
        </div>
      )}
    </section>
  );
}

export function MediaPreviewDialog({ open, onOpenChange, src, alt, title }: { open: boolean; onOpenChange: (open: boolean) => void; src?: string; alt?: string; title?: string }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="left-0 top-0 flex h-dvh w-screen max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none bg-transparent p-0 shadow-none sm:max-w-none [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:z-30 [&_[data-slot=dialog-close]]:size-10 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:bg-black/60 [&_[data-slot=dialog-close]]:text-zinc-200 [&_[data-slot=dialog-close]]:backdrop-blur-md [&_[data-slot=dialog-close]]:hover:bg-black/80 [&_[data-slot=dialog-close]]:hover:text-white"
        overlayClassName="bg-black/85 backdrop-blur-[2px]"
      >
        <DialogTitle className="sr-only">{title ?? alt ?? "图片预览"}</DialogTitle>
        <DialogDescription className="sr-only">可缩放的图片预览</DialogDescription>
        {src ? (
          <ImagePreviewViewer
            key={src}
            appearance="overlay"
            currentIndex={0}
            dataUrl={src}
            fileName={alt ?? title ?? "图片预览"}
            hasNext={false}
            hasPrevious={false}
            total={1}
            onNext={() => undefined}
            onPrevious={() => undefined}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

export function MediaPreviewDialogHost() {
  const [request, setRequest] = useState<MediaPreviewRequest>();

  useEffect(() => {
    const open = (event: Event) => setRequest((event as CustomEvent<MediaPreviewRequest>).detail);
    window.addEventListener(mediaPreviewRequestEvent, open);
    return () => window.removeEventListener(mediaPreviewRequestEvent, open);
  }, []);

  return <MediaPreviewDialog open={Boolean(request)} onOpenChange={(open) => { if (!open) setRequest(undefined); }} {...request} />;
}
