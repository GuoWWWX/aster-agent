import { useCallback, useEffect, useMemo, useState } from "react";

import type { ProjectSession } from "../projects/project-session-model.js";
import {
  retainedWorkspaceCacheIds,
  WORKSPACE_CACHE_MAX_RETAINED,
  WORKSPACE_CACHE_SWEEP_INTERVAL_MS,
  WORKSPACE_CACHE_TTL_MS,
} from "../workspace/workspace-cache-policy.js";

export const CONVERSATION_WORKSPACE_CACHE_MAX_RETAINED = WORKSPACE_CACHE_MAX_RETAINED;
export const CONVERSATION_WORKSPACE_CACHE_TTL_MS = WORKSPACE_CACHE_TTL_MS;

export type ConversationWorkspaceCacheEntry<T extends { id: string } = ProjectSession> = {
  lastAccessedAt: number;
  session: T;
};

export function retainConversationWorkspace<T extends { id: string }>(
  entries: readonly ConversationWorkspaceCacheEntry<T>[],
  activeSession: T | null,
  now: number,
  protectedSessionIds: ReadonlySet<string> = new Set(),
): readonly ConversationWorkspaceCacheEntry<T>[] {
  const activeSessionId = activeSession?.id ?? null;
  const ordered = activeSession === null
    ? [...entries]
    : [
        { lastAccessedAt: now, session: activeSession },
        ...entries.filter((entry) => entry.session.id !== activeSession.id),
      ];

  const retainedIds = retainedWorkspaceCacheIds(
    ordered.map((entry) => ({ id: entry.session.id, lastAccessedAt: entry.lastAccessedAt })),
    activeSessionId,
    now,
  );
  const retained = ordered.filter((entry) =>
    retainedIds.has(entry.session.id) || protectedSessionIds.has(entry.session.id)
  );
  return retained.length === entries.length && retained.every((entry, index) => entry === entries[index]) ? entries : retained;
}

export function conversationWorkspaceSessions<T extends { id: string }>(
  entries: readonly ConversationWorkspaceCacheEntry<T>[],
  activeSession: T | null,
  availableSessionIds: ReadonlySet<string> | null = null,
): readonly T[] {
  const availableActiveSession = activeSession;
  const cachedSessions = entries
    .filter((entry) => entry.session.id !== availableActiveSession?.id)
    .filter((entry) => availableSessionIds?.has(entry.session.id) ?? true)
    .map((entry) => entry.session);
  return availableActiveSession === null
    ? cachedSessions
    : [availableActiveSession, ...cachedSessions];
}

export function useConversationWorkspaceCache<T extends { id: string; isArchived?: boolean }>(
  activeSession: T | null,
  availableSessions?: readonly T[],
  protectedSessionIds?: readonly string[],
): readonly T[] {
  const availableSessionIds = useMemo(
    () => availableSessions === undefined
      ? null
      : new Set(
          availableSessions
            .filter((session) => !session.isArchived)
            .map((session) => session.id),
        ),
    [availableSessions],
  );
  const availableActiveSession = activeSession;
  const protectedIds = useMemo(
    () => new Set(protectedSessionIds ?? []),
    [protectedSessionIds],
  );
  const [entries, setEntries] = useState<readonly ConversationWorkspaceCacheEntry<T>[]>(() =>
    retainConversationWorkspace([], availableActiveSession, Date.now())
  );
  const retainEntries = useCallback((current: readonly ConversationWorkspaceCacheEntry<T>[]) => {
    const next = retainConversationWorkspace(
      current.filter((entry) => availableSessionIds?.has(entry.session.id) ?? true),
      availableActiveSession,
      Date.now(),
      protectedIds,
    );
    return next.length === current.length && next.every((entry, index) => entry === current[index]) ? current : next;
  }, [availableActiveSession, availableSessionIds, protectedIds]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setEntries(retainEntries);
    });
    return () => window.clearTimeout(timeout);
  }, [retainEntries]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setEntries(retainEntries);
    }, WORKSPACE_CACHE_SWEEP_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, [retainEntries]);

  return useMemo(
    () => conversationWorkspaceSessions(entries, availableActiveSession, availableSessionIds),
    [availableActiveSession, availableSessionIds, entries],
  );
}
