import { randomUUID } from "node:crypto";
import type { ConversationModelRetryItem, ConversationRunEvent } from "@agent/protocol";

import type { AgentGraphModelRetry } from "./langgraph-executor.js";
import { isAbortError, isRetryableModelError, modelRetryDelay, modelRetryReason } from "./runtime-model-retry.js";

type ModelRetryPolicyInput = {
  apiKey: string;
  conversationId: string;
  emit: (event: ConversationRunEvent) => void;
  hasSuccessfulToolExecution: () => boolean;
  markConnectionError: () => void;
  maxRetries: number;
  onFinalFailurePersisted: () => void;
  persistRetry: (retry: ConversationModelRetryItem) => void;
  runId: string;
  signal: AbortSignal;
  wait: AgentGraphModelRetry["wait"];
};

/** Owns one Run's reconnect observations; LangGraph still performs all retries. */
export function createRuntimeModelRetryPolicy(input: ModelRetryPolicyInput): AgentGraphModelRetry {
  const retries = new Map<string, ConversationModelRetryItem>();
  const updateRetry = (
    requestId: string,
    update: Pick<ConversationModelRetryItem, "attempt" | "reason" | "retryInMs" | "status">,
  ): ConversationModelRetryItem => {
    const current = retries.get(requestId);
    const now = new Date().toISOString();
    const retry: ConversationModelRetryItem = {
      ...update,
      conversationId: input.conversationId,
      createdAt: current?.createdAt ?? now,
      id: current?.id ?? randomUUID(),
      kind: "model_retry",
      maxAttempts: input.maxRetries,
      runId: input.runId,
      updatedAt: now,
    };
    input.persistRetry(retry);
    retries.set(requestId, retry);
    input.emit({
      conversationId: input.conversationId,
      retry,
      runId: input.runId,
      type: "model.retry_updated",
    });
    return retry;
  };
  return {
    createEmptyResponseError: () => new Error("模型未返回可显示内容，请稍后重试或切换模型。"),
    getDelay: modelRetryDelay,
    maxRetries: input.maxRetries,
    onFailure: ({ attempt, error, requestId }) => {
      if (!input.signal.aborted && !isAbortError(error)) {
        input.markConnectionError();
      }
      const current = retries.get(requestId);
      if (current === undefined) return;
      updateRetry(requestId, {
        attempt,
        reason: modelRetryReason(error, input.apiKey),
        retryInMs: null,
        status: "failed",
      });
      input.onFinalFailurePersisted();
    },
    onRetry: ({ attempt, delayMs, error, requestId }) => {
      updateRetry(requestId, {
        attempt,
        reason: error === null
          ? "模型未返回可显示内容。"
          : modelRetryReason(error, input.apiKey),
        retryInMs: delayMs,
        status: "retrying",
      });
    },
    onSuccess: ({ attempt, requestId }) => {
      const current = retries.get(requestId);
      if (current === undefined) return;
      updateRetry(requestId, {
        attempt,
        reason: current.reason,
        retryInMs: null,
        status: "completed",
      });
    },
    shouldFailEmptyResponse: () => !input.hasSuccessfulToolExecution(),
    shouldRetry: isRetryableModelError,
    wait: input.wait,
  };
}
