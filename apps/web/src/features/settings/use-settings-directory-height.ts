import { useLayoutEffect, useRef, type RefObject } from "react";

/** Fits a sticky directory to the visible settings page; its body owns scrolling. */
export function useSettingsDirectoryHeight(): RefObject<HTMLElement | null> {
  const directoryRef = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const directory = directoryRef.current;
    const content = directory?.closest<HTMLElement>(".settings-content");
    const section = directory?.closest<HTMLElement>(".settings-section");
    if (directory === null || content === undefined || content === null || section === undefined || section === null) return;

    let frame: number | null = null;
    const measure = (): void => {
      const offset = Math.max(0, directory.getBoundingClientRect().top - content.getBoundingClientRect().top);
      const bottomPadding = Number.parseFloat(getComputedStyle(section).paddingBottom) || 0;
      const height = `${Math.max(0, Math.floor(content.clientHeight - offset - bottomPadding))}px`;
      if (directory.style.getPropertyValue("--settings-directory-height") !== height) {
        directory.style.setProperty("--settings-directory-height", height);
      }
    };
    const schedule = (): void => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        measure();
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    observer.observe(section);
    content.addEventListener("scroll", schedule, { passive: true });
    return () => {
      observer.disconnect();
      content.removeEventListener("scroll", schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, []);

  return directoryRef;
}
