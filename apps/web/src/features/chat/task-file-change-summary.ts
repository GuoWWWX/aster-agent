import type { ConversationTimelineItem } from "@agent/protocol";

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

export function summarizeTaskFileChanges(
  timeline: readonly ConversationTimelineItem[],
  taskCreatedAt: string | null,
): TaskFileChangeSummary {
  const filesByPath = new Map<string, TaskFileChange>();
  for (const item of timeline) {
    if (
      item.kind !== "tool" ||
      item.status !== "completed" ||
      item.diff === null ||
      (taskCreatedAt !== null && item.createdAt < taskCreatedAt)
    ) {
      continue;
    }
    const change = summarizeDiff(item.diff);
    const previous = filesByPath.get(change.path);
    filesByPath.set(change.path, previous === undefined ? change : {
      additions: previous.additions + change.additions,
      deletions: previous.deletions + change.deletions,
      path: change.path,
    });
  }
  const files = [...filesByPath.values()];
  return {
    additions: files.reduce((total, file) => total + file.additions, 0),
    deletions: files.reduce((total, file) => total + file.deletions, 0),
    files,
  };
}
