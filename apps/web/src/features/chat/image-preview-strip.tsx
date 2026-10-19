import { useEffect, useRef, type ReactNode } from "react";

/** Scroll only overflowing image rows; at either end, let the conversation scroll. */
export function ImagePreviewStrip({ children, label = "查看的图片" }: { children: ReactNode; label?: string }) {
  const element = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const row = element.current;
    if (row === null) return;
    const wheel = (event: WheelEvent): void => {
      if (event.ctrlKey || row.scrollWidth <= row.clientWidth) return;
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      const distance = delta * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? row.clientWidth : 1);
      const next = Math.max(0, Math.min(row.scrollWidth - row.clientWidth, row.scrollLeft + distance));
      if (next === row.scrollLeft) return;
      event.preventDefault();
      row.scrollLeft = next;
    };
    row.addEventListener("wheel", wheel, { passive: false });
    return () => row.removeEventListener("wheel", wheel);
  }, []);
  return <div ref={element} role="region" aria-label={label} tabIndex={0}
    className="flex min-w-0 max-w-full items-start gap-[5px] overflow-x-auto py-[5px] focus-visible:rounded-[var(--app-radius)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
    {children}
  </div>;
}
