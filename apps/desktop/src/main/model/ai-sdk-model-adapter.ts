import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import {
  isGemini3ReasoningModel,
  type ModelApiFormat,
} from "@agent/protocol";
import {
  APICallError,
  jsonSchema,
  streamText,
  tool,
  type AssistantModelMessage as AiSdkAssistantModelMessage,
  type ModelMessage as AiSdkModelMessage,
  type ProviderOptions,
  type ReasoningPart,
  type TextPart,
  type ToolCallPart,
  type ToolSet,
} from "ai";
import { z } from "zod";

import type {
  CompleteTurnInput,
  ModelMessage,
  ModelProviderAdapter,
  ModelProviderState,
  ModelToolCall,
  ModelTurnResult,
} from "./model-contracts.js";
import { modelImageAttachmentCaption } from "./model-contracts.js";
import { createModelRequestError } from "./model-request-error.js";
import { parseToolArguments } from "./tool-arguments.js";

const AI_SDK_PROVIDER_STATE_VERSION = 1;

const providerOptionsSchema = z.record(
  z.string(),
  z.record(z.string(), z.json()),
);

const assistantPartSchema = z.discriminatedUnion("type", [
  z.object({
    providerOptions: providerOptionsSchema.optional(),
    text: z.string(),
    type: z.literal("text"),
  }),
  z.object({
    providerOptions: providerOptionsSchema.optional(),
    text: z.string(),
    type: z.literal("reasoning"),
  }),
  z.object({
    input: z.json(),
    providerExecuted: z.boolean().optional(),
    providerOptions: providerOptionsSchema.optional(),
    toolCallId: z.string(),
    toolName: z.string(),
    type: z.literal("tool-call"),
  }),
]);

const assistantMessageSchema = z.object({
  content: z.union([z.string(), z.array(assistantPartSchema)]),
  providerOptions: providerOptionsSchema.optional(),
  role: z.literal("assistant"),
});

const providerStatePayloadSchema = z.object({
  assistantMessage: z.unknown().optional(),
  openAiChatReasoningContent: z.string().optional(),
  version: z.literal(AI_SDK_PROVIDER_STATE_VERSION),
}).strict();

const openAiChatRawChunkSchema = z.object({
  choices: z.array(z.object({
    delta: z.object({
      reasoning_content: z.string().nullable().optional(),
    }).passthrough(),
  }).passthrough()),
}).passthrough();

function matchingProviderState(
  message: ModelMessage,
  input: CompleteTurnInput,
): ModelProviderState | null {
  const state = message.providerState;
  return state?.apiFormat === input.configuration.apiFormat
    && state.baseUrl === input.configuration.baseUrl
    && state.modelId === input.configuration.modelId
    ? state
    : null;
}

function isAiSdkProviderState(state: ModelProviderState): boolean {
  return providerStatePayloadSchema.safeParse(state.payload).success;
}

function hasLegacyProviderState(input: CompleteTurnInput): boolean {
  return input.messages.some((message) => {
    const state = matchingProviderState(message, input);
    return state !== null && !isAiSdkProviderState(state);
  });
}

function readProviderStatePayload(
  message: ModelMessage,
  input: CompleteTurnInput,
): z.infer<typeof providerStatePayloadSchema> | null {
  const state = matchingProviderState(message, input);
  if (state === null) return null;
  const result = providerStatePayloadSchema.safeParse(state.payload);
  return result.success ? result.data : null;
}

function toAiSdkAssistantMessage(value: unknown): AiSdkAssistantModelMessage | null {
  const result = assistantMessageSchema.safeParse(value);
  if (!result.success) return null;

  const content = typeof result.data.content === "string"
    ? result.data.content
    : result.data.content.map((part): TextPart | ReasoningPart | ToolCallPart => {
        const providerOptions = part.providerOptions;
        if (part.type === "text") {
          return {
            text: part.text,
            type: "text",
            ...(providerOptions === undefined ? {} : { providerOptions }),
          };
        }
        if (part.type === "reasoning") {
          return {
            text: part.text,
            type: "reasoning",
            ...(providerOptions === undefined ? {} : { providerOptions }),
          };
        }
        return {
          input: part.input,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          type: "tool-call",
          ...(part.providerExecuted === undefined
            ? {}
            : { providerExecuted: part.providerExecuted }),
          ...(providerOptions === undefined ? {} : { providerOptions }),
        };
      });

  return {
    content,
    role: "assistant",
    ...(result.data.providerOptions === undefined
      ? {}
      : { providerOptions: result.data.providerOptions }),
  };
}

function snapshotProviderOptions(value: ProviderOptions | undefined): ProviderOptions | undefined {
  if (value === undefined) return undefined;
  const result = providerOptionsSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function snapshotAssistantMessage(
  message: AiSdkAssistantModelMessage,
): AiSdkAssistantModelMessage {
  const providerOptions = snapshotProviderOptions(message.providerOptions);
  const content = typeof message.content === "string"
    ? message.content
    : message.content.flatMap((part): Array<TextPart | ReasoningPart | ToolCallPart> => {
        if (part.type === "text" || part.type === "reasoning") {
          const partProviderOptions = snapshotProviderOptions(part.providerOptions);
          return [{
            text: part.text,
            type: part.type,
            ...(partProviderOptions === undefined
              ? {}
              : { providerOptions: partProviderOptions }),
          }];
        }
        if (part.type !== "tool-call") return [];
        const parsedInput = z.json().safeParse(part.input);
        if (!parsedInput.success) return [];
        const partProviderOptions = snapshotProviderOptions(part.providerOptions);
        return [{
          input: parsedInput.data,
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          type: "tool-call",
          ...(part.providerExecuted === undefined
            ? {}
            : { providerExecuted: part.providerExecuted }),
          ...(partProviderOptions === undefined
            ? {}
            : { providerOptions: partProviderOptions }),
        }];
      });

  return {
    content,
    role: "assistant",
    ...(providerOptions === undefined ? {} : { providerOptions }),
  };
}

function userContent(message: ModelMessage): AiSdkModelMessage["content"] {
  if (message.attachments.length === 0) return message.content;
  return [
    ...(message.content.length === 0
      ? []
      : [{ text: message.content, type: "text" as const }]),
    ...message.attachments.flatMap((attachment) => {
      if (attachment.kind === "text") {
        return [{ text: attachment.content, type: "text" as const }];
      }
      if (attachment.data === null) {
        throw new Error(`Image attachment ${attachment.name} was not loaded.`);
      }
      return [
        {
          text: modelImageAttachmentCaption(attachment),
          type: "text" as const,
        },
        {
          data: attachment.data,
          filename: attachment.name,
          mediaType: attachment.mimeType,
          type: "file" as const,
        },
      ];
    }),
  ];
}

function toolNamesByCallId(messages: readonly ModelMessage[]): Map<string, string> {
  const result = new Map<string, string>();
  for (const message of messages) {
    if (message.role !== "assistant") continue;
    for (const call of message.toolCalls) result.set(call.id, call.name);
  }
  return result;
}

function fallbackAssistantMessage(message: ModelMessage): AiSdkAssistantModelMessage {
  if (message.toolCalls.length === 0) {
    return { content: message.content, role: "assistant" };
  }
  return {
    content: [
      ...(message.content.length === 0
        ? []
        : [{ text: message.content, type: "text" as const }]),
      ...message.toolCalls.map((call) => ({
        input: parseToolArguments(call.arguments),
        toolCallId: call.id,
        toolName: call.name,
        type: "tool-call" as const,
      })),
    ],
    role: "assistant",
  };
}

function toAiSdkMessages(input: CompleteTurnInput): AiSdkModelMessage[] {
  const toolNames = toolNamesByCallId(input.messages);
  return input.messages.map((message): AiSdkModelMessage => {
    if (message.role === "system") {
      return { content: message.content, role: "system" };
    }
    if (message.role === "user") {
      return { content: userContent(message), role: "user" };
    }
    if (message.role === "assistant") {
      const payload = readProviderStatePayload(message, input);
      const storedMessage = toAiSdkAssistantMessage(payload?.assistantMessage);
      return storedMessage ?? fallbackAssistantMessage(message);
    }

    const toolCallId = message.toolCallId?.trim() ?? "";
    const toolName = toolNames.get(toolCallId);
    if (toolCallId.length === 0 || toolName === undefined) {
      throw new Error("Tool result does not match a preceding model tool call.");
    }
    return {
      content: [{
        output: { type: "text", value: message.content },
        toolCallId,
        toolName,
        type: "tool-result",
      }],
      role: "tool",
    };
  });
}

function toAiSdkTools(input: CompleteTurnInput): ToolSet {
  return Object.fromEntries(input.tools.map((definition) => [
    definition.name,
    tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.parameters),
    }),
  ]));
}

function reasoningProviderOptions(input: CompleteTurnInput): ProviderOptions | undefined {
  const reasoning = input.reasoning;
  if (reasoning === undefined) return undefined;

  if (input.configuration.apiFormat === "openai-chat-completions") {
    return reasoning.kind === "effort"
      ? { openai: { reasoningEffort: reasoning.value } }
      : undefined;
  }
  if (input.configuration.apiFormat === "openai-responses") {
    return reasoning.kind === "effort" || reasoning.kind === "custom_effort"
      ? {
          openai: {
            reasoningEffort: reasoning.value,
            reasoningSummary: "auto",
          },
        }
      : undefined;
  }
  if (input.configuration.apiFormat === "anthropic-messages") {
    return reasoning.kind === "token_budget"
      ? {
          anthropic: {
            thinking: {
              budgetTokens: reasoning.value,
              type: "enabled",
            },
          },
        }
      : undefined;
  }
  if (reasoning.kind === "token_budget") {
    return {
      google: {
        thinkingConfig: {
          includeThoughts: true,
          thinkingBudget: reasoning.value,
        },
      },
    };
  }
  return reasoning.kind === "effort"
    && isGemini3ReasoningModel(input.configuration.modelId)
    ? {
        google: {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: reasoning.value,
          },
        },
      }
    : undefined;
}

function openAiChatReasoningByAssistant(input: CompleteTurnInput): Array<string | null> {
  return input.messages.flatMap((message) => {
    if (message.role !== "assistant") return [];
    const value = readProviderStatePayload(message, input)?.openAiChatReasoningContent;
    return [value === undefined || value.length === 0 ? null : value];
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function openAiChatCompatibilityFetch(
  input: CompleteTurnInput,
  request: typeof fetch,
): typeof fetch {
  const reasoningByAssistant = openAiChatReasoningByAssistant(input);
  const customEffort = input.reasoning?.kind === "custom_effort"
    ? input.reasoning.value
    : undefined;
  if (reasoningByAssistant.every((value) => value === null) && customEffort === undefined) {
    return request;
  }

  return async (requestInfo, requestInit) => {
    if (typeof requestInit?.body !== "string") {
      return request(requestInfo, requestInit);
    }
    let value: unknown;
    try {
      value = JSON.parse(requestInit.body) as unknown;
    } catch {
      return request(requestInfo, requestInit);
    }
    if (!isRecord(value)) return request(requestInfo, requestInit);
    if (customEffort !== undefined) value.reasoning_effort = customEffort;

    if (Array.isArray(value.messages)) {
      let assistantIndex = 0;
      for (const message of value.messages) {
        if (!isRecord(message) || message.role !== "assistant") continue;
        const reasoningContent = reasoningByAssistant[assistantIndex];
        assistantIndex += 1;
        if (reasoningContent !== null && reasoningContent !== undefined) {
          message.reasoning_content = reasoningContent;
        }
      }
    }
    return request(requestInfo, {
      ...requestInit,
      body: JSON.stringify(value),
    });
  };
}

function providerModel(input: CompleteTurnInput, request: typeof fetch) {
  const { apiKey, apiFormat, baseUrl, modelId } = input.configuration;
  if (apiFormat === "openai-chat-completions") {
    return createOpenAI({
      apiKey,
      baseURL: baseUrl,
      fetch: openAiChatCompatibilityFetch(input, request),
    }).chat(modelId);
  }
  if (apiFormat === "openai-responses") {
    return createOpenAI({ apiKey, baseURL: baseUrl, fetch: request }).responses(modelId);
  }
  if (apiFormat === "anthropic-messages") {
    return createAnthropic({ apiKey, baseURL: baseUrl, fetch: request })(modelId);
  }
  return createGoogleGenerativeAI({ apiKey, baseURL: baseUrl, fetch: request })(modelId);
}

function reasoningKind(input: CompleteTurnInput): "summary" | "content" {
  if (input.configuration.apiFormat === "openai-responses") return "summary";
  return input.configuration.apiFormat === "anthropic-messages"
    && input.configuration.modelId.trim().toLowerCase().startsWith("claude-")
    ? "summary"
    : "content";
}

function toolArguments(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (typeof serialized !== "string") {
    throw new Error("Model returned tool arguments that are not JSON serializable.");
  }
  return serialized;
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

async function mapModelError(error: unknown): Promise<Error> {
  if (!APICallError.isInstance(error) || error.statusCode === undefined) {
    return error instanceof Error ? error : new Error(String(error));
  }
  return createModelRequestError(new Response(error.responseBody ?? "", {
    headers: {
      "content-type": error.responseHeaders?.["content-type"] ?? "text/plain",
    },
    status: error.statusCode,
  }));
}

function providerState(
  input: CompleteTurnInput,
  assistantMessage: AiSdkAssistantModelMessage | undefined,
  openAiChatReasoningContent: string,
): ModelProviderState | undefined {
  if (assistantMessage === undefined && openAiChatReasoningContent.length === 0) {
    return undefined;
  }
  return {
    apiFormat: input.configuration.apiFormat,
    baseUrl: input.configuration.baseUrl,
    modelId: input.configuration.modelId,
    payload: {
      ...(assistantMessage === undefined
        ? {}
        : { assistantMessage: snapshotAssistantMessage(assistantMessage) }),
      ...(openAiChatReasoningContent.length === 0
        ? {}
        : { openAiChatReasoningContent }),
      version: AI_SDK_PROVIDER_STATE_VERSION,
    },
  };
}

/**
 * Uses AI SDK for provider protocol conversion while leaving the Agent loop and tool execution local.
 */
export class AiSdkModelAdapter implements ModelProviderAdapter {
  public constructor(
    private readonly apiFormat: ModelApiFormat,
    private readonly request: typeof fetch = fetch,
    private readonly legacyAdapter?: ModelProviderAdapter,
  ) {}

  public async completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    if (input.configuration.apiFormat !== this.apiFormat) {
      throw new Error(
        `AI SDK adapter for ${this.apiFormat} cannot handle ${input.configuration.apiFormat}.`,
      );
    }
    if (hasLegacyProviderState(input) && this.legacyAdapter !== undefined) {
      return this.legacyAdapter.completeTurn(input);
    }

    let content = "";
    let finishReason: string | null = null;
    let openAiChatReasoningContent = "";
    let hasReasoningDelta = false;
    const toolCalls: ModelToolCall[] = [];

    try {
      const providerOptions = reasoningProviderOptions(input);
      const result = streamText({
        abortSignal: input.signal,
        includeRawChunks: input.configuration.apiFormat === "openai-chat-completions",
        maxOutputTokens: input.maxOutputTokens,
        maxRetries: 0,
        messages: toAiSdkMessages(input),
        model: providerModel(input, this.request),
        tools: toAiSdkTools(input),
        ...(providerOptions === undefined ? {} : { providerOptions }),
      });

      for await (const part of result.stream) {
        if (part.type === "text-delta") {
          content += part.text;
          input.onTextDelta(part.text);
          continue;
        }
        if (part.type === "reasoning-delta") {
          input.onReasoningDelta?.({
            delta: part.text,
            kind: reasoningKind(input),
            reset: !hasReasoningDelta,
          });
          hasReasoningDelta = true;
          continue;
        }
        if (part.type === "raw" && this.apiFormat === "openai-chat-completions") {
          const rawChunk = openAiChatRawChunkSchema.safeParse(part.rawValue);
          if (!rawChunk.success) continue;
          for (const choice of rawChunk.data.choices) {
            const delta = choice.delta.reasoning_content;
            if (delta === undefined || delta === null || delta.length === 0) continue;
            openAiChatReasoningContent += delta;
            input.onReasoningDelta?.({
              delta,
              kind: "content",
              reset: !hasReasoningDelta,
            });
            hasReasoningDelta = true;
          }
          continue;
        }
        if (part.type === "tool-call") {
          toolCalls.push({
            arguments: toolArguments(part.input),
            id: part.toolCallId,
            name: part.toolName,
          });
          continue;
        }
        if (part.type === "finish-step" || part.type === "finish") {
          finishReason = part.rawFinishReason
            ?? (this.apiFormat === "openai-responses" ? "completed" : part.finishReason);
          continue;
        }
        if (part.type === "abort") throw abortError(input.signal);
        if (part.type === "error") throw part.error;
      }

      const responseMessages = await result.responseMessages;
      const assistantMessage = responseMessages.find(
        (message): message is AiSdkAssistantModelMessage => message.role === "assistant",
      );
      const state = providerState(input, assistantMessage, openAiChatReasoningContent);
      return {
        content,
        finishReason,
        ...(state === undefined ? {} : { providerState: state }),
        toolCalls,
      };
    } catch (error) {
      throw await mapModelError(error);
    }
  }
}
