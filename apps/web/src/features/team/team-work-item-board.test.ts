import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { TEAM_WORK_ITEMS, type TeamWorkItemStatus } from "./team-runtime-prototype.js";
import { TeamWorkItemBoard, workItemBoardColumnForStatus } from "./team-work-item-board.js";

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

  it("renders compact task details without embedding collaboration canvases", () => {
    const item = TEAM_WORK_ITEMS[1];
    if (item === undefined) throw new Error("Team work item fixture is unavailable.");

    const html = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(TeamWorkItemBoard, {
        items: [item],
        onOpen: () => undefined,
      }),
    ));

    expect(html).toContain(item.title);
    expect(html).toContain(item.nextAction);
    expect(html).toContain("14:18");
    expect(html).not.toContain('data-variant="mini"');
  });
});
