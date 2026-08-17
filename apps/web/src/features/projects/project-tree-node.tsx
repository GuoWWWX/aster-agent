import {
  ChevronDown,
  ChevronRight,
  FileSymlink,
  Folder,
  FolderOpen,
} from "lucide-react";
import type { DragEvent, ReactElement } from "react";

import type { ProjectEntry } from "@agent/protocol";

import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import {
  filterProjectEntries,
  sortProjectEntries,
  type DirectoryStates,
  type ProjectTreeSortOption,
} from "./project-tree-model.js";

type ProjectTreeNodeProps = {
  customOrders: Readonly<Record<string, readonly string[] | undefined>>;
  depth: number;
  directories: DirectoryStates;
  draggingPath: string | null;
  dropIndicator: { path: string; position: "after" | "before" } | null;
  entry: ProjectEntry;
  expandedDirectories: ReadonlySet<string>;
  locatedPath: string | null;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLElement>, entry: ProjectEntry, parentPath: string) => void;
  onDragStart: (event: DragEvent<HTMLElement>, entry: ProjectEntry, parentPath: string) => void;
  onDrop: (
    event: DragEvent<HTMLElement>,
    entry: ProjectEntry,
    parentPath: string,
    siblings: readonly ProjectEntry[],
  ) => void;
  onReload: (directoryPath: string) => void;
  onOpenFile: (entry: ProjectEntry) => void;
  onSelect: (path: string) => void;
  onToggle: (directoryPath: string) => void;
  parentPath: string;
  query: string;
  selectedPath: string | null;
  sortOption: ProjectTreeSortOption;
};

export function ProjectTreeNode({
  customOrders,
  depth,
  directories,
  draggingPath,
  dropIndicator,
  entry,
  expandedDirectories,
  locatedPath,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onReload,
  onOpenFile,
  onSelect,
  onToggle,
  parentPath,
  query,
  selectedPath,
  sortOption,
}: ProjectTreeNodeProps): ReactElement {
  const isDirectory = entry.kind === "directory";
  const isExpanded = expandedDirectories.has(entry.path);
  const childState = directories[entry.path];
  const visibleChildren = sortProjectEntries(
    filterProjectEntries(childState?.entries ?? [], query),
    sortOption,
    customOrders[entry.path],
  );
  const isSelected = selectedPath === entry.path;
  const isLocated = locatedPath === entry.path;
  const DirectoryIcon =
    entry.kind === "directory"
      ? isExpanded
        ? FolderOpen
        : Folder
      : null;

  return (
    <li
      aria-expanded={isDirectory ? isExpanded : undefined}
      aria-level={depth + 1}
      className="project-tree__node"
      role="treeitem"
    >
      <div
        className="project-tree__row"
        data-dragging={draggingPath === entry.path}
        data-drop-position={dropIndicator?.path === entry.path ? dropIndicator.position : undefined}
        data-located={isLocated}
        data-selected={isSelected}
        data-project-path={entry.path}
        draggable={sortOption === "custom" && query.length === 0}
        style={{ paddingInlineStart: `${6 + depth * 14}px` }}
        onDragEnd={onDragEnd}
        onDragOver={(event) => onDragOver(event, entry, parentPath)}
        onDragStart={(event) => onDragStart(event, entry, parentPath)}
        onDrop={(event) => onDrop(
          event,
          entry,
          parentPath,
          directories[parentPath]?.entries ?? [],
        )}
      >
        {isDirectory ? (
          <button
            aria-label={isExpanded ? `收起 ${entry.name}` : `展开 ${entry.name}`}
            className="project-tree__toggle"
            type="button"
            onClick={() => onToggle(entry.path)}
          >
            {isExpanded ? (
              <ChevronDown aria-hidden="true" size={14} />
            ) : (
              <ChevronRight aria-hidden="true" size={14} />
            )}
          </button>
        ) : (
          <span className="project-tree__toggle-placeholder" aria-hidden="true" />
        )}
        <button
          className="project-tree__entry"
          title={entry.path}
          type="button"
          onClick={() => {
            onSelect(entry.path);
            if (isDirectory) {
              onToggle(entry.path);
            } else {
              onOpenFile(entry);
            }
          }}
        >
          {DirectoryIcon !== null ? (
            <DirectoryIcon aria-hidden="true" size={16} />
          ) : entry.kind === "symlink" ? (
            <FileSymlink aria-hidden="true" size={16} />
          ) : (
            <FileTypeIcon
              javaDeclarationKind={entry.javaDeclarationKind}
              path={entry.path}
              size={16}
            />
          )}
          <span>{entry.name}</span>
        </button>
      </div>

      {isDirectory && isExpanded ? (
        <ul className="project-tree" role="group">
          {childState?.errorMessage ? (
            <li className="project-tree__message" role="none">
              <span>读取失败</span>
              <button type="button" onClick={() => onReload(entry.path)}>
                重试
              </button>
            </li>
          ) : visibleChildren.length === 0 && !childState?.isLoading ? (
            <li className="project-tree__message" role="none">
              {query.length > 0 ? "没有匹配项" : "空目录"}
            </li>
          ) : (
            visibleChildren.map((child) => (
              <ProjectTreeNode
                key={child.path}
                customOrders={customOrders}
                depth={depth + 1}
                directories={directories}
                draggingPath={draggingPath}
                dropIndicator={dropIndicator}
                entry={child}
                expandedDirectories={expandedDirectories}
                locatedPath={locatedPath}
                onDragEnd={onDragEnd}
                onDragOver={onDragOver}
                onDragStart={onDragStart}
                onDrop={onDrop}
                onReload={onReload}
                onOpenFile={onOpenFile}
                onSelect={onSelect}
                onToggle={onToggle}
                parentPath={entry.path}
                query={query}
                selectedPath={selectedPath}
                sortOption={sortOption}
              />
            ))
          )}
          {childState?.truncated ? (
            <li className="project-tree__message" role="none">
              当前目录仅显示前 1000 项。
            </li>
          ) : null}
        </ul>
      ) : null}
    </li>
  );
}
