import { Bot, LoaderCircle, MessageSquareText, Search, UserRound } from "lucide-react";
import { useEffect, useRef, useState, type ReactElement } from "react";

import type { ConversationSearchResult } from "@agent/protocol";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";

function roleLabel(role: ConversationSearchResult["role"]): string {
  if (role === "user") return "用户";
  if (role === "agent") return "Agent 消息";
  return "AI";
}

function RoleIcon({ role }: { role: ConversationSearchResult["role"] }): ReactElement {
  if (role === "user") return <UserRound aria-hidden="true" size={14} />;
  if (role === "agent") return <Bot aria-hidden="true" size={14} />;
  return <MessageSquareText aria-hidden="true" size={14} />;
}

export function GlobalConversationSearchDialog({
  agentClient,
  onOpenChange,
  onSelect,
  open,
}: {
  agentClient: AgentClient;
  onOpenChange: (open: boolean) => void;
  onSelect: (result: ConversationSearchResult) => void;
  open: boolean;
}): ReactElement {
  const requestIdRef = useRef(0);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ConversationSearchResult[]>([]);
  const [isLoading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const normalized = query.trim();
    if (normalized.length === 0) {
      requestIdRef.current += 1;
      return;
    }
    const requestId = ++requestIdRef.current;
    const timer = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void agentClient.searchConversations({ limit: 50, query: normalized })
        .then((nextResults) => {
          if (requestId === requestIdRef.current) setResults(nextResults);
        })
        .catch((reason: unknown) => {
          if (requestId === requestIdRef.current) {
            setError(getUserErrorMessage(reason, "搜索对话失败。"));
            setResults([]);
          }
        })
        .finally(() => {
          if (requestId === requestIdRef.current) setLoading(false);
        });
    }, 140);
    return () => window.clearTimeout(timer);
  }, [agentClient, open, query]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) {
        requestIdRef.current += 1;
        setLoading(false);
      }
      onOpenChange(nextOpen);
    }}>
      <DialogContent className="max-h-[min(680px,calc(100vh-3rem))] max-w-2xl grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden border border-[var(--app-border)]">
        <DialogHeader className="border-b border-[var(--app-border)] px-5 pb-3 pt-4 pr-12">
          <DialogTitle>搜索所有对话</DialogTitle>
          <DialogDescription>搜索用户、AI 与 Agent 消息，选择结果后定位到原消息。</DialogDescription>
        </DialogHeader>
        <label className="mx-4 mt-3 flex h-9 items-center gap-2 rounded-md border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-3 focus-within:border-[var(--app-accent)]">
          <Search aria-hidden="true" className="text-[var(--app-muted-foreground)]" size={16} />
          <input
            autoFocus
            aria-label="搜索所有对话"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--app-muted-foreground)]"
            placeholder="输入消息内容"
            value={query}
            onChange={(event) => {
              const value = event.target.value;
              requestIdRef.current += 1;
              setQuery(value);
              if (value.trim().length === 0) {
                setResults([]);
                setError(null);
                setLoading(false);
              }
            }}
          />
          {isLoading ? <LoaderCircle aria-label="正在搜索" className="animate-spin text-[var(--app-muted-foreground)]" size={15} /> : null}
        </label>
        <div className="min-h-56 overflow-y-auto p-4" aria-live="polite">
          {error !== null ? <p className="rounded-md bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">{error}</p> : null}
          {error === null && query.trim().length === 0 ? (
            <p className="grid min-h-48 place-items-center text-sm text-[var(--app-muted-foreground)]">输入关键词开始搜索</p>
          ) : null}
          {error === null && query.trim().length > 0 && !isLoading && results.length === 0 ? (
            <p className="grid min-h-48 place-items-center text-sm text-[var(--app-muted-foreground)]">没有找到匹配消息</p>
          ) : null}
          {results.length > 0 ? (
            <ul className="space-y-1">
              {results.map((result) => (
                <li key={result.itemId}>
                  <button
                    className="w-full rounded-md px-3 py-2.5 text-left hover:bg-[var(--app-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
                    type="button"
                    onClick={() => onSelect(result)}
                  >
                    <span className="flex items-center gap-2 text-xs text-[var(--app-muted-foreground)]">
                      <RoleIcon role={result.role} />
                      <strong className="min-w-0 flex-1 truncate font-medium text-[var(--app-foreground)]">{result.conversationTitle}</strong>
                      <span>{roleLabel(result.role)}</span>
                      <time dateTime={result.createdAt}>{new Date(result.createdAt).toLocaleString()}</time>
                    </span>
                    <span className="mt-1.5 block line-clamp-2 text-sm leading-5">{result.content}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
