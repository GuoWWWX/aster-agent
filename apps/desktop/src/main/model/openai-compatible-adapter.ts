import { z } from "zod";
import type {
  CompleteTurnInput,
  ModelConfiguration,
  ModelMessage,
  ModelProviderAdapter,
  ModelProviderState,
  ModelTurnResult,
} from "./model-contracts.js";
import { createModelRequestError } from "./model-request-error.js";
import { readSseDataStream } from "./sse-data-stream.js";

const toolCallDeltaSchema = z
  .object({
    function: z
      .object({
        arguments: z.string().optional(),
        name: z.string().optional()
      })
      .optional(),
    id: z.string().optional(),
    index: z.number().int().nonnegative(),
    type: z.literal("function").optional()
  })
  .passthrough();

const completionChunkSchema = z
  .object({
    choices: z.array(
      z
        .object({
          delta: z
            .object({
              content: z.string().nullable().optional(),
              reasoning_content: z.string().nullable().optional(),
              tool_calls: z.array(toolCallDeltaSchema).optional()
            })
            .passthrough(),
          finish_reason: z.string().nullable()
        })
        .passthrough()
    )
  })
  .passthrough();

import { modelImageAttachmentCaption } from "./model-contracts.js";

export type {
  CompleteTurnInput,
  ModelConfiguration,
  ModelMessage,
  ModelMessageAttachment,
  ModelProviderAdapter,
  ModelProviderState,
  ModelToolCall,
  ModelToolDefinition,
  ModelTurnResult,
} from "./model-contracts.js";
export { modelImageAttachmentCaption } from "./model-contracts.js";

type PendingToolCall = {
  arguments: string;
  id: string;
  name: string;
};

function matchingProviderState(
  message: ModelMessage,
  configuration: ModelConfiguration,
  apiFormat: ModelConfiguration["apiFormat"]
): ModelProviderState | null {
  const state = message.providerState;
  return state?.apiFormat === apiFormat
    && state.baseUrl === configuration.baseUrl
    && state.modelId === configuration.modelId
    ? state
    : null;
}

function serializeMessage(
  message: ModelMessage,
  configuration: ModelConfiguration
): Record<string, unknown> {
  if (message.role === "assistant") {
    const serialized: Record<string, unknown> = {
      content: message.content.length === 0 ? null : message.content,
      role: message.role
    };
    if (message.toolCalls.length > 0) {
      serialized.tool_calls = message.toolCalls.map((call) => ({
        function: { arguments: call.arguments, name: call.name },
        id: call.id,
        type: "function"
      }));
    }
    const state = matchingProviderState(message, configuration, "openai-chat-completions");
    if (state?.payload !== null && typeof state?.payload === "object") {
      const reasoningContent = (state.payload as { reasoningContent?: unknown }).reasoningContent;
      if (typeof reasoningContent === "string" && reasoningContent.length > 0) {
        serialized.reasoning_content = reasoningContent;
      }
    }
    return serialized;
  }
  if (message.role === "tool") {
    return {
      content: message.content,
      role: message.role,
      tool_call_id: message.toolCallId
    };
  }
  if (message.role !== "user" || message.attachments.length === 0) {
    return { content: message.content, role: message.role };
  }
  return {
    content: [
      ...(message.content.length === 0 ? [] : [{ text: message.content, type: "text" }]),
      ...message.attachments.flatMap((attachment) => {
        if (attachment.kind === "text") {
          return [{ text: attachment.content, type: "text" }];
        }
        if (attachment.data === null) {
          throw new Error(`Image attachment ${attachment.name} was not loaded.`);
        }
        return [
          { text: modelImageAttachmentCaption(attachment), type: "text" },
          {
            image_url: {
              url: `data:${attachment.mimeType};base64,${attachment.data}`
            },
            type: "image_url"
          },
        ];
      })
    ],
    role: message.role
  };
}

function createRequestBody(input: CompleteTurnInput): Record<string, unknown> {
  const body: Record<string, unknown> = {
    max_tokens: input.maxOutputTokens,
    messages: input.messages.map((message) => serializeMessage(message, input.configuration)),
    model: input.configuration.modelId,
    stream: true,
    stream_options: { include_usage: true },
    tools: input.tools.map((tool) => ({
      function: {
        description: tool.description,
        name: tool.name,
        parameters: tool.parameters
      },
      type: "function"
    }))
  };
  if (input.reasoning?.kind === "effort" || input.reasoning?.kind === "custom_effort") {
    body.reasoning_effort = input.reasoning.value;
  }
  return body;
}

export class OpenAiChatCompletionsAdapter implements ModelProviderAdapter {
  public constructor(
    private readonly request: typeof fetch = fetch
  ) {}

  public async completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    const endpoint = `${input.configuration.baseUrl}/chat/completions`;
    const response = await this.request(endpoint, {
      body: JSON.stringify(createRequestBody(input)),
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
    if (response.body === null) {
      throw new Error("Model response did not contain a stream body.");
    }

    let content = "";
    let reasoningContent = "";
    let finishReason: string | null = null;
    const pendingToolCalls = new Map<number, PendingToolCall>();

    await readSseDataStream(response.body, (data) => {
      if (data === "[DONE]") return;
      const chunk = completionChunkSchema.parse(JSON.parse(data));
      for (const choice of chunk.choices) {
        finishReason = choice.finish_reason ?? finishReason;
        const reasoningDelta = choice.delta.reasoning_content;
        if (
          reasoningDelta !== undefined
          && reasoningDelta !== null
          && reasoningDelta.length > 0
        ) {
          input.onReasoningDelta?.({
            delta: reasoningDelta,
            kind: "content",
            reset: reasoningContent.length === 0
          });
          reasoningContent += reasoningDelta;
        }
        const delta = choice.delta.content;
        if (delta !== undefined && delta !== null && delta.length > 0) {
          content += delta;
          input.onTextDelta(delta);
        }
        for (const toolDelta of choice.delta.tool_calls ?? []) {
          const pending = pendingToolCalls.get(toolDelta.index) ?? {
            arguments: "",
            id: "",
            name: ""
          };
          pending.id += toolDelta.id ?? "";
          pending.name += toolDelta.function?.name ?? "";
          pending.arguments += toolDelta.function?.arguments ?? "";
          pendingToolCalls.set(toolDelta.index, pending);
        }
      }
    });

    const toolCalls = [...pendingToolCalls.entries()]
      .sort(([left], [right]) => left - right)
      .map(([, call]) => {
        if (call.id.length === 0 || call.name.length === 0) {
          throw new Error("Model returned an incomplete tool call.");
        }
        return call;
      });
    return {
      content,
      finishReason,
      ...(reasoningContent.length === 0
        ? {}
        : {
            providerState: {
              apiFormat: "openai-chat-completions" as const,
              baseUrl: input.configuration.baseUrl,
              modelId: input.configuration.modelId,
              payload: { reasoningContent }
            }
          }),
      toolCalls
    };
  }

}

/** @deprecated Use OpenAiChatCompletionsAdapter through ModelAdapterRegistry. */
export const OpenAiCompatibleAdapter = OpenAiChatCompletionsAdapter;
