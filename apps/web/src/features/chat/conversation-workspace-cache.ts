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
): readonly ProjectSession[] {
  const cachedSessions = entries
    .filter((entry) => entry.session.id !== activeSession?.id)
    .map((entry) => entry.session);
  return activeSession === null
    ? cachedSessions
    : [activeSession, ...cachedSessions];
}

export function useConversationWorkspaceCache(
  activeSession: ProjectSession | null,
): readonly ProjectSession[] {
  const [entries, setEntries] = useState<ConversationWorkspaceCacheEntry[]>(() =>
    retainConversationWorkspace([], activeSession, Date.now())
  );

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setEntries((current) => retainConversationWorkspace(current, activeSession, Date.now()));
    });
    return () => window.clearTimeout(timeout);
  }, [activeSession]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setEntries((current) => retainConversationWorkspace(current, activeSession, Date.now()));
    }, 60_000);
    return () => window.clearInterval(interval);
  }, [activeSession]);

  return useMemo(
    () => conversationWorkspaceSessions(entries, activeSession),
    [activeSession, entries],
  );
}
