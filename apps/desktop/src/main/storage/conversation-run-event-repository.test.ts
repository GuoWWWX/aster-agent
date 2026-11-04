import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { ConversationToolItem } from "@agent/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "./agent-database.js";
import { ConversationRunEventRepository } from "./conversation-run-event-repository.js";
import type { CompleteRunInput, ThreadLogProjectionEvent } from "./conversation-storage-contracts.js";

const databases: AgentDatabase[] = [];
const sqliteConnections: DatabaseSync[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const database of databases.splice(0)) database.close();
  for (const connection of sqliteConnections.splice(0)) connection.close();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function fixture(databasePath = ":memory:") {
  const database = new AgentDatabase(databasePath);
  databases.push(database);
  const conversation = database.createConversation(null);
  const run = database.createRunWithUserMessage(conversation.id, "执行任务", "fixture");
  database.markRunRunning(run.runId);
  const tool = (status: ConversationToolItem["status"] = "running"): ConversationToolItem => ({
    arguments: "{}", batchId: null, conversationId: conversation.id,
    createdAt: "2026-10-19T10:00:00.000Z", diff: null, id: randomUUID(), kind: "tool",
    name: "run_command", result: null, runId: run.runId, status,
  });
  return { conversationId: conversation.id, database, runId: run.runId, tool };
}

function event(sequence: number, type: string, payload: Record<string, unknown>): ThreadLogProjectionEvent {
  return { createdAt: "2026-10-19T10:00:01.000Z", eventId: randomUUID(), payload, sequence, type };
}

describe("Conversation Run event persistence", () => {
  it.each([
    { kind: "turn", status: "completed", content: "", reasoningContent: "完整思考", timeline: true, model: true },
    { kind: "turn", status: "completed", content: "", reasoningContent: "", timeline: false, model: true },
    { kind: "failure", status: "failed", content: "失败诊断", timeline: true, model: false },
    { kind: "cancelled", status: "cancelled", content: "尚未完成的回答", reasoningContent: "部分思考", timeline: true, model: true },
    { kind: "cancelled", status: "cancelled", content: "", reasoningContent: "", timeline: false, model: true },
  ] as const)("preserves terminal $kind content and model visibility ($content/$reasoningContent)", value => {
    const { database, conversationId, runId } = fixture();
    const messageId = randomUUID();
    const assistant: CompleteRunInput["assistant"] = {
      kind: value.kind, content: value.content, messageId, modelId: "fixture",
      ...("reasoningContent" in value ? { reasoningContent: value.reasoningContent } : {}),
    };
    const result = database.completeRun({
      assistant, conversationId, error: value.status === "failed" ? "诊断" : null,
      result: value.content, runId, status: value.status,
    });
    expect(result.assistantMessage === null).toBe(!value.timeline);
    if (value.timeline) expect(result.assistantMessage).toMatchObject({
      content: value.content, id: messageId, status: value.status,
    });
    expect(database.listModelMessages(conversationId).filter(message => message.role === "assistant"))
      .toHaveLength(Number(value.model));
    expect(database.listModelMessages(conversationId).at(-1)?.content)
      .toBe(value.model ? value.content : "执行任务");
    expect(database.getConversation(conversationId)).toMatchObject({
      activeRunId: null, hasUnreadResult: value.status !== "cancelled", lastRunStatus: value.status,
    });
  });

  it.each([
    { kind: "failure", status: "completed" },
    { kind: "turn", status: "cancelled" },
    { kind: "cancelled", status: "failed" },
  ] as const)("rejects inconsistent terminal $kind/$status before writing", value => {
    const { database, conversationId, runId } = fixture();
    const before = database.listTimeline(conversationId);
    expect(() => database.completeRun({
      assistant: { kind: value.kind, content: "不应保存", messageId: randomUUID(), modelId: "fixture" },
      conversationId, error: null, result: null, runId, status: value.status,
    })).toThrow();
    expect(database.getConversation(conversationId).activeRunId).toBe(runId);
    expect(database.listTimeline(conversationId)).toEqual(before);
    expect(database.listModelMessages(conversationId)).toHaveLength(1);
  });

  it("keeps a standalone Assistant failure out of model context", () => {
    const { database, conversationId, runId } = fixture();
    const message = database.appendAssistantFailure({
      content: "仅供用户查看的失败诊断", conversationId, runId, messageId: randomUUID(), modelId: "fixture",
    });
    expect(database.listTimeline(conversationId)).toContainEqual(message);
    expect(database.listModelMessages(conversationId)).toHaveLength(1);
    expect(database.getConversation(conversationId).activeRunId).toBe(runId);
  });

  it("updates runtime activity in place without inserting a model ToolMessage", () => {
    const { database, conversationId, tool } = fixture();
    const initial = tool();
    database.upsertRuntimeActivity(initial);
    const completed = { ...initial, status: "completed" as const, result: "后台命令结果" };
    database.upsertRuntimeActivity(completed);
    expect(database.listTimeline(conversationId).filter(item => item.id === initial.id)).toEqual([completed]);
    expect(database.listModelMessages(conversationId)).toHaveLength(1);
  });

  it("rejects Retry identity reuse across Runs without changing the existing row", () => {
    const first = fixture();
    const second = first.database.createConversation(null);
    const secondRun = first.database.createRunWithUserMessage(second.id, "第二个任务", "fixture");
    const retry = {
      attempt: 1, conversationId: first.conversationId, createdAt: "2026-10-19T10:00:00.000Z",
      id: randomUUID(), kind: "model_retry" as const, maxAttempts: 3, reason: "暂时不可用",
      retryInMs: 1000, runId: first.runId, status: "retrying" as const, updatedAt: "2026-10-19T10:00:01.000Z",
    };
    first.database.upsertModelRetry(retry);
    expect(() => first.database.upsertModelRetry({ ...retry, conversationId: second.id, runId: secondRun.runId }))
      .toThrow("Model retry timeline identity conflicts");
    expect(first.database.listTimeline(first.conversationId)).toContainEqual(retry);
    expect(first.database.listTimeline(second.id).some(item => item.id === retry.id)).toBe(false);
  });

  it("expires only pending approvals of the target Run and remains idempotent", () => {
    const first = fixture();
    const other = first.database.createConversation(null);
    const otherRun = first.database.createRunWithUserMessage(other.id, "另一个待审批任务", "fixture");
    const pending = first.tool("awaiting_approval");
    const completed = first.tool("completed");
    const unrelated = { ...first.tool("awaiting_approval"), conversationId: other.id, runId: otherRun.runId };
    first.database.appendToolStarted(pending);
    first.database.appendToolStarted(completed);
    first.database.appendToolStarted(unrelated);
    first.database.finishRun(first.runId, "cancelled", null);
    expect(first.database.expirePendingToolApprovalsForRun(first.runId)).toEqual([
      { ...pending, result: "审批已失效：所属运行已经结束。", status: "cancelled" },
    ]);
    expect(first.database.expirePendingToolApprovalsForRun(first.runId)).toEqual([]);
    expect(first.database.listTimeline(first.conversationId)).toContainEqual(completed);
    expect(first.database.listTimeline(other.id)).toContainEqual(unrelated);
  });

  it("replays Assistant and Tool facts once and rolls back an invalid event batch", () => {
    const { database, conversationId, runId, tool } = fixture();
    const assistantEvent = event(1, "assistant_message", {
      content: "准备调用", messageId: randomUUID(), modelId: "fixture", reasoningContent: "内部思考",
      runId, toolCalls: [{ id: "provider-call", name: "run_command", arguments: "{}" }], writeAhead: true,
    });
    const completed = { ...tool(), result: "工具结果", status: "completed" };
    const toolEvent = event(2, "tool_result", {
      content: "工具结果", tool: completed, toolCallId: "provider-call", writeAhead: true,
    });
    database.projectThreadLogBusinessEvents(conversationId, [assistantEvent, toolEvent]);
    database.projectThreadLogBusinessEvents(conversationId, [assistantEvent, toolEvent]);
    expect(database.listModelMessages(conversationId).map(message => message.content))
      .toEqual(["执行任务", "准备调用", "工具结果"]);
    expect(database.listTimeline(conversationId).filter(item => item.kind === "tool")).toEqual([completed]);
    const invalid = event(4, "runtime_activity_updated", { tool: null, writeAhead: true });
    const before = database.listTimeline(conversationId);
    expect(() => database.projectThreadLogBusinessEvents(conversationId, [
      event(3, "tool_result", { ...toolEvent.payload, tool: { ...completed, id: randomUUID() } }), invalid,
    ])).toThrow("ThreadLog runtime activity update is invalid");
    expect(database.listTimeline(conversationId)).toEqual(before);
    expect(database.listModelMessages(conversationId)).toHaveLength(3);
  });

  it("rolls back the Tool row when its model result cannot be inserted", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "run-event-rollback-"));
    directories.push(directory);
    const databasePath = path.join(directory, "db.sqlite");
    const { database, conversationId, tool } = fixture(databasePath);
    const running = tool();
    database.appendToolStarted(running);
    const injection = new DatabaseSync(databasePath);
    try {
      injection.exec(`CREATE TRIGGER fail_tool_model_result BEFORE INSERT ON model_messages
        BEGIN SELECT RAISE(ABORT, 'injected tool result failure'); END;`);
    } finally { injection.close(); }
    expect(() => database.completeTool({
      providerCallId: "provider-call", result: "不能提交", tool: { ...running, status: "completed", result: "不能提交" },
    })).toThrow("injected tool result failure");
    expect(database.listTimeline(conversationId)).toContainEqual(running);
    expect(database.listModelMessages(conversationId)).toHaveLength(1);
  });
});

function repositoryFixture() {
  const database = new DatabaseSync(":memory:");
  sqliteConnections.push(database);
  database.exec(`
    CREATE TABLE conversations (id TEXT PRIMARY KEY, updated_at TEXT, has_unread_result INTEGER);
    CREATE TABLE runs (id TEXT PRIMARY KEY, conversation_id TEXT, status TEXT, error TEXT, updated_at TEXT);
    CREATE TABLE conversation_timeline (
      id TEXT PRIMARY KEY, conversation_id TEXT, run_id TEXT, kind TEXT, payload_json TEXT, created_at TEXT
    );
    CREATE TABLE model_messages (
      id TEXT PRIMARY KEY, conversation_id TEXT, run_id TEXT, role TEXT, content TEXT,
      tool_calls_json TEXT, tool_call_id TEXT, attachment_ids_json TEXT, provider_state_json TEXT, created_at TEXT
    );
  `);
  const conversationId = randomUUID();
  const runId = randomUUID();
  database.prepare("INSERT INTO conversations VALUES (?, ?, 0)").run(conversationId, "2026-10-19T10:00:00.000Z");
  database.prepare("INSERT INTO runs VALUES (?, ?, 'running', NULL, ?)").run(runId, conversationId, "2026-10-19T10:00:00.000Z");
  return { conversationId, database, repository: new ConversationRunEventRepository(database), runId };
}

describe("ConversationRunEventRepository", () => {
  it("participates in its caller's transaction without committing partial terminal facts", () => {
    const { conversationId, database, repository, runId } = repositoryFixture();
    database.exec("BEGIN IMMEDIATE;");
    expect(repository.updateRunInTransaction(runId, "completed", null)).toBe(conversationId);
    repository.appendTerminalAssistant({
      assistant: { kind: "turn", content: "未提交的结论", messageId: randomUUID(), modelId: "fixture" },
      conversationId, runId,
    });
    database.exec("ROLLBACK;");
    expect(database.prepare("SELECT status FROM runs WHERE id = ?").get(runId)?.status).toBe("running");
    expect(database.prepare("SELECT has_unread_result FROM conversations WHERE id = ?").get(conversationId)?.has_unread_result).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM conversation_timeline").get()?.count).toBe(0);
    expect(database.prepare("SELECT COUNT(*) AS count FROM model_messages").get()?.count).toBe(0);
  });

  it("preserves strict live inserts and idempotent event-identity replay inserts", () => {
    const { conversationId, database, repository, runId } = repositoryFixture();
    const message = repository.appendTerminalAssistant({
      assistant: { kind: "turn", content: "首次结论", messageId: randomUUID(), modelId: "fixture" },
      conversationId, runId,
    });
    expect(message).not.toBeNull();
    if (message === null) throw new Error("Expected the visible Assistant message.");
    expect(() => repository.insertTimelineItem(message)).toThrow("UNIQUE constraint failed");
    repository.insertThreadLogTimeline({ ...message, content: "不应覆盖" });
    expect(JSON.parse(String(database.prepare("SELECT payload_json FROM conversation_timeline WHERE id = ?").get(message.id)?.payload_json)))
      .toMatchObject({ content: "首次结论" });
    const replayInput = {
      attachmentIds: [], content: "事件结果", conversationId, createdAt: message.createdAt, eventId: randomUUID(),
      role: "tool" as const, runId, toolCallId: "provider-call", toolCalls: [],
    };
    repository.insertThreadLogModelMessage(replayInput);
    repository.insertThreadLogModelMessage({ ...replayInput, content: "不应重复插入或覆盖" });
    expect(database.prepare("SELECT content FROM model_messages WHERE id = ?").get(replayInput.eventId)?.content)
      .toBe("事件结果");
    expect(database.prepare("SELECT COUNT(*) AS count FROM model_messages").get()?.count).toBe(2);
  });
});
