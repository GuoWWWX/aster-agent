import { useEffect, useMemo, useState } from "react";

import type { ProjectSession } from "../projects/project-session-model.js";

export const CONVERSATION_WORKSPACE_CACHE_MIN_RETAINED = 3;
export const CONVERSATION_WORKSPACE_CACHE_TTL_MS = 60 * 60_000;

export type ConversationWorkspaceCacheEntry = {
  lastAccessedAt: number;
  session: ProjectSession;
};

export function retainConversationWorkspace(
  entries: readonly ConversationWorkspaceCacheEntry[],
  activeSession: ProjectSession | null,
  now: number,
): ConversationWorkspaceCacheEntry[] {
  const activeSessionId = activeSession?.id ?? null;
  const ordered = activeSession === null
    ? [...entries]
    : [
        { lastAccessedAt: now, session: activeSession },
        ...entries.filter((entry) => entry.session.id !== activeSession.id),
      ];

  return ordered.filter((entry, index) =>
    index < CONVERSATION_WORKSPACE_CACHE_MIN_RETAINED
    || entry.session.id === activeSessionId
    || now - entry.lastAccessedAt < CONVERSATION_WORKSPACE_CACHE_TTL_MS
  );
}

export function conversationWorkspaceSessions(
  entries: readonly ConversationWorkspaceCacheEntry[],
  activeSession: ProjectSession | null,
  availableSessionIds: ReadonlySet<string> | null = null,
): readonly ProjectSession[] {
  const availableActiveSession = activeSession;
  const cachedSessions = entries
    .filter((entry) => entry.session.id !== availableActiveSession?.id)
    .filter((entry) => availableSessionIds?.has(entry.session.id) ?? true)
    .map((entry) => entry.session);
  return availableActiveSession === null
    ? cachedSessions
    : [availableActiveSession, ...cachedSessions];
}

export function useConversationWorkspaceCache(
  activeSession: ProjectSession | null,
  availableSessions?: readonly ProjectSession[],
): readonly ProjectSession[] {
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
  const [entries, setEntries] = useState<ConversationWorkspaceCacheEntry[]>(() =>
    retainConversationWorkspace([], availableActiveSession, Date.now())
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setEntries((current) => retainConversationWorkspace(
        current.filter((entry) => availableSessionIds?.has(entry.session.id) ?? true),
        availableActiveSession,
        Date.now(),
      ));
    });
    return () => window.clearTimeout(timeout);
  }, [availableActiveSession, availableSessionIds]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setEntries((current) => retainConversationWorkspace(
        current.filter((entry) => availableSessionIds?.has(entry.session.id) ?? true),
        availableActiveSession,
        Date.now(),
      ));
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [availableActiveSession, availableSessionIds]);

  return useMemo(
    () => conversationWorkspaceSessions(entries, availableActiveSession, availableSessionIds),
    [availableActiveSession, availableSessionIds, entries],
  );
}
