import { describe, expect, it } from "vitest";

import type { ConversationTimelineItem, ConversationToolItem } from "@agent/protocol";

import { collectFileChangeReview, conversationChangeAnchors, conversationChangeSummaries, summarizeTaskFileChanges } from "./task-file-change-summary.js";

function tool(
  id: string,
  createdAt: string,
  diff: string,
  status: ConversationToolItem["status"] = "completed",
): ConversationTimelineItem {
  return {
    arguments: "{}",
    batchId: null,
    conversationId: "00000000-0000-4000-8000-000000000001",
    createdAt,
    diff,
    id,
    kind: "tool",
    name: "write_file",
    result: "{}",
    runId: "00000000-0000-4000-8000-000000000002",
    status,
  };
}

describe("summarizeTaskFileChanges", () => {
  it("keeps repeated edits under one file and places completed run cards after their last visible item", () => {
    const diff = "--- a/src/app.ts\n+++ b/src/app.ts\n@@ -1 +1 @@\n-before\n+after\n";
    const first = tool("first", "2026-10-15T00:00:00Z", diff);
    const repeated = tool("repeated", "2026-10-15T00:00:01Z", diff);
    const next = { ...tool("next", "2026-10-15T00:00:02Z", diff), runId: "next-run" };
    const timeline = [first, repeated, tool("failed", "2026-10-15T00:00:03Z", diff, "failed"), next];
    expect(collectFileChangeReview([first, repeated])).toEqual([{ path: "src/app.ts", additions: 2, deletions: 2, diffs: [diff, diff] }]);
    const summaries = conversationChangeSummaries(timeline);
    expect(summaries.get(first.runId!)?.files).toHaveLength(1);
    expect(summaries.get(first.runId!)?.additions).toBe(2);
    const anchors = [{ id: "work", runIds: [first.runId!] }, { id: "reply", runId: first.runId }, { id: "live", runId: "next-run" }];
    const cards = conversationChangeAnchors(summaries, anchors, "next-run");
    expect([...cards.keys()]).toEqual(["reply"]);
    expect(conversationChangeAnchors(summaries, [anchors[0]!], null).get("work")).toHaveLength(1);
    expect(conversationChangeAnchors(summaries, [{ id: "continued", continuationMessages: [{ runId: first.runId }] }], null).get("continued")).toHaveLength(1);
  });

  it("counts successful file diffs created during the current task list", () => {
    const summary = summarizeTaskFileChanges([
      tool("00000000-0000-4000-8000-000000000010", "2026-08-16T07:59:59.000Z", [
        "--- old.ts",
        "+++ old.ts",
        "@@ -1 +1 @@",
        "-old",
        "+new",
      ].join("\n")),
      tool("00000000-0000-4000-8000-000000000011", "2026-08-16T08:00:01.000Z", [
        "--- src/app.ts",
        "+++ src/app.ts",
        "@@ -1,2 +1,3 @@",
        "-before",
        "+after",
        "+added",
      ].join("\n")),
      tool("00000000-0000-4000-8000-000000000012", "2026-08-16T08:00:02.000Z", [
        "--- src/app.ts",
        "+++ src/app.ts",
        "@@ -5 +5 @@",
        "-previous",
        "+next",
      ].join("\n")),
      tool("00000000-0000-4000-8000-000000000013", "2026-08-16T08:00:03.000Z", [
        "--- notes.md",
        "+++ notes.md",
        "@@ -0,0 +1,2 @@",
        "+one",
        "+two",
      ].join("\n")),
      tool("00000000-0000-4000-8000-000000000014", "2026-08-16T08:00:04.000Z", [
        "--- rejected.ts",
        "+++ rejected.ts",
        "@@ -0,0 +1 @@",
        "+ignored",
      ].join("\n"), "rejected"),
    ], "2026-08-16T08:00:00.000Z");

    expect(summary).toEqual({
      additions: 5,
      deletions: 2,
      files: [
        { additions: 3, deletions: 2, path: "src/app.ts" },
        { additions: 2, deletions: 0, path: "notes.md" },
      ],
    });
  });
});
