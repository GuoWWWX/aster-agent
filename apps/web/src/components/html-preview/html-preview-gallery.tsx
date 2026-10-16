import { useCallback, useEffect, useRef, useState, type ReactElement } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import type { HtmlPresentationPage } from "@agent/protocol";
import { IconButton } from "../ui/icon-button.js";
import { Select, SelectContent, SelectItem, SelectTrigger } from "../ui/select.js";
import { HtmlPreviewCard } from "./html-preview-card.js";

export function HtmlPreviewGallery({ pages, cacheTtlMs }: { pages: readonly HtmlPresentationPage[]; cacheTtlMs: number }): ReactElement {
  const [index, setIndex] = useState(0);
  const [visited, setVisited] = useState(() => new Set([0]));
  const [height, setHeight] = useState<number>();
  const measure = useCallback((measured: number) => { setHeight(current => current ?? measured); }, []);
  const select = (next: number): void => { setVisited(current => new Set([...current, next])); setIndex(next); };
  const page = pages[index]!;
  return <section aria-label="HTML 方案对比" className="my-[5px] min-w-0 overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] text-[var(--app-foreground)]">
    {pages.map((option, optionIndex) => visited.has(optionIndex) ? <CachedOption key={optionIndex} page={option} active={optionIndex === index} height={height} onHeight={measure} cacheTtlMs={cacheTtlMs} /> : null)}
    <footer className="flex min-w-0 items-center justify-center gap-[5px] border-t border-[var(--app-border)] px-2 py-1">
      <IconButton label="上一个方案" size="compact" disabled={index === 0} onClick={() => select(index - 1)}><ChevronLeft size={14} /></IconButton>
      <Select value={String(index)} onValueChange={value => select(Number(value))}>
        <SelectTrigger aria-label="选择预览方案" className="h-7 max-w-[min(320px,70%)] border-transparent shadow-none">
          <span className="min-w-0 truncate" aria-live="polite">{index + 1} / {pages.length} · {page.title}</span>
        </SelectTrigger>
        <SelectContent>{pages.map((option, optionIndex) => <SelectItem key={optionIndex} value={String(optionIndex)}>{optionIndex + 1}. {option.title}</SelectItem>)}</SelectContent>
      </Select>
      <IconButton label="下一个方案" size="compact" disabled={index === pages.length - 1} onClick={() => select(index + 1)}><ChevronRight size={14} /></IconButton>
    </footer>
  </section>;
}

function CachedOption({ page, active, height, onHeight, cacheTtlMs }: {
  page: HtmlPresentationPage; active: boolean; height: number | undefined; onHeight: (height: number) => void; cacheTtlMs: number;
}): ReactElement {
  const host = useRef<HTMLDivElement>(null);
  const [resident, setResident] = useState(true);
  useEffect(() => {
    const target = host.current;
    if (target === null || typeof IntersectionObserver === "undefined") return;
    let visible = true;
    let expiresAt = Date.now() + cacheTtlMs;
    let timer = setTimeout(expire, cacheTtlMs);
    function expire(): void { if (!visible) setResident(false); }
    const observer = new IntersectionObserver(([entry]) => {
      if (entry === undefined) return;
      visible = entry.isIntersecting;
      if (Date.now() < expiresAt) return;
      if (!visible) { setResident(false); return; }
      setResident(true);
      expiresAt = Date.now() + cacheTtlMs;
      clearTimeout(timer);
      timer = setTimeout(expire, cacheTtlMs);
    });
    observer.observe(target);
    return () => { clearTimeout(timer); observer.disconnect(); };
  }, [cacheTtlMs]);
  return <div ref={host} hidden={!active}>
    <HtmlPreviewCard source={page} embedded suspended={!resident} previewHeight={height} onPreviewHeight={onHeight} />
  </div>;
}
