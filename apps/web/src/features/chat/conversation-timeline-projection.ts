import { isGptReasoningSummaryModel } from "@agent/protocol";
import type { ConversationMessageItem, ConversationModelRetryItem, ConversationTimelineItem, ConversationToolItem } from "@agent/protocol";

export type ToolBatchTimelineItem = {
  batchId: string;
  id: string;
  kind: "tool_batch";
  tools: ConversationToolItem[];
};

export type RunActivityReasoningItem = {
  content: string;
  id: string;
  kind: "activity_reasoning";
  streaming: boolean;
};

export type RunActivityProgressItem = {
  content: string;
  id: string;
  kind: "activity_progress";
  streaming: boolean;
};

export type RunActivityTextItem = RunActivityProgressItem | RunActivityReasoningItem;

export type RunActivityItem =
  | ConversationModelRetryItem
  | ConversationToolItem
  | RunActivityTextItem;

export type RunActivityTimelineItem = {
  durationMs: number | null;
  streaming: boolean;
  id: string;
  items: RunActivityItem[];
  kind: "run_activity";
  runId: string;
  runIds: string[];
};

export type TimelineDisplayItem = (ConversationTimelineItem & { continuationMessages?: ConversationMessageItem[] })
  | RunActivityTimelineItem
  | ToolBatchTimelineItem;

export function upsertTimelineItem(
  timeline: ConversationTimelineItem[],
  item: ConversationTimelineItem,
): ConversationTimelineItem[] {
  const index = timeline.findIndex((candidate) => candidate.id === item.id);
  if (index < 0) {
    return [...timeline, item];
  }

  return timeline.map((candidate) => (candidate.id === item.id ? item : candidate));
}

export function mergeLatestTimelinePage(
  current: ConversationTimelineItem[],
  latest: ConversationTimelineItem[],
  resetPaging = false,
): ConversationTimelineItem[] {
  if (current.length === 0) return latest;
  const latestRuns = new Set(latest.map(item => item.runId));
  const persisted = new Map(latest.map(item => [item.id, item]));
  // Current output is volatile until the model turn is committed. A history
  // refresh must not erase a snapshot already replayed by Main.
  for (const item of current) {
    if (item.kind !== "message" || item.role !== "assistant" || item.status !== "streaming" || !latestRuns.has(item.runId)) continue;
    const stored = persisted.get(item.id);
    if (stored === undefined || (stored.kind === "message" && stored.status === "streaming")) latest = upsertTimelineItem(latest, item);
  }
  if (resetPaging) return latest;
  const latestIds = new Set(latest.map((item) => item.id));
  const overlapIndex = current.findIndex((item) => latestIds.has(item.id));
  if (overlapIndex >= 0) return [...current.slice(0, overlapIndex), ...latest];
  return [
    ...current.filter((item) => !latestIds.has(item.id)),
    ...latest,
  ];
}

export function prependTimelinePage(
  current: ConversationTimelineItem[],
  older: ConversationTimelineItem[],
): ConversationTimelineItem[] {
  const olderIds = new Set(older.map((item) => item.id));
  return [...older, ...current.filter((item) => !olderIds.has(item.id))];
}

export function replaceTimelineFromMessage(
  timeline: ConversationTimelineItem[],
  replacement: ConversationMessageItem,
): ConversationTimelineItem[] {
  const sourceIndex = timeline.findIndex((item) => item.id === replacement.id);
  const source = timeline[sourceIndex];
  if (sourceIndex < 0 || source?.kind !== "message" || source.runId === null) {
    return upsertTimelineItem(timeline, replacement);
  }

  return timeline.flatMap((item, index) => {
    if (item.id === replacement.id) return [replacement];
    return index > sourceIndex && item.runId === source.runId ? [] : [item];
  });
}

export function projectSubagentMessagesForParentTimeline(
  timeline: ConversationTimelineItem[],
  subagentConversationIds: ReadonlySet<string>,
): ConversationTimelineItem[] {
  let removeReceiptDividerFromNextAssistant = false;
  const projected: ConversationTimelineItem[] = [];

  for (const item of timeline) {
    if (
      item.kind === "agent_message"
      && subagentConversationIds.has(item.senderConversationId)
    ) {
      removeReceiptDividerFromNextAssistant = true;
      continue;
    }
    if (item.kind === "message" && item.role === "user") {
      removeReceiptDividerFromNextAssistant = false;
    }
    if (
      removeReceiptDividerFromNextAssistant
      && item.kind === "message"
      && item.role === "assistant"
    ) {
      removeReceiptDividerFromNextAssistant = false;
      projected.push({
        ...item,
        content: item.content
          .replace(/(?:^|\r?\n)[ \t]*---[ \t]*(?=\r?\n|$)/u, "")
          .replace(/(?:\r?\n){3,}/gu, "\n\n"),
      });
      continue;
    }
    projected.push(item);
  }

  return projected;
}

export function groupRunActivities(
  timeline: ConversationTimelineItem[],
): TimelineDisplayItem[] {
  timeline = timeline.filter(item => item.kind !== "tool"
    || (item.name !== "wait_for_commands" && (item.name !== "read_command_output" || item.status === "failed")));
  const userIndexesByRun = new Map<string, number[]>();
  const restoredRunStarts = new Map<string, number>();
  for (const [index, item] of timeline.entries()) {
    if (item.runId === null) continue;
    if (item.kind === "message" && item.role === "assistant" && item.durationMs != null) {
      restoredRunStarts.set(item.runId, Date.parse(item.createdAt) - item.durationMs);
    }
    if (item.kind !== "message" || item.role !== "user") {
      // A paged window may begin mid-Run, before its next Steer input.
      if (!userIndexesByRun.has(item.runId)) userIndexesByRun.set(item.runId, [-1]);
      continue;
    }
    const indexes = userIndexesByRun.get(item.runId) ?? [];
    indexes.push(index);
    userIndexesByRun.set(item.runId, indexes);
  }
  const boundaries = [...userIndexesByRun.values()].flatMap((indexes) => indexes.slice(1))
    .sort((a, b) => a - b);
  if (boundaries.length === 0) return groupRunActivitySegment(timeline);
  const projected: TimelineDisplayItem[] = [];
  let start = 0;
  for (const end of [...boundaries, timeline.length]) {
    const segment = groupRunActivitySegment(timeline.slice(start, end));
    for (const [runId, indexes] of userIndexesByRun) {
      if (indexes.length < 2) continue;
      const firstIndex = indexes[0];
      const currentIndex = indexes.findLast((index) => index <= start) ?? firstIndex;
      const nextIndex = indexes.find((index) => index >= end);
      if (firstIndex === undefined || currentIndex === undefined) continue;
      const first = timeline[firstIndex];
      const current = timeline[currentIndex];
      const firstTime = first === undefined ? restoredRunStarts.get(runId) : Date.parse(first.createdAt);
      const currentTime = current === undefined ? firstTime : Date.parse(current.createdAt);
      if (currentTime === undefined || !Number.isFinite(currentTime)) continue;
      const offset = firstTime === undefined ? null : Math.max(0, currentTime - firstTime);
      const next = nextIndex === undefined ? undefined : timeline[nextIndex];
      const duration = next === undefined ? null
        : Math.max(0, Date.parse(next.createdAt) - currentTime);
      const activityIndex = segment.findIndex((item) => item.kind === "run_activity" && item.runId === runId);
      const durationIndex = activityIndex >= 0 ? activityIndex : segment.findLastIndex((item) =>
        item.kind === "message" && item.role === "assistant" && item.runId === runId);
      for (const [index, item] of segment.entries()) {
        if (!("runId" in item) || item.runId !== runId
          || (item.kind !== "message" && item.kind !== "run_activity" && item.kind !== "model_retry")) continue;
        if (item.kind === "message" && item.role !== "assistant") continue;
        segment[index] = {
          ...item,
          ...(item.kind === "run_activity" && currentIndex !== firstIndex && current !== undefined
            ? { id: `${item.id}:${current.id}` } : {}),
          durationMs: index === durationIndex && duration !== null
            ? duration
            : item.durationMs == null || offset === null ? null : Math.max(0, item.durationMs - offset),
        };
      }
    }
    projected.push(...segment);
    start = end;
  }
  return projected;
}

function groupRunActivitySegment(
  timeline: ConversationTimelineItem[],
): TimelineDisplayItem[] {
  const lastRunWorkIndex = new Map<string, number>();
  for (const [index, item] of timeline.entries()) {
    const isWork = item.kind === "model_retry"
      || (item.kind === "tool" && !isTaskListManagementTool(item.name))
      || (item.kind === "message" && item.role === "assistant"
        && (item.status === "completed" || item.status === "streaming"));
    // Terminal notices and checklist bookkeeping do not turn a final answer
    // into progress. They can be appended after the model has already replied.
    if (item.runId !== null && isWork) lastRunWorkIndex.set(item.runId, index);
  }

  const activities = new Map<string, RunActivityTimelineItem & { firstIndex: number }>();
  const activityFor = (
    runId: string,
    index: number,
  ): RunActivityTimelineItem & { firstIndex: number } => {
    const existing = activities.get(runId);
    if (existing !== undefined) return existing;
    const created: RunActivityTimelineItem & { firstIndex: number } = {
      durationMs: null,
      streaming: false,
      firstIndex: index,
      id: `run-activity:${runId}`,
      items: [],
      kind: "run_activity",
      runId,
      runIds: [runId],
    };
    activities.set(runId, created);
    return created;
  };

  for (const [index, item] of timeline.entries()) {
    if (item.runId === null) continue;
    if (item.kind === "model_retry") {
      const activity = activityFor(item.runId, index);
      activity.items.push(item);
      if (item.durationMs != null) activity.durationMs = item.durationMs;
      continue;
    }
    if (item.kind === "tool") {
      if (item.name === "compact_context" || isTaskListManagementTool(item.name)) continue;
      activityFor(item.runId, index).items.push(item);
      continue;
    }
    if (item.kind !== "message" || item.role !== "assistant") continue;

    const reasoningContent = item.reasoningContent?.trim();
    const visibleContent = stripLeadingThinkingSummary(item.content);
    const isIntermediate = (item.status === "completed" || item.status === "streaming")
      && index < (lastRunWorkIndex.get(item.runId) ?? index);
    const hasReasoning = reasoningContent !== undefined
      && reasoningContent.length > 0
      && (item.modelId === null || !isGptReasoningSummaryModel(item.modelId));
    const hasProgress = isIntermediate && visibleContent.trim().length > 0;
    const existingActivity = activities.get(item.runId);
    if (!hasReasoning && !hasProgress && existingActivity === undefined) continue;

    const activity = existingActivity ?? activityFor(item.runId, index);
    activity.streaming ||= item.status === "streaming";
    if (item.durationMs != null) activity.durationMs = item.durationMs;
    if (hasReasoning) {
      activity.items.push({
        content: item.reasoningContent ?? "",
        id: `${item.id}:reasoning`,
        kind: "activity_reasoning",
        streaming: item.status === "streaming",
      });
    }
    if (hasProgress) {
      activity.items.push({
        content: visibleContent,
        id: `${item.id}:progress`,
        kind: "activity_progress",
        streaming: item.status === "streaming",
      });
    }
  }

  const projected: TimelineDisplayItem[] = [];
  for (const [index, item] of timeline.entries()) {
    if (item.kind === "tool" && isTaskListManagementTool(item.name)) continue;
    if (item.kind === "tool" && item.name === "compact_context") {
      projected.push(item);
      continue;
    }
    const activity = item.runId === null ? undefined : activities.get(item.runId);
    if (activity?.firstIndex === index) {
      projected.push({
        durationMs: activity.durationMs,
        streaming: activity.streaming,
        id: activity.id,
        items: activity.items,
        kind: activity.kind,
        runId: activity.runId,
        runIds: activity.runIds,
      });
    }
    if (activity === undefined) {
      const visibleContent = item.kind === "message" && item.role === "assistant"
        ? stripLeadingThinkingSummary(item.content)
        : null;
      const isLegacyGptSummary = item.kind === "message"
        && item.role === "assistant"
        && item.modelId !== null
        && isGptReasoningSummaryModel(item.modelId)
        && item.reasoningContent !== undefined;
      if (
        visibleContent !== null
        && visibleContent.length === 0
        && item.kind === "message"
        && item.attachments.length === 0
        && item.status !== "failed"
      ) {
        continue;
      }
      projected.push(item.kind === "message" && visibleContent !== null
        ? {
            ...item,
            content: visibleContent,
            ...(isLegacyGptSummary ? { reasoningContent: undefined } : {}),
          }
        : item);
      continue;
    }
    if (item.kind === "tool" || item.kind === "model_retry") continue;
    if (item.kind !== "message" || item.role !== "assistant") {
      projected.push(item);
      continue;
    }

    const isIntermediate = (item.status === "completed" || item.status === "streaming")
      && index < (lastRunWorkIndex.get(item.runId ?? "") ?? index);
    if (isIntermediate) {
      if (item.attachments.length > 0) {
        projected.push({
          ...item,
          content: "",
          durationMs: null,
          reasoningContent: undefined,
        });
      }
      continue;
    }
    const visibleContent = stripLeadingThinkingSummary(item.content);
    if (visibleContent.length === 0 && item.attachments.length === 0 && item.status !== "failed") {
      continue;
    }
    projected.push({
      ...item,
      content: visibleContent,
      durationMs: null,
      reasoningContent: undefined,
    });
  }

  return combineAutomaticContinuationDurations(projected);
}

export function combineAutomaticContinuationDurations(
  timeline: TimelineDisplayItem[],
): TimelineDisplayItem[] {
  const combined = [...timeline];
  const mergedActivityIndexes = new Set<number>();
  let turnStartIndex = 0;

  const combineTurn = (turnEndIndex: number): void => {
    const activityIndexes: number[] = [];
    for (let index = turnStartIndex; index < turnEndIndex; index += 1) {
      if (combined[index]?.kind === "run_activity") activityIndexes.push(index);
    }
    const firstActivityIndex = activityIndexes[0];
    if (firstActivityIndex === undefined) return;

    const completedRunIds = new Set<string>();
    const turnRunIds = new Set<string>();
    let hasStreamingOutput = false;
    let combinedDurationMs = 0;
    let hasDuration = false;
    for (let index = turnStartIndex; index < turnEndIndex; index += 1) {
      const item = combined[index];
      if (item === undefined) continue;
      const isCompletedAssistant = item.kind === "message" && item.role === "assistant";
      const isTerminalRetry = item.kind === "model_retry" && item.status !== "retrying";
      if (item.kind === "run_activity") {
        for (const runId of item.runIds) turnRunIds.add(runId);
        hasStreamingOutput ||= item.streaming;
      } else if (isCompletedAssistant) {
        if (item.runId !== null) turnRunIds.add(item.runId);
        hasStreamingOutput ||= item.status === "streaming";
      }
      if (
        item.kind !== "run_activity"
        && !isCompletedAssistant
        && !isTerminalRetry
      ) continue;
      if (item.durationMs == null) continue;
      const runId = item.runId ?? `legacy-turn:${turnStartIndex}`;
      if (completedRunIds.has(runId)) continue;
      completedRunIds.add(runId);
      combinedDurationMs += item.durationMs;
      hasDuration = true;
    }
    for (let index = turnStartIndex; index < turnEndIndex; index += 1) {
      const item = combined[index];
      if (item === undefined) continue;
      if (item.kind === "run_activity") {
        combined[index] = {
          ...item,
          durationMs: hasDuration && index === firstActivityIndex
            ? combinedDurationMs
            : null,
        };
        continue;
      }
      const isCompletedAssistant = item.kind === "message" && item.role === "assistant";
      const isTerminalRetry = item.kind === "model_retry" && item.status !== "retrying";
      if ((isCompletedAssistant || isTerminalRetry) && item.durationMs != null) {
        combined[index] = { ...item, durationMs: null };
      }
    }

    const firstActivity = combined[firstActivityIndex];
    if (firstActivity?.kind !== "run_activity") return;
    combined[firstActivityIndex] = {
      ...firstActivity,
      streaming: hasStreamingOutput,
      items: activityIndexes.flatMap((index) => {
        const activity = combined[index];
        return activity?.kind === "run_activity" ? activity.items : [];
      }),
      runIds: [...turnRunIds],
    };
    for (const index of activityIndexes.slice(1)) mergedActivityIndexes.add(index);
  };

  for (const [index, item] of combined.entries()) {
    const startsVisibleTurn = (item.kind === "message" && item.role === "user")
      || (item.kind === "agent_message" && item.messageType !== "task_result");
    if (!startsVisibleTurn) continue;
    combineTurn(index);
    turnStartIndex = index + 1;
  }
  combineTurn(combined.length);

  return combineContinuationAnswers(combined.filter((_, index) => !mergedActivityIndexes.has(index)));
}

function combineContinuationAnswers(timeline: TimelineDisplayItem[]): TimelineDisplayItem[] {
  const result: TimelineDisplayItem[] = [];
  let answerIndex = -1;
  for (const item of timeline) {
    if (item.kind === "agent_message" && item.messageType === "task_result") {
      result.push(item);
      continue;
    }
    const previous = result[answerIndex];
    if (item.kind === "message" && item.role === "assistant"
      && (item.status === "completed" || item.status === "streaming")) {
      if (previous?.kind === "message" && previous.status === "completed"
        && previous.runId !== item.runId) {
        result[answerIndex] = {
          ...item,
          attachments: [...previous.attachments, ...item.attachments],
          continuationMessages: [...(previous.continuationMessages ?? [previous]), item],
        };
      } else {
        answerIndex = result.length;
        result.push(item);
      }
      continue;
    }
    answerIndex = -1;
    result.push(item);
  }
  return result;
}

export function groupToolBatches(
  timeline: ConversationTimelineItem[],
  breakAfterTimelineItemId: string | null = null,
): TimelineDisplayItem[] {
  const grouped: TimelineDisplayItem[] = [];
  let tools: ConversationToolItem[] = [];

  const flushTools = (): void => {
    if (tools.length === 0) return;
    const firstTool = tools[0];
    if (firstTool === undefined) return;
    if (tools.length === 1) {
      grouped.push(firstTool);
    } else {
      grouped.push({
        batchId: firstTool.batchId ?? firstTool.id,
        id: `tool-batch:${firstTool.id}`,
        kind: "tool_batch",
        tools,
      });
    }
    tools = [];
  };

  for (const item of timeline) {
    if (item.kind === "tool") {
      if (isTaskListManagementTool(item.name)) continue;
      tools.push(item);
      if (item.id === breakAfterTimelineItemId) flushTools();
      continue;
    }
    flushTools();
    grouped.push(item);
  }

  flushTools();
  return grouped;
}

function isTaskListManagementTool(name: string): boolean {
  return name === "create_task_list" || name === "update_task_list" || name === "close_task_list";
}

export function projectTimelineForActiveRun(
  timeline: ConversationTimelineItem[],
  activeRunId: string | null,
  showToolActivity: boolean,
): ConversationTimelineItem[] {
  if (activeRunId === null) return timeline;

  const currentRunTools = timeline.filter((item): item is ConversationToolItem =>
    item.kind === "tool" && item.runId === activeRunId
  );
  if (currentRunTools.length === 0) return timeline;

  const visibleTools = showToolActivity
    ? currentRunTools.filter((tool) =>
        tool.status === "running" || tool.status === "awaiting_approval"
      )
    : [];
  if (showToolActivity && visibleTools.length === 0) {
    const latestTool = currentRunTools.at(-1);
    if (latestTool !== undefined) visibleTools.push(latestTool);
  }
  const visibleToolIds = new Set(visibleTools.map((tool) => tool.id));

  return timeline.filter((item) =>
    item.kind !== "tool"
    || item.runId !== activeRunId
    || visibleToolIds.has(item.id)
  );
}

export function getLatestActiveToolId(
  timeline: readonly {
    id: string;
    kind: string;
    status?: string | undefined;
  }[],
): string | null {
  const latestTool = timeline.findLast((item) => item.kind === "tool");
  return latestTool?.status === "running" || latestTool?.status === "awaiting_approval"
    ? latestTool.id
    : null;
}

export function stripLeadingThinkingSummary(content: string): string {
  const match = /^\s*<(think|thinking)>([\s\S]*?)<\/\1>\s*/iu.exec(content);
  if (match?.[2] === undefined) return content;
  return content.slice(match[0].length).trimStart();
}

export function getConversationRunDurationInsertIndexes(
  timeline: readonly {
    durationMs?: number | null | undefined;
    kind: string;
    messageType?: string | undefined;
    role?: string | undefined;
    runId?: string | null | undefined;
    status?: string | undefined;
  }[],
): ReadonlyMap<number, readonly number[]> {
  const durationsByInsertIndex = new Map<number, number[]>();
  const completedRunIds = new Set<string>();
  let runStartIndex = 0;

  for (const [index, item] of timeline.entries()) {
    if (
      (item.kind === "agent_message" && item.messageType !== "task_result")
      || (item.kind === "message" && item.role === "user")
    ) {
      runStartIndex = index + 1;
      completedRunIds.clear();
      continue;
    }
    const isCompletedAssistant = item.kind === "message" && item.role === "assistant";
    const isTerminalRetry = item.kind === "model_retry" && item.status !== "retrying";
    if ((!isCompletedAssistant && !isTerminalRetry) || item.durationMs == null) continue;
    const runId = item.runId ?? `legacy-turn:${runStartIndex}`;
    if (completedRunIds.has(runId)) continue;
    completedRunIds.add(runId);
    const currentDuration = durationsByInsertIndex.get(runStartIndex)?.[0] ?? 0;
    durationsByInsertIndex.set(runStartIndex, [currentDuration + item.durationMs]);
  }

  return durationsByInsertIndex;
}

export function getRepeatedAssistantFailureMessageIds(
  timeline: readonly {
    content?: string | undefined;
    id: string;
    kind: string;
    role?: string | undefined;
    runId?: string | null | undefined;
    status?: string | undefined;
  }[],
): ReadonlySet<string> {
  const repeatedIds = new Set<string>();

  for (let index = 1; index < timeline.length; index += 1) {
    const previous = timeline[index - 1];
    const current = timeline[index];
    if (
      previous?.kind === "message"
      && previous.role === "assistant"
      && previous.status === "failed"
      && typeof previous.runId === "string"
      && current?.kind === "message"
      && current.role === "assistant"
      && current.status === "failed"
      && typeof current.runId === "string"
      && current.runId !== previous.runId
      && current.content?.trim() === previous.content?.trim()
    ) {
      repeatedIds.add(current.id);
    }
  }

  return repeatedIds;
}

export function getConversationRunProgressInsertIndex(
  timeline: readonly {
    id: string;
    items?: readonly { id: string }[] | undefined;
    kind: string;
    messageType?: string | undefined;
    role?: string | undefined;
    tools?: readonly { id: string }[] | undefined;
  }[],
  anchorTimelineItemId: string | null,
): number {
  const anchorIndex = anchorTimelineItemId === null
    ? -1
    : timeline.findIndex((item) =>
      item.id === anchorTimelineItemId
      || item.items?.some((entry) => entry.id === anchorTimelineItemId) === true
      || item.tools?.some((tool) => tool.id === anchorTimelineItemId) === true,
    );
  const searchStartIndex = anchorIndex < 0 ? timeline.length - 1 : anchorIndex;

  for (let index = searchStartIndex; index >= 0; index -= 1) {
    const item = timeline[index];
    if ((item?.kind === "message" && item.role === "user")
      || (item?.kind === "agent_message" && item.messageType !== "task_result")) return index + 1;
  }

  return 0;
}

export function getModelActivityInsertIndex(
  timeline: readonly {
    id: string;
    items?: readonly {
      id: string;
      kind: string;
      runId?: string | null | undefined;
    }[] | undefined;
    kind: string;
    role?: string | undefined;
    runId?: string | null | undefined;
  }[],
  runId: string | null,
  fallbackAnchorTimelineItemId: string | null,
): number {
  const turnStart = getConversationRunProgressInsertIndex(timeline, fallbackAnchorTimelineItemId);
  if (runId !== null) {
    const latestRetryIndex = timeline.findLastIndex((item) =>
      (item.kind === "model_retry" && item.runId === runId)
      || item.items?.some((entry) =>
        entry.kind === "model_retry" && entry.runId === runId
      ) === true
    );
    if (latestRetryIndex >= turnStart) {
      return timeline[latestRetryIndex]?.kind === "model_retry"
        ? latestRetryIndex + 1
        : latestRetryIndex;
    }
  }

  return turnStart;
}

export function getFinalCompletedAssistantMessageIds(
  timeline: readonly {
    id: string;
    kind: string;
    role?: string | undefined;
    runId?: string | null | undefined;
    status?: string | undefined;
  }[],
): ReadonlySet<string> {
  return new Set(timeline.flatMap((item, index) => {
    if (
      item.kind !== "message"
      || item.role !== "assistant"
      || item.status !== "completed"
      || item.runId == null
    ) {
      return [];
    }
    const hasLaterItemInRun = timeline
      .slice(index + 1)
      .some((candidate) => candidate.runId === item.runId);
    return hasLaterItemInRun ? [] : [item.id];
  }));
}
