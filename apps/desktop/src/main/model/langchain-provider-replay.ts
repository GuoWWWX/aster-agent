import type { ContentBlock } from "@langchain/core/messages";
import type { ModelApiFormat } from "@agent/protocol";
import type { CompleteTurnInput, ModelMessage, ModelProviderState } from "./model-contracts.js";
import { compactProviderReplayState } from "./provider-replay-state.js";

const AI_SDK_PROVIDER_STATE_VERSION = 1;
const GEMINI_FUNCTION_CALL_SIGNATURES_KEY = "__gemini_function_call_thought_signatures__";
type JsonRecord = Record<string, unknown>;
type LangChainContent = string | ContentBlock[];

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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

export function providerReplayFields(
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

export function matchingProviderState(
  message: ModelMessage,
  input: CompleteTurnInput,
): ModelProviderState | null {
  const state = message.providerState;
  return state?.apiFormat === input.configuration.apiFormat
    && state.baseUrl === input.configuration.baseUrl
    && state.modelId === input.configuration.modelId
    ? compactProviderReplayState(state)
    : null;
}

export function openAiChatReasoningByAssistant(input: CompleteTurnInput): Array<string | null> {
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
