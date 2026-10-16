import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationRunEvent } from "@agent/protocol";
import { CollaborationTool } from "./collaboration-tool.js";
import { AgentRuntime } from "./agent-runtime.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import type { CompleteTurnInput, ModelProviderAdapter, ModelTurnResult } from "../model/model-contracts.js";

const roots: string[] = [];
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { force: true, recursive: true }); });
class GroupFixture implements ModelProviderAdapter {
  public readonly requests: CompleteTurnInput[] = [];
  public delegateTo: string | null = null;
  public delegateAgainOnReceipt = false;
  public memberGate: Promise<void> | null = null;
  private receiptTurns = 0;
  private readonly steps = new Map<string, number>();
  public async completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    this.requests.push(input);
    if (input.messages.some(message => message.content.includes("[Team group request receipt | reference data]"))) {
      if (this.delegateAgainOnReceipt && this.receiptTurns++ === 0 && this.delegateTo !== null) {
        return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{ id: "receipt-follow-up", name: "post_team_message",
          arguments: JSON.stringify({ content: "继续核实同一问题", intent: "request", recipientConversationIds: [this.delegateTo] }) }] });
      }
      return Promise.resolve({ content: "负责人已收到原委派的完成回执。", finishReason: "stop", toolCalls: [] });
    }
    const source = input.messages.findLast(message => message.role === "user" && message.content.startsWith("[Team group input;"));
    if (!source) throw new Error("Missing original group request");
    const context = z.object({ deliveryId: z.string(), messageId: z.string(), content: z.string() }).parse(JSON.parse(source.content.slice(source.content.indexOf("\n") + 1)));
    if (context.content !== "委派验收" && this.memberGate !== null) await this.memberGate;
    const step = this.steps.get(context.deliveryId) ?? 0; this.steps.set(context.deliveryId, step + 1);
    const candidateText = input.messages.findLast(message => message.role === "tool" && message.toolCallId === `${context.deliveryId}-0`)?.content;
    const candidate = candidateText === undefined ? null : z.object({ value: z.object({ items: z.array(z.object({ id: z.string(), revision: z.number() })) }) }).safeParse(JSON.parse(candidateText));
    const existing = candidate && candidate.success ? candidate.data.value.items[0] : undefined;
    const operations = [
      { name: "list_task_contexts", arguments: {} },
      { name: "update_task_context", arguments: { title: "查证文件", goal: "确认 fact.txt 内容", summary: "正在检查", status: "running", ...(existing === undefined ? {} : { id: existing.id, expectedRevision: existing.revision }) } },
      { name: "read_file", arguments: { path: "fact.txt" } },
      { name: "post_team_message", arguments: { content: "已核实文件内容为 evidence。", intent: "notify", replyToId: context.messageId } },
    ];
    const operation = context.content === "委派验收" && this.delegateTo !== null
      ? step === 0 ? { name: "post_team_message", arguments: { content: "请查证文件", intent: "request", replyToId: context.messageId, recipientConversationIds: [this.delegateTo] } } : undefined
      : operations[step];
    if (operation) return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{ name: operation.name, arguments: JSON.stringify(operation.arguments), id: `${context.deliveryId}-${step}` }] });
    input.onTextDelta("成员私有的执行总结。");
    return Promise.resolve({ content: "成员私有的执行总结。", finishReason: "stop", toolCalls: [] });
  }
}
async function fixture(withThreadLog = false) {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-group-integration-")); roots.push(root);
  await writeFile(path.join(root, "fact.txt"), "evidence", "utf8");
  const db = new AgentDatabase(":memory:"); const projects = new ProjectRegistry(db); const project = await projects.registerDirectory(root);
  const log = withThreadLog ? new ThreadLog(path.join(root, "conversations")) : null;
  const projector = log === null ? null : new EventProjector(db, log);
  const lifecycle = log === null || projector === null ? db : new ConversationLifecycleService(db, log, projector);
  db.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  const instance = db.createTeamInstance({ teamId: "default-team", scope: "project", projectId: project.id });
  const lead = lifecycle.createConversation(project.id, { teamId: instance.teamId, threadKind: "team_lead" });
  db.bindTeamExecutionConversation({ conversationId: lead.id, teamId: instance.teamId, teamInstanceId: instance.id, projectId: project.id, sourceConversationId: null });
  db.setTeamInstanceRoot(instance.id, lead.id);
  const member = lifecycle.createConversation(project.id, { teamId: instance.teamId, parentConversationId: lead.id, threadKind: "agent",
    agent: { id: "developer", name: "开发", role: "开发", instructions: "", isDefault: false } });
  db.bindTeamMemberConversation({ conversationId: member.id, agentId: "developer", teamExecutionConversationId: lead.id });
  const model = new GroupFixture(); const tools = new ProjectToolRegistry(projects);
  const runtime = new AgentRuntime(db, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://example.test/v1", modelId: "fixture", reasoningOptions: [] }) }, projects, tools, model,
    undefined, undefined, null, null, null, null, null, undefined, null, log, projector);
  return { db, lead, member, instance, runtime, model, tools, log };
}
describe("group execution integration", () => {
  it("cancels an idle member's saved pending group requests when the user stops that member", async () => {
    const { db, instance, lead, member, runtime, tools } = await fixture();
    try {
      const message = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "待处理请求", recipientConversationIds: [member.id], requestId: randomUUID() }, lead.id);
      runtime.cancelConversation(member.id);
      expect(db.collaboration.message(message.id).deliveries[0]?.status).toBe("cancelled");
      expect(db.isConversationExecutionPaused(member.id)).toBe(true);
    } finally { await tools.dispose(); db.close(); }
  });
  it("preserves the original group cause when a receipt makes the lead delegate again", async () => {
    const { db, instance, member, runtime, model, tools } = await fixture(true);
    model.delegateTo = member.id; model.delegateAgainOnReceipt = true;
    let releaseMember!: () => void;
    model.memberGate = new Promise<void>(resolve => { releaseMember = resolve; });
    try {
      await new Promise<void>((resolve, reject) => {
        let finished = 0;
        runtime.postTeamChat({ teamInstanceId: instance.id, content: "委派验收", requestId: randomUUID() }, event => {
          if (event.type === "run.finished") {
            if (finished === 0) releaseMember();
            if (event.status !== "completed") reject(new Error(event.error ?? "Run failed"));
            else if (++finished === 5) resolve();
          }
        });
      });
      const messages = db.collaboration.readMessages({ teamInstanceId: instance.id }).messages;
      const original = messages[0]!;
      const followUp = messages.find(message => message.content === "继续核实同一问题")!;
      expect(followUp.sourceRunId).not.toBe(messages[1]?.sourceRunId);
      expect(followUp.rootMessageId).toBe(original.id);
      expect(followUp.depth).toBe(2);
      expect(followUp.deliveries[0]?.status).toBe("completed");
    } finally { await tools.dispose(); db.close(); }
  });
  it("runs every selected member once for an explicit all-members request", async () => {
    const { db, instance, lead, member, runtime, model, tools } = await fixture(true);
    try {
      await new Promise<void>((resolve, reject) => {
        let finished = 0;
        runtime.postTeamChat({ teamInstanceId: instance.id, content: "请所有成员分别查证", allMembers: true, requestId: randomUUID() }, event => {
          if (event.type === "run.finished") {
            if (event.status !== "completed") reject(new Error(event.error ?? "Run failed"));
            else if (++finished === 2) resolve();
          }
        });
      });
      const messages = db.collaboration.readMessages({ teamInstanceId: instance.id }).messages;
      expect(messages[0]?.deliveries.map(delivery => delivery.conversationId).sort()).toEqual([lead.id, member.id].sort());
      expect(messages[0]?.deliveries.every(delivery => delivery.status === "completed")).toBe(true);
      expect(messages.slice(1).map(message => message.senderConversationId).sort()).toEqual([lead.id, member.id].sort());
      expect(messages.slice(1).every(message => message.deliveries.length === 0)).toBe(true);
      const input = model.requests[0]!.messages.findLast(message => message.content.startsWith("[Team group input;"))!;
      const inputContext = z.object({ recipientConversationIds: z.array(z.string()) }).parse(JSON.parse(input.content.slice(input.content.indexOf("\n") + 1)));
      expect(inputContext.recipientConversationIds).toEqual([lead.id, member.id]);
    } finally { await tools.dispose(); db.close(); }
  });
  it("bounds model reads and advances only the member's fully provided consecutive messages", async () => {
    const { db, instance, lead, member, tools } = await fixture();
    try {
    const tool = new CollaborationTool(db); const runId = randomUUID();
    const execute = async (args: object) => {
      const result = await tool.execute({ name: "read_team_messages", arguments: JSON.stringify(args), conversationId: member.id, runId,
        toolCallId: randomUUID(), post: () => { throw new Error("Read must not post"); }, changed: () => undefined });
      expect(result.kind).toBe("completed");
      if (result.kind !== "completed") throw new Error("Unexpected tool result");
      return JSON.parse(result.content) as { value: { memberReadSequence: number; messages: { content: string; nextContentOffset: number | null }[] } };
    };
    const first = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "short", intent: "notify", requestId: randomUUID() }, lead.id);
    const long = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "x".repeat(9000), intent: "notify", requestId: randomUUID() }, lead.id);
    const last = db.collaboration.postMessage({ teamInstanceId: instance.id, content: "last", intent: "notify", requestId: randomUUID() }, lead.id);
    const targeted = await execute({ messageId: last.id }); expect(targeted.value.memberReadSequence).toBe(0);
    const page = await execute({}); expect(page.value.memberReadSequence).toBe(first.sequence);
    expect(page.value.messages[1]?.content).toHaveLength(2000); expect(page.value.messages[1]?.nextContentOffset).toBe(2000);
    const chunk = await execute({ messageId: long.id, contentOffset: 8000 }); expect(chunk.value.messages[0]?.content).toHaveLength(1000);
    expect(chunk.value.memberReadSequence).toBe(first.sequence);
    expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).userReadSequence).toBe(0);
    expect(db.collaboration.pendingDeliveries()).toEqual([]);
    } finally { await tools.dispose(); db.close(); }
  });
  it("returns one bounded receipt to the original delegator without publishing private work", async () => {
    const { db, lead, member, instance, runtime, model, tools } = await fixture(true);
    model.delegateTo = member.id;
    try {
      await new Promise<void>((resolve, reject) => {
        let completed = 0;
        runtime.postTeamChat({ teamInstanceId: instance.id, content: "委派验收", requestId: crypto.randomUUID() }, event => {
          if (event.type === "run.finished") {
            if (event.status !== "completed") reject(new Error(event.error ?? "Run failed"));
            else if (++completed === 3) resolve();
          }
        });
      });
      const page = db.collaboration.readMessages({ teamInstanceId: instance.id });
      expect(page.messages.map(message => message.content)).toEqual(["委派验收", "请查证文件", "已核实文件内容为 evidence。"]);
      const delegated = page.messages[1]!; const receiptId = delegated.deliveries[0]!.id;
      expect(db.listTimeline(lead.id).filter(item => item.id === receiptId)).toHaveLength(1);
      const receipt = db.listTimeline(lead.id).find(item => item.id === receiptId);
      expect(receipt).toMatchObject({ messageType: "agent_result", taskId: receiptId, executionStatus: "completed" });
      expect(receipt && "content" in receipt ? receipt.content : "").not.toContain("成员私有的执行总结");
      expect(db.collaboration.receiptsToRecover()).toEqual([]);
    } finally { await tools.dispose(); db.close(); }
  });
  it("queues a second task boundary and reuses the existing task context", async () => {
    const { db, member, instance, runtime, tools } = await fixture();
    try {
      let finished = 0; let resolveFinished!: () => void; let rejectFinished!: (error: Error) => void;
      const allFinished = new Promise<void>((resolve, reject) => { resolveFinished = resolve; rejectFinished = reject; });
      const emit = (event: ConversationRunEvent) => { if (event.type === "run.finished") { if (event.status !== "completed") rejectFinished(new Error(event.error ?? "Run failed")); else if (++finished === 2) resolveFinished(); } };
      runtime.postTeamChat({ teamInstanceId: instance.id, content: "第一次查证", recipientConversationIds: [member.id], requestId: crypto.randomUUID() }, emit);
      const second = runtime.postTeamChat({ teamInstanceId: instance.id, content: "继续查证同一目标", recipientConversationIds: [member.id], requestId: crypto.randomUUID() }, emit);
      expect(second.deliveries[0]?.status).toBe("pending");
      await allFinished;
      expect(db.collaboration.listTasks({ conversationId: member.id }).items).toHaveLength(1);
      expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).messages.filter(message => message.intent === "notify")).toHaveLength(2);
    } finally { await tools.dispose(); db.close(); }
  });
  it("performs tools in the selected member's history and publishes only explicit group messages", async () => {
    const { db, lead, member, instance, runtime, model, tools, log } = await fixture(true);
    try {
      const events: ConversationRunEvent[] = [];
      const completed = new Promise<void>((resolve, reject) => {
        runtime.postTeamChat({ teamInstanceId: instance.id, content: "请查证文件", recipientConversationIds: [member.id], requestId: crypto.randomUUID() }, event => {
          events.push(event); if (event.type === "run.finished") { if (event.status === "completed") resolve(); else reject(new Error(event.error ?? "Run failed")); }
        });
      });
      await completed;
      const page = db.collaboration.readMessages({ teamInstanceId: instance.id });
      expect(page.messages.map(message => message.content)).toEqual(["请查证文件", "已核实文件内容为 evidence。"]);
      expect(page.messages[1]?.senderConversationId).toBe(member.id);
      expect(page.messages[1]?.deliveries).toEqual([]);
      expect(page.messages[0]?.deliveries[0]?.status).toBe("completed");
      expect(db.listTimeline(member.id)).toContainEqual(expect.objectContaining({ kind: "tool", name: "read_file", status: "completed" }));
      expect(db.listTimeline(lead.id)).toEqual([]);
      const canonical = JSON.stringify(log?.read(member.id)?.events);
      expect(canonical).toContain("read_file"); expect(canonical).toContain("成员私有的执行总结");
      const tasks = db.collaboration.listTasks({ conversationId: member.id }).items;
      expect(tasks).toHaveLength(1);
      db.clearVolatileConversationHistory(member.id);
      expect(db.collaboration.getTask(tasks[0]!.id).sources.every(source => source.available)).toBe(true);
      expect(db.collaboration.getTask(tasks[0]!.id).sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: "group", messageId: page.messages[0]!.id }),
        expect.objectContaining({ kind: "conversation", containerId: member.id, purpose: "verification" }),
        expect.objectContaining({ kind: "conversation", containerId: member.id, purpose: "result" }),
      ]));
      const calls = model.requests.length;
      runtime.postTeamChat({ teamInstanceId: instance.id, content: "全体注意", intent: "notify", allMembers: true, requestId: crypto.randomUUID() }, event => events.push(event));
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(model.requests).toHaveLength(calls);
    } finally { await tools.dispose(); db.close(); }
  });
  it("sends an unmentioned user request only to the Team Lead", async () => {
    const { db, lead, member, instance, runtime, tools } = await fixture();
    try {
      await new Promise<void>((resolve, reject) => runtime.postTeamChat({ teamInstanceId: instance.id, content: "请查证文件", requestId: crypto.randomUUID() }, event => {
        if (event.type === "run.finished") { if (event.status === "completed") resolve(); else reject(new Error(event.error ?? "Run failed")); }
      }));
      expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).messages[0]?.deliveries.map(item => item.conversationId)).toEqual([lead.id]);
      expect(db.listTimeline(member.id)).toEqual([]);
    } finally { await tools.dispose(); db.close(); }
  });
});
