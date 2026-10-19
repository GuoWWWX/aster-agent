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

it("updates several persistent tasks in one call with one change notification", async () => {
  const { database, lead, tool } = fixture();
  const run = database.createRunWithUserMessage(lead.id, "完成两项独立验收", "fixture");
  const changed = vi.fn();
  const execute = (updates: unknown[]) => tool.execute({ name: "update_task_context", arguments: JSON.stringify({ updates }),
    conversationId: lead.id, runId: run.runId, toolCallId: randomUUID(), changed, post: vi.fn() });
  const created = await execute([{ title: "目标 A", goal: "验证 A" }, { title: "目标 B", goal: "验证 B" }]);
  expect(created).toMatchObject({ isError: false });
  expect(changed).toHaveBeenCalledOnce();
  const tasks = database.collaboration.runTasks(run.runId);
  expect(tasks).toHaveLength(2);
  changed.mockClear();
  const completed = await execute(tasks.map(task => ({ id: task.id, expectedRevision: task.revision,
    title: task.title, goal: task.goal, summary: "验证通过", decisions: "保留原产物", nextStep: "等待用户确认", status: "completed" })));
  expect(completed).toMatchObject({ isError: false });
  if (completed.kind !== "completed") throw new Error("Expected completion");
  expect(JSON.parse(completed.content)).toMatchObject({ value: { tasks: [
    { revision: 2, summary: "验证通过", completionRequested: true }, { revision: 2, summary: "验证通过", completionRequested: true },
  ] } });
  expect(changed).toHaveBeenCalledOnce();
});

it("rolls back all task changes and bindings when a later batch entry fails", async () => {
  const { database, lead, tool } = fixture();
  const task = database.collaboration.updateTask({ conversationId: lead.id, title: "原目标", goal: "保持修订", requestId: randomUUID() });
  const runId = randomUUID(), toolCallId = randomUUID(), changed = vi.fn();
  const updates = [{ title: "新目标", goal: "不能部分创建" },
    { id: task.id, expectedRevision: task.revision + 1, title: task.title, goal: task.goal, summary: "不能部分更新" }];
  const execute = () => tool.execute({ name: "update_task_context", arguments: JSON.stringify({ updates }),
    conversationId: lead.id, runId, toolCallId, changed, post: vi.fn() });
  expect(await execute()).toMatchObject({ isError: true });
  expect(database.collaboration.listTasks({ conversationId: lead.id }).total).toBe(1);
  expect(database.collaboration.getTask(task.id).task.revision).toBe(1);
  expect(database.collaboration.runTasks(runId)).toHaveLength(0);
  expect(changed).not.toHaveBeenCalled();
  updates[1]!.expectedRevision = task.revision;
  expect(await execute()).toMatchObject({ isError: false });
  expect(database.collaboration.runTasks(runId)).toHaveLength(2);
  expect(changed).toHaveBeenCalledOnce();
});

it("replays a batch idempotently and preserves each earlier task's original source", async () => {
  const { database, lead, tool } = fixture();
  const first = database.createRunWithUserMessage(lead.id, "目标 A", "fixture");
  database.finishRun(first.runId, "completed", null);
  const second = database.createRunWithUserMessage(lead.id, "目标 B", "fixture");
  database.finishRun(second.runId, "completed", null);
  const tasks = [first, second].map((run, index) => database.collaboration.updateTask({ conversationId: lead.id,
    requestId: randomUUID(), title: `目标 ${index}`, goal: `完成 ${index}`, source: { kind: "conversation", containerId: lead.id,
      messageId: run.userMessage.id, runId: run.runId, purpose: "request" } }));
  const current = database.createRunWithUserMessage(lead.id, "另一项独立输入", "fixture");
  const updates = tasks.map(task => ({ id: task.id, expectedRevision: task.revision, title: task.title, goal: task.goal, summary: "成员验证已通过" }));
  const input = { name: "update_task_context", arguments: JSON.stringify({ updates }), conversationId: lead.id,
    runId: current.runId, toolCallId: randomUUID(), changed: vi.fn(), post: vi.fn() };
  const result = await tool.execute(input);
  expect(result).toMatchObject({ isError: false });
  expect(await tool.execute(input)).toEqual(result);
  tasks.forEach((task, index) => {
    const detail = database.collaboration.getTask(task.id);
    expect(detail.task.revision).toBe(2);
    expect(detail.sources.map(source => source.messageId)).toEqual([[first, second][index]!.userMessage.id]);
  });
});

it("does not attach unrelated group inputs to every existing task in a batch", async () => {
  const { database, instance, lead, tool } = fixture();
  const tasks = ["A", "B"].map(title => database.collaboration.updateTask({ conversationId: lead.id,
    requestId: randomUUID(), title, goal: `完成 ${title}` }));
  const run = database.createRunWithUserMessage(lead.id, "汇总现有任务状态", "fixture");
  const message = database.collaboration.postMessage({ teamInstanceId: instance.id, content: "另一项独立请求",
    recipientConversationIds: [lead.id], requestId: randomUUID() }, null);
  database.collaboration.consumeDelivery(message.deliveries[0]!.id, run.runId);
  const result = await tool.execute({ name: "update_task_context", arguments: JSON.stringify({ updates: tasks.map(task => ({
    id: task.id, expectedRevision: task.revision, title: task.title, goal: task.goal, summary: "已有验证结果",
  })) }), conversationId: lead.id, runId: run.runId, toolCallId: randomUUID(), changed: vi.fn(), post: vi.fn() });
  expect(result).toMatchObject({ isError: false });
  for (const task of tasks) expect(database.collaboration.getTask(task.id).sources).toEqual([]);
});

it.each([0, 21])("rejects a batch of %i tasks before changing any records", async count => {
  const { database, lead, tool } = fixture();
  const definition = tool.definitions(false).find(item => item.name === "update_task_context")!;
  expect(definition.parameters.required).toContain("updates");
  const changed = vi.fn();
  const result = await tool.execute({ name: definition.name, arguments: JSON.stringify({ updates: Array.from({ length: count },
    (_, index) => ({ title: `目标 ${index}`, goal: "不应保存" })) }), conversationId: lead.id,
    runId: randomUUID(), toolCallId: randomUUID(), changed, post: vi.fn() });
  expect(result).toMatchObject({ isError: true });
  expect(database.collaboration.listTasks({ conversationId: lead.id }).total).toBe(0);
  expect(changed).not.toHaveBeenCalled();
});

it("rejects duplicate task IDs in a batch and reports a bad source at its batch index", async () => {
  const { database, lead, tool } = fixture();
  const task = database.collaboration.updateTask({ conversationId: lead.id, title: "原任务", goal: "保持完整", requestId: randomUUID() });
  const changed = vi.fn();
  const execute = (updates: unknown[]) => tool.execute({ name: "update_task_context", arguments: JSON.stringify({ updates }),
    conversationId: lead.id, runId: randomUUID(), toolCallId: randomUUID(), changed, post: vi.fn() });
  const update = { id: task.id, expectedRevision: task.revision, title: task.title, goal: task.goal, summary: "不能重复写" };
  expect(await execute([update, update])).toMatchObject({ isError: true });
  const result = await execute([{ title: "新目标", goal: "不能留下半个批次" }, { title: "坏来源", goal: "应回滚", source: {
    kind: "conversation", containerId: lead.id, messageId: randomUUID(), purpose: "request",
  } }]);
  expect(result).toMatchObject({ isError: true });
  if (result.kind !== "completed") throw new Error("Expected validation failure");
  expect(JSON.parse(result.content)).toMatchObject({ recovery: { issues: [{ path: ["updates", 1, "source", "messageId"] }] } });
  expect(database.collaboration.listTasks({ conversationId: lead.id }).total).toBe(1);
  expect(database.collaboration.getTask(task.id).task.revision).toBe(1);
  expect(changed).not.toHaveBeenCalled();
});

it("does not create revisions for identical persistent task updates, including pending confirmation", async () => {
  const { database, lead, tool } = fixture();
  const runId = randomUUID();
  const execute = (updates: unknown[]) => tool.execute({ name: "update_task_context", arguments: JSON.stringify({ updates }),
    conversationId: lead.id, runId, toolCallId: randomUUID(), changed: vi.fn(), post: vi.fn() });
  await execute([{ title: "最终结果", goal: "已有完整结果", summary: "通过", status: "completed" }]);
  const task = database.collaboration.runTasks(runId)[0]!;
  expect(task).toMatchObject({ revision: 1, completionRequested: true });
  const update = { id: task.id, expectedRevision: task.revision, title: task.title, goal: task.goal, summary: task.summary, status: "completed" };
  expect(await execute([update])).toMatchObject({ isError: false });
  expect(database.collaboration.getTask(task.id).task).toMatchObject({ revision: 1, completionRequested: true });
});

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

it("bounds task discovery by default, preserves paging and keeps full records available on demand", async () => {
  const { database, lead, tool } = fixture();
  for (let index = 0; index < 7; index++) database.collaboration.updateTask({ conversationId: lead.id,
    title: `Goal ${index}`, goal: "g".repeat(4000), summary: "s".repeat(4000), decisions: "d".repeat(4000),
    nextStep: "n".repeat(2000), requestId: randomUUID() });
  const execute = (name: string, args: unknown) => tool.execute({ name, arguments: JSON.stringify(args), conversationId: lead.id,
    runId: randomUUID(), toolCallId: randomUUID(), changed: vi.fn(), post: vi.fn() });
  const result = await execute("list_task_contexts", {});
  if (result.kind !== "completed") throw new Error("Expected list result");
  const pageSchema = z.object({ value: z.object({ items: z.array(z.object({ id: z.string(), revision: z.number(), excerpted: z.boolean() }).passthrough()),
    total: z.number(), nextBeforeId: z.string().nullable() }) });
  const page = pageSchema.parse(JSON.parse(result.content)).value;
  expect(page.items).toHaveLength(5);
  expect(page.total).toBe(7);
  expect(result.content.length).toBeLessThan(7000);
  expect(page.items[0]).not.toHaveProperty("decisions");
  expect(page.items[0]).not.toHaveProperty("createdAt");
  expect(page.items[0]).toMatchObject({ revision: 1, excerpted: true });
  const next = await execute("list_task_contexts", { beforeId: page.nextBeforeId });
  if (next.kind !== "completed") throw new Error("Expected next page");
  expect(pageSchema.parse(JSON.parse(next.content)).value.items).toHaveLength(2);
  const task = page.items[0];
  if (task === undefined) throw new Error("Expected first task");
  const detail = await execute("get_task_context", { id: task.id });
  if (detail.kind !== "completed") throw new Error("Expected detail");
  expect(z.object({ value: z.object({ task: z.object({ decisions: z.string() }) }) }).parse(JSON.parse(detail.content)).value.task.decisions).toBe("d".repeat(4000));
});

it("acknowledges batched updates without echoing full submitted task descriptions", async () => {
  const { database, lead, tool } = fixture();
  const result = await tool.execute({ name: "update_task_context", arguments: JSON.stringify({ updates: [{
    title: "Bounded receipt", goal: "g".repeat(4000), summary: "s".repeat(4000), decisions: "d".repeat(4000), nextStep: "n".repeat(2000),
  }] }), conversationId: lead.id, runId: randomUUID(), toolCallId: randomUUID(), changed: vi.fn(), post: vi.fn() });
  if (result.kind !== "completed") throw new Error("Expected receipt");
  expect(result.isError).toBe(false);
  expect(result.content.length).toBeLessThan(800);
  const receipt = z.object({ value: z.object({ tasks: z.array(z.object({ id: z.string(), revision: z.number() })) }) }).parse(JSON.parse(result.content));
  const task = receipt.value.tasks[0];
  if (task === undefined) throw new Error("Expected task reference");
  expect(task.revision).toBe(1);
  expect(database.collaboration.getTask(task.id).task.summary).toBe("s".repeat(4000));
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

it.each(["id", "expectedRevision"] as const)("rejects an incomplete task update missing %s without creating or changing a record", async missing => {
  const { database, lead, tool } = fixture();
  const run = database.createRunWithUserMessage(lead.id, "制定验收清单", "fixture");
  const task = database.collaboration.updateTask({ conversationId: lead.id, requestId: randomUUID(), title: "验收清单", goal: "制定验收清单" });
  const changed = vi.fn();
  const execute = (args: unknown) => tool.execute({ name: "update_task_context", arguments: JSON.stringify(args), conversationId: lead.id,
    runId: run.runId, toolCallId: randomUUID(), changed, post: vi.fn() });
  const update = { title: task.title, goal: task.goal, status: "completed" };
  const result = await execute({ ...update, ...(missing === "id" ? { expectedRevision: task.revision } : { id: task.id }) });
  if (result.kind !== "completed") throw new Error("Expected a validation result.");
  expect(result.isError).toBe(true);
  expect(JSON.parse(result.content)).toMatchObject({ recovery: { action: "fix_arguments", issues: [{ path: [missing] }] } });
  expect(database.collaboration.listTasks({ conversationId: lead.id }).total).toBe(1);
  expect(database.collaboration.getTask(task.id).task.revision).toBe(1);
  expect(changed).not.toHaveBeenCalled();
  expect(await execute({ ...update, id: task.id, expectedRevision: task.revision })).toMatchObject({ isError: false });
  expect(database.collaboration.listTasks({ conversationId: lead.id }).total).toBe(1);
  expect(database.collaboration.getTask(task.id).task.revision).toBe(2);
});

it.each(["conversation", "message"] as const)("explains an unavailable task source %s and permits a corrected retry without duplicating the task", async missing => {
  const { database, lead, tool } = fixture();
  const run = database.createRunWithUserMessage(lead.id, "计算 13+24", "fixture");
  const changed = vi.fn();
  const execute = (args: unknown) => tool.execute({ name: "update_task_context", arguments: JSON.stringify(args), conversationId: lead.id,
    runId: run.runId, toolCallId: randomUUID(), changed, post: vi.fn() });
  const args = { title: "简单计算", goal: "计算 13+24", source: { kind: "conversation", containerId: missing === "conversation"
    ? "ffffffff-ffff-ffff-ffff-ffffffffffff" : lead.id, messageId: "00000000-0000-0000-0000-000000000000", purpose: "request" } };
  const result = await execute(args);
  expect(result).toMatchObject({ kind: "completed", isError: true });
  if (result.kind !== "completed") throw new Error("Expected a validation result.");
  expect(JSON.parse(result.content)).toMatchObject({ recovery: { action: "fix_arguments", issues: [{
    path: ["source", missing === "conversation" ? "containerId" : "messageId"],
  }] } });
  expect(result.content).toContain("omit source");
  expect(changed).not.toHaveBeenCalled();
  expect(database.collaboration.listTasks({ conversationId: lead.id }).total).toBe(0);
  expect(await execute({ title: args.title, goal: args.goal })).toMatchObject({ isError: false });
  const tasks = database.collaboration.listTasks({ conversationId: lead.id }); expect(tasks.total).toBe(1);
  expect(database.collaboration.getTask(tasks.items[0]!.id).sources).toEqual([expect.objectContaining({
    containerId: lead.id, messageId: run.userMessage.id, runId: run.runId,
  })]);
  expect(changed).toHaveBeenCalledTimes(1);
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
