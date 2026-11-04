export const WORKSPACE_CACHE_TTL_MS = 60 * 60_000;
export const WORKSPACE_CACHE_MAX_RETAINED = 8;
export const WORKSPACE_CACHE_SWEEP_INTERVAL_MS = 60_000;

export type WorkspaceCacheCandidate = {
  id: string;
  lastAccessedAt: number;
};

export function retainedWorkspaceCacheIds(
  candidates: readonly WorkspaceCacheCandidate[],
  activeId: string | null,
  now: number,
): ReadonlySet<string> {
  const ordered = candidates
    .filter((candidate) => candidate.id === activeId || now - candidate.lastAccessedAt < WORKSPACE_CACHE_TTL_MS)
    .sort((left, right) => {
      if (left.id === activeId) return -1;
      if (right.id === activeId) return 1;
      return right.lastAccessedAt - left.lastAccessedAt;
    });
  return new Set(ordered.slice(0, WORKSPACE_CACHE_MAX_RETAINED).map((candidate) => candidate.id));
}
