import { formatAgentError } from "@agent/protocol";
import { toMainAgentError } from "../errors/agent-error.js";
import { ModelRequestError, ModelResponseError } from "../model/model-request-error.js";

const MODEL_RETRY_INITIAL_DELAY_MS = 1_000;

const MODEL_RETRY_MAX_DELAY_MS = 16_000;

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

export function isRetryableModelError(error: unknown): boolean {
  if (error instanceof ModelResponseError) return true;

  if (error instanceof ModelRequestError) {
    return [408, 425, 429].includes(error.status) || error.status >= 500;
  }

  return (error instanceof Error || error instanceof DOMException)
    && /fetch failed|network|socket|connect|connection|timed out|timeout|terminated|econn/iu.test(error.message);
}

export function modelRetryReason(error: unknown, apiKey: string): string {
  const agentError = toMainAgentError(error, {
    operation: "model.retry",
    redactValues: [apiKey],
  });
  return formatAgentError(agentError);
}

export function modelRetryDelay(retryAttempt: number): number {
  return Math.min(
    MODEL_RETRY_INITIAL_DELAY_MS * 2 ** (retryAttempt - 1),
    MODEL_RETRY_MAX_DELAY_MS
  );
}

function retryAbortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

export function waitForRetryDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    return Promise.reject(retryAbortError(signal));
  }

  return new Promise((resolve, reject) => {
    const complete = (): void => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    };
    const onAbort = (): void => {
      clearTimeout(timeout);
      signal.removeEventListener("abort", onAbort);
      reject(retryAbortError(signal));
    };
    const timeout = setTimeout(complete, delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
