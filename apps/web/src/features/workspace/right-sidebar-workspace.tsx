import { useSidebarFileNavigation, useProjectImageNavigation } from "./use-sidebar-file-navigation.js";
import { useSidebarSessions } from "./use-sidebar-sessions.js";
import { SidebarWorkspaceTabs } from "./sidebar-workspace-tabs.js";
import { SidebarWorkspaceAddMenu } from "./sidebar-workspace-add-menu.js";
import { SidebarTabContextMenu } from "./sidebar-tab-context-menu.js";
import { useWorkspaceToolTabs } from "./use-workspace-tool-tabs.js";
import { useProjectFilePreviews } from "./use-project-file-previews.js";
import { useConfigurationFilePreviews } from "./use-configuration-file-previews.js";
import { TaskListWorkspace } from "../team/task-context-directory.js";
import {
  useCallback,
  useEffect,
  useEffectEvent,
  useMemo,
  useRef,
  useState,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
} from "react";

import type {
  ConversationSummary,
  ManagedBrowserSession,
  ManagedBrowserWorkspaceAddAction,
  ManagedBrowserWorkspaceTabAction,
  ProjectEntry,
  ProjectSummary,
  TerminalSession,
  TeamInstanceView,
} from "@agent/protocol";

import { WorkbenchPanel } from "../../components/layout/panel.js";
import { ResizableDivider } from "../../components/layout/resizable-divider.js";
import { TooltipSideContext } from "../../components/ui/tooltip.js";
import { appendNewTabIds, moveTabId } from "../../components/ui/tab-order.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import {
  resolveActiveSettingsWorkspaceTarget,
  useWorkbenchUiStore,
  type AgentPromptWorkspaceTarget,
  type ConfigurationWorkspaceTarget,
} from "../../stores/workbench-ui-store.js";
import { useConversationWorkspaceCache } from "../chat/conversation-workspace-cache.js";
import { ConversationWorkspace } from "../chat/workspace-content.js";
import { teamChatTabId } from "../chat/workbench-tabs.js";
import { TeamChatDetails } from "../team/team-chat-details.js";
import { ConfigurationWorkspaceTreePanel } from "./configuration-workspace-tree-panel.js";
import { getGitReviewCache } from "./git-review-cache.js";
import { ConversationReviewWorkspace } from "./conversation-review-workspace.js";
import { GitReviewWorkspace } from "./git-review-workspace.js";
import {
  ManagedBrowserWorkspace,
  type ManagedBrowserWorkspaceMenuRequest,
} from "./managed-browser-workspace.js";
import { ProjectTreePanel } from "../projects/project-tree-panel.js";
import { TerminalWorkspace } from "./terminal-workspace.js";
import { BackgroundCommandWorkspace } from "./background-command-workspace.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import type { ProjectTreeController } from "../projects/use-project-tree.js";
import "./right-sidebar-workspace.css";

import { RightSidebarEmptyState } from "./right-sidebar-empty-state.js";
import { FilePreview } from "./sidebar-project-file-preview.js";
import { AgentPromptPreview } from "./sidebar-agent-prompt-preview.js";
import { ConfigurationFilePreview } from "./sidebar-configuration-file-preview.js";
import { shouldDeleteSidebarChat, toProjectSession } from "./sidebar-conversation-model.js";
import {
  activeSidebarTabIdAfterClosingTabs,
  agentPromptTabId,
  configurationFileTabId,
  fileTabId,
  nextTerminalTabName,
  nextWorkspaceTabName,
  shouldCollapseRightSidebarAfterClosingTabs,
  targetForConfigurationTab,
} from "./sidebar-tab-model.js";
import { directoryPathForFile } from "./sidebar-file-model.js";
import type {
  AgentPromptTab,
  ConfigurationFileTab,
  FileTab,
  GitReviewOpenRequest,
  ManagedBrowserTab,
  ProjectFileOpenRequest,
  ProjectFileTab,
  SidebarTab,
  TabContextMenuState,
  TeamMemberOpenRequest,
} from "./sidebar-workspace-types.js";

export { RightSidebarEmptyState } from "./right-sidebar-empty-state.js";
export {
  isAutoOpenedSideConversation,
  isDirectTeamMemberConversation,
  shouldDeleteSidebarChat,
  shouldLoadSideConversations,
  updateSideSessionsForRunEvent,
  upsertSideSession,
} from "./sidebar-conversation-model.js";
export {
  activeSidebarTabIdAfterClosingTabs,
  nextTerminalTabName,
  nextWorkspaceTabName,
  scrollWorkspaceTabsOnWheel,
  shouldCollapseRightSidebarAfterClosingTabs,
} from "./sidebar-tab-model.js";
export {
  isProjectPreviewImagePath,
  projectImageNavigation,
  type ProjectImageNavigation,
} from "./sidebar-file-model.js";
export type { GitReviewOpenRequest, ProjectFileOpenRequest, TeamMemberOpenRequest } from "./sidebar-workspace-types.js";

const FILE_TREE_WIDTH_RANGE = { max: 360, min: 220 } as const;

export function RightSidebarWorkspace({
  activeProject,
  activeSession,
  teamChat = null,
  sessions = [],
  teamInstances = [],
  agentClient,
  fileOpenRequest,
  gitReviewOpenRequest = null,
  teamMemberOpenRequest,
  onLocateProject,
  onLocateSession,
  onLocateConversationItem,
  onSessionViewed,
  onSessionUpdated,
  onRenameTeamInstance,
  tree,
}: {
  activeProject: ProjectSummary | null;
  activeSession: ProjectSession | null;
  teamChat?: TeamInstanceView | null;
  sessions?: readonly ProjectSession[];
  teamInstances?: readonly TeamInstanceView[];
  agentClient: AgentClient;
  fileOpenRequest: ProjectFileOpenRequest | null;
  gitReviewOpenRequest?: GitReviewOpenRequest | null;
  teamMemberOpenRequest: TeamMemberOpenRequest | null;
  onLocateProject: (projectId: string) => void;
  onLocateSession: (sessionId: string) => void;
  onLocateConversationItem?: (conversationId: string, itemId: string) => void;
  onSessionViewed: (sessionId: string) => void;
  onSessionUpdated: (conversation: ConversationSummary) => void;
  onRenameTeamInstance?: (instanceId: string, name: string) => Promise<boolean>;
  tree: ProjectTreeController;
}): ReactElement {
  const gitReviewCache = getGitReviewCache(agentClient);
  const isDark = useWorkbenchUiStore((state) => state.themeMode === "dark");
  const activeActivity = useWorkbenchUiStore((state) => state.activeActivity);
  const backgroundCommandViewRequest = useWorkbenchUiStore(state => state.backgroundCommandViewRequest);
  const handledBackgroundCommandRequest = useRef<string | null>(null);
  const conversationReviewViewRequest = useWorkbenchUiStore(state => state.conversationReviewViewRequest);
  const handledConversationReviewRequest = useRef<string | null>(null);
  const activeSessionId = activeSession?.id ?? null;
  const workspaceId = teamChat === null ? activeSessionId : teamChatTabId(teamChat.id);
  const taskListViewRequest = useWorkbenchUiStore(state => state.taskListViewRequest);
  const handledTaskListRequest = useRef<string | null>(null);
  const detailsTarget = useWorkbenchUiStore(state => state.teamChatDetailsTarget);
  const handledDetailsRequest = useRef<string | null>(null);
  const sidebarVisible = useWorkbenchUiStore((state) => activeActivity === "settings"
    ? state.isSettingsFilePanelOpen
    : activeActivity === "conversations" && workspaceId !== null
      ? state.filePanelOpenByConversationId[workspaceId] ?? false
      : state.isFilePanelOpen);
  const settingsSection = useWorkbenchUiStore((state) => state.settingsSection);
  const setGlobalFilePanelOpen = useWorkbenchUiStore((state) => state.setFilePanelOpen);
  const setFilePanelOpenForConversation = useWorkbenchUiStore(
    (state) => state.setFilePanelOpenForConversation,
  );
  const setSettingsFilePanelOpen = useWorkbenchUiStore(
    (state) => state.setSettingsFilePanelOpen,
  );
  const closeAgentPromptWorkspace = useWorkbenchUiStore(
    (state) => state.closeAgentPromptWorkspace,
  );
  const closeConfigurationWorkspace = useWorkbenchUiStore(
    (state) => state.closeConfigurationWorkspace,
  );
  const configurationWorkspaceTarget = useWorkbenchUiStore(
    (state) => state.configurationWorkspaceTarget,
  );
  const agentPromptWorkspaceTarget = useWorkbenchUiStore(
    (state) => state.agentPromptWorkspaceTarget,
  );
  const activeSettingsWorkspaceTarget = useMemo(
    () => resolveActiveSettingsWorkspaceTarget(
      activeActivity,
      settingsSection,
      agentPromptWorkspaceTarget,
      configurationWorkspaceTarget,
    ),
    [
      activeActivity,
      agentPromptWorkspaceTarget,
      configurationWorkspaceTarget,
      settingsSection,
    ],
  );
  const setFilePanelOpen = useCallback((isOpen: boolean): void => {
    if (activeActivity === "settings") {
      setSettingsFilePanelOpen(isOpen);
      return;
    }
    if (activeActivity === "conversations" && workspaceId !== null) {
      setFilePanelOpenForConversation(workspaceId, isOpen);
      return;
    }
    setGlobalFilePanelOpen(isOpen);
  }, [
    activeActivity,
    workspaceId,
    setFilePanelOpenForConversation,
    setGlobalFilePanelOpen,
    setSettingsFilePanelOpen,
  ]);
  const reloadProjectDirectory = tree.reloadDirectory;
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const { filePreviews, flushFileSave, hasFilePreview, loadFile, markFileDirty, overwriteFile, updateFileDraft } = useProjectFilePreviews({ agentClient, activeProjectId: activeProject?.id, fileTabs, reloadProjectDirectory });
  const { configurationFilePreviews, flushConfigurationFile, forgetConfigurationPreviews, hasPendingConfigurationFile, hasUnsavedConfigurationFile, loadConfigurationFile, updateConfigurationDraft } = useConfigurationFilePreviews(agentClient);
  const [tabOrder, setTabOrder] = useState<string[]>([]);
  const [capabilities, setCapabilities] = useState({ git: false, managedBrowser: false, pty: false });
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [managedBrowserMenuRequest, setManagedBrowserMenuRequest] = useState<{
    request: ManagedBrowserWorkspaceMenuRequest;
    tabId: string;
  } | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const { activeTabId, activeTeam, coordinationLocation, getCoordinationSessions, forgetCoordinationSessions, openChatIds, setActiveTabForCurrentSession: selectSidebarTab, setSideSessions, sideSessions, updateOpenChatIds, updateSideSession } = useSidebarSessions({ agentClient, activeSession, teamChat, teamMemberOpenRequest, onSessionUpdated, setFilePanelOpen, setIsFileBrowserOpen, setOperationError });
  const { toolTabs, setToolTabs, retainedToolTabs } = useWorkspaceToolTabs(agentClient, activeTabId);
  const relatedSessions = useMemo(() => [...new Map([...sessions, ...sideSessions].map(item => [item.id, item])).values()], [sessions, sideSessions]);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false);
  const [fileTreeWidth, setFileTreeWidth] = useState<number | null>(null);
  const handledFileOpenRequestRef = useRef<ProjectFileOpenRequest | null>(null);
  const handledGitReviewOpenRequestIdRef = useRef<number | null>(null);
  const managedBrowserMenuRequestIdRef = useRef(0);

  useEffect(() => {
    let disposed = false;
    void agentClient.getCapabilities().then((next) => {
      if (!disposed) {
        setCapabilities({ git: next.git, managedBrowser: next.managedBrowser, pty: next.pty });
      }
    }).catch(() => undefined);
    return () => {
      disposed = true;
    };
  }, [agentClient]);

  useEffect(() => {
    gitReviewCache.activateProject(activeProject?.id ?? null);
  }, [activeProject?.id, gitReviewCache]);

  useEffect(() => {
    if (!capabilities.git || activeProject === null) return;
    const warm = (): void => {
      void gitReviewCache.warmProject(activeProject.id).catch(() => {
        // Opening the Git workspace reports foreground failures; project warming stays silent.
      });
    };
    warm();
    window.addEventListener("focus", warm);
    return () => window.removeEventListener("focus", warm);
  }, [activeProject, capabilities.git, gitReviewCache]);

  const setActiveTabForCurrentSession = useCallback((tabId: string | null): void => {
    selectSidebarTab(tabId);
    if (activeActivity === "settings") return;
      if (tabId !== null) {
        const now = Date.now();
        setToolTabs((current) => {
          const index = current.findIndex((tab) => tab.id === tabId);
          if (index === -1) return current;
          const tab = current[index];
          if (tab === undefined) return current;
          const next = [...current];
          next[index] = { ...tab, lastAccessedAt: now };
          return next;
        });
      }

  }, [activeActivity, selectSidebarTab, setToolTabs]);
  const openTerminal = useCallback((
    requestedName?: string,
    session: TerminalSession | null = null,
  ): string | null => {
    if (!capabilities.pty || activeProject === null) return null;
    const id = `terminal:${crypto.randomUUID()}`;
    const now = Date.now();
    const name = requestedName === undefined
      ? nextTerminalTabName(toolTabs, activeProject.id)
      : nextWorkspaceTabName([
        ...fileTabs,
        ...toolTabs,
        ...sideSessions.map((sideSession) => ({ name: sideSession.title })),
      ], requestedName);
    setToolTabs((current) => [...current, {
      id,
      kind: "terminal",
      lastAccessedAt: now,
      name,
      projectId: activeProject.id,
      session,
    }]);
    setActiveTabForCurrentSession(id);
    setFilePanelOpen(true);
    setIsFileBrowserOpen(false);
    setMenuOpen(false);
    return name;
  }, [activeProject, capabilities.pty, fileTabs, setActiveTabForCurrentSession, setFilePanelOpen, setToolTabs, sideSessions, toolTabs]);
  const openManagedBrowser = useCallback((
    requestedName?: string,
    session: ManagedBrowserSession | null = null,
    background = false,
    conversationId = activeSessionId,
  ): string | null => {
    if (!capabilities.managedBrowser) return null;
    const id = `managed-browser:${crypto.randomUUID()}`;
    const now = Date.now();
    const name = requestedName === undefined
      ? "新标签页"
      : nextWorkspaceTabName([
        ...fileTabs,
        ...toolTabs,
        ...sideSessions.map((sideSession) => ({ name: sideSession.title })),
      ], requestedName);
    setToolTabs((current) => [...current, {
      id,
      kind: "managed-browser",
      conversationId,
      background,
      lastAccessedAt: now,
      name,
      session,
      url: session?.url ?? "",
    }]);
    if (!background) {
      setActiveTabForCurrentSession(id);
      setFilePanelOpen(true);
      setIsFileBrowserOpen(false);
      setMenuOpen(false);
    }
    return name;
  }, [activeSessionId, capabilities.managedBrowser, fileTabs, setActiveTabForCurrentSession, setFilePanelOpen, setToolTabs, sideSessions, toolTabs]);

  useEffect(() => {
    if (teamChat === null || detailsTarget?.instanceId !== teamChat.id || handledDetailsRequest.current === detailsTarget.requestId) return;
    handledDetailsRequest.current = detailsTarget.requestId;
    const id = `group-details:${teamChat.id}`;
    setToolTabs(current => current.some(tab => tab.id === id)
      ? current.map(tab => tab.id === id ? { ...tab, section: detailsTarget.section, lastAccessedAt: Date.now() } : tab)
      : [...current, { id, kind: "group-details", instance: teamChat, section: detailsTarget.section, name: "群资料", lastAccessedAt: Date.now() }]);
    setActiveTabForCurrentSession(id); setIsFileBrowserOpen(false);
  }, [detailsTarget, teamChat, setActiveTabForCurrentSession, setToolTabs]);

  useEffect(() => {
    const request = conversationReviewViewRequest;
    if (request === null || handledConversationReviewRequest.current === request.requestId
      || (request.conversationId !== activeSessionId && !openChatIds.has(request.conversationId))) return;
    handledConversationReviewRequest.current = request.requestId;
    const id = `conversation-review:${request.conversationId}:${request.runId ?? "all"}`;
    setToolTabs(current => current.some(tab => tab.id === id)
      ? current.map(tab => tab.id === id ? { ...tab, lastAccessedAt: Date.now() } : tab)
      : [...current, { id, kind: "conversation-review", conversationId: request.conversationId,
        runId: request.runId, name: "审阅", lastAccessedAt: Date.now() }]);
    setActiveTabForCurrentSession(id); setFilePanelOpen(true); setIsFileBrowserOpen(false);
  }, [activeSessionId, conversationReviewViewRequest, openChatIds, setActiveTabForCurrentSession, setFilePanelOpen, setToolTabs]);

  useEffect(() => {
    const request = backgroundCommandViewRequest;
    if (request === null || handledBackgroundCommandRequest.current === request.requestId
      || (request.conversationId !== activeSessionId && !openChatIds.has(request.conversationId))) return;
    handledBackgroundCommandRequest.current = request.requestId;
    const id = `background-command:${request.commandId}`;
    setToolTabs(current => current.some(tab => tab.id === id)
      ? current.map(tab => tab.id === id ? { ...tab, lastAccessedAt: Date.now() } : tab)
      : [...current, { id, kind: "background-command", conversationId: request.conversationId,
        commandId: request.commandId, name: `运行：${request.name}`, lastAccessedAt: Date.now() }]);
    setActiveTabForCurrentSession(id); setFilePanelOpen(true); setIsFileBrowserOpen(false);
  }, [activeSessionId, backgroundCommandViewRequest, openChatIds, setActiveTabForCurrentSession, setFilePanelOpen, setToolTabs]);

  useEffect(() => {
    return agentClient.onWorkspaceTerminalTabOpenRequested((request) => {
      if (
        (request.conversationId !== activeSessionId && !openChatIds.has(request.conversationId))
        || request.projectId !== activeProject?.id
        || !capabilities.pty
      ) {
        return;
      }
      const resolvedName = openTerminal(request.requestedName ?? undefined, request.session);
      if (resolvedName === null) return;
      void agentClient.confirmWorkspaceTerminalTabOpened({
        requestId: request.requestId,
        resolvedName,
      }).catch(() => undefined);
    });
  }, [
    activeProject?.id,
    activeSessionId,
    agentClient,
    capabilities.pty,
    fileTabs,
    openChatIds,
    openTerminal,
    sideSessions,
    toolTabs,
  ]);

  useEffect(() => {
    return agentClient.onWorkspaceTerminalTabCloseRequested((request) => {
      if (
        (request.conversationId !== activeSessionId && !openChatIds.has(request.conversationId))
        || activeProject === null
      ) {
        return;
      }
      const closedTabIds = new Set(toolTabs
        .filter((tab) => tab.kind === "terminal" && tab.session?.sessionId === request.sessionId)
        .map((tab) => tab.id));
      if (closedTabIds.size === 0) return;
      const openTabs = [
        ...fileTabs.filter((tab) => tab.kind === "file"),
        ...toolTabs,
        ...sideSessions
          .filter((session) => openChatIds.has(session.id))
          .map((session) => ({ id: `chat:${session.id}` })),
      ];
      const nextActiveTabId = activeSidebarTabIdAfterClosingTabs(
        openTabs,
        activeTabId,
        closedTabIds,
      );
      setToolTabs((current) => current.filter((tab) => !closedTabIds.has(tab.id)));
      if (activeTabId !== null && closedTabIds.has(activeTabId)) {
        setActiveTabForCurrentSession(nextActiveTabId);
        setIsFileBrowserOpen(false);
        setIsTreeCollapsed(false);
        if (nextActiveTabId === null) setFilePanelOpen(false);
      }
    });
  }, [activeProject, activeSessionId, activeTabId, agentClient, openChatIds, setFilePanelOpen, setActiveTabForCurrentSession, sideSessions, fileTabs, toolTabs, setToolTabs]);

  useEffect(() => {
    return agentClient.onWorkspaceBrowserTabOpenRequested((request) => {
      const conversation = request.conversationId === activeSessionId
        ? activeSession
        : sideSessions.find((session) => session.id === request.conversationId && openChatIds.has(session.id));
      if (
        (conversation != null && request.projectId !== (conversation.projectId ?? conversation.id))
        || (request.background !== true && conversation == null)
        || !capabilities.managedBrowser
      ) {
        return;
      }
      const existing = toolTabs.find((tab) => tab.kind === "managed-browser" && tab.session?.sessionId === request.session.sessionId);
      if (existing !== undefined && request.background !== true) {
        setActiveTabForCurrentSession(existing.id);
        setFilePanelOpen(true);
        setIsFileBrowserOpen(false);
      }
      const resolvedName = existing?.name ?? openManagedBrowser(request.requestedName ?? undefined, request.session, request.background === true, request.conversationId);
      if (resolvedName === null) return;
      void agentClient.confirmWorkspaceBrowserTabOpened({
        requestId: request.requestId,
        resolvedName,
      }).catch(() => undefined);
    });
  }, [
    activeSession,
    activeSessionId,
    agentClient,
    capabilities.managedBrowser,
    fileTabs,
    openChatIds,
    openManagedBrowser,
    setActiveTabForCurrentSession,
    setFilePanelOpen,
    sideSessions,
    toolTabs,
  ]);

  useEffect(() => {
    return agentClient.onWorkspaceBrowserTabCloseRequested((request) => {
      const closedTabIds = new Set(toolTabs
        .filter((tab) => tab.kind === "managed-browser" && tab.conversationId === request.conversationId && tab.session?.sessionId === request.sessionId)
        .map((tab) => tab.id));
      if (closedTabIds.size === 0) return;
      const openTabs = [
        ...fileTabs.filter((tab) => tab.kind === "file"),
        ...toolTabs,
        ...sideSessions
          .filter((session) => openChatIds.has(session.id))
          .map((session) => ({ id: `chat:${session.id}` })),
      ];
      const nextActiveTabId = activeSidebarTabIdAfterClosingTabs(
        openTabs,
        activeTabId,
        closedTabIds,
      );
      setToolTabs((current) => current.filter((tab) => !closedTabIds.has(tab.id)));
      if (activeTabId !== null && closedTabIds.has(activeTabId)) {
        setActiveTabForCurrentSession(nextActiveTabId);
        setIsFileBrowserOpen(false);
        setIsTreeCollapsed(false);
        if (nextActiveTabId === null) setFilePanelOpen(false);
      }
    });
  }, [activeSessionId, activeTabId, agentClient, openChatIds, setFilePanelOpen, setActiveTabForCurrentSession, sideSessions, fileTabs, toolTabs, setToolTabs]);

  useEffect(() => {
    const request = taskListViewRequest;
    if (activeActivity !== "conversations" || request === null || request.workspaceId !== workspaceId
      || handledTaskListRequest.current === request.requestId) return;
    handledTaskListRequest.current = request.requestId;
    const id = `tasks:${workspaceId}`;
    setToolTabs(current => current.some(tab => tab.id === id)
      ? current.map(tab => tab.id === id ? { id, name: "任务列表", kind: "task-list" as const, request, lastAccessedAt: Date.now() } : tab)
      : [...current, { id, name: "任务列表", kind: "task-list", request, lastAccessedAt: Date.now() }]);
    setActiveTabForCurrentSession(id); setIsFileBrowserOpen(false); setFilePanelOpen(true);
  }, [activeActivity, workspaceId, taskListViewRequest, setActiveTabForCurrentSession, setFilePanelOpen, setToolTabs]);

  const openFile = useCallback(
    (entry: ProjectEntry): void => {
      if (activeProject === null) return;
      const tab: ProjectFileTab = {
        id: fileTabId(activeProject.id, entry.path),
        kind: "file",
        javaDeclarationKind: entry.javaDeclarationKind,
        name: entry.name,
        path: entry.path,
        projectId: activeProject.id,
      };
      const alreadyOpen = fileTabs.some((candidate) => candidate.id === tab.id);
      setFileTabs((current) =>
        current.some((candidate) => candidate.id === tab.id) ? current : [...current, tab],
      );
      setActiveTabForCurrentSession(tab.id);
      setFilePanelOpen(true);
      setIsFileBrowserOpen(false);
      // Re-clicking an already-open tab must not reload and discard its unsaved draft.
      if (!alreadyOpen || !hasFilePreview(tab.id)) void loadFile(tab);
    },
    [activeProject, fileTabs, hasFilePreview, loadFile, setActiveTabForCurrentSession, setFilePanelOpen],
  );

  const openAgentPromptTab = useCallback(
    (target: AgentPromptWorkspaceTarget): void => {
      const tab: AgentPromptTab = {
        agentId: target.agentId,
        id: agentPromptTabId(target.agentId),
        kind: "agent-prompt",
        name: target.title,
        title: target.title,
      };
      setFileTabs((current) => (
        current.some((candidate) => candidate.id === tab.id) ? current : [...current, tab]
      ));
      setActiveTabForCurrentSession(tab.id);
      setFilePanelOpen(true);
      setIsFileBrowserOpen(false);
      setIsTreeCollapsed(false);
    },
    [setActiveTabForCurrentSession, setFilePanelOpen],
  );

  const openConfigurationFile = useCallback(
    (target: ConfigurationWorkspaceTarget, path: string): void => {
      const tab: ConfigurationFileTab = {
        configurationId: target.configurationId,
        configurationKind: target.kind,
        id: configurationFileTabId(target.kind, target.configurationId, path),
        kind: "configuration-file",
        name: path.split("/").at(-1) ?? path,
        path,
        title: target.title,
      };
      setFileTabs((current) => (
        current.some((candidate) => candidate.id === tab.id) ? current : [...current, tab]
      ));
      setActiveTabForCurrentSession(tab.id);
      setIsFileBrowserOpen(false);
      setIsTreeCollapsed(false);
      if (!hasUnsavedConfigurationFile(tab.id)) {
        void loadConfigurationFile(tab);
      }
    },
    [hasUnsavedConfigurationFile, loadConfigurationFile, setActiveTabForCurrentSession],
  );

  const createSideChat = useCallback(async (): Promise<void> => {
    if (activeSession === null || isCreatingChat) return;
    setIsCreatingChat(true);
    setOperationError(null);
    try {
      const conversation = await agentClient.forkConversation({
        conversationId: activeSession.id,
      });
      const session = toProjectSession(conversation);
      updateSideSession(conversation);
      updateOpenChatIds((current) => new Set(current).add(session.id));
      setActiveTabForCurrentSession(`chat:${session.id}`);
      setIsFileBrowserOpen(false);
      setMenuOpen(false);
    } catch {
      setOperationError("无法创建侧边聊天");
    } finally {
      setIsCreatingChat(false);
    }
  }, [
    activeSession,
    agentClient,
    isCreatingChat,
    setActiveTabForCurrentSession,
    updateSideSession,
    updateOpenChatIds,
  ]);

  const openSideSessions = useMemo(
    () => sideSessions.filter((session) => openChatIds.has(session.id)),
    [openChatIds, sideSessions],
  );
  const visibleFileTabs = useMemo(() => {
    if (activeActivity !== "settings") {
      return fileTabs.filter((tab): tab is ProjectFileTab => tab.kind === "file");
    }
    if (activeSettingsWorkspaceTarget?.kind === "agent-prompt") {
      return fileTabs.filter((tab): tab is AgentPromptTab => (
        tab.kind === "agent-prompt"
        && tab.agentId === activeSettingsWorkspaceTarget.target.agentId
      ));
    }
    if (activeSettingsWorkspaceTarget?.kind === "configuration") {
      return fileTabs.filter((tab): tab is ConfigurationFileTab => (
        tab.kind === "configuration-file"
        && tab.configurationId === activeSettingsWorkspaceTarget.target.configurationId
        && tab.configurationKind === activeSettingsWorkspaceTarget.target.kind
      ));
    }
    return [];
  }, [activeActivity, activeSettingsWorkspaceTarget, fileTabs]);
  const unorderedTabs = useMemo<SidebarTab[]>(
    () => activeActivity === "settings"
      ? visibleFileTabs
      : [
        ...visibleFileTabs,
        ...toolTabs.filter(tab => tab.kind !== "group-details" || workspaceId === teamChatTabId(tab.instance.id)),
        ...openSideSessions
        .map((session): SidebarTab => ({
          id: `chat:${session.id}`,
          kind: "chat",
          name: session.title,
          session,
        })),
      ],
    [activeActivity, openSideSessions, toolTabs, visibleFileTabs, workspaceId],
  );
  const nextTabOrder = appendNewTabIds(tabOrder, unorderedTabs.map((tab) => tab.id));
  if (nextTabOrder !== tabOrder) setTabOrder(nextTabOrder);
  const tabRanks = new Map(nextTabOrder.map((id, index) => [id, index]));
  const tabs = [...unorderedTabs].sort((a, b) => tabRanks.get(a.id)! - tabRanks.get(b.id)!);
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const availableSideSessions = useMemo(() => [...new Map([...openSideSessions, ...getCoordinationSessions()].map(session => [session.id, session])).values()], [getCoordinationSessions, openSideSessions]);
  const retainedSideSessions = useConversationWorkspaceCache(
    activeTab?.kind === "chat" ? activeTab.session : null,
    availableSideSessions,
  );
  const activeConfigurationTab = activeTab?.kind === "configuration-file" ? activeTab : null;
  const activeConfigurationTarget = activeConfigurationTab === null
    ? null
    : targetForConfigurationTab(activeConfigurationTab);
  const activeConfigurationPreview = activeConfigurationTab === null
    ? undefined
    : configurationFilePreviews[activeConfigurationTab.id];
  const activeAgentPromptTab = activeTab?.kind === "agent-prompt" ? activeTab : null;
  const activeFileTab = activeTab?.kind === "file" ? activeTab : null;
  const activeFilePreview = activeFileTab === null
    ? undefined
    : filePreviews[activeFileTab.id];
  const activeImageNavigation = useProjectImageNavigation(activeFileTab?.path ?? null, tree.directories);
  const { openProjectFile, openProjectFilePath } = useSidebarFileNavigation({ activeConfigurationTab, activeFileTab, flushConfigurationFile, flushFileSave, openFile });
  const showFileWorkspace = activeTab?.kind === "file"
    || activeConfigurationTab !== null
    || isFileBrowserOpen;
  const ensureProjectRootLoaded = tree.ensureRootLoaded;
  useEffect(() => {
    if (sidebarVisible && showFileWorkspace && activeConfigurationTarget === null) ensureProjectRootLoaded();
  }, [sidebarVisible, showFileWorkspace, activeConfigurationTarget, ensureProjectRootLoaded]);

  useEffect(() => {
    if (
      activeFileTab === null
      || activeFilePreview?.isDirty !== true
      || activeFilePreview.file === null
      || activeFilePreview.file.content === null
      || activeFilePreview.file.isBinary
      || activeFilePreview.file.truncated
      || activeFilePreview.draft === activeFilePreview.savedContent
      || (activeFilePreview.conflict !== null && activeFilePreview.conflict !== "locked")
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void flushFileSave({ ...activeFileTab });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    activeFilePreview?.conflict,
    activeFilePreview?.draft,
    activeFilePreview?.file,
    activeFilePreview?.isDirty,
    activeFilePreview?.isSaving,
    activeFilePreview?.savedContent,
    activeFileTab,
    flushFileSave,
  ]);

  useEffect(() => {
    if (
      activeConfigurationTab === null
      || activeConfigurationPreview?.isDirty !== true
      || activeConfigurationPreview.file === null
      || activeConfigurationPreview.file.content === null
      || activeConfigurationPreview.file.isBinary
      || activeConfigurationPreview.file.truncated
    ) {
      return undefined;
    }
    const timer = window.setTimeout(() => {
      void flushConfigurationFile({ ...activeConfigurationTab });
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    activeConfigurationPreview?.draft,
    activeConfigurationPreview?.file,
    activeConfigurationPreview?.isDirty,
    activeConfigurationTab,
    flushConfigurationFile,
  ]);

  const flushPendingConfigurationFiles = useEffectEvent(async (): Promise<boolean> => {
    for (const tab of fileTabs) {
      if (tab.kind !== "configuration-file") continue;
      if (!hasPendingConfigurationFile(tab.id)) continue;
      if (!await flushConfigurationFile({ ...tab })) return false;
    }
    return true;
  });

  useEffect(() => {
    if (activeSettingsWorkspaceTarget?.kind !== "configuration") return;
    const { target } = activeSettingsWorkspaceTarget;
    const path = target.kind === "skill" ? "SKILL.md" : "mcp.json";
    let cancelled = false;
    void (async () => {
      if (!await flushPendingConfigurationFiles() || cancelled) return;
      openConfigurationFile(target, path);
    })();
    return () => { cancelled = true; };
  }, [activeSettingsWorkspaceTarget, openConfigurationFile]);

  useEffect(() => {
    if (activeSettingsWorkspaceTarget?.kind !== "agent-prompt") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Synchronize the external settings document request with its tab.
    openAgentPromptTab(activeSettingsWorkspaceTarget.target);
  }, [activeSettingsWorkspaceTarget, openAgentPromptTab]);

  async function activateTab(tab: SidebarTab): Promise<void> {
    if (
      activeConfigurationTab !== null
      && activeConfigurationTab.id !== tab.id
      && !await flushConfigurationFile({ ...activeConfigurationTab })
    ) {
      return;
    }
    if (
      activeFileTab !== null
      && activeFileTab.id !== tab.id
      && !await flushFileSave({ ...activeFileTab })
    ) return;
    setActiveTabForCurrentSession(tab.id);
    if (tab.kind === "chat") onSessionViewed(tab.session.id);
    setIsFileBrowserOpen(false);
  }

  function openFileBrowser(): void {
    if (activeFileTab !== null) {
      void flushFileSave({ ...activeFileTab }).then((saved) => {
        if (!saved) return;
        setActiveTabForCurrentSession(null);
        setIsFileBrowserOpen(true);
        setIsTreeCollapsed(false);
      });
      return;
    }
    setActiveTabForCurrentSession(null);
    setIsFileBrowserOpen(true);
    setIsTreeCollapsed(false);
  }

  const openGitReview = useCallback((): void => {
    if (!capabilities.git || activeProject === null) return;
    const id = `git-review:${activeProject.id}`;
    const now = Date.now();
    setToolTabs((current) => current.some((tab) => tab.id === id)
      ? current
      : [...current, {
        id,
        kind: "git-review",
        lastAccessedAt: now,
        name: "审阅",
        projectId: activeProject.id,
      }]);
    setActiveTabForCurrentSession(id);
    setFilePanelOpen(true);
    setIsFileBrowserOpen(false);
    setMenuOpen(false);
  }, [activeProject, capabilities.git, setActiveTabForCurrentSession, setFilePanelOpen, setToolTabs]);

  useEffect(() => {
    if (
      gitReviewOpenRequest === null
      || gitReviewOpenRequest.projectId !== activeProject?.id
      || handledGitReviewOpenRequestIdRef.current === gitReviewOpenRequest.requestId
      || !capabilities.git
    ) return;
    handledGitReviewOpenRequestIdRef.current = gitReviewOpenRequest.requestId;
    openGitReview();
  }, [activeProject?.id, capabilities.git, gitReviewOpenRequest, openGitReview]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.shiftKey && event.key.toLocaleLowerCase("en-US") === "g") {
        event.preventDefault();
        openGitReview();
        return;
      }
      if (!event.shiftKey && event.key === "`") {
        event.preventDefault();
        openTerminal();
        return;
      }
      if (!event.shiftKey && event.key.toLocaleLowerCase("en-US") === "t") {
        event.preventDefault();
        openManagedBrowser();
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  });

  useEffect(() => {
    if (
      fileOpenRequest === null
      || activeProject?.id !== fileOpenRequest.projectId
      || handledFileOpenRequestRef.current === fileOpenRequest
    ) {
      return;
    }
    handledFileOpenRequestRef.current = fileOpenRequest;
    void openProjectFilePath(fileOpenRequest.path);
  }, [activeProject?.id, fileOpenRequest, openProjectFilePath]);

  async function openConfigurationPath(path: string): Promise<void> {
    const target = activeConfigurationTarget ?? configurationWorkspaceTarget;
    if (target === null) return;
    if (
      activeConfigurationTab !== null
      && activeConfigurationTab.path !== path
      && !await flushConfigurationFile({ ...activeConfigurationTab })
    ) {
      return;
    }
    if (activeFileTab !== null && !await flushFileSave({ ...activeFileTab })) return;
    openConfigurationFile(target, path);
  }

  function commitCloseTabs(tabsToClose: SidebarTab[]): void {
    const tabIds = new Set(tabsToClose.map((tab) => tab.id));
    setTabOrder((current) => current.filter((id) => !tabIds.has(id)));
    const sessionIds = new Set(
      tabsToClose
        .filter((tab): tab is Extract<SidebarTab, { kind: "chat" }> => tab.kind === "chat")
        .map((tab) => tab.session.id),
    );
    if (tabIds.size === 0) return;
    const shouldCollapseRightSidebar = shouldCollapseRightSidebarAfterClosingTabs(tabs, tabIds);
    const nextActiveTabId = activeSidebarTabIdAfterClosingTabs(tabs, activeTabId, tabIds);

    for (const tab of tabsToClose) {
      if (tab.kind === "agent-prompt") {
        closeAgentPromptWorkspace(tab.agentId);
        continue;
      }
      if (tab.kind !== "configuration-file") continue;
      const hasRemainingConfigurationTab = fileTabs.some((candidate) => (
        candidate.kind === "configuration-file"
        && candidate.configurationId === tab.configurationId
        && candidate.configurationKind === tab.configurationKind
        && !tabIds.has(candidate.id)
      ));
      if (!hasRemainingConfigurationTab) {
        closeConfigurationWorkspace({
          configurationId: tab.configurationId,
          kind: tab.configurationKind,
        });
      }
    }

    setFileTabs((current) => current.filter((candidate) => !tabIds.has(candidate.id)));
    setToolTabs((current) => current.filter((candidate) => !tabIds.has(candidate.id)));
    forgetCoordinationSessions(sessionIds);
    forgetConfigurationPreviews(tabIds);
    if (sessionIds.size > 0) {
      setSideSessions((current) => current.filter((session) => !sessionIds.has(session.id)));
      updateOpenChatIds((current) => {
        const next = new Set(current);
        for (const sessionId of sessionIds) next.delete(sessionId);
        return next;
      });
    }

    if (shouldCollapseRightSidebar) {
      setActiveTabForCurrentSession(null);
      setIsFileBrowserOpen(false);
      setIsTreeCollapsed(false);
    } else if (activeTabId !== null && tabIds.has(activeTabId)) {
      setActiveTabForCurrentSession(nextActiveTabId);
      setIsFileBrowserOpen(false);
      setIsTreeCollapsed(false);
      const nextActiveTab = tabs.find((tab) => tab.id === nextActiveTabId);
      if (nextActiveTab?.kind === "chat") onSessionViewed(nextActiveTab.session.id);
    }
    setTabContextMenu(null);
    if (shouldCollapseRightSidebar) setFilePanelOpen(false);
  }

  async function closeTabs(tabsToClose: SidebarTab[]): Promise<void> {
    setOperationError(null);
    for (const tab of tabsToClose) {
      if (tab.kind === "configuration-file" && !await flushConfigurationFile({ ...tab })) return;
      if (tab.kind === "file" && !await flushFileSave({ ...tab })) return;
    }

    const closedTabs: SidebarTab[] = [];
    for (const tab of tabsToClose) {
      if (tab.kind === "terminal" && tab.session !== null) {
        try {
          await agentClient.closeTerminalSession({ sessionId: tab.session.sessionId });
          closedTabs.push(tab);
        } catch (reason) {
          setOperationError(getUserErrorMessage(reason, "无法关闭终端。"));
        }
        continue;
      }
      if (tab.kind === "managed-browser" && tab.session !== null) {
        try {
          await agentClient.closeManagedBrowser({ sessionId: tab.session.sessionId });
          closedTabs.push(tab);
        } catch (reason) {
          setOperationError(getUserErrorMessage(reason, "无法关闭浏览器。"));
        }
        continue;
      }
      if (tab.kind !== "chat") {
        closedTabs.push(tab);
        continue;
      }
      if (tab.session.coordinationTeamInstanceId !== undefined || !shouldDeleteSidebarChat(tab.session, activeSession, activeTeam)) {
        closedTabs.push(tab);
        continue;
      }
      try {
        await agentClient.deleteConversation({ conversationId: tab.session.id });
        closedTabs.push(tab);
      } catch (reason) {
        setOperationError(getUserErrorMessage(reason, "无法删除侧边聊天"));
      }
    }
    commitCloseTabs(closedTabs);
  }

  function openFilesFromWorkspaceMenu(): void {
    void (async () => {
      if (
        activeConfigurationTab !== null
        && !await flushConfigurationFile({ ...activeConfigurationTab })
      ) return;
      openFileBrowser();
      setMenuOpen(false);
    })();
  }

  function handleWorkspaceAddMenuAction(action: ManagedBrowserWorkspaceAddAction): void {
    switch (action) {
      case "createSideChat":
        void createSideChat();
        return;
      case "openBrowser":
        openManagedBrowser();
        return;
      case "openFiles":
        openFilesFromWorkspaceMenu();
        return;
      case "openGitReview":
        openGitReview();
        return;
      case "openTerminal":
        openTerminal();
    }
  }

  function handleWorkspaceTabMenuAction(
    tab: ManagedBrowserTab,
    action: ManagedBrowserWorkspaceTabAction,
  ): void {
    switch (action) {
      case "close":
        void closeTabs([tab]);
        return;
      case "closeAll":
        void closeTabs(tabs);
        return;
      case "closeOthers":
        void closeTabs(tabs.filter((candidate) => candidate.id !== tab.id));
    }
  }

  function showNativeWorkspaceAddMenu(
    tab: ManagedBrowserTab,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    managedBrowserMenuRequestIdRef.current += 1;
    setManagedBrowserMenuRequest({
      request: {
        canCreateSideChat: activeSession !== null && !isCreatingChat,
        canOpenGitReview: capabilities.git && activeProject !== null,
        canOpenTerminal: capabilities.pty && activeProject !== null,
        id: managedBrowserMenuRequestIdRef.current,
        kind: "add",
        x: Math.max(0, Math.min(16_384, Math.round(bounds.left))),
        y: Math.max(0, Math.min(16_384, Math.round(bounds.bottom))),
      },
      tabId: tab.id,
    });
  }

  function showNativeWorkspaceTabMenu(
    tab: ManagedBrowserTab,
    event: ReactMouseEvent<HTMLButtonElement>,
  ): void {
    managedBrowserMenuRequestIdRef.current += 1;
    setManagedBrowserMenuRequest({
      request: {
        canCloseOthers: tabs.length > 1,
        id: managedBrowserMenuRequestIdRef.current,
        kind: "tab",
        x: Math.max(0, Math.min(16_384, Math.round(event.clientX))),
        y: Math.max(0, Math.min(16_384, Math.round(event.clientY))),
      },
      tabId: tab.id,
    });
  }

  function removeDeletedConfigurationEntry(
    target: ConfigurationWorkspaceTarget,
    path: string,
  ): void {
    const tabsToClose = fileTabs.filter((tab) => (
      tab.kind === "configuration-file"
      && tab.configurationId === target.configurationId
      && tab.configurationKind === target.kind
      && (tab.path === path || tab.path.startsWith(`${path}/`))
    ));
    commitCloseTabs(tabsToClose);
  }

  const activeManagedBrowserTab = activeTab?.kind === "managed-browser" ? activeTab : null;
  const captureInitialFileTreeWidth = useCallback((element: HTMLDivElement | null): void => {
    if (element === null) return;
    setFileTreeWidth((current) => {
      if (current !== null) return current;
      const measuredWidth = Math.round(element.getBoundingClientRect().width);
      return measuredWidth > 0 ? measuredWidth : current;
    });
  }, []);

  return (
    <TooltipSideContext.Provider value="left">
    <WorkbenchPanel className="right-sidebar-workspace" aria-label="右侧工作区">
      <div className="right-sidebar-workspace__main">
        <div className="right-sidebar-workspace__tabs-row">
          <SidebarWorkspaceTabs activeTabId={activeTab?.id ?? null} tabs={tabs} sessions={sessions} teamInstances={teamInstances}
            onActivate={tab => void activateTab(tab)} onClose={tab => void closeTabs([tab])}
            onMove={(source, target, side) => setTabOrder(current => moveTabId(current, source, target, side))}
            onContextMenu={(tab, event) => {
              if (tab.kind === "managed-browser") { showNativeWorkspaceTabMenu(tab, event); return; }
              setTabContextMenu({ tab, x: Math.max(8, Math.min(event.clientX, window.innerWidth - 176)), y: Math.max(8, Math.min(event.clientY, window.innerHeight - 128)) });
            }} />

          <SidebarWorkspaceAddMenu hasActiveBrowser={activeManagedBrowserTab !== null} hasProject={activeProject !== null}
            canOpenGitReview={capabilities.git && activeProject !== null} canOpenTerminal={capabilities.pty && activeProject !== null}
            canOpenBrowser={capabilities.managedBrowser} canCreateSideChat={activeSession !== null} isCreatingChat={isCreatingChat}
            menuOpen={menuOpen} onMenuOpenChange={setMenuOpen}
            onNativeAddMenu={event => { if (activeManagedBrowserTab !== null) showNativeWorkspaceAddMenu(activeManagedBrowserTab, event); }}
            onOpenGitReview={openGitReview} onOpenTerminal={() => { openTerminal(); }} onOpenBrowser={() => { openManagedBrowser(); }}
            onOpenFiles={openFilesFromWorkspaceMenu} onCreateSideChat={() => void createSideChat()} />
        </div>

        {operationError !== null ? (
          <div className="right-sidebar-workspace__error" role="alert">{operationError}</div>
        ) : null}

        <div className="right-sidebar-workspace__content">
          {retainedToolTabs.map((tab) => {
            const isActive = activeTab?.id === tab.id;
            return (
              <div
                aria-hidden={!isActive}
                className={isActive ? "flex h-full min-h-0 min-w-0 flex-1 overflow-hidden" : "hidden"}
                key={tab.id}
              >
                {tab.kind === "task-list" ? (
                  <TaskListWorkspace agentClient={agentClient} scope={tab.request.scope}
                    active={isActive && sidebarVisible && activeActivity === "conversations"}
                    requestId={tab.request.requestId} {...(tab.request.taskId === undefined ? {} : { requestedTaskId: tab.request.taskId })}
                    onOpenConversation={(conversation, messageId) => {
                      if (messageId !== undefined && onLocateConversationItem !== undefined) onLocateConversationItem(conversation.id, messageId);
                      else onLocateSession(conversation.id);
                      }} />
                ) : tab.kind === "group-details" ? (
                  <TeamChatDetails agentClient={agentClient} instance={teamChat?.id === tab.instance.id ? teamChat : tab.instance}
                    active={isActive && sidebarVisible && activeActivity === "conversations" && teamChat?.id === tab.instance.id} section={tab.section}
                    onSectionChanged={section => setToolTabs(current => current.map(item => item.id === tab.id && item.kind === "group-details" ? { ...item, section } : item))}
                    onRename={async name => onRenameTeamInstance?.(tab.instance.id, name) ?? false}
                    onOpenMember={conversation => {
                      const session = toProjectSession(conversation);
                      setSideSessions(current => current.some(item => item.id === session.id) ? current : [...current, session]);
                      updateOpenChatIds(current => new Set(current).add(session.id));
                      setActiveTabForCurrentSession(`chat:${session.id}`); onSessionViewed(session.id);
                    }} />
                ) : tab.kind === "git-review" ? (
                  <GitReviewWorkspace
                    active={isActive && sidebarVisible && activeActivity === "conversations"}
                    agentClient={agentClient}
                    gitReviewCache={gitReviewCache}
                    projectId={tab.projectId}
                    requestedFile={gitReviewOpenRequest?.projectId === tab.projectId
                      && gitReviewOpenRequest.path !== null
                      ? {
                          path: gitReviewOpenRequest.path,
                          requestId: gitReviewOpenRequest.requestId,
                        }
                      : null}
                  />
                ) : tab.kind === "conversation-review" ? (
                  <ConversationReviewWorkspace agentClient={agentClient} conversationId={tab.conversationId} runId={tab.runId}
                    active={isActive && sidebarVisible && activeActivity === "conversations"}
                    requestedFile={conversationReviewViewRequest?.conversationId === tab.conversationId
                      && conversationReviewViewRequest.runId === tab.runId && conversationReviewViewRequest.path !== null
                      ? { path: conversationReviewViewRequest.path, requestId: conversationReviewViewRequest.requestId } : null} />
                ) : tab.kind === "background-command" ? (
                  <BackgroundCommandWorkspace agentClient={agentClient} conversationId={tab.conversationId} commandId={tab.commandId}
                    active={isActive && sidebarVisible && activeActivity === "conversations"} />
                ) : tab.kind === "terminal" ? (
                  <TerminalWorkspace
                    active={isActive}
                    agentClient={agentClient}
                    projectId={tab.projectId}
                    session={tab.session}
                    onError={(message) => setOperationError(message)}
                    onSessionOpened={(session) => {
                      setToolTabs((current) => current.map((candidate) => candidate.id === tab.id && candidate.kind === "terminal"
                        ? { ...candidate, session }
                        : candidate));
                    }}
                  />
                ) : (
                  <ManagedBrowserWorkspace
                    {...(tab.conversationId === null ? {} : { conversationId: tab.conversationId })}
                    active={isActive && sidebarVisible && activeActivity === "conversations"}
                    agentClient={agentClient}
                    colorScheme={isDark ? "dark" : "light"}
                    initialUrl={tab.url}
                    menuRequest={managedBrowserMenuRequest?.tabId === tab.id
                      ? managedBrowserMenuRequest.request
                      : null}
                    session={tab.session}
                    onSessionChanged={(session) => {
                      setToolTabs((current) => current.map((candidate) => candidate.id === tab.id && candidate.kind === "managed-browser"
                        ? {
                          ...candidate,
                          name: session.url.trim().length === 0
                            ? "新标签页"
                            : session.title.trim() || "浏览器",
                          session,
                          url: session.url,
                        }
                        : candidate));
                    }}
                    onWorkspaceAddMenuAction={handleWorkspaceAddMenuAction}
                    onWorkspaceTabMenuAction={(action) => handleWorkspaceTabMenuAction(tab, action)}
                  />
                )}
              </div>
            );
          })}
          {retainedSideSessions
            .map((cachedSession) => (
              openSideSessions.find((session) => session.id === cachedSession.id) ?? cachedSession
            ))
            .map((session) => {
              const isActive = activeTab?.kind === "chat" && activeTab.session.id === session.id;
              return (
                <div
                  aria-hidden={!isActive}
                  className={isActive ? "flex min-h-0 min-w-0 flex-1 overflow-hidden" : "hidden"}
                  key={session.id}
                >
                  <ConversationWorkspace
                    compact
                    active={sidebarVisible && isActive}
                    agentClient={agentClient}
                    locateTimelineItem={coordinationLocation?.conversationId === session.id ? coordinationLocation : teamMemberOpenRequest?.conversation.id === session.id
                      && teamMemberOpenRequest.timelineItemId !== null
                      ? {
                          id: teamMemberOpenRequest.timelineItemId,
                          requestId: teamMemberOpenRequest.requestId,
                        }
                      : null}
                    onLocateProject={onLocateProject}
                    onLocateSession={onLocateSession}
                    {...(onLocateConversationItem === undefined ? {} : { onLocateConversationItem })}
                     onOpenProjectFile={(path) => void openProjectFilePath(path)}
                    onSessionUpdated={updateSideSession}
                    onViewed={() => onSessionViewed(session.id)}
                    project={session.projectId === null ? null : activeProject}
                    relatedSessions={relatedSessions}
                    teamInstances={teamInstances}
                    session={session}
                    teamManaged={session.teamWorkItemId !== null && session.teamWorkItemId !== undefined}
                  />
                </div>
              );
            })}
          {activeTab?.kind === "chat" ? null : activeTab?.kind === "file" ? (
            <FilePreview
              isDark={isDark}
              imageNavigation={activeImageNavigation}
              state={filePreviews[activeTab.id]}
              tab={activeTab}
              isTreeCollapsed={isTreeCollapsed}
              onLocateDirectory={() => {
                setIsTreeCollapsed(false);
                tree.locatePath(directoryPathForFile(activeTab.path), true);
              }}
              onLocateFile={() => {
                setIsTreeCollapsed(false);
                tree.locatePath(activeTab.path);
              }}
              onNavigateImage={(entry) => void openProjectFile(entry)}
              onChange={value => updateFileDraft(activeTab.id, value)}
              onDirty={content => markFileDirty(activeTab.id, content)}
              onOverwrite={() => overwriteFile(activeTab)}
              onReload={() => void loadFile(activeTab)}
              onRequestSave={(content) => void flushFileSave({ ...activeTab }, undefined, content)}
              onToggleTree={() => setIsTreeCollapsed((current) => !current)}
            />
          ) : activeAgentPromptTab !== null ? (
            <AgentPromptPreview
              key={activeAgentPromptTab.id}
              isDark={isDark}
              tab={activeAgentPromptTab}
            />
          ) : activeConfigurationTab !== null ? (
            <ConfigurationFilePreview
              isDark={isDark}
              isTreeCollapsed={isTreeCollapsed}
              state={activeConfigurationPreview}
              tab={activeConfigurationTab}
              onChange={value => updateConfigurationDraft(activeConfigurationTab.id, value)}
              onReload={() => void loadConfigurationFile(activeConfigurationTab)}
              onSave={() => void flushConfigurationFile({ ...activeConfigurationTab })}
              onToggleTree={() => setIsTreeCollapsed((current) => !current)}
            />
          ) : activeTab?.kind === "task-list"
            || activeTab?.kind === "git-review"
            || activeTab?.kind === "group-details"
            || activeTab?.kind === "background-command"
            || activeTab?.kind === "conversation-review"
            || activeTab?.kind === "terminal"
            || activeTab?.kind === "managed-browser" ? null : (
            <RightSidebarEmptyState
              canOpenBrowser={capabilities.managedBrowser}
              canOpenGitReview={capabilities.git && activeProject !== null}
              canOpenTerminal={capabilities.pty && activeProject !== null}
              canCreateSideChat={activeSession !== null}
              isCreatingChat={isCreatingChat}
              onCreateSideChat={() => void createSideChat()}
              onOpenBrowser={openManagedBrowser}
              onOpenFiles={openFileBrowser}
              onOpenGitReview={openGitReview}
              onOpenTerminal={() => {
                openTerminal();
              }}
            />
          )}
        </div>
      </div>

      {showFileWorkspace ? (
        <ResizableDivider
          ariaLabel={isTreeCollapsed ? "拖动展开文件树" : "调整文件树宽度"}
          collapsed={isTreeCollapsed}
          direction="from-end"
          max={FILE_TREE_WIDTH_RANGE.max}
          min={FILE_TREE_WIDTH_RANGE.min}
          size={fileTreeWidth ?? FILE_TREE_WIDTH_RANGE.max}
          onCollapsedChange={setIsTreeCollapsed}
          onResize={setFileTreeWidth}
        />
      ) : null}

      {showFileWorkspace ? (
        <div
          className={isTreeCollapsed
            ? "right-sidebar-workspace__tree hidden"
            : "right-sidebar-workspace__tree flex min-h-0 min-w-[220px] flex-[0_0_clamp(220px,42%,360px)] border-l border-[var(--app-border)]"}
          ref={captureInitialFileTreeWidth}
          style={fileTreeWidth === null ? undefined : {
            flexBasis: fileTreeWidth,
            width: fileTreeWidth,
          }}
        >
          {activeConfigurationTarget !== null ? (
            <ConfigurationWorkspaceTreePanel
              agentClient={agentClient}
              currentFilePath={activeConfigurationTab?.path ?? null}
              isCollapsed={isTreeCollapsed}
              key={`${activeConfigurationTarget.kind}:${activeConfigurationTarget.configurationId}`}
              target={activeConfigurationTarget}
              onDeleteEntry={(path) => removeDeletedConfigurationEntry(activeConfigurationTarget, path)}
              onOpenFile={(path) => void openConfigurationPath(path)}
            />
          ) : (
            <ProjectTreePanel
              currentFilePath={activeTab?.kind === "file" ? activeTab.path : null}
              isCollapsed={isTreeCollapsed}
              key={tree.activeProject?.id ?? "no-project"}
              tree={tree}
              onOpenFile={(entry) => void openProjectFile(entry)}
            />
          )}
        </div>
      ) : null}

      {tabContextMenu === null ? null : <SidebarTabContextMenu tabs={tabs} tabContextMenu={tabContextMenu}
        onClose={tabsToClose => void closeTabs(tabsToClose)} onDismiss={() => setTabContextMenu(null)} />}
    </WorkbenchPanel>
    </TooltipSideContext.Provider>
  );
}
