import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { AgentDatabase } from "./agent-database.js";

const opened: AgentDatabase[] = [];
afterEach(() => { for (const database of opened.splice(0)) database.close(); });
function fixture() {
  const database = new AgentDatabase(":memory:"); opened.push(database);
  const owner = database.createConversation(null);
  const other = database.createConversation(null);
  const input = { conversationId: owner.id, title: "搜索与分页", goal: "保留来源消息", status: "running" as const, requestId: randomUUID() };
  const task = database.collaboration.updateTask(input);
  return { database, owner, other, task, input };
}
it("requires user confirmation until this conversation grants Agent completion, while retaining manual control", () => {
  const { database, owner, other, task, input } = fixture(); const store = database.collaboration;
  expect(store.getCompletionPolicy({ conversationId: owner.id })).toEqual({ allowAgentCompletion: false });
  const requested = store.updateTask({ ...input, id: task.id, expectedRevision: task.revision, status: "completed", requestId: randomUUID() }, "agent");
  expect(requested).toMatchObject({ status: "running", completionRequested: true, completedBy: null });
  store.setCompletionPolicy({ conversationId: owner.id, allowAgentCompletion: true });
  expect(store.getCompletionPolicy({ conversationId: other.id })).toEqual({ allowAgentCompletion: false });
  const completed = store.updateTask({ ...input, id: task.id, expectedRevision: requested.revision, status: "completed", requestId: randomUUID() }, "agent");
  expect(completed).toMatchObject({ status: "completed", completionRequested: false, completedBy: "agent" });
  store.setCompletionPolicy({ conversationId: owner.id, allowAgentCompletion: false });
  const manual = store.updateTask({ ...input, id: task.id, expectedRevision: completed.revision, status: "completed", requestId: randomUUID() });
  expect(manual).toMatchObject({ status: "completed", completedBy: "user" });
});
it("returns filtered totals before cursor pagination and never resolves another conversation's private task", () => {
  const { database, owner, other, task } = fixture();
  for (let index = 0; index < 7; index++) database.collaboration.updateTask({ conversationId: owner.id, title: `任务 ${index}`, goal: "分页", requestId: randomUUID() });
  const first = database.collaboration.listTasks({ conversationId: owner.id, query: "分页", limit: 3 });
  const second = database.collaboration.listTasks({ conversationId: owner.id, query: "分页", limit: 3, beforeId: first.nextBeforeId! });
  expect(first.total).toBe(8); expect(second.total).toBe(8); expect(second.items).toHaveLength(3);
  expect(database.collaboration.resolveReferences({ conversationId: owner.id, ids: [task.id] })).toEqual([expect.objectContaining({ kind: "task", title: task.title })]);
  expect(database.collaboration.resolveReferences({ conversationId: other.id, ids: [task.id] })).toEqual([]);
});

it("searches original user messages before pagination and returns readable source bodies", () => {
  const { database, owner, task } = fixture();
  const run = database.createRunWithUserMessage(owner.id, "原始用户需求：检验候选分页", "fixture");
  database.collaboration.linkTask({ id: task.id, source: { kind: "conversation", containerId: owner.id, messageId: run.userMessage.id } });
  const page = database.collaboration.listTasks({ conversationId: owner.id, query: "检验候选" });
  expect(page.total).toBe(1); expect(page.items[0]).toMatchObject({ id: task.id, userMessageCount: 1 });
  expect(database.collaboration.getTask(task.id).sources[0]).toMatchObject({ role: "user", content: "原始用户需求：检验候选分页", available: true });
  expect(database.collaboration.resolveReferences({ conversationId: owner.id, ids: [run.userMessage.id] })).toEqual([expect.objectContaining({ kind: "message", senderName: "你", senderConversationId: null, content: "原始用户需求：检验候选分页" })]);
});
it("isolates group completion grants from member-private conversations and resolves group quotes in scope", () => {
  const { database } = fixture(); database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  const instance = database.createTeamInstance({ teamId: "default-team", scope: "global" });
  const lead = database.createConversation(null, { teamId: instance.teamId, threadKind: "team_lead" });
  database.bindTeamExecutionConversation({ conversationId: lead.id, teamId: instance.teamId, teamInstanceId: instance.id, projectId: null, sourceConversationId: null });
  database.setTeamInstanceRoot(instance.id, lead.id);
  const message = database.collaboration.postMessage({ teamInstanceId: instance.id, content: "群聊原始需求用于搜索", requestId: randomUUID(), intent: "notify" }, null);
  const create = { conversationId: lead.id, title: "群聊需求", goal: "独立确认", source: { kind: "group" as const, containerId: instance.id, messageId: message.id }, requestId: randomUUID() };
  const task = database.collaboration.updateTask(create);
  database.collaboration.setCompletionPolicy({ teamInstanceId: instance.id, allowAgentCompletion: true });
  expect(database.collaboration.updateTask({ ...create, id: task.id, expectedRevision: task.revision, status: "completed", requestId: randomUUID() }, "agent")).toMatchObject({ status: "completed", completedBy: "agent" });
  const privateTask = database.collaboration.updateTask({ conversationId: lead.id, title: "私聊任务", goal: "独立确认", status: "completed", requestId: randomUUID() }, "agent");
  expect(privateTask).toMatchObject({ status: "running", completionRequested: true });
  expect(database.collaboration.listTasks({ teamInstanceId: instance.id, query: "原始需求用于搜索" }).items.map(item => item.id)).toEqual([task.id]);
  expect(database.collaboration.resolveReferences({ teamInstanceId: instance.id, ids: [message.id] })).toEqual([expect.objectContaining({ kind: "message", sourceKind: "group", content: message.content })]);
});
it("upgrades a version-34 database and retains user grants across repeated reopen", () => {
  const directory = mkdtempSync(path.join(os.tmpdir(), "task-list-migration-"));
  const file = path.join(directory, "agent.sqlite");
  try {
    const database = new AgentDatabase(file); const owner = database.createConversation(null); database.close();
    const legacy = new DatabaseSync(file); legacy.exec("DROP TABLE task_completion_policies; DELETE FROM schema_migrations WHERE version = 35"); legacy.close();
    const upgraded = new AgentDatabase(file);
    expect(upgraded.collaboration.getCompletionPolicy({ conversationId: owner.id })).toEqual({ allowAgentCompletion: false });
    upgraded.collaboration.setCompletionPolicy({ conversationId: owner.id, allowAgentCompletion: true }); upgraded.close();
    const reopened = new AgentDatabase(file); expect(reopened.collaboration.getCompletionPolicy({ conversationId: owner.id })).toEqual({ allowAgentCompletion: true }); reopened.close();
  } finally { rmSync(directory, { force: true, recursive: true }); }
});
