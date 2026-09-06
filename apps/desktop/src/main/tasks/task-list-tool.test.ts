import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "../storage/agent-database.js";
import {
  CLOSE_TASK_LIST_TOOL_NAME,
  TaskListTool,
  UPDATE_TASK_LIST_TOOL_NAME,
} from "./task-list-tool.js";

const databases: AgentDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("TaskListTool", () => {
  it("creates, updates and recreates a list through the same update tool", () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    const conversation = database.createConversation(null);
    const tool = new TaskListTool(database);
    const firstTasks = JSON.stringify({
      tasks: [
        { status: "running", title: "分析" },
        { status: "pending", title: "实现" },
      ],
    });
    const secondTasks = JSON.stringify({
      tasks: [
        { status: "completed", title: "分析" },
        { status: "running", title: "实现" },
      ],
    });

    expect(tool.getDefinitions().map((definition) => definition.name))
      .toEqual([UPDATE_TASK_LIST_TOOL_NAME, CLOSE_TASK_LIST_TOOL_NAME]);
    const created = tool.execute(UPDATE_TASK_LIST_TOOL_NAME, firstTasks, conversation.id);
    expect(created.isError).toBe(false);
    expect(JSON.parse(created.content)).toEqual({
      ok: true,
      value: { status: "updated", taskCount: 2 },
    });
    expect(created.content).not.toContain("createdAt");
    expect(created.content).not.toContain("分析");
    const updated = tool.execute(UPDATE_TASK_LIST_TOOL_NAME, secondTasks, conversation.id);
    expect(updated.isError).toBe(false);
    expect(updated.taskList?.createdAt).toBe(created.taskList?.createdAt);
    expect(updated.taskList?.tasks.map((task) => task.id))
      .toEqual(created.taskList?.tasks.map((task) => task.id));
    const taskList = database.getTaskList(conversation.id);
    if (taskList === null) throw new Error("Expected an active task list.");
    expect(taskList.status).toBe("active");
    expect(taskList.tasks.map((task) => task.status)).toEqual(["completed", "running"]);
    const other = database.createConversation(null);
    expect(database.getTaskList(other.id)).toBeNull();
    const closed = tool.execute(CLOSE_TASK_LIST_TOOL_NAME, "{}", conversation.id);
    expect(closed.isError).toBe(false);
    expect(JSON.parse(closed.content)).toEqual({ ok: true, value: { status: "closed" } });
    expect(database.getTaskList(conversation.id)).toBeNull();
    expect(tool.execute(UPDATE_TASK_LIST_TOOL_NAME, firstTasks, conversation.id).isError).toBe(false);
    expect(database.getTaskList(conversation.id)?.tasks.map((task) => task.status))
      .toEqual(["running", "pending"]);
  });

  it("requires a reason only when a task becomes blocked or failed", () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    const conversation = database.createConversation(null);
    const tool = new TaskListTool(database);
    const created = tool.execute(UPDATE_TASK_LIST_TOOL_NAME, JSON.stringify({
      tasks: [
        { status: "running", title: "执行" },
        { status: "pending", title: "验证" },
      ],
    }), conversation.id);

    expect(created.isError).toBe(false);
    const missingReason = tool.execute(UPDATE_TASK_LIST_TOOL_NAME, JSON.stringify({
      tasks: [
        { status: "blocked", title: "执行" },
        { status: "pending", title: "验证" },
      ],
    }), conversation.id);
    expect(missingReason.isError).toBe(true);
    expect(database.getTaskList(conversation.id)).toEqual(created.taskList);

    const updated = tool.execute(UPDATE_TASK_LIST_TOOL_NAME, JSON.stringify({
      tasks: [
        { reason: "等待用户批准文件修改", status: "blocked", title: "执行" },
        { status: "pending", title: "验证" },
      ],
    }), conversation.id);
    expect(updated.isError).toBe(false);
    expect(database.getTaskList(conversation.id)?.tasks[0]).toMatchObject({
      reason: "等待用户批准文件修改",
      status: "blocked",
    });
  });

  it("allows the conversation task list to show multiple running tasks", () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    const conversation = database.createConversation(null);
    const tool = new TaskListTool(database);

    const created = tool.execute(UPDATE_TASK_LIST_TOOL_NAME, JSON.stringify({
      tasks: [
        { status: "running", title: "调查问题" },
        { status: "running", title: "补充测试" },
        { status: "pending", title: "汇总结果" },
      ],
    }), conversation.id);

    expect(created.isError).toBe(false);
    expect(database.getTaskList(conversation.id)?.tasks.map((task) => task.status))
      .toEqual(["running", "running", "pending"]);
  });
});
