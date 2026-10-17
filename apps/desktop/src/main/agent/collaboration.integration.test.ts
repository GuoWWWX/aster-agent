import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationRunEvent, type TeamChatMessage } from "@agent/protocol";
import { CollaborationTool } from "./collaboration-tool.js";
import { AgentRuntime } from "./agent-runtime.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { NodeSqliteCheckpointSaver } from "../storage/node-sqlite-checkpoint-saver.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import type { CompleteTurnInput, ModelProviderAdapter, ModelTurnResult } from "../model/model-contracts.js";
import { ModelRequestError } from "../model/model-request-error.js";

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
async function fixture(withThreadLog = false, withCoordinator = false, graphCheckpointer: NodeSqliteCheckpointSaver | null = null) {
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
    (_delay, signal) => { signal.throwIfAborted(); return Promise.resolve(); }, undefined, null, null,
    withCoordinator ? { getConfiguration: () => structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION) } : null, null, graphCheckpointer, undefined, null, log, projector);
  return { db, lead, member, instance, runtime, model, tools, log };
}
describe("group execution integration", () => {
  it.each([false, true])("waits for checkpoint cleanup before starting the next group delivery (resumePaused=%s)", async resumePaused => {
    const checkpointer = new NodeSqliteCheckpointSaver(":memory:");
    const { db, instance, member, runtime, model, tools } = await fixture(true, false, checkpointer);
    const removeCheckpoint = checkpointer.deleteThread.bind(checkpointer);
    let releaseCleanup!: () => void; let cleanupEntered = false;
    const cleanupGate = new Promise<void>(resolve => { releaseCleanup = resolve; });
    vi.spyOn(checkpointer, "deleteThread").mockImplementation(async id => {
      if (!cleanupEntered) { cleanupEntered = true; await cleanupGate; }
      await removeCheckpoint(id);
    });
    vi.spyOn(model, "completeTurn").mockImplementation(input => {
      const source = input.messages.findLast(message => message.content.startsWith("[Team group input;"))!;
      const context = z.object({ deliveryId: z.string(), content: z.string() }).parse(JSON.parse(source.content.slice(source.content.indexOf("\n") + 1)));
      if (input.messages.some(message => message.toolCallId === context.deliveryId)) return Promise.resolve({ content: "已发言", finishReason: "stop", toolCalls: [] });
      return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{ id: context.deliveryId, name: "post_team_message",
        arguments: JSON.stringify({ content: context.content, intent: "notify" }) }] });
    });
    try {
      const first = runtime.postTeamChat({ teamInstanceId: instance.id, content: "第一条", recipientConversationIds: [member.id], requestId: randomUUID() }, () => undefined);
      let second = runtime.postTeamChat({ teamInstanceId: instance.id, content: "第二条", recipientConversationIds: [member.id], requestId: randomUUID() }, () => undefined);
      await vi.waitFor(() => expect(cleanupEntered).toBe(true));
      if (resumePaused) {
        runtime.cancelConversation(member.id);
        expect(db.collaboration.message(second.id).deliveries[0]?.status).toBe("cancelled");
        second = runtime.postTeamChat({ teamInstanceId: instance.id, content: "第二条", recipientConversationIds: [member.id], requestId: randomUUID() }, () => undefined);
        expect(db.isConversationExecutionPaused(member.id)).toBe(false);
      }
      // Let the run.finished timer fire while the old executor still owns this conversation.
      await new Promise(resolve => setTimeout(resolve, 20));
      expect(db.collaboration.message(first.id).deliveries[0]?.status).toBe("completed");
      expect(db.collaboration.message(second.id).deliveries[0]?.status).toBe("pending");
      expect(db.getConversation(member.id).activeRunId).toBeNull();
      releaseCleanup();
      await vi.waitFor(() => expect(db.collaboration.message(second.id).deliveries[0]?.status).toBe("completed"));
      expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).messages.filter(message => message.senderConversationId === member.id).map(message => message.content)).toEqual(["第一条", "第二条"]);
    } finally { releaseCleanup(); await runtime.stopAllRuns(); await tools.dispose(); db.close(); checkpointer.close(); }
  });
  it("publishes a leader's invitation before parallel member replies and resumes the leader for a public synthesis", async () => {
    const { db, instance, lead, member, runtime, model, tools } = await fixture(true, true);
    const reviewer = db.createConversation(lead.projectId, { teamId: instance.teamId, parentConversationId: lead.id, threadKind: "agent",
      agent: { id: "qa-engineer", name: "测试", role: "测试", instructions: "", isDefault: false } });
    db.bindTeamMemberConversation({ conversationId: reviewer.id, agentId: "qa-engineer", teamExecutionConversationId: lead.id });
    const recipients = [member.id, reviewer.id]; const entered = new Set<string>();
    let releaseMembers!: () => void;
    const membersStarted = new Promise<void>(resolve => { releaseMembers = resolve; });
    const events: ConversationRunEvent[] = [];
    let original: TeamChatMessage;
    vi.spyOn(model, "completeTurn").mockImplementation(async input => {
      if (input.tools.length === 0) return { content: JSON.stringify({ recipientConversationIds: [lead.id] }), finishReason: "stop", toolCalls: [] };
      const source = input.messages.findLast(message => message.content.startsWith("[Team group input;"))!;
      const context = z.object({ deliveryId: z.string(), messageId: z.string(), content: z.string() }).parse(JSON.parse(source.content.slice(source.content.indexOf("\n") + 1)));
      const page = db.collaboration.readMessages({ teamInstanceId: instance.id });
      const publicReplies = page.messages.filter(message => recipients.includes(message.senderConversationId ?? ""));
      if (input.messages.some(message => message.content.includes("[Team group request receipt | reference data]"))) {
        if (publicReplies.length === 2 && !page.messages.some(message => message.content === "两位的意见已汇总")) {
          return { content: "", finishReason: "tool_calls", toolCalls: [{ id: "synthesis", name: "post_team_message",
            arguments: JSON.stringify({ content: "两位的意见已汇总", intent: "notify", replyToId: original.id }) }] };
        }
        return { content: "已收取公开回复回执", finishReason: "stop", toolCalls: [] };
      }
      if (context.content === "负责人，请公开邀请两位讨论后汇总") {
        expect(input.messages[0]?.content).toContain("Delegate through post_team_message");
        if (page.messages.some(message => message.intent === "request" && message.senderConversationId === lead.id)) return { content: "已公开邀请", finishReason: "stop", toolCalls: [] };
        return { content: "", finishReason: "tool_calls", toolCalls: [{ id: "invitation", name: "post_team_message",
          arguments: JSON.stringify({ content: "@开发 @测试 请各给一条意见", intent: "request", recipientConversationIds: recipients, replyToId: context.messageId }) }] };
      }
      entered.add(context.deliveryId); if (entered.size === 2) releaseMembers();
      await membersStarted;
      if (input.messages.some(message => message.toolCallId === "opinion")) return { content: "私有工作已结束", finishReason: "stop", toolCalls: [] };
      return { content: "", finishReason: "tool_calls", toolCalls: [{ id: "opinion", name: "post_team_message",
        arguments: JSON.stringify({ content: "我的意见", intent: "notify", replyToId: context.messageId }) }] };
    });
    try {
      original = runtime.postTeamChat({ teamInstanceId: instance.id, content: "负责人，请公开邀请两位讨论后汇总", requestId: randomUUID() }, event => { events.push(event); });
      await vi.waitFor(() => {
        expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).messages.at(-1)?.content).toBe("两位的意见已汇总");
        expect([lead.id, ...recipients].every(id => db.getConversation(id).activeRunId === null)).toBe(true);
      });
      const messages = db.collaboration.readMessages({ teamInstanceId: instance.id }).messages;
      expect(messages).toHaveLength(5); expect(messages[0]?.recipientConversationIds).toEqual([lead.id]);
      expect(messages[1]).toMatchObject({ senderConversationId: lead.id, intent: "request", recipientConversationIds: recipients, rootMessageId: original.id });
      expect(messages.slice(2, 4).map(message => message.senderConversationId).sort()).toEqual([...recipients].sort());
      expect(messages[4]).toMatchObject({ senderConversationId: lead.id, intent: "notify", rootMessageId: original.id });
      expect(messages.flatMap(message => message.deliveries).every(delivery => delivery.status === "completed")).toBe(true);
      const firstMemberFinished = events.findIndex(event => event.type === "run.finished" && recipients.includes(event.conversationId));
      for (const id of recipients) expect(events.findIndex(event => event.type === "run.started" && event.conversationId === id)).toBeLessThan(firstMemberFinished);
      expect(events.filter(event => event.type === "run.started" && event.conversationId === lead.id).length).toBeGreaterThanOrEqual(2);
      expect(db.collaboration.receiptsToRecover()).toEqual([]);
      expect(db.collaboration.listTasks({ teamInstanceId: instance.id }).items).toEqual([]);
    } finally { releaseMembers(); await runtime.stopAllRuns(); await tools.dispose(); db.close(); }
  });
  it("retries an incomplete decision and accepts a fenced JSON response before starting a member", async () => {
    const { db, instance, member, runtime, model, tools } = await fixture(true, true); let attempts = 0;
    vi.spyOn(model, "completeTurn").mockImplementation(input => {
      if (input.tools.length === 0) {
        attempts += 1; expect(input.maxOutputTokens).toBeGreaterThanOrEqual(3000);
        return Promise.resolve({ content: attempts === 1 ? '{"recipientConversationIds":[' : '```json\n' + JSON.stringify({ recipientConversationIds: [member.id] }) + '\n```', finishReason: attempts === 1 ? "length" : "stop", toolCalls: [] });
      }
      return Promise.resolve({ content: "完成", finishReason: "stop", toolCalls: [] });
    });
    try {
      const message = runtime.postTeamChat({ teamInstanceId: instance.id, content: "请合适的成员回答", requestId: randomUUID() }, () => undefined);
      await vi.waitFor(() => expect(db.collaboration.message(message.id).deliveries[0]?.status).toBe("completed"));
      expect(attempts).toBe(2); expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).messages).toHaveLength(1);
    } finally { await runtime.stopAllRuns(); await tools.dispose(); db.close(); }
  });
  it("rejects invented recipients without executing a member", async () => {
    const { db, instance, runtime, model, tools } = await fixture(true, true);
    const started: string[] = [];
    vi.spyOn(model, "completeTurn").mockResolvedValue({ content: JSON.stringify({ recipientConversationIds: [randomUUID()] }), finishReason: "stop", toolCalls: [] });
    try {
      const message = runtime.postTeamChat({ teamInstanceId: instance.id, content: "请安排成员回答", requestId: randomUUID() }, event => { if (event.type === "run.started") started.push(event.conversationId); });
      await vi.waitFor(() => expect(db.collaboration.message(message.id).coordinator?.status).toBe("failed"));
      expect(started).toEqual([]); expect(db.collaboration.message(message.id).deliveries).toEqual([]);
    } finally { await runtime.stopAllRuns(); await tools.dispose(); db.close(); }
  });
  it("drains and records an interrupted coordinator without waking anyone", async () => {
    const { db, instance, runtime, model, tools } = await fixture(true, true);
    let entered = false;
    vi.spyOn(model, "completeTurn").mockImplementation(input => new Promise((_resolve, reject) => {
      entered = true; input.signal.addEventListener("abort", () => reject(new Error("Coordinator cancelled")), { once: true });
    }));
    try {
      const message = runtime.postTeamChat({ teamInstanceId: instance.id, content: "请协调一下", requestId: randomUUID() }, () => undefined);
      await vi.waitFor(() => expect(entered).toBe(true)); await runtime.stopAllRuns();
      expect(db.collaboration.message(message.id).coordinator?.status).toBe("failed");
      expect(db.collaboration.message(message.id).deliveries).toEqual([]);
    } finally { await runtime.stopAllRuns(); await tools.dispose(); db.close(); }
  });
  it("routes with the owning Agent in the background and gives the selected member an attributed public transcript", async () => {
    const { db, instance, lead, member, runtime, model, tools } = await fixture(true, true);
    const leadHistory = db.listTimeline(lead.id);
    db.collaboration.postMessage({ teamInstanceId: instance.id, content: "界面只使用蓝色按钮", intent: "notify", requestId: randomUUID() }, null);
    db.collaboration.postMessage({ teamInstanceId: instance.id, content: "我会按蓝色按钮处理", intent: "notify", requestId: randomUUID() }, member.id);
    db.collaboration.postMessage({ teamInstanceId: instance.id, content: "我负责确认接口", intent: "notify", requestId: randomUUID() }, lead.id);
    const started: string[] = [];
    vi.spyOn(model, "completeTurn").mockImplementation(input => {
      model.requests.push(input);
      if (input.tools.length === 0) return Promise.resolve({ content: JSON.stringify({ recipientConversationIds: [member.id], contextSummary: "用户要求使用蓝色按钮，开发正在处理。" }), finishReason: "stop", toolCalls: [] });
      if (input.messages.some(message => message.toolCallId === "public-reply")) return Promise.resolve({ content: "已回复", finishReason: "stop", toolCalls: [] });
      return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{ id: "public-reply", name: "post_team_message", arguments: JSON.stringify({ content: "蓝色按钮已确认", intent: "notify" }) }] });
    });
    try {
      const request = runtime.postTeamChat({ teamInstanceId: instance.id, content: "继续确认刚才那个按钮", requestId: randomUUID(),
        coordinator: { agentId: "default-agent", modelSelection: null } }, event => { if (event.type === "run.started") started.push(event.conversationId); });
      await vi.waitFor(() => expect(db.collaboration.message(request.id).deliveries[0]?.status).toBe("completed"));
      expect(started).toEqual([member.id]); expect(db.listTimeline(lead.id)).toEqual(leadHistory);
      const routing = model.requests.find(input => input.tools.length === 0)!;
      expect(routing.messages[1]?.content).toContain('"id":"default-agent"');
      expect(routing.messages[1]?.content).toContain("界面只使用蓝色按钮");
      const memberRequest = model.requests.find(input => input.tools.some(tool => tool.name === "post_team_message"))!;
      const source = memberRequest.messages.findLast(message => message.content.startsWith("[Team group input;"))!;
      const payload = z.object({ groupContext: z.array(z.object({ senderName: z.string(), perspective: z.string(), content: z.string() })) }).parse(JSON.parse(source.content.slice(source.content.indexOf("\n") + 1)));
      expect(payload.groupContext.map(message => message.perspective)).toEqual(["user", "self", "member"]);
      expect(payload.groupContext[1]?.content).toBe("我会按蓝色按钮处理");
      expect(payload.groupContext[2]?.senderName).toBeTruthy();
      expect(db.collaboration.coordinator(instance.id)?.contextSummary).toContain("蓝色按钮");
    } finally { await runtime.stopAllRuns(); await tools.dispose(); db.close(); }
  });
  it("retries a failed background coordination without adding another user message or starting the leader", async () => {
    const { db, instance, lead, member, runtime, model, tools } = await fixture(true, true);
    let recovered = false; const started: string[] = []; const requests = vi.spyOn(model, "completeTurn").mockImplementation(input => {
      if (input.tools.length === 0) {
        if (!recovered) return Promise.reject(new ModelRequestError(502, "upstream unavailable"));
        return Promise.resolve({ content: JSON.stringify({ recipientConversationIds: [member.id] }), finishReason: "stop", toolCalls: [] });
      }
      return Promise.resolve({ content: "处理完毕", finishReason: "stop", toolCalls: [] });
    });
    try {
      const message = runtime.postTeamChat({ teamInstanceId: instance.id, content: "帮忙看一下", requestId: randomUUID() }, event => { if (event.type === "run.started") started.push(event.conversationId); });
      await vi.waitFor(() => expect(db.collaboration.message(message.id).coordinator?.status).toBe("failed"));
      expect(requests).toHaveBeenCalledTimes(6); expect(started).toEqual([]);
      recovered = true;
      runtime.resumeTeamChatDelivery(message.id, event => { if (event.type === "run.started") started.push(event.conversationId); });
      await vi.waitFor(() => expect(db.collaboration.message(message.id).deliveries[0]?.status).toBe("completed"));
      expect(started).toEqual([member.id]); expect(db.listTimeline(lead.id)).toEqual([]);
      expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).messages).toHaveLength(1);
    } finally { await runtime.stopAllRuns(); await tools.dispose(); db.close(); }
  });
  it("runs only the naturally addressed member and publishes their own greeting", async () => {
    const { db, instance, lead, member, runtime, model, tools } = await fixture(true);
    const events: ConversationRunEvent[] = [];
    vi.spyOn(model, "completeTurn").mockImplementation((input): Promise<ModelTurnResult> => Promise.resolve(
      input.messages.some(message => message.role === "tool" && message.toolCallId === "greeting")
        ? { content: "好。", finishReason: "stop", toolCalls: [] }
        : { content: "", finishReason: "tool_calls", toolCalls: [{ id: "greeting", name: "post_team_message",
          arguments: JSON.stringify({ content: "你好呀，我在。", intent: "notify" }) }] },
    ));
    try {
      await new Promise<void>((resolve, reject) => {
        runtime.postTeamChat({ teamInstanceId: instance.id, content: "开发你好", requestId: randomUUID() }, event => {
          events.push(event);
          if (event.type === "run.finished") { if (event.status === "completed") resolve(); else reject(new Error(event.error ?? "Run failed")); }
        });
      });
      const messages = db.collaboration.readMessages({ teamInstanceId: instance.id }).messages;
      expect(messages[0]?.recipientConversationIds).toEqual([member.id]);
      expect(messages.slice(1).map(message => [message.senderConversationId, message.content])).toEqual([[member.id, "你好呀，我在。"]]);
      expect(events.filter(event => event.type === "run.started").map(event => event.conversationId)).toEqual([member.id]);
      expect(db.listTimeline(lead.id)).toEqual([]);
      expect(db.collaboration.listTasks({ conversationId: member.id }).items).toEqual([]);
    } finally { await tools.dispose(); db.close(); }
  });
  it.each(["private", "group"])("accepts a bound member's %s follow-up after 502 retries without reposting its completed group message", async (entry) => {
    const { db, instance, member, runtime, model, tools } = await fixture(true);
    let recovered = false;
    let followUpAttempts = 0;
    const requests = vi.spyOn(model, "completeTurn").mockImplementation((input): Promise<ModelTurnResult> => {
      if (recovered) {
        if (++followUpAttempts === 1) return Promise.reject(new ModelRequestError(503, "Upstream is recovering"));
        if (entry === "group" && !input.messages.some(message => message.role === "tool" && message.toolCallId === "resumed-public")) {
          return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{ id: "resumed-public", name: "post_team_message",
            arguments: JSON.stringify({ content: "连接恢复，可以继续聊了。", intent: "notify" }) }] });
        }
        return Promise.resolve({ content: "连接已恢复，可以继续。", finishReason: "stop", toolCalls: [] });
      }
      if (!input.messages.some(message => message.role === "tool" && message.toolCallId === "published-once")) {
        return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{ id: "published-once", name: "post_team_message",
          arguments: JSON.stringify({ content: "已核实结果。", intent: "notify" }) }] });
      }
      return Promise.reject(new ModelRequestError(502, "Upstream service temporarily unavailable"));
    });
    try {
      const failed = await new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(resolve => {
        runtime.postTeamChat({ teamInstanceId: instance.id, content: "先在群里公开结果", recipientConversationIds: [member.id], requestId: randomUUID() },
          event => { if (event.type === "run.finished") resolve(event); });
      });
      expect(failed.status).toBe("failed");
      expect(requests).toHaveBeenCalledTimes(7);
      expect(db.listTimeline(member.id)).toContainEqual(expect.objectContaining({ kind: "model_retry", status: "failed", attempt: 5 }));
      expect(db.getConversation(member.id).activeRunId).toBeNull();
      const binding = db.getConversationAgentBinding(member.id)!;
      recovered = true;
      let followUp: TeamChatMessage | null = null;
      const resumed = await new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(resolve => {
        const onEvent = (event: ConversationRunEvent) => { if (event.type === "run.finished") resolve(event); };
        if (entry === "group") followUp = runtime.postTeamChat({ teamInstanceId: instance.id, content: "开发，继续", requestId: randomUUID() }, onEvent);
        else runtime.sendMessage({ conversationId: member.id, content: "继续", agent: binding }, onEvent);
      });
      expect(resumed).toMatchObject({ status: "completed", error: null });
      expect(resumed.runId).not.toBe(failed.runId);
      expect(requests).toHaveBeenCalledTimes(entry === "group" ? 10 : 9);
      expect(db.listTimeline(member.id)).toContainEqual(expect.objectContaining({ kind: "model_retry", runId: resumed.runId, status: "completed", attempt: 1 }));
      expect(db.getConversationAgentBinding(member.id)).toEqual(binding);
      const messages = db.collaboration.readMessages({ teamInstanceId: instance.id }).messages;
      expect(messages.map(message => message.content)).toEqual(entry === "group"
        ? ["先在群里公开结果", "已核实结果。", "开发，继续", "连接恢复，可以继续聊了。"] : ["先在群里公开结果", "已核实结果。"]);
      if (entry === "group") {
        expect(followUp).toMatchObject({ recipientConversationIds: [member.id] });
        expect(messages.at(-1)?.rootMessageId).toBe(messages[2]?.id);
        expect(messages[2]?.deliveries[0]?.status).toBe("completed");
      }
    } finally { await tools.dispose(); db.close(); }
  });
  it("lets a later-started member publish while the first member is still thinking", async () => {
    const { db, instance, lead, member, runtime, model, tools } = await fixture(true);
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>(resolve => { releaseSlow = resolve; });
    const entered = new Set<string>(); const finished = new Set<string>(); const starts: string[] = [];
    vi.spyOn(model, "completeTurn").mockImplementation(async (input): Promise<ModelTurnResult> => {
      const source = input.messages.findLast(message => message.role === "user" && message.content.startsWith("[Team group input;"))!;
      const context = z.object({ deliveryId: z.string(), messageId: z.string() }).parse(JSON.parse(source.content.slice(source.content.indexOf("\n") + 1)));
      const target = db.collaboration.message(context.messageId).deliveries.find(delivery => delivery.id === context.deliveryId)!.conversationId;
      const toolCallId = `${context.deliveryId}-public`;
      if (input.messages.some(message => message.role === "tool" && message.toolCallId === toolCallId)) {
        return { content: "私有处理完成", finishReason: "stop", toolCalls: [] };
      }
      entered.add(target);
      if (target === lead.id) await slowGate;
      return { content: "", finishReason: "tool_calls", toolCalls: [{ id: toolCallId, name: "post_team_message",
        arguments: JSON.stringify({ content: target === lead.id ? "较慢成员的回复" : "较快成员的回复", intent: "notify", replyToId: context.messageId }) }] };
    });
    try {
      runtime.postTeamChat({ teamInstanceId: instance.id, content: "请两位各自回答", allMembers: true, requestId: randomUUID() }, event => {
        if (event.type === "run.started") starts.push(event.conversationId);
        if (event.type === "run.finished") finished.add(event.conversationId);
      });
      await vi.waitFor(() => { expect(entered.size).toBe(2); });
      expect(starts).toEqual([lead.id, member.id]);
      await vi.waitFor(() => { expect(finished.has(member.id)).toBe(true); });
      expect(db.getConversation(lead.id).activeRunId).not.toBeNull();
      expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).messages.slice(1).map(message => message.senderConversationId)).toEqual([member.id]);
      releaseSlow();
      await vi.waitFor(() => { expect(finished.size).toBe(2); });
      expect(db.collaboration.readMessages({ teamInstanceId: instance.id }).messages.slice(1).map(message => message.senderConversationId)).toEqual([member.id, lead.id]);
    } finally {
      releaseSlow();
      await vi.waitFor(() => { expect(finished.size).toBe(2); });
      await tools.dispose(); db.close();
    }
  });
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
