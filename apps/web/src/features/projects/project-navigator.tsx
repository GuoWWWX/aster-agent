import {
  Archive,
  ArchiveRestore,
  ArrowDownAZ,
  ArrowDownUp,
  ArrowDownZA,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clock3,
  Eye,
  EyeOff,
  Folder,
  FolderOpen,
  FolderPlus,
  Folders,
  LoaderCircle,
  MessageSquareText,
  MoreHorizontal,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Scale,
  SquarePen,
  Trash2,
  UsersRound,
  X,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type MouseEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

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
import { IconButton } from "../../components/ui/icon-button.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import {
  groupSubagentSessionsByParent,
  getTeamInstanceNavigatorGroups,
  getProjectSessions,
  getPinnedSessions,
  getTemporarySessions,
  type ProjectSession,
  type TeamInstanceNavigatorGroup,
} from "./project-session-model.js";
import type { ProjectTreeController } from "./use-project-tree.js";
import { AgentAvatar, SubagentAvatar } from "../team/agent-avatar.js";
import "./project-navigator.css";

type ProjectNavigatorProps = {
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
  onReorderTeamInstances: (teamInstanceIds: string[]) => Promise<boolean>;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onSetSessionArchived: (sessionId: string, archived: boolean) => Promise<boolean>;
  onSetSessionPinned: (sessionId: string, pinned: boolean) => Promise<boolean>;
  onSetTeamInstanceArchived: (
    teamInstanceId: string,
    archived: boolean,
  ) => Promise<boolean>;
};

type NavigatorMenuTarget =
  | { kind: "project"; project: ProjectSummary }
  | { kind: "session"; session: ProjectSession }
  | { kind: "team-instance"; instance: TeamInstanceView };

type NavigatorContextMenu = {
  target: NavigatorMenuTarget;
  x: number;
  y: number;
};

type NavigatorDialog =
  | {
      kind: "create-team-instance";
      projectId: string | null;
      scope: TeamInstanceScope;
      sourceConversationId: string | null;
    }
  | { kind: "delete-team-instance"; instance: TeamInstanceView }
  | { kind: "delete-session"; session: ProjectSession }
  | { kind: "edit-team-instance"; instance: TeamInstanceView }
  | { kind: "remove-project"; project: ProjectSummary }
  | { kind: "rename-project"; project: ProjectSummary }
  | { kind: "rename-session"; session: ProjectSession }
  | { kind: "rename-team-instance"; instance: TeamInstanceView };

type NavigatorDragItem = {
  groupKey: string;
  id: string;
  kind: "project" | "session" | "team-instance";
};

type NavigatorDropIndicator = {
  id: string;
  kind: "project" | "session" | "team-instance";
  position: "after" | "before";
};

type NavigatorSortOption = "custom" | "name-ascending" | "name-descending";

const NAVIGATOR_SORT_OPTIONS: readonly {
  label: string;
  value: NavigatorSortOption;
}[] = [
  { label: "自定义顺序", value: "custom" },
  { label: "名称 A-Z", value: "name-ascending" },
  { label: "名称 Z-A", value: "name-descending" },
];

const UNASSOCIATED_PROJECT_SELECT_VALUE = "__unassociated_project__";

const navigatorLabelCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

function sortNavigatorItems<Item>(
  items: readonly Item[],
  option: NavigatorSortOption,
  getLabel: (item: Item) => string,
): Item[] {
  if (option === "custom") return [...items];
  return [...items].sort((left, right) => {
    const comparison = navigatorLabelCollator.compare(getLabel(left), getLabel(right));
    return option === "name-descending" ? -comparison : comparison;
  });
}

function getVisibleSubagents(
  session: ProjectSession,
  subagentsByParent: ReadonlyMap<string, readonly ProjectSession[]>,
  normalizedQuery: string,
): readonly ProjectSession[] {
  const subagents = (subagentsByParent.get(session.id) ?? []).filter(
    (subagent) => subagent.teamId === null,
  );
  if (
    normalizedQuery.length === 0
    || session.title.toLocaleLowerCase().includes(normalizedQuery)
  ) {
    return subagents;
  }
  return subagents.filter((subagent) =>
    subagent.title.toLocaleLowerCase().includes(normalizedQuery),
  );
}

function sessionTreeMatchesQuery(
  session: ProjectSession,
  subagentsByParent: ReadonlyMap<string, readonly ProjectSession[]>,
  normalizedQuery: string,
): boolean {
  return session.title.toLocaleLowerCase().includes(normalizedQuery)
    || getVisibleSubagents(session, subagentsByParent, normalizedQuery).length > 0;
}

function teamGroupMatchesQuery(
  group: TeamInstanceNavigatorGroup,
  normalizedQuery: string,
): boolean {
  if (normalizedQuery.length === 0) return true;
  return group.instance.name.toLocaleLowerCase().includes(normalizedQuery)
    || group.team.name.toLocaleLowerCase().includes(normalizedQuery)
    || group.team.description.toLocaleLowerCase().includes(normalizedQuery)
    || group.members.some(({ profile }) =>
      profile.name.toLocaleLowerCase().includes(normalizedQuery)
      || profile.role.toLocaleLowerCase().includes(normalizedQuery)
      || group.team.memberConfigurations[profile.id]?.role
        .toLocaleLowerCase().includes(normalizedQuery) === true
    );
}

function NavigatorSortIcon({ option }: { option: NavigatorSortOption }): ReactElement {
  if (option === "name-ascending") return <ArrowDownAZ aria-hidden="true" size={15} />;
  if (option === "name-descending") return <ArrowDownZA aria-hidden="true" size={15} />;
  return <ArrowDownUp aria-hidden="true" size={15} />;
}

function reorderIdentifiers(
  identifiers: readonly string[],
  sourceId: string,
  targetId: string,
  position: "after" | "before",
): string[] {
  const reordered = identifiers.filter((identifier) => identifier !== sourceId);
  const targetIndex = reordered.indexOf(targetId);
  if (targetIndex < 0) return [...identifiers];
  reordered.splice(position === "before" ? targetIndex : targetIndex + 1, 0, sourceId);
  return reordered;
}

function setDragPreview(event: DragEvent<HTMLElement>): void {
  const bounds = event.currentTarget.getBoundingClientRect();
  const preview = event.currentTarget.cloneNode(true) as HTMLElement;
  preview.classList.add("project-navigator__drag-preview");
  preview.style.width = `${bounds.width}px`;
  preview.style.height = `${bounds.height}px`;
  document.body.append(preview);
  event.dataTransfer.setDragImage(
    preview,
    Math.max(0, event.clientX - bounds.left),
    Math.max(0, event.clientY - bounds.top),
  );
  window.setTimeout(() => preview.remove(), 0);
}

export type ProjectNavigatorLocateRequest = {
  id: string;
  kind: "project" | "session";
  requestId: number;
};

export function ProjectNavigator({
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
  onReorderTeamInstances,
  onSelectProject,
  onSelectSession,
  onSetSessionArchived,
  onSetSessionPinned,
  onSetTeamInstanceArchived,
}: ProjectNavigatorProps): ReactElement {
  const activeProjectId = tree.activeProject?.id ?? null;
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [expandedSessionIds, setExpandedSessionIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [isProjectsGroupExpanded, setIsProjectsGroupExpanded] = useState(true);
  const [isTeamsGroupExpanded, setIsTeamsGroupExpanded] = useState(true);
  const [isPinnedGroupExpanded, setIsPinnedGroupExpanded] = useState(true);
  const [isTemporaryGroupExpanded, setIsTemporaryGroupExpanded] = useState(true);
  const [expandedTeamIds, setExpandedTeamIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [query, setQuery] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortOption, setSortOption] = useState<NavigatorSortOption>("custom");
  const [contextMenu, setContextMenu] = useState<NavigatorContextMenu | null>(null);
  const [dialog, setDialog] = useState<NavigatorDialog | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftProjectId, setDraftProjectId] = useState("");
  const [draftTeamId, setDraftTeamId] = useState(teams[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragItem, setDragItem] = useState<NavigatorDragItem | null>(null);
  const [dropIndicator, setDropIndicator] = useState<NavigatorDropIndicator | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const sortLabel = NAVIGATOR_SORT_OPTIONS.find(
    (option) => option.value === sortOption,
  )?.label ?? "自定义顺序";
  const projectNamesById = useMemo(
    () => new Map(tree.projects.map((project) => [project.id, project.name])),
    [tree.projects],
  );

  function startDrag(
    event: DragEvent<HTMLElement>,
    item: NavigatorDragItem,
    actionsSelector: string,
  ): void {
    if (
      normalizedQuery.length > 0
      || (event.target as Element).closest(actionsSelector) !== null
    ) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${item.kind}:${item.id}`);
    setDragPreview(event);
    setDragItem(item);
    setDropIndicator(null);
  }

  function updateDropIndicator(
    event: DragEvent<HTMLElement>,
    target: NavigatorDragItem,
  ): void {
    if (
      dragItem === null
      || dragItem.kind !== target.kind
      || dragItem.groupKey !== target.groupKey
      || dragItem.id === target.id
    ) {
      setDropIndicator(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropIndicator({
      id: target.id,
      kind: target.kind,
      position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    });
  }

  function finishDrag(): void {
    setDragItem(null);
    setDropIndicator(null);
  }

  function dropItem(
    event: DragEvent<HTMLElement>,
    target: NavigatorDragItem,
    groupIds: readonly string[],
  ): void {
    event.preventDefault();
    if (
      dragItem === null
      || dropIndicator === null
      || dragItem.kind !== target.kind
      || dragItem.groupKey !== target.groupKey
    ) {
      finishDrag();
      return;
    }
    const reordered = reorderIdentifiers(
      groupIds,
      dragItem.id,
      target.id,
      dropIndicator.position,
    );
    finishDrag();
    if (reordered.every((identifier, index) => identifier === groupIds[index])) return;
    if (target.kind === "project") {
      void tree.reorderProjects(reordered);
    } else if (target.kind === "session") {
      void onReorderSessions(reordered);
    } else {
      void onReorderTeamInstances(reordered);
    }
  }

  useEffect(() => {
    if (locateRequest === null) return undefined;

    const locatedSession = locateRequest.kind === "session"
      ? sessions.find((session) => session.id === locateRequest.id)
      : undefined;
    const locatedProjectId =
      locateRequest.kind === "project"
        ? locateRequest.id
        : locatedSession?.projectId ?? null;

    const targetKey = `${locateRequest.kind}:${locateRequest.id}`;
    let secondFrame = 0;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (locatedSession?.isPinned === true) {
        setIsPinnedGroupExpanded(true);
      } else if (locatedSession?.projectId === null) {
        setIsTemporaryGroupExpanded(true);
      } else if (locatedProjectId !== null) {
        setIsProjectsGroupExpanded(true);
        setExpandedProjectIds((current) => new Set(current).add(locatedProjectId));
        setCollapsedProjectIds((current) => {
          const next = new Set(current);
          next.delete(locatedProjectId);
          return next;
        });
      }
      const locatedParentId = locatedSession?.parentConversationId ?? null;
      if (locatedParentId !== null) {
        setExpandedSessionIds((current) =>
          new Set(current).add(locatedParentId),
        );
      } else if (locatedSession?.threadKind === "team_lead") {
        setExpandedSessionIds((current) =>
          new Set(current).add(locatedSession.id),
        );
      }
    });
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const target = Array.from(
          bodyRef.current?.querySelectorAll<HTMLElement>("[data-navigator-key]") ?? [],
        ).find((element) => element.dataset.navigatorKey === targetKey);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [locateRequest, sessions]);

  const toggleProjectExpansion = (projectId: string, isExpanded: boolean) => {
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (isExpanded) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (isExpanded) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }
      return next;
    });
  };

  function isProjectExpanded(projectId: string): boolean {
    return expandedProjectIds.has(projectId)
      || (projectId === activeProjectId && !collapsedProjectIds.has(projectId));
  }

  const subagentSessionsByParent = useMemo(
    () => groupSubagentSessionsByParent(sessions, teamWorkItems),
    [sessions, teamWorkItems],
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

  function toggleSessionExpansion(sessionId: string): void {
    setExpandedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  const visiblePinnedSessions = useMemo(
    () =>
      sortNavigatorItems(
        getPinnedSessions(sessions).filter((session) =>
          sessionTreeMatchesQuery(session, subagentSessionsByParent, normalizedQuery),
        ),
        sortOption,
        (session) => session.title,
      ),
    [normalizedQuery, sessions, sortOption, subagentSessionsByParent],
  );
  const visibleTemporarySessions = useMemo(
    () =>
      sortNavigatorItems(
        getTemporarySessions(sessions).filter(
          (session) =>
            !session.isPinned &&
            sessionTreeMatchesQuery(session, subagentSessionsByParent, normalizedQuery),
        ),
        sortOption,
        (session) => session.title,
      ),
    [normalizedQuery, sessions, sortOption, subagentSessionsByParent],
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
                subagentSessionsByParent,
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
    [normalizedQuery, sessions, sortOption, subagentSessionsByParent, teamInstanceGroups, tree.projects],
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
    setContextMenu({
      target,
      x: Math.max(8, Math.min(event.clientX, window.innerWidth - 196)),
      y: Math.max(8, Math.min(event.clientY, window.innerHeight - 216)),
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
      y: Math.max(8, Math.min(bounds.bottom + 4, window.innerHeight - 216)),
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
                <LoaderCircle
                  aria-hidden="true"
                  className="project-navigator__spin"
                  size={16}
                />
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
              if (allNavigatorGroupsCollapsed) {
                setIsProjectsGroupExpanded(true);
                setIsTeamsGroupExpanded(true);
                setExpandedProjectIds(new Set(tree.projects.map((project) => project.id)));
                setExpandedSessionIds(new Set(subagentSessionsByParent.keys()));
                setExpandedTeamIds(new Set(teamInstanceGroups.map((group) => group.instance.id)));
                setCollapsedProjectIds(new Set());
                setIsPinnedGroupExpanded(true);
                setIsTemporaryGroupExpanded(true);
              } else {
                setIsProjectsGroupExpanded(false);
                setIsTeamsGroupExpanded(false);
                setExpandedProjectIds(new Set());
                setExpandedSessionIds(new Set());
                setExpandedTeamIds(new Set());
                setCollapsedProjectIds(new Set(tree.projects.map((project) => project.id)));
                setIsPinnedGroupExpanded(false);
                setIsTemporaryGroupExpanded(false);
              }
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
        <Search aria-hidden="true" size={14} />
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

        {tree.operationError ?? operationError ? (
          <div className="project-navigator__notice" role="status">
            <span>{tree.operationError ?? operationError}</span>
            <button
              type="button"
              onClick={() => {
                tree.clearOperationError();
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
                  onToggle={() => setIsPinnedGroupExpanded((current) => !current)}
                />
                {isPinnedGroupExpanded ? (
                  <div className="project-navigator__sessions">
                  {visiblePinnedSessions.map((session) => (
                    <SessionTreeItem
                      key={session.id}
                      active={session.id === activeSessionId}
                      activeSessionId={activeSessionId}
                      locatedSessionId={
                        locateRequest?.kind === "session" ? locateRequest.id : null
                      }
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
                      subagents={getVisibleSubagents(
                        session,
                        subagentSessionsByParent,
                        normalizedQuery,
                      )}
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
                      <LoaderCircle
                        aria-hidden="true"
                        className="project-navigator__spin"
                        size={15}
                      />
                    ) : (
                      <Plus aria-hidden="true" size={15} />
                    ),
                    label: tree.isAddingProject ? "正在打开项目" : "打开或添加项目",
                    onClick: () => void tree.addProject(),
                  }}
                  expanded={isProjectsGroupExpanded}
                  icon={<Folders aria-hidden="true" size={15} />}
                  label="项目"
                  onToggle={() => setIsProjectsGroupExpanded((current) => !current)}
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
                  const visibleSessions =
                    normalizedQuery.length === 0
                      ? projectSessions
                      : projectSessions.filter((session) =>
                          sessionTreeMatchesQuery(
                            session,
                            subagentSessionsByParent,
                            normalizedQuery,
                          ),
                        );
                  const isExpanded =
                    isProjectExpanded(project.id);
                  const projectGroupKey = `project:${project.isPinned === true ? "pinned" : "regular"}`;
                  const projectGroupIds = visibleProjects
                    .filter((candidate) => candidate.isPinned === project.isPinned)
                    .map((candidate) => candidate.id);

                  return (
                    <li
                      key={project.id}
                      className="project-navigator__project"
                      data-pinned={project.isPinned === true}
                    >
                      <div
                        className="project-navigator__project-row"
                        data-dragging={dragItem?.kind === "project" && dragItem.id === project.id}
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
                        onDragOver={(event) => updateDropIndicator(event, {
                          groupKey: projectGroupKey,
                          id: project.id,
                          kind: "project",
                        })}
                        onDragStart={(event) => startDrag(event, {
                          groupKey: projectGroupKey,
                          id: project.id,
                          kind: "project",
                        }, ".project-navigator__project-actions")}
                        onDrop={(event) => dropItem(event, {
                          groupKey: projectGroupKey,
                          id: project.id,
                          kind: "project",
                        }, projectGroupIds)}
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
                          onClick={() => {
                            toggleProjectExpansion(project.id, isExpanded);
                            onSelectProject(project.id);
                          }}
                          onContextMenu={(event) =>
                            openContextMenu(event, { kind: "project", project })
                          }
                        >
                          {isExpanded ? (
                            <FolderOpen aria-hidden="true" size={16} />
                          ) : (
                            <Folder aria-hidden="true" size={16} />
                          )}
                          <span>{project.name}</span>
                        </button>
                        <div className="project-navigator__project-actions">
                          <button
                            aria-label={`更多 ${project.name}`}
                            title="更多"
                            type="button"
                            onClick={(event) => openProjectActionsMenu(event, project)}
                          >
                            <MoreHorizontal aria-hidden="true" size={15} />
                          </button>
                          <button
                            aria-label={`在 ${project.name} 中创建团队`}
                            disabled={teams.length === 0}
                            title={teams.length === 0 ? "请先在设置中配置团队模板" : "创建项目团队"}
                            type="button"
                            onClick={() => openCreateTeamDialog("project", project.id, null)}
                          >
                            <UsersRound aria-hidden="true" size={15} />
                          </button>
                          <button
                            aria-label={`在 ${project.name} 中新建对话`}
                            disabled={isCreatingSession}
                            title="新建对话"
                            type="button"
                            onClick={() => onCreateProjectSession(project.id)}
                          >
                            <SquarePen aria-hidden="true" size={15} />
                          </button>
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
                              onContextMenu={(event) => openContextMenu(event, {
                                instance: group.instance,
                                kind: "team-instance",
                              })}
                              onOpenMember={(agentId, session) =>
                                onOpenTeamMember(group.instance.id, agentId, session)}
                              onToggle={() => setExpandedTeamIds((current) => {
                                const next = new Set(current);
                                if (next.has(group.instance.id)) next.delete(group.instance.id);
                                else next.add(group.instance.id);
                                return next;
                              })}
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
                                key={session.id}
                                active={session.id === activeSessionId}
                                activeSessionId={activeSessionId}
                                locatedSessionId={
                                  locateRequest?.kind === "session" ? locateRequest.id : null
                                }
                                located={locateRequest?.kind === "session" && locateRequest.id === session.id}
                                draggable={
                                  sortOption === "custom"
                                  && normalizedQuery.length === 0
                                  && visibleSessions.length > 1
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
                                subagents={getVisibleSubagents(
                                  session,
                                  subagentSessionsByParent,
                                  normalizedQuery,
                                )}
                                subagentsExpanded={
                                  normalizedQuery.length > 0
                                  || expandedSessionIds.has(session.id)
                                }
                                onArchive={(archived) =>
                                  void onSetSessionArchived(session.id, archived)
                                }
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
                                }, visibleSessions.map((candidate) => candidate.id))}
                                onPin={(pinned) =>
                                  void onSetSessionPinned(session.id, pinned)
                                }
                                onSelect={onSelectSession}
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
                                onToggleTeam={(instanceId) => setExpandedTeamIds((current) => {
                                  const next = new Set(current);
                                  if (next.has(instanceId)) next.delete(instanceId);
                                  else next.add(instanceId);
                                  return next;
                                })}
                                expandedTeamIds={expandedTeamIds}
                                onToggleSubagents={() => toggleSessionExpansion(session.id)}
                              />
                            ))
                          )}
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
                  onToggle={() => setIsTeamsGroupExpanded((current) => !current)}
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
                        onToggle={() => setExpandedTeamIds((current) => {
                          const next = new Set(current);
                          if (next.has(group.instance.id)) next.delete(group.instance.id);
                          else next.add(group.instance.id);
                          return next;
                        })}
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
                  onToggle={() => setIsTemporaryGroupExpanded((current) => !current)}
                />
                {isTemporaryGroupExpanded && visibleTemporarySessions.length > 0 ? (
                  <div className="project-navigator__sessions">
                  {visibleTemporarySessions.map((session) => (
                    <SessionTreeItem
                      key={session.id}
                      active={session.id === activeSessionId}
                      activeSessionId={activeSessionId}
                      locatedSessionId={
                        locateRequest?.kind === "session" ? locateRequest.id : null
                      }
                      located={locateRequest?.kind === "session" && locateRequest.id === session.id}
                      draggable={
                        sortOption === "custom"
                        && normalizedQuery.length === 0
                        && visibleTemporarySessions.length > 1
                      }
                      dragging={dragItem?.kind === "session" && dragItem.id === session.id}
                      dropPosition={
                        dropIndicator?.kind === "session" && dropIndicator.id === session.id
                          ? dropIndicator.position
                          : null
                      }
                      session={session}
                      subagents={getVisibleSubagents(
                        session,
                        subagentSessionsByParent,
                        normalizedQuery,
                      )}
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
        document.body,
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
        document.body,
      ) : null}
    </WorkbenchPanel>
  );
}

function NavigatorGroupHeader({
  action,
  expanded,
  icon,
  label,
  onToggle,
}: {
  action?: {
    disabled?: boolean;
    icon: ReactElement;
    label: string;
    onClick: () => void;
  };
  expanded: boolean;
  icon: ReactElement;
  label: string;
  onToggle: () => void;
}): ReactElement {
  return (
    <div className="project-navigator__project-row">
      <button
        aria-expanded={expanded}
        aria-label={expanded ? `收起 ${label}` : `展开 ${label}`}
        className="project-navigator__project-button project-navigator__group-button"
        title={expanded ? "收起对话" : "展开对话"}
        type="button"
        onClick={onToggle}
      >
        {icon}
        <span>{label}</span>
        {expanded ? (
          <ChevronDown
            aria-hidden="true"
            className="project-navigator__group-chevron"
            size={14}
          />
        ) : (
          <ChevronRight
            aria-hidden="true"
            className="project-navigator__group-chevron"
            size={14}
          />
        )}
      </button>
      {action === undefined ? null : (
        <div className="project-navigator__project-actions">
          <button
            aria-label={action.label}
            disabled={action.disabled}
            title={action.label}
            type="button"
            onClick={action.onClick}
          >
            {action.icon}
          </button>
        </div>
      )}
    </div>
  );
}

function TeamInstanceTreeItem({
  activeSessionId,
  draggable,
  dragging,
  dropPosition,
  expanded,
  group,
  onContextMenu,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onOpenMember,
  onToggle,
  projectName = null,
}: {
  activeSessionId: string | null;
  draggable?: boolean;
  dragging?: boolean;
  dropPosition?: "after" | "before" | null;
  expanded: boolean;
  group: TeamInstanceNavigatorGroup;
  onContextMenu: (event: MouseEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onOpenMember: (agentId: string, session: ProjectSession | null) => void;
  onToggle: () => void;
  projectName?: string | null;
}): ReactElement {
  const runningMemberCount = group.members.filter(({ session }) =>
    session !== null && isSessionRunning(session),
  ).length;
  return (
    <div className="project-navigator__session-branch">
      <div
        className="project-navigator__session-branch-row"
        data-dragging={dragging === true}
        data-drop-position={dropPosition ?? undefined}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <button
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"} ${group.instance.name}`}
          className="project-navigator__session-toggle"
          type="button"
          onClick={onToggle}
        >
          {expanded ? <ChevronDown aria-hidden="true" size={13} /> : <ChevronRight aria-hidden="true" size={13} />}
        </button>
        <div className="project-navigator__session-shell">
          <button
            aria-expanded={expanded}
            aria-label={`${expanded ? "收起" : "展开"} ${group.instance.name}`}
            className="project-navigator__session project-navigator__team-instance-session"
            data-enabled={group.team.enabled}
            draggable={draggable === true}
            title={`${group.instance.name}${projectName === null ? "" : ` · ${projectName}`} · ${group.team.name}`}
            type="button"
            onClick={onToggle}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
          >
            <UsersRound aria-hidden="true" size={14} />
            <span className="project-navigator__session-title">
              {group.instance.name}{projectName === null ? "" : ` · ${projectName}`}
            </span>
            <span className="project-navigator__subagent-count" data-running={runningMemberCount > 0}>
              {group.members.length}
            </span>
          </button>
          <div className="project-navigator__session-actions">
            <button aria-label={`更多 ${group.instance.name}`} title="更多" type="button" onClick={(event) => {
              event.stopPropagation();
              onContextMenu(event);
            }}>
              <MoreHorizontal aria-hidden="true" size={13} />
            </button>
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="project-navigator__subagents project-navigator__team-members">
          {group.members.length === 0 ? (
            <p className="project-navigator__team-empty">
              {group.instance.scope === "conversation" ? "尚未启用成员" : "暂无成员"}
            </p>
          ) : group.members.map(({ profile, session }) => {
            const configuredRole = group.team.memberConfigurations[profile.id]?.role.trim();
            const role = configuredRole === undefined || configuredRole.length === 0
              ? profile.role
              : configuredRole;
            return (
              <button
                aria-current={session?.id === activeSessionId ? "page" : undefined}
                aria-label={`打开 ${profile.name} 的团队对话`}
                className="project-navigator__team-member"
                data-active={session?.id === activeSessionId}
                data-navigator-key={session === null ? undefined : `session:${session.id}`}
                key={profile.id}
                title={`打开 ${profile.name} 的团队对话`}
                type="button"
                onClick={() => onOpenMember(profile.id, session)}
              >
                <AgentAvatar avatar={profile.avatar} size="compact" status={profile.status} />
                <span className="project-navigator__team-member-copy">
                  <span className="project-navigator__team-member-name">{profile.name}</span>
                  <span className="project-navigator__team-member-role">
                    {profile.id === group.team.leadAgentId ? `负责人 · ${role}` : role}
                  </span>
                </span>
                {session === null ? null : <SessionStatusIndicator session={session} />}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

type SessionButtonProps = {
  active: boolean;
  archived?: boolean;
  draggable: boolean;
  dragging: boolean;
  dropPosition: "after" | "before" | null;
  located: boolean;
  session: ProjectSession;
  onArchive: (archived: boolean) => void;
  onContextMenu: (event: MouseEvent) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPin: (pinned: boolean) => void;
  onSelect: (sessionId: string) => void;
};

function isSessionRunning(session: ProjectSession): boolean {
  return (session.activeSideConversationCount ?? 0) > 0
    || (session.activeSubagentCount ?? 0) > 0
    || session.activeRunId !== null;
}

function hasUnreadSessionResult(session: ProjectSession): boolean {
  return session.hasUnreadSideConversationResult === true
    || (session.hasUnreadResult
      && (session.lastRunStatus === "completed" || session.lastRunStatus === "failed"));
}

function hasFailedUnreadSessionResult(session: ProjectSession): boolean {
  return session.hasFailedUnreadSideConversationResult === true
    || (session.hasUnreadResult && session.lastRunStatus === "failed");
}

function sessionStatusLabel(session: ProjectSession): string | null {
  if (isSessionRunning(session)) return "正在运行";
  if (!hasUnreadSessionResult(session)) return null;
  return hasFailedUnreadSessionResult(session) ? "上次运行失败" : "上次运行完成";
}

function SessionStatusIndicator({ session }: { session: ProjectSession }): ReactElement | null {
  if (isSessionRunning(session)) {
    return (
      <LoaderCircle
        aria-label="正在运行"
        className="project-navigator__session-status project-navigator__session-status--running project-navigator__spin"
        size={14}
      />
    );
  }
  if (hasFailedUnreadSessionResult(session)) {
    return (
      <span
        aria-label="上次运行失败"
        className="project-navigator__session-status project-navigator__session-status--failed"
        role="img"
      />
    );
  }
  if (hasUnreadSessionResult(session)) {
    return (
      <span
        aria-label="上次运行完成"
        className="project-navigator__session-status project-navigator__session-status--completed"
        role="img"
      />
    );
  }
  return null;
}

function SessionTreeItem({
  activeSessionId,
  expandedTeamIds = new Set<string>(),
  locatedSessionId,
  subagents,
  subagentsExpanded,
  teamGroups = [],
  onCreateTeam,
  onOpenTeamMember,
  onOpenTeamMenu,
  onToggleTeam,
  onToggleSubagents,
  ...buttonProps
}: SessionButtonProps & {
  activeSessionId: string | null;
  expandedTeamIds?: ReadonlySet<string>;
  locatedSessionId: string | null;
  subagents: readonly ProjectSession[];
  subagentsExpanded: boolean;
  teamGroups?: readonly TeamInstanceNavigatorGroup[];
  onCreateTeam?: () => void;
  onOpenTeamMember?: (
    teamInstanceId: string,
    agentId: string,
    session: ProjectSession | null,
  ) => void;
  onOpenTeamMenu?: (event: MouseEvent, instance: TeamInstanceView) => void;
  onToggleTeam?: (instanceId: string) => void;
  onToggleSubagents: () => void;
}): ReactElement {
  const runningSubagentCount = subagents.filter(isSessionRunning).length;
  const hasExpandableContent = subagents.length > 0
    || teamGroups.length > 0;
  return (
    <div className="project-navigator__session-branch">
      <div className="project-navigator__session-branch-row">
        {hasExpandableContent ? (
          <button
            aria-expanded={subagentsExpanded}
            aria-label={`${subagentsExpanded ? "收起" : "展开"} ${buttonProps.session.title} 的协作成员`}
            className="project-navigator__session-toggle"
            title={`${subagents.length} 个协作成员，${teamGroups.length} 个对话团队${runningSubagentCount > 0 ? `，${runningSubagentCount} 个正在运行` : ""}`}
            type="button"
            onClick={onToggleSubagents}
          >
            {subagentsExpanded ? (
              <ChevronDown aria-hidden="true" size={13} />
            ) : (
              <ChevronRight aria-hidden="true" size={13} />
            )}
          </button>
        ) : (
          <span aria-hidden="true" className="project-navigator__session-toggle-spacer" />
        )}
        <SessionButton
          {...buttonProps}
          {...(onCreateTeam === undefined ? {} : { onCreateTeam })}
          runningSubagentCount={runningSubagentCount}
          subagentCount={subagents.length}
        />
      </div>
      {subagentsExpanded && hasExpandableContent ? (
        <div className="project-navigator__subagents" role="group" aria-label="协作成员与对话团队">
          {onCreateTeam === undefined
            || onOpenTeamMember === undefined
            || onOpenTeamMenu === undefined
            || onToggleTeam === undefined
            ? null
            : (
              <>
                {teamGroups.map((group) => (
                  <TeamInstanceTreeItem
                    activeSessionId={activeSessionId}
                    expanded={expandedTeamIds.has(group.instance.id)}
                    group={group}
                    key={group.instance.id}
                    onContextMenu={(event) => onOpenTeamMenu(event, group.instance)}
                    onOpenMember={(agentId, session) =>
                      onOpenTeamMember(group.instance.id, agentId, session)}
                    onToggle={() => onToggleTeam(group.instance.id)}
                  />
                ))}
              </>
            )}
          {subagents.map((subagent) => (
              <SubagentSessionButton
                active={subagent.id === activeSessionId}
                key={subagent.id}
                located={locatedSessionId === subagent.id}
                session={subagent}
                onSelect={buttonProps.onSelect}
              />
            ))}
        </div>
      ) : null}
    </div>
  );
}

function SubagentSessionButton({
  active,
  located,
  session,
  onSelect,
}: {
  active: boolean;
  located: boolean;
  session: ProjectSession;
  onSelect: (sessionId: string) => void;
}): ReactElement {
  const statusLabel = sessionStatusLabel(session);
  return (
    <button
      aria-current={active ? "page" : undefined}
      className="project-navigator__session project-navigator__session--subagent"
      data-active={active}
      data-located={located}
      data-navigator-key={`session:${session.id}`}
      data-run-status={session.lastRunStatus ?? "idle"}
      title={statusLabel === null ? session.title : `${session.title} · ${statusLabel}`}
      type="button"
      onClick={() => onSelect(session.id)}
    >
      {session.threadKind === "team_lead" ? (
        <Scale aria-label="Team Lead 对话" size={14} />
      ) : (
        <SubagentAvatar
          icon={session.avatarIcon}
          seed={session.id}
          size="compact"
          status={isSessionRunning(session) ? "running" : "standby"}
        />
      )}
      <span className="project-navigator__session-title">{session.title}</span>
      <SessionStatusIndicator session={session} />
    </button>
  );
}

function SessionButton({
  active,
  archived = false,
  draggable,
  dragging,
  dropPosition,
  located,
  session,
  runningSubagentCount,
  subagentCount,
  onArchive,
  onContextMenu,
  onCreateTeam,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onPin,
  onSelect,
}: SessionButtonProps & {
  runningSubagentCount: number;
  subagentCount: number;
  onCreateTeam?: () => void;
}): ReactElement {
  const isRunning = isSessionRunning(session);
  const isManagedTeamWorkItemConversation = session.teamWorkItemId !== null
    && session.teamWorkItemId !== undefined;
  const statusLabel = sessionStatusLabel(session);

  return (
    <div
      className="project-navigator__session-shell"
      data-dragging={dragging}
      data-drop-position={dropPosition ?? undefined}
      data-pinned={session.isPinned}
      draggable={draggable}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onDrop={onDrop}
    >
      <button
        aria-current={active ? "page" : undefined}
        className="project-navigator__session"
        data-active={active}
        data-located={located}
        data-navigator-key={`session:${session.id}`}
        data-run-status={session.lastRunStatus ?? "idle"}
        title={statusLabel === null ? session.title : `${session.title} · ${statusLabel}`}
        type="button"
        onClick={() => onSelect(session.id)}
        onContextMenu={onContextMenu}
      >
        {session.threadKind === "team_lead" ? (
          <Scale aria-label="Team Lead 对话" size={14} />
        ) : (
          <MessageSquareText aria-hidden="true" size={14} />
        )}
        <span className="project-navigator__session-title">{session.title}</span>
        {subagentCount > 0 ? (
          <span
            className="project-navigator__subagent-count"
            data-running={runningSubagentCount > 0}
            title={`${subagentCount} 个协作成员`}
          >
            <Bot aria-hidden="true" size={11} />
            {subagentCount}
          </span>
        ) : null}
        <SessionStatusIndicator session={session} />
      </button>
      <div className="project-navigator__session-actions">
        {onCreateTeam === undefined ? null : (
          <button
            aria-label={`在 ${session.title} 中创建对话团队`}
            title="创建对话团队"
            type="button"
            onClick={onCreateTeam}
          >
            <UsersRound aria-hidden="true" size={13} />
          </button>
        )}
        <button
          aria-label={`${session.isPinned ? "取消置顶" : "置顶"} ${session.title}`}
          title={session.isPinned ? "取消置顶" : "置顶"}
          type="button"
          onClick={() => onPin(!session.isPinned)}
        >
          {session.isPinned ? (
            <PinOff aria-hidden="true" size={13} />
          ) : (
            <Pin aria-hidden="true" size={13} />
          )}
        </button>
        <button
          aria-label={`${archived ? "取消归档" : "归档"} ${session.title}`}
          disabled={isRunning || (isManagedTeamWorkItemConversation && !archived)}
          title={isManagedTeamWorkItemConversation && !archived
            ? "团队执行对话由 WorkItem 生命周期保留"
            : isRunning ? "运行中的对话不能归档" : archived ? "取消归档" : "归档"}
          type="button"
          onClick={() => onArchive(!archived)}
        >
          {archived ? (
            <ArchiveRestore aria-hidden="true" size={13} />
          ) : (
            <Archive aria-hidden="true" size={13} />
          )}
        </button>
      </div>
    </div>
  );
}

function NavigatorContextMenuView({
  menu,
  projectHasRunningSession,
  onClose,
  onDeleteSession,
  onDeleteTeamInstance,
  onEditTeamInstance,
  onRemoveProject,
  onRename,
  onSetArchived,
  onSetPinned,
  onSetProjectPinned,
  onSetProjectTeamsInNavigator,
  onSetTeamInstanceArchived,
}: {
  menu: NavigatorContextMenu;
  projectHasRunningSession: boolean;
  onClose: () => void;
  onDeleteSession: (session: ProjectSession) => void;
  onDeleteTeamInstance: (instance: TeamInstanceView) => void;
  onEditTeamInstance: (instance: TeamInstanceView) => void;
  onRemoveProject: (project: ProjectSummary) => void;
  onRename: (target: NavigatorMenuTarget) => void;
  onSetArchived: (session: ProjectSession, archived: boolean) => void;
  onSetPinned: (session: ProjectSession, pinned: boolean) => void;
  onSetProjectPinned: (project: ProjectSummary, pinned: boolean) => void;
  onSetProjectTeamsInNavigator: (
    project: ProjectSummary,
    showTeamsInNavigator: boolean,
  ) => void;
  onSetTeamInstanceArchived: (instance: TeamInstanceView, archived: boolean) => void;
}): ReactElement {
  const target = menu.target;
  const sessionIsRunning = target.kind === "session" && (
    isSessionRunning(target.session)
  );
  const sessionIsManagedTeamWorkItem = target.kind === "session"
    && target.session.teamWorkItemId !== null
    && target.session.teamWorkItemId !== undefined
    && !target.session.isArchived;

  return (
    <>
      <div
        aria-hidden="true"
        className="project-navigator__context-menu-backdrop"
        onMouseDown={onClose}
      />
      <div
        className="project-navigator__context-menu"
        role="menu"
        style={{ left: menu.x, top: menu.y }}
      >
        {target.kind === "team-instance" ? (
          <>
            <button role="menuitem" type="button" onClick={() => onRename(target)}>
              <Pencil aria-hidden="true" size={15} />
              重命名团队
            </button>
            <button
              disabled={target.instance.scope === "conversation"}
              role="menuitem"
              title={target.instance.scope === "conversation"
                ? "对话团队保留原对话的项目归属"
                : undefined}
              type="button"
              onClick={() => onEditTeamInstance(target.instance)}
            >
              <Settings2 aria-hidden="true" size={15} />
              编辑团队
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => onSetTeamInstanceArchived(target.instance, true)}
            >
              <Archive aria-hidden="true" size={15} />
              归档团队
            </button>
            <div className="project-navigator__context-menu-separator" role="separator" />
            <button
              className="project-navigator__context-menu-danger"
              role="menuitem"
              type="button"
              onClick={() => onDeleteTeamInstance(target.instance)}
            >
              <Trash2 aria-hidden="true" size={15} />
              删除团队
            </button>
          </>
        ) : target.kind === "session" ? (
          <>
            <button role="menuitem" type="button" onClick={() => onRename(target)}>
              <Pencil aria-hidden="true" size={15} />
              重命名
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => onSetPinned(target.session, !target.session.isPinned)}
            >
              {target.session.isPinned ? (
                <PinOff aria-hidden="true" size={15} />
              ) : (
                <Pin aria-hidden="true" size={15} />
              )}
              {target.session.isPinned ? "取消置顶" : "置顶"}
            </button>
            <button
              disabled={sessionIsRunning || sessionIsManagedTeamWorkItem}
              role="menuitem"
              title={sessionIsManagedTeamWorkItem
                ? "团队执行对话由 WorkItem 生命周期保留"
                : sessionIsRunning ? "运行中的对话不能归档" : undefined}
              type="button"
              onClick={() =>
                onSetArchived(target.session, !target.session.isArchived)
              }
            >
              {target.session.isArchived ? (
                <ArchiveRestore aria-hidden="true" size={15} />
              ) : (
                <Archive aria-hidden="true" size={15} />
              )}
              {target.session.isArchived ? "取消归档" : "归档"}
            </button>
            <div className="project-navigator__context-menu-separator" role="separator" />
            <button
              className="project-navigator__context-menu-danger"
              disabled={sessionIsRunning || sessionIsManagedTeamWorkItem}
              role="menuitem"
              title={sessionIsManagedTeamWorkItem
                ? "团队执行对话由 WorkItem 生命周期保留"
                : sessionIsRunning ? "运行中的对话不能删除" : undefined}
              type="button"
              onClick={() => onDeleteSession(target.session)}
            >
              <Trash2 aria-hidden="true" size={15} />
              删除对话
            </button>
          </>
        ) : (
          <>
            <button
              role="menuitem"
              type="button"
              onClick={() => onSetProjectPinned(target.project, target.project.isPinned !== true)}
            >
              {target.project.isPinned === true ? (
                <PinOff aria-hidden="true" size={15} />
              ) : (
                <Pin aria-hidden="true" size={15} />
              )}
              {target.project.isPinned === true ? "取消置顶项目" : "置顶项目"}
            </button>
            <button role="menuitem" type="button" onClick={() => onRename(target)}>
              <Pencil aria-hidden="true" size={15} />
              重命名
            </button>
            <button
              aria-checked={target.project.showTeamsInNavigator === true}
              role="menuitemcheckbox"
              type="button"
              onClick={() => onSetProjectTeamsInNavigator(
                target.project,
                target.project.showTeamsInNavigator !== true,
              )}
            >
              {target.project.showTeamsInNavigator === true ? (
                <Eye aria-hidden="true" size={15} />
              ) : (
                <EyeOff aria-hidden="true" size={15} />
              )}
              在项目中显示团队
            </button>
            <div className="project-navigator__context-menu-separator" role="separator" />
            <button
              className="project-navigator__context-menu-danger"
              disabled={projectHasRunningSession}
              role="menuitem"
              title={projectHasRunningSession ? "项目中有正在运行的对话" : undefined}
              type="button"
              onClick={() => onRemoveProject(target.project)}
            >
              <Trash2 aria-hidden="true" size={15} />
              移除项目
            </button>
          </>
        )}
      </div>
    </>
  );
}

function NavigatorManagementDialog({
  dialog,
  draftName,
  draftProjectId,
  draftTeamId,
  isSubmitting,
  onCancel,
  onDraftNameChange,
  onDraftProjectIdChange,
  onDraftTeamIdChange,
  onSubmit,
  teams,
  projects,
}: {
  dialog: NavigatorDialog;
  draftName: string;
  draftProjectId: string;
  draftTeamId: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onDraftNameChange: (value: string) => void;
  onDraftProjectIdChange: (value: string) => void;
  onDraftTeamIdChange: (value: string) => void;
  onSubmit: () => void;
  teams: readonly AgentTeam[];
  projects: readonly ProjectSummary[];
}): ReactElement {
  const isCreate = dialog.kind === "create-team-instance";
  const isEditTeam = dialog.kind === "edit-team-instance";
  const isRename = dialog.kind === "rename-project"
    || dialog.kind === "rename-session"
    || dialog.kind === "rename-team-instance";
  const title = dialog.kind === "rename-project"
    ? "重命名项目"
    : dialog.kind === "rename-session"
      ? "重命名对话"
      : dialog.kind === "rename-team-instance"
        ? "重命名团队"
        : dialog.kind === "edit-team-instance"
          ? "编辑团队"
        : dialog.kind === "create-team-instance"
          ? dialog.scope === "global"
            ? "创建团队"
            : dialog.scope === "project"
              ? "创建项目团队"
              : "创建对话团队"
      : dialog.kind === "remove-project"
        ? "移除项目"
        : dialog.kind === "delete-team-instance"
          ? "删除团队"
          : "删除对话";
  const description = dialog.kind === "remove-project"
    ? `将从工作区移除“${dialog.project.name}”，并删除本软件中的相关对话记录。磁盘文件不会被删除。`
    : dialog.kind === "delete-session"
      ? `将永久删除“${dialog.session.title}”及其对话记录。`
      : dialog.kind === "delete-team-instance"
        ? `将删除团队“${dialog.instance.name}”。现有对话与执行记录会保留用于审计。`
      : null;

  return (
    <div className="project-navigator__dialog-backdrop">
      <form
        aria-labelledby="navigator-management-dialog-title"
        aria-modal="true"
        className="project-navigator__dialog"
        role="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="project-navigator__dialog-header">
          <h2 id="navigator-management-dialog-title">{title}</h2>
          <button aria-label="关闭" disabled={isSubmitting} type="button" onClick={onCancel}>
            <X aria-hidden="true" size={15} />
          </button>
        </div>
        {isCreate ? (
          <>
            {dialog.kind === "create-team-instance" && dialog.scope !== "conversation" ? (
              <div className="project-navigator__dialog-field">
                <span id="navigator-team-project-label">关联项目</span>
                <Select
                  value={draftProjectId || UNASSOCIATED_PROJECT_SELECT_VALUE}
                  onValueChange={(value) => onDraftProjectIdChange(
                    value === UNASSOCIATED_PROJECT_SELECT_VALUE ? "" : value,
                  )}
                >
                  <SelectTrigger
                    aria-labelledby="navigator-team-project-label"
                    autoFocus
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value={UNASSOCIATED_PROJECT_SELECT_VALUE}>不关联项目</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="project-navigator__dialog-field">
              <span id="navigator-team-template-label">团队模板</span>
              <Select
                value={draftTeamId}
                onValueChange={onDraftTeamIdChange}
              >
                <SelectTrigger
                  aria-labelledby="navigator-team-template-label"
                  autoFocus={dialog.kind !== "create-team-instance" || dialog.scope === "conversation"}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}{team.enabled ? "" : "（已暂停）"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="project-navigator__dialog-field">
              <span>团队名（可选）</span>
              <input
                maxLength={120}
                placeholder="留空时使用模板名称，重名会自动编号"
                value={draftName}
                onChange={(event) => onDraftNameChange(event.target.value)}
              />
            </label>
          </>
        ) : isEditTeam ? (
          <div className="project-navigator__dialog-field">
            <span id="navigator-edit-team-project-label">关联项目</span>
            <Select
              value={draftProjectId || UNASSOCIATED_PROJECT_SELECT_VALUE}
              onValueChange={(value) => onDraftProjectIdChange(
                value === UNASSOCIATED_PROJECT_SELECT_VALUE ? "" : value,
              )}
            >
              <SelectTrigger
                aria-labelledby="navigator-edit-team-project-label"
                autoFocus
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value={UNASSOCIATED_PROJECT_SELECT_VALUE}>不关联项目</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : isRename ? (
          <label className="project-navigator__dialog-field">
            <span>名称</span>
            <input
              autoFocus
              maxLength={dialog.kind === "rename-team-instance" ? 120 : 200}
              value={draftName}
              onChange={(event) => onDraftNameChange(event.target.value)}
            />
          </label>
        ) : (
          <p>{description}</p>
        )}
        <div className="project-navigator__dialog-actions">
          <button disabled={isSubmitting} type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className={isCreate || isRename || isEditTeam
              ? "project-navigator__dialog-primary"
              : "project-navigator__dialog-danger"}
            disabled={isSubmitting
              || (isRename && draftName.trim().length === 0)
              || (isCreate && draftTeamId.length === 0)}
            type="submit"
          >
            {isSubmitting
              ? "处理中…"
              : isCreate ? "创建" : isRename || isEditTeam ? "保存" : "确认"}
          </button>
        </div>
      </form>
    </div>
  );
}

function NavigatorEmpty({
  actionLabel,
  label,
  loading = false,
  onAction,
}: {
  actionLabel?: string;
  label: string;
  loading?: boolean;
  onAction?: () => void;
}): ReactElement {
  return (
    <div className="project-navigator__empty" data-loading={String(loading)}>
      {loading ? (
        <LoaderCircle aria-hidden="true" size={17} />
      ) : (
        <Folder aria-hidden="true" size={19} />
      )}
      <p>{label}</p>
      {actionLabel && onAction ? (
        <button type="button" onClick={onAction}>
          {actionLabel}
        </button>
      ) : null}
    </div>
  );
}
