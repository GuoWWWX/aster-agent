import {
  ArrowDownAZ,
  ArrowDownUp,
  ArrowDownZA,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FilePlus,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  LocateFixed,
  Search,
  Trash2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactElement,
} from "react";
import { createPortal } from "react-dom";

import type { ConfigurationWorkspaceEntry } from "@agent/protocol";

import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { IconButton } from "../../components/ui/icon-button.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import type { ConfigurationWorkspaceTarget } from "../../stores/workbench-ui-store.js";
import "./configuration-workspace-tree-panel.css";

type ConfigurationTreeSortOption = "name-ascending" | "name-descending";

const SORT_OPTIONS: readonly { label: string; value: ConfigurationTreeSortOption }[] = [
  { label: "名称 A-Z", value: "name-ascending" },
  { label: "名称 Z-A", value: "name-descending" },
];

const entryNameCollator = new Intl.Collator("zh-CN", {
  numeric: true,
  sensitivity: "base",
});

function parentPath(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash < 0 ? "" : path.slice(0, slash);
}

function entryPath(directoryPath: string, name: string): string {
  return directoryPath.length === 0 ? name : `${directoryPath}/${name}`;
}

function isSafeEntryName(name: string): boolean {
  // eslint-disable-next-line no-control-regex
  return name.length > 0 && name !== "." && name !== ".." && !/[\\/\u0000]/.test(name);
}

function sortEntries(
  entries: readonly ConfigurationWorkspaceEntry[],
  option: ConfigurationTreeSortOption,
): ConfigurationWorkspaceEntry[] {
  return [...entries].sort((left, right) => {
    const leftDirectory = left.kind === "directory";
    const rightDirectory = right.kind === "directory";
    if (leftDirectory !== rightDirectory) return leftDirectory ? -1 : 1;
    const comparison = entryNameCollator.compare(left.name, right.name);
    return option === "name-descending" ? -comparison : comparison;
  });
}

function filterEntries(
  entries: readonly ConfigurationWorkspaceEntry[],
  query: string,
): ConfigurationWorkspaceEntry[] {
  if (query.length === 0) return [...entries];
  const normalizedQuery = query.toLocaleLowerCase("zh-CN");
  return entries.filter((entry) => (
    entry.name.toLocaleLowerCase("zh-CN").includes(normalizedQuery)
  ));
}

type ConfigurationWorkspaceTreePanelProps = {
  agentClient: AgentClient;
  currentFilePath: string | null;
  isCollapsed: boolean;
  target: ConfigurationWorkspaceTarget;
  onDeleteEntry: (path: string) => void;
  onOpenFile: (path: string) => void;
};

export function ConfigurationWorkspaceTreePanel({
  agentClient,
  currentFilePath,
  isCollapsed,
  target,
  onDeleteEntry,
  onOpenFile,
}: ConfigurationWorkspaceTreePanelProps): ReactElement {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [createKind, setCreateKind] = useState<"directory" | "file" | null>(null);
  const [draftName, setDraftName] = useState("");
  const [entriesByDirectory, setEntriesByDirectory] = useState<
    Record<string, readonly ConfigurationWorkspaceEntry[]>
  >({});
  const [expandedDirectories, setExpandedDirectories] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [isCreating, setIsCreating] = useState(false);
  const [isExpandingAll, setIsExpandingAll] = useState(false);
  const [loadingDirectories, setLoadingDirectories] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const [locateRequestId, setLocateRequestId] = useState(0);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [rootPath, setRootPath] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [sortOpen, setSortOpen] = useState(false);
  const [sortOption, setSortOption] = useState<ConfigurationTreeSortOption>("name-ascending");

  const selectedEntry = useMemo(() => Object.values(entriesByDirectory)
    .flatMap((entries) => entries)
    .find((entry) => entry.path === selectedPath) ?? null, [entriesByDirectory, selectedPath]);
  const selectedDirectoryPath = selectedEntry?.kind === "directory"
    ? selectedEntry.path
    : selectedEntry === null
      ? ""
      : parentPath(selectedEntry.path);
  const hasDirectories = Object.values(entriesByDirectory)
    .some((entries) => entries.some((entry) => entry.kind === "directory"));
  const allDirectoriesCollapsed = expandedDirectories.size === 0;
  const sortLabel = SORT_OPTIONS.find((option) => option.value === sortOption)?.label ?? "名称 A-Z";

  const loadDirectory = useCallback(async (directoryPath: string): Promise<void> => {
    setLoadingDirectories((current) => new Set(current).add(directoryPath));
    try {
      const listing = await agentClient.listConfigurationWorkspaceEntries({
        configurationId: target.configurationId,
        directoryPath,
        kind: target.kind,
      });
      setEntriesByDirectory((current) => ({ ...current, [directoryPath]: listing.entries }));
      setRootPath(listing.rootPath);
      setOperationError(null);
    } catch (reason) {
      setOperationError(getUserErrorMessage(reason, "无法读取配置文件树。"));
    } finally {
      setLoadingDirectories((current) => {
        const next = new Set(current);
        next.delete(directoryPath);
        return next;
      });
    }
  }, [agentClient, target.configurationId, target.kind]);

  useEffect(() => {
    void Promise.resolve().then(async () => {
      setEntriesByDirectory({});
      setExpandedDirectories(new Set());
      setOperationError(null);
      setQuery("");
      setRootPath("");
      setSelectedPath(null);
      await loadDirectory("");
    });
  }, [loadDirectory]);

  useEffect(() => {
    if (createKind === null) return undefined;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape" && !isCreating) setCreateKind(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [createKind, isCreating]);

  useEffect(() => {
    if (locateRequestId === 0 || currentFilePath === null) return undefined;
    let secondFrame = 0;
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        bodyRef.current
          ?.querySelector<HTMLElement>(`[data-configuration-path="${CSS.escape(currentFilePath)}"]`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });
    return () => {
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [currentFilePath, entriesByDirectory, locateRequestId]);

  function toggleDirectory(path: string): void {
    const isExpanded = expandedDirectories.has(path);
    setSelectedPath(path);
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!isExpanded) void loadDirectory(path);
  }

  async function expandAllDirectories(): Promise<void> {
    setIsExpandingAll(true);
    try {
      const nextEntries: Record<string, readonly ConfigurationWorkspaceEntry[]> = {};
      const nextExpanded = new Set<string>();
      const pendingDirectories = [""];

      while (pendingDirectories.length > 0) {
        const directoryPath = pendingDirectories.shift();
        if (directoryPath === undefined) continue;
        const listing = await agentClient.listConfigurationWorkspaceEntries({
          configurationId: target.configurationId,
          directoryPath,
          kind: target.kind,
        });
        nextEntries[directoryPath] = listing.entries;
        if (directoryPath === "") setRootPath(listing.rootPath);
        for (const entry of listing.entries) {
          if (entry.kind !== "directory") continue;
          nextExpanded.add(entry.path);
          pendingDirectories.push(entry.path);
        }
      }

      setEntriesByDirectory(nextEntries);
      setExpandedDirectories(nextExpanded);
      setOperationError(null);
    } catch (reason) {
      setOperationError(getUserErrorMessage(reason, "无法展开配置目录。"));
    } finally {
      setIsExpandingAll(false);
    }
  }

  async function locateCurrentFile(): Promise<void> {
    if (currentFilePath === null) return;
    const ancestorDirectories: string[] = [];
    let directoryPath = parentPath(currentFilePath);
    while (directoryPath.length > 0) {
      ancestorDirectories.unshift(directoryPath);
      directoryPath = parentPath(directoryPath);
    }
    setSelectedPath(currentFilePath);
    setExpandedDirectories((current) => {
      const next = new Set(current);
      for (const path of ancestorDirectories) next.add(path);
      return next;
    });
    await Promise.all(ancestorDirectories.map((path) => loadDirectory(path)));
    setLocateRequestId((current) => current + 1);
  }

  function openCreateDialog(kind: "directory" | "file"): void {
    setOperationError(null);
    setDraftName("");
    setCreateKind(kind);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (createKind === null || isCreating) return;
    const name = draftName.trim();
    if (!isSafeEntryName(name)) {
      setOperationError("名称不能包含路径分隔符，且不能是 . 或 ..。");
      return;
    }

    setIsCreating(true);
    try {
      const created = await agentClient.createConfigurationWorkspaceEntry({
        configurationId: target.configurationId,
        entryKind: createKind,
        kind: target.kind,
        path: entryPath(selectedDirectoryPath, name),
      });
      await loadDirectory(selectedDirectoryPath);
      if (created.kind === "directory") {
        setSelectedPath(created.path);
        setExpandedDirectories((current) => new Set(current).add(created.path));
        await loadDirectory(created.path);
      } else {
        onOpenFile(created.path);
      }
      setCreateKind(null);
    } catch (reason) {
      setOperationError(getUserErrorMessage(reason, "无法新建配置项目。"));
    } finally {
      setIsCreating(false);
    }
  }

  async function deleteSelected(): Promise<void> {
    if (selectedEntry === null || selectedEntry.isProtected) return;
    if (!window.confirm(`确定删除 ${selectedEntry.name} 吗？`)) return;
    try {
      await agentClient.deleteConfigurationWorkspaceEntry({
        configurationId: target.configurationId,
        kind: target.kind,
        path: selectedEntry.path,
      });
      const parentDirectoryPath = parentPath(selectedEntry.path);
      await loadDirectory(parentDirectoryPath);
      setEntriesByDirectory((current) => Object.fromEntries(
        Object.entries(current).filter(([directoryPath]) => (
          directoryPath !== selectedEntry.path && !directoryPath.startsWith(`${selectedEntry.path}/`)
        )),
      ));
      setExpandedDirectories((current) => new Set(
        [...current].filter((directoryPath) => (
          directoryPath !== selectedEntry.path && !directoryPath.startsWith(`${selectedEntry.path}/`)
        )),
      ));
      setSelectedPath(null);
      onDeleteEntry(selectedEntry.path);
    } catch (reason) {
      setOperationError(getUserErrorMessage(reason, "无法删除配置项目。"));
    }
  }

  const rootEntries = entriesByDirectory[""] ?? [];
  const visibleRootEntries = sortEntries(filterEntries(rootEntries, query), sortOption);

  return (
    <section
      aria-labelledby="configuration-workspace-tree-heading"
      className="project-tree-panel configuration-workspace-tree-panel"
      data-collapsed={String(isCollapsed)}
    >
      <header className="project-tree-panel__header">
        <div className="project-tree-panel__heading-row">
          <div>
            <p className="panel-eyebrow">工作区文件</p>
            <h2 id="configuration-workspace-tree-heading" title={target.title}>{target.title}</h2>
          </div>
        </div>

        {!isCollapsed ? (
          <div className="project-tree-panel__toolbar">
            <div className="project-tree-panel__toolbar-group">
              <IconButton
                className="project-tree-panel__tool-button"
                label="新建文件"
                size="compact"
                variant="quiet"
                onClick={() => openCreateDialog("file")}
              >
                <FilePlus aria-hidden="true" size={16} />
              </IconButton>
              <IconButton
                className="project-tree-panel__tool-button"
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
                        aria-checked={option.value === sortOption}
                        key={option.value}
                        role="menuitemradio"
                        type="button"
                        onClick={() => {
                          setSortOption(option.value);
                          setSortOpen(false);
                        }}
                      >
                        <span className="project-tree-panel__sort-option">
                          {option.value === "name-ascending" ? (
                            <ArrowDownAZ aria-hidden="true" size={15} />
                          ) : (
                            <ArrowDownZA aria-hidden="true" size={15} />
                          )}
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
                onClick={() => void locateCurrentFile()}
              >
                <LocateFixed aria-hidden="true" size={16} />
              </IconButton>
              <IconButton
                className="project-tree-panel__tool-button"
                disabled={selectedEntry === null || selectedEntry.isProtected}
                label={selectedEntry?.isProtected ? "入口文件不可删除" : "删除所选项目"}
                size="compact"
                variant="quiet"
                onClick={() => void deleteSelected()}
              >
                <Trash2 aria-hidden="true" size={15} />
              </IconButton>
            </div>
            <IconButton
              className="project-tree-panel__tool-button"
              disabled={!hasDirectories || isExpandingAll}
              label={allDirectoriesCollapsed ? "全部展开目录" : "全部收起目录"}
              size="compact"
              variant="quiet"
              onClick={() => {
                if (allDirectoriesCollapsed) void expandAllDirectories();
                else setExpandedDirectories(new Set());
              }}
            >
              {allDirectoriesCollapsed ? (
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
              placeholder="搜索文件名"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query.length > 0 ? (
              <button
                aria-label="清除文件筛选"
                type="button"
                onClick={() => setQuery("")}
              >
                <X aria-hidden="true" size={13} />
              </button>
            ) : null}
          </label>
        ) : null}
      </header>

      {operationError === null ? null : (
        <p className="configuration-workspace-tree-panel__error" role="alert">{operationError}</p>
      )}

      {!isCollapsed ? (
        <div className="project-tree-panel__body" ref={bodyRef}>
          {loadingDirectories.has("") && rootEntries.length === 0 ? (
            <ConfigurationWorkspaceEmpty label="正在读取配置目录…" loading />
          ) : rootEntries.length === 0 ? (
            <ConfigurationWorkspaceEmpty label={query.length > 0 ? "没有匹配的已加载文件。" : "该配置目录为空。"} />
          ) : (
            <ul
              aria-label={`${target.title} 文件树`}
              className="project-tree"
              role="tree"
            >
              {visibleRootEntries.map((entry) => (
                <ConfigurationWorkspaceTreeNode
                  currentFilePath={currentFilePath}
                  depth={0}
                  entriesByDirectory={entriesByDirectory}
                  entry={entry}
                  expandedDirectories={expandedDirectories}
                  key={entry.path}
                  loadingDirectories={loadingDirectories}
                  query={query}
                  selectedPath={selectedPath}
                  sortOption={sortOption}
                  onOpenFile={(path) => {
                    setSelectedPath(path);
                    onOpenFile(path);
                  }}
                  onSelectDirectory={setSelectedPath}
                  onToggleDirectory={toggleDirectory}
                />
              ))}
              {visibleRootEntries.length === 0 ? (
                <li className="project-tree__message" role="none">没有匹配项</li>
              ) : null}
            </ul>
          )}
        </div>
      ) : null}

      {!isCollapsed ? (
        <footer className="project-tree-panel__footer" title={rootPath}>
          {rootPath || "正在定位配置目录"}
        </footer>
      ) : null}

      {createKind !== null ? createPortal(
        <div
          className="project-tree-panel__dialog-backdrop"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !isCreating) setCreateKind(null);
          }}
        >
          <form
            aria-labelledby="configuration-workspace-create-title"
            className="project-tree-panel__dialog"
            role="dialog"
            onSubmit={(event) => void submitCreate(event)}
          >
            <h2 id="configuration-workspace-create-title">
              {createKind === "file" ? "新建文件" : "新建文件夹"}
            </h2>
            <p title={selectedDirectoryPath || "配置目录根路径"}>
              位置：{selectedDirectoryPath || "配置目录根路径"}
            </p>
            <input
              autoFocus
              aria-label={createKind === "file" ? "文件名" : "文件夹名"}
              disabled={isCreating}
              placeholder={createKind === "file" ? "文件名" : "文件夹名"}
              value={draftName}
              onChange={(event) => setDraftName(event.target.value)}
            />
            {operationError !== null ? (
              <div className="project-tree-panel__dialog-error" role="alert">
                {operationError}
              </div>
            ) : null}
            <div className="project-tree-panel__dialog-actions">
              <button disabled={isCreating} type="button" onClick={() => setCreateKind(null)}>
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

function ConfigurationWorkspaceTreeNode({
  currentFilePath,
  depth,
  entriesByDirectory,
  entry,
  expandedDirectories,
  loadingDirectories,
  query,
  selectedPath,
  sortOption,
  onOpenFile,
  onSelectDirectory,
  onToggleDirectory,
}: {
  currentFilePath: string | null;
  depth: number;
  entriesByDirectory: Record<string, readonly ConfigurationWorkspaceEntry[]>;
  entry: ConfigurationWorkspaceEntry;
  expandedDirectories: ReadonlySet<string>;
  loadingDirectories: ReadonlySet<string>;
  query: string;
  selectedPath: string | null;
  sortOption: ConfigurationTreeSortOption;
  onOpenFile: (path: string) => void;
  onSelectDirectory: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}): ReactElement {
  const isDirectory = entry.kind === "directory";
  const isExpanded = expandedDirectories.has(entry.path);
  const visibleChildren = sortEntries(
    filterEntries(entriesByDirectory[entry.path] ?? [], query),
    sortOption,
  );
  const isSelected = selectedPath === entry.path || currentFilePath === entry.path;

  return (
    <li
      aria-expanded={isDirectory ? isExpanded : undefined}
      aria-level={depth + 1}
      className="project-tree__node"
      role="treeitem"
    >
      <div
        className="project-tree__row"
        data-configuration-path={entry.path}
        data-selected={isSelected}
        style={{ paddingInlineStart: `${6 + depth * 14}px` }}
      >
        {isDirectory ? (
          <button
            aria-label={isExpanded ? `收起 ${entry.name}` : `展开 ${entry.name}`}
            className="project-tree__toggle"
            type="button"
            onClick={() => onToggleDirectory(entry.path)}
          >
            {loadingDirectories.has(entry.path) ? (
              <LoaderCircle aria-hidden="true" className="project-tree-panel__spin" size={14} />
            ) : isExpanded ? (
              <ChevronDown aria-hidden="true" size={14} />
            ) : (
              <ChevronRight aria-hidden="true" size={14} />
            )}
          </button>
        ) : (
          <span aria-hidden="true" className="project-tree__toggle-placeholder" />
        )}
        <button
          className="project-tree__entry"
          title={entry.path}
          type="button"
          onClick={() => {
            if (isDirectory) {
              onSelectDirectory(entry.path);
              onToggleDirectory(entry.path);
            } else {
              onOpenFile(entry.path);
            }
          }}
        >
          {isDirectory ? (
            isExpanded ? <FolderOpen aria-hidden="true" size={16} /> : <Folder aria-hidden="true" size={16} />
          ) : (
            <FileTypeIcon path={entry.path} size={16} />
          )}
          <span>{entry.name}</span>
          {entry.isProtected ? <small className="configuration-workspace-tree-panel__entry-badge">入口</small> : null}
        </button>
      </div>

      {isDirectory && isExpanded ? (
        <ul className="project-tree" role="group">
          {visibleChildren.length === 0
            && !loadingDirectories.has(entry.path)
            && query.length > 0 ? (
            <li className="project-tree__message" role="none">
              没有匹配项
            </li>
          ) : (
            visibleChildren.map((child) => (
              <ConfigurationWorkspaceTreeNode
                currentFilePath={currentFilePath}
                depth={depth + 1}
                entriesByDirectory={entriesByDirectory}
                entry={child}
                expandedDirectories={expandedDirectories}
                key={child.path}
                loadingDirectories={loadingDirectories}
                query={query}
                selectedPath={selectedPath}
                sortOption={sortOption}
                onOpenFile={onOpenFile}
                onSelectDirectory={onSelectDirectory}
                onToggleDirectory={onToggleDirectory}
              />
            ))
          )}
        </ul>
      ) : null}
    </li>
  );
}

function ConfigurationWorkspaceEmpty({
  label,
  loading = false,
}: {
  label: string;
  loading?: boolean;
}): ReactElement {
  return (
    <div className="project-tree-panel__empty" data-loading={String(loading)}>
      {loading ? <LoaderCircle aria-hidden="true" size={17} /> : <Folder aria-hidden="true" size={19} />}
      <p>{label}</p>
    </div>
  );
}
