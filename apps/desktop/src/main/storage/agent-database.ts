import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { DatabaseMigrationRunner } from "./database-migration-runner.js";
import {
  conversationAgentBindingSchema,
  conversationAgentMessageItemSchema,
  conversationMessageItemSchema,
  conversationPendingMessageSchema,
  conversationRunStatusSchema,
  sendConversationMessageInputSchema,
  conversationSummarySchema,
  conversationTaskListSchema,
  conversationTimelineItemSchema,
  conversationToolItemSchema,
  projectSummarySchema,
  conversationAttachmentSchema,
  type ConversationAttachment,
  type ConversationAgentMessageItem,
  type ConversationMessageItem,
  type ConversationPendingMessage,
  type ConversationRunStatus,
  type ConversationAgentBinding,
  type ConversationSummary,
  type ConversationTask,
  type ConversationTaskList,
  type ConversationTimelineItem,
  type ConversationToolItem,
  type CreateConversationInput,
  type ProjectSummary,
  type RunAccepted,
  type SendConversationMessageInput
} from "@agent/protocol";
import type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";

export type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";

export type StoredModelMessage = {
  attachmentIds: string[];
  content: string;
  providerState?: ModelProviderState;
  role: "user" | "assistant" | "tool";
  toolCallId: string | null;
  toolCalls: ModelToolCall[];
};

export type StoredConversationAttachment = ConversationAttachment & {
  extractedTextPath: string | null;
  pendingMessageId: string | null;
  storedPath: string;
};

export type StoredPendingMessage = {
  input: SendConversationMessageInput;
  message: ConversationPendingMessage;
};

export type StoredContextMessage = StoredModelMessage & {
  runId: string | null;
  sequence: number;
};

export type ConversationContextCheckpoint = {
  conversationId: string;
  coveredThroughSequence: number;
  createdAt: string;
  summary: string;
  updatedAt: string;
};

export type ConversationDeletionTaskStatus = "failed" | "pending" | "running";

export type ConversationDeletionTask = {
  conversationIds: string[];
  createdAt: string;
  filePaths: string[];
  id: string;
  lastError: string | null;
  retryCount: number;
  rootConversationId: string;
  status: ConversationDeletionTaskStatus;
  updatedAt: string;
};

export type SendAgentMessageInput = {
  content: string;
  messageType?: "message" | "notification" | "agent_result" | "task_result";
  runId: string;
  senderConversationId: string;
  taskId?: string | null;
  targetConversationId: string;
};

export function agentMessageModelContent(message: ConversationAgentMessageItem): string {
  if (message.messageType === "task_result") {
    return [
      "[Subagent 任务结果]",
      `Subagent 对话：${message.senderTitle}`,
      `Subagent conversationId：${message.senderConversationId}`,
      ...(message.taskId === null ? [] : [`任务 ID：${message.taskId}`]),
      "这是一次性 Subagent 的完成摘要。完整过程保存在独立子对话中；需要更多细节时，使用 read_agent_conversation 按预算读取，不要要求 Subagent 继续对话。",
      "结果摘要：",
      message.content
    ].join("\n");
  }
  if (message.messageType === "agent_result") {
    return [
      "[Agent 处理结果]",
      `执行对话：${message.senderTitle}`,
      `执行方 conversationId：${message.senderConversationId}`,
      ...(message.taskId === null ? [] : [`原协作消息 ID：${message.taskId}`]),
      "这是接收方完成本次协作消息后由运行时自动回传的最终结果，不需要再次回复。",
      "结果内容：",
      message.content,
    ].join("\n");
  }
  if (message.messageType === "notification") {
    return [
      "[Agent 协作通知]",
      `发送方对话：${message.senderTitle}`,
      `发送方 conversationId：${message.senderConversationId}`,
      "这是一条不要求自动回传结果的进度或通知消息；根据内容继续当前工作即可。",
      "消息内容：",
      message.content,
    ].join("\n");
  }
  return [
    "[Agent 协作消息]",
    `发送方对话：${message.senderTitle}`,
    `发送方 conversationId：${message.senderConversationId}`,
    "处理方式：直接完成消息中的工作并给出最终答复；运行时会自动把最终结果关联回发送方。只有中间进度、追问或额外主动消息才需要调用 send_agent_message。",
    "消息内容：",
    message.content
  ].join("\n");
}

export type SubagentTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

export type SubagentTask = {
  childConversationId: string;
  completedAt: string | null;
  createdAt: string;
  error: string | null;
  id: string;
  parentConversationId: string;
  result: string | null;
  resultMessageId: string | null;
  sourceRunId: string;
  status: SubagentTaskStatus;
  targetRunId: string | null;
  task: string;
  title: string;
  updatedAt: string;
};

type RunCreation = RunAccepted & {
  conversation: ConversationSummary;
};

export type CompleteRunInput = {
  assistant:
    | {
        content: string;
        kind: "turn";
        messageId: string;
        modelId: string;
        providerState?: ModelProviderState;
      }
    | {
        content: string;
        kind: "failure";
        messageId: string;
        modelId: string;
      }
    | {
        content: string;
        kind: "cancelled";
        messageId: string;
        modelId: string;
        providerState?: ModelProviderState;
      }
    | null;
  conversationId: string;
  error: string | null;
  result: string | null;
  runId: string;
  status: "completed" | "failed" | "cancelled";
};

export type CompletedRun = {
  assistantMessage: ConversationMessageItem | null;
  subagentResultMessage: ConversationAgentMessageItem | null;
  subagentTask: SubagentTask | null;
};

export type LatestUserMessageReplacementSource = {
  message: ConversationMessageItem;
  modelContent: string;
};

type ReplaceLatestUserMessageInput = {
  content: string;
  conversationId: string;
  messageId: string;
  modelContent: string;
  modelId: string;
};

type UserTimelineRecord = {
  message: ConversationMessageItem;
  sequence: number;
};

type UserModelMessageRecord = {
  attachmentIds: string[];
  content: string;
  id: string;
  sequence: number;
};

type AgentMessageRunCreation = {
  conversation: ConversationSummary;
  runId: string;
};

type DatabaseRow = Record<string, unknown>;

const RUNNING_STATUSES = ["queued", "running"] as const;
const RUN_STATUS_TRANSITIONS: Readonly<Record<
  ConversationRunStatus,
  readonly ConversationRunStatus[]
>> = {
  cancelled: [],
  completed: [],
  failed: [],
  queued: ["running", "completed", "failed", "cancelled"],
  running: ["completed", "failed", "cancelled"],
};
const MAX_SUBAGENT_RESULT_SUMMARY_LENGTH = 2_000;

type SqliteModule = typeof import("node:sqlite");
type SqliteDatabase = InstanceType<SqliteModule["DatabaseSync"]>;

// Keep this builtin dynamic so tsup does not drop the `node:` prefix in CJS.
const requireNodeBuiltin = createRequire(__filename);
const { DatabaseSync } = requireNodeBuiltin("node:sqlite") as SqliteModule;

function asString(row: DatabaseRow, key: string): string {
  const value = row[key];
  if (typeof value !== "string") {
    throw new Error(`Database column ${key} is not a string.`);
  }
  return value;
}

function asNullableString(row: DatabaseRow, key: string): string | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`Database column ${key} is not nullable text.`);
  }
  return value;
}

function asBoolean(row: DatabaseRow, key: string): boolean {
  const value = row[key];
  if (value === 0 || value === false) return false;
  if (value === 1 || value === true) return true;
  throw new Error(`Database column ${key} is not a boolean.`);
}

function asNullableNumber(row: DatabaseRow, key: string): number | null {
  const value = row[key];
  if (value === null) return null;
  if (typeof value !== "number") {
    throw new Error(`Database column ${key} is not a nullable number.`);
  }
  return value;
}

function asNumber(row: DatabaseRow, key: string): number {
  const value = row[key];
  if (typeof value !== "number") {
    throw new Error(`Database column ${key} is not a number.`);
  }
  return value;
}

function parseJson<T>(value: string, description: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new Error(`Stored ${description} is invalid JSON.`);
  }
}

function parseStoredStringArray(value: string, description: string): string[] {
  const parsed = parseJson<unknown>(value, description);
  if (!Array.isArray(parsed)) {
    throw new Error(`Stored ${description} is not a string array.`);
  }
  const strings: string[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "string") {
      throw new Error(`Stored ${description} is not a string array.`);
    }
    strings.push(entry);
  }
  return [...new Set(strings)];
}

function toConversationDeletionTask(row: DatabaseRow): ConversationDeletionTask {
  const status = asString(row, "status");
  if (status !== "failed" && status !== "pending" && status !== "running") {
    throw new Error("Stored conversation deletion task status is invalid.");
  }
  return {
    conversationIds: parseStoredStringArray(
      asString(row, "conversation_ids_json"),
      "conversation deletion task conversation identifiers",
    ),
    createdAt: asString(row, "created_at"),
    filePaths: parseStoredStringArray(
      asString(row, "file_paths_json"),
      "conversation deletion task file paths",
    ),
    id: asString(row, "id"),
    lastError: asNullableString(row, "last_error"),
    retryCount: asNumber(row, "retry_count"),
    rootConversationId: asString(row, "root_conversation_id"),
    status,
    updatedAt: asString(row, "updated_at"),
  };
}

function toConversation(row: DatabaseRow): ConversationSummary {
  return conversationSummarySchema.parse({
    activeSubagentCount: asNumber(row, "active_subagent_count"),
    activeRunId: asNullableString(row, "active_run_id"),
    agentId: asNullableString(row, "agent_id"),
    archivedAt: asNullableString(row, "archived_at"),
    createdAt: asString(row, "created_at"),
    hasUnreadResult: asBoolean(row, "has_unread_result"),
    id: asString(row, "id"),
    isArchived: asBoolean(row, "is_archived"),
    isPinned: asBoolean(row, "is_pinned"),
    lastRunStatus: asNullableString(row, "last_run_status"),
    parentConversationId: asNullableString(row, "parent_conversation_id"),
    pinOrder: asNullableNumber(row, "pin_order"),
    projectId: asNullableString(row, "project_id"),
    subagentTaskStatus: asNullableString(row, "subagent_task_status"),
    teamId: asNullableString(row, "team_id"),
    threadKind: asString(row, "thread_kind"),
    title: asString(row, "title"),
    updatedAt: asString(row, "updated_at"),
    workspaceRootPath: asNullableString(row, "workspace_root_path")
  });
}

function toSubagentTask(row: DatabaseRow): SubagentTask {
  const status = asString(row, "status");
  if (!["queued", "running", "completed", "failed", "cancelled"].includes(status)) {
    throw new Error("Stored Subagent task status is invalid.");
  }
  return {
    childConversationId: asString(row, "child_conversation_id"),
    completedAt: asNullableString(row, "completed_at"),
    createdAt: asString(row, "created_at"),
    error: asNullableString(row, "error"),
    id: asString(row, "id"),
    parentConversationId: asString(row, "parent_conversation_id"),
    result: asNullableString(row, "result"),
    resultMessageId: asNullableString(row, "result_message_id"),
    sourceRunId: asString(row, "source_run_id"),
    status: status as SubagentTaskStatus,
    targetRunId: asNullableString(row, "target_run_id"),
    task: asString(row, "task"),
    title: asString(row, "title"),
    updatedAt: asString(row, "updated_at")
  };
}

function toProject(row: DatabaseRow): ProjectSummary {
  return projectSummarySchema.parse({
    id: asString(row, "id"),
    isPinned: asBoolean(row, "is_pinned"),
    name: asString(row, "name"),
    rootPath: asString(row, "root_path")
  });
}

function toConversationAttachment(row: DatabaseRow): StoredConversationAttachment {
  const attachment = conversationAttachmentSchema.parse({
    contextTokens: asNumber(row, "context_tokens"),
    conversationId: asString(row, "conversation_id"),
    createdAt: asString(row, "created_at"),
    id: asString(row, "id"),
    kind: asString(row, "kind"),
    messageId: asNullableString(row, "message_id"),
    mimeType: asString(row, "mime_type"),
    name: asString(row, "name"),
    projectPath: asNullableString(row, "project_path"),
    sizeBytes: asNumber(row, "size_bytes"),
    source: asString(row, "source"),
    truncated: asBoolean(row, "truncated")
  });
  return {
    ...attachment,
    extractedTextPath: asNullableString(row, "extracted_text_path"),
    pendingMessageId: asNullableString(row, "pending_message_id"),
    storedPath: asString(row, "stored_path")
  };
}

function toStoredPendingMessage(row: DatabaseRow): StoredPendingMessage {
  const input = sendConversationMessageInputSchema.parse(
    parseJson(asString(row, "payload_json"), "pending conversation message")
  );
  const deliveryMode = asString(row, "delivery_mode");
  const message = conversationPendingMessageSchema.parse({
    attachmentIds: input.attachmentIds ?? [],
    content: input.content,
    conversationId: asString(row, "conversation_id"),
    createdAt: asString(row, "created_at"),
    deliveryMode,
    id: asString(row, "id"),
    referencedConversationIds: input.referencedConversationIds ?? [],
    referencedProjectPaths: input.referencedProjectPaths ?? []
  });
  if (input.conversationId !== message.conversationId) {
    throw new Error("Stored pending conversation message belongs to another conversation.");
  }
  return {
    input: { ...input, deliveryMode: message.deliveryMode },
    message
  };
}

function toPublicConversationAttachment(
  attachment: StoredConversationAttachment
): ConversationAttachment {
  return conversationAttachmentSchema.parse({
    contextTokens: attachment.contextTokens,
    conversationId: attachment.conversationId,
    createdAt: attachment.createdAt,
    id: attachment.id,
    kind: attachment.kind,
    messageId: attachment.messageId,
    mimeType: attachment.mimeType,
    name: attachment.name,
    projectPath: attachment.projectPath,
    sizeBytes: attachment.sizeBytes,
    source: attachment.source,
    truncated: attachment.truncated
  });
}

export class AgentDatabase {
  private readonly database: SqliteDatabase;

  public constructor(databasePath: string) {
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON;");
    if (databasePath !== ":memory:") {
      this.database.exec("PRAGMA journal_mode = WAL;");
    }
    try {
      this.migrate();
      this.interruptUnfinishedRuns();
    } catch (error) {
      this.database.close();
      throw error;
    }
  }

  public close(): void {
    this.database.close();
  }

  public listProjects(): ProjectSummary[] {
    const rows = this.database
      .prepare(
        "SELECT id, name, root_path, is_pinned FROM projects ORDER BY is_pinned DESC, sort_order ASC, created_at ASC"
      )
      .all() as DatabaseRow[];
    return rows.map(toProject);
  }

  public saveProject(project: ProjectSummary): void {
    const validated = projectSummarySchema.parse(project);
    this.database
      .prepare(
        `INSERT INTO projects (id, name, root_path, is_pinned, sort_order, created_at)
         SELECT ?, ?, ?, ?, COALESCE(MAX(sort_order), -1) + 1, ? FROM projects WHERE true
         ON CONFLICT(root_path) DO UPDATE SET
           name = excluded.name,
           is_pinned = excluded.is_pinned`
      )
      .run(
        validated.id,
        validated.name,
        validated.rootPath,
        Number(validated.isPinned ?? false),
        new Date().toISOString()
      );
  }

  public reorderProjects(projectIds: readonly string[]): void {
    if (new Set(projectIds).size !== projectIds.length) {
      throw new Error("Project order contains duplicate identifiers.");
    }
    const placeholders = projectIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(`SELECT id, is_pinned FROM projects WHERE id IN (${placeholders})`)
      .all(...projectIds) as DatabaseRow[];
    const pinned = rows[0]?.is_pinned;
    if (
      rows.length !== projectIds.length
      || (pinned !== 0 && pinned !== 1)
      || rows.some((row) => row.is_pinned !== pinned)
    ) {
      throw new Error("Projects can only be reordered inside one pin group.");
    }
    const countRow = this.database
      .prepare("SELECT COUNT(*) AS count FROM projects WHERE is_pinned = ?")
      .get(pinned) as DatabaseRow;
    if (Number(countRow.count) !== projectIds.length) {
      throw new Error("Project reorder must include the complete pin group.");
    }
    this.withTransaction(() => {
      const update = this.database.prepare("UPDATE projects SET sort_order = ? WHERE id = ?");
      projectIds.forEach((projectId, index) => update.run(index, projectId));
    });
  }

  public deleteProject(projectId: string): void {
    const activeRun = this.database
      .prepare(
        `SELECT 1 AS present
         FROM runs
         JOIN conversations ON conversations.id = runs.conversation_id
         WHERE conversations.project_id = ? AND runs.status IN ('queued', 'running')
         LIMIT 1`
      )
      .get(projectId);
    if (activeRun !== undefined) {
      throw new Error("A project with running conversations cannot be removed.");
    }
    const result = this.database
      .prepare("DELETE FROM projects WHERE id = ?")
      .run(projectId);
    if (result.changes !== 1) {
      throw new Error("Project was not found.");
    }
  }

  public listConversations(): ConversationSummary[] {
    const rows = this.database
      .prepare(
        `SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            thread_kind, agent_id, team_id, title, created_at, conversations.updated_at,
            conversations.archived_at,
            conversations.has_unread_result, conversations.is_archived,
            conversations.is_pinned, conversations.pin_order,
           (SELECT id FROM runs
            WHERE conversation_id = conversations.id
              AND status IN ('queued', 'running')
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS active_run_id,
           (SELECT status FROM runs
            WHERE conversation_id = conversations.id
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_run_status
          ,(SELECT COUNT(*) FROM subagent_tasks
            WHERE parent_conversation_id = conversations.id
              AND status IN ('queued', 'running')) AS active_subagent_count
          ,(SELECT status FROM subagent_tasks
            WHERE child_conversation_id = conversations.id LIMIT 1) AS subagent_task_status
         FROM conversations
         WHERE parent_conversation_id IS NULL AND deletion_pending = 0
         ORDER BY conversations.is_pinned DESC, conversations.sort_order ASC,
                  conversations.updated_at DESC`
      )
      .all() as DatabaseRow[];
    return rows.map(toConversation);
  }

  public listAgentConversations(): ConversationSummary[] {
    const rows = this.database
      .prepare(
        `SELECT id FROM conversations
         WHERE is_archived = 0 AND deletion_pending = 0
         ORDER BY updated_at DESC, rowid DESC`
      )
      .all() as DatabaseRow[];
    return rows.map((row) => this.getConversation(asString(row, "id")));
  }

  public getConversation(conversationId: string): ConversationSummary {
    const row = this.database
      .prepare(
        `SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            thread_kind, agent_id, team_id, title, created_at, conversations.updated_at,
            conversations.archived_at,
            conversations.has_unread_result, conversations.is_archived,
            conversations.is_pinned, conversations.pin_order,
           (SELECT id FROM runs
            WHERE conversation_id = conversations.id
              AND status IN ('queued', 'running')
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS active_run_id,
           (SELECT status FROM runs
            WHERE conversation_id = conversations.id
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_run_status
          ,(SELECT COUNT(*) FROM subagent_tasks
            WHERE parent_conversation_id = conversations.id
              AND status IN ('queued', 'running')) AS active_subagent_count
          ,(SELECT status FROM subagent_tasks
            WHERE child_conversation_id = conversations.id LIMIT 1) AS subagent_task_status
         FROM conversations WHERE conversations.id = ? AND deletion_pending = 0`
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("Conversation was not found.");
    }
    return toConversation(row);
  }

  public createConversation(
    projectId: string | null,
    options: Omit<CreateConversationInput, "projectId"> = {}
  ): ConversationSummary {
    if (projectId !== null) {
      this.assertProjectExists(projectId);
    }
    const countRow = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM conversations
         WHERE project_id IS ? AND parent_conversation_id IS NULL AND deletion_pending = 0`
      )
      .get(projectId) as DatabaseRow;
    const count = Number(countRow.count);
    const now = new Date().toISOString();
    const agent = options.agent ?? null;
    const conversation = conversationSummarySchema.parse({
      activeSubagentCount: 0,
      activeRunId: null,
      agentId: agent?.id ?? null,
      archivedAt: null,
      createdAt: now,
      hasUnreadResult: false,
      id: randomUUID(),
      lastRunStatus: null,
      parentConversationId: null,
      pinOrder: null,
      projectId,
      subagentTaskStatus: null,
      teamId: options.teamId ?? null,
      threadKind: options.threadKind ?? "agent",
      title: count === 0 ? "新会话" : `新会话 ${count + 1}`,
      updatedAt: now,
      workspaceRootPath: null
    });
    this.database
      .prepare(
        `INSERT INTO conversations
           (id, project_id, thread_kind, agent_id, agent_name, agent_role, agent_is_default,
            agent_instructions, team_id, title, created_at, updated_at, sort_order)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
      )
      .run(
        conversation.id,
        conversation.projectId,
        conversation.threadKind,
        conversation.agentId,
        agent?.name ?? null,
        agent?.role ?? null,
        Number(agent?.isDefault ?? false),
        agent?.instructions ?? null,
        conversation.teamId,
        conversation.title,
        conversation.createdAt,
        conversation.updatedAt
      );
    return conversation;
  }

  public bindConversationAgent(
    conversationId: string,
    rawAgent: ConversationAgentBinding
  ): ConversationSummary {
    const agent = conversationAgentBindingSchema.parse(rawAgent);
    const conversation = this.getConversation(conversationId);
    if (conversation.agentId !== null && conversation.agentId !== agent.id) {
      throw new Error("This conversation is already bound to another Agent.");
    }
    this.database
      .prepare(
        `UPDATE conversations
         SET thread_kind = ?, agent_id = ?, agent_name = ?, agent_role = ?,
             agent_is_default = ?, agent_instructions = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        conversation.threadKind,
        agent.id,
        agent.name,
        agent.role,
        Number(agent.isDefault),
        agent.instructions,
        new Date().toISOString(),
        conversationId
      );
    return this.getConversation(conversationId);
  }

  public getConversationAgentBinding(
    conversationId: string
  ): ConversationAgentBinding | null {
    const row = this.database
      .prepare(
        `SELECT agent_id, agent_name, agent_role, agent_is_default, agent_instructions
         FROM conversations WHERE id = ? AND deletion_pending = 0`
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("Conversation was not found.");
    }
    const id = asNullableString(row, "agent_id");
    if (id === null) return null;
    return conversationAgentBindingSchema.parse({
      id,
      instructions: asNullableString(row, "agent_instructions") ?? "",
      isDefault: asBoolean(row, "agent_is_default"),
      name: asNullableString(row, "agent_name") ?? id,
      role: asNullableString(row, "agent_role") ?? ""
    });
  }

  public listConversationWorkspaces(): Array<{
    conversationId: string;
    rootPath: string;
  }> {
    const rows = this.database
      .prepare(
        `SELECT id, workspace_root_path
         FROM conversations
         WHERE project_id IS NULL AND workspace_root_path IS NOT NULL
           AND deletion_pending = 0
         ORDER BY created_at ASC, rowid ASC`
      )
      .all() as DatabaseRow[];
    return rows.map((row) => ({
      conversationId: asString(row, "id"),
      rootPath: asString(row, "workspace_root_path")
    }));
  }

  public setConversationWorkspaceRoot(
    conversationId: string,
    rootPath: string | null
  ): ConversationSummary {
    const conversation = this.getConversation(conversationId);
    if (conversation.projectId !== null) {
      throw new Error("Project conversations already use their project root.");
    }
    this.assertNoActiveRun(conversationId);
    if (rootPath !== null && rootPath.trim().length === 0) {
      throw new Error("Conversation workspace path cannot be empty.");
    }
    this.database
      .prepare(
        "UPDATE conversations SET workspace_root_path = ?, updated_at = ? WHERE id = ?"
      )
      .run(rootPath, new Date().toISOString(), conversationId);
    return this.getConversation(conversationId);
  }

  public forkConversation(
    sourceConversationId: string,
    kind: "side" | "sibling" | "subagent" = "subagent",
    throughMessageId?: string,
  ): ConversationSummary {
    const source = this.getConversation(sourceConversationId);
    const forkBoundary = throughMessageId === undefined
      ? null
      : this.resolveForkBoundary(sourceConversationId, throughMessageId);
    if (kind === "sibling" && forkBoundary === null) {
      throw new Error("A sibling conversation requires an assistant message boundary.");
    }
    const throughModelMessageSequence = forkBoundary?.modelMessageSequence ?? null;
    const inheritedAgent = kind === "subagent"
      ? null
      : this.getConversationAgentBinding(sourceConversationId);
    const countRow = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM conversations
         WHERE parent_conversation_id = ? AND deletion_pending = 0`
      )
      .get(sourceConversationId) as DatabaseRow;
    const count = Number(countRow.count);
    const now = new Date().toISOString();
    const parentConversationId = kind === "sibling" ? null : sourceConversationId;
    const conversation = conversationSummarySchema.parse({
      activeSubagentCount: 0,
      activeRunId: null,
      agentId: inheritedAgent?.id ?? null,
      archivedAt: null,
      createdAt: now,
      hasUnreadResult: false,
      id: randomUUID(),
      lastRunStatus: null,
      parentConversationId,
      pinOrder: null,
      projectId: source.projectId,
      subagentTaskStatus: null,
      teamId: source.teamId,
      threadKind: kind === "subagent" ? "subagent" : "agent",
      title: kind === "sibling"
        ? this.createSiblingForkTitle(source)
        : count === 0 ? "侧边聊天" : `侧边聊天 ${count + 1}`,
      updatedAt: now,
      workspaceRootPath: source.workspaceRootPath
    });

    return this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO conversations
             (id, project_id, parent_conversation_id, workspace_root_path,
              thread_kind, agent_id, agent_name, agent_role, agent_is_default,
              agent_instructions, team_id, title, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          conversation.id,
          conversation.projectId,
          parentConversationId,
          conversation.workspaceRootPath,
          conversation.threadKind,
          inheritedAgent?.id ?? null,
          inheritedAgent?.name ?? null,
          inheritedAgent?.role ?? null,
          Number(inheritedAgent?.isDefault ?? false),
          inheritedAgent?.instructions ?? null,
          conversation.teamId,
          conversation.title,
          conversation.createdAt,
          conversation.updatedAt
        );

      const sourceMessages = this.database
        .prepare(
          `SELECT sequence, run_id, role, content, tool_calls_json, tool_call_id,
                  attachment_ids_json, provider_state_json, created_at
           FROM model_messages
           WHERE conversation_id = ?
             ${throughModelMessageSequence === null ? "" : "AND sequence <= ?"}
           ORDER BY sequence ASC`
        )
        .all(
          sourceConversationId,
          ...(throughModelMessageSequence === null ? [] : [throughModelMessageSequence]),
        ) as DatabaseRow[];
      const sourceTimelineItems = kind === "sibling" && forkBoundary !== null
        ? (this.database
            .prepare(
              `SELECT payload_json FROM conversation_timeline
               WHERE conversation_id = ? AND sequence <= ?
               ORDER BY sequence ASC`,
            )
            .all(
              sourceConversationId,
              forkBoundary.timelineSequence,
            ) as DatabaseRow[]).map((row) => conversationTimelineItemSchema.parse(
              parseJson(asString(row, "payload_json"), "timeline item"),
            ))
        : [];
      const timelineItemIdMap = new Map(
        sourceTimelineItems.map((item) => [item.id, randomUUID()]),
      );
      const runIdMap = new Map<string, string>();
      if (kind === "sibling") {
        for (const sourceRunId of [
          ...sourceMessages.map((message) => asNullableString(message, "run_id")),
          ...sourceTimelineItems.map((item) => item.runId),
        ]) {
          if (sourceRunId !== null && !runIdMap.has(sourceRunId)) {
            runIdMap.set(sourceRunId, randomUUID());
          }
        }
      }
      const forkedRunId = (sourceRunId: string | null): string | null => {
        if (sourceRunId === null || kind !== "sibling") return null;
        const copiedRunId = runIdMap.get(sourceRunId);
        if (copiedRunId === undefined) {
          throw new Error("Forked conversation Run identifier could not be mapped.");
        }
        return copiedRunId;
      };
      const inheritedAttachmentIds = new Set(
        sourceMessages.flatMap((message) => parseJson<string[]>(
          asString(message, "attachment_ids_json"),
          "model message attachment identifiers",
        )),
      );
      const sourceAttachments = this.listStoredAttachments(
        "conversation_id = ? AND message_id IS NOT NULL",
        [sourceConversationId]
      ).filter((attachment) => inheritedAttachmentIds.has(attachment.id));
      const attachmentIdMap = new Map<string, string>();
      const insertAttachment = this.database.prepare(
        `INSERT INTO conversation_attachments
           (id, conversation_id, message_id, source, kind, name, mime_type,
            size_bytes, project_path, stored_path, extracted_text_path,
            context_tokens, truncated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const attachment of sourceAttachments) {
        const copiedId = randomUUID();
        attachmentIdMap.set(attachment.id, copiedId);
        insertAttachment.run(
          copiedId,
          conversation.id,
          attachment.messageId === null
            ? null
            : timelineItemIdMap.get(attachment.messageId) ?? null,
          attachment.source,
          attachment.kind,
          attachment.name,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.projectPath,
          attachment.storedPath,
          attachment.extractedTextPath,
          attachment.contextTokens,
          Number(attachment.truncated),
          attachment.createdAt
        );
      }

      // Visible fork history is an independent snapshot. IDs are remapped so later
      // edits and forks operate only on the new conversation.
      for (const sourceItem of sourceTimelineItems) {
        const copiedId = timelineItemIdMap.get(sourceItem.id);
        if (copiedId === undefined) {
          throw new Error("Forked timeline item identifier could not be mapped.");
        }
        if (sourceItem.kind === "message") {
          this.insertTimelineItem({
            ...sourceItem,
            attachments: sourceItem.attachments.flatMap((attachment) => {
              const copiedAttachmentId = attachmentIdMap.get(attachment.id);
              return copiedAttachmentId === undefined
                ? []
                : [{
                    ...attachment,
                    id: copiedAttachmentId,
                    messageId: copiedId,
                  }];
            }),
            conversationId: conversation.id,
            id: copiedId,
            runId: forkedRunId(sourceItem.runId),
          });
          continue;
        }
        if (sourceItem.kind === "agent_message") {
          this.insertTimelineItem({
            ...sourceItem,
            conversationId: conversation.id,
            id: copiedId,
            readAt: sourceItem.readAt ?? now,
            runId: forkedRunId(sourceItem.runId),
            status: "read",
            taskId: null,
          });
          continue;
        }
        const copiedRunId = forkedRunId(sourceItem.runId);
        if (copiedRunId === null) {
          throw new Error("Forked tool Run identifier could not be mapped.");
        }
        this.insertTimelineItem({
          ...sourceItem,
          conversationId: conversation.id,
          id: copiedId,
          runId: copiedRunId,
        });
      }

      const forkedMessageSequences = new Map<number, number>();
      const insertMessage = this.database.prepare(
         `INSERT INTO model_messages
            (id, conversation_id, run_id, role, content, tool_calls_json,
             tool_call_id, attachment_ids_json, provider_state_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const message of sourceMessages) {
        const result = insertMessage.run(
          randomUUID(),
          conversation.id,
          forkedRunId(asNullableString(message, "run_id")),
          asString(message, "role"),
          asString(message, "content"),
          asString(message, "tool_calls_json"),
          asNullableString(message, "tool_call_id"),
          JSON.stringify(
            parseJson<string[]>(
              asString(message, "attachment_ids_json"),
              "model message attachment identifiers"
            ).flatMap((attachmentId) => {
              const copiedId = attachmentIdMap.get(attachmentId);
              return copiedId === undefined ? [] : [copiedId];
            })
          ),
          asNullableString(message, "provider_state_json"),
          asString(message, "created_at")
        );
        const forkedSequence = Number(result.lastInsertRowid);
        if (!Number.isSafeInteger(forkedSequence) || forkedSequence <= 0) {
          throw new Error("Forked conversation message sequence is invalid.");
        }
        forkedMessageSequences.set(asNumber(message, "sequence"), forkedSequence);
      }

      const sourceCheckpoint = this.getContextCheckpoint(sourceConversationId);
      if (
        sourceCheckpoint !== null
        && (
          throughModelMessageSequence === null
          || sourceCheckpoint.coveredThroughSequence <= throughModelMessageSequence
        )
      ) {
        const forkedCoveredThroughSequence = forkedMessageSequences.get(
          sourceCheckpoint.coveredThroughSequence
        );
        if (forkedCoveredThroughSequence === undefined) {
          throw new Error("Forked conversation checkpoint could not be mapped.");
        }
        this.saveContextCheckpoint(
          conversation.id,
          forkedCoveredThroughSequence,
          sourceCheckpoint.summary
        );
      }

      return conversation;
    });
  }

  private createSiblingForkTitle(source: ConversationSummary): string {
    const siblingRows = this.database
      .prepare(
        `SELECT title FROM conversations
         WHERE project_id IS ? AND parent_conversation_id IS NULL
           AND deletion_pending = 0`,
      )
      .all(source.projectId) as DatabaseRow[];
    const prefix = `${source.title} (`;
    let highestSuffix = 0;
    for (const row of siblingRows) {
      const title = asString(row, "title");
      if (!title.startsWith(prefix) || !title.endsWith(")")) continue;
      const suffix = title.slice(prefix.length, -1);
      if (!/^[1-9]\d*$/.test(suffix)) continue;
      highestSuffix = Math.max(highestSuffix, Number(suffix));
    }
    return `${source.title} (${highestSuffix + 1})`;
  }

  private resolveForkBoundary(
    sourceConversationId: string,
    throughMessageId: string,
  ): { modelMessageSequence: number; timelineSequence: number } {
    const timelineRow = this.database
      .prepare(
        `SELECT sequence, run_id, payload_json
         FROM conversation_timeline
         WHERE id = ? AND conversation_id = ? AND kind = 'message'`,
      )
      .get(throughMessageId, sourceConversationId) as DatabaseRow | undefined;
    if (timelineRow === undefined) {
      throw new Error("The fork message was not found in the source conversation.");
    }
    const targetMessage = conversationMessageItemSchema.parse(
      parseJson(asString(timelineRow, "payload_json"), "conversation message"),
    );
    if (targetMessage.role !== "assistant" || targetMessage.status !== "completed") {
      throw new Error("A conversation can only be forked from a completed assistant message.");
    }
    const runId = asNullableString(timelineRow, "run_id");
    if (runId === null) {
      throw new Error("The fork message is not associated with a model run.");
    }

    const assistantTimelineRows = this.database
      .prepare(
        `SELECT payload_json
         FROM conversation_timeline
         WHERE conversation_id = ? AND run_id = ? AND kind = 'message' AND sequence <= ?
         ORDER BY sequence ASC`,
      )
      .all(
        sourceConversationId,
        runId,
        asNumber(timelineRow, "sequence"),
      ) as DatabaseRow[];
    const targetAssistantIndex = assistantTimelineRows
      .map((row) => conversationMessageItemSchema.parse(
        parseJson(asString(row, "payload_json"), "conversation message"),
      ))
      .filter((message) => message.role === "assistant" && message.status === "completed")
      .findIndex((message) => message.id === throughMessageId);
    if (targetAssistantIndex < 0) {
      throw new Error("The fork message could not be mapped to its model context.");
    }

    const assistantModelRows = this.database
      .prepare(
        `SELECT sequence, content
         FROM model_messages
         WHERE conversation_id = ? AND run_id = ? AND role = 'assistant' AND content <> ''
         ORDER BY sequence ASC`,
      )
      .all(sourceConversationId, runId) as DatabaseRow[];
    const targetModelRow = assistantModelRows[targetAssistantIndex];
    if (
      targetModelRow === undefined
      || asString(targetModelRow, "content") !== targetMessage.content
    ) {
      throw new Error("The fork message could not be mapped to its model context.");
    }
    const targetModelSequence = asNumber(targetModelRow, "sequence");
    const laterRunMessage = this.database
      .prepare(
        `SELECT 1 AS present
         FROM model_messages
         WHERE conversation_id = ? AND run_id = ? AND sequence > ?
         LIMIT 1`,
      )
      .get(sourceConversationId, runId, targetModelSequence);
    if (laterRunMessage !== undefined) {
      throw new Error("A conversation can only be forked from the final assistant reply in a run.");
    }
    return {
      modelMessageSequence: targetModelSequence,
      timelineSequence: asNumber(timelineRow, "sequence"),
    };
  }

  public listConversationForks(sourceConversationId: string): ConversationSummary[] {
    this.getConversation(sourceConversationId);
    const rows = this.database
      .prepare(
        `SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            thread_kind, agent_id, team_id, title, created_at, conversations.updated_at,
            conversations.archived_at,
            conversations.has_unread_result, conversations.is_archived,
            conversations.is_pinned, conversations.pin_order,
           (SELECT id FROM runs
            WHERE conversation_id = conversations.id
              AND status IN ('queued', 'running')
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS active_run_id,
           (SELECT status FROM runs
            WHERE conversation_id = conversations.id
            ORDER BY created_at DESC, rowid DESC LIMIT 1) AS last_run_status
          ,(SELECT COUNT(*) FROM subagent_tasks
            WHERE parent_conversation_id = conversations.id
              AND status IN ('queued', 'running')) AS active_subagent_count
          ,(SELECT status FROM subagent_tasks
            WHERE child_conversation_id = conversations.id LIMIT 1) AS subagent_task_status
         FROM conversations
         WHERE parent_conversation_id = ? AND deletion_pending = 0
         ORDER BY conversations.created_at ASC`
      )
      .all(sourceConversationId) as DatabaseRow[];
    return rows.map(toConversation);
  }

  public isConversationFork(conversationId: string): boolean {
    const row = this.database
      .prepare(
        `SELECT parent_conversation_id FROM conversations
         WHERE id = ? AND deletion_pending = 0`
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("Conversation was not found.");
    }
    return asNullableString(row, "parent_conversation_id") !== null;
  }

  public renameConversation(
    conversationId: string,
    title: string
  ): ConversationSummary {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        "UPDATE conversations SET title = ?, updated_at = ? WHERE id = ?"
      )
      .run(title, now, conversationId);
    if (result.changes !== 1) {
      throw new Error("Conversation was not found.");
    }
    return this.getConversation(conversationId);
  }

  public setConversationProject(
    conversationId: string,
    projectId: string | null
  ): ConversationSummary {
    const conversation = this.getConversation(conversationId);
    if (conversation.projectId === projectId) {
      return conversation;
    }
    this.assertNoActiveRun(conversationId);
    if (projectId !== null) {
      this.assertProjectExists(projectId);
    }

    const nextSortOrder = conversation.isPinned
      ? null
      : Number((this.database
          .prepare(
            `SELECT COALESCE(MAX(sort_order), -1) + 1 AS sort_order
             FROM conversations
             WHERE project_id IS ? AND is_pinned = 0 AND is_archived = 0
               AND parent_conversation_id IS NULL AND id <> ?
               AND deletion_pending = 0`
          )
          .get(projectId, conversationId) as DatabaseRow).sort_order);

    this.database
      .prepare(
        `UPDATE conversations
         SET project_id = ?,
             workspace_root_path = CASE WHEN ? IS NULL THEN workspace_root_path ELSE NULL END,
             sort_order = COALESCE(?, sort_order),
             updated_at = ?
         WHERE id = ?`
      )
      .run(projectId, projectId, nextSortOrder, new Date().toISOString(), conversationId);
    return this.getConversation(conversationId);
  }

  public setConversationArchived(
    conversationId: string,
    archived: boolean
  ): ConversationSummary {
    const conversation = this.getConversation(conversationId);
    if (archived && (
      conversation.activeRunId !== null || conversation.activeSubagentCount > 0
    )) {
      throw new Error("A running conversation or Subagent cannot be archived.");
    }
    if (conversation.isArchived === archived) {
      return conversation;
    }
    this.database
      .prepare("UPDATE conversations SET is_archived = ?, archived_at = ? WHERE id = ?")
      .run(archived ? 1 : 0, archived ? new Date().toISOString() : null, conversationId);
    return this.getConversation(conversationId);
  }

  public listExpiredArchivedConversationRootIds(cutoffIso: string): string[] {
    const rows = this.database
      .prepare(
        `SELECT id, parent_conversation_id, is_archived, archived_at
         FROM conversations
         WHERE deletion_pending = 0`
      )
      .all() as DatabaseRow[];
    const byId = new Map(rows.map((row) => [asString(row, "id"), row]));
    const expiredIds = new Set(rows.flatMap((row) => {
      const archivedAt = asNullableString(row, "archived_at");
      return asBoolean(row, "is_archived")
        && archivedAt !== null
        && archivedAt <= cutoffIso
        ? [asString(row, "id")]
        : [];
    }));
    return [...expiredIds].filter((conversationId) => {
      let parentId = asNullableString(byId.get(conversationId)!, "parent_conversation_id");
      const visited = new Set<string>();
      while (parentId !== null && !visited.has(parentId)) {
        if (expiredIds.has(parentId)) return false;
        visited.add(parentId);
        const parent = byId.get(parentId);
        parentId = parent === undefined
          ? null
          : asNullableString(parent, "parent_conversation_id");
      }
      return true;
    });
  }

  public setConversationPinned(
    conversationId: string,
    pinned: boolean
  ): ConversationSummary {
    const conversation = this.getConversation(conversationId);
    if (conversation.isPinned === pinned) {
      return conversation;
    }
    if (pinned) {
      this.database
        .prepare(
          `UPDATE conversations
           SET is_pinned = 1,
               pin_order = (SELECT COALESCE(MAX(pin_order), 0) + 1
                            FROM conversations WHERE deletion_pending = 0),
               sort_order = (SELECT COALESCE(MAX(sort_order), -1) + 1
                             FROM conversations
                             WHERE is_pinned = 1 AND is_archived = 0
                               AND parent_conversation_id IS NULL
                               AND deletion_pending = 0)
           WHERE id = ? AND deletion_pending = 0`
        )
        .run(conversationId);
    } else {
      this.database
        .prepare("UPDATE conversations SET is_pinned = 0, pin_order = NULL WHERE id = ?")
        .run(conversationId);
    }
    return this.getConversation(conversationId);
  }

  public reorderConversations(conversationIds: readonly string[]): void {
    if (new Set(conversationIds).size !== conversationIds.length) {
      throw new Error("Conversation order contains duplicate identifiers.");
    }
    const placeholders = conversationIds.map(() => "?").join(", ");
    const rows = this.database
      .prepare(
        `SELECT id, project_id, is_pinned, is_archived, parent_conversation_id
         FROM conversations
         WHERE id IN (${placeholders}) AND deletion_pending = 0`
      )
      .all(...conversationIds) as DatabaseRow[];
    const first = rows[0];
    const firstPinned = first === undefined ? null : asBoolean(first, "is_pinned");
    const firstProjectId = first === undefined ? null : asNullableString(first, "project_id");
    if (
      first === undefined
      || rows.length !== conversationIds.length
      || rows.some((row) => row.is_archived !== 0 || row.parent_conversation_id !== null)
      || rows.some((row) => asBoolean(row, "is_pinned") !== firstPinned)
      || (
        firstPinned === false
        && rows.some((row) => asNullableString(row, "project_id") !== firstProjectId)
      )
    ) {
      throw new Error("Conversations can only be reordered inside one visible group.");
    }
    const countRow = firstPinned === true
      ? this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM conversations
             WHERE is_pinned = 1 AND is_archived = 0 AND parent_conversation_id IS NULL
               AND deletion_pending = 0`
          )
          .get() as DatabaseRow
      : this.database
          .prepare(
            `SELECT COUNT(*) AS count FROM conversations
             WHERE project_id IS ? AND is_pinned = 0 AND is_archived = 0
               AND parent_conversation_id IS NULL AND deletion_pending = 0`
          )
          .get(firstProjectId) as DatabaseRow;
    if (Number(countRow.count) !== conversationIds.length) {
      throw new Error("Conversation reorder must include the complete visible group.");
    }
    this.withTransaction(() => {
      const update = this.database.prepare(
        "UPDATE conversations SET sort_order = ? WHERE id = ?"
      );
      conversationIds.forEach((conversationId, index) => update.run(index, conversationId));
    });
  }

  public markConversationResultViewed(conversationId: string): ConversationSummary {
    this.getConversation(conversationId);
    this.database
      .prepare("UPDATE conversations SET has_unread_result = 0 WHERE id = ?")
      .run(conversationId);
    return this.getConversation(conversationId);
  }

  public createConversationDeletionTask(conversationId: string): ConversationDeletionTask {
    const existingTask = this.listIncompleteConversationDeletionTasks().find((task) =>
      task.conversationIds.includes(conversationId)
    );
    if (existingTask !== undefined) return existingTask;

    this.getConversation(conversationId);
    const conversationRows = this.database
      .prepare(
        `WITH RECURSIVE conversation_tree(id, depth) AS (
           SELECT id, 0 FROM conversations WHERE id = ?
           UNION ALL
           SELECT conversations.id, conversation_tree.depth + 1
           FROM conversations
           JOIN conversation_tree
             ON conversations.parent_conversation_id = conversation_tree.id
         )
         SELECT conversations.id, conversations.deletion_pending
         FROM conversations
         JOIN conversation_tree ON conversation_tree.id = conversations.id
         ORDER BY conversation_tree.depth ASC, conversations.rowid ASC`
      )
      .all(conversationId) as DatabaseRow[];
    if (conversationRows.length === 0) throw new Error("Conversation was not found.");
    if (conversationRows.some((row) => asBoolean(row, "deletion_pending"))) {
      throw new Error("A child conversation is already pending deletion.");
    }
    const conversationIds = conversationRows.map((row) => asString(row, "id"));
    const placeholders = conversationIds.map(() => "?").join(", ");
    const activeRun = this.database
      .prepare(
        `SELECT 1 AS present FROM runs
         WHERE conversation_id IN (${placeholders})
           AND status IN ('queued', 'running')
         LIMIT 1`
      )
      .get(...conversationIds);
    if (activeRun !== undefined) {
      throw new Error("A running conversation cannot be deleted.");
    }
    const fileRows = this.database
      .prepare(
        `SELECT stored_path, extracted_text_path
         FROM conversation_attachments
         WHERE conversation_id IN (${placeholders})`
      )
      .all(...conversationIds) as DatabaseRow[];
    const filePaths = [...new Set(fileRows.flatMap((row) => [
      asString(row, "stored_path"),
      ...(asNullableString(row, "extracted_text_path") === null
        ? []
        : [asString(row, "extracted_text_path")]),
    ]))];
    const now = new Date().toISOString();
    const task: ConversationDeletionTask = {
      conversationIds,
      createdAt: now,
      filePaths,
      id: randomUUID(),
      lastError: null,
      retryCount: 0,
      rootConversationId: conversationId,
      status: "pending",
      updatedAt: now,
    };

    return this.withTransaction(() => {
      this.database.prepare(
        `INSERT INTO conversation_deletion_tasks
           (id, root_conversation_id, conversation_ids_json, file_paths_json,
            status, retry_count, last_error, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        task.id,
        task.rootConversationId,
        JSON.stringify(task.conversationIds),
        JSON.stringify(task.filePaths),
        task.status,
        task.retryCount,
        task.lastError,
        task.createdAt,
        task.updatedAt,
      );
      const result = this.database.prepare(
        `UPDATE conversations SET deletion_pending = 1
         WHERE id IN (${placeholders}) AND deletion_pending = 0`,
      ).run(...conversationIds);
      if (result.changes !== conversationIds.length) {
        throw new Error("Conversation deletion state changed while creating the task.");
      }
      return task;
    });
  }

  public listIncompleteConversationDeletionTasks(): ConversationDeletionTask[] {
    const rows = this.database.prepare(
      `SELECT id, root_conversation_id, conversation_ids_json, file_paths_json,
              status, retry_count, last_error, created_at, updated_at
       FROM conversation_deletion_tasks
       ORDER BY created_at ASC, rowid ASC`,
    ).all() as DatabaseRow[];
    return rows.map(toConversationDeletionTask);
  }

  public beginConversationDeletionTask(taskId: string): ConversationDeletionTask | null {
    const now = new Date().toISOString();
    const result = this.database.prepare(
      `UPDATE conversation_deletion_tasks
       SET status = 'running', retry_count = retry_count + 1,
           last_error = NULL, updated_at = ?
       WHERE id = ?`,
    ).run(now, taskId);
    if (result.changes === 0) return null;
    return this.getConversationDeletionTask(taskId);
  }

  public failConversationDeletionTask(taskId: string, error: string): void {
    this.database.prepare(
      `UPDATE conversation_deletion_tasks
       SET status = 'failed', last_error = ?, updated_at = ?
       WHERE id = ?`,
    ).run(error.slice(0, 4_000), new Date().toISOString(), taskId);
  }

  public completeConversationDeletionTask(taskId: string): void {
    const task = this.getConversationDeletionTask(taskId);
    if (task === null) return;
    this.withTransaction(() => {
      this.database.prepare("DELETE FROM conversations WHERE id = ?")
        .run(task.rootConversationId);
      this.database.prepare("DELETE FROM conversation_deletion_tasks WHERE id = ?")
        .run(task.id);
    });
  }

  private getConversationDeletionTask(taskId: string): ConversationDeletionTask | null {
    const row = this.database.prepare(
      `SELECT id, root_conversation_id, conversation_ids_json, file_paths_json,
              status, retry_count, last_error, created_at, updated_at
       FROM conversation_deletion_tasks WHERE id = ?`,
    ).get(taskId) as DatabaseRow | undefined;
    return row === undefined ? null : toConversationDeletionTask(row);
  }

  public createConversationAttachment(input: StoredConversationAttachment): ConversationAttachment {
    this.getConversation(input.conversationId);
    const validated = conversationAttachmentSchema.parse({
      contextTokens: input.contextTokens,
      conversationId: input.conversationId,
      createdAt: input.createdAt,
      id: input.id,
      kind: input.kind,
      messageId: input.messageId,
      mimeType: input.mimeType,
      name: input.name,
      projectPath: input.projectPath,
      sizeBytes: input.sizeBytes,
      source: input.source,
      truncated: input.truncated
    });
    if (validated.messageId !== null) {
      throw new Error("A new conversation attachment must be a draft.");
    }
    this.database
      .prepare(
        `INSERT INTO conversation_attachments
           (id, conversation_id, message_id, source, kind, name, mime_type,
            size_bytes, project_path, stored_path, extracted_text_path,
            context_tokens, truncated, created_at)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        validated.id,
        validated.conversationId,
        validated.source,
        validated.kind,
        validated.name,
        validated.mimeType,
        validated.sizeBytes,
        validated.projectPath,
        input.storedPath,
        input.extractedTextPath,
        validated.contextTokens,
        Number(validated.truncated),
        validated.createdAt
      );
    return validated;
  }

  public listDraftConversationAttachments(conversationId: string): ConversationAttachment[] {
    this.getConversation(conversationId);
    return this.listStoredAttachments(
      `conversation_id = ? AND message_id IS NULL AND pending_message_id IS NULL
       ORDER BY created_at ASC, rowid ASC`,
      [conversationId]
    ).map(toPublicConversationAttachment);
  }

  public getConversationAttachment(
    conversationId: string,
    attachmentId: string
  ): StoredConversationAttachment {
    const attachments = this.listStoredAttachments(
      "conversation_id = ? AND id = ?",
      [conversationId, attachmentId]
    );
    const attachment = attachments[0];
    if (attachment === undefined) {
      throw new Error("Conversation attachment was not found.");
    }
    return attachment;
  }

  public listConversationAttachmentsByIds(
    conversationId: string,
    attachmentIds: readonly string[]
  ): StoredConversationAttachment[] {
    if (attachmentIds.length === 0) return [];
    if (new Set(attachmentIds).size !== attachmentIds.length) {
      throw new Error("Conversation attachment list contains duplicates.");
    }
    const placeholders = attachmentIds.map(() => "?").join(", ");
    const attachments = this.listStoredAttachments(
      `conversation_id = ? AND id IN (${placeholders})`,
      [conversationId, ...attachmentIds]
    );
    const byId = new Map(attachments.map((attachment) => [attachment.id, attachment]));
    return attachmentIds.map((attachmentId) => {
      const attachment = byId.get(attachmentId);
      if (attachment === undefined) {
        throw new Error("Conversation attachment was not found.");
      }
      return attachment;
    });
  }

  public removeDraftConversationAttachment(
    conversationId: string,
    attachmentId: string
  ): StoredConversationAttachment {
    const attachment = this.getConversationAttachment(conversationId, attachmentId);
    if (attachment.messageId !== null || attachment.pendingMessageId !== null) {
      throw new Error("A sent or queued conversation attachment cannot be removed.");
    }
    const result = this.database
      .prepare(
        `DELETE FROM conversation_attachments
         WHERE conversation_id = ? AND id = ?
           AND message_id IS NULL AND pending_message_id IS NULL`
      )
      .run(conversationId, attachmentId);
    if (result.changes !== 1) {
      throw new Error("Conversation attachment was not found.");
    }
    return attachment;
  }

  public isConversationAttachmentFileReferencedByActiveConversation(filePath: string): boolean {
    return this.database
      .prepare(
        `SELECT 1 AS present FROM conversation_attachments
         JOIN conversations
           ON conversations.id = conversation_attachments.conversation_id
         WHERE conversations.deletion_pending = 0
           AND (stored_path = ? OR extracted_text_path = ?)
         LIMIT 1`
      )
      .get(filePath, filePath) !== undefined;
  }

  public createSubagentTask(input: {
    childConversationId: string;
    parentConversationId: string;
    sourceRunId: string;
    task: string;
    title: string;
  }): SubagentTask {
    const parent = this.getConversation(input.parentConversationId);
    const child = this.getConversation(input.childConversationId);
    if (child.parentConversationId !== parent.id) {
      throw new Error("The Subagent conversation does not belong to the parent conversation.");
    }
    const sourceRun = this.database
      .prepare("SELECT conversation_id FROM runs WHERE id = ?")
      .get(input.sourceRunId) as DatabaseRow | undefined;
    if (sourceRun === undefined || asString(sourceRun, "conversation_id") !== parent.id) {
      throw new Error("The Subagent task source run does not belong to the parent conversation.");
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO subagent_tasks
           (id, parent_conversation_id, child_conversation_id, source_run_id,
            target_run_id, title, task, status, result, error, result_message_id,
            created_at, updated_at, completed_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, 'queued', NULL, NULL, NULL, ?, ?, NULL)`
      )
      .run(
        id,
        parent.id,
        child.id,
        input.sourceRunId,
        input.title,
        input.task,
        now,
        now
      );
    return this.getSubagentTask(id);
  }

  public assignSubagentTaskRun(taskId: string, targetRunId: string): SubagentTask {
    const task = this.getSubagentTask(taskId);
    const run = this.database
      .prepare("SELECT conversation_id FROM runs WHERE id = ?")
      .get(targetRunId) as DatabaseRow | undefined;
    if (run === undefined || asString(run, "conversation_id") !== task.childConversationId) {
      throw new Error("The Subagent run does not belong to the task conversation.");
    }
    const now = new Date().toISOString();
    const update = this.database
      .prepare(
        `UPDATE subagent_tasks
         SET target_run_id = ?, status = 'running', updated_at = ?
         WHERE id = ? AND status = 'queued' AND target_run_id IS NULL`
      )
      .run(targetRunId, now, taskId);
    if (update.changes !== 1) throw new Error("The Subagent task has already started.");
    return this.getSubagentTask(taskId);
  }

  public getSubagentTask(taskId: string): SubagentTask {
    const row = this.database
      .prepare("SELECT * FROM subagent_tasks WHERE id = ?")
      .get(taskId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Subagent task was not found.");
    return toSubagentTask(row);
  }

  public listSubagentTasks(parentConversationId: string): SubagentTask[] {
    this.getConversation(parentConversationId);
    const rows = this.database
      .prepare(
        `SELECT * FROM subagent_tasks
         WHERE parent_conversation_id = ? ORDER BY created_at ASC`
      )
      .all(parentConversationId) as DatabaseRow[];
    return rows.map(toSubagentTask);
  }

  public listUndeliveredSubagentTasks(): SubagentTask[] {
    const rows = this.database
      .prepare(
        `SELECT * FROM subagent_tasks
         WHERE status IN ('completed', 'failed', 'cancelled')
           AND result_message_id IS NULL
         ORDER BY completed_at ASC, created_at ASC`
      )
      .all() as DatabaseRow[];
    return rows.map(toSubagentTask);
  }

  public completeSubagentTaskByRun(input: {
    error: string | null;
    result: string | null;
    status: "completed" | "failed" | "cancelled";
    targetRunId: string;
  }): SubagentTask | null {
    return this.withTransaction(() => this.completeSubagentTaskByRunInTransaction(input));
  }

  public deliverSubagentTaskResult(taskId: string): ConversationAgentMessageItem | null {
    return this.withTransaction(() => this.deliverSubagentTaskResultInTransaction(taskId));
  }

  private completeSubagentTaskByRunInTransaction(input: {
    error: string | null;
    result: string | null;
    status: "completed" | "failed" | "cancelled";
    targetRunId: string;
  }): SubagentTask | null {
    const row = this.database
      .prepare("SELECT id FROM subagent_tasks WHERE target_run_id = ?")
      .get(input.targetRunId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    const taskId = asString(row, "id");
    const current = this.getSubagentTask(taskId);
    if (current.status !== "queued" && current.status !== "running") return current;
    const now = new Date().toISOString();
    const update = this.database
      .prepare(
        `UPDATE subagent_tasks
         SET status = ?, result = ?, error = ?, updated_at = ?, completed_at = ?
         WHERE id = ? AND status IN ('queued', 'running')`
      )
      .run(input.status, input.result, input.error, now, now, taskId);
    if (update.changes !== 1) {
      throw new Error("The Subagent task changed before completion could be committed.");
    }
    return this.getSubagentTask(taskId);
  }

  private deliverSubagentTaskResultInTransaction(
    taskId: string
  ): ConversationAgentMessageItem | null {
    const task = this.getSubagentTask(taskId);
    if (
      task.resultMessageId !== null
      || (task.status !== "completed" && task.status !== "failed" && task.status !== "cancelled")
    ) {
      return null;
    }
    const sender = this.getConversation(task.childConversationId);
    const target = this.getConversation(task.parentConversationId);
    const now = new Date().toISOString();
    const fullContent = task.status === "completed"
      ? task.result?.trim() || "Subagent 已完成任务，但未提供最终说明。"
      : task.status === "cancelled"
        ? `Subagent 任务已取消：${task.error?.trim() || "未提供原因。"}`
        : `Subagent 任务失败：${task.error?.trim() || "未提供错误信息。"}`;
    const content = fullContent.length <= MAX_SUBAGENT_RESULT_SUMMARY_LENGTH
      ? fullContent
      : `${fullContent.slice(0, MAX_SUBAGENT_RESULT_SUMMARY_LENGTH - 28)}\n\n[摘要已截断，可读取完整子对话]`;
    const message = conversationAgentMessageItemSchema.parse({
      content,
      conversationId: target.id,
      createdAt: now,
      id: randomUUID(),
      kind: "agent_message",
      messageType: "task_result",
      readAt: null,
      runId: task.targetRunId,
      senderConversationId: sender.id,
      senderTitle: sender.title,
      status: "unread",
      taskId: task.id
    });

    this.persistAgentMessage(message, false);
    const update = this.database
      .prepare(
        `UPDATE subagent_tasks SET result_message_id = ?, updated_at = ?
         WHERE id = ? AND result_message_id IS NULL`
      )
      .run(message.id, now, task.id);
    if (update.changes !== 1) {
      throw new Error("The Subagent result changed before delivery could be committed.");
    }
    return message;
  }

  public listTimeline(conversationId: string): ConversationTimelineItem[] {
    this.getConversation(conversationId);
    const rows = this.database
      .prepare(
        `SELECT payload_json FROM conversation_timeline
         WHERE conversation_id = ? ORDER BY sequence ASC`
      )
      .all(conversationId) as DatabaseRow[];
    return rows.map((row) =>
      conversationTimelineItemSchema.parse(
        parseJson(asString(row, "payload_json"), "timeline item")
      )
    );
  }

  public sendAgentMessage(input: SendAgentMessageInput): ConversationAgentMessageItem {
    const sender = this.getConversation(input.senderConversationId);
    const target = this.getConversation(input.targetConversationId);
    if (sender.id === target.id) {
      throw new Error("An Agent cannot send a message to its own conversation.");
    }
    if (target.isArchived && input.messageType !== "agent_result") {
      throw new Error("An archived conversation cannot receive Agent messages.");
    }
    if (
      target.subagentTaskStatus === "completed"
      || target.subagentTaskStatus === "failed"
      || target.subagentTaskStatus === "cancelled"
    ) {
      throw new Error("A finished Subagent conversation is read-only.");
    }
    const now = new Date().toISOString();
    const message = conversationAgentMessageItemSchema.parse({
      content: input.content,
      conversationId: target.id,
      createdAt: now,
      id: randomUUID(),
      kind: "agent_message",
      messageType: input.messageType ?? "message",
      readAt: null,
      runId: input.runId,
      senderConversationId: sender.id,
      senderTitle: sender.title,
      status: "unread",
      taskId: input.taskId ?? null
    });

    this.withTransaction(() => this.persistAgentMessage(message));
    return message;
  }

  private persistAgentMessage(
    message: ConversationAgentMessageItem,
    includeInTimeline = true
  ): void {
    this.database
      .prepare(
        `INSERT INTO conversation_agent_messages
           (id, sender_conversation_id, target_conversation_id, status,
            payload_json, created_at, read_at)
         VALUES (?, ?, ?, 'unread', ?, ?, NULL)`
      )
      .run(
        message.id,
        message.senderConversationId,
        message.conversationId,
        JSON.stringify(message),
        message.createdAt
      );
    if (includeInTimeline) this.insertTimelineItem(message);
    this.insertModelMessage({
      attachmentIds: [],
      content: agentMessageModelContent(message),
      conversationId: message.conversationId,
      role: "user",
      runId: null,
      toolCallId: null,
      toolCalls: []
    });
    this.database
      .prepare(
        `UPDATE conversations
         SET updated_at = ?, has_unread_result = 1
         WHERE id = ?`
      )
      .run(message.createdAt, message.conversationId);
  }

  public listUnreadAgentMessages(
    conversationId: string,
    senderConversationId?: string
  ): ConversationAgentMessageItem[] {
    this.getConversation(conversationId);
    const rows = senderConversationId === undefined
      ? this.database
          .prepare(
            `SELECT payload_json FROM conversation_agent_messages
             WHERE target_conversation_id = ? AND status = 'unread'
             ORDER BY created_at ASC LIMIT 50`
          )
          .all(conversationId) as DatabaseRow[]
      : this.database
          .prepare(
            `SELECT payload_json FROM conversation_agent_messages
             WHERE target_conversation_id = ? AND sender_conversation_id = ?
               AND status = 'unread'
             ORDER BY created_at ASC LIMIT 50`
          )
          .all(conversationId, senderConversationId) as DatabaseRow[];
    return rows.map((row) => conversationAgentMessageItemSchema.parse(
      parseJson(asString(row, "payload_json"), "Agent message")
    ));
  }

  public listConversationIdsWithUnreadAgentMessages(): string[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT target_conversation_id
         FROM conversation_agent_messages
         WHERE status = 'unread' ORDER BY created_at ASC`
      )
      .all() as DatabaseRow[];
    return rows.map((row) => asString(row, "target_conversation_id"));
  }

  public markAgentMessagesRead(messageIds: readonly string[]): void {
    if (messageIds.length === 0) return;
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const readStoredMessage = this.database.prepare(
        "SELECT payload_json FROM conversation_agent_messages WHERE id = ?"
      );
      const updateStoredMessage = this.database.prepare(
        `UPDATE conversation_agent_messages
         SET status = 'read', payload_json = ?, read_at = ? WHERE id = ?`
      );
      const updateTimeline = this.database.prepare(
        "UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'agent_message'"
      );
      for (const messageId of messageIds) {
        const row = readStoredMessage.get(messageId) as DatabaseRow | undefined;
        if (row === undefined) continue;
        const current = conversationAgentMessageItemSchema.parse(
          parseJson(asString(row, "payload_json"), "Agent message")
        );
        if (current.status === "read") continue;
        const read = conversationAgentMessageItemSchema.parse({
          ...current,
          readAt: now,
          status: "read"
        });
        updateStoredMessage.run(JSON.stringify(read), now, messageId);
        updateTimeline.run(JSON.stringify(read), messageId);
      }
    });
  }

  public getTaskList(conversationId: string): ConversationTaskList | null {
    this.getConversation(conversationId);
    const row = this.database
      .prepare(
        "SELECT payload_json FROM conversation_task_lists WHERE conversation_id = ?"
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    const taskList = conversationTaskListSchema.parse(
      parseJson(asString(row, "payload_json"), "conversation task list")
    );
    if (taskList.status === "closed") {
      this.database
        .prepare("DELETE FROM conversation_task_lists WHERE conversation_id = ?")
        .run(conversationId);
      return null;
    }
    return taskList;
  }

  public createTaskList(
    conversationId: string,
    tasks: ReadonlyArray<Pick<ConversationTask, "status" | "title">>
  ): ConversationTaskList {
    this.getConversation(conversationId);
    const previous = this.getTaskList(conversationId);
    if (previous?.status === "active") {
      throw new Error("An active task list already exists for this conversation.");
    }
    return this.saveActiveTaskList(conversationId, tasks, null);
  }

  public updateTaskList(
    conversationId: string,
    tasks: ReadonlyArray<Pick<ConversationTask, "status" | "title">>
  ): ConversationTaskList {
    this.getConversation(conversationId);
    const previous = this.getTaskList(conversationId);
    if (previous === null) {
      throw new Error("No active task list exists for this conversation. Create one first.");
    }
    if (previous.status !== "active") {
      throw new Error("The task list is closed. Create a new task list before updating it.");
    }
    return this.saveActiveTaskList(conversationId, tasks, previous);
  }

  public closeTaskList(conversationId: string): void {
    this.deleteTaskList(conversationId);
  }

  public deleteTaskList(conversationId: string): void {
    this.getConversation(conversationId);
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database
        .prepare("DELETE FROM conversation_task_lists WHERE conversation_id = ?")
        .run(conversationId);
      if (result.changes !== 1) {
        throw new Error("Task list was not found.");
      }
      this.touchConversation(conversationId, now);
    });
  }

  private saveActiveTaskList(
    conversationId: string,
    tasks: ReadonlyArray<Pick<ConversationTask, "status" | "title">>,
    previous: ConversationTaskList | null
  ): ConversationTaskList {
    const now = new Date().toISOString();
    const taskList = conversationTaskListSchema.parse({
      closedAt: null,
      conversationId,
      createdAt: previous?.createdAt ?? now,
      status: "active",
      tasks: tasks.map((task, index) => ({
        id:
          previous?.tasks[index]?.title === task.title
            ? previous.tasks[index].id
            : randomUUID(),
        status: task.status,
        title: task.title
      })),
      updatedAt: now
    });
    this.persistTaskList(taskList, now);
    return taskList;
  }

  private persistTaskList(taskList: ConversationTaskList, now: string): void {
    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO conversation_task_lists (conversation_id, payload_json, updated_at)
           VALUES (?, ?, ?)
           ON CONFLICT(conversation_id) DO UPDATE SET
             payload_json = excluded.payload_json,
             updated_at = excluded.updated_at`
        )
        .run(taskList.conversationId, JSON.stringify(taskList), now);
      this.touchConversation(taskList.conversationId, now);
    });
  }

  public completeRunningTasks(conversationId: string): ConversationTaskList | null {
    const taskList = this.getTaskList(conversationId);
    if (
      taskList === null ||
      taskList.status !== "active" ||
      !taskList.tasks.some((task) => task.status === "running")
    ) {
      return null;
    }
    return this.updateTaskList(
      conversationId,
      taskList.tasks.map((task) => ({
        status: task.status === "running" ? "completed" : task.status,
        title: task.title
      }))
    );
  }

  public enqueuePendingMessage(rawInput: SendConversationMessageInput): ConversationPendingMessage {
    const input = sendConversationMessageInputSchema.parse(rawInput);
    this.getConversation(input.conversationId);
    const deliveryMode = input.deliveryMode ?? "queue";
    const attachmentIds = input.attachmentIds ?? [];
    const attachments = this.listConversationAttachmentsByIds(
      input.conversationId,
      attachmentIds
    );
    if (attachments.some(
      (attachment) => attachment.messageId !== null || attachment.pendingMessageId !== null
    )) {
      throw new Error("Only unqueued draft attachments can be added to a pending message.");
    }

    const now = new Date().toISOString();
    const id = randomUUID();
    const storedInput = { ...input, deliveryMode };
    const message = conversationPendingMessageSchema.parse({
      attachmentIds,
      content: input.content,
      conversationId: input.conversationId,
      createdAt: now,
      deliveryMode,
      id,
      referencedConversationIds: input.referencedConversationIds ?? [],
      referencedProjectPaths: input.referencedProjectPaths ?? []
    });

    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO conversation_pending_messages
             (id, conversation_id, delivery_mode, status, payload_json, sort_order,
              created_at, updated_at, consumed_at)
           SELECT ?, ?, ?, 'pending', ?, COALESCE(MAX(sort_order), -1) + 1, ?, ?, NULL
           FROM conversation_pending_messages
           WHERE conversation_id = ? AND status = 'pending'`
        )
        .run(
          id,
          input.conversationId,
          deliveryMode,
          JSON.stringify(storedInput),
          now,
          now,
          input.conversationId
        );
      if (attachmentIds.length > 0) {
        const placeholders = attachmentIds.map(() => "?").join(", ");
        const result = this.database
          .prepare(
            `UPDATE conversation_attachments SET pending_message_id = ?
             WHERE conversation_id = ? AND message_id IS NULL
               AND pending_message_id IS NULL AND id IN (${placeholders})`
          )
          .run(id, input.conversationId, ...attachmentIds);
        if (result.changes !== attachmentIds.length) {
          throw new Error("One or more conversation attachments are no longer available.");
        }
      }
      this.touchConversation(input.conversationId, now);
    });
    return message;
  }

  public listPendingMessages(conversationId: string): ConversationPendingMessage[] {
    return this.listPendingMessageRecords(conversationId).map((record) => record.message);
  }

  public listPendingMessageRecords(
    conversationId: string,
    deliveryMode?: "queue" | "steer"
  ): StoredPendingMessage[] {
    this.getConversation(conversationId);
    const rows = this.database
      .prepare(
        `SELECT id, conversation_id, delivery_mode, payload_json, created_at
         FROM conversation_pending_messages
         WHERE conversation_id = ? AND status = 'pending'
           AND (? IS NULL OR delivery_mode = ?)
         ORDER BY sort_order ASC, sequence ASC`
      )
      .all(conversationId, deliveryMode ?? null, deliveryMode ?? null) as DatabaseRow[];
    return rows.map(toStoredPendingMessage);
  }

  public getNextPendingMessageRecord(conversationId: string): StoredPendingMessage | null {
    this.getConversation(conversationId);
    const row = this.database
      .prepare(
        `SELECT id, conversation_id, delivery_mode, payload_json, created_at
         FROM conversation_pending_messages
         WHERE conversation_id = ? AND status = 'pending'
         ORDER BY CASE delivery_mode WHEN 'steer' THEN 0 ELSE 1 END,
                  sort_order ASC, sequence ASC
         LIMIT 1`
      )
      .get(conversationId) as DatabaseRow | undefined;
    return row === undefined ? null : toStoredPendingMessage(row);
  }

  public listConversationIdsWithPendingMessages(): string[] {
    const rows = this.database
      .prepare(
        `SELECT DISTINCT pending.conversation_id
         FROM conversation_pending_messages AS pending
         WHERE pending.status = 'pending'
           AND NOT EXISTS (
             SELECT 1 FROM runs
             WHERE runs.conversation_id = pending.conversation_id
               AND runs.status IN ('queued', 'running')
           )
         ORDER BY pending.conversation_id ASC`
      )
      .all() as DatabaseRow[];
    return rows.map((row) => asString(row, "conversation_id"));
  }

  public promotePendingMessage(pendingMessageId: string): ConversationPendingMessage[] {
    const record = this.getPendingMessageRecord(pendingMessageId);
    const input = { ...record.input, deliveryMode: "steer" as const };
    const result = this.database
      .prepare(
        `UPDATE conversation_pending_messages
         SET delivery_mode = 'steer', payload_json = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(JSON.stringify(input), new Date().toISOString(), pendingMessageId);
    if (result.changes !== 1) throw new Error("Pending conversation message was not found.");
    return this.listPendingMessages(record.message.conversationId);
  }

  public updatePendingMessage(
    pendingMessageId: string,
    content: string
  ): ConversationPendingMessage[] {
    const record = this.getPendingMessageRecord(pendingMessageId);
    const input = sendConversationMessageInputSchema.parse({ ...record.input, content });
    const result = this.database
      .prepare(
        `UPDATE conversation_pending_messages SET payload_json = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(JSON.stringify(input), new Date().toISOString(), pendingMessageId);
    if (result.changes !== 1) throw new Error("Pending conversation message was not found.");
    return this.listPendingMessages(record.message.conversationId);
  }

  public reorderPendingMessages(
    conversationId: string,
    pendingMessageIds: readonly string[]
  ): ConversationPendingMessage[] {
    const current = this.listPendingMessages(conversationId).map((message) => message.id);
    if (
      current.length !== pendingMessageIds.length
      || current.some((id) => !pendingMessageIds.includes(id))
      || new Set(pendingMessageIds).size !== pendingMessageIds.length
    ) {
      throw new Error("Pending message reorder must include the complete queue.");
    }
    this.withTransaction(() => {
      const update = this.database.prepare(
        `UPDATE conversation_pending_messages SET sort_order = ?, updated_at = ?
         WHERE id = ? AND conversation_id = ? AND status = 'pending'`
      );
      const now = new Date().toISOString();
      pendingMessageIds.forEach((id, index) => update.run(index, now, id, conversationId));
    });
    return this.listPendingMessages(conversationId);
  }

  public deletePendingMessage(pendingMessageId: string): ConversationPendingMessage[] {
    const record = this.getPendingMessageRecord(pendingMessageId);
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database
        .prepare(
          `UPDATE conversation_pending_messages
           SET status = 'cancelled', consumed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`
        )
        .run(now, now, pendingMessageId);
      if (result.changes !== 1) throw new Error("Pending conversation message was not found.");
      this.database
        .prepare(
          `UPDATE conversation_attachments SET pending_message_id = NULL
           WHERE pending_message_id = ? AND message_id IS NULL`
        )
        .run(pendingMessageId);
      this.touchConversation(record.message.conversationId, now);
    });
    return this.listPendingMessages(record.message.conversationId);
  }

  public consumePendingMessageIntoRun(
    pendingMessageId: string,
    runId: string,
    modelContent: string
  ): ConversationMessageItem {
    const record = this.getPendingMessageRecord(pendingMessageId);
    const conversation = this.getConversation(record.message.conversationId);
    if (conversation.activeRunId !== runId) {
      throw new Error("Pending message can only steer its active conversation run.");
    }
    const messageId = randomUUID();
    const attachments = this.listConversationAttachmentsByIds(
      record.message.conversationId,
      record.message.attachmentIds
    );
    if (attachments.some((attachment) => attachment.pendingMessageId !== pendingMessageId)) {
      throw new Error("A queued attachment is no longer reserved for this message.");
    }
    const message = conversationMessageItemSchema.parse({
      attachments: attachments.map((attachment) => ({
        ...toPublicConversationAttachment(attachment),
        messageId
      })),
      content: record.message.content,
      conversationId: record.message.conversationId,
      createdAt: new Date().toISOString(),
      id: messageId,
      kind: "message",
      modelId: null,
      role: "user",
      runId,
      status: "completed"
    });

    this.withTransaction(() => {
      this.consumePendingRecord(pendingMessageId);
      this.insertTimelineItem(message);
      this.bindPendingAttachmentsToMessage(pendingMessageId, message.id, message.attachments.length);
      this.insertModelMessage({
        attachmentIds: record.message.attachmentIds,
        content: modelContent,
        conversationId: record.message.conversationId,
        role: "user",
        runId,
        toolCallId: null,
        toolCalls: []
      });
      this.touchConversation(record.message.conversationId, message.createdAt);
    });
    return message;
  }

  public createRunFromPendingMessage(
    pendingMessageId: string,
    modelId: string,
    modelContent: string
  ): RunCreation {
    const record = this.getPendingMessageRecord(pendingMessageId);
    const conversation = this.getConversation(record.message.conversationId);
    this.assertNoActiveRun(record.message.conversationId);
    const runId = randomUUID();
    const messageId = randomUUID();
    const now = new Date().toISOString();
    const attachments = this.listConversationAttachmentsByIds(
      record.message.conversationId,
      record.message.attachmentIds
    );
    if (attachments.some((attachment) => attachment.pendingMessageId !== pendingMessageId)) {
      throw new Error("A queued attachment is no longer reserved for this message.");
    }
    const message = conversationMessageItemSchema.parse({
      attachments: attachments.map((attachment) => ({
        ...toPublicConversationAttachment(attachment),
        messageId
      })),
      content: record.message.content,
      conversationId: record.message.conversationId,
      createdAt: now,
      id: messageId,
      kind: "message",
      modelId: null,
      role: "user",
      runId,
      status: "completed"
    });
    const userMessageCount = this.countUserMessages(record.message.conversationId);
    const nextTitle = userMessageCount === 0
      ? this.createTitleFromMessage(
          record.message.content || attachments[0]?.name || "新会话"
        )
      : conversation.title;

    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs
             (id, conversation_id, model_id, status, error, created_at, updated_at)
           VALUES (?, ?, ?, 'queued', NULL, ?, ?)`
        )
        .run(runId, record.message.conversationId, modelId, now, now);
      this.consumePendingRecord(pendingMessageId);
      this.insertTimelineItem(message);
      this.bindPendingAttachmentsToMessage(pendingMessageId, message.id, message.attachments.length);
      this.insertModelMessage({
        attachmentIds: record.message.attachmentIds,
        content: modelContent,
        conversationId: record.message.conversationId,
        role: "user",
        runId,
        toolCallId: null,
        toolCalls: []
      });
      this.database
        .prepare(
          "UPDATE conversations SET title = ?, updated_at = ?, has_unread_result = 0 WHERE id = ?"
        )
        .run(nextTitle, now, record.message.conversationId);
    });
    return {
      conversation: this.getConversation(record.message.conversationId),
      runId,
      userMessage: message
    };
  }

  public createRunForAgentMessage(
    conversationId: string,
    modelId: string,
  ): AgentMessageRunCreation {
    this.getConversation(conversationId);
    this.assertNoActiveRun(conversationId);
    const now = new Date().toISOString();
    const runId = randomUUID();

    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs
             (id, conversation_id, model_id, status, error, created_at, updated_at)
           VALUES (?, ?, ?, 'queued', NULL, ?, ?)`
        )
        .run(runId, conversationId, modelId, now, now);
      this.database
        .prepare(
          "UPDATE conversations SET updated_at = ?, has_unread_result = 0 WHERE id = ?"
        )
        .run(now, conversationId);
    });

    return {
      conversation: this.getConversation(conversationId),
      runId,
    };
  }

  public createRunWithUserMessage(
    conversationId: string,
    content: string,
    modelId: string,
    attachmentIds: readonly string[] = [],
    modelContent = content,
  ): RunCreation {
    const conversation = this.getConversation(conversationId);
    this.assertNoActiveRun(conversationId);
    const now = new Date().toISOString();
    const runId = randomUUID();
    const attachments = this.listConversationAttachmentsByIds(conversationId, attachmentIds);
    if (attachments.some(
      (attachment) => attachment.messageId !== null || attachment.pendingMessageId !== null
    )) {
      throw new Error("Only draft attachments can be sent.");
    }
    const messageId = randomUUID();
    const message = conversationMessageItemSchema.parse({
      attachments: attachments.map((attachment) => ({
        contextTokens: attachment.contextTokens,
        conversationId: attachment.conversationId,
        createdAt: attachment.createdAt,
        id: attachment.id,
        kind: attachment.kind,
        messageId,
        mimeType: attachment.mimeType,
        name: attachment.name,
        projectPath: attachment.projectPath,
        sizeBytes: attachment.sizeBytes,
        source: attachment.source,
        truncated: attachment.truncated
      })),
      content,
      conversationId,
      createdAt: now,
      id: messageId,
      kind: "message",
      modelId: null,
      role: "user",
      runId,
      status: "completed"
    });
    const userMessageCount = this.countUserMessages(conversationId);
    const nextTitle = userMessageCount === 0
      ? this.createTitleFromMessage(content || attachments[0]?.name || "新会话")
      : conversation.title;

    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs
             (id, conversation_id, model_id, status, error, created_at, updated_at)
           VALUES (?, ?, ?, 'queued', NULL, ?, ?)`
        )
        .run(runId, conversationId, modelId, now, now);
      this.insertTimelineItem(message);
      if (attachmentIds.length > 0) {
        const placeholders = attachmentIds.map(() => "?").join(", ");
        const result = this.database
          .prepare(
            `UPDATE conversation_attachments SET message_id = ?
             WHERE conversation_id = ? AND message_id IS NULL
               AND pending_message_id IS NULL AND id IN (${placeholders})`
          )
          .run(message.id, conversationId, ...attachmentIds);
        if (result.changes !== attachmentIds.length) {
          throw new Error("One or more conversation attachments are no longer drafts.");
        }
      }
      this.insertModelMessage({
        attachmentIds,
        content: modelContent,
        conversationId,
        role: "user",
        runId,
        toolCallId: null,
        toolCalls: []
      });
      this.database
        .prepare(
          "UPDATE conversations SET title = ?, updated_at = ?, has_unread_result = 0 WHERE id = ?"
        )
        .run(nextTitle, now, conversationId);
    });

    return {
      conversation: this.getConversation(conversationId),
      runId,
      userMessage: message
    };
  }

  public getLatestUserMessageReplacementSource(
    conversationId: string,
    messageId: string,
  ): LatestUserMessageReplacementSource {
    this.getConversation(conversationId);
    const timelineRecord = this.getLatestUserTimelineRecord(conversationId);
    if (timelineRecord === null || timelineRecord.message.id !== messageId) {
      throw new Error("Only the latest sent user message can be edited.");
    }
    const runId = timelineRecord.message.runId;
    if (runId === null) throw new Error("The selected user message is not associated with a run.");
    const modelRecord = this.getLatestUserModelMessageRecord(conversationId, runId);
    if (modelRecord === null) {
      throw new Error("The selected user message is missing from the model context.");
    }
    const timelineAttachmentIds = timelineRecord.message.attachments.map(
      (attachment) => attachment.id,
    );
    if (
      timelineAttachmentIds.length !== modelRecord.attachmentIds.length
      || timelineAttachmentIds.some((id, index) => id !== modelRecord.attachmentIds[index])
    ) {
      throw new Error("The selected user message attachments are inconsistent.");
    }
    return {
      message: timelineRecord.message,
      modelContent: modelRecord.content,
    };
  }

  public replaceLatestUserMessage(input: ReplaceLatestUserMessageInput): RunCreation {
    const now = new Date().toISOString();
    const runId = randomUUID();
    let replacement: ConversationMessageItem | null = null;

    this.withTransaction(() => {
      const conversation = this.getConversation(input.conversationId);
      this.assertNoActiveRun(input.conversationId);
      const timelineRecord = this.getLatestUserTimelineRecord(input.conversationId);
      if (timelineRecord === null || timelineRecord.message.id !== input.messageId) {
        throw new Error("Only the latest sent user message can be edited.");
      }
      const oldRunId = timelineRecord.message.runId;
      if (oldRunId === null) {
        throw new Error("The selected user message is not associated with a run.");
      }
      const modelRecord = this.getLatestUserModelMessageRecord(input.conversationId, oldRunId);
      if (modelRecord === null) {
        throw new Error("The selected user message is missing from the model context.");
      }
      const message = conversationMessageItemSchema.parse({
        ...timelineRecord.message,
        content: input.content,
        createdAt: now,
        runId,
      });

      this.database.prepare(
        `DELETE FROM conversation_timeline
         WHERE conversation_id = ? AND run_id = ? AND sequence > ?`,
      ).run(input.conversationId, oldRunId, timelineRecord.sequence);
      this.database.prepare(
        `DELETE FROM model_messages
         WHERE conversation_id = ? AND run_id = ? AND sequence > ?`,
      ).run(input.conversationId, oldRunId, modelRecord.sequence);
      const timelineUpdate = this.database.prepare(
        `UPDATE conversation_timeline
         SET run_id = ?, payload_json = ?, created_at = ?
         WHERE id = ? AND conversation_id = ? AND run_id = ?`,
      ).run(
        runId,
        JSON.stringify(message),
        now,
        input.messageId,
        input.conversationId,
        oldRunId,
      );
      if (timelineUpdate.changes !== 1) {
        throw new Error("The latest user timeline message could not be replaced.");
      }
      const modelUpdate = this.database.prepare(
        `UPDATE model_messages
         SET run_id = ?, content = ?, created_at = ?
         WHERE id = ? AND conversation_id = ? AND run_id = ?`,
      ).run(
        runId,
        input.modelContent,
        now,
        modelRecord.id,
        input.conversationId,
        oldRunId,
      );
      if (modelUpdate.changes !== 1) {
        throw new Error("The latest user model message could not be replaced.");
      }
      this.database.prepare(
        `DELETE FROM conversation_context_checkpoints
         WHERE conversation_id = ? AND covered_through_sequence >= ?`,
      ).run(input.conversationId, modelRecord.sequence);
      this.database.prepare(
        `INSERT INTO runs
           (id, conversation_id, model_id, status, error, created_at, updated_at)
         VALUES (?, ?, ?, 'queued', NULL, ?, ?)`,
      ).run(runId, input.conversationId, input.modelId, now, now);
      const nextTitle = this.countUserMessages(input.conversationId) === 1
        ? this.createTitleFromMessage(
            input.content || message.attachments[0]?.name || "新会话",
          )
        : conversation.title;
      this.database.prepare(
        `UPDATE conversations
         SET title = ?, updated_at = ?, has_unread_result = 0
         WHERE id = ?`,
      ).run(nextTitle, now, input.conversationId);
      replacement = message;
    });

    if (replacement === null) throw new Error("The latest user message could not be replaced.");
    return {
      conversation: this.getConversation(input.conversationId),
      runId,
      userMessage: replacement,
    };
  }

  public markRunRunning(runId: string): void {
    this.updateRun(runId, "running", null);
  }

  public finishRun(
    runId: string,
    status: "completed" | "failed" | "cancelled",
    error: string | null
  ): void {
    this.updateRun(runId, status, error);
  }

  public completeRun(input: CompleteRunInput): CompletedRun {
    if (input.assistant?.kind === "failure" && input.status !== "failed") {
      throw new Error("A failed Assistant message requires a failed Run.");
    }
    if (input.assistant?.kind === "turn" && input.status !== "completed") {
      throw new Error("A final Assistant turn requires a completed Run.");
    }
    if (input.assistant?.kind === "cancelled" && input.status !== "cancelled") {
      throw new Error("A partial Assistant message requires a cancelled Run.");
    }

    return this.withTransaction(() => {
      const runConversationId = this.updateRunInTransaction(
        input.runId,
        input.status,
        input.error,
      );
      if (runConversationId !== input.conversationId) {
        throw new Error("The Run does not belong to the conversation.");
      }

      let assistantMessage: ConversationMessageItem | null = null;
      if (input.assistant?.kind === "turn") {
        const now = new Date().toISOString();
        assistantMessage = input.assistant.content.length === 0
          ? null
          : conversationMessageItemSchema.parse({
              content: input.assistant.content,
              conversationId: input.conversationId,
              createdAt: now,
              id: input.assistant.messageId,
              kind: "message",
              modelId: input.assistant.modelId,
              role: "assistant",
              runId: input.runId,
              status: "completed"
            });
        this.insertModelMessage({
          attachmentIds: [],
          content: input.assistant.content,
          conversationId: input.conversationId,
          ...(input.assistant.providerState === undefined
            ? {}
            : { providerState: input.assistant.providerState }),
          role: "assistant",
          runId: input.runId,
          toolCallId: null,
          toolCalls: []
        });
        if (assistantMessage !== null) this.insertTimelineItem(assistantMessage);
        this.touchConversation(input.conversationId, now);
      } else if (input.assistant?.kind === "failure") {
        const now = new Date().toISOString();
        assistantMessage = conversationMessageItemSchema.parse({
          content: input.assistant.content,
          conversationId: input.conversationId,
          createdAt: now,
          id: input.assistant.messageId,
          kind: "message",
          modelId: input.assistant.modelId,
          role: "assistant",
          runId: input.runId,
          status: "failed"
        });
        this.insertTimelineItem(assistantMessage);
        this.touchConversation(input.conversationId, now);
      } else if (input.assistant?.kind === "cancelled") {
        const now = new Date().toISOString();
        assistantMessage = input.assistant.content.length === 0
          ? null
          : conversationMessageItemSchema.parse({
              content: input.assistant.content,
              conversationId: input.conversationId,
              createdAt: now,
              id: input.assistant.messageId,
              kind: "message",
              modelId: input.assistant.modelId,
              role: "assistant",
              runId: input.runId,
              status: "cancelled"
            });
        this.insertModelMessage({
          attachmentIds: [],
          content: input.assistant.content,
          conversationId: input.conversationId,
          ...(input.assistant.providerState === undefined
            ? {}
            : { providerState: input.assistant.providerState }),
          role: "assistant",
          runId: input.runId,
          toolCallId: null,
          toolCalls: []
        });
        if (assistantMessage !== null) this.insertTimelineItem(assistantMessage);
        this.touchConversation(input.conversationId, now);
      }

      const subagentTask = this.completeSubagentTaskByRunInTransaction({
        error: input.error,
        result: input.result,
        status: input.status,
        targetRunId: input.runId,
      });
      const subagentResultMessage = subagentTask === null
        ? null
        : this.deliverSubagentTaskResultInTransaction(subagentTask.id);
      return { assistantMessage, subagentResultMessage, subagentTask };
    });
  }

  public appendAssistantTurn(input: {
    content: string;
    conversationId: string;
    messageId: string;
    modelId: string;
    providerState?: ModelProviderState;
    runId: string;
    toolCalls: ModelToolCall[];
  }): ConversationMessageItem | null {
    const now = new Date().toISOString();
    const message =
      input.content.length === 0
        ? null
        : conversationMessageItemSchema.parse({
            content: input.content,
            conversationId: input.conversationId,
            createdAt: now,
            id: input.messageId,
            kind: "message",
            modelId: input.modelId,
            role: "assistant",
            runId: input.runId,
            status: "completed"
          });

    this.withTransaction(() => {
      this.insertModelMessage({
        attachmentIds: [],
        content: input.content,
        conversationId: input.conversationId,
        ...(input.providerState === undefined ? {} : { providerState: input.providerState }),
        role: "assistant",
        runId: input.runId,
        toolCallId: null,
        toolCalls: input.toolCalls
      });
      if (message !== null) {
        this.insertTimelineItem(message);
      }
      this.touchConversation(input.conversationId, now);
    });
    return message;
  }

  public appendAssistantFailure(input: {
    content: string;
    conversationId: string;
    messageId: string;
    modelId: string;
    runId: string;
  }): ConversationMessageItem {
    const now = new Date().toISOString();
    const message = conversationMessageItemSchema.parse({
      content: input.content,
      conversationId: input.conversationId,
      createdAt: now,
      id: input.messageId,
      kind: "message",
      modelId: input.modelId,
      role: "assistant",
      runId: input.runId,
      status: "failed"
    });

    this.withTransaction(() => {
      this.insertTimelineItem(message);
      this.touchConversation(input.conversationId, now);
    });
    return message;
  }

  public appendToolStarted(tool: ConversationToolItem): void {
    const validated = conversationToolItemSchema.parse(tool);
    this.insertTimelineItem(validated);
  }

  public updateTool(tool: ConversationToolItem): void {
    const validated = conversationToolItemSchema.parse(tool);
    const update = this.database
      .prepare(
        `UPDATE conversation_timeline SET payload_json = ?
         WHERE id = ? AND kind = 'tool'`
      )
      .run(JSON.stringify(validated), validated.id);
    if (update.changes !== 1) {
      throw new Error("Tool timeline item was not found.");
    }
    this.touchConversation(validated.conversationId, new Date().toISOString());
  }

  public completeTool(input: {
    providerCallId: string;
    result: string;
    tool: ConversationToolItem;
  }): void {
    const tool = conversationToolItemSchema.parse(input.tool);
    this.withTransaction(() => {
      this.updateTool(tool);
      this.insertModelMessage({
        attachmentIds: [],
        content: input.result,
        conversationId: tool.conversationId,
        role: "tool",
        runId: tool.runId,
        toolCallId: input.providerCallId,
        toolCalls: []
      });
      this.touchConversation(tool.conversationId, new Date().toISOString());
    });
  }

  public listModelMessages(conversationId: string): StoredModelMessage[] {
    return this.listContextMessages(conversationId).map((message) => ({
      attachmentIds: message.attachmentIds,
      content: message.content,
      ...(message.providerState === undefined ? {} : { providerState: message.providerState }),
      role: message.role,
      toolCallId: message.toolCallId,
      toolCalls: message.toolCalls
    }));
  }

  public listContextMessages(conversationId: string): StoredContextMessage[] {
    const rows = this.database
      .prepare(
        `SELECT sequence, run_id, role, content, tool_calls_json, tool_call_id,
                attachment_ids_json, provider_state_json
         FROM model_messages
         WHERE conversation_id = ?
         ORDER BY sequence ASC`
      )
      .all(conversationId) as DatabaseRow[];
    return rows.map((row) => {
      const role = asString(row, "role");
      if (role !== "user" && role !== "assistant" && role !== "tool") {
        throw new Error("Stored model message role is invalid.");
      }
      return {
        attachmentIds: parseJson<string[]>(
          asString(row, "attachment_ids_json"),
          "model message attachment identifiers"
        ),
        content: asString(row, "content"),
        ...(asNullableString(row, "provider_state_json") === null
          ? {}
          : {
              providerState: parseJson<ModelProviderState>(
                asString(row, "provider_state_json"),
                "model provider state"
              )
            }),
        role,
        runId: asNullableString(row, "run_id"),
        sequence: asNumber(row, "sequence"),
        toolCallId: asNullableString(row, "tool_call_id"),
        toolCalls: parseJson<ModelToolCall[]>(
          asString(row, "tool_calls_json"),
          "model tool calls"
        )
      };
    });
  }

  public getContextCheckpoint(conversationId: string): ConversationContextCheckpoint | null {
    const row = this.database
      .prepare(
        `SELECT conversation_id, covered_through_sequence, summary, created_at, updated_at
         FROM conversation_context_checkpoints
         WHERE conversation_id = ?`
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    return {
      conversationId: asString(row, "conversation_id"),
      coveredThroughSequence: asNumber(row, "covered_through_sequence"),
      createdAt: asString(row, "created_at"),
      summary: asString(row, "summary"),
      updatedAt: asString(row, "updated_at")
    };
  }

  public saveContextCheckpoint(
    conversationId: string,
    coveredThroughSequence: number,
    summary: string
  ): ConversationContextCheckpoint {
    this.getConversation(conversationId);
    const normalizedSummary = summary.trim();
    if (!Number.isSafeInteger(coveredThroughSequence) || coveredThroughSequence <= 0) {
      throw new Error("Context checkpoint sequence must be a positive integer.");
    }
    if (normalizedSummary.length === 0 || normalizedSummary.length > 200_000) {
      throw new Error("Context checkpoint summary has an invalid length.");
    }
    const coveredMessage = this.database
      .prepare(
        "SELECT sequence FROM model_messages WHERE conversation_id = ? AND sequence = ?"
      )
      .get(conversationId, coveredThroughSequence) as DatabaseRow | undefined;
    if (coveredMessage === undefined) {
      throw new Error("Context checkpoint must end at a stored conversation message.");
    }
    const existing = this.getContextCheckpoint(conversationId);
    if (
      existing !== null &&
      coveredThroughSequence < existing.coveredThroughSequence
    ) {
      throw new Error("Context checkpoint coverage cannot move backwards.");
    }

    const now = new Date().toISOString();
    this.database
      .prepare(
        `INSERT INTO conversation_context_checkpoints
           (conversation_id, covered_through_sequence, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(conversation_id) DO UPDATE SET
           covered_through_sequence = excluded.covered_through_sequence,
           summary = excluded.summary,
           updated_at = excluded.updated_at`
      )
      .run(conversationId, coveredThroughSequence, normalizedSummary, now, now);
    return this.getContextCheckpoint(conversationId) ?? (() => {
      throw new Error("Context checkpoint could not be persisted.");
    })();
  }

  private migrate(): void {
    new DatabaseMigrationRunner(this.database).run([
      {
        name: "agent-database-initial",
        up: () => this.migrateSchemaV1(),
        version: 1,
      },
    ]);
  }

  private migrateSchemaV1(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
        workspace_root_path TEXT,
        thread_kind TEXT NOT NULL DEFAULT 'agent',
        agent_id TEXT,
        agent_name TEXT,
        agent_role TEXT,
        agent_is_default INTEGER NOT NULL DEFAULT 0,
        agent_instructions TEXT,
        team_id TEXT,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        has_unread_result INTEGER NOT NULL DEFAULT 0,
        is_archived INTEGER NOT NULL DEFAULT 0,
        archived_at TEXT,
         is_pinned INTEGER NOT NULL DEFAULT 0,
         pin_order INTEGER,
         sort_order INTEGER NOT NULL DEFAULT 0,
         deletion_pending INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS conversations_project_updated
        ON conversations(project_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        model_id TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS runs_conversation_status
        ON runs(conversation_id, status);

      CREATE TABLE IF NOT EXISTS conversation_timeline (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        run_id TEXT,
        kind TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS model_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        run_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        tool_calls_json TEXT NOT NULL,
        tool_call_id TEXT,
        attachment_ids_json TEXT NOT NULL DEFAULT '[]',
        provider_state_json TEXT,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_pending_messages (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL UNIQUE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        delivery_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        sort_order INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        consumed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS conversation_pending_messages_pending_order
        ON conversation_pending_messages(conversation_id, status, sort_order, sequence);

      CREATE TABLE IF NOT EXISTS conversation_attachments (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        message_id TEXT,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        name TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        project_path TEXT,
        stored_path TEXT NOT NULL,
        extracted_text_path TEXT,
        pending_message_id TEXT,
        context_tokens INTEGER NOT NULL,
        truncated INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS conversation_attachments_conversation_message
        ON conversation_attachments(conversation_id, message_id, created_at);

      CREATE TABLE IF NOT EXISTS conversation_task_lists (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        payload_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_agent_messages (
        id TEXT PRIMARY KEY,
        sender_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        target_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        read_at TEXT
      );

      CREATE INDEX IF NOT EXISTS conversation_agent_messages_target_status
        ON conversation_agent_messages(target_conversation_id, status, created_at);

      CREATE TABLE IF NOT EXISTS subagent_tasks (
        id TEXT PRIMARY KEY,
        parent_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        child_conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        source_run_id TEXT NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
        target_run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        task TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        error TEXT,
        result_message_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      );

      CREATE INDEX IF NOT EXISTS subagent_tasks_parent_status
        ON subagent_tasks(parent_conversation_id, status, created_at);

      CREATE TABLE IF NOT EXISTS conversation_context_checkpoints (
        conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
        covered_through_sequence INTEGER NOT NULL,
        summary TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS conversation_deletion_tasks (
        id TEXT PRIMARY KEY,
        root_conversation_id TEXT NOT NULL UNIQUE,
        conversation_ids_json TEXT NOT NULL,
        file_paths_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending', 'running', 'failed')),
        retry_count INTEGER NOT NULL DEFAULT 0,
        last_error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS conversation_deletion_tasks_status
        ON conversation_deletion_tasks(status, updated_at);
    `);
    this.migrateProjectManagementState();
    this.migrateNullableConversationProject();
    this.migrateConversationParent();
    this.migrateConversationIdentity();
    this.migrateConversationUnreadResult();
    this.migrateConversationManagementState();
    this.migrateConversationArchivedAt();
    this.migrateConversationWorkspace();
    this.migrateModelMessageAttachments();
    this.migrateModelMessageProviderState();
    this.migratePendingMessageAttachments();
    this.migrateConversationDeletionPending();
  }

  private migrateConversationDeletionPending(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(conversations)")
      .all() as DatabaseRow[];
    if (!columns.some((column) => column.name === "deletion_pending")) {
      this.database.exec(
        "ALTER TABLE conversations ADD COLUMN deletion_pending INTEGER NOT NULL DEFAULT 0",
      );
    }
  }

  private migrateProjectManagementState(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(projects)")
      .all() as DatabaseRow[];
    if (!columns.some((column) => column.name === "is_pinned")) {
      this.database.exec(
        "ALTER TABLE projects ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"
      );
    }
    if (!columns.some((column) => column.name === "sort_order")) {
      this.database.exec("ALTER TABLE projects ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0");
      this.database.exec("UPDATE projects SET sort_order = rowid - 1");
    }
  }

  private migrateNullableConversationProject(): void {
    const row = this.database
      .prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'conversations'"
      )
      .get() as DatabaseRow | undefined;
    const definition = row === undefined ? null : asNullableString(row, "sql");

    if (definition === null || !definition.includes("project_id TEXT NOT NULL")) {
      return;
    }

    this.database.exec(`
      CREATE TABLE conversations_migrated (
        id TEXT PRIMARY KEY,
        project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      INSERT INTO conversations_migrated (id, project_id, title, created_at, updated_at)
        SELECT id, project_id, title, created_at, updated_at FROM conversations;
      DROP TABLE conversations;
      ALTER TABLE conversations_migrated RENAME TO conversations;
      CREATE INDEX conversations_project_updated
        ON conversations(project_id, updated_at DESC);
    `);
  }

  private migrateConversationParent(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(conversations)")
      .all() as DatabaseRow[];
    if (!columns.some((column) => column.name === "parent_conversation_id")) {
      this.database.exec(
        "ALTER TABLE conversations ADD COLUMN parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE"
      );
    }
    this.database.exec(
      "CREATE INDEX IF NOT EXISTS conversations_parent_created ON conversations(parent_conversation_id, created_at ASC)"
    );
  }

  private migrateConversationIdentity(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(conversations)")
      .all() as DatabaseRow[];
    const columnNames = new Set(columns.map((column) => column.name));
    if (!columnNames.has("thread_kind")) {
      this.database.exec(
        "ALTER TABLE conversations ADD COLUMN thread_kind TEXT NOT NULL DEFAULT 'agent'"
      );
    }
    for (const column of [
      "agent_id",
      "agent_name",
      "agent_role",
      "agent_instructions",
      "team_id"
    ]) {
      if (!columnNames.has(column)) {
        this.database.exec(`ALTER TABLE conversations ADD COLUMN ${column} TEXT`);
      }
    }
    if (!columnNames.has("agent_is_default")) {
      this.database.exec(
        "ALTER TABLE conversations ADD COLUMN agent_is_default INTEGER NOT NULL DEFAULT 0"
      );
    }
    this.database.exec(`
      UPDATE conversations
      SET thread_kind = CASE
        WHEN parent_conversation_id IS NOT NULL THEN 'subagent'
        ELSE 'agent'
      END
      WHERE thread_kind = 'standard'
    `);
    this.database.exec(`
      UPDATE conversations
      SET thread_kind = 'agent'
      WHERE parent_conversation_id IS NOT NULL
        AND thread_kind = 'subagent'
        AND NOT EXISTS (
          SELECT 1 FROM subagent_tasks
          WHERE subagent_tasks.child_conversation_id = conversations.id
        )
    `);
    this.database.exec(
      "CREATE INDEX IF NOT EXISTS conversations_team_kind ON conversations(team_id, thread_kind)"
    );
  }

  private migrateConversationUnreadResult(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(conversations)")
      .all() as DatabaseRow[];
    if (!columns.some((column) => column.name === "has_unread_result")) {
      this.database.exec(
        "ALTER TABLE conversations ADD COLUMN has_unread_result INTEGER NOT NULL DEFAULT 0"
      );
    }
  }

  private migrateConversationManagementState(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(conversations)")
      .all() as DatabaseRow[];
    if (!columns.some((column) => column.name === "is_archived")) {
      this.database.exec(
        "ALTER TABLE conversations ADD COLUMN is_archived INTEGER NOT NULL DEFAULT 0"
      );
    }
    if (!columns.some((column) => column.name === "is_pinned")) {
      this.database.exec(
        "ALTER TABLE conversations ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"
      );
    }
    if (!columns.some((column) => column.name === "pin_order")) {
      this.database.exec("ALTER TABLE conversations ADD COLUMN pin_order INTEGER");
      this.database.exec(`
        UPDATE conversations
        SET pin_order = (
          SELECT COUNT(*)
          FROM conversations AS earlier
          WHERE earlier.is_pinned = 1
            AND (
              earlier.updated_at > conversations.updated_at
              OR (
                earlier.updated_at = conversations.updated_at
                AND earlier.rowid >= conversations.rowid
              )
            )
        )
        WHERE is_pinned = 1
      `);
    }
    if (!columns.some((column) => column.name === "sort_order")) {
      this.database.exec(
        "ALTER TABLE conversations ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"
      );
      this.database.exec(`
        WITH ranked AS (
          SELECT id,
                 ROW_NUMBER() OVER (
                   PARTITION BY project_id, is_pinned, is_archived, parent_conversation_id
                   ORDER BY
                     CASE WHEN is_pinned = 1 THEN pin_order END ASC,
                     CASE WHEN is_pinned = 0 THEN updated_at END DESC,
                     rowid DESC
                 ) - 1 AS position
          FROM conversations
        )
        UPDATE conversations
        SET sort_order = (
          SELECT position FROM ranked WHERE ranked.id = conversations.id
        )
      `);
    }
  }

  private migrateConversationWorkspace(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(conversations)")
      .all() as DatabaseRow[];
    if (!columns.some((column) => column.name === "workspace_root_path")) {
      this.database.exec("ALTER TABLE conversations ADD COLUMN workspace_root_path TEXT");
    }
  }

  private migrateConversationArchivedAt(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(conversations)")
      .all() as DatabaseRow[];
    if (!columns.some((column) => column.name === "archived_at")) {
      this.database.exec("ALTER TABLE conversations ADD COLUMN archived_at TEXT");
    }

    this.database
      .prepare(
        "UPDATE conversations SET archived_at = ? WHERE is_archived = 1 AND archived_at IS NULL"
      )
      .run(new Date().toISOString());
  }

  private migrateModelMessageAttachments(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(model_messages)")
      .all() as DatabaseRow[];
    if (!columns.some((column) => column.name === "attachment_ids_json")) {
      this.database.exec(
        "ALTER TABLE model_messages ADD COLUMN attachment_ids_json TEXT NOT NULL DEFAULT '[]'"
      );
    }
  }

  private migrateModelMessageProviderState(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(model_messages)")
      .all() as DatabaseRow[];
    if (!columns.some((column) => column.name === "provider_state_json")) {
      this.database.exec("ALTER TABLE model_messages ADD COLUMN provider_state_json TEXT");
    }
  }

  private migratePendingMessageAttachments(): void {
    const columns = this.database
      .prepare("PRAGMA table_info(conversation_attachments)")
      .all() as DatabaseRow[];
    if (!columns.some((column) => column.name === "pending_message_id")) {
      this.database.exec(
        "ALTER TABLE conversation_attachments ADD COLUMN pending_message_id TEXT"
      );
    }
    this.database.exec(
      "CREATE INDEX IF NOT EXISTS conversation_attachments_pending_message ON conversation_attachments(pending_message_id)"
    );
  }

  private interruptUnfinishedRuns(): void {
    this.withTransaction(() => {
      const taskRows = this.database
        .prepare(
          `SELECT id FROM subagent_tasks
           WHERE status IN ('queued', 'running')`
        )
        .all() as DatabaseRow[];
      const now = new Date().toISOString();
      this.database.exec(
        `UPDATE conversations
         SET has_unread_result = 1
         WHERE id IN (SELECT conversation_id FROM runs WHERE status IN ('queued', 'running'))`
      );
      this.database
        .prepare(
          `UPDATE runs
           SET status = 'failed', error = 'Application stopped before the run finished.', updated_at = ?
           WHERE status IN ('queued', 'running')`
        )
        .run(now);
      this.database
        .prepare(
          `UPDATE subagent_tasks
           SET status = 'failed', error = 'Application stopped before the Subagent finished.',
               updated_at = ?, completed_at = ?
           WHERE status IN ('queued', 'running')`
        )
        .run(now, now);
      for (const row of taskRows) {
        this.deliverSubagentTaskResultInTransaction(asString(row, "id"));
      }
    });
  }

  private assertProjectExists(projectId: string): void {
    const project = this.database
      .prepare("SELECT 1 AS present FROM projects WHERE id = ?")
      .get(projectId);
    if (project === undefined) {
      throw new Error("Project was not found.");
    }
  }

  private assertNoActiveRun(conversationId: string): void {
    const placeholders = RUNNING_STATUSES.map(() => "?").join(", ");
    const row = this.database
      .prepare(
        `SELECT id FROM runs
         WHERE conversation_id = ? AND status IN (${placeholders}) LIMIT 1`
      )
      .get(conversationId, ...RUNNING_STATUSES);
    if (row !== undefined) {
      throw new Error("This conversation already has an active run.");
    }
  }

  private getLatestUserTimelineRecord(conversationId: string): UserTimelineRecord | null {
    const rows = this.database.prepare(
      `SELECT sequence, payload_json FROM conversation_timeline
       WHERE conversation_id = ? AND kind = 'message'
       ORDER BY sequence DESC`,
    ).all(conversationId) as DatabaseRow[];
    for (const row of rows) {
      const message = conversationMessageItemSchema.parse(
        parseJson(asString(row, "payload_json"), "conversation message"),
      );
      if (message.role === "user") {
        return { message, sequence: asNumber(row, "sequence") };
      }
    }
    return null;
  }

  private getLatestUserModelMessageRecord(
    conversationId: string,
    runId: string,
  ): UserModelMessageRecord | null {
    const row = this.database.prepare(
      `SELECT id, sequence, content, attachment_ids_json FROM model_messages
       WHERE conversation_id = ? AND run_id = ? AND role = 'user'
       ORDER BY sequence DESC LIMIT 1`,
    ).get(conversationId, runId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    return {
      attachmentIds: parseStoredStringArray(
        asString(row, "attachment_ids_json"),
        "model message attachment identifiers",
      ),
      content: asString(row, "content"),
      id: asString(row, "id"),
      sequence: asNumber(row, "sequence"),
    };
  }

  private countUserMessages(conversationId: string): number {
    const row = this.database
      .prepare(
        `SELECT COUNT(*) AS count FROM model_messages
         WHERE conversation_id = ? AND role = 'user'`
      )
      .get(conversationId) as DatabaseRow;
    return Number(row.count);
  }

  public getPendingMessageRecord(pendingMessageId: string): StoredPendingMessage {
    const row = this.database
      .prepare(
        `SELECT id, conversation_id, delivery_mode, payload_json, created_at
         FROM conversation_pending_messages
         WHERE id = ? AND status = 'pending'`
      )
      .get(pendingMessageId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Pending conversation message was not found.");
    return toStoredPendingMessage(row);
  }

  private consumePendingRecord(pendingMessageId: string): void {
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        `UPDATE conversation_pending_messages
         SET status = 'consumed', consumed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`
      )
      .run(now, now, pendingMessageId);
    if (result.changes !== 1) throw new Error("Pending conversation message was already consumed.");
  }

  private bindPendingAttachmentsToMessage(
    pendingMessageId: string,
    messageId: string,
    expectedCount: number
  ): void {
    if (expectedCount === 0) return;
    const result = this.database
      .prepare(
        `UPDATE conversation_attachments
         SET message_id = ?, pending_message_id = NULL
         WHERE pending_message_id = ? AND message_id IS NULL`
      )
      .run(messageId, pendingMessageId);
    if (result.changes !== expectedCount) {
      throw new Error("One or more queued attachments could not be sent.");
    }
  }

  private createTitleFromMessage(content: string): string {
    const normalized = content.replace(/\s+/g, " ").trim();
    return normalized.length <= 32 ? normalized : `${normalized.slice(0, 32)}...`;
  }

  private insertTimelineItem(item: ConversationTimelineItem): void {
    const validated = conversationTimelineItemSchema.parse(item);
    this.database
      .prepare(
        `INSERT INTO conversation_timeline
           (id, conversation_id, run_id, kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        validated.id,
        validated.conversationId,
        validated.runId,
        validated.kind,
        JSON.stringify(validated),
        validated.createdAt
      );
  }

  private insertModelMessage(input: {
    attachmentIds: readonly string[];
    content: string;
    conversationId: string;
    providerState?: ModelProviderState;
    role: StoredModelMessage["role"];
    runId: string | null;
    toolCallId: string | null;
    toolCalls: ModelToolCall[];
  }): void {
    this.database
      .prepare(
        `INSERT INTO model_messages
           (id, conversation_id, run_id, role, content, tool_calls_json,
            tool_call_id, attachment_ids_json, provider_state_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        randomUUID(),
        input.conversationId,
        input.runId,
        input.role,
        input.content,
        JSON.stringify(input.toolCalls),
        input.toolCallId,
        JSON.stringify(input.attachmentIds),
        input.providerState === undefined ? null : JSON.stringify(input.providerState),
        new Date().toISOString()
      );
  }

  private listStoredAttachments(
    whereClause: string,
    parameters: readonly (number | string | null)[]
  ): StoredConversationAttachment[] {
    const rows = this.database
      .prepare(
        `SELECT id, conversation_id, message_id, pending_message_id, source, kind, name, mime_type,
                size_bytes, project_path, stored_path, extracted_text_path,
                context_tokens, truncated, created_at
         FROM conversation_attachments
         WHERE ${whereClause}`
      )
      .all(...parameters) as DatabaseRow[];
    return rows.map(toConversationAttachment);
  }

  private touchConversation(conversationId: string, timestamp: string): void {
    this.database
      .prepare("UPDATE conversations SET updated_at = ? WHERE id = ?")
      .run(timestamp, conversationId);
  }

  private updateRun(
    runId: string,
    status: ConversationRunStatus,
    error: string | null,
  ): void {
    this.withTransaction(() => this.updateRunInTransaction(runId, status, error));
  }

  private updateRunInTransaction(
    runId: string,
    status: ConversationRunStatus,
    error: string | null,
  ): string {
    const row = this.database
      .prepare("SELECT conversation_id, status FROM runs WHERE id = ?")
      .get(runId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Run was not found.");
    const currentStatus = conversationRunStatusSchema.parse(asString(row, "status"));
    const conversationId = asString(row, "conversation_id");
    if (!RUN_STATUS_TRANSITIONS[currentStatus].includes(status)) {
      throw new Error(
        `Run state transition is not allowed: ${currentStatus} -> ${status}.`,
      );
    }
    const now = new Date().toISOString();
    const result = this.database
      .prepare(
        "UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status = ?",
      )
      .run(status, error, now, runId, currentStatus);
    if (result.changes !== 1) {
      throw new Error("Run state changed before the transition could be committed.");
    }
    this.database
      .prepare(
        "UPDATE conversations SET has_unread_result = ? WHERE id = (SELECT conversation_id FROM runs WHERE id = ?)"
      )
      .run(status === "completed" || status === "failed" ? 1 : 0, runId);
    return conversationId;
  }

  private withTransaction<T>(operation: () => T): T {
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const result = operation();
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK;");
      throw error;
    }
  }
}
