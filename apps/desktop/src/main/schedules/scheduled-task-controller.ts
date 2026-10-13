import { randomUUID } from "node:crypto";
import {
  saveScheduledTaskInputSchema, type SaveScheduledTaskInput, type ScheduledTask,
  type ScheduledTaskExecution, type ConversationRunEvent,
  type AgentErrorCode,
} from "@agent/protocol";
import { nextScheduledTime } from "./next-scheduled-time.js";
import { ScheduledTaskStore } from "./scheduled-task-store.js";

export function scheduledTaskError(code: AgentErrorCode, message: string): Error {
  return Object.assign(new Error(message), { code, id: randomUUID(), retryable: false });
}

export interface ScheduledTaskRunner {
  validate(task: SaveScheduledTaskInput): void;
  createConversation(task: ScheduledTask): string;
  start(task: ScheduledTask, conversationId: string, accepted: (runId: string) => void,
    emit: (event: ConversationRunEvent) => void): void;
  outcome(conversationId: string, runId: string): "queued" | "running" | "completed" | "failed" | "cancelled" | null;
}

export class ScheduledTaskController {
  private tasks: ScheduledTask[];
  private timer: ReturnType<typeof setInterval> | undefined;
  public constructor(private readonly store: ScheduledTaskStore, private readonly runner: ScheduledTaskRunner,
    private readonly emit: (event: ConversationRunEvent) => void, private readonly reportError: (error: unknown) => void,
    private readonly now: () => Date = () => new Date()) {
    this.tasks = store.read();
  }

  public start(): void {
    if (this.timer !== undefined) return;
    const now = this.now();
    this.commit(this.tasks.map((task) => {
      const nextRunAt = task.enabled ? nextScheduledTime(task.recurrence, now) : null;
      return { ...task, nextRunAt, enabled: task.enabled && nextRunAt !== null,
        executions: task.executions.map((execution) => {
          if (execution.status !== "running") return execution;
          const outcome = execution.conversationId !== null && execution.runId !== null
            ? this.runner.outcome(execution.conversationId, execution.runId) : null;
          return { ...execution, status: outcome === "completed" || outcome === "cancelled" ? outcome : "failed" as const,
            finishedAt: now.toISOString(), error: outcome === "completed" || outcome === "cancelled" ? null : "应用关闭中断执行，未自动重试。" };
        }),
      };
    }));
    this.timer = setInterval(() => { try { this.tick(); } catch (error) { this.reportError(error); } }, 5000);
    this.timer.unref();
  }
  public dispose(): void { clearInterval(this.timer); this.timer = undefined; }
  public list(): ScheduledTask[] { return structuredClone(this.tasks); }

  public save(rawInput: SaveScheduledTaskInput): ScheduledTask {
    const input = saveScheduledTaskInputSchema.parse(rawInput);
    if (input.enabled) this.runner.validate(input);
    const previous = input.id === undefined ? undefined : this.find(input.id);
    if (previous === undefined && this.tasks.length >= 100) throw scheduledTaskError("VALIDATION_FAILED", "最多可创建 100 个定时任务。");
    const now = this.now();
    const nextRunAt = input.enabled ? nextScheduledTime(input.recurrence, now) : null;
    if (input.enabled && nextRunAt === null) throw scheduledTaskError("VALIDATION_FAILED", "请选择未来的执行时间。");
    const task: ScheduledTask = { ...input, id: previous?.id ?? randomUUID(),
      createdAt: previous?.createdAt ?? now.toISOString(), updatedAt: now.toISOString(),
      nextRunAt, executions: previous?.executions ?? [] };
    this.commit(previous === undefined ? [...this.tasks, task] : this.tasks.map((item) => item.id === task.id ? task : item));
    return structuredClone(task);
  }
  public delete(id: string): void {
    const task = this.find(id);
    if (task.executions.some((execution) => execution.status === "running")) throw scheduledTaskError("CONFLICT", "任务正在执行，请先在对应对话中停止。");
    this.commit(this.tasks.filter((item) => item.id !== id));
  }
  public run(id: string): ScheduledTask {
    const task = this.find(id);
    if (task.executions.some((execution) => execution.status === "running")) throw scheduledTaskError("CONFLICT", "任务正在执行，请等待当前执行结束。");
    const execution: ScheduledTaskExecution = { id: randomUUID(), startedAt: this.now().toISOString(), finishedAt: null,
      status: "running", conversationId: null, runId: null, error: null };
    // Claim durably before creating a conversation or dispatching a model call.
    this.update(id, (current) => ({ ...current, executions: [execution, ...current.executions].slice(0, 20) }));
    try {
      this.runner.validate(task);
      const conversationId = this.runner.createConversation(task);
      this.updateExecution(id, execution.id, { conversationId });
      this.runner.start(task, conversationId, (runId) => this.updateExecution(id, execution.id, { runId }), (event) => {
        try {
          if (event.type === "run.finished") this.updateExecution(id, execution.id, {
            status: event.status, finishedAt: this.now().toISOString(),
            error: event.status === "failed" ? "执行失败，请打开结果对话查看详情。" : null,
          });
        } catch (error) { this.reportError(error); }
        this.emit(event);
      });
    } catch (error) {
      this.updateExecution(id, execution.id, { status: "failed", finishedAt: this.now().toISOString(),
        error: "无法开始执行，请检查项目、Agent 和模型配置。" });
      this.reportError(error);
    }
    return structuredClone(this.find(id));
  }
  public tick(): void {
    const now = this.now();
    for (const task of this.list()) for (const execution of task.executions) {
      if (execution.status !== "running" || execution.conversationId === null || execution.runId === null) continue;
      const outcome = this.runner.outcome(execution.conversationId, execution.runId);
      if (outcome === "completed" || outcome === "failed" || outcome === "cancelled") this.updateExecution(task.id, execution.id, {
        status: outcome, finishedAt: now.toISOString(), error: outcome === "failed" ? "执行失败，请打开结果对话查看详情。" : null,
      });
    }
    for (const task of this.list()) {
      if (!task.enabled || task.nextRunAt === null || Date.parse(task.nextRunAt) > now.getTime()) continue;
      const nextRunAt = nextScheduledTime(task.recurrence, now);
      this.update(task.id, (current) => ({ ...current, nextRunAt, enabled: nextRunAt !== null }));
      // Skip overlapping occurrences instead of building an unbounded queue.
      if (!task.executions.some((execution) => execution.status === "running")) this.run(task.id);
    }
  }
  private find(id: string): ScheduledTask {
    const task = this.tasks.find((item) => item.id === id);
    if (task === undefined) throw scheduledTaskError("ARTIFACT_NOT_FOUND", "定时任务不存在。");
    return task;
  }
  private commit(tasks: ScheduledTask[]): void { this.store.write(tasks); this.tasks = tasks; }
  private update(id: string, apply: (task: ScheduledTask) => ScheduledTask): void {
    this.commit(this.tasks.map((task) => task.id === id ? apply(task) : task));
  }
  private updateExecution(id: string, executionId: string, changes: Partial<ScheduledTaskExecution>): void {
    this.update(id, (task) => ({ ...task, executions: task.executions.map((execution) => execution.id === executionId ? { ...execution, ...changes } : execution) }));
  }
}
