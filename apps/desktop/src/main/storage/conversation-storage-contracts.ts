import { userQuestionSchema } from "@agent/protocol";
import { z } from "zod";
import {
  contextCompressionThresholdSchema,
  conversationAgentBindingSchema,
  conversationAgentMessageItemSchema,
  conversationPendingMessageSchema,
  conversationPermissionModeSchema,
  conversationRunStatusSchema,
  modelApiFormatSchema,
  modelReasoningOptionSchema,
  providerIdSchema,
  sendConversationMessageInputSchema,
  conversationSummarySchema,
  conversationTaskListSchema,
  conversationAttachmentSchema,
  type ConversationAttachment,
  type ConversationAgentMessageItem,
  type ConversationMessageItem,
  type ConversationPendingMessage,
  type ConversationRunStatus,
  type ConversationRunFileChange,
  type ConversationAgentBinding,
  type ConversationSummary,
  type ConversationTaskList,
  type ConversationTimelineItem,
  type RunAccepted,
  type SendConversationMessageInput,
} from "@agent/protocol";
import type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";

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

export type ConversationAttachmentStoragePaths = Pick<
  StoredConversationAttachment,
  "extractedTextPath" | "id" | "storedPath"
>;

export type StoredPendingMessage = {
  input: SendConversationMessageInput;
  message: ConversationPendingMessage;
};

export type CancelledPendingMessageAttachmentCleanup = {
  attachments: StoredConversationAttachment[];
  conversationId: string;
  pendingMessageId: string;
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

export type ConversationTurnSummary = {
  conversationId: string;
  coveredThroughSequence: number;
  createdAt: string;
  runId: string;
  summary: string;
};

export const conversationTurnSummarySchema = z.object({
  conversationId: z.string().uuid(),
  coveredThroughSequence: z.number().int().positive(),
  createdAt: z.string().datetime(),
  runId: z.string().uuid(),
  summary: z.string().min(1).max(100_000),
}).strict();

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
  sourceModifiedAtMs: number | null;
  sourceSizeBytes: number | null;
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

export type PreparedConversationCreation = {
  agent: ConversationAgentBinding | null;
  conversation: ConversationSummary;
};

export type ThreadLogLegacySnapshot = {
  agent: ConversationAgentBinding | null;
  agentMessages: ThreadLogLegacyAgentMessage[];
  attachmentRefs: ConversationAttachment[];
  checkpoint: ConversationContextCheckpoint | null;
  conversation: ConversationSummary;
  modelMessages: StoredContextMessage[];
  pendingMessages: StoredPendingMessage[];
  subagentTasks: SubagentTask[];
  taskList: ConversationTaskList | null;
  timeline: ConversationTimelineItem[];
  turnSummaries: ConversationTurnSummary[];
  runs: ThreadLogLegacyRun[];
};

export type ThreadLogLegacyAgentMessage = {
  message: ConversationAgentMessageItem;
  workItemId: string | null;
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
  id?: string;
  autoWake?: boolean;
  deliveryMode?: "queue" | "steer";
  content: string;
  executionStatus?: "completed" | "failed" | "cancelled";
  summaryStatus?: "provided" | "missing";
  executionError?: string | null;
  fileChanges?: readonly ConversationRunFileChange[];
  messageType?: "message" | "notification" | "agent_result" | "task_result";
  replyInstruction?: string | null;
  runId: string;
  senderConversationId: string;
  taskId?: string | null;
  targetConversationId: string;
};

export type SubagentTaskStatus = "queued" | "running" | "completed" | "failed" | "cancelled" | "ended";

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

export type RunCreation = RunAccepted & {
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

export const threadLogSubagentTaskSchema = z.object({
  childConversationId: z.string().uuid(),
  completedAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
  error: z.string().nullable(),
  id: z.string().uuid(),
  parentConversationId: z.string().uuid(),
  result: z.string().nullable(),
  resultMessageId: z.string().uuid().nullable(),
  sourceRunId: z.string().uuid(),
  status: z.enum(["queued", "running", "completed", "failed", "cancelled", "ended"]),
  targetRunId: z.string().uuid().nullable(),
  task: z.string(),
  title: z.string(),
  updatedAt: z.string().datetime(),
}).strict();

export const threadLogPendingMessagesSchema = z.object({
  pendingMessages: z.array(z.object({
    input: sendConversationMessageInputSchema,
    message: conversationPendingMessageSchema,
  }).strict()),
}).strict();

export const threadLogStartupStateSchema = z.object({
  format: z.literal(2),
  executionPaused: z.boolean().default(false),
  terminalResults: z.array(z.object({ runId: z.string().uuid(), result: z.string().nullable() }).strict()).default([]),
  userQuestions: z.array(userQuestionSchema).default([]),
  deliveredQuestionIds: z.array(z.string().uuid()).default([]),
  agent: conversationAgentBindingSchema.nullable(),
  conversation: conversationSummarySchema,
  sortOrder: z.number().int().nonnegative(),
  attachmentRefs: z.array(conversationAttachmentSchema),
  agentMessages: z.array(z.object({ message: conversationAgentMessageItemSchema, workItemId: z.string().uuid().nullable() }).strict()),
  pendingMessages: threadLogPendingMessagesSchema.shape.pendingMessages,
  subagentTasks: z.array(threadLogSubagentTaskSchema),
  taskList: conversationTaskListSchema.nullable(),
  runs: z.array(z.object({
    id: z.string().uuid(), modelId: z.string(), status: conversationRunStatusSchema,
    error: z.string().nullable(), executionSnapshotJson: z.string().nullable(),
    createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  }).strict()),
  checkpoint: z.null(),
  modelMessages: z.array(z.never()).max(0),
  timeline: z.array(z.never()).max(0),
  turnSummaries: z.array(z.never()).max(0),
}).strict();

export type CompletedRun = {
  assistantMessage: ConversationMessageItem | null;
  subagentResultMessage: ConversationAgentMessageItem | null;
  subagentTask: SubagentTask | null;
};

export const runExecutionSnapshotSchema = z.object({
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

export type ReplaceLatestUserMessageInput = {
  attachmentIds: readonly string[];
  content: string;
  conversationId: string;
  executionSnapshot?: RunExecutionSnapshot;
  messageId: string;
  modelContent: string;
  modelId: string;
};

export type UserTimelineRecord = {
  message: ConversationMessageItem;
  sequence: number;
};

export type UserModelMessageRecord = {
  attachmentIds: string[];
  content: string;
  id: string;
  sequence: number;
};

export type AgentMessageRunCreation = {
  conversation: ConversationSummary;
  runId: string;
};
