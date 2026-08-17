import { z } from "zod";

import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/openai-compatible-adapter.js";
import { parseToolArguments } from "../model/tool-arguments.js";
import {
  AgentDatabase,
  type SubagentTask,
} from "../storage/agent-database.js";

const SPAWN_SUBAGENT_TOOL_NAME = "spawn_subagent";
const LIST_SUBAGENTS_TOOL_NAME = "list_subagents";
const WAIT_FOR_SUBAGENTS_TOOL_NAME = "wait_for_subagents";
const toolNames = new Set([
  SPAWN_SUBAGENT_TOOL_NAME,
  LIST_SUBAGENTS_TOOL_NAME,
  WAIT_FOR_SUBAGENTS_TOOL_NAME,
]);

const spawnArgumentsSchema = z.object({
  agentId: z.string().trim().min(1).max(80).optional(),
  task: z.string().trim().min(1).max(20_000),
  title: z.string().trim().min(1).max(200).optional(),
}).strict();
const emptyArgumentsSchema = z.object({}).strict();
const waitArgumentsSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(32)
    .refine((ids) => new Set(ids).size === ids.length, "Task identifiers must be unique."),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(30_000),
  waitFor: z.enum(["any", "all"]).default("any"),
}).strict();

type SubagentToolExecution = {
  content: string;
  isError: boolean;
  kind: "completed";
};

type TaskWaiter = {
  parentConversationId: string;
  resolve: (value: { status: "ready" | "timeout"; tasks: SubagentTask[] }) => void;
  taskIds: string[];
  waitFor: "any" | "all";
};

function isTerminal(task: SubagentTask): boolean {
  return task.status === "completed" || task.status === "failed" || task.status === "cancelled";
}

function success(value: unknown): SubagentToolExecution {
  return {
    content: JSON.stringify({ ok: true, value }),
    isError: false,
    kind: "completed",
  };
}

function boundedText(value: string | null, limit: number): string | null {
  if (value === null || value.length <= limit) return value;
  return `${value.slice(0, limit - 16)}\n[内容已截断]`;
}

function toToolTask(task: SubagentTask): Record<string, unknown> {
  return {
    childConversationId: task.childConversationId,
    completedAt: task.completedAt,
    createdAt: task.createdAt,
    error: boundedText(task.error, 4_000),
    id: task.id,
    result: boundedText(task.result, 8_000),
    status: task.status,
    task: boundedText(task.task, 2_000),
    title: task.title,
    updatedAt: task.updatedAt,
  };
}

export function isSubagentToolName(name: string): boolean {
  return toolNames.has(name);
}

export class SubagentTool {
  private readonly waiters = new Set<TaskWaiter>();

  public constructor(private readonly database: AgentDatabase) {}

  public getDefinitions(): ModelToolDefinition[] {
    return [
      {
        description: "Start an independent one-shot Subagent for one bounded task. Optionally select a configured Agent or team member with agentId. The tool returns immediately; use wait_for_subagents only when the current work depends on its result. The Subagent becomes read-only after completion. Its concise result is delivered automatically, while the full conversation remains available through read_agent_conversation.",
        name: SPAWN_SUBAGENT_TOOL_NAME,
        parameters: {
          additionalProperties: false,
          properties: {
            agentId: { minLength: 1, type: "string" },
            task: { minLength: 1, type: "string" },
            title: { minLength: 1, type: "string" },
          },
          required: ["task"],
          type: "object",
        },
      },
      {
        description: "List Subagent tasks created by this conversation and inspect their current status and final result.",
        name: LIST_SUBAGENTS_TOOL_NAME,
        parameters: { additionalProperties: false, properties: {}, type: "object" },
      },
      {
        description: "Wait for any or all selected Subagent tasks. Use this only when their result blocks the current work. A timeout is not a failure; the Subagents continue in the background and completion will still reactivate this conversation.",
        name: WAIT_FOR_SUBAGENTS_TOOL_NAME,
        parameters: {
          additionalProperties: false,
          properties: {
            taskIds: {
              items: { type: "string" },
              maxItems: 32,
              minItems: 1,
              type: "array",
            },
            timeoutMs: {
              default: 30000,
              maximum: 600000,
              minimum: 1000,
              type: "integer",
            },
            waitFor: { default: "any", enum: ["any", "all"], type: "string" },
          },
          required: ["taskIds"],
          type: "object",
        },
      },
    ];
  }

  public async execute(input: {
    arguments: string;
    conversationId: string;
    signal: AbortSignal;
    spawn: (task: string, title: string | undefined, agentId: string | undefined) => SubagentTask;
    toolName: string;
  }): Promise<SubagentToolExecution> {
    try {
      const argumentsValue = parseToolArguments(input.arguments);
      switch (input.toolName) {
        case SPAWN_SUBAGENT_TOOL_NAME: {
          const parsed = spawnArgumentsSchema.parse(argumentsValue);
          return success({
            task: toToolTask(input.spawn(parsed.task, parsed.title, parsed.agentId)),
          });
        }
        case LIST_SUBAGENTS_TOOL_NAME:
          emptyArgumentsSchema.parse(argumentsValue);
          return success({
            tasks: this.database.listSubagentTasks(input.conversationId).slice(-50).map(toToolTask),
          });
        case WAIT_FOR_SUBAGENTS_TOOL_NAME: {
          const parsed = waitArgumentsSchema.parse(argumentsValue);
          const result = await this.waitForTasks({
            ...parsed,
            parentConversationId: input.conversationId,
            signal: input.signal,
          });
          return success({
            status: result.status,
            tasks: result.tasks.map(toToolTask),
          });
        }
        default:
          throw new Error(`Unknown Subagent tool: ${input.toolName}`);
      }
    } catch (error) {
      if (input.signal.aborted) throw error;
      return {
        content: toolErrorContent(error, `tool:${input.toolName}`),
        isError: true,
        kind: "completed",
      };
    }
  }

  public notifyTaskCompleted(task: SubagentTask): void {
    for (const waiter of [...this.waiters]) {
      if (
        waiter.parentConversationId !== task.parentConversationId
        || !waiter.taskIds.includes(task.id)
      ) {
        continue;
      }
      const tasks = this.readTasks(waiter.parentConversationId, waiter.taskIds);
      if (!this.isReady(tasks, waiter.waitFor)) continue;
      this.waiters.delete(waiter);
      this.markResultsRead(tasks);
      waiter.resolve({ status: "ready", tasks });
    }
  }

  private async waitForTasks(input: {
    parentConversationId: string;
    signal: AbortSignal;
    taskIds: string[];
    timeoutMs: number;
    waitFor: "any" | "all";
  }): Promise<{ status: "ready" | "timeout"; tasks: SubagentTask[] }> {
    const initial = this.readTasks(input.parentConversationId, input.taskIds);
    if (this.isReady(initial, input.waitFor)) {
      this.markResultsRead(initial);
      return { status: "ready", tasks: initial };
    }
    if (input.signal.aborted) throw this.abortError(input.signal);

    return new Promise((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timeout);
        input.signal.removeEventListener("abort", onAbort);
        this.waiters.delete(waiter);
      };
      const finish = (value: { status: "ready" | "timeout"; tasks: SubagentTask[] }): void => {
        cleanup();
        resolve(value);
      };
      const onAbort = (): void => {
        cleanup();
        reject(this.abortError(input.signal));
      };
      const waiter: TaskWaiter = {
        parentConversationId: input.parentConversationId,
        resolve: finish,
        taskIds: input.taskIds,
        waitFor: input.waitFor,
      };
      const timeout = setTimeout(() => {
        const tasks = this.readTasks(input.parentConversationId, input.taskIds);
        this.markResultsRead(tasks);
        finish({ status: "timeout", tasks });
      }, input.timeoutMs);
      this.waiters.add(waiter);
      input.signal.addEventListener("abort", onAbort, { once: true });
    });
  }

  private readTasks(parentConversationId: string, taskIds: readonly string[]): SubagentTask[] {
    return taskIds.map((taskId) => {
      const task = this.database.getSubagentTask(taskId);
      if (task.parentConversationId !== parentConversationId) {
        throw new Error("A conversation can only wait for its own Subagent tasks.");
      }
      return task;
    });
  }

  private isReady(tasks: readonly SubagentTask[], waitFor: "any" | "all"): boolean {
    return waitFor === "all" ? tasks.every(isTerminal) : tasks.some(isTerminal);
  }

  private markResultsRead(tasks: readonly SubagentTask[]): void {
    this.database.markAgentMessagesRead(
      tasks.flatMap((task) => task.resultMessageId === null ? [] : [task.resultMessageId]),
    );
  }

  private abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  }
}
