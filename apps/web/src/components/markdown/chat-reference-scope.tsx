import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { CircleUserRound, ListTodo } from "lucide-react";
import type { ChatReference } from "@agent/protocol";
import { MessageReferenceQuote } from "./message-reference-quote.js";

export type InlineReference = { label: string; content: ReactNode };
type ReferenceScope = { resolve: (ids: string[]) => Promise<ChatReference[]>; open: (reference: ChatReference) => void;
  renderMessageAvatar?: (reference: Extract<ChatReference, { kind: "message" }>) => ReactNode };
const ReferenceContext = createContext<ReferenceScope | null>(null);
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

/** Keep original text offsets and newlines while excluding fenced source. */
export function referenceProseSegments(content: string): { text: string; prose: boolean }[] {
  let fence: string | undefined;
  return (content.match(/[^\n]*\n|[^\n]+$/gu) ?? []).map(line => {
    const marker = /^\s*(?:>\s*)*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence !== undefined) { if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && new RegExp(`^\\s*${marker[0]}{${fence.length},}\\s*$`, "u").test(line)) fence = undefined; return { text: line, prose: false }; }
    if (marker !== undefined) { fence = marker; return { text: line, prose: false }; }
    return { text: line, prose: true };
  });
}

/** Only prose is resolved: fenced code stays byte-for-byte available as code. */
export function proseReferenceIds(content: string): string[] {
  if (content.match(uuidPattern) === null) return [];
  const prose = referenceProseSegments(content).filter(segment => segment.prose).map(segment => segment.text).join("");
  return [...new Set(prose.match(uuidPattern) ?? [])];
}

export function ChatReferenceScope({ scopeKey, resolve, onOpen, children, renderMessageAvatar }: {
  scopeKey: string; resolve: ReferenceScope["resolve"]; onOpen: ReferenceScope["open"]; children: ReactNode;
  renderMessageAvatar?: ReferenceScope["renderMessageAvatar"];
}): ReactElement {
  const lookup = useMemo(() => {
    const cache = new Map<string, Promise<ChatReference | null>>();
    return { scopeKey, resolve: async (ids: string[]) => {
      const missing = ids.filter(id => !cache.has(id));
      for (let offset = 0; offset < missing.length; offset += 20) {
        const batch = missing.slice(offset, offset + 20);
        const lookup = resolve(batch).catch(reason => { for (const id of batch) cache.delete(id); throw reason; });
        for (const id of batch) cache.set(id, lookup.then(references => references.find(reference => reference.id.toLowerCase() === id.toLowerCase()) ?? null));
      }
      return (await Promise.all(ids.map(id => cache.get(id)!))).filter((reference): reference is ChatReference => reference !== null);
    } };
  }, [scopeKey, resolve]);
  const scope = useMemo(() => ({ ...lookup, open: onOpen,
    ...(renderMessageAvatar === undefined ? {} : { renderMessageAvatar }) }), [lookup, onOpen, renderMessageAvatar]);
  return <ReferenceContext.Provider value={scope}>{children}</ReferenceContext.Provider>;
}

export function useChatReferences(content: string, streaming: boolean, presentation: "quote" | "mention" = "quote"): readonly InlineReference[] {
  const scope = useContext(ReferenceContext);
  const resolve = scope?.resolve;
  const ids = useMemo(() => proseReferenceIds(content), [content]);
  const [resolved, setResolved] = useState<{ resolve: ReferenceScope["resolve"]; references: ChatReference[] } | null>(null);
  useEffect(() => {
    if (resolve === undefined || streaming || ids.length === 0) return;
    let disposed = false;
    void resolve(ids).then(references => { if (!disposed) setResolved({ resolve, references }); }).catch(() => { if (!disposed) setResolved({ resolve, references: [] }); });
    return () => { disposed = true; };
  }, [resolve, ids, streaming]);
  if (scope === null) return [];
  const references = resolved !== null && resolved.resolve === resolve ? resolved.references : [];
  return ids.flatMap(id => {
    const reference = references.find(item => item.id.toLowerCase() === id.toLowerCase());
    const contextual = content.includes(`task://${id}`) || content.includes(`message://${id}`) || new RegExp(`(?:群消息|消息|任务)(?:[\\s:#：*\x60]|ID|id)*${id}`, "u").test(content);
    if (reference === undefined && !contextual) return [];
    if (reference === undefined) return [{ label: id, content: <span className="text-[var(--app-muted-foreground)]">{presentation === "mention" ? "@" : ""}{resolved?.resolve === resolve ? "引用已不可用" : "正在读取引用…"}</span> }];
    const avatar = reference.kind === "message" ? scope.renderMessageAvatar?.(reference) : undefined;
    return [{ label: id, content: reference.kind === "task" ? <button type="button" onClick={() => scope.open(reference)} aria-label={`打开任务 ${reference.title}`} className="inline-flex max-w-full items-center gap-[5px] align-middle text-[var(--app-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]"><ListTodo size={14} className="shrink-0" /><span className="min-w-0 break-words">@{reference.title}</span></button>
      : presentation === "mention" ? <button type="button" onClick={() => scope.open(reference)} aria-label={`定位 ${reference.senderName} 的引用消息`}
        className="inline-flex max-w-full items-center gap-[5px] align-middle text-[var(--app-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">{avatar ?? <CircleUserRound aria-hidden="true" size={16} className="shrink-0" />}<span className="min-w-0 break-words">@{reference.senderName}的消息</span></button>
        : <MessageReferenceQuote senderName={reference.senderName} content={reference.content} avatar={avatar} onOpen={() => scope.open(reference)} /> }];
  });
}
