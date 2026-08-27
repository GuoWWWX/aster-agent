import { ChatAnthropic } from "@langchain/anthropic";
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  BaseMessage,
  type ContentBlock,
} from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import {
  isGemini3ReasoningModel,
  type ModelApiFormat,
} from "@agent/protocol";

import type {
  CompleteTurnInput,
  ModelMessage,
  ModelProviderAdapter,
  ModelProviderState,
  ModelToolCall,
  ModelToolDefinition,
  ModelTurnResult,
} from "./model-contracts.js";
import { modelImageAttachmentCaption } from "./model-contracts.js";
import {
  ModelRequestError,
  ModelResponseError,
  summarizeModelErrorText,
} from "./model-request-error.js";
import { parseToolArguments } from "./tool-arguments.js";

const LANGCHAIN_PROVIDER_STATE_VERSION = 2;
const AI_SDK_PROVIDER_STATE_VERSION = 1;
const GEMINI_FUNCTION_CALL_SIGNATURES_KEY = "__gemini_function_call_thought_signatures__";

type LangChainModel = BaseChatModel;
type LangChainAssistantMessage = BaseMessage;

export type LangChainModelFactory = (
  input: CompleteTurnInput,
  request: typeof fetch,
) => LangChainModel;

type JsonRecord = Record<string, unknown>;
type LangChainContent = string | ContentBlock[];

const GEMINI_API_VERSION_SEGMENT = /^v\d+(?:alpha|beta)?$/iu;

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function jsonSnapshot(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) return value.map(jsonSnapshot);
  if (!isRecord(value)) return undefined;
  const result: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    const snapshot = jsonSnapshot(entry);
    if (snapshot !== undefined) result[key] = snapshot;
  }
  return result;
}

function restoreContent(value: unknown): LangChainContent | undefined {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return undefined;
  const blocks: ContentBlock[] = [];
  for (const part of value) {
    if (typeof part === "string") {
      blocks.push({ text: part, type: "text" });
      continue;
    }
    if (!isRecord(part) || typeof part.type !== "string") return undefined;
    blocks.push({ ...part, type: part.type });
  }
  return blocks;
}

function restoreRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function geminiLegacyParts(value: unknown): {
  content: ContentBlock[] | undefined;
  signatures: JsonRecord;
} {
  if (!Array.isArray(value)) return { content: undefined, signatures: {} };
  const signatures: JsonRecord = {};
  const content: ContentBlock[] = [];
  for (const part of value) {
    if (!isRecord(part)) continue;
    if (part.thought === true && typeof part.text === "string") {
      content.push({
        ...part,
        ...(typeof part.thoughtSignature === "string"
          ? { signature: part.thoughtSignature }
          : {}),
        thinking: part.text,
        type: "thinking",
      });
      continue;
    }
    const functionCall = part.functionCall;
    if (isRecord(functionCall)) {
      const id = stringValue(functionCall.id);
      const signature = stringValue(part.thoughtSignature);
      if (id !== null && signature !== null) signatures[id] = signature;
      content.push({ ...part, type: "functionCall" });
      continue;
    }
    if (typeof part.type === "string") content.push({ ...part, type: part.type });
  }
  return { content, signatures };
}

type ProviderReplayFields = {
  additionalKwargs?: JsonRecord;
  content?: LangChainContent;
  responseMetadata?: JsonRecord;
};

function aiSdkProviderOptions(
  part: JsonRecord,
  provider: "anthropic" | "google" | "openai",
): JsonRecord | undefined {
  const providerOptions = restoreRecord(part.providerOptions);
  return providerOptions === undefined ? undefined : restoreRecord(providerOptions[provider]);
}

function aiSdkProviderReplayFields(
  payload: JsonRecord,
  apiFormat: ModelApiFormat,
): ProviderReplayFields {
  if (payload.version !== AI_SDK_PROVIDER_STATE_VERSION) return {};
  const assistantMessage = restoreRecord(payload.assistantMessage);
  if (assistantMessage === undefined || assistantMessage.role !== "assistant") {
    const reasoningContent = stringValue(payload.openAiChatReasoningContent);
    return apiFormat === "openai-chat-completions" && reasoningContent !== null
      ? { additionalKwargs: { reasoning_content: reasoningContent } }
      : {};
  }

  const assistantContent = assistantMessage.content;
  const openAiChatReasoning = stringValue(payload.openAiChatReasoningContent);
  if (typeof assistantContent === "string") {
    return {
      content: assistantContent,
      ...(apiFormat === "openai-chat-completions" && openAiChatReasoning !== null
        ? { additionalKwargs: { reasoning_content: openAiChatReasoning } }
        : {}),
    };
  }
  if (!Array.isArray(assistantContent)) return {};

  const content: ContentBlock[] = [];
  const geminiSignatures: JsonRecord = {};
  const responsesReasoning: Array<{ options: JsonRecord | undefined; text: string }> = [];
  for (const value of assistantContent) {
    if (!isRecord(value)) continue;
    const type = stringValue(value.type);
    if (type === "text" && typeof value.text === "string") {
      content.push({ text: value.text, type: "text" });
      continue;
    }
    if (type === "reasoning" && typeof value.text === "string") {
      if (apiFormat === "anthropic-messages") {
        const options = aiSdkProviderOptions(value, "anthropic");
        content.push({
          ...(typeof options?.signature === "string" ? { signature: options.signature } : {}),
          thinking: value.text,
          type: "thinking",
        });
      } else if (apiFormat === "google-gemini") {
        const options = aiSdkProviderOptions(value, "google");
        content.push({
          ...(typeof options?.thoughtSignature === "string"
            ? { signature: options.thoughtSignature }
            : {}),
          thinking: value.text,
          type: "thinking",
        });
      } else if (apiFormat === "openai-responses") {
        const options = aiSdkProviderOptions(value, "openai");
        responsesReasoning.push({ options, text: value.text });
        content.push({
          ...(typeof options?.itemId === "string" ? { id: options.itemId } : {}),
          reasoning: value.text,
          type: "reasoning",
        });
      }
      continue;
    }
    if (type === "tool-call" && apiFormat === "google-gemini") {
      const toolCallId = stringValue(value.toolCallId);
      const signature = stringValue(aiSdkProviderOptions(value, "google")?.thoughtSignature);
      if (toolCallId !== null && signature !== null) geminiSignatures[toolCallId] = signature;
    }
  }

  const additionalKwargs: JsonRecord = {};
  if (apiFormat === "openai-chat-completions" && openAiChatReasoning !== null) {
    additionalKwargs.reasoning_content = openAiChatReasoning;
  }
  if (apiFormat === "google-gemini" && Object.keys(geminiSignatures).length > 0) {
    additionalKwargs[GEMINI_FUNCTION_CALL_SIGNATURES_KEY] = geminiSignatures;
  }
  const firstReasoning = responsesReasoning[0];
  if (apiFormat === "openai-responses" && firstReasoning !== undefined) {
    additionalKwargs.reasoning = {
      ...(typeof firstReasoning.options?.itemId === "string"
        ? { id: firstReasoning.options.itemId }
        : {}),
      ...(typeof firstReasoning.options?.reasoningEncryptedContent === "string"
        ? { encrypted_content: firstReasoning.options.reasoningEncryptedContent }
        : {}),
      summary: responsesReasoning.map(({ text }) => ({ text, type: "summary_text" })),
      type: "reasoning",
    };
  }

  return {
    ...(Object.keys(additionalKwargs).length === 0 ? {} : { additionalKwargs }),
    ...(content.length === 0 ? {} : { content }),
  };
}

function providerReplayFields(
  state: ModelProviderState | null,
  apiFormat: ModelApiFormat,
): ProviderReplayFields {
  if (state === null || !isRecord(state.payload)) return {};
  const payload = state.payload;
  let content = restoreContent(payload.content);
  let additionalKwargs = restoreRecord(payload.additionalKwargs);
  let responseMetadata = restoreRecord(payload.responseMetadata);

  const aiSdkReplay = aiSdkProviderReplayFields(payload, apiFormat);
  content ??= aiSdkReplay.content;
  additionalKwargs ??= aiSdkReplay.additionalKwargs;
  responseMetadata ??= aiSdkReplay.responseMetadata;

  if (apiFormat === "openai-responses" && content === undefined && Array.isArray(payload.outputItems)) {
    responseMetadata = {
      ...responseMetadata,
      model_provider: "openai",
      output: payload.outputItems,
    };
  }
  if (apiFormat === "anthropic-messages" && content === undefined) {
    content = restoreContent(payload.contentBlocks);
    if (content !== undefined) {
      responseMetadata = { ...responseMetadata, model_provider: "anthropic" };
    }
  }
  if (apiFormat === "google-gemini" && content === undefined) {
    const legacy = geminiLegacyParts(payload.parts);
    content = legacy.content;
    if (Object.keys(legacy.signatures).length > 0) {
      additionalKwargs = {
        ...additionalKwargs,
        [GEMINI_FUNCTION_CALL_SIGNATURES_KEY]: legacy.signatures,
      };
    }
  }

  return {
    ...(additionalKwargs === undefined ? {} : { additionalKwargs }),
    ...(content === undefined ? {} : { content }),
    ...(responseMetadata === undefined ? {} : { responseMetadata }),
  };
}

function textFromContent(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return value.flatMap((part) => {
    if (typeof part === "string") return [part];
    if (!isRecord(part)) return [];
    const type = stringValue(part.type);
    if (type === "text" || type === "output_text") {
      const text = stringValue(part.text) ?? stringValue(part.value);
      return text === null ? [] : [text];
    }
    return [];
  }).join("");
}

function reasoningFromContent(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((part) => {
    if (!isRecord(part)) return [];
    const type = stringValue(part.type);
    if (type === "reasoning") {
      const reasoning = stringValue(part.reasoning) ?? stringValue(part.text);
      return reasoning === null || reasoning.length === 0 ? [] : [reasoning];
    }
    if (type === "thinking") {
      const thinking = stringValue(part.thinking) ?? stringValue(part.text);
      return thinking === null || thinking.length === 0 ? [] : [thinking];
    }
    return [];
  });
}

function reasoningFromMessage(message: BaseMessage): string[] {
  const contentReasoning = reasoningFromContent(message.content);
  if (contentReasoning.length > 0) return contentReasoning;
  if (!isRecord(message.additional_kwargs)) return [];
  const reasoning = stringValue(message.additional_kwargs.reasoning_content)
    ?? stringValue(message.additional_kwargs.reasoning);
  return reasoning === null || reasoning.length === 0 ? [] : [reasoning];
}

type HumanContent = string | Array<ContentBlock.Standard>;

function attachmentContent(message: ModelMessage): HumanContent {
  if (message.attachments.length === 0) return message.content;
  const parts: Array<ContentBlock.Text | ContentBlock.Multimodal.Image> = [];
  if (message.content.length > 0) parts.push({ text: message.content, type: "text" });
  for (const attachment of message.attachments) {
    if (attachment.kind === "text") {
      parts.push({ text: attachment.content, type: "text" });
      continue;
    }
    if (attachment.data === null) {
      throw new Error(`Image attachment ${attachment.name} was not loaded.`);
    }
    parts.push({ text: modelImageAttachmentCaption(attachment), type: "text" });
    parts.push({ data: attachment.data, mimeType: attachment.mimeType, type: "image" });
  }
  return parts;
}

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

function toLangChainMessage(
  message: ModelMessage,
  input: CompleteTurnInput,
): BaseMessage {
  if (message.role === "system") return new SystemMessage(message.content);
  if (message.role === "user") {
    const content = attachmentContent(message);
    return typeof content === "string"
      ? new HumanMessage(content)
      : new HumanMessage({ contentBlocks: content });
  }
  if (message.role === "tool") {
    const toolCallId = message.toolCallId?.trim();
    if (toolCallId === undefined || toolCallId.length === 0) {
      throw new Error("Tool result does not match a preceding model tool call.");
    }
    return new ToolMessage({
      content: message.content,
      tool_call_id: toolCallId,
    });
  }

  const providerState = matchingProviderState(message, input);
  const replay = providerReplayFields(providerState, input.configuration.apiFormat);
  return new AIMessage({
    content: replay.content ?? message.content,
    ...(replay.additionalKwargs === undefined
      ? {}
      : { additional_kwargs: replay.additionalKwargs }),
    ...(replay.responseMetadata === undefined
      ? {}
      : { response_metadata: replay.responseMetadata }),
    ...(message.toolCalls.length === 0
      ? {}
      : {
          tool_calls: message.toolCalls.map((call) => ({
            args: parseToolArguments(call.arguments),
            id: call.id,
            name: call.name,
          })),
        }),
  });
}

function toLangChainMessages(
  messages: readonly ModelMessage[],
  input: CompleteTurnInput,
): BaseMessage[] {
  return messages.map((message) => toLangChainMessage(message, input));
}

function openAiChatReasoningByAssistant(input: CompleteTurnInput): Array<string | null> {
  return input.messages.flatMap((message) => {
    if (message.role !== "assistant") return [];
    const replay = providerReplayFields(
      matchingProviderState(message, input),
      "openai-chat-completions",
    );
    const reasoning = replay.additionalKwargs === undefined
      ? null
      : stringValue(replay.additionalKwargs.reasoning_content);
    return [reasoning === null || reasoning.length === 0 ? null : reasoning];
  });
}

function openAiChatCompatibilityFetch(
  input: CompleteTurnInput,
  request: typeof fetch,
): typeof fetch {
  const reasoningByAssistant = openAiChatReasoningByAssistant(input);
  if (reasoningByAssistant.every((reasoning) => reasoning === null)) return request;

  return async (requestInfo, requestInit) => {
    if (typeof requestInit?.body !== "string") return request(requestInfo, requestInit);
    let body: unknown;
    try {
      body = JSON.parse(requestInit.body) as unknown;
    } catch {
      return request(requestInfo, requestInit);
    }
    if (!isRecord(body) || !Array.isArray(body.messages)) {
      return request(requestInfo, requestInit);
    }

    let assistantIndex = 0;
    for (const message of body.messages) {
      if (!isRecord(message) || message.role !== "assistant") continue;
      const reasoning = reasoningByAssistant[assistantIndex];
      assistantIndex += 1;
      if (reasoning !== null && reasoning !== undefined) {
        message.reasoning_content = reasoning;
      }
    }
    return request(requestInfo, {
      ...requestInit,
      body: JSON.stringify(body),
    });
  };
}

function normalizeResponsesPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeResponsesPayload);
  if (!isRecord(value)) return value;

  const normalized: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    normalized[key] = normalizeResponsesPayload(entry);
  }
  if (normalized.type === "output_text" && !Array.isArray(normalized.annotations)) {
    normalized.annotations = [];
  }
  return normalized;
}

// OpenAI-compatible Responses gateways may omit the optional annotations array;
// LangChain's Responses converter currently assumes it is always present.
function normalizeResponsesSseLine(line: string): string {
  const match = /^(\s*data:\s*)(.*?)(\r?)$/u.exec(line);
  if (match === null || match[2] === "[DONE]" || !match[2]?.trim().startsWith("{")) {
    return line;
  }
  try {
    const payload = JSON.parse(match[2]) as unknown;
    return `${match[1]}${JSON.stringify(normalizeResponsesPayload(payload))}${match[3]}`;
  } catch {
    return line;
  }
}

function openAiResponsesCompatibilityFetch(request: typeof fetch): typeof fetch {
  return async (requestInfo, requestInit) => {
    const response = await request(requestInfo, requestInit);
    if (response.body === null) return response;

    const decoder = new TextDecoder();
    const encoder = new TextEncoder();
    let pending = "";
    const normalizePendingLines = (
      controller: TransformStreamDefaultController<Uint8Array>,
      flush: boolean,
    ): void => {
      if (flush) pending += decoder.decode();
      const lines = pending.split("\n");
      if (!flush) pending = lines.pop() ?? "";
      else pending = "";
      if (lines.length === 0) return;
      const serialized = lines.map(normalizeResponsesSseLine).join("\n");
      controller.enqueue(encoder.encode(`${serialized}${flush ? "" : "\n"}`));
    };
    const body = response.body.pipeThrough(new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        pending += decoder.decode(chunk, { stream: true });
        normalizePendingLines(controller, false);
      },
      flush(controller) {
        normalizePendingLines(controller, true);
      },
    }));
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.delete("content-encoding");
    return new Response(body, {
      headers,
      status: response.status,
      statusText: response.statusText,
    });
  };
}

export function toolDefinitions(
  tools: readonly ModelToolDefinition[],
): Array<Record<string, unknown>> {
  return tools.map((definition) => ({
    type: "function",
    function: {
      description: definition.description,
      name: definition.name,
      parameters: definition.parameters,
    },
  }));
}

function bindModelTools(model: LangChainModel, input: CompleteTurnInput) {
  const definitions = toolDefinitions(input.tools);
  if (model.bindTools === undefined) return model;
  if (
    input.configuration.apiFormat === "openai-chat-completions"
    || input.configuration.apiFormat === "openai-responses"
  ) {
    // OpenAI-compatible providers otherwise may choose the single-call mode;
    // keep the provider contract aligned with the Runtime's bounded batch.
    return model.bindTools(definitions, { parallel_tool_calls: true } as never);
  }
  return model.bindTools(definitions);
}

function reasoningOptions(input: CompleteTurnInput): Record<string, unknown> {
  const reasoning = input.reasoning;
  if (reasoning === undefined) return {};
  if (input.configuration.apiFormat === "openai-chat-completions") {
    return reasoning.kind === "effort" || reasoning.kind === "custom_effort"
      ? {
          modelKwargs: { reasoning_effort: reasoning.value },
          reasoningEffort: reasoning.value,
        }
      : {};
  }
  if (input.configuration.apiFormat === "openai-responses") {
    return reasoning.kind === "effort" || reasoning.kind === "custom_effort"
      ? {
          modelKwargs: { reasoning: { effort: reasoning.value, summary: "auto" } },
          reasoning: { effort: reasoning.value, summary: "auto" },
          reasoningEffort: reasoning.value,
        }
      : {};
  }
  if (input.configuration.apiFormat === "anthropic-messages") {
    return reasoning.kind === "token_budget"
      ? { thinking: { budget_tokens: reasoning.value, type: "enabled" } }
      : {};
  }
  if (isGemini3ReasoningModel(input.configuration.modelId)) {
    return reasoning.kind === "effort"
      ? {
          thinkingConfig: {
            includeThoughts: true,
            thinkingLevel: reasoning.value.toUpperCase(),
          },
        }
      : {};
  }
  return reasoning.kind === "token_budget"
    ? { thinkingConfig: { includeThoughts: true, thinkingBudget: reasoning.value } }
    : {};
}

function geminiRequestOptions(baseUrl: string): {
  apiVersion?: string;
  baseUrl: string;
} {
  const parsed = new URL(baseUrl);
  const segments = parsed.pathname.split("/").filter((segment) => segment.length > 0);
  const version = segments.at(-1);
  if (version === undefined || !GEMINI_API_VERSION_SEGMENT.test(version)) {
    return { baseUrl: parsed.toString().replace(/\/$/u, "") };
  }

  segments.pop();
  parsed.pathname = segments.length === 0 ? "/" : `/${segments.join("/")}`;
  parsed.search = "";
  parsed.hash = "";
  return {
    apiVersion: version.toLowerCase(),
    baseUrl: parsed.toString().replace(/\/$/u, ""),
  };
}

function anthropicSdkBaseUrl(baseUrl: string): string {
  const parsed = new URL(baseUrl);
  const pathname = parsed.pathname.replace(/\/+$/u, "");
  parsed.pathname = /\/v1$/iu.test(pathname)
    ? pathname.slice(0, -3) || "/"
    : pathname || "/";
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/$/u, "");
}

function defaultFactory(input: CompleteTurnInput, request: typeof fetch): LangChainModel {
  const { apiFormat, apiKey, baseUrl, modelId } = input.configuration;
  const common = {
    maxRetries: 0,
    streaming: true,
    ...reasoningOptions(input),
  };
  if (apiFormat === "openai-chat-completions") {
    return new ChatOpenAI({
      ...common,
      apiKey,
      configuration: { baseURL: baseUrl, fetch: openAiChatCompatibilityFetch(input, request) },
      model: modelId,
      maxTokens: input.maxOutputTokens,
      useResponsesApi: false,
    });
  }
  if (apiFormat === "openai-responses") {
    return new ChatOpenAI({
      ...common,
      apiKey,
      configuration: { baseURL: baseUrl, fetch: openAiResponsesCompatibilityFetch(request) },
      model: modelId,
      maxTokens: input.maxOutputTokens,
      useResponsesApi: true,
    });
  }
  if (apiFormat === "anthropic-messages") {
    return new ChatAnthropic({
      ...common,
      anthropicApiKey: apiKey,
      anthropicApiUrl: anthropicSdkBaseUrl(baseUrl),
      clientOptions: { fetch: request },
      maxTokens: input.maxOutputTokens,
      model: modelId,
    });
  }
  const gemini = geminiRequestOptions(baseUrl);
  return new ChatGoogleGenerativeAI({
    ...common,
    apiKey,
    baseUrl: gemini.baseUrl,
    ...(gemini.apiVersion === undefined ? {} : { apiVersion: gemini.apiVersion }),
    maxOutputTokens: input.maxOutputTokens,
    model: modelId,
  });
}

function toolCallArguments(value: unknown): string {
  const normalized = typeof value === "string"
    ? parseToolArguments(value)
    : value;
  if (!isRecord(normalized)) {
    throw new ModelResponseError("Model returned tool arguments that are not a JSON object.");
  }
  const serialized = JSON.stringify(normalized);
  if (typeof serialized !== "string") {
    throw new ModelResponseError("Model returned tool arguments that are not JSON serializable.");
  }
  return serialized;
}

function readFinishReason(message: LangChainAssistantMessage): string | null {
  const metadata = message.response_metadata;
  if (!isRecord(metadata)) return null;
  return stringValue(metadata.finish_reason)
    ?? stringValue(metadata.stop_reason)
    ?? stringValue(metadata.status);
}

function providerState(
  input: CompleteTurnInput,
  message: LangChainAssistantMessage,
): ModelProviderState | undefined {
  const additionalKwargs = jsonSnapshot(message.additional_kwargs);
  const content = jsonSnapshot(message.content);
  const responseMetadata = jsonSnapshot(message.response_metadata);
  if (content === undefined && additionalKwargs === undefined && responseMetadata === undefined) {
    return undefined;
  }
  return {
    apiFormat: input.configuration.apiFormat,
    baseUrl: input.configuration.baseUrl,
    modelId: input.configuration.modelId,
    payload: {
      additionalKwargs,
      content,
      responseMetadata,
      version: LANGCHAIN_PROVIDER_STATE_VERSION,
    },
  };
}

function mergeMessageChunks(
  current: BaseMessage,
  next: BaseMessage,
): BaseMessage {
  const concat = isRecord(current) ? current.concat : undefined;
  if (typeof concat === "function") {
    const merged: unknown = Reflect.apply(concat, current, [next]);
    if (BaseMessage.isInstance(merged)) return merged;
  }
  return next;
}

function assistantToolCalls(message: BaseMessage): unknown[] {
  const calls = isRecord(message) ? message.tool_calls : undefined;
  return Array.isArray(calls) ? calls : [];
}

function normalizeToolCall(value: unknown): ModelToolCall {
  if (!isRecord(value)) throw new ModelResponseError("Model returned an invalid tool call.");
  const name = stringValue(value.name)?.trim() ?? "";
  if (name.length === 0) {
    throw new ModelResponseError("Model returned a tool call without a name.");
  }
  const id = stringValue(value.id)?.trim() ?? crypto.randomUUID();
  return {
    arguments: toolCallArguments(value.args),
    id: id.length > 0 ? id : crypto.randomUUID(),
    name,
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

function providerErrorStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  const status = error.status ?? error.statusCode;
  if (typeof status === "number" && Number.isInteger(status) && status >= 100 && status <= 599) {
    return status;
  }
  const response = error.response;
  if (isRecord(response) && typeof response.status === "number") return response.status;
  return null;
}

function providerErrorMessage(error: unknown, status: number): string {
  const message = (error instanceof Error ? error.message : String(error))
    .replace(/\s*Troubleshooting URL:\s*https?:\/\/\S+\s*$/iu, "")
    .replace(new RegExp(`^${status}\\s+`, "u"), "");
  return summarizeModelErrorText(message);
}

export class LangChainModelAdapter implements ModelProviderAdapter {
  public constructor(
    private readonly apiFormat: ModelApiFormat,
    private readonly request: typeof fetch = fetch,
    private readonly factory: LangChainModelFactory = defaultFactory,
  ) {}

  public async completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    if (input.configuration.apiFormat !== this.apiFormat) {
      throw new Error(
        `LangChain adapter for ${this.apiFormat} cannot handle ${input.configuration.apiFormat}.`,
      );
    }

    const model = this.factory(input, this.request);
    const boundModel = input.tools.length === 0 || model.bindTools === undefined
      ? model
      : bindModelTools(model, input);
    const messages = toLangChainMessages(input.messages, input);
    let content = "";
    let latest: LangChainAssistantMessage | null = null;
    let reasoningStarted = false;
    try {
      const stream = await boundModel.stream(messages, {
        maxRetries: 0,
        signal: input.signal,
      });
      for await (const chunk of stream) {
        if (input.signal.aborted) throw input.signal.reason;
        const text = textFromContent(chunk.content);
        if (text.length > 0) {
          content += text;
          input.onTextDelta(text);
        }
        for (const reasoning of reasoningFromMessage(chunk)) {
          input.onReasoningDelta?.({
            delta: reasoning,
            kind: this.apiFormat === "openai-responses" || this.apiFormat === "anthropic-messages"
              ? "summary"
              : "content",
            reset: !reasoningStarted,
          });
          reasoningStarted = true;
        }
        if (BaseMessage.isInstance(chunk)) {
          latest = latest === null ? chunk : mergeMessageChunks(latest, chunk);
        }
      }
      if (latest === null) {
        throw new ModelResponseError("LangChain model returned no response chunks.");
      }
      const toolCalls = assistantToolCalls(latest).map(normalizeToolCall);
      const savedProviderState = providerState(input, latest);
      return {
        content,
        finishReason: readFinishReason(latest),
        ...(savedProviderState === undefined
          ? {}
          : { providerState: savedProviderState }),
        toolCalls,
      };
    } catch (error) {
      if (input.signal.aborted || isAbortError(error)) throw error;
      const status = providerErrorStatus(error);
      if (status !== null) {
        throw new ModelRequestError(
          status,
          `Model request failed (${status}): ${providerErrorMessage(error, status)}`,
        );
      }
      throw error;
    }
  }
}
