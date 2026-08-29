import type {
  ConversationSummary,
  ConversationRunEvent,
  ConversationRunStatus,
  ConversationThreadKind,
} from "@agent/protocol";

export type ProjectSession = {
  activeSideConversationCount?: number;
  activeSubagentCount?: number;
  activeRunId: string | null;
  agentId: string | null;
  avatarIcon?: ConversationSummary["avatarIcon"];
  hasFailedUnreadSideConversationResult?: boolean;
  hasUnreadResult: boolean;
  hasUnreadSideConversationResult?: boolean;
  id: string;
  isArchived: boolean;
  isPinned: boolean;
  lastRunStatus: ConversationRunStatus | null;
  modelSelection: ConversationSummary["modelSelection"];
  parentConversationId: string | null;
  pinOrder?: number | null;
  projectId: string | null;
  subagentTaskStatus?: ConversationSummary["subagentTaskStatus"];
  teamId: string | null;
  teamWorkItemId?: ConversationSummary["teamWorkItemId"];
  threadKind: ConversationThreadKind;
  title: string;
  workspaceRootPath: string | null;
};

type SessionRunEvent = Extract<
  ConversationRunEvent,
  { type: "run.finished" | "run.started" }
>;

function hasActiveRun(session: ProjectSession): boolean {
  return session.activeRunId !== null
    || session.lastRunStatus === "queued"
    || session.lastRunStatus === "running";
}

export function aggregateSideConversationState(
  sessions: readonly ProjectSession[],
): ProjectSession[] {
  const sideConversationsByParent = new Map<string, ProjectSession[]>();
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  for (const session of sessions) {
    const rootId = session.teamWorkItemId !== null && session.teamWorkItemId !== undefined
      ? resolveConversationRootId(session, sessionsById)
      : session.parentConversationId;
    if (
      rootId === null
      || (session.threadKind !== "agent"
        && (session.teamWorkItemId === null || session.teamWorkItemId === undefined))
    ) continue;
    const siblings = sideConversationsByParent.get(rootId) ?? [];
    siblings.push(session);
    sideConversationsByParent.set(rootId, siblings);
  }

  return sessions.map((session) => {
    if (session.parentConversationId !== null) return session;
    const sideConversations = sideConversationsByParent.get(session.id) ?? [];
    return {
      ...session,
      activeSideConversationCount: sideConversations.filter(hasActiveRun).length,
      hasFailedUnreadSideConversationResult: sideConversations.some(
        (sideConversation) => sideConversation.hasUnreadResult
          && sideConversation.lastRunStatus === "failed",
      ),
      hasUnreadSideConversationResult: sideConversations.some(
        (sideConversation) => sideConversation.hasUnreadResult,
      ),
    };
  });
}

export function getSessionFamilyResultIds(
  sessions: readonly ProjectSession[],
  sessionId: string,
): string[] {
  const selected = sessions.find((session) => session.id === sessionId);
  if (selected === undefined || selected.threadKind === "subagent") return [sessionId];
  const parentId = selected.parentConversationId ?? selected.id;
  return sessions.flatMap((session) =>
    session.id === parentId
      || (session.parentConversationId === parentId && session.threadKind === "agent")
      ? [session.id]
      : [],
  );
}

export function updateSessionRunState(
  sessions: readonly ProjectSession[],
  event: SessionRunEvent,
): ProjectSession[] {
  return sessions.map((session) => {
    if (session.id !== event.conversationId) return session;
    if (event.type === "run.started") {
      return {
        ...session,
        activeRunId: event.runId,
        hasUnreadResult: false,
        lastRunStatus: "running",
      };
    }
    return {
      ...session,
      activeRunId: null,
      hasUnreadResult: event.status === "completed" || event.status === "failed",
      lastRunStatus: event.status,
    };
  });
}

export function getProjectSessions(
  sessions: readonly ProjectSession[],
  projectId: string,
): ProjectSession[] {
  return sortPinnedSessions(
    sessions.filter(
      (session) =>
        !session.isArchived
        && session.parentConversationId === null
        && session.projectId === projectId,
    ),
  );
}

export function getTemporarySessions(
  sessions: readonly ProjectSession[],
): ProjectSession[] {
  return sortPinnedSessions(
    sessions.filter(
      (session) =>
        !session.isArchived
        && session.parentConversationId === null
        && session.projectId === null,
    ),
  );
}

export function getPinnedSessions(
  sessions: readonly ProjectSession[],
): ProjectSession[] {
  return sortPinnedSessions(
    sessions.filter(
      (session) =>
        !session.isArchived
        && session.parentConversationId === null
        && session.isPinned,
    ),
  );
}

export function getSubagentSessions(
  sessions: readonly ProjectSession[],
  parentConversationId: string,
): ProjectSession[] {
  return sessions.filter(
    (session) =>
      !session.isArchived
      && session.parentConversationId === parentConversationId
      && session.threadKind === "subagent",
  );
}

export function groupSubagentSessionsByParent(
  sessions: readonly ProjectSession[],
): Map<string, ProjectSession[]> {
  const grouped = new Map<string, ProjectSession[]>();
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  for (const session of sessions) {
    if (session.parentConversationId === null || session.isArchived) continue;
    if (session.teamWorkItemId !== null && session.teamWorkItemId !== undefined) {
      const rootId = resolveConversationRootId(session, sessionsById);
      if (rootId === null) continue;
      const members = grouped.get(rootId) ?? [];
      members.push(session);
      grouped.set(rootId, members);
      continue;
    }
    if (session.threadKind !== "subagent") continue;
    const subagents = grouped.get(session.parentConversationId) ?? [];
    subagents.push(session);
    grouped.set(session.parentConversationId, subagents);
  }
  return grouped;
}

function resolveConversationRootId(
  session: ProjectSession,
  sessionsById: ReadonlyMap<string, ProjectSession>,
): string | null {
  let current = session;
  const visited = new Set<string>();
  while (current.parentConversationId !== null) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    const parent = sessionsById.get(current.parentConversationId);
    if (parent === undefined) return null;
    current = parent;
  }
  return current.threadKind === "agent" ? current.id : null;
}

export function getArchivedSessions(
  sessions: readonly ProjectSession[],
): ProjectSession[] {
  return sortPinnedSessions(
    sessions.filter(
      (session) => session.isArchived && session.parentConversationId === null,
    ),
  );
}

function sortPinnedSessions(sessions: readonly ProjectSession[]): ProjectSession[] {
  return [...sessions].sort(
    (left, right) => Number(right.isPinned) - Number(left.isPinned),
  );
}

export function createProjectSession(
  projectId: string | null,
  sessions: readonly ProjectSession[],
  id: string,
): ProjectSession {
  const nextSessionNumber =
    (projectId === null
      ? getTemporarySessions(sessions)
      : getProjectSessions(sessions, projectId)
    ).length + 1;

  return {
    activeSubagentCount: 0,
    activeRunId: null,
    agentId: null,
    avatarIcon: null,
    hasUnreadResult: false,
    id,
    isArchived: false,
    isPinned: false,
    lastRunStatus: null,
    modelSelection: null,
    parentConversationId: null,
    pinOrder: null,
    projectId,
    teamId: null,
    teamWorkItemId: null,
    threadKind: "agent",
    title: nextSessionNumber === 1 ? "新会话" : `新会话 ${nextSessionNumber}`,
    workspaceRootPath: null,
  };
}
