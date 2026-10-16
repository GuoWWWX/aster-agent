import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactElement } from "react";

/** Fold only the visible body; copying, search and model history keep the full text. */
export function UserMessageContent({ content }: { content: string }): ReactElement {
  const paragraph = useRef<HTMLParagraphElement>(null);
  const contentId = useId();
  const [overflows, setOverflows] = useState(false);
  const [expandedContent, setExpandedContent] = useState<string | null>(null);
  const expanded = expandedContent === content;
  useLayoutEffect(() => {
    const element = paragraph.current;
    if (element === null) return;
    const measure = (): void => {
      const lineHeight = Number.parseFloat(window.getComputedStyle(element).lineHeight);
      setOverflows(element.scrollHeight > lineHeight * 6 + 1);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, [content]);
  return <div className="min-w-0" data-user-message-content>
    <p ref={paragraph} id={contentId} className={expanded ? undefined : "line-clamp-6"}>{content}</p>
    {overflows ? <button type="button" aria-expanded={expanded} aria-controls={contentId}
      data-conversation-find-ignore
      onClick={() => setExpandedContent(expanded ? null : content)}
      className="mt-[5px] inline-flex items-center gap-1 rounded-[var(--app-radius-small)] bg-transparent text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)] hover:text-[var(--app-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
      {expanded ? <ChevronUp aria-hidden="true" size={13} /> : <ChevronDown aria-hidden="true" size={13} />}
      {expanded ? "收起" : "展开全文"}
    </button> : null}
  </div>;
}
