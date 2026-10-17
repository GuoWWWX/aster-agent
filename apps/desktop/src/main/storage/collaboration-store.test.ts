import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { AgentDatabase } from "./agent-database.js";

const opened: AgentDatabase[] = [];
const roots: string[] = [];
function fixture(file = ":memory:") {
  const db = new AgentDatabase(file); opened.push(db);
  db.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  const instance = db.createTeamInstance({ teamId: "default-team", scope: "global" });
  const lead = db.createConversation(null, { teamId: instance.teamId, threadKind: "team_lead" });
  db.bindTeamExecutionConversation({ conversationId: lead.id, teamId: instance.teamId,
    teamInstanceId: instance.id, projectId: null, sourceConversationId: null });
  db.setTeamInstanceRoot(instance.id, lead.id);
  const member = db.createConversation(null, { teamId: instance.teamId, threadKind: "agent", parentConversationId: lead.id,
    agent: { id: "developer", name: "开发", role: "开发", instructions: "", isDefault: false } });
  db.bindTeamMemberConversation({ conversationId: member.id, teamExecutionConversationId: lead.id, agentId: "developer" });
  return { db, instance, lead, member };
}
afterEach(() => { for (const db of opened.splice(0)) if (db.isOpen()) db.close(); for (const root of roots.splice(0)) rmSync(root, { force: true, recursive: true }); });
function namedFixture() {
  const state = fixture();
  state.db.bindConversationAgent(state.member.id, { ...state.db.getConversationAgentBinding(state.member.id)!, name: "需求分析师" });
  const architect = state.db.createConversation(null, { teamId: state.instance.teamId, threadKind: "agent", parentConversationId: state.lead.id,
    agent: { id: "architect", name: "架构师", role: "架构", instructions: "", isDefault: false } });
  state.db.bindTeamMemberConversation({ conversationId: architect.id, teamExecutionConversationId: state.lead.id, agentId: "architect" });
  return { ...state, architect };
}

describe("natural group addressing", () => {
  it("delivers the original member's published file without changing file ownership on forwarding", () => {
    const { db, instance, lead, member } = namedFixture();
    const source = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "已完成页面", fileReferences: [{ path: "out/card.html" }], intent: "notify", requestId: randomUUID() }, member.id);
    const first = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "实现与独立验证已通过，现交付。", intent: "notify",
      fileReferences: [{ sourceMessageId: source.id, path: "out/card.html" }], requestId: randomUUID() }, lead.id);
    expect(first.fileReferences).toEqual([{ sourceMessageId: source.id, path: "out/card.html", conversationId: member.id }]);
    expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).messages.find(message => message.id === first.id)?.fileReferences).toEqual(first.fileReferences);
    const forwarded = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "继续引用原成果", intent: "notify",
      fileReferences: [{ sourceMessageId: first.id, path: "out/card.html" }], requestId: randomUUID() }, lead.id);
    expect(forwarded.fileReferences?.[0]?.conversationId).toBe(member.id);
    expect(() => db.collaboration.postMessage({ teamInstanceId: instance.id, content: "private", fileReferences: [{ sourceMessageId: source.id, path: "private.txt" }], requestId: randomUUID() }, lead.id)).toThrow("文件尚未");
    const other = db.createTeamInstance({ teamId: instance.teamId, scope: "global" });
    expect(() => db.collaboration.postMessage({ teamInstanceId: other.id, content: "cross room", fileReferences: [{ sourceMessageId: source.id, path: "out/card.html" }], requestId: randomUUID() }, null)).toThrow("成果来源不属于当前群");
  });
  it("searches canonical message text by keyword, sender and date without marking history read", () => {
    const { db, instance, member } = namedFixture();
    db.collaboration.postMessage({ teamInstanceId: instance.id, content: "用户 HTML 说明", intent: "notify", requestId: randomUUID() }, null);
    const result = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "已交付 Html 页面", intent: "notify", requestId: randomUUID() }, member.id);
    const page = db.collaboration.readMessages({ teamInstanceId: instance.id, query: "html", senderConversationId: member.id });
    expect(page.messages.map(message => message.id)).toEqual([result.id]); expect(page.userReadSequence).toBe(0);
    expect(db.collaboration.readMessages({ teamInstanceId: instance.id, query: "HTML", senderConversationId: null }).messages).toHaveLength(1);
    expect(db.collaboration.readMessages({ teamInstanceId: instance.id, createdBefore: "2000-01-01T00:00:00.000Z" }).messages).toEqual([]);
  });
  it("bounds each keyword scan and keeps a cursor even when that batch has no matches", () => {
    const { db, instance } = namedFixture();
    const first = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "很早的目标内容", intent: "notify", requestId: randomUUID() }, null);
    for (let i = 0; i < 101; i++) db.collaboration.postMessage({ teamInstanceId: instance.id, content: "其他聊天", intent: "notify", requestId: randomUUID() }, null);
    const page = db.collaboration.readMessages({ teamInstanceId: instance.id, query: "目标" });
    expect(page.messages).toEqual([]); expect(page.nextBeforeSequence).not.toBeNull();
    expect(db.collaboration.readMessages({ teamInstanceId: instance.id, query: "目标", beforeSequence: page.nextBeforeSequence! }).messages.map(message => message.id)).toEqual([first.id]);
  });
  it("paginates matching history without duplicates and treats search metacharacters literally", () => {
    const { db, instance } = namedFixture();
    for (let i = 0; i < 4; i++) db.collaboration.postMessage({ teamInstanceId: instance.id, content: `目标 ${i} %_`, intent: "notify", requestId: randomUUID() }, null);
    const page = db.collaboration.readMessages({ teamInstanceId: instance.id, query: "%_", limit: 2 });
    expect(page.messages.map(message => message.sequence)).toEqual([3, 4]); expect(page.nextBeforeSequence).toBe(3);
    const next = db.collaboration.readMessages({ teamInstanceId: instance.id, query: "%_", limit: 2, beforeSequence: page.nextBeforeSequence! });
    expect(next.messages.map(message => message.sequence)).toEqual([1, 2]); expect(next.nextBeforeSequence).toBeNull();
  });
  it("routes a quoted member reply to its author and adds explicitly mentioned recipients", () => {
    const { db, instance, lead, member, architect } = namedFixture();
    const original = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "需求已梳理", intent: "notify", requestId: randomUUID() }, member.id);
    const reply = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "请继续细化", replyToId: original.id, requestId: randomUUID(),
      coordinator: { agentId: "default-agent", modelSelection: null } }, null);
    expect(reply.recipientConversationIds).toEqual([member.id]); expect(reply.coordinator?.status).toBe("completed");
    const extra = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "@架构师 一起核对", replyToId: original.id,
      recipientConversationIds: [architect.id], requestId: randomUUID() }, null);
    expect(new Set(extra.recipientConversationIds)).toEqual(new Set([member.id, architect.id]));
    expect(extra.recipientConversationIds).not.toContain(lead.id);
  });
  it.each(["需求分析师你好", "需求分析师，你好", "@需求分析师 你好", "请需求分析师帮我看看", "你好，需求分析师", "需求分析师"])("delivers %s only to the addressed member", content => {
    const { db, instance, member } = namedFixture();
    const message = db.collaboration.postMessage({ teamInstanceId: instance.id, content, requestId: randomUUID() }, null);
    expect(message.recipientConversationIds).toEqual([member.id]);
    expect(message.deliveries.map(delivery => delivery.conversationId)).toEqual([member.id]);
  });
  it.each(["需求分析师和架构师，各提一个想法", "@需求分析师 @架构师 你好"])("delivers %s to both addressed members", content => {
    const { db, instance, member, architect } = namedFixture();
    const message = db.collaboration.postMessage({ teamInstanceId: instance.id, content, requestId: randomUUID() }, null);
    expect(message.recipientConversationIds).toEqual([member.id, architect.id]);
  });
  it.each(["你们好", "需求分析师的职责是什么", "我刚才问了需求分析师", "“需求分析师你好”这句话怎么说", "请负责人安排需求分析师回答", "需求分析师和架构师的职责是什么", "@需求分析师助手 你好", "请需求分析师助手帮我看看"])("leaves %s with the lead rather than treating a name mention as an address", content => {
    const { db, instance, lead } = namedFixture();
    const message = db.collaboration.postMessage({ teamInstanceId: instance.id, content, requestId: randomUUID() }, null);
    expect(message.recipientConversationIds).toEqual([lead.id]);
  });
  it("keeps structured recipients and explicit broadcasts authoritative", () => {
    const { db, instance, lead, member, architect } = namedFixture();
    const post = { teamInstanceId: instance.id, content: "需求分析师你好" };
    expect(db.collaboration.postMessage({ ...post, requestId: randomUUID(), recipientConversationIds: [architect.id] }, null).recipientConversationIds).toEqual([architect.id]);
    expect(db.collaboration.postMessage({ ...post, requestId: randomUUID(), allMembers: true }, null).recipientConversationIds.sort()).toEqual([lead.id, member.id, architect.id].sort());
  });
  it("matches the complete longer name and treats name punctuation literally", () => {
    const { db, instance, architect } = namedFixture();
    const binding = db.getConversationAgentBinding(architect.id)!;
    db.bindConversationAgent(architect.id, { ...binding, name: "需求分析师助手" });
    expect(db.collaboration.postMessage({ teamInstanceId: instance.id, content: "需求分析师助手你好", requestId: randomUUID() }, null).recipientConversationIds).toEqual([architect.id]);
    db.bindConversationAgent(architect.id, { ...binding, name: "QA(1)+" });
    expect(db.collaboration.postMessage({ teamInstanceId: instance.id, content: "QA(1)+你好", requestId: randomUUID() }, null).recipientConversationIds).toEqual([architect.id]);
    db.bindConversationAgent(architect.id, { ...binding, name: "请问" });
    expect(db.collaboration.postMessage({ teamInstanceId: instance.id, content: "请问你好", requestId: randomUUID() }, null).recipientConversationIds).toEqual([architect.id]);
    expect(db.collaboration.postMessage({ teamInstanceId: instance.id, content: "你好，请问你好", requestId: randomUUID() }, null).recipientConversationIds).toEqual([architect.id]);
  });
  it("does not turn notifications or a member's plain text into new requests", () => {
    const { db, instance, lead } = namedFixture();
    const post = { teamInstanceId: instance.id, content: "需求分析师你好" };
    expect(db.collaboration.postMessage({ ...post, requestId: randomUUID(), intent: "notify" }, null).deliveries).toEqual([]);
    expect(db.collaboration.postMessage({ ...post, requestId: randomUUID(), intent: "request" }, lead.id).deliveries).toEqual([]);
  });
  it("returns the saved recipient on an idempotent retry after a member is renamed", () => {
    const { db, instance, member } = namedFixture();
    const post = { teamInstanceId: instance.id, content: "需求分析师你好", requestId: randomUUID() };
    const original = db.collaboration.postMessage(post, null);
    db.bindConversationAgent(member.id, { ...db.getConversationAgentBinding(member.id)!, name: "分析同学" });
    expect(db.collaboration.postMessage(post, null)).toEqual(original);
    expect(original.recipientConversationIds).toEqual([member.id]);
  });
  it("does not guess between members with the same name or wake an archived member", () => {
    const { db, instance, lead, member, architect } = namedFixture();
    db.bindConversationAgent(architect.id, { ...db.getConversationAgentBinding(architect.id)!, name: "需求分析师" });
    expect(db.collaboration.postMessage({ teamInstanceId: instance.id, content: "需求分析师你好", requestId: randomUUID() }, null).recipientConversationIds).toEqual([lead.id]);
    db.setConversationArchived(architect.id, true); db.setConversationArchived(member.id, true);
    expect(db.collaboration.postMessage({ teamInstanceId: instance.id, content: "需求分析师你好", requestId: randomUUID() }, null).recipientConversationIds).toEqual([lead.id]);
  });
});

describe("durable collaboration", () => {
  it("recovers a durable post and coordination after a SQL projection failure, without duplicate messages or deliveries", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agent-group-journal-failure-")); roots.push(root);
    const file = path.join(root, "state.sqlite"); const { db, instance, member } = fixture(file);
    const sql = new DatabaseSync(file);
    try {
      const input = { teamInstanceId: instance.id, content: "持久原文", requestId: randomUUID(), coordinator: { agentId: "default-agent", modelSelection: null } };
      sql.exec("CREATE TRIGGER fail_group_post BEFORE INSERT ON team_chat_messages BEGIN SELECT RAISE(ABORT, 'injected post failure'); END");
      expect(() => db.collaboration.postMessage(input, null)).toThrow("injected post failure");
      sql.exec("DROP TRIGGER fail_group_post");
      const intervening = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "在恢复前收到的新消息", intent: "notify", requestId: randomUUID() }, null);
      const message = db.collaboration.postMessage(input, null);
      expect(intervening.sequence).toBe(message.sequence + 1);
      expect(db.collaboration.postMessage(input, null).id).toBe(message.id);
      sql.exec("CREATE TRIGGER fail_group_delivery BEFORE INSERT ON team_chat_deliveries BEGIN SELECT RAISE(ABORT, 'injected delivery failure'); END");
      expect(() => db.collaboration.finishCoordination(message.id, [member.id], null, "需要开发确认")).toThrow("injected delivery failure");
      sql.exec("DROP TRIGGER fail_group_delivery");
      const page = db.collaboration.readMessages({ teamInstanceId: instance.id });
      expect(page.messages).toHaveLength(2); expect(page.messages[0]?.deliveries).toHaveLength(1);
      expect(page.messages[0]?.coordinator?.contextSummary).toBe("需要开发确认");
      const metadata = String(sql.prepare("SELECT payload_json FROM team_chat_messages WHERE id = ?").get(message.id)?.payload_json);
      expect(metadata).not.toContain("持久原文"); expect(metadata).not.toContain("需要开发确认");
      expect(String(sql.prepare("SELECT fingerprint FROM collaboration_requests WHERE result_id = ?").get(message.id)?.fingerprint)).toMatch(/^[a-f0-9]{64}$/u);
    } finally { sql.close(); }
  });
  it("retains old evidence when the user edits the latest completed message and does not reuse its deliveries", () => {
    const { db, instance, lead, member } = fixture();
    const original = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "最初的问题", recipientConversationIds: [member.id], requestId: randomUUID() }, null);
    const run = db.createRunWithUserMessage(member.id, "原问题", "fixture");
    db.collaboration.consumeDelivery(original.deliveries[0]!.id, run.runId);
    expect(() => db.collaboration.postMessage({ teamInstanceId: instance.id, content: "修订的问题", supersedesId: original.id, requestId: randomUUID() }, null)).toThrow("GROUP_EDIT_BUSY");
    db.collaboration.finishRun(run.runId, "completed", null);
    const edited = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "修订的问题", supersedesId: original.id, recipientConversationIds: [member.id], requestId: randomUUID() }, null);
    expect(edited.supersedesId).toBe(original.id); expect(edited.deliveries[0]?.id).not.toBe(original.deliveries[0]?.id);
    expect(db.collaboration.message(original.id).content).toBe("最初的问题");
    expect(db.collaboration.message(original.id).deliveries[0]?.status).toBe("completed");
    expect(() => db.collaboration.postMessage({ teamInstanceId: instance.id, content: "再次修订旧消息", supersedesId: original.id, requestId: randomUUID() }, null)).toThrow("GROUP_EDIT_INVALID");
    expect(() => db.collaboration.postMessage({ teamInstanceId: instance.id, content: "成员不能编辑用户消息", supersedesId: edited.id, requestId: randomUUID() }, lead.id)).toThrow("GROUP_EDIT_INVALID");
  });

  it("recovers saved requests without replaying completed work and requires explicit resume for pending delivery", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "agent-group-recovery-")); roots.push(root);
    const file = path.join(root, "state.sqlite"); const { db, lead, instance, member } = fixture(file);
    const post = { teamInstanceId: instance.id, content: "saved request", requestId: randomUUID() };
    const pending = db.collaboration.postMessage(post, null);
    const processing = db.collaboration.postMessage({ ...post, requestId: randomUUID(), recipientConversationIds: [member.id] }, lead.id);
    const run = db.createRunWithUserMessage(member.id, "delivered input", "fixture");
    db.collaboration.consumeDelivery(processing.deliveries[0]!.id, run.runId, run.userMessage.id);
    db.finishRun(run.runId, "completed", null); db.close();
    const reopened = new AgentDatabase(file); opened.push(reopened);
    reopened.collaboration.recoverDeliveries(); reopened.collaboration.recoverDeliveries();
    expect(reopened.collaboration.postMessage(post, null).id).toBe(pending.id);
    expect(reopened.collaboration.pendingDeliveries()).toHaveLength(0);
    expect(reopened.collaboration.message(processing.id).deliveries[0]?.status).toBe("completed");
    expect(reopened.collaboration.receiptsToRecover()).toEqual(expect.arrayContaining([expect.objectContaining({ id: processing.deliveries[0]!.id })]));
    reopened.collaboration.receiptRecorded(processing.deliveries[0]!.id);
    expect(reopened.collaboration.receiptsToRecover().some(item => item.id === processing.deliveries[0]!.id)).toBe(false);
    reopened.collaboration.resumeDelivery(pending.deliveries[0]!.id);
    expect(reopened.collaboration.pendingDeliveries().map(item => item.id)).toEqual([pending.deliveries[0]!.id]);
    expect(reopened.listTimeline(member.id)).toHaveLength(1);
  });
  it("paginates every source, preserves merged evidence and shows unclassified requests", () => {
    const { db, lead } = fixture();
    const task = db.collaboration.updateTask({ conversationId: lead.id, title: "goal", goal: "verify", requestId: randomUUID() });
    for (let index = 0; index < 23; index++) {
      const run = db.createRunWithUserMessage(lead.id, `evidence ${index}`, "fixture");
      db.finishRun(run.runId, "completed", null);
      db.collaboration.linkTask({ id: task.id, source: { kind: "conversation", containerId: lead.id, messageId: run.userMessage.id, runId: run.runId } });
    }
    const first = db.collaboration.getTask(task.id); const second = db.collaboration.getTask(task.id, { beforeSourceSequence: first.nextBeforeSourceSequence! });
    expect(first.sources).toHaveLength(20); expect(second.sources).toHaveLength(3); expect(second.nextBeforeSourceSequence).toBeNull();
    expect(db.collaboration.listTasks({ conversationId: lead.id }).unclassified).toEqual([]);
    const newRun = db.createRunWithUserMessage(lead.id, "new objective", "fixture");
    expect(db.collaboration.listTasks({ conversationId: lead.id }).unclassified[0]?.messageId).toBe(newRun.userMessage.id);
    const target = db.collaboration.updateTask({ conversationId: lead.id, title: "same goal", goal: "verify", requestId: randomUUID() });
    db.collaboration.bindTask(newRun.runId, task.id, lead.id);
    db.collaboration.mergeTasks({ id: task.id, intoId: target.id, expectedRevision: task.revision });
    expect(db.collaboration.runTasks(newRun.runId)[0]?.id).toBe(target.id);
    expect(db.collaboration.getTask(task.id).task.mergedIntoId).toBe(target.id);
    expect(db.collaboration.getTask(target.id).sources).toHaveLength(20);
    expect(db.collaboration.listTasks({ conversationId: lead.id }).items.map(item => item.id)).toEqual([target.id]);
  });
  it("retains causal limits across new Runs and cancels pending requests when a room is deleted", () => {
    const { db, lead, member, instance } = fixture();
    let message = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "start", requestId: randomUUID() }, null);
    for (let depth = 1; depth <= 5; depth++) {
      const sender = depth % 2 ? lead : member; const recipient = depth % 2 ? member : lead;
      message = db.collaboration.postMessage({ teamInstanceId: instance.id, content: `step ${depth}`, requestId: randomUUID(), replyToId: message.id, recipientConversationIds: [recipient.id] }, sender.id, randomUUID());
      expect(message.depth).toBe(depth);
    }
    expect(message.deliveries[0]?.status).toBe("failed");
    db.deleteTeamInstance(instance.id);
    expect(db.collaboration.pendingDeliveries()).toEqual([]);
  });
  it("permits bounded implementation and review handoffs for an explicit task beyond the casual-chat depth", () => {
    const { db, lead, member, instance } = fixture();
    const task = db.collaboration.updateTask({ conversationId: lead.id, title: "快速排序验收", goal: "实现、复测和交付", requestId: randomUUID() });
    let message = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "start", taskContextId: task.id, requestId: randomUUID() }, null);
    for (let depth = 1; depth <= 13; depth++) {
      const sender = depth % 2 ? lead : member; const recipient = depth % 2 ? member : lead;
      message = db.collaboration.postMessage({ teamInstanceId: instance.id, content: `handoff ${depth}`, requestId: randomUUID(), replyToId: message.id, recipientConversationIds: [recipient.id] }, sender.id, randomUUID());
      expect(message.taskContextId).toBe(task.id); expect(message.deliveries[0]?.status).toBe(depth <= 12 ? "pending" : "failed");
    }
  });
  it("reuses a task across conversations, rejects stale summaries, and keeps source references after the checklist closes", () => {
    const { db, lead, member } = fixture();
    const run = db.createRunWithUserMessage(lead.id, "Fix overlap", "test-model");
    const input = { conversationId: lead.id, title: "Fix overlap", goal: "No overlap", requestId: randomUUID(),
      source: { kind: "conversation" as const, containerId: lead.id, messageId: run.userMessage.id } };
    const task = db.collaboration.updateTask(input);
    expect(db.collaboration.updateTask(input).id).toBe(task.id);
    const other = db.createRunWithUserMessage(member.id, "Verify overlap", "test-model");
    db.collaboration.linkTask({ id: task.id, source: { kind: "conversation", containerId: member.id, messageId: other.userMessage.id } });
    expect(db.collaboration.listTasks({ conversationId: member.id }).items.map(item => item.id)).toEqual([task.id]);
    const updated = db.collaboration.updateTask({ ...input, id: task.id, expectedRevision: 1, summary: "Fixed", requestId: randomUUID() });
    expect(updated.revision).toBe(2);
    expect(() => db.collaboration.updateTask({ ...input, id: task.id, expectedRevision: 1, requestId: randomUUID() })).toThrow(/revision/i);
    db.createTaskList(lead.id, [{ title: "step", status: "completed" }]); db.closeTaskList(lead.id);
    expect(db.collaboration.getTask(task.id).sources).toHaveLength(2);
  });
  it("keeps broadcasts readable without deliveries and routes user requests only to the lead or selected members", () => {
    const { db, instance, lead, member } = fixture();
    const post = { teamInstanceId: instance.id, content: "Please investigate", requestId: randomUUID() };
    const request = db.collaboration.postMessage(post, null);
    expect(request.deliveries.map(item => item.conversationId)).toEqual([lead.id]);
    expect(db.collaboration.postMessage(post, null).id).toBe(request.id);
    const notification = db.collaboration.postMessage({ ...post, requestId: randomUUID(), intent: "notify", content: "@developer already checked" }, lead.id);
    expect(notification.deliveries).toEqual([]);
    const direct = db.collaboration.postMessage({ ...post, requestId: randomUUID(), recipientConversationIds: [member.id] }, lead.id);
    expect(direct.deliveries.map(item => item.conversationId)).toEqual([member.id]);
    expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).messages).toHaveLength(3);
    expect(() => db.collaboration.postMessage({ ...post, content: "different" }, null)).toThrow(/idempot/i);
  });
  it("isolates rooms, preserves causal depth, and never lets delivery advance the user's read marker", () => {
    const { db, instance, lead, member } = fixture();
    const request = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "Question", requestId: randomUUID() }, null);
    db.collaboration.consumeDelivery(request.deliveries[0]!.id, randomUUID());
    expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).userReadSequence).toBe(0);
    const stranger = db.createConversation(null);
    expect(() => db.collaboration.postMessage({ teamInstanceId: instance.id, content: "Hi", requestId: randomUUID() }, stranger.id)).toThrow(/member/i);
    const reply = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "Check", requestId: randomUUID(),
      replyToId: request.id, recipientConversationIds: [member.id] }, lead.id);
    expect(reply.rootMessageId).toBe(request.id); expect(reply.depth).toBe(1);
    db.collaboration.markRead({ teamInstanceId: instance.id, throughSequence: reply.sequence }, null);
    expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).userReadSequence).toBe(reply.sequence);
  });
});
