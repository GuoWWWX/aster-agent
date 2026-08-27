import { describe, expect, it } from "vitest";

import { AgentDatabase, type SubagentTask } from "../storage/agent-database.js";
import { SubagentTool } from "./subagent-tool.js";

describe("SubagentTool", () => {
  it("lists recently healthy models and forwards an explicit Subagent selection", async () => {
    const database = new AgentDatabase(":memory:");
    const parent = database.createConversation(null);
    const providerId = crypto.randomUUID();
    const tool = new SubagentTool(database, () => ({
      baseUrl: "https://example.test/v1",
      configured: true,
      modelId: "older-model",
      models: [
        {
          connectionStatus: "healthy",
          connectionStatusUpdatedAt: "2026-08-26T00:00:00.000Z",
          contextWindow: 128_000,
          displayName: "较早可用",
          lastSuccessfulAt: "2026-08-26T00:00:00.000Z",
          modelId: "older-model",
          providerApiFormat: "openai-responses",
          providerBaseUrl: "https://example.test/v1",
          providerId,
          providerName: "测试供应商",
          reasoningOptions: [],
        },
        {
          connectionStatus: "healthy",
          connectionStatusUpdatedAt: "2026-08-27T00:00:00.000Z",
          contextWindow: 128_000,
          displayName: "最近可用",
          lastSuccessfulAt: "2026-08-27T00:00:00.000Z",
          modelId: "recent-model",
          providerApiFormat: "openai-responses",
          providerBaseUrl: "https://example.test/v1",
          providerId,
          providerName: "测试供应商",
          reasoningOptions: [{ kind: "effort", value: "high" }],
        },
      ],
      providerId,
      recentSelection: null,
      supportsStreaming: true,
      supportsTools: true,
    }));
    const listResult = await tool.execute({
      arguments: "{}",
      conversationId: parent.id,
      signal: new AbortController().signal,
      spawn: () => {
        throw new Error("Spawn is not used while listing models.");
      },
      toolName: "list_models",
    });
    expect(JSON.parse(listResult.content)).toMatchObject({
      value: {
        models: [
          { modelId: "recent-model" },
          { modelId: "older-model" },
        ],
      },
    });

    let selectedModelId: string | undefined;
    const spawnResult = await tool.execute({
      arguments: JSON.stringify({
        modelId: "recent-model",
        providerId,
        reasoning: { kind: "effort", value: "high" },
        task: "检查实现",
      }),
      conversationId: parent.id,
      signal: new AbortController().signal,
      spawn: (_task, _title, _agentId, selection) => {
        selectedModelId = selection?.modelId;
        return {
          childConversationId: crypto.randomUUID(),
          completedAt: null,
          createdAt: "2026-08-27T00:00:00.000Z",
          error: null,
          id: crypto.randomUUID(),
          parentConversationId: parent.id,
          result: null,
          resultMessageId: null,
          sourceRunId: crypto.randomUUID(),
          status: "queued",
          targetRunId: null,
          task: "检查实现",
          title: "检查实现",
          updatedAt: "2026-08-27T00:00:00.000Z",
        };
      },
      toolName: "spawn_subagent",
    });
    expect(spawnResult.isError).toBe(false);
    expect(selectedModelId).toBe("recent-model");
    database.close();
  });

  it("accepts empty JSON arguments for list_subagents", async () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const tool = new SubagentTool(database);
    const input = {
      conversationId: conversation.id,
      signal: new AbortController().signal,
      spawn: () => {
        throw new Error("Spawn is not used by this test.");
      },
      toolName: "list_subagents",
    } as const;

    await expect(tool.execute({ ...input, arguments: "" })).resolves.toMatchObject({ isError: false });
    await expect(tool.execute({ ...input, arguments: "{}" })).resolves.toMatchObject({ isError: false });
    database.close();
  });

  it("waits for all concurrent Subagents without completing after the first result", async () => {
    const database = new AgentDatabase(":memory:");
    const parent = database.createConversation(null);
    const parentRun = database.createRunWithUserMessage(parent.id, "并行委派", "test-model");
    const tasks = ["检查前端", "检查后端"].map((title) => {
      const child = database.forkConversation(parent.id);
      const childRun = database.createRunWithUserMessage(child.id, title, "test-model");
      const task = database.createSubagentTask({
        childConversationId: child.id,
        parentConversationId: parent.id,
        sourceRunId: parentRun.runId,
        task: title,
        title,
      });
      return database.assignSubagentTaskRun(task.id, childRun.runId);
    });
    const tool = new SubagentTool(database);
    const execution = tool.execute({
      arguments: JSON.stringify({
        taskIds: tasks.map((task) => task.id),
        timeoutMs: 10_000,
        waitFor: "all",
      }),
      conversationId: parent.id,
      signal: new AbortController().signal,
      spawn: () => {
        throw new Error("Spawn is not used by this test.");
      },
      toolName: "wait_for_subagents",
    });
    let settled = false;
    void execution.then(() => {
      settled = true;
    });

    const complete = (task: SubagentTask, result: string): void => {
      if (task.targetRunId === null) throw new Error("Subagent run was not assigned.");
      database.finishRun(task.targetRunId, "completed", null);
      database.completeSubagentTaskByRun({
        error: null,
        result,
        status: "completed",
        targetRunId: task.targetRunId,
      });
      database.deliverSubagentTaskResult(task.id);
      tool.notifyTaskCompleted(database.getSubagentTask(task.id));
    };

    complete(tasks[0]!, "前端检查完成");
    await Promise.resolve();
    expect(settled).toBe(false);

    complete(tasks[1]!, "后端检查完成");
    const result = await execution;
    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      value: {
        status: "ready",
        tasks: [
          { result: "前端检查完成", status: "completed" },
          { result: "后端检查完成", status: "completed" },
        ],
      },
    });
    expect(database.listUnreadAgentMessages(parent.id)).toEqual([]);
    database.close();
  });
});
