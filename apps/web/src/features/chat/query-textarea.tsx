import { useCallback, useLayoutEffect, useRef, type ReactNode, type RefObject, type TextareaHTMLAttributes } from "react";
import { referenceDeletionRange, type ComposerReferenceRange } from "./composer-reference-ranges.js";

/** Native editing with inline query/reference colors and atomic reference deletion. */
export function QueryTextarea({ query, references = [], onReferenceDelete, renderReferenceIcon, onValueChange, textareaRef, value, onScroll, onKeyDown, ...props }: {
  query: { start: number; end: number } | null;
  references?: readonly ComposerReferenceRange[];
  onReferenceDelete?: (range: ComposerReferenceRange) => void;
  renderReferenceIcon?: (range: ComposerReferenceRange) => ReactNode;
  onValueChange?: (value: string, caret: number) => void;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  value: string;
} & Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, "value">) {
  const mirrorRef = useRef<HTMLDivElement>(null);
  const icons = new Map(references.filter((range) => query === null || range.end <= query.start || range.start >= query.end)
    .map((range) => [range.start, renderReferenceIcon?.(range)] as const).filter((entry) => entry[1] != null));
  // One full-width space replaces one prefix character, retaining all selection offsets.
  const displayValue = value.split("").map((character, index) => icons.has(index) ? "\u3000" : character).join("");
  const highlights: ComposerReferenceRange[] = [];
  for (const range of [...references, ...(query === null ? [] : [query])].sort((a, b) => a.start - b.start)) {
    const previous = highlights.at(-1);
    if (previous !== undefined && range.start <= previous.end) previous.end = Math.max(previous.end, range.end);
    else highlights.push({ ...range });
  }
  const syncMirror = useCallback((): void => {
    const input = textareaRef.current;
    const mirror = mirrorRef.current;
    if (input === null || mirror === null) return;
    mirror.style.width = `${input.clientWidth}px`;
    mirror.style.height = `${input.clientHeight}px`;
    mirror.scrollTop = input.scrollTop;
    mirror.scrollLeft = input.scrollLeft;
  }, [textareaRef]);
  useLayoutEffect(() => {
    syncMirror();
  });
  useLayoutEffect(() => {
    const input = textareaRef.current;
    if (input === null) return;
    const observer = new ResizeObserver(syncMirror);
    observer.observe(input);
    return () => observer.disconnect();
  }, [textareaRef, syncMirror]);
  return <div className="relative">
    {highlights.length === 0 ? null : <div aria-hidden="true" ref={mirrorRef}
      className="pointer-events-none absolute left-0 top-0 overflow-hidden whitespace-pre-wrap break-words px-3 pt-2.5 pb-[5px] text-[length:var(--app-font-size-body)] leading-[18px] text-[var(--app-foreground)]">
      {highlights.map((range, index) => <span key={range.start}>
        {value.slice(highlights[index - 1]?.end ?? 0, range.start)}<span className="text-[var(--app-accent)]" data-composer-query>
          {icons.has(range.start) ? <><span className="relative" data-composer-reference-icon>
            <span className="invisible">{"\u3000"}</span>
            <span className="absolute inset-0 inline-flex items-center justify-center">{icons.get(range.start)}</span>
          </span>{value.slice(range.start + 1, range.end)}</> : value.slice(range.start, range.end)}
        </span>
      </span>)}{value.slice(highlights.at(-1)?.end ?? 0)}{"\u200b"}
    </div>}
    <textarea {...props} ref={textareaRef} value={displayValue} data-query-active={highlights.length === 0 ? undefined : "true"}
      onChange={(event) => {
        if (onValueChange === undefined) { props.onChange?.(event); return; }
        const next = event.currentTarget.value;
        let start = 0;
        while (start < displayValue.length && start < next.length && displayValue[start] === next[start]) start++;
        let end = displayValue.length;
        let nextEnd = next.length;
        while (end > start && nextEnd > start && displayValue[end - 1] === next[nextEnd - 1]) { end--; nextEnd--; }
        onValueChange(value.slice(0, start) + next.slice(start, nextEnd) + value.slice(end), event.currentTarget.selectionStart);
      }}
      onCopy={(event) => {
        if (icons.size === 0) { props.onCopy?.(event); return; }
        event.preventDefault();
        event.clipboardData.setData("text/plain", value.slice(event.currentTarget.selectionStart, event.currentTarget.selectionEnd));
      }}
      onCut={(event) => {
        if (icons.size === 0 || onValueChange === undefined) { props.onCut?.(event); return; }
        event.preventDefault();
        const { selectionStart: start, selectionEnd: end } = event.currentTarget;
        event.clipboardData.setData("text/plain", value.slice(start, end));
        if (!props.readOnly && !props.disabled) onValueChange(value.slice(0, start) + value.slice(end), start);
      }}
      onKeyDown={(event) => {
        if (!event.nativeEvent.isComposing && !props.readOnly && !props.disabled
          && onReferenceDelete !== undefined && (event.key === "Backspace" || event.key === "Delete")) {
          let range = referenceDeletionRange(references, event.currentTarget.selectionStart,
            event.currentTarget.selectionEnd, event.key === "Backspace");
          const caret = event.currentTarget.selectionStart;
          if (range === null && event.key === "Backspace" && caret === event.currentTarget.selectionEnd
            && value[caret - 1] === " " && references.some((reference) => reference.end === caret - 1)) {
            const reference = references.find((candidate) => candidate.end === caret - 1);
            if (reference !== undefined) range = { start: reference.start, end: caret };
          }
          if (range !== null) {
            event.preventDefault();
            onReferenceDelete(range);
            return;
          }
        }
        onKeyDown?.(event);
      }}
      onScroll={(event) => { syncMirror(); onScroll?.(event); }} />
  </div>;
}
