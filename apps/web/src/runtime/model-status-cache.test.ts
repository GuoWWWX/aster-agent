import { describe, expect, it, vi } from "vitest";

import type { ModelRuntimeStatus } from "@agent/protocol";

import type { AgentClient } from "./agent-client.js";
import {
  getCachedModelStatus,
  loadModelStatus,
  rememberModelStatus,
} from "./model-status-cache.js";

const status = { configured: false, models: [] } as unknown as ModelRuntimeStatus;

describe("model status cache", () => {
  it("exposes the latest status synchronously", () => {
    const client = {} as AgentClient;

    expect(getCachedModelStatus(client)).toBeNull();
    expect(rememberModelStatus(client, status)).toBe(status);
    expect(getCachedModelStatus(client)).toBe(status);
  });

  it("deduplicates concurrent status requests", async () => {
    const getModelStatus = vi.fn().mockResolvedValue(status);
    const client = { getModelStatus } as unknown as AgentClient;

    const first = loadModelStatus(client);
    const second = loadModelStatus(client);

    await expect(Promise.all([first, second])).resolves.toEqual([status, status]);
    expect(getModelStatus).toHaveBeenCalledTimes(1);
    expect(getCachedModelStatus(client)).toBe(status);
  });

  it("does not let an older request overwrite a newer remembered status", async () => {
    let resolveRequest: ((value: ModelRuntimeStatus) => void) | undefined;
    const oldStatus = { configured: false, models: [] } as unknown as ModelRuntimeStatus;
    const newStatus = { configured: true, models: [] } as unknown as ModelRuntimeStatus;
    const client = {
      getModelStatus: () => new Promise<ModelRuntimeStatus>((resolve) => {
        resolveRequest = resolve;
      }),
    } as unknown as AgentClient;

    const request = loadModelStatus(client);
    rememberModelStatus(client, newStatus);
    resolveRequest?.(oldStatus);

    await expect(request).resolves.toBe(newStatus);
    expect(getCachedModelStatus(client)).toBe(newStatus);
  });
});
