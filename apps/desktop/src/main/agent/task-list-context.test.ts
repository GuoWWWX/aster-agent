import { describe, expect, it } from "vitest";

import {
  activeTaskListContextMessage,
  activeTaskListContextTokens,
} from "./task-list-context.js";

describe("task-list context", () => {
  it("serializes only current model-relevant state with a bounded deterministic payload", () => {
    const context = activeTaskListContextMessage({
      closedAt: null,
      conversationId: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-08-27T00:00:00.000Z",
      status: "active",
      tasks: [{
        id: "00000000-0000-4000-8000-000000000002",
        status: "running",
        title: "完成任务状态注入".repeat(20),
      }],
      updatedAt: "2026-08-27T00:01:00.000Z",
    });

    expect(context).toMatchObject({ role: "system", toolCalls: [] });
    expect(context?.content).toContain("[当前任务清单｜动态运行状态]");
    expect(context?.content).toContain("[running]");
    expect(context?.content).toContain("…");
    expect(context?.content).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(context?.content).not.toContain("2026-08-27T00:01:00.000Z");
    expect(activeTaskListContextTokens({
      closedAt: null,
      conversationId: "00000000-0000-4000-8000-000000000001",
      status: "active",
      tasks: [{
        id: "00000000-0000-4000-8000-000000000002",
        status: "running",
        title: "完成任务状态注入".repeat(20),
      }],
      updatedAt: "2026-08-27T00:01:00.000Z",
    })).toBeGreaterThan(0);
  });

  it("does not inject a missing or closed task list", () => {
    expect(activeTaskListContextMessage(null)).toBeNull();
    expect(activeTaskListContextTokens(null)).toBe(0);
    expect(activeTaskListContextMessage({
      closedAt: "2026-08-27T00:01:00.000Z",
      conversationId: "00000000-0000-4000-8000-000000000001",
      status: "closed",
      tasks: [{
        id: "00000000-0000-4000-8000-000000000002",
        status: "completed",
        title: "已完成",
      }],
      updatedAt: "2026-08-27T00:01:00.000Z",
    })).toBeNull();
  });
});
