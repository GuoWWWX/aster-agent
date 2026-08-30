import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationRunEvent } from "@agent/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "../storage/agent-database.js";
import { TeamWorkItemTool } from "./team-work-item-tool.js";

const databases: AgentDatabase[] = [];

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

describe("TeamWorkItemTool", () => {
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
});
