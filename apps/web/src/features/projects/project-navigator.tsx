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
  SquarePen,
  Trash2,
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

import type { ProjectSummary } from "@agent/protocol";

import { WorkbenchPanel } from "../../components/layout/panel.js";
import { IconButton } from "../../components/ui/icon-button.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import {
  groupSubagentSessionsByParent,
  getProjectSessions,
  getPinnedSessions,
  getTemporarySessions,
  type ProjectSession,
} from "./project-session-model.js";
import type { ProjectTreeController } from "./use-project-tree.js";
import "./project-navigator.css";

type ProjectNavigatorProps = {
  activeSessionId: string | null;
  isCreatingSession: boolean;
  isLoadingSessions: boolean;
  locateRequest: ProjectNavigatorLocateRequest | null;
  operationError: string | null;
  sessions: ProjectSession[];
  tree: ProjectTreeController;
  onClearOperationError: () => void;
  onCreateProjectSession: (projectId: string) => void;
  onCreateTemporarySession: () => void;
  onDeleteSession: (sessionId: string) => Promise<boolean>;
  onRemoveProject: (projectId: string) => Promise<boolean>;
  onRenameProject: (projectId: string, name: string) => Promise<boolean>;
  onRenameSession: (sessionId: string, title: string) => Promise<boolean>;
  onReorderSessions: (sessionIds: string[]) => Promise<boolean>;
  onSelectProject: (projectId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onSetSessionArchived: (sessionId: string, archived: boolean) => Promise<boolean>;
  onSetSessionPinned: (sessionId: string, pinned: boolean) => Promise<boolean>;
};

type NavigatorMenuTarget =
  | { kind: "project"; project: ProjectSummary }
  | { kind: "session"; session: ProjectSession };

type NavigatorContextMenu = {
  target: NavigatorMenuTarget;
  x: number;
  y: number;
};

type NavigatorDialog =
  | { kind: "delete-session"; session: ProjectSession }
  | { kind: "remove-project"; project: ProjectSummary }
  | { kind: "rename-project"; project: ProjectSummary }
  | { kind: "rename-session"; session: ProjectSession };

type NavigatorDragItem = {
  groupKey: string;
  id: string;
  kind: "project" | "session";
};

type NavigatorDropIndicator = {
  id: string;
  kind: "project" | "session";
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
  const subagents = subagentsByParent.get(session.id) ?? [];
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
  isCreatingSession,
  isLoadingSessions,
  locateRequest,
  operationError,
  sessions,
  tree,
  onClearOperationError,
  onCreateProjectSession,
  onCreateTemporarySession,
  onDeleteSession,
  onRemoveProject,
  onRenameProject,
  onRenameSession,
  onReorderSessions,
  onSelectProject,
  onSelectSession,
  onSetSessionArchived,
  onSetSessionPinned,
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
  const [isPinnedGroupExpanded, setIsPinnedGroupExpanded] = useState(true);
  const [isTemporaryGroupExpanded, setIsTemporaryGroupExpanded] = useState(true);
  const [query, setQuery] = useState("");
  const [sortOpen, setSortOpen] = useState(false);
  const [sortOption, setSortOption] = useState<NavigatorSortOption>("custom");
  const [contextMenu, setContextMenu] = useState<NavigatorContextMenu | null>(null);
  const [dialog, setDialog] = useState<NavigatorDialog | null>(null);
  const [draftName, setDraftName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [dragItem, setDragItem] = useState<NavigatorDragItem | null>(null);
  const [dropIndicator, setDropIndicator] = useState<NavigatorDropIndicator | null>(null);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const sortLabel = NAVIGATOR_SORT_OPTIONS.find(
    (option) => option.value === sortOption,
  )?.label ?? "自定义顺序";

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
    } else {
      void onReorderSessions(reordered);
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
    const firstFrame = window.requestAnimationFrame(() => {
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
      }
      secondFrame = window.requestAnimationFrame(() => {
        const target = Array.from(
          bodyRef.current?.querySelectorAll<HTMLElement>("[data-navigator-key]") ?? [],
        ).find((element) => element.dataset.navigatorKey === targetKey);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });

    return () => {
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
    () => groupSubagentSessionsByParent(sessions),
    [sessions],
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

          return getProjectSessions(sessions, project.id).some(
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
    [normalizedQuery, sessions, sortOption, subagentSessionsByParent, tree.projects],
  );
  const hasPinnedGroup = visiblePinnedSessions.length > 0;
  const hasProjectsGroup = visibleProjects.length > 0;
  const hasTemporaryGroup = visibleTemporarySessions.length > 0;
  const allNavigatorGroupsCollapsed =
    (!hasProjectsGroup || !isProjectsGroupExpanded)
    && (!hasPinnedGroup || !isPinnedGroupExpanded)
    && (!hasTemporaryGroup || !isTemporaryGroupExpanded);
  const hasExpandableNavigatorGroups =
    hasProjectsGroup || hasPinnedGroup || hasTemporaryGroup;
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
    setDraftName(target.kind === "project" ? target.project.name : target.session.title);
    setDialog(
      target.kind === "project"
        ? { kind: "rename-project", project: target.project }
        : { kind: "rename-session", session: target.session },
    );
  }

  async function submitDialog(): Promise<void> {
    if (dialog === null || isSubmitting) return;
    setIsSubmitting(true);
    let succeeded: boolean;
    if (dialog.kind === "rename-project") {
      succeeded = await onRenameProject(dialog.project.id, draftName.trim());
    } else if (dialog.kind === "rename-session") {
      succeeded = await onRenameSession(dialog.session.id, draftName.trim());
    } else if (dialog.kind === "remove-project") {
      succeeded = await onRemoveProject(dialog.project.id);
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
          项目与对话
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
                setExpandedProjectIds(new Set(tree.projects.map((project) => project.id)));
                setExpandedSessionIds(new Set(subagentSessionsByParent.keys()));
                setCollapsedProjectIds(new Set());
                setIsPinnedGroupExpanded(true);
                setIsTemporaryGroupExpanded(true);
              } else {
                setIsProjectsGroupExpanded(false);
                setExpandedProjectIds(new Set());
                setExpandedSessionIds(new Set());
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
          aria-label="搜索项目或会话"
          placeholder="搜索项目或会话"
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
              visiblePinnedSessions.length === 0 && visibleTemporarySessions.length === 0 ? (
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
              visiblePinnedSessions.length === 0 && visibleTemporarySessions.length === 0 ? (
                <NavigatorEmpty label="没有匹配的项目或会话。" />
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
                          {visibleSessions.length === 0 && normalizedQuery.length === 0 ? (
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
            {visibleTemporarySessions.length > 0 || normalizedQuery.length === 0 ? (
              <section
                className={`project-navigator__temporary${
                  visibleProjects.length > 0
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
          onDeleteSession={(session) => {
            setContextMenu(null);
            setDialog({ kind: "delete-session", session });
          }}
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
          onSetPinned={(session, pinned) => {
            setContextMenu(null);
            void onSetSessionPinned(session.id, pinned);
          }}
        />,
        document.body,
      ) : null}
      {dialog !== null ? createPortal(
        <NavigatorManagementDialog
          dialog={dialog}
          draftName={draftName}
          isSubmitting={isSubmitting}
          onCancel={() => setDialog(null)}
          onDraftNameChange={setDraftName}
          onSubmit={() => void submitDialog()}
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
    || session.activeRunId !== null
    || session.lastRunStatus === "queued"
    || session.lastRunStatus === "running";
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
  locatedSessionId,
  subagents,
  subagentsExpanded,
  onToggleSubagents,
  ...buttonProps
}: SessionButtonProps & {
  activeSessionId: string | null;
  locatedSessionId: string | null;
  subagents: readonly ProjectSession[];
  subagentsExpanded: boolean;
  onToggleSubagents: () => void;
}): ReactElement {
  const runningSubagentCount = subagents.filter(isSessionRunning).length;
  return (
    <div className="project-navigator__session-branch">
      <div className="project-navigator__session-branch-row">
        {subagents.length > 0 ? (
          <button
            aria-expanded={subagentsExpanded}
            aria-label={`${subagentsExpanded ? "收起" : "展开"} ${buttonProps.session.title} 的 Subagent`}
            className="project-navigator__session-toggle"
            title={`${subagents.length} 个 Subagent${runningSubagentCount > 0 ? `，${runningSubagentCount} 个正在运行` : ""}`}
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
          runningSubagentCount={runningSubagentCount}
          subagentCount={subagents.length}
        />
      </div>
      {subagentsExpanded && subagents.length > 0 ? (
        <div className="project-navigator__subagents" role="group" aria-label="Subagent 对话">
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
      <Bot aria-hidden="true" size={14} />
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
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onPin,
  onSelect,
}: SessionButtonProps & {
  runningSubagentCount: number;
  subagentCount: number;
}): ReactElement {
  const isRunning = isSessionRunning(session);
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
        <MessageSquareText aria-hidden="true" size={14} />
        <span className="project-navigator__session-title">{session.title}</span>
        {subagentCount > 0 ? (
          <span
            className="project-navigator__subagent-count"
            data-running={runningSubagentCount > 0}
            title={`${subagentCount} 个 Subagent`}
          >
            <Bot aria-hidden="true" size={11} />
            {subagentCount}
          </span>
        ) : null}
        <SessionStatusIndicator session={session} />
      </button>
      <div className="project-navigator__session-actions">
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
          disabled={isRunning}
          title={isRunning ? "运行中的对话不能归档" : archived ? "取消归档" : "归档"}
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
  onRemoveProject,
  onRename,
  onSetArchived,
  onSetPinned,
  onSetProjectPinned,
}: {
  menu: NavigatorContextMenu;
  projectHasRunningSession: boolean;
  onClose: () => void;
  onDeleteSession: (session: ProjectSession) => void;
  onRemoveProject: (project: ProjectSummary) => void;
  onRename: (target: NavigatorMenuTarget) => void;
  onSetArchived: (session: ProjectSession, archived: boolean) => void;
  onSetPinned: (session: ProjectSession, pinned: boolean) => void;
  onSetProjectPinned: (project: ProjectSummary, pinned: boolean) => void;
}): ReactElement {
  const target = menu.target;
  const sessionIsRunning = target.kind === "session" && (
    isSessionRunning(target.session)
  );

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
        {target.kind === "session" ? (
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
              disabled={sessionIsRunning}
              role="menuitem"
              title={sessionIsRunning ? "运行中的对话不能归档" : undefined}
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
              disabled={sessionIsRunning}
              role="menuitem"
              title={sessionIsRunning ? "运行中的对话不能删除" : undefined}
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
  isSubmitting,
  onCancel,
  onDraftNameChange,
  onSubmit,
}: {
  dialog: NavigatorDialog;
  draftName: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onDraftNameChange: (value: string) => void;
  onSubmit: () => void;
}): ReactElement {
  const isRename = dialog.kind === "rename-project" || dialog.kind === "rename-session";
  const title = dialog.kind === "rename-project"
    ? "重命名项目"
    : dialog.kind === "rename-session"
      ? "重命名对话"
      : dialog.kind === "remove-project"
        ? "移除项目"
        : "删除对话";
  const description = dialog.kind === "remove-project"
    ? `将从工作区移除“${dialog.project.name}”，并删除本软件中的相关对话记录。磁盘文件不会被删除。`
    : dialog.kind === "delete-session"
      ? `将永久删除“${dialog.session.title}”及其对话记录。`
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
        {isRename ? (
          <label className="project-navigator__dialog-field">
            <span>名称</span>
            <input
              autoFocus
              maxLength={200}
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
            className={isRename ? "project-navigator__dialog-primary" : "project-navigator__dialog-danger"}
            disabled={isSubmitting || (isRename && draftName.trim().length === 0)}
            type="submit"
          >
            {isSubmitting ? "处理中…" : isRename ? "保存" : "确认"}
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
