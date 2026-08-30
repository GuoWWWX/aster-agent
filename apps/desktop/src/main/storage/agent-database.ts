import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { DatabaseMigrationRunner } from "./database-migration-runner.js";
import { z } from "zod";
import {
  agentAvatarIconSchema,
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
  createTeamInstanceInputSchema,
  listTeamInstancesInputSchema,
  renameTeamInstanceInputSchema,
  setTeamInstanceArchivedInputSchema,
  submitTeamWorkItemInputSchema,
  updateTeamWorkItemInputSchema,
  updateTeamWorkItemPermissionInputSchema,
  teamWorkItemEventSchema,
  teamWorkItemExecutionViewSchema,
  teamWorkItemViewSchema,
  setTeamCollaborationPlanInputSchema,
  teamCollaborationProjectionSchema,
  teamInstanceViewSchema,
  conversationAttachmentSchema,
  type AcceptTeamWorkItemInput,
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
  type CreateTeamInstanceInput,
  type ListTeamInstancesInput,
  type ProjectSummary,
  type RenameTeamInstanceInput,
  type RunAccepted,
  type SendConversationMessageInput,
  type SubmitTeamWorkItemInput,
  type UpdateTeamWorkItemInput,
  type UpdateTeamWorkItemPermissionInput,
  type TeamWorkItemEvent,
  type TeamWorkItemExecutionView,
  type TeamWorkItemStatus,
  type TeamWorkItemView,
  type TeamInstanceView,
  type SetTeamCollaborationPlanInput,
  type TeamCollaborationProjection,
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

/** A durable Team Lead conversation, reused for one project or explicit source-conversation scope. */
export type TeamExecutionConversationRecord = {
  conversationId: string;
  projectId: string;
  sourceConversationId: string | null;
  teamId: string;
  teamInstanceId: string;
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
  replyInstruction?: string | null;
  runId: string;
  senderConversationId: string;
  taskId?: string | null;
  targetConversationId: string;
};

export function agentMessageModelContent(message: ConversationAgentMessageItem): string {
  if (message.messageType === "task_result") {
    return [
      "[Subagent task result]",
      `Subagent conversation: ${message.senderTitle}`,
      `Subagent conversationId: ${message.senderConversationId}`,
      ...(message.taskId === null ? [] : [`Task ID: ${message.taskId}`]),
      "This is the completion summary from a one-shot Subagent. The full process remains in its separate conversation; use read_agent_conversation within budget for details, and do not ask the completed Subagent to continue.",
      "Result summary:",
      message.content
    ].join("\n");
  }
  if (message.messageType === "agent_result") {
    return [
      "[Agent result]",
      `Executor conversation: ${message.senderTitle}`,
      `Executor conversationId: ${message.senderConversationId}`,
      ...(message.taskId === null ? [] : [`Original collaboration message ID: ${message.taskId}`]),
      "This is a bounded completion receipt, not the executor's full answer. Full details remain only in the executor conversation; use read_agent_conversation with a chosen maxTokens budget when needed. Do not reply again unless follow-up work is required.",
      "Completion receipt:",
      message.content,
    ].join("\n");
  }
  if (message.messageType === "notification") {
    return [
      "[Agent collaboration notification]",
      `Sender conversation: ${message.senderTitle}`,
      `Sender conversationId: ${message.senderConversationId}`,
      "This progress or notification message does not request an automatic result. Continue the current work as appropriate.",
      "Message:",
      message.content,
    ].join("\n");
  }
  return [
    "[Agent collaboration request]",
    `Sender conversation: ${message.senderTitle}`,
    `Sender conversationId: ${message.senderConversationId}`,
    "Complete the requested work in this persistent conversation. Start the final answer with the concise completion receipt requested below, add a standalone Markdown --- line, then keep full details after the divider in this conversation. The runtime can return only a bounded completion receipt before the divider. Call send_agent_message only for progress, clarification, or another proactive message.",
    `Completion receipt request: ${message.replyInstruction ?? "Summarize the conclusion, key evidence, and unresolved risks concisely."}`,
    "Message:",
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
        reasoningContent?: string;
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
        reasoningContent?: string;
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

function collaborationRunStatus(
  conversation: ConversationSummary | undefined,
  workItemStatus: TeamWorkItemStatus,
): TeamCollaborationProjection["nodes"][number]["runStatus"] {
  if (conversation?.activeRunId !== null && conversation?.activeRunId !== undefined) {
    return "running";
  }
  if (conversation?.lastRunStatus === "queued" || conversation?.lastRunStatus === "running") {
    return conversation.lastRunStatus;
  }
  if (conversation?.lastRunStatus === "failed") return "failed";
  if (conversation?.lastRunStatus === "completed") return "completed";
  if (conversation?.lastRunStatus === "cancelled" || workItemStatus === "blocked") return "blocked";
  return "idle";
}

function collaborationEdgeView(input: {
  activity: readonly ConversationAgentMessageItem[];
  fromNodeId: string;
  id: string;
  purposes: string[];
  state: TeamCollaborationProjection["edges"][number]["state"];
  toNodeId: string;
}): TeamCollaborationProjection["edges"][number] {
  const firstActivityAt = input.activity[0]?.createdAt ?? null;
  const lastActivityAt = input.activity.at(-1)?.createdAt ?? null;
  return {
    firstActivityAt,
    fromNodeId: input.fromNodeId,
    id: input.id,
    lastActivityAt,
    messageCount: input.activity.length,
    messageTypes: {
      agent_result: input.activity.filter((message) => message.messageType === "agent_result").length,
      message: input.activity.filter((message) => message.messageType === "message").length,
      notification: input.activity.filter((message) => message.messageType === "notification").length,
      task_result: input.activity.filter((message) => message.messageType === "task_result").length,
    },
    purposes: input.purposes,
    state: input.state,
    toNodeId: input.toNodeId,
    unreadCount: input.activity.filter((message) => message.status === "unread").length,
  };
}

function isTerminalTeamWorkItemStatus(status: TeamWorkItemStatus): boolean {
  return status === "completed"
    || status === "failed"
    || status === "cancelled";
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

function teamExecutionScopeKey(projectId: string, sourceConversationId: string | null): string {
  return sourceConversationId === null
    ? `project:${projectId}`
    : `conversation:${sourceConversationId}`;
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
  reasoningContent?: string;
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
  const reasoningContent = readProjectionString(payload, "reasoningContent");
  return {
    content,
    kind,
    messageId,
    modelId,
    ...(providerState === undefined ? {} : { providerState }),
    ...(reasoningContent === null ? {} : { reasoningContent }),
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

const teamWorkItemExecutionTreeCte = `WITH RECURSIVE team_execution_tree(work_item_id, conversation_id) AS (
  SELECT id, execution_conversation_id
  FROM team_work_items
  WHERE execution_conversation_id IS NOT NULL
  UNION
  SELECT team_execution_tree.work_item_id, team_member_conversations.conversation_id
  FROM team_execution_tree
  JOIN team_member_conversations
    ON team_member_conversations.team_execution_conversation_id = team_execution_tree.conversation_id
  UNION
  SELECT team_execution_tree.work_item_id, subagent_tasks.child_conversation_id
  FROM team_execution_tree
  JOIN subagent_tasks
    ON subagent_tasks.parent_conversation_id = team_execution_tree.conversation_id
), team_execution_tree_projection AS (
  SELECT team_execution_tree.conversation_id,
    (
      SELECT candidate.work_item_id
      FROM team_execution_tree AS candidate
      JOIN team_work_items AS candidate_work_item
        ON candidate_work_item.id = candidate.work_item_id
      WHERE candidate.conversation_id = team_execution_tree.conversation_id
      ORDER BY CASE candidate_work_item.status
        WHEN 'running' THEN 0
        WHEN 'reviewing' THEN 1
        WHEN 'waiting_user' THEN 2
        WHEN 'planned' THEN 3
        WHEN 'queued' THEN 4
        ELSE 5
      END,
      candidate_work_item.updated_at DESC,
      candidate_work_item.rowid DESC
      LIMIT 1
    ) AS work_item_id
  FROM team_execution_tree
  GROUP BY team_execution_tree.conversation_id
)`;

function toConversation(row: DatabaseRow): ConversationSummary {
  const selectedProviderId = asNullableString(row, "selected_provider_id");
  const selectedModelId = asNullableString(row, "selected_model_id");
  const selectedReasoningJson = asNullableString(row, "selected_reasoning_json");
  return conversationSummarySchema.parse({
    activeSubagentCount: asNumber(row, "active_subagent_count"),
    activeRunId: asNullableString(row, "active_run_id"),
    agentId: asNullableString(row, "agent_id"),
    archivedAt: asNullableString(row, "archived_at"),
    avatarIcon: asNullableString(row, "avatar_icon"),
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
    teamWorkItemId: asNullableString(row, "team_work_item_id"),
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
  const showTeamsInNavigator = asBoolean(row, "show_teams_in_navigator");
  return projectSummarySchema.parse({
    id: asString(row, "id"),
    isPinned: asBoolean(row, "is_pinned"),
    name: asString(row, "name"),
    rootPath: asString(row, "root_path"),
    ...(showTeamsInNavigator ? { showTeamsInNavigator: true } : {})
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
        "SELECT id, name, root_path, is_pinned, show_teams_in_navigator FROM projects ORDER BY is_pinned DESC, sort_order ASC, created_at ASC"
      )
      .all() as DatabaseRow[];
    return rows.map(toProject);
  }

  public saveProject(project: ProjectSummary): void {
    const validated = projectSummarySchema.parse(project);
    this.database
      .prepare(
        `INSERT INTO projects (
           id, name, root_path, is_pinned, show_teams_in_navigator, sort_order, created_at
         )
         SELECT ?, ?, ?, ?, ?, COALESCE(MAX(sort_order), -1) + 1, ? FROM projects WHERE true
         ON CONFLICT(root_path) DO UPDATE SET
           name = excluded.name,
           is_pinned = excluded.is_pinned,
           show_teams_in_navigator = excluded.show_teams_in_navigator`
      )
      .run(
        validated.id,
        validated.name,
        validated.rootPath,
        Number(validated.isPinned ?? false),
        Number(validated.showTeamsInNavigator ?? false),
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
        `${teamWorkItemExecutionTreeCte}
         SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            selected_provider_id, selected_model_id, selected_reasoning_json,
            thread_kind, agent_id, avatar_icon, team_id, title, created_at, conversations.updated_at,
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
           ,team_execution_tree_projection.work_item_id AS team_work_item_id
          FROM conversations
          LEFT JOIN team_execution_tree_projection
            ON team_execution_tree_projection.conversation_id = conversations.id
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

  /**
   * Background projection must not revive a Conversation already owned by a
   * persisted deletion task. Keep listAllConversationIds() inclusive for
   * deletion/recovery workflows and use this narrower query at that boundary.
   */
  public listProjectableConversationIds(): string[] {
    const rows = this.database
      .prepare(
        "SELECT id FROM conversations WHERE deletion_pending = 0 ORDER BY created_at ASC, rowid ASC",
      )
      .all() as DatabaseRow[];
    return rows.map((row) => asString(row, "id"));
  }

  public getConversation(conversationId: string): ConversationSummary {
    const row = this.database
      .prepare(
        `${teamWorkItemExecutionTreeCte}
         SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            selected_provider_id, selected_model_id, selected_reasoning_json,
            thread_kind, agent_id, avatar_icon, team_id, title, created_at, conversations.updated_at,
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
           ,team_execution_tree_projection.work_item_id AS team_work_item_id
         FROM conversations
         LEFT JOIN team_execution_tree_projection
           ON team_execution_tree_projection.conversation_id = conversations.id
         WHERE conversations.id = ? AND deletion_pending = 0`
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
      const removedTeamIds = (this.database
        .prepare("SELECT id FROM teams")
        .all() as DatabaseRow[])
        .map((row) => asString(row, "id"))
        .filter((teamId) => !retainedIds.has(teamId));
      for (const teamId of removedTeamIds) {
        const workItem = this.database
          .prepare("SELECT id FROM team_work_items WHERE team_id = ? LIMIT 1")
          .get(teamId);
        if (workItem !== undefined) {
          throw new Error("Cannot remove a Team that still has WorkItems; resolve or archive them first.");
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

  public listTeamInstances(rawInput: Partial<ListTeamInstancesInput> = {}): TeamInstanceView[] {
    const input = listTeamInstancesInputSchema.parse(rawInput);
    const clauses = ["deleted_at IS NULL"];
    const values: string[] = [];
    if (!input.includeArchived) clauses.push("archived_at IS NULL");
    if (input.projectId !== undefined) {
      clauses.push("project_id = ?");
      values.push(input.projectId);
    }
    if (input.sourceConversationId !== undefined) {
      clauses.push("source_conversation_id = ?");
      values.push(input.sourceConversationId);
    }
    const rows = this.database.prepare(
      `SELECT * FROM team_instances
       WHERE ${clauses.join(" AND ")}
       ORDER BY CASE WHEN scope IN ('global', 'project') THEN sort_order ELSE 0 END ASC,
                created_at ASC, rowid ASC`,
    ).all(...values) as DatabaseRow[];
    return rows.map((row) => this.toTeamInstance(row));
  }

  public getTeamInstance(teamInstanceId: string): TeamInstanceView {
    const row = this.database.prepare(
      "SELECT * FROM team_instances WHERE id = ? AND deleted_at IS NULL",
    ).get(teamInstanceId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Team instance was not found.");
    return this.toTeamInstance(row);
  }

  public createTeamInstance(rawInput: CreateTeamInstanceInput): TeamInstanceView {
    const input = createTeamInstanceInputSchema.parse(rawInput);
    const team = this.database.prepare("SELECT name FROM teams WHERE id = ?").get(input.teamId) as DatabaseRow | undefined;
    if (team === undefined) throw new Error("The selected Team template is not available.");
    if (input.projectId !== undefined) {
      const project = this.database.prepare("SELECT id FROM projects WHERE id = ?").get(input.projectId);
      if (project === undefined) throw new Error("Team instance project was not found.");
    }
    if (input.sourceConversationId !== undefined) {
      const source = this.getConversation(input.sourceConversationId);
      if (source.projectId !== input.projectId) {
        throw new Error("The Team instance source must belong to its project.");
      }
    }
    const id = randomUUID();
    const now = new Date().toISOString();
    const sortOrder = input.scope === "conversation"
      ? 0
      : Number((this.database.prepare(
        `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_sort_order
         FROM team_instances
         WHERE scope IN ('global', 'project') AND deleted_at IS NULL`,
      ).get() as DatabaseRow).next_sort_order);
    const name = this.allocateTeamInstanceName({
      baseName: input.name ?? asString(team, "name"),
      projectId: input.projectId ?? null,
      scope: input.scope,
      sourceConversationId: input.sourceConversationId ?? null,
    });
    this.database.prepare(
      `INSERT INTO team_instances (
        id, team_id, scope, project_id, source_conversation_id, name,
        root_conversation_id, sort_order, archived_at, deleted_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, NULL, NULL, ?, ?)`,
    ).run(
      id,
      input.teamId,
      input.scope,
      input.projectId ?? null,
      input.sourceConversationId ?? null,
      name,
      sortOrder,
      now,
      now,
    );
    return this.getTeamInstance(id);
  }

  public setTeamInstanceRoot(teamInstanceId: string, conversationId: string): TeamInstanceView {
    const instance = this.getTeamInstance(teamInstanceId);
    const conversation = this.getConversation(conversationId);
    if (
      conversation.teamId !== instance.teamId
      || conversation.threadKind !== "team_lead"
      || conversation.projectId !== instance.projectId
      || conversation.parentConversationId !== instance.sourceConversationId
    ) {
      throw new Error("Team instance root does not match its owner and Team template.");
    }
    const now = new Date().toISOString();
    const result = this.database.prepare(
      `UPDATE team_instances SET root_conversation_id = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(conversationId, now, teamInstanceId);
    if (result.changes !== 1) throw new Error("Team instance root could not be saved.");
    return this.getTeamInstance(teamInstanceId);
  }

  public renameTeamInstance(rawInput: RenameTeamInstanceInput): TeamInstanceView {
    const input = renameTeamInstanceInputSchema.parse(rawInput);
    const current = this.getTeamInstance(input.teamInstanceId);
    if (input.projectId !== undefined && current.scope === "conversation") {
      throw new Error("A conversation Team retains its source conversation project.");
    }
    const projectId = input.projectId === undefined ? current.projectId : input.projectId;
    if (projectId !== null) this.assertProjectExists(projectId);
    const scope = current.scope === "conversation"
      ? current.scope
      : projectId === null ? "global" : "project";
    const associationChanged = projectId !== current.projectId || scope !== current.scope;
    if (associationChanged && this.hasActiveTeamInstanceWork(current.id)) {
      throw new Error("A Team instance with active work cannot change its project.");
    }
    const name = this.allocateTeamInstanceName({
      baseName: input.name,
      excludeTeamInstanceId: current.id,
      projectId,
      scope,
      sourceConversationId: current.sourceConversationId,
    });
    const now = new Date().toISOString();
    this.withTransaction(() => {
      if (associationChanged && current.rootConversationId !== null) {
        const participantIds = [
          current.rootConversationId,
          ...this.listTeamMemberConversations(current.rootConversationId)
            .map((conversation) => conversation.id),
        ];
        for (const conversationId of participantIds) {
          this.setConversationProject(conversationId, projectId);
        }
        this.database.prepare(
          "DELETE FROM team_execution_conversations WHERE team_instance_id = ?",
        ).run(current.id);
        if (scope === "project") {
          this.database.prepare(
            `INSERT INTO team_execution_conversations (
              team_instance_id, team_id, project_id, source_conversation_id,
              scope_key, conversation_id, created_at, updated_at
            ) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
          ).run(
            current.id,
            current.teamId,
            projectId,
            teamExecutionScopeKey(projectId!, null),
            current.rootConversationId,
            now,
            now,
          );
          this.database.prepare(
            `UPDATE teams SET coordinator_conversation_id = NULL, updated_at = ?
             WHERE id = ? AND coordinator_conversation_id = ?`,
          ).run(now, current.teamId, current.rootConversationId);
        }
      }
      this.database.prepare(
        `UPDATE team_instances
         SET name = ?, scope = ?, project_id = ?, updated_at = ?
         WHERE id = ? AND deleted_at IS NULL`,
      ).run(name, scope, projectId, now, current.id);
    });
    return this.getTeamInstance(current.id);
  }

  public reorderTeamInstances(teamInstanceIds: readonly string[]): TeamInstanceView[] {
    if (new Set(teamInstanceIds).size !== teamInstanceIds.length) {
      throw new Error("Team instance order contains duplicate identifiers.");
    }
    const rows = this.database.prepare(
      `SELECT id FROM team_instances
       WHERE scope IN ('global', 'project')
         AND archived_at IS NULL
         AND deleted_at IS NULL`,
    ).all() as DatabaseRow[];
    const existingIds = new Set(rows.map((row) => asString(row, "id")));
    if (
      teamInstanceIds.length !== existingIds.size
      || teamInstanceIds.some((teamInstanceId) => !existingIds.has(teamInstanceId))
    ) {
      throw new Error("Team instance reorder must include every visible Team.");
    }
    this.withTransaction(() => {
      const update = this.database.prepare(
        "UPDATE team_instances SET sort_order = ?, updated_at = ? WHERE id = ?",
      );
      const now = new Date().toISOString();
      teamInstanceIds.forEach((teamInstanceId, index) => update.run(index, now, teamInstanceId));
    });
    return this.listTeamInstances({ includeArchived: false });
  }

  public setTeamInstanceArchived(
    rawInput: { archived: boolean; teamInstanceId: string },
  ): TeamInstanceView {
    const input = setTeamInstanceArchivedInputSchema.parse(rawInput);
    const current = this.getTeamInstance(input.teamInstanceId);
    if (input.archived && this.hasActiveTeamInstanceWork(current.id)) {
      throw new Error("A Team instance with active work cannot be archived.");
    }
    const now = new Date().toISOString();
    this.database.prepare(
      `UPDATE team_instances SET archived_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(input.archived ? now : null, now, current.id);
    return this.getTeamInstance(current.id);
  }

  public deleteTeamInstance(teamInstanceId: string): void {
    const current = this.getTeamInstance(teamInstanceId);
    if (this.hasActiveTeamInstanceWork(current.id)) {
      throw new Error("A Team instance with active work cannot be deleted.");
    }
    const now = new Date().toISOString();
    this.database.prepare(
      `UPDATE team_instances SET archived_at = COALESCE(archived_at, ?), deleted_at = ?, updated_at = ?
       WHERE id = ? AND deleted_at IS NULL`,
    ).run(now, now, now, current.id);
  }

  private hasActiveTeamInstanceWork(teamInstanceId: string): boolean {
    return this.database.prepare(
      `SELECT 1 FROM team_work_items
       WHERE team_instance_id = ? AND status IN ('queued', 'planned', 'running', 'reviewing')
       LIMIT 1`,
    ).get(teamInstanceId) !== undefined;
  }

  private allocateTeamInstanceName(input: {
    baseName: string;
    excludeTeamInstanceId?: string;
    projectId: string | null;
    scope: TeamInstanceView["scope"];
    sourceConversationId: string | null;
  }): string {
    const baseName = input.baseName.trim().slice(0, 120);
    if (baseName.length === 0) throw new Error("Team instance name cannot be empty.");
    const rows = this.database.prepare(
      `SELECT id, name FROM team_instances
       WHERE deleted_at IS NULL AND archived_at IS NULL
         AND (
           scope = 'global'
           OR (? IS NOT NULL AND scope = 'project' AND project_id = ?)
           OR (? IS NOT NULL AND scope = 'conversation' AND source_conversation_id = ?)
         )`,
    ).all(
      input.projectId,
      input.projectId,
      input.sourceConversationId,
      input.sourceConversationId,
    ) as DatabaseRow[];
    const names = new Set(rows.flatMap((row) =>
      asString(row, "id") === input.excludeTeamInstanceId
        ? []
        : [asString(row, "name").toLocaleLowerCase()]
    ));
    if (!names.has(baseName.toLocaleLowerCase())) return baseName;
    for (let suffix = 1; suffix < 10_000; suffix += 1) {
      const marker = ` (${suffix})`;
      const candidate = `${baseName.slice(0, Math.max(1, 120 - marker.length))}${marker}`;
      if (!names.has(candidate.toLocaleLowerCase())) return candidate;
    }
    throw new Error("A unique Team instance name could not be allocated.");
  }

  /**
   * Resolves the durable Team Lead conversation for one source Conversation.
   * WorkItems remain independent records, but repeated requests from this
   * source enter the same Team Lead and member audit trail.
   */
  public getTeamExecutionConversation(input: {
    projectId: string;
    sourceConversationId: string | null;
    teamId: string;
    teamInstanceId?: string;
  }): ConversationSummary | null {
    const scopeKey = teamExecutionScopeKey(input.projectId, input.sourceConversationId);
    const row = input.teamInstanceId === undefined
      ? this.database.prepare(
        `SELECT conversation_id FROM team_execution_conversations
         WHERE team_id = ? AND scope_key = ? ORDER BY created_at ASC LIMIT 1`,
      ).get(input.teamId, scopeKey) as DatabaseRow | undefined
      : this.database.prepare(
        `SELECT conversation_id FROM team_execution_conversations
         WHERE team_instance_id = ? AND scope_key = ?`,
      ).get(input.teamInstanceId, scopeKey) as DatabaseRow | undefined;
    return row === undefined ? null : this.getConversation(asString(row, "conversation_id"));
  }

  public bindTeamExecutionConversation(input: {
    conversationId: string;
    projectId: string;
    sourceConversationId: string | null;
    teamId: string;
    teamInstanceId?: string;
  }): ConversationSummary {
    const source = input.sourceConversationId === null
      ? null
      : this.getConversation(input.sourceConversationId);
    if (source !== null && source.projectId !== input.projectId) {
      throw new Error("The Team execution source must belong to the selected project.");
    }
    const conversation = this.getConversation(input.conversationId);
    if (
      conversation.projectId !== input.projectId
      || conversation.teamId !== input.teamId
      || conversation.threadKind !== "team_lead"
      || conversation.parentConversationId !== input.sourceConversationId
    ) {
      throw new Error("Team execution conversation does not match its Team and source.");
    }
    const scopeKey = teamExecutionScopeKey(input.projectId, input.sourceConversationId);
    const teamInstanceId = input.teamInstanceId ?? this.resolveLegacyTeamInstanceId({
      projectId: input.projectId,
      sourceConversationId: input.sourceConversationId,
      teamId: input.teamId,
    });
    const instance = this.getTeamInstance(teamInstanceId);
    if (instance.teamId !== input.teamId || instance.isArchived) {
      throw new Error("Team execution instance is unavailable or uses another Team template.");
    }
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO team_execution_conversations (
        team_instance_id, team_id, project_id, source_conversation_id,
        scope_key, conversation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(team_instance_id, scope_key) DO NOTHING`,
    ).run(
      teamInstanceId,
      input.teamId,
      input.projectId,
      input.sourceConversationId,
      scopeKey,
      input.conversationId,
      now,
      now,
    );
    const bound = this.getTeamExecutionConversation({ ...input, teamInstanceId });
    if (bound === null) throw new Error("Team execution conversation could not be persisted.");
    return bound;
  }

  private resolveLegacyTeamInstanceId(input: {
    projectId: string;
    sourceConversationId: string | null;
    teamId: string;
  }): string {
    const row = this.database.prepare(
      `SELECT id FROM team_instances
       WHERE team_id = ? AND project_id = ? AND deleted_at IS NULL
         AND scope = ?
         AND ((? IS NULL AND source_conversation_id IS NULL) OR source_conversation_id = ?)
       ORDER BY created_at ASC LIMIT 1`,
    ).get(
      input.teamId,
      input.projectId,
      input.sourceConversationId === null ? "project" : "conversation",
      input.sourceConversationId,
      input.sourceConversationId,
    ) as DatabaseRow | undefined;
    if (row !== undefined) return asString(row, "id");
    return this.createTeamInstance({
      projectId: input.projectId,
      scope: input.sourceConversationId === null ? "project" : "conversation",
      ...(input.sourceConversationId === null
        ? {}
        : { sourceConversationId: input.sourceConversationId }),
      teamId: input.teamId,
    }).id;
  }

  public listTeamMemberConversations(teamExecutionConversationId: string): ConversationSummary[] {
    this.getConversation(teamExecutionConversationId);
    const rows = this.database.prepare(
      `SELECT conversation_id FROM team_member_conversations
       WHERE team_execution_conversation_id = ?
       ORDER BY created_at ASC, rowid ASC`,
    ).all(teamExecutionConversationId) as DatabaseRow[];
    return rows.map((row) => this.getConversation(asString(row, "conversation_id")));
  }

  public bindTeamMemberConversation(input: {
    agentId: string;
    conversationId: string;
    teamExecutionConversationId: string;
  }): ConversationSummary {
    const lead = this.getConversation(input.teamExecutionConversationId);
    const member = this.getConversation(input.conversationId);
    if (
      lead.threadKind !== "team_lead"
      || lead.teamId === null
      || member.threadKind !== "agent"
      || member.teamId !== lead.teamId
      || member.parentConversationId !== lead.id
      || member.agentId !== input.agentId
    ) {
      throw new Error("Team member conversation does not match its Team Lead.");
    }
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO team_member_conversations (
        team_execution_conversation_id, team_id, agent_id, conversation_id, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(team_execution_conversation_id, agent_id) DO NOTHING`,
    ).run(lead.id, lead.teamId, input.agentId, member.id, now, now);
    const row = this.database.prepare(
      `SELECT conversation_id FROM team_member_conversations
       WHERE team_execution_conversation_id = ? AND agent_id = ?`,
    ).get(lead.id, input.agentId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Team member conversation could not be persisted.");
    return this.getConversation(asString(row, "conversation_id"));
  }

  public getTeamExecutionConversationIdForParticipant(conversationId: string): string | null {
    const asLead = this.database.prepare(
      "SELECT conversation_id FROM team_execution_conversations WHERE conversation_id = ?",
    ).get(conversationId) as DatabaseRow | undefined;
    if (asLead !== undefined) return asString(asLead, "conversation_id");
    const asInstanceRoot = this.database.prepare(
      `SELECT root_conversation_id FROM team_instances
       WHERE root_conversation_id = ? AND deleted_at IS NULL`,
    ).get(conversationId) as DatabaseRow | undefined;
    if (asInstanceRoot !== undefined) return asString(asInstanceRoot, "root_conversation_id");
    const asMember = this.database.prepare(
      `SELECT team_execution_conversation_id FROM team_member_conversations
       WHERE conversation_id = ?`,
    ).get(conversationId) as DatabaseRow | undefined;
    return asMember === undefined
      ? null
      : asString(asMember, "team_execution_conversation_id");
  }

  public isTeamMemberConversation(conversationId: string): boolean {
    return this.database.prepare(
      "SELECT 1 FROM team_member_conversations WHERE conversation_id = ? LIMIT 1",
    ).get(conversationId) !== undefined;
  }

  public areTeamExecutionParticipants(
    firstConversationId: string,
    secondConversationId: string,
  ): boolean {
    const first = this.getTeamExecutionConversationIdForParticipant(firstConversationId);
    const second = this.getTeamExecutionConversationIdForParticipant(secondConversationId);
    return first !== null && first === second;
  }

  public recordTeamMemberAssignment(input: {
    message: ConversationAgentMessageItem;
    workItemId: string;
  }): void {
    const workItem = this.getTeamWorkItem(input.workItemId);
    if (workItem.status !== "running" || workItem.executionConversationId === null) return;
    const senderLeadId = this.getTeamExecutionConversationIdForParticipant(
      input.message.senderConversationId,
    );
    const targetLeadId = this.getTeamExecutionConversationIdForParticipant(input.message.conversationId);
    if (
      senderLeadId === null
      || senderLeadId !== workItem.executionConversationId
      || targetLeadId !== senderLeadId
      || !this.isTeamMemberConversation(input.message.conversationId)
    ) return;
    const now = new Date().toISOString();
    this.database.prepare(
      `INSERT INTO team_work_item_member_assignments (
        id, work_item_id, member_conversation_id, message_id, title, created_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(message_id) DO NOTHING`,
    ).run(
      randomUUID(),
      input.workItemId,
      input.message.conversationId,
      input.message.id,
      input.message.content.replaceAll(/\s+/gu, " ").slice(0, 300) || "团队成员任务",
      now,
    );
  }

  public createTeamWorkItem(
    rawInput: SubmitTeamWorkItemInput,
    modelSelection: ConversationModelSelection,
  ): TeamWorkItemView {
    const input = submitTeamWorkItemInputSchema.parse(rawInput);
    this.getTeamCoordinatorConversationId(input.teamId);
    const project = this.database.prepare("SELECT id FROM projects WHERE id = ?").get(input.projectId);
    if (project === undefined) throw new Error("Team WorkItem project was not found.");
    const sourceConversation = input.sourceConversationId === undefined
      ? null
      : this.getConversation(input.sourceConversationId);
    if (sourceConversation !== null) {
      if (sourceConversation.projectId !== input.projectId) {
        throw new Error("The source conversation must belong to the Team WorkItem project.");
      }
      if (sourceConversation.threadKind !== "agent" || sourceConversation.teamWorkItemId !== null) {
        throw new Error("Only a normal project conversation can submit a Team WorkItem.");
      }
    }
    const instance = this.resolveTeamInstanceForWorkItem(input);
    const id = randomUUID();
    const now = new Date().toISOString();
    this.withTransaction(() => {
      this.database.prepare(
        `INSERT INTO team_work_items (
          id, team_id, team_instance_id, project_id, title, requirement, acceptance_criteria_json,
          priority, status, revision, permission_mode, model_selection_json,
          execution_conversation_id, active_run_id, result_summary, blocked_reason,
          source_conversation_id, execution_scope, created_at, updated_at, completed_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'queued', 1, ?, ?, NULL, NULL, NULL, NULL, ?, ?, ?, ?, NULL)`,
      ).run(
        id,
        input.teamId,
        instance.id,
        input.projectId,
        input.title,
        input.requirement,
        JSON.stringify(input.acceptanceCriteria),
        input.priority,
        input.permissionMode,
        JSON.stringify(modelSelection),
        sourceConversation?.id ?? null,
        input.executionScope,
        now,
        now,
      );
      this.appendTeamWorkItemEvent(input.teamId, id, "received", "需求已进入团队收件箱。", now);
      this.appendTeamWorkItemEvent(input.teamId, id, "scheduled", "需求已进入调度队列。", now);
    });
    return this.getTeamWorkItem(id);
  }

  private resolveTeamInstanceForWorkItem(
    input: ReturnType<typeof submitTeamWorkItemInputSchema.parse>,
  ): TeamInstanceView {
    if (input.teamInstanceId !== undefined) {
      const instance = this.getTeamInstance(input.teamInstanceId);
      if (instance.teamId !== input.teamId || instance.isArchived) {
        throw new Error("The selected Team instance is unavailable or uses another Team template.");
      }
      if (instance.scope === "project" && instance.projectId !== input.projectId) {
        throw new Error("The selected Team instance belongs to another project.");
      }
      if (
        instance.scope === "conversation"
        && (
          input.executionScope !== "conversation"
          || instance.sourceConversationId !== (input.sourceConversationId ?? null)
        )
      ) {
        throw new Error("The selected conversation Team instance belongs to another conversation.");
      }
      if (instance.scope !== "conversation" && input.executionScope === "conversation") {
        throw new Error("Conversation isolation requires a conversation Team instance.");
      }
      return instance;
    }

    const scope = input.executionScope === "conversation" ? "conversation" : "project";
    const sourceConversationId = scope === "conversation"
      ? input.sourceConversationId ?? null
      : null;
    const existing = this.listTeamInstances({ includeArchived: false })
      .find((instance) =>
        instance.teamId === input.teamId
        && instance.scope === scope
        && instance.projectId === input.projectId
        && instance.sourceConversationId === sourceConversationId
      );
    if (existing !== undefined) return existing;
    return this.createTeamInstance({
      ...(input.instanceName === undefined ? {} : { name: input.instanceName }),
      projectId: input.projectId,
      scope,
      ...(sourceConversationId === null ? {} : { sourceConversationId }),
      teamId: input.teamId,
    });
  }

  public updateTeamWorkItem(rawInput: UpdateTeamWorkItemInput): TeamWorkItemView {
    const input = updateTeamWorkItemInputSchema.parse(rawInput);
    const current = this.getTeamWorkItem(input.workItemId);
    if (current.status !== "queued") {
      throw new Error("Only a queued Team WorkItem can be edited before Team Lead starts it.");
    }
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET title = ?, requirement = ?, updated_at = ?
         WHERE id = ? AND status = 'queued'`,
      ).run(input.title, input.requirement, now, input.workItemId);
      if (result.changes !== 1) {
        throw new Error("Team WorkItem was claimed before the edit could be saved.");
      }
      this.appendTeamWorkItemEvent(
        current.teamId,
        input.workItemId,
        "updated",
        "用户在 Team Lead 领取前更新了需求。",
        now,
      );
    });
    return this.getTeamWorkItem(input.workItemId);
  }

  /**
   * Changes the policy future Team Runs inherit without retroactively changing
   * an in-flight Run or approving an already displayed tool request.
   */
  public updateTeamWorkItemPermission(
    rawInput: UpdateTeamWorkItemPermissionInput,
  ): TeamWorkItemView {
    const input = updateTeamWorkItemPermissionInputSchema.parse(rawInput);
    const current = this.getTeamWorkItem(input.workItemId);
    if (current.status === "completed" || current.status === "cancelled" || current.status === "failed") {
      throw new Error("A completed Team WorkItem cannot change its execution permission.");
    }
    if (current.permissionMode === input.permissionMode) return current;
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET permission_mode = ?, updated_at = ?
         WHERE id = ?`,
      ).run(input.permissionMode, now, input.workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem permission could not be saved.");
      this.appendTeamWorkItemEvent(
        current.teamId,
        input.workItemId,
        "updated",
        "用户更新了团队执行权限；当前 Run 保持原策略，后续执行将使用新策略。",
        now,
      );
    });
    return this.getTeamWorkItem(input.workItemId);
  }

  /**
   * Keeps a managed member Conversation visually and behaviorally aligned with
   * an ordinary Conversation without letting a renderer rewrite an active Run.
   */
  public updateTeamWorkItemModelSelection(
    workItemId: string,
    conversationId: string,
    rawSelection: ConversationModelSelection,
  ): ConversationSummary {
    const selection = conversationModelSelectionSchema.parse(rawSelection);
    const workItem = this.getTeamWorkItem(workItemId);
    if (workItem.status === "completed" || workItem.status === "cancelled" || workItem.status === "failed") {
      throw new Error("A completed Team WorkItem cannot change its execution model.");
    }
    const conversation = this.getConversation(conversationId);
    if (!this.isConversationInTeamWorkItemExecution(conversation.id, workItemId)) {
      throw new Error("The Conversation is not owned by the requested Team WorkItem.");
    }
    const workItemSelectionMatches = workItem.modelSelection.providerId === selection.providerId
      && workItem.modelSelection.modelId === selection.modelId
      && JSON.stringify(workItem.modelSelection.reasoning) === JSON.stringify(selection.reasoning);
    const conversationSelectionMatches = conversation.modelSelection?.providerId === selection.providerId
      && conversation.modelSelection.modelId === selection.modelId
      && JSON.stringify(conversation.modelSelection.reasoning) === JSON.stringify(selection.reasoning);
    if (workItemSelectionMatches && conversationSelectionMatches) return conversation;

    const now = new Date().toISOString();
    this.withTransaction(() => {
      const workItemUpdate = this.database.prepare(
        `UPDATE team_work_items
         SET model_selection_json = ?, updated_at = ?
         WHERE id = ?`,
      ).run(JSON.stringify(selection), now, workItemId);
      if (workItemUpdate.changes !== 1) throw new Error("Team WorkItem model could not be saved.");
      const conversationUpdate = this.database.prepare(
        `UPDATE conversations
         SET selected_provider_id = ?, selected_model_id = ?, selected_reasoning_json = ?,
             updated_at = ?
         WHERE id = ? AND deletion_pending = 0`,
      ).run(
        selection.providerId,
        selection.modelId,
        selection.reasoning === null ? null : JSON.stringify(selection.reasoning),
        now,
        conversationId,
      );
      if (conversationUpdate.changes !== 1) {
        throw new Error("Team member Conversation model could not be saved.");
      }
      this.appendTeamWorkItemEvent(
        workItem.teamId,
        workItemId,
        "updated",
        "用户更新了团队执行模型和思考程度；当前 Run 保持原快照，后续执行将使用新选择。",
        now,
      );
    });
    return this.getConversation(conversationId);
  }

  public getTeamWorkItem(workItemId: string): TeamWorkItemView {
    const row = this.database
      .prepare("SELECT * FROM team_work_items WHERE id = ?")
      .get(workItemId) as DatabaseRow | undefined;
    if (row === undefined) throw new Error("Team WorkItem was not found.");
    return this.toTeamWorkItem(row);
  }

  public isManagedTeamWorkItemConversation(conversationId: string): boolean {
    return this.getTeamExecutionConversationIdForParticipant(conversationId) !== null
      || this.database
        .prepare("SELECT 1 FROM team_work_items WHERE execution_conversation_id = ? LIMIT 1")
        .get(conversationId) !== undefined;
  }

  /** Whether a Conversation belongs below a WorkItem's Team Lead execution root. */
  public isTeamWorkItemExecutionTreeConversation(conversationId: string): boolean {
    return this.database.prepare(
      `${teamWorkItemExecutionTreeCte}
       SELECT 1 FROM team_execution_tree
       WHERE conversation_id = ?
       LIMIT 1`,
    ).get(conversationId) !== undefined;
  }

  private isConversationInTeamWorkItemExecution(
    conversationId: string,
    workItemId: string,
  ): boolean {
    return this.database.prepare(
      `${teamWorkItemExecutionTreeCte}
       SELECT 1 FROM team_execution_tree
       WHERE conversation_id = ? AND work_item_id = ?
       LIMIT 1`,
    ).get(conversationId, workItemId) !== undefined;
  }

  /**
   * Returns the running WorkItem that owns a Team Lead execution Conversation.
   * AgentRuntime uses this only while delivering a Subagent result so the
   * follow-up consolidation Run retains the WorkItem's frozen execution policy.
   */
  public getRunningTeamWorkItemByExecutionConversation(
    conversationId: string,
  ): TeamWorkItemView | null {
    const row = this.database.prepare(
      `SELECT * FROM team_work_items
       WHERE execution_conversation_id = ? AND status = 'running'
       LIMIT 1`,
    ).get(conversationId) as DatabaseRow | undefined;
    return row === undefined ? null : this.toTeamWorkItem(row);
  }

  /**
   * Returns the running WorkItem for either its Team Lead Conversation or one
   * of its persisted delegated member Conversations.
   */
  public getRunningTeamWorkItemByExecutionTreeConversation(
    conversationId: string,
  ): TeamWorkItemView | null {
    const row = this.database.prepare(
      `${teamWorkItemExecutionTreeCte}
       SELECT team_work_items.*
       FROM team_work_items
       INNER JOIN team_execution_tree
         ON team_execution_tree.work_item_id = team_work_items.id
       WHERE team_execution_tree.conversation_id = ?
         AND team_work_items.status = 'running'
       LIMIT 1`,
    ).get(conversationId) as DatabaseRow | undefined;
    return row === undefined ? null : this.toTeamWorkItem(row);
  }

  public listTeamWorkItems(
    input: { projectId?: string | undefined; teamId?: string | undefined } = {},
  ): TeamWorkItemView[] {
    const clauses: string[] = [];
    const values: string[] = [];
    if (input.teamId !== undefined) {
      clauses.push("team_id = ?");
      values.push(input.teamId);
    }
    if (input.projectId !== undefined) {
      clauses.push("project_id = ?");
      values.push(input.projectId);
    }
    const rows = this.database.prepare(
      `SELECT * FROM team_work_items${clauses.length === 0 ? "" : ` WHERE ${clauses.join(" AND ")}`}
       ORDER BY CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END,
                created_at ASC, rowid ASC`,
    ).all(...values) as DatabaseRow[];
    return rows.map((row) => this.toTeamWorkItem(row));
  }

  /**
   * Reads the durable Team Lead and member conversations for one WorkItem.
   * Member participation is proved by the Team mapping and each routed Agent
   * message is retained as an assignment record; ordinary side chats are not
   * included merely because they share a parent Conversation.
   */
  public getTeamWorkItemExecution(workItemId: string): TeamWorkItemExecutionView {
    const workItemRow = this.database.prepare(
      "SELECT execution_conversation_id FROM team_work_items WHERE id = ?",
    ).get(workItemId) as DatabaseRow | undefined;
    if (workItemRow === undefined) throw new Error("Team WorkItem was not found.");
    const executionConversationId = asNullableString(workItemRow, "execution_conversation_id");
    const projectableConversationIds = new Set(this.listProjectableConversationIds());
    if (
      executionConversationId === null
      || !projectableConversationIds.has(executionConversationId)
    ) {
      return teamWorkItemExecutionViewSchema.parse({ agents: [], workItemId });
    }

    const assignments = new Map(
      (this.database.prepare(
        `SELECT member_conversation_id, message_id, title
         FROM team_work_item_member_assignments
         WHERE work_item_id = ?
         ORDER BY created_at DESC, rowid DESC`,
      ).all(workItemId) as DatabaseRow[]).map((row) => [
        asString(row, "member_conversation_id"),
        {
          id: asString(row, "message_id"),
          title: asString(row, "title"),
        },
      ]),
    );
    const agents: TeamWorkItemExecutionView["agents"] = [];
    const visitedConversationIds = new Set<string>();
    const pending = [{
      conversationId: executionConversationId,
      delegation: null as TeamWorkItemExecutionView["agents"][number]["delegation"],
      depth: 0,
    }];

    while (pending.length > 0) {
      const current = pending.shift();
      if (current === undefined || visitedConversationIds.has(current.conversationId)) continue;
      visitedConversationIds.add(current.conversationId);
      if (!projectableConversationIds.has(current.conversationId)) continue;
      const conversation = this.getConversation(current.conversationId);
      agents.push({
        agent: this.getConversationAgentBinding(conversation.id),
        conversation,
        delegation: current.delegation,
        depth: current.depth,
      });

      const persistentMembers = this.listTeamMemberConversations(conversation.id);
      for (const member of persistentMembers) {
        const assignment = assignments.get(member.id);
        pending.push({
          conversationId: member.id,
          delegation: assignment === undefined
            ? null
            : {
              id: assignment.id,
              status: member.activeRunId !== null ? "running" : member.lastRunStatus ?? "queued",
              title: assignment.title,
            },
          depth: current.depth + 1,
        });
      }
      for (const task of this.listSubagentTasks(conversation.id)) {
        pending.push({
          conversationId: task.childConversationId,
          delegation: {
            id: task.id,
            status: task.status,
            title: task.title,
          },
          depth: current.depth + 1,
        });
      }
    }

    return teamWorkItemExecutionViewSchema.parse({ agents, workItemId });
  }

  /**
   * Publishes a complete collaboration-plan revision for the running WorkItem
   * owned by the calling Team Lead. Routes are advisory: message delivery does
   * not consult this table and therefore remains available for plan deviations.
   */
  public setTeamCollaborationPlan(
    rawInput: SetTeamCollaborationPlanInput,
  ): TeamCollaborationProjection {
    const input = setTeamCollaborationPlanInputSchema.parse(rawInput);
    const workItem = this.getRunningTeamWorkItemByExecutionTreeConversation(
      input.createdByConversationId,
    );
    if (
      workItem === null
      || workItem.executionConversationId !== input.createdByConversationId
      || this.getConversation(input.createdByConversationId).threadKind !== "team_lead"
    ) {
      throw new Error("Only the current WorkItem Team Lead can publish its collaboration plan.");
    }

    const execution = this.getTeamWorkItemExecution(workItem.id);
    const participants = new Map(
      execution.agents.map((participant) => [participant.conversation.id, participant]),
    );
    for (const route of input.routes) {
      if (
        !participants.has(route.fromConversationId)
        || !participants.has(route.toConversationId)
      ) {
        throw new Error("Collaboration routes may reference only participants in the current WorkItem.");
      }
    }
    const plannedConversationIds = new Set<string>([input.createdByConversationId]);
    for (const route of input.routes) {
      plannedConversationIds.add(route.fromConversationId);
      plannedConversationIds.add(route.toConversationId);
    }
    const plannedParticipants = execution.agents.filter((participant) => (
      plannedConversationIds.has(participant.conversation.id)
    ));

    const now = new Date().toISOString();
    const planId = randomUUID();
    this.withTransaction(() => {
      const revisionRow = this.database.prepare(
        "SELECT COALESCE(MAX(revision), 0) AS revision FROM team_collaboration_plans WHERE work_item_id = ?",
      ).get(workItem.id) as DatabaseRow;
      const revision = asNumber(revisionRow, "revision") + 1;
      this.database.prepare(
        `UPDATE team_collaboration_plans
         SET status = 'superseded', superseded_at = ?
         WHERE work_item_id = ? AND status = 'active'`,
      ).run(now, workItem.id);
      this.database.prepare(
        `INSERT INTO team_collaboration_plans (
          id, work_item_id, revision, status, created_by_conversation_id,
          reason, created_at, activated_at, superseded_at
        ) VALUES (?, ?, ?, 'active', ?, ?, ?, ?, NULL)`,
      ).run(
        planId,
        workItem.id,
        revision,
        input.createdByConversationId,
        input.reason,
        now,
        now,
      );

      const participantsByDepth = new Map<number, typeof plannedParticipants>();
      for (const participant of plannedParticipants) {
        const depthParticipants = participantsByDepth.get(participant.depth) ?? [];
        depthParticipants.push(participant);
        participantsByDepth.set(participant.depth, depthParticipants);
      }
      const nodeIds = new Map<string, string>();
      const insertNode = this.database.prepare(
        `INSERT INTO team_collaboration_plan_nodes (
          id, plan_id, stable_agent_id, conversation_id, kind, name_snapshot,
          role_snapshot, position_x, position_y, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const participant of plannedParticipants) {
        const siblings = participantsByDepth.get(participant.depth) ?? [participant];
        const siblingIndex = Math.max(0, siblings.findIndex(
          (candidate) => candidate.conversation.id === participant.conversation.id,
        ));
        const nodeId = randomUUID();
        nodeIds.set(participant.conversation.id, nodeId);
        insertNode.run(
          nodeId,
          planId,
          participant.agent?.id ?? null,
          participant.conversation.id,
          participant.depth === 0
            ? "team_lead"
            : participant.conversation.threadKind === "subagent" ? "ephemeral" : "standing",
          participant.agent?.name ?? participant.conversation.title,
          participant.agent?.role ?? (participant.depth === 0 ? "Team Lead" : "团队成员"),
          120 + participant.depth * 240,
          90 + siblingIndex * 120,
          now,
        );
      }

      const insertRoute = this.database.prepare(
        `INSERT INTO team_collaboration_plan_routes (
          id, plan_id, from_node_id, to_node_id, purposes_json, optional, created_at
        ) VALUES (?, ?, ?, ?, ?, 0, ?)`,
      );
      for (const route of input.routes) {
        const fromNodeId = nodeIds.get(route.fromConversationId);
        const toNodeId = nodeIds.get(route.toConversationId);
        if (fromNodeId === undefined || toNodeId === undefined) {
          throw new Error("A collaboration-plan participant disappeared while publishing the plan.");
        }
        insertRoute.run(
          randomUUID(),
          planId,
          fromNodeId,
          toNodeId,
          JSON.stringify([route.purpose]),
          now,
        );
      }
    });

    return this.getTeamCollaborationProjection(workItem.id);
  }

  /** Associates an already committed Agent message with its running WorkItem. */
  public recordTeamCollaborationMessage(input: {
    message: ConversationAgentMessageItem;
    workItemId: string;
  }): void {
    if (
      !this.isConversationInTeamWorkItemExecution(
        input.message.senderConversationId,
        input.workItemId,
      )
      || !this.isConversationInTeamWorkItemExecution(
        input.message.conversationId,
        input.workItemId,
      )
    ) return;
    this.database.prepare(
      "UPDATE conversation_agent_messages SET work_item_id = ? WHERE id = ? AND work_item_id IS NULL",
    ).run(input.workItemId, input.message.id);
  }

  /** Builds the single renderer projection from persisted plan and message facts. */
  public getTeamCollaborationProjection(workItemId: string): TeamCollaborationProjection {
    const workItem = this.getTeamWorkItem(workItemId);
    const execution = this.getTeamWorkItemExecution(workItemId);
    const executionByConversationId = new Map(
      execution.agents.map((participant) => [participant.conversation.id, participant]),
    );
    const planRow = this.database.prepare(
      `SELECT * FROM team_collaboration_plans
       WHERE work_item_id = ? AND status = 'active'
       ORDER BY revision DESC LIMIT 1`,
    ).get(workItemId) as DatabaseRow | undefined;
    const planId = planRow === undefined ? null : asString(planRow, "id");
    const planNodeRows = planId === null
      ? []
      : this.database.prepare(
          "SELECT * FROM team_collaboration_plan_nodes WHERE plan_id = ? ORDER BY created_at ASC, rowid ASC",
        ).all(planId) as DatabaseRow[];
    const messageRows = this.database.prepare(
      `SELECT DISTINCT messages.payload_json
       FROM conversation_agent_messages AS messages
       LEFT JOIN team_work_item_member_assignments AS assignments
         ON assignments.message_id = messages.id
       WHERE messages.work_item_id = ? OR assignments.work_item_id = ?
       ORDER BY messages.created_at ASC`,
    ).all(workItemId, workItemId) as DatabaseRow[];
    const messages = messageRows.map((row) => conversationAgentMessageItemSchema.parse(
      parseJson(asString(row, "payload_json"), "Team collaboration message"),
    ));
    const actualConversationIds = new Set<string>();
    for (const message of messages) {
      actualConversationIds.add(message.senderConversationId);
      actualConversationIds.add(message.conversationId);
    }

    const nodes: TeamCollaborationProjection["nodes"] = [];
    const nodeIdByConversationId = new Map<string, string>();
    for (const row of planNodeRows) {
      const conversationId = asNullableString(row, "conversation_id");
      const participant = conversationId === null
        ? undefined
        : executionByConversationId.get(conversationId);
      const id = asString(row, "id");
      if (conversationId !== null) nodeIdByConversationId.set(conversationId, id);
      nodes.push({
        agentId: asNullableString(row, "stable_agent_id"),
        conversationId,
        id,
        kind: z.enum(["team_lead", "standing", "ephemeral", "placeholder"])
          .parse(asString(row, "kind")),
        name: asString(row, "name_snapshot"),
        position: {
          x: asNumber(row, "position_x"),
          y: asNumber(row, "position_y"),
        },
        role: asString(row, "role_snapshot"),
        runStatus: collaborationRunStatus(participant?.conversation, workItem.status),
        taskIds: participant?.delegation === null || participant?.delegation === undefined
          ? []
          : [participant.delegation.id],
      });
    }

    for (const participant of execution.agents) {
      if (nodeIdByConversationId.has(participant.conversation.id)) continue;
      if (
        participant.depth !== 0
        && participant.delegation === null
        && !actualConversationIds.has(participant.conversation.id)
      ) continue;
      const positionX = 120 + participant.depth * 240;
      const lastPositionY = nodes.reduce((maximum, node) => (
        node.position.x === positionX ? Math.max(maximum, node.position.y) : maximum
      ), -30);
      const id = `conversation:${participant.conversation.id}`;
      nodeIdByConversationId.set(participant.conversation.id, id);
      nodes.push({
        agentId: participant.agent?.id ?? null,
        conversationId: participant.conversation.id,
        id,
        kind: participant.depth === 0
          ? "team_lead"
          : participant.conversation.threadKind === "subagent" ? "ephemeral" : "standing",
        name: participant.agent?.name ?? participant.conversation.title,
        position: {
          x: positionX,
          y: lastPositionY + 120,
        },
        role: participant.agent?.role ?? (participant.depth === 0 ? "Team Lead" : "团队成员"),
        runStatus: collaborationRunStatus(participant.conversation, workItem.status),
        taskIds: participant.delegation === null ? [] : [participant.delegation.id],
      });
    }

    const messageGroups = new Map<string, ConversationAgentMessageItem[]>();
    for (const message of messages) {
      const key = `${message.senderConversationId}:${message.conversationId}`;
      const group = messageGroups.get(key) ?? [];
      group.push(message);
      messageGroups.set(key, group);
    }

    const edges: TeamCollaborationProjection["edges"] = [];
    const plannedRouteKeys = new Set<string>();
    if (planId !== null) {
      const routeRows = this.database.prepare(
        `SELECT routes.*, source.conversation_id AS from_conversation_id,
                target.conversation_id AS to_conversation_id
         FROM team_collaboration_plan_routes AS routes
         JOIN team_collaboration_plan_nodes AS source ON source.id = routes.from_node_id
         JOIN team_collaboration_plan_nodes AS target ON target.id = routes.to_node_id
         WHERE routes.plan_id = ? ORDER BY routes.created_at ASC, routes.rowid ASC`,
      ).all(planId) as DatabaseRow[];
      for (const row of routeRows) {
        const fromConversationId = asNullableString(row, "from_conversation_id");
        const toConversationId = asNullableString(row, "to_conversation_id");
        const routeKey = fromConversationId === null || toConversationId === null
          ? null
          : `${fromConversationId}:${toConversationId}`;
        if (routeKey !== null) plannedRouteKeys.add(routeKey);
        const activity = routeKey === null ? [] : messageGroups.get(routeKey) ?? [];
        edges.push(collaborationEdgeView({
          activity,
          fromNodeId: asString(row, "from_node_id"),
          id: asString(row, "id"),
          purposes: z.array(z.string().trim().min(1).max(500)).max(20).parse(
            parseJson(asString(row, "purposes_json"), "Team collaboration route purposes"),
          ),
          state: activity.length > 0
            ? "observed"
            : isTerminalTeamWorkItemStatus(workItem.status) ? "skipped" : "planned",
          toNodeId: asString(row, "to_node_id"),
        }));
      }
    }

    for (const [routeKey, activity] of messageGroups) {
      if (plannedRouteKeys.has(routeKey)) continue;
      const first = activity[0];
      if (first === undefined) continue;
      const fromNodeId = nodeIdByConversationId.get(first.senderConversationId);
      const toNodeId = nodeIdByConversationId.get(first.conversationId);
      if (fromNodeId === undefined || toNodeId === undefined) continue;
      edges.push(collaborationEdgeView({
        activity,
        fromNodeId,
        id: `actual:${routeKey}`,
        purposes: ["计划外通信"],
        state: "ad_hoc",
        toNodeId,
      }));
    }

    const lastActivityAt = messages.at(-1)?.createdAt ?? null;
    return teamCollaborationProjectionSchema.parse({
      edges,
      nodes,
      plan: planRow === undefined ? null : {
        activatedAt: asString(planRow, "activated_at"),
        createdAt: asString(planRow, "created_at"),
        id: asString(planRow, "id"),
        reason: asString(planRow, "reason"),
        revision: asNumber(planRow, "revision"),
        status: "active",
      },
      summary: {
        adHocRouteCount: edges.filter((edge) => edge.state === "ad_hoc").length,
        lastActivityAt,
        messageCount: messages.length,
        observedRouteCount: edges.filter((edge) => edge.messageCount > 0).length,
        participantCount: nodes.length,
        plannedRouteCount: edges.filter((edge) => edge.state !== "ad_hoc").length,
      },
      workItemId,
    });
  }

  /**
   * Claims a queued WorkItem before its first Team Lead Run is written. This
   * makes a process stop between Conversation creation and Run scheduling
   * recover as a blocked WorkItem instead of creating or replaying a second
   * execution root on the next launch.
   */
  public reserveTeamWorkItemExecution(
    workItemId: string,
    conversationId: string,
  ): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status !== "queued" || current.executionConversationId !== null) {
      throw new Error("Only an unclaimed queued Team WorkItem can reserve an execution Conversation.");
    }
    this.getConversation(conversationId);
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET execution_conversation_id = ?, status = 'planned', updated_at = ?
         WHERE id = ? AND status = 'queued' AND execution_conversation_id IS NULL`,
      ).run(conversationId, now, workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem changed before its execution Conversation could be reserved.");
      this.appendTeamWorkItemEvent(
        current.teamId,
        workItemId,
        "planned",
        "Team Lead 执行对话已创建，等待首个 Run 调度。",
        now,
      );
    });
    return this.getTeamWorkItem(workItemId);
  }

  public startTeamWorkItem(
    workItemId: string,
    conversationId: string,
    runId: string,
  ): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status !== "queued" && current.status !== "planned") {
      throw new Error("Only queued Team WorkItems can start.");
    }
    if (
      current.executionConversationId !== null
      && current.executionConversationId !== conversationId
    ) {
      throw new Error("Team WorkItem execution Conversation changed before its Run could start.");
    }
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET execution_conversation_id = ?, active_run_id = ?, status = 'running', updated_at = ?
         WHERE id = ? AND status IN ('queued', 'planned')
           AND (execution_conversation_id IS NULL OR execution_conversation_id = ?)`,
      ).run(conversationId, runId, now, workItemId, conversationId);
      if (result.changes !== 1) throw new Error("Team WorkItem changed before it could start.");
      this.appendTeamWorkItemEvent(current.teamId, workItemId, "run_started", "团队执行对话已启动。", now);
    });
    return this.getTeamWorkItem(workItemId);
  }

  /**
   * Starts the Team Lead's next coordination Run after a member result while
   * retaining the WorkItem's frozen execution policy.
   */
  public createTeamWorkItemContinuationRun(input: {
    conversationId: string;
    executionSnapshot?: RunExecutionSnapshot;
    modelId: string;
    workItemId: string;
  }): AgentMessageRunCreation {
    const current = this.getTeamWorkItem(input.workItemId);
    if (
      current.status !== "running"
      || current.executionConversationId !== input.conversationId
      || current.activeRunId !== null
    ) {
      throw new Error("The Team WorkItem is not ready for a coordination Run.");
    }
    this.getConversation(input.conversationId);
    this.assertNoActiveRun(input.conversationId);
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
          input.conversationId,
          input.modelId,
          now,
          now,
          serializeRunExecutionSnapshot(input.executionSnapshot),
        );
      this.database
        .prepare(
          "UPDATE conversations SET updated_at = ?, has_unread_result = 0 WHERE id = ?"
        )
        .run(now, input.conversationId);
      const result = this.database
        .prepare(
          `UPDATE team_work_items
           SET active_run_id = ?, updated_at = ?
           WHERE id = ? AND status = 'running'
             AND execution_conversation_id = ? AND active_run_id IS NULL`,
        )
        .run(runId, now, input.workItemId, input.conversationId);
      if (result.changes !== 1) {
        throw new Error("The Team WorkItem changed before coordination could start.");
      }
      this.appendTeamWorkItemEvent(
        current.teamId,
        input.workItemId,
        "run_started",
        "团队成员消息已送达，正在继续协调执行。",
        now,
      );
    });

    return {
      conversation: this.getConversation(input.conversationId),
      runId,
    };
  }

  public failTeamWorkItemBeforeRun(workItemId: string, error: string): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status !== "queued" && current.status !== "planned") return current;
    const now = new Date().toISOString();
    const detail = error.trim().slice(0, 4_000) || "团队执行对话启动失败。";
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items SET status = 'failed', blocked_reason = ?, updated_at = ?
         WHERE id = ? AND status IN ('queued', 'planned')`,
      ).run(detail, now, workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem changed before start failure was recorded.");
      this.appendTeamWorkItemEvent(current.teamId, workItemId, "failed", detail, now);
    });
    return this.getTeamWorkItem(workItemId);
  }

  /** Records a non-replayable managed execution failure without changing its history. */
  public blockTeamWorkItem(workItemId: string, reason: string): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status !== "running") return current;
    const now = new Date().toISOString();
    const detail = reason.trim().slice(0, 4_000) || "团队执行需要人工处理。";
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET active_run_id = NULL, status = 'blocked', blocked_reason = ?, updated_at = ?
         WHERE id = ? AND status = 'running'`,
      ).run(detail, now, workItemId);
      if (result.changes !== 1) {
        throw new Error("The Team WorkItem changed before it could be blocked.");
      }
      this.appendTeamWorkItemEvent(current.teamId, workItemId, "blocked", detail, now);
    });
    return this.getTeamWorkItem(workItemId);
  }

  public finishTeamWorkItemRun(input: {
    conversationId: string;
    error: string | null;
    resultSummary: string | null;
    runId: string;
    status: "cancelled" | "completed" | "failed";
    workItemId: string;
  }): TeamWorkItemView {
    const current = this.getTeamWorkItem(input.workItemId);
    if (
      current.activeRunId !== input.runId
      || current.executionConversationId !== input.conversationId
    ) return current;
    const activeSubagentCount = input.status === "completed"
      ? this.countActiveSubagentTasksInExecutionTree(input.conversationId)
      : 0;
    const activeMemberCount = input.status === "completed"
      ? this.countActiveTeamMemberRuns(input.conversationId)
      : 0;
    const unreadAgentMessageCount = input.status === "completed"
      ? this.listUnreadAgentMessages(input.conversationId).length
      : 0;
    const now = new Date().toISOString();
    if (activeSubagentCount > 0 || activeMemberCount > 0 || unreadAgentMessageCount > 0) {
      this.withTransaction(() => {
        const result = this.database.prepare(
          `UPDATE team_work_items
           SET active_run_id = NULL, result_summary = NULL, blocked_reason = NULL, updated_at = ?
           WHERE id = ? AND status = 'running' AND active_run_id = ?`,
        ).run(now, input.workItemId, input.runId);
        if (result.changes !== 1) {
          throw new Error("Team WorkItem run changed before it could await Subagents.");
        }
        this.appendTeamWorkItemEvent(
          current.teamId,
          input.workItemId,
        "task_updated",
          activeMemberCount > 0
            ? `Team Lead 已完成当前步骤，正在等待 ${activeMemberCount} 位团队成员交付。`
            : activeSubagentCount > 0
            ? `Team Lead 已完成当前步骤，正在等待 ${activeSubagentCount} 个旧版一次性任务交付。`
            : `正在等待 Team Lead 汇总 ${unreadAgentMessageCount} 条已送达的成员结果。`,
          now,
        );
      });
      return this.getTeamWorkItem(input.workItemId);
    }
    const nextStatus: TeamWorkItemStatus = input.status === "completed"
      ? "waiting_user"
      : input.status === "cancelled"
        ? "cancelled"
        : "failed";
    const eventType = input.status === "completed"
      ? "review_ready"
      : input.status === "cancelled"
        ? "cancelled"
        : "failed";
    const detail = input.status === "completed"
      ? "执行、验证与自检已结束，等待用户验收。"
      : input.error ?? (input.status === "cancelled" ? "执行已取消。" : "执行失败。");
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET active_run_id = NULL, status = ?, result_summary = ?, blocked_reason = ?, updated_at = ?
         WHERE id = ? AND active_run_id = ?`,
      ).run(
        nextStatus,
        input.resultSummary,
        input.status === "failed" ? detail : null,
        now,
        input.workItemId,
        input.runId,
      );
      if (result.changes !== 1) throw new Error("Team WorkItem run changed before it finished.");
      this.appendTeamWorkItemEvent(current.teamId, input.workItemId, eventType, detail, now);
    });
    return this.getTeamWorkItem(input.workItemId);
  }

  private countActiveTeamMemberRuns(teamExecutionConversationId: string): number {
    const row = this.database.prepare(
      `SELECT COUNT(*) AS count
       FROM team_member_conversations
       INNER JOIN runs
         ON runs.conversation_id = team_member_conversations.conversation_id
        AND runs.status IN ('queued', 'running')
       WHERE team_member_conversations.team_execution_conversation_id = ?`,
    ).get(teamExecutionConversationId) as DatabaseRow;
    return asNumber(row, "count");
  }

  public startTeamWorkItemRework(workItemId: string, runId: string, feedback: string): TeamWorkItemView {
    const current = this.getTeamWorkItem(workItemId);
    if (current.status !== "waiting_user" || current.executionConversationId === null) {
      throw new Error("Only a WorkItem waiting for user acceptance can be reworked.");
    }
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET active_run_id = ?, status = 'running', revision = revision + 1,
             result_summary = NULL, accepted_criteria_json = '[]', blocked_reason = NULL, updated_at = ?
         WHERE id = ? AND status = 'waiting_user'`,
      ).run(runId, now, workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem changed before rework started.");
      this.appendTeamWorkItemEvent(
        current.teamId,
        workItemId,
        "rework_requested",
        `用户要求返工：${feedback.slice(0, 1_500)}`,
        now,
      );
    });
    return this.getTeamWorkItem(workItemId);
  }

  public acceptTeamWorkItem(input: AcceptTeamWorkItemInput): TeamWorkItemView {
    const current = this.getTeamWorkItem(input.workItemId);
    if (current.status !== "waiting_user") {
      throw new Error("Only a WorkItem waiting for user acceptance can be completed.");
    }
    if (
      current.acceptanceCriteria.length !== input.acceptedCriteria.length
      || current.acceptanceCriteria.some((criterion) => !input.acceptedCriteria.includes(criterion))
    ) {
      throw new Error("Every acceptance criterion must be explicitly confirmed before completion.");
    }
    const now = new Date().toISOString();
    this.withTransaction(() => {
      const result = this.database.prepare(
        `UPDATE team_work_items
         SET status = 'completed', accepted_criteria_json = ?, completed_at = ?, updated_at = ?
         WHERE id = ? AND status = 'waiting_user'`,
      ).run(JSON.stringify(input.acceptedCriteria), now, now, input.workItemId);
      if (result.changes !== 1) throw new Error("Team WorkItem changed before acceptance.");
      this.appendTeamWorkItemEvent(current.teamId, input.workItemId, "accepted", "用户已逐项验收通过，工作项已完成。", now);
    });
    return this.getTeamWorkItem(input.workItemId);
  }

  public blockInterruptedTeamWorkItems(): number {
    const rows = this.database.prepare(
      `SELECT id, team_id, status, execution_conversation_id
       FROM team_work_items
       WHERE execution_conversation_id IS NOT NULL`,
    ).all() as DatabaseRow[];
    if (rows.length === 0) return 0;
    const now = new Date().toISOString();
    let blockedCount = 0;
    this.withTransaction(() => {
      for (const row of rows) {
        const id = asString(row, "id");
        const teamId = asString(row, "team_id");
        const status = asString(row, "status");
        const executionConversationId = asString(row, "execution_conversation_id");
        const interruptedRuns = this.database.prepare(
          `UPDATE runs
           SET status = 'failed', error = ?, updated_at = ?
           WHERE conversation_id = ? AND status IN ('queued', 'running')`,
        ).run(
          "Application stopped before the managed Team WorkItem Run finished; it was not resumed.",
          now,
          executionConversationId,
        );
        if (interruptedRuns.changes > 0) {
          this.database.prepare(
            "UPDATE conversations SET has_unread_result = 1 WHERE id = ?",
          ).run(executionConversationId);
        }
        if (!["triaging", "planned", "running", "reviewing"].includes(status)) continue;
        this.database.prepare(
          `UPDATE team_work_items
           SET active_run_id = NULL, status = 'blocked', blocked_reason = ?, updated_at = ?
           WHERE id = ? AND status IN ('triaging', 'planned', 'running', 'reviewing')`,
        ).run("应用在执行过程中退出；为避免重放文件或命令副作用，任务已阻塞。", now, id);
        this.appendTeamWorkItemEvent(
          teamId,
          id,
          "blocked",
          "应用重启后未自动重放副作用，任务需要人工确认。",
          now,
        );
        blockedCount += 1;
      }
    });
    return blockedCount;
  }

  private appendTeamWorkItemEvent(
    teamId: string,
    workItemId: string,
    type: TeamWorkItemEvent["type"],
    detail: string,
    createdAt: string,
  ): void {
    const row = this.database.prepare(
      "SELECT COALESCE(MAX(sequence), 0) + 1 AS next_sequence FROM team_work_item_events WHERE team_id = ?",
    ).get(teamId) as DatabaseRow;
    const event = teamWorkItemEventSchema.parse({
      createdAt,
      detail,
      id: randomUUID(),
      sequence: asNumber(row, "next_sequence"),
      type,
    });
    this.database.prepare(
      `INSERT INTO team_work_item_events
       (id, team_id, work_item_id, sequence, type, detail, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(event.id, teamId, workItemId, event.sequence, event.type, event.detail, event.createdAt);
  }

  private toTeamWorkItem(row: DatabaseRow): TeamWorkItemView {
    const executionConversationId = asNullableString(row, "execution_conversation_id");
    const teamInstanceId = asNullableString(row, "team_instance_id");
    const instanceRow = teamInstanceId === null
      ? undefined
      : this.database.prepare("SELECT * FROM team_instances WHERE id = ?")
        .get(teamInstanceId) as DatabaseRow | undefined;
    const instance = instanceRow === undefined ? null : this.toTeamInstance(instanceRow);
    const participantConversationIds = executionConversationId === null
      ? []
      : [
        executionConversationId,
        ...(this.database.prepare(
          `SELECT DISTINCT member_conversation_id
           FROM team_work_item_member_assignments
           WHERE work_item_id = ?
           ORDER BY created_at ASC, rowid ASC`,
        ).all(asString(row, "id")) as DatabaseRow[])
          .map((participant) => asString(participant, "member_conversation_id")),
      ];
    // Keep the full append-only audit trail in SQLite, while bounding the
    // renderer/IPC projection to the protocol's 200-event contract.
    const eventRows = this.database.prepare(
      `SELECT id, sequence, type, detail, created_at
       FROM (
         SELECT id, sequence, type, detail, created_at
         FROM team_work_item_events
         WHERE work_item_id = ?
         ORDER BY sequence DESC
         LIMIT 200
       )
       ORDER BY sequence ASC`,
    ).all(asString(row, "id")) as DatabaseRow[];
    const tasks = executionConversationId === null
      || !this.isConversationProjectable(executionConversationId)
      ? []
      : this.getTaskList(executionConversationId)?.tasks ?? [];
    return teamWorkItemViewSchema.parse({
      acceptanceCriteria: parseJson(asString(row, "acceptance_criteria_json"), "Team WorkItem acceptance criteria"),
      acceptedCriteria: parseJson(asString(row, "accepted_criteria_json"), "Team WorkItem accepted criteria"),
      activeRunId: asNullableString(row, "active_run_id"),
      blockedReason: asNullableString(row, "blocked_reason"),
      completedAt: asNullableString(row, "completed_at"),
      createdAt: asString(row, "created_at"),
      events: eventRows.map((eventRow) => ({
        createdAt: asString(eventRow, "created_at"),
        detail: asString(eventRow, "detail"),
        id: asString(eventRow, "id"),
        sequence: asNumber(eventRow, "sequence"),
        type: asString(eventRow, "type"),
      })),
      executionConversationId,
      executionScope: asString(row, "execution_scope"),
      id: asString(row, "id"),
      ...(instance === null ? {} : { instanceName: instance.name }),
      modelSelection: parseJson(asString(row, "model_selection_json"), "Team WorkItem model selection"),
      participantConversationIds,
      permissionMode: asString(row, "permission_mode"),
      priority: asString(row, "priority"),
      projectId: asString(row, "project_id"),
      requirement: asString(row, "requirement"),
      resultSummary: asNullableString(row, "result_summary"),
      revision: asNumber(row, "revision"),
      sourceConversationId: asNullableString(row, "source_conversation_id"),
      status: asString(row, "status"),
      tasks,
      teamId: asString(row, "team_id"),
      ...(teamInstanceId === null ? {} : { teamInstanceId }),
      title: asString(row, "title"),
      updatedAt: asString(row, "updated_at"),
    });
  }

  private toTeamInstance(row: DatabaseRow): TeamInstanceView {
    return teamInstanceViewSchema.parse({
      createdAt: asString(row, "created_at"),
      id: asString(row, "id"),
      isArchived: asNullableString(row, "archived_at") !== null,
      name: asString(row, "name"),
      projectId: asNullableString(row, "project_id"),
      rootConversationId: asNullableString(row, "root_conversation_id"),
      scope: asString(row, "scope"),
      sourceConversationId: asNullableString(row, "source_conversation_id"),
      teamId: asString(row, "team_id"),
      updatedAt: asString(row, "updated_at"),
    });
  }

  private isConversationProjectable(conversationId: string): boolean {
    return this.database
      .prepare(
        "SELECT 1 AS present FROM conversations WHERE id = ? AND deletion_pending = 0 LIMIT 1",
      )
      .get(conversationId) !== undefined;
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
    const parent = options.parentConversationId === undefined
      ? null
      : this.getConversation(options.parentConversationId);
    if (parent !== null) {
      if (parent.isArchived) {
        throw new Error("A Team execution conversation cannot have an archived parent.");
      }
      const isTeamLeadFromSource = options.threadKind === "team_lead"
        && parent.projectId === projectId
        && parent.parentConversationId === null
        && parent.threadKind === "agent"
        && parent.teamWorkItemId === null;
      const isPersistentMemberFromLead = options.threadKind === "agent"
        && parent.projectId === projectId
        && parent.threadKind === "team_lead"
        && parent.teamId !== null
        && options.teamId === parent.teamId;
      if (!isTeamLeadFromSource && !isPersistentMemberFromLead) {
        throw new Error("A Team execution child must be either a Team Lead or one of its persistent members.");
      }
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
      avatarIcon: agent?.avatarIcon ?? null,
      createdAt: now,
      hasUnreadResult: false,
      id: randomUUID(),
      lastRunStatus: null,
      modelSelection: options.modelSelection ?? null,
      parentConversationId: parent?.id ?? null,
      pinOrder: null,
      projectId,
      subagentTaskStatus: null,
      teamId: options.teamId ?? null,
      teamWorkItemId: null,
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
             thread_kind, agent_id, avatar_icon, agent_name, agent_role, agent_is_default,
             agent_instructions, team_id, title, created_at, updated_at, sort_order)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`
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
          conversation.avatarIcon ?? null,
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
         SET thread_kind = ?, agent_id = ?, avatar_icon = ?, agent_name = ?, agent_role = ?,
             agent_is_default = ?, agent_instructions = ?, updated_at = ?
         WHERE id = ?`
      )
      .run(
        conversation.threadKind,
        agent.id,
        agent.avatarIcon ?? null,
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
        `SELECT agent_id, avatar_icon, agent_name, agent_role, agent_is_default, agent_instructions
         FROM conversations WHERE id = ? AND deletion_pending = 0`
      )
      .get(conversationId) as DatabaseRow | undefined;
    if (row === undefined) {
      throw new Error("Conversation was not found.");
    }
    const id = asNullableString(row, "agent_id");
    if (id === null) return null;
    const avatarIcon = asNullableString(row, "avatar_icon");
    return conversationAgentBindingSchema.parse({
      ...(avatarIcon === null ? {} : { avatarIcon }),
      id,
      instructions: asNullableString(row, "agent_instructions") ?? "",
      isDefault: asBoolean(row, "agent_is_default"),
      name: asNullableString(row, "agent_name") ?? id,
      role: asNullableString(row, "agent_role") ?? ""
    });
  }

  public setConversationAvatarIcon(
    conversationId: string,
    rawAvatarIcon: unknown,
  ): ConversationSummary {
    const avatarIcon = agentAvatarIconSchema.parse(rawAvatarIcon);
    this.getConversation(conversationId);
    this.database
      .prepare("UPDATE conversations SET avatar_icon = ?, updated_at = ? WHERE id = ?")
      .run(avatarIcon, new Date().toISOString(), conversationId);
    return this.getConversation(conversationId);
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
    const conversation = this.getConversation(conversationId);
    if (conversation.teamWorkItemId !== null) {
      throw new Error("Managed Team WorkItem conversations use the WorkItem's frozen model selection.");
    }
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
      avatarIcon: inheritedAgent?.avatarIcon ?? null,
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
      teamWorkItemId: null,
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
              thread_kind, agent_id, avatar_icon, agent_name, agent_role, agent_is_default,
              agent_instructions, team_id, title, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
          inheritedAgent?.avatarIcon ?? null,
          inheritedAgent?.name ?? null,
          inheritedAgent?.role ?? null,
          Number(inheritedAgent?.isDefault ?? false),
          inheritedAgent?.instructions ?? null,
          conversation.teamId,
          conversation.title,
          conversation.createdAt,
          conversation.updatedAt
        );

      const sourceCheckpoint = this.getContextCheckpoint(sourceConversationId);
      const allSourceMessages = this.database
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
      const sourceMessages = kind === "side" && sourceCheckpoint !== null
        ? allSourceMessages.filter(
            (message) => asNumber(message, "sequence") >= sourceCheckpoint.coveredThroughSequence,
          )
        : allSourceMessages;
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
        `${teamWorkItemExecutionTreeCte}
         SELECT conversations.id, project_id, parent_conversation_id, workspace_root_path,
            selected_provider_id, selected_model_id, selected_reasoning_json,
            thread_kind, agent_id, avatar_icon, team_id, title, created_at, conversations.updated_at,
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
           ,team_execution_tree_projection.work_item_id AS team_work_item_id
         FROM conversations
         LEFT JOIN team_execution_tree_projection
           ON team_execution_tree_projection.conversation_id = conversations.id
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
    return asNullableString(row, "parent_conversation_id") !== null
      && !this.isManagedTeamWorkItemConversation(conversationId);
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
    if (conversation.teamWorkItemId !== null) {
      throw new Error("Managed Team WorkItem conversations retain their WorkItem project binding.");
    }
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
    if (archived && conversation.teamWorkItemId !== null) {
      throw new Error("Managed Team WorkItem conversations are retained by their WorkItem lifecycle.");
    }
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

    const conversation = this.getConversation(conversationId);
    if (conversation.teamWorkItemId !== null) {
      throw new Error("Managed Team WorkItem conversations are retained by their WorkItem lifecycle.");
    }
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

  /** Counts queued/running tasks across an execution tree, including nested delegation. */
  public countActiveSubagentTasksInExecutionTree(rootConversationId: string): number {
    this.getConversation(rootConversationId);
    const row = this.database.prepare(
      `WITH RECURSIVE execution_tree(conversation_id) AS (
         SELECT ?
         UNION
         SELECT task.child_conversation_id
         FROM subagent_tasks AS task
         JOIN execution_tree AS parent
           ON parent.conversation_id = task.parent_conversation_id
       )
       SELECT COUNT(*) AS count
       FROM subagent_tasks
       WHERE parent_conversation_id IN (SELECT conversation_id FROM execution_tree)
         AND status IN ('queued', 'running')`,
    ).get(rootConversationId) as DatabaseRow;
    return asNumber(row, "count");
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
      if (item.kind === "agent_message") {
        return this.withCurrentAgentMessageSenderTitle(item);
      }
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
      replyInstruction: input.replyInstruction ?? null,
      runId: input.runId,
      senderConversationId: sender.id,
      senderTitle: this.agentMessageSenderTitle(sender),
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
    return rows.map((row) => this.withCurrentAgentMessageSenderTitle(
      conversationAgentMessageItemSchema.parse(
        parseJson(asString(row, "payload_json"), "Agent message")
      ),
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
    const nextTitle = userMessageCount === 0 && !this.hasStableTeamParticipantTitle(conversation)
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
    titleOverride?: string,
  ): RunCreation {
    const prepared = this.prepareRunWithUserMessage(
      conversationId,
      content,
      modelId,
      attachmentIds,
      modelContent,
      executionSnapshot,
      titleOverride,
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
    titleOverride?: string,
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
    const nextTitle = this.hasStableTeamParticipantTitle(conversation)
      ? conversation.title
      : titleOverride ?? (userMessageCount === 0
          ? this.createTitleFromMessage(content || attachments[0]?.name || "新会话")
          : conversation.title);

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
      && !this.hasStableTeamParticipantTitle(conversation)
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
        && !this.hasStableTeamParticipantTitle(conversation)
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
          && (input.assistant.reasoningContent?.length ?? 0) === 0
          ? null
          : conversationMessageItemSchema.parse({
              content: input.assistant.content,
              conversationId: input.conversationId,
              createdAt: now,
              id: input.assistant.messageId,
              kind: "message",
              modelId: input.assistant.modelId,
              ...(input.assistant.reasoningContent === undefined
                ? {}
                : { reasoningContent: input.assistant.reasoningContent }),
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
          && (input.assistant.reasoningContent?.length ?? 0) === 0
          ? null
          : conversationMessageItemSchema.parse({
              content: input.assistant.content,
              conversationId: input.conversationId,
              createdAt: now,
              id: input.assistant.messageId,
              kind: "message",
              modelId: input.assistant.modelId,
              ...(input.assistant.reasoningContent === undefined
                ? {}
                : { reasoningContent: input.assistant.reasoningContent }),
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
    reasoningContent?: string;
    runId: string;
    toolCalls: ModelToolCall[];
  }): ConversationMessageItem | null {
    const now = new Date().toISOString();
    const message =
      input.content.length === 0 && (input.reasoningContent?.length ?? 0) === 0
        ? null
        : conversationMessageItemSchema.parse({
            content: input.content,
            conversationId: input.conversationId,
            createdAt: now,
            id: input.messageId,
            kind: "message",
            modelId: input.modelId,
            ...(input.reasoningContent === undefined
              ? {}
              : { reasoningContent: input.reasoningContent }),
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

  /**
   * A Run cannot leave an actionable approval behind after it reaches a
   * terminal state. Returning the updated rows lets AgentRuntime write the
   * same fact to ThreadLog for recovery.
   */
  public expirePendingToolApprovalsForRun(runId: string): ConversationToolItem[] {
    return this.withTransaction(() => this.expirePendingToolApprovalsForRunInTransaction(runId));
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

        if (event.type === "tool_approval_expired") {
          const tool = readProjectionTool(payload, "tool");
          if (tool !== null && tool.status === "cancelled") {
            this.expireThreadLogToolApproval(conversationId, tool);
          }
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
      this.expirePendingToolApprovalsForTerminalRunsInTransaction();
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
    const reasoningContent = readProjectionString(payload, "reasoningContent");
    const timelineMessage = storedTimelineMessage
      ?? (content.length === 0 && reasoningContent === null
        ? null
        : messageId !== null && modelId !== null
          ? conversationMessageItemSchema.parse({
              content,
              conversationId,
              createdAt: event.createdAt,
              id: messageId,
              kind: "message",
              modelId,
              ...(reasoningContent === null ? {} : { reasoningContent }),
              role: "assistant",
              runId,
              status: "completed",
            })
          : null);
    if (
      payload.writeAhead === true
      && (content.length > 0 || reasoningContent !== null)
      && timelineMessage === null
    ) {
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
        ? assistant.content.length === 0 && (assistant.reasoningContent?.length ?? 0) === 0
          ? null
          : conversationMessageItemSchema.parse({
              content: assistant.content,
              conversationId,
              createdAt: event.createdAt,
              id: assistant.messageId,
               kind: "message",
               modelId: assistant.modelId,
               ...(assistant.reasoningContent === undefined
                 ? {}
                 : { reasoningContent: assistant.reasoningContent }),
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

  private expireThreadLogToolApproval(
    conversationId: string,
    tool: ConversationToolItem,
  ): void {
    const current = this.database
      .prepare(
        `SELECT payload_json FROM conversation_timeline
         WHERE id = ? AND conversation_id = ? AND kind = 'tool'`,
      )
      .get(tool.id, conversationId) as DatabaseRow | undefined;
    if (current === undefined) return;
    const currentTool = conversationToolItemSchema.parse(
      parseJson(asString(current, "payload_json"), "tool"),
    );
    if (currentTool.status !== "awaiting_approval") return;
    this.database
      .prepare("UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'tool'")
      .run(JSON.stringify(tool), tool.id);
  }

  private expirePendingToolApprovalsForRunInTransaction(runId: string): ConversationToolItem[] {
    const rows = this.database.prepare(
      `SELECT payload_json FROM conversation_timeline
       WHERE kind = 'tool'`,
    ).all() as DatabaseRow[];
    const expired = rows.flatMap((row) => {
      const current = conversationToolItemSchema.parse(
        parseJson(asString(row, "payload_json"), "tool"),
      );
      if (current.runId !== runId || current.status !== "awaiting_approval") return [];
      const tool = conversationToolItemSchema.parse({
        ...current,
        result: "审批已失效：所属运行已经结束。",
        status: "cancelled",
      });
      this.database
        .prepare("UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'tool'")
        .run(JSON.stringify(tool), tool.id);
      this.touchConversation(tool.conversationId, new Date().toISOString());
      return [tool];
    });
    return expired;
  }

  private expirePendingToolApprovalsForTerminalRunsInTransaction(): void {
    const terminalRunIds = new Set((this.database.prepare(
      `SELECT id FROM runs WHERE status IN ('completed', 'failed', 'cancelled')`,
    ).all() as DatabaseRow[]).map((row) => asString(row, "id")));
    if (terminalRunIds.size === 0) return;
    const rows = this.database.prepare(
      `SELECT payload_json FROM conversation_timeline
       WHERE kind = 'tool'`,
    ).all() as DatabaseRow[];
    for (const row of rows) {
      const current = conversationToolItemSchema.parse(
        parseJson(asString(row, "payload_json"), "tool"),
      );
      if (current.status !== "awaiting_approval" || !terminalRunIds.has(current.runId)) continue;
      const tool = conversationToolItemSchema.parse({
        ...current,
        result: "审批已失效：所属运行已经结束。",
        status: "cancelled",
      });
      this.database
        .prepare("UPDATE conversation_timeline SET payload_json = ? WHERE id = ? AND kind = 'tool'")
        .run(JSON.stringify(tool), tool.id);
      this.touchConversation(tool.conversationId, new Date().toISOString());
    }
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
      {
        name: "conversation-avatar-icon",
        up: (database) => {
          const columns = database
            .prepare("PRAGMA table_info(conversations)")
            .all() as DatabaseRow[];
          if (!columns.some((column) => column.name === "avatar_icon")) {
            database.exec("ALTER TABLE conversations ADD COLUMN avatar_icon TEXT");
          }
        },
        version: 8,
      },
      {
        name: "team-work-items",
        up: (database) => {
          database.exec(`
            CREATE TABLE IF NOT EXISTS team_work_items (
              id TEXT PRIMARY KEY,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              requirement TEXT NOT NULL,
              acceptance_criteria_json TEXT NOT NULL,
              priority TEXT NOT NULL CHECK(priority IN ('high', 'normal', 'low')),
              status TEXT NOT NULL CHECK(status IN (
                'inbox', 'triaging', 'needs_clarification', 'planned', 'queued', 'running',
                'waiting_user', 'blocked', 'reviewing', 'completed', 'failed', 'cancelled'
              )),
              revision INTEGER NOT NULL,
              permission_mode TEXT NOT NULL,
              model_selection_json TEXT NOT NULL,
              execution_conversation_id TEXT UNIQUE REFERENCES conversations(id) ON DELETE SET NULL,
              active_run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE SET NULL,
              result_summary TEXT,
              blocked_reason TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              completed_at TEXT
            );

            CREATE INDEX IF NOT EXISTS team_work_items_team_status
              ON team_work_items(team_id, status, priority, created_at);
            CREATE INDEX IF NOT EXISTS team_work_items_project_status
              ON team_work_items(project_id, status, created_at);

            CREATE TABLE IF NOT EXISTS team_work_item_events (
              id TEXT PRIMARY KEY,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              work_item_id TEXT NOT NULL REFERENCES team_work_items(id) ON DELETE CASCADE,
              sequence INTEGER NOT NULL,
              type TEXT NOT NULL,
              detail TEXT NOT NULL,
              created_at TEXT NOT NULL,
              UNIQUE(team_id, sequence)
            );

            CREATE INDEX IF NOT EXISTS team_work_item_events_work_item
              ON team_work_item_events(work_item_id, sequence);
          `);
        },
        version: 9,
      },
      {
        name: "team-work-item-acceptance",
        up: (database) => {
          const columns = database.prepare("PRAGMA table_info(team_work_items)").all() as DatabaseRow[];
          if (!columns.some((column) => column.name === "accepted_criteria_json")) {
            database.exec("ALTER TABLE team_work_items ADD COLUMN accepted_criteria_json TEXT NOT NULL DEFAULT '[]'");
          }
        },
        version: 10,
      },
      {
        name: "team-work-item-source-conversation",
        up: (database) => {
          const columns = database.prepare("PRAGMA table_info(team_work_items)").all() as DatabaseRow[];
          if (!columns.some((column) => column.name === "source_conversation_id")) {
            database.exec(
              "ALTER TABLE team_work_items ADD COLUMN source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL",
            );
          }
          database.exec(
            "CREATE INDEX IF NOT EXISTS team_work_items_source_conversation ON team_work_items(source_conversation_id)",
          );
        },
        version: 11,
      },
      {
        name: "team-durable-member-conversations",
        up: (database) => {
          database.exec(`
            CREATE TABLE team_work_items_next (
              id TEXT PRIMARY KEY,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              requirement TEXT NOT NULL,
              acceptance_criteria_json TEXT NOT NULL,
              priority TEXT NOT NULL CHECK(priority IN ('high', 'normal', 'low')),
              status TEXT NOT NULL CHECK(status IN (
                'inbox', 'triaging', 'needs_clarification', 'planned', 'queued', 'running',
                'waiting_user', 'blocked', 'reviewing', 'completed', 'failed', 'cancelled'
              )),
              revision INTEGER NOT NULL,
              permission_mode TEXT NOT NULL,
              model_selection_json TEXT NOT NULL,
              execution_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
              active_run_id TEXT UNIQUE REFERENCES runs(id) ON DELETE SET NULL,
              result_summary TEXT,
              blocked_reason TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              completed_at TEXT,
              accepted_criteria_json TEXT NOT NULL DEFAULT '[]',
              source_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL
            );

            INSERT INTO team_work_items_next (
              id, team_id, project_id, title, requirement, acceptance_criteria_json,
              priority, status, revision, permission_mode, model_selection_json,
              execution_conversation_id, active_run_id, result_summary, blocked_reason,
              created_at, updated_at, completed_at, accepted_criteria_json, source_conversation_id
            )
            SELECT
              id, team_id, project_id, title, requirement, acceptance_criteria_json,
              priority, status, revision, permission_mode, model_selection_json,
              execution_conversation_id, active_run_id, result_summary, blocked_reason,
              created_at, updated_at, completed_at, accepted_criteria_json, source_conversation_id
            FROM team_work_items;

            DROP TABLE team_work_items;
            ALTER TABLE team_work_items_next RENAME TO team_work_items;

            CREATE INDEX team_work_items_team_status
              ON team_work_items(team_id, status, priority, created_at);
            CREATE INDEX team_work_items_project_status
              ON team_work_items(project_id, status, created_at);
            CREATE INDEX team_work_items_source_conversation
              ON team_work_items(source_conversation_id);

            CREATE TABLE IF NOT EXISTS team_execution_conversations (
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
              source_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
              scope_key TEXT NOT NULL,
              conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (team_id, scope_key)
            );

            CREATE INDEX IF NOT EXISTS team_execution_conversations_source
              ON team_execution_conversations(source_conversation_id, team_id);

            CREATE TABLE IF NOT EXISTS team_member_conversations (
              team_execution_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              agent_id TEXT NOT NULL,
              conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (team_execution_conversation_id, agent_id)
            );

            CREATE INDEX IF NOT EXISTS team_member_conversations_member
              ON team_member_conversations(conversation_id);

            CREATE TABLE IF NOT EXISTS team_work_item_member_assignments (
              id TEXT PRIMARY KEY,
              work_item_id TEXT NOT NULL REFERENCES team_work_items(id) ON DELETE CASCADE,
              member_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              message_id TEXT NOT NULL UNIQUE REFERENCES conversation_agent_messages(id) ON DELETE CASCADE,
              title TEXT NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS team_work_item_member_assignments_work_item
              ON team_work_item_member_assignments(work_item_id, created_at);

            INSERT OR IGNORE INTO team_execution_conversations (
              team_id, project_id, source_conversation_id, scope_key, conversation_id, created_at, updated_at
            )
            SELECT
              team_id,
              project_id,
              source_conversation_id,
              CASE
                WHEN source_conversation_id IS NULL THEN 'project:' || project_id
                ELSE 'conversation:' || source_conversation_id
              END,
              execution_conversation_id,
              created_at,
              updated_at
            FROM team_work_items
            WHERE execution_conversation_id IS NOT NULL
            ORDER BY updated_at DESC, rowid DESC;
          `);
        },
        version: 12,
      },
      {
        name: "team-work-item-execution-scope",
        up: (database) => {
          const columns = database.prepare("PRAGMA table_info(team_work_items)").all() as DatabaseRow[];
          if (!columns.some((column) => column.name === "execution_scope")) {
            database.exec(
              "ALTER TABLE team_work_items ADD COLUMN execution_scope TEXT NOT NULL DEFAULT 'conversation' CHECK(execution_scope IN ('project', 'conversation'))",
            );
            database.exec(
              "UPDATE team_work_items SET execution_scope = 'project' WHERE source_conversation_id IS NULL",
            );
          }
        },
        version: 13,
      },
      {
        name: "team-instance-names",
        up: (database) => {
          database.exec(`
            CREATE TABLE IF NOT EXISTS team_instances (
              id TEXT PRIMARY KEY,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              scope TEXT NOT NULL CHECK(scope IN ('global', 'project', 'conversation')),
              project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
              source_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
              name TEXT NOT NULL,
              root_conversation_id TEXT UNIQUE REFERENCES conversations(id) ON DELETE SET NULL,
              archived_at TEXT,
              deleted_at TEXT,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS team_instances_owner
              ON team_instances(scope, project_id, source_conversation_id, archived_at, deleted_at);
            CREATE INDEX IF NOT EXISTS team_instances_team
              ON team_instances(team_id, archived_at, deleted_at);

            INSERT OR IGNORE INTO team_instances (
              id, team_id, scope, project_id, source_conversation_id, name,
              root_conversation_id, archived_at, deleted_at, created_at, updated_at
            )
            SELECT
              coordinator_conversation_id,
              id,
              'global',
              NULL,
              NULL,
              name,
              coordinator_conversation_id,
              NULL,
              NULL,
              created_at,
              updated_at
            FROM teams
            WHERE coordinator_conversation_id IS NOT NULL;

            INSERT OR IGNORE INTO team_instances (
              id, team_id, scope, project_id, source_conversation_id, name,
              root_conversation_id, archived_at, deleted_at, created_at, updated_at
            )
            SELECT
              binding.conversation_id,
              binding.team_id,
              CASE WHEN binding.source_conversation_id IS NULL THEN 'project' ELSE 'conversation' END,
              binding.project_id,
              binding.source_conversation_id,
              teams.name,
              binding.conversation_id,
              NULL,
              NULL,
              binding.created_at,
              binding.updated_at
            FROM team_execution_conversations AS binding
            JOIN teams ON teams.id = binding.team_id;

            INSERT OR IGNORE INTO team_instances (
              id, team_id, scope, project_id, source_conversation_id, name,
              root_conversation_id, archived_at, deleted_at, created_at, updated_at
            )
            SELECT
              MIN(work_item.id),
              work_item.team_id,
              CASE WHEN work_item.execution_scope = 'conversation' THEN 'conversation' ELSE 'project' END,
              work_item.project_id,
              CASE WHEN work_item.execution_scope = 'conversation'
                THEN work_item.source_conversation_id ELSE NULL END,
              teams.name,
              NULL,
              NULL,
              NULL,
              MIN(work_item.created_at),
              MAX(work_item.updated_at)
            FROM team_work_items AS work_item
            JOIN teams ON teams.id = work_item.team_id
            WHERE NOT EXISTS (
              SELECT 1 FROM team_instances AS instance
              WHERE instance.team_id = work_item.team_id
                AND instance.project_id = work_item.project_id
                AND instance.scope = CASE
                  WHEN work_item.execution_scope = 'conversation' THEN 'conversation' ELSE 'project' END
                AND (
                  (work_item.execution_scope = 'project' AND instance.source_conversation_id IS NULL)
                  OR instance.source_conversation_id = work_item.source_conversation_id
                )
            )
            GROUP BY
              work_item.team_id,
              work_item.project_id,
              work_item.execution_scope,
              CASE WHEN work_item.execution_scope = 'conversation'
                THEN work_item.source_conversation_id ELSE NULL END;
          `);

          const workItemColumns = database.prepare("PRAGMA table_info(team_work_items)").all() as DatabaseRow[];
          if (!workItemColumns.some((column) => column.name === "team_instance_id")) {
            database.exec("ALTER TABLE team_work_items ADD COLUMN team_instance_id TEXT");
          }
          database.exec(`
            UPDATE team_work_items
            SET team_instance_id = (
              SELECT instance.id
              FROM team_instances AS instance
              WHERE instance.team_id = team_work_items.team_id
                AND instance.project_id = team_work_items.project_id
                AND instance.scope = CASE
                  WHEN team_work_items.execution_scope = 'conversation' THEN 'conversation' ELSE 'project' END
                AND (
                  (team_work_items.execution_scope = 'project' AND instance.source_conversation_id IS NULL)
                  OR instance.source_conversation_id = team_work_items.source_conversation_id
                )
              ORDER BY instance.created_at ASC
              LIMIT 1
            )
            WHERE team_instance_id IS NULL;

            CREATE INDEX IF NOT EXISTS team_work_items_instance_status
              ON team_work_items(team_instance_id, status, created_at);

            CREATE TABLE team_execution_conversations_next (
              team_instance_id TEXT NOT NULL REFERENCES team_instances(id) ON DELETE CASCADE,
              team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
              project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
              source_conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
              scope_key TEXT NOT NULL,
              conversation_id TEXT NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
              created_at TEXT NOT NULL,
              updated_at TEXT NOT NULL,
              PRIMARY KEY (team_instance_id, scope_key)
            );

            INSERT INTO team_execution_conversations_next (
              team_instance_id, team_id, project_id, source_conversation_id,
              scope_key, conversation_id, created_at, updated_at
            )
            SELECT
              instance.id,
              binding.team_id,
              binding.project_id,
              binding.source_conversation_id,
              binding.scope_key,
              binding.conversation_id,
              binding.created_at,
              binding.updated_at
            FROM team_execution_conversations AS binding
            JOIN team_instances AS instance
              ON instance.root_conversation_id = binding.conversation_id;

            DROP TABLE team_execution_conversations;
            ALTER TABLE team_execution_conversations_next RENAME TO team_execution_conversations;

            CREATE INDEX team_execution_conversations_source
              ON team_execution_conversations(source_conversation_id, team_id);
            CREATE INDEX team_execution_conversations_instance
              ON team_execution_conversations(team_instance_id, project_id, source_conversation_id);
          `);
        },
        version: 14,
      },
      {
        name: "project-team-navigator-visibility",
        up: (database) => {
          const columns = database
            .prepare("PRAGMA table_info(projects)")
            .all() as DatabaseRow[];
          if (!columns.some((column) => column.name === "show_teams_in_navigator")) {
            database.exec(`
              ALTER TABLE projects
              ADD COLUMN show_teams_in_navigator INTEGER NOT NULL DEFAULT 0;
            `);
          }
        },
        version: 15,
      },
      {
        name: "team-instance-sort-order",
        up: (database) => {
          const columns = database
            .prepare("PRAGMA table_info(team_instances)")
            .all() as DatabaseRow[];
          if (!columns.some((column) => column.name === "sort_order")) {
            database.exec(
              "ALTER TABLE team_instances ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            );
          }
          const rows = database.prepare(
            `SELECT id FROM team_instances
             WHERE scope IN ('global', 'project') AND deleted_at IS NULL
             ORDER BY created_at ASC, rowid ASC`,
          ).all() as DatabaseRow[];
          const update = database.prepare(
            "UPDATE team_instances SET sort_order = ? WHERE id = ?",
          );
          rows.forEach((row, index) => update.run(index, asString(row, "id")));
        },
        version: 16,
      },
      {
        name: "team-collaboration-plans",
        up: (database) => {
          const messageColumns = database
            .prepare("PRAGMA table_info(conversation_agent_messages)")
            .all() as DatabaseRow[];
          if (!messageColumns.some((column) => column.name === "work_item_id")) {
            database.exec(`
              ALTER TABLE conversation_agent_messages
              ADD COLUMN work_item_id TEXT REFERENCES team_work_items(id) ON DELETE SET NULL;
            `);
          }
          database.exec(`
            CREATE INDEX IF NOT EXISTS conversation_agent_messages_work_item
              ON conversation_agent_messages(work_item_id, created_at);

            CREATE TABLE IF NOT EXISTS team_collaboration_plans (
              id TEXT PRIMARY KEY,
              work_item_id TEXT NOT NULL REFERENCES team_work_items(id) ON DELETE CASCADE,
              revision INTEGER NOT NULL,
              status TEXT NOT NULL CHECK(status IN ('active', 'superseded')),
              created_by_conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
              reason TEXT NOT NULL,
              created_at TEXT NOT NULL,
              activated_at TEXT NOT NULL,
              superseded_at TEXT,
              UNIQUE(work_item_id, revision)
            );

            CREATE UNIQUE INDEX IF NOT EXISTS team_collaboration_plans_active
              ON team_collaboration_plans(work_item_id) WHERE status = 'active';

            CREATE TABLE IF NOT EXISTS team_collaboration_plan_nodes (
              id TEXT PRIMARY KEY,
              plan_id TEXT NOT NULL REFERENCES team_collaboration_plans(id) ON DELETE CASCADE,
              stable_agent_id TEXT,
              conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
              kind TEXT NOT NULL CHECK(kind IN ('team_lead', 'standing', 'ephemeral', 'placeholder')),
              name_snapshot TEXT NOT NULL,
              role_snapshot TEXT NOT NULL,
              position_x REAL NOT NULL,
              position_y REAL NOT NULL,
              created_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS team_collaboration_plan_nodes_plan
              ON team_collaboration_plan_nodes(plan_id, created_at);

            CREATE TABLE IF NOT EXISTS team_collaboration_plan_routes (
              id TEXT PRIMARY KEY,
              plan_id TEXT NOT NULL REFERENCES team_collaboration_plans(id) ON DELETE CASCADE,
              from_node_id TEXT NOT NULL REFERENCES team_collaboration_plan_nodes(id) ON DELETE CASCADE,
              to_node_id TEXT NOT NULL REFERENCES team_collaboration_plan_nodes(id) ON DELETE CASCADE,
              purposes_json TEXT NOT NULL,
              optional INTEGER NOT NULL DEFAULT 0,
              created_at TEXT NOT NULL,
              UNIQUE(plan_id, from_node_id, to_node_id)
            );

            CREATE INDEX IF NOT EXISTS team_collaboration_plan_routes_plan
              ON team_collaboration_plan_routes(plan_id, created_at);
          `);
        },
        version: 17,
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
        avatar_icon TEXT,
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
                  OR EXISTS (
                    SELECT 1 FROM team_work_items
                    WHERE team_work_items.execution_conversation_id = runs.conversation_id
                  )
                  OR EXISTS (
                    SELECT 1 FROM conversations
                    WHERE conversations.id = runs.conversation_id
                      AND conversations.thread_kind = 'subagent'
                  )
                )
              )`
        )
        .run(now);
      this.expirePendingToolApprovalsForTerminalRunsInTransaction();
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

  private hasStableTeamParticipantTitle(conversation: ConversationSummary): boolean {
    return conversation.teamId !== null
      && this.getTeamExecutionConversationIdForParticipant(conversation.id) !== null;
  }

  private agentMessageSenderTitle(conversation: ConversationSummary): string {
    const teamExecutionConversationId = this.getTeamExecutionConversationIdForParticipant(
      conversation.id,
    );
    if (teamExecutionConversationId === null) return conversation.title;
    const agent = this.getConversationAgentBinding(conversation.id);
    if (agent === null) return conversation.title;
    const instanceRow = this.database.prepare(
      `SELECT name FROM team_instances
       WHERE root_conversation_id = ? AND deleted_at IS NULL
       ORDER BY created_at ASC LIMIT 1`,
    ).get(teamExecutionConversationId) as DatabaseRow | undefined;
    if (instanceRow === undefined) return agent.name;
    return `${agent.name} · ${asString(instanceRow, "name")}`.slice(0, 200);
  }

  private withCurrentAgentMessageSenderTitle(
    message: ConversationAgentMessageItem,
  ): ConversationAgentMessageItem {
    const senderTitle = this.agentMessageSenderTitle(
      this.getConversation(message.senderConversationId),
    );
    if (senderTitle === message.senderTitle) return message;
    return conversationAgentMessageItemSchema.parse({ ...message, senderTitle });
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
