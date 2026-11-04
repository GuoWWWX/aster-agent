import { describe, expect, it } from "vitest";

import { TEAM_WORK_ITEMS, type TeamWorkItemPrototype } from "./team-runtime-prototype.js";
import {
  canEditWorkItem,
  matchesWorkItemFilter,
  transitionWorkItem,
} from "./team-work-item-lifecycle.js";

function fixture(status: TeamWorkItemPrototype["status"]): TeamWorkItemPrototype {
  const source = TEAM_WORK_ITEMS[0];
  if (source === undefined) throw new Error("A work item fixture is required.");
  return { ...source, status };
}

describe("team work item lifecycle", () => {
  it("only allows queued requirements to be edited", () => {
    expect(canEditWorkItem(fixture("queued"))).toBe(true);
    expect(canEditWorkItem(fixture("planning"))).toBe(false);
    expect(canEditWorkItem(fixture("awaiting_acceptance"))).toBe(false);
  });

  it("keeps internal review in processing and separates user acceptance", () => {
    expect(matchesWorkItemFilter(fixture("reviewing"), "processing")).toBe(true);
    expect(matchesWorkItemFilter(fixture("reviewing"), "acceptance")).toBe(false);
    expect(matchesWorkItemFilter(fixture("awaiting_acceptance"), "acceptance")).toBe(true);
  });

  it("moves a task through claim, execution, acceptance and finalization", () => {
    const claimed = transitionWorkItem(fixture("queued"), { type: "claim" });
    const delivered = transitionWorkItem(claimed, { type: "execution_completed" });
    const approved = transitionWorkItem(delivered, {
      acceptedCriteria: delivered.acceptance,
      action: "merge",
      type: "approve",
    });
    const completed = transitionWorkItem(approved, { type: "finalization_completed" });

    expect([claimed.status, delivered.status, approved.status, completed.status]).toEqual([
      "planning",
      "awaiting_acceptance",
      "finalizing",
      "completed",
    ]);
  });

  it("returns rework to processing and preserves the feedback", () => {
    const reworked = transitionWorkItem(fixture("awaiting_acceptance"), {
      request: "补充窄窗口验证",
      type: "request_rework",
    });

    expect(reworked.status).toBe("reworking");
    expect(reworked.reworkRequest).toBe("补充窄窗口验证");
    expect(reworked.acceptanceRound).toBe(2);
  });

  it("rejects illegal transitions without changing the item", () => {
    const running = fixture("executing");
    expect(transitionWorkItem(running, {
      acceptedCriteria: running.acceptance,
      action: "commit",
      type: "approve",
    })).toBe(running);
    expect(transitionWorkItem(running, { type: "finalization_completed" })).toBe(running);
  });

  it("does not approve partial acceptance or submit empty rework", () => {
    const acceptance = fixture("awaiting_acceptance");
    expect(transitionWorkItem(acceptance, {
      acceptedCriteria: acceptance.acceptance.slice(0, 1),
      action: "merge",
      type: "approve",
    })).toBe(acceptance);
    expect(transitionWorkItem(acceptance, { request: "  ", type: "request_rework" })).toBe(acceptance);
  });
});
