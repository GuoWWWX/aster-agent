import { CollaborationError } from "../errors/collaboration-error.js";
import { randomUUID } from "node:crypto";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";
import {
  taskContextSchema, taskSourceSchema, updateTaskContextInputSchema, listTaskContextsInputSchema,
  postTeamChatInputSchema, readTeamChatInputSchema, teamChatMessageSchema, teamChatDeliverySchema,
  type TaskContext, type TaskSource, type TaskContextDetail, type TaskContextPage,
  type ListTaskContextsInput, type UpdateTaskContextInput, type LinkTaskContextInput, type MergeTaskContextsInput,
  type PostTeamChatInput, type ReadTeamChatInput, type TeamChatMessage, type TeamChatPage,
  type MarkTeamChatReadInput, type ConversationSummary, type TeamInstanceView, type TeamChatMember,
  type ConversationAgentBinding, type TeamWorkItemView,
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
  outcome(conversationId: string, runId: string): { status: string; error: string | null } | null;
};

/** Durable task and team communication facts; member histories remain in ThreadLog. */
export class CollaborationStore {
  private sourceExists: StoreContext["sourceExists"];
  public constructor(private readonly db: DatabaseSync, private readonly context: StoreContext) { this.sourceExists = context.sourceExists; }
  public setSourceResolver(resolve: StoreContext["sourceExists"]): void { this.sourceExists = resolve; }

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
    const task = this.task(id);
    const limit = options.limit ?? 20;
    const rows = this.db.prepare("SELECT sequence, payload_json FROM task_context_sources WHERE task_id = ? AND sequence < ? ORDER BY sequence DESC LIMIT ?").all(id, options.beforeSourceSequence ?? Number.MAX_SAFE_INTEGER, limit + 1);
    return { task, nextBeforeSourceSequence: rows.length > limit ? Number(rows[limit - 1]!.sequence) : null, sources: rows.slice(0, limit).map(row => {
      const source = taskSourceSchema.parse(JSON.parse(String(row.payload_json)));
      let available = false; let title = "原始记录已删除";
      try {
        available = source.kind === "group" ? this.message(source.messageId).teamInstanceId === source.containerId : this.sourceExists(source);
        title = source.kind === "group" ? this.context.team(source.containerId).name : this.context.conversation(source.containerId).title;
      } catch { /* A source can be deleted while its task remains. */ }
      return { ...source, available, title, sequence: Number(row.sequence) };
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
    if (input.query) { clauses.push("(instr(lower(json_extract(payload_json, '$.title')), lower(?)) > 0 OR instr(lower(json_extract(payload_json, '$.goal')), lower(?)) > 0)"); params.push(input.query, input.query); }
    if (input.beforeId !== undefined) {
      const before = this.task(input.beforeId);
      clauses.push("(updated_at < ? OR (updated_at = ? AND id < ?))"); params.push(before.updatedAt, before.updatedAt, before.id);
    }
    const rows = this.db.prepare(`SELECT payload_json FROM task_contexts WHERE ${clauses.join(" AND ")} ORDER BY updated_at DESC, id DESC LIMIT ?`).all(...params, input.limit + 1);
    const items = rows.slice(0, input.limit).map(row => taskContextSchema.parse(JSON.parse(String(row.payload_json))));
    const unclassified = input.conversationId === undefined ? [] : this.db.prepare(`SELECT t.id, t.run_id FROM conversation_timeline t
      WHERE t.conversation_id = ? AND t.kind = 'message' AND json_extract(t.payload_json, '$.role') = 'user'
      AND NOT EXISTS (SELECT 1 FROM task_context_sources s WHERE s.message_id = t.id AND s.container_id = t.conversation_id)
      AND t.run_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM task_context_bindings b WHERE b.run_id = t.run_id)
      ORDER BY t.sequence DESC LIMIT 10`).all(input.conversationId).map(row => taskSourceSchema.parse({
        kind: "conversation", containerId: input.conversationId, messageId: row.id, runId: row.run_id, purpose: "request",
      }));
    return { items, nextBeforeId: rows.length > input.limit ? items.at(-1)?.id ?? null : null, unclassified };
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

  public updateTask(raw: UpdateTaskContextInput): TaskContext {
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
      const task = taskContextSchema.parse({
        id: previous?.id ?? randomUUID(), title: input.title, goal: input.goal, summary: input.summary,
        decisions: input.decisions, nextStep: input.nextStep, status: input.status,
        ownerConversationId: previous?.ownerConversationId ?? owner.id, projectId: previous?.projectId ?? owner.projectId,
        teamInstanceId: previous?.teamInstanceId ?? this.context.teamForConversation(owner.id)?.id ?? null,
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
  private assertMember(teamInstanceId: string, conversationId: string | null, allowArchived = false): void {
    const instance = this.context.team(teamInstanceId);
    if (instance.isArchived && !allowArchived) throw new CollaborationError("TEAM_ARCHIVED", "The room is archived.");
    if (conversationId !== null && !this.members(teamInstanceId).some(member => member.conversationId === conversationId && !member.isArchived)) throw new CollaborationError("TEAM_MEMBER", "Sender is not an active room member.");
  }
  public message(id: string): TeamChatMessage {
    const row = this.db.prepare("SELECT payload_json FROM team_chat_messages WHERE id = ?").get(id);
    if (typeof row?.payload_json !== "string") throw new CollaborationError("GROUP_MESSAGE_NOT_FOUND", "Message is unavailable.");
    const message = teamChatMessageSchema.parse(JSON.parse(row.payload_json));
    return { ...message, deliveries: this.db.prepare("SELECT * FROM team_chat_deliveries WHERE message_id = ? ORDER BY rowid").all(id).map(row => teamChatDeliverySchema.parse({
      id: row.id, conversationId: row.conversation_id, status: row.status, runId: row.run_id, error: row.error,
    })) };
  }
  public postMessage(raw: PostTeamChatInput, senderId: string | null, runId: string | null = null, causeId: string | null = null): TeamChatMessage {
    const input = postTeamChatInputSchema.parse(raw); this.assertMember(input.teamInstanceId, senderId);
    const fingerprint = JSON.stringify({ ...input, senderId });
    return this.write(() => {
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
          if (recipients.length === 0) recipients = [instance.rootConversationId];
        }
        for (const id of recipients) if (id === senderId || !active.some(member => member.conversationId === id)) throw new CollaborationError("TEAM_MEMBER", "Recipient must be another active room member.");
      }
      const id = randomUUID(); const sequence = Number(this.db.prepare("SELECT COALESCE(MAX(sequence), 0) + 1 AS next FROM team_chat_messages WHERE team_instance_id = ?").get(instance.id)?.next);
      const message = teamChatMessageSchema.parse({
        id, teamInstanceId: instance.id, sequence, content: input.content,
        senderConversationId: senderId, senderName: senderId === null ? "你" : members.find(member => member.conversationId === senderId)?.name,
        intent: input.intent, recipientConversationIds: recipients, taskContextId: input.taskContextId ?? parent?.taskContextId ?? null,
        replyToId: input.replyToId, createdAt: new Date().toISOString(), sourceRunId: runId,
        rootMessageId: senderId === null ? id : parent?.rootMessageId ?? id,
        depth: senderId === null ? 0 : (parent?.depth ?? 0) + 1, deliveries: [],
      });
      this.db.prepare("INSERT INTO team_chat_messages VALUES (?, ?, ?, ?)").run(id, instance.id, sequence, JSON.stringify(message));
      for (const recipient of recipients) this.db.prepare("INSERT INTO team_chat_deliveries(id, message_id, conversation_id, status, error) VALUES (?, ?, ?, ?, ?)")
        .run(randomUUID(), id, recipient, message.depth > 4 ? "failed" : "pending", message.depth > 4 ? "讨论已暂停：达到自动协作深度上限。" : null);
      this.db.prepare("INSERT INTO collaboration_requests VALUES (?, ?, ?)").run(`group:${input.requestId}`, fingerprint, id);
      if (message.taskContextId !== null) this.linkTask({ id: message.taskContextId,
        source: { kind: "group", containerId: instance.id, messageId: id, runId, purpose: input.intent === "request" ? "request" : "result" } });
      return this.message(id);
    });
  }
  public readMessages(raw: ReadTeamChatInput, memberId: string | null = null): TeamChatPage {
    const input = readTeamChatInputSchema.parse(raw); this.assertMember(input.teamInstanceId, memberId, true);
    const ascending = input.afterSequence !== undefined;
    const rows = this.db.prepare(`SELECT id FROM team_chat_messages WHERE team_instance_id = ? AND sequence < ? AND sequence > ? ORDER BY sequence ${ascending ? "ASC" : "DESC"} LIMIT ?`)
      .all(input.teamInstanceId, input.beforeSequence ?? Number.MAX_SAFE_INTEGER, input.afterSequence ?? 0, input.limit + 1);
    const selected = rows.slice(0, input.limit).map(row => this.message(String(row.id)));
    const messages = ascending ? selected : selected.reverse();
    const read = (reader: string) => Number(this.db.prepare("SELECT sequence FROM team_chat_reads WHERE team_instance_id = ? AND reader_id = ?").get(input.teamInstanceId, reader)?.sequence ?? 0);
    return { messages, nextBeforeSequence: rows.length > input.limit ? messages[0]?.sequence ?? null : null,
      userReadSequence: read("user"), memberReadSequence: memberId === null ? 0 : read(memberId) };
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
    this.db.prepare("UPDATE team_chat_deliveries SET status = 'cancelled', error = '团队已删除' WHERE status = 'pending' AND message_id IN (SELECT id FROM team_chat_messages WHERE team_instance_id = ?)").run(teamInstanceId);
  }
  public recoverDeliveries(): void {
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
