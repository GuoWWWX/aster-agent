import { ArrowDown, ArrowUp, Search, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type RefObject,
} from "react";

import type { ConversationSearchResult } from "@agent/protocol";

import { IconButton } from "../../components/ui/icon-button.js";

const MATCH_HIGHLIGHT = "conversation-find-match";
const ACTIVE_HIGHLIGHT = "conversation-find-active";
const REMOTE_SEARCH_PAGE_SIZE = 100;
const MAX_MATCHES = 500;

type HighlightConstructor = new (...ranges: Range[]) => unknown;
type HighlightRegistry = {
  delete(name: string): void;
  set(name: string, highlight: unknown): void;
};

function highlightApi(): { Highlight: HighlightConstructor; registry: HighlightRegistry } | null {
  const constructor = (globalThis as typeof globalThis & { Highlight?: HighlightConstructor }).Highlight;
  const registry = (globalThis.CSS as typeof CSS & { highlights?: HighlightRegistry } | undefined)?.highlights;
  return constructor === undefined || registry === undefined
    ? null
    : { Highlight: constructor, registry };
}

export function findConversationTextRanges(root: HTMLElement, query: string): Range[] {
  const normalizedQuery = query.toLocaleLowerCase();
  if (normalizedQuery.length === 0) return [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent === null || parent.closest("[data-conversation-find-ignore]") !== null) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const ranges: Range[] = [];
  let node = walker.nextNode();
  while (node !== null && ranges.length < MAX_MATCHES) {
    const text = node.textContent ?? "";
    const normalizedText = text.toLocaleLowerCase();
    let fromIndex = 0;
    while (ranges.length < MAX_MATCHES) {
      const index = normalizedText.indexOf(normalizedQuery, fromIndex);
      if (index < 0) break;
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + query.length);
      ranges.push(range);
      fromIndex = index + Math.max(1, query.length);
    }
    node = walker.nextNode();
  }
  return ranges;
}

function clearHighlights(): void {
  const api = highlightApi();
  api?.registry.delete(MATCH_HIGHLIGHT);
  api?.registry.delete(ACTIVE_HIGHLIGHT);
}

export function scrollConversationMatchIntoView(root: HTMLElement, range: Range): void {
  const rangeWithLayout = range as Range & {
    getBoundingClientRect?: () => DOMRect;
  };
  const matchRect = rangeWithLayout.getBoundingClientRect?.() ?? null;
  const rootRect = root.getBoundingClientRect();
  if (
    matchRect !== null
    && matchRect.height > 0
    && rootRect.height > 0
    && typeof root.scrollTo === "function"
  ) {
    if (matchRect.top >= rootRect.top && matchRect.bottom <= rootRect.bottom) return;
    const centeredTop = root.scrollTop
      + matchRect.top
      - rootRect.top
      - (root.clientHeight - matchRect.height) / 2;
    root.scrollTo({ behavior: "smooth", top: Math.max(0, centeredTop) });
    return;
  }

  const timelineItem = range.startContainer.parentElement?.closest<HTMLElement>(
    "[data-conversation-timeline-item]",
  );
  timelineItem?.scrollIntoView?.({ behavior: "smooth", block: "center" });
}

export function ConversationFindBar({
  active,
  containerRef,
  onReveal,
  revision,
  search,
}: {
  active: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  onReveal?: (result: ConversationSearchResult) => Promise<void>;
  revision: unknown;
  search?: (query: string, beforeSequence?: number) => Promise<ConversationSearchResult[]>;
}): ReactElement | null {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<Range[]>([]);
  const [searchResults, setSearchResults] = useState<ConversationSearchResult[]>([]);
  const [searchResultsQuery, setSearchResultsQuery] = useState("");
  const [searchHasMore, setSearchHasMore] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const searchRequestIdRef = useRef(0);

  const close = useCallback(() => {
    setOpen(false);
    clearHighlights();
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape" && isOpen) {
        event.preventDefault();
        close();
        return;
      }
      if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
      if (event.key.toLocaleLowerCase() !== "f" || event.defaultPrevented) return;
      const target = event.target instanceof Element ? event.target : null;
      if (target !== null && target.closest(
        '[data-managed-browser-workspace], [data-slot="dialog-content"]',
      ) !== null) return;
      event.preventDefault();
      setOpen(true);
      window.requestAnimationFrame(() => inputRef.current?.focus());
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [active, close, isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const root = containerRef.current;
    const nextMatches = root === null ? [] : findConversationTextRanges(root, query);
    setMatches(nextMatches);
    setActiveIndex((current) => nextMatches.length === 0 ? 0 : Math.min(current, nextMatches.length - 1));
  }, [containerRef, isOpen, query, revision]);

  useEffect(() => {
    const requestId = ++searchRequestIdRef.current;
    if (!isOpen || query.length === 0 || search === undefined) {
      return;
    }
    const timeout = window.setTimeout(() => {
      void search(query).then((results) => {
        if (requestId !== searchRequestIdRef.current) return;
        setSearchResults(results);
        setSearchResultsQuery(query);
        setSearchHasMore(results.length === REMOTE_SEARCH_PAGE_SIZE);
        setActiveIndex(0);
      }).catch(() => {
        if (requestId === searchRequestIdRef.current) {
          setSearchResults([]);
          setSearchResultsQuery(query);
          setSearchHasMore(false);
        }
      });
    }, 120);
    return () => window.clearTimeout(timeout);
  }, [isOpen, query, search]);

  const visibleSearchResults = useMemo(
    () => searchResultsQuery === query ? searchResults : [],
    [query, searchResults, searchResultsQuery],
  );

  useEffect(() => {
    const result = visibleSearchResults[activeIndex];
    if (!isOpen || result === undefined || onReveal === undefined) return;
    void onReveal(result);
  }, [activeIndex, isOpen, onReveal, visibleSearchResults]);

  useEffect(() => {
    clearHighlights();
    if (!isOpen || matches.length === 0) return;
    const api = highlightApi();
    if (api !== null) {
      api.registry.set(MATCH_HIGHLIGHT, new api.Highlight(...matches));
      const activeResult = visibleSearchResults[activeIndex];
      const activeMatch = activeResult === undefined
        ? matches[activeIndex]
        : matches.find((range) => range.startContainer.parentElement?.closest<HTMLElement>(
            "[data-conversation-timeline-item]",
          )?.dataset.conversationTimelineItem === activeResult.itemId);
      if (activeMatch !== undefined) {
        api.registry.set(ACTIVE_HIGHLIGHT, new api.Highlight(activeMatch));
      }
    }
    const activeResult = visibleSearchResults[activeIndex];
    const activeMatch = activeResult === undefined
      ? matches[activeIndex]
      : matches.find((range) => range.startContainer.parentElement?.closest<HTMLElement>(
          "[data-conversation-timeline-item]",
        )?.dataset.conversationTimelineItem === activeResult.itemId);
    const root = containerRef.current;
    if (activeMatch !== undefined && root !== null) {
      scrollConversationMatchIntoView(root, activeMatch);
    }
    return clearHighlights;
  }, [activeIndex, containerRef, isOpen, matches, visibleSearchResults]);

  useEffect(() => clearHighlights, []);

  const move = (direction: -1 | 1): void => {
    const matchCount = visibleSearchResults.length > 0
      ? visibleSearchResults.length
      : matches.length;
    if (matchCount === 0) return;
    if (
      direction === 1
      && visibleSearchResults.length > 0
      && activeIndex === visibleSearchResults.length - 1
      && searchHasMore
      && search !== undefined
    ) {
      const beforeSequence = visibleSearchResults.at(-1)?.sequence;
      if (beforeSequence === undefined) return;
      const requestId = ++searchRequestIdRef.current;
      void search(query, beforeSequence).then((results) => {
        if (requestId !== searchRequestIdRef.current) return;
        const knownItemIds = new Set(visibleSearchResults.map((result) => result.itemId));
        const olderResults = results.filter((result) => !knownItemIds.has(result.itemId));
        setSearchHasMore(results.length === REMOTE_SEARCH_PAGE_SIZE);
        if (olderResults.length === 0) {
          setActiveIndex(0);
          return;
        }
        setSearchResults((current) => [...current, ...olderResults]);
        setActiveIndex(visibleSearchResults.length);
      }).catch(() => setSearchHasMore(false));
      return;
    }
    setActiveIndex((current) => (current + direction + matchCount) % matchCount);
  };

  if (!active || !isOpen) return null;
  const matchCount = visibleSearchResults.length > 0
    ? visibleSearchResults.length
    : matches.length;
  return (
    <div
      className="absolute right-3 top-2 z-40 flex h-9 w-[min(430px,calc(100%-24px))] items-center gap-1 rounded-md border border-[var(--app-border)] bg-[var(--app-panel)] px-2 shadow-lg"
      data-conversation-find-ignore
      role="search"
    >
      <Search aria-hidden="true" className="shrink-0 text-[var(--app-muted-foreground)]" size={15} />
      <input
        ref={inputRef}
        aria-label="在当前对话中查找"
        className="h-7 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[var(--app-muted-foreground)]"
        placeholder="在当前对话中查找"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setActiveIndex(0);
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          move(event.shiftKey ? -1 : 1);
        }}
      />
      <span className="min-w-14 shrink-0 text-center text-xs tabular-nums text-[var(--app-muted-foreground)]">
        {query.length === 0 || matchCount === 0
          ? `0 / ${matchCount}`
          : `${activeIndex + 1} / ${matchCount}${searchHasMore ? "+" : ""}`}
      </span>
      <IconButton disabled={matchCount === 0} label="上一个匹配项" size="compact" variant="quiet" onClick={() => move(-1)}>
        <ArrowUp aria-hidden="true" size={15} />
      </IconButton>
      <IconButton disabled={matchCount === 0} label="下一个匹配项" size="compact" variant="quiet" onClick={() => move(1)}>
        <ArrowDown aria-hidden="true" size={15} />
      </IconButton>
      <IconButton label="关闭查找" size="compact" variant="quiet" onClick={close}>
        <X aria-hidden="true" size={15} />
      </IconButton>
    </div>
  );
}
