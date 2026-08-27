import { z } from "zod";

import { agentErrorSchema } from "./agent-error.js";

import {
  contextCompressionModeSchema,
  contextCompressionThresholdSchema,
} from "./context-compression.js";
import { projectIdSchema, relativeProjectPathSchema } from "./project.js";

const MAX_TITLE_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 200_000;
const MAX_TOOL_PAYLOAD_LENGTH = 500_000;
const MAX_AGENT_INSTRUCTIONS_LENGTH = 20_000;
const MAX_CONVERSATION_ATTACHMENTS = 10;
const MAX_CONVERSATION_REFERENCES = 5;
const MAX_PROJECT_FILE_REFERENCES = 10;
const MAX_ATTACHMENT_BYTES = 25 * 1_024 * 1_024;

const projectFileReferenceListSchema = z
  .array(
    relativeProjectPathSchema.refine((value) => value.length > 0, {
      message: "A referenced project file path is required."
    })
  )
  .max(MAX_PROJECT_FILE_REFERENCES)
  .refine((paths) => new Set(paths).size === paths.length, {
    message: "Referenced project file paths must be unique."
  });

export const ARCHIVED_CONVERSATION_RETENTION_DAYS = 30;

export const conversationIdSchema = z.string().uuid();
export const runIdSchema = z.string().uuid();
export const timelineItemIdSchema = z.string().uuid();
export const isoTimestampSchema = z.string().datetime({ offset: true });
export const providerIdSchema = z.string().uuid();

export const modelReasoningEffortSchema = z.enum([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max"
]);

const modelReasoningOptionMetadataSchema = {
  displayName: z.string().trim().min(1).max(64).optional(),
  enabled: z.boolean().optional()
};

export const modelReasoningOptionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("effort"),
    value: modelReasoningEffortSchema,
    ...modelReasoningOptionMetadataSchema
  }).strict(),
  z.object({
    kind: z.literal("custom_effort"),
    value: z.string().trim().min(1).max(64),
    ...modelReasoningOptionMetadataSchema
  }).strict(),
  z.object({
    kind: z.literal("token_budget"),
    value: z.number().int().min(-1).max(1_000_000),
    ...modelReasoningOptionMetadataSchema
  }).strict()
]);

export const conversationModelSelectionSchema = z.object({
  modelId: z.string().trim().min(1).max(200),
  providerId: providerIdSchema,
  reasoning: modelReasoningOptionSchema.nullable().default(null)
}).strict();

export const conversationRunStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled"
]);

export const conversationThreadKindSchema = z.enum([
  "agent",
  "team_lead",
  "subagent"
]);

export const conversationAgentBindingSchema = z
  .object({
    id: z.string().trim().min(1).max(200),
    instructions: z.string().trim().max(MAX_AGENT_INSTRUCTIONS_LENGTH),
    isDefault: z.boolean(),
    name: z.string().trim().min(1).max(200),
    role: z.string().trim().max(500)
  })
  .strict();

export const conversationAttachmentSchema = z
  .object({
    contextTokens: z.number().int().nonnegative(),
    conversationId: conversationIdSchema,
    createdAt: isoTimestampSchema,
    id: z.string().uuid(),
    kind: z.enum(["file", "image"]),
    messageId: timelineItemIdSchema.nullable(),
    mimeType: z.string().trim().min(1).max(255),
    name: z.string().trim().min(1).max(255),
    projectPath: z.string().trim().min(1).max(4_096).nullable(),
    sizeBytes: z.number().int().nonnegative().max(MAX_ATTACHMENT_BYTES),
    source: z.enum(["project", "upload"]),
    truncated: z.boolean()
  })
  .strict();

export const conversationAttachmentListSchema = z.array(conversationAttachmentSchema);

export const removeConversationAttachmentInputSchema = z
  .object({
    attachmentId: z.string().uuid(),
    conversationId: conversationIdSchema
  })
  .strict();

/**
 * Renderer-safe envelope for a clipboard or drag-and-drop Blob. Binary data
 * crosses IPC as bounded base64 and is immediately copied into managed storage
 * by Main; no renderer-supplied filesystem path is accepted.
 */
export const importConversationAttachmentBytesInputSchema = z
  .object({
    base64: z.string()
      .min(4)
      .max(Math.ceil(MAX_ATTACHMENT_BYTES * 4 / 3) + 4)
      .regex(/^[A-Za-z0-9+/]*={0,2}$/u)
      .refine((value) => value.length % 4 === 0, {
        message: "Attachment base64 must contain complete quartets.",
      }),
    conversationId: conversationIdSchema,
    mimeType: z.string().trim().min(3).max(200).optional(),
    name: z.string().trim().min(1).max(255),
  })
  .strict();

export const conversationSummarySchema = z
  .object({
    activeSubagentCount: z.number().int().nonnegative().default(0),
    activeRunId: runIdSchema.nullable(),
    agentId: z.string().trim().min(1).max(200).nullable().default(null),
    archivedAt: isoTimestampSchema.nullable().default(null),
    createdAt: isoTimestampSchema,
    hasUnreadResult: z.boolean().default(false),
    id: conversationIdSchema,
    isArchived: z.boolean().default(false),
    isPinned: z.boolean().default(false),
    lastRunStatus: conversationRunStatusSchema.nullable(),
    modelSelection: conversationModelSelectionSchema.nullable().default(null),
    parentConversationId: conversationIdSchema.nullable().default(null),
    pinOrder: z.number().int().positive().nullable().optional(),
    projectId: projectIdSchema.nullable(),
    subagentTaskStatus: z.enum([
      "queued",
      "running",
      "completed",
      "failed",
      "cancelled"
    ]).nullable().optional(),
    teamId: z.string().trim().min(1).max(200).nullable().default(null),
    threadKind: conversationThreadKindSchema.default("agent"),
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    updatedAt: isoTimestampSchema,
    workspaceRootPath: z.string().trim().min(1).max(4_096).nullable().default(null)
  })
  .strict();

export const conversationListResponseSchema = z.array(conversationSummarySchema);
export const conversationWorkspaceSelectionResponseSchema = conversationSummarySchema.nullable();

export const conversationTaskStatusSchema = z.enum([
  "pending",
  "running",
  "completed",
  "blocked",
  "failed"
]);

export const conversationTaskListStatusSchema = z.enum(["active", "closed"]);

export const conversationTaskSchema = z
  .object({
    id: timelineItemIdSchema,
    reason: z.string().trim().min(1).max(600).nullable().default(null),
    status: conversationTaskStatusSchema,
    title: z.string().trim().min(1).max(300)
  })
  .strict()
  .superRefine((task, context) => {
    if ((task.status === "blocked" || task.status === "failed") || task.reason === null) return;
    context.addIssue({
      code: "custom",
      message: "Only blocked and failed tasks may include a reason.",
      path: ["reason"]
    });
  });

const conversationTaskCollectionSchema = z
  .array(conversationTaskSchema)
  .min(1)
  .max(20)
  .superRefine((tasks, context) => {
    if (tasks.filter((task) => task.status === "running").length > 1) {
      context.addIssue({
        code: "custom",
        message: "A task list can only have one running task.",
        path: []
      });
    }
  });

export const conversationTaskListSchema = z
  .object({
    closedAt: isoTimestampSchema.nullable().default(null),
    conversationId: conversationIdSchema,
    createdAt: isoTimestampSchema.nullable().optional(),
    status: conversationTaskListStatusSchema.default("active"),
    tasks: conversationTaskCollectionSchema,
    updatedAt: isoTimestampSchema
  })
  .strict();

export const conversationTaskListResponseSchema = conversationTaskListSchema.nullable();

export const createConversationInputSchema = z
  .object({
    agent: conversationAgentBindingSchema.optional(),
    modelSelection: conversationModelSelectionSchema.optional(),
    projectId: projectIdSchema.nullable().optional(),
    teamId: z.string().trim().min(1).max(200).nullable().optional(),
    threadKind: z.enum(["agent", "team_lead"]).optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.threadKind === "team_lead" && value.teamId == null) {
      context.addIssue({
        code: "custom",
        message: "A Team Lead conversation must belong to a team.",
        path: ["teamId"]
      });
    }
    if ((value.threadKind === "team_lead" || value.teamId != null) && value.agent === undefined) {
      context.addIssue({
        code: "custom",
        message: "A team conversation must identify its Agent profile.",
        path: ["agent"]
      });
    }
  });

export const renameConversationInputSchema = z
  .object({
    conversationId: conversationIdSchema,
    title: z.string().trim().min(1).max(MAX_TITLE_LENGTH)
  })
  .strict();

export const setConversationProjectInputSchema = z
  .object({
    conversationId: conversationIdSchema,
    projectId: projectIdSchema.nullable()
  })
  .strict();

export const setConversationModelSelectionInputSchema = z
  .object({
    conversationId: conversationIdSchema,
    modelSelection: conversationModelSelectionSchema
  })
  .strict();

export const conversationReferenceInputSchema = z
  .object({ conversationId: conversationIdSchema })
  .strict();

const teamIdInputSchema = z.string().trim().min(1).max(200);

export const setTeamCoordinatorInputSchema = z
  .object({
    conversationId: conversationIdSchema,
    teamId: teamIdInputSchema,
  })
  .strict();

export const forkConversationInputSchema = z
  .object({
    conversationId: conversationIdSchema,
    throughMessageId: timelineItemIdSchema.optional()
  })
  .strict();

export const setConversationArchivedInputSchema = z
  .object({
    archived: z.boolean(),
    conversationId: conversationIdSchema
  })
  .strict();

export const setConversationPinnedInputSchema = z
  .object({
    conversationId: conversationIdSchema,
    pinned: z.boolean()
  })
  .strict();

export const reorderConversationsInputSchema = z
  .object({
    conversationIds: z.array(conversationIdSchema).min(1).max(10_000)
  })
  .strict();

export const conversationMessageRoleSchema = z.enum(["user", "assistant"]);
export const conversationMessageStatusSchema = z.enum([
  "streaming",
  "completed",
  "failed",
  "cancelled"
]);

export const conversationMessageItemSchema = z
  .object({
    attachments: z.array(conversationAttachmentSchema).max(MAX_CONVERSATION_ATTACHMENTS).default([]),
    completedAt: isoTimestampSchema.nullable().optional(),
    content: z.string().max(MAX_MESSAGE_LENGTH),
    conversationId: conversationIdSchema,
    createdAt: isoTimestampSchema,
    durationMs: z.number().int().nonnegative().nullable().optional(),
    id: timelineItemIdSchema,
    kind: z.literal("message"),
    modelId: z.string().min(1).max(200).nullable(),
    role: conversationMessageRoleSchema,
    runId: runIdSchema.nullable(),
    status: conversationMessageStatusSchema
  })
  .strict();

export const conversationToolStatusSchema = z.enum([
  "running",
  "awaiting_approval",
  "completed",
  "failed",
  "rejected"
]);

/** Scheduler decision recorded for observability; omitted on legacy tool rows. */
export const conversationToolExecutionModeSchema = z.enum(["serial", "parallel"]);

export const conversationToolItemSchema = z
  .object({
    arguments: z.string().max(MAX_TOOL_PAYLOAD_LENGTH),
    batchId: z.string().uuid().nullable().optional().transform((value) => value ?? null),
    conversationId: conversationIdSchema,
    createdAt: isoTimestampSchema,
    diff: z.string().max(MAX_TOOL_PAYLOAD_LENGTH).nullable(),
    id: timelineItemIdSchema,
    kind: z.literal("tool"),
    name: z.string().min(1).max(120),
    result: z.string().max(MAX_TOOL_PAYLOAD_LENGTH).nullable(),
    runId: runIdSchema,
    status: conversationToolStatusSchema,
    executionMode: conversationToolExecutionModeSchema.optional(),
  })
  .strict();

export const conversationAgentMessageStatusSchema = z.enum(["unread", "read"]);
export const conversationAgentMessageTypeSchema = z.enum([
  "message",
  "notification",
  "agent_result",
  "task_result",
]);

export const conversationAgentMessageItemSchema = z
  .object({
    content: z.string().trim().min(1).max(20_000),
    conversationId: conversationIdSchema,
    createdAt: isoTimestampSchema,
    id: timelineItemIdSchema,
    kind: z.literal("agent_message"),
    messageType: conversationAgentMessageTypeSchema.default("message"),
    readAt: isoTimestampSchema.nullable(),
    runId: runIdSchema.nullable(),
    senderConversationId: conversationIdSchema,
    senderTitle: z.string().trim().min(1).max(MAX_TITLE_LENGTH),
    status: conversationAgentMessageStatusSchema,
    taskId: timelineItemIdSchema.nullable().default(null)
  })
  .strict();

export const conversationTimelineItemSchema = z.discriminatedUnion("kind", [
  conversationAgentMessageItemSchema,
  conversationMessageItemSchema,
  conversationToolItemSchema
]);

export const conversationTimelineResponseSchema = z.array(
  conversationTimelineItemSchema
);

export const conversationPermissionModeSchema = z.enum([
  "read_only",
  "ask_before_changes",
  "full_access"
]);

export const conversationMessageDeliveryModeSchema = z.enum(["queue", "steer"]);

export const conversationPendingMessageSchema = z
  .object({
    attachmentIds: z.array(z.string().uuid()).max(MAX_CONVERSATION_ATTACHMENTS),
    content: z.string().max(MAX_MESSAGE_LENGTH),
    conversationId: conversationIdSchema,
    createdAt: isoTimestampSchema,
    deliveryMode: conversationMessageDeliveryModeSchema,
    id: z.string().uuid(),
    referencedConversationIds: z.array(conversationIdSchema).max(MAX_CONVERSATION_REFERENCES),
    referencedProjectPaths: projectFileReferenceListSchema
  })
  .strict();

export const conversationPendingMessageListSchema = z.array(conversationPendingMessageSchema);

export const pendingConversationMessageReferenceInputSchema = z
  .object({ pendingMessageId: z.string().uuid() })
  .strict();

export const updatePendingConversationMessageInputSchema = z
  .object({
    content: z.string().trim().max(MAX_MESSAGE_LENGTH),
    pendingMessageId: z.string().uuid()
  })
  .strict();

export const reorderPendingConversationMessagesInputSchema = z
  .object({
    conversationId: conversationIdSchema,
    pendingMessageIds: z.array(z.string().uuid()).min(1).max(1_000)
  })
  .strict()
  .refine((value) => new Set(value.pendingMessageIds).size === value.pendingMessageIds.length, {
    message: "Pending message order contains duplicate identifiers.",
    path: ["pendingMessageIds"]
  });

export const conversationContextUsageInputSchema = z
  .object({
    attachmentIds: z.array(z.string().uuid()).max(MAX_CONVERSATION_ATTACHMENTS).optional(),
    conversationId: conversationIdSchema,
    modelId: z.string().trim().min(1).max(200).optional(),
    permissionMode: conversationPermissionModeSchema,
    providerId: z.string().uuid().optional(),
    referencedProjectPaths: projectFileReferenceListSchema.optional(),
    referencedConversationIds: z
      .array(conversationIdSchema)
      .max(MAX_CONVERSATION_REFERENCES)
      .optional()
  })
  .strict();

export const conversationContextUsageSchema = z
  .object({
    compressionMode: contextCompressionModeSchema,
    compressionThresholdTokens: z.number().int().positive(),
    estimatedConversationTokens: z.number().int().nonnegative(),
    estimatedAttachmentTokens: z.number().int().nonnegative().default(0),
    estimatedReferenceTokens: z.number().int().nonnegative().default(0),
    estimatedInputTokens: z.number().int().nonnegative(),
    estimatedSystemTokens: z.number().int().nonnegative(),
    estimatedToolDefinitionTokens: z.number().int().nonnegative(),
    estimatedToolTokens: z.number().int().nonnegative(),
    historyCharacters: z.number().int().nonnegative(),
    includedMessageCount: z.number().int().nonnegative(),
    omittedMessageCount: z.number().int().nonnegative(),
    outputReserveTokens: z.number().int().nonnegative()
  })
  .strict();

export const providerNameSchema = z.string().trim().min(1).max(100);
export const modelProviderIconSchema = z.enum([
  "aihubmix",
  "anthropic",
  "baidu",
  "cloudflare",
  "deepseek",
  "google",
  "huggingface",
  "meta",
  "minimax",
  "mistral",
  "modelscope",
  "moonshot",
  "new-api",
  "nvidia",
  "one-api",
  "ollama",
  "openai",
  "openrouter",
  "qwen",
  "replicate",
  "siliconflow",
  "xai",
  "zhipu",
  "auto"
]);
export const modelApiFormatSchema = z.enum([
  "openai-chat-completions",
  "openai-responses",
  "anthropic-messages",
  "google-gemini"
]);

const OPENAI_CHAT_REASONING_EFFORTS = new Set(["low", "medium", "high"]);
const GPT_5_6_REASONING_EFFORTS = new Set(["none", "low", "medium", "high", "xhigh", "max"]);
const GEMINI_3_THINKING_LEVELS = new Set(["minimal", "low", "medium", "high"]);

export function isGpt56ReasoningModel(modelId: string): boolean {
  const normalizedModelId = modelId.trim().toLocaleLowerCase();
  return normalizedModelId === "gpt-5.6" || normalizedModelId.startsWith("gpt-5.6-");
}

export function isGemini3ReasoningModel(modelId: string): boolean {
  const normalizedModelId = modelId.trim().toLocaleLowerCase().replace(/^models\//, "");
  return normalizedModelId === "gemini-3" || normalizedModelId.startsWith("gemini-3.")
    || normalizedModelId.startsWith("gemini-3-");
}

export type ModelReasoningOption = z.infer<typeof modelReasoningOptionSchema>;

export function isReasoningOptionSupportedByApiFormat(
  apiFormat: ModelApiFormat,
  option: ModelReasoningOption,
  modelId = ""
): boolean {
  if (apiFormat === "openai-chat-completions") {
    return option.kind === "custom_effort" || (
      option.kind === "effort" && (
        isGpt56ReasoningModel(modelId)
          ? GPT_5_6_REASONING_EFFORTS.has(option.value)
          : OPENAI_CHAT_REASONING_EFFORTS.has(option.value)
      )
    );
  }
  if (apiFormat === "openai-responses") {
    return option.kind === "custom_effort" || (
      option.kind === "effort" && (
        !isGpt56ReasoningModel(modelId) || GPT_5_6_REASONING_EFFORTS.has(option.value)
      )
    );
  }
  if (apiFormat === "anthropic-messages") {
    return option.kind === "token_budget" && option.value >= 1_024 && option.value < 8_192;
  }
  if (isGemini3ReasoningModel(modelId)) {
    return option.kind === "effort" && GEMINI_3_THINKING_LEVELS.has(option.value);
  }
  return option.kind === "token_budget" && (
    option.value === -1 || option.value >= 0
  );
}

export function isReasoningOptionEnabled(option: ModelReasoningOption): boolean {
  return option.enabled !== false;
}

export function modelReasoningOptionKey(option: ModelReasoningOption): string {
  if (option.kind === "token_budget") return `token_budget:${option.value}`;
  if (option.kind === "custom_effort") return `custom_effort:${option.value}`;
  return `effort:${option.value}`;
}

export const modelConnectionStatusSchema = z.enum(["unknown", "healthy", "error"]);

export const modelProfileSchema = z
  .object({
    connectionStatus: modelConnectionStatusSchema.default("unknown"),
    connectionStatusUpdatedAt: isoTimestampSchema.nullable().default(null),
    contextCompression: contextCompressionThresholdSchema.optional(),
    contextWindow: z.number().int().min(0).max(10_000_000),
    displayName: z.string().trim().min(1).max(200),
    modelId: z.string().trim().min(1).max(200),
    lastSuccessfulAt: isoTimestampSchema.nullable().default(null),
    providerApiFormat: modelApiFormatSchema,
    providerBaseUrl: z.string().url(),
    providerId: providerIdSchema,
    providerName: providerNameSchema,
    providerIcon: modelProviderIconSchema.optional(),
    providerNote: z.string().trim().max(500).optional(),
    providerWebsiteUrl: z.string().url().optional(),
    reasoningOptions: z.array(modelReasoningOptionSchema).max(16)
  })
  .strict();

export const discoveredModelSchema = z
  .object({
    modelId: z.string().trim().min(1).max(200),
    ownedBy: z.string().trim().min(1).max(200).nullable()
  })
  .strict();

export const discoverModelsInputSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(2_000),
    apiFormat: modelApiFormatSchema,
    baseUrl: z.string().url()
  })
  .strict();

export const testModelConnectionInputSchema = z
  .object({
    modelId: z.string().trim().min(1).max(200),
    providerId: providerIdSchema
  })
  .strict();

export const modelConnectionTestResultSchema = z
  .object({
    content: z.string().trim().min(1).max(2_000),
    modelId: z.string().trim().min(1).max(200)
  })
  .strict();

export const saveModelConfigurationInputSchema = z
  .object({
    apiKey: z.string().trim().min(1).max(2_000),
    apiFormat: modelApiFormatSchema,
    baseUrl: z.string().url(),
    models: z
      .array(
        modelProfileSchema.pick({
          contextCompression: true,
          contextWindow: true,
          displayName: true,
          modelId: true,
          reasoningOptions: true
        })
      )
      .min(1)
      .max(100),
    providerId: providerIdSchema.optional(),
    providerIcon: modelProviderIconSchema.optional(),
    providerName: providerNameSchema,
    providerNote: z.string().trim().max(500).optional(),
    providerWebsiteUrl: z.string().url().optional()
  })
  .strict()
  .superRefine((value, context) => {
    const modelIds = new Set<string>();
    for (const [modelIndex, model] of value.models.entries()) {
      if (modelIds.has(model.modelId)) {
        context.addIssue({
          code: "custom",
          message: "A model ID can only be configured once per provider.",
          path: ["models", modelIndex, "modelId"]
        });
      }
      modelIds.add(model.modelId);
      const optionKeys = new Set<string>();
      for (const [optionIndex, option] of model.reasoningOptions.entries()) {
        const key = modelReasoningOptionKey(option);
        if (optionKeys.has(key)) {
          context.addIssue({
            code: "custom",
            message: "A reasoning option can only be configured once per model.",
            path: ["models", modelIndex, "reasoningOptions", optionIndex]
          });
        }
        optionKeys.add(key);
        if (!isReasoningOptionSupportedByApiFormat(value.apiFormat, option, model.modelId)) {
          context.addIssue({
            code: "custom",
            message: "The reasoning option is not supported by this API format.",
            path: ["models", modelIndex, "reasoningOptions", optionIndex]
          });
        }
      }
    }
  });

export const setDefaultModelInputSchema = z
  .object({
    modelId: z.string().trim().min(1).max(200),
    providerId: providerIdSchema
  })
  .strict();

export const sendConversationMessageInputSchema = z
  .object({
    agent: conversationAgentBindingSchema.optional(),
    attachmentIds: z.array(z.string().uuid()).max(MAX_CONVERSATION_ATTACHMENTS).optional(),
    content: z.string().trim().max(MAX_MESSAGE_LENGTH),
    conversationId: conversationIdSchema,
    deliveryMode: conversationMessageDeliveryModeSchema.optional(),
    modelId: z.string().trim().min(1).max(200).optional(),
    permissionMode: conversationPermissionModeSchema.optional(),
    providerId: providerIdSchema.optional(),
    referencedProjectPaths: projectFileReferenceListSchema.optional(),
    referencedConversationIds: z
      .array(conversationIdSchema)
      .max(MAX_CONVERSATION_REFERENCES)
      .optional(),
    reasoning: modelReasoningOptionSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.referencedConversationIds?.includes(value.conversationId) === true) {
      context.addIssue({
        code: "custom",
        message: "A conversation cannot reference itself.",
        path: ["referencedConversationIds"]
      });
    }
    if (
      value.referencedConversationIds !== undefined
      && new Set(value.referencedConversationIds).size !== value.referencedConversationIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Referenced conversations must be unique.",
        path: ["referencedConversationIds"]
      });
    }
    if (
      value.content.length === 0
      && (value.attachmentIds?.length ?? 0) === 0
      && (value.referencedProjectPaths?.length ?? 0) === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "A message must contain text, an attachment, or a project file reference.",
        path: ["content"]
      });
    }
  });

/** A Team delivery resolves to its coordinator Conversation before execution. */
export const sendTeamMessageInputSchema = z
  .object({
    attachmentIds: z.array(z.string().uuid()).max(MAX_CONVERSATION_ATTACHMENTS).optional(),
    content: z.string().trim().max(MAX_MESSAGE_LENGTH),
    deliveryMode: conversationMessageDeliveryModeSchema.optional(),
    modelId: z.string().trim().min(1).max(200).optional(),
    permissionMode: conversationPermissionModeSchema.optional(),
    providerId: providerIdSchema.optional(),
    referencedProjectPaths: projectFileReferenceListSchema.optional(),
    referencedConversationIds: z.array(conversationIdSchema).max(MAX_CONVERSATION_REFERENCES).optional(),
    reasoning: modelReasoningOptionSchema.optional(),
    teamId: teamIdInputSchema,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.referencedConversationIds !== undefined
      && new Set(value.referencedConversationIds).size !== value.referencedConversationIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Referenced conversations must be unique.",
        path: ["referencedConversationIds"],
      });
    }
    if (
      value.content.length === 0
      && (value.attachmentIds?.length ?? 0) === 0
      && (value.referencedProjectPaths?.length ?? 0) === 0
    ) {
      context.addIssue({
        code: "custom",
        message: "A message must contain text, an attachment, or a project file reference.",
        path: ["content"],
      });
    }
  });

export const replaceLatestConversationMessageInputSchema = z
  .object({
    content: z.string().trim().min(1).max(MAX_MESSAGE_LENGTH),
    conversationId: conversationIdSchema,
    messageId: timelineItemIdSchema,
    modelId: z.string().trim().min(1).max(200).optional(),
    permissionMode: conversationPermissionModeSchema.optional(),
    providerId: providerIdSchema.optional(),
    referencedProjectPaths: projectFileReferenceListSchema.optional(),
    referencedConversationIds: z
      .array(conversationIdSchema)
      .max(MAX_CONVERSATION_REFERENCES)
      .optional(),
    reasoning: modelReasoningOptionSchema.optional()
  })
  .strict()
  .superRefine((value, context) => {
    if (value.referencedConversationIds?.includes(value.conversationId) === true) {
      context.addIssue({
        code: "custom",
        message: "A conversation cannot reference itself.",
        path: ["referencedConversationIds"]
      });
    }
    if (
      value.referencedConversationIds !== undefined
      && new Set(value.referencedConversationIds).size !== value.referencedConversationIds.length
    ) {
      context.addIssue({
        code: "custom",
        message: "Referenced conversations must be unique.",
        path: ["referencedConversationIds"]
      });
    }
  });

export const cancelRunInputSchema = z.object({ runId: runIdSchema }).strict();

export const approveToolChangeInputSchema = z
  .object({
    approved: z.boolean(),
    runId: runIdSchema,
    scope: z.enum(["once", "session", "agent"]).default("once"),
    toolId: timelineItemIdSchema
  })
  .strict();

export const runAcceptedSchema = z
  .object({
    runId: runIdSchema,
    userMessage: conversationMessageItemSchema
  })
  .strict();

export const conversationMessageSubmissionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("started"),
      runId: runIdSchema,
      userMessage: conversationMessageItemSchema
    })
    .strict(),
  z
    .object({
      kind: z.literal("pending"),
      pendingMessage: conversationPendingMessageSchema
    })
    .strict()
]);

export const modelRuntimeStatusSchema = z
  .object({
    baseUrl: z.string().url().nullable(),
    configured: z.boolean(),
    modelId: z.string().min(1).max(200).nullable(),
    models: z.array(modelProfileSchema).max(100),
    providerId: providerIdSchema.nullable(),
    recentSelection: conversationModelSelectionSchema.nullable().default(null),
    supportsStreaming: z.boolean(),
    supportsTools: z.boolean()
  })
  .strict();

export const modelApiKeySchema = z.string().trim().min(1).max(2_000).nullable();

export const getModelApiKeyInputSchema = z
  .object({ providerId: providerIdSchema })
  .strict();

const runStartedEventSchema = z
  .object({
    conversationId: conversationIdSchema,
    modelId: z.string().min(1).max(200),
    runId: runIdSchema,
    type: z.literal("run.started")
  })
  .strict();

const modelRequestStartedEventSchema = z
  .object({
    conversationId: conversationIdSchema,
    runId: runIdSchema,
    type: z.literal("model.request_started")
  })
  .strict();

const modelRequestRetryingEventSchema = z
  .object({
    attempt: z.number().int().min(1).max(5),
    conversationId: conversationIdSchema,
    reason: z.string().trim().min(1).max(1_000).optional(),
    retryInMs: z.number().int().positive().max(60_000),
    runId: runIdSchema,
    type: z.literal("model.request_retrying")
  })
  .strict();

const assistantDeltaEventSchema = z
  .object({
    conversationId: conversationIdSchema,
    delta: z.string().min(1).max(MAX_MESSAGE_LENGTH),
    messageId: timelineItemIdSchema,
    modelId: z.string().min(1).max(200),
    runId: runIdSchema,
    type: z.literal("assistant.delta")
  })
  .strict();

const assistantReasoningDeltaEventSchema = z
  .object({
    conversationId: conversationIdSchema,
    delta: z.string().min(1).max(MAX_MESSAGE_LENGTH),
    kind: z.enum(["summary", "content"]),
    reset: z.boolean(),
    runId: runIdSchema,
    type: z.literal("assistant.reasoning_delta")
  })
  .strict();

const taskListUpdatedEventSchema = z
  .object({
    conversationId: conversationIdSchema,
    runId: runIdSchema,
    taskList: conversationTaskListSchema.nullable(),
    type: z.literal("task_list.updated")
  })
  .strict();

const pendingMessagesUpdatedEventSchema = z
  .object({
    conversationId: conversationIdSchema,
    pendingMessages: conversationPendingMessageListSchema,
    type: z.literal("pending_messages.updated")
  })
  .strict();

const toolStartedEventSchema = z
  .object({
    conversationId: conversationIdSchema,
    runId: runIdSchema,
    tool: conversationToolItemSchema,
    type: z.literal("tool.started")
  })
  .strict();

const toolOutputDeltaEventSchema = z
  .object({
    commandId: z.string().uuid(),
    conversationId: conversationIdSchema,
    delta: z.string().max(MAX_MESSAGE_LENGTH),
    done: z.boolean(),
    exitCode: z.number().int().nullable(),
    runId: runIdSchema,
    status: z.enum(["running", "completed", "failed", "cancelled"]),
    stream: z.enum(["stderr", "stdout"]),
    timedOut: z.boolean(),
    toolId: timelineItemIdSchema,
    truncated: z.boolean(),
    type: z.literal("tool.output_delta"),
  })
  .strict();

const toolCompletedEventSchema = z
  .object({
    conversationId: conversationIdSchema,
    fileChange: z
      .object({
        operation: z.enum(["apply_patch", "delete_file", "replace_in_file", "write_file"]),
        path: relativeProjectPathSchema.refine((value) => value.length > 0),
        projectId: projectIdSchema
      })
      .strict()
      .nullable()
      .optional(),
    runId: runIdSchema,
    tool: conversationToolItemSchema,
    type: z.literal("tool.completed")
  })
  .strict();

const toolApprovalRequestedEventSchema = z
  .object({
    conversationId: conversationIdSchema,
    runId: runIdSchema,
    tool: conversationToolItemSchema,
    type: z.literal("tool.approval_requested")
  })
  .strict();

const conversationUpdatedEventSchema = z
  .object({
    conversation: conversationSummarySchema,
    type: z.literal("conversation.updated")
  })
  .strict();

const runFinishedEventSchema = z
  .object({
    agentError: agentErrorSchema.nullable().optional(),
    conversationId: conversationIdSchema,
    error: z.string().max(4_000).nullable(),
    runId: runIdSchema,
    status: z.enum(["completed", "failed", "cancelled"]),
    type: z.literal("run.finished")
  })
  .strict();

export const conversationRunEventSchema = z.discriminatedUnion("type", [
  runStartedEventSchema,
  modelRequestStartedEventSchema,
  modelRequestRetryingEventSchema,
  assistantReasoningDeltaEventSchema,
  assistantDeltaEventSchema,
  taskListUpdatedEventSchema,
  pendingMessagesUpdatedEventSchema,
  toolStartedEventSchema,
  toolOutputDeltaEventSchema,
  toolApprovalRequestedEventSchema,
  toolCompletedEventSchema,
  conversationUpdatedEventSchema,
  runFinishedEventSchema
]);

export type ConversationSummary = z.infer<typeof conversationSummarySchema>;
export type ConversationModelSelection = z.infer<typeof conversationModelSelectionSchema>;
export type ConversationAttachment = z.infer<typeof conversationAttachmentSchema>;
export type ConversationThreadKind = z.infer<typeof conversationThreadKindSchema>;
export type ConversationAgentBinding = z.infer<typeof conversationAgentBindingSchema>;
export type ConversationTaskStatus = z.infer<typeof conversationTaskStatusSchema>;
export type ConversationTask = z.infer<typeof conversationTaskSchema>;
export type ConversationTaskListStatus = z.infer<typeof conversationTaskListStatusSchema>;
export type ConversationTaskList = z.infer<typeof conversationTaskListSchema>;
export type ConversationRunStatus = z.infer<
  typeof conversationRunStatusSchema
>;
export type CreateConversationInput = z.infer<
  typeof createConversationInputSchema
>;
export type RenameConversationInput = z.infer<
  typeof renameConversationInputSchema
>;
export type SetConversationProjectInput = z.infer<
  typeof setConversationProjectInputSchema
>;
export type SetConversationModelSelectionInput = z.infer<
  typeof setConversationModelSelectionInputSchema
>;
export type ConversationReferenceInput = z.infer<
  typeof conversationReferenceInputSchema
>;
export type SetTeamCoordinatorInput = z.infer<typeof setTeamCoordinatorInputSchema>;
export type ForkConversationInput = z.infer<typeof forkConversationInputSchema>;
export type SetConversationArchivedInput = z.infer<
  typeof setConversationArchivedInputSchema
>;
export type SetConversationPinnedInput = z.infer<
  typeof setConversationPinnedInputSchema
>;
export type ReorderConversationsInput = z.infer<
  typeof reorderConversationsInputSchema
>;
export type RemoveConversationAttachmentInput = z.infer<
  typeof removeConversationAttachmentInputSchema
>;
export type ImportConversationAttachmentBytesInput = z.infer<
  typeof importConversationAttachmentBytesInputSchema
>;
export type ConversationMessageItem = z.infer<
  typeof conversationMessageItemSchema
>;
export type ConversationAgentMessageItem = z.infer<
  typeof conversationAgentMessageItemSchema
>;
export type ConversationAgentMessageStatus = z.infer<
  typeof conversationAgentMessageStatusSchema
>;
export type ConversationAgentMessageType = z.infer<
  typeof conversationAgentMessageTypeSchema
>;
export type ConversationToolItem = z.infer<typeof conversationToolItemSchema>;
export type ConversationToolExecutionMode = z.infer<
  typeof conversationToolExecutionModeSchema
>;
export type ConversationTimelineItem = z.infer<
  typeof conversationTimelineItemSchema
>;
export type ConversationPermissionMode = z.infer<
  typeof conversationPermissionModeSchema
>;
export type ConversationMessageDeliveryMode = z.infer<
  typeof conversationMessageDeliveryModeSchema
>;
export type ConversationPendingMessage = z.infer<typeof conversationPendingMessageSchema>;
export type PendingConversationMessageReferenceInput = z.infer<
  typeof pendingConversationMessageReferenceInputSchema
>;
export type UpdatePendingConversationMessageInput = z.infer<
  typeof updatePendingConversationMessageInputSchema
>;
export type ReorderPendingConversationMessagesInput = z.infer<
  typeof reorderPendingConversationMessagesInputSchema
>;
export type ConversationContextUsageInput = z.infer<
  typeof conversationContextUsageInputSchema
>;
export type ConversationContextUsage = z.infer<
  typeof conversationContextUsageSchema
>;
export type ModelReasoningEffort = z.infer<typeof modelReasoningEffortSchema>;
export type ModelApiFormat = z.infer<typeof modelApiFormatSchema>;
export type ModelProviderIcon = z.infer<typeof modelProviderIconSchema>;
export type ProviderId = z.infer<typeof providerIdSchema>;
export type ModelProfile = z.infer<typeof modelProfileSchema>;
export type ModelConnectionStatus = z.infer<typeof modelConnectionStatusSchema>;
export type DiscoveredModel = z.infer<typeof discoveredModelSchema>;
export type DiscoverModelsInput = z.infer<typeof discoverModelsInputSchema>;
export type TestModelConnectionInput = z.infer<typeof testModelConnectionInputSchema>;
export type ModelConnectionTestResult = z.infer<typeof modelConnectionTestResultSchema>;
export type SaveModelConfigurationInput = z.infer<
  typeof saveModelConfigurationInputSchema
>;
export type SetDefaultModelInput = z.infer<typeof setDefaultModelInputSchema>;
export type GetModelApiKeyInput = z.infer<typeof getModelApiKeyInputSchema>;
export type SendConversationMessageInput = z.infer<
  typeof sendConversationMessageInputSchema
>;
export type SendTeamMessageInput = z.infer<typeof sendTeamMessageInputSchema>;
export type ReplaceLatestConversationMessageInput = z.infer<
  typeof replaceLatestConversationMessageInputSchema
>;
export type ConversationMessageSubmission = z.infer<
  typeof conversationMessageSubmissionSchema
>;
export type CancelRunInput = z.infer<typeof cancelRunInputSchema>;
export type ApproveToolChangeInput = z.infer<typeof approveToolChangeInputSchema>;
export type RunAccepted = z.infer<typeof runAcceptedSchema>;
export type ModelRuntimeStatus = z.infer<typeof modelRuntimeStatusSchema>;
export type ConversationRunEvent = z.infer<typeof conversationRunEventSchema>;
