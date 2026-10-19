import { LoadingState } from "../ui/loading.js";
import { ImageIcon } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type WheelEvent } from "react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../ui/dialog.js";
import { cn } from "../../lib/cn.js";
import { svgDataUrl } from "../../lib/svg-image.js";
import { ImagePreviewViewer } from "./image-preview-viewer.js";
import { useNativeOverlayContainer } from "../ui/native-overlay-provider.js";
import { mediaPreviewRequestEvent, type MediaPreviewImage, type MediaPreviewRequest } from "./media-preview-request.js";
export { requestMediaPreview, useMediaPreview } from "./media-preview-request.js";

export { svgDataUrl };

const minZoom = 0.25;
const maxZoom = 4;

function clampZoom(value: number) {
  return Math.min(maxZoom, Math.max(minZoom, value));
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
          <LoadingState label="正在加载图片" className="w-full" />
        </div>
      )}
    </section>
  );
}

export function MediaPreviewDialog({ open, onOpenChange, src, alt, title, imageKey, images, loadImages }: {
  open: boolean; onOpenChange: (open: boolean) => void; src?: string; alt?: string; title?: string;
  imageKey?: string; images?: readonly MediaPreviewImage[]; loadImages?: (signal?: AbortSignal) => Promise<readonly MediaPreviewImage[]>;
}) {
  const overlayContainer = useNativeOverlayContainer();
  const [bounds, setBounds] = useState<CSSProperties>({ inset: 0 });
  const [selected, setSelected] = useState(() => ({ key: imageKey ?? src ?? "", src: src ?? "",
    label: images?.find(image => image.key === imageKey)?.label ?? title ?? alt ?? "图片预览" }));
  const [gallery, setGallery] = useState<readonly MediaPreviewImage[]>(() => images ?? []);
  const [loading, setLoading] = useState(false);
  const [findingImages, setFindingImages] = useState(Boolean(loadImages));
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(false), navigating = useRef(false);
  const entries = gallery.some(image => image.key === selected.key) ? gallery
    : [...gallery, { key: selected.key, label: selected.label, load: () => Promise.resolve(selected.src) }];
  const index = entries.findIndex(image => image.key === selected.key);
  useEffect(() => {
    const abort = new AbortController();
    alive.current = open;
    if (open && loadImages) void loadImages(abort.signal).then(value => { if (!abort.signal.aborted) setGallery(value); })
      .catch(() => { if (!abort.signal.aborted) setError("部分历史图片无法读取，可关闭预览后重试。"); })
      .finally(() => { if (!abort.signal.aborted) setFindingImages(false); });
    return () => { alive.current = false; abort.abort(); };
  }, [open, loadImages]);
  const navigate = (next: number) => {
    const entry = entries[next];
    if (!entry || navigating.current) return;
    navigating.current = true; setLoading(true); setError(null);
    void entry.load().then(url => { if (alive.current) setSelected({ key: entry.key, src: url, label: entry.label }); })
      .catch(() => { if (alive.current) setError("图片无法读取，可能已移动或删除。可再次点击翻页重试。"); })
      .finally(() => { navigating.current = false; if (alive.current) setLoading(false); });
  };
  useLayoutEffect(() => {
    // A native overlay has a separate document: backdrop-filter cannot sample its parent window.
    if (!open || !overlayContainer || overlayContainer.ownerDocument === document) return;
    const surfaces = [...document.querySelectorAll<HTMLElement>(".workbench-grid > .workbench-main, .workbench-grid > .workbench-sidebar")];
    const filters = surfaces.map(element => element.style.filter);
    surfaces.forEach(element => { element.style.filter = `${element.style.filter} blur(3px)`.trim(); });
    return () => { surfaces.forEach((element, index) => { element.style.filter = filters[index] ?? ""; }); };
  }, [open, overlayContainer]);
  useLayoutEffect(() => {
    if (!open) return;
    // Read the host document, even when Dialog portals into the native overlay window.
    const workbench = document.querySelector(".workbench-grid");
    const rail = workbench?.querySelector('[data-slot="activity-bar"]');
    if (workbench === null) return;
    const update = () => {
      const area = workbench.getBoundingClientRect();
      setBounds({ top: Math.max(0, area.top), left: Math.max(0, rail?.getBoundingClientRect().right ?? area.left),
        right: Math.max(0, window.innerWidth - area.right), bottom: Math.max(0, window.innerHeight - area.bottom) });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(workbench);
    if (rail !== null && rail !== undefined) observer.observe(rail);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="flex h-auto w-auto max-w-none translate-x-0 translate-y-0 flex-col overflow-hidden rounded-none bg-transparent p-0 shadow-none sm:max-w-none [&_[data-slot=dialog-close]]:right-4 [&_[data-slot=dialog-close]]:top-4 [&_[data-slot=dialog-close]]:z-30 [&_[data-slot=dialog-close]]:size-10 [&_[data-slot=dialog-close]]:rounded-full [&_[data-slot=dialog-close]]:bg-black/60 [&_[data-slot=dialog-close]]:text-zinc-200 [&_[data-slot=dialog-close]]:backdrop-blur-md [&_[data-slot=dialog-close]]:hover:bg-black/80 [&_[data-slot=dialog-close]]:hover:text-white"
        style={bounds}
        overlayClassName="bg-black/10 backdrop-blur-[3px]"
        overlayStyle={bounds}
        onKeyDown={event => {
          if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey) return;
          if (event.key === "ArrowLeft" && index > 0) { event.preventDefault(); navigate(index - 1); }
          if (event.key === "ArrowRight" && index < entries.length - 1) { event.preventDefault(); navigate(index + 1); }
        }}
        onClickCapture={event => {
          const target = event.target as Element;
          if (typeof target.closest === "function" && target.closest("img, button, input, select, textarea") === null) onOpenChange(false);
        }}
      >
        <DialogTitle className="sr-only">{selected.label}</DialogTitle>
        <DialogDescription className="sr-only">滚轮上下移动，Shift 加滚轮左右移动，Ctrl 加滚轮缩放，左右箭头切换图片</DialogDescription>
        {loading || findingImages || error ? <div className="pointer-events-none absolute inset-x-14 top-4 z-30 text-center text-[length:var(--app-font-size-body)]" role={error ? "alert" : "status"}>
          <span className="inline-block rounded-[var(--app-radius)] bg-[var(--app-panel)] px-3 py-2 text-[var(--app-foreground)] shadow-sm">{error ?? (loading ? "正在读取图片…" : "正在查找对话图片…")}</span>
        </div> : null}
        {src ? (
          <ImagePreviewViewer
            key={selected.key}
            appearance="overlay"
            currentIndex={index}
            dataUrl={selected.src}
            fileName={selected.label}
            hasNext={index < entries.length - 1}
            hasPrevious={index > 0}
            navigationPending={loading}
            total={entries.length}
            onNext={() => navigate(index + 1)}
            onPrevious={() => navigate(index - 1)}
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

  return request ? <MediaPreviewDialog key={`${request.imageKey ?? request.src}`} open onOpenChange={(open) => { if (!open) setRequest(undefined); }} {...request} /> : null;
}
