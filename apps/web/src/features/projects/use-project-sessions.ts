import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { ConversationSummary } from "@agent/protocol";

import type { AgentClient } from "../../runtime/index.js";
import {
  aggregateSideConversationState,
  getSessionFamilyResultIds,
  getProjectSessions,
  getTemporarySessions,
  updateSessionRunState,
  type ProjectSession,
} from "./project-session-model.js";

export type ProjectSessionsController = {
  activeSession: ProjectSession | null;
  activeSessionId: string | null;
  createProjectSession(projectId?: string): Promise<void>;
  createTemporarySession(): Promise<void>;
  deleteSession(sessionId: string): Promise<boolean>;
  discardProjectSessions(projectId: string): void;
  isCreatingSession: boolean;
  isLoadingSessions: boolean;
  operationError: string | null;
  markSessionResultViewed(sessionId: string): void;
  renameSession(sessionId: string, title: string): Promise<boolean>;
  reorderSessions(sessionIds: string[]): Promise<boolean>;
  sessions: ProjectSession[];
  clearOperationError(): void;
  selectProject(projectId: string): void;
  selectSession(sessionId: string): void;
  setSessionArchived(sessionId: string, archived: boolean): Promise<boolean>;
  setSessionPinned(sessionId: string, pinned: boolean): Promise<boolean>;
  updateSession(conversation: ConversationSummary): void;
};

function toProjectSession(conversation: ConversationSummary): ProjectSession {
  return {
    activeSubagentCount: conversation.activeSubagentCount,
    activeRunId: conversation.activeRunId,
    agentId: conversation.agentId,
    avatarIcon: conversation.avatarIcon ?? null,
    hasUnreadResult: conversation.hasUnreadResult,
    id: conversation.id,
    isArchived: conversation.isArchived,
    isPinned: conversation.isPinned,
    lastRunStatus: conversation.lastRunStatus,
    modelSelection: conversation.modelSelection,
    parentConversationId: conversation.parentConversationId,
    pinOrder: conversation.pinOrder ?? null,
    projectId: conversation.projectId,
    subagentTaskStatus: conversation.subagentTaskStatus,
    teamId: conversation.teamId,
    threadKind: conversation.threadKind,
    title: conversation.title,
    workspaceRootPath: conversation.workspaceRootPath,
  };
}

async function listSessionHierarchy(agentClient: AgentClient): Promise<ProjectSession[]> {
  const conversations = await agentClient.listConversations();
  const forks = await Promise.all(
    conversations.map((conversation) =>
      agentClient.listConversationForks({ conversationId: conversation.id }),
    ),
  );
  return [...conversations, ...forks.flat()].map(toProjectSession);
}

export function useProjectSessions(
  agentClient: AgentClient,
  activeProjectId: string | null,
): ProjectSessionsController {
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<ProjectSession[]>([]);
  const sessionsRef = useRef<ProjectSession[]>([]);
  const sessionsWithSideConversationState = useMemo(
    () => aggregateSideConversationState(sessions),
    [sessions],
  );

  const activeProjectSessions = useMemo(
    () =>
      activeProjectId === null
        ? []
        : getProjectSessions(sessionsWithSideConversationState, activeProjectId),
    [activeProjectId, sessionsWithSideConversationState],
  );
  const temporarySessions = useMemo(
    () => getTemporarySessions(sessionsWithSideConversationState),
    [sessionsWithSideConversationState],
  );
  const currentSessions = activeProjectId === null ? temporarySessions : activeProjectSessions;
  const activeSession = useMemo(
    () =>
      sessionsWithSideConversationState.find(
        (session) => !session.isArchived && session.id === activeSessionId,
      ) ??
      currentSessions[0] ??
      null,
    [activeSessionId, currentSessions, sessionsWithSideConversationState],
  );
  const activeSessionIdRef = useRef<string | null>(null);

  useEffect(() => {
    activeSessionIdRef.current = activeSession?.id ?? null;
  }, [activeSession?.id]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const markSessionResultViewed = useCallback(
    async (sessionId: string): Promise<void> => {
      const familyIds = getSessionFamilyResultIds(sessionsRef.current, sessionId);
      const familyIdSet = new Set(familyIds);
      if (!sessionsRef.current.some(
        (session) => familyIdSet.has(session.id) && session.hasUnreadResult,
      )) return;
      const viewedSessions = (await Promise.all(familyIds.map(async (conversationId) => {
        try {
          return toProjectSession(await agentClient.markConversationResultViewed({
            conversationId,
          }));
        } catch {
          return null;
        }
      }))).filter((session): session is ProjectSession => session !== null);
      if (viewedSessions.length === 0) return;
      const viewedById = new Map(viewedSessions.map((session) => [session.id, session]));
      setSessions((current) => current.map(
        (candidate) => viewedById.get(candidate.id) ?? candidate,
      ));
    },
    [agentClient],
  );

  const loadSessions = useCallback(async (): Promise<void> => {
    try {
      setSessions(await listSessionHierarchy(agentClient));
    } catch {
      setOperationError("无法加载会话列表");
    } finally {
      setIsLoadingSessions(false);
    }
  }, [agentClient]);

  useEffect(() => {
    void Promise.resolve().then(loadSessions);
  }, [loadSessions]);

  useEffect(() => {
    return agentClient.onConversationRunEvent((event) => {
      if (event.type === "run.started") {
        setSessions((current) => updateSessionRunState(current, event));
        return;
      }
      if (event.type === "run.finished") {
        setSessions((current) => updateSessionRunState(current, event));
        return;
      }
      if (event.type !== "conversation.updated") return;

      const session = toProjectSession(event.conversation);
      setSessions((current) => {
        const existingIndex = current.findIndex(
          (candidate) => candidate.id === session.id,
        );
        if (existingIndex < 0) {
          return session.parentConversationId === null
            ? [session, ...current]
            : [...current, session];
        }

        return current.map((candidate) =>
          candidate.id === session.id ? session : candidate,
        );
      });
    });
  }, [agentClient]);

  const createSession = useCallback(async (projectId: string | null): Promise<void> => {
    if (isCreatingSession) {
      return;
    }

    setIsCreatingSession(true);
    setOperationError(null);
    try {
      const conversation = await agentClient.createConversation({
        projectId,
      });
      const session = toProjectSession(conversation);
      setSessions((current) => [
        session,
        ...current.filter((candidate) => candidate.id !== session.id),
      ]);
      activeSessionIdRef.current = session.id;
      setActiveSessionId(session.id);
    } catch {
      setOperationError("无法创建会话");
    } finally {
      setIsCreatingSession(false);
    }
  }, [agentClient, isCreatingSession]);

  const updateSession = useCallback((conversation: ConversationSummary): void => {
    const session = toProjectSession(conversation);
    setSessions((current) => current.some((candidate) => candidate.id === session.id)
      ? current.map((candidate) => candidate.id === session.id ? session : candidate)
      : session.parentConversationId === null
        ? [session, ...current]
        : [...current, session]);
  }, []);

  const renameSession = useCallback(async (
    sessionId: string,
    title: string,
  ): Promise<boolean> => {
    setOperationError(null);
    try {
      updateSession(await agentClient.renameConversation({ conversationId: sessionId, title }));
      return true;
    } catch {
      setOperationError("无法重命名对话");
      return false;
    }
  }, [agentClient, updateSession]);

  const reorderSessions = useCallback(async (conversationIds: string[]): Promise<boolean> => {
    setOperationError(null);
    try {
      await agentClient.reorderConversations({ conversationIds });
      setSessions(await listSessionHierarchy(agentClient));
      return true;
    } catch {
      setOperationError("无法调整对话顺序");
      return false;
    }
  }, [agentClient]);

  const setSessionPinned = useCallback(async (
    sessionId: string,
    pinned: boolean,
  ): Promise<boolean> => {
    setOperationError(null);
    try {
      await agentClient.setConversationPinned({
        conversationId: sessionId,
        pinned,
      });
      setSessions(await listSessionHierarchy(agentClient));
      return true;
    } catch {
      setOperationError(pinned ? "无法置顶对话" : "无法取消置顶");
      return false;
    }
  }, [agentClient]);

  const setSessionArchived = useCallback(async (
    sessionId: string,
    archived: boolean,
  ): Promise<boolean> => {
    setOperationError(null);
    try {
      updateSession(await agentClient.setConversationArchived({
        archived,
        conversationId: sessionId,
      }));
      if (archived && activeSessionIdRef.current === sessionId) {
        activeSessionIdRef.current = null;
        setActiveSessionId(null);
      }
      return true;
    } catch {
      setOperationError(archived ? "无法归档对话" : "无法恢复对话");
      return false;
    }
  }, [agentClient, updateSession]);

  const deleteSession = useCallback(async (sessionId: string): Promise<boolean> => {
    setOperationError(null);
    try {
      await agentClient.deleteConversation({ conversationId: sessionId });
      setSessions((current) => current.filter(
        (session) =>
          session.id !== sessionId && session.parentConversationId !== sessionId,
      ));
      if (activeSessionIdRef.current === sessionId) {
        activeSessionIdRef.current = null;
        setActiveSessionId(null);
      }
      return true;
    } catch {
      setOperationError("无法删除对话");
      return false;
    }
  }, [agentClient]);

  const selectSession = useCallback(
    (sessionId: string): void => {
      activeSessionIdRef.current = sessionId;
      setActiveSessionId(sessionId);
      void markSessionResultViewed(sessionId);
    },
    [markSessionResultViewed],
  );

  const selectProject = useCallback(
    (projectId: string): void => {
      const nextSessionId =
        getProjectSessions(sessions, projectId)[0]?.id ?? null;
      activeSessionIdRef.current = nextSessionId;
      setActiveSessionId(nextSessionId);
      if (nextSessionId !== null) {
        void markSessionResultViewed(nextSessionId);
      }
    },
    [markSessionResultViewed, sessions],
  );

  return {
    activeSession,
    activeSessionId: activeSession?.id ?? null,
    clearOperationError: () => setOperationError(null),
    createProjectSession: (projectId = activeProjectId ?? undefined) =>
      projectId === undefined
        ? Promise.resolve()
        : createSession(projectId),
    createTemporarySession: () => createSession(null),
    deleteSession,
    discardProjectSessions: (projectId) => {
      setSessions((current) => current.filter((session) => session.projectId !== projectId));
    },
    isCreatingSession,
    isLoadingSessions,
    markSessionResultViewed: (sessionId) => void markSessionResultViewed(sessionId),
    operationError,
    renameSession,
    reorderSessions,
    selectProject,
    selectSession,
    setSessionArchived,
    setSessionPinned,
    sessions: sessionsWithSideConversationState,
    updateSession,
  };
}
