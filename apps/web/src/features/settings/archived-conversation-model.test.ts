import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "@agent/protocol";

import {
  getArchivedConversationDaysRemaining,
  getArchivedConversations,
} from "./archived-conversation-model.js";

function conversation(
  id: string,
  archivedAt: string | null,
  isArchived = true,
): ConversationSummary {
  return {
    activeSubagentCount: 0,
    activeRunId: null,
    agentId: null,
    archivedAt,
    createdAt: "2026-08-01T00:00:00.000Z",
    hasUnreadResult: false,
    id,
    isArchived,
    isPinned: false,
    lastRunStatus: null,
    modelSelection: null,
    parentConversationId: null,
    pinOrder: null,
    projectId: null,
    teamId: null,
    teamWorkItemId: null,
    threadKind: "agent",
    title: id,
    updatedAt: archivedAt ?? "2026-08-01T00:00:00.000Z",
    workspaceRootPath: null,
  };
}

describe("archived conversation settings model", () => {
  it("keeps only archived conversations and shows the newest archive first", () => {
    expect(getArchivedConversations([
      conversation("older", "2026-08-01T00:00:00.000Z"),
      conversation("visible", null, false),
      conversation("newer", "2026-08-10T00:00:00.000Z"),
    ]).map((item) => item.id)).toEqual(["newer", "older"]);
  });

  it("counts down the fixed 30-day retention period", () => {
    expect(getArchivedConversationDaysRemaining(
      "2026-08-01T00:00:00.000Z",
      Date.parse("2026-08-11T00:00:00.000Z"),
    )).toBe(20);
    expect(getArchivedConversationDaysRemaining(
      "2026-08-01T00:00:00.000Z",
      Date.parse("2026-09-01T00:00:00.000Z"),
    )).toBe(0);
  });
});
