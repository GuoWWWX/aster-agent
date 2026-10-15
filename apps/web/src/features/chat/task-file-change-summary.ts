import type { ConversationTimelineItem, ConversationToolItem } from "@agent/protocol";

export type TaskFileChange = {
  additions: number;
  deletions: number;
  path: string;
};

export type TaskFileChangeSummary = {
  additions: number;
  deletions: number;
  files: TaskFileChange[];
};

export type ReviewedFileChange = TaskFileChange & { diffs: string[] };
const toolChanges = new WeakMap<ConversationToolItem, TaskFileChange>();

function diffPath(lines: readonly string[]): string {
  const headers = [
    lines.find((line) => line.startsWith("+++ ")),
    lines.find((line) => line.startsWith("--- ")),
  ];
  for (const header of headers) {
    if (header === undefined) continue;
    const path = header.slice(4).split("\t")[0]?.replace(/^[ab]\//, "") ?? "";
    if (path.length > 0 && path !== "/dev/null") return path;
  }
  return "文件变更";
}

function summarizeDiff(diff: string): TaskFileChange {
  const lines = diff.split(/\r?\n/);
  let additions = 0;
  let deletions = 0;
  for (const line of lines) {
    if (line.startsWith("+++ ") || line.startsWith("--- ")) continue;
    if (line.startsWith("+")) additions += 1;
    if (line.startsWith("-")) deletions += 1;
  }
  return { additions, deletions, path: diffPath(lines) };
}

export function collectFileChangeReview(
  timeline: readonly ConversationTimelineItem[],
  taskCreatedAt: string | null = null,
): ReviewedFileChange[] {
  const filesByPath = new Map<string, ReviewedFileChange>();
  for (const item of timeline) {
    if (
      item.kind !== "tool" ||
      item.status !== "completed" ||
      item.diff === null ||
      (taskCreatedAt !== null && item.createdAt < taskCreatedAt)
    ) {
      continue;
    }
    let change = toolChanges.get(item);
    if (change === undefined) {
      change = summarizeDiff(item.diff);
      toolChanges.set(item, change);
    }
    const previous = filesByPath.get(change.path);
    filesByPath.set(change.path, previous === undefined ? { ...change, diffs: [item.diff] } : {
      additions: previous.additions + change.additions,
      deletions: previous.deletions + change.deletions,
      path: change.path,
      diffs: [...previous.diffs, item.diff],
    });
  }
  return [...filesByPath.values()];
}

export function summarizeTaskFileChanges(timeline: readonly ConversationTimelineItem[], taskCreatedAt: string | null): TaskFileChangeSummary {
  const files = collectFileChangeReview(timeline, taskCreatedAt).map(({ additions, deletions, path }) => ({ additions, deletions, path }));
  return {
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
  };
}

type ChangeAnchor = { id: string; runId?: string | null; runIds?: readonly string[]; continuationMessages?: readonly { runId: string | null }[] };
export function conversationChangeSummaries(timeline: readonly ConversationTimelineItem[]): ReadonlyMap<string, TaskFileChangeSummary> {
  const runs = new Map<string, ConversationTimelineItem[]>();
  for (const item of timeline) {
    if (item.kind !== "tool" || item.runId === null || item.diff === null || item.status !== "completed") continue;
    const items = runs.get(item.runId) ?? []; items.push(item); runs.set(item.runId, items);
  }
  return new Map([...runs].map(([runId, items]) => [runId, summarizeTaskFileChanges(items, null)]));
}
export function conversationChangeAnchors(summaries: ReadonlyMap<string, TaskFileChangeSummary>, anchors: readonly ChangeAnchor[], activeRunId: string | null): ReadonlyMap<string, { runId: string; summary: TaskFileChangeSummary }[]> {
  const result = new Map<string, { runId: string; summary: TaskFileChangeSummary }[]>();
  for (const [runId, summary] of summaries) {
    if (runId === activeRunId || summary.files.length === 0) continue;
    const anchor = anchors.findLast(item => item.runId === runId || item.runIds?.includes(runId) || item.continuationMessages?.some(message => message.runId === runId));
    if (anchor === undefined) continue;
    const items = result.get(anchor.id) ?? []; items.push({ runId, summary }); result.set(anchor.id, items);
  }
  return result;
}
