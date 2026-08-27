import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { DatabaseMigrationRunner } from "./database-migration-runner.js";
import { z } from "zod";
import {
  agentDirectoryConfigurationSchema,
  contextCompressionThresholdSchema,
  conversationAgentBindingSchema,
  conversationModelSelectionSchema,
  conversationAgentMessageItemSchema,
  conversationMessageItemSchema,
  conversationPendingMessageSchema,
  conversationPermissionModeSchema,
  conversationRunStatusSchema,
  modelApiFormatSchema,
  modelReasoningOptionSchema,
  providerIdSchema,
  sendConversationMessageInputSchema,
  conversationSummarySchema,
  conversationTaskListSchema,
  conversationTimelineItemSchema,
  conversationToolItemSchema,
  projectSummarySchema,
  conversationAttachmentSchema,
  type AgentDirectoryConfiguration,
  type ConversationAttachment,
  type ConversationAgentMessageItem,
  type ConversationMessageItem,
  type ConversationModelSelection,
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

export type PreparedPendingMessage = StoredPendingMessage;

export type PreparedPendingMessageConsumption = {
  modelContent: string;
  pendingMessageId: string;
  userMessage: ConversationMessageItem;
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

export type ThreadLogProjectionEvent = {
  createdAt: string;
  eventId: string;
  payload: Record<string, unknown>;
  sequence: number;
  type: string;
};

export type ThreadLogProjectionCursor = {
  conversationId: string;
  lastEventId: string;
  lastSequence: number;
  updatedAt: string;
};

/** Resolves a managed AttachmentStore location without serializing paths into JSONL. */
export type ThreadLogAttachmentPathResolver = (
  attachment: ConversationAttachment,
) => {
  extractedTextPath: string | null;
  storedPath: string;
};

/** Cross-conversation Team metadata is a SQLite relationship, not a ThreadLog. */
export type TeamDirectoryRecord = {
  coordinatorConversationId: string | null;
  description: string;
  enabled: boolean;
  id: string;
  instructions: string;
  leadAgentId: string;
  maxWorkers: number;
  name: string;
  projectScope: "all" | "selected";
  updatedAt: string;
};

export type TeamMemberRecord = {
  agentId: string;
  instructions: string;
  role: string;
  teamId: string;
};

export type PluginCatalogRecord = {
  contentHash: string;
  enabled: boolean;
  id: string;
  manifestJson: string;
  name: string;
  rootPath: string;
  updatedAt: string;
  version: string;
};

export type PreparedConversationCreation = {
  agent: ConversationAgentBinding | null;
  conversation: ConversationSummary;
};

export type ThreadLogLegacySnapshot = {
  agent: ConversationAgentBinding | null;
  checkpoint: ConversationContextCheckpoint | null;
  conversation: ConversationSummary;
  modelMessages: StoredContextMessage[];
  timeline: ConversationTimelineItem[];
  runs: ThreadLogLegacyRun[];
};

export type ThreadLogLegacyRun = {
  createdAt: string;
  error: string | null;
  executionSnapshotJson: string | null;
  id: string;
  modelId: string;
  status: ConversationRunStatus;
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

/**
 * A fully validated, but not yet materialized, initial user turn. The
 * ThreadLog write-ahead path owns the durable boundary; SQLite receives this
 * object only as its query/UI projection.
 */
export type PreparedRunWithUserMessage = {
  attachmentIds: string[];
  conversationId: string;
  executionSnapshot: RunExecutionSnapshot | undefined;
  modelContent: string;
  modelId: string;
  nextTitle: string;
  pendingMessageId: string | null;
  runCreatedAt: string;
  runId: string;
  userMessage: ConversationMessageItem;
};

export type PreparedLatestUserMessageReplacement = {
  conversationId: string;
  executionSnapshot: RunExecutionSnapshot | undefined;
  modelContent: string;
  modelId: string;
  nextTitle: string;
  previousRunId: string;
  runCreatedAt: string;
  runId: string;
  userMessage: ConversationMessageItem;
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

const pluginRunSnapshotSchema = z.object({
  contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
  id: z.string().trim().min(1).max(128),
  version: z.string().trim().min(1).max(80),
}).strict();

const threadLogSubagentTaskSchema = z.object({
  childConversationId: z.string().uuid(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  error: z.string().nullable(),
  id: z.string().uuid(),
  parentConversationId: z.string().uuid(),
  result: z.string().nullable(),
  resultMessageId: z.string().uuid().nullable(),
  sourceRunId: z.string().uuid(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  targetRunId: z.string().uuid().nullable(),
  task: z.string(),
  title: z.string(),
  updatedAt: z.string().datetime(),
}).strict();

const threadLogPendingMessagesSchema = z.object({
  pendingMessages: z.array(z.object({
    input: sendConversationMessageInputSchema,
    message: conversationPendingMessageSchema,
  }).strict()),
}).strict();

export type CompletedRun = {
  assistantMessage: ConversationMessageItem | null;
  subagentResultMessage: ConversationAgentMessageItem | null;
  subagentTask: SubagentTask | null;
};

const runExecutionSnapshotSchema = z.object({
  apiFormat: modelApiFormatSchema,
  baseUrl: z.string().url(),
  contextCompressionConfiguration: contextCompressionThresholdSchema,
  contextWindow: z.number().int().nonnegative().nullable(),
  modelId: z.string().trim().min(1).max(200),
  permissionMode: conversationPermissionModeSchema,
  plugins: z.array(pluginRunSnapshotSchema).max(200).default([]),
  providerId: providerIdSchema.nullable(),
  reasoning: modelReasoningOptionSchema.nullable(),
  reasoningOptions: z.array(modelReasoningOptionSchema).max(16),
  toolManifest: z.array(z.object({
    contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
    name: z.string().trim().min(1).max(200),
  }).strict()).max(200).default([]),
}).strict();

export type RunExecutionSnapshot = z.infer<typeof runExecutionSnapshotSchema>;

export type QueuedRunRecovery = {
  attachmentIds: string[];
  content: string;
  conversationId: string;
  executionSnapshot: RunExecutionSnapshot | null;
  modelId: string;
  runId: string;
};

export type LatestUserMessageReplacementSource = {
  message: ConversationMessageItem;
  modelContent: string;
};

type ReplaceLatestUserMessageInput = {
  content: string;
  conversationId: string;
  executionSnapshot?: RunExecutionSnapshot;
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
type TaskListTaskInput = Pick<ConversationTask, "status" | "title"> & {
  reason?: ConversationTask["reason"] | undefined;
};

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

function contextSearchTerms(query: string): string[] {
  const runs = query.match(/[\p{Script=Han}]+|[\p{L}\p{N}_./\\:@#-]+/gu) ?? [];
  const terms: string[] = [];
  const append = (term: string): void => {
    const normalized = term.trim();
    if (normalized.length < 2 || terms.includes(normalized)) return;
    terms.push(normalized);
  };
  for (const run of runs) {
    if (/^[\p{Script=Han}]+$/u.test(run)) {
      append(run);
      for (let index = 0; index + 3 <= run.length; index += 1) {
        append(run.slice(index, index + 3));
      }
      if (run.length <= 8) {
        for (let index = 0; index + 2 <= run.length; index += 1) {
          append(run.slice(index, index + 2));
        }
      }
      continue;
    }
    append(run);
  }
  return terms.slice(0, 24);
}

function ftsQueryForTerms(terms: readonly string[]): string {
  return terms
    .filter((term) => term.length >= 3)
    .map((term) => `"${term.replaceAll('"', '""')}"`)
    .join(" OR ");
}

function likePattern(term: string): string {
  return `%${term.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
}

function serializeRunExecutionSnapshot(
  snapshot: RunExecutionSnapshot | undefined,
): string | null {
  if (snapshot === undefined) return null;
  return JSON.stringify(runExecutionSnapshotSchema.parse(snapshot));
}

function parseRunExecutionSnapshot(
  value: string | null,
): RunExecutionSnapshot | null {
  if (value === null) return null;
  return runExecutionSnapshotSchema.parse(
    parseJson<unknown>(value, "Run execution snapshot"),
  );
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

function readProjectionString(payload: Record<string, unknown>, key: string): string | null {
  const value = payload[key];
  return typeof value === "string" ? value : null;
}

function readProjectionIsoDate(payload: Record<string, unknown>, key: string): string | null {
  const value = readProjectionString(payload, key);
  return value !== null && !Number.isNaN(Date.parse(value)) ? value : null;
}

function readProjectionTimelineMessage(
  payload: Record<string, unknown>,
  key: string,
): ConversationMessageItem | null {
  const parsed = conversationMessageItemSchema.safeParse(payload[key]);
  return parsed.success ? parsed.data : null;
}

function readProjectionTool(
  payload: Record<string, unknown>,
  key: string,
): ConversationToolItem | null {
  const parsed = conversationToolItemSchema.safeParse(payload[key]);
  return parsed.success ? parsed.data : null;
}

function readProjectionAgentMessage(
  payload: Record<string, unknown>,
  key: string,
): ConversationAgentMessageItem | null {
  const parsed = conversationAgentMessageItemSchema.safeParse(payload[key]);
  return parsed.success ? parsed.data : null;
}

function readProjectionToolCalls(payload: Record<string, unknown>): ModelToolCall[] {
  const value = payload.toolCalls;
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    if (!isProjectionRecord(candidate)) return [];
    return typeof candidate.arguments === "string"
      && typeof candidate.id === "string"
      && typeof candidate.name === "string"
      ? [{ arguments: candidate.arguments, id: candidate.id, name: candidate.name }]
      : [];
  });
}

function readProjectionProviderState(
  payload: Record<string, unknown>,
): ModelProviderState | undefined {
  const value = payload.providerState;
  if (
    !isProjectionRecord(value)
    || typeof value.baseUrl !== "string"
    || typeof value.modelId !== "string"
    || !("payload" in value)
  ) {
    return undefined;
  }
  const apiFormat = modelApiFormatSchema.safeParse(value.apiFormat);
  return apiFormat.success
    ? {
        apiFormat: apiFormat.data,
        baseUrl: value.baseUrl,
        modelId: value.modelId,
        payload: value.payload,
      }
    : undefined;
}

function threadLogUserMessage(
  payload: Record<string, unknown>,
  conversationId: string,
  createdAt: string,
): ConversationMessageItem | null {
  const parsedMessage = conversationMessageItemSchema.safeParse(payload.message);
  if (parsedMessage.success) {
    return parsedMessage.data.role === "user" && parsedMessage.data.conversationId === conversationId
      ? parsedMessage.data
      : null;
  }
  const messageId = readProjectionString(payload, "messageId");
  const content = readProjectionString(payload, "content");
  const runId = readProjectionString(payload, "runId");
  if (messageId === null || content === null || runId === null) return null;
  const attachmentIds = Array.isArray(payload.attachmentIds)
    ? payload.attachmentIds.filter((attachmentId): attachmentId is string => typeof attachmentId === "string")
    : [];
  return conversationMessageItemSchema.safeParse({
    attachments: attachmentIds.map((id) => ({
      contextTokens: 0,
      conversationId,
      createdAt,
      id,
      kind: "file",
      messageId,
      mimeType: "application/octet-stream",
      name: id,
      projectPath: null,
      sizeBytes: 0,
      source: "upload",
      truncated: false,
    })),
    content,
    conversationId,
    createdAt,
    id: messageId,
    kind: "message",
    modelId: null,
    role: "user",
    runId,
    status: "completed",
  }).data ?? null;
}

function threadLogTerminalAssistant(payload: Record<string, unknown>): {
  content: string;
  kind: "turn" | "failure" | "cancelled";
  messageId: string;
  modelId: string;
  providerState?: ModelProviderState;
} | null {
  const kind = payload.assistantKind;
  if (kind === null || kind === undefined) return null;
  if (kind !== "turn" && kind !== "failure" && kind !== "cancelled") {
    throw new Error("ThreadLog terminal assistant kind is invalid.");
  }
  const content = readProjectionString(payload, "content");
  const messageId = readProjectionString(payload, "messageId");
  const modelId = readProjectionString(payload, "modelId");
  if (content === null || messageId === null || modelId === null) {
    throw new Error("ThreadLog terminal assistant payload is invalid.");
  }
  const providerState = readProjectionProviderState(payload);
  return {
    content,
    kind,
    messageId,
    modelId,
    ...(providerState === undefined ? {} : { providerState }),
  };
}

function isProjectionRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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
  const selectedProviderId = asNullableString(row, "selected_provider_id");
  const selectedModelId = asNullableString(row, "selected_model_id");
  const selectedReasoningJson = asNullableString(row, "selected_reasoning_json");
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
    modelSelection: selectedProviderId === null || selectedModelId === null
      ? null
      : conversationModelSelectionSchema.parse({
          modelId: selectedModelId,
          providerId: selectedProviderId,
          reasoning: selectedReasoningJson === null
            ? null
            : parseJson(selectedReasoningJson, "conversation model reasoning"),
        }),
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

  /**
   * Bootstrap calls this after rebuilding a missing SQLite projection from
   * ThreadLog. Runs that had reached the model/tool execution boundary must
   * never be replayed automatically after a process stop.
   */
  public interruptRecoveredThreadLogRuns(): void {
    this.interruptUnfinishedRuns();
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
            selected_provider_id, selected_model_id, selected_reasoning_json,
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

  public listAllConversationIds(): string[] {
    const rows = this.database
      .prepare("SELECT id FROM conversations ORDER BY created_at ASC, rowid ASC")
      .all() as DatabaseRow[];
    return rows.map((row) => asString(row, "id"));
  }

  public getConversation(conversationId: string): ConversationSummary {
    const row = this.database
      .prepare(
        `SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            selected_provider_id, selected_model_id, selected_reasoning_json,
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

  /**
   * Mirrors declarative Team configuration into relational tables. Team member
   * links remain queryable without duplicating any member conversation history.
   */
  public syncTeamDirectory(rawDirectory: AgentDirectoryConfiguration): void {
    const directory = agentDirectoryConfigurationSchema.parse(rawDirectory);
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const retainedIds = new Set(directory.teams.map((team) => team.id));
      for (const team of directory.teams) {
        this.database
          .prepare(
            `INSERT INTO teams (
              id, name, description, enabled, lead_agent_id, instructions,
              max_workers, project_scope, coordinator_conversation_id, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              name = excluded.name,
              description = excluded.description,
              enabled = excluded.enabled,
              lead_agent_id = excluded.lead_agent_id,
              instructions = excluded.instructions,
              max_workers = excluded.max_workers,
              project_scope = excluded.project_scope,
              updated_at = excluded.updated_at`,
          )
          .run(
            team.id,
            team.name,
            team.description,
            Number(team.enabled),
            team.leadAgentId,
            team.instructions,
            team.maxWorkers,
            team.projectScope,
            now,
            now,
          );
        this.database.prepare("DELETE FROM team_members WHERE team_id = ?").run(team.id);
        for (const [index, agentId] of team.memberIds.entries()) {
          const member = team.memberConfigurations[agentId];
          this.database
            .prepare(
              `INSERT INTO team_members (team_id, agent_id, member_index, role, instructions)
               VALUES (?, ?, ?, ?, ?)`,
            )
            .run(team.id, agentId, index, member?.role ?? "", member?.instructions ?? "");
        }
      }
      if (retainedIds.size === 0) {
        this.database.exec("DELETE FROM teams");
      } else {
        this.database
          .prepare(`DELETE FROM teams WHERE id NOT IN (${[...retainedIds].map(() => "?").join(", ")})`)
          .run(...retainedIds);
      }
    });
  }

  public listTeams(): TeamDirectoryRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, name, description, enabled, lead_agent_id, instructions,
                max_workers, project_scope, coordinator_conversation_id, updated_at
         FROM teams ORDER BY name COLLATE NOCASE ASC, id ASC`,
      )
      .all() as DatabaseRow[];
    return rows.map((row) => ({
      coordinatorConversationId: asNullableString(row, "coordinator_conversation_id"),
      description: asString(row, "description"),
      enabled: asBoolean(row, "enabled"),
      id: asString(row, "id"),
      instructions: asString(row, "instructions"),
      leadAgentId: asString(row, "lead_agent_id"),
      maxWorkers: asNumber(row, "max_workers"),
      name: asString(row, "name"),
      projectScope: asString(row, "project_scope") === "selected" ? "selected" : "all",
      updatedAt: asString(row, "updated_at"),
    }));
  }

  public listTeamMembers(teamId: string): TeamMemberRecord[] {
    const team = this.database.prepare("SELECT id FROM teams WHERE id = ?").get(teamId);
    if (team === undefined) throw new Error("Team was not found.");
    const rows = this.database
      .prepare(
        `SELECT team_id, agent_id, role, instructions
         FROM team_members WHERE team_id = ? ORDER BY member_index ASC`,
      )
      .all(teamId) as DatabaseRow[];
    return rows.map((row) => ({
      agentId: asString(row, "agent_id"),
      instructions: asString(row, "instructions"),
      role: asString(row, "role"),
      teamId: asString(row, "team_id"),
    }));
  }

  public getTeamCoordinatorConversationId(teamId: string): string | null {
    const row = this.database
      .prepare("SELECT coordinator_conversation_id FROM teams WHERE id = ?")
      .get(teamId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Team was not found.");
    return asNullableString(row, "coordinator_conversation_id");
  }

  public setTeamCoordinatorConversation(teamId: string, conversationId: string): void {
    const team = this.database.prepare("SELECT id FROM teams WHERE id = ?").get(teamId);
    if (team === undefined) throw new Error("Team was not found.");
    const conversation = this.getConversation(conversationId);
    if (conversation.teamId !== teamId || conversation.threadKind !== "team_lead") {
      throw new Error("Team coordinator must be a Team Lead conversation bound to the same Team.");
    }
    this.database
      .prepare("UPDATE teams SET coordinator_conversation_id = ?, updated_at = ? WHERE id = ?")
      .run(conversationId, new Date().toISOString(), teamId);
  }

  /** Plugin files are discovered on disk; this table is their queryable catalog. */
  public syncPluginCatalog(records: readonly Omit<PluginCatalogRecord, "enabled" | "updatedAt">[]): void {
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const retainedIds = new Set(records.map((record) => record.id));
      for (const record of records) {
        this.database
          .prepare(
            `INSERT INTO plugin_catalog (
              id, root_path, name, version, content_hash, manifest_json, enabled, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
              root_path = excluded.root_path,
              name = excluded.name,
              version = excluded.version,
              content_hash = excluded.content_hash,
              manifest_json = excluded.manifest_json,
              updated_at = excluded.updated_at`,
          )
          .run(
            record.id,
            record.rootPath,
            record.name,
            record.version,
            record.contentHash,
            record.manifestJson,
            now,
            now,
          );
      }
      if (retainedIds.size === 0) {
        this.database.exec("DELETE FROM plugin_catalog");
      } else {
        this.database
          .prepare(`DELETE FROM plugin_catalog WHERE id NOT IN (${[...retainedIds].map(() => "?").join(", ")})`)
          .run(...retainedIds);
      }
    });
  }

  public listPluginCatalog(): PluginCatalogRecord[] {
    const rows = this.database
      .prepare(
        `SELECT id, root_path, name, version, content_hash, manifest_json, enabled, updated_at
         FROM plugin_catalog ORDER BY name COLLATE NOCASE ASC, id ASC`,
      )
      .all() as DatabaseRow[];
    return rows.map((row) => ({
      contentHash: asString(row, "content_hash"),
      enabled: asBoolean(row, "enabled"),
      id: asString(row, "id"),
      manifestJson: asString(row, "manifest_json"),
      name: asString(row, "name"),
      rootPath: asString(row, "root_path"),
      updatedAt: asString(row, "updated_at"),
      version: asString(row, "version"),
    }));
  }

  public setPluginEnabled(pluginId: string, enabled: boolean): PluginCatalogRecord {
    const changed = this.database
      .prepare("UPDATE plugin_catalog SET enabled = ?, updated_at = ? WHERE id = ?")
      .run(Number(enabled), new Date().toISOString(), pluginId);
    if (changed.changes === 0) throw new Error("Plugin was not found.");
    const plugin = this.listPluginCatalog().find((candidate) => candidate.id === pluginId);
    if (plugin === undefined) throw new Error("Plugin was not found.");
    return plugin;
  }

  public createConversation(
    projectId: string | null,
    options: Omit<CreateConversationInput, "projectId"> = {}
  ): ConversationSummary {
    return this.persistPreparedConversation(this.prepareConversationCreation(projectId, options));
  }

  public prepareConversationCreation(
    projectId: string | null,
    options: Omit<CreateConversationInput, "projectId"> = {},
  ): PreparedConversationCreation {
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
      modelSelection: options.modelSelection ?? null,
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
    return { agent, conversation };
  }

  public projectConversationCreated(
    creation: PreparedConversationCreation,
  ): ConversationSummary {
    if (this.hasConversation(creation.conversation.id)) {
      return this.getConversation(creation.conversation.id);
    }
    this.assertProjectExistsWhenPresent(creation.conversation.projectId);
    return this.persistPreparedConversation(creation);
  }

  public hasConversation(conversationId: string): boolean {
    return this.database
      .prepare("SELECT 1 AS present FROM conversations WHERE id = ? LIMIT 1")
      .get(conversationId) !== undefined;
  }

  private persistPreparedConversation(
    creation: PreparedConversationCreation,
  ): ConversationSummary {
    const { agent, conversation } = creation;
    this.database
        .prepare(
          `INSERT INTO conversations
            (id, project_id, parent_conversation_id, workspace_root_path,
             selected_provider_id, selected_model_id, selected_reasoning_json,
             thread_kind, agent_id, agent_name, agent_role, agent_is_default,
             agent_instructions, team_id, title, created_at, updated_at, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
        )
        .run(
          conversation.id,
          conversation.projectId,
          conversation.parentConversationId,
          conversation.workspaceRootPath,
          conversation.modelSelection?.providerId ?? null,
          conversation.modelSelection?.modelId ?? null,
          conversation.modelSelection === null || conversation.modelSelection.reasoning === null
            ? null
            : JSON.stringify(conversation.modelSelection.reasoning),
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

  private assertProjectExistsWhenPresent(projectId: string | null): void {
    if (projectId !== null) this.assertProjectExists(projectId);
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

  public setConversationModelSelection(
    conversationId: string,
    rawSelection: ConversationModelSelection,
  ): ConversationSummary {
    const selection = conversationModelSelectionSchema.parse(rawSelection);
    this.getConversation(conversationId);
    this.database
      .prepare(
        `UPDATE conversations
         SET selected_provider_id = ?, selected_model_id = ?, selected_reasoning_json = ?,
             updated_at = ?
         WHERE id = ? AND deletion_pending = 0`
      )
      .run(
        selection.providerId,
        selection.modelId,
        selection.reasoning === null ? null : JSON.stringify(selection.reasoning),
        new Date().toISOString(),
        conversationId,
      );
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
      modelSelection: source.modelSelection,
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
              selected_provider_id, selected_model_id, selected_reasoning_json,
              thread_kind, agent_id, agent_name, agent_role, agent_is_default,
              agent_instructions, team_id, title, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          conversation.id,
          conversation.projectId,
          parentConversationId,
          conversation.workspaceRootPath,
          conversation.modelSelection?.providerId ?? null,
          conversation.modelSelection?.modelId ?? null,
          conversation.modelSelection === null || conversation.modelSelection.reasoning === null
            ? null
            : JSON.stringify(conversation.modelSelection.reasoning),
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
            selected_provider_id, selected_model_id, selected_reasoning_json,
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

  public listRunIdsForConversations(conversationIds: readonly string[]): string[] {
    if (conversationIds.length === 0) return [];
    const placeholders = conversationIds.map(() => "?").join(", ");
    const rows = this.database.prepare(
      `SELECT id FROM runs WHERE conversation_id IN (${placeholders}) ORDER BY created_at ASC, rowid ASC`,
    ).all(...conversationIds) as DatabaseRow[];
    return rows.map((row) => asString(row, "id"));
  }

  public listQueuedRunRecoveries(): QueuedRunRecovery[] {
    const rows = this.database.prepare(
      `SELECT runs.id, runs.conversation_id, runs.model_id,
              runs.execution_snapshot_json,
              model_messages.content, model_messages.attachment_ids_json
       FROM runs
       JOIN model_messages
         ON model_messages.run_id = runs.id
        AND model_messages.role = 'user'
       WHERE runs.status = 'queued'
       ORDER BY runs.created_at ASC, runs.rowid ASC, model_messages.sequence ASC`,
    ).all() as DatabaseRow[];
    const seen = new Set<string>();
    return rows.flatMap((row) => {
      const runId = asString(row, "id");
      if (seen.has(runId)) return [];
      seen.add(runId);
      return [{
        attachmentIds: parseStoredStringArray(
          asString(row, "attachment_ids_json"),
          "queued Run attachment identifiers",
        ),
        content: asString(row, "content"),
        conversationId: asString(row, "conversation_id"),
        executionSnapshot: parseRunExecutionSnapshot(
          asNullableString(row, "execution_snapshot_json"),
        ),
        modelId: asString(row, "model_id"),
        runId,
      }];
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
    const contextAttachmentIds = new Set(
      this.listContextMessages(conversationId).flatMap((message) => message.attachmentIds),
    );
    // Side forks inherit model context without copying the visible timeline. Their
    // copied attachments therefore have no message_id, but they are not drafts.
    return this.listStoredAttachments(
      `conversation_id = ? AND message_id IS NULL AND pending_message_id IS NULL
       ORDER BY created_at ASC, rowid ASC`,
      [conversationId]
    )
      .filter((attachment) => !contextAttachmentIds.has(attachment.id))
      .map(toPublicConversationAttachment);
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

  /** Returns renderer-safe immutable attachment references for ThreadLog events. */
  public listThreadLogAttachmentReferences(
    conversationId: string,
    attachmentIds: readonly string[],
  ): ConversationAttachment[] {
    return this.listConversationAttachmentsByIds(conversationId, attachmentIds)
      .map(toPublicConversationAttachment);
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

  /** A Subagent terminal Run also has a cross-Conversation delivery fact.
   * It stays on the existing atomic completion path until that two-log
   * transaction has its own write-ahead contract. */
  public hasSubagentTaskForTargetRun(runId: string): boolean {
    return this.database
      .prepare("SELECT 1 AS present FROM subagent_tasks WHERE target_run_id = ? LIMIT 1")
      .get(runId) !== undefined;
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
        `SELECT conversation_timeline.payload_json,
                runs.created_at AS run_created_at,
                runs.status AS run_status,
                runs.updated_at AS run_completed_at
         FROM conversation_timeline
         LEFT JOIN runs ON runs.id = conversation_timeline.run_id
         WHERE conversation_timeline.conversation_id = ?
         ORDER BY conversation_timeline.sequence ASC`
      )
      .all(conversationId) as DatabaseRow[];
    return rows.map((row) => {
      const item = conversationTimelineItemSchema.parse(
        parseJson(asString(row, "payload_json"), "timeline item")
      );
      if (item.kind !== "message" || item.role !== "assistant" || item.runId === null) {
        return item;
      }

      const runStatus = asNullableString(row, "run_status");
      const runCreatedAt = asNullableString(row, "run_created_at");
      const runCompletedAt = asNullableString(row, "run_completed_at");
      if (
        runStatus === null
        || runCreatedAt === null
        || runCompletedAt === null
        || (runStatus !== "completed" && runStatus !== "failed" && runStatus !== "cancelled")
      ) {
        return item;
      }

      const durationMs = Math.max(
        0,
        Date.parse(runCompletedAt) - Date.parse(runCreatedAt),
      );
      return conversationTimelineItemSchema.parse({
        ...item,
        completedAt: runCompletedAt,
        durationMs,
      });
    });
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
    tasks: ReadonlyArray<TaskListTaskInput>
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
    tasks: ReadonlyArray<TaskListTaskInput>
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
    tasks: ReadonlyArray<TaskListTaskInput>,
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
        reason: task.reason ?? null,
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

  public enqueuePendingMessage(rawInput: SendConversationMessageInput): ConversationPendingMessage {
    const prepared = this.preparePendingMessage(rawInput);
    this.projectPreparedPendingMessage(prepared);
    return prepared.message;
  }

  /** Validate and assign a stable pending-message ID without SQLite writes. */
  public preparePendingMessage(rawInput: SendConversationMessageInput): PreparedPendingMessage {
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

    return { input: storedInput, message };
  }

  /** Insert one pending message and reserve its already-stored attachments. */
  public projectPreparedPendingMessage(prepared: PreparedPendingMessage): void {
    const input = sendConversationMessageInputSchema.parse(prepared.input);
    const message = conversationPendingMessageSchema.parse(prepared.message);
    if (input.conversationId !== message.conversationId) {
      throw new Error("Prepared pending message belongs to another conversation.");
    }
    this.getConversation(message.conversationId);
    const attachmentIds = message.attachmentIds;
    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT OR IGNORE INTO conversation_pending_messages
             (id, conversation_id, delivery_mode, status, payload_json, sort_order,
              created_at, updated_at, consumed_at)
           SELECT ?, ?, ?, 'pending', ?, COALESCE(MAX(sort_order), -1) + 1, ?, ?, NULL
           FROM conversation_pending_messages
           WHERE conversation_id = ? AND status = 'pending'`
        )
        .run(
          message.id,
          message.conversationId,
          message.deliveryMode,
          JSON.stringify(input),
          message.createdAt,
          message.createdAt,
          message.conversationId,
        );
      if (attachmentIds.length > 0) {
        const placeholders = attachmentIds.map(() => "?").join(", ");
        const result = this.database
          .prepare(
            `UPDATE conversation_attachments SET pending_message_id = ?
             WHERE conversation_id = ? AND message_id IS NULL
               AND (pending_message_id IS NULL OR pending_message_id = ?)
               AND id IN (${placeholders})`
          )
          .run(message.id, message.conversationId, message.id, ...attachmentIds);
        if (result.changes !== attachmentIds.length) {
          throw new Error("One or more conversation attachments are no longer available.");
        }
      }
      this.touchConversation(message.conversationId, message.createdAt);
    });
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
    const prepared = this.preparePendingMessageConsumption(
      pendingMessageId,
      runId,
      modelContent,
    );
    this.projectPreparedPendingMessageConsumption(prepared);
    return prepared.userMessage;
  }

  /** Construct a Steer user message before its JSONL write-ahead event. */
  public preparePendingMessageConsumption(
    pendingMessageId: string,
    runId: string,
    modelContent: string,
  ): PreparedPendingMessageConsumption {
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

    return { modelContent, pendingMessageId, userMessage: message };
  }

  /** Commit a Steer user message; an event ID makes write-ahead replay idempotent. */
  public projectPreparedPendingMessageConsumption(
    prepared: PreparedPendingMessageConsumption,
    eventId?: string,
  ): void {
    this.withTransaction(() => {
      this.projectPreparedPendingMessageConsumptionInTransaction(prepared, eventId);
    });
  }

  private projectPreparedPendingMessageConsumptionInTransaction(
    prepared: PreparedPendingMessageConsumption,
    eventId?: string,
  ): void {
    const message = conversationMessageItemSchema.parse(prepared.userMessage);
    const record = this.getPendingMessageRecord(prepared.pendingMessageId);
    if (
      message.role !== "user"
      || message.conversationId !== record.message.conversationId
      || message.runId === null
    ) {
      throw new Error("Prepared pending message consumption is invalid.");
    }
    const conversation = this.getConversation(message.conversationId);
    if (conversation.activeRunId !== message.runId) {
      throw new Error("Pending message can only steer its active conversation run.");
    }
    this.consumePendingRecord(prepared.pendingMessageId);
    this.insertTimelineItem(message);
    this.bindPendingAttachmentsToMessage(
      prepared.pendingMessageId,
      message.id,
      message.attachments.length,
    );
    if (eventId === undefined) {
      this.insertModelMessage({
        attachmentIds: record.message.attachmentIds,
        content: prepared.modelContent,
        conversationId: message.conversationId,
        role: "user",
        runId: message.runId,
        toolCallId: null,
        toolCalls: []
      });
    } else {
      this.insertThreadLogModelMessage({
        attachmentIds: record.message.attachmentIds,
        content: prepared.modelContent,
        conversationId: message.conversationId,
        createdAt: message.createdAt,
        eventId,
        role: "user",
        runId: message.runId,
        toolCallId: null,
        toolCalls: [],
      });
    }
    this.touchConversation(message.conversationId, message.createdAt);
  }

  public createRunFromPendingMessage(
    pendingMessageId: string,
    modelId: string,
    modelContent: string,
    executionSnapshot?: RunExecutionSnapshot,
  ): RunCreation {
    const prepared = this.prepareRunFromPendingMessage(
      pendingMessageId,
      modelId,
      modelContent,
      executionSnapshot,
    );
    this.projectPreparedRunWithUserMessage(prepared);
    return {
      conversation: this.getConversation(prepared.conversationId),
      runId: prepared.runId,
      userMessage: prepared.userMessage,
    };
  }

  /** Validates a queued user input without consuming it or creating its Run. */
  public prepareRunFromPendingMessage(
    pendingMessageId: string,
    modelId: string,
    modelContent: string,
    executionSnapshot?: RunExecutionSnapshot,
  ): PreparedRunWithUserMessage {
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

    return {
      attachmentIds: [...record.message.attachmentIds],
      conversationId: record.message.conversationId,
      executionSnapshot,
      modelContent,
      modelId,
      nextTitle,
      pendingMessageId,
      runCreatedAt: now,
      runId,
      userMessage: message,
    };
  }

  public createRunForAgentMessage(
    conversationId: string,
    modelId: string,
    executionSnapshot?: RunExecutionSnapshot,
  ): AgentMessageRunCreation {
    this.getConversation(conversationId);
    this.assertNoActiveRun(conversationId);
    const now = new Date().toISOString();
    const runId = randomUUID();

    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs
             (id, conversation_id, model_id, status, error, created_at, updated_at,
              execution_snapshot_json)
           VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`
        )
        .run(
          runId,
          conversationId,
          modelId,
          now,
          now,
          serializeRunExecutionSnapshot(executionSnapshot),
        );
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
    executionSnapshot?: RunExecutionSnapshot,
  ): RunCreation {
    const prepared = this.prepareRunWithUserMessage(
      conversationId,
      content,
      modelId,
      attachmentIds,
      modelContent,
      executionSnapshot,
    );
    this.projectPreparedRunWithUserMessage(prepared);
    return {
      conversation: this.getConversation(prepared.conversationId),
      runId: prepared.runId,
      userMessage: prepared.userMessage,
    };
  }

  /**
   * Validates and assigns stable IDs for a user turn without writing SQLite.
   * This lets the runtime durably append one `run_queued` event before the
   * SQLite projection is created.
   */
  public prepareRunWithUserMessage(
    conversationId: string,
    content: string,
    modelId: string,
    attachmentIds: readonly string[] = [],
    modelContent = content,
    executionSnapshot?: RunExecutionSnapshot,
  ): PreparedRunWithUserMessage {
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

    return {
      attachmentIds: [...attachmentIds],
      conversationId,
      executionSnapshot,
      modelContent,
      modelId,
      nextTitle,
      pendingMessageId: null,
      runCreatedAt: now,
      runId,
      userMessage: message,
    };
  }

  /** Materializes an already validated initial user turn into SQLite. */
  public projectPreparedRunWithUserMessage(
    prepared: PreparedRunWithUserMessage,
  ): void {
    this.getConversation(prepared.conversationId);
    this.assertNoActiveRun(prepared.conversationId);
    this.withTransaction(() => {
      this.database
        .prepare(
          `INSERT INTO runs
             (id, conversation_id, model_id, status, error, created_at, updated_at,
              execution_snapshot_json)
           VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`
        )
        .run(
          prepared.runId,
          prepared.conversationId,
          prepared.modelId,
          prepared.runCreatedAt,
          prepared.runCreatedAt,
          serializeRunExecutionSnapshot(prepared.executionSnapshot),
        );
      if (prepared.pendingMessageId !== null) {
        const pending = this.getPendingMessageRecord(prepared.pendingMessageId);
        if (
          pending.message.conversationId !== prepared.conversationId
          || pending.message.content !== prepared.userMessage.content
        ) {
          throw new Error("Queued conversation message changed before its Run was created.");
        }
        this.consumePendingRecord(prepared.pendingMessageId);
      }
      this.insertTimelineItem(prepared.userMessage);
      if (prepared.pendingMessageId !== null) {
        this.bindPendingAttachmentsToMessage(
          prepared.pendingMessageId,
          prepared.userMessage.id,
          prepared.attachmentIds.length,
        );
      } else if (prepared.attachmentIds.length > 0) {
        const placeholders = prepared.attachmentIds.map(() => "?").join(", ");
        const result = this.database
          .prepare(
            `UPDATE conversation_attachments SET message_id = ?
             WHERE conversation_id = ? AND message_id IS NULL
               AND pending_message_id IS NULL AND id IN (${placeholders})`
          )
          .run(
            prepared.userMessage.id,
            prepared.conversationId,
            ...prepared.attachmentIds,
          );
        if (result.changes !== prepared.attachmentIds.length) {
          throw new Error("One or more conversation attachments are no longer drafts.");
        }
      }
      this.insertModelMessage({
        attachmentIds: prepared.attachmentIds,
        content: prepared.modelContent,
        conversationId: prepared.conversationId,
        role: "user",
        runId: prepared.runId,
        toolCallId: null,
        toolCalls: []
      });
      this.database
        .prepare(
          "UPDATE conversations SET title = ?, updated_at = ?, has_unread_result = 0 WHERE id = ?"
        )
        .run(
          prepared.nextTitle,
          prepared.runCreatedAt,
          prepared.conversationId,
        );
    });
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

  /**
   * Creates the immutable replacement facts before a `run_replaced` event is
   * appended. No SQLite row is changed by this method.
   */
  public prepareLatestUserMessageReplacement(
    input: ReplaceLatestUserMessageInput,
  ): PreparedLatestUserMessageReplacement {
    const conversation = this.getConversation(input.conversationId);
    this.assertNoActiveRun(input.conversationId);
    const source = this.getLatestUserMessageReplacementSource(
      input.conversationId,
      input.messageId,
    );
    const previousRunId = source.message.runId;
    if (previousRunId === null) {
      throw new Error("The selected user message is not associated with a run.");
    }
    const runId = randomUUID();
    const now = new Date().toISOString();
    const userMessage = conversationMessageItemSchema.parse({
      ...source.message,
      content: input.content,
      createdAt: now,
      runId,
    });
    const nextTitle = this.countUserMessages(input.conversationId) === 1
      ? this.createTitleFromMessage(
          input.content || userMessage.attachments[0]?.name || "新会话",
        )
      : conversation.title;
    return {
      conversationId: input.conversationId,
      executionSnapshot: input.executionSnapshot,
      modelContent: input.modelContent,
      modelId: input.modelId,
      nextTitle,
      previousRunId,
      runCreatedAt: now,
      runId,
      userMessage,
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
           (id, conversation_id, model_id, status, error, created_at, updated_at,
            execution_snapshot_json)
         VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`,
      ).run(
        runId,
        input.conversationId,
        input.modelId,
        now,
        now,
        serializeRunExecutionSnapshot(input.executionSnapshot),
      );
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
    return rows.map((row) => this.toStoredContextMessage(row));
  }

  /**
   * ContextCompiler uses the JSONL history as its chronological source. This
   * bounded lookup only supplies the SQLite sequence needed to omit the
   * current query from FTS retrieval; it deliberately avoids loading the
   * whole materialized history on every model turn.
   */
  public getLatestContextUserMessage(conversationId: string): StoredContextMessage | null {
    const row = this.database
      .prepare(
        `SELECT sequence, run_id, role, content, tool_calls_json, tool_call_id,
                attachment_ids_json, provider_state_json
         FROM model_messages
         WHERE conversation_id = ? AND role = 'user'
         ORDER BY sequence DESC LIMIT 1`,
      )
      .get(conversationId) as DatabaseRow | undefined;
    return row === undefined ? null : this.toStoredContextMessage(row);
  }

  public searchContextMessages(input: {
    conversationId: string;
    excludeSequences?: readonly number[];
    limit?: number;
    query: string;
  }): StoredContextMessage[] {
    this.getConversation(input.conversationId);
    const terms = contextSearchTerms(input.query);
    if (terms.length === 0) return [];
    const limit = input.limit ?? 24;
    if (!Number.isSafeInteger(limit) || limit <= 0 || limit > 100) {
      throw new Error("Context search limit must be between 1 and 100.");
    }
    const excluded = [...new Set(input.excludeSequences ?? [])].filter(
      (sequence) => Number.isSafeInteger(sequence) && sequence > 0,
    );
    const exclusionSql = excluded.length === 0
      ? ""
      : ` AND model_messages.sequence NOT IN (${excluded.map(() => "?").join(", ")})`;
    const ftsQuery = ftsQueryForTerms(terms);
    const columns = `model_messages.sequence, model_messages.run_id, model_messages.role,
      model_messages.content, model_messages.tool_calls_json, model_messages.tool_call_id,
      model_messages.attachment_ids_json, model_messages.provider_state_json`;
    if (ftsQuery.length > 0) {
      const rows = this.database
        .prepare(
          `SELECT ${columns}
           FROM model_message_search
           JOIN model_messages
             ON model_messages.sequence = model_message_search.sequence
            AND model_messages.conversation_id = model_message_search.conversation_id
           WHERE model_message_search.conversation_id = ?
             AND model_message_search MATCH ?
             ${exclusionSql}
           ORDER BY bm25(model_message_search) ASC, model_messages.sequence DESC
           LIMIT ?`,
        )
        .all(input.conversationId, ftsQuery, ...excluded, limit) as DatabaseRow[];
      if (rows.length > 0) return rows.map((row) => this.toStoredContextMessage(row));
    }

    const searchableText = "(model_messages.content || char(10) || model_messages.tool_calls_json)";
    const likeConditions = terms.map(() => `${searchableText} LIKE ? ESCAPE '\\'`);
    const rows = this.database
      .prepare(
        `SELECT ${columns}
         FROM model_messages
         WHERE model_messages.conversation_id = ?
           AND (${likeConditions.join(" OR ")})
           ${exclusionSql}
         ORDER BY model_messages.sequence DESC
         LIMIT ?`,
      )
      .all(
        input.conversationId,
        ...terms.map(likePattern),
        ...excluded,
        limit,
      ) as DatabaseRow[];
    return rows.map((row) => this.toStoredContextMessage(row));
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
    return this.projectPreparedContextCheckpoint(
      this.prepareContextCheckpoint(conversationId, coveredThroughSequence, summary),
    );
  }

  /** Validate a checkpoint before the JSONL write-ahead boundary. */
  public prepareContextCheckpoint(
    conversationId: string,
    coveredThroughSequence: number,
    summary: string,
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
    return {
      conversationId,
      coveredThroughSequence,
      createdAt: existing?.createdAt ?? now,
      summary: normalizedSummary,
      updatedAt: now,
    };
  }

  /** Materialize a previously validated checkpoint using its durable times. */
  public projectPreparedContextCheckpoint(
    checkpoint: ConversationContextCheckpoint,
  ): ConversationContextCheckpoint {
    this.getConversation(checkpoint.conversationId);
    const normalizedSummary = checkpoint.summary.trim();
    if (!Number.isSafeInteger(checkpoint.coveredThroughSequence) || checkpoint.coveredThroughSequence <= 0) {
      throw new Error("Context checkpoint sequence must be a positive integer.");
    }
    if (normalizedSummary.length === 0 || normalizedSummary.length > 200_000) {
      throw new Error("Context checkpoint summary has an invalid length.");
    }
    const coveredMessage = this.database
      .prepare(
        "SELECT sequence FROM model_messages WHERE conversation_id = ? AND sequence = ?"
      )
      .get(checkpoint.conversationId, checkpoint.coveredThroughSequence) as DatabaseRow | undefined;
    if (coveredMessage === undefined) {
      throw new Error("Context checkpoint must end at a stored conversation message.");
    }
    const existing = this.getContextCheckpoint(checkpoint.conversationId);
    if (
      existing !== null
      && checkpoint.coveredThroughSequence < existing.coveredThroughSequence
    ) {
      throw new Error("Context checkpoint coverage cannot move backwards.");
    }
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
      .run(
        checkpoint.conversationId,
        checkpoint.coveredThroughSequence,
        normalizedSummary,
        checkpoint.createdAt,
        checkpoint.updatedAt,
      );
    return this.getContextCheckpoint(checkpoint.conversationId) ?? (() => {
      throw new Error("Context checkpoint could not be persisted.");
    })();
  }

  public getThreadLogProjectionCursor(
    conversationId: string,
  ): ThreadLogProjectionCursor | null {
    this.getConversation(conversationId);
    const row = this.database
      .prepare(
        `SELECT conversation_id, last_event_sequence, last_event_id, updated_at
         FROM thread_log_projection_cursors WHERE conversation_id = ?`,
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) return null;
    return {
      conversationId: asString(row, "conversation_id"),
      lastEventId: asString(row, "last_event_id"),
      lastSequence: asNumber(row, "last_event_sequence"),
      updatedAt: asString(row, "updated_at"),
    };
  }

  /** Clears only the derived event index before a Conversation log is rebuilt. */
  public resetThreadLogProjection(conversationId: string): void {
    this.getConversation(conversationId);
    this.withTransaction(() => {
      this.database
        .prepare("DELETE FROM thread_log_projection_cursors WHERE conversation_id = ?")
        .run(conversationId);
      this.database
        .prepare("DELETE FROM thread_log_event_index WHERE conversation_id = ?")
        .run(conversationId);
    });
  }

  /**
   * Materializes the append-only log into its idempotent event index. Selected
   * write-ahead facts have already updated their business projection before
   * this cursor advances; all other events remain shadow-log metadata.
   */
  public projectThreadLogEvents(
    conversationId: string,
    events: readonly ThreadLogProjectionEvent[],
  ): ThreadLogProjectionCursor | null {
    this.getConversation(conversationId);
    if (events.length === 0) return this.getThreadLogProjectionCursor(conversationId);

    const current = this.getThreadLogProjectionCursor(conversationId);
    let expectedSequence = (current?.lastSequence ?? 0) + 1;
    for (const event of events) {
      if (
        !Number.isSafeInteger(event.sequence)
        || event.sequence !== expectedSequence
        || event.eventId.trim().length === 0
        || event.type.trim().length === 0
        || Number.isNaN(Date.parse(event.createdAt))
      ) {
        throw new Error("ThreadLog projection events are not a valid ordered sequence.");
      }
      expectedSequence += 1;
    }

    const lastEvent = events.at(-1);
    if (lastEvent === undefined) throw new Error("ThreadLog projection events are empty.");
    const now = new Date().toISOString();
    this.withTransaction(() => {
      for (const event of events) {
        const duplicate = this.database
          .prepare(
            `SELECT conversation_id, sequence, type, created_at, payload_json
             FROM thread_log_event_index WHERE event_id = ?`,
          )
          .get(event.eventId) as DatabaseRow | undefined;
        if (duplicate !== undefined) {
          const matches =
            asString(duplicate, "conversation_id") === conversationId
            && asNumber(duplicate, "sequence") === event.sequence
            && asString(duplicate, "type") === event.type
            && asString(duplicate, "created_at") === event.createdAt
            && asString(duplicate, "payload_json") === JSON.stringify(event.payload);
          if (!matches) {
            throw new Error("ThreadLog eventId conflicts with an existing event index row.");
          }
          continue;
        }
        this.database
          .prepare(
            `INSERT INTO thread_log_event_index
               (event_id, conversation_id, sequence, type, created_at, payload_json)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .run(
            event.eventId,
            conversationId,
            event.sequence,
            event.type,
            event.createdAt,
            JSON.stringify(event.payload),
          );
      }
      this.database
        .prepare(
          `INSERT INTO thread_log_projection_cursors
             (conversation_id, last_event_sequence, last_event_id, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(conversation_id) DO UPDATE SET
             last_event_sequence = excluded.last_event_sequence,
             last_event_id = excluded.last_event_id,
             updated_at = excluded.updated_at`,
        )
        .run(conversationId, lastEvent.sequence, lastEvent.eventId, now);
    });
    return this.getThreadLogProjectionCursor(conversationId);
  }

  public listProjectedThreadLogEvents(conversationId: string): ThreadLogProjectionEvent[] {
    this.getConversation(conversationId);
    const rows = this.database
      .prepare(
        `SELECT event_id, sequence, type, created_at, payload_json
         FROM thread_log_event_index
         WHERE conversation_id = ?
         ORDER BY sequence ASC`,
      )
      .all(conversationId) as DatabaseRow[];
    return rows.map((row) => ({
      createdAt: asString(row, "created_at"),
      eventId: asString(row, "event_id"),
      payload: parseJson<Record<string, unknown>>(
        asString(row, "payload_json"),
        "ThreadLog event payload",
      ),
      sequence: asNumber(row, "sequence"),
      type: asString(row, "type"),
    }));
  }

  /**
   * Recreates AttachmentStore metadata from renderer-safe references already
   * carried by durable message and pending-queue events. The resolver is
   * supplied by AttachmentStore so JSONL never contains a managed absolute
   * path or extracted text.
   */
  public projectThreadLogAttachmentReferences(
    conversationId: string,
    events: readonly ThreadLogProjectionEvent[],
    resolvePaths: ThreadLogAttachmentPathResolver,
  ): void {
    this.getConversation(conversationId);
    const byId = new Map<string, ConversationAttachment>();
    for (const event of events) {
      const message = threadLogUserMessage(event.payload, conversationId, event.createdAt);
      if (message !== null) {
        for (const attachment of message.attachments) {
          byId.set(attachment.id, attachment);
        }
      }
      const references = z.array(conversationAttachmentSchema).safeParse(
        event.payload.attachmentRefs,
      );
      if (!references.success) continue;
      for (const attachment of references.data) {
        if (attachment.conversationId !== conversationId) {
          throw new Error("ThreadLog attachment reference belongs to another Conversation.");
        }
        byId.set(attachment.id, attachment);
      }
    }
    if (byId.size === 0) return;

    this.withTransaction(() => {
      const insert = this.database.prepare(
        `INSERT OR IGNORE INTO conversation_attachments
           (id, conversation_id, message_id, source, kind, name, mime_type,
            size_bytes, project_path, stored_path, extracted_text_path,
            context_tokens, truncated, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const attachment of byId.values()) {
        const paths = resolvePaths(attachment);
        insert.run(
          attachment.id,
          attachment.conversationId,
          attachment.messageId,
          attachment.source,
          attachment.kind,
          attachment.name,
          attachment.mimeType,
          attachment.sizeBytes,
          attachment.projectPath,
          paths.storedPath,
          paths.extractedTextPath,
          attachment.contextTokens,
          Number(attachment.truncated),
          attachment.createdAt,
        );
      }
    });
  }

  /**
   * Materializes write-ahead business events for the JSONL-first migration
   * seam. It is intentionally narrow: legacy shadow events still keep their
   * existing SQLite-first path until their own atomic event contracts exist.
   */
  public projectThreadLogBusinessEvents(
    conversationId: string,
    events: readonly ThreadLogProjectionEvent[],
  ): boolean {
    this.getConversation(conversationId);
    if (events.length === 0 || events.some((event) => event.type === "legacy_snapshot_imported")) {
      return false;
    }
    let projected = false;
    this.withTransaction(() => {
      for (const event of events) {
        if (event.type === "run_queued") {
          this.materializeThreadLogQueuedRun(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "run_replaced") {
          this.materializeThreadLogReplacedRun(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "run_terminal") {
          this.materializeThreadLogTerminalRun(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "run_started" && event.payload.writeAhead === true) {
          this.materializeThreadLogStartedRun(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "assistant_message" && event.payload.writeAhead === true) {
          this.materializeThreadLogAssistantMessage(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "tool_call_requested" && event.payload.writeAhead === true) {
          this.materializeThreadLogToolStarted(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "tool_result" && event.payload.writeAhead === true) {
          this.materializeThreadLogToolResult(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "context_checkpoint" && event.payload.writeAhead === true) {
          this.materializeThreadLogContextCheckpoint(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "pending_messages_updated" && event.payload.writeAhead === true) {
          this.materializeThreadLogPendingMessages(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "pending_message_cancelled" && event.payload.writeAhead === true) {
          this.materializeThreadLogPendingMessageCancellation(conversationId, event);
          projected = true;
          continue;
        }
        if (event.type === "user_message" && event.payload.writeAhead === true) {
          this.materializeThreadLogPendingMessageConsumption(conversationId, event);
          projected = true;
        }
      }
    });
    return projected;
  }

  /**
   * Rebuilds the local query/UI projection of a post-migration ThreadLog when
   * the Conversation metadata exists but its mutable business rows do not.
   *
   * This is deliberately recovery-only: normal writes still use the existing
   * business transaction and append the same event stream for verification.
   * A legacy snapshot takes precedence because it is the only lossless source
   * for Conversations created before the richer v1 event payloads existed.
   */
  public restoreThreadLogBusinessEvents(
    conversationId: string,
    events: readonly ThreadLogProjectionEvent[],
  ): boolean {
    this.getConversation(conversationId);
    if (events.some((event) => event.type === "legacy_snapshot_imported")) return false;
    const existing = this.database
      .prepare(
        `SELECT
           (SELECT COUNT(*) FROM runs WHERE conversation_id = ?) AS run_count,
           (SELECT COUNT(*) FROM conversation_timeline WHERE conversation_id = ?) AS timeline_count,
           (SELECT COUNT(*) FROM model_messages WHERE conversation_id = ?) AS message_count,
           (SELECT COUNT(*) FROM conversation_agent_messages WHERE target_conversation_id = ?) AS agent_message_count`,
      )
      .get(conversationId, conversationId, conversationId, conversationId) as DatabaseRow;
    if (
      asNumber(existing, "run_count") > 0
      || asNumber(existing, "timeline_count") > 0
      || asNumber(existing, "message_count") > 0
      || asNumber(existing, "agent_message_count") > 0
    ) {
      return false;
    }

    const startedTools = new Map<string, ConversationToolItem>();
    this.withTransaction(() => {
      for (const event of events) {
        const payload = event.payload;
        if (event.type === "run_queued") {
          this.materializeThreadLogQueuedRun(conversationId, event);
          continue;
        }

        if (event.type === "run_replaced") {
          this.materializeThreadLogReplacedRun(conversationId, event);
          continue;
        }

        if (event.type === "run_terminal") {
          this.materializeThreadLogTerminalRun(conversationId, event);
          continue;
        }

        if (event.type === "run_started") {
          this.materializeThreadLogStartedRun(conversationId, event);
          continue;
        }

        if (event.type === "run_created") {
          const runId = readProjectionString(payload, "runId");
          const modelId = readProjectionString(payload, "modelId");
          if (runId === null || modelId === null) continue;
          const executionSnapshot = runExecutionSnapshotSchema.safeParse(payload.executionSnapshot);
          this.database
            .prepare(
              `INSERT OR IGNORE INTO runs
                 (id, conversation_id, model_id, status, error, created_at, updated_at,
                  execution_snapshot_json)
               VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`,
            )
            .run(
              runId,
              conversationId,
              modelId,
              readProjectionIsoDate(payload, "createdAt") ?? event.createdAt,
              event.createdAt,
              executionSnapshot.success
                ? serializeRunExecutionSnapshot(executionSnapshot.data)
                : null,
            );
          continue;
        }

        if (
          (event.type === "user_message" || event.type === "user_message_replaced")
          && event.payload.writeAhead !== true
        ) {
          const message = threadLogUserMessage(payload, conversationId, event.createdAt);
          if (message === null) continue;
          if (event.type === "user_message_replaced") {
            const supersededRunId = readProjectionString(payload, "previousRunId");
            if (supersededRunId !== null) {
              this.database
                .prepare("DELETE FROM conversation_timeline WHERE conversation_id = ? AND run_id = ?")
                .run(conversationId, supersededRunId);
              this.database
                .prepare("DELETE FROM model_messages WHERE conversation_id = ? AND run_id = ?")
                .run(conversationId, supersededRunId);
            }
          }
          this.insertThreadLogTimeline(message);
          this.insertThreadLogModelMessage({
            attachmentIds: message.attachments.map((attachment) => attachment.id),
            content: readProjectionString(payload, "modelContent") ?? message.content,
            conversationId,
            eventId: event.eventId,
            role: "user",
            runId: message.runId,
            toolCallId: null,
            toolCalls: [],
            createdAt: message.createdAt,
          });
          this.touchConversation(conversationId, message.createdAt);
          continue;
        }

        if (event.type === "assistant_message") {
          this.materializeThreadLogAssistantMessage(conversationId, event);
          continue;
        }

        if (event.type === "tool_call_requested") {
          const tool = readProjectionTool(payload, "tool");
          if (tool === null) continue;
          startedTools.set(tool.id, tool);
          this.insertThreadLogTimeline(tool);
          continue;
        }

        if (event.type === "tool_result") {
          const tool = readProjectionTool(payload, "tool")
            ?? startedTools.get(readProjectionString(payload, "toolId") ?? "")
            ?? null;
          if (tool !== null) {
            this.database
              .prepare("UPDATE conversation_timeline SET payload_json = ?, created_at = ? WHERE id = ?")
              .run(JSON.stringify(tool), tool.createdAt, tool.id);
            this.insertThreadLogTimeline(tool);
          }
          const content = readProjectionString(payload, "content");
          const runId = readProjectionString(payload, "runId");
          const toolCallId = readProjectionString(payload, "toolCallId");
          if (content !== null && toolCallId !== null) {
            this.insertThreadLogModelMessage({
              attachmentIds: [],
              content,
              conversationId,
              createdAt: tool?.createdAt ?? event.createdAt,
              eventId: event.eventId,
              role: "tool",
              runId,
              toolCallId,
              toolCalls: [],
            });
          }
          continue;
        }

        if (event.type === "tool_approval_requested") {
          const toolId = readProjectionString(payload, "toolId");
          if (toolId !== null) this.markThreadLogToolAwaitingApproval(conversationId, toolId);
          continue;
        }

        if (event.type === "agent_message") {
          const message = readProjectionAgentMessage(payload, "message");
          if (message === null) continue;
          if (!this.hasConversation(message.senderConversationId)) {
            throw new Error("ThreadLog Agent message source conversation is unavailable.");
          }
          this.persistAgentMessage(message);
          if (message.messageType === "task_result" && message.taskId !== null) {
            const linked = this.database
              .prepare(
                `UPDATE subagent_tasks
                 SET result_message_id = ?, updated_at = ?
                 WHERE id = ?
                   AND parent_conversation_id = ?
                   AND child_conversation_id = ?
                   AND result_message_id IS NULL`,
              )
              .run(
                message.id,
                message.createdAt,
                message.taskId,
                conversationId,
                message.senderConversationId,
              );
            if (linked.changes !== 1) {
              const task = this.database
                .prepare(
                  `SELECT result_message_id FROM subagent_tasks
                   WHERE id = ?
                     AND parent_conversation_id = ?
                     AND child_conversation_id = ?`,
                )
                .get(
                  message.taskId,
                  conversationId,
                  message.senderConversationId,
                ) as DatabaseRow | undefined;
              if (task === undefined || asNullableString(task, "result_message_id") !== message.id) {
                throw new Error("ThreadLog Subagent result message has no matching task.");
              }
            }
          }
          continue;
        }

        if (event.type === "agent_message_read") {
          const messageId = readProjectionString(payload, "messageId");
          if (messageId !== null) {
            this.markThreadLogAgentMessageRead(conversationId, messageId, event.createdAt);
          }
          continue;
        }

        if (event.type === "pending_messages_updated") {
          const snapshot = threadLogPendingMessagesSchema.safeParse({
            pendingMessages: payload.pendingMessages,
          });
          if (snapshot.success) {
            this.replaceThreadLogPendingMessages(conversationId, snapshot.data.pendingMessages);
          }
          continue;
        }

        if (event.type === "pending_message_cancelled") {
          if (payload.writeAhead === true) {
            this.materializeThreadLogPendingMessageCancellation(conversationId, event);
          }
          continue;
        }

        if (event.type === "task_list_updated") {
          if (payload.taskList === null) {
            this.database
              .prepare("DELETE FROM conversation_task_lists WHERE conversation_id = ?")
              .run(conversationId);
            continue;
          }
          const taskList = conversationTaskListSchema.safeParse(payload.taskList);
          if (!taskList.success || taskList.data.conversationId !== conversationId) continue;
          this.database
            .prepare(
              `INSERT INTO conversation_task_lists (conversation_id, payload_json, updated_at)
               VALUES (?, ?, ?)
               ON CONFLICT(conversation_id) DO UPDATE SET
                 payload_json = excluded.payload_json,
                 updated_at = excluded.updated_at`,
            )
            .run(conversationId, JSON.stringify(taskList.data), taskList.data.updatedAt);
          continue;
        }

        if (
          event.type === "subagent_task_created"
          || event.type === "subagent_task_completed"
        ) {
          const task = threadLogSubagentTaskSchema.safeParse(payload.task);
          if (!task.success || task.data.parentConversationId !== conversationId) continue;
          if (
            !this.hasConversation(task.data.childConversationId)
            || !this.runExists(task.data.sourceRunId)
            || (task.data.targetRunId !== null && !this.runExists(task.data.targetRunId))
          ) {
            throw new Error("ThreadLog Subagent task dependencies are unavailable.");
          }
          this.database
            .prepare(
              `INSERT INTO subagent_tasks
                 (id, parent_conversation_id, child_conversation_id, source_run_id,
                  target_run_id, title, task, status, result, error, result_message_id,
                  created_at, updated_at, completed_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET
                 target_run_id = excluded.target_run_id,
                 status = excluded.status,
                 result = excluded.result,
                 error = excluded.error,
                 result_message_id = COALESCE(excluded.result_message_id, subagent_tasks.result_message_id),
                 updated_at = excluded.updated_at,
                 completed_at = excluded.completed_at`,
            )
            .run(
              task.data.id,
              task.data.parentConversationId,
              task.data.childConversationId,
              task.data.sourceRunId,
              task.data.targetRunId,
              task.data.title,
              task.data.task,
              task.data.status,
              task.data.result,
              task.data.error,
              task.data.resultMessageId,
              task.data.createdAt,
              task.data.updatedAt,
              task.data.completedAt,
            );
          continue;
        }

        if (event.type === "context_checkpoint") {
          const coveredThroughSequence = payload.coveredThroughSequence;
          const summary = readProjectionString(payload, "summary");
          if (
            typeof coveredThroughSequence === "number"
            && Number.isSafeInteger(coveredThroughSequence)
            && coveredThroughSequence > 0
            && summary !== null
          ) {
            this.database
              .prepare(
                `INSERT INTO conversation_context_checkpoints
                   (conversation_id, covered_through_sequence, summary, created_at, updated_at)
                 VALUES (?, ?, ?, ?, ?)
                 ON CONFLICT(conversation_id) DO UPDATE SET
                   covered_through_sequence = excluded.covered_through_sequence,
                   summary = excluded.summary,
                   updated_at = excluded.updated_at`,
              )
              .run(
                conversationId,
                coveredThroughSequence,
                summary,
                readProjectionIsoDate(payload, "createdAt") ?? event.createdAt,
                readProjectionIsoDate(payload, "updatedAt") ?? event.createdAt,
              );
          }
          continue;
        }

        if (event.type === "run_finished") {
          const runId = readProjectionString(payload, "runId");
          const status = conversationRunStatusSchema.safeParse(payload.status);
          if (runId === null || !status.success || status.data === "queued" || status.data === "running") {
            continue;
          }
          this.database
            .prepare("UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ?")
            .run(status.data, readProjectionString(payload, "error"), event.createdAt, runId);
          this.database
            .prepare("UPDATE conversations SET has_unread_result = ?, updated_at = ? WHERE id = ?")
            .run(Number(status.data === "completed" || status.data === "failed"), event.createdAt, conversationId);
          this.database
            .prepare(
              `UPDATE subagent_tasks
               SET status = ?, result = ?, error = ?, updated_at = ?, completed_at = ?
               WHERE target_run_id = ?`,
            )
            .run(
              status.data,
              readProjectionString(payload, "result"),
              readProjectionString(payload, "error"),
              event.createdAt,
              event.createdAt,
              runId,
            );
        }
      }
    });
    return true;
  }

  /** Insert the initial Run and its user turn from one atomic ThreadLog event. */
  private materializeThreadLogQueuedRun(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const payload = event.payload;
    const runId = readProjectionString(payload, "runId");
    const modelId = readProjectionString(payload, "modelId");
    const message = threadLogUserMessage(payload, conversationId, event.createdAt);
    if (runId === null || modelId === null || message === null || message.runId !== runId) {
      throw new Error("ThreadLog queued Run event is invalid.");
    }
    const executionSnapshot = runExecutionSnapshotSchema.safeParse(payload.executionSnapshot);
    const runCreatedAt = readProjectionIsoDate(payload, "createdAt") ?? event.createdAt;
    this.database
      .prepare(
        `INSERT OR IGNORE INTO runs
           (id, conversation_id, model_id, status, error, created_at, updated_at,
            execution_snapshot_json)
         VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`,
      )
      .run(
        runId,
        conversationId,
        modelId,
        runCreatedAt,
        runCreatedAt,
        executionSnapshot.success ? serializeRunExecutionSnapshot(executionSnapshot.data) : null,
      );
    this.insertThreadLogTimeline(message);
    const pendingMessageId = readProjectionString(payload, "pendingMessageId");
    if (pendingMessageId === null) {
      this.bindThreadLogMessageAttachments(message);
    } else {
      this.consumeThreadLogPendingRecord(pendingMessageId, event.createdAt);
      this.bindThreadLogPendingAttachmentsToMessage(pendingMessageId, message.id);
    }
    this.insertThreadLogModelMessage({
      attachmentIds: message.attachments.map((attachment) => attachment.id),
      content: readProjectionString(payload, "modelContent") ?? message.content,
      conversationId,
      createdAt: message.createdAt,
      eventId: event.eventId,
      role: "user",
      runId,
      toolCallId: null,
      toolCalls: [],
    });
    const title = readProjectionString(payload, "title");
    if (title === null) {
      this.touchConversation(conversationId, message.createdAt);
      return;
    }
    this.database
      .prepare(
        "UPDATE conversations SET title = ?, updated_at = ?, has_unread_result = 0 WHERE id = ?",
      )
      .run(title, message.createdAt, conversationId);
  }

  /** Replace the latest user turn and start its replacement Run from one event. */
  private materializeThreadLogReplacedRun(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const payload = event.payload;
    const previousRunId = readProjectionString(payload, "previousRunId");
    const runId = readProjectionString(payload, "runId");
    const modelId = readProjectionString(payload, "modelId");
    const message = threadLogUserMessage(payload, conversationId, event.createdAt);
    if (
      previousRunId === null
      || runId === null
      || modelId === null
      || message === null
      || message.runId !== runId
    ) {
      throw new Error("ThreadLog replaced Run event is invalid.");
    }
    const executionSnapshot = runExecutionSnapshotSchema.safeParse(payload.executionSnapshot);
    const runCreatedAt = readProjectionIsoDate(payload, "createdAt") ?? event.createdAt;
    this.database
      .prepare("DELETE FROM conversation_timeline WHERE conversation_id = ? AND run_id = ?")
      .run(conversationId, previousRunId);
    this.database
      .prepare("DELETE FROM model_messages WHERE conversation_id = ? AND run_id = ?")
      .run(conversationId, previousRunId);
    this.database
      .prepare("DELETE FROM conversation_context_checkpoints WHERE conversation_id = ?")
      .run(conversationId);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO runs
           (id, conversation_id, model_id, status, error, created_at, updated_at,
            execution_snapshot_json)
         VALUES (?, ?, ?, 'queued', NULL, ?, ?, ?)`,
      )
      .run(
        runId,
        conversationId,
        modelId,
        runCreatedAt,
        runCreatedAt,
        executionSnapshot.success ? serializeRunExecutionSnapshot(executionSnapshot.data) : null,
      );
    this.insertThreadLogTimeline(message);
    this.insertThreadLogModelMessage({
      attachmentIds: message.attachments.map((attachment) => attachment.id),
      content: readProjectionString(payload, "modelContent") ?? message.content,
      conversationId,
      createdAt: message.createdAt,
      eventId: event.eventId,
      role: "user",
      runId,
      toolCallId: null,
      toolCalls: [],
    });
    const title = readProjectionString(payload, "title");
    if (title === null) {
      this.touchConversation(conversationId, message.createdAt);
      return;
    }
    this.database
      .prepare(
        "UPDATE conversations SET title = ?, updated_at = ?, has_unread_result = 0 WHERE id = ?",
      )
      .run(title, message.createdAt, conversationId);
  }

  /** Materialize a checkpoint without letting its coverage move backwards. */
  private materializeThreadLogContextCheckpoint(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const coveredThroughSequence = event.payload.coveredThroughSequence;
    const summary = readProjectionString(event.payload, "summary");
    if (
      typeof coveredThroughSequence !== "number"
      || !Number.isSafeInteger(coveredThroughSequence)
      || coveredThroughSequence <= 0
      || summary === null
    ) {
      throw new Error("ThreadLog write-ahead checkpoint is invalid.");
    }
    this.projectPreparedContextCheckpoint({
      conversationId,
      coveredThroughSequence,
      createdAt: readProjectionIsoDate(event.payload, "createdAt") ?? event.createdAt,
      summary,
      updatedAt: readProjectionIsoDate(event.payload, "updatedAt") ?? event.createdAt,
    });
  }

  /** Replace the pending-input projection from one durable queue snapshot. */
  private materializeThreadLogPendingMessages(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const snapshot = threadLogPendingMessagesSchema.safeParse({
      pendingMessages: event.payload.pendingMessages,
    });
    if (!snapshot.success) {
      throw new Error("ThreadLog write-ahead pending message snapshot is invalid.");
    }
    this.replaceThreadLogPendingMessages(
      conversationId,
      snapshot.data.pendingMessages,
      true,
    );
  }

  /** Preserve a cancelled pending-message audit row while releasing its drafts. */
  private materializeThreadLogPendingMessageCancellation(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const pendingMessageId = readProjectionString(event.payload, "pendingMessageId");
    if (pendingMessageId === null) {
      throw new Error("ThreadLog pending message cancellation is invalid.");
    }
    const row = this.database
      .prepare(
        "SELECT status FROM conversation_pending_messages WHERE id = ? AND conversation_id = ?",
      )
      .get(pendingMessageId, conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("ThreadLog pending message cancellation has no pending message.");
    }
    const currentStatus = asString(row, "status");
    if (currentStatus === "pending") {
      this.database
        .prepare(
          `UPDATE conversation_pending_messages
           SET status = 'cancelled', consumed_at = ?, updated_at = ?
           WHERE id = ? AND status = 'pending'`,
        )
        .run(event.createdAt, event.createdAt, pendingMessageId);
    } else if (currentStatus !== "cancelled") {
      throw new Error("ThreadLog pending message cancellation state is invalid.");
    }
    this.database
      .prepare(
        `UPDATE conversation_attachments SET pending_message_id = NULL
         WHERE pending_message_id = ? AND message_id IS NULL`,
      )
      .run(pendingMessageId);
    this.touchConversation(conversationId, event.createdAt);
  }

  /** Materialize a Steer message into the already-running Run. */
  private materializeThreadLogPendingMessageConsumption(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const pendingMessageId = readProjectionString(event.payload, "pendingMessageId");
    const message = threadLogUserMessage(event.payload, conversationId, event.createdAt);
    const modelContent = readProjectionString(event.payload, "modelContent");
    if (pendingMessageId === null || message === null || modelContent === null) {
      throw new Error("ThreadLog write-ahead pending message consumption is invalid.");
    }
    this.projectPreparedPendingMessageConsumptionInTransaction({
      modelContent,
      pendingMessageId,
      userMessage: message,
    }, event.eventId);
  }

  /** Persist the Tool timeline item before its handler is allowed to run. */
  private materializeThreadLogToolStarted(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const tool = readProjectionTool(event.payload, "tool");
    if (tool === null || tool.conversationId !== conversationId) {
      throw new Error("ThreadLog write-ahead Tool start is invalid.");
    }
    this.insertThreadLogTimeline(tool);
  }

  /** Persist one completed Tool row and its model-visible result together. */
  private materializeThreadLogToolResult(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const tool = readProjectionTool(event.payload, "tool");
    const content = readProjectionString(event.payload, "content");
    const toolCallId = readProjectionString(event.payload, "toolCallId");
    if (
      tool === null
      || tool.conversationId !== conversationId
      || content === null
      || toolCallId === null
    ) {
      throw new Error("ThreadLog write-ahead Tool result is invalid.");
    }
    this.insertThreadLogTimeline(tool);
    this.database
      .prepare("UPDATE conversation_timeline SET payload_json = ?, created_at = ? WHERE id = ? AND kind = 'tool'")
      .run(JSON.stringify(tool), tool.createdAt, tool.id);
    this.insertThreadLogModelMessage({
      attachmentIds: [],
      content,
      conversationId,
      createdAt: tool.createdAt,
      eventId: event.eventId,
      role: "tool",
      runId: tool.runId,
      toolCallId,
      toolCalls: [],
    });
    this.touchConversation(conversationId, tool.createdAt);
  }

  /** Materialize an Assistant model turn before its tool calls can execute. */
  private materializeThreadLogAssistantMessage(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const payload = event.payload;
    const content = readProjectionString(payload, "content");
    const runId = readProjectionString(payload, "runId");
    if (content === null || runId === null) {
      if (payload.writeAhead === true) {
        throw new Error("ThreadLog write-ahead Assistant message is invalid.");
      }
      return;
    }
    const storedTimelineMessage = readProjectionTimelineMessage(payload, "timelineMessage");
    const messageId = readProjectionString(payload, "messageId");
    const modelId = readProjectionString(payload, "modelId");
    const timelineMessage = storedTimelineMessage
      ?? (content.length === 0
        ? null
        : messageId !== null && modelId !== null
          ? conversationMessageItemSchema.parse({
              content,
              conversationId,
              createdAt: event.createdAt,
              id: messageId,
              kind: "message",
              modelId,
              role: "assistant",
              runId,
              status: "completed",
            })
          : null);
    if (payload.writeAhead === true && content.length > 0 && timelineMessage === null) {
      throw new Error("ThreadLog write-ahead Assistant timeline message is invalid.");
    }
    const providerState = readProjectionProviderState(payload);
    this.insertThreadLogModelMessage({
      attachmentIds: [],
      content,
      conversationId,
      createdAt: timelineMessage?.createdAt ?? event.createdAt,
      eventId: event.eventId,
      ...(providerState === undefined ? {} : { providerState }),
      role: "assistant",
      runId,
      toolCallId: null,
      toolCalls: readProjectionToolCalls(payload),
    });
    if (timelineMessage !== null) {
      this.insertThreadLogTimeline(timelineMessage);
      this.touchConversation(conversationId, timelineMessage.createdAt);
    }
  }

  /** Advance a queued Run through its durable model/tool execution boundary. */
  private materializeThreadLogStartedRun(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const runId = readProjectionString(event.payload, "runId");
    if (runId === null) throw new Error("ThreadLog started Run event is invalid.");
    const row = this.database
      .prepare("SELECT conversation_id, status FROM runs WHERE id = ?")
      .get(runId) as DatabaseRow | undefined;
    if (row === undefined || asString(row, "conversation_id") !== conversationId) {
      throw new Error("ThreadLog started Run does not belong to the conversation.");
    }
    const currentStatus = conversationRunStatusSchema.parse(asString(row, "status"));
    if (currentStatus === "running") return;
    if (currentStatus === "completed" || currentStatus === "failed" || currentStatus === "cancelled") {
      // Recovery may have already replayed this Run's later terminal event
      // before the projector advances its independent event-index cursor.
      return;
    }
    if (currentStatus !== "queued") {
      throw new Error("ThreadLog started Run state transition is invalid.");
    }
    this.database
      .prepare("UPDATE runs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'queued'")
      .run(event.createdAt, runId);
  }

  /** Materialize one non-Subagent terminal Run from its write-ahead fact. */
  private materializeThreadLogTerminalRun(
    conversationId: string,
    event: ThreadLogProjectionEvent,
  ): void {
    const payload = event.payload;
    const runId = readProjectionString(payload, "runId");
    const status = conversationRunStatusSchema.safeParse(payload.status);
    if (
      runId === null
      || !status.success
      || status.data === "queued"
      || status.data === "running"
    ) {
      throw new Error("ThreadLog terminal Run event is invalid.");
    }
    const row = this.database
      .prepare("SELECT conversation_id, status FROM runs WHERE id = ?")
      .get(runId) as DatabaseRow | undefined;
    if (row === undefined || asString(row, "conversation_id") !== conversationId) {
      throw new Error("ThreadLog terminal Run does not belong to the conversation.");
    }
    const currentStatus = conversationRunStatusSchema.parse(asString(row, "status"));
    if (currentStatus !== status.data) {
      if (!RUN_STATUS_TRANSITIONS[currentStatus].includes(status.data)) {
        throw new Error("ThreadLog terminal Run state transition is invalid.");
      }
      this.database
        .prepare("UPDATE runs SET status = ?, error = ?, updated_at = ? WHERE id = ? AND status = ?")
        .run(status.data, readProjectionString(payload, "error"), event.createdAt, runId, currentStatus);
    }

    const assistant = threadLogTerminalAssistant(payload);
    if (assistant !== null) {
      const timelineMessage = assistant.kind === "turn" || assistant.kind === "cancelled"
        ? assistant.content.length === 0
          ? null
          : conversationMessageItemSchema.parse({
              content: assistant.content,
              conversationId,
              createdAt: event.createdAt,
              id: assistant.messageId,
              kind: "message",
              modelId: assistant.modelId,
              role: "assistant",
              runId,
              status: assistant.kind === "turn" ? "completed" : "cancelled",
            })
        : conversationMessageItemSchema.parse({
            content: assistant.content,
            conversationId,
            createdAt: event.createdAt,
            id: assistant.messageId,
            kind: "message",
            modelId: assistant.modelId,
            role: "assistant",
            runId,
            status: "failed",
          });
      if (assistant.kind !== "failure") {
        this.insertThreadLogModelMessage({
          attachmentIds: [],
          content: assistant.content,
          conversationId,
          createdAt: event.createdAt,
          eventId: event.eventId,
          ...(assistant.providerState === undefined ? {} : { providerState: assistant.providerState }),
          role: "assistant",
          runId,
          toolCallId: null,
          toolCalls: [],
        });
      }
      if (timelineMessage !== null) this.insertThreadLogTimeline(timelineMessage);
    }
    this.database
      .prepare("UPDATE conversations SET has_unread_result = ?, updated_at = ? WHERE id = ?")
      .run(Number(status.data === "completed" || status.data === "failed"), event.createdAt, conversationId);
  }

  private insertThreadLogTimeline(item: ConversationTimelineItem): void {
    const validated = conversationTimelineItemSchema.parse(item);
    this.database
      .prepare(
        `INSERT OR IGNORE INTO conversation_timeline
           (id, conversation_id, run_id, kind, payload_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        validated.id,
        validated.conversationId,
        validated.runId,
        validated.kind,
        JSON.stringify(validated),
        validated.createdAt,
      );
  }

  /**
   * Existing attachment snapshots are already stored under AGENT_HOME. The
   * log only references their immutable IDs, so replay can re-bind drafts
   * without ever serializing a managed absolute path into JSONL.
   */
  private bindThreadLogMessageAttachments(message: ConversationMessageItem): void {
    const attachmentIds = message.attachments.map((attachment) => attachment.id);
    if (attachmentIds.length === 0) return;
    const placeholders = attachmentIds.map(() => "?").join(", ");
    this.database
      .prepare(
        `UPDATE conversation_attachments SET message_id = ?
         WHERE conversation_id = ? AND message_id IS NULL
           AND pending_message_id IS NULL AND id IN (${placeholders})`,
      )
      .run(message.id, message.conversationId, ...attachmentIds);
  }

  /** Idempotently consumes a queued input when its atomic Run event is replayed. */
  private consumeThreadLogPendingRecord(pendingMessageId: string, consumedAt: string): void {
    this.database
      .prepare(
        `UPDATE conversation_pending_messages
         SET status = 'consumed', consumed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(consumedAt, consumedAt, pendingMessageId);
  }

  /** The pending snapshot may be absent in a partial recovery; binding zero rows is safe. */
  private bindThreadLogPendingAttachmentsToMessage(
    pendingMessageId: string,
    messageId: string,
  ): void {
    this.database
      .prepare(
        `UPDATE conversation_attachments SET message_id = ?, pending_message_id = NULL
         WHERE pending_message_id = ? AND message_id IS NULL`,
      )
      .run(messageId, pendingMessageId);
  }

  private runExists(runId: string): boolean {
    return this.database
      .prepare("SELECT 1 AS present FROM runs WHERE id = ? LIMIT 1")
      .get(runId) !== undefined;
  }

  private markThreadLogAgentMessageRead(
    conversationId: string,
    messageId: string,
    readAt: string,
  ): void {
    const row = this.database
      .prepare(
        `SELECT payload_json FROM conversation_agent_messages
         WHERE id = ? AND target_conversation_id = ?`,
      )
      .get(messageId, conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("ThreadLog Agent message read event has no matching message.");
    }
    const current = conversationAgentMessageItemSchema.parse(
      parseJson(asString(row, "payload_json"), "Agent message"),
    );
    if (current.status === "read") return;
    const read = conversationAgentMessageItemSchema.parse({
      ...current,
      readAt,
      status: "read",
    });
    this.database
      .prepare(
        `UPDATE conversation_agent_messages
         SET status = 'read', payload_json = ?, read_at = ? WHERE id = ?`,
      )
      .run(JSON.stringify(read), readAt, messageId);
    this.database
      .prepare(
        "UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'agent_message'",
      )
      .run(JSON.stringify(read), messageId);
  }

  private markThreadLogToolAwaitingApproval(
    conversationId: string,
    toolId: string,
  ): void {
    const row = this.database
      .prepare(
        `SELECT payload_json FROM conversation_timeline
         WHERE id = ? AND conversation_id = ? AND kind = 'tool'`,
      )
      .get(toolId, conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("ThreadLog tool approval has no matching Tool Call.");
    }
    const current = conversationToolItemSchema.parse(
      parseJson(asString(row, "payload_json"), "tool"),
    );
    if (current.status === "awaiting_approval") return;
    const awaiting = conversationToolItemSchema.parse({
      ...current,
      status: "awaiting_approval",
    });
    this.database
      .prepare(
        "UPDATE conversation_timeline SET payload_json = ? WHERE id = ?",
      )
      .run(JSON.stringify(awaiting), toolId);
  }

  private replaceThreadLogPendingMessages(
    conversationId: string,
    pendingMessages: readonly StoredPendingMessage[],
    requireAttachmentBindings = false,
  ): void {
    if (pendingMessages.some((record) =>
      record.message.conversationId !== conversationId
      || record.input.conversationId !== conversationId
      || (record.input.deliveryMode ?? "queue") !== record.message.deliveryMode,
    )) {
      throw new Error("ThreadLog pending message snapshot belongs to another Conversation.");
    }
    this.database
      .prepare(
        "DELETE FROM conversation_pending_messages WHERE conversation_id = ? AND status = 'pending'",
      )
      .run(conversationId);
    this.database
      .prepare(
        `UPDATE conversation_attachments SET pending_message_id = NULL
         WHERE conversation_id = ? AND message_id IS NULL AND pending_message_id IS NOT NULL`,
      )
      .run(conversationId);
    const insert = this.database.prepare(
      `INSERT INTO conversation_pending_messages
         (id, conversation_id, delivery_mode, status, payload_json, sort_order,
          created_at, updated_at, consumed_at)
       VALUES (?, ?, ?, 'pending', ?, ?, ?, ?, NULL)`,
    );
    for (const [index, record] of pendingMessages.entries()) {
      insert.run(
        record.message.id,
        conversationId,
        record.message.deliveryMode,
        JSON.stringify({ ...record.input, deliveryMode: record.message.deliveryMode }),
        index,
        record.message.createdAt,
        record.message.createdAt,
      );
      const attachmentIds = record.message.attachmentIds;
      if (attachmentIds.length === 0) continue;
      const placeholders = attachmentIds.map(() => "?").join(", ");
      const result = this.database
        .prepare(
          `UPDATE conversation_attachments SET pending_message_id = ?
           WHERE conversation_id = ? AND message_id IS NULL
             AND pending_message_id IS NULL AND id IN (${placeholders})`,
        )
        .run(record.message.id, conversationId, ...attachmentIds);
      if (requireAttachmentBindings && result.changes !== attachmentIds.length) {
        throw new Error("ThreadLog pending message attachment binding is incomplete.");
      }
    }
  }

  private insertThreadLogModelMessage(input: {
    attachmentIds: readonly string[];
    content: string;
    conversationId: string;
    createdAt: string;
    eventId: string;
    providerState?: ModelProviderState;
    role: StoredModelMessage["role"];
    runId: string | null;
    toolCallId: string | null;
    toolCalls: ModelToolCall[];
  }): void {
    this.database
      .prepare(
        `INSERT OR IGNORE INTO model_messages
           (id, conversation_id, run_id, role, content, tool_calls_json,
            tool_call_id, attachment_ids_json, provider_state_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.eventId,
        input.conversationId,
        input.runId,
        input.role,
        input.content,
        JSON.stringify(input.toolCalls),
        input.toolCallId,
        JSON.stringify(input.attachmentIds),
        input.providerState === undefined ? null : JSON.stringify(input.providerState),
        input.createdAt,
      );
  }

  public exportThreadLogLegacySnapshot(conversationId: string): ThreadLogLegacySnapshot {
    return {
      agent: this.getConversationAgentBinding(conversationId),
      checkpoint: this.getContextCheckpoint(conversationId),
      conversation: this.getConversation(conversationId),
      modelMessages: this.listContextMessages(conversationId),
      runs: this.listThreadLogLegacyRuns(conversationId),
      timeline: this.listTimeline(conversationId),
    };
  }

  public restoreThreadLogLegacySnapshot(
    conversationId: string,
    snapshot: Omit<ThreadLogLegacySnapshot, "agent" | "conversation">,
  ): void {
    this.getConversation(conversationId);
    if (
      this.listContextMessages(conversationId).length > 0
      || this.listTimeline(conversationId).length > 0
    ) {
      return;
    }
    this.withTransaction(() => {
      for (const run of snapshot.runs) {
        this.database
          .prepare(
            `INSERT OR IGNORE INTO runs
               (id, conversation_id, model_id, status, error, created_at, updated_at,
                execution_snapshot_json)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            run.id,
            conversationId,
            run.modelId,
            run.status,
            run.error,
            run.createdAt,
            run.updatedAt,
            run.executionSnapshotJson,
          );
      }
      for (const message of snapshot.modelMessages) {
        this.insertModelMessage({
          attachmentIds: message.attachmentIds,
          content: message.content,
          conversationId,
          ...(message.providerState === undefined ? {} : { providerState: message.providerState }),
          role: message.role,
          runId: message.runId,
          toolCallId: message.toolCallId,
          toolCalls: message.toolCalls,
        });
      }
      for (const item of snapshot.timeline) this.insertTimelineItem(item);
      if (snapshot.checkpoint !== null) {
        const originalIndex = snapshot.modelMessages.findIndex(
          (message) => message.sequence === snapshot.checkpoint?.coveredThroughSequence,
        );
        const restoredMessage = this.listContextMessages(conversationId)[originalIndex];
        if (restoredMessage !== undefined) {
          this.saveContextCheckpoint(
            conversationId,
            restoredMessage.sequence,
            snapshot.checkpoint.summary,
          );
        }
      }
    });
  }

  private toStoredContextMessage(row: DatabaseRow): StoredContextMessage {
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
  }

  private listThreadLogLegacyRuns(conversationId: string): ThreadLogLegacyRun[] {
    const rows = this.database
      .prepare(
        `SELECT id, model_id, status, error, created_at, updated_at, execution_snapshot_json
         FROM runs WHERE conversation_id = ? ORDER BY created_at ASC, rowid ASC`,
      )
      .all(conversationId) as DatabaseRow[];
    return rows.map((row) => ({
      createdAt: asString(row, "created_at"),
      error: asNullableString(row, "error"),
      executionSnapshotJson: asNullableString(row, "execution_snapshot_json"),
      id: asString(row, "id"),
      modelId: asString(row, "model_id"),
      status: conversationRunStatusSchema.parse(asString(row, "status")),
      updatedAt: asString(row, "updated_at"),
    }));
  }

  private migrate(): void {
    new DatabaseMigrationRunner(this.database).run([
      {
        name: "agent-database-initial",
        up: () => this.migrateSchemaV1(),
        version: 1,
      },
      {
        name: "agent-run-execution-snapshot",
        up: (database) => {
          const columns = database
            .prepare("PRAGMA table_info(runs)")
            .all() as DatabaseRow[];
          if (!columns.some((column) => column.name === "execution_snapshot_json")) {
            database.exec(
              "ALTER TABLE runs ADD COLUMN execution_snapshot_json TEXT",
            );
          }
        },
        version: 2,
      },
      {
        name: "agent-context-message-search",
        up: (database) => {
          database.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS model_message_search USING fts5(
              conversation_id UNINDEXED,
              sequence UNINDEXED,
              search_text,
              tokenize = 'trigram'
            );

            CREATE TRIGGER IF NOT EXISTS model_messages_search_after_insert
            AFTER INSERT ON model_messages
            BEGIN
              INSERT INTO model_message_search(conversation_id, sequence, search_text)
              VALUES (new.conversation_id, new.sequence,
                new.content || char(10) || new.tool_calls_json);
            END;

            CREATE TRIGGER IF NOT EXISTS model_messages_search_after_delete
            AFTER DELETE ON model_messages
            BEGIN
              DELETE FROM model_message_search
              WHERE rowid IN (
                SELECT rowid FROM model_message_search
                WHERE conversation_id = old.conversation_id
                  AND sequence = old.sequence
              );
            END;

            CREATE TRIGGER IF NOT EXISTS model_messages_search_after_update
            AFTER UPDATE OF conversation_id, content, tool_calls_json ON model_messages
            BEGIN
              DELETE FROM model_message_search
              WHERE rowid IN (
                SELECT rowid FROM model_message_search
                WHERE conversation_id = old.conversation_id
                  AND sequence = old.sequence
              );
              INSERT INTO model_message_search(conversation_id, sequence, search_text)
              VALUES (new.conversation_id, new.sequence,
                new.content || char(10) || new.tool_calls_json);
            END;

            DELETE FROM model_message_search;
            INSERT INTO model_message_search(conversation_id, sequence, search_text)
            SELECT conversation_id, sequence, content || char(10) || tool_calls_json
            FROM model_messages;
          `);
        },
        version: 3,
      },
      {
        name: "agent-thread-log-event-index",
        up: (database) => {
          database.exec(`
            CREATE TABLE IF NOT EXISTS thread_log_event_index (
              event_id TEXT PRIMARY KEY,
              conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              sequence INTEGER NOT NULL,
              type TEXT NOT NULL,
              created_at TEXT NOT NULL,
              payload_json TEXT NOT NULL,
              UNIQUE(conversation_id, sequence)
            );

            CREATE INDEX IF NOT EXISTS thread_log_event_index_conversation_type
              ON thread_log_event_index(conversation_id, type, sequence);

            CREATE TABLE IF NOT EXISTS thread_log_projection_cursors (
              conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
              last_event_sequence INTEGER NOT NULL,
              last_event_id TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );
          `);
        },
        version: 4,
      },
      {
        name: "agent-team-relationships",
        up: (database) => {
          database.exec(`
            CREATE TABLE IF NOT EXISTS teams (
              id TEXT PRIMARY KEY,
              name TEXT NOT NULL,
              description TEXT NOT NULL,
              enabled INTEGER NOT NULL,
              lead_agent_id TEXT NOT NULL,
              instructions TEXT NOT NULL,
              max_workers INTEGER NOT NULL,
              project_scope TEXT NOT NULL,
              coordinator_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS team_members (
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              agent_id TEXT NOT NULL,
              member_index INTEGER NOT NULL,
              role TEXT NOT NULL,
              instructions TEXT NOT NULL,
              PRIMARY KEY (team_id, agent_id),
              UNIQUE(team_id, member_index)
            );

            CREATE INDEX IF NOT EXISTS team_members_agent
              ON team_members(agent_id, team_id);
          `);
        },
        version: 5,
      },
      {
        name: "agent-plugin-catalog",
        up: (database) => {
          database.exec(`
            CREATE TABLE IF NOT EXISTS plugin_catalog (
              id TEXT PRIMARY KEY,
              root_path TEXT NOT NULL UNIQUE,
              name TEXT NOT NULL,
              version TEXT NOT NULL,
              content_hash TEXT NOT NULL,
              manifest_json TEXT NOT NULL,
              enabled INTEGER NOT NULL DEFAULT 1,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS plugin_catalog_enabled
              ON plugin_catalog(enabled, name COLLATE NOCASE, id);
          `);
        },
        version: 6,
      },
      {
        name: "conversation-model-selection",
        up: (database) => {
          const columns = database
            .prepare("PRAGMA table_info(conversations)")
            .all() as DatabaseRow[];
          const columnNames = new Set(columns.map((column) => column.name));
          if (!columnNames.has("selected_provider_id")) {
            database.exec("ALTER TABLE conversations ADD COLUMN selected_provider_id TEXT");
          }
          if (!columnNames.has("selected_model_id")) {
            database.exec("ALTER TABLE conversations ADD COLUMN selected_model_id TEXT");
          }
          if (!columnNames.has("selected_reasoning_json")) {
            database.exec("ALTER TABLE conversations ADD COLUMN selected_reasoning_json TEXT");
          }
        },
        version: 7,
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
        selected_provider_id TEXT,
        selected_model_id TEXT,
        selected_reasoning_json TEXT,
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
           WHERE status = 'running'
              OR (
                status = 'queued'
                AND (
                  NOT EXISTS (
                    SELECT 1 FROM model_messages
                    WHERE model_messages.run_id = runs.id
                      AND model_messages.role = 'user'
                  )
                  OR id IN (
                    SELECT target_run_id FROM subagent_tasks WHERE target_run_id IS NOT NULL
                  )
                )
              )`
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
