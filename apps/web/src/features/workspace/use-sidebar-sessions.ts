import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { ConversationSummary, TeamInstanceView } from "@agent/protocol";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { teamChatTabId } from "../chat/workbench-tabs.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import {
  isAutoOpenedSideConversation,
  isDirectTeamMemberConversation,
  isManagedTeamMember,
  shouldLoadSideConversations,
  toProjectSession,
  updateSideSessionsForRunEvent,
  upsertSideSession,
  type TeamMembership,
} from "./sidebar-conversation-model.js";
import { isSettingsWorkspaceTabId } from "./sidebar-tab-model.js";
import type { TeamMemberOpenRequest } from "./sidebar-workspace-types.js";

async function listSideConversations(
  agentClient: AgentClient,
  sourceConversation: ProjectSession,
  team: TeamMembership | null,
): Promise<{ autoOpenIds: Set<string>; sessions: ProjectSession[] }> {
  const directChildren = await agentClient.listConversationForks({
    conversationId: sourceConversation.id,
  });
  const ordinarySideChats = directChildren.filter(
    (conversation) => isAutoOpenedSideConversation(conversation, sourceConversation, team),
  );
  return {
    autoOpenIds: new Set(ordinarySideChats.map((conversation) => conversation.id)),
    sessions: ordinarySideChats.map(toProjectSession),
  };
}

/** Owns side-conversation membership and each source workspace's remembered selection. */
export function useSidebarSessions({
  agentClient,
  activeSession,
  teamChat,
  teamMemberOpenRequest,
  onSessionUpdated,
  setFilePanelOpen,
  setIsFileBrowserOpen,
  setOperationError,
}: {
  agentClient: AgentClient;
  activeSession: ProjectSession | null;
  teamChat: TeamInstanceView | null;
  teamMemberOpenRequest: TeamMemberOpenRequest | null;
  onSessionUpdated: (conversation: ConversationSummary) => void;
  setFilePanelOpen: (open: boolean) => void;
  setIsFileBrowserOpen: (open: boolean) => void;
  setOperationError: (error: string | null) => void;
}) {
  const activeActivity = useWorkbenchUiStore(state => state.activeActivity);
  const coordinationTarget = useWorkbenchUiStore(state => state.teamChatCoordinationTarget);
  const teams = useAgentDirectoryStore(state => state.teams);
  const activeSessionId = activeSession?.id ?? null;
  const workspaceId = teamChat === null ? activeSessionId : teamChatTabId(teamChat.id);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const coordinationSessions = useRef(new Map<string, ProjectSession>());
  const [coordinationLocation, setCoordinationLocation] = useState<{ conversationId: string; id: string; requestId: number } | null>(null);
  const coordinationLocateSequence = useRef(0);
  const handledCoordinationRequest = useRef<string | null>(null);
  const [openChatIds, setOpenChatIds] = useState<Set<string>>(() => new Set());
  const openChatIdsRef = useRef(openChatIds);
  const [sideSessions, setSideSessions] = useState<ProjectSession[]>([]);
  const handledTeamMemberOpenRequestIdRef = useRef<number | null>(null);
  const teamMemberOpenRequestRef = useRef(teamMemberOpenRequest);
  const activeTabIdsBySessionRef = useRef(new Map<string, string | null>());
  const activeTabOwnerRef = useRef<string | null>(workspaceId);
  const openChatIdsBySessionRef = useRef(new Map<string, Set<string>>());
  const activeTeam = activeSession?.teamId === null || activeSession === null
    ? null
    : teams.find((team) => team.id === activeSession.teamId) ?? null;
  useLayoutEffect(() => {
    openChatIdsRef.current = openChatIds;
    teamMemberOpenRequestRef.current = teamMemberOpenRequest;
  }, [openChatIds, teamMemberOpenRequest]);

  const updateOpenChatIds = useCallback(
    (update: (current: Set<string>) => Set<string>): void => {
      const current = workspaceId === null ? openChatIdsRef.current : openChatIdsBySessionRef.current.get(workspaceId) ?? openChatIdsRef.current;
      const next = update(current);
      openChatIdsRef.current = next;
      if (workspaceId !== null) openChatIdsBySessionRef.current.set(workspaceId, next);
      setOpenChatIds(next);
    },
    [workspaceId],
  );
  const setActiveTabForCurrentSession = useCallback(
    (tabId: string | null): void => {
      setActiveTabId(tabId);
      if (activeActivity === "settings") return;
      if (workspaceId !== null) {
        activeTabIdsBySessionRef.current.set(workspaceId, tabId);
      }
    },
    [activeActivity, workspaceId],
  );
  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(async () => {
      if (disposed) return;
      setOperationError(null);
      if (activeSession === null || activeSessionId === null) {
        const cached = [...coordinationSessions.current.values()].filter(session => session.coordinationTeamInstanceId === teamChat?.id);
        setSideSessions(cached);
        setOpenChatIds(new Set(cached.map(session => session.id)));
        setActiveTabId(workspaceId === null ? null : activeTabIdsBySessionRef.current.get(workspaceId) ?? null);
        return;
      }
      const request = teamMemberOpenRequestRef.current;
      const requestedMember = request?.sourceConversationId === workspaceId
        ? request.conversation
        : null;
      if (!shouldLoadSideConversations(activeSession)) {
        setSideSessions(requestedMember === null ? [] : [requestedMember]);
        setOpenChatIds(requestedMember === null ? new Set() : new Set([requestedMember.id]));
        setActiveTabId(requestedMember === null ? activeTabIdsBySessionRef.current.get(workspaceId!) ?? null : `chat:${requestedMember.id}`);
        return;
      }

      try {
        const loaded = await listSideConversations(agentClient, activeSession, activeTeam);
        if (disposed) return;
        const latestRequest = teamMemberOpenRequestRef.current;
        const latestRequestedMember = latestRequest?.sourceConversationId === workspaceId
          ? latestRequest.conversation
          : null;
        const groupCoordinators = [...coordinationSessions.current.values()].filter(session => session.coordinationTeamInstanceId === teamChat?.id);
        loaded.sessions = [...new Map([...loaded.sessions, ...groupCoordinators].map(session => [session.id, session])).values()];
        const sessions = latestRequestedMember === null
          || loaded.sessions.some((session) => session.id === latestRequestedMember.id)
          ? loaded.sessions
          : [...loaded.sessions, latestRequestedMember];
        setSideSessions(sessions);
        const sessionIds = new Set(sessions.map((session) => session.id));
        const savedOpenChatIds = openChatIdsBySessionRef.current.get(workspaceId!);
        const nextOpenChatIds = savedOpenChatIds === undefined
          ? new Set([
              ...loaded.autoOpenIds,
              ...(latestRequestedMember === null ? [] : [latestRequestedMember.id]),
            ])
          : new Set([...savedOpenChatIds].filter((id) => sessionIds.has(id)));
        openChatIdsBySessionRef.current.set(workspaceId!, nextOpenChatIds);
        setOpenChatIds(nextOpenChatIds);
        setActiveTabId(activeTabIdsBySessionRef.current.get(workspaceId!) ?? null);
      } catch {
        if (!disposed) setOperationError("无法加载侧边聊天");
      }
      });

    return () => {
      disposed = true;
    };
  }, [activeSession, activeSessionId, activeTeam, agentClient, teamChat?.id, workspaceId, setOperationError]);

  useEffect(() => {
    return agentClient.onConversationRunEvent((event) => {
      if (event.type === "conversation.updated") {
        const nextSession = toProjectSession(event.conversation);
        if (event.conversation.coordinationTeamInstanceId !== undefined) coordinationSessions.current.set(nextSession.id, nextSession);
        const isOrdinarySideChat = event.conversation.parentConversationId === activeSessionId
          && isAutoOpenedSideConversation(event.conversation, activeSession, activeTeam);
        if (isOrdinarySideChat) {
          setSideSessions((current) => upsertSideSession(current, event.conversation));
          updateOpenChatIds((current) => current.has(nextSession.id)
            ? current
            : new Set(current).add(nextSession.id));
          return;
        }
        if (
          event.conversation.coordinationTeamInstanceId !== undefined || isManagedTeamMember(event.conversation)
          || isDirectTeamMemberConversation(event.conversation, activeSession, activeTeam)
        ) {
          setSideSessions((current) => {
            return current.some((session) => session.id === event.conversation.id)
              ? upsertSideSession(current, event.conversation)
              : current;
          });
          return;
        }
      }
      setSideSessions((current) => updateSideSessionsForRunEvent(current, event));
    });
  }, [activeSession, activeSessionId, activeTeam, agentClient, updateOpenChatIds]);

  useEffect(() => {
    if (
      teamMemberOpenRequest === null
      || teamMemberOpenRequest.sourceConversationId !== workspaceId
      || handledTeamMemberOpenRequestIdRef.current === teamMemberOpenRequest.requestId
    ) return;
    handledTeamMemberOpenRequestIdRef.current = teamMemberOpenRequest.requestId;
    const session = teamMemberOpenRequest.conversation;
    setSideSessions((current) => current.some((candidate) => candidate.id === session.id)
      ? current.map((candidate) => candidate.id === session.id ? session : candidate)
      : [...current, session]);
    updateOpenChatIds((current) => new Set(current).add(session.id));
    setActiveTabForCurrentSession(`chat:${session.id}`);
    setIsFileBrowserOpen(false);
  }, [
    workspaceId,
    setActiveTabForCurrentSession,
    teamMemberOpenRequest,
    updateOpenChatIds,
    setIsFileBrowserOpen,
  ]);

  useEffect(() => {
    if (activeActivity === "settings" || isSettingsWorkspaceTabId(activeTabId)) return;
    if (activeTabOwnerRef.current !== workspaceId) {
      activeTabOwnerRef.current = workspaceId;
      return;
    }
    if (workspaceId === null) return;
    activeTabIdsBySessionRef.current.set(workspaceId, activeTabId);
  }, [activeActivity, workspaceId, activeTabId]);

  useEffect(() => {
    if (activeActivity === "settings") return;
    setActiveTabId(
      workspaceId === null
        ? null
        : activeTabIdsBySessionRef.current.get(workspaceId) ?? null,
    );
    setIsFileBrowserOpen(false);
  }, [activeActivity, workspaceId, setIsFileBrowserOpen]);

  useEffect(() => {
    if (activeActivity !== "conversations" || teamChat === null || coordinationTarget?.instanceId !== teamChat.id
      || handledCoordinationRequest.current === coordinationTarget.requestId) return;
    let disposed = false;
    void agentClient.getTeamChatCoordinationConversation({ teamInstanceId: teamChat.id,
      ...(coordinationTarget.agentId === undefined ? {} : { agentId: coordinationTarget.agentId }) }).then(conversation => {
      const session = toProjectSession(conversation);
      coordinationSessions.current.set(session.id, session);
      if (disposed) return;
      handledCoordinationRequest.current = coordinationTarget.requestId;
      setSideSessions(current => upsertSideSession(current, conversation));
      updateOpenChatIds(current => new Set(current).add(session.id));
      setActiveTabForCurrentSession(`chat:${session.id}`);
      setCoordinationLocation(coordinationTarget.timelineItemId === undefined ? null : {
        conversationId: session.id, id: coordinationTarget.timelineItemId, requestId: ++coordinationLocateSequence.current,
      });
      setIsFileBrowserOpen(false); setFilePanelOpen(true); setOperationError(null);
    }).catch(error => { if (!disposed) setOperationError(getUserErrorMessage(error, "无法打开协调对话")); });
    return () => { disposed = true; };
  }, [activeActivity, agentClient, coordinationTarget, setActiveTabForCurrentSession, setFilePanelOpen, teamChat, updateOpenChatIds, setIsFileBrowserOpen, setOperationError]);

  const updateSideSession = useCallback((conversation: ConversationSummary): void => {
    setSideSessions((current) => upsertSideSession(current, conversation));
    onSessionUpdated(conversation);
  }, [onSessionUpdated]);

  const getCoordinationSessions = useCallback((): ProjectSession[] => [...coordinationSessions.current.values()], []);
  const forgetCoordinationSessions = useCallback((sessionIds: ReadonlySet<string>): void => {
    for (const id of sessionIds) coordinationSessions.current.delete(id);
  }, []);

  return {
    activeTabId,
    activeTeam,
    coordinationLocation,
    getCoordinationSessions,
    forgetCoordinationSessions,
    openChatIds,
    setActiveTabForCurrentSession,
    setSideSessions,
    sideSessions,
    updateOpenChatIds,
    updateSideSession,
  };
}
