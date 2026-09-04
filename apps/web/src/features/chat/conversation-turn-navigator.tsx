import type { ConversationMessageItem, ConversationTimelineItem } from "@agent/protocol";
import { useEffect, useMemo, useRef, useState, type ReactElement, type RefObject } from "react";

import { TooltipAnchor } from "../../components/ui/tooltip.js";

const QUESTION_SUMMARY_CHARACTERS = 58;
const ANSWER_SUMMARY_CHARACTERS = 110;
const TURN_MARKER_GAP_PX = 10;
const NAVIGATOR_MIN_SURFACE_WIDTH_PX = 824;
const TURN_MARKER_WIDTHS_PX = [32, 24, 16] as const;

export type ConversationTurnPreview = {
  answer: string;
  id: string;
  question: string;
};

function plainConversationText(content: string): string {
  return content
    .replace(/<thinking>[\s\S]*?<\/thinking>/giu, " ")
    .replace(/```[\s\S]*?```/gu, " 代码片段 ")
    .replace(/!\[([^\]]*)\]\([^)]+\)/gu, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/<[^>]+>/gu, " ")
    .replace(/[*_~`>#]/gu, "")
    .replace(/\s+/gu, " ")
    .trim();
}

function shortenConversationText(content: string, maxCharacters: number): string {
  const characters = Array.from(plainConversationText(content));
  return characters.length <= maxCharacters
    ? characters.join("")
    : `${characters.slice(0, maxCharacters).join("")}…`;
}

function userQuestionSummary(message: ConversationMessageItem): string {
  const content = shortenConversationText(message.content, QUESTION_SUMMARY_CHARACTERS);
  if (content.length > 0) return content;
  if (message.attachments.length === 1) return `发送了附件：${message.attachments[0]?.name ?? "文件"}`;
  if (message.attachments.length > 1) return `发送了 ${message.attachments.length} 个附件`;
  return "空白提问";
}

export function createConversationTurnPreviews(
  timeline: readonly ConversationTimelineItem[],
): ConversationTurnPreview[] {
  const answersByRunId = new Map<string, string>();
  for (const item of timeline) {
    if (
      item.kind !== "message"
      || item.role !== "assistant"
      || item.runId === null
      || item.content.trim().length === 0
    ) continue;
    answersByRunId.set(
      item.runId,
      shortenConversationText(item.content, ANSWER_SUMMARY_CHARACTERS),
    );
  }

  return timeline.flatMap((item) => {
    if (item.kind !== "message" || item.role !== "user") return [];
    return [{
      answer: item.runId === null
        ? "暂无模型输出"
        : answersByRunId.get(item.runId) ?? "暂无模型输出",
      id: item.id,
      question: userQuestionSummary(item),
    }];
  });
}

function timelineAnchor(root: HTMLElement, id: string): HTMLElement | null {
  const wrapper = Array.from(
    root.querySelectorAll<HTMLElement>("[data-conversation-timeline-item]"),
  ).find((candidate) => candidate.dataset.conversationTimelineItem === id);
  if (wrapper === undefined) return null;
  return wrapper.firstElementChild instanceof HTMLElement ? wrapper.firstElementChild : wrapper;
}

function timelineAnchors(
  root: HTMLElement,
  turnIds: ReadonlySet<string>,
): Map<string, HTMLElement> {
  const anchors = new Map<string, HTMLElement>();
  for (const wrapper of root.querySelectorAll<HTMLElement>(
    "[data-conversation-timeline-item]",
  )) {
    const id = wrapper.dataset.conversationTimelineItem;
    if (id === undefined || !turnIds.has(id)) continue;
    anchors.set(
      id,
      wrapper.firstElementChild instanceof HTMLElement ? wrapper.firstElementChild : wrapper,
    );
  }
  return anchors;
}

export function visibleConversationTurnIds(
  root: HTMLElement,
  turnIds: ReadonlySet<string>,
): Set<string> {
  const rootRect = root.getBoundingClientRect();
  const visibleIds = new Set<string>();
  for (const [id, anchor] of timelineAnchors(root, turnIds)) {
    const rect = anchor.getBoundingClientRect();
    if (rect.bottom >= rootRect.top && rect.top <= rootRect.bottom) {
      visibleIds.add(id);
    }
  }
  return visibleIds;
}

export function conversationTurnOffsetPixels(index: number, turnCount: number): number {
  return (index - (turnCount - 1) / 2) * TURN_MARKER_GAP_PX;
}

export function conversationTurnMarkerWidthPixels(
  index: number,
  hoveredIndex: number | null,
): number {
  if (hoveredIndex === null) return 8;
  return TURN_MARKER_WIDTHS_PX[Math.abs(index - hoveredIndex)] ?? 8;
}

export function conversationTurnIndexAtRailPosition({
  clientY,
  railClientHeight,
  railScrollTop,
  railTop,
  turnCount,
}: {
  clientY: number;
  railClientHeight: number;
  railScrollTop: number;
  railTop: number;
  turnCount: number;
}): number | null {
  if (turnCount <= 0) return null;
  const contentHeight = Math.max(railClientHeight, turnCount * TURN_MARKER_GAP_PX);
  const firstMarkerY = contentHeight / 2 + conversationTurnOffsetPixels(0, turnCount);
  const index = Math.round(
    (clientY - railTop + railScrollTop - firstMarkerY) / TURN_MARKER_GAP_PX,
  );
  return Math.max(0, Math.min(index, turnCount - 1));
}

export function isConversationTurnNavigatorNarrow(width: number): boolean {
  return width > 0 && width < NAVIGATOR_MIN_SURFACE_WIDTH_PX;
}

export function ConversationTurnNavigator({
  bottomOffsetPx,
  containerRef,
  hidden,
  onNavigateStart,
  timeline,
}: {
  bottomOffsetPx: number;
  containerRef: RefObject<HTMLDivElement | null>;
  hidden: boolean;
  onNavigateStart: () => void;
  timeline: readonly ConversationTimelineItem[];
}): ReactElement | null {
  const turns = useMemo(() => createConversationTurnPreviews(timeline), [timeline]);
  const turnIds = useMemo(() => new Set(turns.map((turn) => turn.id)), [turns]);
  const railRef = useRef<HTMLElement | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const dragAnchorsRef = useRef<ReadonlyMap<string, HTMLElement> | null>(null);
  const dragPointerRef = useRef<{ moved: boolean; pointerId: number; startY: number } | null>(null);
  const lastDraggedIndexRef = useRef<number | null>(null);
  const pendingDragClientYRef = useRef<number | null>(null);
  const pointerStartedNavigationRef = useRef(false);
  const suppressNextClickRef = useRef(false);
  const [visibleTurnIds, setVisibleTurnIds] = useState<ReadonlySet<string>>(new Set());
  const [hiddenByWidth, setHiddenByWidth] = useState(false);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  useEffect(() => {
    if (hidden || turns.length === 0) return undefined;
    const root = containerRef.current;
    if (root === null) return undefined;
    let frameId: number | null = null;
    const updateNavigator = (): void => {
      frameId = null;
      setHiddenByWidth(isConversationTurnNavigatorNarrow(root.clientWidth));
      const nextVisibleTurnIds = visibleConversationTurnIds(root, turnIds);
      setVisibleTurnIds((current) =>
        stringSetsEqual(current, nextVisibleTurnIds) ? current : nextVisibleTurnIds
      );
      const visibleIndexes = turns.flatMap((turn, index) =>
        nextVisibleTurnIds.has(turn.id) ? [index] : []
      );
      const rail = railRef.current;
      if (
        dragPointerRef.current === null
        && rail !== null
        && visibleIndexes.length > 0
        && rail.scrollHeight > rail.clientHeight
      ) {
        const firstIndex = visibleIndexes[0] ?? 0;
        const lastIndex = visibleIndexes.at(-1) ?? firstIndex;
        const centerIndex = (firstIndex + lastIndex) / 2;
        const centeredScrollTop = (centerIndex + 0.5) * TURN_MARKER_GAP_PX
          - rail.clientHeight / 2;
        rail.scrollTop = Math.max(
          0,
          Math.min(centeredScrollTop, rail.scrollHeight - rail.clientHeight),
        );
      }
    };
    const scheduleUpdate = (): void => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(updateNavigator);
    };
    scheduleUpdate();
    root.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(scheduleUpdate);
    resizeObserver?.observe(root);
    return () => {
      root.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      resizeObserver?.disconnect();
      if (frameId !== null) window.cancelAnimationFrame(frameId);
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, [containerRef, hidden, turnIds, turns]);

  const navigateToRailPosition = (clientY: number): void => {
    const rail = railRef.current;
    const root = containerRef.current;
    if (rail === null || root === null) return;
    const index = conversationTurnIndexAtRailPosition({
      clientY,
      railClientHeight: rail.clientHeight,
      railScrollTop: rail.scrollTop,
      railTop: rail.getBoundingClientRect().top,
      turnCount: turns.length,
    });
    if (index === null || lastDraggedIndexRef.current === index) return;
    lastDraggedIndexRef.current = index;
    setHoveredIndex(index);
    const turn = turns[index];
    const anchor = turn === undefined
      ? null
      : dragAnchorsRef.current?.get(turn.id) ?? timelineAnchor(root, turn.id);
    anchor?.scrollIntoView({ behavior: "auto", block: "center" });
  };

  const scheduleDragNavigation = (clientY: number): void => {
    pendingDragClientYRef.current = clientY;
    if (dragFrameRef.current !== null) return;
    dragFrameRef.current = window.requestAnimationFrame(() => {
      dragFrameRef.current = null;
      const pendingClientY = pendingDragClientYRef.current;
      pendingDragClientYRef.current = null;
      if (pendingClientY !== null) navigateToRailPosition(pendingClientY);
    });
  };

  const finishDrag = (clientY: number | null): void => {
    if (dragFrameRef.current !== null) {
      window.cancelAnimationFrame(dragFrameRef.current);
      dragFrameRef.current = null;
    }
    pendingDragClientYRef.current = null;
    if (clientY !== null) navigateToRailPosition(clientY);
    suppressNextClickRef.current = dragPointerRef.current?.moved ?? false;
    dragPointerRef.current = null;
    dragAnchorsRef.current = null;
    lastDraggedIndexRef.current = null;
    setHoveredIndex(null);
  };

  if (hidden || hiddenByWidth || turns.length === 0) return null;
  return (
    <nav
      ref={railRef}
      aria-label="对话轮次导航"
      className="conversation-turn-navigator pointer-events-auto absolute left-2 z-[6] w-10 -translate-y-1/2 overflow-y-auto overscroll-contain"
      style={{
        height: "min(56%, 28rem)",
        top: `calc((100% - ${bottomOffsetPx}px) / 2)`,
        touchAction: "none",
      }}
      onWheel={(event) => {
        const rail = event.currentTarget;
        if (rail.scrollHeight <= rail.clientHeight) return;
        event.preventDefault();
        event.stopPropagation();
        rail.scrollTop += event.deltaY;
      }}
    >
      <div
        className="relative min-h-full w-full"
        style={{ height: `max(100%, ${turns.length * TURN_MARKER_GAP_PX}px)` }}
      >
        {turns.map((turn, index) => {
          const active = visibleTurnIds.has(turn.id);
          const offset = conversationTurnOffsetPixels(index, turns.length);
          return (
            <TooltipAnchor
              key={turn.id}
              side="right"
              contentClassName="conversation-turn-tooltip !w-fit !max-w-96 overflow-hidden !px-2.5 !py-2 !text-[length:var(--app-font-size-control)] !leading-[1.4]"
              content={(
                <span className="grid min-w-0 max-w-[22rem] gap-1 overflow-hidden text-left">
                  <strong className="block min-w-0 truncate whitespace-nowrap font-semibold text-[var(--app-foreground)]">
                    {turn.question}
                  </strong>
                  <span className="line-clamp-3 min-w-0 max-w-full overflow-hidden break-words font-normal [overflow-wrap:anywhere] text-[var(--app-muted-foreground)]">
                    {turn.answer}
                  </span>
                </span>
              )}
            >
              <button
                aria-current={active ? "true" : undefined}
                aria-label={`跳到提问：${turn.question}`}
                className="group absolute left-0 flex h-[10px] w-10 -translate-y-1/2 cursor-ns-resize items-center border-0 bg-transparent p-0 focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1"
                style={{ top: `calc(50% + ${offset}px)` }}
                type="button"
                onBlur={() => {
                  if (dragPointerRef.current === null) setHoveredIndex(null);
                }}
                onFocus={() => setHoveredIndex(index)}
                onMouseEnter={() => setHoveredIndex(index)}
                onMouseLeave={() => {
                  if (dragPointerRef.current === null) setHoveredIndex(null);
                }}
                onPointerDown={(event) => {
                  if (event.button !== 0) return;
                  event.preventDefault();
                  dragPointerRef.current = {
                    moved: false,
                    pointerId: event.pointerId,
                    startY: event.clientY,
                  };
                  const root = containerRef.current;
                  dragAnchorsRef.current = root === null ? null : timelineAnchors(root, turnIds);
                  lastDraggedIndexRef.current = null;
                  suppressNextClickRef.current = false;
                  pointerStartedNavigationRef.current = true;
                  if (typeof event.currentTarget.setPointerCapture === "function") {
                    event.currentTarget.setPointerCapture(event.pointerId);
                  }
                  onNavigateStart();
                  scheduleDragNavigation(event.clientY);
                }}
                onPointerMove={(event) => {
                  const dragPointer = dragPointerRef.current;
                  if (dragPointer === null || dragPointer.pointerId !== event.pointerId) return;
                  event.preventDefault();
                  if (Math.abs(event.clientY - dragPointer.startY) >= 3) dragPointer.moved = true;
                  scheduleDragNavigation(event.clientY);
                }}
                onPointerUp={(event) => {
                  const dragPointer = dragPointerRef.current;
                  if (dragPointer === null || dragPointer.pointerId !== event.pointerId) return;
                  if (typeof event.currentTarget.releasePointerCapture === "function") {
                    event.currentTarget.releasePointerCapture(event.pointerId);
                  }
                  finishDrag(event.clientY);
                }}
                onPointerCancel={() => {
                  finishDrag(null);
                  pointerStartedNavigationRef.current = false;
                }}
                onClick={(event) => {
                  const navigationAlreadyStarted = pointerStartedNavigationRef.current;
                  pointerStartedNavigationRef.current = false;
                  if (suppressNextClickRef.current) {
                    suppressNextClickRef.current = false;
                    event.preventDefault();
                    return;
                  }
                  const root = containerRef.current;
                  const anchor = root === null ? null : timelineAnchor(root, turn.id);
                  if (anchor === null) return;
                  if (!navigationAlreadyStarted) onNavigateStart();
                  anchor.scrollIntoView({ behavior: "smooth", block: "center" });
                }}
              >
                <span
                  aria-hidden="true"
                  data-hover-distance={hoveredIndex === null
                    ? undefined
                    : Math.abs(index - hoveredIndex)}
                  className={active
                    ? "h-0.5 bg-[var(--app-foreground)] transition-[width,background-color] duration-150"
                    : "h-0.5 bg-[var(--app-border)] transition-[width,background-color] duration-150 group-hover:bg-[var(--app-muted-foreground)]"}
                  style={{ width: conversationTurnMarkerWidthPixels(index, hoveredIndex) }}
                />
              </button>
            </TooltipAnchor>
          );
        })}
      </div>
    </nav>
  );
}

function stringSetsEqual(current: ReadonlySet<string>, next: ReadonlySet<string>): boolean {
  if (current.size !== next.size) return false;
  for (const id of next) {
    if (!current.has(id)) return false;
  }
  return true;
}
