import { Scale } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import type {
  ApplicationSettings,
  ConversationSearchResult,
  CreateTeamInstanceInput,
  TeamInstanceView,
  TeamWorkItemView,
} from "@agent/protocol";

import { AppShell } from "../components/layout/app-shell.js";
import { MediaPreviewDialogHost } from "../components/media/image-viewer.js";
import { GlobalConversationSearchDialog } from "../features/chat/global-conversation-search-dialog.js";
import {
  resolveConversationPathIconKind,
  resolveConversationPathScope,
  WorkspaceContent,
} from "../features/chat/workspace-content.js";
import {
  closeConversationTab,
  openConversationTab,
} from "../features/chat/conversation-tabs.js";
import {
  ProjectNavigator,
  type ProjectNavigatorLocateRequest,
} from "../features/projects/project-navigator.js";
import { useProjectSessions } from "../features/projects/use-project-sessions.js";
import { useProjectTree } from "../features/projects/use-project-tree.js";
import { AgentAvatar, SubagentAvatar } from "../features/team/agent-avatar.js";
import {
  RightSidebarWorkspace,
  type ProjectFileOpenRequest,
  type TeamMemberOpenRequest,
} from "../features/workspace/right-sidebar-workspace.js";
import {
  isProjectSessionRunning,
  type ProjectSession,
} from "../features/projects/project-session-model.js";
import { useWorkbenchUiStore } from "../stores/workbench-ui-store.js";
import { useAgentDirectoryStore } from "../stores/agent-directory-store.js";
import { useApplicationSettingsStore } from "../stores/application-settings-store.js";
import {
  createAgentClientForCurrentHost,
  getUserErrorMessage,
  type AgentClient,
} from "../runtime/index.js";

function applicationSettingsSnapshot(): ApplicationSettings {
  const workbench = useWorkbenchUiStore.getState();
  const directory = useAgentDirectoryStore.getState();
  const applicationSettings = useApplicationSettingsStore.getState();

  return {
    agentDirectory: {
      agents: structuredClone(directory.agents),
      teams: structuredClone(directory.teams),
    },
    appearance: {
      filePanelOpen: workbench.isFilePanelOpen,
      filePanelWidth: workbench.filePanelWidth,
      projectNavigatorOpen: workbench.isProjectNavigatorOpen,
      projectNavigatorWidth: workbench.projectNavigatorWidth,
      themeMode: workbench.themeMode,
    },
    general: {
      approvalReviewer: applicationSettings.approvalReviewer,
      defaultPermissionMode: applicationSettings.defaultPermissionMode,
      defaultMessageDeliveryMode: applicationSettings.defaultMessageDeliveryMode,
      sendShortcut: applicationSettings.sendShortcut,
      showContextUsage: applicationSettings.showContextUsage,
    },
    permissionPolicies: structuredClone(applicationSettings.permissionPolicies),
    version: 1,
  };
}

function sourceConversationIdForMember(
  member: ProjectSession,
  sessions: readonly ProjectSession[],
): string | null {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const visited = new Set<string>();
  let current = member;
  while (current.parentConversationId !== null) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    const parent = sessionsById.get(current.parentConversationId);
    // A fresh team-run event can reach the board before the navigator has
    // refreshed its recursive session cache. A Team Lead is always attached
    // directly to its source root, so its persisted parent is enough to open
    // the source conversation and then its read-only side tab.
    if (parent === undefined) {
      return current.threadKind === "team_lead" ? current.parentConversationId : null;
    }
    current = parent;
  }
  return current.threadKind === "agent" ? current.id : null;
}

export function App(): ReactElement {
  const agentClient = useMemo<AgentClient>(
    () => createAgentClientForCurrentHost(),
    [],
  );
  const setTerminalConfiguration = useWorkbenchUiStore(
    (state) => state.setTerminalConfiguration,
  );
  const setFilePanelOpen = useWorkbenchUiStore((state) => state.setFilePanelOpen);
  const setActiveActivity = useWorkbenchUiStore((state) => state.setActiveActivity);
  const agents = useAgentDirectoryStore((state) => state.agents);
  const teams = useAgentDirectoryStore((state) => state.teams);
  const [teamInstances, setTeamInstances] = useState<TeamInstanceView[]>([]);
  const [teamNavigatorWorkItems, setTeamNavigatorWorkItems] = useState<TeamWorkItemView[]>([]);
  const [teamInstanceError, setTeamInstanceError] = useState<string | null>(null);
  const projectTree = useProjectTree(agentClient);
  const projectSessions = useProjectSessions(
    agentClient,
    projectTree.activeProject?.id ?? null,
  );
  const [openConversationIds, setOpenConversationIds] = useState<string[]>([]);
  const [navigatorLocateRequest, setNavigatorLocateRequest] =
    useState<ProjectNavigatorLocateRequest | null>(null);
  const [fileOpenRequest, setFileOpenRequest] = useState<ProjectFileOpenRequest | null>(null);
  const [teamMemberOpenRequest, setTeamMemberOpenRequest] =
    useState<TeamMemberOpenRequest | null>(null);
  const [isGlobalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [conversationLocateRequest, setConversationLocateRequest] = useState<{
    conversationId: string;
    id: string;
    requestId: number;
  } | null>(null);
  const requestOpenProjectFile = useCallback((projectId: string, path: string): void => {
    setFileOpenRequest({ path, projectId });
    setFilePanelOpen(true);
  }, [setFilePanelOpen]);
  const applicationSettingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

  useEffect(() => {
    const activeSessionId = projectSessions.activeSessionId;
    if (activeSessionId === null) return;
    setOpenConversationIds((current) => openConversationTab(current, activeSessionId));
  }, [projectSessions.activeSessionId]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || !event.shiftKey || event.altKey) return;
      if (event.key.toLocaleLowerCase() !== "f") return;
      event.preventDefault();
      setGlobalSearchOpen(true);
    };
    const disposeBrowserEvents = agentClient.onManagedBrowserEvent((event) => {
      if (event.type === "openGlobalSearch") setGlobalSearchOpen(true);
    });
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      disposeBrowserEvents();
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [agentClient]);

  useEffect(() => {
    const availableIds = new Set(
      projectSessions.sessions
        .filter((session) => !session.isArchived)
        .map((session) => session.id),
    );
    setOpenConversationIds((current) => current.filter((id) => availableIds.has(id)));
  }, [projectSessions.sessions]);

  const conversationTabs = useMemo(() => {
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const projectsById = new Map(projectTree.projects.map((project) => [project.id, project]));
    return openConversationIds.flatMap((id) => {
      const session = projectSessions.sessions.find((candidate) => candidate.id === id);
      if (session === undefined || session.isArchived) return [];

      const isRunning = isProjectSessionRunning(session);
      const project = session.projectId === null
        ? null
        : projectsById.get(session.projectId) ?? null;
      const scope = resolveConversationPathScope(project, session, teams);
      const iconKind = resolveConversationPathIconKind(scope.kind, session);
      const agent = session.agentId === null ? undefined : agentsById.get(session.agentId);
      const icon = iconKind === "team_lead"
        ? <Scale aria-label="Team Lead 对话" size={14} />
        : iconKind === "agent" && agent !== undefined
          ? <AgentAvatar avatar={agent.avatar} size="compact" status={isRunning ? "running" : "standby"} />
          : iconKind === "agent" && session.avatarIcon !== null && session.avatarIcon !== undefined
            ? <AgentAvatar avatar={{ icon: session.avatarIcon, kind: "icon" }} size="compact" status={isRunning ? "running" : "standby"} />
            : iconKind === "subagent"
              ? <SubagentAvatar icon={session.avatarIcon} seed={session.id} size="compact" status={isRunning ? "running" : "standby"} />
              : undefined;

      return [{
        id: session.id,
        ...(icon === undefined ? {} : { icon }),
        isRunning,
        title: session.title,
      }];
    });
  }, [agents, openConversationIds, projectSessions.sessions, projectTree.projects, teams]);

  useEffect(() => {
    let disposed = false;
    let refreshTimer: number | undefined;

    async function refreshTeamNavigation(): Promise<void> {
      try {
        const [instances, items] = await Promise.all([
          agentClient.listTeamInstances({ includeArchived: false }),
          Promise.all(
            teams.map((team) => agentClient.listTeamWorkItems({ teamId: team.id })),
          ).then((groups) => groups.flat()),
        ]);
        if (!disposed) {
          setTeamInstances(instances);
          setTeamNavigatorWorkItems(items);
        }
      } catch {
        // The conversation tree remains usable when Team history is unavailable.
      }
    }

    void refreshTeamNavigation();
    const unsubscribe = agentClient.onConversationRunEvent((event) => {
      if (
        event.type !== "conversation.updated"
        && event.type !== "run.started"
        && event.type !== "run.finished"
        && event.type !== "task_list.updated"
        && event.type !== "tool.completed"
      ) return;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => void refreshTeamNavigation(), 120);
    });

    return () => {
      disposed = true;
      unsubscribe();
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
    };
  }, [agentClient, teams]);

  const refreshTeamState = useCallback(async (): Promise<void> => {
    const [instances, items] = await Promise.all([
      agentClient.listTeamInstances({ includeArchived: false }),
      Promise.all(
        teams.map((team) => agentClient.listTeamWorkItems({ teamId: team.id })),
      ).then((groups) => groups.flat()),
    ]);
    setTeamInstances(instances);
    setTeamNavigatorWorkItems(items);
    await projectSessions.refreshSessions();
  }, [agentClient, projectSessions, teams]);

  const createTeamInstance = useCallback(async (
    input: CreateTeamInstanceInput,
  ): Promise<boolean> => {
    setTeamInstanceError(null);
    try {
      await agentClient.createTeamInstance(input);
      await refreshTeamState();
      return true;
    } catch (error) {
      setTeamInstanceError(getUserErrorMessage(error, "无法创建团队"));
      return false;
    }
  }, [agentClient, refreshTeamState]);

  const renameTeamInstance = useCallback(async (
    teamInstanceId: string,
    name: string,
    projectId?: string | null,
  ): Promise<boolean> => {
    setTeamInstanceError(null);
    try {
      await agentClient.renameTeamInstance({
        name,
        teamInstanceId,
        ...(projectId === undefined ? {} : { projectId }),
      });
      await refreshTeamState();
      return true;
    } catch (error) {
      setTeamInstanceError(getUserErrorMessage(error, "无法编辑团队"));
      return false;
    }
  }, [agentClient, refreshTeamState]);

  const reorderTeamInstances = useCallback(async (
    teamInstanceIds: string[],
  ): Promise<boolean> => {
    setTeamInstanceError(null);
    try {
      setTeamInstances(await agentClient.reorderTeamInstances({ teamInstanceIds }));
      return true;
    } catch (error) {
      setTeamInstanceError(getUserErrorMessage(error, "无法调整团队顺序"));
      return false;
    }
  }, [agentClient]);

  const setTeamInstanceArchived = useCallback(async (
    teamInstanceId: string,
    archived: boolean,
  ): Promise<boolean> => {
    setTeamInstanceError(null);
    try {
      await agentClient.setTeamInstanceArchived({ archived, teamInstanceId });
      await refreshTeamState();
      return true;
    } catch (error) {
      setTeamInstanceError(getUserErrorMessage(
        error,
        archived ? "无法归档团队" : "无法恢复团队",
      ));
      return false;
    }
  }, [agentClient, refreshTeamState]);

  const deleteTeamInstance = useCallback(async (
    teamInstanceId: string,
  ): Promise<boolean> => {
    setTeamInstanceError(null);
    try {
      await agentClient.deleteTeamInstance({ teamInstanceId });
      await refreshTeamState();
      return true;
    } catch (error) {
      setTeamInstanceError(getUserErrorMessage(error, "无法删除团队"));
      return false;
    }
  }, [agentClient, refreshTeamState]);

  useEffect(() => {
    let disposed = false;

    void agentClient
      .getTerminalConfiguration()
      .then((configuration) => {
        if (!disposed) setTerminalConfiguration(configuration);
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
    };
  }, [agentClient, setTerminalConfiguration]);

  useEffect(() => {
    let disposed = false;
    let initialized = false;
    let saveTimer: number | undefined;
    let lastSavedSnapshot = "";
    let applyingRemoteSettings = false;
    const unsubscribe: (() => void)[] = [];

    function hydrateApplicationSettings(settings: ApplicationSettings): void {
      applyingRemoteSettings = true;
      try {
        useWorkbenchUiStore.getState().hydrateAppearance(settings.appearance);
        useAgentDirectoryStore.getState().hydrate(settings.agentDirectory);
        useApplicationSettingsStore.getState().hydrateGeneralConfiguration(
          settings.general,
        );
        useApplicationSettingsStore.getState().hydratePermissionPolicies(
          settings.permissionPolicies,
        );
        lastSavedSnapshot = JSON.stringify(settings);
      } finally {
        applyingRemoteSettings = false;
      }
    }

    function scheduleSave(): void {
      if (disposed || !initialized || applyingRemoteSettings) return;
      const snapshot = applicationSettingsSnapshot();
      if (JSON.stringify(snapshot) === lastSavedSnapshot) return;
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(() => {
        saveTimer = undefined;
        const pendingSnapshot = applicationSettingsSnapshot();
        const pendingSerialized = JSON.stringify(pendingSnapshot);
        if (pendingSerialized === lastSavedSnapshot) return;

        applicationSettingsSaveQueueRef.current = applicationSettingsSaveQueueRef.current
          .catch(() => undefined)
          .then(async () => {
            const saved = await agentClient.saveApplicationSettings(pendingSnapshot);
            lastSavedSnapshot = JSON.stringify(saved);
            if (!disposed && JSON.stringify(applicationSettingsSnapshot()) !== lastSavedSnapshot) {
              scheduleSave();
            }
          });
      }, 450);
    }

    function subscribeToApplicationSettings(): void {
      unsubscribe.push(useWorkbenchUiStore.subscribe(scheduleSave));
      unsubscribe.push(useAgentDirectoryStore.subscribe(scheduleSave));
      unsubscribe.push(useApplicationSettingsStore.subscribe(scheduleSave));
    }

    unsubscribe.push(agentClient.onApplicationSettingsChanged((settings) => {
      if (disposed) return;
      hydrateApplicationSettings(settings);
    }));

    void agentClient.getApplicationSettings().then(
      (settings) => {
        if (disposed) return;
        hydrateApplicationSettings(settings);
        initialized = true;
        subscribeToApplicationSettings();
      },
      () => {
        if (disposed) return;
        initialized = true;
        lastSavedSnapshot = JSON.stringify(applicationSettingsSnapshot());
        subscribeToApplicationSettings();
      },
    );

    return () => {
      disposed = true;
      if (saveTimer !== undefined) window.clearTimeout(saveTimer);
      unsubscribe.forEach((stop) => stop());
    };
  }, [agentClient]);

  useEffect(() => {
    if (navigatorLocateRequest === null) return undefined;
    const requestId = navigatorLocateRequest.requestId;
    const timeout = window.setTimeout(() => {
      setNavigatorLocateRequest((current) =>
        current?.requestId === requestId ? null : current,
      );
    }, 1_500);
    return () => window.clearTimeout(timeout);
  }, [navigatorLocateRequest]);

  function selectProject(projectId: string): void {
    projectTree.selectProject(projectId);
  }

  const openTeamMemberSession = useCallback((
    member: ProjectSession,
    requestedSourceConversationId?: string,
  ): void => {
    const sourceConversationId = requestedSourceConversationId
      ?? sourceConversationIdForMember(member, projectSessions.sessions);
    if (sourceConversationId === null) {
      if (member.projectId !== null) projectTree.selectProject(member.projectId);
      projectSessions.selectSession(member.id);
      setActiveActivity("conversations");
      return;
    }
    if (member.projectId !== null) projectTree.selectProject(member.projectId);
    projectSessions.selectSession(sourceConversationId);
    setFilePanelOpen(true);
    setActiveActivity("conversations");
    setTeamMemberOpenRequest((current) => ({
      conversation: member,
      requestId: (current?.requestId ?? 0) + 1,
      sourceConversationId,
      timelineItemId: null,
    }));
    setNavigatorLocateRequest((current) => ({
      id: sourceConversationId,
      kind: "session",
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }, [projectSessions, projectTree, setActiveActivity, setFilePanelOpen]);

  function selectSession(sessionId: string): void {
    const session = projectSessions.sessions.find(
      (candidate) => candidate.id === sessionId,
    );
    if (session?.teamWorkItemId !== null && session?.teamWorkItemId !== undefined) {
      openTeamMemberSession(session);
      return;
    }
    if (session?.projectId !== null && session?.projectId !== undefined) {
      projectTree.selectProject(session.projectId);
    }
    projectSessions.selectSession(sessionId);
  }

  function closeConversationTitlebarTab(conversationId: string): void {
    const result = closeConversationTab(
      openConversationIds,
      conversationId,
      projectSessions.activeSessionId,
    );
    setOpenConversationIds(result.openIds);
    if (result.nextActiveId === null) {
      projectSessions.clearSessionSelection();
    } else if (result.nextActiveId !== projectSessions.activeSessionId) {
      selectSession(result.nextActiveId);
    }
  }

  function closeOtherConversationTitlebarTabs(conversationId: string): void {
    if (!openConversationIds.includes(conversationId)) return;
    setOpenConversationIds([conversationId]);
    if (projectSessions.activeSessionId !== conversationId) {
      selectSession(conversationId);
    }
  }

  function closeAllConversationTitlebarTabs(): void {
    setOpenConversationIds([]);
    projectSessions.clearSessionSelection();
  }

  function locateInProjectNavigator(kind: "project" | "session", id: string): void {
    setNavigatorLocateRequest((current) => ({
      id,
      kind,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }

  const forkConversationFromMessage = useCallback(async (
    conversationId: string,
    throughMessageId: string,
  ): Promise<void> => {
    const conversation = await agentClient.forkConversation({
      conversationId,
      throughMessageId,
    });
    projectSessions.updateSession(conversation);
    setNavigatorLocateRequest(null);
    if (conversation.projectId !== null) {
      projectTree.selectProject(conversation.projectId);
    }
    projectSessions.selectSession(conversation.id);
  }, [agentClient, projectSessions, projectTree]);

  const openTeamConversation = useCallback((
    conversation: ProjectSession,
    sourceConversationId?: string,
    timelineItemId?: string,
  ): void => {
    const ownerConversationId = sourceConversationId
      ?? sourceConversationIdForMember(conversation, projectSessions.sessions)
      ?? conversation.id;
    if (conversation.projectId !== null) projectTree.selectProject(conversation.projectId);
    projectSessions.selectSession(ownerConversationId);
    setFilePanelOpen(true);
    setTeamMemberOpenRequest((current) => ({
      conversation,
      requestId: (current?.requestId ?? 0) + 1,
      sourceConversationId: ownerConversationId,
      timelineItemId: timelineItemId ?? null,
    }));
  }, [projectSessions, projectTree, setFilePanelOpen]);

  const navigateToTeamConversation = useCallback((conversationId: string): void => {
    const session = projectSessions.sessions.find((candidate) => candidate.id === conversationId);
    if (session?.projectId !== null && session?.projectId !== undefined) {
      projectTree.selectProject(session.projectId);
    }
    setNavigatorLocateRequest(null);
    projectSessions.selectSession(conversationId);
    setActiveActivity("conversations");
  }, [projectSessions, projectTree, setActiveActivity]);

  const selectGlobalSearchResult = useCallback((result: ConversationSearchResult): void => {
    const session = projectSessions.sessions.find((candidate) => candidate.id === result.conversationId);
    if (session === undefined) return;
    setGlobalSearchOpen(false);
    setActiveActivity("conversations");
    if (result.parentConversationId !== null && result.threadKind !== "subagent") {
      openTeamConversation(session, undefined, result.itemId);
      return;
    }
    if (result.projectId !== null) projectTree.selectProject(result.projectId);
    projectSessions.selectSession(result.conversationId);
    setConversationLocateRequest((current) => ({
      conversationId: result.conversationId,
      id: result.itemId,
      requestId: (current?.requestId ?? 0) + 1,
    }));
  }, [openTeamConversation, projectSessions, projectTree, setActiveActivity]);

  return (
    <>
      <AppShell
        activeConversationId={projectSessions.activeSessionId}
        agentClient={agentClient}
        conversationTabs={conversationTabs}
        onCloseAllConversationTabs={closeAllConversationTitlebarTabs}
        onCloseConversationTab={closeConversationTitlebarTab}
        onCloseOtherConversationTabs={closeOtherConversationTitlebarTabs}
        onOpenGlobalSearch={() => setGlobalSearchOpen(true)}
        onSelectConversationTab={selectSession}
        projectNavigator={
        <ProjectNavigator
          activeSessionId={projectSessions.activeSessionId}
          agents={agents}
          isCreatingSession={projectSessions.isCreatingSession}
          isLoadingSessions={projectSessions.isLoadingSessions}
          locateRequest={navigatorLocateRequest}
          operationError={teamInstanceError ?? projectSessions.operationError}
          sessions={projectSessions.sessions}
          teamInstances={teamInstances}
          teams={teams}
          teamWorkItems={teamNavigatorWorkItems}
          tree={projectTree}
          onClearOperationError={() => {
            setTeamInstanceError(null);
            projectSessions.clearOperationError();
          }}
          onCreateProjectSession={(projectId) => {
            setNavigatorLocateRequest(null);
            projectTree.selectProject(projectId);
            void projectSessions.createProjectSession(projectId);
          }}
          onCreateTemporarySession={() => void projectSessions.createTemporarySession()}
          onCreateTeamInstance={createTeamInstance}
          onDeleteSession={(sessionId) => projectSessions.deleteSession(sessionId)}
          onDeleteTeamInstance={deleteTeamInstance}
          onOpenTeamMember={(teamInstanceId, agentId, session) => {
            void projectSessions.ensureTeamInstanceMemberSession(
              teamInstanceId,
              agentId,
            ).then((ensured) => {
              const member = ensured ?? session;
              if (member !== null) openTeamMemberSession(member);
            });
          }}
          onRemoveProject={async (projectId) => {
            const removed = await projectTree.removeProject(projectId);
            if (removed) projectSessions.discardProjectSessions(projectId);
            return removed;
          }}
          onRenameProject={(projectId, name) => projectTree.renameProject(projectId, name)}
          onRenameSession={(sessionId, title) =>
            projectSessions.renameSession(sessionId, title)
          }
          onRenameTeamInstance={renameTeamInstance}
          onReorderSessions={(sessionIds) => projectSessions.reorderSessions(sessionIds)}
          onReorderTeamInstances={reorderTeamInstances}
          onSelectProject={(projectId) => {
            setNavigatorLocateRequest(null);
            selectProject(projectId);
          }}
          onSelectSession={(sessionId) => {
            setNavigatorLocateRequest(null);
            selectSession(sessionId);
          }}
          onSetSessionArchived={(sessionId, archived) =>
            projectSessions.setSessionArchived(sessionId, archived)
          }
          onSetSessionPinned={(sessionId, pinned) =>
            projectSessions.setSessionPinned(sessionId, pinned)
          }
          onSetTeamInstanceArchived={setTeamInstanceArchived}
        />
      }
      mainContent={
        <WorkspaceContent
          activeProject={projectTree.activeProject}
          activeSession={projectSessions.activeSession}
          agentClient={agentClient}
          canAddProjects={projectTree.canAddProjects}
          isAddingProject={projectTree.isAddingProject}
          isCreatingSession={projectSessions.isCreatingSession}
          projects={projectTree.projects}
          protectedSessionIds={openConversationIds}
          sessions={projectSessions.sessions}
          locateTimelineItem={conversationLocateRequest}
          teamInstances={teamInstances}
          onAddProject={() => projectTree.addProject()}
          onCreateProjectSession={(projectId) => {
            setNavigatorLocateRequest(null);
            projectTree.selectProject(projectId);
            void projectSessions.createProjectSession(projectId);
          }}
          onCreateTemporarySession={() => void projectSessions.createTemporarySession()}
          onForkConversation={forkConversationFromMessage}
          onLocateProject={(projectId) => locateInProjectNavigator("project", projectId)}
          onLocateSession={(sessionId) => locateInProjectNavigator("session", sessionId)}
          onOpenProjectFile={requestOpenProjectFile}
          onOpenTeamConversation={openTeamConversation}
          onNavigateToTeamConversation={navigateToTeamConversation}
          onProjectSelected={(projectId) => projectTree.selectProject(projectId)}
          onSessionSelected={(sessionId) => {
            setNavigatorLocateRequest(null);
            selectSession(sessionId);
          }}
          onSessionUpdated={(conversation) => projectSessions.updateSession(conversation)}
          onSessionViewed={(sessionId) => projectSessions.markSessionResultViewed(sessionId)}
        />
      }
      filePanel={
        <RightSidebarWorkspace
          activeProject={projectTree.activeProject}
          activeSession={projectSessions.activeSession}
          agentClient={agentClient}
          fileOpenRequest={fileOpenRequest}
          teamMemberOpenRequest={teamMemberOpenRequest}
          onLocateProject={(projectId) => locateInProjectNavigator("project", projectId)}
          onLocateSession={(sessionId) => locateInProjectNavigator("session", sessionId)}
          onSessionViewed={(sessionId) => projectSessions.markSessionResultViewed(sessionId)}
          onSessionUpdated={(conversation) => projectSessions.updateSession(conversation)}
          tree={projectTree}
        />
      }
      />
      <GlobalConversationSearchDialog
        agentClient={agentClient}
        open={isGlobalSearchOpen}
        onOpenChange={setGlobalSearchOpen}
        onSelect={selectGlobalSearchResult}
      />
      <MediaPreviewDialogHost />
    </>
  );
}
