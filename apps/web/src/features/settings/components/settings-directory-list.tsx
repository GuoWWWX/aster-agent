import { useLayoutEffect, useRef, type ReactElement, type ReactNode } from "react";

/** Keep the selected entry visible without scrolling its surrounding settings page. */
export function SettingsDirectoryList({ children, className, selectedId }: {
  children: ReactNode;
  className: string;
  selectedId: string | null;
}): ReactElement {
  const listRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const list = listRef.current;
    const selected = list?.querySelector<HTMLElement>('[data-selected="true"]');
    if (list === null || selected === undefined || selected === null) return;
    const visibleTop = list.getBoundingClientRect().top + list.clientTop;
    const visibleBottom = visibleTop + list.clientHeight;
    const row = selected.getBoundingClientRect();
    if (row.top < visibleTop) list.scrollTop -= visibleTop - row.top;
    else if (row.bottom > visibleBottom) list.scrollTop += row.bottom - visibleBottom;
  }, [selectedId]);
  return <div ref={listRef} className={className}>{children}</div>;
}
