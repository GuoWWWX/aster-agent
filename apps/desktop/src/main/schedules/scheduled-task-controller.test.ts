import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import type { ConversationRunEvent, SaveScheduledTaskInput } from "@agent/protocol";
import { ScheduledTaskController, type ScheduledTaskRunner } from "./scheduled-task-controller.js";
import { ScheduledTaskStore } from "./scheduled-task-store.js";
import { toMainAgentError } from "../errors/agent-error.js";

const CONVERSATION_ID = "00000000-0000-4000-8000-000000000001";
const RUN_ID = "00000000-0000-4000-8000-000000000002";
const input: SaveScheduledTaskInput = { name: "巡检", prompt: "检查项目", enabled: true,
  projectId: null, agentId: null, permissionMode: "ask_before_changes",
  recurrence: { kind: "daily", time: "09:00", timezone: "UTC" } };
let directory: string;
let store: ScheduledTaskStore;
let controller: ScheduledTaskController;
let now: Date;
let emitRun: (event: ConversationRunEvent) => void;
let runner: { [Key in keyof ScheduledTaskRunner]: Mock<ScheduledTaskRunner[Key]> };
const notify = vi.fn();
const report = vi.fn();
beforeEach(() => {
  directory = mkdtempSync(path.join(tmpdir(), "aster-schedule-test-"));
  store = new ScheduledTaskStore(path.join(directory, "scheduled-tasks.json"));
  now = new Date("2026-10-14T08:00:00Z");
  runner = { validate: vi.fn<ScheduledTaskRunner["validate"]>(), createConversation: vi.fn(() => CONVERSATION_ID), outcome: vi.fn<ScheduledTaskRunner["outcome"]>(() => "running"),
    start: vi.fn<ScheduledTaskRunner["start"]>((_task, _id, accepted, emit) => { accepted(RUN_ID); emitRun = emit; }),
  };
  notify.mockClear(); report.mockClear();
  controller = new ScheduledTaskController(store, runner, notify, report, () => now);
});
afterEach(() => { controller.dispose(); rmSync(directory, { recursive: true, force: true }); });
describe("scheduled tasks lifecycle", () => {
  it("persists create/edit/pause/delete without losing execution records", () => {
    const task = controller.save(input);
    expect(store.read()[0]?.nextRunAt).toBe("2026-10-14T09:00:00.000Z");
    controller.run(task.id);
    emitRun({ type: "run.finished", conversationId: CONVERSATION_ID, runId: RUN_ID, status: "completed", error: null });
    controller.save({ ...input, id: task.id, name: "新名称", enabled: false });
    expect(store.read()[0]).toMatchObject({ name: "新名称", nextRunAt: null, executions: [{ status: "completed" }] });
    controller.delete(task.id);
    expect(store.read()).toEqual([]);
  });
  it("claims and advances the occurrence durably before dispatch", () => {
    const task = controller.save(input);
    vi.mocked(runner.createConversation).mockImplementation(() => {
      expect(store.read()[0]).toMatchObject({ nextRunAt: "2026-10-15T09:00:00.000Z", executions: [{ status: "running", runId: null }] });
      return CONVERSATION_ID;
    });
    now = new Date("2026-10-14T09:00:01Z");
    controller.tick(); controller.tick();
    expect(runner.start).toHaveBeenCalledTimes(1);
    expect(controller.list()[0]?.executions[0]).toMatchObject({ conversationId: CONVERSATION_ID, runId: RUN_ID });
    expect(() => controller.run(task.id)).toThrow("正在执行");
    try { controller.run(task.id); } catch (error) {
      expect(toMainAgentError(error, { operation: "scheduled_task.run" })).toMatchObject({
        code: "CONFLICT", message: "任务正在执行，请等待当前执行结束。",
      });
    }
    expect(() => controller.delete(task.id)).toThrow("正在执行");
  });
  it("skips overlapping occurrences and starts again after completion", () => {
    const task = controller.save(input);
    controller.run(task.id);
    now = new Date("2026-10-14T09:00:01Z"); controller.tick();
    expect(runner.start).toHaveBeenCalledTimes(1);
    emitRun({ type: "run.finished", conversationId: CONVERSATION_ID, runId: RUN_ID, status: "completed", error: null });
    now = new Date("2026-10-15T09:00:01Z"); controller.tick();
    expect(runner.start).toHaveBeenCalledTimes(2);
  });
  it("does not catch up or replay work after restart", () => {
    const task = controller.save(input);
    controller.run(task.id);
    now = new Date("2026-10-16T10:00:00Z");
    controller = new ScheduledTaskController(store, runner, notify, report, () => now);
    controller.start(); controller.tick();
    expect(controller.list()[0]).toMatchObject({ nextRunAt: "2026-10-17T09:00:00.000Z", executions: [{ status: "failed" }] });
    expect(runner.start).toHaveBeenCalledTimes(1);
  });
  it("disables an expired one-off plan at startup", () => {
    controller.save({ ...input, recurrence: { kind: "once", at: "2026-10-14T09:00:00.000Z" } });
    now = new Date("2026-10-14T10:00:00Z"); controller.start(); controller.tick();
    expect(controller.list()[0]).toMatchObject({ enabled: false, nextRunAt: null });
    expect(runner.start).not.toHaveBeenCalled();
  });
  it("one-off execution consumes its plan and never repeats", () => {
    controller.save({ ...input, recurrence: { kind: "once", at: "2026-10-14T09:00:00.000Z" } });
    now = new Date("2026-10-14T09:00:00Z"); controller.tick(); controller.tick();
    expect(controller.list()[0]).toMatchObject({ enabled: false, nextRunAt: null });
    expect(runner.start).toHaveBeenCalledTimes(1);
  });
  it("records dispatch failure without leaking causes or retrying", () => {
    const task = controller.save(input);
    vi.mocked(runner.start).mockImplementation(() => { throw new Error("secret internal failure"); });
    const result = controller.run(task.id);
    expect(result.executions[0]?.status).toBe("failed");
    expect(readFileSync(path.join(directory, "scheduled-tasks.json"), "utf8")).not.toContain("secret internal failure");
    expect(report).toHaveBeenCalledTimes(1);
  });
  it("does not dispatch when durable claiming fails", () => {
    const task = controller.save(input);
    vi.spyOn(store, "write").mockImplementation(() => { throw new Error("disk full"); });
    expect(() => controller.run(task.id)).toThrow("disk full");
    expect(runner.start).not.toHaveBeenCalled();
    expect(controller.list()[0]?.executions).toEqual([]);
  });
  it("reconciles a missed completion event from authoritative run state", () => {
    const task = controller.save(input); controller.run(task.id);
    vi.mocked(runner.outcome).mockReturnValue("completed"); controller.tick();
    expect(controller.list()[0]?.executions[0]?.status).toBe("completed");
  });
  it("keeps the latest twenty executions and preserves result conversations on delete", () => {
    const task = controller.save(input);
    for (let i = 0; i < 25; i++) {
      controller.run(task.id);
      emitRun({ type: "run.finished", conversationId: CONVERSATION_ID, runId: RUN_ID, status: "completed", error: null });
    }
    expect(store.read()[0]?.executions).toHaveLength(20);
    controller.delete(task.id); expect(store.read()).toEqual([]);
  });
  it("rejects stale IDs, invalid recurrence, and missing targets", () => {
    expect(() => controller.save({ ...input, id: CONVERSATION_ID })).toThrow("不存在");
    expect(() => controller.save({ ...input, recurrence: { kind: "weekly", time: "09:00", timezone: "UTC", weekdays: [] } })).toThrow();
    vi.mocked(runner.validate).mockImplementation(() => { throw new Error("missing target"); });
    expect(() => controller.save(input)).toThrow("missing target"); expect(store.read()).toEqual([]);
  });
  it("can pause a plan even when its project or Agent has been removed", () => {
    const task = controller.save(input);
    runner.validate.mockImplementation(() => { throw new Error("missing target"); });
    expect(controller.save({ ...input, id: task.id, enabled: false }).enabled).toBe(false);
    expect(() => controller.save({ ...input, id: task.id, enabled: true })).toThrow("missing target");
    expect(controller.list()[0]?.enabled).toBe(false);
  });
  it("does not silently overwrite corrupt or future-version state", () => {
    const file = path.join(directory, "scheduled-tasks.json"); writeFileSync(file, '{"version":2,"tasks":[]}');
    expect(() => store.read()).toThrow(); expect(readFileSync(file, "utf8")).toContain('"version":2');
  });
});
