import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { z } from "zod";
import { AgentDatabase } from "../storage/agent-database.js";
import { CollaborationTool } from "./collaboration-tool.js";

const opened: AgentDatabase[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const database of opened.splice(0)) database.close(); });

function fixture() {
  const database = new AgentDatabase(":memory:"); opened.push(database);
  database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  const instance = database.createTeamInstance({ teamId: "default-team", scope: "global" });
  const lead = database.createConversation(null, { teamId: instance.teamId, threadKind: "team_lead" });
  database.bindTeamExecutionConversation({ conversationId: lead.id, teamId: instance.teamId,
    teamInstanceId: instance.id, projectId: null, sourceConversationId: null });
  database.setTeamInstanceRoot(instance.id, lead.id);
  return { database, instance, lead, tool: new CollaborationTool(database) };
}

it("requires an explicit audience choice before routing any members", async () => {
  const { database, lead, tool } = fixture();
  const finish = vi.spyOn(database.collaboration, "finishCoordination");
  const changed = vi.fn(); const routed = vi.fn(); const post = vi.fn();
  expect(tool.coordinatorDefinitions().find(definition => definition.name === "select_team_chat_members")?.parameters.required).toContain("audience");
  const result = await tool.execute({ name: "select_team_chat_members", arguments: JSON.stringify({ messageId: randomUUID(),
    recipientConversationIds: [lead.id], decisionSummary: "另起独立问题。" }), conversationId: lead.id,
    runId: randomUUID(), toolCallId: randomUUID(), changed, routed, post });
  expect(result).toMatchObject({ kind: "completed", isError: true });
  if (result.kind !== "completed") throw new Error("Expected a validation result.");
  expect(result.content).toContain("audience");
  expect(finish).not.toHaveBeenCalled(); expect(changed).not.toHaveBeenCalled();
  expect(routed).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});

it.each([0, 1, 2])("resolves current only for a unique assignment in the calling Run (%i assignments)", async count => {
  const { database, instance, lead, tool } = fixture();
  const run = database.createRunWithUserMessage(lead.id, "本轮委派", "test-model");
  for (let index = 0; index < count; index++) {
    const message = database.collaboration.postMessage({ teamInstanceId: instance.id, content: `当前请求 ${index}`,
      recipientConversationIds: [lead.id], requestId: randomUUID() }, null);
    database.collaboration.consumeDelivery(message.deliveries[0]!.id, run.runId);
  }
  const result = await tool.execute({ name: "read_team_messages", arguments: JSON.stringify({ messageId: "current" }),
    conversationId: lead.id, runId: run.runId, toolCallId: randomUUID(), changed: vi.fn(), post: vi.fn() });
  expect(result).toMatchObject({ kind: "completed", isError: count !== 1 });
  if (result.kind !== "completed") throw new Error("Expected a read result.");
  if (count === 1) expect(JSON.parse(result.content)).toMatchObject({ value: { messages: [{ content: "当前请求 0" }] } });
  else expect(result.content).toContain("ambiguous_current_message");
});

it.each(["read_team_messages", "post_team_message"])("does not scan or synchronize the board for %s", async (name) => {
  const { database, lead, tool } = fixture();
  const list = vi.spyOn(database, "listTeamWorkItems");
  const sync = vi.spyOn(database.collaboration, "syncWorkItems");
  const result = await tool.execute({ name, arguments: JSON.stringify(name === "post_team_message" ? { content: "你好" } : {}),
    conversationId: lead.id, runId: randomUUID(), toolCallId: randomUUID(), changed: vi.fn(),
    post: input => database.collaboration.postMessage(input, lead.id) });
  expect(result).toMatchObject({ kind: "completed", isError: false });
  expect(list).not.toHaveBeenCalled();
  expect(sync).not.toHaveBeenCalled();
});

it("still imports existing board tasks when listing the task directory", async () => {
  const { database, instance, lead, tool } = fixture();
  const modelSelection = { providerId: randomUUID(), modelId: "test-model", reasoning: null };
  const task = database.createTeamWorkItem({ teamId: instance.teamId, teamInstanceId: instance.id,
    projectId: null, title: "Existing task", requirement: "Keep board task identity", acceptanceCriteria: [],
    priority: "normal", permissionMode: "full_access", modelSelection }, modelSelection);
  const result = await tool.execute({ name: "list_task_contexts", arguments: "{}", conversationId: lead.id,
    runId: randomUUID(), toolCallId: randomUUID(), changed: vi.fn(), post: input => database.collaboration.postMessage(input, lead.id) });
  expect(result).toMatchObject({ kind: "completed", isError: false });
  if (result.kind !== "completed") throw new Error("Expected a completed directory read.");
  const response = z.object({ value: z.object({ items: z.array(z.object({ id: z.string() })) }) }).parse(JSON.parse(result.content));
  expect(response.value.items).toContainEqual({ id: task.id });
});

it("records Agent completion as awaiting user confirmation and rejects self-granted permission", async () => {
  const { database, lead, tool } = fixture(); const runId = randomUUID();
  const execute = (args: unknown) => tool.execute({ name: "update_task_context", arguments: JSON.stringify(args), conversationId: lead.id,
    runId, toolCallId: randomUUID(), changed: vi.fn(), post: input => database.collaboration.postMessage(input, lead.id) });
  const args = { title: "需用户确认", goal: "权限由用户控制", status: "completed" };
  expect(await execute({ ...args, allowAgentCompletion: true })).toMatchObject({ isError: true });
  const result = await execute(args); expect(result).toMatchObject({ isError: false });
  expect(database.collaboration.listTasks({ conversationId: lead.id }).items).toEqual([expect.objectContaining({ status: "running", completionRequested: true })]);
});

it("explains that a queued preview must be claimed before it can be a task source", async () => {
  const { database, lead, tool } = fixture();
  const pending = database.enqueuePendingMessage({ conversationId: lead.id, content: "尚未领取的任务" });
  const result = await tool.execute({ name: "update_task_context", arguments: JSON.stringify({ title: "新目标", goal: "不要提前登记", source: {
    kind: "conversation", containerId: lead.id, messageId: pending.id, purpose: "request",
  } }), conversationId: lead.id, runId: randomUUID(), toolCallId: randomUUID(), changed: vi.fn(), post: input => database.collaboration.postMessage(input, lead.id) });
  expect(result).toMatchObject({ isError: true });
  if (result.kind !== "completed") throw new Error("Expected a validation failure");
  expect(JSON.parse(result.content)).toMatchObject({ recovery: { action: "fix_arguments", issues: [{ path: ["source", "messageId"] }] } });
  expect(result.content).toContain("claim_pending_messages");
  expect(database.collaboration.listTasks({ conversationId: lead.id }).items).toHaveLength(0);
});

it.each([true, false])("reads only this coordinator's group task details (same group: %s)", async sameGroup => {
  const { database, lead, instance, tool } = fixture();
  const coordinator = database.createConversation(null);
  database.collaboration.bindCoordinatorConversation(instance.id, "default-agent", coordinator.id);
  const owner = sameGroup ? lead : database.createConversation(null);
  const task = database.collaboration.updateTask({ conversationId: owner.id, title: "参考目标", goal: "只允许读取本群目标", requestId: randomUUID() });
  const result = await tool.execute({ name: "get_task_context", arguments: JSON.stringify({ id: task.id }), conversationId: coordinator.id,
    runId: randomUUID(), toolCallId: randomUUID(), changed: vi.fn(), post: input => database.collaboration.postMessage(input, coordinator.id) });
  expect(result).toMatchObject({ isError: !sameGroup });
  if (result.kind !== "completed") throw new Error("Expected a completed read");
  if (sameGroup) expect(JSON.parse(result.content)).toMatchObject({ value: { task: { id: task.id } } });
  else expect(JSON.parse(result.content)).not.toHaveProperty("value.task");
});

it.each([true, false])("keeps independent task sources separate when updating with an explicit source: %s", async explicit => {
  const { database, lead, tool } = fixture();
  const run = database.createRunWithUserMessage(lead.id, "任务 D", "test-model");
  const queued = database.enqueuePendingMessage({ conversationId: lead.id, content: "独立任务 E" });
  const second = database.consumePendingMessageIntoRun(queued.id, run.runId, "独立任务 E");
  const execute = (args: unknown) => tool.execute({ name: "update_task_context", arguments: JSON.stringify(args),
    conversationId: lead.id, runId: run.runId, toolCallId: randomUUID(), changed: vi.fn(),
    post: input => database.collaboration.postMessage(input, lead.id) });
  const source = { kind: "conversation", containerId: lead.id, messageId: run.userMessage.id, purpose: "request" };
  expect(await execute({ title: "D", goal: "完成 D", source })).toMatchObject({ isError: false });
  const first = database.collaboration.listTasks({ conversationId: lead.id }).items[0]!;
  expect(database.collaboration.getTask(first.id).sources.map(item => item.messageId)).toEqual([run.userMessage.id]);
  expect(await execute({ title: "E", goal: "完成 E", source: { ...source, messageId: second.id } })).toMatchObject({ isError: false });
  expect(await execute({ id: first.id, expectedRevision: first.revision, title: "D", goal: "完成 D", status: "completed", ...(explicit ? { source } : {}) })).toMatchObject({ isError: false });
  const tasks = database.collaboration.listTasks({ conversationId: lead.id });
  expect(tasks.total).toBe(2);
  expect(tasks.items.find(task => task.id === first.id)).toMatchObject({ completionRequested: true });
  expect(database.collaboration.getTask(first.id).sources.map(item => item.messageId)).toEqual([run.userMessage.id]);
  expect(database.collaboration.getTask(tasks.items.find(task => task.id !== first.id)!.id).sources.map(item => item.messageId)).toEqual([second.id]);
});

it("searches already-read history on explicit filters and still validates the full date range", async () => {
  const { database, instance, lead, tool } = fixture();
  const message = database.collaboration.postMessage({ teamInstanceId: instance.id, content: "已读的 HTML 交付", intent: "notify", requestId: randomUUID() }, null);
  database.collaboration.markRead({ teamInstanceId: instance.id, throughSequence: message.sequence }, lead.id);
  const execute = (args: unknown) => tool.execute({ name: "read_team_messages", arguments: JSON.stringify(args), conversationId: lead.id,
    runId: randomUUID(), toolCallId: randomUUID(), changed: vi.fn(), post: input => database.collaboration.postMessage(input, lead.id) });
  const result = await execute({ query: "html" });
  expect(result).toMatchObject({ kind: "completed", isError: false });
  if (result.kind !== "completed") throw new Error("Expected history results.");
  const response = z.object({ value: z.object({ messages: z.array(z.object({ id: z.string() })) }) }).parse(JSON.parse(result.content));
  expect(response.value.messages.map(item => item.id)).toEqual([message.id]);
  expect(await execute({ createdAfter: "2026-10-20T00:00:00.000Z", createdBefore: "2026-10-01T00:00:00.000Z" })).toMatchObject({ kind: "completed", isError: true });
});
