import { describe, expect, it, vi } from "vitest";

import { AgentDatabase, type SubagentTask } from "../storage/agent-database.js";
import { SubagentTool } from "./subagent-tool.js";

describe("SubagentTool", () => {
  it.each(["timeout", "no_progress", "approval", "deleted", "cancelled"] as const)("handles %s without confusing wait completion with successful execution", async (scenario) => {
    vi.useFakeTimers();
    const db = new AgentDatabase(":memory:");
    try {
      const parent = db.createConversation(null);
      const source = db.createRunWithUserMessage(parent.id, "委派", "test");
      const child = db.forkConversation(parent.id, "subagent");
      const run = db.createRunWithUserMessage(child.id, "检查", "test");
      const task = db.createSubagentTask({ parentConversationId: parent.id, childConversationId: child.id,
        sourceRunId: source.runId, title: "检查", task: "检查" });
      db.assignSubagentTaskRun(task.id, run.runId);
      if (scenario === "approval") {
        db.appendToolStarted({ id: crypto.randomUUID(), kind: "tool", name: "run_command", arguments: "{}",
          conversationId: child.id, runId: run.runId, status: "awaiting_approval", createdAt: new Date().toISOString(),
          diff: null, result: null, batchId: null });
        // Approval need not be among the most recent eight timeline entries.
        for (let index = 0; index < 10; index++) db.appendAssistantTurn({ conversationId: child.id, runId: run.runId,
          messageId: crypto.randomUUID(), modelId: "test", content: `进度 ${index}`, toolCalls: [] });
      }
      const tool = new SubagentTool(db, undefined, () => true);
      const controller = new AbortController();
      let settled = false;
      const execution = tool.execute({ arguments: JSON.stringify({ taskIds: [task.id],
        ...(scenario === "timeout" ? { timeoutMs: 1_000 } : {}) }), conversationId: parent.id,
        signal: controller.signal, toolName: "wait_for_subagents",
        end: () => { throw new Error("unused"); }, spawn: () => { throw new Error("unused"); } });
      void execution.then(() => { settled = true; }, () => { settled = true; });
      if (scenario === "approval") {
        await vi.advanceTimersByTimeAsync(360_000);
        expect(settled).toBe(false);
        const rejected = expect(execution).rejects.toThrow();
        controller.abort();
        await rejected;
      } else if (scenario === "deleted" || scenario === "cancelled") {
        db.finishRun(run.runId, "cancelled", "用户取消");
        if (scenario === "deleted") db.completeConversationDeletionTask(db.createConversationDeletionTask(child.id).id);
        await vi.advanceTimersByTimeAsync(1_000);
        expect(JSON.parse((await execution).content)).toMatchObject({ value: { status: "ready", tasks: [
          { status: scenario === "deleted" ? "deleted" : "cancelled" },
        ] } });
      } else {
        await vi.advanceTimersByTimeAsync(scenario === "timeout" ? 1_000 : 300_000);
        expect(JSON.parse((await execution).content)).toMatchObject({ value: {
          status: scenario === "timeout" ? "timeout" : "interrupted",
        } });
        expect(db.getConversation(child.id).activeRunId).toBe(run.runId);
      }
    } finally { vi.useRealTimers(); db.close(); }
  });
  it("pins a follow-up run, accepts an omitted timeout, and consumes its receipt rather than the previous result", async () => {
    const db = new AgentDatabase(":memory:");
    const parent = db.createConversation(null);
    const source = db.createRunWithUserMessage(parent.id, "委派", "test");
    const child = db.forkConversation(parent.id, "subagent");
    const first = db.createRunWithUserMessage(child.id, "第一轮", "test");
    const task = db.createSubagentTask({ parentConversationId: parent.id, childConversationId: child.id,
      sourceRunId: source.runId, title: "检查", task: "检查" });
    db.assignSubagentTaskRun(task.id, first.runId);
    db.finishRun(first.runId, "completed", null);
    db.completeSubagentTaskByRun({ targetRunId: first.runId, status: "completed", result: "旧结果", error: null });
    const oldReceipt = db.deliverSubagentTaskResult(task.id)!;
    db.markAgentMessagesRead([oldReceipt.id]);
    const second = db.createRunWithUserMessage(child.id, "返工", "test");
    const tool = new SubagentTool(db);
    let settled = false;
    const execution = tool.execute({ arguments: JSON.stringify({ taskIds: [task.id], waitFor: "all" }), conversationId: parent.id,
      signal: new AbortController().signal, toolName: "wait_for_subagents",
      end: () => { throw new Error("unused"); }, spawn: () => { throw new Error("unused"); } });
    void execution.then(() => { settled = true; });
    await Promise.resolve();
    expect(settled).toBe(false);
    db.completeRun({ conversationId: child.id, runId: second.runId, status: "completed", result: null, assistant: null, error: null });
    db.sendAgentMessage({ senderConversationId: child.id, targetConversationId: parent.id, runId: second.runId,
      messageType: "agent_result", content: "未提供总结" });
    const third = db.createRunWithUserMessage(child.id, "后续独立一轮", "test");
    tool.notifyTaskCompleted(db.getSubagentTask(task.id));
    expect(JSON.parse((await execution).content)).toMatchObject({ value: { status: "ready", tasks: [
      { runId: second.runId, status: "completed", result: null, lifecycleStatus: "completed" },
    ] } });
    expect(db.listUnreadAgentMessages(parent.id)).toEqual([]);
    expect(db.getConversation(child.id).activeRunId).toBe(third.runId);
    db.close();
  });

  it("releases a no-timeout wait for a missing executor without cancelling its task", async () => {
    const db = new AgentDatabase(":memory:");
    const parent = db.createConversation(null);
    const source = db.createRunWithUserMessage(parent.id, "委派", "test");
    const child = db.forkConversation(parent.id, "subagent");
    const run = db.createRunWithUserMessage(child.id, "执行", "test");
    const task = db.createSubagentTask({ parentConversationId: parent.id, childConversationId: child.id,
      sourceRunId: source.runId, title: "检查", task: "检查" });
    db.assignSubagentTaskRun(task.id, run.runId);
    const tool = new SubagentTool(db, undefined, () => false);
    const read = vi.fn();
    const result = await tool.execute({ arguments: JSON.stringify({ taskIds: [task.id] }), conversationId: parent.id,
      signal: new AbortController().signal, toolName: "wait_for_subagents", onResultMessagesRead: read,
      end: () => { throw new Error("unused"); }, spawn: () => { throw new Error("unused"); } });
    expect(JSON.parse(result.content)).toMatchObject({ value: { status: "interrupted" } });
    expect(read).not.toHaveBeenCalled();
    expect(db.getConversation(child.id).activeRunId).toBe(run.runId);
    db.close();
  });
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
      end: () => {
        throw new Error("End is not used while listing models.");
      },
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
    let selectedName: string | undefined;
    let selectedIcon: string | undefined;
    const child = database.forkConversation(parent.id);
    database.setConversationAvatarIcon(child.id, "bug");
    const spawnResult = await tool.execute({
      arguments: JSON.stringify({
        icon: "bug",
        modelId: "recent-model",
        name: "缺陷侦探",
        providerId,
        reasoning: { kind: "effort", value: "high" },
        task: "检查实现",
      }),
      conversationId: parent.id,
      end: () => {
        throw new Error("End is not used while spawning.");
      },
      signal: new AbortController().signal,
      spawn: (_task, name, icon, _agentId, selection) => {
        selectedModelId = selection?.modelId;
        selectedName = name;
        selectedIcon = icon;
        return {
          childConversationId: child.id,
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
          title: name ?? "检查实现",
          updatedAt: "2026-08-27T00:00:00.000Z",
        };
      },
      toolName: "spawn_subagent",
    });
    expect(spawnResult.isError).toBe(false);
    expect(selectedModelId).toBe("recent-model");
    expect(selectedName).toBe("缺陷侦探");
    expect(selectedIcon).toBe("bug");
    expect(JSON.parse(spawnResult.content)).toMatchObject({
      value: { task: { avatarIcon: "bug", name: "缺陷侦探" } },
    });
    database.close();
  });

  it("ignores an unsupported decorative icon instead of blocking Subagent creation", async () => {
    const database = new AgentDatabase(":memory:");
    const parent = database.createConversation(null);
    const child = database.forkConversation(parent.id);
    const tool = new SubagentTool(database);
    let selectedIcon: string | undefined;

    const result = await tool.execute({
      arguments: JSON.stringify({
        icon: "wave",
        name: "问候助手",
        task: "回复一句友好问候",
      }),
      conversationId: parent.id,
      end: () => {
        throw new Error("End is not used while spawning.");
      },
      signal: new AbortController().signal,
      spawn: (_task, _name, icon) => {
        selectedIcon = icon;
        return {
          childConversationId: child.id,
          completedAt: null,
          createdAt: "2026-09-02T00:00:00.000Z",
          error: null,
          id: crypto.randomUUID(),
          parentConversationId: parent.id,
          result: null,
          resultMessageId: null,
          sourceRunId: crypto.randomUUID(),
          status: "queued",
          targetRunId: null,
          task: "回复一句友好问候",
          title: "问候助手",
          updatedAt: "2026-09-02T00:00:00.000Z",
        };
      },
      toolName: "spawn_subagent",
    });

    expect(result.isError).toBe(false);
    expect(selectedIcon).toBeUndefined();
    database.close();
  });

  it("accepts empty JSON arguments for list_subagents", async () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const tool = new SubagentTool(database);
    const input = {
      conversationId: conversation.id,
      end: () => {
        throw new Error("End is not used while listing Subagents.");
      },
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

  it("ends a completed reusable Subagent without deleting its conversation", async () => {
    const database = new AgentDatabase(":memory:");
    const parent = database.createConversation(null);
    const parentRun = database.createRunWithUserMessage(parent.id, "委派", "test-model");
    const child = database.forkConversation(parent.id);
    const childRun = database.createRunWithUserMessage(child.id, "检查", "test-model");
    const task = database.createSubagentTask({
      childConversationId: child.id,
      parentConversationId: parent.id,
      sourceRunId: parentRun.runId,
      task: "检查",
      title: "检查助手",
    });
    database.assignSubagentTaskRun(task.id, childRun.runId);
    database.finishRun(childRun.runId, "completed", null);
    database.completeSubagentTaskByRun({
      error: null,
      result: "检查完成",
      status: "completed",
      targetRunId: childRun.runId,
    });
    const tool = new SubagentTool(database);

    const result = await tool.execute({
      arguments: JSON.stringify({ conversationId: child.id }),
      conversationId: parent.id,
      end: (conversationId) => database.endSubagent(parent.id, conversationId),
      signal: new AbortController().signal,
      spawn: () => {
        throw new Error("Spawn is not used while ending a Subagent.");
      },
      toolName: "end_subagent",
    });

    expect(JSON.parse(result.content)).toMatchObject({
      ok: true,
      value: { task: { lifecycleStatus: "ended", status: "ended" } },
    });
    expect(database.getConversation(child.id).subagentTaskStatus).toBe("ended");
    expect(() => database.getConversation(child.id)).not.toThrow();
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
      end: () => {
        throw new Error("End is not used while waiting.");
      },
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
