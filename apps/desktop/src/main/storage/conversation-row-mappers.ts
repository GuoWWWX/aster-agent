import {
  conversationModelSelectionSchema,
  conversationPendingMessageSchema,
  conversationPermissionModeSchema,
  sendConversationMessageInputSchema,
  conversationSummarySchema,
  projectSummarySchema,
  conversationAttachmentSchema,
  type ConversationAttachment,
  type ConversationSummary,
  type ProjectSummary,
} from "@agent/protocol";
import {
  type StoredConversationAttachment,
  type StoredPendingMessage,
  type ConversationDeletionTask,
  type SubagentTaskStatus,
  type SubagentTask,
} from "./conversation-storage-contracts.js";
import {
  type DatabaseRow,
  asString,
  asNullableString,
  asBoolean,
  asNullableNumber,
  asNumber,
  parseJson,
  parseStoredStringArray,
} from "./database-row.js";

export function toConversationDeletionTask(row: DatabaseRow): ConversationDeletionTask {
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

export function toConversation(row: DatabaseRow): ConversationSummary {
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
    permissionMode: conversationPermissionModeSchema.parse(asString(row, "permission_mode")),
    coordinationMode: asString(row, "coordination_mode"),
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

export function toSubagentTask(row: DatabaseRow): SubagentTask {
  const status = asString(row, "status");
  if (!["queued", "running", "completed", "failed", "cancelled", "ended"].includes(status)) {
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

export function toProject(row: DatabaseRow): ProjectSummary {
  const showTeamsInNavigator = asBoolean(row, "show_teams_in_navigator");
  return projectSummarySchema.parse({
    id: asString(row, "id"),
    isPinned: asBoolean(row, "is_pinned"),
    name: asString(row, "name"),
    rootPath: asString(row, "root_path"),
    ...(showTeamsInNavigator ? { showTeamsInNavigator: true } : {})
  });
}

export function toConversationAttachment(row: DatabaseRow): StoredConversationAttachment {
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

export function toStoredPendingMessage(row: DatabaseRow): StoredPendingMessage {
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

export function toPublicConversationAttachment(
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
