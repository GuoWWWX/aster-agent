import type { ConversationModelRetryItem, ConversationRunEvent } from "@agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ModelRequestError } from "../model/model-request-error.js";
import { createRuntimeModelRetryPolicy } from "./runtime-model-retry-policy.js";

afterEach(() => vi.useRealTimers());

function fixture() {
  const controller = new AbortController();
  const order: string[] = [];
  const input = {
    apiKey: "fixture-secret",
    conversationId: "conversation",
    emit: vi.fn<(event: ConversationRunEvent) => void>(() => { order.push("emit"); }),
    hasSuccessfulToolExecution: vi.fn(() => false),
    markConnectionError: vi.fn(() => { order.push("connection"); }),
    maxRetries: 5,
    onFinalFailurePersisted: vi.fn(() => { order.push("final"); }),
    persistRetry: vi.fn<(retry: ConversationModelRetryItem) => void>(() => { order.push("persist"); }),
    runId: "run",
    signal: controller.signal,
    wait: vi.fn(() => Promise.resolve()),
  };
  return { controller, input, order, policy: createRuntimeModelRetryPolicy(input) };
}

describe("Runtime model retry observations", () => {
  it("persists before publishing and reuses the same identity only within a request", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-19T00:00:00Z"));
    const { input, order, policy } = fixture();
    await policy.onRetry({ attempt: 1, delayMs: 1_000, error: null, requestId: "first" });
    const first = input.persistRetry.mock.calls[0]?.[0];
    expect(first).toMatchObject({ conversationId: "conversation", runId: "run", attempt: 1, status: "retrying", maxAttempts: 5, createdAt: "2026-10-19T00:00:00.000Z" });
    expect(order).toEqual(["persist", "emit"]);
    vi.setSystemTime(new Date("2026-10-19T00:00:01Z"));
    await policy.onSuccess?.({ attempt: 1, requestId: "first" });
    expect(input.persistRetry.mock.calls[1]?.[0]).toMatchObject({ id: first?.id, createdAt: first?.createdAt, updatedAt: "2026-10-19T00:00:01.000Z", status: "completed", retryInMs: null, reason: first?.reason });
    await policy.onRetry({ attempt: 1, delayMs: 1_000, error: null, requestId: "second" });
    expect(input.persistRetry.mock.calls[2]?.[0].id).not.toBe(first?.id);
    expect(order).toEqual(["persist", "emit", "persist", "emit", "persist", "emit"]);
  });

  it("marks the connection before recording a final failure and never exposes the API key", async () => {
    const { input, order, policy } = fixture();
    await policy.onRetry({ attempt: 1, delayMs: 1_000, error: null, requestId: "request" });
    order.length = 0;
    await policy.onFailure?.({ attempt: 5, error: new Error("network fixture-secret"), requestId: "request" });
    expect(order).toEqual(["connection", "persist", "emit", "final"]);
    const retry = input.persistRetry.mock.calls[1]?.[0];
    expect(retry).toMatchObject({ status: "failed", retryInMs: null, attempt: 5 });
    expect(JSON.stringify(input.persistRetry.mock.calls)).not.toContain("fixture-secret");
    expect(JSON.stringify(input.emit.mock.calls)).not.toContain("fixture-secret");
  });

  it.each(["cancelled", "abort_error"] as const)("does not mark a provider unhealthy for %s", async kind => {
    const { controller, input, policy } = fixture();
    await policy.onRetry({ attempt: 1, delayMs: 1_000, error: null, requestId: "request" });
    if (kind === "cancelled") controller.abort();
    await policy.onFailure?.({ attempt: 1, error: kind === "abort_error" ? new DOMException("cancelled", "AbortError") : new Error("network"), requestId: "request" });
    expect(input.markConnectionError).not.toHaveBeenCalled();
    expect(input.persistRetry.mock.calls[1]?.[0]).toMatchObject({ status: "failed" });
    expect(input.onFinalFailurePersisted).toHaveBeenCalledOnce();
  });

  it("does not publish or retain an update when persistence fails", async () => {
    const { input, policy } = fixture();
    input.persistRetry.mockImplementationOnce(() => { throw new Error("disk failure"); });
    expect(() => policy.onRetry({ attempt: 1, delayMs: 1_000, error: null, requestId: "request" })).toThrow("disk failure");
    await policy.onSuccess?.({ attempt: 1, requestId: "request" });
    expect(input.persistRetry).toHaveBeenCalledOnce();
    expect(input.emit).not.toHaveBeenCalled();
    expect(input.onFinalFailurePersisted).not.toHaveBeenCalled();
  });

  it("delegates waiting and predicates to the existing graph retry contract without a second loop", async () => {
    const { input, policy } = fixture();
    expect(policy.maxRetries).toBe(5);
    expect([1, 2, 3, 4, 5, 6].map(attempt => policy.getDelay(attempt))).toEqual([1_000, 2_000, 4_000, 8_000, 16_000, 16_000]);
    expect(policy.shouldRetry(new ModelRequestError(429, "limited"))).toBe(true);
    expect(policy.shouldRetry(new ModelRequestError(401, "denied"))).toBe(false);
    expect(policy.shouldFailEmptyResponse?.()).toBe(true);
    input.hasSuccessfulToolExecution.mockReturnValue(true);
    expect(policy.shouldFailEmptyResponse?.()).toBe(false);
    await policy.wait(100, input.signal);
    expect(input.wait).toHaveBeenCalledWith(100, input.signal);
    await policy.onSuccess?.({ attempt: 0, requestId: "no-retry" });
    expect(input.persistRetry).not.toHaveBeenCalled();
  });
});
