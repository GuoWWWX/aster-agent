// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitReviewSnapshot } from "@agent/protocol";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { GitReviewCache } from "./git-review-cache.js";
import { GitReviewWorkspace } from "./git-review-workspace.js";

const PROJECT_ID = "00000000-0000-4000-8000-000000000001";
const REQUESTED_PATH = "apps/web/src/app.tsx";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class {
    disconnect(): void {}
    observe(): void {}
    unobserve(): void {}
  });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

describe("GitReviewWorkspace file requests", () => {
  it("selects the requested file diff when the Git review opens", async () => {
    const client = new MockAgentClient();
    const snapshot: GitReviewSnapshot = {
      ahead: 0,
      behind: 0,
      branch: "feature/header-controls",
      branches: [],
      changes: [{
        additions: 1,
        deletions: 1,
        isStaged: false,
        originalPath: null,
        path: REQUESTED_PATH,
        status: " M",
      }],
      isRepository: true,
      projectId: PROJECT_ID,
      refreshedAt: "2026-09-04T00:00:00.000Z",
      upstream: null,
    };
    const source = {
      getGitFileDiff: vi.fn().mockResolvedValue({
        content: "@@ -1 +1 @@\n-old\n+new",
        path: REQUESTED_PATH,
        truncated: false,
      }),
      getGitReviewSnapshot: vi.fn().mockResolvedValue(snapshot),
    };
    const cache = new GitReviewCache(source, { prefetchLimit: 1 });
    cache.replaceSnapshot(PROJECT_ID, snapshot);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <GitReviewWorkspace
            active
            agentClient={client}
            gitReviewCache={cache}
            projectId={PROJECT_ID}
            requestedFile={{ path: REQUESTED_PATH, requestId: 1 }}
          />
        </TooltipProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector('[aria-label="文件差异"]')?.textContent).toContain(REQUESTED_PATH);
    expect(source.getGitFileDiff).toHaveBeenCalledWith({
      contextLines: 3,
      path: REQUESTED_PATH,
      projectId: PROJECT_ID,
    });
  });
});
