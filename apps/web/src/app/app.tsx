import { Scale, PanelsTopLeft, Settings } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import type {
  ApplicationSettings,
  ConversationSearchResult,
  CreateTeamInstanceInput,
  TeamInstanceView,
  TeamWorkItemView,
} from "@agent/protocol";

import { AppShell } from "../components/layout/app-shell.js";
import type { AppTitlebarConversationTab } from "../components/layout/app-titlebar.js";
import { useNavigationHistory } from "../components/layout/use-navigation-history.js";
import { moveTabId } from "../components/ui/tab-order.js";
import { MediaPreviewDialogHost } from "../components/media/image-viewer.js";
import { GlobalConversationSearchDialog } from "../features/chat/global-conversation-search-dialog.js";
import {
  resolveConversationPathIconKind,
  resolveConversationPathScope,
  WorkspaceContent,
} from "../features/chat/workspace-content.js";
import {
  closeConversationTab,
} from "../features/chat/conversation-tabs.js";
import { FUNCTION_TABS, isFunctionTab, reconcileWorkbenchTabs, type WorkbenchTabs } from "../features/chat/workbench-tabs.js";
import { ConversationActivity } from "../features/chat/conversation-activity.js";
import {
  ProjectNavigator,
  type ProjectNavigatorLocateRequest,
} from "../features/projects/project-navigator.js";
import { useProjectSessions } from "../features/projects/use-project-sessions.js";
import { useProjectTree } from "../features/projects/use-project-tree.js";
import { AgentAvatar, SubagentAvatar } from "../features/team/agent-avatar.js";
import {
  RightSidebarWorkspace,
  type GitReviewOpenRequest,
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
  const setFilePanelOpenForConversation = useWorkbenchUiStore(
    (state) => state.setFilePanelOpenForConversation,
  );
  const setActiveActivity = useWorkbenchUiStore((state) => state.setActiveActivity);
  const activeActivity = useWorkbenchUiStore((state) => state.activeActivity);
  const settingsSection = useWorkbenchUiStore((state) => state.settingsSection);
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
  const [tabState, setTabState] = useState<WorkbenchTabs>({ ids: [], previewId: null });
  const openConversationIds = tabState.ids.filter((id) => !isFunctionTab(id));
  const activeTabId = activeActivity === "settings" ? "page:settings"
    : activeActivity === "team" || activeActivity === "tasks" ? "page:team" : projectSessions.activeSessionId;
  const navigation = useNavigationHistory({
    activity: activeActivity, settingsSection,
    projectId: projectTree.activeProject?.id ?? null,
    conversationId: projectSessions.activeSessionId,
  }, (entry) => JSON.stringify(entry), (entry) => {
    setActiveActivity(entry.activity);
    useWorkbenchUiStore.getState().setSettingsSection(entry.settingsSection);
    projectTree.selectProject(entry.projectId);
    if (entry.conversationId === null) projectSessions.clearSessionSelection();
    else {
      projectSessions.selectSession(entry.conversationId);
    }
  }, (entry) => (entry.projectId === null || projectTree.projects.some((project) => project.id === entry.projectId))
    && (entry.conversationId === null || projectSessions.sessions.some(
    (session) => session.id === entry.conversationId && !session.isArchived,
  )));
  const [previousTabSource, setPreviousTabSource] = useState<string | null>(null);
  const availableConversationIds = projectSessions.sessions.filter((session) => !session.isArchived).map((session) => session.id);
  const tabSource = `${activeTabId ?? ""}:${availableConversationIds.join(",")}`;
  // Reconcile only selection/membership changes, before committing child panes.
  // Model deltas and status updates do not schedule a second effect render.
  if (previousTabSource !== tabSource) {
    setPreviousTabSource(tabSource);
    const next = reconcileWorkbenchTabs(tabState, availableConversationIds, activeTabId);
    if (next !== tabState) setTabState(next);
  }
  const [navigatorLocateRequest, setNavigatorLocateRequest] =
    useState<ProjectNavigatorLocateRequest | null>(null);
  const [fileOpenRequest, setFileOpenRequest] = useState<ProjectFileOpenRequest | null>(null);
  const [gitReviewOpenRequest, setGitReviewOpenRequest] = useState<GitReviewOpenRequest | null>(null);
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
    const conversationId = projectSessions.activeSessionId;
    if (conversationId !== null) setFilePanelOpenForConversation(conversationId, true);
  }, [projectSessions.activeSessionId, setFilePanelOpenForConversation]);
  const requestOpenGitReview = useCallback((projectId: string, path?: string): void => {
    setGitReviewOpenRequest((current) => ({
      path: path ?? null,
      projectId,
      requestId: (current?.requestId ?? 0) + 1,
    }));
    const conversationId = projectSessions.activeSessionId;
    if (conversationId !== null) setFilePanelOpenForConversation(conversationId, true);
  }, [projectSessions.activeSessionId, setFilePanelOpenForConversation]);
  const applicationSettingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

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

  const conversationTabs = useMemo(() => {
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const projectsById = new Map(projectTree.projects.map((project) => [project.id, project]));
    return tabState.ids.flatMap<AppTitlebarConversationTab>((id) => {
      if (isFunctionTab(id)) return [{ id, isRunning: false, title: FUNCTION_TABS[id],
        icon: id === "page:team" ? <PanelsTopLeft size={14} /> : <Settings size={14} />,
        kind: "page" as const, isPreview: false }];
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
        kind: "conversation" as const,
        isPreview: tabState.previewId === session.id,
      }];
    });
  }, [agents, tabState, projectSessions.sessions, projectTree.projects, teams]);

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
    setFilePanelOpenForConversation(sourceConversationId, true);
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
  }, [projectSessions, projectTree, setActiveActivity, setFilePanelOpenForConversation]);

  function selectSession(sessionId: string): void {
    if (isFunctionTab(sessionId)) {
      setActiveActivity(sessionId === "page:team" ? "team" : "settings");
      return;
    }
    setActiveActivity("conversations");
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
      tabState.ids,
      conversationId,
      activeTabId,
    );
    setTabState({ ids: result.openIds, previewId: tabState.previewId === conversationId ? null : tabState.previewId });
    if (result.nextActiveId === null) {
      setActiveActivity("conversations");
      projectSessions.clearSessionSelection();
    } else if (result.nextActiveId !== activeTabId) {
      selectSession(result.nextActiveId);
    }
  }

  function closeOtherConversationTitlebarTabs(conversationId: string): void {
    if (!tabState.ids.includes(conversationId)) return;
    setTabState({ ids: [conversationId], previewId: tabState.previewId === conversationId ? conversationId : null });
    if (activeTabId !== conversationId) {
      selectSession(conversationId);
    }
  }

  function closeAllConversationTitlebarTabs(): void {
    setTabState({ ids: [], previewId: null });
    setActiveActivity("conversations");
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
    setFilePanelOpenForConversation(ownerConversationId, true);
    setTeamMemberOpenRequest((current) => ({
      conversation,
      requestId: (current?.requestId ?? 0) + 1,
      sourceConversationId: ownerConversationId,
      timelineItemId: timelineItemId ?? null,
    }));
  }, [projectSessions, projectTree, setFilePanelOpenForConversation]);

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
        navigation={navigation}
        activeConversationId={projectSessions.activeSessionId}
        activeTabId={activeTabId}
        titlebarActivity={<ConversationActivity agentClient={agentClient} sessions={projectSessions.sessions}
          projects={projectTree.projects} onSelect={(id, timelineItemId) => {
            selectSession(id);
            if (timelineItemId !== undefined) setConversationLocateRequest((current) => ({
              conversationId: id,
              id: timelineItemId,
              requestId: (current?.requestId ?? 0) + 1,
            }));
          }} />}
        agentClient={agentClient}
        conversationTabs={conversationTabs}
        onCloseAllConversationTabs={closeAllConversationTitlebarTabs}
        onCloseConversationTab={closeConversationTitlebarTab}
        onCloseOtherConversationTabs={closeOtherConversationTitlebarTabs}
        onSelectConversationTab={selectSession}
        onKeepConversationTab={(id) => setTabState((current) => current.previewId === id ? { ...current, previewId: null } : current)}
        onMoveConversationTab={(source, target, side) => {
          setTabState((current) => ({ ...current, ids: moveTabId(current.ids, source, target, side) }));
        }}
        projectNavigator={
        <ProjectNavigator
          onOpenGlobalSearch={() => setGlobalSearchOpen(true)}
          onCopyText={(text) => agentClient.writeClipboardText(text)}
          onOpenProjectDirectory={(projectId) => agentClient.openProjectDirectory({ projectId })}
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
            setActiveActivity("conversations");
            setNavigatorLocateRequest(null);
            projectTree.selectProject(projectId);
            void projectSessions.createProjectSession(projectId);
          }}
          onCreateTemporarySession={() => { setActiveActivity("conversations"); void projectSessions.createTemporarySession(); }}
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
          onSelectSession={(sessionId) => {
            setNavigatorLocateRequest(null);
            selectSession(sessionId);
          }}
          onKeepSession={(id) => setTabState((current) => current.previewId === id ? { ...current, previewId: null } : current)}
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
          onOpenGitReview={requestOpenGitReview}
          onOpenTeamConversation={openTeamConversation}
          onNavigateToTeamConversation={navigateToTeamConversation}
          onProjectSelected={(projectId) => projectTree.selectProject(projectId)}
          onRefreshSessions={() => projectSessions.refreshSessions()}
          onSessionSelected={(sessionId) => {
            setNavigatorLocateRequest(null);
            selectSession(sessionId);
          }}
          onSessionUpdated={(conversation) => projectSessions.updateSession(conversation)}
          onSessionViewed={(sessionId) => projectSessions.markSessionResultViewed(sessionId, true)}
        />
      }
      filePanel={
        <RightSidebarWorkspace
          activeProject={projectTree.activeProject}
          activeSession={projectSessions.activeSession}
          agentClient={agentClient}
          fileOpenRequest={fileOpenRequest}
          gitReviewOpenRequest={gitReviewOpenRequest}
          teamMemberOpenRequest={teamMemberOpenRequest}
          onLocateProject={(projectId) => locateInProjectNavigator("project", projectId)}
          onLocateSession={(sessionId) => locateInProjectNavigator("session", sessionId)}
          onSessionViewed={(sessionId) => projectSessions.markSessionResultViewed(sessionId, true)}
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
