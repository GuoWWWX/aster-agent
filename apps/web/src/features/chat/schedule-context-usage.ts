/** Give the first message paint priority; switching/closing cancels the queued read. */
export function scheduleContextUsage(refresh: () => void): () => void {
  let cancelled = false;
  if (typeof window.requestIdleCallback !== "function") {
    queueMicrotask(() => { if (!cancelled) refresh(); });
    return () => { cancelled = true; };
  }
  let idle: number | undefined;
  const frame = window.requestAnimationFrame(() => {
    idle = window.requestIdleCallback(() => { if (!cancelled) refresh(); }, { timeout: 1_000 });
  });
  return () => {
    cancelled = true;
    window.cancelAnimationFrame(frame);
    if (idle !== undefined) window.cancelIdleCallback(idle);
  };
}
