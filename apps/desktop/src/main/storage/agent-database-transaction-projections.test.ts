import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "./agent-database.js";
import type { ThreadLogProjectionEvent } from "./conversation-storage-contracts.js";

const databases: AgentDatabase[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function event(sequence: number, type: string, payload: Record<string, unknown>): ThreadLogProjectionEvent {
  return { createdAt: "2026-10-19T12:00:00.000Z", eventId: randomUUID(), payload, sequence, type };
}

function fixture(databasePath = ":memory:") {
  const database = new AgentDatabase(databasePath);
  databases.push(database);
  const conversationId = database.createConversation(null).id;
  const run = database.createRunWithUserMessage(conversationId, "事务边界检查", "fixture");
  database.markRunRunning(run.runId);
  return { conversationId, database, runId: run.runId };
}

function complete(database: AgentDatabase, conversationId: string, runId: string, result: string | null) {
  database.completeRun({
    assistant: { kind: "turn", content: "已提交的正文", messageId: randomUUID(), modelId: "fixture" },
    conversationId, error: null, result, runId, status: "completed",
  });
}

describe("AgentDatabase transactional memory projections", () => {
  it.each([false, true])("restores the previous paused=%s flag when a later event invalidates its SQL batch", paused => {
    const { conversationId, database, runId } = fixture();
    complete(database, conversationId, runId, "已提交结果");
    database.setConversationExecutionPaused(conversationId, paused);
    expect(() => database.projectThreadLogBusinessEvents(conversationId, [
      event(1, "conversation_result_viewed", {}),
      event(2, "conversation_execution_paused", { paused: !paused }),
      event(3, "conversation_execution_paused", { paused }),
      event(4, "conversation_execution_paused", { paused: !paused }),
      event(5, "run_queued", {}),
    ])).toThrow("ThreadLog queued Run event is invalid");
    expect(database.getConversation(conversationId).hasUnreadResult).toBe(true);
    expect(database.isConversationExecutionPaused(conversationId)).toBe(paused);
  });

  it.each(["已提交结果", null])("restores an existing terminal result (%s) after rejecting an illegal transition", result => {
    const { conversationId, database, runId } = fixture();
    complete(database, conversationId, runId, result);
    expect(() => database.projectThreadLogBusinessEvents(conversationId, [
      event(1, "run_terminal", { runId, status: "failed", result: "非法事件内容", error: "rejected" }),
    ])).toThrow("ThreadLog terminal Run state transition is invalid");
    expect(database.getConversationRunOutcome(conversationId, runId)).toMatchObject({ status: "completed", result });
  });

  it("restores a missing result key so the committed Assistant history remains the fallback", () => {
    const { conversationId, database, runId } = fixture();
    database.appendAssistantTurn({
      content: "历史中的正式回答", conversationId, messageId: randomUUID(), modelId: "fixture", runId, toolCalls: [],
    });
    database.finishRun(runId, "completed", null);
    expect(() => database.projectThreadLogBusinessEvents(conversationId, [
      event(1, "run_terminal", { runId, status: "completed", result: "第一次覆盖" }),
      event(2, "run_terminal", { runId, status: "completed", result: "第二次覆盖" }),
      event(3, "run_queued", {}),
    ])).toThrow();
    expect(database.getConversationRunOutcome(conversationId, runId)?.result).toBe("历史中的正式回答");
    expect(database.exportThreadLogStartupState(conversationId)?.terminalResults).toEqual([]);
  });

  it("restores memory when the full recovery owner rolls back a batch", () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    database.activateVolatileConversationProjection();
    const conversationId = database.createConversation(null).id;
    database.finalizeJsonlConversationStorage();
    const original = database.createTaskList(conversationId, [{ title: "已提交步骤", status: "pending" }]);
    expect(() => database.restoreThreadLogBusinessEvents(conversationId, [
      event(1, "conversation_execution_paused", { paused: true }),
      event(2, "task_list_updated", { taskList: { ...original, tasks: [{ ...original.tasks[0], title: "不应提交" }] } }),
      event(3, "run_queued", {}),
    ])).toThrow();
    expect(database.isConversationExecutionPaused(conversationId)).toBe(false);
    expect(database.getTaskList(conversationId)).toEqual(original);
  });

  it("keeps committed pause and terminal results, then rolls back only the next failed transaction", () => {
    const { conversationId, database, runId } = fixture();
    database.projectThreadLogBusinessEvents(conversationId, [
      event(1, "conversation_execution_paused", { paused: true }),
      event(2, "run_terminal", { runId, status: "completed", result: "已提交终态", assistant: null }),
    ]);
    expect(database.getConversationRunOutcome(conversationId, runId)).toMatchObject({ status: "completed", result: "已提交终态" });
    expect(() => database.projectThreadLogBusinessEvents(conversationId, [
      event(3, "conversation_execution_paused", { paused: false }),
      event(4, "run_terminal", { runId, status: "completed", result: "下一次未提交覆盖" }),
      event(5, "run_queued", {}),
    ])).toThrow();
    expect(database.isConversationExecutionPaused(conversationId)).toBe(true);
    expect(database.getConversationRunOutcome(conversationId, runId)?.result).toBe("已提交终态");
  });

  it("discards a final result when completeRun cannot commit its Assistant message", () => {
    const { conversationId, database, runId } = fixture();
    const existingMessage = database.listTimeline(conversationId)[0];
    if (existingMessage === undefined) throw new Error("Expected the initial user message.");
    expect(() => database.completeRun({
      assistant: { kind: "turn", content: "未提交结论", messageId: existingMessage.id, modelId: "fixture" },
      conversationId, error: null, result: "未提交结果", runId, status: "completed",
    })).toThrow("UNIQUE constraint failed");
    expect(database.getConversationRunOutcome(conversationId, runId)?.status).toBe("running");
    database.finishRun(runId, "completed", null);
    expect(database.getConversationRunOutcome(conversationId, runId)?.result).toBeNull();
    expect(database.exportThreadLogStartupState(conversationId)?.terminalResults).toEqual([]);
  });

  it("restores the projections after a real deferred foreign-key failure at COMMIT", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "database-projection-commit-"));
    directories.push(directory);
    const databasePath = path.join(directory, "db.sqlite");
    const { conversationId, database, runId } = fixture(databasePath);
    const injection = new DatabaseSync(databasePath);
    try {
      injection.exec(`
        CREATE TABLE audit_parent (id INTEGER PRIMARY KEY);
        CREATE TABLE audit_child (id INTEGER PRIMARY KEY, parent_id INTEGER REFERENCES audit_parent(id) DEFERRABLE INITIALLY DEFERRED);
        CREATE TRIGGER fail_run_commit AFTER UPDATE ON runs WHEN NEW.status = 'completed'
        BEGIN INSERT INTO audit_child VALUES (1, 999); END;
      `);
    } finally { injection.close(); }
    expect(() => database.projectThreadLogBusinessEvents(conversationId, [
      event(1, "conversation_execution_paused", { paused: true }),
      event(2, "run_terminal", { runId, status: "completed", result: "COMMIT未成功", assistant: null }),
    ])).toThrow("FOREIGN KEY constraint failed");
    expect(database.getConversationRunOutcome(conversationId, runId)).toMatchObject({ status: "running", result: null });
    expect(database.isConversationExecutionPaused(conversationId)).toBe(false);
    const releaseFailure = new DatabaseSync(databasePath);
    try { releaseFailure.exec("DROP TRIGGER fail_run_commit;"); } finally { releaseFailure.close(); }
    database.finishRun(runId, "completed", null);
    expect(database.getConversationRunOutcome(conversationId, runId)?.result).toBeNull();
    expect(database.exportThreadLogStartupState(conversationId)?.terminalResults).toEqual([]);
  });
});
