import { afterEach, describe, expect, it, vi } from "vitest";

import type { GitFileDiff, GitFileDiffInput, GitReviewSnapshot } from "@agent/protocol";

import {
  GitReviewCache,
  backgroundDiffPaths,
  type GitReviewDataSource,
} from "./git-review-cache.js";

function snapshot(
  projectId: string,
  paths: readonly { additions?: number | null; deletions?: number | null; path: string }[] = [],
): GitReviewSnapshot {
  return {
    ahead: 0,
    behind: 0,
    branch: "develop",
    branches: [],
    changes: paths.map((change) => ({
      additions: change.additions === undefined ? 1 : change.additions,
      deletions: change.deletions === undefined ? 0 : change.deletions,
      isStaged: false,
      originalPath: null,
      path: change.path,
      status: " M",
    })),
    isRepository: true,
    projectId,
    refreshedAt: "2026-09-02T00:00:00.000Z",
    upstream: "origin/develop",
  };
}

function createDataSource(
  snapshots: Map<string, GitReviewSnapshot>,
  content = "diff content",
): GitReviewDataSource & {
  diffCalls: string[];
  snapshotCalls: string[];
} {
  const diffCalls: string[] = [];
  const snapshotCalls: string[] = [];
  return {
    diffCalls,
    snapshotCalls,
    getGitFileDiff(input): Promise<GitFileDiff> {
      diffCalls.push(`${input.projectId}:${input.contextLines ?? 3}:${input.path}`);
      return Promise.resolve({ content, path: input.path, truncated: false });
    },
    getGitReviewSnapshot(input): Promise<GitReviewSnapshot> {
      snapshotCalls.push(input.projectId);
      const value = snapshots.get(input.projectId);
      return value === undefined
        ? Promise.reject(new Error(`Missing snapshot for ${input.projectId}`))
        : Promise.resolve(value);
    },
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("Git review project cache", () => {
  it("warms only the first 20 textual file diffs", async () => {
    const changes = [
      ...Array.from({ length: 22 }, (_, index) => ({ path: `src/file-${index}.ts` })),
      { additions: null, deletions: null, path: "assets/logo.png" },
    ];
    const source = createDataSource(new Map([["project-1", snapshot("project-1", changes)]]));
    const cache = new GitReviewCache(source);

    await cache.warmProject("project-1");
    await vi.waitFor(() => expect(source.diffCalls).toHaveLength(20));

    expect(source.diffCalls[0]).toBe("project-1:3:src/file-0.ts");
    expect(source.diffCalls.at(-1)).toBe("project-1:3:src/file-19.ts");
    expect(source.diffCalls.some((call) => call.includes("logo.png"))).toBe(false);
  });

  it("reuses an in-flight prefetch when the user opens the same file", async () => {
    let resolveDiff: ((value: GitFileDiff) => void) | undefined;
    const source = createDataSource(new Map([[
      "project-1",
      snapshot("project-1", [{ path: "src/app.ts" }]),
    ]]));
    source.getGitFileDiff = vi.fn((input: GitFileDiffInput) => new Promise<GitFileDiff>((resolve) => {
      source.diffCalls.push(`${input.projectId}:${input.contextLines ?? 3}:${input.path}`);
      resolveDiff = resolve;
    }));
    const cache = new GitReviewCache(source);

    await cache.warmProject("project-1");
    await vi.waitFor(() => expect(source.diffCalls).toHaveLength(1));
    const selected = cache.getFileDiff("project-1", "src/app.ts", 3);
    resolveDiff?.({ content: "ready", path: "src/app.ts", truncated: false });

    await expect(selected).resolves.toMatchObject({ content: "ready" });
    expect(source.diffCalls).toHaveLength(1);
    expect(cache.peekFileDiff("project-1", "src/app.ts", 3)?.content).toBe("ready");
  });

  it("invalidates only the changed path and coalesces snapshot refreshes", async () => {
    vi.useFakeTimers();
    const source = createDataSource(new Map([["project-1", snapshot("project-1")]]));
    const cache = new GitReviewCache(source, { fileChangeDebounceMs: 250 });
    await cache.warmProject("project-1");
    await cache.getFileDiff("project-1", "src/a.ts", 3);
    await cache.getFileDiff("project-1", "src/b.ts", 3);

    cache.noteFileChange("project-1", "src/a.ts");
    cache.noteFileChange("project-1", "src/a.ts");

    expect(cache.peekFileDiff("project-1", "src/a.ts", 3)).toBeNull();
    expect(cache.peekFileDiff("project-1", "src/b.ts", 3)?.path).toBe("src/b.ts");
    expect(source.snapshotCalls).toEqual(["project-1"]);

    await vi.advanceTimersByTimeAsync(250);
    await vi.waitFor(() => expect(source.snapshotCalls).toEqual(["project-1", "project-1"]));
  });

  it("does not let a stale in-flight diff overwrite an invalidated path", async () => {
    let resolveFirst: ((value: GitFileDiff) => void) | undefined;
    const source = createDataSource(new Map([["project-1", snapshot("project-1")]]));
    source.getGitFileDiff = vi.fn((input: GitFileDiffInput) => new Promise<GitFileDiff>((resolve) => {
      source.diffCalls.push(`${input.projectId}:${input.contextLines ?? 3}:${input.path}`);
      if (source.diffCalls.length === 1) resolveFirst = resolve;
      else resolve({ content: "new", path: input.path, truncated: false });
    }));
    const cache = new GitReviewCache(source);

    const first = cache.getFileDiff("project-1", "src/app.ts", 3);
    cache.noteFileChange("project-1", "src/app.ts");
    resolveFirst?.({ content: "old", path: "src/app.ts", truncated: false });

    await expect(first).resolves.toMatchObject({ content: "new" });
    expect(source.diffCalls).toHaveLength(2);
    expect(cache.peekFileDiff("project-1", "src/app.ts", 3)?.content).toBe("new");
  });

  it("keeps the active project and evicts least-recent inactive projects", async () => {
    let now = 0;
    const source = createDataSource(new Map([
      ["project-1", snapshot("project-1")],
      ["project-2", snapshot("project-2")],
      ["project-3", snapshot("project-3")],
    ]));
    const cache = new GitReviewCache(source, {
      maxProjects: 2,
      now: () => now,
      projectTtlMs: 100,
    });

    cache.activateProject("project-1");
    await cache.warmProject("project-1");
    now = 1;
    await cache.warmProject("project-2");
    now = 2;
    await cache.warmProject("project-3");

    expect(cache.peekSnapshot("project-1")?.projectId).toBe("project-1");
    expect(cache.peekSnapshot("project-2")).toBeNull();
    expect(cache.peekSnapshot("project-3")?.projectId).toBe("project-3");

    cache.activateProject(null);
    now = 103;
    cache.sweep();
    expect(cache.peekSnapshot("project-1")).toBeNull();
    expect(cache.peekSnapshot("project-3")).toBeNull();
  });

  it("evicts least-recent diffs when the global byte budget is exceeded", async () => {
    const source = createDataSource(new Map([["project-1", snapshot("project-1")]]), "x".repeat(20));
    const cache = new GitReviewCache(source, { maxDiffBytes: 70 });

    await cache.getFileDiff("project-1", "src/a.ts", 3);
    await cache.getFileDiff("project-1", "src/b.ts", 3);

    expect(cache.peekFileDiff("project-1", "src/a.ts", 3)).toBeNull();
    expect(cache.peekFileDiff("project-1", "src/b.ts", 3)?.path).toBe("src/b.ts");
  });
});

describe("Git diff background paths", () => {
  it("deduplicates paths and skips binary files", () => {
    expect(backgroundDiffPaths(snapshot("project-1", [
      { path: "src/app.ts" },
      { additions: null, deletions: null, path: "assets/logo.png" },
      { path: "src/app.ts" },
      { path: "src/feature.ts" },
    ]).changes)).toEqual(["src/app.ts", "src/feature.ts"]);
  });
});
