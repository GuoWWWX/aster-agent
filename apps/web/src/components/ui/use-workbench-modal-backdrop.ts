import { useLayoutEffect, useState, type CSSProperties } from "react";
import { useNativeOverlayContainer } from "./native-overlay-provider.js";

export const WORKBENCH_MODAL_BACKDROP_CLASS = "bg-black/10 backdrop-blur-[3px]";
const nativeBlurOwners = new WeakMap<HTMLElement, { count: number; filter: string }>();

/** Measure the host workbench even when the modal lives in a separate native document. */
export function useWorkbenchOverlayBounds(active = true): CSSProperties {
  const [bounds, setBounds] = useState<CSSProperties>({ inset: 0 });
  useLayoutEffect(() => {
    if (!active) return;
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
    if (rail != null) observer.observe(rail);
    window.addEventListener("resize", update);
    return () => { observer.disconnect(); window.removeEventListener("resize", update); };
  }, [active]);
  return bounds;
}

export function useWorkbenchModalBackdrop(): CSSProperties {
  const container = useNativeOverlayContainer();
  const bounds = useWorkbenchOverlayBounds();
  useLayoutEffect(() => {
    // A native overlay cannot sample the parent window with backdrop-filter.
    if (container === undefined || container.ownerDocument === document) return;
    const surfaces = [...document.querySelectorAll<HTMLElement>(".workbench-grid > .workbench-main, .workbench-grid > .workbench-sidebar")];
    for (const element of surfaces) {
      const owner = nativeBlurOwners.get(element);
      if (owner !== undefined) owner.count += 1;
      else {
        nativeBlurOwners.set(element, { count: 1, filter: element.style.filter });
        element.style.filter = `${element.style.filter} blur(3px)`.trim();
      }
    }
    return () => {
      for (const element of surfaces) {
        const owner = nativeBlurOwners.get(element);
        if (owner !== undefined && --owner.count === 0) {
          element.style.filter = owner.filter;
          nativeBlurOwners.delete(element);
        }
      }
    };
  }, [container]);
  return bounds;
}
