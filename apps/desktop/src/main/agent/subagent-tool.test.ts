import { describe, expect, it } from "vitest";

import { AgentDatabase, type SubagentTask } from "../storage/agent-database.js";
import { SubagentTool } from "./subagent-tool.js";

describe("SubagentTool", () => {
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
