import { isGraphInterrupt } from "@langchain/langgraph";
import type { ConversationToolExecutionMode } from "@agent/protocol";
import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelMessage, ModelMessageAttachment, ModelToolCall } from "../model/model-contracts.js";
import { MAX_PARALLEL_COMMAND_TOOL_CALLS, MAX_PARALLEL_READ_TOOL_CALLS, type ToolExecutionPolicy } from "../tools/tool-execution-policy.js";
import { isAbortError } from "./runtime-model-retry.js";
import type { RuntimeToolCallLedger } from "./runtime-tool-call-ledger.js";
import { chunkToolCalls, type LangChainToolResultEnvelope } from "./runtime-tool-results.js";

export type RuntimeToolBatchOperations = {
  getPolicy(toolCall: ModelToolCall): ToolExecutionPolicy;
  prepare(toolCall: ModelToolCall, toolBatchId: string): Promise<void>;
  invokeToolNode(toolCalls: readonly ModelToolCall[], executionMode: ConversationToolExecutionMode, toolBatchId: string): Promise<Map<string, LangChainToolResultEnvelope>>;
};

type RuntimeToolBatchInput = {
  ledger: RuntimeToolCallLedger;
  operations: RuntimeToolBatchOperations;
  runId: string;
  signal: AbortSignal;
  toolCalls: readonly ModelToolCall[];
};

/** Schedules one ToolNode batch; approval, execution and persistence stay behind the Runtime actions. */
export async function executeRuntimeToolBatch(
  input: RuntimeToolBatchInput,
): Promise<{ messages: ModelMessage[]; successful: boolean }> {
  const messages = Array<ModelMessage | undefined>(input.toolCalls.length);
  const modelAttachments: ModelMessageAttachment[] = [];
  const policies = new Map<number, ToolExecutionPolicy>();
  let hasSuccessfulToolExecution = false;
  const batchCallIds = input.toolCalls.map(toolCall => toolCall.id);
  const toolBatchId = input.ledger.batchId(input.runId, batchCallIds);

  for (let index = 0; index < input.toolCalls.length; index += 1) {
    input.signal.throwIfAborted();
    const toolCall = input.toolCalls[index];
    if (toolCall === undefined) continue;
    const identity = { runId: input.runId, callId: toolCall.id };
    const cached = input.ledger.getCompleted(identity);
    if (cached !== undefined) {
      messages[index] = cached.message;
      modelAttachments.push(...(cached.envelope.modelAttachments ?? []));
      hasSuccessfulToolExecution ||= cached.envelope.successful;
      continue;
    }
    try {
      policies.set(index, input.operations.getPolicy(toolCall));
    } catch (error) {
      if (input.signal.aborted || isAbortError(error) || isGraphInterrupt(error)) {
        throw error;
      }
      input.ledger.rememberPrepared(identity, {
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
      await input.operations.prepare(toolCall, toolBatchId);
    }
  }

  let index = 0;
  while (index < input.toolCalls.length) {
    input.signal.throwIfAborted();
    const toolCall = input.toolCalls[index];
    if (toolCall === undefined) {
      index += 1;
      continue;
    }
    const identity = { runId: input.runId, callId: toolCall.id };
    if (input.ledger.getCompleted(identity) !== undefined) {
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
          || input.ledger.getCompleted({ runId: input.runId, callId: nextCall.id }) !== undefined
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
      const chunkResults = await input.operations.invokeToolNode(chunk, policy.kind === "parallel" ? "parallel" : "serial", toolBatchId);
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
      modelAttachments.push(...(result.modelAttachments ?? []));
      hasSuccessfulToolExecution ||= result.successful;
      input.ledger.rememberCompleted({ runId: input.runId, callId: call.id }, { envelope: result, message });
    }
    index = nextIndex;
  }

  input.ledger.releaseBatch(input.runId, batchCallIds);
  return {
    messages: [
      ...messages.filter((message): message is ModelMessage => message !== undefined),
      ...(modelAttachments.length === 0
        ? []
        : [{
            attachments: modelAttachments.slice(-4),
            content: [
              modelAttachments.some((attachment) => attachment.source === "browser")
                ? "Rendered page screenshots. Use screenshot pixel coordinates for pointer actions."
                : null,
              modelAttachments.some((attachment) => attachment.source === "computer")
                ? "Authorized application window screenshots returned by computer_use. Coordinates are physical pixels relative to that window; reobserve after UI changes."
                : null,
              modelAttachments.some((attachment) => attachment.source !== "browser" && attachment.source !== "computer")
                ? "Images returned by view_attachments. Re-read images using their paths, not attachment IDs."
                : null,
            ].filter((value): value is string => value !== null).join("\n"),
            role: "user" as const,
            toolCallId: null,
            toolCalls: [],
          }]),
    ],
    successful: hasSuccessfulToolExecution,
  };
}
