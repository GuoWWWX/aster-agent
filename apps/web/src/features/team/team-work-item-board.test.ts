import { describe, expect, it } from "vitest";

import type { TeamWorkItemStatus } from "./team-runtime-prototype.js";
import { workItemBoardColumnForStatus } from "./team-work-item-board.js";

describe("team work item board", () => {
  it("routes every lifecycle status to one visible board column", () => {
    const expected = {
      awaiting_acceptance: "acceptance",
      blocked: "processing",
      completed: "completed",
      executing: "processing",
      finalizing: "processing",
      planning: "processing",
      queued: "queued",
      reworking: "processing",
      reviewing: "processing",
    } satisfies Record<TeamWorkItemStatus, string>;

    for (const [status, column] of Object.entries(expected)) {
      expect(workItemBoardColumnForStatus(status as TeamWorkItemStatus)).toBe(column);
    }
  });
});
