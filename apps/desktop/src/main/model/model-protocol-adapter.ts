import { randomUUID } from "node:crypto";

import { isGemini3ReasoningModel } from "@agent/protocol";

import {
  type CompleteTurnInput,
  type ModelMessage,
  type ModelProviderAdapter,
  type ModelToolDefinition,
  type ModelTurnResult,
  modelImageAttachmentCaption,
  OpenAiCompatibleAdapter
} from "./openai-compatible-adapter.js";
import { createModelRequestError } from "./model-request-error.js";
import { parseToolArguments } from "./tool-arguments.js";
import { readSseDataStream } from "./sse-data-stream.js";
import type { ModelToolCall } from "../storage/agent-database.js";

type PendingToolCall = {
  arguments: string;
  id: string;
  name: string;
};

function endpoint(baseUrl: string, pathname: string): string {
  return new URL(pathname, `${baseUrl.replace(/\/$/, "")}/`).toString();
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readStringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readIdentifier(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const identifier = value.trim();
  return identifier.length > 0 ? identifier : null;
}

function readResponseOutputText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(readResponseOutputText).join("");
  if (value === null || typeof value !== "object") return "";

  const record = value as {
    content?: unknown;
    output?: unknown;
    text?: unknown;
    type?: unknown;
    value?: unknown;
  };
  const type = readIdentifier(record.type);
  if (type === "output_text" || type === "text") {
    return readStringValue(record.text) ?? readStringValue(record.value) ?? "";
  }
  if (type === "message" || record.content !== undefined) {
    return readResponseOutputText(record.content);
  }
  return readResponseOutputText(record.output);
}

function toFunctionTools(tools: readonly ModelToolDefinition[]): Record<string, unknown>[] {
  return tools.map((tool) => ({
    description: tool.description,
    name: tool.name,
    parameters: tool.parameters,
    type: "function"
  }));
}

function matchingProviderPayload(
  message: ModelMessage,
  input: CompleteTurnInput,
  apiFormat: CompleteTurnInput["configuration"]["apiFormat"]
): unknown {
  const state = message.providerState;
  return state?.apiFormat === apiFormat
    && state.baseUrl === input.configuration.baseUrl
    && state.modelId === input.configuration.modelId
    ? state.payload
    : null;
}

function responsesInput(
  messages: readonly ModelMessage[],
  input: CompleteTurnInput
): Record<string, unknown>[] {
  return messages.flatMap((message) => {
    if (message.role === "tool") {
      return [{
        call_id: message.toolCallId,
        output: message.content,
        type: "function_call_output"
      }];
    }
    if (message.role === "assistant") {
      const payload = matchingProviderPayload(message, input, "openai-responses");
      if (payload !== null && typeof payload === "object") {
        const outputItems = (payload as { outputItems?: unknown }).outputItems;
        if (Array.isArray(outputItems)) {
          return outputItems.filter(
            (item): item is Record<string, unknown> => item !== null && typeof item === "object"
          );
        }
      }
    }
    const responseContent = message.role === "user" && message.attachments.length > 0
      ? [
          ...(message.content.length === 0
            ? []
            : [{ text: message.content, type: "input_text" }]),
          ...message.attachments.flatMap((attachment) => {
            if (attachment.kind === "text") {
              return [{ text: attachment.content, type: "input_text" }];
            }
            if (attachment.data === null) {
              throw new Error(`Image attachment ${attachment.name} was not loaded.`);
            }
            return [
              { text: modelImageAttachmentCaption(attachment), type: "input_text" },
              {
                image_url: `data:${attachment.mimeType};base64,${attachment.data}`,
                type: "input_image"
              }
            ];
          })
        ]
      : message.content;
    const serialized: Record<string, unknown>[] = [{
      content: responseContent,
      role: message.role
    }];
    if (message.role === "assistant") {
      serialized.push(
        ...message.toolCalls.map((call) => ({
          arguments: call.arguments,
          call_id: call.id,
          name: call.name,
          type: "function_call"
        }))
      );
    }
    return serialized;
  });
}

function anthropicRequest(input: CompleteTurnInput): Record<string, unknown> {
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  type AnthropicContent = Record<string, unknown>[] | string;
  const messages: Array<{ content: AnthropicContent; role: "assistant" | "user" }> = [];

  function append(role: "assistant" | "user", content: AnthropicContent): void {
    const previous = messages.at(-1);
    if (previous !== undefined && previous.role === role && Array.isArray(previous.content)) {
      previous.content.push(...(Array.isArray(content) ? content : [{ text: content, type: "text" }]));
      return;
    }
    messages.push({ content, role });
  }

  for (const message of input.messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      append("user", [{
        content: message.content,
        tool_use_id: message.toolCallId,
        type: "tool_result"
      }]);
      continue;
    }
    if (message.role === "assistant") {
      const payload = matchingProviderPayload(message, input, "anthropic-messages");
      if (payload !== null && typeof payload === "object") {
        const contentBlocks = (payload as { contentBlocks?: unknown }).contentBlocks;
        if (Array.isArray(contentBlocks)) {
          append(
            "assistant",
            contentBlocks.filter(
              (block): block is Record<string, unknown> => block !== null && typeof block === "object"
            )
          );
          continue;
        }
      }
    }
    if (message.role === "assistant" && message.toolCalls.length > 0) {
      const content: Array<Record<string, unknown>> = [];
      if (message.content.length > 0) content.push({ text: message.content, type: "text" });
      content.push(...message.toolCalls.map((call) => ({
        id: call.id,
        input: parseToolArguments(call.arguments),
        name: call.name,
        type: "tool_use"
      })));
      append("assistant", content);
      continue;
    }
    if (message.role === "user" && message.attachments.length > 0) {
      const content: Array<Record<string, unknown>> = [];
      if (message.content.length > 0) content.push({ text: message.content, type: "text" });
      for (const attachment of message.attachments) {
        if (attachment.kind === "text") {
          content.push({ text: attachment.content, type: "text" });
          continue;
        }
        if (attachment.data === null) {
          throw new Error(`Image attachment ${attachment.name} was not loaded.`);
        }
        content.push({ text: modelImageAttachmentCaption(attachment), type: "text" });
        content.push({
          source: {
            data: attachment.data,
            media_type: attachment.mimeType,
            type: "base64"
          },
          type: "image"
        });
      }
      append("user", content);
      continue;
    }
    append(message.role === "assistant" ? "assistant" : "user", message.content);
  }

  const body: Record<string, unknown> = {
    max_tokens: input.maxOutputTokens,
    messages,
    model: input.configuration.modelId,
    stream: true
  };
  if (system.length > 0) body.system = system;
  if (input.reasoning?.kind === "token_budget") {
    body.thinking = {
      budget_tokens: input.reasoning.value,
      ...(input.configuration.modelId.trim().toLowerCase().startsWith("claude-")
        ? { display: "summarized" }
        : {}),
      type: "enabled"
    };
  }
  if (input.tools.length > 0) {
    body.tools = input.tools.map((tool) => ({
      description: tool.description,
      input_schema: tool.parameters,
      name: tool.name
    }));
  }
  return body;
}

function geminiRequest(input: CompleteTurnInput): Record<string, unknown> {
  const system = input.messages
    .filter((message) => message.role === "system")
    .map((message) => message.content)
    .join("\n\n");
  const contents: Array<{ parts: Record<string, unknown>[]; role: string }> = [];
  const toolNames = new Map<string, string>();
  const providerToolCallIds = new Set<string>();

  function append(role: string, parts: Record<string, unknown>[]): void {
    const previous = contents.at(-1);
    if (previous !== undefined && previous.role === role) {
      previous.parts.push(...parts);
      return;
    }
    contents.push({ parts, role });
  }

  for (const message of input.messages) {
    if (message.role === "system") continue;
    if (message.role === "tool") {
      const toolCallId = message.toolCallId ?? "";
      append("user", [{
        functionResponse: {
          ...(providerToolCallIds.has(toolCallId) ? { id: toolCallId } : {}),
          name: toolNames.get(toolCallId) ?? "tool",
          response: { content: message.content }
        }
      }]);
      continue;
    }
    if (message.role === "assistant") {
      for (const call of message.toolCalls) toolNames.set(call.id, call.name);
      const payload = matchingProviderPayload(message, input, "google-gemini");
      if (payload !== null && typeof payload === "object") {
        const storedParts = (payload as { parts?: unknown }).parts;
        if (Array.isArray(storedParts)) {
          const parts = storedParts.filter(
            (part): part is Record<string, unknown> => part !== null && typeof part === "object"
          );
          for (const part of parts) {
            const functionCall = part.functionCall;
            if (functionCall === null || typeof functionCall !== "object") continue;
            const id = readString((functionCall as { id?: unknown }).id);
            const name = readString((functionCall as { name?: unknown }).name);
            if (id !== null) providerToolCallIds.add(id);
            if (id !== null && name !== null) toolNames.set(id, name);
          }
          append("model", parts);
          continue;
        }
      }
      const parts: Record<string, unknown>[] = [];
      if (message.content.length > 0) parts.push({ text: message.content });
      for (const call of message.toolCalls) {
        parts.push({ functionCall: { args: parseToolArguments(call.arguments), name: call.name } });
      }
      append("model", parts);
      continue;
    }
    const parts: Record<string, unknown>[] = [];
    if (message.content.length > 0) parts.push({ text: message.content });
    for (const attachment of message.attachments) {
      if (attachment.kind === "text") {
        parts.push({ text: attachment.content });
        continue;
      }
      if (attachment.data === null) {
        throw new Error(`Image attachment ${attachment.name} was not loaded.`);
      }
      parts.push({ text: modelImageAttachmentCaption(attachment) });
      parts.push({
        inlineData: {
          data: attachment.data,
          mimeType: attachment.mimeType
        }
      });
    }
    append("user", parts);
  }

  const generationConfig: Record<string, unknown> = {
    maxOutputTokens: input.maxOutputTokens
  };
  if (input.reasoning?.kind === "token_budget") {
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingBudget: input.reasoning.value
    };
  } else if (
    input.reasoning?.kind === "effort"
    && isGemini3ReasoningModel(input.configuration.modelId)
  ) {
    generationConfig.thinkingConfig = {
      includeThoughts: true,
      thinkingLevel: input.reasoning.value
    };
  }
  const body: Record<string, unknown> = {
    contents,
    generationConfig
  };
  if (system.length > 0) body.systemInstruction = { parts: [{ text: system }] };
  if (input.tools.length > 0) {
    body.tools = [{ functionDeclarations: input.tools.map((tool) => ({
      description: tool.description,
      name: tool.name,
      parameters: tool.parameters
    })) }];
  }
  return body;
}

export class ModelProtocolAdapter implements ModelProviderAdapter {
  private readonly openAiChat: OpenAiCompatibleAdapter;

  public constructor(private readonly request: typeof fetch = fetch) {
    this.openAiChat = new OpenAiCompatibleAdapter(request);
  }

  public async completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    switch (input.configuration.apiFormat) {
      case "openai-chat-completions":
        return this.openAiChat.completeTurn(input);
      case "openai-responses":
        return this.completeOpenAiResponses(input);
      case "anthropic-messages":
        return this.completeAnthropic(input);
      case "google-gemini":
        return this.completeGemini(input);
    }
  }

  private async completeOpenAiResponses(input: CompleteTurnInput): Promise<ModelTurnResult> {
    const body: Record<string, unknown> = {
      input: responsesInput(input.messages, input),
      max_output_tokens: input.maxOutputTokens,
      model: input.configuration.modelId,
      stream: true
    };
    if (input.reasoning?.kind === "effort" || input.reasoning?.kind === "custom_effort") {
      body.reasoning = { effort: input.reasoning.value, summary: "auto" };
    }
    if (input.tools.length > 0) body.tools = toFunctionTools(input.tools);
    const response = await this.request(endpoint(input.configuration.baseUrl, "responses"), {
      body: JSON.stringify(body),
      headers: {
        Authorization: `Bearer ${input.configuration.apiKey}`,
        "Content-Type": "application/json"
      },
      method: "POST",
      signal: input.signal
    });
    if (!response.ok) {
      throw await createModelRequestError(response);
    }
    if (response.body === null) throw new Error("Model response did not contain a stream body.");

    let content = "";
    let finishReason: string | null = null;
    let receivedTextDelta = false;
    let activeReasoningSegment: string | null = null;
    const outputItems: Record<string, unknown>[] = [];
    const toolCalls = new Map<string, PendingToolCall>();

    const appendFinalText = (text: string): void => {
      if (receivedTextDelta || text.length === 0) return;
      content += text;
      input.onTextDelta(text);
    };

    const mergeToolCalls = (
      target: PendingToolCall,
      source: PendingToolCall
    ): PendingToolCall => {
      if (target === source) return target;
      if (target.id.length === 0) target.id = source.id;
      if (target.name.length === 0) target.name = source.name;
      if (target.arguments.length === 0) target.arguments = source.arguments;
      for (const [key, call] of toolCalls) {
        if (call === source) toolCalls.set(key, target);
      }
      return target;
    };

    const getToolCall = (
      itemId: string | null,
      callId: string | null
    ): PendingToolCall | null => {
      if (itemId === null && callId === null) return null;
      const byItemId = itemId === null ? undefined : toolCalls.get(itemId);
      const byCallId = callId === null ? undefined : toolCalls.get(callId);
      const call =
        byItemId !== undefined && byCallId !== undefined
          ? mergeToolCalls(byItemId, byCallId)
          : byItemId ?? byCallId ?? {
              arguments: "",
              id: callId ?? itemId ?? "",
              name: ""
            };
      if (callId !== null) call.id = callId;
      if (itemId !== null) toolCalls.set(itemId, call);
      if (callId !== null) toolCalls.set(callId, call);
      return call;
    };

    await readSseDataStream(response.body, (data) => {
      if (data === "[DONE]") return;
      const event: unknown = JSON.parse(data);
      if (event === null || typeof event !== "object") return;
      const eventRecord = event as {
        arguments?: unknown;
        call_id?: unknown;
        delta?: unknown;
        item?: unknown;
        item_id?: unknown;
        response?: unknown;
        text?: unknown;
        type?: unknown;
      };
      const type = readString(eventRecord.type);
      if (
        type === "response.reasoning_summary_text.delta"
        || type === "response.reasoning_text.delta"
      ) {
        const delta = readStringValue(eventRecord.delta) ?? "";
        if (delta.length > 0) {
          const segment = [
            type,
            readIdentifier(eventRecord.item_id) ?? "reasoning",
            typeof (event as { summary_index?: unknown }).summary_index === "number"
              ? String((event as { summary_index: number }).summary_index)
              : "0"
          ].join(":");
          input.onReasoningDelta?.({
            delta,
            kind: type === "response.reasoning_summary_text.delta" ? "summary" : "content",
            reset: activeReasoningSegment !== segment
          });
          activeReasoningSegment = segment;
        }
        return;
      }
      if (type === "response.output_text.delta") {
        const delta = readString(eventRecord.delta);
        if (delta !== null) {
          receivedTextDelta = true;
          content += delta;
          input.onTextDelta(delta);
        }
        return;
      }
      if (type === "response.output_text.done") {
        appendFinalText(readStringValue(eventRecord.text) ?? "");
        return;
      }
      if (type === "response.function_call_arguments.delta") {
        const call = getToolCall(
          readIdentifier(eventRecord.item_id),
          readIdentifier(eventRecord.call_id)
        );
        if (call !== null) {
          call.arguments += readStringValue(eventRecord.delta) ?? "";
        }
        return;
      }
      if (type === "response.function_call_arguments.done") {
        const call = getToolCall(
          readIdentifier(eventRecord.item_id),
          readIdentifier(eventRecord.call_id)
        );
        const argumentsValue = readStringValue(eventRecord.arguments);
        if (call !== null && argumentsValue !== null) {
          call.arguments = argumentsValue;
        }
        return;
      }
      if (type === "response.completed") {
        finishReason = "completed";
        appendFinalText(readResponseOutputText(eventRecord.response));
        if (outputItems.length === 0 && eventRecord.response !== null && typeof eventRecord.response === "object") {
          const output = (eventRecord.response as { output?: unknown }).output;
          if (Array.isArray(output)) {
            outputItems.push(...output.filter(
              (item): item is Record<string, unknown> => item !== null && typeof item === "object"
            ));
          }
        }
        return;
      }

      const item = eventRecord.item;
      const source = item !== null && typeof item === "object" ? item : event;
      const sourceRecord = source as {
        arguments?: unknown;
        call_id?: unknown;
        id?: unknown;
        name?: unknown;
        type?: unknown;
      };
      const itemId = item !== null && typeof item === "object"
        ? readIdentifier((item as { id?: unknown }).id)
        : readIdentifier(eventRecord.item_id);
      if (type === "response.output_item.done") {
        appendFinalText(readResponseOutputText(source));
        if (source !== null && typeof source === "object") {
          outputItems.push(structuredClone(source as Record<string, unknown>));
        }
      }
      const name = readIdentifier((source as { name?: unknown }).name);
      const argumentsValue = readStringValue(sourceRecord.arguments);
      const callId = readIdentifier(sourceRecord.call_id);
      const isFunctionCall =
        readIdentifier(sourceRecord.type) === "function_call" ||
        (name !== null && (itemId !== null || callId !== null));
      if (isFunctionCall) {
        const call = getToolCall(itemId, callId);
        if (call !== null) {
          if (name !== null) call.name = name;
          if (argumentsValue !== null && (argumentsValue.length > 0 || call.arguments.length === 0)) {
            call.arguments = argumentsValue;
          }
        }
      }
    });
    const calls = [...new Set(toolCalls.values())].map((call) => {
      const id = call.id.trim();
      const name = call.name.trim();
      if (id.length === 0 || name.length === 0) {
        throw new Error("Model returned an incomplete tool call.");
      }
      return { ...call, id, name };
    });
    return {
      content,
      finishReason,
      ...(outputItems.length === 0
        ? {}
        : {
            providerState: {
              apiFormat: "openai-responses" as const,
              baseUrl: input.configuration.baseUrl,
              modelId: input.configuration.modelId,
              payload: { outputItems }
            }
          }),
      toolCalls: calls
    };
  }

  private async completeAnthropic(input: CompleteTurnInput): Promise<ModelTurnResult> {
    const response = await this.request(endpoint(input.configuration.baseUrl, "messages"), {
      body: JSON.stringify(anthropicRequest(input)),
      headers: {
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
        "x-api-key": input.configuration.apiKey
      },
      method: "POST",
      signal: input.signal
    });
    if (!response.ok) {
      throw await createModelRequestError(response);
    }
    if (response.body === null) throw new Error("Model response did not contain a stream body.");

    let content = "";
    let finishReason: string | null = null;
    let activeThinkingIndex: number | null = null;
    const contentBlocks = new Map<number, Record<string, unknown>>();
    const toolCalls = new Map<number, PendingToolCall>();
    const reasoningKind = input.configuration.modelId.trim().toLowerCase().startsWith("claude-")
      ? "summary" as const
      : "content" as const;
    await readSseDataStream(response.body, (data) => {
      const event: unknown = JSON.parse(data);
      if (event === null || typeof event !== "object") return;
      const type = readString((event as { type?: unknown }).type);
      const index = (event as { index?: unknown }).index;
      if (type === "content_block_start" && typeof index === "number") {
        const block = (event as { content_block?: unknown }).content_block;
        if (block !== null && typeof block === "object") {
          const storedBlock = structuredClone(block as Record<string, unknown>);
          contentBlocks.set(index, storedBlock);
          const blockType = readString(storedBlock.type);
          if (blockType === "tool_use") {
            const id = readString(storedBlock.id);
            const name = readString(storedBlock.name);
            if (id !== null && name !== null) toolCalls.set(index, { arguments: "", id, name });
          }
          if (blockType === "thinking") {
            const thinking = readStringValue(storedBlock.thinking) ?? "";
            if (thinking.length > 0) {
              input.onReasoningDelta?.({
                delta: thinking,
                kind: reasoningKind,
                reset: activeThinkingIndex !== index
              });
              activeThinkingIndex = index;
            }
          }
        }
        return;
      }
      if (type === "content_block_delta" && typeof index === "number") {
        const delta = (event as { delta?: unknown }).delta;
        if (delta === null || typeof delta !== "object") return;
        const deltaType = readString((delta as { type?: unknown }).type);
        if (deltaType === "text_delta") {
          const text = readString((delta as { text?: unknown }).text);
          if (text !== null) {
            content += text;
            input.onTextDelta(text);
            const block = contentBlocks.get(index);
            if (block !== undefined) {
              block.text = `${readStringValue(block.text) ?? ""}${text}`;
            }
          }
        }
        if (deltaType === "thinking_delta") {
          const thinking = readStringValue((delta as { thinking?: unknown }).thinking) ?? "";
          if (thinking.length > 0) {
            input.onReasoningDelta?.({
              delta: thinking,
              kind: reasoningKind,
              reset: activeThinkingIndex !== index
            });
            activeThinkingIndex = index;
            const block = contentBlocks.get(index);
            if (block !== undefined) {
              block.thinking = `${readStringValue(block.thinking) ?? ""}${thinking}`;
            }
          }
        }
        if (deltaType === "signature_delta") {
          const signature = readStringValue((delta as { signature?: unknown }).signature) ?? "";
          const block = contentBlocks.get(index);
          if (block !== undefined && signature.length > 0) {
            block.signature = `${readStringValue(block.signature) ?? ""}${signature}`;
          }
        }
        if (deltaType === "input_json_delta") {
          const call = toolCalls.get(index);
          if (call !== undefined) call.arguments += readString((delta as { partial_json?: unknown }).partial_json) ?? "";
        }
        return;
      }
      if (type === "message_delta") {
        const delta = (event as { delta?: unknown }).delta;
        if (delta !== null && typeof delta === "object") {
          finishReason = readString((delta as { stop_reason?: unknown }).stop_reason) ?? finishReason;
        }
      }
    });
    for (const [index, call] of toolCalls) {
      const block = contentBlocks.get(index);
      if (block !== undefined) block.input = parseToolArguments(call.arguments);
    }
    const storedBlocks = [...contentBlocks.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, block]) => block);
    return {
      content,
      finishReason,
      ...(storedBlocks.length === 0
        ? {}
        : {
            providerState: {
              apiFormat: "anthropic-messages" as const,
              baseUrl: input.configuration.baseUrl,
              modelId: input.configuration.modelId,
              payload: { contentBlocks: storedBlocks }
            }
          }),
      toolCalls: [...toolCalls.values()]
    };
  }

  private async completeGemini(input: CompleteTurnInput): Promise<ModelTurnResult> {
    const modelId = encodeURIComponent(input.configuration.modelId);
    const response = await this.request(
      `${endpoint(input.configuration.baseUrl, `models/${modelId}:streamGenerateContent`)}?alt=sse`,
      {
        body: JSON.stringify(geminiRequest(input)),
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": input.configuration.apiKey
        },
        method: "POST",
        signal: input.signal
      }
    );
    if (!response.ok) {
      throw await createModelRequestError(response);
    }
    if (response.body === null) throw new Error("Model response did not contain a stream body.");

    let content = "";
    let finishReason: string | null = null;
    let hasThoughtSummary = false;
    const storedParts: Record<string, unknown>[] = [];
    const toolCalls: ModelToolCall[] = [];
    await readSseDataStream(response.body, (data) => {
      const event: unknown = JSON.parse(data);
      if (event === null || typeof event !== "object") return;
      const candidates = (event as { candidates?: unknown }).candidates;
      if (!Array.isArray(candidates)) return;
      for (const candidate of candidates) {
        if (candidate === null || typeof candidate !== "object") continue;
        finishReason = readString((candidate as { finishReason?: unknown }).finishReason) ?? finishReason;
        const contentPart = (candidate as { content?: unknown }).content;
        const parts = contentPart !== null && typeof contentPart === "object"
          ? (contentPart as { parts?: unknown }).parts
          : undefined;
        if (!Array.isArray(parts)) continue;
        for (const part of parts) {
          if (part === null || typeof part !== "object") continue;
          const storedPart = part as Record<string, unknown>;
          storedParts.push(storedPart);
          const text = readString((part as { text?: unknown }).text);
          if (text !== null) {
            if ((part as { thought?: unknown }).thought === true) {
              input.onReasoningDelta?.({
                delta: text,
                kind: "summary",
                reset: !hasThoughtSummary
              });
              hasThoughtSummary = true;
            } else {
              content += text;
              input.onTextDelta(text);
            }
          }
          const functionCall = (part as { functionCall?: unknown }).functionCall;
          if (functionCall === null || typeof functionCall !== "object") continue;
          const name = readString((functionCall as { name?: unknown }).name);
          if (name === null) continue;
          const args = (functionCall as { args?: unknown }).args;
          toolCalls.push({
            arguments: JSON.stringify(args ?? {}),
            id: readString((functionCall as { id?: unknown }).id) ?? randomUUID(),
            name
          });
        }
      }
    });
    return {
      content,
      finishReason,
      ...(storedParts.length === 0
        ? {}
        : {
            providerState: {
              apiFormat: "google-gemini" as const,
              baseUrl: input.configuration.baseUrl,
              modelId: input.configuration.modelId,
              payload: { parts: storedParts }
            }
          }),
      toolCalls
    };
  }
}
