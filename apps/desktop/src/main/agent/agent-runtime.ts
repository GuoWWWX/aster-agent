import { createHash, randomUUID } from "node:crypto";
import { AIMessage, ToolMessage } from "@langchain/core/messages";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { interrupt, isGraphInterrupt } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { z } from "zod";
import {
  AGENT_AVATAR_ICONS,
  approveToolChangeInputSchema,
  agentPermissionRuleSchema,
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
  type AgentAvatarIcon,
  type AgentPermissionRule,
  type AgentPermissionTool,
  type ApplicationPermissionPolicies,
  type ApplicationSettings,
  type PermissionPolicy,
  type ConversationAgentBinding,
  type ConversationAgentMessageItem,
  type ConversationAttachment,
  type ConversationMessageSubmission,
  type ConversationModelSelection,
  type ConversationPendingMessage,
  type ConversationContextUsage,
  sendConversationMessageInputSchema,
  type ConversationPermissionMode,
  type ConversationRunEvent,
  type ConversationSummary,
  type ConversationTaskList,
  type ConversationToolExecutionMode,
  type ConversationToolItem,
  type ModelReasoningOption,
  type ModelRuntimeStatus,
  replaceLatestConversationMessageInputSchema,
  type ReplaceLatestConversationMessageInput,
  type RunAccepted,
  type SendConversationMessageInput
} from "@agent/protocol";

import { reportMainError, toMainAgentError } from "../errors/agent-error.js";
import { toolErrorContent } from "../errors/tool-error.js";
import type {
  ModelConfiguration,
  ModelContextConfiguration,
} from "../model/model-contracts.js";
import {
  type CompleteTurnInput,
  type ModelMessage,
  type ModelProviderAdapter,
  type ModelToolCall,
  type ModelToolDefinition,
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
  type StoredPendingMessage,
  type SubagentTask
} from "../storage/agent-database.js";
import type { PluginCatalogRecord } from "../storage/agent-database.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog, type ThreadLogEventInput } from "../storage/thread-log.js";
import { ThreadLogLegacyImporter } from "../storage/thread-log-legacy-importer.js";
import { RunCoordinator } from "./run-coordinator.js";
import { ModelGateway } from "./model-gateway.js";
import { TaskListTool } from "../tasks/task-list-tool.js";
import { ConversationAttachmentTool } from "../tools/conversation-attachment-tool.js";
import { WebSearchTool } from "../tools/web-search-tool.js";
import {
  ProjectToolRegistry,
  type PreparedCommand,
  type PreparedExternalFileRead,
  type PreparedFileChange,
  type ProjectOperationOwner,
  type ToolExecution,
  type ToolExecutionResult
} from "../tools/project-tool-registry.js";
import {
  createContextCompactionMessages,
  type ManagedContextSourceMessage,
  parseContextSummary
} from "./context-manager.js";
import { ContextCompiler } from "./context-compiler.js";
import {
  activeTaskListContextMessage,
  activeTaskListContextTokens,
} from "./task-list-context.js";
import {
  buildConversationReferenceBundle,
  resolveConversationReferenceBudget,
} from "./conversation-reference.js";
import { AgentCommunicationTool } from "./agent-communication-tool.js";
import {
  LangGraphExecutor,
  type AgentGraphModelCallHooks,
  type AgentGraphModelRetry,
  type LangGraphInterrupt,
} from "./langgraph-executor.js";
import {
  resolveActiveSkillContextBudget,
  SkillRuntime,
  type SkillRuntimeContext,
  type SkillSnapshotRef,
} from "./skill-runtime.js";
import { SubagentTool } from "./subagent-tool.js";
import { BASE_SYSTEM_PROMPT } from "./prompts/prompt-assets.js";
import {
  ToolHandlerRegistry,
  type ToolExecutionPolicy,
  type ToolHandler,
  type ToolHandlerExecutionContext,
} from "../tools/tool-handler-registry.js";
import {
  MAX_PARALLEL_COMMAND_TOOL_CALLS,
  MAX_PARALLEL_READ_TOOL_CALLS,
} from "../tools/tool-execution-policy.js";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import { parseToolArguments } from "../model/tool-arguments.js";

const MAX_AGENT_LOOPS = 8;
const MAX_TOOL_CALLS_PER_MODEL_TURN = 32;
const MAX_CONTEXT_COMPACTIONS_PER_RUN = 3;
const MAX_MODEL_RECONNECT_ATTEMPTS = 5;
const MAX_AGENT_MESSAGE_AUTO_DEPTH = 4;
const MAX_OUTPUT_TOKENS = 8_192;
const MAX_SUMMARY_OUTPUT_TOKENS = 4_096;
const MODEL_RETRY_INITIAL_DELAY_MS = 1_000;
const MODEL_RETRY_MAX_DELAY_MS = 16_000;
const DEFAULT_PERMISSION_MODE: ConversationPermissionMode = "ask_before_changes";

function fallbackSubagentAvatarIcon(seed: string): AgentAvatarIcon {
  let hash = 0;
  for (const character of seed) {
    hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
  }
  return AGENT_AVATAR_ICONS[Math.abs(hash) % AGENT_AVATAR_ICONS.length] ?? "bot";
}

class ToolCallLimitError extends Error {
  public readonly code = "TOOL_CALL_LIMIT_EXCEEDED";

  public constructor(
    count: number,
    limit: number,
  ) {
    super(
      `模型本轮返回了 ${count} 个工具调用，超过安全上限 ${limit}。请拆分为多个模型轮次后重试。`,
    );
    this.name = "ToolCallLimitError";
  }
}

class ModelToolCallValidationError extends Error {
  public readonly code = "MODEL_TOOL_CALLS_INVALID";

  public constructor(message: string) {
    super(message);
    this.name = "ModelToolCallValidationError";
  }
}

class ToolApprovalExpiredError extends Error {
  public readonly code = "APPROVAL_EXPIRED";

  public constructor() {
    super("This tool approval is no longer pending.");
    this.name = "ToolApprovalExpiredError";
  }
}

function chunkToolCalls(
  toolCalls: readonly ModelToolCall[],
  chunkSize: number,
): ModelToolCall[][] {
  const chunks: ModelToolCall[][] = [];
  for (let start = 0; start < toolCalls.length; start += chunkSize) {
    chunks.push([...toolCalls.slice(start, start + chunkSize)]);
  }
  return chunks;
}

type ModelConfigurationProvider = {
  getConfiguration(providerId?: string, modelId?: string): ModelConfiguration;
  getContextConfiguration?: (
    providerId?: string,
    modelId?: string,
  ) => ModelContextConfiguration;
  getStatus?: () => ModelRuntimeStatus;
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

type ApplicationSettingsProvider = {
  getConfiguration(): ApplicationSettings;
  saveConfiguration(configuration: ApplicationSettings): ApplicationSettings;
};

type PluginCatalogProvider = {
  list(): readonly PluginCatalogRecord[];
};

const defaultContextCompressionConfigurationProvider: ContextCompressionConfigurationProvider = {
  getConfiguration: () => DEFAULT_CONTEXT_COMPRESSION_CONFIGURATION
};

function resolveContextCompressionConfiguration(
  modelConfiguration: Pick<ModelConfiguration, "contextCompression">,
  globalConfiguration: ContextCompressionConfiguration
): ContextCompressionThreshold {
  return modelConfiguration.contextCompression ?? globalConfiguration;
}

function createRunExecutionSnapshot(input: {
  configuration: ModelConfiguration;
  contextCompressionConfiguration: ContextCompressionThreshold;
  permissionMode: ConversationPermissionMode;
  plugins: readonly { contentHash: string; id: string; version: string }[];
  providerId: string | undefined;
  reasoning: ModelReasoningOption | undefined;
  toolDefinitions: readonly ModelToolDefinition[];
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
    plugins: input.plugins.map((plugin) => ({
      contentHash: plugin.contentHash,
      id: plugin.id,
      version: plugin.version,
    })),
    providerId: input.providerId ?? null,
    reasoning: input.reasoning === undefined ? null : structuredClone(input.reasoning),
    reasoningOptions: structuredClone(input.configuration.reasoningOptions),
    toolManifest: createToolManifestSnapshot(input.toolDefinitions),
  };
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => (
    `${JSON.stringify(key)}:${stableJson(record[key])}`
  )).join(",")}}`;
}

function createToolManifestSnapshot(definitions: readonly ModelToolDefinition[]): RunExecutionSnapshot["toolManifest"] {
  return definitions
    .map((definition) => ({
      contentHash: createHash("sha256").update(stableJson({
        description: definition.description,
        name: definition.name,
        parameters: definition.parameters,
      }), "utf8").digest("hex"),
      name: definition.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function assertRunToolManifestMatchesSnapshot(
  definitions: readonly ModelToolDefinition[],
  snapshot: RunExecutionSnapshot,
): void {
  // Snapshots created before this field existed remain recoverable. New Runs
  // always contain it, so a restart cannot silently change callable tools.
  if (snapshot.toolManifest.length === 0) return;
  const current = createToolManifestSnapshot(definitions);
  if (JSON.stringify(current) !== JSON.stringify(snapshot.toolManifest)) {
    throw new Error("Queued Run 的 Tool Manifest 已变化，无法安全恢复；请重新发送该消息。");
  }
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
  executionMode: ConversationToolExecutionMode;
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
  agentId: string | null;
  conversationId: string;
  pattern: string;
  permissionTool: AgentPermissionTool;
  promise: Promise<boolean>;
  resolve: (approved: boolean) => void;
  runId: string;
};

type ToolApprovalInterrupt = {
  conversationId: string;
  kind: "tool_approval";
  pattern: string;
  permissionTool: AgentPermissionTool;
  runId: string;
  toolId: string;
};

type PermissionDecision = "allow" | "ask" | "deny";

const DEFAULT_APPLICATION_PERMISSION_POLICIES: ApplicationPermissionPolicies = {
  "command-run": "ask",
  "git-write": "unavailable",
  "patch-write": "ask",
  "workspace-read": "allow",
  "workspace-search": "allow",
};

const PROJECT_READ_TOOL_NAMES = new Set([
  "list_directory",
  "read_file",
]);

const PROJECT_SEARCH_TOOL_NAMES = new Set([
  "find_files",
  "search_text",
]);

function normalizePermissionCandidate(
  tool: AgentPermissionTool,
  candidate: string,
): string {
  const trimmed = candidate.trim();
  return tool === "run_command" || tool === "external_read"
    ? trimmed
    : trimmed.replaceAll("\\", "/").replace(/^\.\//u, "");
}

function permissionRuleMatches(
  rule: AgentPermissionRule,
  tool: AgentPermissionTool,
  candidate: string,
): boolean {
  if (rule.tool !== tool) return false;
  const normalizedCandidate = normalizePermissionCandidate(tool, candidate);
  const pattern = normalizePermissionCandidate(tool, rule.pattern);
  if (pattern === "*") return true;
  if (!pattern.endsWith("*")) return pattern === normalizedCandidate;
  const prefix = pattern.slice(0, -1).trimEnd();
  if (tool !== "run_command" && (prefix.endsWith("/") || prefix.endsWith("\\"))) {
    return normalizedCandidate.startsWith(prefix);
  }
  return normalizedCandidate === prefix || normalizedCandidate.startsWith(`${prefix} `);
}

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
        return `You are the Team Lead for team ${conversation.teamId ?? "unbound"}. Accept work, decide whether to delegate, and consolidate the final result.`;
      case "agent":
        if (conversation.parentConversationId !== null) {
          return `You are a side branch created from parent conversation ${conversation.parentConversationId}. Its context snapshot is already injected but is not repeated in the side-chat UI. Do not call read_agent_conversation merely to retrieve that inherited snapshot. Later parent messages do not sync into this branch.`;
        }
        return conversation.teamId === null
          ? "You are an independent Agent."
          : `You are a standing Agent in team ${conversation.teamId}.`;
      case "subagent":
        return `You are a temporary Subagent derived from parent conversation ${conversation.parentConversationId ?? "unknown"}. The parent snapshot at creation is already injected as this conversation's history; do not reread the parent for the same content. Handle only the assigned branch task, return verifiable results, and do not recursively create teams.`;
    }
  })();
  if (agent === null) return [identity];
  return [
    identity,
    `Current Agent: ${agent.name} (${agent.id}).${agent.role.length === 0 ? "" : ` Role: ${agent.role}.`}`,
    ...(agent.instructions.length === 0 ? [] : [`Agent-specific instructions: ${agent.instructions}`])
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
    && typeof record.pattern === "string"
    && typeof record.permissionTool === "string"
    && typeof record.runId === "string"
    && typeof record.toolId === "string"
    && [
      "apply_patch",
      "delete_file",
      "external_read",
      "replace_in_file",
      "run_command",
      "write_file",
    ].includes(record.permissionTool);
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
  return resolveConfiguredReasoning(input.reasoning, configuration);
}

function resolveConfiguredReasoning(
  reasoning: ModelReasoningOption | undefined,
  configuration: ModelConfiguration,
): ModelReasoningOption | undefined {
  if (reasoning === undefined) return undefined;
  const key = modelReasoningOptionKey(reasoning);
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
  private readonly runCoordinator = new RunCoordinator();

  private readonly graphExecutor = new LangGraphExecutor();

  private readonly modelGateway: ModelGateway;

  private readonly contextCompiler: ContextCompiler;

  private readonly agentMessageDepthByRun = new Map<string, number>();

  private readonly agentMessagesToReplyByRun = new Map<string, ConversationAgentMessageItem[]>();

  private readonly activeSkillRefsByRun = new Map<string, Map<string, SkillSnapshotRef>>();

  /** Reused when ToolNode re-enters a tool after an interrupt resume. */
  private readonly startedToolsByRunCall = new Map<string, ConversationToolItem>();

  /** Completed calls are replayed as messages after an interrupt, never re-executed. */
  private readonly completedToolsByRunCall = new Map<string, CachedGraphToolResult>();

  /**
   * A sibling approval interrupt can cause LangGraph's ToolNode to replay a
   * batch while an already-approved command is still running. Reuse that
   * promise instead of starting the side effect a second time.
   */
  private readonly inFlightToolsByRunCall = new Map<
    string,
    Promise<LangChainToolResultEnvelope & { activeSkills: SkillSnapshotRef[] }>
  >();

  /** Prepared side effects survive an approval interrupt without taking a new file snapshot. */
  private readonly preparedToolsByRunCall = new Map<string, ToolExecution>();

  /** One durable execution-intent event per Tool Call, including graph replays. */
  private readonly preparedToolIntentKeys = new Set<string>();

  /** Keeps one UI batch identity while a multi-call ToolNode is resumed. */
  private readonly toolBatchIdsByRunCalls = new Map<string, string>();

  private readonly pendingChangeApprovals = new Map<string, PendingChangeApproval>();

  /** Session grants intentionally survive Runs but disappear on app restart. */
  private readonly sessionPermissionGrants = new Map<string, AgentPermissionRule[]>();

  /** Marks decisions that the replayed interrupt must consume without re-notifying the UI. */
  private readonly resumedApprovalDecisions = new Map<string, { approved: boolean; runId: string }>();

  private readonly taskListTool: TaskListTool;

  private readonly attachmentTool: ConversationAttachmentTool | null;

  private readonly agentCommunicationTool: AgentCommunicationTool;

  private readonly subagentTool: SubagentTool;

  private readonly webSearchTool: WebSearchTool;

  private readonly toolHandlers: ToolHandlerRegistry<RuntimeToolContext>;

  public constructor(
    private readonly database: AgentDatabase,
    private readonly credentials: ModelConfigurationProvider,
    private readonly projects: ProjectRegistry,
    private readonly tools: ProjectToolRegistry,
    model: ModelProviderAdapter = new ModelAdapterRegistry(),
    private readonly waitForRetry: RetryWaiter = waitForRetryDelay,
    private readonly contextCompression: ContextCompressionConfigurationProvider =
      defaultContextCompressionConfigurationProvider,
    private readonly contextCompactor: ContextCompactor | null = null,
    private readonly attachments: ConversationAttachmentStore | null = null,
    private readonly agentDirectory: AgentDirectoryConfigurationProvider | null = null,
    private readonly skillRuntime: SkillRuntime | null = null,
    private readonly graphCheckpointer: BaseCheckpointSaver | null = null,
    webSearchTool: WebSearchTool = new WebSearchTool(),
    private readonly applicationSettings: ApplicationSettingsProvider | null = null,
    private readonly threadLog: ThreadLog | null = null,
    private readonly eventProjector: EventProjector | null = null,
    private readonly threadLogLegacyImporter: ThreadLogLegacyImporter | null = null,
    private readonly pluginCatalog: PluginCatalogProvider | null = null,
  ) {
    this.modelGateway = new ModelGateway(model);
    this.taskListTool = new TaskListTool(database);
    this.agentCommunicationTool = new AgentCommunicationTool(database);
    const getModelStatus = credentials.getStatus;
    this.subagentTool = new SubagentTool(
      database,
      getModelStatus === undefined ? undefined : () => getModelStatus.call(credentials),
    );
    this.webSearchTool = webSearchTool;
    this.attachmentTool = attachments === null
      ? null
      : new ConversationAttachmentTool(attachments);
    this.contextCompiler = new ContextCompiler(database, attachments, threadLog);
    this.toolHandlers = this.createToolHandlerRegistry();
  }

  private enabledPluginSnapshots(): { contentHash: string; id: string; version: string }[] {
    if (this.pluginCatalog === null) return [];
    return this.pluginCatalog.list()
      .filter((plugin) => plugin.enabled)
      .map((plugin) => ({
        contentHash: plugin.contentHash,
        id: plugin.id,
        version: plugin.version,
      }));
  }

  private appendShadowThreadLog(
    conversationId: string,
    event: ThreadLogEventInput,
    uniquePayloadField?: string,
  ): void {
    if (this.threadLog === null) return;
    try {
      const appended = uniquePayloadField === undefined
        ? this.threadLog.append(conversationId, event)
        : this.threadLog.appendIfMissing(conversationId, event, uniquePayloadField);
      if (appended === null) return;
      this.eventProjector?.projectEvent(conversationId, appended);
    } catch (error) {
      const agentError = toMainAgentError(error, {
        operation: "thread_log.shadow_append",
      });
      reportMainError(agentError, error);
    }
  }

  /**
   * The JSONL-first seam is deliberately strict: when this append fails, no
   * SQLite business projection has been written yet. Shadow-log callers keep
   * their compatibility behavior until their event contracts are migrated.
   */
  private appendWriteAheadThreadLog(
    conversationId: string,
    event: ThreadLogEventInput,
  ): boolean {
    if (this.threadLog === null || this.eventProjector === null) return false;
    const appended = this.threadLog.append(conversationId, event);
    this.eventProjector.projectBusinessEvent(conversationId, appended);
    return true;
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
          onMessagesRead: (messageIds) => this.appendAgentMessageReadThreadLog(
            context.conversationId,
            messageIds,
          ),
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
          onResultMessagesRead: (messageIds) => this.appendAgentMessageReadThreadLog(
            context.conversationId,
            messageIds,
          ),
          signal: context.signal,
          spawn: (task, name, icon, agentId, modelSelection) => this.spawnSubagent({
            agentId,
            configuration: context.configuration,
            contextCompressionConfiguration: context.contextCompressionConfiguration,
            emit: context.emit,
            icon,
            name,
            parentConversationId: context.conversationId,
            parentRunId: context.runId,
            permissionMode: context.permissionMode,
            providerId: context.providerId,
            reasoning: context.reasoning,
            modelSelection,
            task,
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
      execute: ({ context, rawArguments }) => this.webSearchTool.execute(
        rawArguments,
        context.signal,
      ),
      getDefinitions: () => this.webSearchTool.getDefinitions(),
      getExecutionPolicy: () => this.webSearchTool.getExecutionPolicy(),
      isAvailable: () => true,
    });
    handlers.push({
      execute: ({ context, rawArguments, toolName }) => {
        return this.tools.execute(
          toolName,
          rawArguments,
          context.projectId,
          context.signal,
          context.operationOwner,
        );
      },
      getDefinitions: () => this.tools.getCommandDefinitions(),
      getExecutionPolicy: ({ context, rawArguments, toolName }) => this.tools.getExecutionPolicy(
        toolName,
        rawArguments,
        context.permissionMode !== "read_only",
      ),
      isAvailable: () => true,
    });
    handlers.push({
      execute: ({ context, rawArguments, toolName }) => {
        return this.tools.execute(
          toolName,
          rawArguments,
          context.projectId,
          context.signal,
          context.operationOwner,
        );
      },
      getDefinitions: () => this.tools.getProjectDefinitions().filter(
        (definition) => definition.name === "read_external_file",
      ),
      getExecutionPolicy: ({ context, rawArguments, toolName }) => this.tools.getExecutionPolicy(
        toolName,
        rawArguments,
        context.permissionMode !== "read_only",
      ),
      isAvailable: () => true,
    });
    handlers.push({
      execute: ({ context, rawArguments, toolName }) => {
        if (context.projectId === undefined) {
          throw new Error("A workspace is required for project tools.");
        }
        return this.tools.execute(
          toolName,
          rawArguments,
          context.projectId,
          context.signal,
          context.operationOwner,
        );
      },
      getDefinitions: () => this.tools.getProjectDefinitions().filter(
        (definition) => definition.name !== "read_external_file",
      ),
      getExecutionPolicy: ({ context, rawArguments, toolName }) => this.tools.getExecutionPolicy(
        toolName,
        rawArguments,
        context.permissionMode !== "read_only",
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
      const pendingInput = {
        ...input,
        deliveryMode: input.deliveryMode ?? "queue" as const,
      };
      const pendingMessage = this.threadLog !== null && this.eventProjector !== null
        ? (() => {
            const preparedPending = this.database.preparePendingMessage(pendingInput);
            this.appendWriteAheadPendingMessages(input.conversationId, [
              ...this.database.listPendingMessageRecords(input.conversationId),
              preparedPending,
            ]);
            return preparedPending.message;
          })()
        : this.database.enqueuePendingMessage(pendingInput);
      if (this.threadLog === null || this.eventProjector === null) {
        this.appendPendingMessagesThreadLog(input.conversationId);
      }
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
    const activeRun = this.runCoordinator.get(sourceRunId);
    if (activeRun !== undefined) {
      this.runCoordinator.markReplacing(sourceRunId);
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
    const executionSnapshot = createRunExecutionSnapshot({
      configuration: prepared.configuration,
      contextCompressionConfiguration: prepared.contextCompressionConfiguration,
      permissionMode: prepared.permissionMode,
      plugins: this.enabledPluginSnapshots(),
      providerId: prepared.input.providerId,
      reasoning: prepared.reasoning,
      toolDefinitions: this.toolDefinitionsForConversation(input.conversationId),
    });
    const useWriteAheadRun = this.threadLog !== null && this.eventProjector !== null;
    const creation = useWriteAheadRun
      ? (() => {
          const replacement = this.database.prepareLatestUserMessageReplacement({
            content: input.content,
            conversationId: input.conversationId,
            executionSnapshot,
            messageId,
            modelContent: prepared.modelInputContent,
            modelId: prepared.configuration.modelId,
          });
          this.appendWriteAheadThreadLog(input.conversationId, {
            payload: {
              attachmentIds: replacement.userMessage.attachments.map((attachment) => attachment.id),
              content: replacement.userMessage.content,
              createdAt: replacement.runCreatedAt,
              executionSnapshot,
              message: replacement.userMessage,
              messageId: replacement.userMessage.id,
              modelContent: replacement.modelContent,
              modelId: replacement.modelId,
              permissionMode: prepared.permissionMode,
              previousRunId: replacement.previousRunId,
              runId: replacement.runId,
              title: replacement.nextTitle,
            },
            type: "run_replaced",
          });
          return {
            conversation: this.database.getConversation(input.conversationId),
            runId: replacement.runId,
            userMessage: replacement.userMessage,
          };
        })()
      : this.database.replaceLatestUserMessage({
          content: input.content,
          conversationId: input.conversationId,
          executionSnapshot,
          messageId,
          modelContent: prepared.modelInputContent,
          modelId: prepared.configuration.modelId,
        });
    if (!useWriteAheadRun) {
      this.appendShadowThreadLog(input.conversationId, {
        payload: {
          replacementRunId: creation.runId,
          runId: sourceRunId,
        },
        type: "run_superseded",
      });
      this.appendShadowThreadLog(input.conversationId, {
        payload: {
          attachmentIds: creation.userMessage.attachments.map((attachment) => attachment.id),
          content: creation.userMessage.content,
          messageId: creation.userMessage.id,
          message: creation.userMessage,
          modelContent: prepared.modelInputContent,
          previousRunId: sourceRunId,
          runId: creation.runId,
        },
        type: "user_message_replaced",
      });
      this.appendShadowThreadLog(input.conversationId, {
        payload: {
          createdAt: creation.userMessage.createdAt,
          executionSnapshot,
          modelId: prepared.configuration.modelId,
          permissionMode: prepared.permissionMode,
          runId: creation.runId,
        },
        type: "run_created",
      });
    }
    return this.schedulePreparedRun(creation, prepared, emit);
  }

  public listPendingMessages(conversationId: string): ConversationPendingMessage[] {
    return this.database.listPendingMessages(conversationId);
  }

  public promotePendingMessage(
    pendingMessageId: string,
    emit: RunEventEmitter
  ): ConversationPendingMessage[] {
    const record = this.database.getPendingMessageRecord(pendingMessageId);
    const conversationId = record.message.conversationId;
    if (this.threadLog !== null && this.eventProjector !== null) {
      const snapshot = this.database.listPendingMessageRecords(conversationId).map((candidate) =>
        candidate.message.id !== pendingMessageId
          ? candidate
          : {
              input: { ...candidate.input, deliveryMode: "steer" as const },
              message: { ...candidate.message, deliveryMode: "steer" as const },
            },
      );
      this.appendWriteAheadPendingMessages(conversationId, snapshot);
    } else {
      this.database.promotePendingMessage(pendingMessageId);
      this.appendPendingMessagesThreadLog(conversationId);
    }
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
    const record = this.database.getPendingMessageRecord(pendingMessageId);
    const conversationId = record.message.conversationId;
    if (this.threadLog !== null && this.eventProjector !== null) {
      const snapshot = this.database.listPendingMessageRecords(conversationId).map((candidate) => {
        if (candidate.message.id !== pendingMessageId) return candidate;
        const input = sendConversationMessageInputSchema.parse({ ...candidate.input, content });
        return { input, message: { ...candidate.message, content } };
      });
      this.appendWriteAheadPendingMessages(conversationId, snapshot);
    } else {
      this.database.updatePendingMessage(pendingMessageId, content);
      this.appendPendingMessagesThreadLog(conversationId);
    }
    this.emitPendingMessages(conversationId, emit);
    return this.database.listPendingMessages(conversationId);
  }

  public reorderPendingMessages(
    conversationId: string,
    pendingMessageIds: readonly string[],
    emit: RunEventEmitter
  ) {
    if (this.threadLog !== null && this.eventProjector !== null) {
      const current = this.database.listPendingMessageRecords(conversationId);
      if (
        current.length !== pendingMessageIds.length
        || current.some((message) => !pendingMessageIds.includes(message.message.id))
        || new Set(pendingMessageIds).size !== pendingMessageIds.length
      ) {
        throw new Error("Pending message reorder must include the complete queue.");
      }
      const byId = new Map(current.map((message) => [message.message.id, message]));
      const snapshot = pendingMessageIds.map((id) => {
        const message = byId.get(id);
        if (message === undefined) throw new Error("Pending message reorder references an unknown message.");
        return message;
      });
      this.appendWriteAheadPendingMessages(conversationId, snapshot);
    } else {
      this.database.reorderPendingMessages(conversationId, pendingMessageIds);
      this.appendPendingMessagesThreadLog(conversationId);
    }
    this.emitPendingMessages(conversationId, emit);
    return this.database.listPendingMessages(conversationId);
  }

  public deletePendingMessage(
    pendingMessageId: string,
    emit: RunEventEmitter
  ): ConversationPendingMessage[] {
    const conversationId = this.database.getPendingMessageRecord(
      pendingMessageId
    ).message.conversationId;
    if (this.threadLog !== null && this.eventProjector !== null) {
      this.appendWriteAheadThreadLog(conversationId, {
        payload: { pendingMessageId, writeAhead: true },
        type: "pending_message_cancelled",
      });
    } else {
      this.database.deletePendingMessage(pendingMessageId);
      this.appendPendingMessagesThreadLog(conversationId);
    }
    this.emitPendingMessages(conversationId, emit);
    return this.database.listPendingMessages(conversationId);
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
    assertRunToolManifestMatchesSnapshot(
      this.toolDefinitionsForConversation(recovery.conversationId),
      snapshot,
    );
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
      plugins: this.enabledPluginSnapshots(),
      providerId: input.providerId,
      reasoning: prepared.reasoning,
      toolDefinitions: this.toolDefinitionsForConversation(input.conversationId),
    });
    const creation = this.threadLog !== null
      && this.eventProjector !== null
      ? (() => {
          const queued = pendingMessageId === undefined
            ? this.database.prepareRunWithUserMessage(
                input.conversationId,
                input.content,
                configuration.modelId,
                input.attachmentIds ?? [],
                prepared.modelInputContent,
                executionSnapshot,
              )
            : this.database.prepareRunFromPendingMessage(
                pendingMessageId,
                configuration.modelId,
                prepared.modelInputContent,
                executionSnapshot,
              );
          this.appendWriteAheadThreadLog(input.conversationId, {
            payload: {
              attachmentIds: queued.userMessage.attachments.map((attachment) => attachment.id),
              content: queued.userMessage.content,
              createdAt: queued.runCreatedAt,
              executionSnapshot,
              message: queued.userMessage,
              messageId: queued.userMessage.id,
              modelContent: queued.modelContent,
              modelId: queued.modelId,
              permissionMode: prepared.permissionMode,
              runId: queued.runId,
              title: queued.nextTitle,
              ...(queued.pendingMessageId === null
                ? {}
                : { pendingMessageId: queued.pendingMessageId }),
            },
            type: "run_queued",
          });
          return {
            conversation: this.database.getConversation(input.conversationId),
            runId: queued.runId,
            userMessage: queued.userMessage,
          };
        })()
      : pendingMessageId === undefined
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
    if (pendingMessageId !== undefined) {
      this.appendPendingMessagesThreadLog(creation.conversation.id);
    }
    if (this.threadLog === null || this.eventProjector === null) {
      this.appendShadowThreadLog(creation.conversation.id, {
        payload: {
          attachmentIds: creation.userMessage.attachments.map((attachment) => attachment.id),
          content: creation.userMessage.content,
          messageId: creation.userMessage.id,
          message: creation.userMessage,
          modelContent: prepared.modelInputContent,
          runId: creation.runId,
        },
        type: "user_message",
      });
      this.appendShadowThreadLog(creation.conversation.id, {
        payload: {
          createdAt: creation.userMessage.createdAt,
          executionSnapshot,
          modelId: configuration.modelId,
          permissionMode: prepared.permissionMode,
          runId: creation.runId,
        },
        type: "run_created",
      });
    }
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
    this.runCoordinator.schedule(runId, conversationId, async (controller) => {
      await this.executeRun(
        runId,
        conversationId,
        input.providerId,
        configuration,
        contextCompressionConfiguration,
        prepared.permissionMode,
        prepared.reasoning,
        controller,
        emit,
      );
    });
    this.agentMessageDepthByRun.set(runId, 0);
    if (!this.database.isConversationFork(conversationId)) {
      this.emit(emit, {
        conversation: this.database.getConversation(conversationId),
        type: "conversation.updated"
      });
    }
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
      const userMessage = this.threadLog !== null && this.eventProjector !== null
        ? (() => {
            const pendingConsumption = this.database.preparePendingMessageConsumption(
              record.message.id,
              runId,
              prepared.modelInputContent,
            );
            this.appendWriteAheadThreadLog(conversationId, {
              payload: {
                attachmentIds: pendingConsumption.userMessage.attachments.map((attachment) => attachment.id),
                content: pendingConsumption.userMessage.content,
                message: pendingConsumption.userMessage,
                messageId: pendingConsumption.userMessage.id,
                modelContent: pendingConsumption.modelContent,
                pendingMessageId: pendingConsumption.pendingMessageId,
                runId,
                writeAhead: true,
              },
              type: "user_message",
            });
            return pendingConsumption.userMessage;
          })()
        : this.database.consumePendingMessageIntoRun(
            record.message.id,
            runId,
            prepared.modelInputContent,
          );
      if (this.threadLog === null || this.eventProjector === null) {
        this.appendShadowThreadLog(conversationId, {
          payload: {
            attachmentIds: userMessage.attachments.map((attachment) => attachment.id),
            content: userMessage.content,
            message: userMessage,
            messageId: userMessage.id,
            modelContent: prepared.modelInputContent,
            runId,
          },
          type: "user_message",
        });
      }
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
    this.appendPendingMessagesThreadLog(conversationId);
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

  private appendPendingMessagesThreadLog(conversationId: string): void {
    const pendingMessages = this.database.listPendingMessageRecords(conversationId);
    this.appendShadowThreadLog(conversationId, {
      payload: {
        attachmentRefs: this.pendingMessageAttachmentReferences(conversationId, pendingMessages),
        pendingMessages,
      },
      type: "pending_messages_updated",
    });
  }

  private appendWriteAheadPendingMessages(
    conversationId: string,
    pendingMessages: readonly StoredPendingMessage[],
  ): void {
    this.appendWriteAheadThreadLog(conversationId, {
      payload: {
        attachmentRefs: this.pendingMessageAttachmentReferences(conversationId, pendingMessages),
        pendingMessages,
        writeAhead: true,
      },
      type: "pending_messages_updated",
    });
  }

  private pendingMessageAttachmentReferences(
    conversationId: string,
    pendingMessages: readonly StoredPendingMessage[],
  ): ConversationAttachment[] {
    const attachmentIds = [...new Set(
      pendingMessages.flatMap((pending) => pending.message.attachmentIds),
    )];
    return this.database.listThreadLogAttachmentReferences(conversationId, attachmentIds);
  }

  public cancelRun(runId: string): void {
    for (const pending of this.pendingChangeApprovals.values()) {
      if (pending.runId === runId) pending.resolve(false);
    }
    this.runCoordinator.cancel(runId);
  }

  public getContextUsage(rawInput: unknown): ConversationContextUsage {
    const input = conversationContextUsageInputSchema.parse(rawInput);
    const conversation = this.database.getConversation(input.conversationId);
    const workspace = this.resolveConversationWorkspace(conversation);
    const configuration = this.credentials.getContextConfiguration?.(
      input.providerId,
      input.modelId,
    ) ?? this.credentials.getConfiguration(input.providerId, input.modelId);

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
      estimatedReferenceTokens:
        context.usage.estimatedReferenceTokens
        + references.estimatedTokens
        + projectFileReferenceTokens,
    });
  }

  public approveToolChange(rawInput: unknown): void {
    const input = approveToolChangeInputSchema.parse(rawInput);
    const pending = this.pendingChangeApprovals.get(input.toolId);
    if (pending === undefined || pending.runId !== input.runId) {
      throw new ToolApprovalExpiredError();
    }
    this.appendShadowThreadLog(pending.conversationId, {
      payload: {
        approved: input.approved,
        runId: input.runId,
        scope: input.scope,
        toolId: input.toolId,
      },
      type: "tool_approval_decided",
    });
    if (input.approved) this.grantPermission(pending, input.scope);
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
      throw new ToolApprovalExpiredError();
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
      if (this.threadLog !== null && this.eventProjector !== null) {
        this.appendWriteAheadThreadLog(conversationId, {
          payload: { runId, writeAhead: true },
          type: "run_started",
        });
      } else {
        this.database.markRunRunning(runId);
        this.appendShadowThreadLog(conversationId, {
          payload: { runId },
          type: "run_started",
        });
      }
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
      let hasSuccessfulToolExecution = false;
      let lastAssistantContent = "";
      let lastAssistantMessageId: string = randomUUID();
      let lastAssistantResult: ModelTurnResult | null = null;
      let followUpInputForGraph = false;
      const modelMessageIdsByTurn = new Map<number, string>();
      const agentMessageIdsPreparedInInitialContext = new Set<string>();
      const graphResult = await this.graphExecutor.invoke({
        callbacks: {
          beforeAgent: async () => {
            const unreadAgentMessages = this.database.listUnreadAgentMessages(conversationId);
            const preparedContext = await this.prepareContext(
              conversationId,
              workspace,
              permissionMode,
              configuration.contextWindow ?? 0,
              contextCompressionConfiguration,
              configuration,
              controller.signal,
            );
            const preparedUserMessageContents = new Map<string, number>();
            for (const message of preparedContext.messages) {
              if (message.role !== "user") continue;
              preparedUserMessageContents.set(
                message.content,
                (preparedUserMessageContents.get(message.content) ?? 0) + 1,
              );
            }
            for (const message of unreadAgentMessages) {
              const content = agentMessageModelContent(message);
              const count = preparedUserMessageContents.get(content) ?? 0;
              if (count < 1) continue;
              agentMessageIdsPreparedInInitialContext.add(message.id);
              preparedUserMessageContents.set(content, count - 1);
            }
            return { messages: preparedContext.messages };
          },
          beforeModel: (state) => {
            const additions: ModelMessage[] = [];
            const incomingAgentMessages = this.database.listUnreadAgentMessages(conversationId);
            if (incomingAgentMessages.length > 0) {
              this.trackAgentMessagesForReply(runId, incomingAgentMessages);
              additions.push(...incomingAgentMessages
                .filter((message) => !agentMessageIdsPreparedInInitialContext.delete(message.id))
                .map((message) => ({
                attachments: [],
                content: agentMessageModelContent(message),
                role: "user" as const,
                toolCallId: null,
                toolCalls: [],
              })));
              this.database.markAgentMessagesRead(
                incomingAgentMessages.map((message) => message.id),
              );
              this.appendAgentMessageReadThreadLog(
                conversationId,
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
            const taskListContext = activeTaskListContextMessage(
              this.database.getTaskList(conversationId),
            );
            return Promise.resolve({
              contextMessages: [
                ...(activeSkillContext === null || activeSkillContext === undefined
                  ? []
                  : [activeSkillContext]),
                ...(taskListContext === null ? [] : [taskListContext]),
              ],
              hasFollowUpInput: false,
              messages: additions,
            });
          },
          callModel: async (modelMessages, turn, hooks?: AgentGraphModelCallHooks) => {
            controller.signal.throwIfAborted();
            const messageId = modelMessageIdsByTurn.get(turn) ?? randomUUID();
            if (!modelMessageIdsByTurn.has(turn)) {
              modelMessageIdsByTurn.set(turn, messageId);
              lastAssistantMessageId = messageId;
              activeAssistantContent = "";
              activeAssistantContentPersisted = false;
            }
            const result = await this.completeModelTurn({
              configuration,
              conversationId,
              emit,
              maxOutputTokens: MAX_OUTPUT_TOKENS,
              messageId,
              messages: [...modelMessages],
              onTextDelta: (delta) => {
                hooks?.onTextDelta?.();
                activeAssistantContent += delta;
              },
              reasoning,
              signal: controller.signal,
              runId,
              tools: this.toolHandlers.getDefinitions({ projectId: workspace?.id })
            });
            if (result.content.length > 0) activeAssistantContent = result.content;
            const toolCalls = result.toolCalls.map((toolCall) => ({
              ...toolCall,
              id: toolCall.id.trim(),
              name: toolCall.name.trim()
            }));
            if (toolCalls.some((toolCall) => toolCall.id.length === 0 || toolCall.name.length === 0)) {
              throw new ModelToolCallValidationError("模型返回了缺少 ID 或名称的工具调用，请重试。");
            }
            if (new Set(toolCalls.map((toolCall) => toolCall.id)).size !== toolCalls.length) {
              throw new ModelToolCallValidationError("模型本轮返回了重复的工具调用 ID，请重试。");
            }
            const previousToolCallIds = new Set(
              modelMessages.flatMap((message) =>
                message.role === "assistant"
                  ? message.toolCalls.map((toolCall) => toolCall.id)
                  : []
              ),
            );
            if (toolCalls.some((toolCall) => previousToolCallIds.has(toolCall.id))) {
              throw new ModelToolCallValidationError(
                "模型复用了当前上下文中已经存在的工具调用 ID，请使用新的 ID 后重试。",
              );
            }
            if (toolCalls.length > MAX_TOOL_CALLS_PER_MODEL_TURN) {
              throw new ToolCallLimitError(toolCalls.length, MAX_TOOL_CALLS_PER_MODEL_TURN);
            }
            followUpInputForGraph = toolCalls.length === 0 && (
              this.database.listUnreadAgentMessages(conversationId).length > 0
              || this.database.listPendingMessageRecords(conversationId, "steer").length > 0
            );
            if (toolCalls.length === 0 && result.content.trim().length === 0) {
              // Empty responses are retried and, when necessary, rejected by
              // the LangGraph model middleware after the retry policy runs.
            } else {
              if (result.content.trim().length > 0) lastAssistantContent = result.content;
              if (toolCalls.length > 0 || followUpInputForGraph) {
                if (this.threadLog !== null && this.eventProjector !== null) {
                  this.appendWriteAheadThreadLog(conversationId, {
                    payload: {
                      content: result.content,
                      messageId,
                      modelId: configuration.modelId,
                      ...(result.providerState === undefined
                        ? {}
                        : { providerState: result.providerState }),
                      runId,
                      toolCalls,
                      writeAhead: true,
                    },
                    type: "assistant_message",
                  });
                } else {
                  const assistantMessage = this.database.appendAssistantTurn({
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
                  this.appendShadowThreadLog(conversationId, {
                    payload: {
                      content: result.content,
                      messageId,
                      modelId: configuration.modelId,
                      ...(result.providerState === undefined
                        ? {}
                        : { providerState: result.providerState }),
                      runId,
                      timelineMessage: assistantMessage,
                      toolCalls,
                    },
                    type: "assistant_message",
                  });
                }
                activeAssistantContentPersisted = true;
              }
            }
            const normalizedResult = { ...result, toolCalls };
            lastAssistantResult = normalizedResult;
            if (toolCalls.length > 0 || result.content.trim().length > 0) {
              modelMessageIdsByTurn.delete(turn);
            }
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
        initialMessages: [],
        maxSteps: MAX_AGENT_LOOPS,
        modelRetry: this.createModelRetryPolicy({
          configuration,
          hasSuccessfulToolExecution: () => hasSuccessfulToolExecution,
          providerId,
          runId,
          conversationId,
          emit,
          signal: controller.signal,
        }),
        onInterrupt: (interrupts) => this.resumeGraphInterrupts(
          interrupts,
          controller.signal,
        ),
        signal: controller.signal,
        threadId: runId,
        toolDefinitions: this.toolHandlers.getDefinitions({ projectId: workspace?.id }),
        ...(this.graphCheckpointer === null ? {} : { checkpointer: this.graphCheckpointer }),
      });
      const result = lastAssistantResult ?? graphResult.lastResult;
      if (result === null) throw new Error("Agent graph finished without a model result.");
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
      this.clearPendingChangeApprovals(runId);
      for (const [toolId, decision] of this.resumedApprovalDecisions) {
        if (decision.runId === runId) this.resumedApprovalDecisions.delete(toolId);
      }
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
      for (const key of this.preparedToolIntentKeys) {
        if (key.startsWith(`${runId}:`)) this.preparedToolIntentKeys.delete(key);
      }
      for (const key of this.inFlightToolsByRunCall.keys()) {
        if (key.startsWith(`${runId}:`)) this.inFlightToolsByRunCall.delete(key);
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
      const { wasReplacing } = this.runCoordinator.complete(runId);
      if (!wasReplacing) {
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
      avatarIcon: agent.avatar.kind === "icon" ? agent.avatar.icon : null,
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
      .map((agent) => `${agent.id}=${agent.name} (${agent.role || "role not configured"})`);
    return members.length === 0
      ? []
      : [`Delegate to a team member by passing its agentId to spawn_subagent: ${members.join("; ")}`];
  }

  private spawnSubagent(input: {
    agentId: string | undefined;
    configuration: ModelConfiguration;
    contextCompressionConfiguration: ContextCompressionThreshold;
    emit: RunEventEmitter;
    icon: AgentAvatarIcon | undefined;
    name: string | undefined;
    parentConversationId: string;
    parentRunId: string;
    permissionMode: ConversationPermissionMode;
    providerId: string | undefined;
    reasoning: ModelReasoningOption | undefined;
    modelSelection: ConversationModelSelection | undefined;
    task: string;
  }): SubagentTask {
    const parent = this.database.getConversation(input.parentConversationId);
    if (parent.isArchived) throw new Error("An archived conversation cannot start a Subagent.");

    const configuration = input.modelSelection === undefined
      ? input.configuration
      : this.credentials.getConfiguration(
          input.modelSelection.providerId,
          input.modelSelection.modelId,
        );
    const providerId = input.modelSelection?.providerId ?? input.providerId;
    const reasoning = input.modelSelection?.reasoning === null
      ? undefined
      : resolveConfiguredReasoning(
          input.modelSelection?.reasoning ?? input.reasoning,
          configuration,
        );
    const contextCompressionConfiguration = input.modelSelection === undefined
      ? input.contextCompressionConfiguration
      : resolveContextCompressionConfiguration(
          configuration,
          this.contextCompression.getConfiguration(),
        );

    const child = this.database.forkConversation(parent.id, "subagent");
    if (providerId !== undefined) {
      this.database.setConversationModelSelection(child.id, {
        modelId: configuration.modelId,
        providerId,
        reasoning: reasoning ?? null,
      });
    }
    this.projects.inheritConversationWorkspace(parent.id, child.id);
    const selectedAgent = this.resolveSubagentAgent(parent, input.agentId);
    if (selectedAgent !== null) this.database.bindConversationAgent(child.id, selectedAgent);
    const avatarIcon = input.icon
      ?? (input.agentId === undefined ? undefined : selectedAgent?.avatarIcon)
      ?? fallbackSubagentAvatarIcon(child.id);
    this.database.setConversationAvatarIcon(child.id, avatarIcon);
    const title = input.name?.trim()
      || `${selectedAgent?.name ?? "Subagent"} · ${input.task.replace(/\s+/gu, " ").slice(0, 80)}`;
    const updatedChild = this.database.renameConversation(child.id, title);
    this.threadLogLegacyImporter?.importConversationIfMissing(child.id);

    const executionSnapshot = createRunExecutionSnapshot({
      configuration,
      contextCompressionConfiguration,
      permissionMode: input.permissionMode,
      plugins: this.enabledPluginSnapshots(),
      providerId,
      reasoning,
      toolDefinitions: this.toolDefinitionsForConversation(child.id),
    });
    const useWriteAheadRun = this.threadLog !== null
      && this.eventProjector !== null
      && this.threadLog.hasConversation(child.id);
    const creation = useWriteAheadRun
      ? (() => {
          const queued = this.database.prepareRunWithUserMessage(
            child.id,
            input.task,
            configuration.modelId,
            [],
            input.task,
            executionSnapshot,
          );
          this.appendWriteAheadThreadLog(child.id, {
            payload: {
              attachmentIds: [],
              content: queued.userMessage.content,
              createdAt: queued.runCreatedAt,
              executionSnapshot,
              message: queued.userMessage,
              messageId: queued.userMessage.id,
              modelContent: queued.modelContent,
              modelId: queued.modelId,
              permissionMode: input.permissionMode,
              runId: queued.runId,
              title,
            },
            type: "run_queued",
          });
          return {
            conversation: this.database.getConversation(child.id),
            runId: queued.runId,
            userMessage: queued.userMessage,
          };
        })()
      : this.database.createRunWithUserMessage(
          child.id,
          input.task,
          configuration.modelId,
          [],
          input.task,
          executionSnapshot,
        );
    if (!useWriteAheadRun) {
      this.appendShadowThreadLog(child.id, {
        payload: {
          attachmentIds: [],
          content: input.task,
          messageId: creation.userMessage.id,
          message: creation.userMessage,
          modelContent: input.task,
          runId: creation.runId,
        },
        type: "user_message",
      });
      this.appendShadowThreadLog(child.id, {
        payload: {
          createdAt: creation.userMessage.createdAt,
          executionSnapshot,
          modelId: configuration.modelId,
          permissionMode: input.permissionMode,
          runId: creation.runId,
        },
        type: "run_created",
      });
    }
    const task = this.database.createSubagentTask({
      childConversationId: child.id,
      parentConversationId: parent.id,
      sourceRunId: input.parentRunId,
      task: input.task,
      title,
    });
    const startedTask = this.database.assignSubagentTaskRun(task.id, creation.runId);
    this.appendShadowThreadLog(parent.id, {
      payload: { task: startedTask },
      type: "subagent_task_created",
    });
    const parentDepth = this.agentMessageDepthByRun.get(input.parentRunId) ?? 0;
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
    this.runCoordinator.schedule(creation.runId, child.id, async (controller) => {
      await this.executeRun(
        creation.runId,
        child.id,
        providerId,
        configuration,
        structuredClone(contextCompressionConfiguration),
        input.permissionMode,
        reasoning,
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
    const canWriteAheadTerminal = this.threadLog !== null
      && this.eventProjector !== null
      && !this.database.hasSubagentTaskForTargetRun(input.runId);
    if (canWriteAheadTerminal) {
      const assistant = input.assistant;
      this.appendWriteAheadThreadLog(input.conversationId, {
        payload: {
          assistantKind: assistant?.kind ?? null,
          content: assistant?.content ?? null,
          error: input.error,
          messageId: assistant?.messageId ?? null,
          modelId: assistant?.modelId ?? null,
          ...(assistant !== null
            && assistant.kind !== "failure"
            && assistant.providerState !== undefined
            ? { providerState: assistant.providerState }
            : {}),
          result: input.result,
          runId: input.runId,
          status: input.status,
        },
        type: "run_terminal",
      });
      this.emit(input.emit, {
        conversation: this.database.getConversation(input.conversationId),
        type: "conversation.updated",
      });
      return;
    }
    const completedRun = this.database.completeRun({
      assistant: input.assistant,
      conversationId: input.conversationId,
      error: input.error,
      result: input.result,
      runId: input.runId,
      status: input.status,
    });
    if (input.assistant !== null) {
      this.appendShadowThreadLog(input.conversationId, {
        payload: {
          content: input.assistant.content,
          messageId: input.assistant.messageId,
          modelId: input.assistant.modelId,
          ...(input.assistant.kind === "turn" && input.assistant.providerState !== undefined
            ? { providerState: input.assistant.providerState }
            : {}),
          runId: input.runId,
          status: input.status,
          timelineMessage: completedRun.assistantMessage,
          toolCalls: [],
        },
        type: "assistant_message",
      });
    }
    this.appendShadowThreadLog(input.conversationId, {
      payload: {
        error: input.error,
        result: input.result,
        runId: input.runId,
        status: input.status,
      },
      type: "run_finished",
    });
    this.emit(input.emit, {
      conversation: this.database.getConversation(input.conversationId),
      type: "conversation.updated",
    });
    if (completedRun.subagentTask === null) return;
    this.appendShadowThreadLog(completedRun.subagentTask.parentConversationId, {
      payload: {
        task: {
          ...completedRun.subagentTask,
          resultMessageId: completedRun.subagentResultMessage?.id
            ?? completedRun.subagentTask.resultMessageId,
        },
      },
      type: "subagent_task_completed",
    });
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
    this.appendAgentMessageThreadLog(message);
    const sourceDepth = message.runId === null
      ? 0
      : this.agentMessageDepthByRun.get(message.runId) ?? 0;
    this.startUnreadAgentMessageRun(message.conversationId, sourceDepth + 1, emit);
  }

  private appendAgentMessageThreadLog(message: ConversationAgentMessageItem): void {
    this.appendShadowThreadLog(message.conversationId, {
      payload: {
        content: message.content,
        message,
        messageId: message.id,
        messageType: message.messageType,
        modelContent: agentMessageModelContent(message),
        runId: message.runId,
        senderConversationId: message.senderConversationId,
        taskId: message.taskId,
      },
      type: "agent_message",
    }, "messageId");
  }

  private appendAgentMessageReadThreadLog(
    conversationId: string,
    messageIds: readonly string[],
  ): void {
    for (const messageId of new Set(messageIds)) {
      this.appendShadowThreadLog(conversationId, {
        payload: { messageId },
        type: "agent_message_read",
      }, "messageId");
    }
  }

  private startUnreadAgentMessageRun(
    conversationId: string,
    targetDepth: number,
    emit: RunEventEmitter,
  ): void {
    const unreadMessages = this.database.listUnreadAgentMessages(conversationId);
    if (unreadMessages.length === 0) return;
    for (const message of unreadMessages) {
      this.appendAgentMessageThreadLog(message);
    }
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
      const executionSnapshot = createRunExecutionSnapshot({
        configuration,
        contextCompressionConfiguration,
        permissionMode: DEFAULT_PERMISSION_MODE,
        plugins: this.enabledPluginSnapshots(),
        providerId: undefined,
        reasoning: undefined,
        toolDefinitions: this.toolDefinitionsForConversation(conversationId),
      });
      const creation = this.database.createRunForAgentMessage(
        conversationId,
        configuration.modelId,
        executionSnapshot,
      );
      this.appendShadowThreadLog(conversationId, {
        payload: {
          createdAt: new Date().toISOString(),
          executionSnapshot,
          modelId: configuration.modelId,
          permissionMode: DEFAULT_PERMISSION_MODE,
          runId: creation.runId,
        },
        type: "run_created",
      });
      this.agentMessageDepthByRun.set(creation.runId, targetDepth);
      this.trackAgentMessagesForReply(creation.runId, unreadMessages);
      if (!this.database.isConversationFork(conversationId)) {
        this.emit(emit, {
          conversation: creation.conversation,
          type: "conversation.updated",
        });
      }
      this.runCoordinator.schedule(creation.runId, conversationId, async (controller) => {
        await this.executeRun(
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

  private createModelRetryPolicy(input: {
    configuration: ModelConfiguration;
    conversationId: string;
    emit: RunEventEmitter;
    hasSuccessfulToolExecution: () => boolean;
    providerId: string | undefined;
    runId: string;
    signal: AbortSignal;
  }): AgentGraphModelRetry {
    return {
      createEmptyResponseError: () => new Error("模型未返回可显示内容，请稍后重试或切换模型。"),
      getDelay: modelRetryDelay,
      maxRetries: MAX_MODEL_RECONNECT_ATTEMPTS,
      onFailure: (error) => {
        if (!input.signal.aborted && !isAbortError(error)) {
          this.updateModelConnectionStatus(input.providerId, input.configuration.modelId, "error");
        }
      },
      onRetry: ({ attempt, delayMs, error }) => {
        this.emit(input.emit, {
          attempt,
          conversationId: input.conversationId,
          reason: error === null
            ? "模型未返回可显示内容。"
            : modelRetryReason(error, input.configuration.apiKey),
          retryInMs: delayMs,
          runId: input.runId,
          type: "model.request_retrying"
        });
      },
      shouldFailEmptyResponse: () => !input.hasSuccessfulToolExecution(),
      shouldRetry: isRetryableModelError,
      wait: this.waitForRetry,
    };
  }

  private async completeModelTurn(input: ModelTurnRequest): Promise<ModelTurnResult> {
    input.signal.throwIfAborted();
    this.emit(input.emit, {
      conversationId: input.conversationId,
      runId: input.runId,
      type: "model.request_started"
    });
    return this.modelGateway.completeTurn({
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
      try {
        policies.set(index, this.toolHandlers.getExecutionPolicy({
          context: this.runtimeToolContext(input),
          rawArguments: toolCall.arguments,
          toolName: toolCall.name,
        }));
      } catch (error) {
        if (input.controller.signal.aborted || isAbortError(error) || isGraphInterrupt(error)) {
          throw error;
        }
        this.preparedToolsByRunCall.set(callKey, {
          content: toolErrorContent(error, `tool:${toolCall.name}`),
          isError: true,
          kind: "completed",
        });
        policies.set(index, { kind: "serial" });
      }
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
        await this.prepareGraphToolCall({
          ...input,
          executionMode: "serial",
          toolBatchId,
          toolCall,
        });
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

      const maxConcurrency = policy.kind === "parallel"
        ? policy.group === "read"
          ? MAX_PARALLEL_READ_TOOL_CALLS
          : MAX_PARALLEL_COMMAND_TOOL_CALLS
        : 1;
      const envelopes = new Map<string, LangChainToolResultEnvelope>();
      for (const chunk of chunkToolCalls(group, maxConcurrency)) {
        const chunkResults = await this.invokeGraphToolNode({
          ...input,
          executionMode: policy.kind === "parallel" ? "parallel" : "serial",
          toolBatchId,
          toolCalls: chunk,
        });
        for (const [callId, result] of chunkResults) envelopes.set(callId, result);
      }
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
    executionMode: ConversationToolExecutionMode;
    toolBatchId: string;
    toolCalls: readonly ModelToolCall[];
  }): Promise<Map<string, LangChainToolResultEnvelope>> {
    const callsById = new Map(input.toolCalls.map((toolCall) => [toolCall.id, toolCall]));
    const definitions = this.toolHandlers.getDefinitions({ projectId: input.projectId });
    const toolsByName = new Map<string, DynamicStructuredTool>();
    for (const toolCall of input.toolCalls) {
      if (toolsByName.has(toolCall.name)) continue;
      const definition = definitions.find((candidate) => candidate.name === toolCall.name);
      toolsByName.set(toolCall.name, new DynamicStructuredTool({
        description: definition?.description ?? "Return a structured error for an unavailable tool.",
        func: async (_arguments, _runManager, config) => {
          const callId = toolCallIdFromConfig(config);
          const call = callId === undefined ? undefined : callsById.get(callId);
          if (call === undefined) throw new Error(`ToolNode lost the tool call identity for ${toolCall.name}.`);
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
        name: toolCall.name,
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
        this.appendShadowThreadLog(input.conversationId, {
          payload: { taskList },
          type: "task_list_updated",
        });
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

  private executeGraphToolCall(
    input: GraphToolCallInput,
  ): Promise<LangChainToolResultEnvelope & { activeSkills: SkillSnapshotRef[] }> {
    const key = `${input.runId}:${input.toolCall.id}`;
    const completed = this.completedToolsByRunCall.get(key);
    if (completed !== undefined) return Promise.resolve(completed.envelope);
    const inFlight = this.inFlightToolsByRunCall.get(key);
    if (inFlight !== undefined) return inFlight;

    const execution = this.executeGraphToolCallOnce(input);
    this.inFlightToolsByRunCall.set(key, execution);
    const clearInFlight = (): void => {
      if (this.inFlightToolsByRunCall.get(key) === execution) {
        this.inFlightToolsByRunCall.delete(key);
      }
    };
    void execution.then(clearInFlight, clearInFlight);
    return execution;
  }

  private async executeGraphToolCallOnce(
    input: GraphToolCallInput,
  ): Promise<LangChainToolResultEnvelope & { activeSkills: SkillSnapshotRef[] }> {
    const key = `${input.runId}:${input.toolCall.id}`;
    const startedTool = this.startedToolsByRunCall.get(key)
      ?? conversationToolItemSchema.parse({
        arguments: input.toolCall.arguments,
        batchId: input.toolBatchId,
        conversationId: input.conversationId,
        createdAt: new Date().toISOString(),
        executionMode: input.executionMode,
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
      const event = {
        payload: {
          arguments: input.toolCall.arguments,
          executionMode: startedTool.executionMode ?? "serial",
          runId: input.runId,
          tool: startedTool,
          toolCallId: input.toolCall.id,
          toolId: startedTool.id,
          toolName: input.toolCall.name,
        },
        type: "tool_call_requested" as const,
      };
      if (this.threadLog !== null && this.eventProjector !== null) {
        this.appendWriteAheadThreadLog(input.conversationId, {
          ...event,
          payload: { ...event.payload, writeAhead: true },
        });
      } else {
        this.appendShadowThreadLog(input.conversationId, event);
        this.database.appendToolStarted(startedTool);
      }
      this.emit(input.emit, {
        conversationId: input.conversationId,
        runId: input.runId,
        tool: startedTool,
        type: "tool.started",
      });
    }

    let proposal: ToolExecution | undefined = this.preparedToolsByRunCall.get(key);
    let execution: ToolExecutionResult = {
      content: "",
      isError: true,
      kind: "completed",
    };
    try {
      const unavailableReason = this.unavailableToolReason(input.toolCall.name);
      if (unavailableReason !== null) {
        execution = {
          content: JSON.stringify({ error: unavailableReason, ok: false }),
          isError: true,
          kind: "completed",
        };
      } else if (proposal === undefined) {
        proposal = await this.toolHandlers.execute({
          context: this.runtimeToolContext(input),
          rawArguments: input.toolCall.arguments,
          toolName: input.toolCall.name,
        });
        if (
          proposal.kind === "change"
          || proposal.kind === "command"
          || proposal.kind === "external_read"
        ) {
          this.preparedToolsByRunCall.set(key, proposal);
        }
      }
      if (unavailableReason !== null) {
        // The policy rejection above is already the complete tool result.
      } else {
        if (proposal === undefined) throw new Error("Tool handler did not return an execution proposal.");
        this.appendToolExecutionPrepared(input, startedTool, proposal);
        execution = proposal.kind === "change"
        ? await this.resolveFileChange({
            change: proposal.change,
            controller: input.controller,
            permissionMode: input.permissionMode,
            projectId: input.projectId ?? (() => {
              throw new Error("A workspace is required for file changes.");
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
              projectId: input.projectId,
              runId: input.runId,
              startedTool,
              operationOwner: input.operationOwner,
            })
          : proposal.kind === "external_read"
            ? await this.resolveExternalFileRead({
                prepared: proposal.externalRead,
                controller: input.controller,
                emit: input.emit,
                permissionMode: input.permissionMode,
                runId: input.runId,
                startedTool,
              })
          : proposal;
      }
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
    const resultEvent = {
      payload: {
        content: execution.content,
        resultCharacters: execution.content.length,
        runId: input.runId,
        status: completedTool.status,
        tool: completedTool,
        toolCallId: input.toolCall.id,
        toolId: completedTool.id,
        toolName: completedTool.name,
      },
      type: "tool_result" as const,
    };
    if (this.threadLog !== null && this.eventProjector !== null) {
      this.appendWriteAheadThreadLog(input.conversationId, {
        ...resultEvent,
        payload: { ...resultEvent.payload, writeAhead: true },
      });
    } else {
      this.database.completeTool({
        providerCallId: input.toolCall.id,
        result: execution.content,
        tool: completedTool,
      });
      this.appendShadowThreadLog(input.conversationId, resultEvent);
    }
    this.startedToolsByRunCall.delete(key);
    this.preparedToolsByRunCall.delete(key);
    const envelope = {
      activeSkills: [...(this.activeSkillRefsByRun.get(input.runId)?.values() ?? [])],
      content: execution.content,
      isError: execution.isError,
      marker: "agent-tool-result-v1" as const,
      ...(execution.status === undefined ? {} : { status: execution.status }),
      successful: completedTool.status === "completed",
    } satisfies LangChainToolResultEnvelope & { activeSkills: SkillSnapshotRef[] };
    const message: ModelMessage = {
      attachments: [],
      content: envelope.content,
      role: "tool",
      toolCallId: input.toolCall.id,
      toolCalls: [],
    };
    // Persist the replay cache before notifying the renderer. A concurrent
    // ToolNode replay must observe the completed side effect immediately.
    this.completedToolsByRunCall.set(key, { envelope, message });
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
    return envelope;
  }

  /**
   * Records the immutable execution proposal once, before an approval may
   * suspend the graph. The in-memory key prevents graph replay from creating
   * a second intent for the same provider Tool Call.
   */
  private appendToolExecutionPrepared(
    input: GraphToolCallInput,
    tool: ConversationToolItem,
    proposal: ToolExecution,
  ): void {
    const key = `${input.runId}:${input.toolCall.id}`;
    if (this.preparedToolIntentKeys.has(key)) return;
    this.appendShadowThreadLog(input.conversationId, {
      payload: {
        arguments: input.toolCall.arguments,
        executionKind: proposal.kind,
        runId: input.runId,
        toolCallId: input.toolCall.id,
        toolId: tool.id,
        toolName: tool.name,
      },
      type: "tool_execution_prepared",
    });
    this.preparedToolIntentKeys.add(key);
  }

  private permissionPolicyFor(toolName: string): PermissionPolicy {
    const policies = this.applicationSettings?.getConfiguration().permissionPolicies
      ?? DEFAULT_APPLICATION_PERMISSION_POLICIES;
    if (toolName === "run_command") return policies["command-run"];
    if (
      toolName === "write_file"
      || toolName === "delete_file"
      || toolName === "replace_in_file"
      || toolName === "apply_patch"
    ) {
      return policies["patch-write"];
    }
    if (PROJECT_READ_TOOL_NAMES.has(toolName)) return policies["workspace-read"];
    if (PROJECT_SEARCH_TOOL_NAMES.has(toolName)) return policies["workspace-search"];
    return "allow";
  }

  private unavailableToolReason(toolName: string): string | null {
    const policy = this.permissionPolicyFor(toolName);
    if (policy !== "unavailable") return null;
    if (PROJECT_READ_TOOL_NAMES.has(toolName)) return "工作区读取已在应用权限设置中禁用。";
    if (PROJECT_SEARCH_TOOL_NAMES.has(toolName)) return "工作区搜索已在应用权限设置中禁用。";
    if (toolName === "run_command") return "终端命令执行已在应用权限设置中禁用。";
    if (
      toolName === "write_file"
      || toolName === "delete_file"
      || toolName === "replace_in_file"
      || toolName === "apply_patch"
    ) {
      return "文件变更已在应用权限设置中禁用。";
    }
    return "该工具已在应用权限设置中禁用。";
  }

  private agentForConversation(conversationId: string): {
    id: string;
    permissions: { allow: AgentPermissionRule[] };
  } | null {
    const conversation = this.database.getConversation(conversationId);
    if (conversation.agentId === null || this.agentDirectory === null) return null;
    const agent = this.agentDirectory.getConfiguration().agents.find(
      (candidate) => candidate.id === conversation.agentId,
    );
    return agent === undefined
      ? null
      : { id: agent.id, permissions: agent.permissions ?? { allow: [] } };
  }

  private hasPermissionGrant(
    conversationId: string,
    tool: AgentPermissionTool,
    candidate: string,
  ): boolean {
    const sessionRules = this.sessionPermissionGrants.get(conversationId) ?? [];
    if (sessionRules.some((rule) => permissionRuleMatches(rule, tool, candidate))) return true;
    const agent = this.agentForConversation(conversationId);
    return agent?.permissions.allow.some((rule) => permissionRuleMatches(rule, tool, candidate)) ?? false;
  }

  private permissionDecision(input: {
    conversationId: string;
    permissionMode: ConversationPermissionMode;
    permissionTool: AgentPermissionTool;
    pattern: string;
    toolId: string;
    externalRead?: boolean;
  }): PermissionDecision {
    // A resumed interrupt must be consumed even when the selected scope has
    // just created a matching session or Agent rule.
    if (this.resumedApprovalDecisions.has(input.toolId)) return "ask";
    if (input.externalRead !== true && input.permissionMode === "read_only") return "deny";
    if (input.externalRead === true) return "ask";
    if (this.permissionPolicyFor(input.permissionTool) === "unavailable") {
      return "deny";
    }
    if (this.hasPermissionGrant(input.conversationId, input.permissionTool, input.pattern)) {
      return "allow";
    }
    if (
      input.permissionMode === "full_access"
      || this.permissionPolicyFor(input.permissionTool) === "allow"
    ) {
      return "allow";
    }
    return "ask";
  }

  private grantPermission(
    pending: PendingChangeApproval,
    scope: "once" | "session" | "agent",
  ): void {
    if (scope === "once") return;
    if (pending.permissionTool === "external_read") {
      throw new Error("工作区外文件读取只能本次允许，不能保存为会话或 Agent 永久规则。");
    }
    const rule = agentPermissionRuleSchema.parse({
      pattern: pending.pattern,
      tool: pending.permissionTool,
    });
    if (scope === "session") {
      const current = this.sessionPermissionGrants.get(pending.conversationId) ?? [];
      if (!current.some((candidate) => candidate.tool === rule.tool && candidate.pattern === rule.pattern)) {
        this.sessionPermissionGrants.set(pending.conversationId, [...current, rule]);
      }
      if (this.sessionPermissionGrants.size > 500) {
        const oldest = this.sessionPermissionGrants.keys().next().value;
        if (typeof oldest === "string") this.sessionPermissionGrants.delete(oldest);
      }
      return;
    }
    if (pending.agentId === null || this.applicationSettings === null) {
      throw new Error("当前对话没有可保存权限的 Agent。请选择本次允许或本会话允许。");
    }
    const configuration = this.applicationSettings.getConfiguration();
    const agent = configuration.agentDirectory.agents.find(
      (candidate) => candidate.id === pending.agentId,
    );
    if (agent === undefined) throw new Error("当前 Agent 不存在，无法保存权限规则。");
    const currentRules = agent.permissions?.allow ?? [];
    if (currentRules.some((candidate) => candidate.tool === rule.tool && candidate.pattern === rule.pattern)) {
      return;
    }
    this.applicationSettings.saveConfiguration({
      ...configuration,
      agentDirectory: {
        ...configuration.agentDirectory,
        agents: configuration.agentDirectory.agents.map((candidate) => candidate.id === agent.id
          ? {
              ...candidate,
              permissions: { allow: [...currentRules, rule] },
            }
          : candidate),
      },
    });
  }

  private requestToolApproval(input: {
    runId: string;
    signal: AbortSignal;
    tool: ReturnType<typeof conversationToolItemSchema.parse>;
    emit: RunEventEmitter;
    pattern: string;
    permissionTool: AgentPermissionTool;
  }): boolean {
    const interruptValue: ToolApprovalInterrupt = {
      conversationId: input.tool.conversationId,
      kind: "tool_approval",
      pattern: input.pattern,
      permissionTool: input.permissionTool,
      runId: input.runId,
      toolId: input.tool.id,
    };
    const resumed = this.resumedApprovalDecisions.get(input.tool.id);
    if (resumed !== undefined && resumed.runId === input.runId) {
      const approved = interrupt<ToolApprovalInterrupt, boolean>(interruptValue);
      this.resumedApprovalDecisions.delete(input.tool.id);
      return approved;
    }

    this.appendShadowThreadLog(input.tool.conversationId, {
      payload: {
        pattern: input.pattern,
        permissionTool: input.permissionTool,
        runId: input.runId,
        toolId: input.tool.id,
      },
      type: "tool_approval_requested",
    });
    this.database.updateTool(input.tool);
    void this.createChangeApproval({
      agentId: this.agentForConversation(input.tool.conversationId)?.id ?? null,
      conversationId: input.tool.conversationId,
      pattern: input.pattern,
      permissionTool: input.permissionTool,
      runId: input.runId,
      signal: input.signal,
      toolId: input.tool.id,
    });
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
    const decision = this.permissionDecision({
      conversationId: input.startedTool.conversationId,
      permissionMode: input.permissionMode,
      permissionTool: input.change.operation,
      pattern: input.change.path,
      toolId: input.startedTool.id,
    });
    if (decision === "deny") {
      const message = input.permissionMode === "read_only"
        ? "File changes are blocked because this conversation is read-only."
        : this.unavailableToolReason(input.change.operation) ?? "File changes are blocked by the current permission policy.";
      return {
        content: JSON.stringify({
          error: message,
          ok: false
        }),
        isError: true,
        kind: "completed"
      };
    }
    if (decision === "ask") {
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
        pattern: input.change.path,
        permissionTool: input.change.operation,
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

  private async resolveExternalFileRead(input: {
    controller: AbortController;
    emit: RunEventEmitter;
    permissionMode: ConversationPermissionMode;
    prepared: PreparedExternalFileRead;
    runId: string;
    startedTool: ReturnType<typeof conversationToolItemSchema.parse>;
  }): Promise<ToolExecutionResult> {
    const decision = this.permissionDecision({
      conversationId: input.startedTool.conversationId,
      externalRead: true,
      permissionMode: input.permissionMode,
      pattern: input.prepared.path,
      permissionTool: "external_read",
      toolId: input.startedTool.id,
    });
    if (decision !== "allow") {
      const awaitingTool = conversationToolItemSchema.parse({
        ...input.startedTool,
        status: "awaiting_approval",
      });
      const approved = this.requestToolApproval({
        emit: input.emit,
        pattern: input.prepared.path,
        permissionTool: "external_read",
        runId: input.runId,
        signal: input.controller.signal,
        tool: awaitingTool,
      });
      this.pendingChangeApprovals.delete(awaitingTool.id);
      if (!approved) {
        return {
          content: JSON.stringify({
            error: "The user rejected this external file read.",
            ok: false,
            value: { path: input.prepared.path, status: "rejected" },
          }),
          isError: true,
          kind: "completed",
          status: "rejected",
        };
      }
    }
    return this.tools.executePreparedExternalFileRead(
      input.prepared,
      input.controller.signal,
    );
  }

  private async resolveCommand(input: {
    command: PreparedCommand;
    controller: AbortController;
    emit: RunEventEmitter;
    permissionMode: ConversationPermissionMode;
    projectId: string | undefined;
    runId: string;
    startedTool: ReturnType<typeof conversationToolItemSchema.parse>;
    operationOwner: ProjectOperationOwner;
  }): Promise<ToolExecutionResult> {
    const decision = this.permissionDecision({
      conversationId: input.startedTool.conversationId,
      permissionMode: input.permissionMode,
      permissionTool: "run_command",
      pattern: input.command.command,
      toolId: input.startedTool.id,
    });
    if (decision === "deny") {
      const message = input.permissionMode === "read_only"
        ? "Command execution is blocked because this conversation is read-only."
        : this.unavailableToolReason("run_command") ?? "Command execution is blocked by the current permission policy.";
      return {
        content: JSON.stringify({
          error: message,
          ok: false
        }),
        isError: true,
        kind: "completed"
      };
    }
    if (decision === "ask") {
      const awaitingTool = conversationToolItemSchema.parse({
        ...input.startedTool,
        status: "awaiting_approval"
      });
      const approved = this.requestToolApproval({
        emit: input.emit,
        runId: input.runId,
        signal: input.controller.signal,
        tool: awaitingTool,
        pattern: input.command.command,
        permissionTool: "run_command",
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
      (output) => {
        this.emit(input.emit, {
          commandId: output.commandId,
          conversationId: input.startedTool.conversationId,
          delta: output.delta,
          done: output.done,
          exitCode: output.exitCode,
          runId: input.runId,
          status: output.status,
          stream: output.stream,
          timedOut: output.timedOut,
          toolId: input.startedTool.id,
          type: "tool.output_delta",
          truncated: output.truncated,
        });
      },
    );
  }

  private createChangeApproval(input: {
    agentId: string | null;
    conversationId: string;
    pattern: string;
    permissionTool: AgentPermissionTool;
    runId: string;
    signal: AbortSignal;
    toolId: string;
  }): Promise<boolean> {
    const existing = this.pendingChangeApprovals.get(input.toolId);
    if (existing !== undefined && existing.runId === input.runId) return existing.promise;

    let resolvePromise: (approved: boolean) => void = () => undefined;
    const promise = new Promise<boolean>((resolve) => {
      resolvePromise = resolve;
    });
    const cleanup = (): void => {
      input.signal.removeEventListener("abort", onAbort);
      if (this.pendingChangeApprovals.get(input.toolId)?.runId === input.runId) {
        this.pendingChangeApprovals.delete(input.toolId);
      }
    };
    const onAbort = (): void => {
      cleanup();
      resolvePromise(false);
    };
    const pending: PendingChangeApproval = {
      agentId: input.agentId,
      conversationId: input.conversationId,
      pattern: input.pattern,
      permissionTool: input.permissionTool,
      promise,
      resolve: (approved) => {
        input.signal.removeEventListener("abort", onAbort);
        resolvePromise(approved);
      },
      runId: input.runId,
    };
    this.pendingChangeApprovals.set(input.toolId, pending);
    if (input.signal.aborted) onAbort();
    else input.signal.addEventListener("abort", onAbort, { once: true });
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
    const skillCatalogPrompt = this.skillRuntime === null
      ? null
      : this.skillRuntime.getCatalogPrompt(
          this.skillRuntimeContext(conversation, workspace?.id),
        ) ?? "No enabled Skill currently satisfies the scope and dependency requirements.";
    const systemMessage: ModelMessage = {
      attachments: [],
      content: [
        BASE_SYSTEM_PROMPT,
        ...conversationIdentityContext(conversation, agent),
        ...this.agentDelegationContext(conversation),
        this.skillRuntime === null
          ? "A Skill is a task instruction and capability bundle injected from SKILL.md. No Skill Runtime is currently available, so do not label general abilities as Skills. Git is a command-line program available through run_command, not a Skill or dedicated Git tool; use it only when the task requires it and the workspace is a Git repository."
          : "A Skill is a task instruction and capability bundle injected from SKILL.md, not a built-in tool, Agent role, or command-line program. Use load_skill when catalog details match the task. Skill bodies enter only the current model context, never the chat Timeline, and cannot expand permissions or bypass approval. Git is available through run_command, not as a Skill or dedicated Git tool; use it only when needed in a Git workspace.",
        workspace === null
          ? this.attachmentTool === null
            ? `This temporary conversation has no workspace. It may still use the ${this.tools.getCommandEnvironmentDescription()} command tool, read_external_file, web_search, and Agent/Subagent collaboration tools. Commands run in an isolated temporary directory. Project file, directory, and search tools require an attached working directory. Every external file read still requires approval.`
            : `This temporary conversation has no workspace. It may still use read_attachment, the ${this.tools.getCommandEnvironmentDescription()} command tool, read_external_file, web_search, and Agent/Subagent collaboration tools. Commands run in an isolated temporary directory. Project file, directory, and search tools require an attached working directory. Every external file read still requires approval.`
          : `The current workspace supports file reads, search, controlled file changes, the ${this.tools.getCommandEnvironmentDescription()} command tool, and web_search. Commands and writes remain subject to this run's permission policy.`,
        `One model turn may return at most ${MAX_TOOL_CALLS_PER_MODEL_TURN} mixed Tool Calls. Independent reads such as read_file, search_text, find_files, and read_attachment run concurrently in groups of up to ${MAX_PARALLEL_READ_TOOL_CALLS}, with results matched by call ID. File changes, approvals, Agent messages, and task state remain ordered; stale same-file changes in one batch are rejected. Outside read_only mode, consecutive independent run_command calls run in parallel by default in groups of up to ${MAX_PARALLEL_COMMAND_TOOL_CALLS}; set parallel=false for dependencies or shared mutable state. ask_before_changes still approves each command separately, after which independent commands may overlap. If a turn exceeds the limit, none of its tools run; split the work across turns. Prefer passing multiple IDs at once to wait_for_commands and wait_for_subagents.`,
        `Permission mode selected for this task: ${permissionModeLabel(permissionMode)}.`,
        ...(workspace === null
          ? []
          : [
            workspace.kind === "project"
              ? `Current project: ${workspace.name}`
              : `Current conversation working directory: ${workspace.name}`,
            `Authorized root: ${workspace.rootPath}`,
            "Every file-tool path is a POSIX path relative to the authorized root; an empty path means the root. Do not call a tool merely to discover the authorized root."
          ]),
        ...(skillCatalogPrompt === null ? [] : [skillCatalogPrompt])
      ].join("\n"),
      role: "system",
      toolCallId: null,
      toolCalls: []
    };
    const reservedSkillTokens = this.skillRuntime === null
      ? 0
      : resolveActiveSkillContextBudget(contextWindowTokens) + CONTEXT_MESSAGE_OVERHEAD_TOKENS;
    const reservedTaskListTokens = activeTaskListContextTokens(
      this.database.getTaskList(conversationId),
    );
    const compiled = this.contextCompiler.compile({
      contextCompressionConfiguration,
      contextWindowTokens,
      conversationId,
      includeImageData,
      outputReserveTokens: MAX_OUTPUT_TOKENS,
      estimatedSkillCatalogTokens: skillCatalogPrompt === null
        ? 0
        : estimateContextTokens(skillCatalogPrompt),
      reservedSkillTokens,
      reservedTaskListTokens,
      systemMessage,
      toolDefinitions: this.toolHandlers.getDefinitions({ projectId: workspace?.id }),
    });

    return {
      compactionCandidates: compiled.compactionCandidates,
      messages: compiled.messages,
      usage: conversationContextUsageSchema.parse(compiled.usage)
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
        const savedCheckpoint = this.threadLog !== null && this.eventProjector !== null
          ? (() => {
              const preparedCheckpoint = this.database.prepareContextCheckpoint(
                conversationId,
                lastCandidate.sequence,
                summary,
              );
              this.appendWriteAheadThreadLog(conversationId, {
                payload: { ...preparedCheckpoint, writeAhead: true },
                type: "context_checkpoint",
              });
              return this.database.getContextCheckpoint(conversationId) ?? (() => {
                throw new Error("Context checkpoint projection could not be persisted.");
              })();
            })()
          : this.database.saveContextCheckpoint(
              conversationId,
              lastCandidate.sequence,
              summary,
            );
        if (this.threadLog === null || this.eventProjector === null) {
          this.appendShadowThreadLog(conversationId, {
            payload: {
              coveredThroughSequence: lastCandidate.sequence,
              createdAt: savedCheckpoint.createdAt,
              summary,
              updatedAt: savedCheckpoint.updatedAt,
            },
            type: "context_checkpoint",
          });
        }
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
        const result = await this.modelGateway.completeTurn({
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
      "[Referenced project files]",
      "The following paths are relative to the current authorized root. Call read_file before using their contents:",
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

  private toolDefinitionsForConversation(conversationId: string): ModelToolDefinition[] {
    const conversation = this.database.getConversation(conversationId);
    const workspace = this.resolveConversationWorkspace(conversation);
    return this.toolHandlers.getDefinitions({ projectId: workspace?.id });
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
      return "read_only";
    case "ask_before_changes":
      return "ask_before_changes";
    case "full_access":
      return "full_access";
  }
}
