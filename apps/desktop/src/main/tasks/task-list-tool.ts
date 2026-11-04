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

export const UPDATE_TASK_LIST_TOOL_NAME = "update_task_list";
export const CLOSE_TASK_LIST_TOOL_NAME = "close_task_list";

const taskListToolNames = new Set([
  UPDATE_TASK_LIST_TOOL_NAME,
  CLOSE_TASK_LIST_TOOL_NAME
]);

const taskListUpdateSchema = z
  .object({
    close: z.boolean().optional().describe("When all steps are completed, set true in this final update to close the checklist in the same call. Omit while work remains."),
    tasks: z.array(
      z.object({
        reason: z.string().trim().min(1).max(600).nullable().optional().describe(
          "Short reason when the step is blocked or failed. Omit it for other statuses."
        ),
        status: conversationTaskStatusSchema
          .describe("Step status. Use running for every step currently being handled, including independent work progressing concurrently. Use blocked with a reason when external input is required, or failed with a reason when work cannot continue."),
        title: z.string().trim().min(1).max(300).describe("Short, verifiable step title.")
      }).strict()
    ).min(2).max(20).describe("Complete task list. Resubmit every step on each update.")
  })
  .strict()
  .superRefine((value, context) => {
    if (value.close && value.tasks.some(task => task.status !== "completed")) context.addIssue({
      code: "custom", path: ["close"], message: "Only close a checklist when every submitted step is completed.",
    });
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
  changed: boolean;
  content: string;
  isError: boolean;
  kind: "completed";
  taskList: ConversationTaskList | null;
};

export function isTaskListToolName(value: string): boolean {
  return taskListToolNames.has(value);
}

function resultContent(taskList: ConversationTaskList | null, changed: boolean): string {
  return JSON.stringify({
    ok: true,
    value: taskList === null
      ? { status: "closed" }
      : changed ? { status: "updated", taskCount: taskList.tasks.length }
        : { status: "unchanged", taskCount: taskList.tasks.length,
          message: "清单没有变化，无需再次提交。继续当前实际工作；若已回答或正在等待，本轮可直接结束，不要重复更新无关步骤。" },
  });
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
          "Create or update this conversation's local execution checklist above its input for multi-step work. This does not create or update persistent task records in the conversation header.",
          "Send one complete list combining every currently known step change (for example, finish the previous step and start the next together). Do not submit separate updates per step or bookkeeping-only transitions. Set close=true with all steps completed to finish and close in one call; no separate close_task_list is needed. Multiple tasks may be running at once. Blocked and failed tasks require a short reason."
        ].join(" "),
        name: UPDATE_TASK_LIST_TOOL_NAME,
        parameters: taskListParameters
      },
      {
        description: "Close the local execution checklist after all its steps are completed and before giving the final answer. This does not remove or complete persistent task records in the conversation header.",
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
      const { taskList, changed } = this.executeTaskListOperation(toolName, parsedArguments, conversationId);
      return { content: resultContent(taskList, changed), changed, isError: false, kind: "completed", taskList };
    } catch (error) {
      return {
        content: toolErrorContent(error, `tool:${toolName}`),
        changed: false,
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
  ): { taskList: ConversationTaskList | null; changed: boolean } {
    switch (toolName) {
      case UPDATE_TASK_LIST_TOOL_NAME: {
        const input = taskListUpdateSchema.parse(rawArguments);
        const previous = this.database.getTaskList(conversationId);
        if (input.close) {
          if (previous !== null) this.database.closeTaskList(conversationId);
          return { taskList: null, changed: previous !== null };
        }
        if (previous?.tasks.length === input.tasks.length && input.tasks.every((task, index) => {
          const old = previous.tasks[index]!;
          return old.title === task.title && old.status === task.status && old.reason === (task.reason ?? null);
        })) return { taskList: previous, changed: false };
        return { taskList: this.database.updateTaskList(conversationId, input.tasks), changed: true };
      }
      case CLOSE_TASK_LIST_TOOL_NAME:
        closeTaskListSchema.parse(rawArguments);
        this.database.closeTaskList(conversationId);
        return { taskList: null, changed: true };
      default:
        throw new Error(`Unknown task list tool: ${toolName}`);
    }
  }
}
