import { z } from "zod";
import {
  isReasoningOptionEnabled,
  modelReasoningOptionSchema,
  type ConversationModelSelection,
  type ModelRuntimeStatus,
} from "@agent/protocol";

import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import {
  AgentDatabase,
  type SubagentTask,
} from "../storage/agent-database.js";
import type { ToolExecutionPolicy } from "../tools/tool-execution-policy.js";

const SPAWN_SUBAGENT_TOOL_NAME = "spawn_subagent";
const LIST_MODELS_TOOL_NAME = "list_models";
const LIST_SUBAGENTS_TOOL_NAME = "list_subagents";
const WAIT_FOR_SUBAGENTS_TOOL_NAME = "wait_for_subagents";
const toolNames = new Set([
  SPAWN_SUBAGENT_TOOL_NAME,
  LIST_MODELS_TOOL_NAME,
  LIST_SUBAGENTS_TOOL_NAME,
  WAIT_FOR_SUBAGENTS_TOOL_NAME,
]);

const spawnArgumentsSchema = z.object({
  agentId: z.string().trim().min(1).max(80).optional()
    .describe("可选的已配置 Agent 或当前团队成员 ID。"),
  modelId: z.string().trim().min(1).max(200).optional()
    .describe("可选的已配置模型 ID；必须与 providerId 同时传入。"),
  providerId: z.string().uuid().optional()
    .describe("可选的模型供应商 UUID；必须与 modelId 同时传入。"),
  reasoning: modelReasoningOptionSchema.optional()
    .describe("可选的已启用推理选项；仅在显式选择 providerId 和 modelId 时使用。"),
  task: z.string().trim().min(1).max(20_000)
    .describe("交给 Subagent 的独立、有边界且可验收的任务。"),
  title: z.string().trim().min(1).max(200).optional()
    .describe("可选的简短任务标题。"),
}).strict().superRefine((value, context) => {
  if ((value.providerId === undefined) !== (value.modelId === undefined)) {
    context.addIssue({
      code: "custom",
      message: "providerId and modelId must be provided together.",
      path: value.providerId === undefined ? ["providerId"] : ["modelId"],
    });
  }
  if (value.reasoning !== undefined && value.modelId === undefined) {
    context.addIssue({
      code: "custom",
      message: "reasoning requires an explicit providerId and modelId.",
      path: ["reasoning"],
    });
  }
});
const emptyArgumentsSchema = z.object({}).strict();
const waitArgumentsSchema = z.object({
  taskIds: z.array(z.string().uuid()).min(1).max(32)
    .refine((ids) => new Set(ids).size === ids.length, "Task identifiers must be unique.")
    .describe("由 spawn_subagent 返回的唯一任务 UUID 列表。"),
  timeoutMs: z.number().int().min(1_000).max(600_000).default(30_000)
    .describe("本次等待的最长毫秒数；超时不会停止 Subagent。"),
  waitFor: z.enum(["any", "all"]).default("any")
    .describe("any 等待任意任务结束；all 等待全部任务结束。"),
}).strict();

type SubagentToolExecution = {
  content: string;
  isError: boolean;
  kind: "completed";
};

type TaskWaiter = {
  onResultMessagesRead: ((messageIds: readonly string[]) => void) | undefined;
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

  public constructor(
    private readonly database: AgentDatabase,
    private readonly getModelStatus?: () => ModelRuntimeStatus,
  ) {}

  public getDefinitions(): ModelToolDefinition[] {
    return [
      {
        description: "Start an independent one-shot Subagent for one bounded task. Optionally select a configured Agent or team member with agentId. The tool returns immediately; use wait_for_subagents only when the current work depends on its result. The Subagent becomes read-only after completion. Its concise result is delivered automatically, while the full conversation remains available through read_agent_conversation.",
        name: SPAWN_SUBAGENT_TOOL_NAME,
        parameters: modelToolParameters(spawnArgumentsSchema),
      },
      {
        description: "List configured model providers, models, enabled reasoning options, and recent health timestamps. Results prefer models that succeeded most recently. Use this before explicitly selecting a different model for spawn_subagent.",
        name: LIST_MODELS_TOOL_NAME,
        parameters: modelToolParameters(emptyArgumentsSchema),
      },
      {
        description: "List Subagent tasks created by this conversation and inspect their current status and final result.",
        name: LIST_SUBAGENTS_TOOL_NAME,
        parameters: modelToolParameters(emptyArgumentsSchema),
      },
      {
        description: "Wait for any or all selected Subagent tasks. Use this only when their result blocks the current work. A timeout is not a failure; the Subagents continue in the background and completion will still reactivate this conversation.",
        name: WAIT_FOR_SUBAGENTS_TOOL_NAME,
        parameters: modelToolParameters(waitArgumentsSchema),
      },
    ];
  }

  public getExecutionPolicy(toolName: string): ToolExecutionPolicy {
    switch (toolName) {
      case LIST_SUBAGENTS_TOOL_NAME:
      case LIST_MODELS_TOOL_NAME:
        return { group: "read", kind: "parallel" };
      case SPAWN_SUBAGENT_TOOL_NAME:
      case WAIT_FOR_SUBAGENTS_TOOL_NAME:
        return { kind: "serial" };
      default:
        throw new Error(`Unknown Subagent tool: ${toolName}`);
    }
  }

  public async execute(input: {
    arguments: string;
    conversationId: string;
    onResultMessagesRead?: (messageIds: readonly string[]) => void;
    signal: AbortSignal;
    spawn: (
      task: string,
      title: string | undefined,
      agentId: string | undefined,
      modelSelection: ConversationModelSelection | undefined,
    ) => SubagentTask;
    toolName: string;
  }): Promise<SubagentToolExecution> {
    try {
      const argumentsValue = parseToolArguments(input.arguments);
      switch (input.toolName) {
        case SPAWN_SUBAGENT_TOOL_NAME: {
          const parsed = spawnArgumentsSchema.parse(argumentsValue);
          return success({
            task: toToolTask(input.spawn(
              parsed.task,
              parsed.title,
              parsed.agentId,
              parsed.providerId === undefined || parsed.modelId === undefined
                ? undefined
                : {
                    modelId: parsed.modelId,
                    providerId: parsed.providerId,
                    reasoning: parsed.reasoning ?? null,
                  },
            )),
          });
        }
        case LIST_MODELS_TOOL_NAME: {
          emptyArgumentsSchema.parse(argumentsValue);
          const status = this.getModelStatus?.();
          if (status === undefined) throw new Error("The model catalog is unavailable.");
          const models = [...status.models].sort((left, right) => {
            const statusOrder = { healthy: 0, unknown: 1, error: 2 } as const;
            const byStatus = statusOrder[left.connectionStatus] - statusOrder[right.connectionStatus];
            if (byStatus !== 0) return byStatus;
            return (right.lastSuccessfulAt ?? "").localeCompare(left.lastSuccessfulAt ?? "");
          });
          return success({
            defaultSelection: status.providerId === null || status.modelId === null
              ? null
              : { modelId: status.modelId, providerId: status.providerId },
            models: models.map((model) => ({
              connectionStatus: model.connectionStatus,
              connectionStatusUpdatedAt: model.connectionStatusUpdatedAt,
              displayName: model.displayName,
              lastSuccessfulAt: model.lastSuccessfulAt,
              modelId: model.modelId,
              providerApiFormat: model.providerApiFormat,
              providerId: model.providerId,
              providerName: model.providerName,
              reasoningOptions: model.reasoningOptions.filter(isReasoningOptionEnabled),
            })),
            recentSelection: status.recentSelection,
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
            onResultMessagesRead: input.onResultMessagesRead,
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
      this.markResultsRead(tasks, waiter.onResultMessagesRead);
      waiter.resolve({ status: "ready", tasks });
    }
  }

  private async waitForTasks(input: {
    onResultMessagesRead: ((messageIds: readonly string[]) => void) | undefined;
    parentConversationId: string;
    signal: AbortSignal;
    taskIds: string[];
    timeoutMs: number;
    waitFor: "any" | "all";
  }): Promise<{ status: "ready" | "timeout"; tasks: SubagentTask[] }> {
    const initial = this.readTasks(input.parentConversationId, input.taskIds);
    if (this.isReady(initial, input.waitFor)) {
      this.markResultsRead(initial, input.onResultMessagesRead);
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
        onResultMessagesRead: input.onResultMessagesRead,
        parentConversationId: input.parentConversationId,
        resolve: finish,
        taskIds: input.taskIds,
        waitFor: input.waitFor,
      };
      const timeout = setTimeout(() => {
        const tasks = this.readTasks(input.parentConversationId, input.taskIds);
        this.markResultsRead(tasks, input.onResultMessagesRead);
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

  private markResultsRead(
    tasks: readonly SubagentTask[],
    onResultMessagesRead: ((messageIds: readonly string[]) => void) | undefined,
  ): void {
    const messageIds = tasks.flatMap((task) => task.resultMessageId === null ? [] : [task.resultMessageId]);
    this.database.markAgentMessagesRead(messageIds);
    if (messageIds.length > 0) onResultMessagesRead?.(messageIds);
  }

  private abortError(signal: AbortSignal): Error {
    return signal.reason instanceof Error
      ? signal.reason
      : new DOMException("The operation was aborted.", "AbortError");
  }
}
