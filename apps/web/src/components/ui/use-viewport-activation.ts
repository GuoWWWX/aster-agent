import { useEffect, useState, type RefObject } from "react";

/** Activate heavy content near the viewport once; retain it to preserve local state. */
export function useViewportActivation(host: RefObject<HTMLElement | null>, immediate = false): boolean {
  const [activated, setActivated] = useState(() => immediate || typeof IntersectionObserver === "undefined");
  if (immediate && !activated) setActivated(true);
  useEffect(() => {
    if (activated || immediate || typeof IntersectionObserver === "undefined") return;
    const target = host.current;
    if (target === null) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); setActivated(true); }
    }, { root: target.closest("[data-deferred-scroll-root]"), rootMargin: "400px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [activated, host, immediate]);
  return activated || immediate;
}
