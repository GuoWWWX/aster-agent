import { randomUUID } from "node:crypto";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { interrupt, isGraphInterrupt } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
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
  type ConversationToolItem,
  type ModelReasoningOption,
  replaceLatestConversationMessageInputSchema,
  type ReplaceLatestConversationMessageInput,
  type RunAccepted,
  type SendConversationMessageInput
} from "@agent/protocol";

import { reportMainError, toMainAgentError } from "../errors/agent-error.js";
import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelConfiguration } from "../model/model-contracts.js";
import {
  type CompleteTurnInput,
  type ModelMessage,
  type ModelProviderAdapter,
  type ModelToolCall,
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
  type QueuedRunRecovery,
  type RunExecutionSnapshot,
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
  type ToolExecution,
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
import {
  LangGraphExecutor,
  type LangGraphInterrupt,
} from "./langgraph-executor.js";
import {
  resolveActiveSkillContextBudget,
  SkillRuntime,
  type SkillRuntimeContext,
  type SkillSnapshotRef,
} from "./skill-runtime.js";
import { SubagentTool } from "./subagent-tool.js";
import {
  ToolHandlerRegistry,
  type ToolExecutionPolicy,
  type ToolHandler,
  type ToolHandlerExecutionContext,
} from "../tools/tool-handler-registry.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { parseToolArguments } from "../model/tool-arguments.js";

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

function createRunExecutionSnapshot(input: {
  configuration: ModelConfiguration;
  contextCompressionConfiguration: ContextCompressionThreshold;
  permissionMode: ConversationPermissionMode;
  providerId: string | undefined;
  reasoning: ModelReasoningOption | undefined;
}): RunExecutionSnapshot {
  const { mode, percentageThreshold, tokenThreshold } = input.contextCompressionConfiguration;
  return {
    apiFormat: input.configuration.apiFormat,
    baseUrl: input.configuration.baseUrl,
    contextCompressionConfiguration: {
      mode,
      percentageThreshold,
      tokenThreshold,
    },
    contextWindow: input.configuration.contextWindow ?? null,
    modelId: input.configuration.modelId,
    permissionMode: input.permissionMode,
    providerId: input.providerId ?? null,
    reasoning: input.reasoning === undefined ? null : structuredClone(input.reasoning),
    reasoningOptions: structuredClone(input.configuration.reasoningOptions),
  };
}

function assertRunConfigurationMatchesSnapshot(
  configuration: ModelConfiguration,
  snapshot: RunExecutionSnapshot,
): void {
  const sameReasoningOptions = JSON.stringify(configuration.reasoningOptions)
    === JSON.stringify(snapshot.reasoningOptions);
  if (
    configuration.apiFormat !== snapshot.apiFormat
    || configuration.baseUrl !== snapshot.baseUrl
    || configuration.contextWindow !== (snapshot.contextWindow ?? undefined)
    || configuration.modelId !== snapshot.modelId
    || !sameReasoningOptions
  ) {
    throw new Error("Queued Run 的模型配置已变化，无法安全恢复；请重新发送该消息。");
  }
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

type GraphToolExecutionInput = Omit<RuntimeToolContext, "onTaskListChanged" | "signal"> & {
  controller: AbortController;
};

type GraphToolCallInput = GraphToolExecutionInput & {
  toolBatchId: string;
  toolCall: ModelToolCall;
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
  promise: Promise<boolean>;
  resolve: (approved: boolean) => void;
  runId: string;
};

type ToolApprovalInterrupt = {
  conversationId: string;
  kind: "tool_approval";
  runId: string;
  toolId: string;
};

type LangChainToolResultEnvelope = {
  activeSkills: SkillSnapshotRef[];
  content: string;
  isError: boolean;
  marker: "agent-tool-result-v1";
  status?: "rejected" | undefined;
  successful: boolean;
};

type CachedGraphToolResult = {
  envelope: LangChainToolResultEnvelope;
  message: ModelMessage;
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

function isToolApprovalInterrupt(value: unknown): value is ToolApprovalInterrupt {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return record.kind === "tool_approval"
    && typeof record.conversationId === "string"
    && typeof record.runId === "string"
    && typeof record.toolId === "string";
}

function hasToolNodeMessages(value: unknown): value is { messages: unknown[] } {
  return typeof value === "object"
    && value !== null
    && "messages" in value
    && Array.isArray(value.messages);
}

function toolCallIdFromConfig(value: unknown): string | undefined {
  if (typeof value !== "object" || value === null || !("toolCall" in value)) return undefined;
  const toolCall = value.toolCall;
  if (typeof toolCall !== "object" || toolCall === null || !("id" in toolCall)) return undefined;
  return typeof toolCall.id === "string" ? toolCall.id : undefined;
}

function parseToolArgumentsOrEmpty(rawArguments: string): Record<string, unknown> {
  try {
    return parseToolArguments(rawArguments);
  } catch {
    // The project handler owns the structured malformed-JSON error. ToolNode
    // still needs an object-shaped value to invoke that handler.
    return {};
  }
}

const langChainToolResultEnvelopeSchema = z
  .object({
    activeSkills: z.array(z.object({
      contentHash: z.string().min(1),
      id: z.string().min(1),
      version: z.string().min(1),
    }).strict()),
    content: z.string(),
    isError: z.boolean(),
    marker: z.literal("agent-tool-result-v1"),
    status: z.literal("rejected").optional(),
    successful: z.boolean(),
  })
  .strict();

function parseLangChainToolResult(content: unknown): LangChainToolResultEnvelope {
  const serialized = typeof content === "string" ? content : JSON.stringify(content);
  return langChainToolResultEnvelopeSchema.parse(JSON.parse(serialized));
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

  private readonly activeSkillRefsByRun = new Map<string, Map<string, SkillSnapshotRef>>();

  /** Reused when ToolNode re-enters a tool after an interrupt resume. */
  private readonly startedToolsByRunCall = new Map<string, ConversationToolItem>();

  /** Completed calls are replayed as messages after an interrupt, never re-executed. */
  private readonly completedToolsByRunCall = new Map<string, CachedGraphToolResult>();

  /** Prepared side effects survive an approval interrupt without taking a new file snapshot. */
  private readonly preparedToolsByRunCall = new Map<string, ToolExecution>();

  /** Keeps one UI batch identity while a multi-call ToolNode is resumed. */
  private readonly toolBatchIdsByRunCalls = new Map<string, string>();

  private readonly pendingChangeApprovals = new Map<string, PendingChangeApproval>();

  /** Marks decisions that the replayed interrupt must consume without re-notifying the UI. */
  private readonly resumedApprovalDecisions = new Map<string, { approved: boolean; runId: string }>();

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
    private readonly agentDirectory: AgentDirectoryConfigurationProvider | null = null,
    private readonly skillRuntime: SkillRuntime | null = null,
    private readonly graphCheckpointer: BaseCheckpointSaver | null = null
  ) {
    this.taskListTool = new TaskListTool(database);
    this.agentCommunicationTool = new AgentCommunicationTool(database);
    this.subagentTool = new SubagentTool(database);
    this.attachmentTool = attachments === null
      ? null
      : new ConversationAttachmentTool(attachments);
    this.toolHandlers = this.createToolHandlerRegistry();
  }

  private skillRuntimeContext(
    conversation: ConversationSummary,
    projectId: string | undefined,
    activeSkillIds?: readonly string[],
  ): SkillRuntimeContext {
    // A temporary conversation may have its own workspace project record, but
    // it is not a project-scoped conversation and must not unlock project
    // Skills. The persisted conversation binding is the authoritative scope.
    const scopedProjectId = conversation.projectId === null ? undefined : projectId;
    let allowedSkillIds: readonly string[] | undefined;
    if (conversation.agentId !== null) {
      const agent = this.agentDirectory?.getConfiguration().agents.find(
        (candidate) => candidate.id === conversation.agentId,
      );
      if (agent === undefined || !agent.enabled) {
        allowedSkillIds = [];
      } else if (agent.capabilityScope === "custom") {
        allowedSkillIds = agent.skillIds;
      }
    }
    return {
      projectId: scopedProjectId,
      ...(activeSkillIds === undefined ? {} : { activeSkillIds }),
      ...(allowedSkillIds === undefined ? {} : { allowedSkillIds }),
      ...(conversation.teamId === null ? {} : { teamId: conversation.teamId }),
    };
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
        getExecutionPolicy: ({ toolName }) => this.agentCommunicationTool.getExecutionPolicy(toolName),
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
        getExecutionPolicy: ({ toolName }) => this.subagentTool.getExecutionPolicy(toolName),
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
        getExecutionPolicy: ({ toolName }) => this.taskListTool.getExecutionPolicy(toolName),
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
        getExecutionPolicy: ({ toolName }) => {
          if (this.attachmentTool === null) throw new Error("Attachment tool is unavailable.");
          return this.attachmentTool.getExecutionPolicy(toolName);
        },
        isAvailable: () => true,
      });
    }
    if (this.skillRuntime !== null) {
      handlers.push({
        execute: ({ context, rawArguments, toolName }) => {
          const conversation = this.database.getConversation(context.conversationId);
          const result = this.skillRuntime?.execute({
            arguments: rawArguments,
            context: this.skillRuntimeContext(
              conversation,
              context.projectId,
              [...(this.activeSkillRefsByRun.get(context.runId)?.keys() ?? [])],
            ),
            toolName,
          });
          if (result?.snapshot !== undefined) {
            const active = this.activeSkillRefsByRun.get(context.runId)
              ?? new Map<string, SkillSnapshotRef>();
            active.set(result.snapshot.id, result.snapshot);
            this.activeSkillRefsByRun.set(context.runId, active);
          }
          return Promise.resolve({
            content: result?.content ?? "Skill Runtime is unavailable.",
            isError: result?.isError ?? true,
            kind: "completed" as const,
          });
        },
        getDefinitions: () => this.skillRuntime?.getDefinitions() ?? [],
        getExecutionPolicy: ({ toolName }) => {
          if (this.skillRuntime === null) throw new Error("Skill Runtime is unavailable.");
          return this.skillRuntime.getExecutionPolicy(toolName);
        },
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
      getExecutionPolicy: ({ context, rawArguments, toolName }) => this.tools.getExecutionPolicy(
        toolName,
        rawArguments,
        context.permissionMode === "full_access",
      ),
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
      executionSnapshot: createRunExecutionSnapshot({
        configuration: prepared.configuration,
        contextCompressionConfiguration: prepared.contextCompressionConfiguration,
        permissionMode: prepared.permissionMode,
        providerId: prepared.input.providerId,
        reasoning: prepared.reasoning,
      }),
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
    for (const recovery of this.database.listQueuedRunRecoveries()) {
      try {
        this.resumeQueuedRun(recovery, emit);
      } catch (error) {
        const agentError = toMainAgentError(error, {
          operation: "agent.run.resume",
        });
        reportMainError(agentError, error);
        try {
          this.database.finishRun(recovery.runId, "failed", agentError.message);
        } catch (finishError) {
          reportMainError(
            toMainAgentError(finishError, { operation: "agent.run.resume.finish" }),
            finishError,
          );
        }
      }
    }
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

  private resumeQueuedRun(recovery: QueuedRunRecovery, emit: RunEventEmitter): void {
    const snapshot = recovery.executionSnapshot;
    if (snapshot === null) {
      throw new Error("Queued Run 缺少执行快照，无法安全恢复；请重新发送该消息。");
    }
    if (snapshot.modelId !== recovery.modelId) {
      throw new Error("Queued Run 的模型快照与 Run 记录不一致，无法安全恢复。");
    }
    const currentConfiguration = this.credentials.getConfiguration(
      snapshot.providerId ?? undefined,
      snapshot.modelId,
    );
    assertRunConfigurationMatchesSnapshot(currentConfiguration, snapshot);
    const configuration: ModelConfiguration = {
      ...currentConfiguration,
      apiFormat: snapshot.apiFormat,
      baseUrl: snapshot.baseUrl,
      contextCompression: structuredClone(snapshot.contextCompressionConfiguration),
      modelId: snapshot.modelId,
      reasoningOptions: structuredClone(snapshot.reasoningOptions),
      ...(snapshot.contextWindow === null ? {} : { contextWindow: snapshot.contextWindow }),
    };
    const preparedInput: SendConversationMessageInput = {
      attachmentIds: recovery.attachmentIds,
      content: recovery.content,
      conversationId: recovery.conversationId,
      modelId: snapshot.modelId,
      permissionMode: snapshot.permissionMode,
      ...(snapshot.providerId === null ? {} : { providerId: snapshot.providerId }),
      ...(snapshot.reasoning === null ? {} : { reasoning: structuredClone(snapshot.reasoning) }),
    };
    const prepared: PreparedConversationMessage = {
      contextCompressionConfiguration: structuredClone(snapshot.contextCompressionConfiguration),
      configuration,
      input: preparedInput,
      modelInputContent: recovery.content,
      permissionMode: snapshot.permissionMode,
      reasoning: snapshot.reasoning === null ? undefined : structuredClone(snapshot.reasoning),
    };
    this.assertAttachmentTurnFitsContext(
      preparedInput,
      configuration,
      prepared.contextCompressionConfiguration,
      prepared.permissionMode,
      prepared.modelInputContent,
    );
    this.scheduleExistingRun(recovery.runId, recovery.conversationId, prepared, emit);
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
    const executionSnapshot = createRunExecutionSnapshot({
      configuration,
      contextCompressionConfiguration: prepared.contextCompressionConfiguration,
      permissionMode: prepared.permissionMode,
      providerId: input.providerId,
      reasoning: prepared.reasoning,
    });
    const creation = pendingMessageId === undefined
      ? this.database.createRunWithUserMessage(
          input.conversationId,
          input.content,
          configuration.modelId,
          input.attachmentIds ?? [],
          prepared.modelInputContent,
          executionSnapshot,
        )
      : this.database.createRunFromPendingMessage(
          pendingMessageId,
          configuration.modelId,
          prepared.modelInputContent,
          executionSnapshot,
        );
    return this.schedulePreparedRun(creation, prepared, emit);
  }

  private schedulePreparedRun(
    creation: RunAccepted & { conversation: ConversationSummary },
    prepared: PreparedConversationMessage,
    emit: RunEventEmitter,
  ): RunAccepted {
    this.scheduleExistingRun(
      creation.runId,
      prepared.input.conversationId,
      prepared,
      emit,
    );
    return { runId: creation.runId, userMessage: creation.userMessage };
  }

  private scheduleExistingRun(
    runId: string,
    conversationId: string,
    prepared: PreparedConversationMessage,
    emit: RunEventEmitter,
  ): void {
    const { configuration, contextCompressionConfiguration, input } = prepared;
    const controller = new AbortController();
    this.registerActiveRun(runId, controller);
    this.agentMessageDepthByRun.set(runId, 0);
    if (!this.database.isConversationFork(conversationId)) {
      this.emit(emit, {
        conversation: this.database.getConversation(conversationId),
        type: "conversation.updated"
      });
    }
    setImmediate(() => {
      void this.executeRun(
        runId,
        conversationId,
        input.providerId,
        configuration,
        contextCompressionConfiguration,
        prepared.permissionMode,
        prepared.reasoning,
        controller,
        emit
      );
    });
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

  private async resumeGraphInterrupts(
    interrupts: readonly LangGraphInterrupt[],
    signal: AbortSignal,
  ): Promise<unknown> {
    if (interrupts.length !== 1) {
      throw new Error("Agent approval graph returned an unsupported number of interrupts.");
    }
    const [entry] = interrupts;
    if (entry === undefined || !isToolApprovalInterrupt(entry.value)) {
      throw new Error("Agent graph returned an unknown interrupt payload.");
    }
    const pending = this.pendingChangeApprovals.get(entry.value.toolId);
    if (pending === undefined || pending.runId !== entry.value.runId) {
      throw new Error("This tool approval is no longer pending.");
    }
    signal.throwIfAborted();
    try {
      const approved = await pending.promise;
      signal.throwIfAborted();
      this.resumedApprovalDecisions.set(entry.value.toolId, {
        approved,
        runId: entry.value.runId,
      });
      return approved;
    } finally {
      this.pendingChangeApprovals.delete(entry.value.toolId);
    }
  }

  private clearPendingChangeApprovals(runId: string): void {
    for (const [toolId, pending] of this.pendingChangeApprovals) {
      if (pending.runId !== runId) continue;
      pending.resolve(false);
      this.pendingChangeApprovals.delete(toolId);
    }
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
      this.activeSkillRefsByRun.set(runId, new Map());
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
      const initialMessages = (await this.prepareContext(
        conversationId,
        workspace,
        permissionMode,
        configuration.contextWindow ?? 0,
        contextCompressionConfiguration,
        configuration,
        controller.signal
      )).messages;
      let hasSuccessfulToolExecution = false;
      let lastAssistantContent = "";
      let lastAssistantMessageId = randomUUID();
      let lastAssistantResult: ModelTurnResult | null = null;
      let followUpInputForGraph = false;
      const graphResult = await new LangGraphExecutor().invoke({
        callbacks: {
          beforeModel: (state) => {
            const additions: ModelMessage[] = [];
            const incomingAgentMessages = this.database.listUnreadAgentMessages(conversationId);
            if (incomingAgentMessages.length > 0) {
              this.trackAgentMessagesForReply(runId, incomingAgentMessages);
              additions.push(...incomingAgentMessages.map((message) => ({
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
            const steerMessages: ModelMessage[] = [];
            this.consumePendingSteerMessages(conversationId, runId, steerMessages, emit);
            additions.push(...steerMessages);
            const activeSkillContext = this.skillRuntime?.buildActiveContext(
              state.activeSkills,
              this.skillRuntimeContext(conversation, workspace?.id),
              resolveActiveSkillContextBudget(configuration.contextWindow ?? 0),
            );
            return Promise.resolve({
              contextMessages: activeSkillContext === null || activeSkillContext === undefined
                ? []
                : [activeSkillContext],
              hasFollowUpInput: false,
              messages: additions,
            });
          },
          callModel: async (modelMessages) => {
            controller.signal.throwIfAborted();
            const messageId = randomUUID();
            lastAssistantMessageId = messageId;
            activeAssistantContent = "";
            activeAssistantContentPersisted = false;
            let result: ModelTurnResult;
            try {
              result = await this.completeModelTurnWithRetries({
                configuration,
                conversationId,
                emit,
                maxOutputTokens: MAX_OUTPUT_TOKENS,
                messageId,
                messages: [...modelMessages],
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
            followUpInputForGraph = toolCalls.length === 0 && (
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
              if (toolCalls.length > 0 || followUpInputForGraph) {
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
            }
            const normalizedResult = { ...result, toolCalls };
            lastAssistantResult = normalizedResult;
            return normalizedResult;
          },
          executeTools: async (toolCalls) => {
            const execution = await this.executeGraphTools({
              configuration,
              contextCompressionConfiguration,
              conversationId,
              controller,
              emit,
              operationOwner,
              permissionMode,
              projectId: workspace?.id,
              providerId,
              reasoning,
              runId,
              toolCalls,
            });
            hasSuccessfulToolExecution ||= execution.successful;
            return execution;
          },
          hasFollowUpInput: () => followUpInputForGraph,
        },
        initialMessages,
        maxSteps: MAX_AGENT_LOOPS,
        onInterrupt: (interrupts) => this.resumeGraphInterrupts(
          interrupts,
          controller.signal,
        ),
        signal: controller.signal,
        threadId: runId,
        ...(this.graphCheckpointer === null ? {} : { checkpointer: this.graphCheckpointer }),
      });
      const result = lastAssistantResult ?? graphResult.lastResult;
      if (result === null) throw new Error("Agent graph finished without a model result.");
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
          messageId: lastAssistantMessageId,
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
      this.clearPendingChangeApprovals(runId);
      for (const [toolId, decision] of this.resumedApprovalDecisions) {
        if (decision.runId === runId) this.resumedApprovalDecisions.delete(toolId);
      }
      this.activeRuns.delete(runId);
      this.agentMessageDepthByRun.delete(runId);
      this.agentMessagesToReplyByRun.delete(runId);
      this.activeSkillRefsByRun.delete(runId);
      for (const key of this.startedToolsByRunCall.keys()) {
        if (key.startsWith(`${runId}:`)) this.startedToolsByRunCall.delete(key);
      }
      for (const key of this.completedToolsByRunCall.keys()) {
        if (key.startsWith(`${runId}:`)) this.completedToolsByRunCall.delete(key);
      }
      for (const key of this.preparedToolsByRunCall.keys()) {
        if (key.startsWith(`${runId}:`)) this.preparedToolsByRunCall.delete(key);
      }
      for (const key of this.toolBatchIdsByRunCalls.keys()) {
        if (key.startsWith(`${runId}:`)) this.toolBatchIdsByRunCalls.delete(key);
      }
      if (this.graphCheckpointer !== null) {
        try {
          await this.graphCheckpointer.deleteThread(runId);
        } catch (error) {
          console.error("LangGraph checkpoint cleanup failed.", error);
        }
      }
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
      [],
      input.task,
      createRunExecutionSnapshot({
        configuration: input.configuration,
        contextCompressionConfiguration: input.contextCompressionConfiguration,
        permissionMode: input.permissionMode,
        providerId: input.providerId,
        reasoning: input.reasoning,
      }),
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
        createRunExecutionSnapshot({
          configuration,
          contextCompressionConfiguration,
          permissionMode: DEFAULT_PERMISSION_MODE,
          providerId: undefined,
          reasoning: undefined,
        }),
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

  private async executeGraphTools(
    input: GraphToolExecutionInput & { toolCalls: readonly ModelToolCall[] },
  ): Promise<{ activeSkills: SkillSnapshotRef[]; messages: ModelMessage[]; successful: boolean }> {
    const messages = Array<ModelMessage | undefined>(input.toolCalls.length);
    const policies = new Map<number, ToolExecutionPolicy>();
    let hasSuccessfulToolExecution = false;
    const toolBatchKey = `${input.runId}:${input.toolCalls.map((toolCall) => toolCall.id).join(",")}`;
    const toolBatchId = this.toolBatchIdsByRunCalls.get(toolBatchKey) ?? randomUUID();
    this.toolBatchIdsByRunCalls.set(toolBatchKey, toolBatchId);

    for (let index = 0; index < input.toolCalls.length; index += 1) {
      input.controller.signal.throwIfAborted();
      const toolCall = input.toolCalls[index];
      if (toolCall === undefined) continue;
      const callKey = `${input.runId}:${toolCall.id}`;
      const cached = this.completedToolsByRunCall.get(callKey);
      if (cached !== undefined) {
        messages[index] = cached.message;
        hasSuccessfulToolExecution ||= cached.envelope.successful;
        continue;
      }
      policies.set(index, this.toolHandlers.getExecutionPolicy({
        context: this.runtimeToolContext(input),
        rawArguments: toolCall.arguments,
        toolName: toolCall.name,
      }));
    }

    // Prepare every file change from this model turn before applying the first
    // one. A later call targeting the same file therefore keeps the original
    // expectedContent and becomes FILE_CHANGED instead of being re-based.
    for (let index = 0; index < input.toolCalls.length; index += 1) {
      const toolCall = input.toolCalls[index];
      const policy = policies.get(index);
      if (
        toolCall !== undefined
        && policy?.kind === "serial"
        && policy.prepareBeforeBatch === true
      ) {
        await this.prepareGraphToolCall({ ...input, toolBatchId, toolCall });
      }
    }

    let index = 0;
    while (index < input.toolCalls.length) {
      input.controller.signal.throwIfAborted();
      const toolCall = input.toolCalls[index];
      if (toolCall === undefined) {
        index += 1;
        continue;
      }
      const callKey = `${input.runId}:${toolCall.id}`;
      if (this.completedToolsByRunCall.has(callKey)) {
        index += 1;
        continue;
      }
      const policy = policies.get(index) ?? { kind: "serial" as const };
      const group: ModelToolCall[] = [toolCall];
      let nextIndex = index + 1;
      if (policy.kind === "parallel") {
        while (nextIndex < input.toolCalls.length) {
          const nextCall = input.toolCalls[nextIndex];
          const nextPolicy = policies.get(nextIndex);
          if (
            nextCall === undefined
            || this.completedToolsByRunCall.has(`${input.runId}:${nextCall.id}`)
            || nextPolicy?.kind !== "parallel"
            || nextPolicy.group !== policy.group
          ) {
            break;
          }
          group.push(nextCall);
          nextIndex += 1;
        }
      }

      const envelopes = await this.invokeGraphToolNode({
        ...input,
        toolBatchId,
        toolCalls: group,
      });
      for (const [offset, call] of group.entries()) {
        const result = envelopes.get(call.id);
        if (result === undefined) {
          throw new Error(`ToolNode did not return a result for ${call.name}.`);
        }
        const resultIndex = index + offset;
        const message: ModelMessage = {
          attachments: [],
          content: result.content,
          role: "tool",
          toolCallId: call.id,
          toolCalls: [],
        };
        messages[resultIndex] = message;
        hasSuccessfulToolExecution ||= result.successful;
        this.completedToolsByRunCall.set(`${input.runId}:${call.id}`, { envelope: result, message });
      }
      index = nextIndex;
    }

    this.toolBatchIdsByRunCalls.delete(toolBatchKey);
    return {
      activeSkills: [...(this.activeSkillRefsByRun.get(input.runId)?.values() ?? [])],
      messages: messages.filter((message): message is ModelMessage => message !== undefined),
      successful: hasSuccessfulToolExecution,
    };
  }

  private async prepareGraphToolCall(input: GraphToolCallInput): Promise<void> {
    const key = `${input.runId}:${input.toolCall.id}`;
    if (this.preparedToolsByRunCall.has(key)) return;
    try {
      const proposal = await this.toolHandlers.execute({
        context: this.runtimeToolContext(input),
        rawArguments: input.toolCall.arguments,
        toolName: input.toolCall.name,
      });
      this.preparedToolsByRunCall.set(key, proposal);
    } catch (error) {
      if (input.controller.signal.aborted || isAbortError(error) || isGraphInterrupt(error)) {
        throw error;
      }
      this.preparedToolsByRunCall.set(key, {
        content: toolErrorContent(error, `tool:${input.toolCall.name}`),
        isError: true,
        kind: "completed",
      });
    }
  }

  private async invokeGraphToolNode(input: GraphToolExecutionInput & {
    toolBatchId: string;
    toolCalls: readonly ModelToolCall[];
  }): Promise<Map<string, LangChainToolResultEnvelope>> {
    const callsById = new Map(input.toolCalls.map((toolCall) => [toolCall.id, toolCall]));
    const definitions = this.toolHandlers.getDefinitions({ projectId: input.projectId });
    const toolsByName = new Map<string, DynamicStructuredTool>();
    for (const toolCall of input.toolCalls) {
      if (toolsByName.has(toolCall.name)) continue;
      const definition = definitions.find((candidate) => candidate.name === toolCall.name);
      if (definition === undefined) throw new Error(`Unknown tool: ${toolCall.name}`);
      toolsByName.set(toolCall.name, new DynamicStructuredTool({
        description: definition.description,
        func: async (_arguments, _runManager, config) => {
          const callId = toolCallIdFromConfig(config);
          const call = callId === undefined ? undefined : callsById.get(callId);
          if (call === undefined) throw new Error(`ToolNode lost the tool call identity for ${definition.name}.`);
          const execution = await this.executeGraphToolCall({
            ...input,
            toolCall: call,
          });
          return JSON.stringify({
            activeSkills: execution.activeSkills,
            content: execution.content,
            isError: execution.isError,
            marker: "agent-tool-result-v1",
            ...(execution.status === undefined ? {} : { status: execution.status }),
            successful: execution.successful,
          } satisfies LangChainToolResultEnvelope);
        },
        name: definition.name,
        schema: z.record(z.string(), z.unknown()),
      }));
    }

    const output: unknown = await new ToolNode([...toolsByName.values()], {
      handleToolErrors: false,
    }).invoke({
      messages: [new AIMessage({
        content: "",
        tool_calls: input.toolCalls.map((toolCall) => ({
          args: parseToolArgumentsOrEmpty(toolCall.arguments),
          id: toolCall.id,
          name: toolCall.name,
          type: "tool_call" as const,
        })),
      })],
    }, { signal: input.controller.signal });
    if (!hasToolNodeMessages(output)) {
      throw new Error("ToolNode returned an invalid result.");
    }
    const results = new Map<string, LangChainToolResultEnvelope>();
    for (const message of output.messages) {
      if (!(message instanceof ToolMessage)) {
        throw new Error("ToolNode did not return a ToolMessage.");
      }
      const callId = message.tool_call_id;
      if (typeof callId !== "string" || !callsById.has(callId)) {
        throw new Error("ToolNode returned a result for an unknown tool call.");
      }
      if (results.has(callId)) throw new Error(`ToolNode returned duplicate result for ${callId}.`);
      results.set(callId, parseLangChainToolResult(message.content));
    }
    if (results.size !== input.toolCalls.length) {
      throw new Error("ToolNode did not return one result for every tool call.");
    }
    return results;
  }

  private runtimeToolContext(input: GraphToolExecutionInput): RuntimeToolContext {
    return {
      configuration: input.configuration,
      contextCompressionConfiguration: input.contextCompressionConfiguration,
      conversationId: input.conversationId,
      emit: input.emit,
      onTaskListChanged: (taskList) => {
        this.emit(input.emit, {
          conversationId: input.conversationId,
          runId: input.runId,
          taskList,
          type: "task_list.updated",
        });
      },
      operationOwner: input.operationOwner,
      permissionMode: input.permissionMode,
      projectId: input.projectId,
      providerId: input.providerId,
      reasoning: input.reasoning,
      runId: input.runId,
      signal: input.controller.signal,
    };
  }

  private async executeGraphToolCall(
    input: GraphToolCallInput,
  ): Promise<LangChainToolResultEnvelope & { activeSkills: SkillSnapshotRef[] }> {
    const key = `${input.runId}:${input.toolCall.id}`;
    const startedTool = this.startedToolsByRunCall.get(key)
      ?? conversationToolItemSchema.parse({
        arguments: input.toolCall.arguments,
        batchId: input.toolBatchId,
        conversationId: input.conversationId,
        createdAt: new Date().toISOString(),
        id: randomUUID(),
        kind: "tool",
        name: input.toolCall.name,
        result: null,
        runId: input.runId,
        status: "running",
        diff: null,
      });
    if (!this.startedToolsByRunCall.has(key)) {
      this.startedToolsByRunCall.set(key, startedTool);
      this.database.appendToolStarted(startedTool);
      this.emit(input.emit, {
        conversationId: input.conversationId,
        runId: input.runId,
        tool: startedTool,
        type: "tool.started",
      });
    }

    let proposal: ToolExecution | undefined = this.preparedToolsByRunCall.get(key);
    let execution: ToolExecutionResult;
    try {
      if (proposal === undefined) {
        proposal = await this.toolHandlers.execute({
          context: this.runtimeToolContext(input),
          rawArguments: input.toolCall.arguments,
          toolName: input.toolCall.name,
        });
        if (proposal.kind === "change" || proposal.kind === "command") {
          this.preparedToolsByRunCall.set(key, proposal);
        }
      }
      execution = proposal.kind === "change"
        ? await this.resolveFileChange({
            change: proposal.change,
            controller: input.controller,
            permissionMode: input.permissionMode,
            projectId: input.projectId ?? (() => {
              throw new Error("A project is required for file changes.");
            })(),
            runId: input.runId,
            startedTool,
            emit: input.emit,
            operationOwner: input.operationOwner,
          })
        : proposal.kind === "command"
          ? await this.resolveCommand({
              command: proposal.command,
              controller: input.controller,
              emit: input.emit,
              permissionMode: input.permissionMode,
              projectId: input.projectId ?? (() => {
                throw new Error("A project is required for command execution.");
              })(),
              runId: input.runId,
              startedTool,
              operationOwner: input.operationOwner,
            })
          : proposal;
    } catch (error) {
      // Approval interrupts and cancellation must escape so LangGraph can
      // suspend/resume or terminate the run. Other tool failures are turned
      // into a bounded ToolMessage and persisted as a failed tool row.
      if (input.controller.signal.aborted || isAbortError(error) || isGraphInterrupt(error)) {
        throw error;
      }
      execution = {
        content: toolErrorContent(error, `tool:${input.toolCall.name}`),
        isError: true,
        kind: "completed",
      };
    }
    const toolDiff = proposal?.kind === "change" ? proposal.change.diff : null;
    const completedTool = conversationToolItemSchema.parse({
      ...startedTool,
      diff: toolDiff,
      result: execution.content,
      status: execution.status ?? (execution.isError ? "failed" : "completed"),
    });
    this.database.completeTool({
      providerCallId: input.toolCall.id,
      result: execution.content,
      tool: completedTool,
    });
    this.startedToolsByRunCall.delete(key);
    this.preparedToolsByRunCall.delete(key);
    this.emit(input.emit, {
      conversationId: input.conversationId,
      fileChange:
        proposal?.kind === "change"
        && completedTool.status === "completed"
        && input.projectId !== undefined
          ? {
              operation: proposal.change.operation,
              path: proposal.change.path,
              projectId: input.projectId,
            }
          : null,
      runId: input.runId,
      tool: completedTool,
      type: "tool.completed",
    });
    return {
      activeSkills: [...(this.activeSkillRefsByRun.get(input.runId)?.values() ?? [])],
      content: execution.content,
      isError: execution.isError,
      marker: "agent-tool-result-v1",
      ...(execution.status === undefined ? {} : { status: execution.status }),
      successful: completedTool.status === "completed",
    };
  }

  private requestToolApproval(input: {
    runId: string;
    signal: AbortSignal;
    tool: ReturnType<typeof conversationToolItemSchema.parse>;
    emit: RunEventEmitter;
  }): boolean {
    const interruptValue: ToolApprovalInterrupt = {
      conversationId: input.tool.conversationId,
      kind: "tool_approval",
      runId: input.runId,
      toolId: input.tool.id,
    };
    const resumed = this.resumedApprovalDecisions.get(input.tool.id);
    if (resumed !== undefined && resumed.runId === input.runId) {
      const approved = interrupt<ToolApprovalInterrupt, boolean>(interruptValue);
      this.resumedApprovalDecisions.delete(input.tool.id);
      return approved;
    }

    this.database.updateTool(input.tool);
    void this.createChangeApproval(input.tool.id, input.runId, input.signal);
    this.emit(input.emit, {
      conversationId: input.tool.conversationId,
      runId: input.runId,
      tool: input.tool,
      type: "tool.approval_requested",
    });
    return interrupt<ToolApprovalInterrupt, boolean>(interruptValue);
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
      const approved = this.requestToolApproval({
        emit: input.emit,
        runId: input.runId,
        signal: input.controller.signal,
        tool: awaitingTool,
      });
      this.pendingChangeApprovals.delete(awaitingTool.id);
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
      const approved = this.requestToolApproval({
        emit: input.emit,
        runId: input.runId,
        signal: input.controller.signal,
        tool: awaitingTool,
      });
      this.pendingChangeApprovals.delete(awaitingTool.id);
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

  private createChangeApproval(
    toolId: string,
    runId: string,
    signal: AbortSignal
  ): Promise<boolean> {
    const existing = this.pendingChangeApprovals.get(toolId);
    if (existing !== undefined && existing.runId === runId) return existing.promise;

    let resolvePromise: (approved: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve;
    });
    const cleanup = (): void => {
      signal.removeEventListener("abort", onAbort);
      if (this.pendingChangeApprovals.get(toolId)?.runId === runId) {
        this.pendingChangeApprovals.delete(toolId);
      }
    };
    const onAbort = (): void => {
      cleanup();
      resolvePromise(false);
    };
    const pending: PendingChangeApproval = {
      promise,
      resolve: (approved) => {
        signal.removeEventListener("abort", onAbort);
        resolvePromise(approved);
      },
      runId,
    };
    this.pendingChangeApprovals.set(toolId, pending);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
    return promise;
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
        this.skillRuntime === null
          ? "Skill 特指通过 SKILL.md 注入的任务说明和能力组合；当前没有可调用的 Skill Runtime，不要把一般能力列成 Skill。Git 是可通过 run_command 执行的命令行程序，不是 Skill，也不是当前的专用 Git 工具；仅在任务确实需要且工作区是 Git 仓库时使用。"
          : "Skill 特指通过 SKILL.md 注入的任务说明和能力组合，不等同于内置工具、Agent 职责或命令行程序。需要详细指令时先根据目录调用 load_skill；Skill 正文只进入本轮模型上下文，不写入聊天 Timeline。Skill 不能扩大工具权限或绕过审批。Git 是可通过 run_command 执行的命令行程序，不是 Skill，也不是当前的专用 Git 工具；仅在任务确实需要且工作区是 Git 仓库时使用。",
        "用户消息开头的内置命令语义：/plan 表示先分析并创建任务清单再执行；/review 表示审查相关实现、优先指出缺陷和风险；/test 表示运行与当前任务相关的测试并根据结果修复。命令后的文本是具体任务。",
        "对于包含两个或以上独立步骤的复杂任务，先用 create_task_list 建立完整任务清单；每完成一步就用 update_task_list 更新完整清单，并且同一时间只能有一个步骤为 running。简单问答或单步修改不要创建任务清单。全部步骤完成后调用 close_task_list 删除清单，再给出最终答复。",
        workspace === null
          ? this.attachmentTool === null
            ? "当前是临时对话，没有关联项目或文件工具。"
            : "当前是临时对话，没有关联项目；仍可使用 read_attachment 读取本对话中的文本附件。"
          : `当前提供工作目录内读文件、搜索、受控文件变更和 ${this.tools.getCommandEnvironmentDescription()} 命令工具；命令与写入均受本轮权限策略控制。`,
        "同一模型轮可以返回多个相互独立的只读 Tool Call（例如同时 read_file 多个文件、search_text、find_files 或 read_attachment），运行时会并发执行并按调用 ID 保持结果对应。文件变更、审批、Agent 消息和任务状态按顺序处理；同批同文件的旧变更会作废。只有 full_access 且明确设置 parallel=true 的独立 run_command 才会并行，命令可能修改工作区时不要标记为并行。wait_for_commands 和 wait_for_subagents 优先一次传入多个 ID。",
        "简单、结果需要保持有界的文本或文件查询优先调用 search_text 和 find_files。需要 ripgrep 的上下文行、计数、多表达式、复杂 glob、精确 CLI 输出或管道组合时，可以直接用 run_command 执行 rg；应用已提供内置 rg，不要求用户另行安装。",
        "如果文件变更工具返回 PROJECT_OPERATION_CONFLICT、FILE_CHANGED 或 recovery.action=reread_and_rebuild_change，本次文件变更请求已经作废；不要排队、重放或继续提交相同参数。必要时等待当前占用操作结束，然后必须重新调用 read_file 获取最新内容，再生成新的 Diff。run_command 的 PROJECT_OPERATION_CONFLICT 同样表示原命令已作废；等待后应重新评估最新工作区状态，只在仍适用时生成新命令。",
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
        ...(this.skillRuntime === null
          ? []
          : [this.skillRuntime.getCatalogPrompt(
              this.skillRuntimeContext(conversation, workspace?.id),
            ) ?? "当前没有满足范围和依赖条件的可用 Skill。"]),
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
    const reservedSkillTokens = this.skillRuntime === null
      ? 0
      : resolveActiveSkillContextBudget(contextWindowTokens) + CONTEXT_MESSAGE_OVERHEAD_TOKENS;
    const managed = buildManagedContext({
      checkpoint: this.database.getContextCheckpoint(conversationId),
      compressionMode: contextCompressionConfiguration.mode,
      compressionThresholdTokens,
      estimatedSystemTokens,
      estimatedToolDefinitionTokens,
      outputReserveTokens: MAX_OUTPUT_TOKENS,
      reservedSkillTokens,
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
