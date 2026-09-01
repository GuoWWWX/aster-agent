import { describe, expect, it } from "vitest";

import {
  addTeamWorkItemCommentInputSchema,
  deleteTeamWorkItemInputSchema,
  getTeamWorkItemExecutionInputSchema,
  submitTeamWorkItemInputSchema,
  teamWorkItemExecutionViewSchema,
  teamWorkItemViewSchema,
  updateTeamWorkItemInputSchema,
  updateTeamWorkItemPermissionInputSchema,
} from "./team-work-item.js";

describe("Team WorkItem protocol", () => {
  it("accepts a bounded task comment without turning it into an Agent message", () => {
    const input = {
      content: "补充说明：窄窗口下也要保持可用。",
      workItemId: "00000000-0000-4000-8000-000000000009",
    };

    expect(addTeamWorkItemCommentInputSchema.parse(input)).toEqual(input);
    expect(() => addTeamWorkItemCommentInputSchema.parse({ ...input, content: "   " }))
      .toThrow();
    expect(() => addTeamWorkItemCommentInputSchema.parse({ ...input, notifyAgents: true }))
      .toThrow();
  });

  it("applies safe submission defaults and rejects unknown fields", () => {
    const input = {
      projectId: "00000000-0000-4000-8000-000000000001",
      requirement: "实现并验证一个小功能。",
      teamId: "default-team",
      title: "小功能",
    };
    expect(submitTeamWorkItemInputSchema.parse(input)).toMatchObject({
      acceptanceCriteria: [],
      executionScope: "project",
      permissionMode: "ask_before_changes",
      priority: "normal",
    });
    expect(() => submitTeamWorkItemInputSchema.parse({ ...input, status: "completed" }))
      .toThrow();
  });

  it("requires a source conversation only for explicit conversation isolation", () => {
    const input = {
      executionScope: "conversation" as const,
      projectId: "00000000-0000-4000-8000-000000000001",
      requirement: "仅在当前对话中执行。",
      teamId: "default-team",
      title: "对话隔离任务",
    };

    expect(() => submitTeamWorkItemInputSchema.parse(input)).toThrow();
    expect(submitTeamWorkItemInputSchema.parse({
      ...input,
      sourceConversationId: "00000000-0000-4000-8000-000000000003",
    })).toMatchObject({ executionScope: "conversation" });
  });

  it("accepts a bounded Team instance name and rejects blank names", () => {
    const input = {
      instanceName: "登录交付组",
      projectId: "00000000-0000-4000-8000-000000000001",
      requirement: "实现登录流程。",
      teamId: "default-team",
      title: "登录流程",
    };

    expect(submitTeamWorkItemInputSchema.parse(input)).toMatchObject({
      instanceName: "登录交付组",
    });
    expect(() => submitTeamWorkItemInputSchema.parse({ ...input, instanceName: "   " }))
      .toThrow();
  });

  it("allows requirement edits only through a narrow WorkItem update contract", () => {
    const input = {
      requirement: "补充验收条件并调整实现范围。",
      title: "补充验收条件",
      workItemId: "00000000-0000-4000-8000-000000000009",
    };
    expect(updateTeamWorkItemInputSchema.parse(input)).toEqual(input);
    expect(() => updateTeamWorkItemInputSchema.parse({ ...input, teamId: "default-team" }))
      .toThrow();
  });

  it("deletes a WorkItem only through its identifier", () => {
    const input = { workItemId: "00000000-0000-4000-8000-000000000009" };
    expect(deleteTeamWorkItemInputSchema.parse(input)).toEqual(input);
    expect(() => deleteTeamWorkItemInputSchema.parse({ ...input, hardDelete: true })).toThrow();
  });

  it("allows an execution permission update without widening requirement edits", () => {
    const input = {
      permissionMode: "read_only",
      workItemId: "00000000-0000-4000-8000-000000000009",
    };
    expect(updateTeamWorkItemPermissionInputSchema.parse(input)).toEqual(input);
    expect(() => updateTeamWorkItemPermissionInputSchema.parse({ ...input, title: "不应修改需求" }))
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

  it("validates a durable WorkItem execution lineage", () => {
    const now = new Date().toISOString();
    const workItemId = "00000000-0000-4000-8000-000000000010";
    const rootConversationId = "00000000-0000-4000-8000-000000000011";
    const childConversationId = "00000000-0000-4000-8000-000000000012";
    const execution = teamWorkItemExecutionViewSchema.parse({
      agents: [
        {
          agent: {
            id: "team-lead",
            instructions: "负责汇总交付。",
            isDefault: true,
            name: "Team Lead",
            role: "负责人",
          },
          conversation: {
            activeRunId: "00000000-0000-4000-8000-000000000013",
            createdAt: now,
            id: rootConversationId,
            lastRunStatus: "running",
            projectId: null,
            title: "团队任务：验证执行谱系",
            updatedAt: now,
          },
          delegation: null,
          depth: 0,
        },
        {
          agent: null,
          conversation: {
            activeRunId: "00000000-0000-4000-8000-000000000014",
            createdAt: now,
            id: childConversationId,
            lastRunStatus: "queued",
            parentConversationId: rootConversationId,
            projectId: null,
            threadKind: "subagent",
            title: "检查数据库查询",
            updatedAt: now,
          },
          delegation: {
            id: "00000000-0000-4000-8000-000000000015",
            status: "running",
            title: "检查数据库查询",
          },
          depth: 1,
        },
      ],
      workItemId,
    });

    expect(execution.agents.map((agent) => agent.depth)).toEqual([0, 1]);
    expect(getTeamWorkItemExecutionInputSchema.parse({ workItemId })).toEqual({ workItemId });
    expect(() => getTeamWorkItemExecutionInputSchema.parse({ extra: true, workItemId })).toThrow();
    expect(() => teamWorkItemExecutionViewSchema.parse({ ...execution, agents: [{
      ...execution.agents[0],
      depth: -1,
    }] })).toThrow();
  });
});
