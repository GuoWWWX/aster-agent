import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { CompleteTurnInput, ModelProviderAdapter, ModelTurnResult } from "../model/model-contracts.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { EventProjector } from "../storage/event-projector.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ThreadLogLegacyImporter } from "../storage/thread-log-legacy-importer.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { AgentRuntime } from "./agent-runtime.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

function hold(input: CompleteTurnInput): Promise<ModelTurnResult> {
  return new Promise((_resolve, reject) => input.signal.addEventListener("abort", () =>
    reject(new DOMException("Cancelled", "AbortError")), { once: true }));
}

function tool(name: string, args: object): ModelTurnResult {
  return { content: "", finishReason: "tool_calls", toolCalls: [{ name, arguments: JSON.stringify(args), id: crypto.randomUUID() }] };
}

function runtimeFor(database: AgentDatabase, projects: ProjectRegistry, model: ModelProviderAdapter, log?: ThreadLog) {
  const projector = log === undefined ? undefined : new EventProjector(database, log);
  return new AgentRuntime(database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions",
    baseUrl: "https://fixture.invalid", modelId: "fixture", reasoningOptions: [] }) }, projects, new ProjectToolRegistry(projects), model,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    log, projector, log === undefined || projector === undefined ? undefined : new ThreadLogLegacyImporter(database, log, projector),
    undefined, undefined, undefined, undefined, {},
    log === undefined || projector === undefined ? undefined : new ConversationLifecycleService(database, log, projector));
}

describe("quick coordination request queue", () => {
  it("retains two parent-owned task records and their exact inputs after a reused child closes its local checklist", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "quick-task-directory-"));
    const db = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(db);
    const project = await projects.registerDirectory(directory);
    const parent = db.createConversation(project.id);
    db.setConversationPermissionMode(parent.id, "full_access", "parallel_queue");
    const start = deferred(), releaseWorker = deferred(), releaseDelivery = deferred();
    let parentTurn = 0, childTurn = 0, queuedId = "";
    const completionViews: string[] = [];
    const taskFor = (title: string) => db.collaboration.listTasks({ conversationId: parent.id }).items.find(task => task.title === title)!;
    const source = (messageId: string) => ({ kind: "conversation", containerId: parent.id, messageId, purpose: "request" });
    const runtime = runtimeFor(db, projects, { completeTurn: async input => {
      if (input.messages.some(message => message.content.includes("You are a reusable Subagent"))) {
        switch (++childTurn) {
          case 1: return tool("update_task_list", { tasks: [{ title: "检查当前分工", status: "completed" }] });
          case 2: await releaseWorker.promise; return tool("close_task_list", {});
          default: return { content: childTurn === 3 ? "result-D" : "result-E", finishReason: "stop", toolCalls: [] };
        }
      }
      switch (++parentTurn) {
        case 1:
          expect(input.messages.some(message => message.role === "system" && message.content.includes("If the queue is empty, do not claim or invent placeholder IDs"))).toBe(true);
          await start.promise; return tool("list_task_contexts", {});
        case 2: return tool("update_task_context", { title: "D", goal: "处理 D" });
        case 3: return tool("spawn_subagent", { name: "执行者", task: "只处理 D" });
        case 4: return tool("claim_pending_messages", { pendingMessageIds: [queuedId] });
        case 5: return tool("list_task_contexts", {});
        case 6: return tool("update_task_context", { title: "E", goal: "处理 E", source: source(queuedId) });
        case 7: return tool("send_agent_message", { conversationIds: [db.listSubagentTasks(parent.id)[0]!.childConversationId], content: "只处理 E" });
        case 8: await releaseDelivery.promise; return tool("find_files", { pattern: "*" });
        case 9: {
          expect(JSON.stringify(input.messages)).toContain("result-D");
          expect(JSON.stringify(input.messages)).toContain("result-E");
          const task = taskFor("D");
          return tool("update_task_context", { id: task.id, expectedRevision: task.revision, title: "D", goal: "处理 D", summary: "result-D", status: "completed" });
        }
        case 10: {
          completionViews.push(input.messages.findLast(message => message.content.startsWith("[Persistent task directory"))?.content ?? "");
          const task = taskFor("E");
          return tool("update_task_context", { id: task.id, expectedRevision: task.revision, title: "E", goal: "处理 E", summary: "result-E", status: "completed", source: source(queuedId) });
        }
        default:
          completionViews.push(input.messages.findLast(message => message.content.startsWith("[Persistent task directory"))?.content ?? "");
          return { content: "两项结果均已交付，任务列表待用户确认。", finishReason: "stop", toolCalls: [] };
      }
    } });
    try {
      runtime.sendMessage({ conversationId: parent.id, content: "处理 D", permissionMode: "full_access" }, () => undefined);
      await vi.waitFor(() => expect(parentTurn).toBe(1));
      const queued = runtime.sendMessage({ conversationId: parent.id, content: "独立处理 E", permissionMode: "full_access", deliveryMode: "queue" }, () => undefined);
      if (queued.kind !== "pending") throw new Error("Expected queued input");
      queuedId = queued.pendingMessage.id;
      const firstId = db.listTimeline(parent.id).find(item => item.kind === "message" && item.role === "user")!.id;
      start.resolve();
      await vi.waitFor(() => expect(parentTurn).toBe(8));
      const child = db.listSubagentTasks(parent.id)[0]!.childConversationId;
      expect(db.listUnreadAgentMessages(child)).toMatchObject([{ deliveryMode: "queue" }]);
      releaseWorker.resolve();
      await vi.waitFor(() => expect(db.listUnreadAgentMessages(parent.id)).toHaveLength(2));
      releaseDelivery.resolve();
      await vi.waitFor(() => expect(db.getConversation(parent.id).activeRunId).toBeNull());
      expect(parentTurn).toBe(11);
      const directoryState = (content: string) => z.array(z.object({ title: z.string(), status: z.string(), completionRequested: z.boolean() }))
        .parse(JSON.parse(content.split("\n")[2] ?? "[]"));
      expect(directoryState(completionViews[0]!)).toEqual(expect.arrayContaining([
        expect.objectContaining({ title: "D", status: "running", completionRequested: true }),
        expect.objectContaining({ title: "E", status: "running", completionRequested: false }),
      ]));
      expect(directoryState(completionViews[1]!).every(task => task.completionRequested)).toBe(true);
      expect(completionViews[1]).toContain("Do not resubmit completion or reset the status");
      expect(db.getConversation(parent.id).lastRunStatus).toBe("completed");
      expect(db.listSubagentTasks(parent.id)).toHaveLength(1);
      expect(db.getTaskList(child)).toBeNull();
      const page = db.collaboration.listTasks({ conversationId: parent.id });
      expect(page.total).toBe(2);
      expect(page.items).toEqual(expect.arrayContaining([expect.objectContaining({ title: "D", ownerConversationId: parent.id, summary: "result-D", completionRequested: true }),
        expect.objectContaining({ title: "E", ownerConversationId: parent.id, summary: "result-E", completionRequested: true })]));
      for (const [title, messageId] of [["D", firstId], ["E", queuedId]]) {
        const detail = db.collaboration.getTask(taskFor(title!).id);
        expect(detail.sources.every(item => item.available)).toBe(true);
        expect(detail.sources.filter(item => item.containerId === parent.id && item.purpose === "request").map(item => item.messageId)).toEqual([messageId]);
      }
    } finally {
      start.resolve(); releaseWorker.resolve(); releaseDelivery.resolve(); runtime.cancelConversation(parent.id);
      await runtime.stopAllRuns(); db.close(); await rm(directory, { recursive: true, force: true });
    }
  });

  it.each(["paused", "foreign", "missing"])("retains the whole batch after a rejected %s claim and cancellation", async mode => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "quick-queue-guard-"));
    const db = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(db);
    const project = await projects.registerDirectory(directory);
    const log = mode === "paused" ? new ThreadLog(path.join(directory, "logs")) : undefined;
    const lifecycle = log === undefined ? db : new ConversationLifecycleService(db, log, new EventProjector(db, log));
    const parent = lifecycle.createConversation(project.id);
    lifecycle.setConversationPermissionMode(parent.id, "full_access", "parallel_queue");
    const start = deferred();
    const ids: string[] = [];
    let turns = 0;
    const foreign = db.createConversation(null);
    const foreignInput = db.enqueuePendingMessage({ conversationId: foreign.id, content: "another conversation" });
    const runtime = runtimeFor(db, projects, { completeTurn: async input => {
      if (input.messages.some(message => message.role === "user" && message.content === "guard-worker")) return hold(input);
      switch (++turns) {
        case 1: await start.promise; return tool("spawn_subagent", { task: "guard-worker" });
        case 2: return tool("claim_pending_messages", { pendingMessageIds: mode === "paused" ? [ids[0]]
          : [ids[0], mode === "foreign" ? foreignInput.id : crypto.randomUUID()] });
        default: return hold(input);
      }
    } }, log);
    try {
      runtime.sendMessage({ conversationId: parent.id, content: "current", permissionMode: "full_access" }, () => undefined);
      await vi.waitFor(() => expect(turns).toBe(1));
      for (let index = 0; index < 3; index++) {
        const queued = runtime.sendMessage({ conversationId: parent.id, content: `queued-${index}`, permissionMode: "full_access" }, () => undefined);
        if (queued.kind !== "pending") throw new Error("Expected a queued message");
        ids.push(queued.pendingMessage.id);
      }
      if (mode === "paused") runtime.setPendingQueuePaused(parent.id, true, () => undefined);
      start.resolve();
      await vi.waitFor(() => expect(turns).toBe(3));
      expect(db.listPendingMessages(parent.id).map(message => message.id)).toEqual(ids);
      expect(db.listTimeline(parent.id).filter(item => item.kind === "message" && item.role === "user")).toHaveLength(1);
      runtime.cancelConversation(parent.id);
      await runtime.stopAllRuns();
      expect(db.listPendingMessages(parent.id).map(message => message.id)).toEqual(ids);
      if (log !== undefined) {
        const restored = new AgentDatabase(":memory:");
        try {
          restored.saveProject(project);
          new EventProjector(restored, log).projectAllConversationLogs();
          const model = { completeTurn: vi.fn(() => Promise.resolve<ModelTurnResult>({ content: "must not run", finishReason: "stop", toolCalls: [] })) };
          const next = runtimeFor(restored, new ProjectRegistry(restored), model, log);
          next.resumePendingMessages(() => undefined);
          await new Promise<void>(resolve => setImmediate(resolve));
          expect(next.isPendingQueuePaused(parent.id)).toBe(true);
          expect(restored.listPendingMessages(parent.id).map(message => message.id)).toEqual(ids);
          expect(model.completeTurn).not.toHaveBeenCalled();
          await next.stopAllRuns();
        } finally { restored.close(); }
      }
    } finally {
      start.resolve(); runtime.cancelConversation(parent.id); await runtime.stopAllRuns();
      db.close(); await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([false, true])("selects related requests from ten tasks, reuses a busy child, starts another and delivers every receipt (JSONL: %s)", async jsonl => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "quick-batch-"));
    const db = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(db);
    const project = await projects.registerDirectory(directory);
    const log = jsonl ? new ThreadLog(path.join(directory, "logs")) : undefined;
    const lifecycle = log === undefined ? db : new ConversationLifecycleService(db, log, new EventProjector(db, log));
    const parent = lifecycle.createConversation(project.id);
    lifecycle.setConversationPermissionMode(parent.id, "full_access", "parallel_queue");
    const start = deferred(), releaseWorkers = deferred(), releaseDelivery = deferred();
    const pendingIds: string[] = [];
    const requests: CompleteTurnInput[] = [];
    const workerRequests: CompleteTurnInput[] = [];
    let parentTurn = 0;
    let originalRunId: string;
    let deliveredMessages: string[] = [];
    const childId = () => db.listSubagentTasks(parent.id)[0]!.childConversationId;
    const lastTool = (input: CompleteTurnInput): { ok: boolean } => z.object({ ok: z.boolean() }).passthrough()
      .parse(JSON.parse(input.messages.findLast(message => message.role === "tool")!.content));
    const runtime = runtimeFor(db, projects, { completeTurn: async input => {
      if (input.messages.some(message => message.role === "user" && ["worker-first", "worker-9-10"].includes(message.content))) {
        workerRequests.push(input);
        await releaseWorkers.promise;
        const latest = input.messages.filter(message => message.role === "user").at(-1)!.content;
        const marker = ["worker-3-5-6-7-8", "worker-2-4", "worker-9-10", "worker-first"].find(value => latest.includes(value))!;
        return { content: `result-${marker}`, finishReason: "stop", toolCalls: [] };
      }
      requests.push(input);
      switch (++parentTurn) {
        case 1: await start.promise; return tool("list_pending_messages", {});
        case 2:
          expect(lastTool(input)).toMatchObject({ ok: true, value: { total: 9 } });
          expect(db.listPendingMessages(parent.id)).toHaveLength(9);
          return tool("claim_pending_messages", { pendingMessageIds: [pendingIds[0]] });
        case 3:
          expect(lastTool(input).ok).toBe(false);
          expect(db.listPendingMessages(parent.id)).toHaveLength(9);
          return tool("spawn_subagent", { name: "worker-one", task: "worker-first" });
        case 4: return tool("claim_pending_messages", { pendingMessageIds: [pendingIds[0], pendingIds[2]] });
        case 5:
          expect(lastTool(input).ok).toBe(true);
          expect(db.listPendingMessages(parent.id).map(message => message.id)).toEqual(pendingIds.filter((_, index) => index !== 0 && index !== 2));
          return tool("claim_pending_messages", { pendingMessageIds: [pendingIds[1]] });
        case 6:
          expect(lastTool(input).ok).toBe(false);
          return tool("send_agent_message", { conversationIds: [childId()], content: "worker-2-4" });
        case 7: return tool("claim_pending_messages", { pendingMessageIds: [1, 3, 4, 5, 6].map(index => pendingIds[index]) });
        case 8:
          expect(lastTool(input).ok).toBe(true);
          return tool("send_agent_message", { conversationIds: [childId()], content: "worker-3-5-6-7-8" });
        case 9: return tool("claim_pending_messages", { pendingMessageIds: pendingIds.slice(7) });
        case 10:
          expect(lastTool(input).ok).toBe(true);
          return tool("spawn_subagent", { name: "worker-two", task: "worker-9-10" });
        case 11:
          expect(lastTool(input).ok).toBe(true);
          await releaseDelivery.promise;
          return tool("find_files", { pattern: "*" });
        default:
          deliveredMessages = input.messages.filter(message => message.role === "user" && message.content.includes("result-")).map(message => message.content);
          return { content: "十项任务已完成交付，四份执行结果均已核对。", finishReason: "stop", toolCalls: [] };
      }
    } }, log);
    try {
      const submission = runtime.sendMessage({ conversationId: parent.id, content: "任务1", permissionMode: "full_access" }, () => undefined);
      if (submission.kind !== "started") throw new Error("Expected the first run");
      originalRunId = submission.runId;
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      for (let index = 2; index <= 10; index++) {
        const queued = runtime.sendMessage({ conversationId: parent.id, content: `任务${index}`,
          permissionMode: "full_access", deliveryMode: "queue" }, () => undefined);
        if (queued.kind !== "pending") throw new Error("Expected pending input");
        pendingIds.push(queued.pendingMessage.id);
      }
      start.resolve();
      await vi.waitFor(() => expect(parentTurn).toBe(11));
      expect(db.listPendingMessages(parent.id)).toEqual([]);
      expect(db.getConversation(parent.id).activeRunId).toBe(originalRunId);
      expect(db.listSubagentTasks(parent.id)).toHaveLength(2);
      expect(workerRequests).toHaveLength(2);
      expect(db.listUnreadAgentMessages(childId())).toHaveLength(2);
      expect(db.listContextMessages(childId()).some(message => message.content.includes("worker-2-4"))).toBe(false);
      releaseWorkers.resolve();
      await vi.waitFor(() => expect(db.listUnreadAgentMessages(parent.id)
        .filter(message => message.messageType === "agent_result" || message.messageType === "task_result")).toHaveLength(4));
      await vi.waitFor(() => expect(db.listConversationHierarchy().filter(conversation => conversation.parentConversationId === parent.id)
        .every(conversation => conversation.activeRunId === null)).toBe(true));
      expect(workerRequests).toHaveLength(4);
      releaseDelivery.resolve();
      await vi.waitFor(() => expect(db.getConversation(parent.id).activeRunId).toBeNull());
      expect(db.getConversation(parent.id).lastRunStatus).toBe("completed");
      for (const result of ["result-worker-first", "result-worker-2-4", "result-worker-3-5-6-7-8", "result-worker-9-10"]) {
        expect(deliveredMessages.some(message => message.includes(result)), `${result}: ${JSON.stringify(deliveredMessages)}`).toBe(true);
      }
      const userMessages = db.listTimeline(parent.id).filter(item => item.kind === "message" && item.role === "user");
      expect(userMessages).toHaveLength(10);
      for (const id of pendingIds) expect(userMessages.filter(message => message.id === id)).toHaveLength(1);
      expect(db.listUnreadAgentMessages(parent.id)).toEqual([]);
      if (log !== undefined) {
        const restored = new AgentDatabase(":memory:");
        try {
          restored.saveProject(project);
          new EventProjector(restored, log).projectAllConversationLogs();
          expect(restored.listPendingMessages(parent.id)).toEqual([]);
          expect(restored.listTimeline(parent.id).filter(item => item.kind === "message" && item.role === "user")).toHaveLength(10);
          expect(restored.listUnreadAgentMessages(childId())).toEqual([]);
          expect(restored.listContextMessages(childId()).filter(message => message.role === "user" && message.content.includes("worker-2-4"))).toHaveLength(1);
        } finally { restored.close(); }
      }
    } finally {
      start.resolve(); releaseWorkers.resolve(); releaseDelivery.resolve();
      runtime.cancelConversation(parent.id);
      await vi.waitFor(() => expect(db.listConversationHierarchy().every(conversation => conversation.activeRunId === null)).toBe(true));
      await new Promise<void>(resolve => setImmediate(resolve));
      db.close(); await rm(directory, { recursive: true, force: true });
    }
  });

  it("keeps later requests pending while the current request has no accepted handoff", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "quick-queue-"));
    const db = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(db);
    const project = await projects.registerDirectory(directory);
    const parent = db.createConversation(project.id);
    db.setConversationPermissionMode(parent.id, "full_access", "parallel_queue");
    const first = deferred();
    const requests: CompleteTurnInput[] = [];
    const runtime = runtimeFor(db, projects, { completeTurn: async input => {
      requests.push(input);
      if (requests.length === 1) { await first.promise; return tool("find_files", { pattern: "*" }); }
      return hold(input);
    } });
    try {
      runtime.sendMessage({ conversationId: parent.id, content: "先安排任务一", permissionMode: "full_access" }, () => undefined);
      await vi.waitFor(() => expect(requests).toHaveLength(1));
      for (let index = 2; index <= 6; index++) runtime.sendMessage({ conversationId: parent.id,
        content: `后续独立任务${index}`, permissionMode: "full_access", deliveryMode: "queue" }, () => undefined);
      first.resolve();
      await vi.waitFor(() => expect(requests).toHaveLength(2));
      expect(db.listPendingMessages(parent.id)).toHaveLength(5);
      expect(JSON.stringify(requests[1]?.messages)).not.toContain("后续独立任务");
    } finally {
      first.resolve(); runtime.cancelConversation(parent.id);
      await vi.waitFor(() => expect(db.getConversation(parent.id).activeRunId).toBeNull());
      db.close(); await rm(directory, { recursive: true, force: true });
    }
  });

  it("queues follow-up work for a busy child without adding it to the current task or its receipt", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "quick-child-queue-"));
    const db = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(db);
    const project = await projects.registerDirectory(directory);
    const parent = db.createConversation(project.id);
    const child = db.forkConversation(parent.id, "subagent");
    const first = deferred();
    const childRequests: CompleteTurnInput[] = [];
    let parentTurns = 0;
    const runtime = runtimeFor(db, projects, { completeTurn: async input => {
      if (input.messages.some(message => message.content === "child-active")) {
        childRequests.push(input);
        if (childRequests.length === 1) { await first.promise; return tool("find_files", { pattern: "*" }); }
        return hold(input);
      }
      if (++parentTurns === 1) return tool("send_agent_message", { conversationIds: [child.id], content: "child-next-independent" });
      return { content: "已排队", finishReason: "stop", toolCalls: [] };
    } });
    try {
      runtime.sendMessage({ conversationId: child.id, content: "child-active", permissionMode: "full_access" }, () => undefined);
      await vi.waitFor(() => expect(childRequests).toHaveLength(1));
      runtime.sendMessage({ conversationId: parent.id, content: "安排下一项", permissionMode: "full_access" }, () => undefined);
      await vi.waitFor(() => expect(db.listUnreadAgentMessages(child.id)).toHaveLength(1));
      first.resolve();
      await vi.waitFor(() => expect(childRequests).toHaveLength(2));
      expect(JSON.stringify(childRequests[1]?.messages)).not.toContain("child-next-independent");
      expect(db.listUnreadAgentMessages(child.id)).toMatchObject([{ deliveryMode: "queue" }]);
    } finally {
      first.resolve(); runtime.cancelConversation(parent.id);
      await vi.waitFor(() => expect(db.getConversation(child.id).activeRunId).toBeNull());
      db.close(); await rm(directory, { recursive: true, force: true });
    }
  });
});
