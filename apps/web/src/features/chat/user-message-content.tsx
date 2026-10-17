import { ChevronDown, ChevronUp } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState, type ReactElement, type ReactNode } from "react";
import { referenceProseSegments, useChatReferences, type InlineReference } from "../../components/markdown/chat-reference-scope.js";
import { findComposerReferenceRanges } from "./composer-reference-ranges.js";

function referencedText(content: string, references: readonly InlineReference[]): ReactNode {
  if (references.length === 0) return content;
  return referenceProseSegments(content).map((segment, segmentIndex) => {
    if (!segment.prose) return segment.text;
    const text = segment.text;
    const protectedRanges = [...text.matchAll(/https?:\/\/[^\s]+|(`+)[^\n]*?\1/gu)];
    const links = [...text.matchAll(/\[[^\]\n]*\]\((?:task|message):\/\/([0-9a-f-]{36})\)/giu)];
    const matches = references.flatMap((reference) => {
      if (!/^[0-9a-f-]{36}$/iu.test(reference.label)) return findComposerReferenceRanges(text, [reference.label]).map(range => ({ ...range, reference }));
      return [...text.matchAll(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/giu)].flatMap(match => {
        if (match[0].toLowerCase() !== reference.label.toLowerCase()) return [];
        const start = match.index; const end = start + match[0].length;
        const link = links.find(item => item.index <= start && item.index + item[0].length >= end);
        if (link) return [{ start: link.index, end: link.index + link[0].length, reference }];
        const protectedRange = protectedRanges.find(item => item.index <= start && item.index + item[0].length >= end);
        if (protectedRange) return protectedRange[1] && protectedRange[0].slice(protectedRange[1].length, -protectedRange[1].length) === match[0]
          ? [{ start: protectedRange.index, end: protectedRange.index + protectedRange[0].length, reference }] : [];
        return [{ start, end, reference }];
      });
    }).sort((left, right) => left.start - right.start || right.end - left.end);
    let through = 0;
    const nodes: ReactNode[] = [];
    for (const match of matches) {
      if (match.start < through) continue;
      nodes.push(text.slice(through, match.start), <span key={`${segmentIndex}:${match.start}`}>{match.reference.content}</span>);
      through = match.end;
    }
    nodes.push(text.slice(through));
    return nodes;
  });
}

/** Fold only the visible body; copying, search and model history keep the full text. */
export function UserMessageContent({ content, children, inlineReferences = [] }: { content: string; children?: ReactNode; inlineReferences?: readonly InlineReference[] }): ReactElement {
  const references = [...inlineReferences, ...useChatReferences(content, false, "mention")];
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
  }, [content, children]);
  return <div className="min-w-0" data-user-message-content>
    <p ref={paragraph} id={contentId} className={expanded ? undefined : "line-clamp-6"}>{children ?? referencedText(content, references)}</p>
    {overflows ? <button type="button" aria-expanded={expanded} aria-controls={contentId}
      data-conversation-find-ignore
      onClick={() => setExpandedContent(expanded ? null : content)}
      className="mt-[5px] inline-flex items-center gap-1 rounded-[var(--app-radius-small)] bg-transparent text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)] hover:text-[var(--app-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
      {expanded ? <ChevronUp aria-hidden="true" size={13} /> : <ChevronDown aria-hidden="true" size={13} />}
      {expanded ? "收起" : "展开全文"}
    </button> : null}
  </div>;
}
