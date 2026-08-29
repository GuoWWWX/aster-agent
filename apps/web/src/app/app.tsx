import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";

import type { ApplicationSettings, ConversationSummary } from "@agent/protocol";

import { AppShell } from "../components/layout/app-shell.js";
import { MediaPreviewDialogHost } from "../components/media/image-viewer.js";
import { WorkspaceContent } from "../features/chat/workspace-content.js";
import {
  ProjectNavigator,
  type ProjectNavigatorLocateRequest,
} from "../features/projects/project-navigator.js";
import { useProjectSessions } from "../features/projects/use-project-sessions.js";
import { useProjectTree } from "../features/projects/use-project-tree.js";
import {
  RightSidebarWorkspace,
  type ProjectFileOpenRequest,
  type TeamMemberOpenRequest,
} from "../features/workspace/right-sidebar-workspace.js";
import type { ProjectSession } from "../features/projects/project-session-model.js";
import { useWorkbenchUiStore } from "../stores/workbench-ui-store.js";
import { useAgentDirectoryStore } from "../stores/agent-directory-store.js";
import { useApplicationSettingsStore } from "../stores/application-settings-store.js";
import {
  createAgentClientForCurrentHost,
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
      defaultPermissionMode: applicationSettings.defaultPermissionMode,
      defaultMessageDeliveryMode: applicationSettings.defaultMessageDeliveryMode,
      sendShortcut: applicationSettings.sendShortcut,
      showContextUsage: applicationSettings.showContextUsage,
    },
    permissionPolicies: structuredClone(applicationSettings.permissionPolicies),
    version: 1,
  };
}

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
    teamWorkItemId: conversation.teamWorkItemId,
    threadKind: conversation.threadKind,
    title: conversation.title,
    workspaceRootPath: conversation.workspaceRootPath,
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
  const projectTree = useProjectTree(agentClient);
  const projectSessions = useProjectSessions(
    agentClient,
    projectTree.activeProject?.id ?? null,
  );
  const [navigatorLocateRequest, setNavigatorLocateRequest] =
    useState<ProjectNavigatorLocateRequest | null>(null);
  const [fileOpenRequest, setFileOpenRequest] = useState<ProjectFileOpenRequest | null>(null);
  const [teamMemberOpenRequest, setTeamMemberOpenRequest] =
    useState<TeamMemberOpenRequest | null>(null);
  const requestOpenProjectFile = useCallback((projectId: string, path: string): void => {
    setFileOpenRequest({ path, projectId });
    setFilePanelOpen(true);
  }, [setFilePanelOpen]);
  const applicationSettingsSaveQueueRef = useRef<Promise<void>>(Promise.resolve());

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

  const openTeamMemberSession = useCallback((member: ProjectSession): void => {
    const sourceConversationId = sourceConversationIdForMember(member, projectSessions.sessions);
    if (sourceConversationId === null) return;
    if (member.projectId !== null) projectTree.selectProject(member.projectId);
    projectSessions.selectSession(sourceConversationId);
    setFilePanelOpen(true);
    setActiveActivity("conversations");
    setTeamMemberOpenRequest((current) => ({
      conversation: member,
      requestId: (current?.requestId ?? 0) + 1,
      sourceConversationId,
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

  const openTeamConversation = useCallback((conversation: ConversationSummary): void => {
    projectSessions.updateSession(conversation);
    openTeamMemberSession(toProjectSession(conversation));
  }, [openTeamMemberSession, projectSessions]);

  return (
    <>
      <AppShell
        activeConversationId={projectSessions.activeSessionId}
        agentClient={agentClient}
        projectNavigator={
        <ProjectNavigator
          activeSessionId={projectSessions.activeSessionId}
          isCreatingSession={projectSessions.isCreatingSession}
          isLoadingSessions={projectSessions.isLoadingSessions}
          locateRequest={navigatorLocateRequest}
          operationError={projectSessions.operationError}
          sessions={projectSessions.sessions}
          tree={projectTree}
          onClearOperationError={() => projectSessions.clearOperationError()}
          onCreateProjectSession={(projectId) => {
            setNavigatorLocateRequest(null);
            projectTree.selectProject(projectId);
            void projectSessions.createProjectSession(projectId);
          }}
          onCreateTemporarySession={() => void projectSessions.createTemporarySession()}
          onDeleteSession={(sessionId) => projectSessions.deleteSession(sessionId)}
          onRemoveProject={async (projectId) => {
            const removed = await projectTree.removeProject(projectId);
            if (removed) projectSessions.discardProjectSessions(projectId);
            return removed;
          }}
          onRenameProject={(projectId, name) => projectTree.renameProject(projectId, name)}
          onRenameSession={(sessionId, title) =>
            projectSessions.renameSession(sessionId, title)
          }
          onReorderSessions={(sessionIds) => projectSessions.reorderSessions(sessionIds)}
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
          sessions={projectSessions.sessions}
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
      <MediaPreviewDialogHost />
    </>
  );
}
