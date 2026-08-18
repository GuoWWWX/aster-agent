import { z } from "zod";
import type { ConversationTaskList } from "@agent/protocol";

import type { ModelToolDefinition } from "../model/model-contracts.js";
import { parseToolArguments } from "../model/tool-arguments.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { toolErrorContent } from "../errors/tool-error.js";

export const CREATE_TASK_LIST_TOOL_NAME = "create_task_list";
export const UPDATE_TASK_LIST_TOOL_NAME = "update_task_list";
export const CLOSE_TASK_LIST_TOOL_NAME = "close_task_list";

const taskListToolNames = new Set([
  CREATE_TASK_LIST_TOOL_NAME,
  UPDATE_TASK_LIST_TOOL_NAME,
  CLOSE_TASK_LIST_TOOL_NAME
]);

const taskListUpdateSchema = z
  .object({
    tasks: z.array(
      z.object({
        status: z.enum(["pending", "running", "completed"]),
        title: z.string().trim().min(1).max(300)
      }).strict()
    ).min(2).max(20)
  })
  .strict()
  .superRefine((value, context) => {
    if (value.tasks.filter((task) => task.status === "running").length > 1) {
      context.addIssue({
        code: "custom",
        message: "Only one task can be running at a time.",
        path: ["tasks"]
      });
    }
  });

const closeTaskListSchema = z.object({}).strict();

export type TaskListToolExecution = {
  content: string;
  isError: boolean;
  kind: "completed";
  taskList: ConversationTaskList | null;
};

export function isTaskListToolName(value: string): boolean {
  return taskListToolNames.has(value);
}

function resultContent(taskList: ConversationTaskList | null): string {
  return JSON.stringify({ ok: true, value: taskList });
}

/**
 * The task list is metadata only: it is model-controlled but never grants
 * filesystem or command access, so it can run in every conversation type.
 */
export class TaskListTool {
  public constructor(private readonly database: AgentDatabase) {}

  public getDefinitions(): ModelToolDefinition[] {
    const taskListParameters = {
      additionalProperties: false,
      properties: {
        tasks: {
          items: {
            additionalProperties: false,
            properties: {
              status: { enum: ["pending", "running", "completed"], type: "string" },
              title: { minLength: 1, type: "string" }
            },
            required: ["title", "status"],
            type: "object"
          },
          maxItems: 20,
          minItems: 2,
          type: "array"
        }
      },
      required: ["tasks"],
      type: "object"
    } as const;

    return [
      {
        description: [
          "Create a task list for a complex, multi-step task before substantive work.",
          "Use this only when no active task list exists. Provide the full list with exactly zero or one running task."
        ].join(" "),
        name: CREATE_TASK_LIST_TOOL_NAME,
        parameters: taskListParameters
      },
      {
        description: [
          "Update the active task list, including task titles and statuses.",
          "Send the full list on every update. Keep at most one task running, and mark a task completed before moving to the next one."
        ].join(" "),
        name: UPDATE_TASK_LIST_TOOL_NAME,
        parameters: taskListParameters
      },
      {
        description: "Close and remove the active task list after every task is completed and before giving the final answer.",
        name: CLOSE_TASK_LIST_TOOL_NAME,
        parameters: {
          additionalProperties: false,
          properties: {},
          required: [],
          type: "object"
        }
      }
    ];
  }

  public execute(
    toolName: string,
    rawArguments: string,
    conversationId: string
  ): TaskListToolExecution {
    try {
      const parsedArguments = parseToolArguments(rawArguments);
      const taskList = this.executeTaskListOperation(toolName, parsedArguments, conversationId);
      return { content: resultContent(taskList), isError: false, kind: "completed", taskList };
    } catch (error) {
      return {
        content: toolErrorContent(error, `tool:${toolName}`),
        isError: true,
        kind: "completed",
        taskList: null
      };
    }
  }

  private executeTaskListOperation(
    toolName: string,
    rawArguments: unknown,
    conversationId: string
  ): ConversationTaskList | null {
    switch (toolName) {
      case CREATE_TASK_LIST_TOOL_NAME: {
        const input = taskListUpdateSchema.parse(rawArguments);
        return this.database.createTaskList(conversationId, input.tasks);
      }
      case UPDATE_TASK_LIST_TOOL_NAME: {
        const input = taskListUpdateSchema.parse(rawArguments);
        return this.database.updateTaskList(conversationId, input.tasks);
      }
      case CLOSE_TASK_LIST_TOOL_NAME:
        closeTaskListSchema.parse(rawArguments);
        this.database.closeTaskList(conversationId);
        return null;
      default:
        throw new Error(`Unknown task list tool: ${toolName}`);
    }
  }
}
