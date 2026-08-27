import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "../storage/agent-database.js";
import {
  CREATE_TASK_LIST_TOOL_NAME,
  TaskListTool,
  UPDATE_TASK_LIST_TOOL_NAME,
} from "./task-list-tool.js";

const databases: AgentDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe("TaskListTool", () => {
  it("keeps exactly one active task list when concurrent Agents try to create one", () => {
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
        { status: "running", title: "测试" },
        { status: "pending", title: "汇报" },
      ],
    });

    const results = [
      tool.execute(CREATE_TASK_LIST_TOOL_NAME, firstTasks, conversation.id),
      tool.execute(CREATE_TASK_LIST_TOOL_NAME, secondTasks, conversation.id),
    ];

    expect(results.filter((result) => !result.isError)).toHaveLength(1);
    expect(results.filter((result) => result.isError)).toHaveLength(1);
    const taskList = database.getTaskList(conversation.id);
    if (taskList === null) throw new Error("Expected an active task list.");
    expect(taskList.status).toBe("active");
    expect(taskList.tasks).toHaveLength(2);
  });

  it("requires a reason only when a task becomes blocked or failed", () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    const conversation = database.createConversation(null);
    const tool = new TaskListTool(database);
    const created = tool.execute(CREATE_TASK_LIST_TOOL_NAME, JSON.stringify({
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
});
