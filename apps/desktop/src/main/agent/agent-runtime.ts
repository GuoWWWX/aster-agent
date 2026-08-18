import { randomUUID } from "node:crypto";
import {
  approveToolChangeInputSchema,
  CONTEXT_MESSAGE_OVERHEAD_TOKENS,
  DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION,
  conversationContextUsageInputSchema,
  conversationContextUsageSchema,
  conversationRunEventSchema,
  conversationToolItemSchema,
  estimateContextTokens,
  formatAgentError,
  isReasoningOptionEnabled,
  modelReasoningOptionKey,
  resolveContextCompressionThresholdTokens,
  type ContextCompressionConfiguration,
  type ContextCompressionThreshold,
  type AgentDirectoryConfiguration,
  type ConversationAgentBinding,
  type ConversationAgentMessageItem,
  type ConversationMessageSubmission,
  type ConversationPendingMessage,
  type ConversationContextUsage,
  sendConversationMessageInputSchema,
  type ConversationPermissionMode,
  type ConversationRunEvent,
  type ConversationSummary,
  type ConversationTaskList,
  type ModelReasoningOption,
  replaceLatestConversationMessageInputSchema,
  type ReplaceLatestConversationMessageInput,
  type RunAccepted,
  type SendConversationMessageInput
} from "@agent/protocol";

import { reportMainError, toMainAgentError } from "../errors/agent-error.js";
import type { ModelConfiguration } from "../model/model-contracts.js";
import {
  type CompleteTurnInput,
  type ModelMessage,
  type ModelProviderAdapter,
  type ModelTurnResult
} from "../model/model-contracts.js";
import { ModelAdapterRegistry } from "../model/model-adapter-registry.js";
import { ModelRequestError } from "../model/model-request-error.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import {
  AgentDatabase,
  agentMessageModelContent,
  type CompleteRunInput,
  type LatestUserMessageReplacementSource,
  type SubagentTask,
  type StoredModelMessage
} from "../storage/agent-database.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { TaskListTool } from "../tasks/task-list-tool.js";
import { ConversationAttachmentTool } from "../tools/conversation-attachment-tool.js";
import {
  ProjectToolRegistry,
  type PreparedCommand,
  type PreparedFileChange,
  type ProjectOperationOwner,
  type ToolExecutionResult
} from "../tools/project-tool-registry.js";
import {
  buildManagedContext,
  createContextCompactionMessages,
  type ManagedContextSourceMessage,
  parseContextSummary
} from "./context-manager.js";
import {
  buildConversationReferenceBundle,
  resolveConversationReferenceBudget,
} from "./conversation-reference.js";
import { AgentCommunicationTool } from "./agent-communication-tool.js";
import { SubagentTool } from "./subagent-tool.js";
import {
  ToolHandlerRegistry,
  type ToolHandler,
  type ToolHandlerExecutionContext,
} from "../tools/tool-handler-registry.js";

const MAX_AGENT_LOOPS = 8;
const MAX_CONTEXT_COMPACTIONS_PER_RUN = 3;
const MAX_MODEL_RECONNECT_ATTEMPTS = 5;
const MAX_AGENT_MESSAGE_AUTO_DEPTH = 4;
const MAX_OUTPUT_TOKENS = 8_192;
const MAX_SUMMARY_OUTPUT_TOKENS = 4_096;
const MODEL_RETRY_INITIAL_DELAY_MS = 1_000;
const MODEL_RETRY_MAX_DELAY_MS = 16_000;
const DEFAULT_PERMISSION_MODE: ConversationPermissionMode = "ask_before_changes";

type ModelConfigurationProvider = {
  getConfiguration(providerId?: string, modelId?: string): ModelConfiguration;
  setModelConnectionStatus?: (
    providerId: string,
    modelId: string,
    status: "healthy" | "error"
  ) => void;
};

type ContextCompressionConfigurationProvider = {
  getConfiguration(): ContextCompressionConfiguration;
};

type AgentDirectoryConfigurationProvider = {
  getConfiguration(): AgentDirectoryConfiguration;
};

const defaultContextCompressionConfigurationProvider: ContextCompressionConfigurationProvider = {
  getConfiguration: () => DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION
};

function resolveContextCompressionConfiguration(
  modelConfiguration: ModelConfiguration,
  globalConfiguration: ContextCompressionConfiguration
): ContextCompressionThreshold {
  return modelConfiguration.contextCompression ?? globalConfiguration;
}

type RunEventEmitter = (event: ConversationRunEvent) => void;

type RuntimeToolContext = ToolHandlerExecutionContext & {
  configuration: ModelConfiguration;
  contextCompressionConfiguration: ContextCompressionThreshold;
  emit: RunEventEmitter;
  onTaskListChanged: (taskList: ConversationTaskList | null) => void;
  operationOwner: ProjectOperationOwner;
  permissionMode: ConversationPermissionMode;
  providerId: string | undefined;
  reasoning: ModelReasoningOption | undefined;
};

type RetryWaiter = (delayMs: number, signal: AbortSignal) => Promise<void>;

type ModelTurnRequest = Omit<CompleteTurnInput, "onTextDelta"> & {
  conversationId: string;
  emit: RunEventEmitter;
  messageId: string;
  onTextDelta?: (delta: string) => void;
  runId: string;
};

type PendingChangeApproval = {
  resolve: (approved: boolean) => void;
  runId: string;
};

type ActiveRun = {
  controller: AbortController;
  finished: Promise<void>;
  resolveFinished: () => void;
};

type PreparedConversationMessage = {
  configuration: ModelConfiguration;
  contextCompressionConfiguration: ContextCompressionThreshold;
  input: SendConversationMessageInput;
  modelInputContent: string;
  permissionMode: ConversationPermissionMode;
  reasoning: ModelReasoningOption | undefined;
};

type BuiltContext = {
  compactionCandidates: ManagedContextSourceMessage[];
  messages: ModelMessage[];
  usage: ConversationContextUsage;
};

export type ContextCompactionInput = {
  configuration: ModelConfiguration;
  messages: readonly ManagedContextSourceMessage[];
  previousSummary: string | null;
  signal: AbortSignal;
};

export type ContextCompactor = {
  compact(input: ContextCompactionInput): Promise<string>;
};

type RuntimeWorkspace = {
  id: string;
  kind: "conversation" | "project";
  name: string;
  rootPath: string;
};

function conversationIdentityContext(
  conversation: ConversationSummary,
  agent: ConversationAgentBinding | null
): string[] {
  const identity = (() => {
    switch (conversation.threadKind) {
      case "team_lead":
        return `你是团队 ${conversation.teamId ?? "未绑定"} 的 Team Lead，负责接单、判断是否委派并汇总最终结果。`;
      case "agent":
        if (conversation.parentConversationId !== null) {
          return `你是从父对话 ${conversation.parentConversationId} 创建的侧边分支。你已继承创建时的上下文快照；继承历史由系统直接注入模型上下文，但不会在侧边对话界面重复显示。不要为了了解创建时的父对话内容再次调用 read_agent_conversation。创建后的父对话新消息不会自动同步到本分支。`;
        }
        return conversation.teamId === null
          ? "你是一个独立 Agent。"
          : `你是团队 ${conversation.teamId} 中的常驻 Agent。`;
      case "subagent":
        return `你是从父对话 ${conversation.parentConversationId ?? "未知"} 派生的临时 Subagent；创建时的父对话上下文快照已作为本对话历史注入，不要为获得同一批历史重复读取父对话。只处理当前支线任务并返回可验证结果，不递归创建团队。`;
    }
  })();
  if (agent === null) return [identity];
  return [
    identity,
    `当前 Agent：${agent.name}（${agent.id}）。${agent.role.length === 0 ? "" : `职责：${agent.role}。`}`,
    ...(agent.instructions.length === 0 ? [] : [`Agent 指令：${agent.instructions}`])
  ];
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function isRetryableModelError(error: unknown): boolean {
  if (error instanceof ModelRequestError) {
    if ([402, 408, 425, 429].includes(error.status) || error.status >= 500) return true;
    return error.status === 400 && /insufficient[_\s-]?(?:quota|balance|credit)|(?:额度|余额)(?:不足|耗尽)/iu.test(error.message);
  }

  return error instanceof TypeError && /fetch failed|network|socket|connect|connection|timed out|timeout|terminated|econn/iu.test(error.message);
}

function modelRetryReason(error: unknown, apiKey: string): string {
  const agentError = toMainAgentError(error, {
    operation: "model.retry",
    redactValues: [apiKey],
  });
  return formatAgentError(agentError);
}

function modelRetryDelay(retryAttempt: number): number {
  return Math.min(
    MODEL_RETRY_INITIAL_DELAY_MS * 2 ** (retryAttempt - 1),
    MODEL_RETRY_MAX_DELAY_MS
  );
}

function retryAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function waitForRetryDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(retryAbortError(signal));
  }

  return new Promise((resolve, reject) => {
    const complete = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(retryAbortError(signal));
    };
    const timeout = setTimeout(complete, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function resolveReasoning(
  input: SendConversationMessageInput,
  configuration: ModelConfiguration
): ModelReasoningOption | undefined {
  if (input.reasoning === undefined) return undefined;
  const key = modelReasoningOptionKey(input.reasoning);
  const option = configuration.reasoningOptions.find(
    (candidate) => modelReasoningOptionKey(candidate) === key
  );
  if (option === undefined) {
    throw new Error("The selected reasoning option is not configured for this model.");
  }
  if (!isReasoningOptionEnabled(option)) {
    throw new Error("The selected reasoning option is disabled for this model.");
  }
  return option;
}

function sanitizeStoredModelMessages<T extends StoredModelMessage>(
  messages: readonly T[]
): T[] {
  const validToolCallIds = new Set<string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const toolCall of message.toolCalls) {
      const id = toolCall.id.trim();
      const name = toolCall.name.trim();
      if (id.length > 0 && name.length > 0) validToolCallIds.add(id);
    }
  }

  const completedToolCallIds = new Set(
    messages.flatMap((message) => {
      if (message.role !== "tool" || message.toolCallId === null) return [];
      const id = message.toolCallId.trim();
      return id.length > 0 && validToolCallIds.has(id) ? [id] : [];
    })
  );

  return messages.flatMap((message) => {
    if (message.role === "assistant") {
      const toolCalls = message.toolCalls.flatMap((toolCall) => {
        const id = toolCall.id.trim();
        const name = toolCall.name.trim();
        if (
          id.length === 0 ||
          name.length === 0 ||
          !completedToolCallIds.has(id)
        ) {
          return [];
        }
        return [{ ...toolCall, id, name }];
      });
      if (message.content.trim().length === 0 && toolCalls.length === 0) return [];
      const sanitizedMessage = { ...message, toolCalls };
      if (toolCalls.length !== message.toolCalls.length) {
        delete sanitizedMessage.providerState;
      }
      return [sanitizedMessage];
    }

    if (message.role === "tool") {
      const id = message.toolCallId?.trim() ?? "";
      return id.length > 0 && completedToolCallIds.has(id)
        ? [{ ...message, toolCallId: id }]
        : [];
    }

    return [message];
  });
}

function replaceStoredVisibleMessageContent(
  source: LatestUserMessageReplacementSource,
  content: string,
): string {
  if (source.modelContent === source.message.content) return content;
  if (
    source.message.content.length > 0
    && source.modelContent.startsWith(source.message.content)
  ) {
    return `${content}${source.modelContent.slice(source.message.content.length)}`;
  }
  if (source.message.content.length === 0 && source.modelContent.length > 0) {
    return `${content}\n\n${source.modelContent}`;
  }
  return content;
}

function agentResultContent(input: {
  error: string | null;
  result: string | null;
  status: "completed" | "failed" | "cancelled";
}): string {
  if (input.status === "completed") {
    return input.result?.trim() || "Agent 已完成本次协作消息，没有额外文字结果。";
  }
  if (input.status === "cancelled") {
    return "Agent 处理本次协作消息时被取消。";
  }
  return `Agent 处理本次协作消息失败：${input.error ?? "未知错误"}`;
}

export class AgentRuntime {
  private readonly activeRuns = new Map<string, ActiveRun>();

  private readonly runsBeingReplaced = new Set<string>();

  private readonly agentMessageDepthByRun = new Map<string, number>();

  private readonly agentMessagesToReplyByRun = new Map<string, ConversationAgentMessageItem[]>();

  private readonly pendingChangeApprovals = new Map<string, PendingChangeApproval>();

  private readonly taskListTool: TaskListTool;

  private readonly attachmentTool: ConversationAttachmentTool | null;

  private readonly agentCommunicationTool: AgentCommunicationTool;

  private readonly subagentTool: SubagentTool;

  private readonly toolHandlers: ToolHandlerRegistry<RuntimeToolContext>;

  public constructor(
    private readonly database: AgentDatabase,
    private readonly credentials: ModelConfigurationProvider,
    private readonly projects: ProjectRegistry,
    private readonly tools: ProjectToolRegistry,
    private readonly model: ModelProviderAdapter = new ModelAdapterRegistry(),
    private readonly waitForRetry: RetryWaiter = waitForRetryDelay,
    private readonly contextCompression: ContextCompressionConfigurationProvider =
      defaultContextCompressionConfigurationProvider,
    private readonly contextCompactor: ContextCompactor | null = null,
    private readonly attachments: ConversationAttachmentStore | null = null,
    private readonly agentDirectory: AgentDirectoryConfigurationProvider | null = null
  ) {
    this.taskListTool = new TaskListTool(database);
    this.agentCommunicationTool = new AgentCommunicationTool(database);
    this.subagentTool = new SubagentTool(database);
    this.attachmentTool = attachments === null
      ? null
      : new ConversationAttachmentTool(attachments);
    this.toolHandlers = this.createToolHandlerRegistry();
  }

  private createToolHandlerRegistry(): ToolHandlerRegistry<RuntimeToolContext> {
    const handlers: ToolHandler<RuntimeToolContext>[] = [
      {
        execute: ({ context, rawArguments, toolName }) => this.agentCommunicationTool.execute({
          arguments: rawArguments,
          conversationId: context.conversationId,
          onMessageSent: (message) => this.handleAgentMessageSent(message, context.emit),
          runId: context.runId,
          signal: context.signal,
          toolName,
        }),
        getDefinitions: () => this.agentCommunicationTool.getDefinitions(),
        isAvailable: () => true,
      },
      {
        execute: ({ context, rawArguments, toolName }) => this.subagentTool.execute({
          arguments: rawArguments,
          conversationId: context.conversationId,
          signal: context.signal,
          spawn: (task, title, agentId) => this.spawnSubagent({
            agentId,
            configuration: context.configuration,
            contextCompressionConfiguration: context.contextCompressionConfiguration,
            emit: context.emit,
            parentConversationId: context.conversationId,
            parentRunId: context.runId,
            permissionMode: context.permissionMode,
            providerId: context.providerId,
            reasoning: context.reasoning,
            task,
            title,
          }),
          toolName,
        }),
        getDefinitions: () => this.subagentTool.getDefinitions(),
        isAvailable: () => true,
      },
      {
        execute: ({ context, rawArguments, toolName }) => {
          const taskListProposal = this.taskListTool.execute(
            toolName,
            rawArguments,
            context.conversationId,
          );
          if (!taskListProposal.isError) context.onTaskListChanged(taskListProposal.taskList);
          return Promise.resolve({
            content: taskListProposal.content,
            isError: taskListProposal.isError,
            kind: "completed" as const,
          });
        },
        getDefinitions: () => this.taskListTool.getDefinitions(),
        isAvailable: () => true,
      },
    ];
    if (this.attachmentTool !== null) {
      handlers.push({
        execute: ({ context, rawArguments }) => {
          const attachmentResult = this.attachmentTool?.execute(
            context.conversationId,
            rawArguments,
          );
          return Promise.resolve({
            content: attachmentResult?.content ?? "Attachment tool is unavailable.",
            isError: attachmentResult?.isError ?? true,
            kind: "completed" as const,
          });
        },
        getDefinitions: () => this.attachmentTool?.getDefinitions() ?? [],
        isAvailable: () => true,
      });
    }
    handlers.push({
      execute: ({ context, rawArguments, toolName }) => {
        if (context.projectId === undefined) {
          throw new Error("Temporary conversations cannot access project tools.");
        }
        return this.tools.execute(
          toolName,
          rawArguments,
          context.projectId,
          context.signal,
          context.operationOwner,
        );
      },
      getDefinitions: () => this.tools.getDefinitions(),
      isAvailable: ({ projectId }) => projectId !== undefined,
    });
    return new ToolHandlerRegistry(handlers);
  }

  public sendMessage(
    rawInput: SendConversationMessageInput,
    emit: RunEventEmitter
  ): ConversationMessageSubmission {
    const input = sendConversationMessageInputSchema.parse(rawInput);
    const conversation = this.database.getConversation(input.conversationId);
    if (
      conversation.subagentTaskStatus === "completed"
      || conversation.subagentTaskStatus === "failed"
      || conversation.subagentTaskStatus === "cancelled"
    ) {
      throw new Error("This Subagent task has ended and its conversation is read-only.");
    }
    if (input.agent !== undefined) {
      this.database.bindConversationAgent(input.conversationId, input.agent);
    }
    const prepared = this.prepareConversationMessage(input);
    if (conversation.activeRunId !== null) {
      const pendingMessage = this.database.enqueuePendingMessage({
        ...input,
        deliveryMode: input.deliveryMode ?? "queue"
      });
      this.emitPendingMessages(input.conversationId, emit);
      return { kind: "pending", pendingMessage };
    }

    const creation = this.startPreparedRun(prepared, emit);
    return {
      kind: "started",
      runId: creation.runId,
      userMessage: creation.userMessage
    };
  }

  public async replaceLatestMessage(
    rawInput: ReplaceLatestConversationMessageInput,
    emit: RunEventEmitter,
  ): Promise<RunAccepted> {
    const input = replaceLatestConversationMessageInputSchema.parse(rawInput);
    const conversation = this.database.getConversation(input.conversationId);
    if (
      conversation.subagentTaskStatus === "completed"
      || conversation.subagentTaskStatus === "failed"
      || conversation.subagentTaskStatus === "cancelled"
    ) {
      throw new Error("This Subagent task has ended and its conversation is read-only.");
    }
    let source = this.database.getLatestUserMessageReplacementSource(
      input.conversationId,
      input.messageId,
    );
    const sourceRunId = source.message.runId;
    if (sourceRunId === null) {
      throw new Error("The selected user message is not associated with a run.");
    }
    if (conversation.activeRunId !== null && conversation.activeRunId !== sourceRunId) {
      throw new Error("Another run is active; wait for it to finish before editing this message.");
    }
    const activeRun = this.activeRuns.get(sourceRunId);
    if (activeRun !== undefined) {
      this.runsBeingReplaced.add(sourceRunId);
      this.cancelRun(sourceRunId);
      await activeRun.finished;
      source = this.database.getLatestUserMessageReplacementSource(
        input.conversationId,
        input.messageId,
      );
    } else if (conversation.activeRunId !== null) {
      throw new Error("The active run cannot be replaced until runtime recovery completes.");
    }

    const { messageId, ...messageInput } = input;
    const sendInput: SendConversationMessageInput = {
      ...messageInput,
      attachmentIds: source.message.attachments.map((attachment) => attachment.id),
    };
    const initialPrepared = this.prepareConversationMessage(sendInput);
    const preserveStoredReferences = input.referencedConversationIds === undefined
      && input.referencedProjectPaths === undefined;
    const modelInputContent = preserveStoredReferences
      ? replaceStoredVisibleMessageContent(source, input.content)
      : initialPrepared.modelInputContent;
    this.assertAttachmentTurnFitsContext(
      sendInput,
      initialPrepared.configuration,
      initialPrepared.contextCompressionConfiguration,
      initialPrepared.permissionMode,
      modelInputContent,
    );
    const prepared = { ...initialPrepared, modelInputContent };
    const creation = this.database.replaceLatestUserMessage({
      content: input.content,
      conversationId: input.conversationId,
      messageId,
      modelContent: prepared.modelInputContent,
      modelId: prepared.configuration.modelId,
    });
    return this.schedulePreparedRun(creation, prepared, emit);
  }

  public listPendingMessages(conversationId: string): ConversationPendingMessage[] {
    return this.database.listPendingMessages(conversationId);
  }

  public promotePendingMessage(
    pendingMessageId: string,
    emit: RunEventEmitter
  ): ConversationPendingMessage[] {
    const conversationId = this.database.getPendingMessageRecord(
      pendingMessageId
    ).message.conversationId;
    this.database.promotePendingMessage(pendingMessageId);
    this.emitPendingMessages(conversationId, emit);
    if (this.database.getConversation(conversationId).activeRunId === null) {
      this.startNextPendingRun(conversationId, emit);
    }
    return this.database.listPendingMessages(conversationId);
  }

  public updatePendingMessage(
    pendingMessageId: string,
    content: string,
    emit: RunEventEmitter
  ): ConversationPendingMessage[] {
    const conversationId = this.database.getPendingMessageRecord(
      pendingMessageId
    ).message.conversationId;
    const messages = this.database.updatePendingMessage(pendingMessageId, content);
    this.emitPendingMessages(conversationId, emit);
    return messages;
  }

  public reorderPendingMessages(
    conversationId: string,
    pendingMessageIds: readonly string[],
    emit: RunEventEmitter
  ) {
    const messages = this.database.reorderPendingMessages(conversationId, pendingMessageIds);
    this.emitPendingMessages(conversationId, emit);
    return messages;
  }

  public deletePendingMessage(
    pendingMessageId: string,
    emit: RunEventEmitter
  ): ConversationPendingMessage[] {
    const conversationId = this.database.getPendingMessageRecord(
      pendingMessageId
    ).message.conversationId;
    const messages = this.database.deletePendingMessage(pendingMessageId);
    this.emitPendingMessages(conversationId, emit);
    return messages;
  }

  public resumePendingMessages(emit: RunEventEmitter): void {
    for (const task of this.database.listUndeliveredSubagentTasks()) {
      const message = this.database.deliverSubagentTaskResult(task.id);
      if (message === null) continue;
      this.agentCommunicationTool.notifyMessage(message);
      this.handleAgentMessageSent(message, emit);
    }
    for (const conversationId of this.database.listConversationIdsWithPendingMessages()) {
      this.startNextPendingRun(conversationId, emit);
    }
    for (const conversationId of this.database.listConversationIdsWithUnreadAgentMessages()) {
      this.startUnreadAgentMessageRun(conversationId, 0, emit);
    }
  }

  private prepareConversationMessage(
    input: SendConversationMessageInput
  ): PreparedConversationMessage {
    const storedConfiguration = this.credentials.getConfiguration(
      input.providerId,
      input.modelId
    );
    const configuration = {
      ...storedConfiguration,
      modelId: input.modelId ?? storedConfiguration.modelId
    };
    const permissionMode = input.permissionMode ?? DEFAULT_PERMISSION_MODE;
    const reasoning = resolveReasoning(input, configuration);
    const contextCompressionConfiguration = structuredClone(
      resolveContextCompressionConfiguration(
        configuration,
        this.contextCompression.getConfiguration()
      )
    );
    const compressionThresholdTokens = resolveContextCompressionThresholdTokens(
      contextCompressionConfiguration,
      configuration.contextWindow ?? 0,
    );
    const references = buildConversationReferenceBundle({
      budgetTokens: resolveConversationReferenceBudget(compressionThresholdTokens),
      currentConversationId: input.conversationId,
      database: this.database,
      referencedConversationIds: input.referencedConversationIds ?? [],
    });
    const projectFileReferences = this.projectFileReferenceContent(
      input.conversationId,
      input.referencedProjectPaths ?? [],
    );
    const modelInputContent = [
      input.content,
      references.content,
      projectFileReferences,
    ].filter((content) => content.length > 0).join("\n\n");
    this.assertAttachmentTurnFitsContext(
      input,
      configuration,
      contextCompressionConfiguration,
      permissionMode,
      modelInputContent,
    );
    return {
      configuration,
      contextCompressionConfiguration,
      input,
      modelInputContent,
      permissionMode,
      reasoning
    };
  }

  private startPreparedRun(
    prepared: PreparedConversationMessage,
    emit: RunEventEmitter,
    pendingMessageId?: string
  ): RunAccepted {
    const { configuration, input } = prepared;
    const creation = pendingMessageId === undefined
      ? this.database.createRunWithUserMessage(
          input.conversationId,
          input.content,
          configuration.modelId,
          input.attachmentIds ?? [],
          prepared.modelInputContent,
        )
      : this.database.createRunFromPendingMessage(
          pendingMessageId,
          configuration.modelId,
          prepared.modelInputContent
        );
    return this.schedulePreparedRun(creation, prepared, emit);
  }

  private schedulePreparedRun(
    creation: RunAccepted & { conversation: ConversationSummary },
    prepared: PreparedConversationMessage,
    emit: RunEventEmitter,
  ): RunAccepted {
    const { configuration, contextCompressionConfiguration, input } = prepared;
    const controller = new AbortController();
    this.registerActiveRun(creation.runId, controller);
    this.agentMessageDepthByRun.set(creation.runId, 0);
    if (!this.database.isConversationFork(input.conversationId)) {
      this.emit(emit, {
        conversation: creation.conversation,
        type: "conversation.updated"
      });
    }
    setImmediate(() => {
      void this.executeRun(
        creation.runId,
        input.conversationId,
        input.providerId,
        configuration,
        contextCompressionConfiguration,
        prepared.permissionMode,
        prepared.reasoning,
        controller,
        emit
      );
    });
    return { runId: creation.runId, userMessage: creation.userMessage };
  }

  private startNextPendingRun(conversationId: string, emit: RunEventEmitter): void {
    if (this.database.getConversation(conversationId).activeRunId !== null) return;
    const record = this.database.getNextPendingMessageRecord(conversationId);
    if (record === null) return;
    try {
      if (record.input.agent !== undefined) {
        this.database.bindConversationAgent(conversationId, record.input.agent);
      }
      const prepared = this.prepareConversationMessage(record.input);
      this.startPreparedRun(prepared, emit, record.message.id);
      this.emitPendingMessages(conversationId, emit);
    } catch (error) {
      const agentError = toMainAgentError(error, {
        operation: "agent.pending_message.start"
      });
      reportMainError(agentError, error);
    }
  }

  private consumePendingSteerMessages(
    conversationId: string,
    runId: string,
    messages: ModelMessage[],
    emit: RunEventEmitter
  ): boolean {
    const records = this.database.listPendingMessageRecords(conversationId, "steer");
    if (records.length === 0) return false;
    for (const record of records) {
      const prepared = this.prepareConversationMessage(record.input);
      this.database.consumePendingMessageIntoRun(
        record.message.id,
        runId,
        prepared.modelInputContent
      );
      messages.push({
        attachments: this.attachments?.toModelAttachments(
          conversationId,
          record.message.attachmentIds,
          true
        ) ?? [],
        content: prepared.modelInputContent,
        role: "user",
        toolCallId: null,
        toolCalls: []
      });
    }
    this.emitPendingMessages(conversationId, emit);
    return true;
  }

  private emitPendingMessages(conversationId: string, emit: RunEventEmitter): void {
    this.emit(emit, {
      conversationId,
      pendingMessages: this.database.listPendingMessages(conversationId),
      type: "pending_messages.updated"
    });
  }

  public cancelRun(runId: string): void {
    for (const pending of this.pendingChangeApprovals.values()) {
      if (pending.runId === runId) pending.resolve(false);
    }
    this.activeRuns
      .get(runId)
      ?.controller.abort(new DOMException("Run cancelled by the user.", "AbortError"));
  }

  private registerActiveRun(runId: string, controller: AbortController): ActiveRun {
    let resolveFinished = (): void => undefined;
    const finished = new Promise<void>((resolve) => {
      resolveFinished = resolve;
    });
    const activeRun = { controller, finished, resolveFinished };
    this.activeRuns.set(runId, activeRun);
    return activeRun;
  }

  public getContextUsage(rawInput: unknown): ConversationContextUsage {
    const input = conversationContextUsageInputSchema.parse(rawInput);
    const conversation = this.database.getConversation(input.conversationId);
    const workspace = this.resolveConversationWorkspace(conversation);
    const configuration = this.credentials.getConfiguration(input.providerId, input.modelId);

    const context = this.buildContext(
      input.conversationId,
      workspace,
      input.permissionMode,
      configuration.contextWindow ?? 0,
      resolveContextCompressionConfiguration(
        configuration,
        this.contextCompression.getConfiguration()
      )
    );
    const draftAttachments = this.attachments?.toModelAttachments(
      input.conversationId,
      input.attachmentIds ?? [],
      false
    ) ?? [];
    const draftAttachmentTokens = draftAttachments.reduce(
      (total, attachment) => total + attachment.contextTokens,
      0
    );
    const compressionThresholdTokens = resolveContextCompressionThresholdTokens(
      resolveContextCompressionConfiguration(
        configuration,
        this.contextCompression.getConfiguration(),
      ),
      configuration.contextWindow ?? 0,
    );
    const references = buildConversationReferenceBundle({
      budgetTokens: resolveConversationReferenceBudget(compressionThresholdTokens),
      currentConversationId: input.conversationId,
      database: this.database,
      referencedConversationIds: input.referencedConversationIds ?? [],
    });
    const projectFileReferences = this.projectFileReferenceContent(
      input.conversationId,
      input.referencedProjectPaths ?? [],
    );
    const projectFileReferenceTokens = estimateContextTokens(projectFileReferences);
    return conversationContextUsageSchema.parse({
      ...context.usage,
      estimatedAttachmentTokens:
        context.usage.estimatedAttachmentTokens + draftAttachmentTokens,
      estimatedInputTokens:
        context.usage.estimatedInputTokens
        + draftAttachmentTokens
        + references.estimatedTokens
        + projectFileReferenceTokens,
      estimatedReferenceTokens: references.estimatedTokens + projectFileReferenceTokens,
    });
  }

  public approveToolChange(rawInput: unknown): void {
    const input = approveToolChangeInputSchema.parse(rawInput);
    const pending = this.pendingChangeApprovals.get(input.toolId);
    if (pending === undefined || pending.runId !== input.runId) {
      throw new Error("This file change is no longer awaiting approval.");
    }
    pending.resolve(input.approved);
  }

  private async executeRun(
    runId: string,
    conversationId: string,
    providerId: string | undefined,
    configuration: ModelConfiguration,
    contextCompressionConfiguration: ContextCompressionThreshold,
    permissionMode: ConversationPermissionMode,
    reasoning: ModelReasoningOption | undefined,
    controller: AbortController,
    emit: RunEventEmitter
  ): Promise<void> {
    let activeAssistantContent = "";
    let activeAssistantContentPersisted = false;
    try {
      this.database.markRunRunning(runId);
      this.emit(emit, {
        conversationId,
        modelId: configuration.modelId,
        runId,
        type: "run.started"
      });
      const conversation = this.database.getConversation(conversationId);
      const operationOwner: ProjectOperationOwner = {
        conversationId,
        conversationTitle: conversation.title,
        runId,
      };
      const workspace = this.resolveConversationWorkspace(conversation);
      const initiallyUnreadAgentMessages = this.database.listUnreadAgentMessages(conversationId);
      this.trackAgentMessagesForReply(runId, initiallyUnreadAgentMessages);
      const messages = (await this.prepareContext(
        conversationId,
        workspace,
        permissionMode,
        configuration.contextWindow ?? 0,
        contextCompressionConfiguration,
        configuration,
        controller.signal
      )).messages;
      this.database.markAgentMessagesRead(
        initiallyUnreadAgentMessages.map((message) => message.id),
      );
      let hasSuccessfulToolExecution = false;
      let lastAssistantContent = "";

      for (let loop = 0; loop < MAX_AGENT_LOOPS; loop += 1) {
        controller.signal.throwIfAborted();
        const incomingAgentMessages = this.database.listUnreadAgentMessages(conversationId);
        if (incomingAgentMessages.length > 0) {
          this.trackAgentMessagesForReply(runId, incomingAgentMessages);
          messages.push(...incomingAgentMessages.map((message) => ({
            attachments: [],
            content: agentMessageModelContent(message),
            role: "user" as const,
            toolCallId: null,
            toolCalls: [],
          })));
          this.database.markAgentMessagesRead(
            incomingAgentMessages.map((message) => message.id),
          );
        }
        this.consumePendingSteerMessages(conversationId, runId, messages, emit);
        const messageId = randomUUID();
        let result: ModelTurnResult;
        activeAssistantContent = "";
        activeAssistantContentPersisted = false;
        try {
          result = await this.completeModelTurnWithRetries({
            configuration,
            conversationId,
            emit,
            maxOutputTokens: MAX_OUTPUT_TOKENS,
            messageId,
            messages,
            onTextDelta: (delta) => {
              activeAssistantContent += delta;
            },
            reasoning,
            signal: controller.signal,
            runId,
            tools: this.toolHandlers.getDefinitions({ projectId: workspace?.id })
          });
        } catch (error) {
          if (!controller.signal.aborted && !isAbortError(error)) {
            this.updateModelConnectionStatus(providerId, configuration.modelId, "error");
          }
          throw error;
        }
        if (result.content.length > 0) activeAssistantContent = result.content;
        const toolCalls = result.toolCalls.map((toolCall) => ({
          ...toolCall,
          id: toolCall.id.trim(),
          name: toolCall.name.trim()
        }));
        if (toolCalls.some((toolCall) => toolCall.id.length === 0 || toolCall.name.length === 0)) {
          throw new Error("Model returned an incomplete tool call.");
        }
        const hasFollowUpInput = toolCalls.length === 0 && (
          this.database.listUnreadAgentMessages(conversationId).length > 0
          || this.database.listPendingMessageRecords(conversationId, "steer").length > 0
        );
        if (toolCalls.length === 0 && result.content.trim().length === 0) {
          if (!hasSuccessfulToolExecution) {
            this.updateModelConnectionStatus(providerId, configuration.modelId, "error");
            throw new Error("模型未返回可显示内容，请稍后重试或切换模型。");
          }
        } else {
          if (result.content.trim().length > 0) lastAssistantContent = result.content;
          if (toolCalls.length > 0 || hasFollowUpInput) {
            this.database.appendAssistantTurn({
              content: result.content,
              conversationId,
              messageId,
              modelId: configuration.modelId,
              ...(result.providerState === undefined
                ? {}
                : { providerState: result.providerState }),
              runId,
              toolCalls
            });
            activeAssistantContentPersisted = true;
          }
          messages.push({
            attachments: [],
            content: result.content,
            ...(result.providerState === undefined
              ? {}
              : { providerState: result.providerState }),
            role: "assistant",
            toolCallId: null,
            toolCalls
          });
        }

        if (toolCalls.length === 0) {
          if (hasFollowUpInput) continue;
          const completedTaskList = this.database.completeRunningTasks(conversationId);
          if (completedTaskList !== null) {
            this.emit(emit, {
              conversationId,
              runId,
              taskList: completedTaskList,
              type: "task_list.updated"
            });
          }
          this.completeRunAndNotifySubagent({
            assistant: {
              content: result.content,
              kind: "turn",
              messageId,
              modelId: configuration.modelId,
              ...(result.providerState === undefined
                ? {}
                : { providerState: result.providerState }),
            },
            conversationId,
            emit,
            error: null,
            result: lastAssistantContent,
            runId,
            status: "completed",
          });
          this.finishRunAndNotifyAgentSenders({
            conversationId,
            emit,
            error: null,
            result: lastAssistantContent,
            runId,
            status: "completed",
          });
          this.updateModelConnectionStatus(providerId, configuration.modelId, "healthy");
          this.emit(emit, {
            agentError: null,
            conversationId,
            error: null,
            runId,
            status: "completed",
            type: "run.finished"
          });
          return;
        }

        const toolBatchId = randomUUID();
        for (const toolCall of toolCalls) {
          controller.signal.throwIfAborted();
          const startedTool = conversationToolItemSchema.parse({
            arguments: toolCall.arguments,
            batchId: toolBatchId,
            conversationId,
            createdAt: new Date().toISOString(),
            id: randomUUID(),
            kind: "tool",
            name: toolCall.name,
            result: null,
            runId,
            status: "running",
            diff: null
          });
          this.database.appendToolStarted(startedTool);
          this.emit(emit, {
            conversationId,
            runId,
            tool: startedTool,
            type: "tool.started"
          });
          const projectId = workspace?.id;
          const proposal = await this.toolHandlers.execute({
            context: {
              configuration,
              contextCompressionConfiguration,
              conversationId,
              emit,
              onTaskListChanged: (taskList) => {
                this.emit(emit, {
                  conversationId,
                  runId,
                  taskList,
                  type: "task_list.updated"
                });
              },
              operationOwner,
              permissionMode,
              projectId,
              providerId,
              reasoning,
              runId,
              signal: controller.signal,
            },
            rawArguments: toolCall.arguments,
            toolName: toolCall.name,
          });
          const toolDiff = proposal.kind === "change" ? proposal.change.diff : null;
          const execution =
            proposal.kind === "change"
              ? await this.resolveFileChange({
                  change: proposal.change,
                  controller,
                  permissionMode,
                  projectId: projectId ?? (() => {
                    throw new Error("A project is required for file changes.");
                  })(),
                  runId,
                  startedTool,
                  emit,
                  operationOwner,
                })
              : proposal.kind === "command"
                ? await this.resolveCommand({
                    command: proposal.command,
                    controller,
                    emit,
                    permissionMode,
                    projectId: projectId ?? (() => {
                      throw new Error("A project is required for command execution.");
                    })(),
                    runId,
                    startedTool,
                    operationOwner,
                  })
              : proposal;
          const completedTool = conversationToolItemSchema.parse({
            ...startedTool,
            diff: toolDiff,
            result: execution.content,
            status: execution.status ?? (execution.isError ? "failed" : "completed")
          });
          this.database.completeTool({
            providerCallId: toolCall.id,
            result: execution.content,
            tool: completedTool
          });
          if (completedTool.status === "completed") {
            hasSuccessfulToolExecution = true;
          }
          this.emit(emit, {
            conversationId,
            fileChange:
              proposal.kind === "change"
              && completedTool.status === "completed"
              && projectId !== undefined
                ? {
                    operation: proposal.change.operation,
                    path: proposal.change.path,
                    projectId
                  }
                : null,
            runId,
            tool: completedTool,
            type: "tool.completed"
          });
          messages.push({
            attachments: [],
            content: execution.content,
            role: "tool",
            toolCallId: toolCall.id,
            toolCalls: []
          });
        }
      }
      throw new Error(`Agent exceeded the ${MAX_AGENT_LOOPS}-turn tool loop limit.`);
    } catch (error) {
      const cancelled = controller.signal.aborted || isAbortError(error);
      const status = cancelled ? "cancelled" : "failed";
      const agentError = toMainAgentError(error, {
        operation: "agent.run",
        redactValues: [configuration.apiKey],
      });
      const message = formatAgentError(agentError);
      if (!cancelled) {
        reportMainError(agentError, error, [configuration.apiKey]);
      }
      this.completeRunAndNotifySubagent({
        assistant: status === "failed"
          ? {
              content: message,
              kind: "failure",
              messageId: randomUUID(),
              modelId: configuration.modelId,
            }
          : activeAssistantContent.length > 0 && !activeAssistantContentPersisted
            ? {
                content: activeAssistantContent,
                kind: "cancelled",
                messageId: randomUUID(),
                modelId: configuration.modelId,
              }
            : null,
        conversationId,
        emit,
        error: message,
        result: null,
        runId,
        status,
      });
      this.finishRunAndNotifyAgentSenders({
        conversationId,
        emit,
        error: message,
        result: null,
        runId,
        status,
      });
      this.emit(emit, {
        agentError,
        conversationId,
        error: message,
        runId,
        status,
        type: "run.finished"
      });
    } finally {
      const activeRun = this.activeRuns.get(runId);
      this.activeRuns.delete(runId);
      this.agentMessageDepthByRun.delete(runId);
      this.agentMessagesToReplyByRun.delete(runId);
      const isBeingReplaced = this.runsBeingReplaced.delete(runId);
      activeRun?.resolveFinished();
      if (!isBeingReplaced) {
        this.startNextPendingRun(conversationId, emit);
        this.startUnreadAgentMessageRun(conversationId, 0, emit);
      }
    }
  }

  private resolveSubagentAgent(
    parent: ConversationSummary,
    agentId: string | undefined,
  ): ConversationAgentBinding | null {
    if (agentId === undefined) {
      return this.database.getConversationAgentBinding(parent.id);
    }
    const directory = this.agentDirectory?.getConfiguration();
    if (directory === undefined) {
      throw new Error("Agent configuration is unavailable for this Subagent request.");
    }
    const agent = directory.agents.find((candidate) => candidate.id === agentId);
    if (agent === undefined || !agent.enabled) {
      throw new Error("The selected Agent is not available.");
    }
    const teamId = parent.teamId;
    const team = teamId === null
      ? undefined
      : directory.teams.find((candidate) => candidate.id === teamId);
    if (teamId !== null && (team === undefined || !team.enabled)) {
      throw new Error("The current conversation team is not available.");
    }
    if (team !== undefined && !team.memberIds.includes(agent.id)) {
      throw new Error("The selected Agent is not a member of the current team.");
    }
    const member = team?.memberConfigurations[agent.id];
    const instructions = [agent.instructions, team?.instructions, member?.instructions]
      .filter((value): value is string => value !== undefined && value.trim().length > 0)
      .join("\n\n")
      .slice(0, 20_000);
    return {
      id: agent.id,
      instructions,
      isDefault: agent.isDefault,
      name: agent.name,
      role: member?.role.trim() || agent.role,
    };
  }

  private agentDelegationContext(conversation: ConversationSummary): string[] {
    if (conversation.teamId === null) return [];
    const directory = this.agentDirectory?.getConfiguration();
    const team = directory?.teams.find((candidate) =>
      candidate.id === conversation.teamId && candidate.enabled
    );
    if (directory === undefined || team === undefined) return [];
    const members = team.memberIds
      .map((agentId) => directory.agents.find((agent) => agent.id === agentId && agent.enabled))
      .filter((agent) => agent !== undefined)
      .slice(0, 32)
      .map((agent) => `${agent.id}=${agent.name}（${agent.role || "未配置职责"}）`);
    return members.length === 0
      ? []
      : [`可通过 spawn_subagent 的 agentId 委派团队成员：${members.join("；")}`];
  }

  private spawnSubagent(input: {
    agentId: string | undefined;
    configuration: ModelConfiguration;
    contextCompressionConfiguration: ContextCompressionThreshold;
    emit: RunEventEmitter;
    parentConversationId: string;
    parentRunId: string;
    permissionMode: ConversationPermissionMode;
    providerId: string | undefined;
    reasoning: ModelReasoningOption | undefined;
    task: string;
    title: string | undefined;
  }): SubagentTask {
    const parent = this.database.getConversation(input.parentConversationId);
    if (parent.isArchived) throw new Error("An archived conversation cannot start a Subagent.");

    const child = this.database.forkConversation(parent.id, "subagent");
    this.projects.inheritConversationWorkspace(parent.id, child.id);
    const selectedAgent = this.resolveSubagentAgent(parent, input.agentId);
    if (selectedAgent !== null) this.database.bindConversationAgent(child.id, selectedAgent);

    const creation = this.database.createRunWithUserMessage(
      child.id,
      input.task,
      input.configuration.modelId,
    );
    const title = input.title?.trim()
      || `${selectedAgent?.name ?? "Subagent"} · ${input.task.replace(/\s+/gu, " ").slice(0, 80)}`;
    const updatedChild = this.database.renameConversation(child.id, title);
    const task = this.database.createSubagentTask({
      childConversationId: child.id,
      parentConversationId: parent.id,
      sourceRunId: input.parentRunId,
      task: input.task,
      title,
    });
    const startedTask = this.database.assignSubagentTaskRun(task.id, creation.runId);
    const controller = new AbortController();
    const parentDepth = this.agentMessageDepthByRun.get(input.parentRunId) ?? 0;
    this.registerActiveRun(creation.runId, controller);
    this.agentMessageDepthByRun.set(creation.runId, parentDepth + 1);
    this.emit(input.emit, {
      conversation: this.database.getConversation(parent.id),
      type: "conversation.updated",
    });
    this.emit(input.emit, {
      conversation: {
        ...updatedChild,
        activeRunId: creation.runId,
        lastRunStatus: "queued",
      },
      type: "conversation.updated",
    });
    setImmediate(() => {
      void this.executeRun(
        creation.runId,
        child.id,
        input.providerId,
        input.configuration,
        structuredClone(input.contextCompressionConfiguration),
        input.permissionMode,
        input.reasoning,
        controller,
        input.emit,
      );
    });
    return startedTask;
  }

  private completeRunAndNotifySubagent(input: {
    assistant: CompleteRunInput["assistant"];
    conversationId: string;
    emit: RunEventEmitter;
    error: string | null;
    result: string | null;
    runId: string;
    status: "completed" | "failed" | "cancelled";
  }): void {
    const completedRun = this.database.completeRun({
      assistant: input.assistant,
      conversationId: input.conversationId,
      error: input.error,
      result: input.result,
      runId: input.runId,
      status: input.status,
    });
    this.emit(input.emit, {
      conversation: this.database.getConversation(input.conversationId),
      type: "conversation.updated",
    });
    if (completedRun.subagentTask === null) return;
    try {
      this.emit(input.emit, {
        conversation: this.database.getConversation(
          completedRun.subagentTask.parentConversationId,
        ),
        type: "conversation.updated",
      });
      this.subagentTool.notifyTaskCompleted(completedRun.subagentTask);
      if (completedRun.subagentResultMessage === null) return;
      this.agentCommunicationTool.notifyMessage(completedRun.subagentResultMessage);
      this.handleAgentMessageSent(completedRun.subagentResultMessage, input.emit);
    } catch (error) {
      const agentError = toMainAgentError(error, {
        operation: "subagent.result.deliver",
      });
      reportMainError(agentError, error);
    }
  }

  private finishRunAndNotifyAgentSenders(input: {
    conversationId: string;
    emit: RunEventEmitter;
    error: string | null;
    result: string | null;
    runId: string;
    status: "completed" | "failed" | "cancelled";
  }): void {
    const triggers = this.agentMessagesToReplyByRun.get(input.runId) ?? [];
    this.agentMessagesToReplyByRun.delete(input.runId);
    const bySender = new Map<string, ConversationAgentMessageItem>();
    for (const trigger of triggers) {
      if (!bySender.has(trigger.senderConversationId)) {
        bySender.set(trigger.senderConversationId, trigger);
      }
    }
    for (const trigger of bySender.values()) {
      try {
        const content = agentResultContent(input).slice(0, 20_000);
        const message = this.database.sendAgentMessage({
          content,
          messageType: "agent_result",
          runId: input.runId,
          senderConversationId: input.conversationId,
          targetConversationId: trigger.senderConversationId,
          taskId: trigger.id,
        });
        this.agentCommunicationTool.notifyMessage(message);
        this.handleAgentMessageSent(message, input.emit);
      } catch (error) {
        const agentError = toMainAgentError(error, {
          operation: "agent.message.result.deliver",
        });
        reportMainError(agentError, error);
      }
    }
  }

  private trackAgentMessagesForReply(
    runId: string,
    messages: readonly ConversationAgentMessageItem[],
  ): void {
    const eligible = messages.filter((message) => message.messageType === "message");
    if (eligible.length === 0) return;
    const tracked = this.agentMessagesToReplyByRun.get(runId) ?? [];
    const trackedIds = new Set(tracked.map((message) => message.id));
    tracked.push(...eligible.filter((message) => !trackedIds.has(message.id)));
    this.agentMessagesToReplyByRun.set(runId, tracked);
  }

  private handleAgentMessageSent(
    message: ConversationAgentMessageItem,
    emit: RunEventEmitter,
  ): void {
    const sourceDepth = message.runId === null
      ? 0
      : this.agentMessageDepthByRun.get(message.runId) ?? 0;
    this.startUnreadAgentMessageRun(message.conversationId, sourceDepth + 1, emit);
  }

  private startUnreadAgentMessageRun(
    conversationId: string,
    targetDepth: number,
    emit: RunEventEmitter,
  ): void {
    const unreadMessages = this.database.listUnreadAgentMessages(conversationId);
    if (unreadMessages.length === 0) return;
    const targetConversation = this.database.getConversation(conversationId);
    if (targetConversation.isArchived) return;
    if (targetConversation.activeRunId !== null) {
      this.trackAgentMessagesForReply(targetConversation.activeRunId, unreadMessages);
      const currentDepth = this.agentMessageDepthByRun.get(targetConversation.activeRunId) ?? 0;
      this.agentMessageDepthByRun.set(
        targetConversation.activeRunId,
        Math.max(currentDepth, targetDepth),
      );
      return;
    }
    if (targetDepth > MAX_AGENT_MESSAGE_AUTO_DEPTH) return;

    try {
      const configuration = this.credentials.getConfiguration();
      const contextCompressionConfiguration = structuredClone(
        resolveContextCompressionConfiguration(
          configuration,
          this.contextCompression.getConfiguration(),
        ),
      );
      const creation = this.database.createRunForAgentMessage(
        conversationId,
        configuration.modelId,
      );
      const controller = new AbortController();
      this.registerActiveRun(creation.runId, controller);
      this.agentMessageDepthByRun.set(creation.runId, targetDepth);
      this.trackAgentMessagesForReply(creation.runId, unreadMessages);
      if (!this.database.isConversationFork(conversationId)) {
        this.emit(emit, {
          conversation: creation.conversation,
          type: "conversation.updated",
        });
      }
      setImmediate(() => {
        void this.executeRun(
          creation.runId,
          conversationId,
          undefined,
          configuration,
          contextCompressionConfiguration,
          DEFAULT_PERMISSION_MODE,
          undefined,
          controller,
          emit,
        );
      });
    } catch (error) {
      const agentError = toMainAgentError(error, {
        operation: "agent.message.auto_run",
      });
      reportMainError(agentError, error);
    }
  }

  private updateModelConnectionStatus(
    providerId: string | undefined,
    modelId: string,
    status: "healthy" | "error"
  ): void {
    if (providerId === undefined) return;
    this.credentials.setModelConnectionStatus?.(providerId, modelId, status);
  }

  private async completeModelTurnWithRetries(input: ModelTurnRequest): Promise<ModelTurnResult> {
    let reconnectAttempt = 0;

    while (true) {
      input.signal.throwIfAborted();
      this.emit(input.emit, {
        conversationId: input.conversationId,
        runId: input.runId,
        type: "model.request_started"
      });
      let receivedTextDelta = false;

      try {
        const result = await this.model.completeTurn({
          configuration: input.configuration,
          maxOutputTokens: input.maxOutputTokens,
          messages: input.messages,
          onReasoningDelta: (event) => {
            this.emit(input.emit, {
              conversationId: input.conversationId,
              delta: event.delta,
              kind: event.kind,
              reset: event.reset,
              runId: input.runId,
              type: "assistant.reasoning_delta"
            });
          },
          onTextDelta: (delta) => {
            receivedTextDelta = true;
            input.onTextDelta?.(delta);
            this.emit(input.emit, {
              conversationId: input.conversationId,
              delta,
              messageId: input.messageId,
              modelId: input.configuration.modelId,
              runId: input.runId,
              type: "assistant.delta"
            });
          },
          reasoning: input.reasoning,
          signal: input.signal,
          tools: input.tools
        });
        if (
          !receivedTextDelta
          && result.content.trim().length === 0
          && result.toolCalls.length === 0
          && reconnectAttempt < MAX_MODEL_RECONNECT_ATTEMPTS
        ) {
          reconnectAttempt += 1;
          const retryInMs = modelRetryDelay(reconnectAttempt);
          this.emit(input.emit, {
            attempt: reconnectAttempt,
            conversationId: input.conversationId,
            reason: "模型未返回可显示内容。",
            retryInMs,
            runId: input.runId,
            type: "model.request_retrying"
          });
          await this.waitForRetry(retryInMs, input.signal);
          continue;
        }
        return result;
      } catch (error) {
        if (
          receivedTextDelta ||
          !isRetryableModelError(error) ||
          reconnectAttempt >= MAX_MODEL_RECONNECT_ATTEMPTS
        ) {
          throw error;
        }

        reconnectAttempt += 1;
        const retryInMs = modelRetryDelay(reconnectAttempt);
        this.emit(input.emit, {
          attempt: reconnectAttempt,
          conversationId: input.conversationId,
          reason: modelRetryReason(error, input.configuration.apiKey),
          retryInMs,
          runId: input.runId,
          type: "model.request_retrying"
        });
        await this.waitForRetry(retryInMs, input.signal);
      }
    }
  }

  private async resolveFileChange(input: {
    change: PreparedFileChange;
    controller: AbortController;
    emit: RunEventEmitter;
    permissionMode: ConversationPermissionMode;
    projectId: string;
    runId: string;
    startedTool: ReturnType<typeof conversationToolItemSchema.parse>;
    operationOwner: ProjectOperationOwner;
  }): Promise<ToolExecutionResult> {
    if (input.permissionMode === "read_only") {
      return {
        content: JSON.stringify({
          error: "File changes are blocked because this conversation is read-only.",
          ok: false
        }),
        isError: true,
        kind: "completed"
      };
    }
    if (input.permissionMode === "ask_before_changes") {
      const awaitingTool = conversationToolItemSchema.parse({
        ...input.startedTool,
        diff: input.change.diff,
        status: "awaiting_approval"
      });
      this.database.updateTool(awaitingTool);
      const approval = this.waitForChangeApproval(
        awaitingTool.id,
        input.runId,
        input.controller.signal
      );
      this.emit(input.emit, {
        conversationId: awaitingTool.conversationId,
        runId: input.runId,
        tool: awaitingTool,
        type: "tool.approval_requested"
      });
      const approved = await approval;
      if (!approved) {
        return {
          content: JSON.stringify({
            error: "The user rejected this file change.",
            ok: false,
            value: { path: input.change.path, status: "rejected" }
          }),
          isError: true,
          kind: "completed",
          status: "rejected"
        };
      }
    }
    return this.tools.applyPreparedChange(
      input.change,
      input.projectId,
      input.controller.signal,
      input.operationOwner,
    );
  }

  private async resolveCommand(input: {
    command: PreparedCommand;
    controller: AbortController;
    emit: RunEventEmitter;
    permissionMode: ConversationPermissionMode;
    projectId: string;
    runId: string;
    startedTool: ReturnType<typeof conversationToolItemSchema.parse>;
    operationOwner: ProjectOperationOwner;
  }): Promise<ToolExecutionResult> {
    if (input.permissionMode === "read_only") {
      return {
        content: JSON.stringify({
          error: "Command execution is blocked because this conversation is read-only.",
          ok: false
        }),
        isError: true,
        kind: "completed"
      };
    }
    if (input.permissionMode === "ask_before_changes") {
      const awaitingTool = conversationToolItemSchema.parse({
        ...input.startedTool,
        status: "awaiting_approval"
      });
      this.database.updateTool(awaitingTool);
      const approval = this.waitForChangeApproval(
        awaitingTool.id,
        input.runId,
        input.controller.signal
      );
      this.emit(input.emit, {
        conversationId: awaitingTool.conversationId,
        runId: input.runId,
        tool: awaitingTool,
        type: "tool.approval_requested"
      });
      const approved = await approval;
      if (!approved) {
        return {
          content: JSON.stringify({
            error: "The user rejected this command.",
            ok: false,
            value: { command: input.command.command, status: "rejected" }
          }),
          isError: true,
          kind: "completed",
          status: "rejected"
        };
      }
    }
    return this.tools.executePreparedCommand(
      input.command,
      input.projectId,
      input.controller.signal,
      input.operationOwner,
    );
  }

  private waitForChangeApproval(
    toolId: string,
    runId: string,
    signal: AbortSignal
  ): Promise<boolean> {
    return new Promise<boolean>((resolve, reject) => {
      const onAbort = (): void => {
        this.pendingChangeApprovals.delete(toolId);
        reject(
          signal.reason instanceof Error
            ? signal.reason
            : new DOMException("The operation was aborted.", "AbortError")
        );
      };
      signal.addEventListener("abort", onAbort, { once: true });
      this.pendingChangeApprovals.set(toolId, {
        resolve: (approved) => {
          signal.removeEventListener("abort", onAbort);
          this.pendingChangeApprovals.delete(toolId);
          resolve(approved);
        },
        runId
      });
    });
  }

  private buildContext(
    conversationId: string,
    workspace: RuntimeWorkspace | null,
    permissionMode: ConversationPermissionMode,
    contextWindowTokens: number,
    contextCompressionConfiguration: ContextCompressionThreshold,
    includeImageData = false
  ): BuiltContext {
    const conversation = this.database.getConversation(conversationId);
    const agent = this.database.getConversationAgentBinding(conversationId);
    const systemMessage: ModelMessage = {
      attachments: [],
      content: [
        "你是本地编码 Agent。回答要直接、可验证，并优先使用工具核对项目事实。",
        ...conversationIdentityContext(conversation, agent),
        ...this.agentDelegationContext(conversation),
        "你可以用 list_agent_conversations、read_agent_conversation、send_agent_message 和 wait_for_agent_message 与其他 Agent 对话协作。读取其他对话时必须控制预算。收到普通 Agent 协作消息后直接处理并给出本对话的最终答复，运行时会把最终结果自动关联回发送方并在需要时唤醒它；发送中间进度或无需对方回传结果的通知时调用 send_agent_message，并设置 expectReply=false。",
        "复杂任务可以用 spawn_subagent 启动独立的一次性 Subagent。只有当前工作依赖其结果时才调用 wait_for_subagents；否则继续当前工作，Subagent 完成后系统会持久化结果并自动唤醒本对话。可用 list_subagents 查看状态。主对话只会收到完成摘要；需要核对详细过程时，使用 read_agent_conversation 按预算读取子对话。Subagent 结束后只读，不要求其调用 send_agent_message，也不要继续向其发送任务。",
        "用户消息可以通过 @ 引用当前工作区文件。引用只提供相对路径；需要查看内容时先调用 read_file，不要根据文件名猜测内容。",
        "Skill 特指通过 SKILL.md 注入的任务说明和能力组合，不等同于内置工具、Agent 职责或命令行程序。当前没有可调用的 Skill Runtime；如果用户询问可用 Skill，明确说明尚未接入，不要调用工具或把一般能力列成 Skill。Git 是可通过 run_command 执行的命令行程序，不是 Skill，也不是当前的专用 Git 工具；仅在任务确实需要且工作区是 Git 仓库时使用。",
        "用户消息开头的内置命令语义：/plan 表示先分析并创建任务清单再执行；/review 表示审查相关实现、优先指出缺陷和风险；/test 表示运行与当前任务相关的测试并根据结果修复。命令后的文本是具体任务。",
        "对于包含两个或以上独立步骤的复杂任务，先用 create_task_list 建立完整任务清单；每完成一步就用 update_task_list 更新完整清单，并且同一时间只能有一个步骤为 running。简单问答或单步修改不要创建任务清单。全部步骤完成后调用 close_task_list 删除清单，再给出最终答复。",
        workspace === null
          ? this.attachmentTool === null
            ? "当前是临时对话，没有关联项目或文件工具。"
            : "当前是临时对话，没有关联项目；仍可使用 read_attachment 读取本对话中的文本附件。"
          : `当前提供工作目录内读文件、搜索、受控文件变更和 ${this.tools.getCommandEnvironmentDescription()} 命令工具；命令与写入均受本轮权限策略控制。`,
        "简单、结果需要保持有界的文本或文件查询优先调用 search_text 和 find_files。需要 ripgrep 的上下文行、计数、多表达式、复杂 glob、精确 CLI 输出或管道组合时，可以直接用 run_command 执行 rg；应用已提供内置 rg，不要求用户另行安装。",
        "如果项目工具返回 PROJECT_OPERATION_CONFLICT，不要盲目重试。先查看冲突中的对话和 operationId，再选择 wait_for_project_operation 等待，或用 send_agent_message 联系对方；完成等待后重新读取文件并生成新 Diff。",
        `用户为本次任务选择的权限模式：${permissionModeLabel(permissionMode)}。`,
        ...(workspace === null
          ? []
          : [
            workspace.kind === "project"
              ? `当前项目：${workspace.name}`
              : `当前对话工作目录：${workspace.name}`,
            `授权根目录：${workspace.rootPath}`,
            "所有文件工具的 path 参数均使用相对于授权根目录的 POSIX 路径；空路径表示根目录。不要调用工具查询授权根目录。"
          ]),
        ...this.taskListContext(conversationId)
      ].join("\n"),
      role: "system",
      toolCallId: null,
      toolCalls: []
    };
    const sourceMessages = this.database.listContextMessages(conversationId);
    const storedMessages = sanitizeStoredModelMessages(sourceMessages).map((message) => ({
      ...message,
      attachments: this.attachments?.toModelAttachments(
        conversationId,
        message.attachmentIds,
        includeImageData
      ) ?? []
    }));
    const estimatedSystemTokens = estimateModelMessageTokens(systemMessage).contentTokens;
    const estimatedToolDefinitionTokens = estimateContextTokens(
      JSON.stringify(this.toolHandlers.getDefinitions({ projectId: workspace?.id }))
    );
    const compressionThresholdTokens = resolveContextCompressionThresholdTokens(
      contextCompressionConfiguration,
      contextWindowTokens
    );
    const managed = buildManagedContext({
      checkpoint: this.database.getContextCheckpoint(conversationId),
      compressionMode: contextCompressionConfiguration.mode,
      compressionThresholdTokens,
      estimatedSystemTokens,
      estimatedToolDefinitionTokens,
      outputReserveTokens: MAX_OUTPUT_TOKENS,
      sourceMessages: storedMessages
    });

    return {
      compactionCandidates: managed.compactionCandidates,
      messages: [systemMessage, ...managed.messages],
      usage: conversationContextUsageSchema.parse(managed.usage)
    };
  }

  private async prepareContext(
    conversationId: string,
    workspace: RuntimeWorkspace | null,
    permissionMode: ConversationPermissionMode,
    contextWindowTokens: number,
    contextCompressionConfiguration: ContextCompressionThreshold,
    configuration: ModelConfiguration,
    signal: AbortSignal
  ): Promise<BuiltContext> {
    let context = this.buildContext(
      conversationId,
      workspace,
      permissionMode,
      contextWindowTokens,
      contextCompressionConfiguration,
      true
    );
    for (
      let attempt = 0;
      attempt < MAX_CONTEXT_COMPACTIONS_PER_RUN && context.compactionCandidates.length > 0;
      attempt += 1
    ) {
      signal.throwIfAborted();
      const checkpoint = this.database.getContextCheckpoint(conversationId);
      try {
        const rawSummary = this.contextCompactor === null
          ? await this.compactContextWithModel({
              configuration,
              messages: context.compactionCandidates,
              previousSummary: checkpoint?.summary ?? null,
              signal
            })
          : await this.contextCompactor.compact({
              configuration,
              messages: context.compactionCandidates,
              previousSummary: checkpoint?.summary ?? null,
              signal
            });
        const summary = parseContextSummary(rawSummary);
        const lastCandidate = context.compactionCandidates.at(-1);
        if (lastCandidate === undefined) break;
        this.database.saveContextCheckpoint(
          conversationId,
          lastCandidate.sequence,
          summary
        );
        context = this.buildContext(
          conversationId,
          workspace,
          permissionMode,
          contextWindowTokens,
          contextCompressionConfiguration,
          true
        );
      } catch (error) {
        if (signal.aborted || isAbortError(error)) throw error;
        break;
      }
    }
    return context;
  }

  private async compactContextWithModel(input: ContextCompactionInput): Promise<string> {
    let reconnectAttempt = 0;
    while (true) {
      input.signal.throwIfAborted();
      let receivedTextDelta = false;
      try {
        const result = await this.model.completeTurn({
          configuration: input.configuration,
          maxOutputTokens: MAX_SUMMARY_OUTPUT_TOKENS,
          messages: createContextCompactionMessages(input.previousSummary, input.messages),
          onTextDelta: () => {
            receivedTextDelta = true;
          },
          reasoning: undefined,
          signal: input.signal,
          tools: []
        });
        if (result.toolCalls.length > 0 || result.content.trim().length === 0) {
          throw new Error("Context compaction returned an invalid response.");
        }
        return result.content;
      } catch (error) {
        if (
          receivedTextDelta ||
          !isRetryableModelError(error) ||
          reconnectAttempt >= MAX_MODEL_RECONNECT_ATTEMPTS
        ) {
          throw error;
        }
        reconnectAttempt += 1;
        await this.waitForRetry(modelRetryDelay(reconnectAttempt), input.signal);
      }
    }
  }

  private taskListContext(conversationId: string): string[] {
    const taskList = this.database.getTaskList(conversationId);
    if (taskList === null) return [];
    if (taskList.status === "closed") {
      return [
        "当前任务清单已关闭。不要调用 update_task_list；只有用户要求重新规划时才调用 create_task_list 创建新的清单。"
      ];
    }
    return [
      "当前任务清单：",
      ...taskList.tasks.map((task, index) => `${index + 1}. [${task.status}] ${task.title}`)
    ];
  }

  private assertAttachmentTurnFitsContext(
    input: SendConversationMessageInput,
    configuration: ModelConfiguration,
    contextCompressionConfiguration: ContextCompressionThreshold,
    permissionMode: ConversationPermissionMode,
    modelInputContent: string,
  ): void {
    if (this.attachments === null || (input.attachmentIds?.length ?? 0) === 0) return;

    const conversation = this.database.getConversation(input.conversationId);
    const workspace = this.resolveConversationWorkspace(conversation);
    const context = this.buildContext(
      input.conversationId,
      workspace,
      permissionMode,
      configuration.contextWindow ?? 0,
      contextCompressionConfiguration
    );
    const turnEstimate = estimateModelMessageTokens({
      attachments: this.attachments.toModelAttachments(
        input.conversationId,
        input.attachmentIds ?? [],
        false
      ),
      content: modelInputContent,
      toolCalls: []
    });
    const minimumRequiredTokens =
      context.usage.estimatedSystemTokens +
      context.usage.estimatedToolDefinitionTokens +
      context.usage.outputReserveTokens +
      turnEstimate.attachmentTokens +
      turnEstimate.contentTokens;

    if (minimumRequiredTokens > context.usage.compressionThresholdTokens) {
      throw new Error(
        `本次消息和附件预计至少需要 ${minimumRequiredTokens} Token，超过当前 ${context.usage.compressionThresholdTokens} Token 的上下文阈值。请减少附件，或调高模型上下文/压缩阈值后重试。`
      );
    }
  }

  private projectFileReferenceContent(
    conversationId: string,
    referencedProjectPaths: readonly string[],
  ): string {
    if (referencedProjectPaths.length === 0) return "";
    const conversation = this.database.getConversation(conversationId);
    if (this.resolveConversationWorkspace(conversation) === null) {
      throw new Error("Project files can only be referenced from a conversation with a workspace.");
    }
    return [
      "[引用项目文件]",
      "以下路径相对于当前授权根目录。需要内容时先使用 read_file 读取：",
      ...referencedProjectPaths.map((filePath) => `- ${filePath}`),
    ].join("\n");
  }

  private resolveConversationWorkspace(conversation: {
    id: string;
    projectId: string | null;
    workspaceRootPath: string | null;
  }): RuntimeWorkspace | null {
    if (conversation.projectId !== null) {
      return {
        ...this.projects.getProject(conversation.projectId),
        kind: "project"
      };
    }
    if (conversation.workspaceRootPath === null) return null;
    return {
      ...this.projects.getProject(conversation.id),
      kind: "conversation"
    };
  }

  private emit(emit: RunEventEmitter, event: ConversationRunEvent): void {
    let validated: ConversationRunEvent;
    try {
      validated = conversationRunEventSchema.parse(event);
    } catch (error) {
      throw new Error(`运行事件 ${event.type} 数据校验失败。`, { cause: error });
    }
    emit(validated);
  }
}

function estimateModelMessageTokens(
  message: Pick<ModelMessage, "attachments" | "content" | "toolCalls">
): { attachmentTokens: number; contentTokens: number; toolCallTokens: number } {
  return {
    attachmentTokens: message.attachments.reduce(
      (total, attachment) => total + attachment.contextTokens,
      0
    ),
    contentTokens:
      estimateContextTokens(message.content) + CONTEXT_MESSAGE_OVERHEAD_TOKENS,
    toolCallTokens: message.toolCalls.reduce(
      (total, call) =>
        total +
        estimateContextTokens(call.name) +
        estimateContextTokens(call.arguments) +
        CONTEXT_MESSAGE_OVERHEAD_TOKENS,
      0
    )
  };
}

function permissionModeLabel(mode: ConversationPermissionMode): string {
  switch (mode) {
    case "read_only":
      return "只读";
    case "ask_before_changes":
      return "修改前询问";
    case "full_access":
      return "完全访问";
  }
}
