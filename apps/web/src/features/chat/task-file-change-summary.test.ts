import { describe, expect, it } from "vitest";

import type { ConversationTimelineItem, ConversationToolItem } from "@agent/protocol";

import { summarizeTaskFileChanges } from "./task-file-change-summary.js";

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
