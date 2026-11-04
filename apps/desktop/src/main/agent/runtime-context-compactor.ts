import type { ModelConfiguration } from "../model/model-contracts.js";
import type { ModelGateway } from "../model/model-gateway.js";
import {
  createContextCompactionMessages,
  parseContextSummary,
  selectCompactionRetryBatch,
  type ManagedContextSourceMessage,
} from "./context-manager.js";
import { isRetryableModelError, modelRetryDelay } from "./runtime-model-retry.js";

export type ContextCompactionInput = {
  configuration: ModelConfiguration;
  messages: readonly ManagedContextSourceMessage[];
  previousSummary: string | null;
  signal: AbortSignal;
};

export type ContextCompactor = {
  compact(input: ContextCompactionInput): Promise<string>;
};

interface ConversationTurnSummaryReader {
  getConversationTurnSummary(runId: string): { summary: string } | null;
}

/** Computes summaries; the Runtime alone persists checkpoints and reports their lifecycle. */
export class RuntimeContextCompactor {
  public constructor(
    private readonly modelGateway: Pick<ModelGateway, "completeBackgroundTurn">,
    private readonly turnSummaries: ConversationTurnSummaryReader,
    private readonly waitForRetry: (delayMs: number, signal: AbortSignal) => Promise<void>,
    private readonly contextCompactor: ContextCompactor | null,
    private readonly maxReconnectAttempts: number,
  ) {}

  public compact(
    input: ContextCompactionInput,
    maxReconnectAttempts = this.maxReconnectAttempts,
  ): Promise<string> {
    return this.contextCompactor === null
      ? this.compactWithModel(input, maxReconnectAttempts)
      : this.contextCompactor.compact(input);
  }

  private async compactWithModel(
    input: ContextCompactionInput,
    maxReconnectAttempts = this.maxReconnectAttempts,
  ): Promise<string> {
    let reconnectAttempt = 0;
    while (true) {
      input.signal.throwIfAborted();
      let receivedTextDelta = false;
      try {
        const result = await this.modelGateway.completeBackgroundTurn({
          purpose: "summary",
          configuration: input.configuration,
          messages: createContextCompactionMessages(input.previousSummary, input.messages),
          onTextDelta: () => {
            receivedTextDelta = true;
          },
          signal: input.signal,
        });
        if (result.toolCalls.length > 0 || result.content.trim().length === 0) {
          throw new Error("Context compaction returned an invalid response.");
        }
        return result.content;
      } catch (error) {
        if (
          receivedTextDelta ||
          !isRetryableModelError(error) ||
          reconnectAttempt >= maxReconnectAttempts
        ) {
          throw error;
        }
        reconnectAttempt += 1;
        await this.waitForRetry(modelRetryDelay(reconnectAttempt), input.signal);
      }
    }
  }

  public async resolve(input: ContextCompactionInput & {
    conversationId: string;
    forceCompaction: boolean;
  }): Promise<{
    compressedMessageCount: number;
    coveredThroughSequence: number;
    summary: string;
  }> {
    const lastCandidate = input.messages.at(-1);
    if (lastCandidate === undefined) {
      throw new Error("Context compaction requires at least one completed message.");
    }
    const summarizedMessages: ManagedContextSourceMessage[] = [];
    for (let index = 0; index < input.messages.length;) {
      const first = input.messages[index];
      if (first === undefined) break;
      let end = index + 1;
      while (end < input.messages.length && input.messages[end]?.runId === first.runId) end += 1;
      const turn = input.messages.slice(index, end);
      const boundary = turn.at(-1);
      const prepared = first.runId === null
        ? null
        : this.turnSummaries.getConversationTurnSummary(first.runId);
      if (prepared === null || boundary === undefined) {
        summarizedMessages.push(...turn);
      } else {
        summarizedMessages.push({
          attachmentIds: [],
          attachments: [],
          content: `[Completed turn summary]\n${prepared.summary}`,
          role: "assistant",
          runId: first.runId,
          sequence: boundary.sequence,
          toolCallId: null,
          toolCalls: [],
        });
      }
      index = end;
    }

    const compact = async (
      messages: readonly ManagedContextSourceMessage[],
    ): Promise<string> => {
      const rawSummary = await this.compact({ ...input, messages });
      input.signal.throwIfAborted();
      return parseContextSummary(rawSummary);
    };
    let currentMessages = summarizedMessages;
    let lastError: unknown = null;
    while (currentMessages.length > 0) {
      try {
        const currentBoundary = currentMessages.at(-1) ?? lastCandidate;
        return {
          compressedMessageCount: input.messages.filter(
            (message) => message.sequence <= currentBoundary.sequence,
          ).length,
          coveredThroughSequence: currentBoundary.sequence,
          summary: await compact(currentMessages),
        };
      } catch (error) {
        lastError = error;
        const retryMessages = selectCompactionRetryBatch(currentMessages);
        if (retryMessages.length === 0) break;
        currentMessages = retryMessages;
        if (!input.forceCompaction) {
          const retryBoundary = currentMessages.at(-1);
          if (retryBoundary === undefined) break;
          return {
            compressedMessageCount: input.messages.filter(
              (message) => message.sequence <= retryBoundary.sequence,
            ).length,
            coveredThroughSequence: retryBoundary.sequence,
            summary: await compact(currentMessages),
          };
        }
      }
    }
    throw lastError;
  }
}
