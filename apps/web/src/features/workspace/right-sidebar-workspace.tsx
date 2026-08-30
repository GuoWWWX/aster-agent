import {
  Check,
  ChevronRight,
  FileText,
  Folder,
  FolderOpen,
  Globe2,
  LoaderCircle,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  Plus,
  SquarePen,
  SquareCheckBig,
  Terminal,
  X,
  type LucideIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import type {
  ConfigurationWorkspaceFile,
  ConfigurationWorkspaceKind,
  ConversationRunEvent,
  ConversationSummary,
  JavaDeclarationKind,
  ManagedBrowserSession,
  ProjectEntry,
  ProjectFile,
  ProjectSummary,
  TerminalSession,
} from "@agent/protocol";
import { AgentClientError, parseSerializedAgentError } from "@agent/protocol";

import { DocumentCodeEditor, type DocumentCodeLanguage } from "../../components/editor/document-code-editor.js";
import {
  LiveMarkdownEditor,
  type LiveMarkdownEditorHandle,
} from "../../components/editor/live-markdown-editor.js";
import { setImageSourceResolver } from "../../components/editor/cm/image-source-resolver.js";
import { WorkbenchPanel } from "../../components/layout/panel.js";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import {
  parseAgentPromptDocument,
  serializeAgentPromptDocument,
} from "../../lib/agent-prompt-document.js";
import { resolveBrowserPreviewImage } from "../../lib/browser-preview-images.js";
import {
  useWorkbenchUiStore,
  type AgentPromptWorkspaceTarget,
  type ConfigurationWorkspaceTarget,
} from "../../stores/workbench-ui-store.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useConversationWorkspaceCache } from "../chat/conversation-workspace-cache.js";
import { ConversationWorkspace } from "../chat/workspace-content.js";
import { ConfigurationWorkspaceTreePanel } from "./configuration-workspace-tree-panel.js";
import { GitReviewWorkspace } from "./git-review-workspace.js";
import { ManagedBrowserWorkspace } from "./managed-browser-workspace.js";
import { ProjectTreePanel } from "../projects/project-tree-panel.js";
import { TerminalWorkspace } from "./terminal-workspace.js";
import {
  retainedWorkspaceCacheIds,
  WORKSPACE_CACHE_SWEEP_INTERVAL_MS,
} from "./workspace-cache-policy.js";
import {
  updateSessionRunState,
  type ProjectSession,
} from "../projects/project-session-model.js";
import type { ProjectTreeController } from "../projects/use-project-tree.js";
import "./right-sidebar-workspace.css";

type ProjectFileTab = {
  id: string;
  kind: "file";
  javaDeclarationKind: JavaDeclarationKind | undefined;
  name: string;
  path: string;
  projectId: string;
};

type ConfigurationFileTab = {
  configurationId: string;
  configurationKind: ConfigurationWorkspaceKind;
  id: string;
  kind: "configuration-file";
  name: string;
  path: string;
  title: string;
};

type AgentPromptTab = {
  agentId: string;
  id: string;
  kind: "agent-prompt";
  name: string;
  title: string;
};

type FileTab = ProjectFileTab | ConfigurationFileTab | AgentPromptTab;

type ToolTabBase = {
  id: string;
  lastAccessedAt: number;
  name: string;
};

type GitReviewTab = ToolTabBase & {
  kind: "git-review";
  projectId: string;
};

type TerminalTab = ToolTabBase & {
  kind: "terminal";
  projectId: string;
  session: TerminalSession | null;
};

type ManagedBrowserTab = ToolTabBase & {
  kind: "managed-browser";
  session: ManagedBrowserSession | null;
  url: string;
};

type ToolTab = GitReviewTab | TerminalTab | ManagedBrowserTab;

type SidebarTab =
  | FileTab
  | ToolTab
  | { id: string; kind: "chat"; name: string; session: ProjectSession };

type FilePreviewState = {
  /** 仅在外部读取成功时递增，让实时预览替换同一标签中的旧文档。 */
  contentRevision: number;
  conflict: FileSaveConflict | null;
  draft: string;
  error: string | null;
  file: ProjectFile | null;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  savedContent: string;
};

type FileSaveConflict = "locked" | "stale";

type ConfigurationFilePreviewState = {
  draft: string;
  error: string | null;
  file: ConfigurationWorkspaceFile | null;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  savedContent: string;
};

type TabContextMenuState = {
  tab: SidebarTab;
  x: number;
  y: number;
};

type EmptyStateAction = {
  disabled?: boolean;
  icon: LucideIcon;
  label: string;
  onClick?: (() => void) | undefined;
  shortcut: string;
  title?: string | undefined;
};

export type ProjectFileOpenRequest = {
  path: string;
  projectId: string;
};

export type TeamMemberOpenRequest = {
  conversation: ProjectSession;
  requestId: number;
  sourceConversationId: string;
};

function toProjectSession(conversation: ConversationSummary): ProjectSession {
  return {
    activeSubagentCount: conversation.activeSubagentCount,
    activeRunId: conversation.activeRunId,
    agentId: conversation.agentId,
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

export function upsertSideSession(
  sessions: ProjectSession[],
  conversation: ConversationSummary,
): ProjectSession[] {
  const session = toProjectSession(conversation);
  return sessions.some((candidate) => candidate.id === session.id)
    ? sessions.map((candidate) => candidate.id === session.id ? session : candidate)
    : [...sessions, session];
}

export function updateSideSessionsForRunEvent(
  sessions: ProjectSession[],
  event: ConversationRunEvent,
): ProjectSession[] {
  if (
    event.type !== "conversation.updated"
    && event.type !== "run.started"
    && event.type !== "run.finished"
  ) {
    return sessions;
  }
  const conversationId = event.type === "conversation.updated"
    ? event.conversation.id
    : event.conversationId;
  const existingIndex = sessions.findIndex((session) => session.id === conversationId);
  if (existingIndex < 0) return sessions;
  const existing = sessions[existingIndex];
  if (existing === undefined) return sessions;
  const updated = event.type === "conversation.updated"
    ? toProjectSession(event.conversation)
    : updateSessionRunState([existing], event)[0] ?? existing;
  if (updated === existing) return sessions;
  const next = [...sessions];
  next[existingIndex] = updated;
  return next;
}

function isManagedTeamMember(
  conversation: { teamWorkItemId?: string | null },
): boolean {
  return conversation.teamWorkItemId !== null && conversation.teamWorkItemId !== undefined;
}

/** Team executions are retained for audit; closing only hides their side tab. */
export function shouldDeleteSidebarChat(
  conversation: { teamWorkItemId?: string | null },
): boolean {
  return !isManagedTeamMember(conversation);
}

async function listSideConversations(
  agentClient: AgentClient,
  sourceConversationId: string,
): Promise<{ autoOpenIds: Set<string>; sessions: ProjectSession[] }> {
  const directChildren = await agentClient.listConversationForks({
    conversationId: sourceConversationId,
  });
  const ordinarySideChats = directChildren.filter(
    (conversation) => conversation.threadKind === "agent" && !isManagedTeamMember(conversation),
  );
  const managedMembers: ConversationSummary[] = [];
  const pending = directChildren.filter(isManagedTeamMember);
  const seen = new Set<string>();
  while (pending.length > 0) {
    const member = pending.shift();
    if (member === undefined || seen.has(member.id)) continue;
    seen.add(member.id);
    managedMembers.push(member);
    const children = await agentClient.listConversationForks({ conversationId: member.id });
    pending.push(...children.filter(isManagedTeamMember));
  }
  return {
    autoOpenIds: new Set(ordinarySideChats.map((conversation) => conversation.id)),
    sessions: [...ordinarySideChats, ...managedMembers].map(toProjectSession),
  };
}

type TerminalTabNameCandidate = {
  kind: ToolTab["kind"];
  name: string;
  projectId?: string;
};

type WorkspaceTabNameCandidate = {
  name: string;
};

export function nextWorkspaceTabName(
  tabs: readonly WorkspaceTabNameCandidate[],
  requestedName: string,
): string {
  const names = new Set(tabs.map((tab) => tab.name));
  if (!names.has(requestedName)) return requestedName;

  let ordinal = 1;
  let candidate = `${requestedName} (${ordinal})`;
  while (names.has(candidate)) {
    ordinal += 1;
    candidate = `${requestedName} (${ordinal})`;
  }
  return candidate;
}

export function nextTerminalTabName(
  tabs: readonly TerminalTabNameCandidate[],
  projectId: string,
): string {
  const names = new Set(
    tabs
      .filter((tab) => tab.kind === "terminal" && tab.projectId === projectId)
      .map((tab) => tab.name),
  );
  let ordinal = 1;
  while (names.has(ordinal === 1 ? "终端" : `终端 (${ordinal - 1})`)) ordinal += 1;
  return ordinal === 1 ? "终端" : `终端 (${ordinal - 1})`;
}

function fileTabId(projectId: string, path: string): string {
  return `file:${projectId}:${path}`;
}

function configurationFileTabId(
  kind: ConfigurationWorkspaceKind,
  configurationId: string,
  path: string,
): string {
  return `configuration:${kind}:${configurationId}:${path}`;
}

function agentPromptTabId(agentId: string): string {
  return `agent-prompt:${agentId}`;
}

function targetForConfigurationTab(tab: ConfigurationFileTab): ConfigurationWorkspaceTarget {
  return {
    configurationId: tab.configurationId,
    kind: tab.configurationKind,
    title: tab.title,
  };
}

function languageForPath(path: string): DocumentCodeLanguage {
  const extension = path.split(".").at(-1)?.toLocaleLowerCase("en-US");
  switch (extension) {
    case "css":
    case "less":
    case "sass":
    case "scss":
      return "css";
    case "htm":
    case "html":
    case "vue":
    case "xml":
      return "html";
    case "java":
      return "java";
    case "cjs":
    case "js":
    case "jsx":
    case "mjs":
      return "javascript";
    case "json":
    case "jsonc":
      return "json";
    case "md":
    case "mdx":
      return "markdown";
    case "cts":
    case "mts":
    case "ts":
    case "tsx":
      return "typescript";
    default:
      return "plain";
  }
}

function directoryPathForFile(path: string): string {
  const normalizedPath = path.replaceAll("\\", "/");
  const lastSlashIndex = normalizedPath.lastIndexOf("/");
  return lastSlashIndex === -1 ? "" : normalizedPath.slice(0, lastSlashIndex);
}

function directoryLabelForFile(path: string): string {
  return directoryPathForFile(path) || "项目根目录";
}

function fileExtension(path: string): string {
  return path.split(".").at(-1)?.toLocaleLowerCase("en-US") ?? "";
}

function isMarkdownFile(path: string): boolean {
  const extension = fileExtension(path);
  return extension === "md" || extension === "mdx";
}

function saveConflictFor(reason: unknown): FileSaveConflict | null {
  const code = reason instanceof AgentClientError
    ? reason.code
    : parseSerializedAgentError(reason)?.code
      ?? (reason !== null && typeof reason === "object" && "code" in reason
        && typeof reason.code === "string" ? reason.code : undefined);
  if (code === "CONFLICT" || code === "PROJECT_OPERATION_CONFLICT") return "locked";
  if (code === "FILE_CHANGED") return "stale";
  return null;
}

export function RightSidebarWorkspace({
  activeProject,
  activeSession,
  agentClient,
  fileOpenRequest,
  teamMemberOpenRequest,
  onLocateProject,
  onLocateSession,
  onSessionViewed,
  onSessionUpdated,
  tree,
}: {
  activeProject: ProjectSummary | null;
  activeSession: ProjectSession | null;
  agentClient: AgentClient;
  fileOpenRequest: ProjectFileOpenRequest | null;
  teamMemberOpenRequest: TeamMemberOpenRequest | null;
  onLocateProject: (projectId: string) => void;
  onLocateSession: (sessionId: string) => void;
  onSessionViewed: (sessionId: string) => void;
  onSessionUpdated: (conversation: ConversationSummary) => void;
  tree: ProjectTreeController;
}): ReactElement {
  const isDark = useWorkbenchUiStore((state) => state.themeMode === "dark");
  const setFilePanelOpen = useWorkbenchUiStore((state) => state.setFilePanelOpen);
  const configurationWorkspaceTarget = useWorkbenchUiStore(
    (state) => state.configurationWorkspaceTarget,
  );
  const agentPromptWorkspaceTarget = useWorkbenchUiStore(
    (state) => state.agentPromptWorkspaceTarget,
  );
  const reloadProjectDirectory = tree.reloadDirectory;
  const notifyConfigurationWorkspaceChanged = useWorkbenchUiStore(
    (state) => state.notifyConfigurationWorkspaceChanged,
  );
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [configurationFilePreviews, setConfigurationFilePreviews] = useState<
    Record<string, ConfigurationFilePreviewState>
  >({});
  const [filePreviews, setFilePreviews] = useState<Record<string, FilePreviewState>>({});
  const [fileTabs, setFileTabs] = useState<FileTab[]>([]);
  const [toolTabs, setToolTabs] = useState<ToolTab[]>([]);
  const [capabilities, setCapabilities] = useState({ git: false, managedBrowser: false, pty: false });
  const [isFileBrowserOpen, setIsFileBrowserOpen] = useState(false);
  const [isCreatingChat, setIsCreatingChat] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [openChatIds, setOpenChatIds] = useState<Set<string>>(() => new Set());
  const [operationError, setOperationError] = useState<string | null>(null);
  const [sideSessions, setSideSessions] = useState<ProjectSession[]>([]);
  const [tabContextMenu, setTabContextMenu] = useState<TabContextMenuState | null>(null);
  const [isTreeCollapsed, setIsTreeCollapsed] = useState(false);
  const [workspaceCacheClock, setWorkspaceCacheClock] = useState(() => Date.now());
  const configurationFilePreviewsRef = useRef(configurationFilePreviews);
  const configurationSaveQueuesRef = useRef(new Map<string, Promise<boolean>>());
  const filePreviewsRef = useRef(filePreviews);
  const fileSaveQueuesRef = useRef(new Map<string, Promise<boolean>>());
  const fileLoadRequestIdsRef = useRef(new Map<string, number>());
  const handledFileOpenRequestRef = useRef<ProjectFileOpenRequest | null>(null);
  const handledTeamMemberOpenRequestIdRef = useRef<number | null>(null);
  const activeTabIdsBySessionRef = useRef(new Map<string, string | null>());
  const activeTabOwnerRef = useRef<string | null>(activeSession?.id ?? null);
  const openChatIdsBySessionRef = useRef(new Map<string, Set<string>>());
  const releasingToolTabIdsRef = useRef(new Set<string>());
  const activeSessionId = activeSession?.id ?? null;

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

  const updateOpenChatIds = useCallback(
    (update: (current: Set<string>) => Set<string>): void => {
      setOpenChatIds((current) => {
        const next = update(current);
        if (activeSessionId !== null) {
          openChatIdsBySessionRef.current.set(activeSessionId, next);
        }
        return next;
      });
    },
    [activeSessionId],
  );
  const setActiveTabForCurrentSession = useCallback(
    (tabId: string | null): void => {
      setActiveTabId(tabId);
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
      if (activeSessionId !== null) {
        activeTabIdsBySessionRef.current.set(activeSessionId, tabId);
      }
    },
    [activeSessionId],
  );
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
  }, [
    activeProject,
    capabilities.pty,
    fileTabs,
    setActiveTabForCurrentSession,
    setFilePanelOpen,
    sideSessions,
    toolTabs,
  ]);
  const openManagedBrowser = useCallback((
    requestedName?: string,
    session: ManagedBrowserSession | null = null,
  ): string | null => {
    if (!capabilities.managedBrowser) return null;
    const id = `managed-browser:${crypto.randomUUID()}`;
    const now = Date.now();
    const name = requestedName === undefined
      ? "浏览器"
      : nextWorkspaceTabName([
        ...fileTabs,
        ...toolTabs,
        ...sideSessions.map((sideSession) => ({ name: sideSession.title })),
      ], requestedName);
    setToolTabs((current) => [...current, {
      id,
      kind: "managed-browser",
      lastAccessedAt: now,
      name,
      session,
      url: session?.url ?? "https://www.google.com/",
    }]);
    setActiveTabForCurrentSession(id);
    setFilePanelOpen(true);
    setIsFileBrowserOpen(false);
    setMenuOpen(false);
    return name;
  }, [
    capabilities.managedBrowser,
    fileTabs,
    setActiveTabForCurrentSession,
    setFilePanelOpen,
    sideSessions,
    toolTabs,
  ]);

  useEffect(() => {
    configurationFilePreviewsRef.current = configurationFilePreviews;
  }, [configurationFilePreviews]);

  useEffect(() => {
    filePreviewsRef.current = filePreviews;
  }, [filePreviews]);

  useEffect(() => {
    const projectId = activeProject?.id;
    const resolver = async (source: string, sourcePath?: string): Promise<string | null | undefined> => {
      if (/^(?:https?:|data:|blob:)/iu.test(source)) return source;
      if (projectId === undefined || sourcePath === undefined) {
        return resolveBrowserPreviewImage(source, sourcePath);
      }
      try {
        const image = await agentClient.readProjectPreviewImage({
          path: source,
          projectId,
          sourcePath,
        });
        return `data:${image.mimeType};base64,${image.data}`;
      } catch {
        return resolveBrowserPreviewImage(source, sourcePath);
      }
    };
    return setImageSourceResolver(resolver);
  }, [activeProject?.id, agentClient]);

  useEffect(() => {
    let disposed = false;
    void Promise.resolve().then(async () => {
      if (disposed) return;
      setOperationError(null);
      if (activeSessionId === null) {
        setSideSessions([]);
        setOpenChatIds(new Set());
        setActiveTabId(null);
        return;
      }

      try {
        const loaded = await listSideConversations(agentClient, activeSessionId);
        if (disposed) return;
        const sessions = loaded.sessions;
        setSideSessions(sessions);
        const sessionIds = new Set(sessions.map((session) => session.id));
        const savedOpenChatIds = openChatIdsBySessionRef.current.get(activeSessionId);
        const nextOpenChatIds = savedOpenChatIds === undefined
          ? loaded.autoOpenIds
          : new Set([...savedOpenChatIds].filter((id) => sessionIds.has(id)));
        openChatIdsBySessionRef.current.set(activeSessionId, nextOpenChatIds);
        setOpenChatIds(nextOpenChatIds);
        setActiveTabId(activeTabIdsBySessionRef.current.get(activeSessionId) ?? null);
      } catch {
        if (!disposed) setOperationError("无法加载侧边聊天");
      }
      });

    return () => {
      disposed = true;
    };
  }, [activeSessionId, agentClient]);

  useEffect(() => {
    return agentClient.onConversationRunEvent((event) => {
      if (event.type === "conversation.updated") {
        const nextSession = toProjectSession(event.conversation);
        const isOrdinarySideChat = event.conversation.parentConversationId === activeSessionId
          && event.conversation.threadKind === "agent"
          && !isManagedTeamMember(event.conversation);
        if (isOrdinarySideChat) {
          setSideSessions((current) => upsertSideSession(current, event.conversation));
          updateOpenChatIds((current) => current.has(nextSession.id)
            ? current
            : new Set(current).add(nextSession.id));
          return;
        }
        if (isManagedTeamMember(event.conversation)) {
          setSideSessions((current) => {
            const belongsToSource = event.conversation.parentConversationId === activeSessionId
              || current.some((session) => session.id === event.conversation.parentConversationId);
            return belongsToSource ? upsertSideSession(current, event.conversation) : current;
          });
          return;
        }
      }
      setSideSessions((current) => updateSideSessionsForRunEvent(current, event));
    });
  }, [activeSessionId, agentClient, updateOpenChatIds]);

  useEffect(() => {
    if (
      teamMemberOpenRequest === null
      || teamMemberOpenRequest.sourceConversationId !== activeSessionId
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
    activeSessionId,
    setActiveTabForCurrentSession,
    teamMemberOpenRequest,
    updateOpenChatIds,
  ]);

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
    return agentClient.onWorkspaceBrowserTabOpenRequested((request) => {
      if (
        (request.conversationId !== activeSessionId && !openChatIds.has(request.conversationId))
        || request.projectId !== activeProject?.id
        || !capabilities.managedBrowser
      ) {
        return;
      }
      const resolvedName = openManagedBrowser(request.requestedName ?? undefined, request.session);
      if (resolvedName === null) return;
      void agentClient.confirmWorkspaceBrowserTabOpened({
        requestId: request.requestId,
        resolvedName,
      }).catch(() => undefined);
    });
  }, [
    activeProject?.id,
    activeSessionId,
    agentClient,
    capabilities.managedBrowser,
    fileTabs,
    openChatIds,
    openManagedBrowser,
    sideSessions,
    toolTabs,
  ]);

  useEffect(() => {
    return agentClient.onWorkspaceBrowserTabCloseRequested((request) => {
      if (
        (request.conversationId !== activeSessionId && !openChatIds.has(request.conversationId))
        || activeProject === null
      ) {
        return;
      }
      const closedTabIds = new Set(toolTabs
        .filter((tab) => tab.kind === "managed-browser" && tab.session?.sessionId === request.sessionId)
        .map((tab) => tab.id));
      if (closedTabIds.size === 0) return;
      setToolTabs((current) => current.filter((tab) => !closedTabIds.has(tab.id)));
      if (activeTabId !== null && closedTabIds.has(activeTabId)) {
        setActiveTabForCurrentSession(null);
        setIsFileBrowserOpen(false);
      }
    });
  }, [
    activeProject,
    activeSessionId,
    activeTabId,
    agentClient,
    openChatIds,
    setActiveTabForCurrentSession,
    toolTabs,
  ]);

  useEffect(() => {
    if (activeTabOwnerRef.current !== activeSessionId) {
      activeTabOwnerRef.current = activeSessionId;
      return;
    }
    if (activeSessionId === null) return;
    activeTabIdsBySessionRef.current.set(activeSessionId, activeTabId);
  }, [activeSessionId, activeTabId]);

  useEffect(() => {
    if (tabContextMenu === null) return;
    const dismissOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setTabContextMenu(null);
    };
    window.addEventListener("keydown", dismissOnEscape);
    return () => window.removeEventListener("keydown", dismissOnEscape);
  }, [tabContextMenu]);

  const loadFile = useCallback(
    async (tab: ProjectFileTab): Promise<void> => {
      const requestId = (fileLoadRequestIdsRef.current.get(tab.id) ?? 0) + 1;
      fileLoadRequestIdsRef.current.set(tab.id, requestId);
      setFilePreviews((current) => ({
        ...current,
        [tab.id]: {
          contentRevision: current[tab.id]?.contentRevision ?? 0,
          conflict: current[tab.id]?.conflict ?? null,
          draft: current[tab.id]?.draft ?? "",
          error: null,
          file: current[tab.id]?.file ?? null,
          isDirty: current[tab.id]?.isDirty ?? false,
          isLoading: true,
          isSaving: current[tab.id]?.isSaving ?? false,
          savedContent: current[tab.id]?.savedContent ?? "",
        },
      }));
      try {
        const file = await agentClient.readProjectFile({
          path: tab.path,
          projectId: tab.projectId,
        });
        if (fileLoadRequestIdsRef.current.get(tab.id) !== requestId) return;
        setFilePreviews((current) => ({
          ...current,
          [tab.id]: {
            contentRevision: (current[tab.id]?.contentRevision ?? 0) + 1,
            conflict: null,
            draft: file.content ?? "",
            error: null,
            file,
            isDirty: false,
            isLoading: false,
            isSaving: false,
            savedContent: file.content ?? "",
          },
        }));
      } catch {
        if (fileLoadRequestIdsRef.current.get(tab.id) !== requestId) return;
        setFilePreviews((current) => ({
          ...current,
          [tab.id]: {
            contentRevision: current[tab.id]?.contentRevision ?? 0,
            conflict: null,
            draft: "",
            error: "无法读取文件",
            file: null,
            isDirty: false,
            isLoading: false,
            isSaving: false,
            savedContent: "",
          },
        }));
      }
    },
    [agentClient],
  );

  const refreshFileChangeTargets = useCallback(
    (projectId: string, changedPath: string, savedFile?: ProjectFile): void => {
      reloadProjectDirectory(directoryPathForFile(changedPath));
      for (const tab of fileTabs) {
        if (tab.kind !== "file" || tab.projectId !== projectId || tab.path !== changedPath) continue;
        if (savedFile !== undefined) {
          setFilePreviews((current) => {
            const preview = current[tab.id];
            if (preview === undefined) return current;
            const savedContent = savedFile.content ?? "";
            const isCurrentDraft = preview.draft === savedContent;
            return {
              ...current,
              [tab.id]: {
                ...preview,
                conflict: null,
                draft: isCurrentDraft ? savedContent : preview.draft,
                error: null,
                file: savedFile,
                isDirty: !isCurrentDraft,
                savedContent,
              },
            };
          });
          continue;
        }

        const preview = filePreviewsRef.current[tab.id];
        if (preview?.isDirty === true) {
          setFilePreviews((current) => {
            const currentPreview = current[tab.id];
            return currentPreview === undefined
              ? current
              : {
                ...current,
                [tab.id]: { ...currentPreview, conflict: "stale", error: null },
              };
          });
        } else {
          void loadFile(tab);
        }
      }
    },
    [fileTabs, loadFile, reloadProjectDirectory],
  );

  const queueFileSave = useCallback(
    (tab: ProjectFileTab, content: string, expectedContentOverride?: string | null): Promise<boolean> => {
      const preview = filePreviewsRef.current[tab.id];
      if (
        preview === undefined
        || preview.file === null
        || preview.file.content === null
        || preview.file.isBinary
        || preview.file.truncated
      ) {
        return Promise.resolve(true);
      }

      const existing = fileSaveQueuesRef.current.get(tab.id);
      if (preview.isSaving && existing !== undefined) return existing;

      setFilePreviews((current) => {
        const currentPreview = current[tab.id];
        return currentPreview === undefined
          ? current
          : { ...current, [tab.id]: { ...currentPreview, error: null, isSaving: true } };
      });

      const previous = existing ?? Promise.resolve(true);
      const operation = previous
        .catch(() => true)
        .then(async () => {
          try {
            const currentPreview = filePreviewsRef.current[tab.id];
            const expectedContent = expectedContentOverride
              ?? currentPreview?.savedContent
              ?? preview.savedContent;
            const saved = await agentClient.writeProjectFile({
              content,
              expectedContent,
              path: tab.path,
              projectId: tab.projectId,
            });
            setFilePreviews((current) => {
              const latest = current[tab.id];
              if (latest === undefined) return current;
              const isCurrentDraft = latest.draft === content;
              const savedContent = saved.content ?? content;
              return {
                ...current,
                [tab.id]: {
                  ...latest,
                  conflict: null,
                  draft: isCurrentDraft ? savedContent : latest.draft,
                  error: null,
                  file: saved,
                  isDirty: !isCurrentDraft,
                  savedContent,
                },
              };
            });
            refreshFileChangeTargets(tab.projectId, tab.path, saved);
            return true;
          } catch (reason) {
            const conflict = saveConflictFor(reason);
            setFilePreviews((current) => {
              const latest = current[tab.id];
              if (latest === undefined) return current;
              return {
                ...current,
                [tab.id]: {
                  ...latest,
                  conflict,
                  error: conflict === null
                    ? getUserErrorMessage(reason, "无法保存文件。")
                    : null,
                },
              };
            });
            return false;
          }
        })
        .finally(() => {
          if (fileSaveQueuesRef.current.get(tab.id) !== operation) return;
          setFilePreviews((current) => {
            const latest = current[tab.id];
            return latest === undefined
              ? current
              : { ...current, [tab.id]: { ...latest, isSaving: false } };
          });
        });
      fileSaveQueuesRef.current.set(tab.id, operation);
      return operation;
    },
    [agentClient, refreshFileChangeTargets],
  );

  const flushFileSave = useCallback(
    async (
      tab: ProjectFileTab,
      expectedContentOverride?: string | null,
      contentOverride?: string,
    ): Promise<boolean> => {
      let preview = filePreviewsRef.current[tab.id];
      if (preview !== undefined && contentOverride !== undefined) {
        const nextPreview: FilePreviewState = {
          ...preview,
          draft: contentOverride,
          error: null,
          isDirty: contentOverride !== preview.savedContent,
        };
        // Keep the ref current before queueFileSave reads it; React state updates are
        // asynchronous and a fast Ctrl+S must not wait for a render to see the text.
        filePreviewsRef.current = { ...filePreviewsRef.current, [tab.id]: nextPreview };
        setFilePreviews((current) => {
          const currentPreview = current[tab.id];
          return currentPreview === undefined
            ? current
            : { ...current, [tab.id]: { ...currentPreview, draft: contentOverride, error: null, isDirty: contentOverride !== currentPreview.savedContent } };
        });
        preview = nextPreview;
      }
      const existing = fileSaveQueuesRef.current.get(tab.id);
      if (preview?.isSaving === true && existing !== undefined) return existing;
      const content = contentOverride ?? preview?.draft;
      if (
        preview === undefined
        || preview.file === null
        || preview.file.content === null
        || preview.file.isBinary
        || preview.file.truncated
        || content === undefined
        || content === preview.savedContent
      ) {
        return existing ?? true;
      }
      return queueFileSave(tab, content, expectedContentOverride);
    },
    [queueFileSave],
  );

  useEffect(() => {
    return agentClient.onConversationRunEvent((event) => {
      if (
        event.type !== "tool.completed"
        || event.fileChange == null
        || event.fileChange.projectId !== activeProject?.id
      ) {
        return;
      }

      refreshFileChangeTargets(event.fileChange.projectId, event.fileChange.path);
    });
  }, [activeProject?.id, agentClient, refreshFileChangeTargets]);

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
      if (!alreadyOpen || filePreviewsRef.current[tab.id] === undefined) void loadFile(tab);
    },
    [activeProject, fileTabs, loadFile, setActiveTabForCurrentSession, setFilePanelOpen],
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

  const loadConfigurationFile = useCallback(
    async (tab: ConfigurationFileTab): Promise<void> => {
      setConfigurationFilePreviews((current) => ({
        ...current,
        [tab.id]: {
          draft: current[tab.id]?.draft ?? "",
          error: null,
          file: current[tab.id]?.file ?? null,
          isDirty: current[tab.id]?.isDirty ?? false,
          isLoading: true,
          isSaving: current[tab.id]?.isSaving ?? false,
          savedContent: current[tab.id]?.savedContent ?? "",
        },
      }));
      try {
        const file = await agentClient.readConfigurationWorkspaceFile({
          configurationId: tab.configurationId,
          kind: tab.configurationKind,
          path: tab.path,
        });
        const content = file.content ?? "";
        setConfigurationFilePreviews((current) => ({
          ...current,
          [tab.id]: {
            draft: content,
            error: null,
            file,
            isDirty: false,
            isLoading: false,
            isSaving: false,
            savedContent: content,
          },
        }));
      } catch (reason) {
        setConfigurationFilePreviews((current) => ({
          ...current,
          [tab.id]: {
            draft: "",
            error: getUserErrorMessage(reason, "无法读取配置文件。"),
            file: null,
            isDirty: false,
            isLoading: false,
            isSaving: false,
            savedContent: "",
          },
        }));
      }
    },
    [agentClient],
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
      void loadConfigurationFile(tab);
    },
    [loadConfigurationFile, setActiveTabForCurrentSession],
  );

  const queueConfigurationSave = useCallback(
    (tab: ConfigurationFileTab, content: string): Promise<boolean> => {
      const preview = configurationFilePreviewsRef.current[tab.id];
      if (
        preview === undefined
        || preview.file === null
        || preview.file.content === null
        || preview.file.isBinary
        || preview.file.truncated
      ) {
        return Promise.resolve(true);
      }
      setConfigurationFilePreviews((current) => {
        const currentPreview = current[tab.id];
        return currentPreview === undefined
          ? current
          : { ...current, [tab.id]: { ...currentPreview, error: null, isSaving: true } };
      });
      const previous = configurationSaveQueuesRef.current.get(tab.id) ?? Promise.resolve(true);
      const operation = previous
        .catch(() => true)
        .then(async () => {
          try {
            const saved = await agentClient.writeConfigurationWorkspaceFile({
              configurationId: tab.configurationId,
              content,
              kind: tab.configurationKind,
              path: tab.path,
            });
            const savedContent = saved.content ?? content;
            setConfigurationFilePreviews((current) => {
              const currentPreview = current[tab.id];
              if (currentPreview === undefined) return current;
              const isCurrentDraft = currentPreview.draft === content;
              const nextDraft = isCurrentDraft ? savedContent : currentPreview.draft;
              return {
                ...current,
                [tab.id]: {
                  ...currentPreview,
                  draft: nextDraft,
                  error: null,
                  file: saved,
                  isDirty: isCurrentDraft ? false : currentPreview.draft !== savedContent,
                  savedContent,
                },
              };
            });
            notifyConfigurationWorkspaceChanged();
            return true;
          } catch (reason) {
            setConfigurationFilePreviews((current) => {
              const currentPreview = current[tab.id];
              return currentPreview === undefined
                ? current
                : {
                    ...current,
                    [tab.id]: {
                      ...currentPreview,
                      error: getUserErrorMessage(reason, "无法保存配置文件。"),
                    },
                  };
            });
            return false;
          }
        })
        .finally(() => {
          if (configurationSaveQueuesRef.current.get(tab.id) !== operation) return;
          setConfigurationFilePreviews((current) => {
            const currentPreview = current[tab.id];
            return currentPreview === undefined
              ? current
              : { ...current, [tab.id]: { ...currentPreview, isSaving: false } };
          });
        });
      configurationSaveQueuesRef.current.set(tab.id, operation);
      return operation;
    },
    [agentClient, notifyConfigurationWorkspaceChanged],
  );

  const flushConfigurationFile = useCallback(
    async (tab: ConfigurationFileTab): Promise<boolean> => {
      const preview = configurationFilePreviewsRef.current[tab.id];
      if (preview?.isDirty === true) return queueConfigurationSave(tab, preview.draft);
      return configurationSaveQueuesRef.current.get(tab.id) ?? true;
    },
    [queueConfigurationSave],
  );

  const updateSideSession = useCallback((conversation: ConversationSummary): void => {
    setSideSessions((current) => upsertSideSession(current, conversation));
    onSessionUpdated(conversation);
  }, [onSessionUpdated]);

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
  const tabs = useMemo<SidebarTab[]>(
    () => [
      ...fileTabs,
      ...toolTabs,
      ...openSideSessions
        .map((session): SidebarTab => ({
          id: `chat:${session.id}`,
          kind: "chat",
          name: session.title,
          session,
        })),
    ],
    [fileTabs, openSideSessions, toolTabs],
  );
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null;
  const activeToolTabId = toolTabs.some((tab) => tab.id === activeTabId) ? activeTabId : null;
  const retainedToolTabIds = useMemo(
    () => retainedWorkspaceCacheIds(toolTabs, activeToolTabId, workspaceCacheClock),
    [activeToolTabId, toolTabs, workspaceCacheClock],
  );
  const retainedToolTabs = useMemo(
    () => toolTabs.filter((tab) => retainedToolTabIds.has(tab.id)),
    [retainedToolTabIds, toolTabs],
  );
  const retainedSideSessions = useConversationWorkspaceCache(
    activeTab?.kind === "chat" ? activeTab.session : null,
    openSideSessions,
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

  useEffect(() => {
    const tick = (): void => setWorkspaceCacheClock(Date.now());
    const interval = window.setInterval(tick, WORKSPACE_CACHE_SWEEP_INTERVAL_MS);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    for (const tab of toolTabs) {
      if (
        retainedToolTabIds.has(tab.id)
        || tab.kind === "git-review"
        || tab.session === null
        || releasingToolTabIdsRef.current.has(tab.id)
      ) {
        continue;
      }
      releasingToolTabIdsRef.current.add(tab.id);
      if (tab.kind === "terminal") {
        const sessionId = tab.session.sessionId;
        void agentClient.closeTerminalSession({ sessionId }).then(() => {
          setToolTabs((current) => current.map((candidate) => (
            candidate.id === tab.id
            && candidate.kind === "terminal"
            && candidate.session?.sessionId === sessionId
              ? { ...candidate, session: null }
              : candidate
          )));
        }).catch(() => {
          // Cache eviction is best-effort. A later sweep retries a resource that could not close.
        }).finally(() => {
          releasingToolTabIdsRef.current.delete(tab.id);
        });
        continue;
      }
      const sessionId = tab.session.sessionId;
      void agentClient.closeManagedBrowser({ sessionId }).then(() => {
        setToolTabs((current) => current.map((candidate) => (
          candidate.id === tab.id
          && candidate.kind === "managed-browser"
          && candidate.session?.sessionId === sessionId
            ? { ...candidate, session: null }
            : candidate
        )));
      }).catch(() => {
        // Cache eviction is best-effort. A later sweep retries a resource that could not close.
      }).finally(() => {
        releasingToolTabIdsRef.current.delete(tab.id);
      });
    }
  }, [agentClient, retainedToolTabIds, toolTabs]);
  const openProjectFilePath = useCallback(async (path: string): Promise<void> => {
    if (
      activeConfigurationTab !== null
      && !await flushConfigurationFile(activeConfigurationTab)
    ) {
      return;
    }
    if (activeFileTab !== null && !await flushFileSave(activeFileTab)) return;
    const entry: ProjectEntry = {
      kind: "file",
      name: path.replaceAll("\\", "/").split("/").at(-1) ?? path,
      path,
    };
    openFile(entry);
  }, [activeConfigurationTab, activeFileTab, flushConfigurationFile, flushFileSave, openFile]);
  const showFileWorkspace = activeTab?.kind === "file"
    || activeConfigurationTab !== null
    || isFileBrowserOpen;

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
      void flushFileSave(activeFileTab);
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
      void flushConfigurationFile(activeConfigurationTab);
    }, 450);
    return () => window.clearTimeout(timer);
  }, [
    activeConfigurationPreview?.draft,
    activeConfigurationPreview?.file,
    activeConfigurationPreview?.isDirty,
    activeConfigurationTab,
    flushConfigurationFile,
  ]);

  useEffect(() => {
    if (configurationWorkspaceTarget === null) return;
    const path = configurationWorkspaceTarget.kind === "skill" ? "SKILL.md" : "mcp.json";
    openConfigurationFile(configurationWorkspaceTarget, path);
  }, [configurationWorkspaceTarget, openConfigurationFile]);

  useEffect(() => {
    if (agentPromptWorkspaceTarget === null) return;
    openAgentPromptTab(agentPromptWorkspaceTarget);
  }, [agentPromptWorkspaceTarget, openAgentPromptTab]);

  async function activateTab(tab: SidebarTab): Promise<void> {
    if (
      activeConfigurationTab !== null
      && activeConfigurationTab.id !== tab.id
      && !await flushConfigurationFile(activeConfigurationTab)
    ) {
      return;
    }
    if (
      activeFileTab !== null
      && activeFileTab.id !== tab.id
      && !await flushFileSave(activeFileTab)
    ) return;
    setActiveTabForCurrentSession(tab.id);
    if (tab.kind === "chat") onSessionViewed(tab.session.id);
    setIsFileBrowserOpen(false);
  }

  async function openProjectFile(entry: ProjectEntry): Promise<void> {
    if (
      activeConfigurationTab !== null
      && !await flushConfigurationFile(activeConfigurationTab)
    ) {
      return;
    }
    if (activeFileTab !== null && !await flushFileSave(activeFileTab)) return;
    openFile(entry);
  }

  function openFileBrowser(): void {
    if (activeFileTab !== null) {
      void flushFileSave(activeFileTab).then((saved) => {
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

  function openGitReview(): void {
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
  }

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
      && !await flushConfigurationFile(activeConfigurationTab)
    ) {
      return;
    }
    if (activeFileTab !== null && !await flushFileSave(activeFileTab)) return;
    openConfigurationFile(target, path);
  }

  function commitCloseTabs(tabsToClose: SidebarTab[]): void {
    const tabIds = new Set(tabsToClose.map((tab) => tab.id));
    const sessionIds = new Set(
      tabsToClose
        .filter((tab): tab is Extract<SidebarTab, { kind: "chat" }> => tab.kind === "chat")
        .map((tab) => tab.session.id),
    );
    if (tabIds.size === 0) return;

    setFileTabs((current) => current.filter((candidate) => !tabIds.has(candidate.id)));
    setToolTabs((current) => current.filter((candidate) => !tabIds.has(candidate.id)));
    setConfigurationFilePreviews((current) => Object.fromEntries(
      Object.entries(current).filter(([tabId]) => !tabIds.has(tabId)),
    ));
    if (sessionIds.size > 0) {
      setSideSessions((current) => current.filter((session) => !sessionIds.has(session.id)));
      updateOpenChatIds((current) => {
        const next = new Set(current);
        for (const sessionId of sessionIds) next.delete(sessionId);
        return next;
      });
    }

    if (activeTabId !== null && tabIds.has(activeTabId)) {
      setActiveTabForCurrentSession(null);
      setIsFileBrowserOpen(false);
      setIsTreeCollapsed(false);
    }
    setTabContextMenu(null);
  }

  async function closeTabs(tabsToClose: SidebarTab[]): Promise<void> {
    setOperationError(null);
    for (const tab of tabsToClose) {
      if (tab.kind === "configuration-file" && !await flushConfigurationFile(tab)) return;
      if (tab.kind === "file" && !await flushFileSave(tab)) return;
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
      if (!shouldDeleteSidebarChat(tab.session)) {
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

  return (
    <WorkbenchPanel className="right-sidebar-workspace" aria-label="右侧工作区">
      <div className="right-sidebar-workspace__main">
        <div className="right-sidebar-workspace__tabs-row">
          <div className="right-sidebar-workspace__tabs" role="tablist" aria-label="已打开文件和侧边聊天">
            {tabs.map((tab) => (
              <div
                className="right-sidebar-workspace__tab-shell"
                data-active={String(activeTab?.id === tab.id)}
                key={tab.id}
              >
                <button
                  aria-selected={activeTab?.id === tab.id}
                  className="right-sidebar-workspace__tab"
                  role="tab"
                  title={tab.kind === "file" || tab.kind === "configuration-file" ? tab.path : tab.name}
                  type="button"
                  onClick={() => void activateTab(tab)}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    void activateTab(tab);
                    setTabContextMenu({
                      tab,
                      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 176)),
                      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 128)),
                    });
                  }}
                >
                  {tab.kind === "chat" ? (
                    <MessageSquarePlus aria-hidden="true" size={14} />
                  ) : tab.kind === "git-review" ? (
                    <SquareCheckBig aria-hidden="true" size={14} />
                  ) : tab.kind === "terminal" ? (
                    <Terminal aria-hidden="true" size={14} />
                  ) : tab.kind === "managed-browser" ? (
                    <Globe2 aria-hidden="true" size={14} />
                  ) : tab.kind === "agent-prompt" ? (
                    <FileText aria-hidden="true" size={14} />
                  ) : (
                    <FileTypeIcon
                      javaDeclarationKind={tab.kind === "file" ? tab.javaDeclarationKind : undefined}
                      path={tab.path}
                      size={14}
                    />
                  )}
                  <span>{tab.name}</span>
                </button>
                <button
                  aria-label={`关闭 ${tab.name}`}
                  className="right-sidebar-workspace__tab-close"
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation();
                    void closeTabs([tab]);
                  }}
                >
                  <X aria-hidden="true" size={12} />
                </button>
              </div>
            ))}
          </div>

          <Popover open={menuOpen} onOpenChange={setMenuOpen}>
            <PopoverTrigger asChild>
              <IconButton className="right-sidebar-workspace__add" label="打开项目" size="compact">
                <Plus aria-hidden="true" size={16} />
              </IconButton>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              className="right-sidebar-workspace__menu"
              side="bottom"
              sideOffset={5}
            >
              <button
                disabled={!capabilities.git || activeProject === null}
                title={activeProject === null ? "请先打开项目" : undefined}
                type="button"
                onClick={openGitReview}
              >
                <SquareCheckBig aria-hidden="true" size={15} />
                审阅
              </button>
              <button
                disabled={!capabilities.pty || activeProject === null}
                title={activeProject === null ? "请先打开项目" : undefined}
                type="button"
                onClick={() => {
                  openTerminal();
                }}
              >
                <Terminal aria-hidden="true" size={15} />
                终端
              </button>
              <button
                disabled={!capabilities.managedBrowser}
                type="button"
                onClick={() => openManagedBrowser()}
              >
                <Globe2 aria-hidden="true" size={15} />
                浏览器
              </button>
              <button
                type="button"
                onClick={() => {
                  void (async () => {
                    if (
                      activeConfigurationTab !== null
                      && !await flushConfigurationFile(activeConfigurationTab)
                    ) return;
                    openFileBrowser();
                    setMenuOpen(false);
                  })();
                }}
              >
                <FolderOpen aria-hidden="true" size={15} />
                文件
              </button>
              <button
                disabled={activeSession === null || isCreatingChat}
                type="button"
                onClick={() => void createSideChat()}
              >
                {isCreatingChat ? (
                  <LoaderCircle aria-hidden="true" className="right-sidebar-workspace__spin" size={15} />
                ) : (
                  <SquarePen aria-hidden="true" size={15} />
                )}
                侧边聊天
              </button>
            </PopoverContent>
          </Popover>
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
                {tab.kind === "git-review" ? (
                  <GitReviewWorkspace
                    active={isActive}
                    agentClient={agentClient}
                    projectId={tab.projectId}
                  />
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
                    active={isActive && !menuOpen && tabContextMenu === null}
                    agentClient={agentClient}
                    initialUrl={tab.url}
                    session={tab.session}
                    onSessionChanged={(session) => {
                      setToolTabs((current) => current.map((candidate) => candidate.id === tab.id && candidate.kind === "managed-browser"
                        ? {
                          ...candidate,
                          name: session.title.trim() || "浏览器",
                          session,
                          url: session.url,
                        }
                        : candidate));
                    }}
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
                    agentClient={agentClient}
                    onLocateProject={onLocateProject}
                    onLocateSession={() => {
                      if (activeSession !== null) onLocateSession(activeSession.id);
                    }}
                     onOpenProjectFile={(path) => void openProjectFilePath(path)}
                    onSessionUpdated={updateSideSession}
                    onViewed={() => onSessionViewed(session.id)}
                    project={session.projectId === null ? null : activeProject}
                    relatedSessions={sideSessions}
                    session={session}
                    teamManaged={session.teamWorkItemId !== null && session.teamWorkItemId !== undefined}
                  />
                </div>
              );
            })}
          {activeTab?.kind === "chat" ? null : activeTab?.kind === "file" ? (
            <FilePreview
              isDark={isDark}
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
              onChange={(value) => {
                setFilePreviews((current) => {
                  const preview = current[activeTab.id];
                  if (preview === undefined) return current;
                  return {
                    ...current,
                    [activeTab.id]: {
                      ...preview,
                      draft: value,
                      error: null,
                      isDirty: value !== preview.savedContent,
                    },
                  };
                });
              }}
              onDirty={(content) => {
                const currentPreview = filePreviewsRef.current[activeTab.id];
                if (currentPreview === undefined) return;
                const nextPreview: FilePreviewState = {
                  ...currentPreview,
                  draft: content,
                  error: null,
                  isDirty: content !== currentPreview.savedContent,
                };
                filePreviewsRef.current = {
                  ...filePreviewsRef.current,
                  [activeTab.id]: nextPreview,
                };
                setFilePreviews((current) => {
                  const preview = current[activeTab.id];
                  if (preview === undefined) return current;
                  return {
                    ...current,
                    [activeTab.id]: {
                      ...preview,
                      draft: content,
                      error: null,
                      isDirty: content !== preview.savedContent,
                    },
                  };
                });
              }}
              onOverwrite={async () => {
                const preview = filePreviewsRef.current[activeTab.id];
                if (preview?.file === null || preview?.file === undefined) return;
                try {
                  const latest = await agentClient.readProjectFile({
                    path: activeTab.path,
                    projectId: activeTab.projectId,
                  });
                  if (
                    latest.content === null
                    || latest.isBinary
                    || latest.truncated
                  ) {
                    setFilePreviews((current) => {
                      const currentPreview = current[activeTab.id];
                      return currentPreview === undefined
                        ? current
                        : {
                          ...current,
                          [activeTab.id]: {
                            ...currentPreview,
                            conflict: "stale",
                            error: "文件过大或不可安全覆盖，请重新加载。",
                          },
                        };
                    });
                    return;
                  }
                  setFilePreviews((current) => {
                    const currentPreview = current[activeTab.id];
                    return currentPreview === undefined
                      ? current
                      : {
                        ...current,
                        [activeTab.id]: {
                          ...currentPreview,
                          conflict: null,
                          error: null,
                          file: latest,
                          savedContent: latest.content ?? "",
                        },
                      };
                  });
                  await flushFileSave(activeTab, latest.content);
                } catch (reason) {
                  setFilePreviews((current) => {
                    const currentPreview = current[activeTab.id];
                    return currentPreview === undefined
                      ? current
                      : {
                        ...current,
                        [activeTab.id]: {
                          ...currentPreview,
                          conflict: saveConflictFor(reason),
                          error: getUserErrorMessage(reason, "无法读取最新文件。"),
                        },
                      };
                  });
                }
              }}
              onReload={() => void loadFile(activeTab)}
              onRequestSave={(content) => void flushFileSave(activeTab, undefined, content)}
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
              onChange={(value) => {
                setConfigurationFilePreviews((current) => {
                  const preview = current[activeConfigurationTab.id];
                  if (preview === undefined) return current;
                  return {
                    ...current,
                    [activeConfigurationTab.id]: {
                      ...preview,
                      draft: value,
                      error: null,
                      isDirty: value !== preview.savedContent,
                    },
                  };
                });
              }}
              onReload={() => void loadConfigurationFile(activeConfigurationTab)}
              onSave={() => void flushConfigurationFile(activeConfigurationTab)}
              onToggleTree={() => setIsTreeCollapsed((current) => !current)}
            />
          ) : activeTab?.kind === "git-review"
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
        <div
          className="right-sidebar-workspace__tree"
          data-collapsed={String(isTreeCollapsed)}
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

      {tabContextMenu !== null ? createPortal(
        <>
          <div
            aria-hidden="true"
            className="right-sidebar-workspace__context-menu-backdrop"
            onMouseDown={() => setTabContextMenu(null)}
          />
          <div
            className="right-sidebar-workspace__context-menu"
            role="menu"
            style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
          >
            <button role="menuitem" type="button" onClick={() => void closeTabs([tabContextMenu.tab])}>
              <X aria-hidden="true" size={16} />
              关闭
            </button>
            <button
              disabled={tabs.length <= 1}
              role="menuitem"
              type="button"
              onClick={() => void closeTabs(tabs.filter((tab) => tab.id !== tabContextMenu.tab.id))}
            >
              <X aria-hidden="true" size={16} />
              关闭其他
            </button>
            <button role="menuitem" type="button" onClick={() => void closeTabs(tabs)}>
              <X aria-hidden="true" size={16} />
              关闭全部
            </button>
          </div>
        </>,
        document.body,
      ) : null}
    </WorkbenchPanel>
  );
}

function RightSidebarEmptyState({
  canOpenBrowser,
  canOpenGitReview,
  canOpenTerminal,
  canCreateSideChat,
  isCreatingChat,
  onCreateSideChat,
  onOpenBrowser,
  onOpenFiles,
  onOpenGitReview,
  onOpenTerminal,
}: {
  canOpenBrowser: boolean;
  canOpenGitReview: boolean;
  canOpenTerminal: boolean;
  canCreateSideChat: boolean;
  isCreatingChat: boolean;
  onCreateSideChat: () => void;
  onOpenBrowser: () => void;
  onOpenFiles: () => void;
  onOpenGitReview: () => void;
  onOpenTerminal: () => void;
}): ReactElement {
  const actions: EmptyStateAction[] = [
    {
      disabled: !canOpenGitReview,
      icon: SquareCheckBig,
      label: "审阅",
      onClick: onOpenGitReview,
      shortcut: "Ctrl+Shift+G",
      title: canOpenGitReview ? undefined : "请先打开一个 Git 项目",
    },
    {
      disabled: !canOpenTerminal,
      icon: Terminal,
      label: "终端",
      onClick: onOpenTerminal,
      shortcut: "Ctrl+`",
      title: canOpenTerminal ? undefined : "请先打开项目",
    },
    {
      disabled: !canOpenBrowser,
      icon: Globe2,
      label: "浏览器",
      onClick: onOpenBrowser,
      shortcut: "Ctrl+T",
      title: canOpenBrowser ? undefined : "当前运行环境未接入浏览器",
    },
    {
      icon: FolderOpen,
      label: "文件",
      onClick: onOpenFiles,
      shortcut: "Ctrl+P",
    },
    {
      disabled: !canCreateSideChat || isCreatingChat,
      icon: MessageSquarePlus,
      label: "侧边聊天",
      onClick: onCreateSideChat,
      shortcut: "Ctrl+Alt+S",
      title: canCreateSideChat ? undefined : "请先打开一个主对话",
    },
  ];

  return (
    <div className="right-sidebar-workspace__empty" aria-label="打开工作区标签">
      <div className="right-sidebar-workspace__empty-actions" role="group" aria-label="可打开的工作区标签">
        {actions.map((action) => {
          const Icon = action.icon;
          return (
            <button
              aria-label={action.label}
              className="right-sidebar-workspace__empty-action"
              disabled={action.disabled}
              key={action.label}
              title={action.title}
              type="button"
              onClick={action.onClick}
            >
              <Icon aria-hidden="true" size={19} strokeWidth={1.7} />
              <span>{action.label}</span>
              <kbd aria-hidden="true">{action.shortcut}</kbd>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilePreview({
  isDark,
  isTreeCollapsed,
  state,
  tab,
  onChange,
  onDirty,
  onLocateDirectory,
  onLocateFile,
  onOverwrite,
  onReload,
  onRequestSave,
  onToggleTree,
}: {
  isDark: boolean;
  isTreeCollapsed: boolean;
  state: FilePreviewState | undefined;
  tab: ProjectFileTab;
  onChange: (value: string) => void;
  onDirty: (content: string) => void;
  onLocateDirectory: () => void;
  onLocateFile: () => void;
  onOverwrite: () => void | Promise<void>;
  onReload: () => void;
   onRequestSave: (content?: string) => void;
  onToggleTree: () => void;
}): ReactElement {
  const file = state?.file ?? null;
  const editorRef = useRef<LiveMarkdownEditorHandle | null>(null);
  const canEdit = file !== null
    && file.content !== null
    && !file.isBinary
    && !file.truncated;
  const draft = state?.draft ?? file?.content ?? "";

  useEffect(() => {
    editorRef.current?.requestMeasure();
  }, [tab.id, isTreeCollapsed]);

  return (
    <section className="right-sidebar-file" aria-label={tab.name}>
      <header className="right-sidebar-file__header">
        <div className="right-sidebar-file__path" aria-label="文件路径">
          <button
            aria-label={`在文件树定位目录 ${directoryLabelForFile(tab.path)}`}
            className="right-sidebar-file__path-link right-sidebar-file__path-link--directory"
            title={directoryLabelForFile(tab.path)}
            type="button"
            onClick={onLocateDirectory}
          >
            <Folder
              aria-hidden="true"
              className="right-sidebar-file__directory-icon"
              size={14}
              strokeWidth={1.75}
            />
            <span className="right-sidebar-file__directory">
              {directoryLabelForFile(tab.path)}
            </span>
          </button>
          <ChevronRight
            aria-hidden="true"
            className="right-sidebar-file__path-separator"
            size={12}
            strokeWidth={1.75}
          />
          <button
            aria-label={`在文件树定位文件 ${tab.name}`}
            className="right-sidebar-file__path-link right-sidebar-file__path-link--file"
            title={tab.path}
            type="button"
            onClick={onLocateFile}
          >
            <FileTypeIcon
              className="right-sidebar-file__type-icon"
              javaDeclarationKind={tab.javaDeclarationKind}
              path={tab.path}
              size={14}
            />
            <span className="right-sidebar-file__name">{tab.name}</span>
          </button>
        </div>
        <div className="right-sidebar-file__actions">
          {state?.isSaving ? (
            <span className="text-[var(--app-muted-foreground)] text-[var(--app-font-size-caption)]" role="status">
              保存中
            </span>
          ) : state?.isDirty ? (
            <span className="text-[var(--app-accent)] text-[var(--app-font-size-caption)]" role="status">
              未保存
            </span>
          ) : null}
          <IconButton
            label={isTreeCollapsed ? "展开文件树" : "收起文件树"}
            size="compact"
            variant="quiet"
            onClick={onToggleTree}
          >
            {isTreeCollapsed ? (
              <PanelRightOpen aria-hidden="true" size={14} />
            ) : (
              <PanelRightClose aria-hidden="true" size={14} />
            )}
          </IconButton>
        </div>
      </header>
      {state === undefined || state.isLoading ? (
        <div className="right-sidebar-file__state" role="status">
          <LoaderCircle aria-hidden="true" className="right-sidebar-workspace__spin" size={17} />
          正在读取文件
        </div>
      ) : state.error !== null && file === null ? (
        <div className="right-sidebar-file__state">
          <p>{state.error}</p>
          <button type="button" onClick={onReload}>重试</button>
        </div>
      ) : file === null || file.isBinary || file.content === null ? (
        <div className="right-sidebar-file__state">二进制文件不可预览</div>
      ) : (
        <>
          {file.truncated ? (
            <div className="right-sidebar-file__notice">文件较大，仅显示前 2 MB，只读模式</div>
          ) : null}
          {state.conflict === "locked" ? (
            <div className="right-sidebar-file__notice" role="status">
              Agent 正在修改，稍后自动重试保存
            </div>
          ) : null}
          {state.conflict === "stale" ? (
            <div className="right-sidebar-file__notice flex items-center gap-2" role="alert">
              <span className="min-w-0 flex-1">文件已在别处更改，当前草稿尚未覆盖。</span>
              <button className="shrink-0" type="button" onClick={onReload}>重新加载</button>
              <button className="shrink-0" type="button" onClick={() => void onOverwrite()}>仍然覆盖</button>
            </div>
          ) : null}
          {state.error !== null ? (
            <div className="right-sidebar-file__notice" role="alert">{state.error}</div>
          ) : null}
          {isMarkdownFile(tab.path) ? (
            <LiveMarkdownEditor
              ref={editorRef}
              className="right-sidebar-file__editor"
              contentRevision={state?.contentRevision ?? 0}
              documentKey={tab.id}
              initialContent={draft}
              isDark={isDark}
              markdownSourcePath={tab.path}
              onDocChanged={onChange}
              onDirty={onDirty}
              onRequestSave={onRequestSave}
              readOnly={!canEdit}
            />
          ) : (
            <DocumentCodeEditor
              ariaLabel={`${tab.name} 文件内容`}
              className="right-sidebar-file__editor"
              isDark={isDark}
              language={languageForPath(tab.path)}
              value={draft}
              readOnly={!canEdit}
              onChange={onChange}
              onSave={onRequestSave}
            />
          )}
        </>
      )}
    </section>
  );
}

function AgentPromptPreview({
  isDark,
  tab,
}: {
  isDark: boolean;
  tab: AgentPromptTab;
}): ReactElement {
  const agent = useAgentDirectoryStore((state) => (
    state.agents.find((candidate) => candidate.id === tab.agentId)
  ));
  const updateAgent = useAgentDirectoryStore((state) => state.updateAgent);
  const editorRef = useRef<LiveMarkdownEditorHandle | null>(null);
  const initialSource = agent === undefined ? "" : serializeAgentPromptDocument(agent);
  const sourceRef = useRef(initialSource);
  const [documentSource, setDocumentSource] = useState(initialSource);
  const [documentRevision, setDocumentRevision] = useState(0);
  const saveDocument = useCallback((source: string): void => {
    if (agent === undefined) return;
    sourceRef.current = source;
    const next = parseAgentPromptDocument(source, agent);
    if (
      next.name === agent.name
      && next.role === agent.role
      && next.description === agent.description
      && next.instructions === agent.instructions
    ) {
      return;
    }
    updateAgent(tab.agentId, next);
  }, [agent, tab.agentId, updateAgent]);

  useEffect(() => {
    if (agent === undefined) return;
    const projected = parseAgentPromptDocument(sourceRef.current, agent);
    if (
      projected.name === agent.name
      && projected.role === agent.role
      && projected.description === agent.description
      && projected.instructions === agent.instructions
    ) {
      return;
    }

    const nextSource = serializeAgentPromptDocument(agent);
    sourceRef.current = nextSource;
    setDocumentSource(nextSource);
    setDocumentRevision((current) => current + 1);
  }, [agent]);

  useEffect(() => {
    editorRef.current?.requestMeasure();
  }, [tab.id]);

  return (
    <section className="right-sidebar-file right-sidebar-config-file" aria-label={tab.title}>
      <header className="right-sidebar-file__header">
        <div className="right-sidebar-file__path" aria-label="Agent 提示词文档">
          <span className="right-sidebar-config-file__workspace" title={agent?.name ?? tab.title}>
            <FileText aria-hidden="true" size={14} />
            {agent?.name ?? tab.title}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="right-sidebar-file__path-separator"
            size={12}
            strokeWidth={1.75}
          />
          <span className="right-sidebar-config-file__path" title="核心指令.md">
            <FileText aria-hidden="true" size={14} />
            核心指令.md
          </span>
        </div>
        <div className="right-sidebar-file__actions">
          <span className="text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]" role="status">
            自动保存
          </span>
        </div>
      </header>
      {agent === undefined ? (
        <div className="right-sidebar-file__state">该 Agent 已删除，无法继续编辑提示词。</div>
      ) : (
        <LiveMarkdownEditor
          ref={editorRef}
          className="right-sidebar-file__editor"
          contentRevision={documentRevision}
          documentKey={tab.id}
          documentTitle={`${agent.name.trim() || "未命名 Agent"} 的核心指令`}
          initialContent={documentSource}
          isDark={isDark}
          placeholder="用 Markdown 编写这个 Agent 的核心指令…"
          onDirty={saveDocument}
          onDocChanged={saveDocument}
          onRequestSave={saveDocument}
        />
      )}
      <footer className="right-sidebar-config-file__footer">
        <span>提示词会随 Agent 配置自动保存</span>
        <span>Markdown</span>
      </footer>
    </section>
  );
}

function ConfigurationFilePreview({
  isDark,
  isTreeCollapsed,
  state,
  tab,
  onChange,
  onReload,
  onSave,
  onToggleTree,
}: {
  isDark: boolean;
  isTreeCollapsed: boolean;
  state: ConfigurationFilePreviewState | undefined;
  tab: ConfigurationFileTab;
  onChange: (value: string) => void;
  onReload: () => void;
  onSave: () => void;
  onToggleTree: () => void;
}): ReactElement {
  const file = state?.file ?? null;
  const canEdit = file !== null
    && file.content !== null
    && !file.isBinary
    && !file.truncated;
  const status = state === undefined || state.isLoading
    ? "正在读取文件"
    : state.isSaving
      ? "正在保存"
      : state.isDirty
        ? "有未保存改动"
        : "已保存";
  return (
    <section className="right-sidebar-file right-sidebar-config-file" aria-label={tab.name}>
      <header className="right-sidebar-file__header">
        <div className="right-sidebar-file__path" aria-label="配置文件路径">
          <span className="right-sidebar-config-file__workspace" title={tab.title}>
            <FolderOpen aria-hidden="true" size={14} />
            {tab.title}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="right-sidebar-file__path-separator"
            size={12}
            strokeWidth={1.75}
          />
          <span className="right-sidebar-config-file__path" title={tab.path}>
            <FileTypeIcon className="right-sidebar-file__type-icon" path={tab.path} size={14} />
            {tab.path}
          </span>
        </div>
        <div className="right-sidebar-file__actions">
          <IconButton
            disabled={!canEdit || state?.isDirty !== true || state?.isSaving === true}
            label="立即保存文件"
            size="compact"
            variant="quiet"
            onClick={onSave}
          >
            {state?.isSaving ? (
              <LoaderCircle aria-hidden="true" className="right-sidebar-workspace__spin" size={14} />
            ) : (
              <Check aria-hidden="true" size={15} />
            )}
          </IconButton>
          <IconButton
            label={isTreeCollapsed ? "展开文件树" : "收起文件树"}
            size="compact"
            variant="quiet"
            onClick={onToggleTree}
          >
            {isTreeCollapsed ? (
              <PanelRightOpen aria-hidden="true" size={14} />
            ) : (
              <PanelRightClose aria-hidden="true" size={14} />
            )}
          </IconButton>
        </div>
      </header>
      {state === undefined || state.isLoading ? (
        <div className="right-sidebar-file__state" role="status">
          <LoaderCircle aria-hidden="true" className="right-sidebar-workspace__spin" size={17} />
          正在读取文件
        </div>
      ) : state.error !== null ? (
        <div className="right-sidebar-file__state" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={onReload}>重试</button>
        </div>
      ) : file === null || file.isBinary || file.content === null ? (
        <div className="right-sidebar-file__state">二进制文件不可预览或编辑</div>
      ) : (
        <>
          {file.truncated ? (
            <div className="right-sidebar-file__notice">文件较大，仅显示前 2 MB，不能直接保存</div>
          ) : null}
          <DocumentCodeEditor
            readOnly={!canEdit}
            ariaLabel={`${tab.name} 文件编辑器`}
            className="right-sidebar-file__editor"
            isDark={isDark}
            language={languageForPath(tab.path)}
            value={state.draft}
            onChange={onChange}
            onSave={onSave}
          />
        </>
      )}
      <footer className="right-sidebar-config-file__footer">
        <span>{status}</span>
        {file?.isProtected ? <span>入口文件可编辑，不可删除</span> : null}
      </footer>
    </section>
  );
}
