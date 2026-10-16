import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
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
describe("durable collaboration", () => {

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
