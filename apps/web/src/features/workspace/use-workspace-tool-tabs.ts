import { useEffect, useMemo, useRef, useState } from "react";
import type { AgentClient } from "../../runtime/index.js";
import { getGitReviewCache } from "./git-review-cache.js";
import { retainedWorkspaceCacheIds, WORKSPACE_CACHE_SWEEP_INTERVAL_MS } from "./workspace-cache-policy.js";
import type { ToolTab } from "./sidebar-workspace-types.js";

/** Retains workspace tools and releases native resources when their cache expires. */
export function useWorkspaceToolTabs(agentClient: AgentClient, activeTabId: string | null) {
  const [toolTabs, setToolTabs] = useState<ToolTab[]>([]);
  const [workspaceCacheClock, setWorkspaceCacheClock] = useState(() => Date.now());
  const releasingToolTabIdsRef = useRef(new Set<string>());
  const gitReviewCache = getGitReviewCache(agentClient);
  const activeToolTabId = toolTabs.some((tab) => tab.id === activeTabId) ? activeTabId : null;
  const retainedToolTabIds = useMemo(
    () => retainedWorkspaceCacheIds(toolTabs, activeToolTabId, workspaceCacheClock),
    [activeToolTabId, toolTabs, workspaceCacheClock],
  );
  const retainedToolTabs = useMemo(
    () => toolTabs.filter((tab) => retainedToolTabIds.has(tab.id)),
    [retainedToolTabIds, toolTabs],
  );
  useEffect(() => {
    const tick = (): void => setWorkspaceCacheClock(Date.now());
    const interval = window.setInterval(tick, WORKSPACE_CACHE_SWEEP_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    gitReviewCache.sweep(workspaceCacheClock);
  }, [gitReviewCache, workspaceCacheClock]);

  useEffect(() => {
    for (const tab of toolTabs) {
      if (
        retainedToolTabIds.has(tab.id)
        || tab.kind === "git-review"
        || tab.kind === "background-command"
        || tab.kind === "task-list"
        || tab.kind === "conversation-review"
        || tab.kind === "group-details"
        || tab.session === null
        || releasingToolTabIdsRef.current.has(tab.id)
      ) {
        continue;
      }
      releasingToolTabIdsRef.current.add(tab.id);
      if (tab.kind === "terminal") {
        const sessionId = tab.session.sessionId;
        void agentClient.closeTerminalSession({ sessionId }).then(() => {
          setToolTabs((current) => current.map((candidate) => (
            candidate.id === tab.id
            && candidate.kind === "terminal"
            && candidate.session?.sessionId === sessionId
              ? { ...candidate, session: null }
              : candidate
          )));
        }).catch(() => {
          // Cache eviction is best-effort. A later sweep retries a resource that could not close.
        }).finally(() => {
          releasingToolTabIdsRef.current.delete(tab.id);
        });
        continue;
      }
      const sessionId = tab.session.sessionId;
      void agentClient.closeManagedBrowser({ sessionId }).then(() => {
        setToolTabs((current) => current.map((candidate) => (
          candidate.id === tab.id
          && candidate.kind === "managed-browser"
          && candidate.session?.sessionId === sessionId
            ? { ...candidate, session: null }
            : candidate
        )));
      }).catch(() => {
        // Cache eviction is best-effort. A later sweep retries a resource that could not close.
      }).finally(() => {
        releasingToolTabIdsRef.current.delete(tab.id);
      });
    }
  }, [agentClient, retainedToolTabIds, toolTabs]);

  return { toolTabs, setToolTabs, retainedToolTabs };
}
