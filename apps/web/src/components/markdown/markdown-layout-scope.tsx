import { createContext, useContext, useLayoutEffect, type ReactNode, type RefObject } from "react";

const MarkdownLayoutContext = createContext<(() => void) | undefined>(undefined);
export function MarkdownLayoutScope({ onResize, children }: { onResize: () => void; children: ReactNode }) {
  return <MarkdownLayoutContext.Provider value={onResize}>{children}</MarkdownLayoutContext.Provider>;
}

/** Preserve the conversation's existing follow/read policy when deferred content grows. */
export function useMarkdownLayout(host: RefObject<HTMLElement | null>, activated: boolean): void {
  const onResize = useContext(MarkdownLayoutContext);
  useLayoutEffect(() => {
    const target = host.current;
    if (!activated || target === null || onResize === undefined) return;
    onResize();
    const observer = new ResizeObserver(onResize);
    observer.observe(target);
    return () => observer.disconnect();
  }, [activated, host, onResize]);
}
