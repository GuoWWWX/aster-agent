import { describe, expect, it } from "vitest";

import {
  retainedWorkspaceCacheIds,
  WORKSPACE_CACHE_MAX_RETAINED,
  WORKSPACE_CACHE_TTL_MS,
} from "./workspace-cache-policy.js";

describe("workspace cache policy", () => {
  it("keeps the active workspace even after the cache expires", () => {
    const retained = retainedWorkspaceCacheIds([
      { id: "active", lastAccessedAt: 0 },
      { id: "expired", lastAccessedAt: 0 },
    ], "active", WORKSPACE_CACHE_TTL_MS + 1);

    expect([...retained]).toEqual(["active"]);
  });

  it("retains only the most recently accessed workspaces", () => {
    const candidates = Array.from({ length: WORKSPACE_CACHE_MAX_RETAINED + 3 }, (_, index) => ({
      id: `workspace-${index}`,
      lastAccessedAt: 1_000 - index,
    }));

    const retained = retainedWorkspaceCacheIds(candidates, null, 2_000);

    expect([...retained]).toEqual([
      "workspace-0",
      "workspace-1",
      "workspace-2",
      "workspace-3",
      "workspace-4",
      "workspace-5",
      "workspace-6",
      "workspace-7",
    ]);
  });
});
