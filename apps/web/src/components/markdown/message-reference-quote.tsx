import MarkdownIt from "markdown-it";
import { CircleUserRound } from "lucide-react";
import { useMemo, type ReactElement, type ReactNode } from "react";

const previewParser = new MarkdownIt({ html: false });

/** Quote text is a preview, not another interactive Markdown document. */
export function messageReferencePreview(content: string): string {
  return previewParser.parse(content.slice(0, 2000), {}).flatMap(token => {
    if (token.type === "inline") return [(token.children ?? []).map(child =>
      ["text", "code_inline", "image"].includes(child.type) ? child.content
        : ["softbreak", "hardbreak"].includes(child.type) ? "\n" : "").join("")];
    return ["fence", "code_block"].includes(token.type) ? [token.content.trim()] : [];
  }).join("\n").trim() || "空消息";
}

export function MessageReferenceQuote({ senderName, content, avatar, onOpen, label }: {
  senderName: string; content: string; avatar?: ReactNode; onOpen: () => void; label?: string;
}): ReactElement {
  const preview = useMemo(() => messageReferencePreview(content), [content]);
  return <button type="button" data-message-reference-quote aria-label={label ?? `定位 ${senderName} 的引用消息`}
    onClick={onOpen}
    className="my-[5px] inline-flex min-w-0 max-w-full flex-col gap-[5px] rounded-[var(--app-radius)] border-l-2 border-[var(--app-accent)] bg-[var(--app-hover)] px-2 py-[5px] text-left align-middle text-[length:var(--app-font-size-control)] hover:bg-[var(--app-selection)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
    <span className="flex min-w-0 max-w-full items-center gap-[5px] text-[var(--app-accent)]">
      {avatar ?? <CircleUserRound aria-hidden="true" size={20} className="shrink-0" />}
      <span className="min-w-0 truncate">{senderName}</span>
    </span>
    <span data-message-reference-preview className="line-clamp-3 min-w-0 max-w-full whitespace-pre-wrap break-words text-[var(--app-muted-foreground)] [overflow-wrap:anywhere]">{preview}</span>
  </button>;
}
