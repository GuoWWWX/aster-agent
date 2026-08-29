import { describe, expect, it } from "vitest";

import {
  submitTeamWorkItemInputSchema,
  teamWorkItemViewSchema,
} from "./team-work-item.js";

describe("Team WorkItem protocol", () => {
  it("applies safe submission defaults and rejects unknown fields", () => {
    const input = {
      projectId: "00000000-0000-4000-8000-000000000001",
      requirement: "实现并验证一个小功能。",
      teamId: "default-team",
      title: "小功能",
    };
    expect(submitTeamWorkItemInputSchema.parse(input)).toMatchObject({
      acceptanceCriteria: [],
      permissionMode: "ask_before_changes",
      priority: "normal",
    });
    expect(() => submitTeamWorkItemInputSchema.parse({ ...input, status: "completed" }))
      .toThrow();
  });

  it("requires a persisted model snapshot on renderer views", () => {
    const now = new Date().toISOString();
    expect(() => teamWorkItemViewSchema.parse({
      acceptanceCriteria: [],
      activeRunId: null,
      blockedReason: null,
      completedAt: null,
      createdAt: now,
      events: [],
      executionConversationId: null,
      id: "00000000-0000-4000-8000-000000000002",
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: "00000000-0000-4000-8000-000000000001",
      requirement: "测试",
      resultSummary: null,
      revision: 1,
      status: "queued",
      tasks: [],
      teamId: "default-team",
      title: "测试",
      updatedAt: now,
    })).toThrow();
  });
});
