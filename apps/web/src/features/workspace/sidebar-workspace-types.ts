import type {
  ConfigurationWorkspaceFile,
  ConfigurationWorkspaceKind,
  JavaDeclarationKind,
  ManagedBrowserSession,
  ProjectFile,
  TerminalSession,
  TeamInstanceView,
} from "@agent/protocol";
import type { TaskListViewRequest } from "../../stores/workbench-ui-store.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import type { TeamChatDetailsSection } from "../team/team-chat-details.js";

export type ProjectFileTab = {
  id: string;
  kind: "file";
  javaDeclarationKind: JavaDeclarationKind | undefined;
  name: string;
  path: string;
  projectId: string;
};

export type ConfigurationFileTab = {
  configurationId: string;
  configurationKind: ConfigurationWorkspaceKind;
  id: string;
  kind: "configuration-file";
  name: string;
  path: string;
  title: string;
};

export type AgentPromptTab = {
  agentId: string;
  id: string;
  kind: "agent-prompt";
  name: string;
  title: string;
};

export type FileTab = ProjectFileTab | ConfigurationFileTab | AgentPromptTab;

export type ToolTabBase = {
  id: string;
  lastAccessedAt: number;
  name: string;
};

export type GitReviewTab = ToolTabBase & {
  kind: "git-review";
  projectId: string;
};

export type TerminalTab = ToolTabBase & {
  kind: "terminal";
  projectId: string;
  session: TerminalSession | null;
};

export type ManagedBrowserTab = ToolTabBase & {
  background?: boolean;
  conversationId: string | null;
  kind: "managed-browser";
  session: ManagedBrowserSession | null;
  url: string;
};

export type BackgroundCommandTab = ToolTabBase & { kind: "background-command"; conversationId: string; commandId: string };
export type ConversationReviewTab = ToolTabBase & { kind: "conversation-review"; conversationId: string; runId: string | null };
export type TaskListTab = ToolTabBase & { kind: "task-list"; request: TaskListViewRequest };
export type TeamChatDetailsTab = ToolTabBase & { kind: "group-details"; instance: TeamInstanceView; section: TeamChatDetailsSection };
export type ToolTab = TaskListTab | GitReviewTab | TerminalTab | ManagedBrowserTab | BackgroundCommandTab | ConversationReviewTab | TeamChatDetailsTab;

export type SidebarTab =
  | FileTab
  | ToolTab
  | { id: string; kind: "chat"; name: string; session: ProjectSession };

export type FilePreviewState = {
  /** 仅在外部读取成功时递增，让实时预览替换同一标签中的旧文档。 */
  contentRevision: number;
  conflict: FileSaveConflict | null;
  draft: string;
  error: string | null;
  file: ProjectFile | null;
  imageDataUrl: string | null;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  savedContent: string;
};

export type FileSaveConflict = "locked" | "stale";

export type ConfigurationFilePreviewState = {
  draft: string;
  error: string | null;
  file: ConfigurationWorkspaceFile | null;
  isDirty: boolean;
  isLoading: boolean;
  isSaving: boolean;
  savedContent: string;
};

export type TabContextMenuState = {
  tab: SidebarTab;
  x: number;
  y: number;
};

export type ProjectFileOpenRequest = {
  path: string;
  projectId: string;
};

export type GitReviewOpenRequest = {
  path: string | null;
  projectId: string;
  requestId: number;
};

export type TeamMemberOpenRequest = {
  conversation: ProjectSession;
  requestId: number;
  /** The owning ordinary conversation or group workspace key; never a member API target. */
  sourceConversationId: string;
  timelineItemId: string | null;
};
