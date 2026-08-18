import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "../storage/agent-database.js";
import { CREATE_TASK_LIST_TOOL_NAME, TaskListTool } from "./task-list-tool.js";

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
});
