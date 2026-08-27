import {
  AIMessage,
  BaseMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  coerceMessageLikeToMessage,
  type BaseMessageLike,
} from "@langchain/core/messages";
import { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { ChatGeneration, ChatResult } from "@langchain/core/outputs";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { Command, isInterrupted, MemorySaver } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";
import {
  MIDDLEWARE_BRAND,
  createAgent,
  createMiddleware,
  modelCallLimitMiddleware,
} from "langchain";
import { z } from "zod";

import type {
  ModelMessage,
  ModelMessageAttachment,
  ModelProviderState,
  ModelToolCall,
  ModelToolDefinition,
  ModelTurnResult,
} from "../model/model-contracts.js";
import type { SkillSnapshotRef } from "./skill-runtime.js";

export type AgentGraphState = {
  activeSkills: SkillSnapshotRef[];
  contextPrepared: boolean;
  hasFollowUpInput: boolean;
  hasSuccessfulToolExecution: boolean;
  lastResult: ModelTurnResult | null;
  messages: ModelMessage[];
  pendingToolCalls: ModelToolCall[];
  turns: number;
};

export type AgentGraphModelPreparation = {
  contextMessages?: ModelMessage[];
  messages: ModelMessage[];
  hasFollowUpInput: boolean;
};

export type AgentGraphInitialPreparation = {
  activeSkills?: SkillSnapshotRef[];
  messages: ModelMessage[];
};

export type AgentGraphModelCallHooks = {
  onTextDelta?(): void;
};

export type AgentGraphModelRetry = {
  maxRetries: number;
  getDelay(retryAttempt: number): number;
  shouldRetry(error: unknown): boolean;
  wait(delayMs: number, signal: AbortSignal): Promise<void>;
  onRetry(input: {
    attempt: number;
    delayMs: number;
    error: unknown;
  }): Promise<void> | void;
  onFailure?(error: unknown): Promise<void> | void;
  shouldFailEmptyResponse?(): boolean;
  createEmptyResponseError?(): Error;
};

export type AgentGraphToolExecution = {
  activeSkills?: SkillSnapshotRef[];
  messages: ModelMessage[];
  successful: boolean;
};

export type AgentGraphCallbacks = {
  beforeAgent?(state: AgentGraphState): Promise<AgentGraphInitialPreparation>;
  beforeModel(state: AgentGraphState): Promise<AgentGraphModelPreparation>;
  executeTools(
    calls: readonly ModelToolCall[],
    state: AgentGraphState,
  ): Promise<AgentGraphToolExecution>;
  hasFollowUpInput?(): boolean | Promise<boolean>;
  callModel(
    messages: readonly ModelMessage[],
    turn: number,
    hooks?: AgentGraphModelCallHooks,
  ): Promise<ModelTurnResult>;
};

export type LangGraphExecutorInput = {
  callbacks: AgentGraphCallbacks;
  checkpointer?: BaseCheckpointSaver;
  initialMessages: readonly ModelMessage[];
  maxSteps: number;
  modelRetry?: AgentGraphModelRetry;
  onInterrupt?(interrupts: readonly LangGraphInterrupt[]): Promise<unknown>;
  signal: AbortSignal;
  threadId: string;
  toolDefinitions?: readonly ModelToolDefinition[];
};

export type LangGraphInterrupt = {
  id: string;
  value: unknown;
};

const MODEL_MESSAGE_METADATA_KEY = "__agent_model_message_v1";

const skillSnapshotSchema = z.object({
  contentHash: z.string(),
  id: z.string(),
  version: z.string(),
});

const runtimeStateSchema = z.object({
  activeSkills: z.array(skillSnapshotSchema).default([]),
  contextPrepared: z.boolean().default(false),
  hasFollowUpInput: z.boolean().default(false),
  hasSuccessfulToolExecution: z.boolean().default(false),
  turns: z.number().int().nonnegative().default(0),
});

type RuntimeState = z.infer<typeof runtimeStateSchema> & {
  messages: BaseMessage[];
};

type RuntimeToolBatch = {
  activeSkills: SkillSnapshotRef[];
  messages: Map<string, ModelMessage>;
  successful: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isModelToolCall(value: unknown): value is ModelToolCall {
  return isRecord(value)
    && typeof value.arguments === "string"
    && typeof value.id === "string"
    && typeof value.name === "string";
}

function isModelProviderState(value: unknown): value is ModelProviderState {
  if (!isRecord(value)) return false;
  const formats = [
    "openai-chat-completions",
    "openai-responses",
    "anthropic-messages",
    "google-gemini",
  ] as const;
  return typeof value.apiFormat === "string"
    && formats.includes(value.apiFormat as (typeof formats)[number])
    && typeof value.baseUrl === "string"
    && typeof value.modelId === "string"
    && "payload" in value;
}

function isModelMessageAttachment(value: unknown): value is ModelMessageAttachment {
  if (!isRecord(value)) return false;
  if (
    typeof value.contextTokens !== "number"
    || typeof value.id !== "string"
    || typeof value.mimeType !== "string"
    || typeof value.name !== "string"
    || (value.projectPath !== null && typeof value.projectPath !== "string")
    || (value.readState !== "full" && value.readState !== "metadata_only" && value.readState !== "preview")
    || typeof value.truncated !== "boolean"
    || (value.source !== "project" && value.source !== "upload")
  ) return false;
  if (value.kind === "text") return typeof value.content === "string";
  return value.kind === "image" && (value.data === null || typeof value.data === "string");
}

function isModelMessage(value: unknown): value is ModelMessage {
  if (!isRecord(value)) return false;
  return Array.isArray(value.attachments)
    && value.attachments.every(isModelMessageAttachment)
    && typeof value.content === "string"
    && (value.role === "system" || value.role === "user" || value.role === "assistant" || value.role === "tool")
    && (value.toolCallId === null || typeof value.toolCallId === "string")
    && Array.isArray(value.toolCalls)
    && value.toolCalls.every(isModelToolCall)
    && (value.providerState === undefined || isModelProviderState(value.providerState));
}

function encodedModelMessage(message: BaseMessage): ModelMessage | null {
  const metadata = message.additional_kwargs;
  if (!isRecord(metadata)) return null;
  const candidate = metadata[MODEL_MESSAGE_METADATA_KEY];
  return isModelMessage(candidate) ? candidate : null;
}

function parseToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) return value;
  if (typeof value !== "string") return {};
  try {
    const parsed: unknown = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function assistantMessage(result: ModelTurnResult): ModelMessage {
  return {
    attachments: [],
    content: result.content,
    ...(result.providerState === undefined ? {} : { providerState: result.providerState }),
    role: "assistant",
    toolCallId: null,
    toolCalls: result.toolCalls,
  };
}

function toolCallsOf(result: ModelTurnResult | null): ModelToolCall[] {
  return result === null ? [] : result.toolCalls;
}

function toLangChainMessage(message: ModelMessage): BaseMessage {
  const metadata = { [MODEL_MESSAGE_METADATA_KEY]: message };
  if (message.role === "system") return new SystemMessage({ content: message.content, additional_kwargs: metadata });
  if (message.role === "user") return new HumanMessage({ content: message.content, additional_kwargs: metadata });
  if (message.role === "tool") {
    if (message.toolCallId === null || message.toolCallId.length === 0) {
      throw new Error("Tool result does not match a preceding model tool call.");
    }
    return new ToolMessage({
      additional_kwargs: metadata,
      content: message.content,
      name: "runtime_tool",
      tool_call_id: message.toolCallId,
    });
  }
  return new AIMessage({
    additional_kwargs: metadata,
    content: message.content,
    tool_calls: message.toolCalls.map((call) => ({
      args: parseToolArguments(call.arguments),
      id: call.id,
      name: call.name,
      type: "tool_call" as const,
    })),
  });
}

function fromLangChainMessage(message: BaseMessageLike): ModelMessage {
  const normalized = BaseMessage.isInstance(message) ? message : coerceMessageLikeToMessage(message);
  const encoded = encodedModelMessage(normalized);
  if (encoded !== null) return encoded;
  const role = normalized.getType();
  if (role === "system") {
    return {
      attachments: [],
      content: typeof normalized.content === "string" ? normalized.content : JSON.stringify(normalized.content),
      role: "system",
      toolCallId: null,
      toolCalls: [],
    };
  }
  if (role === "human") {
    return {
      attachments: [],
      content: typeof normalized.content === "string" ? normalized.content : JSON.stringify(normalized.content),
      role: "user",
      toolCallId: null,
      toolCalls: [],
    };
  }
  if (role === "tool") {
    if (!ToolMessage.isInstance(normalized)) {
      throw new Error("Tool result does not match a preceding model tool call.");
    }
    const toolCallId = normalized.tool_call_id;
    if (typeof toolCallId !== "string" || toolCallId.length === 0) {
      throw new Error("Tool result does not match a preceding model tool call.");
    }
    return {
      attachments: [],
      content: typeof normalized.content === "string" ? normalized.content : JSON.stringify(normalized.content),
      role: "tool",
      toolCallId,
      toolCalls: [],
    };
  }
  const toolCalls = AIMessage.isInstance(normalized) && Array.isArray(normalized.tool_calls)
    ? normalized.tool_calls.flatMap((call: unknown) => {
      if (!isRecord(call) || typeof call.id !== "string" || typeof call.name !== "string") return [];
      return [{
        arguments: JSON.stringify(isRecord(call.args) ? call.args : {}),
        id: call.id,
        name: call.name,
      }];
    })
    : [];
  return {
    attachments: [],
    content: typeof normalized.content === "string" ? normalized.content : JSON.stringify(normalized.content),
    role: "assistant",
    toolCallId: null,
    toolCalls,
  };
}

function modelMessagesFromState(messages: readonly BaseMessageLike[]): ModelMessage[] {
  return messages.map(fromLangChainMessage);
}

function addContextMessages(
  messages: readonly BaseMessage[],
  contextMessages: readonly ModelMessage[],
): BaseMessage[] {
  if (contextMessages.length === 0) return [...messages];
  const context = contextMessages.map(toLangChainMessage);
  const firstSystemIndex = messages.findIndex((message) => message.getType() === "system");
  if (firstSystemIndex < 0) return [...context, ...messages];
  const system = messages[firstSystemIndex];
  if (system === undefined) return [...context, ...messages];
  return [system, ...context, ...messages.filter((_message, index) => index !== firstSystemIndex)];
}

function stateForCallback(state: RuntimeState, lastResult: ModelTurnResult | null): AgentGraphState {
  return {
    activeSkills: state.activeSkills,
    contextPrepared: state.contextPrepared,
    hasFollowUpInput: state.hasFollowUpInput,
    hasSuccessfulToolExecution: state.hasSuccessfulToolExecution,
    lastResult,
    messages: modelMessagesFromState(state.messages),
    pendingToolCalls: lastResult?.toolCalls ?? [],
    turns: state.turns,
  };
}

class CallbackChatModel extends BaseChatModel {
  public constructor(
    private readonly runtimeCallbacks: AgentGraphCallbacks,
    private readonly turn: { value: number },
    private readonly modelCallHooks: { current: AgentGraphModelCallHooks | undefined },
    private readonly signal: AbortSignal,
  ) {
    super({});
  }

  public override bindTools(): this {
    // Runtime supplies the exact neutral tool definitions to the provider
    // adapter. The createAgent tool list is only the graph's dispatch catalog.
    return this;
  }

  public override _llmType(): string {
    return "agent-runtime-callback-model";
  }

  public override async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.signal.throwIfAborted();
    const result = await this.runtimeCallbacks.callModel(
      modelMessagesFromState(messages),
      this.turn.value,
      this.modelCallHooks.current,
    );
    this.signal.throwIfAborted();
    const message = toLangChainMessage(assistantMessage(result));
    const generation: ChatGeneration = { message, text: result.content };
    return { generations: [generation] };
  }
}

class RuntimeToolCoordinator {
  private readonly batches = new Map<string, Promise<RuntimeToolBatch>>();

  public constructor(
    private readonly callbacks: AgentGraphCallbacks,
    private readonly lastResult: () => ModelTurnResult | null,
  ) {}

  public execute(request: {
    calls: readonly ModelToolCall[];
    state: RuntimeState;
  }): Promise<RuntimeToolBatch> {
    const key = request.calls.map((call) => call.id).join(",");
    const existing = this.batches.get(key);
    if (existing !== undefined) return existing;
    const state = stateForCallback(request.state, this.lastResult());
    const execution = this.callbacks.executeTools(request.calls, state)
      .then((result) => {
        const messages = new Map<string, ModelMessage>();
        for (const message of result.messages) {
          if (message.role !== "tool" || message.toolCallId === null) continue;
          messages.set(message.toolCallId, message);
        }
        for (const call of request.calls) {
          if (!messages.has(call.id)) throw new Error(`Tool execution did not return a result for ${call.id}.`);
        }
        return {
          activeSkills: result.activeSkills ?? [],
          messages,
          successful: result.successful,
        };
      })
      .finally(() => {
        this.batches.delete(key);
      });
    this.batches.set(key, execution);
    return execution;
  }
}

function toolCallsFromState(state: RuntimeState, fallback: ModelToolCall): ModelToolCall[] {
  const last = state.messages.at(-1);
  if (last !== undefined) {
    const encoded = encodedModelMessage(last);
    if (encoded !== null && encoded.role === "assistant" && encoded.toolCalls.length > 0) {
      return encoded.toolCalls;
    }
  }
  return [fallback];
}

function runtimeToolDefinitions(
  definitions: readonly ModelToolDefinition[],
): DynamicStructuredTool[] {
  return definitions.map((definition) => new DynamicStructuredTool({
    description: definition.description,
    func: () => {
      throw new Error(`Tool ${definition.name} must be executed by the Runtime middleware.`);
    },
    name: definition.name,
    schema: z.record(z.string(), z.unknown()),
  }));
}

function asAgentState(value: unknown): RuntimeState {
  if (!isRecord(value) || !Array.isArray(value.messages)) {
    throw new Error("createAgent returned an invalid state.");
  }
  const parsed = runtimeStateSchema.parse(value);
  return {
    ...parsed,
    messages: value.messages.filter((message) => BaseMessage.isInstance(message)),
  };
}

function isFrameworkModelCallLimitError(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current === null || typeof current !== "object" || seen.has(current)) return false;
    seen.add(current);
    if (current instanceof Error && current.name === "ModelCallLimitMiddlewareError") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

class AgentModelCallLimitError extends Error {
  public readonly code = "MODEL_CALL_LIMIT_EXCEEDED";

  public constructor(maxSteps: number, cause: unknown) {
    super(`Agent exceeded the ${maxSteps}-turn tool loop limit.`, { cause });
    this.name = "AgentModelCallLimitError";
  }
}

function isFrameworkGraphRecursionError(error: unknown): boolean {
  const seen = new Set<object>();
  let current = error;
  for (let depth = 0; depth < 8; depth += 1) {
    if (current === null || typeof current !== "object" || seen.has(current)) return false;
    seen.add(current);
    const record = current as { lc_error_code?: unknown; name?: unknown; cause?: unknown };
    if (record.lc_error_code === "GRAPH_RECURSION_LIMIT" || record.name === "GraphRecursionError") {
      return true;
    }
    current = record.cause;
  }
  return false;
}

function graphRecursionLimit(maxSteps: number): number {
  // createAgent runs model-limit and bridge hooks as graph nodes around the
  // model/tool nodes. Keep enough room for every bounded model turn while
  // retaining LangGraph's own recursion guard as a secondary circuit breaker.
  const estimatedGraphSteps = maxSteps * 8 + 8;
  return Math.max(25, estimatedGraphSteps);
}

function frameworkModelCallLimit(): unknown {
  // langchain@1.5.9 publishes the built-in middleware with Zod v3 declarations
  // that are not assignable under exactOptionalPropertyTypes, although the
  // runtime supports both Zod versions. Keep the compatibility cast at this
  // dependency boundary and verify the middleware brand before returning it.
  const candidate: unknown = modelCallLimitMiddleware();
  if (
    !isRecord(candidate)
    || (candidate as Record<PropertyKey, unknown>)[MIDDLEWARE_BRAND] !== true
  ) {
    throw new Error("LangChain model call limit middleware is unavailable.");
  }
  return candidate;
}

/**
 * Runs the bounded Agent graph through LangChain's createAgent harness.
 * Runtime callbacks remain the only owner of business side effects; the
 * framework owns the model/tool loop, middleware routing, interrupts, and
 * checkpoint boundaries.
 */
export class LangGraphExecutor {
  public async invoke(input: LangGraphExecutorInput): Promise<AgentGraphState> {
    if (!Number.isInteger(input.maxSteps) || input.maxSteps < 1) {
      throw new Error("LangGraph maxSteps must be a positive integer.");
    }
    if (
      input.modelRetry !== undefined
      && (!Number.isInteger(input.modelRetry.maxRetries) || input.modelRetry.maxRetries < 0)
    ) {
      throw new Error("LangGraph modelRetry.maxRetries must be a non-negative integer.");
    }
    input.signal.throwIfAborted();

    const checkpointer = input.checkpointer ?? new MemorySaver();
    const turn = { value: 0 };
    const modelCallHooks: { current: AgentGraphModelCallHooks | undefined } = { current: undefined };
    let lastResult: ModelTurnResult | null = null;
    let contextMessages: ModelMessage[] = [];
    let continueAfterModel = false;
    const coordinator = new RuntimeToolCoordinator(input.callbacks, () => lastResult);
    const model = new CallbackChatModel(input.callbacks, turn, modelCallHooks, input.signal);
    const middleware = createMiddleware({
      name: "agent-runtime-bridge",
      stateSchema: runtimeStateSchema,
      beforeAgent: async (state) => {
        input.signal.throwIfAborted();
        if (state.contextPrepared) return { contextPrepared: true };
        const prepared = await input.callbacks.beforeAgent?.(
          stateForCallback(state, lastResult),
        );
        return {
          ...(prepared === undefined
            ? {}
            : {
                activeSkills: prepared.activeSkills ?? state.activeSkills,
                messages: prepared.messages.map(toLangChainMessage),
              }),
          contextPrepared: true,
        };
      },
      beforeModel: async (state) => {
        input.signal.throwIfAborted();
        turn.value = state.turns;
        const prepared = await input.callbacks.beforeModel(stateForCallback(state, lastResult));
        continueAfterModel = prepared.hasFollowUpInput;
        contextMessages = prepared.contextMessages ?? [];
        return {
          activeSkills: state.activeSkills,
          hasFollowUpInput: prepared.hasFollowUpInput,
          messages: prepared.messages.map(toLangChainMessage),
        };
      },
      afterModel: {
        hook: async (state) => {
          input.signal.throwIfAborted();
          const callbackFollowUpInput = await input.callbacks.hasFollowUpInput?.() ?? false;
          const hasToolCalls = lastResult !== null && lastResult.toolCalls.length > 0;
          if (!hasToolCalls && callbackFollowUpInput) continueAfterModel = true;
          return {
            hasFollowUpInput: false,
            turns: state.turns + 1,
          };
        },
      },
      wrapModelCall: async (request, handler) => {
        const messages = addContextMessages(request.messages, contextMessages);
        let retryAttempt = 0;
        while (true) {
          input.signal.throwIfAborted();
          const modelCallState = { receivedTextDelta: false };
          modelCallHooks.current = {
            onTextDelta: () => {
              modelCallState.receivedTextDelta = true;
            },
          };
          try {
            const response = await handler({ ...request, messages });
            if (AIMessage.isInstance(response)) {
              const encoded = encodedModelMessage(response);
              if (encoded !== null && encoded.role === "assistant") {
                lastResult = {
                  content: encoded.content,
                  finishReason: null,
                  ...(encoded.providerState === undefined ? {} : { providerState: encoded.providerState }),
                  toolCalls: encoded.toolCalls,
                };
                const isEmptyResponse = encoded.content.trim().length === 0
                  && encoded.toolCalls.length === 0;
                const retry = input.modelRetry;
                if (isEmptyResponse && retry !== undefined) {
                  const shouldFail = retry.shouldFailEmptyResponse?.() ?? true;
                  if (shouldFail && (modelCallState.receivedTextDelta || retryAttempt >= retry.maxRetries)) {
                    throw retry.createEmptyResponseError?.()
                      ?? new Error("Model returned an empty response.");
                  }
                  if (!modelCallState.receivedTextDelta && retryAttempt < retry.maxRetries) {
                    retryAttempt += 1;
                    const delayMs = retry.getDelay(retryAttempt);
                    await retry.onRetry({ attempt: retryAttempt, delayMs, error: null });
                    await retry.wait(delayMs, input.signal);
                    continue;
                  }
                }
              }
            }
            return response;
          } catch (error) {
            const retry = input.modelRetry;
            if (
              retry === undefined
              || modelCallState.receivedTextDelta
              || !retry.shouldRetry(error)
              || retryAttempt >= retry.maxRetries
            ) {
              await retry?.onFailure?.(error);
              throw error;
            }
            retryAttempt += 1;
            const delayMs = retry.getDelay(retryAttempt);
            await retry.onRetry({ attempt: retryAttempt, delayMs, error });
            await retry.wait(delayMs, input.signal);
          } finally {
            modelCallHooks.current = undefined;
          }
        }
      },
      wrapToolCall: async (request) => {
        input.signal.throwIfAborted();
        const fallback: ModelToolCall = {
          arguments: JSON.stringify(request.toolCall.args),
          id: typeof request.toolCall.id === "string" ? request.toolCall.id : crypto.randomUUID(),
          name: request.toolCall.name,
        };
        const calls = toolCallsFromState(request.state, fallback);
        const batch = await coordinator.execute({ calls, state: request.state });
        const result = batch.messages.get(fallback.id);
        if (result === undefined) throw new Error(`Tool execution did not return ${fallback.id}.`);
        if (calls[0]?.id !== fallback.id) {
          const toolMessage = toLangChainMessage(result);
          if (!ToolMessage.isInstance(toolMessage)) throw new Error("Runtime returned a non-tool message.");
          return toolMessage;
        }
        return new Command({
          update: {
            activeSkills: batch.activeSkills,
            hasSuccessfulToolExecution:
              request.state.hasSuccessfulToolExecution || batch.successful,
            messages: [toLangChainMessage(result)],
          },
        });
      },
    });
    const modelCallLimit = frameworkModelCallLimit() as typeof middleware;
    const agent = createAgent({
      checkpointer,
      middleware: [
        // The graph thread is one persisted Run, so the framework's thread
        // counter is the durable per-Run model-call limit we need here.
        modelCallLimit,
        middleware,
      ],
      model,
      signal: input.signal,
      tools: runtimeToolDefinitions(input.toolDefinitions ?? []),
      version: "v1",
    });

    const config = {
      configurable: { thread_id: input.threadId },
      context: {
        exitBehavior: "error" as const,
        threadLimit: input.maxSteps,
      },
      recursionLimit: graphRecursionLimit(input.maxSteps),
      signal: input.signal,
    };
    type AgentInput = Parameters<typeof agent.invoke>[0];
    let graphInput: AgentInput = {
      messages: input.initialMessages.map(toLangChainMessage),
    };
    while (true) {
      input.signal.throwIfAborted();
      lastResult = null;
      contextMessages = [];
      let result: unknown;
      try {
        result = await agent.invoke(graphInput, config);
      } catch (error) {
        if (isFrameworkModelCallLimitError(error) || isFrameworkGraphRecursionError(error)) {
          throw new AgentModelCallLimitError(input.maxSteps, error);
        }
        throw error;
      }
      if (!isInterrupted(result)) {
        const state = asAgentState(result);
        const modelResult: ModelTurnResult | null = lastResult;
        const shouldContinue = continueAfterModel
          && toolCallsOf(modelResult).length === 0;
        if (shouldContinue) {
          graphInput = { contextPrepared: true, messages: [] };
          continue;
        }
        return {
          activeSkills: state.activeSkills,
          contextPrepared: state.contextPrepared,
          hasFollowUpInput: state.hasFollowUpInput,
          hasSuccessfulToolExecution: state.hasSuccessfulToolExecution,
          lastResult: modelResult,
          messages: modelMessagesFromState(state.messages),
          pendingToolCalls: toolCallsOf(modelResult),
          turns: state.turns,
        };
      }
      if (input.onInterrupt === undefined) {
        throw new Error("LangGraph interrupted without an approval callback.");
      }
      const interrupts = result.__interrupt__.map((entry) => {
        if (typeof entry.id !== "string") {
          throw new Error("LangGraph returned an interrupt without an identifier.");
        }
        return { id: entry.id, value: entry.value };
      });
      const resume = await input.onInterrupt(interrupts);
      input.signal.throwIfAborted();
      const [interrupt] = interrupts;
      if (interrupt === undefined) {
        throw new Error("LangGraph returned an empty interrupt list.");
      }
      graphInput = new Command({
        resume: { [interrupt.id]: resume },
      });
    }
  }
}
