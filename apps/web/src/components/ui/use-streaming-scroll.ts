import { EditorView } from "@codemirror/view";
import { useLayoutEffect, useRef, type RefObject } from "react";

type ScrollPosition = { top: number; left: number; following: boolean };

/** Keep output at its tail, preserving a reader's position even when Markdown replaces its DOM. */
export function useStreamingScroll(
  hostRef: RefObject<HTMLElement | null>,
  revision: string,
  streaming: boolean,
): void {
  const positions = useRef(new Map<string, ScrollPosition>());
  const wasStreaming = useRef(false);
  useLayoutEffect(() => {
    const host = hostRef.current;
    const follow = streaming || wasStreaming.current;
    wasStreaming.current = streaming;
    if (host === null || (!follow && positions.current.size === 0)) return;
    const tracked = new Map<HTMLElement, ScrollPosition>();
    let frame: number | undefined;
    const synchronize = (): void => {
      frame = undefined;
      const elements = [...host.querySelectorAll<HTMLElement>("pre:not([hidden]), .cm-scroller")];
      // A completed HTML fence becomes a preview and loses its source scroller.
      // Count cards as well so the next fence keeps its own reading position.
      const cards = [...host.querySelectorAll(".agent-markdown__code-block, .agent-markdown__mermaid")];
      for (const element of tracked.keys()) {
        if (!elements.includes(element)) { resize.unobserve(element); tracked.delete(element); }
      }
      elements.forEach((element, index) => {
        const known = tracked.has(element);
        const card = element.closest(".agent-markdown__code-block, .agent-markdown__mermaid");
        const key = card === null ? `output:${index}` : `code:${cards.indexOf(card)}`;
        const saved = positions.current.get(key);
        const position = saved ?? { top: element.scrollTop, left: element.scrollLeft, following: true };
        tracked.set(element, position);
        positions.current.set(key, position);
        if (!known) resize.observe(element);
        const editor = element.classList.contains("cm-scroller") ? EditorView.findFromDOM(element) : null;
        if (follow && position.following) {
          if (editor === null) element.scrollTop = element.scrollHeight;
          else if (!known) editor.dispatch({ effects: EditorView.scrollIntoView(editor.state.doc.length, { y: "end" }) });
        } else if (!known && saved !== undefined) element.scrollTop = position.top;
        if (!known && editor !== null) editor.requestMeasure();
        if (!known) element.scrollLeft = position.left;
        position.top = element.scrollTop;
        position.left = element.scrollLeft;
      });
    };
    const schedule = (): void => { frame ??= window.requestAnimationFrame(synchronize); };
    const resize = new ResizeObserver(schedule);
    const mutations = new MutationObserver(schedule);
    const onScroll = (event: Event): void => {
      const element = event.target as HTMLElement;
      const position = tracked.get(element);
      if (position === undefined) return;
      // Ignore the scroll event queued by our own restoration/follow operation.
      if (position.top === element.scrollTop && position.left === element.scrollLeft) return;
      position.top = element.scrollTop;
      position.left = element.scrollLeft;
      position.following = element.scrollHeight - element.clientHeight - element.scrollTop <= 4;
    };
    host.addEventListener("scroll", onScroll, true);
    mutations.observe(host, { childList: true, subtree: true, characterData: true });
    synchronize();
    return () => {
      host.removeEventListener("scroll", onScroll, true);
      mutations.disconnect();
      resize.disconnect();
      if (frame !== undefined) window.cancelAnimationFrame(frame);
    };
  }, [hostRef, revision, streaming]);
}
