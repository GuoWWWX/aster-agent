import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { ListTodo, MessageSquareQuote } from "lucide-react";
import type { ChatReference } from "@agent/protocol";

export type InlineReference = { label: string; content: ReactNode };
type ReferenceScope = { resolve: (ids: string[]) => Promise<ChatReference[]>; open: (reference: ChatReference) => void };
const ReferenceContext = createContext<ReferenceScope | null>(null);
const uuidPattern = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/giu;

/** Only prose is resolved: fenced code stays byte-for-byte available as code. */
export function proseReferenceIds(content: string): string[] {
  if (content.match(uuidPattern) === null) return [];
  let fence: string | undefined;
  const prose = content.split("\n").filter(line => {
    const marker = /^\s*(?:>\s*)*(`{3,}|~{3,})/u.exec(line)?.[1];
    if (fence !== undefined) { if (marker !== undefined && marker[0] === fence[0] && marker.length >= fence.length && new RegExp(`^\\s*${marker[0]}{${fence.length},}\\s*$`, "u").test(line)) fence = undefined; return false; }
    if (marker !== undefined) { fence = marker; return false; }
    return true;
  }).join("\n");
  return [...new Set(prose.match(uuidPattern) ?? [])];
}

export function ChatReferenceScope({ scopeKey, resolve, onOpen, children }: {
  scopeKey: string; resolve: ReferenceScope["resolve"]; onOpen: ReferenceScope["open"]; children: ReactNode;
}): ReactElement {
  const scope = useMemo(() => {
    const cache = new Map<string, Promise<ChatReference | null>>();
    return { scopeKey, open: onOpen, resolve: async (ids: string[]) => {
      const missing = ids.filter(id => !cache.has(id));
      for (let offset = 0; offset < missing.length; offset += 20) {
        const batch = missing.slice(offset, offset + 20);
        const lookup = resolve(batch).catch(reason => { for (const id of batch) cache.delete(id); throw reason; });
        for (const id of batch) cache.set(id, lookup.then(references => references.find(reference => reference.id.toLowerCase() === id.toLowerCase()) ?? null));
      }
      return (await Promise.all(ids.map(id => cache.get(id)!))).filter((reference): reference is ChatReference => reference !== null);
    } };
  }, [scopeKey, resolve, onOpen]);
  return <ReferenceContext.Provider value={scope}>{children}</ReferenceContext.Provider>;
}

export function useChatReferences(content: string, streaming: boolean): readonly InlineReference[] {
  const scope = useContext(ReferenceContext);
  const ids = useMemo(() => proseReferenceIds(content), [content]);
  const [resolved, setResolved] = useState<{ scope: ReferenceScope; references: ChatReference[] } | null>(null);
  useEffect(() => {
    if (scope === null || streaming || ids.length === 0) return;
    let disposed = false;
    void scope.resolve(ids).then(references => { if (!disposed) setResolved({ scope, references }); }).catch(() => { if (!disposed) setResolved({ scope, references: [] }); });
    return () => { disposed = true; };
  }, [scope, ids, streaming]);
  if (scope === null) return [];
  const references = resolved?.scope === scope ? resolved.references : [];
  return ids.flatMap(id => {
    const reference = references.find(item => item.id.toLowerCase() === id.toLowerCase());
    const contextual = content.includes(`task://${id}`) || content.includes(`message://${id}`) || new RegExp(`(?:群消息|消息|任务)(?:[\\s:#：*\x60]|ID|id)*${id}`, "u").test(content);
    if (reference === undefined && !contextual) return [];
    if (reference === undefined) return [{ label: id, content: <span className="text-[var(--app-muted-foreground)]">{resolved?.scope === scope ? "引用已不可用" : "正在读取引用…"}</span> }];
    return [{ label: id, content: reference.kind === "task" ? <button type="button" onClick={() => scope.open(reference)} aria-label={`打开任务 ${reference.title}`} className="inline-flex max-w-full items-center gap-[5px] align-middle text-[var(--app-accent)] hover:underline focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]"><ListTodo size={14} className="shrink-0" /><span className="min-w-0 break-words">任务 {reference.title}</span></button>
      : <button type="button" onClick={() => scope.open(reference)} aria-label={`定位 ${reference.senderName} 的引用消息`} className="my-1 inline-flex max-w-full items-start gap-2 rounded-[var(--app-radius)] border-l-2 border-[var(--app-accent)] bg-[var(--app-hover)] px-2 py-1 text-left align-middle text-[length:var(--app-font-size-control)] hover:bg-[var(--app-selection)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]"><MessageSquareQuote size={14} className="mt-1 shrink-0 text-[var(--app-muted-foreground)]" /><span className="min-w-0"><span className="block text-[var(--app-muted-foreground)]">{reference.senderName}</span><span className="line-clamp-2 whitespace-pre-wrap break-words">{reference.content || "空消息"}</span></span></button> }];
  });
}
