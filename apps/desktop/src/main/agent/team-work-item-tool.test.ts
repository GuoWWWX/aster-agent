import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationRunEvent } from "@agent/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "../storage/agent-database.js";
import { TeamWorkItemTool } from "./team-work-item-tool.js";

const databases: AgentDatabase[] = [];

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

describe("TeamWorkItemTool", () => {
  it("exposes a read-only status tool alongside Team submission", () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    const tool = new TeamWorkItemTool(database, () => null, () => null);

    expect(tool.getDefinitions().map((definition) => definition.name)).toEqual([
      "submit_team_work_item",
      "get_team_work_item_status",
    ]);
    expect(tool.getExecutionPolicy("submit_team_work_item")).toEqual({ kind: "serial" });
    expect(tool.getExecutionPolicy("get_team_work_item_status")).toEqual({
      group: "read",
      kind: "parallel",
    });
  });

  it("submits an explicitly selected Team from a main project conversation", async () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    database.syncTeamDirectory(directory);
    const project = {
      id: "00000000-0000-4000-8000-000000000051",
      isPinned: false,
      name: "Team tool fixture",
      rootPath: "D:\\workspace\\team-tool",
    };
    database.saveProject(project);
    const source = database.createConversation(project.id);
    const instance = database.createTeamInstance({
      projectId: project.id,
      scope: "project",
      teamId: "default-team",
    });
    const submissions: unknown[] = [];
    const events: ConversationRunEvent[] = [];
    const tool = new TeamWorkItemTool(
      database,
      () => directory,
      () => ({
        submit(input, emit) {
          submissions.push(input);
          emit({
            conversation: database.getConversation(source.id),
            type: "conversation.updated",
          });
          return {
            acceptanceCriteria: [],
            acceptedCriteria: [],
            activeRunId: null,
            blockedReason: null,
            completedAt: null,
            createdAt: "2026-08-29T00:00:00.000Z",
            events: [],
            executionConversationId: null,
            executionScope: "project",
            id: "00000000-0000-4000-8000-000000000052",
            modelSelection: {
              modelId: "deepseek-v4-flash",
              providerId: "00000000-0000-4000-8000-000000000053",
              reasoning: null,
            },
            permissionMode: "ask_before_changes",
            priority: "normal",
            projectId: project.id,
            requirement: "检查 Team 工具。",
            resultSummary: null,
            revision: 1,
            sourceConversationId: source.id,
            status: "queued",
            tasks: [],
            teamId: "default-team",
            title: "检查 Team 工具",
            updatedAt: "2026-08-29T00:00:00.000Z",
          };
        },
      }),
    );

    const result = await tool.execute({
      arguments: JSON.stringify({
        requirement: "检查 Team 工具。",
        teamInstanceId: instance.id,
        title: "检查 Team 工具",
      }),
      conversationId: source.id,
      emit: (event) => events.push(event),
      modelSelection: {
        modelId: "deepseek-v4-flash",
        providerId: "00000000-0000-4000-8000-000000000053",
        reasoning: null,
      },
      permissionMode: "ask_before_changes",
      signal: new AbortController().signal,
      toolName: "submit_team_work_item",
    });

    expect(result).toMatchObject({ isError: false });
    expect(submissions).toEqual([expect.objectContaining({
      projectId: project.id,
      sourceConversationId: source.id,
      teamId: "default-team",
      teamInstanceId: instance.id,
    })]);
    expect(events).toHaveLength(1);
  });

  it("returns bounded progress only for WorkItems submitted by the current conversation", async () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    database.syncTeamDirectory(directory);
    const project = {
      id: "00000000-0000-4000-8000-000000000061",
      isPinned: false,
      name: "Team status fixture",
      rootPath: "D:\\workspace\\team-status",
    };
    database.saveProject(project);
    const source = database.createConversation(project.id);
    const otherSource = database.createConversation(project.id);
    const instance = database.createTeamInstance({
      projectId: project.id,
      scope: "project",
      teamId: "default-team",
    });
    const modelSelection = {
      modelId: "test-model",
      providerId: "00000000-0000-4000-8000-000000000062",
      reasoning: null,
    } as const;
    const owned = database.createTeamWorkItem({
      acceptanceCriteria: [],
      executionScope: "project",
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: "检查上下文与缓存，并给出结果。",
      sourceConversationId: source.id,
      teamId: "default-team",
      teamInstanceId: instance.id,
      title: "检查上下文",
    }, modelSelection);
    const foreign = database.createTeamWorkItem({
      acceptanceCriteria: [],
      executionScope: "project",
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: "不应被另一段对话读取。",
      sourceConversationId: otherSource.id,
      teamId: "default-team",
      teamInstanceId: instance.id,
      title: "其他对话任务",
    }, modelSelection);
    const tool = new TeamWorkItemTool(database, () => directory, () => null);

    const listed = await tool.execute({
      arguments: "{}",
      conversationId: source.id,
      emit: () => undefined,
      modelSelection,
      permissionMode: "ask_before_changes",
      signal: new AbortController().signal,
      toolName: "get_team_work_item_status",
    });
    const listedPayload = JSON.parse(listed.content) as {
      value: { items: Array<{ id: string }> };
    };
    expect(listed).toMatchObject({ isError: false });
    expect(listedPayload.value.items.map((item) => item.id)).toEqual([owned.id]);

    const detailed = await tool.execute({
      arguments: JSON.stringify({ workItemId: owned.id }),
      conversationId: source.id,
      emit: () => undefined,
      modelSelection,
      permissionMode: "ask_before_changes",
      signal: new AbortController().signal,
      toolName: "get_team_work_item_status",
    });
    const detailedPayload = JSON.parse(detailed.content) as {
      value: Record<string, unknown>;
    };
    expect(detailed).toMatchObject({ isError: false });
    expect(detailedPayload.value).toMatchObject({
      id: owned.id,
      status: "queued",
      title: "检查上下文",
    });
    expect(detailedPayload.value).not.toHaveProperty("requirement");
    expect(detailedPayload.value).not.toHaveProperty("events");
    expect(detailedPayload.value).not.toHaveProperty("edges");

    const denied = await tool.execute({
      arguments: JSON.stringify({ workItemId: foreign.id }),
      conversationId: source.id,
      emit: () => undefined,
      modelSelection,
      permissionMode: "ask_before_changes",
      signal: new AbortController().signal,
      toolName: "get_team_work_item_status",
    });
    expect(denied).toMatchObject({ isError: true });
  });
});
