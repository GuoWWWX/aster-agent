import {
  CONTEXT_MESSAGE_OVERHEAD_TOKENS,
  estimateContextTokens,
  resolveContextCompressionThresholdTokens,
  type ContextCompressionThreshold,
  type ConversationContextUsage,
} from "@agent/protocol";

import type { ModelMessage, ModelToolDefinition } from "../model/model-contracts.js";
import { AgentDatabase, type StoredContextMessage } from "../storage/agent-database.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { ThreadLog } from "../storage/thread-log.js";
import { buildManagedContext, type ManagedContextSourceMessage } from "./context-manager.js";

export type CompiledContext = {
  compactionCandidates: ManagedContextSourceMessage[];
  messages: ModelMessage[];
  usage: ConversationContextUsage;
};

export type ContextCompilerInput = {
  contextCompressionConfiguration: ContextCompressionThreshold;
  contextWindowTokens: number;
  conversationId: string;
  includeImageData: boolean;
  outputReserveTokens: number;
  /** Capacity reserved for the mutable task list that can appear mid-Run. */
  reservedTaskListTokens?: number;
  reservedSkillTokens: number;
  systemMessage: ModelMessage;
  toolDefinitions: readonly ModelToolDefinition[];
};

export class ContextCompiler {
  public constructor(
    private readonly database: AgentDatabase,
    private readonly attachments: ConversationAttachmentStore | null,
    private readonly threadLog: ThreadLog | null = null,
  ) {}

  public compile(input: ContextCompilerInput): CompiledContext {
    let threadContext: ReturnType<ThreadLog["readContext"]>;
    try {
      threadContext = this.threadLog === null
        ? null
        : this.threadLog.readContext(input.conversationId);
    } catch {
      // Startup repairs unreadable logs into a SQLite snapshot. If corruption
      // occurs while the app is running, preserve conversation availability
      // until that repair path runs instead of failing the next model request.
      threadContext = null;
    }
    const databaseMessages = threadContext === null
      ? this.database.listContextMessages(input.conversationId)
      : [];
    const sourceMessages = threadContext?.messages ?? databaseMessages;
    const storedMessages = sanitizeStoredModelMessages(sourceMessages).map((message) => ({
      ...message,
      attachments: this.attachments?.toModelAttachments(
        input.conversationId,
        message.attachmentIds,
        input.includeImageData,
      ) ?? [],
    }));
    const latestUserMessage = [...storedMessages].reverse().find((message) => message.role === "user");
    const latestDatabaseUserMessage = threadContext === null
      ? [...databaseMessages].reverse().find((message) => message.role === "user") ?? null
      : this.database.getLatestContextUserMessage(input.conversationId);
    const relevantMessages = latestUserMessage === undefined
      ? []
      : this.database
        .searchContextMessages({
          conversationId: input.conversationId,
          excludeSequences: latestDatabaseUserMessage === null
            ? []
            : [latestDatabaseUserMessage.sequence],
          limit: 24,
          query: latestUserMessage.content,
        })
        .map((match) => storedMessages.find((message) =>
          message.content === match.content
          && message.role === match.role
          && message.runId === match.runId,
        ))
        .filter((message): message is (typeof storedMessages)[number] => message !== undefined);
    const managed = buildManagedContext({
      checkpoint: threadContext?.checkpoint === undefined || threadContext.checkpoint === null
        ? this.database.getContextCheckpoint(input.conversationId)
        : {
          ...threadContext.checkpoint,
          conversationId: input.conversationId,
        },
      compressionMode: input.contextCompressionConfiguration.mode,
      compressionThresholdTokens: resolveContextCompressionThresholdTokens(
        input.contextCompressionConfiguration,
        input.contextWindowTokens,
      ),
      estimatedSystemTokens: estimateMessageTokens(input.systemMessage).contentTokens,
      estimatedToolDefinitionTokens: estimateContextTokens(JSON.stringify(input.toolDefinitions)),
      outputReserveTokens: input.outputReserveTokens,
      relevantMessages,
      reservedSkillTokens: input.reservedSkillTokens,
      ...(input.reservedTaskListTokens === undefined
        ? {}
        : { reservedTaskListTokens: input.reservedTaskListTokens }),
      sourceMessages: storedMessages,
    });
    return {
      compactionCandidates: managed.compactionCandidates,
      messages: [input.systemMessage, ...managed.messages],
      usage: managed.usage,
    };
  }
}

function estimateMessageTokens(
  message: Pick<ModelMessage, "attachments" | "content" | "toolCalls">,
): { attachmentTokens: number; contentTokens: number; toolCallTokens: number } {
  return {
    attachmentTokens: message.attachments.reduce((total, attachment) => total + attachment.contextTokens, 0),
    contentTokens: estimateContextTokens(message.content) + CONTEXT_MESSAGE_OVERHEAD_TOKENS,
    toolCallTokens: message.toolCalls.reduce(
      (total, call) => total + estimateContextTokens(call.name) + estimateContextTokens(call.arguments)
        + CONTEXT_MESSAGE_OVERHEAD_TOKENS,
      0,
    ),
  };
}

function sanitizeStoredModelMessages<T extends StoredContextMessage>(messages: readonly T[]): T[] {
  const validToolCallIds = new Set(
    messages.flatMap((message) => message.role !== "assistant" ? [] : message.toolCalls.flatMap((call) => {
      const id = call.id.trim();
      return id.length > 0 && call.name.trim().length > 0 ? [id] : [];
    })),
  );
  const completedToolCallIds = new Set(messages.flatMap((message) => {
    const id = message.role === "tool" ? message.toolCallId?.trim() ?? "" : "";
    return id.length > 0 && validToolCallIds.has(id) ? [id] : [];
  }));
  return messages.flatMap((message) => {
    if (message.role === "assistant") {
      const toolCalls = message.toolCalls.flatMap((call) => {
        const id = call.id.trim();
        const name = call.name.trim();
        return id.length > 0 && name.length > 0 && completedToolCallIds.has(id)
          ? [{ ...call, id, name }]
          : [];
      });
      if (message.content.trim().length === 0 && toolCalls.length === 0) return [];
      const sanitized = { ...message, toolCalls };
      if (toolCalls.length !== message.toolCalls.length) delete sanitized.providerState;
      return [sanitized];
    }
    if (message.role === "tool") {
      const toolCallId = message.toolCallId?.trim() ?? "";
      return toolCallId.length > 0 && completedToolCallIds.has(toolCallId)
        ? [{ ...message, toolCallId }]
        : [];
    }
    return [message];
  });
}
