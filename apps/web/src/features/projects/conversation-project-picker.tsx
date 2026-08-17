import {
  Check,
  ChevronDown,
  Folder,
  FolderPlus,
  MessageSquareText,
  Search,
  X,
} from "lucide-react";
import {
  useMemo,
  useState,
  type ReactElement,
} from "react";

import type { ProjectSummary } from "@agent/protocol";

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import "./conversation-project-picker.css";

type ConversationProjectPickerProps = {
  canAddProjects: boolean;
  disabled: boolean;
  isAddingProject: boolean;
  projects: readonly ProjectSummary[];
  selectedProjectId: string | null;
  onAddProject: () => Promise<ProjectSummary | null>;
  onProjectChange: (projectId: string | null) => Promise<boolean>;
};

export function ConversationProjectPicker({
  canAddProjects,
  disabled,
  isAddingProject,
  projects,
  selectedProjectId,
  onAddProject,
  onProjectChange,
}: ConversationProjectPickerProps): ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [isChangingProject, setIsChangingProject] = useState(false);
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId,
  ) ?? null;
  const visibleProjects = useMemo(
    () =>
      projects
        .filter((project) =>
          normalizedQuery.length === 0 ||
          project.name.toLocaleLowerCase().includes(normalizedQuery),
        )
        .toSorted(
          (left, right) =>
            Number(right.isPinned === true) - Number(left.isPinned === true),
        ),
    [normalizedQuery, projects],
  );

  function closePicker(): void {
    setOpen(false);
    setQuery("");
  }

  async function selectProject(projectId: string | null): Promise<void> {
    if (disabled || isAddingProject || isChangingProject) return;
    if (projectId === selectedProjectId) {
      closePicker();
      return;
    }
    setIsChangingProject(true);
    const changed = await onProjectChange(projectId);
    setIsChangingProject(false);
    if (changed) closePicker();
  }

  async function addProjectAndSelect(): Promise<void> {
    if (!canAddProjects || disabled || isAddingProject || isChangingProject) return;
    const project = await onAddProject();
    if (project !== null) await selectProject(project.id);
  }

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (nextOpen) setQuery("");
      }}
    >
      <PopoverTrigger asChild>
        <button
          aria-label="选择对话项目"
          className="conversation-project-picker__trigger"
          disabled={disabled || isAddingProject || isChangingProject}
          type="button"
        >
          {selectedProject === null ? (
            <MessageSquareText aria-hidden="true" size={14} />
          ) : (
            <Folder aria-hidden="true" size={14} />
          )}
          <span>{selectedProject?.name ?? "不选项目"}</span>
          <ChevronDown aria-hidden="true" size={13} />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="conversation-project-picker"
        collisionPadding={8}
        side="top"
        sideOffset={5}
      >
        <label className="conversation-project-picker__search app-search-field">
          <Search aria-hidden="true" size={14} />
          <input
            aria-label="搜索项目"
            autoFocus
            placeholder="搜索项目"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {query.length > 0 ? (
            <button aria-label="清除项目搜索" type="button" onClick={() => setQuery("")}>
              <X aria-hidden="true" size={13} />
            </button>
          ) : null}
        </label>

        <div className="conversation-project-picker__projects" role="menu">
          {visibleProjects.length > 0 ? (
            visibleProjects.map((project) => (
              <button
                key={project.id}
                disabled={disabled || isAddingProject || isChangingProject}
                role="menuitem"
                type="button"
                onClick={() => void selectProject(project.id)}
              >
                <Folder aria-hidden="true" size={16} />
                <span>{project.name}</span>
                {project.id === selectedProjectId ? (
                  <Check aria-label="当前项目" size={15} />
                ) : null}
              </button>
            ))
          ) : (
            <p>没有匹配的项目</p>
          )}
        </div>

        <div className="conversation-project-picker__separator" role="separator" />
        <button
          className="conversation-project-picker__action"
          disabled={!canAddProjects || disabled || isAddingProject || isChangingProject}
          title={canAddProjects ? "添加项目" : "添加项目（仅桌面端可用）"}
          type="button"
          onClick={() => void addProjectAndSelect()}
        >
          <FolderPlus aria-hidden="true" size={16} />
          <span>{isAddingProject ? "正在添加项目" : "添加项目"}</span>
        </button>
        <button
          className="conversation-project-picker__action"
          disabled={disabled || isAddingProject || isChangingProject}
          type="button"
          onClick={() => void selectProject(null)}
        >
          <MessageSquareText aria-hidden="true" size={16} />
          <span>不选项目</span>
          {selectedProjectId === null ? <Check aria-label="当前选择" size={15} /> : null}
        </button>
      </PopoverContent>
    </Popover>
  );
}
