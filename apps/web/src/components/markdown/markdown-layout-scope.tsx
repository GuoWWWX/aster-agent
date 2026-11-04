import { createContext, useCallback, useContext, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";

type ObserveLayout = (target: HTMLElement) => () => void;
const MarkdownLayoutContext = createContext<ObserveLayout | undefined>(undefined);
export function MarkdownLayoutScope({ onResize, children }: { onResize: () => void; children: ReactNode }) {
  const resize = useRef(onResize);
  const current = useRef<{ observer: ResizeObserver; count: number } | null>(null);
  useLayoutEffect(() => { resize.current = onResize; }, [onResize]);
  const observe = useCallback((target: HTMLElement) => {
    if (current.current === null) {
      const observer = new ResizeObserver(entries => {
        if (current.current?.observer === observer && entries.some(entry => entry.contentRect.width > 0)) resize.current();
      });
      current.current = { observer, count: 0 };
    }
    const registration = current.current;
    registration.count++;
    registration.observer.observe(target);
    return () => {
      registration.observer.unobserve(target);
      if (--registration.count === 0) {
        registration.observer.disconnect();
        if (current.current === registration) current.current = null;
      }
    };
  }, []);
  return <MarkdownLayoutContext.Provider value={observe}>{children}</MarkdownLayoutContext.Provider>;
}

/** Preserve the conversation's existing follow/read policy when deferred content grows. */
export function useMarkdownLayout(host: RefObject<HTMLElement | null>, activated: boolean): void {
  const observe = useContext(MarkdownLayoutContext);
  useLayoutEffect(() => {
    const target = host.current;
    if (!activated || target === null || observe === undefined) return;
    return observe(target);
  }, [activated, host, observe]);
}
