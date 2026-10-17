import { CollaborationError } from "../errors/collaboration-error.js";
import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { TeamChatJournal } from "./team-chat-journal.js";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  taskContextSchema, taskSourceSchema, updateTaskContextInputSchema, listTaskContextsInputSchema,
  postTeamChatInputSchema, readTeamChatInputSchema, teamChatMessageSchema, teamChatDeliverySchema,
  type TaskContext, type TaskSource, type TaskContextDetail, type TaskContextPage,
  type ListTaskContextsInput, type UpdateTaskContextInput, type LinkTaskContextInput, type MergeTaskContextsInput,
  type PostTeamChatInput, type ReadTeamChatInput, type TeamChatMessage, type TeamChatPage,
  type MarkTeamChatReadInput, type ConversationSummary, type TeamInstanceView, type TeamChatMember,
  type ConversationAgentBinding, type TeamWorkItemView,
  type TeamChatCoordinationStep,
  type TaskContextScope, type TaskCompletionPolicy, type SetTaskCompletionPolicyInput, type ResolveChatReferencesInput, type ChatReference,
} from "@agent/protocol";

/** Recognize a direct opening address, not an arbitrary mention of a member. */
function addressedUserRecipients(content: string, members: readonly TeamChatMember[]): string[] {
  const names = [...members].sort((left, right) => right.name.length - left.name.length);
  let remaining = content.trimStart();
  if (!names.some(member => remaining.toLowerCase().startsWith(member.name.toLowerCase()))) {
    remaining = remaining.replace(/^(?:你好|您好|嗨)[,，\s]+/u, "");
  }
  const polite = names.some(member => remaining.toLowerCase().startsWith(member.name.toLowerCase()))
    ? null : /^(?:请|麻烦)\s*/u.exec(remaining);
  if (polite !== null) remaining = remaining.slice(polite[0].length);
  const recipients: string[] = [];
  while (remaining.length > 0) {
    const token = remaining.replace(/^[@＠]\s*/u, "");
    const matching = names.filter(member => token.toLowerCase().startsWith(member.name.toLowerCase()));
    const member = matching[0];
    if (member === undefined || matching.filter(candidate => candidate.name.toLowerCase() === member.name.toLowerCase()).length > 1) return [];
    recipients.push(member.conversationId);
    const after = token.slice(member.name.length);
    const separator = /^(?:\s*(?:[,，、]|以及|和|与|及)\s*|\s+)/u.exec(after);
    if (separator !== null) {
      const next = after.slice(separator[0].length);
      const nextToken = next.replace(/^[@＠]\s*/u, "").toLowerCase();
      if (names.some(candidate => nextToken.startsWith(candidate.name.toLowerCase()))) { remaining = next; continue; }
    }
    if (((polite !== null || token !== remaining) && /^\s+/u.test(after)) || after.trim().length === 0
      || /^\s*(?:[,，:：!！?？]|你好|您好|早上好|下午好|晚上好|早安|晚安|在吗|请|麻烦|帮我|帮忙|能否|能不能|你|各|都|一起|看看|看一下|说说|聊聊|检查|评审|分析|回答)/u.test(after)) {
      return [...new Set(recipients)];
    }
    return [];
  }
  return [];
}

export const COLLABORATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS task_contexts (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, project_id TEXT,
    team_instance_id TEXT, work_item_id TEXT UNIQUE, updated_at TEXT NOT NULL, payload_json TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS task_contexts_updated ON task_contexts(updated_at DESC, id DESC);
  CREATE TABLE IF NOT EXISTS task_context_revisions (task_id TEXT NOT NULL, revision INTEGER NOT NULL,
    payload_json TEXT NOT NULL, PRIMARY KEY(task_id, revision));
  CREATE TABLE IF NOT EXISTS task_context_sources (sequence INTEGER PRIMARY KEY AUTOINCREMENT, task_id TEXT NOT NULL,
    kind TEXT NOT NULL, container_id TEXT NOT NULL, message_id TEXT NOT NULL, payload_json TEXT NOT NULL,
    UNIQUE(task_id, kind, container_id, message_id));
  CREATE INDEX IF NOT EXISTS task_context_sources_container ON task_context_sources(container_id, task_id);
  CREATE TABLE IF NOT EXISTS task_context_bindings (run_id TEXT NOT NULL, task_id TEXT NOT NULL, conversation_id TEXT NOT NULL,
    updated_at TEXT NOT NULL, PRIMARY KEY(run_id, task_id));
  CREATE TABLE IF NOT EXISTS collaboration_requests (request_id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, result_id TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS team_chat_messages (id TEXT PRIMARY KEY, team_instance_id TEXT NOT NULL,
    sequence INTEGER NOT NULL, payload_json TEXT NOT NULL, UNIQUE(team_instance_id, sequence));
  CREATE TABLE IF NOT EXISTS team_chat_deliveries (id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES team_chat_messages(id),
    conversation_id TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', run_id TEXT, input_id TEXT,
    error TEXT, UNIQUE(message_id, conversation_id));
  CREATE INDEX IF NOT EXISTS team_chat_deliveries_pending ON team_chat_deliveries(conversation_id, status);
  CREATE TABLE IF NOT EXISTS team_chat_reads (team_instance_id TEXT NOT NULL, reader_id TEXT NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(team_instance_id, reader_id));
`;

type StoreContext = {
  conversation(id: string): ConversationSummary;
  team(id: string): TeamInstanceView;
  teamForConversation(id: string): TeamInstanceView | null;
  members(rootId: string): ConversationSummary[];
  binding(id: string): ConversationAgentBinding | null;
  sourceExists: (source: TaskSource) => boolean;
  message(conversationId: string, messageId: string): { content: string; role: "user" | "assistant"; createdAt: string } | null;
  outcome(conversationId: string, runId: string): { status: string; error: string | null } | null;
  isExecutionPaused(conversationId: string): boolean;
};

/** Durable task and team communication facts; member histories remain in ThreadLog. */
export class CollaborationStore {
  private sourceExists: StoreContext["sourceExists"];
  private readonly coordinatorRooms = new Map<string, { teamInstanceId: string; agentId: string }>();
  public constructor(private readonly db: DatabaseSync, private readonly context: StoreContext,
    private readonly journal = new TeamChatJournal(null)) {
    this.sourceExists = context.sourceExists;
    this.restoreJournal();
  }

  private groupFingerprint(value: string): string { return createHash("sha256").update(value).digest("hex"); }

  /** Export and verify original text before replacing SQL payloads with metadata. */
  private restoreJournal(): void {
    const rows = this.db.prepare("SELECT payload_json FROM team_chat_messages ORDER BY team_instance_id, sequence").all();
    for (const row of rows) {
      const message = teamChatMessageSchema.parse(JSON.parse(String(row.payload_json)));
      if (message.content.length === 0) continue;
      const requestRow = this.db.prepare("SELECT request_id, fingerprint FROM collaboration_requests WHERE result_id = ? AND request_id LIKE 'group:%'").get(message.id);
      let request: { id: string; fingerprint: string } | null = null;
      if (requestRow !== undefined) {
        const { senderId, ...raw } = z.object({ senderId: z.string().nullable() }).passthrough().parse(JSON.parse(String(requestRow.fingerprint)));
        request = { id: String(requestRow.request_id).slice(6), fingerprint: this.groupFingerprint(JSON.stringify({ ...postTeamChatInputSchema.parse(raw), senderId })) };
      }
      this.journal.appendMessage({ ...message, deliveries: this.messageDeliveries(message.id) }, request);
      if (this.journal.message(message.teamInstanceId, message.id)?.content !== message.content) throw new Error("Group history export verification failed.");
    }
    // JSONL is already durable. A failed SQL projection is recovered on the next start.
    for (const room of this.journal.rooms()) {
      for (const [agentId, conversationId] of this.journal.coordinators(room)) this.coordinatorRooms.set(conversationId, { teamInstanceId: room, agentId });
      const messages = this.journal.messages(room, this.journal.ids(room));
      this.write(() => {
        for (const message of messages) this.projectMessage(message);
        for (const [id, request] of this.journal.requests(room)) this.db.prepare(
          "INSERT INTO collaboration_requests VALUES (?, ?, ?) ON CONFLICT(request_id) DO UPDATE SET fingerprint = excluded.fingerprint, result_id = excluded.result_id",
        ).run(`group:${id}`, request.fingerprint, request.messageId);
      });
    }
  }

  private messageDeliveries(id: string) {
    return this.db.prepare("SELECT * FROM team_chat_deliveries WHERE message_id = ? ORDER BY rowid").all(id).map(row => teamChatDeliverySchema.parse({
      id: row.id, conversationId: row.conversation_id, status: row.status, runId: row.run_id, error: row.error,
    }));
  }
  private messageMetadata(message: TeamChatMessage): string {
    return JSON.stringify({ ...message, content: "", deliveries: [], coordinator: message.coordinator == null ? null : {
      agentId: message.coordinator.agentId, modelSelection: message.coordinator.modelSelection,
      status: message.coordinator.status, error: message.coordinator.error,
      conversationId: message.coordinator.conversationId, runId: message.coordinator.runId, userMessageId: message.coordinator.userMessageId,
      pendingMessageId: message.coordinator.pendingMessageId } });
  }
  private projectMessage(message: TeamChatMessage): void {
    this.db.prepare(`INSERT INTO team_chat_messages VALUES (?, ?, ?, ?) ON CONFLICT(id)
      DO UPDATE SET payload_json = excluded.payload_json WHERE team_chat_messages.payload_json <> excluded.payload_json`).run(message.id, message.teamInstanceId, message.sequence,
      this.messageMetadata(message));
    for (const delivery of message.deliveries) this.db.prepare(
      "INSERT OR IGNORE INTO team_chat_deliveries(id, message_id, conversation_id, status, run_id, error) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(delivery.id, message.id, delivery.conversationId, delivery.status, delivery.runId, delivery.error);
    if (message.supersedesId) this.db.prepare("UPDATE team_chat_deliveries SET status = 'cancelled', error = '消息已修订' WHERE message_id = ? AND status = 'pending'").run(message.supersedesId);
    if (message.taskContextId !== null && this.db.prepare("SELECT 1 FROM task_contexts WHERE id = ?").get(message.taskContextId) !== undefined) {
      if (this.task(message.taskContextId).teamInstanceId !== message.teamInstanceId) throw new CollaborationError("TASK_SCOPE", "Group source belongs to another room.");
      const source = taskSourceSchema.parse({ kind: "group", containerId: message.teamInstanceId, messageId: message.id,
        runId: message.sourceRunId, purpose: message.intent === "request" ? "request" : "result" });
      this.db.prepare("INSERT OR IGNORE INTO task_context_sources(task_id, kind, container_id, message_id, payload_json) VALUES (?, ?, ?, ?, ?)")
        .run(message.taskContextId, source.kind, source.containerId, source.messageId, JSON.stringify(source));
    }
  }
  public setSourceResolver(resolve: StoreContext["sourceExists"]): void { this.sourceExists = resolve; }

  private policyKey(scope: TaskContextScope): string {
    if (scope.teamInstanceId !== undefined) { this.context.team(scope.teamInstanceId); return `team:${scope.teamInstanceId}`; }
    if (scope.conversationId === undefined) throw new CollaborationError("TASK_SCOPE", "Task scope is required.");
    this.context.conversation(scope.conversationId); return `conversation:${scope.conversationId}`;
  }
  public getCompletionPolicy(scope: TaskContextScope): TaskCompletionPolicy {
    return { allowAgentCompletion: this.db.prepare("SELECT allow_agent_completion FROM task_completion_policies WHERE scope_key = ?").get(this.policyKey(scope))?.allow_agent_completion === 1 };
  }
  public setCompletionPolicy(input: SetTaskCompletionPolicyInput): TaskCompletionPolicy {
    this.db.prepare("INSERT INTO task_completion_policies VALUES (?, ?) ON CONFLICT(scope_key) DO UPDATE SET allow_agent_completion = excluded.allow_agent_completion")
      .run(this.policyKey(input), input.allowAgentCompletion ? 1 : 0);
    return { allowAgentCompletion: input.allowAgentCompletion };
  }

  public resolveReferences(input: ResolveChatReferencesInput): ChatReference[] {
    this.policyKey(input);
    const result: ChatReference[] = [];
    for (const id of new Set(input.ids.map(id => id.toLowerCase()))) {
      if (this.db.prepare("SELECT 1 FROM task_contexts WHERE id = ?").get(id) !== undefined) {
        let task: TaskContext;
        try {
          task = input.conversationId === undefined ? this.task(id) : this.assertTaskAccess(id, input.conversationId);
          if (input.teamInstanceId !== undefined && task.teamInstanceId !== input.teamInstanceId) continue;
        } catch (error) { if (error instanceof CollaborationError) continue; throw error; }
        result.push({ kind: "task", id, title: task.title, ownerConversationId: task.ownerConversationId, teamInstanceId: task.teamInstanceId });
      } else if (input.teamInstanceId !== undefined) {
        const row = this.db.prepare("SELECT 1 FROM team_chat_messages WHERE id = ? AND team_instance_id = ?").get(id, input.teamInstanceId);
        if (row === undefined) continue;
        const message = this.message(id);
        result.push({ kind: "message", id, sourceKind: "group", containerId: message.teamInstanceId, senderName: message.senderName, senderConversationId: message.senderConversationId,
          content: message.content.slice(0, 2000), createdAt: message.createdAt });
      } else if (input.conversationId !== undefined) {
        const message = this.context.message(input.conversationId, id);
        if (message !== null) result.push({ kind: "message", id, sourceKind: "conversation", containerId: input.conversationId,
          senderName: message.role === "user" ? "你" : this.context.conversation(input.conversationId).title,
          senderConversationId: message.role === "user" ? null : input.conversationId, content: message.content.slice(0, 2000), createdAt: message.createdAt });
      }
    }
    return result;
  }

  private userMessageCount(id: string): number {
    const row = this.db.prepare(`SELECT count(*) AS count FROM task_context_sources s
      WHERE s.task_id = ? AND ((s.kind = 'conversation' AND EXISTS (SELECT 1 FROM conversation_timeline t
        WHERE t.id = s.message_id AND t.conversation_id = s.container_id AND t.kind = 'message'
          AND json_extract(t.payload_json, '$.role') = 'user'
          AND substr(json_extract(t.payload_json, '$.content'), 1, 12) != '[Team group '))
      OR (s.kind = 'group' AND EXISTS (SELECT 1 FROM team_chat_messages m WHERE m.id = s.message_id
        AND m.team_instance_id = s.container_id AND json_extract(m.payload_json, '$.senderConversationId') IS NULL)))`).get(id);
    return Number(row?.count ?? 0);
  }

  private write<T>(operation: () => T): T {
    this.db.exec("SAVEPOINT collaboration_write");
    try { const result = operation(); this.db.exec("RELEASE collaboration_write"); return result; }
    catch (error) { this.db.exec("ROLLBACK TO collaboration_write; RELEASE collaboration_write"); throw error; }
  }

  private task(id: string): TaskContext {
    const row = this.db.prepare("SELECT payload_json FROM task_contexts WHERE id = ?").get(id);
    if (typeof row?.payload_json !== "string") throw new CollaborationError("TASK_NOT_FOUND", "Task context is unavailable.");
    return taskContextSchema.parse(JSON.parse(row.payload_json));
  }

  private conversationRoot(id: string): string {
    const seen = new Set<string>(); let current = this.context.conversation(id);
    while (current.parentConversationId !== null && !seen.has(current.id)) { seen.add(current.id); current = this.context.conversation(current.parentConversationId); }
    return current.id;
  }

  public assertTaskAccess(id: string, conversationId: string): TaskContext {
    const task = this.task(id); const conversation = this.context.conversation(conversationId);
    const sameTeam = task.teamInstanceId !== null && this.context.teamForConversation(conversationId)?.id === task.teamInstanceId;
    const linked = this.db.prepare("SELECT 1 FROM task_context_sources WHERE task_id = ? AND container_id = ? LIMIT 1").get(id, conversationId);
    let sameRoot = false;
    try { sameRoot = this.conversationRoot(task.ownerConversationId) === this.conversationRoot(conversationId); } catch { /* The source conversation may have been deleted. */ }
    if (task.ownerConversationId !== conversationId && !sameRoot && !sameTeam && linked === undefined
      && !(task.projectId !== null && task.projectId === conversation.projectId)) {
      throw new CollaborationError("TASK_SCOPE", "Task belongs to another conversation or project.");
    }
    return task;
  }

  public getTask(id: string, options: { beforeSourceSequence?: number | undefined; limit?: number | undefined } = {}): TaskContextDetail {
    const stored = this.task(id); const task = { ...stored, userMessageCount: this.userMessageCount(id) };
    const limit = options.limit ?? 20;
    const rows = this.db.prepare("SELECT sequence, payload_json FROM task_context_sources WHERE task_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?").all(id, options.beforeSourceSequence ?? Number.MAX_SAFE_INTEGER, limit + 1);
    return { task, nextBeforeSourceSequence: rows.length > limit ? Number(rows[limit - 1]!.sequence) : null, sources: rows.slice(0, limit).map(row => {
      const source = taskSourceSchema.parse(JSON.parse(String(row.payload_json)));
      let available = false; let title = "原始记录已删除";
      try {
        available = source.kind === "group" ? this.message(source.messageId).teamInstanceId === source.containerId : this.sourceExists(source);
        title = source.kind === "group" ? this.context.team(source.containerId).name : this.context.conversation(source.containerId).title;
      } catch { /* A source can be deleted while its task remains. */ }
      let content: string | null = null; let role: "user" | "assistant" | null = null; let createdAt: string | null = null;
      if (available) {
        if (source.kind === "group") { const message = this.message(source.messageId); content = message.content; role = message.senderConversationId === null ? "user" : "assistant"; createdAt = message.createdAt; }
        else { const message = this.context.message(source.containerId, source.messageId); if (message !== null) { content = message.content; role = content.startsWith("[Team group ") ? null : message.role; createdAt = message.createdAt; } }
      }
      return { ...source, available, title, sequence: Number(row.sequence), content, role, createdAt };
    }) };
  }

  public listTasks(raw: ListTaskContextsInput): TaskContextPage {
    const input = listTaskContextsInputSchema.parse(raw); const clauses = ["1 = 1"]; const params: SQLInputValue[] = [];
    if (input.conversationId !== undefined) {
      clauses.push("(owner_id = ? OR EXISTS (SELECT 1 FROM task_context_sources s WHERE s.task_id = task_contexts.id AND s.container_id = ?))");
      params.push(input.conversationId, input.conversationId);
    }
    if (input.projectId !== undefined) { clauses.push("project_id = ?"); params.push(input.projectId); }
    if (input.teamInstanceId !== undefined) { clauses.push("team_instance_id = ?"); params.push(input.teamInstanceId); }
    if (input.status !== undefined) { clauses.push("json_extract(payload_json, '$.status') = ?"); params.push(input.status); }
    clauses.push("json_extract(payload_json, '$.mergedIntoId') IS NULL");
    if (input.query) {
      const linked = this.db.prepare(`SELECT s.task_id, s.container_id, s.message_id FROM task_context_sources s
        WHERE s.kind = 'group' AND s.task_id IN (SELECT id FROM task_contexts WHERE ${clauses.join(" AND ")})`).all(...params);
      const matched = new Set<string>();
      const needle = input.query.toLowerCase();
      for (const roomId of new Set(linked.map(row => String(row.container_id)))) {
        const sources = linked.filter(row => row.container_id === roomId);
        const messages = this.journal.messages(roomId, [...new Set(sources.map(row => String(row.message_id)))]);
        const ids = new Set(messages.filter(message => message.senderConversationId === null && message.content.toLowerCase().includes(needle)).map(message => message.id));
        for (const source of sources) if (ids.has(String(source.message_id))) matched.add(String(source.task_id));
      }
      clauses.push(`(instr(lower(json_extract(payload_json, '$.title')), lower(?)) > 0
        OR instr(lower(json_extract(payload_json, '$.goal')), lower(?)) > 0
        OR EXISTS (SELECT 1 FROM task_context_sources s JOIN conversation_timeline t ON t.conversation_id = s.container_id AND t.id = s.message_id
          WHERE s.task_id = task_contexts.id AND s.kind = 'conversation' AND t.kind = 'message' AND json_extract(t.payload_json, '$.role') = 'user'
            AND substr(json_extract(t.payload_json, '$.content'), 1, 12) <> '[Team group '
            AND instr(lower(json_extract(t.payload_json, '$.content')), lower(?)) > 0)
        OR id IN (SELECT value FROM json_each(?)))`);
      params.push(input.query, input.query, input.query, JSON.stringify([...matched]));
    }
    const total = Number(this.db.prepare(`SELECT count(*) AS count FROM task_contexts WHERE ${clauses.join(" AND ")}`).get(...params)?.count ?? 0);
    if (input.beforeId !== undefined) {
      const before = this.task(input.beforeId);
      clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))"); params.push(before.updatedAt, before.updatedAt, before.id);
    }
    const rows = this.db.prepare(`SELECT payload_json FROM task_contexts WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...params, input.limit + 1);
    const items = rows.slice(0, input.limit).map(row => { const task = taskContextSchema.parse(JSON.parse(String(row.payload_json))); return { ...task, userMessageCount: this.userMessageCount(task.id) }; });
    const unclassified = input.conversationId === undefined ? [] : this.db.prepare(`SELECT t.id, t.run_id FROM conversation_timeline t
      WHERE t.conversation_id = ? AND t.kind = 'message' AND json_extract(t.payload_json, '$.role') = 'user'
      AND NOT EXISTS (SELECT 1 FROM task_context_sources s WHERE s.message_id = t.id AND s.container_id = t.conversation_id)
      AND t.run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM task_context_bindings b WHERE b.run_id = t.run_id)
      ORDER BY t.sequence DESC LIMIT 10`).all(input.conversationId).map(row => taskSourceSchema.parse({
        kind: "conversation", containerId: input.conversationId, messageId: row.id, runId: row.run_id, purpose: "request",
      }));
    return { items, nextBeforeId: rows.length > input.limit ? items.at(-1)?.id ?? null : null, unclassified, total };
  }

  public syncWorkItems(items: readonly TeamWorkItemView[]): void {
    for (const item of items) {
      const team = item.teamInstanceId === undefined ? null : this.context.team(item.teamInstanceId);
      const ownerId = item.executionConversationId ?? team?.rootConversationId ?? item.sourceConversationId;
      if (ownerId === null || ownerId === undefined) continue;
      const previousRow = this.db.prepare("SELECT payload_json FROM task_contexts WHERE id = ?").get(item.id);
      const previous = previousRow === undefined ? null : taskContextSchema.parse(JSON.parse(String(previousRow.payload_json)));
      const status = ["completed", "failed", "cancelled", "blocked"].includes(item.status) ? item.status
        : ["inbox", "triaging", "needs_clarification", "planned", "queued"].includes(item.status) ? "pending" : "running";
      if (previous !== null && previous.updatedAt === item.updatedAt && previous.status === status) continue;
      this.write(() => this.saveTask(taskContextSchema.parse({
        id: item.id, title: item.title, goal: item.requirement.slice(0, 4000),
        summary: (item.resultSummary ?? item.blockedReason ?? "").slice(0, 4000),
        decisions: previous?.decisions ?? "", nextStep: previous?.nextStep ?? "", status,
        ownerConversationId: ownerId, projectId: item.projectId, teamInstanceId: item.teamInstanceId ?? null,
        workItemId: item.id, workItemStatus: item.status, revision: (previous?.revision ?? 0) + 1,
        createdAt: item.createdAt, updatedAt: item.updatedAt, mergedIntoId: previous?.mergedIntoId ?? null,
      })));
    }
  }

  public updateTask(raw: UpdateTaskContextInput, actor: "user" | "agent" = "user"): TaskContext {
    const input = updateTaskContextInputSchema.parse(raw); const fingerprint = JSON.stringify(input);
    return this.write(() => {
      const saved = this.db.prepare("SELECT * FROM collaboration_requests WHERE request_id = ?").get(`task:${input.requestId}`);
      if (saved !== undefined) {
        if (saved.fingerprint !== fingerprint) throw new CollaborationError("IDEMPOTENCY_CONFLICT", "Request content changed.");
        return this.task(String(saved.result_id));
      }
      const owner = this.context.conversation(input.conversationId);
      const previous = input.id === undefined ? null : this.assertTaskAccess(input.id, input.conversationId);
      if (previous?.workItemId) throw new CollaborationError("TASK_MANAGED", "Use the WorkItem lifecycle to change this task.");
      if (previous?.mergedIntoId) throw new CollaborationError("TASK_MERGED", `Use ${previous.mergedIntoId}.`);
      if (previous !== null && previous.revision !== input.expectedRevision) throw new CollaborationError("TASK_REVISION_CONFLICT", "Read the current revision before updating.");
      if (previous !== null && previous.ownerConversationId !== owner.id && !(owner.threadKind === "team_lead" && previous.teamInstanceId !== null && this.context.teamForConversation(owner.id)?.id === previous.teamInstanceId)) throw new CollaborationError("TASK_OWNER", "Only the owner maintains the overall summary; link member results instead.");
      const now = new Date().toISOString();
      const teamInstanceId = previous?.teamInstanceId ?? this.context.teamForConversation(owner.id)?.id ?? null;
      const completionRequested = actor === "agent" && input.status === "completed" && !this.getCompletionPolicy(teamInstanceId !== null && (input.source?.kind === "group"
        || this.db.prepare("SELECT 1 FROM task_context_sources WHERE task_id = ? AND kind = 'group' LIMIT 1").get(previous?.id ?? "") !== undefined)
        ? { teamInstanceId } : { conversationId: previous?.ownerConversationId ?? owner.id }).allowAgentCompletion;
      const task = taskContextSchema.parse({
        id: previous?.id ?? randomUUID(), title: input.title, goal: input.goal, summary: input.summary,
        decisions: input.decisions, nextStep: input.nextStep, status: completionRequested ? previous?.status === "completed" ? "completed" : previous?.status ?? "running" : input.status,
        completionRequested: completionRequested && previous?.status !== "completed",
        completedBy: completionRequested && previous?.status === "completed" ? previous.completedBy ?? null : !completionRequested && input.status === "completed" ? actor : null,
        ownerConversationId: previous?.ownerConversationId ?? owner.id, projectId: previous?.projectId ?? owner.projectId,
        teamInstanceId,
        workItemId: previous?.workItemId ?? null, createdAt: previous?.createdAt ?? now, updatedAt: now,
        revision: (previous?.revision ?? 0) + 1, mergedIntoId: null,
      });
      this.saveTask(task);
      if (input.source !== undefined) this.linkTask({ id: task.id, source: input.source });
      this.db.prepare("INSERT INTO collaboration_requests VALUES (?, ?, ?)").run(`task:${input.requestId}`, fingerprint, task.id);
      return task;
    });
  }

  private saveTask(task: TaskContext): void {
    this.db.prepare(`INSERT INTO task_contexts VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET owner_id = excluded.owner_id, project_id = excluded.project_id,
        team_instance_id = excluded.team_instance_id, work_item_id = excluded.work_item_id,
        updated_at = excluded.updated_at, payload_json = excluded.payload_json`)
      .run(task.id, task.ownerConversationId, task.projectId, task.teamInstanceId, task.workItemId, task.updatedAt, JSON.stringify(task));
    this.db.prepare("INSERT INTO task_context_revisions VALUES (?, ?, ?)").run(task.id, task.revision, JSON.stringify(task));
  }

  public linkTask(raw: LinkTaskContextInput): void {
    const task = this.task(raw.id); const source = taskSourceSchema.parse(raw.source);
    if (raw.remove) {
      this.db.prepare("DELETE FROM task_context_sources WHERE task_id = ? AND kind = ? AND container_id = ? AND message_id = ?")
        .run(task.id, source.kind, source.containerId, source.messageId); return;
    }
    if (source.kind === "group") {
      if (this.message(source.messageId).teamInstanceId !== source.containerId || task.teamInstanceId !== source.containerId) throw new CollaborationError("TASK_SCOPE", "Group source belongs to another room.");
    } else {
      const origin = this.context.conversation(source.containerId);
      const sameTeam = task.teamInstanceId !== null && this.context.teamForConversation(origin.id)?.id === task.teamInstanceId;
      let sameRoot = false;
      try { sameRoot = this.conversationRoot(origin.id) === this.conversationRoot(task.ownerConversationId); } catch { /* The owner can have been deleted. */ }
      if (origin.id !== task.ownerConversationId && !sameTeam && !sameRoot && origin.projectId !== task.projectId) throw new CollaborationError("TASK_SCOPE", "Source belongs to another project.");
      if (!this.sourceExists(source)) throw new CollaborationError("TASK_SOURCE_NOT_FOUND", "Source message is unavailable.");
    }
    this.db.prepare("INSERT OR IGNORE INTO task_context_sources(task_id, kind, container_id, message_id, payload_json) VALUES (?, ?, ?, ?, ?)")
      .run(task.id, source.kind, source.containerId, source.messageId, JSON.stringify(source));
  }

  public mergeTasks(input: MergeTaskContextsInput): TaskContext {
    return this.write(() => {
      const source = this.task(input.id); const target = this.task(input.intoId);
      if (source.workItemId !== null || target.workItemId !== null) throw new CollaborationError("TASK_MANAGED", "WorkItems retain their own lifecycle and cannot be merged here.");
      if (source.id === target.id || target.mergedIntoId !== null || source.mergedIntoId !== null) throw new CollaborationError("TASK_MERGE", "Select two active directory entries.");
      if (source.revision !== input.expectedRevision) throw new CollaborationError("TASK_REVISION_CONFLICT", "Task changed.");
      if (source.projectId !== target.projectId || source.teamInstanceId !== target.teamInstanceId) throw new CollaborationError("TASK_SCOPE", "Cannot merge different scopes.");
      this.db.prepare(`INSERT OR IGNORE INTO task_context_sources(task_id, kind, container_id, message_id, payload_json)
        SELECT ?, kind, container_id, message_id, payload_json FROM task_context_sources WHERE task_id = ?`).run(target.id, source.id);
      this.db.prepare("UPDATE task_context_bindings SET task_id = ? WHERE task_id = ? AND run_id NOT IN (SELECT run_id FROM task_context_bindings WHERE task_id = ?)").run(target.id, source.id, target.id);
      this.saveTask({ ...source, mergedIntoId: target.id, revision: source.revision + 1, updatedAt: new Date().toISOString() });
      return target;
    });
  }

  public bindTask(runId: string, taskId: string, conversationId: string): void {
    this.assertTaskAccess(taskId, conversationId);
    this.db.prepare(`INSERT INTO task_context_bindings VALUES (?, ?, ?, ?)
      ON CONFLICT(run_id, task_id) DO UPDATE SET updated_at = excluded.updated_at`)
      .run(runId, taskId, conversationId, new Date().toISOString());
  }
  public runTasks(runId: string): TaskContext[] {
    return this.db.prepare("SELECT task_id FROM task_context_bindings WHERE run_id = ? ORDER BY updated_at DESC, rowid DESC").all(runId).map(row => this.task(String(row.task_id)));
  }

  public members(teamInstanceId: string): TeamChatMember[] {
    const instance = this.context.team(teamInstanceId);
    if (instance.rootConversationId === null) return [];
    const lead = this.context.conversation(instance.rootConversationId);
    return [...new Map([lead, ...this.context.members(teamInstanceId)].map(member => [member.id, member])).values()].map(member => ({
      conversationId: member.id, name: this.context.binding(member.id)?.name ?? member.title,
      role: this.context.binding(member.id)?.role ?? (member.id === lead.id ? "负责人" : "成员"),
      isLead: member.threadKind === "team_lead", isArchived: member.isArchived,
    }));
  }
  public executionMembers(teamInstanceId: string): ConversationSummary[] {
    const root = this.context.team(teamInstanceId).rootConversationId;
    if (root === null) return [];
    return [...new Map([this.context.conversation(root), ...this.context.members(teamInstanceId)].map(member => [member.id, member])).values()]
      .filter(member => !member.isArchived && member.teamWorkItemId == null && member.threadKind !== "subagent");
  }
  private assertMember(teamInstanceId: string, conversationId: string | null, allowArchived = false): void {
    const instance = this.context.team(teamInstanceId);
    if (instance.isArchived && !allowArchived) throw new CollaborationError("TEAM_ARCHIVED", "The room is archived.");
    if (conversationId !== null && !this.members(teamInstanceId).some(member => member.conversationId === conversationId && !member.isArchived)) throw new CollaborationError("TEAM_MEMBER", "Sender is not an active room member.");
  }
  public message(id: string): TeamChatMessage {
    const row = this.db.prepare("SELECT team_instance_id, payload_json FROM team_chat_messages WHERE id = ?").get(id);
    if (typeof row?.team_instance_id !== "string") throw new CollaborationError("GROUP_MESSAGE_NOT_FOUND", "Message is unavailable.");
    const message = this.journal.message(row.team_instance_id, id);
    if (message === null) throw new Error("Canonical group history is missing; SQL metadata cannot replace it.");
    let deliveries = this.messageDeliveries(id);
    if (row.payload_json !== this.messageMetadata(message) || deliveries.length !== message.deliveries.length) {
      this.write(() => this.projectMessage(message)); deliveries = this.messageDeliveries(id);
    }
    return { ...message, deliveries };
  }
  public postMessage(raw: PostTeamChatInput, senderId: string | null, runId: string | null = null, causeId: string | null = null): TeamChatMessage {
    const input = postTeamChatInputSchema.parse(raw); this.assertMember(input.teamInstanceId, senderId);
    const fingerprint = this.groupFingerprint(JSON.stringify({ ...input, senderId }));
    const canonical = this.journal.request(input.teamInstanceId, input.requestId);
    if (canonical !== undefined) {
      if (canonical.fingerprint !== fingerprint) throw new CollaborationError("IDEMPOTENCY_CONFLICT", "Message content changed.");
      const message = this.journal.message(input.teamInstanceId, canonical.messageId)!;
      this.write(() => {
        this.projectMessage(message);
        this.db.prepare("INSERT OR IGNORE INTO collaboration_requests VALUES (?, ?, ?)").run(`group:${input.requestId}`, fingerprint, message.id);
      });
      return this.message(message.id);
    }
    {
      const saved = this.db.prepare("SELECT * FROM collaboration_requests WHERE request_id = ?").get(`group:${input.requestId}`);
      if (saved !== undefined) {
        if (saved.fingerprint !== fingerprint) throw new CollaborationError("IDEMPOTENCY_CONFLICT", "Message content changed.");
        return this.message(String(saved.result_id));
      }
      const members = this.members(input.teamInstanceId); const active = members.filter(member => !member.isArchived);
      const instance = this.context.team(input.teamInstanceId);
      const parent = causeId === null && input.replyToId === null ? null : this.message(causeId ?? input.replyToId!);
      if (parent !== null && parent.teamInstanceId !== instance.id) throw new CollaborationError("TEAM_SCOPE", "Reply belongs to another room.");
      if (input.taskContextId !== null && this.task(input.taskContextId).teamInstanceId !== instance.id) throw new CollaborationError("TASK_SCOPE", "Task belongs to another team.");
      let recipients: string[] = [];
      if (input.intent === "request") {
        if (input.allMembers) recipients = active.map(member => member.conversationId).filter(id => id !== senderId);
        else if (input.recipientConversationIds.length > 0) recipients = input.recipientConversationIds;
        else if (senderId === null && instance.rootConversationId !== null) {
          recipients = addressedUserRecipients(input.content, active);
          if (recipients.length === 0 && input.coordinator === undefined) recipients = [instance.rootConversationId];
        }
        if (senderId === null && input.replyToId !== null) {
          const quoted = this.message(input.replyToId);
          if (quoted.teamInstanceId !== instance.id) throw new CollaborationError("TEAM_SCOPE", "Reply belongs to another room.");
          if (quoted.senderConversationId !== null && !input.allMembers) {
            if (!active.some(member => member.conversationId === quoted.senderConversationId)) throw new CollaborationError("TEAM_MEMBER", "被回复的成员已不可用，请重新选择成员。");
            recipients = [...new Set([quoted.senderConversationId, ...input.recipientConversationIds, ...addressedUserRecipients(input.content, active)])];
          }
        }
        for (const id of recipients) if (id === senderId || !active.some(member => member.conversationId === id)) throw new CollaborationError("TEAM_MEMBER", "Recipient must be another active room member.");
      }
      const lastSequence = this.journal.lastSequence(instance.id);
      const id = randomUUID();
      const fileReferences = input.fileReferences?.map(reference => {
        if (reference.sourceMessageId === undefined) {
          if (senderId === null) throw new CollaborationError("TEAM_SOURCE", "请引用成员已经公开的成果消息。");
          return { ...reference, sourceMessageId: id, conversationId: senderId };
        }
        const source = this.message(reference.sourceMessageId);
        if (source.teamInstanceId !== instance.id) throw new CollaborationError("TEAM_SCOPE", "成果来源不属于当前群。");
        const forwarded = source.fileReferences?.find(file => file.path === reference.path);
        if (forwarded === undefined) throw new CollaborationError("TEAM_SOURCE", "文件尚未发布可转交引用，请原作者使用 fileReferences 补发原文件引用，无需复制或重写文件。");
        if (!members.some(member => member.conversationId === forwarded.conversationId)) throw new CollaborationError("TEAM_MEMBER", "成果来源成员已不可用。");
        return { ...reference, conversationId: forwarded.conversationId };
      });
      if (fileReferences !== undefined && new Set(fileReferences.map(file => file.path)).size !== fileReferences.length) throw new CollaborationError("TEAM_SOURCE", "同一交付消息中的文件路径不能重复。");
      const projectedSequence = Number(this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS last FROM team_chat_messages WHERE team_instance_id = ?").get(instance.id)?.last);
      if (lastSequence < projectedSequence) throw new Error("Canonical group history is missing or truncated; original records were preserved.");
      const sequence = lastSequence + 1;
      if (input.supersedesId !== null) {
        const original = this.message(input.supersedesId);
        const latest = this.db.prepare("SELECT id FROM team_chat_messages WHERE team_instance_id = ? AND json_extract(payload_json, '$.senderConversationId') IS NULL ORDER BY sequence DESC LIMIT 1").get(instance.id);
        if (senderId !== null || original.teamInstanceId !== instance.id || latest?.id !== original.id) throw new CollaborationError("GROUP_EDIT_INVALID", "只能编辑自己最近的一条群消息。");
        if (original.coordinator?.status === "pending" || original.deliveries.some(delivery => ["consumed", "delivered"].includes(delivery.status))) throw new CollaborationError("GROUP_EDIT_BUSY", "请等待这条消息处理结束，或停止相关成员后再编辑。");
      }
      const message = teamChatMessageSchema.parse({
        id, teamInstanceId: instance.id, sequence, content: input.content,
        senderConversationId: senderId, senderName: senderId === null ? "你" : members.find(member => member.conversationId === senderId)?.name,
        intent: input.intent, recipientConversationIds: recipients, allMembers: input.allMembers,
        ...(fileReferences === undefined ? {} : { fileReferences }), taskContextId: input.taskContextId ?? parent?.taskContextId ?? null,
        replyToId: input.replyToId, createdAt: new Date().toISOString(), sourceRunId: runId,
        rootMessageId: parent?.rootMessageId ?? id,
        depth: senderId === null ? 0 : (parent?.depth ?? 0) + 1, deliveries: [],
        coordinator: senderId === null && input.coordinator !== undefined ? { ...input.coordinator,
          status: recipients.length === 0 && input.intent === "request" ? "pending" : "completed", error: null,
          contextSummary: this.coordinator(instance.id)?.contextSummary ?? "",
          ...(recipients.length === 0 && input.intent === "request" ? {} : { steps: [{ type: "completed", at: new Date().toISOString(),
            detail: input.intent === "notify" ? "通知仅发布，不唤醒成员。" : input.allMembers ? "按全员请求直接投递，未调用协调模型。"
              : "按明确点名的成员直接投递，未调用协调模型。", recipientConversationIds: recipients }] }) } : null,
        supersedesId: input.supersedesId,
      });
      message.deliveries = recipients.map(conversationId => ({ id: randomUUID(), conversationId, runId: null,
        status: message.depth > (message.taskContextId === null ? 4 : 12) ? "failed" : "pending",
        error: message.depth > (message.taskContextId === null ? 4 : 12) ? "讨论已暂停：达到自动协作深度上限。" : null }));
      this.journal.appendMessage(message, { id: input.requestId, fingerprint });
      return this.write(() => {
      this.projectMessage(message);
      this.db.prepare("INSERT INTO collaboration_requests VALUES (?, ?, ?)").run(`group:${input.requestId}`, fingerprint, id);
      return this.message(id);
      });
    }
  }
  public hasGroupRequest(teamInstanceId: string, requestId: string): boolean {
    return this.journal.request(teamInstanceId, requestId) !== undefined
      || this.db.prepare("SELECT 1 FROM collaboration_requests WHERE request_id = ?").get(`group:${requestId}`) !== undefined;
  }
  public coordinator(teamInstanceId: string) {
    const row = this.db.prepare("SELECT payload_json FROM team_chat_messages WHERE team_instance_id = ? AND json_extract(payload_json, '$.coordinator') IS NOT NULL ORDER BY sequence DESC LIMIT 1").get(teamInstanceId);
    if (row === undefined) return null;
    const metadata = teamChatMessageSchema.parse(JSON.parse(String(row.payload_json)));
    return this.journal.message(teamInstanceId, metadata.id)?.coordinator ?? null;
  }
  public coordinatorRoom(conversationId: string) { return this.coordinatorRooms.get(conversationId) ?? null; }
  public coordinatorConversation(teamInstanceId: string): string | null {
    return this.journal.coordinators(teamInstanceId)[0]?.[1] ?? null;
  }
  public bindCoordinatorConversation(teamInstanceId: string, agentId: string, conversationId: string): void {
    this.context.team(teamInstanceId);
    const previous = this.coordinatorConversation(teamInstanceId);
    this.journal.bindCoordinator(teamInstanceId, agentId, conversationId);
    if (previous !== null) this.coordinatorRooms.delete(previous);
    this.coordinatorRooms.set(conversationId, { teamInstanceId, agentId });
  }
  public coordinatorConversations(teamInstanceId: string): ConversationSummary[] {
    return this.journal.coordinators(teamInstanceId).map(([, id]) => this.context.conversation(id));
  }
  public attachCoordinationRun(id: string, reference: { conversationId: string; runId?: string; userMessageId?: string; pendingMessageId?: string }): void {
    const message = this.message(id);
    if (message.coordinator?.status !== "pending") return;
    const room = this.coordinatorRoom(reference.conversationId);
    if (room?.teamInstanceId !== message.teamInstanceId || this.context.binding(reference.conversationId)?.id !== message.coordinator.agentId) throw new Error("Coordination conversation belongs to another owner.");
    const next = { ...message, coordinator: { ...message.coordinator, ...reference } };
    this.journal.coordinate(next); this.write(() => this.projectMessage(next));
  }
  public coordinationForRun(runId: string): TeamChatMessage | null {
    const row = this.db.prepare("SELECT id FROM team_chat_messages WHERE json_extract(payload_json, '$.coordinator.runId') = ? LIMIT 1").get(runId);
    return row === undefined ? null : this.message(String(row.id));
  }
  public recordCoordinationStep(id: string, step: TeamChatCoordinationStep): void {
    const message = this.message(id);
    if (message.coordinator?.status !== "pending") return;
    this.journal.coordinationStep(message.teamInstanceId, id, step);
  }
  public finishCoordination(id: string, recipients: string[], error: string | null, contextSummary?: string, decisionSummary?: string): TeamChatMessage {
    const current = this.message(id);
    if (current.coordinator?.status === "cancelled" || current.coordinator?.status === "paused") return current;
    this.assertMember(current.teamInstanceId, null, error !== null);
    if (current.coordinator == null) throw new Error("Group message has no coordinator.");
    if (current.coordinator.status === "completed") return current;
    if (recipients.length === 0 && error === null) throw new Error("Coordination must select at least one member.");
    const active = this.members(current.teamInstanceId).filter(member => !member.isArchived);
    if (new Set(recipients).size !== recipients.length || recipients.some(id => !active.some(member => member.conversationId === id))) throw new Error("Coordination selected an unavailable member.");
    const message: TeamChatMessage = { ...current, recipientConversationIds: recipients,
      coordinator: { ...current.coordinator, status: error === null ? "completed" : "failed", error,
        ...(contextSummary === undefined ? {} : { contextSummary }) },
      deliveries: recipients.map(conversationId => ({ id: randomUUID(), conversationId, status: "pending", runId: null, error: null })) };
    this.journal.coordinate(message, { type: error === null ? "completed" : "failed", at: new Date().toISOString(),
      detail: (error ?? decisionSummary ?? "已选择回答成员。").slice(0, 2000), recipientConversationIds: recipients });
    this.write(() => this.projectMessage(message)); return this.message(id);
  }
  public beginCoordination(id: string): TeamChatMessage {
    const message = this.message(id);
    if (message.coordinator?.status !== "failed" && message.coordinator?.status !== "paused") return message;
    const pending: TeamChatMessage = { ...message, coordinator: { ...message.coordinator, status: "pending", error: null } };
    this.journal.coordinate(pending); this.write(() => this.projectMessage(pending)); return this.message(id);
  }
  public pendingCoordinations(teamInstanceId: string): string[] {
    return this.db.prepare("SELECT id FROM team_chat_messages WHERE team_instance_id = ? AND json_extract(payload_json, '$.coordinator.status') = 'pending'")
      .all(teamInstanceId).map(row => String(row.id));
  }
  public pauseCoordination(id: string): void {
    const message = this.message(id);
    if (message.coordinator?.status !== "pending") return;
    const paused: TeamChatMessage = { ...message, coordinator: { ...message.coordinator, status: "paused", error: null } };
    this.journal.coordinate(paused, { type: "paused", at: new Date().toISOString(), detail: "用户已暂停本群协调。" });
    this.write(() => this.projectMessage(paused));
  }
  public readMessages(raw: ReadTeamChatInput, memberId: string | null = null): TeamChatPage {
    const input = readTeamChatInputSchema.parse(raw); this.assertMember(input.teamInstanceId, memberId, true);
    const ascending = input.afterSequence !== undefined;
    const searching = input.query !== undefined || input.senderConversationId !== undefined || input.createdAfter !== undefined || input.createdBefore !== undefined;
    const scanLimit = searching ? 100 : input.limit;
    const rows = this.db.prepare(`SELECT id, sequence, payload_json FROM team_chat_messages WHERE team_instance_id = ? AND sequence < ? AND sequence > ?
      AND (? = 0 OR json_extract(payload_json, '$.senderConversationId') IS ?)
      AND (? IS NULL OR json_extract(payload_json, '$.createdAt') >= ?)
      AND (? IS NULL OR json_extract(payload_json, '$.createdAt') <= ?)
      ORDER BY sequence ${ascending ? "ASC" : "DESC"} LIMIT ?`)
      .all(input.teamInstanceId, input.beforeSequence ?? Number.MAX_SAFE_INTEGER, input.afterSequence ?? 0,
        input.senderConversationId === undefined ? 0 : 1, input.senderConversationId ?? null,
        input.createdAfter ?? null, input.createdAfter ?? null, input.createdBefore ?? null, input.createdBefore ?? null, scanLimit + 1);
    const candidates = this.journal.messages(input.teamInstanceId, rows.slice(0, scanLimit).map(row => String(row.id)));
    if (candidates.length !== Math.min(rows.length, scanLimit)) throw new Error("Canonical group messages are missing; SQL metadata cannot replace them.");
    const matches = candidates.filter(message => input.query === undefined || message.content.toLocaleLowerCase().includes(input.query.toLocaleLowerCase()));
    const selected = matches.slice(0, input.limit)
      .map(message => {
        let deliveries = this.messageDeliveries(message.id);
        if (rows.find(row => row.id === message.id)?.payload_json !== this.messageMetadata(message) || deliveries.length !== message.deliveries.length) {
          this.write(() => this.projectMessage(message)); deliveries = this.messageDeliveries(message.id);
        }
        return { ...message, deliveries };
      });
    const messages = ascending ? selected : selected.reverse();
    const read = (reader: string) => Number(this.db.prepare("SELECT sequence FROM team_chat_reads WHERE team_instance_id = ? AND reader_id = ?").get(input.teamInstanceId, reader)?.sequence ?? 0);
    const coordinator = this.coordinator(input.teamInstanceId);
    const coordinatorActive = this.coordinatorConversations(input.teamInstanceId).some(conversation => conversation.activeRunId !== null);
    const members = this.executionMembers(input.teamInstanceId);
    const activeMemberCount = members.filter(member => member.activeRunId !== null).length;
    const pendingDeliveryCount = Number(this.db.prepare("SELECT COUNT(*) AS count FROM team_chat_deliveries d JOIN team_chat_messages m ON m.id = d.message_id WHERE m.team_instance_id = ? AND d.status = 'pending' AND d.error IS NULL").get(input.teamInstanceId)?.count ?? 0);
    const paused = members.length > 0 && members.every(member => this.context.isExecutionPaused(member.id));
    const hasMore = matches.length > input.limit || rows.length > scanLimit;
    const lastScanned = matches.length > input.limit ? matches[input.limit - 1]?.sequence : rows[Math.min(rows.length, scanLimit) - 1]?.sequence;
    return { messages, nextBeforeSequence: searching ? hasMore ? Number(lastScanned) : null : rows.length > input.limit ? messages[0]?.sequence ?? null : null,
      userReadSequence: read("user"), memberReadSequence: memberId === null ? 0 : read(memberId),
      activity: { status: paused ? "paused" : coordinatorActive || this.pendingCoordinations(input.teamInstanceId).length > 0 ? "coordinating"
        : activeMemberCount > 0 || pendingDeliveryCount > 0 ? "working" : coordinator?.status === "failed" ? "failed" : "idle", activeMemberCount, pendingDeliveryCount },
      coordinator: coordinator === null ? null : { agentId: coordinator.agentId, modelSelection: coordinator.modelSelection } };
  }
  public markRead(input: MarkTeamChatReadInput, memberId: string | null): void {
    this.assertMember(input.teamInstanceId, memberId, true);
    const max = Number(this.db.prepare("SELECT COALESCE(MAX(sequence), 0) AS last FROM team_chat_messages WHERE team_instance_id = ?").get(input.teamInstanceId)?.last);
    if (input.throughSequence > max) throw new CollaborationError("READ_RANGE", "Cannot mark unseen future messages.");
    this.db.prepare(`INSERT INTO team_chat_reads VALUES (?, ?, ?) ON CONFLICT(team_instance_id, reader_id)
      DO UPDATE SET sequence = MAX(sequence, excluded.sequence)`).run(input.teamInstanceId, memberId ?? "user", input.throughSequence);
  }
  public pendingDeliveries(): { id: string; conversationId: string; message: TeamChatMessage }[] {
    return this.db.prepare("SELECT id, message_id, conversation_id FROM team_chat_deliveries WHERE status = 'pending' AND error IS NULL ORDER BY rowid LIMIT 100").all()
      .map(row => ({ id: String(row.id), conversationId: String(row.conversation_id), message: this.message(String(row.message_id)) }));
  }
  public consumeDelivery(id: string, runId: string, inputId?: string): void {
    this.db.prepare("UPDATE team_chat_deliveries SET status = 'consumed', run_id = ?, input_id = COALESCE(?, input_id) WHERE id = ? AND status IN ('pending','delivered')")
      .run(runId, inputId ?? null, id);
    const row = this.db.prepare("SELECT message_id FROM team_chat_deliveries WHERE id = ?").get(id);
    if (row !== undefined) this.relateRun(runId, String(row.message_id));
  }
  public deliver(id: string, inputId: string): void {
    this.db.prepare("UPDATE team_chat_deliveries SET status = 'delivered', input_id = ? WHERE id = ? AND status = 'pending'").run(inputId, id);
  }
  public bindInput(inputId: string, runId: string, messageId: string): void {
    const coordination = this.db.prepare("SELECT id FROM team_chat_messages WHERE json_extract(payload_json, '$.coordinator.pendingMessageId') = ? AND json_extract(payload_json, '$.coordinator.status') = 'pending'").get(inputId);
    if (coordination !== undefined) {
      const source = this.message(String(coordination.id));
      if (source.coordinator?.conversationId !== undefined) this.attachCoordinationRun(source.id, { conversationId: source.coordinator.conversationId, runId, userMessageId: messageId });
    }
    const row = this.db.prepare("SELECT id, message_id, conversation_id FROM team_chat_deliveries WHERE input_id = ? AND status = 'delivered'").get(inputId);
    if (row !== undefined) {
      this.consumeDelivery(String(row.id), runId, messageId);
      const message = this.message(String(row.message_id));
      if (message.taskContextId !== null) {
        this.bindTask(runId, message.taskContextId, String(row.conversation_id));
        this.linkTask({ id: message.taskContextId, source: { kind: "conversation", containerId: String(row.conversation_id), messageId, runId, purpose: "request" } });
      }
    }
  }
  public runMessages(runId: string): TeamChatMessage[] {
    return this.db.prepare("SELECT message_id FROM team_chat_run_sources WHERE run_id = ? UNION SELECT message_id FROM team_chat_deliveries WHERE run_id = ?").all(runId, runId).map(row => this.message(String(row.message_id)));
  }
  public assignedRunMessages(runId: string): TeamChatMessage[] {
    return this.db.prepare("SELECT message_id FROM team_chat_deliveries WHERE run_id = ? ORDER BY rowid").all(runId).map(row => this.message(String(row.message_id)));
  }
  public relateRun(runId: string, messageId: string): void {
    this.db.prepare("INSERT OR IGNORE INTO team_chat_run_sources VALUES (?, ?)").run(runId, messageId);
  }
  public deliverySource(id: string): TeamChatMessage | null {
    const row = this.db.prepare("SELECT message_id FROM team_chat_deliveries WHERE id = ?").get(id);
    return row === undefined ? null : this.message(String(row.message_id));
  }
  public recoveryConversationIds(): string[] {
    return this.db.prepare("SELECT DISTINCT conversation_id FROM team_chat_deliveries WHERE status IN ('consumed','delivered')").all().map(row => String(row.conversation_id));
  }
  public publicMessagesForRun(runId: string): string[] {
    return this.db.prepare("SELECT id FROM team_chat_messages WHERE json_extract(payload_json, '$.sourceRunId') = ? ORDER BY rowid DESC LIMIT 20").all(runId).map(row => String(row.id));
  }
  public receiptsToRecover(runId?: string) {
    return this.db.prepare(`SELECT * FROM team_chat_deliveries WHERE status IN ('completed','failed','cancelled')
      AND receipt_recorded = 0 AND (? IS NULL OR run_id = ?) ORDER BY rowid LIMIT 100`).all(runId ?? null, runId ?? null)
      .map(row => ({ id: String(row.id), conversationId: String(row.conversation_id), runId: row.run_id === null ? null : String(row.run_id),
        status: teamChatDeliverySchema.shape.status.parse(row.status), error: row.error === null ? null : String(row.error), message: this.message(String(row.message_id)) }));
  }
  public receiptRecorded(id: string): void {
    this.db.prepare("UPDATE team_chat_deliveries SET receipt_recorded = 1 WHERE id = ?").run(id);
  }
  public resumeDelivery(id: string): void {
    this.db.prepare("UPDATE team_chat_deliveries SET error = NULL WHERE id = ? AND status = 'pending'").run(id);
  }
  public hasDelivery(id: string): boolean { return this.db.prepare("SELECT 1 FROM team_chat_deliveries WHERE id = ?").get(id) !== undefined; }
  public finishRun(runId: string, status: "completed" | "failed" | "cancelled", error: string | null): void {
    this.db.prepare("UPDATE team_chat_deliveries SET status = ?, error = ? WHERE run_id = ? AND status IN ('consumed','delivered')").run(status, error, runId);
  }
  public cancelDelivery(id: string): void {
    this.db.prepare("UPDATE team_chat_deliveries SET status = 'cancelled', error = '用户已取消投递' WHERE id = ? AND status = 'pending'").run(id);
  }
  public cancelPending(conversationId: string): void {
    this.db.prepare("UPDATE team_chat_deliveries SET status = 'cancelled', error = '成员已停止' WHERE conversation_id = ? AND status = 'pending'").run(conversationId);
  }
  public cancelRoom(teamInstanceId: string): void {
    for (const row of this.db.prepare("SELECT id FROM team_chat_messages WHERE team_instance_id = ? AND json_extract(payload_json, '$.coordinator.status') IN ('pending', 'failed', 'paused')").all(teamInstanceId)) {
      const message = this.message(String(row.id));
      if (message.coordinator != null) {
        const cancelled: TeamChatMessage = { ...message, coordinator: { ...message.coordinator, status: "cancelled", error: "团队已删除" } };
        this.journal.coordinate(cancelled, { type: "cancelled", at: new Date().toISOString(), detail: "团队已删除" }); this.write(() => this.projectMessage(cancelled));
      }
    }
    this.db.prepare("UPDATE team_chat_deliveries SET status = 'cancelled', error = '团队已删除' WHERE status = 'pending' AND message_id IN (SELECT id FROM team_chat_messages WHERE team_instance_id = ?)").run(teamInstanceId);
  }
  public recoverDeliveries(): void {
    for (const row of this.db.prepare("SELECT id FROM team_chat_messages WHERE json_extract(payload_json, '$.coordinator.status') = 'pending'").all()) {
      this.finishCoordination(String(row.id), [], "上次协调已中断，请继续协调。");
    }
    this.db.prepare("UPDATE team_chat_deliveries SET error = 'Restart paused this request; resume explicitly.' WHERE status = 'pending'").run();
    const rows = this.db.prepare("SELECT * FROM team_chat_deliveries WHERE status = 'consumed'").all();
    for (const row of rows) {
      const runId = String(row.run_id);
      const outcome = this.context.outcome(String(row.conversation_id), runId);
      if (outcome?.status === "queued" || outcome?.status === "running") continue;
      const status = outcome?.status === "completed" ? "completed" : outcome?.status === "cancelled" ? "cancelled" : "failed";
      this.finishRun(runId, status, outcome?.error ?? (status === "completed" ? null : "Interrupted by application restart."));
    }
  }
}
