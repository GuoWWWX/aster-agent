import {
  ArrowDownAZ,
  ArrowDownUp,
  ArrowDownZA,
  Check,
  ChevronsDownUp,
  ChevronsUpDown,
  ClockArrowDown,
  ClockArrowUp,
  FilePlus,
  Folder,
  FolderPlus,
  GripVertical,
  LocateFixed,
  LoaderCircle,
  Search,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type DragEvent,
  type FormEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";
import type { ProjectEntry } from "@agent/protocol";

import { IconButton } from "../../components/ui/icon-button.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import { ProjectTreeNode } from "./project-tree-node.js";
import {
  reorderProjectPaths,
  ROOT_DIRECTORY_PATH,
  sortProjectEntries,
  type ProjectTreeSortOption,
} from "./project-tree-model.js";
import type { ProjectTreeController } from "./use-project-tree.js";
import "./project-tree-panel.css";

type ProjectTreePanelProps = {
  currentFilePath?: string | null;
  isCollapsed?: boolean;
  onOpenFile?: (entry: ProjectEntry) => void;
  tree: ProjectTreeController;
};

const SORT_OPTIONS: readonly { label: string; value: ProjectTreeSortOption }[] = [
  { label: "自定义顺序", value: "custom" },
  { label: "名称 A-Z", value: "name-ascending" },
  { label: "名称 Z-A", value: "name-descending" },
  { label: "修改时间：最新优先", value: "modified-descending" },
  { label: "修改时间：最早优先", value: "modified-ascending" },
];

type ProjectTreeCustomOrders = Record<string, string[] | undefined>;

type ProjectTreeDragItem = {
  parentPath: string;
  path: string;
};

type ProjectTreeDropIndicator = {
  path: string;
  position: "after" | "before";
};

function customOrderStorageKey(projectId: string): string {
  return `agent-workbench.project-tree-order.v1:${projectId}`;
}

function loadCustomOrders(projectId: string): ProjectTreeCustomOrders {
  try {
    const value: unknown = JSON.parse(window.localStorage.getItem(customOrderStorageKey(projectId)) ?? "{}");
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) && entry[1].every((path) => typeof path === "string"),
      ),
    );
  } catch {
    return {};
  }
}

function saveCustomOrders(projectId: string, orders: ProjectTreeCustomOrders): void {
  try {
    window.localStorage.setItem(customOrderStorageKey(projectId), JSON.stringify(orders));
  } catch {
    // Keep the active view usable when browser storage is unavailable.
  }
}

function setDragPreview(event: DragEvent<HTMLElement>): void {
  const bounds = event.currentTarget.getBoundingClientRect();
  const preview = event.currentTarget.cloneNode(true) as HTMLElement;
  preview.classList.add("project-tree__drag-preview");
  preview.style.width = `${bounds.width}px`;
  preview.style.height = `${bounds.height}px`;
  document.body.append(preview);
  event.dataTransfer.setDragImage(preview, event.clientX - bounds.left, event.clientY - bounds.top);
  window.setTimeout(() => preview.remove(), 0);
}

export function ProjectTreePanel({
  currentFilePath = null,
  isCollapsed = false,
  onOpenFile,
  tree,
}: ProjectTreePanelProps): ReactElement {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const headerRef = useRef<HTMLElement | null>(null);
  const [createKind, setCreateKind] = useState<"directory" | "file" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [customOrders, setCustomOrders] = useState<ProjectTreeCustomOrders>(() => {
    const projectId = tree.activeProject?.id;
    return projectId === undefined ? {} : loadCustomOrders(projectId);
  });
  const [dragItem, setDragItem] = useState<ProjectTreeDragItem | null>(null);
  const [dropIndicator, setDropIndicator] = useState<ProjectTreeDropIndicator | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortOption, setSortOption] = useState<ProjectTreeSortOption>("custom");
  const sortLabel = SORT_OPTIONS.find((option) => option.value === sortOption)?.label ?? "自定义顺序";
  const hasDirectories = tree.rootDirectoryState?.entries.some(
    (entry) => entry.kind === "directory",
  ) === true;

  const selectedEntry = Object.values(tree.directories)
    .flatMap((directory) => directory?.entries ?? [])
    .find((entry) => entry.path === tree.selectedPath);
  const selectedDirectoryPath = selectedEntry?.kind === "directory"
    ? selectedEntry.path
    : parentDirectoryPath(tree.selectedPath ?? "");

  function startDrag(
    event: DragEvent<HTMLElement>,
    entry: ProjectEntry,
    parentPath: string,
  ): void {
    if (sortOption !== "custom" || tree.query.length > 0) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", entry.path);
    setDragPreview(event);
    setDragItem({ parentPath, path: entry.path });
    setDropIndicator(null);
  }

  function updateDropIndicator(
    event: DragEvent<HTMLElement>,
    entry: ProjectEntry,
    parentPath: string,
  ): void {
    if (dragItem === null || dragItem.parentPath !== parentPath || dragItem.path === entry.path) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropIndicator({
      path: entry.path,
      position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    });
  }

  function dropEntry(
    event: DragEvent<HTMLElement>,
    entry: ProjectEntry,
    parentPath: string,
    siblings: readonly ProjectEntry[],
  ): void {
    event.preventDefault();
    if (
      dragItem === null
      || dropIndicator === null
      || dragItem.parentPath !== parentPath
      || dragItem.path === entry.path
    ) {
      setDragItem(null);
      setDropIndicator(null);
      return;
    }
    const currentOrder = sortProjectEntries(
      siblings,
      "custom",
      customOrders[parentPath],
    ).map((sibling) => sibling.path);
    const nextOrder = reorderProjectPaths(
      currentOrder,
      dragItem.path,
      entry.path,
      dropIndicator.position,
    );
    setCustomOrders((current) => {
      const next = { ...current, [parentPath]: nextOrder };
      const projectId = tree.activeProject?.id;
      if (projectId !== undefined) saveCustomOrders(projectId, next);
      return next;
    });
    setDragItem(null);
    setDropIndicator(null);
  }

  function finishDrag(): void {
    setDragItem(null);
    setDropIndicator(null);
  }

  function openCreateDialog(kind: "directory" | "file"): void {
    tree.clearOperationError();
    setDraftName("");
    setCreateKind(kind);
  }

  function closeCreateDialog(): void {
    if (isCreating) return;
    tree.clearOperationError();
    setCreateKind(null);
  }

  useEffect(() => {
    if (createKind === null) return undefined;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !isCreating) {
        tree.clearOperationError();
        setCreateKind(null);
      }
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [createKind, isCreating, tree]);

  async function submitCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (createKind === null || isCreating) return;
    setIsCreating(true);
    const entry = await tree.createEntry(createKind, selectedDirectoryPath, draftName);
    setIsCreating(false);
    if (entry === null) return;
    if (entry.kind === "file") onOpenFile?.(entry);
    setCreateKind(null);
  }

  useEffect(() => {
    if (tree.locateRequestId === 0 || tree.locatedPath === null) return undefined;

    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const target = tree.locatedPath === ROOT_DIRECTORY_PATH
          ? headerRef.current
          : Array.from(
              bodyRef.current?.querySelectorAll<HTMLElement>("[data-project-path]") ?? [],
            ).find((element) => element.dataset.projectPath === tree.locatedPath);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });

    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [tree.locateRequestId, tree.locatedPath]);

  return (
    <section
      className="project-tree-panel"
      aria-labelledby="project-tree-heading"
      data-collapsed={String(isCollapsed)}
    >
      <header
        className="project-tree-panel__header"
        data-located={tree.locatedPath === ROOT_DIRECTORY_PATH}
        ref={headerRef}
      >
        <div className="project-tree-panel__heading-row">
          <div>
            <p className="panel-eyebrow">工作区文件</p>
            <h2 id="project-tree-heading">
              {tree.activeProject?.name ?? "文件"}
            </h2>
          </div>
        </div>

        {!isCollapsed ? (
          <div className="project-tree-panel__toolbar">
            <div className="project-tree-panel__toolbar-group">
              <IconButton
                className="project-tree-panel__tool-button"
                disabled={tree.activeProject === null}
                label="新建文件"
                size="compact"
                variant="quiet"
                onClick={() => openCreateDialog("file")}
              >
                <FilePlus aria-hidden="true" size={16} />
              </IconButton>
              <IconButton
                className="project-tree-panel__tool-button"
                disabled={tree.activeProject === null}
                label="新建文件夹"
                size="compact"
                variant="quiet"
                onClick={() => openCreateDialog("directory")}
              >
                <FolderPlus aria-hidden="true" size={16} />
              </IconButton>
              <Popover open={sortOpen} onOpenChange={setSortOpen}>
                <PopoverTrigger asChild>
                  <IconButton
                    className="project-tree-panel__tool-button"
                    disabled={tree.activeProject === null}
                    label={`排序：${sortLabel}`}
                    size="compact"
                    variant="quiet"
                  >
                    <ArrowDownUp aria-hidden="true" size={16} />
                  </IconButton>
                </PopoverTrigger>
                <PopoverContent
                  align="start"
                  className="project-tree-panel__sort-menu"
                  collisionPadding={8}
                  side="bottom"
                  sideOffset={4}
                >
                  <p>排序方式</p>
                  <div role="menu">
                    {SORT_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        role="menuitemradio"
                        aria-checked={option.value === sortOption}
                        type="button"
                        onClick={() => {
                          setSortOption(option.value);
                          setSortOpen(false);
                        }}
                      >
                        <span className="project-tree-panel__sort-option">
                          <SortOptionIcon option={option.value} />
                          {option.label}
                        </span>
                        {option.value === sortOption ? <Check aria-hidden="true" size={14} /> : null}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <IconButton
                className="project-tree-panel__tool-button"
                disabled={currentFilePath === null}
                label="定位当前文件"
                size="compact"
                variant="quiet"
                onClick={() => {
                  if (currentFilePath !== null) tree.locatePath(currentFilePath);
                }}
              >
                <LocateFixed aria-hidden="true" size={16} />
              </IconButton>
            </div>
            <IconButton
              className="project-tree-panel__tool-button"
              disabled={
                tree.activeProject === null
                || tree.rootDirectoryState?.isLoading
                || !hasDirectories
              }
              label={
                tree.allDirectoriesCollapsed ? "全部展开目录" : "全部收起目录"
              }
              size="compact"
              variant="quiet"
              onClick={() => {
                if (tree.allDirectoriesCollapsed) {
                  tree.expandAllDirectories();
                } else {
                  tree.collapseAllDirectories();
                }
              }}
            >
              {tree.allDirectoriesCollapsed ? (
                <ChevronsUpDown aria-hidden="true" size={15} />
              ) : (
                <ChevronsDownUp aria-hidden="true" size={15} />
              )}
            </IconButton>
          </div>
        ) : null}

        {!isCollapsed ? (
          <label className="project-tree-panel__search app-search-field">
            <Search aria-hidden="true" size={14} />
            <input
              aria-label="搜索文件名"
              disabled={tree.activeProject === null}
              placeholder="搜索文件名"
              value={tree.query}
              onChange={(event) => tree.setQuery(event.target.value)}
            />
            {tree.query.length > 0 ? (
              <button
                aria-label="清除文件筛选"
                type="button"
                onClick={() => tree.setQuery("")}
              >
                <X aria-hidden="true" size={13} />
              </button>
            ) : null}
          </label>
        ) : null}
      </header>

      {!isCollapsed ? (
        <div className="project-tree-panel__body" ref={bodyRef}>
          {tree.isLoadingProjects ? (
            <EmptyProjectTree label="正在读取项目…" loading />
          ) : tree.activeProject === null ? (
            <EmptyProjectTree label="从左侧选择项目后显示文件。" />
          ) : tree.rootDirectoryState?.isLoading &&
            tree.rootDirectoryState.entries.length === 0 ? (
            <EmptyProjectTree label="正在读取文件树…" loading />
          ) : tree.rootDirectoryState?.errorMessage ? (
            <EmptyProjectTree
              actionLabel="重试"
              label={tree.rootDirectoryState.errorMessage}
              onAction={() => tree.refresh()}
            />
          ) : tree.rootDirectoryState === undefined ? (
            <EmptyProjectTree label="正在准备文件树…" loading />
          ) : tree.rootEntries.length === 0 ? (
            <EmptyProjectTree
              label={
                tree.query.length > 0
                  ? "没有匹配的已加载文件。"
                  : "该项目目录为空。"
              }
            />
          ) : (
            <ul
              className="project-tree"
              role="tree"
              aria-label={`${tree.activeProject.name} 文件树`}
            >
              {sortProjectEntries(
                tree.rootEntries,
                sortOption,
                customOrders[ROOT_DIRECTORY_PATH],
              ).map((entry) => (
                <ProjectTreeNode
                  key={entry.path}
                  customOrders={customOrders}
                  depth={0}
                  directories={tree.directories}
                  draggingPath={dragItem?.path ?? null}
                  dropIndicator={dropIndicator}
                  entry={entry}
                  expandedDirectories={tree.expandedDirectories}
                  locatedPath={tree.locatedPath}
                  onDragEnd={finishDrag}
                  onDragOver={updateDropIndicator}
                  onDragStart={startDrag}
                  onDrop={dropEntry}
                  onReload={(directoryPath) => tree.reloadDirectory(directoryPath)}
                  onOpenFile={onOpenFile ?? (() => undefined)}
                  onSelect={(path) => tree.selectPath(path)}
                  onToggle={(directoryPath) => tree.toggleDirectory(directoryPath)}
                  parentPath={ROOT_DIRECTORY_PATH}
                  query={tree.query}
                  selectedPath={tree.selectedPath}
                  sortOption={sortOption}
                />
              ))}
            </ul>
          )}
        </div>
      ) : null}

      {!isCollapsed && tree.activeProject !== null && tree.rootDirectoryState?.truncated ? (
        <div className="project-tree-panel__notice">
          当前目录仅显示前 1000 项。
        </div>
      ) : null}

      {!isCollapsed && tree.activeProject !== null ? (
        <footer
          className="project-tree-panel__footer"
          title={tree.activeProject.rootPath}
        >
          {tree.activeProject.rootPath}
        </footer>
      ) : null}

      {createKind !== null ? createPortal(
        <div
          className="project-tree-panel__dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeCreateDialog();
          }}
        >
          <form
            aria-labelledby="project-tree-create-title"
            className="project-tree-panel__dialog"
            role="dialog"
            onSubmit={(event) => void submitCreate(event)}
          >
            <h2 id="project-tree-create-title">
              {createKind === "file" ? "新建文件" : "新建文件夹"}
            </h2>
            <p title={selectedDirectoryPath || "项目根目录"}>
              位置：{selectedDirectoryPath || "项目根目录"}
            </p>
            <input
              autoFocus
              aria-label={createKind === "file" ? "文件名" : "文件夹名"}
              disabled={isCreating}
              placeholder={createKind === "file" ? "文件名" : "文件夹名"}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
            />
            {tree.operationError !== null ? (
              <div className="project-tree-panel__dialog-error" role="alert">
                {tree.operationError}
              </div>
            ) : null}
            <div className="project-tree-panel__dialog-actions">
              <button disabled={isCreating} type="button" onClick={closeCreateDialog}>
                取消
              </button>
              <button disabled={isCreating || draftName.trim().length === 0} type="submit">
                {isCreating ? "正在创建…" : "创建"}
              </button>
            </div>
          </form>
        </div>,
        document.body,
      ) : null}
    </section>
  );
}

function SortOptionIcon({ option }: { option: ProjectTreeSortOption }): ReactElement {
  switch (option) {
    case "custom":
      return <GripVertical aria-hidden="true" size={15} />;
    case "name-ascending":
      return <ArrowDownAZ aria-hidden="true" size={15} />;
    case "name-descending":
      return <ArrowDownZA aria-hidden="true" size={15} />;
    case "modified-descending":
      return <ClockArrowDown aria-hidden="true" size={15} />;
    case "modified-ascending":
      return <ClockArrowUp aria-hidden="true" size={15} />;
  }
}

function parentDirectoryPath(path: string): string {
  const slashIndex = path.lastIndexOf("/");
  return slashIndex < 0 ? ROOT_DIRECTORY_PATH : path.slice(0, slashIndex);
}

function EmptyProjectTree({
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
    <div className="project-tree-panel__empty" data-loading={String(loading)}>
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
