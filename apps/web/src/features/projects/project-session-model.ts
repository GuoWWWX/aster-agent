import type {
  ConversationSummary,
  ConversationRunStatus,
  ConversationThreadKind,
} from "@agent/protocol";

export type ProjectSession = {
  activeSubagentCount?: number;
  activeRunId: string | null;
  agentId: string | null;
  hasUnreadResult: boolean;
  id: string;
  isArchived: boolean;
  isPinned: boolean;
  lastRunStatus: ConversationRunStatus | null;
  parentConversationId: string | null;
  pinOrder?: number | null;
  projectId: string | null;
  subagentTaskStatus?: ConversationSummary["subagentTaskStatus"];
  teamId: string | null;
  threadKind: ConversationThreadKind;
  title: string;
  workspaceRootPath: string | null;
};

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
    hasUnreadResult: false,
    id,
    isArchived: false,
    isPinned: false,
    lastRunStatus: null,
    parentConversationId: null,
    pinOrder: null,
    projectId,
    teamId: null,
    threadKind: "agent",
    title: nextSessionNumber === 1 ? "新会话" : `新会话 ${nextSessionNumber}`,
    workspaceRootPath: null,
  };
}
