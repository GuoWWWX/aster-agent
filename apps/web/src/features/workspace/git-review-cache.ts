import type {
  GitFileDiff,
  GitFileDiffInput,
  GitReviewInput,
  GitReviewSnapshot,
  GitWorkingTreeChange,
} from "@agent/protocol";

export const GIT_REVIEW_PREFETCH_CONCURRENCY = 2;
export const GIT_REVIEW_PREFETCH_LIMIT = 20;
export const GIT_REVIEW_CACHE_MAX_PROJECTS = 4;
export const GIT_REVIEW_CACHE_PROJECT_TTL_MS = 30 * 60_000;
export const GIT_REVIEW_CACHE_MAX_DIFF_BYTES = 32 * 1024 * 1024;
export const GIT_REVIEW_SNAPSHOT_FRESH_MS = 30_000;
export const GIT_REVIEW_FILE_CHANGE_DEBOUNCE_MS = 250;

const DEFAULT_DIFF_CONTEXT_LINES = 3;

export interface GitReviewDataSource {
  getGitFileDiff(input: GitFileDiffInput): Promise<GitFileDiff>;
  getGitReviewSnapshot(input: GitReviewInput): Promise<GitReviewSnapshot>;
}

export type GitReviewCacheOptions = {
  fileChangeDebounceMs?: number;
  maxDiffBytes?: number;
  maxProjects?: number;
  now?: () => number;
  prefetchConcurrency?: number;
  prefetchLimit?: number;
  projectTtlMs?: number;
  snapshotFreshMs?: number;
};

type CachedDiff = {
  lastAccessedAt: number;
  sizeBytes: number;
  value: GitFileDiff;
};

type ProjectCacheEntry = {
  diffs: Map<string, CachedDiff>;
  diffRequests: Map<string, Promise<GitFileDiff>>;
  fileVersions: Map<string, number>;
  lastAccessedAt: number;
  pendingChangedPaths: Set<string>;
  prefetchVersion: number;
  projectId: string;
  refreshTimer: ReturnType<typeof setTimeout> | null;
  snapshot: GitReviewSnapshot | null;
  snapshotInvalidatesDiffs: Set<number>;
  snapshotLoadedAt: number | null;
  snapshotLoadedVersion: number;
  snapshotRequests: Map<number, Promise<GitReviewSnapshot>>;
  snapshotVersion: number;
};

type ResolvedGitReviewCacheOptions = {
  fileChangeDebounceMs: number;
  maxDiffBytes: number;
  maxProjects: number;
  now: () => number;
  prefetchConcurrency: number;
  prefetchLimit: number;
  projectTtlMs: number;
  snapshotFreshMs: number;
};

const sharedCaches = new WeakMap<object, GitReviewCache>();

function diffCacheKey(path: string, contextLines: number): string {
  return `${contextLines}:${path}`;
}

function diffPathFromCacheKey(key: string): string {
  const separator = key.indexOf(":");
  return separator === -1 ? key : key.slice(separator + 1);
}

function estimatedDiffBytes(diff: GitFileDiff): number {
  return diff.content.length * 2;
}

export function backgroundDiffPaths(
  changes: readonly GitWorkingTreeChange[],
  limit = GIT_REVIEW_PREFETCH_LIMIT,
  prioritizedPaths: readonly string[] = [],
): string[] {
  const textualPaths = new Set(changes
    .filter((change) => change.additions !== null && change.deletions !== null)
    .map((change) => change.path));
  const paths = new Set<string>();
  for (const path of prioritizedPaths) {
    if (textualPaths.has(path)) paths.add(path);
    if (paths.size === limit) return [...paths];
  }
  for (const change of changes) {
    if (!textualPaths.has(change.path)) continue;
    paths.add(change.path);
    if (paths.size === limit) break;
  }
  return [...paths];
}

export function getGitReviewCache(dataSource: GitReviewDataSource): GitReviewCache {
  const key = dataSource as object;
  const existing = sharedCaches.get(key);
  if (existing !== undefined) return existing;
  const cache = new GitReviewCache(dataSource);
  sharedCaches.set(key, cache);
  return cache;
}

export class GitReviewCache {
  private activeProjectId: string | null = null;
  private readonly dataSource: GitReviewDataSource;
  private readonly listeners = new Map<string, Set<(snapshot: GitReviewSnapshot) => void>>();
  private readonly options: ResolvedGitReviewCacheOptions;
  private readonly projects = new Map<string, ProjectCacheEntry>();

  public constructor(dataSource: GitReviewDataSource, options: GitReviewCacheOptions = {}) {
    this.dataSource = dataSource;
    this.options = {
      fileChangeDebounceMs: options.fileChangeDebounceMs ?? GIT_REVIEW_FILE_CHANGE_DEBOUNCE_MS,
      maxDiffBytes: options.maxDiffBytes ?? GIT_REVIEW_CACHE_MAX_DIFF_BYTES,
      maxProjects: Math.max(1, options.maxProjects ?? GIT_REVIEW_CACHE_MAX_PROJECTS),
      now: options.now ?? Date.now,
      prefetchConcurrency: Math.max(1, options.prefetchConcurrency ?? GIT_REVIEW_PREFETCH_CONCURRENCY),
      prefetchLimit: Math.max(1, options.prefetchLimit ?? GIT_REVIEW_PREFETCH_LIMIT),
      projectTtlMs: options.projectTtlMs ?? GIT_REVIEW_CACHE_PROJECT_TTL_MS,
      snapshotFreshMs: options.snapshotFreshMs ?? GIT_REVIEW_SNAPSHOT_FRESH_MS,
    };
  }

  public activateProject(projectId: string | null): void {
    this.activeProjectId = projectId;
    if (projectId !== null) this.touch(this.ensureProject(projectId));
    this.enforceProjectLimit();
  }

  public peekSnapshot(projectId: string): GitReviewSnapshot | null {
    const entry = this.projects.get(projectId);
    if (entry?.snapshot === null || entry === undefined) return null;
    this.touch(entry);
    return entry.snapshot;
  }

  public peekFileDiff(
    projectId: string,
    path: string,
    contextLines = DEFAULT_DIFF_CONTEXT_LINES,
  ): GitFileDiff | null {
    const entry = this.projects.get(projectId);
    const cached = entry?.diffs.get(diffCacheKey(path, contextLines));
    if (entry === undefined || cached === undefined) return null;
    const now = this.options.now();
    entry.lastAccessedAt = now;
    cached.lastAccessedAt = now;
    return cached.value;
  }

  public async warmProject(
    projectId: string,
    prioritizedPaths: readonly string[] = [],
  ): Promise<GitReviewSnapshot> {
    const entry = this.ensureProject(projectId);
    this.touch(entry);
    const now = this.options.now();
    const versionChanged = entry.snapshotLoadedVersion !== entry.snapshotVersion;
    const timeExpired = entry.snapshotLoadedAt !== null
      && now - entry.snapshotLoadedAt >= this.options.snapshotFreshMs;
    let next = entry.snapshot;
    if (next === null || versionChanged || timeExpired) {
      if (timeExpired && !versionChanged) entry.snapshotVersion += 1;
      next = await this.requestSnapshot(entry, timeExpired);
    }
    void this.prefetch(entry, next, prioritizedPaths);
    return next;
  }

  public async refreshProject(
    projectId: string,
    options: { invalidateDiffs?: boolean; prioritizedPaths?: readonly string[] } = {},
  ): Promise<GitReviewSnapshot> {
    const entry = this.ensureProject(projectId);
    this.cancelPendingRefresh(entry);
    entry.snapshotVersion += 1;
    const next = await this.requestSnapshot(entry, options.invalidateDiffs ?? false);
    void this.prefetch(entry, next, options.prioritizedPaths ?? []);
    return next;
  }

  public replaceSnapshot(
    projectId: string,
    snapshot: GitReviewSnapshot,
    options: { invalidateDiffs?: boolean; prioritizedPaths?: readonly string[] } = {},
  ): void {
    const entry = this.ensureProject(projectId);
    this.cancelPendingRefresh(entry);
    entry.snapshotVersion += 1;
    if (options.invalidateDiffs === true) this.clearDiffs(entry);
    this.storeSnapshot(entry, snapshot);
    void this.prefetch(entry, snapshot, options.prioritizedPaths ?? []);
  }

  public async getFileDiff(
    projectId: string,
    path: string,
    contextLines = DEFAULT_DIFF_CONTEXT_LINES,
  ): Promise<GitFileDiff> {
    const entry = this.ensureProject(projectId);
    this.touch(entry);
    const cacheKey = diffCacheKey(path, contextLines);
    const cached = entry.diffs.get(cacheKey);
    if (cached !== undefined) {
      cached.lastAccessedAt = this.options.now();
      return cached.value;
    }

    const fileVersion = entry.fileVersions.get(path) ?? 0;
    entry.fileVersions.set(path, fileVersion);
    const requestKey = `${fileVersion}:${cacheKey}`;
    const inFlight = entry.diffRequests.get(requestKey);
    if (inFlight !== undefined) return inFlight;

    const request = this.dataSource.getGitFileDiff({ contextLines, path, projectId }).then((next) => {
      if (
        this.projects.get(projectId) !== entry
        || (entry.fileVersions.get(path) ?? 0) !== fileVersion
      ) {
        return this.getFileDiff(projectId, path, contextLines);
      }
      entry.diffs.set(cacheKey, {
        lastAccessedAt: this.options.now(),
        sizeBytes: estimatedDiffBytes(next),
        value: next,
      });
      this.touch(entry);
      this.enforceDiffByteLimit();
      return next;
    }).finally(() => {
      entry.diffRequests.delete(requestKey);
    });
    entry.diffRequests.set(requestKey, request);
    return request;
  }

  public noteFileChange(projectId: string, path: string): void {
    const entry = this.ensureProject(projectId);
    this.invalidateFile(entry, path);
    entry.snapshotVersion += 1;
    entry.pendingChangedPaths.add(path);
    this.touch(entry);
    if (entry.refreshTimer !== null) clearTimeout(entry.refreshTimer);
    entry.refreshTimer = setTimeout(() => {
      entry.refreshTimer = null;
      const prioritizedPaths = [...entry.pendingChangedPaths];
      entry.pendingChangedPaths.clear();
      void this.requestSnapshot(entry, false).then((next) => {
        void this.prefetch(entry, next, prioritizedPaths);
      }).catch(() => {
        // The active Git workspace reports foreground failures; warming must stay non-blocking.
      });
    }, this.options.fileChangeDebounceMs);
  }

  public subscribe(
    projectId: string,
    listener: (snapshot: GitReviewSnapshot) => void,
  ): () => void {
    const listeners = this.listeners.get(projectId) ?? new Set();
    listeners.add(listener);
    this.listeners.set(projectId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(projectId);
    };
  }

  public sweep(now = this.options.now()): void {
    for (const [projectId, entry] of this.projects) {
      if (
        projectId !== this.activeProjectId
        && now - entry.lastAccessedAt >= this.options.projectTtlMs
      ) {
        this.removeProject(projectId, entry);
      }
    }
    this.enforceProjectLimit();
    this.enforceDiffByteLimit();
  }

  private ensureProject(projectId: string): ProjectCacheEntry {
    const existing = this.projects.get(projectId);
    if (existing !== undefined) return existing;
    const entry: ProjectCacheEntry = {
      diffs: new Map(),
      diffRequests: new Map(),
      fileVersions: new Map(),
      lastAccessedAt: this.options.now(),
      pendingChangedPaths: new Set(),
      prefetchVersion: 0,
      projectId,
      refreshTimer: null,
      snapshot: null,
      snapshotInvalidatesDiffs: new Set(),
      snapshotLoadedAt: null,
      snapshotLoadedVersion: -1,
      snapshotRequests: new Map(),
      snapshotVersion: 0,
    };
    this.projects.set(projectId, entry);
    this.enforceProjectLimit();
    return entry;
  }

  private touch(entry: ProjectCacheEntry): void {
    entry.lastAccessedAt = this.options.now();
  }

  private requestSnapshot(
    entry: ProjectCacheEntry,
    invalidateDiffs: boolean,
  ): Promise<GitReviewSnapshot> {
    const version = entry.snapshotVersion;
    if (invalidateDiffs) entry.snapshotInvalidatesDiffs.add(version);
    const existing = entry.snapshotRequests.get(version);
    if (existing !== undefined) return existing;

    if (this.projects.get(entry.projectId) !== entry) {
      return Promise.reject(new Error("Git review cache entry is no longer available."));
    }

    const request = this.dataSource.getGitReviewSnapshot({ projectId: entry.projectId }).then((next) => {
      if (this.projects.get(entry.projectId) !== entry) return next;
      if (entry.snapshotVersion !== version) {
        if (entry.snapshot !== null && entry.snapshotLoadedVersion === entry.snapshotVersion) {
          return entry.snapshot;
        }
        return this.requestSnapshot(entry, entry.snapshotInvalidatesDiffs.has(version));
      }
      if (entry.snapshotInvalidatesDiffs.has(version)) this.clearDiffs(entry);
      this.storeSnapshot(entry, next);
      return next;
    }).finally(() => {
      entry.snapshotInvalidatesDiffs.delete(version);
      entry.snapshotRequests.delete(version);
    });
    entry.snapshotRequests.set(version, request);
    return request;
  }

  private storeSnapshot(entry: ProjectCacheEntry, snapshot: GitReviewSnapshot): void {
    entry.snapshot = snapshot;
    entry.snapshotLoadedAt = this.options.now();
    entry.snapshotLoadedVersion = entry.snapshotVersion;
    this.touch(entry);
    this.emitSnapshot(snapshot);
  }

  private emitSnapshot(snapshot: GitReviewSnapshot): void {
    for (const listener of this.listeners.get(snapshot.projectId) ?? []) listener(snapshot);
  }

  private async prefetch(
    entry: ProjectCacheEntry,
    snapshot: GitReviewSnapshot,
    prioritizedPaths: readonly string[],
  ): Promise<void> {
    const paths = backgroundDiffPaths(snapshot.changes, this.options.prefetchLimit, prioritizedPaths);
    if (paths.length === 0) return;
    const prefetchVersion = entry.prefetchVersion + 1;
    entry.prefetchVersion = prefetchVersion;
    let cursor = 0;
    const worker = async (): Promise<void> => {
      while (entry.prefetchVersion === prefetchVersion) {
        const path = paths[cursor];
        cursor += 1;
        if (path === undefined) return;
        try {
          await this.getFileDiff(snapshot.projectId, path, DEFAULT_DIFF_CONTEXT_LINES);
        } catch {
          // A selected file surfaces its own error; background warming stays silent.
        }
      }
    };
    await Promise.all(Array.from(
      { length: Math.min(this.options.prefetchConcurrency, paths.length) },
      () => worker(),
    ));
  }

  private invalidateFile(entry: ProjectCacheEntry, path: string): void {
    entry.fileVersions.set(path, (entry.fileVersions.get(path) ?? 0) + 1);
    for (const key of entry.diffs.keys()) {
      if (diffPathFromCacheKey(key) === path) entry.diffs.delete(key);
    }
  }

  private clearDiffs(entry: ProjectCacheEntry): void {
    entry.prefetchVersion += 1;
    entry.diffs.clear();
    for (const path of entry.fileVersions.keys()) {
      entry.fileVersions.set(path, (entry.fileVersions.get(path) ?? 0) + 1);
    }
  }

  private cancelPendingRefresh(entry: ProjectCacheEntry): void {
    if (entry.refreshTimer !== null) clearTimeout(entry.refreshTimer);
    entry.refreshTimer = null;
    entry.pendingChangedPaths.clear();
  }

  private removeProject(projectId: string, entry: ProjectCacheEntry): void {
    this.cancelPendingRefresh(entry);
    entry.prefetchVersion += 1;
    this.projects.delete(projectId);
  }

  private enforceProjectLimit(): void {
    if (this.projects.size <= this.options.maxProjects) return;
    const candidates = [...this.projects.entries()]
      .filter(([projectId]) => projectId !== this.activeProjectId)
      .sort((left, right) => left[1].lastAccessedAt - right[1].lastAccessedAt);
    for (const [projectId, entry] of candidates) {
      if (this.projects.size <= this.options.maxProjects) break;
      this.removeProject(projectId, entry);
    }
  }

  private enforceDiffByteLimit(): void {
    const candidates = [...this.projects.entries()].flatMap(([projectId, entry]) => (
      [...entry.diffs.entries()].map(([key, cached]) => ({ cached, entry, key, projectId }))
    ));
    let totalBytes = candidates.reduce((total, candidate) => total + candidate.cached.sizeBytes, 0);
    if (totalBytes <= this.options.maxDiffBytes) return;
    candidates.sort((left, right) => {
      const leftActive = left.projectId === this.activeProjectId ? 1 : 0;
      const rightActive = right.projectId === this.activeProjectId ? 1 : 0;
      return leftActive - rightActive || left.cached.lastAccessedAt - right.cached.lastAccessedAt;
    });
    for (const candidate of candidates) {
      if (totalBytes <= this.options.maxDiffBytes) break;
      if (!candidate.entry.diffs.delete(candidate.key)) continue;
      totalBytes -= candidate.cached.sizeBytes;
    }
  }
}
