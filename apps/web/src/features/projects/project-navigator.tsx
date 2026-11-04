import { useNavigatorExpansion } from "./use-navigator-expansion.js";
import { useNavigatorDrag } from "./use-navigator-drag.js";
import { Spinner } from "../../components/ui/loading.js";
import { hasUnreadSessionResult } from "./navigator-session-status.js";
import {
  ArrowDownUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock3,
  Folder,
  FolderOpen,
  FolderPlus,
  Folders,
  MoreHorizontal,
  Pin,
  Plus,
  Search,
  SquarePen,
  UsersRound,
  X,
} from "lucide-react";
import {
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import { useNativeOverlayContainer } from "../../components/ui/native-overlay-provider.js";

import type {
  AgentProfile,
  AgentTeam,
  CreateTeamInstanceInput,
  ProjectSummary,
  TeamInstanceScope,
  TeamInstanceView,
  TeamWorkItemView,
} from "@agent/protocol";

import { WorkbenchPanel } from "../../components/layout/panel.js";
import { projectAccent } from "../../components/layout/project-accent.js";
import { IconButton } from "../../components/ui/icon-button.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import {
  getTeamInstanceNavigatorGroups,
  getProjectSessions,
  getPinnedSessions,
  getTemporarySessions,
  isProjectSessionRunning as isSessionRunning,
  type ProjectSession,
} from "./project-session-model.js";
import type { ProjectTreeController } from "./use-project-tree.js";
import "./project-navigator.css";

type ProjectNavigatorProps = {
  onOpenGlobalSearch?: () => void;
  activeSessionId: string | null;
  agents: AgentProfile[];
  isCreatingSession: boolean;
  isLoadingSessions: boolean;
  locateRequest: ProjectNavigatorLocateRequest | null;
  operationError: string | null;
  sessions: ProjectSession[];
  teamInstances: TeamInstanceView[];
  teams: AgentTeam[];
  teamWorkItems: TeamWorkItemView[];
  tree: ProjectTreeController;
  onClearOperationError: () => void;
  onCopyText: (text: string) => Promise<void>;
  onOpenProjectDirectory?: (projectId: string) => Promise<void>;
  onCreateProjectSession: (projectId: string) => void;
  onCreateTemporarySession: () => void;
  onDeleteSession: (sessionId: string) => Promise<boolean>;
  onCreateTeamInstance: (input: CreateTeamInstanceInput) => Promise<boolean>;
  onDeleteTeamInstance: (teamInstanceId: string) => Promise<boolean>;
  onOpenTeamMember: (
    teamInstanceId: string,
    agentId: string,
    session: ProjectSession | null,
  ) => void;
  onRenameTeamInstance: (
    teamInstanceId: string,
    name: string,
    projectId?: string | null,
  ) => Promise<boolean>;
  onRemoveProject: (projectId: string) => Promise<boolean>;
  onRenameProject: (projectId: string, name: string) => Promise<boolean>;
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>;
  onReorderSessions: (sessionIds: string[]) => Promise<boolean>;
  onSetSessionProject: (sessionId: string, projectId: string | null) => Promise<boolean>;
  onReorderTeamInstances: (teamInstanceIds: string[]) => Promise<boolean>;
  onSelectSession: (sessionId: string) => void;
  onKeepSession?: (sessionId: string) => void;
  onSetSessionArchived: (sessionId: string, archived: boolean) => Promise<boolean>;
  onSetSessionPinned: (sessionId: string, pinned: boolean) => Promise<boolean>;
  onSetTeamInstanceArchived: (
    teamInstanceId: string,
    archived: boolean,
  ) => Promise<boolean>;
};

import { NavigatorGroupHeader, NavigatorSortIcon } from "./navigator-group-header.js";
import { TeamInstanceTreeItem } from "./navigator-team-tree-item.js";
import { SessionTreeItem } from "./navigator-session-tree-item.js";
import { NavigatorContextMenuView } from "./navigator-context-menu.js";
import { NavigatorManagementDialog } from "./navigator-management-dialog.js";
import { NavigatorEmpty } from "./navigator-empty.js";
import {
  NAVIGATOR_SORT_OPTIONS,
  navigatorLabelCollator,
  sessionTreeMatchesQuery,
  sortNavigatorItems,
  teamGroupMatchesQuery,
} from "./navigator-model.js";
import type {
  NavigatorContextMenu,
  NavigatorDialog,
  NavigatorMenuTarget,
  NavigatorSortOption,
  ProjectNavigatorLocateRequest,
} from "./navigator-types.js";

export type { ProjectNavigatorLocateRequest } from "./navigator-types.js";

export function ProjectNavigator({
  onOpenGlobalSearch,
  activeSessionId,
  agents,
  isCreatingSession,
  isLoadingSessions,
  locateRequest,
  operationError,
  sessions,
  teamInstances,
  teams,
  teamWorkItems,
  tree,
  onClearOperationError,
  onCopyText,
  onOpenProjectDirectory,
  onCreateProjectSession,
  onCreateTeamInstance,
  onCreateTemporarySession,
  onDeleteTeamInstance,
  onDeleteSession,
  onOpenTeamMember,
  onRemoveProject,
  onRenameProject,
  onRenameSession,
  onRenameTeamInstance,
  onReorderSessions,
  onSetSessionProject,
  onReorderTeamInstances,
  onSelectSession,
  onKeepSession,
  onSetSessionArchived,
  onSetSessionPinned,
  onSetTeamInstanceArchived,
}: ProjectNavigatorProps): ReactElement {
  const nativeOverlayContainer = useNativeOverlayContainer();
  const activeProjectId = tree.activeProject?.id ?? null;
  const {
    bodyRef,
    projectSessionLimits,
    expandedSessionIds,
    expandedTeamIds,
    isProjectsGroupExpanded,
    isTeamsGroupExpanded,
    isPinnedGroupExpanded,
    isTemporaryGroupExpanded,
    isProjectExpanded,
    toggleProjectExpansion,
    toggleSessionExpansion,
    toggleTeamExpansion,
    toggleGroup,
    setAllExpanded,
    revealProject,
    showMoreProjectSessions,
  } = useNavigatorExpansion({ activeProjectId, locateRequest, sessions });
  const [query, setQuery] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortOption, setSortOption] = useState<NavigatorSortOption>("custom");
  const [contextMenu, setContextMenu] = useState<NavigatorContextMenu | null>(null);
  const [menuError, setMenuError] = useState<string | null>(null);
  const [dialog, setDialog] = useState<NavigatorDialog | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftProjectId, setDraftProjectId] = useState("");
  const [draftTeamId, setDraftTeamId] = useState(teams[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const {
    dragItem,
    dropIndicator,
    dropProjectId,
    startDrag,
    updateDropIndicator,
    finishDrag,
    updateProjectDrop,
    moveSessionToProject,
    dropItem,
  } = useNavigatorDrag({ normalizedQuery, sessions, onSetSessionProject, onReorderProjects: projectIds => tree.reorderProjects(projectIds), onReorderSessions, onReorderTeamInstances, onSessionMoved: revealProject });
  const sortLabel = NAVIGATOR_SORT_OPTIONS.find(
    (option) => option.value === sortOption,
  )?.label ?? "自定义顺序";
  const projectNamesById = useMemo(
    () => new Map(tree.projects.map((project) => [project.id, project.name])),
    [tree.projects],
  );

  const teamInstanceGroups = useMemo(
    () => getTeamInstanceNavigatorGroups(
      teamInstances,
      teams,
      sessions,
      agents,
      teamWorkItems,
    ),
    [agents, sessions, teamInstances, teamWorkItems, teams],
  );

  const visiblePinnedSessions = useMemo(
    () =>
      sortNavigatorItems(
        getPinnedSessions(sessions).filter((session) =>
          sessionTreeMatchesQuery(session, normalizedQuery),
        ),
        sortOption,
        (session) => session.title,
      ),
    [normalizedQuery, sessions, sortOption],
  );
  const visibleTemporarySessions = useMemo(
    () =>
      sortNavigatorItems(
        getTemporarySessions(sessions).filter(
          (session) =>
            !session.isPinned &&
            sessionTreeMatchesQuery(session, normalizedQuery),
        ),
        sortOption,
        (session) => session.title,
      ),
    [normalizedQuery, sessions, sortOption],
  );
  const visibleProjects = useMemo(
    () =>
      tree.projects
        .filter((project) => {
          if (normalizedQuery.length === 0) return true;

          if (project.name.toLocaleLowerCase().includes(normalizedQuery)) {
            return true;
          }

          return teamInstanceGroups.some((group) =>
            project.showTeamsInNavigator === true
            && group.instance.scope === "project"
            && group.instance.projectId === project.id
            && teamGroupMatchesQuery(group, normalizedQuery),
          ) || getProjectSessions(sessions, project.id).some(
            (session) =>
              !session.isPinned &&
              sessionTreeMatchesQuery(
                session,
                normalizedQuery,
              ),
          );
        })
        .sort((left, right) => {
          const pinComparison =
            Number(right.isPinned === true) - Number(left.isPinned === true);
          if (pinComparison !== 0 || sortOption === "custom") return pinComparison;
          const nameComparison = navigatorLabelCollator.compare(left.name, right.name);
          return sortOption === "name-descending" ? -nameComparison : nameComparison;
        }),
    [normalizedQuery, sessions, sortOption, teamInstanceGroups, tree.projects],
  );
  const visibleTeamGroups = useMemo(
    () => sortNavigatorItems(
      teamInstanceGroups.filter((group) =>
        (group.instance.scope === "global" || group.instance.scope === "project")
        && (
          teamGroupMatchesQuery(group, normalizedQuery)
          || (
            normalizedQuery.length > 0
            && group.instance.projectId !== null
            && projectNamesById.get(group.instance.projectId)
              ?.toLocaleLowerCase().includes(normalizedQuery) === true
          )
        ),
      ),
      sortOption,
      (group) => group.instance.name,
    ),
    [normalizedQuery, projectNamesById, sortOption, teamInstanceGroups],
  );
  const hasPinnedGroup = visiblePinnedSessions.length > 0;
  const hasProjectsGroup = visibleProjects.length > 0;
  const hasTeamsGroup = visibleTeamGroups.length > 0 || normalizedQuery.length === 0;
  const hasTemporaryGroup = visibleTemporarySessions.length > 0;
  const allNavigatorGroupsCollapsed =
    (!hasProjectsGroup || !isProjectsGroupExpanded)
    && (!hasTeamsGroup || !isTeamsGroupExpanded)
    && (!hasPinnedGroup || !isPinnedGroupExpanded)
    && (!hasTemporaryGroup || !isTemporaryGroupExpanded);
  const hasExpandableNavigatorGroups =
    hasProjectsGroup || hasTeamsGroup || hasPinnedGroup || hasTemporaryGroup;
  const contextMenuProjectId = contextMenu?.target.kind === "project"
    ? contextMenu.target.project.id
    : null;
  const contextMenuProjectHasRunningSession = contextMenuProjectId !== null &&
    sessions.some((session) =>
      session.projectId === contextMenuProjectId && isSessionRunning(session),
    );

  function openContextMenu(
    event: MouseEvent,
    target: NavigatorMenuTarget,
  ): void {
    event.preventDefault();
    const bounds = event.type === "click" ? event.currentTarget.getBoundingClientRect() : null;
    setContextMenu({
      target,
      x: Math.max(8, Math.min(bounds?.left ?? event.clientX, window.innerWidth - 196)),
      y: Math.max(8, Math.min(bounds ? bounds.bottom + 4 : event.clientY, window.innerHeight - 310)),
    });
  }

  function openProjectActionsMenu(
    event: MouseEvent<HTMLButtonElement>,
    project: ProjectSummary,
  ): void {
    event.stopPropagation();
    const bounds = event.currentTarget.getBoundingClientRect();
    setContextMenu({
      target: { kind: "project", project },
      x: Math.max(8, Math.min(bounds.left, window.innerWidth - 196)),
      y: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 310)),
    });
  }

  function openRenameDialog(target: NavigatorMenuTarget): void {
    setContextMenu(null);
    setDraftName(target.kind === "project"
      ? target.project.name
      : target.kind === "session"
        ? target.session.title
        : target.instance.name);
    setDialog(
      target.kind === "project"
        ? { kind: "rename-project", project: target.project }
        : target.kind === "session"
          ? { kind: "rename-session", session: target.session }
          : { kind: "rename-team-instance", instance: target.instance },
    );
  }

  function openEditTeamDialog(instance: TeamInstanceView): void {
    setContextMenu(null);
    setDraftName(instance.name);
    setDraftProjectId(instance.projectId ?? "");
    setDialog({ instance, kind: "edit-team-instance" });
  }

  function openCreateTeamDialog(
    scope: TeamInstanceScope,
    projectId: string | null,
    sourceConversationId: string | null,
  ): void {
    const defaultTeam = teams.find((team) => team.enabled) ?? teams[0];
    if (defaultTeam === undefined) return;
    setDraftTeamId(defaultTeam.id);
    setDraftName("");
    setDraftProjectId(projectId ?? "");
    setDialog({
      kind: "create-team-instance",
      projectId,
      scope,
      sourceConversationId,
    });
  }

  async function submitDialog(): Promise<void> {
    if (dialog === null || isSubmitting) return;
    setIsSubmitting(true);
    let succeeded: boolean;
    if (dialog.kind === "rename-project") {
      succeeded = await onRenameProject(dialog.project.id, draftName.trim());
    } else if (dialog.kind === "rename-session") {
      succeeded = await onRenameSession(dialog.session.id, draftName.trim());
    } else if (dialog.kind === "rename-team-instance") {
      succeeded = await onRenameTeamInstance(
        dialog.instance.id,
        draftName.trim(),
      );
    } else if (dialog.kind === "edit-team-instance") {
      succeeded = await onRenameTeamInstance(
        dialog.instance.id,
        dialog.instance.name,
        draftProjectId.length === 0 ? null : draftProjectId,
      );
    } else if (dialog.kind === "create-team-instance") {
      const selectedProjectId = dialog.scope === "conversation"
        ? dialog.projectId
        : draftProjectId.length === 0 ? null : draftProjectId;
      const selectedScope = dialog.scope === "conversation"
        ? "conversation"
        : selectedProjectId === null ? "global" : "project";
      const input: CreateTeamInstanceInput = {
        scope: selectedScope,
        teamId: draftTeamId,
        ...(draftName.trim().length === 0 ? {} : { name: draftName.trim() }),
        ...(selectedProjectId === null ? {} : { projectId: selectedProjectId }),
        ...(dialog.sourceConversationId === null
          ? {}
          : { sourceConversationId: dialog.sourceConversationId }),
      };
      succeeded = await onCreateTeamInstance(input);
    } else if (dialog.kind === "remove-project") {
      succeeded = await onRemoveProject(dialog.project.id);
    } else if (dialog.kind === "delete-team-instance") {
      succeeded = await onDeleteTeamInstance(dialog.instance.id);
    } else {
      succeeded = await onDeleteSession(dialog.session.id);
    }
    setIsSubmitting(false);
    if (succeeded) setDialog(null);
  }

  return (
    <WorkbenchPanel
      className="project-navigator"
      aria-labelledby="project-navigator-heading"
    >
      <header className="project-navigator__top">
        <h2 className="sr-only" id="project-navigator-heading">
          项目、团队与对话
        </h2>

        <div className="project-navigator__toolbar">
          <div className="project-navigator__toolbar-group">
            <IconButton
              className="project-navigator__tool-button"
              disabled={!tree.canAddProjects || tree.isAddingProject}
              label={tree.isAddingProject ? "正在打开项目" : "打开或添加项目"}
              size="compact"
              variant="quiet"
              onClick={() => void tree.addProject()}
            >
              {tree.isAddingProject ? (
                <Spinner aria-hidden="true" size={16} />
              ) : (
                <FolderPlus aria-hidden="true" size={16} />
              )}
            </IconButton>
            <IconButton
              className="project-navigator__tool-button"
              disabled={isCreatingSession}
              label={isCreatingSession ? "正在创建对话" : "新建对话"}
              size="compact"
              variant="quiet"
              onClick={() => {
                if (activeProjectId === null) onCreateTemporarySession();
                else onCreateProjectSession(activeProjectId);
              }}
            >
              <SquarePen aria-hidden="true" size={16} />
            </IconButton>
            <Popover open={sortOpen} onOpenChange={setSortOpen}>
              <PopoverTrigger asChild>
                <IconButton
                  className="project-navigator__tool-button"
                  disabled={tree.projects.length === 0 && sessions.length === 0}
                  label={`排序：${sortLabel}`}
                  size="compact"
                  variant="quiet"
                >
                  <ArrowDownUp aria-hidden="true" size={16} />
                </IconButton>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="project-navigator__sort-menu"
                collisionPadding={8}
                side="bottom"
                sideOffset={4}
              >
                <p>排序方式</p>
                <div role="menu">
                  {NAVIGATOR_SORT_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      aria-checked={option.value === sortOption}
                      role="menuitemradio"
                      type="button"
                      onClick={() => {
                        setSortOption(option.value);
                        setSortOpen(false);
                      }}
                    >
                      <span className="project-navigator__sort-option">
                        <NavigatorSortIcon option={option.value} />
                        {option.label}
                      </span>
                      {option.value === sortOption ? (
                        <Check aria-hidden="true" size={14} />
                      ) : null}
                    </button>
                  ))}
                </div>
              </PopoverContent>
            </Popover>
          </div>
          <IconButton
            className="project-navigator__tool-button"
            disabled={!hasExpandableNavigatorGroups}
            label={allNavigatorGroupsCollapsed ? "全部展开项目与对话" : "全部收起项目与对话"}
            size="compact"
            variant="quiet"
            onClick={() => {
              setAllExpanded(allNavigatorGroupsCollapsed, tree.projects.map(project => project.id), teamInstanceGroups);
            }}
          >
            {allNavigatorGroupsCollapsed ? (
              <ChevronsUpDown aria-hidden="true" size={15} />
            ) : (
              <ChevronsDownUp aria-hidden="true" size={15} />
            )}
          </IconButton>
        </div>

        <label className="project-navigator__search app-search-field">
        {onOpenGlobalSearch === undefined ? <Search aria-hidden="true" size={14} /> : (
          <IconButton label="搜索所有对话" tooltip="搜索对话正文（Ctrl+Shift+F）" size="compact" onClick={onOpenGlobalSearch}><Search aria-hidden="true" size={14} /></IconButton>
        )}
        <input
          aria-label="搜索项目、团队或对话"
          placeholder="搜索项目、团队或对话"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {query.length > 0 ? (
          <button
            aria-label="清除搜索"
            type="button"
            onClick={() => setQuery("")}
          >
            <X aria-hidden="true" size={13} />
          </button>
        ) : null}
        </label>

        {menuError ?? tree.operationError ?? operationError ? (
          <div className="project-navigator__notice" role="status">
            <span>{menuError ?? tree.operationError ?? operationError}</span>
            <button
              type="button"
              onClick={() => {
                tree.clearOperationError();
                setMenuError(null);
                onClearOperationError();
              }}
            >
              关闭
            </button>
          </div>
        ) : null}
      </header>

      <div className="project-navigator__body" ref={bodyRef}>
        {tree.isLoadingProjects || isLoadingSessions ? (
          <NavigatorEmpty label="正在读取项目…" loading />
        ) : (
          <>
            {visiblePinnedSessions.length > 0 ? (
              <section
                className={`project-navigator__pinned${
                  visibleProjects.length > 0
                    ? " project-navigator__pinned--separated"
                    : ""
                }`}
                aria-label="置顶对话"
              >
                <NavigatorGroupHeader
                  expanded={isPinnedGroupExpanded}
                  icon={<Pin aria-hidden="true" size={15} />}
                  label="置顶"
                  onToggle={() => toggleGroup("pinned")}
                />
                {isPinnedGroupExpanded ? (
                  <div className="project-navigator__sessions">
                  {visiblePinnedSessions.map((session) => (
                    <SessionTreeItem
                      menuOpen={contextMenu?.target.kind === "session" && contextMenu.target.session.id === session.id}
                      key={session.id}
                      active={session.id === activeSessionId}
                      activeSessionId={activeSessionId}
                      located={locateRequest?.kind === "session" && locateRequest.id === session.id}
                      draggable={
                        sortOption === "custom"
                        && normalizedQuery.length === 0
                        && visiblePinnedSessions.length > 1
                      }
                      dragging={dragItem?.kind === "session" && dragItem.id === session.id}
                      dropPosition={
                        dropIndicator?.kind === "session" && dropIndicator.id === session.id
                          ? dropIndicator.position
                          : null
                      }
                      session={session}
                      subagentsExpanded={
                        normalizedQuery.length > 0 || expandedSessionIds.has(session.id)
                      }
                      onArchive={(archived) => void onSetSessionArchived(session.id, archived)}
                      onContextMenu={(event) => openContextMenu(event, { kind: "session", session })}
                      onDragEnd={finishDrag}
                      onDragOver={(event) => updateDropIndicator(event, {
                        groupKey: "session:pinned",
                        id: session.id,
                        kind: "session",
                      })}
                      onDragStart={(event) => startDrag(event, {
                        groupKey: "session:pinned",
                        id: session.id,
                        kind: "session",
                      }, ".project-navigator__session-actions")}
                      onDrop={(event) => dropItem(event, {
                        groupKey: "session:pinned",
                        id: session.id,
                        kind: "session",
                      }, visiblePinnedSessions.map((candidate) => candidate.id))}
                      onPin={(pinned) => void onSetSessionPinned(session.id, pinned)}
                      onSelect={onSelectSession}
                      {...(onKeepSession === undefined ? {} : { onKeep: onKeepSession })}
                      onToggleSubagents={() => toggleSessionExpansion(session.id)}
                    />
                  ))}
                  </div>
                ) : null}
              </section>
            ) : null}

            {tree.projects.length === 0 ? (
              visiblePinnedSessions.length === 0
                && visibleTeamGroups.length === 0
                && visibleTemporarySessions.length === 0 ? (
                tree.canAddProjects ? (
                  <NavigatorEmpty
                    actionLabel="添加项目"
                    label="添加项目，或使用上方按钮开启临时对话。"
                    onAction={() => void tree.addProject()}
                  />
                ) : (
                  <NavigatorEmpty label="使用上方按钮开启临时对话。" />
                )
              ) : null
            ) : visibleProjects.length === 0 ? (
              visiblePinnedSessions.length === 0
                && visibleTeamGroups.length === 0
                && visibleTemporarySessions.length === 0 ? (
                <NavigatorEmpty label="没有匹配的项目、团队或对话。" />
              ) : null
            ) : (
              <section className="project-navigator__project-group" aria-label="项目">
                <NavigatorGroupHeader
                  action={{
                    disabled: !tree.canAddProjects || tree.isAddingProject,
                    icon: tree.isAddingProject ? (
                      <Spinner aria-hidden="true" size={15} />
                    ) : (
                      <Plus aria-hidden="true" size={15} />
                    ),
                    label: tree.isAddingProject ? "正在打开项目" : "打开或添加项目",
                    onClick: () => void tree.addProject(),
                  }}
                  expanded={isProjectsGroupExpanded}
                  icon={<Folders aria-hidden="true" size={15} />}
                  label="项目"
                  onToggle={() => toggleGroup("projects")}
                />
                {isProjectsGroupExpanded ? (
                  <ul className="project-navigator__projects" aria-label="项目列表">
                {visibleProjects.map((project) => {
                  const projectTeamGroups = teamInstanceGroups.filter((group) =>
                    project.showTeamsInNavigator === true
                    && group.instance.scope === "project"
                    && group.instance.projectId === project.id
                    && teamGroupMatchesQuery(group, normalizedQuery),
                  );
                  const projectSessions = sortNavigatorItems(
                    getProjectSessions(sessions, project.id).filter(
                      (session) => !session.isPinned,
                    ),
                    sortOption,
                    (session) => session.title,
                  );
                  const matchingSessions =
                    normalizedQuery.length === 0
                      ? projectSessions
                      : projectSessions.filter((session) =>
                          sessionTreeMatchesQuery(
                            session,
                            normalizedQuery,
                          ),
                        );
                  const sessionLimit = projectSessionLimits[project.id] ?? 5;
                  const visibleSessions = normalizedQuery.length > 0 ? matchingSessions : matchingSessions.filter(
                    (session, index) => index < sessionLimit || isSessionRunning(session)
                      || hasUnreadSessionResult(session)
                      || session.id === activeSessionId
                      || (locateRequest?.kind === "session" && locateRequest.id === session.id),
                  );
                  const hiddenSessionCount = matchingSessions.length - visibleSessions.length;
                  const isExpanded =
                    isProjectExpanded(project.id);
                  const projectGroupKey = `project:${project.isPinned === true ? "pinned" : "regular"}`;
                  const projectGroupIds = visibleProjects
                    .filter((candidate) => candidate.isPinned === project.isPinned)
                    .map((candidate) => candidate.id);
                  const folderAccent = projectAccent(project, tree.projects);

                  return (
                    <li
                      key={project.id}
                      className="project-navigator__project"
                      data-pinned={project.isPinned === true}
                    >
                      <div
                        className="project-navigator__project-row"
                        data-dragging={dragItem?.kind === "project" && dragItem.id === project.id}
                        data-drop-project={dropProjectId === project.id || undefined}
                        data-drop-position={
                          dropIndicator?.kind === "project" && dropIndicator.id === project.id
                            ? dropIndicator.position
                            : undefined
                        }
                        draggable={
                          sortOption === "custom"
                          && normalizedQuery.length === 0
                          && projectGroupIds.length > 1
                        }
                        onDragEnd={finishDrag}
                        onDragOver={(event) => {
                          if (updateProjectDrop(event, project.id)) return;
                          updateDropIndicator(event, {
                            groupKey: projectGroupKey,
                            id: project.id,
                            kind: "project",
                          });
                        }}
                        onDragStart={(event) => startDrag(event, {
                          groupKey: projectGroupKey,
                          id: project.id,
                          kind: "project",
                        }, ".project-navigator__project-actions")}
                        onDrop={(event) => {
                          if (moveSessionToProject(event, project.id)) return;
                          dropItem(event, {
                            groupKey: projectGroupKey,
                            id: project.id,
                            kind: "project",
                          }, projectGroupIds);
                        }}
                      >
                        <button
                          aria-expanded={isExpanded}
                          aria-label={isExpanded ? `收起 ${project.name}` : `展开 ${project.name}`}
                          className="project-navigator__project-toggle"
                          title={isExpanded ? "收起会话" : "展开会话"}
                          type="button"
                          onClick={() => toggleProjectExpansion(project.id, isExpanded)}
                        >
                          {isExpanded ? (
                            <ChevronDown aria-hidden="true" size={14} />
                          ) : (
                            <ChevronRight aria-hidden="true" size={14} />
                          )}
                        </button>
                        <button
                          className="project-navigator__project-button"
                          data-located={locateRequest?.kind === "project" && locateRequest.id === project.id}
                          data-navigator-key={`project:${project.id}`}
                          title={project.rootPath}
                          type="button"
                          onClick={() => toggleProjectExpansion(project.id, isExpanded)}
                          onContextMenu={(event) =>
                            openContextMenu(event, { kind: "project", project })
                          }
                        >
                          <span
                            className="project-navigator__folder-icon"
                            aria-hidden="true"
                            style={{
                              "--project-folder-accent-start": folderAccent?.[0],
                              "--project-folder-accent-end": folderAccent?.[1],
                            } as CSSProperties}
                          >
                            {isExpanded ? (
                              <FolderOpen size={16} />
                            ) : (
                              <Folder size={16} />
                            )}
                          </span>
                          <span>{project.name}</span>
                        </button>
                        <div className="project-navigator__project-actions">
                          <button
                            aria-label={`在 ${project.name} 中新建对话`}
                            disabled={isCreatingSession}
                            title="新建对话"
                            type="button"
                            onClick={() => onCreateProjectSession(project.id)}
                          >
                            <SquarePen aria-hidden="true" size={15} />
                          </button>
                          <IconButton label={`更多 ${project.name}`} onClick={(event) => openProjectActionsMenu(event, project)}>
                            <MoreHorizontal aria-hidden="true" size={15} />
                          </IconButton>
                        </div>
                      </div>

                      {isExpanded ? (
                        <div className="project-navigator__sessions">
                          {projectTeamGroups.map((group) => (
                            <TeamInstanceTreeItem
                              activeSessionId={activeSessionId}
                              expanded={
                                normalizedQuery.length > 0
                                || expandedTeamIds.has(group.instance.id)
                              }
                              group={group}
                              key={group.instance.id}
                              onArchive={() =>
                                void onSetTeamInstanceArchived(group.instance.id, true)}
                              onContextMenu={(event) => openContextMenu(event, {
                                instance: group.instance,
                                kind: "team-instance",
                              })}
                              onOpenMember={(agentId, session) =>
                                onOpenTeamMember(group.instance.id, agentId, session)}
                              onToggle={() => toggleTeamExpansion(group.instance.id)}
                            />
                          ))}
                          {visibleSessions.length === 0
                            && projectTeamGroups.length === 0
                            && normalizedQuery.length === 0 ? (
                            <button
                              className="project-navigator__start-session"
                              disabled={isCreatingSession}
                              type="button"
                              onClick={() => onCreateProjectSession(project.id)}
                            >
                              <SquarePen aria-hidden="true" size={14} />
                              <span>开始新会话</span>
                            </button>
                          ) : (
                            visibleSessions.map((session) => (
                              <SessionTreeItem
                                menuOpen={contextMenu?.target.kind === "session" && contextMenu.target.session.id === session.id}
                                key={session.id}
                                active={session.id === activeSessionId}
                                activeSessionId={activeSessionId}
                                located={locateRequest?.kind === "session" && locateRequest.id === session.id}
                                draggable={
                                  sortOption === "custom"
                                  && normalizedQuery.length === 0
                                }
                                dragging={dragItem?.kind === "session" && dragItem.id === session.id}
                                dropPosition={
                                  dropIndicator?.kind === "session" && dropIndicator.id === session.id
                                    ? dropIndicator.position
                                    : null
                                }
                                session={session}
                                teamGroups={teamInstanceGroups.filter((group) =>
                                  group.instance.scope === "conversation"
                                  && group.instance.sourceConversationId === session.id
                                  && teamGroupMatchesQuery(group, normalizedQuery),
                                )}
                                subagentsExpanded={
                                  normalizedQuery.length > 0
                                  || expandedSessionIds.has(session.id)
                                }
                                onArchive={(archived) =>
                                  void onSetSessionArchived(session.id, archived)
                                }
                                onArchiveTeam={(instance) =>
                                  void onSetTeamInstanceArchived(instance.id, true)}
                                onContextMenu={(event) =>
                                  openContextMenu(event, { kind: "session", session })
                                }
                                onDragEnd={finishDrag}
                                onDragOver={(event) => updateDropIndicator(event, {
                                  groupKey: `session:project:${project.id}`,
                                  id: session.id,
                                  kind: "session",
                                })}
                                onDragStart={(event) => startDrag(event, {
                                  groupKey: `session:project:${project.id}`,
                                  id: session.id,
                                  kind: "session",
                                }, ".project-navigator__session-actions")}
                                onDrop={(event) => dropItem(event, {
                                  groupKey: `session:project:${project.id}`,
                                  id: session.id,
                                  kind: "session",
                                }, matchingSessions.map((candidate) => candidate.id))}
                                onPin={(pinned) =>
                                  void onSetSessionPinned(session.id, pinned)
                                }
                                onSelect={onSelectSession}
                                {...(onKeepSession === undefined ? {} : { onKeep: onKeepSession })}
                                onCreateTeam={() => openCreateTeamDialog(
                                  "conversation",
                                  project.id,
                                  session.id,
                                )}
                                onOpenTeamMember={onOpenTeamMember}
                                onOpenTeamMenu={(event, instance) => openContextMenu(event, {
                                  instance,
                                  kind: "team-instance",
                                })}
                                onToggleTeam={(instanceId) => toggleTeamExpansion(instanceId)}
                                expandedTeamIds={expandedTeamIds}
                                onToggleSubagents={() => toggleSessionExpansion(session.id)}
                              />
                            ))
                          )}
                          {hiddenSessionCount > 0 ? (
                            <button
                              type="button"
                              className="project-navigator__start-session"
                              onClick={() => showMoreProjectSessions(project.id, sessionLimit * 2)}
                            >
                              <ChevronDown aria-hidden="true" size={14} />
                              <span>显示更多（还有 {hiddenSessionCount} 条）</span>
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                    </li>
                  );
                })}
                  </ul>
                ) : null}
              </section>
            )}
            {visibleTeamGroups.length > 0 || normalizedQuery.length === 0 ? (
              <section
                className="project-navigator__team-group"
                aria-label="团队"
              >
                <NavigatorGroupHeader
                  action={{
                    disabled: teams.length === 0,
                    icon: <Plus aria-hidden="true" size={15} />,
                    label: teams.length === 0 ? "请先在设置中配置团队模板" : "创建团队",
                    onClick: () => openCreateTeamDialog("global", null, null),
                  }}
                  expanded={isTeamsGroupExpanded}
                  icon={<UsersRound aria-hidden="true" size={15} />}
                  label="团队"
                  onToggle={() => toggleGroup("teams")}
                />
                {isTeamsGroupExpanded ? (
                  <div className="project-navigator__sessions" aria-label="团队列表">
                    {visibleTeamGroups.length === 0 ? (
                      <p className="project-navigator__team-empty">尚未创建团队</p>
                    ) : visibleTeamGroups.map((group) => (
                      <TeamInstanceTreeItem
                        activeSessionId={activeSessionId}
                        draggable={
                          sortOption === "custom"
                          && normalizedQuery.length === 0
                          && visibleTeamGroups.length > 1
                        }
                        dragging={
                          dragItem?.kind === "team-instance"
                          && dragItem.id === group.instance.id
                        }
                        dropPosition={
                          dropIndicator?.kind === "team-instance"
                          && dropIndicator.id === group.instance.id
                            ? dropIndicator.position
                            : null
                        }
                        expanded={
                          normalizedQuery.length > 0 || expandedTeamIds.has(group.instance.id)
                        }
                        group={group}
                        key={group.instance.id}
                        onArchive={() =>
                          void onSetTeamInstanceArchived(group.instance.id, true)}
                        projectName={
                          group.instance.projectId === null
                            ? null
                            : projectNamesById.get(group.instance.projectId) ?? null
                        }
                        onOpenMember={(agentId, session) =>
                          onOpenTeamMember(group.instance.id, agentId, session)
                        }
                        onContextMenu={(event) => openContextMenu(event, {
                          instance: group.instance,
                          kind: "team-instance",
                        })}
                        onDragEnd={finishDrag}
                        onDragOver={(event) => updateDropIndicator(event, {
                          groupKey: "team-instance:primary",
                          id: group.instance.id,
                          kind: "team-instance",
                        })}
                        onDragStart={(event) => startDrag(event, {
                          groupKey: "team-instance:primary",
                          id: group.instance.id,
                          kind: "team-instance",
                        }, ".project-navigator__session-actions")}
                        onDrop={(event) => dropItem(event, {
                          groupKey: "team-instance:primary",
                          id: group.instance.id,
                          kind: "team-instance",
                        }, visibleTeamGroups.map((candidate) => candidate.instance.id))}
                        onToggle={() => toggleTeamExpansion(group.instance.id)}
                      />
                    ))}
                  </div>
                ) : null}
              </section>
            ) : null}
            {visibleTemporarySessions.length > 0 || normalizedQuery.length === 0 ? (
              <section
                className={`project-navigator__temporary${
                  visibleProjects.length > 0 || visibleTeamGroups.length > 0
                    ? " project-navigator__temporary--separated"
                    : ""
                }`}
                aria-label="临时对话"
                data-drop-project={dropProjectId === null || undefined}
                onDragOver={(event) => { updateProjectDrop(event, null); }}
                onDrop={(event) => { moveSessionToProject(event, null); }}
              >
                <NavigatorGroupHeader
                  action={{
                    disabled: isCreatingSession,
                    icon: <SquarePen aria-hidden="true" size={15} />,
                    label: isCreatingSession ? "正在创建临时对话" : "新建临时对话",
                    onClick: onCreateTemporarySession,
                  }}
                  expanded={isTemporaryGroupExpanded}
                  icon={<Clock3 aria-hidden="true" size={15} />}
                  label="临时"
                  onToggle={() => toggleGroup("temporary")}
                />
                {isTemporaryGroupExpanded && visibleTemporarySessions.length > 0 ? (
                  <div className="project-navigator__sessions">
                  {visibleTemporarySessions.map((session) => (
                    <SessionTreeItem
                      menuOpen={contextMenu?.target.kind === "session" && contextMenu.target.session.id === session.id}
                      key={session.id}
                      active={session.id === activeSessionId}
                      activeSessionId={activeSessionId}
                      located={locateRequest?.kind === "session" && locateRequest.id === session.id}
                      draggable={
                        sortOption === "custom"
                        && normalizedQuery.length === 0
                      }
                      dragging={dragItem?.kind === "session" && dragItem.id === session.id}
                      dropPosition={
                        dropIndicator?.kind === "session" && dropIndicator.id === session.id
                          ? dropIndicator.position
                          : null
                      }
                      session={session}
                      subagentsExpanded={
                        normalizedQuery.length > 0 || expandedSessionIds.has(session.id)
                      }
                      onArchive={(archived) => void onSetSessionArchived(session.id, archived)}
                      onContextMenu={(event) => openContextMenu(event, { kind: "session", session })}
                      onDragEnd={finishDrag}
                      onDragOver={(event) => updateDropIndicator(event, {
                        groupKey: "session:temporary",
                        id: session.id,
                        kind: "session",
                      })}
                      onDragStart={(event) => startDrag(event, {
                        groupKey: "session:temporary",
                        id: session.id,
                        kind: "session",
                      }, ".project-navigator__session-actions")}
                      onDrop={(event) => dropItem(event, {
                        groupKey: "session:temporary",
                        id: session.id,
                        kind: "session",
                      }, visibleTemporarySessions.map((candidate) => candidate.id))}
                      onPin={(pinned) => void onSetSessionPinned(session.id, pinned)}
                      onSelect={onSelectSession}
                      {...(onKeepSession === undefined ? {} : { onKeep: onKeepSession })}
                      onToggleSubagents={() => toggleSessionExpansion(session.id)}
                    />
                  ))}
                  </div>
                ) : null}
              </section>
            ) : null}
          </>
        )}
      </div>
      {contextMenu !== null ? createPortal(
        <NavigatorContextMenuView
          menu={contextMenu}
          canCreateTeam={teams.length > 0}
          canOpenDirectory={onOpenProjectDirectory !== undefined}
          onCreateTeam={(target) => {
            setContextMenu(null);
            if (target.kind === "project") openCreateTeamDialog("project", target.project.id, null);
            if (target.kind === "session") openCreateTeamDialog("conversation", target.session.projectId, target.session.id);
          }}
          onProjectPathAction={(project, action) => {
            setContextMenu(null);
            setMenuError(null);
            void Promise.resolve().then(() => action === "copy"
              ? onCopyText(project.rootPath)
              : onOpenProjectDirectory?.(project.id)
            ).catch(() => setMenuError(action === "copy" ? "复制项目路径失败" : "无法打开项目目录，请确认目录存在并在桌面应用中重试"));
          }}
          projectHasRunningSession={contextMenuProjectHasRunningSession}
          onClose={() => setContextMenu(null)}
          onDeleteTeamInstance={(instance) => {
            setContextMenu(null);
            setDialog({ instance, kind: "delete-team-instance" });
          }}
          onDeleteSession={(session) => {
            setContextMenu(null);
            setDialog({ kind: "delete-session", session });
          }}
          onEditTeamInstance={openEditTeamDialog}
          onRemoveProject={(project) => {
            setContextMenu(null);
            setDialog({ kind: "remove-project", project });
          }}
          onRename={openRenameDialog}
          onSetArchived={(session, archived) => {
            setContextMenu(null);
            void onSetSessionArchived(session.id, archived);
          }}
          onSetProjectPinned={(project, pinned) => {
            setContextMenu(null);
            void tree.setProjectPinned(project.id, pinned);
          }}
          onSetProjectTeamsInNavigator={(project, showTeamsInNavigator) => {
            setContextMenu(null);
            void tree.setProjectTeamsInNavigator(project.id, showTeamsInNavigator);
          }}
          onSetPinned={(session, pinned) => {
            setContextMenu(null);
            void onSetSessionPinned(session.id, pinned);
          }}
          onSetTeamInstanceArchived={(instance, archived) => {
            setContextMenu(null);
            void onSetTeamInstanceArchived(instance.id, archived);
          }}
        />,
        nativeOverlayContainer ?? document.body,
      ) : null}
      {dialog !== null ? createPortal(
        <NavigatorManagementDialog
          dialog={dialog}
          draftName={draftName}
          draftProjectId={draftProjectId}
          draftTeamId={draftTeamId}
          isSubmitting={isSubmitting}
          onCancel={() => setDialog(null)}
          onDraftNameChange={setDraftName}
          onDraftProjectIdChange={setDraftProjectId}
          onDraftTeamIdChange={setDraftTeamId}
          onSubmit={() => void submitDialog()}
          teams={teams}
          projects={tree.projects}
        />,
        nativeOverlayContainer ?? document.body,
      ) : null}
    </WorkbenchPanel>
  );
}
