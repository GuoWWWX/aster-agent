import { AIMessage, HumanMessage, SystemMessage, ToolMessage, type BaseMessage, type ContentBlock } from "@langchain/core/messages";
import type { CompleteTurnInput, ModelMessage } from "./model-contracts.js";
import { modelImageAttachmentCaption } from "./model-contracts.js";
import { parseToolArguments } from "./tool-arguments.js";
import { matchingProviderState, providerReplayFields } from "./langchain-provider-replay.js";

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

function orderToolResultsBeforeInterleavedMessages(
  messages: readonly ModelMessage[],
): ModelMessage[] {
  const ordered: ModelMessage[] = [];
  let index = 0;
  while (index < messages.length) {
    const current = messages[index];
    if (current === undefined) break;
    ordered.push(current);
    index += 1;
    if (current.role !== "assistant" || current.toolCalls.length === 0) continue;

    const pendingToolCallIds = new Set(current.toolCalls.map((call) => call.id));
    const toolResults: ModelMessage[] = [];
    const interleaved: ModelMessage[] = [];
    let cursor = index;
    while (cursor < messages.length && pendingToolCallIds.size > 0) {
      const candidate = messages[cursor];
      if (candidate === undefined || candidate.role === "assistant") break;
      cursor += 1;
      if (
        candidate.role === "tool"
        && candidate.toolCallId !== null
        && pendingToolCallIds.delete(candidate.toolCallId)
      ) {
        toolResults.push(candidate);
      } else {
        interleaved.push(candidate);
      }
    }

    if (pendingToolCallIds.size > 0) continue;
    ordered.push(...toolResults, ...interleaved);
    index = cursor;
  }
  return ordered;
}

function withoutSupersededToolScreenshots(messages: readonly ModelMessage[]): ModelMessage[] {
  const latestImageIndexes = new Map<string, number>();
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    for (const attachment of messages[index]?.attachments ?? []) {
      if (attachment.kind === "image" && (attachment.source === "browser" || attachment.source === "computer") && !latestImageIndexes.has(attachment.source)) {
        latestImageIndexes.set(attachment.source, index);
      }
    }
  }
  if (latestImageIndexes.size === 0) return [...messages];
  return messages.map((message, messageIndex) => {
    return {
      ...message,
      attachments: message.attachments.map((attachment) => {
        if (attachment.kind !== "image" || messageIndex >= (latestImageIndexes.get(attachment.source) ?? -1)) return attachment;
        return {
          content: `[Earlier ${attachment.source} screenshot superseded by a newer capture]\n${modelImageAttachmentCaption(attachment)}`,
          contextTokens: attachment.contextTokens,
          id: attachment.id,
          kind: "text" as const,
          mimeType: attachment.mimeType,
          name: attachment.name,
          projectPath: attachment.projectPath,
          readState: attachment.readState,
          source: attachment.source,
          truncated: attachment.truncated,
        };
      }),
    };
  });
}

export function toLangChainMessages(
  messages: readonly ModelMessage[],
  input: CompleteTurnInput,
): BaseMessage[] {
  const boundedMessages = withoutSupersededToolScreenshots(messages);
  const orderedMessages = input.configuration.apiFormat === "openai-chat-completions"
    || input.configuration.apiFormat === "openai-responses"
    ? orderToolResultsBeforeInterleavedMessages(boundedMessages)
    : boundedMessages;
  return orderedMessages.map((message) => toLangChainMessage(message, input));
}
