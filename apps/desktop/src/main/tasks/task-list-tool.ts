import { z } from "zod";
import {
  conversationTaskStatusSchema,
  type ConversationTaskList,
} from "@agent/protocol";

import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { toolErrorContent } from "../errors/tool-error.js";
import type { ToolExecutionPolicy } from "../tools/tool-execution-policy.js";

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
        reason: z.string().trim().min(1).max(600).nullable().optional().describe(
          "Short reason when the step is blocked or failed. Omit it for other statuses."
        ),
        status: conversationTaskStatusSchema
          .describe("Step status. At most one step may be running. Use blocked with a reason when external input is required, or failed with a reason when work cannot continue."),
        title: z.string().trim().min(1).max(300).describe("Short, verifiable step title.")
      }).strict()
    ).min(2).max(20).describe("Complete task list. Resubmit every step on each update.")
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
    value.tasks.forEach((task, index) => {
      const requiresReason = task.status === "blocked" || task.status === "failed";
      if (requiresReason && task.reason == null) {
        context.addIssue({
          code: "custom",
          message: "Blocked and failed tasks require a short reason.",
          path: ["tasks", index, "reason"]
        });
      }
      if (!requiresReason && task.reason != null) {
        context.addIssue({
          code: "custom",
          message: "Only blocked and failed tasks may include a reason.",
          path: ["tasks", index, "reason"]
        });
      }
    });
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
    const taskListParameters = modelToolParameters(taskListUpdateSchema);

    return [
      {
        description: [
          "Create a task list for a complex, multi-step task before substantive work.",
          "Use this only when no active task list exists. Provide the full list with exactly zero or one running task. Blocked and failed tasks must include a short reason."
        ].join(" "),
        name: CREATE_TASK_LIST_TOOL_NAME,
        parameters: taskListParameters
      },
      {
        description: [
          "Update the active task list, including task titles and statuses.",
          "Send the full list on every update. Keep at most one task running, and mark a task completed before moving to the next one. Blocked and failed tasks must include a short reason."
        ].join(" "),
        name: UPDATE_TASK_LIST_TOOL_NAME,
        parameters: taskListParameters
      },
      {
        description: "Close and remove the active task list after every task is completed and before giving the final answer.",
        name: CLOSE_TASK_LIST_TOOL_NAME,
        parameters: modelToolParameters(closeTaskListSchema)
      }
    ];
  }

  public getExecutionPolicy(toolName: string): ToolExecutionPolicy {
    if (!taskListToolNames.has(toolName)) throw new Error(`Unknown task list tool: ${toolName}`);
    return { kind: "serial" };
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
