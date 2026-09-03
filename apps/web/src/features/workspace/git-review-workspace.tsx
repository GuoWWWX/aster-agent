import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  Ellipsis,
  GitBranch,
  GitBranchPlus,
  GitCommitHorizontal,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from "react";

import type {
  GitFileDiff,
  GitOperationInput,
  GitReviewSnapshot,
  GitWorkingTreeChange,
} from "@agent/protocol";

import { createDiffPresentation, DiffView } from "../../components/diff/diff-view.js";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { TooltipAnchor } from "../../components/ui/tooltip.js";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "../../components/ui/popover.js";
import { cn } from "../../lib/cn.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import type { GitReviewCache } from "./git-review-cache.js";

import "./git-review-workspace.css";

type ReviewDialog = "branch" | null;

export type GitChangeKeyboardSelection = {
  anchorPath: string;
  focusPath: string;
  initiallySelectedPaths: ReadonlySet<string>;
};

const DEFAULT_DIFF_CONTEXT_LINES = 3;
export const EXPANDED_DIFF_CONTEXT_LINES = 120;
const COMMIT_PANEL_DEFAULT_HEIGHT = 208;
const COMMIT_PANEL_MIN_HEIGHT = 155;
const COMMIT_PANEL_MIN_REVIEW_HEIGHT = 150;
const COMMIT_PANEL_MAX_HEIGHT = 480;

export function clampCommitPanelHeight(height: number, workspaceHeight: number): number {
  const max = Math.max(
    COMMIT_PANEL_MIN_HEIGHT,
    Math.min(COMMIT_PANEL_MAX_HEIGHT, workspaceHeight - COMMIT_PANEL_MIN_REVIEW_HEIGHT),
  );
  return Math.min(max, Math.max(COMMIT_PANEL_MIN_HEIGHT, Math.round(height)));
}

export function toggleGitChangeSelection(
  selectedPaths: ReadonlySet<string>,
  path: string,
): Set<string> {
  const next = new Set(selectedPaths);
  if (next.has(path)) next.delete(path);
  else next.add(path);
  return next;
}

export function allGitChangePathsSelected(
  selectedPaths: ReadonlySet<string>,
  paths: readonly string[],
): boolean {
  return paths.length > 0 && paths.every((path) => selectedPaths.has(path));
}

export function toggleGitChangeGroupSelection(
  selectedPaths: ReadonlySet<string>,
  paths: readonly string[],
): Set<string> {
  const next = new Set(selectedPaths);
  const selectAll = !allGitChangePathsSelected(selectedPaths, paths);
  for (const path of paths) {
    if (selectAll) next.add(path);
    else next.delete(path);
  }
  return next;
}

export function extendGitChangeSelection(
  selectedPaths: ReadonlySet<string>,
  groupPaths: readonly string[],
  path: string,
  direction: -1 | 1,
  keyboardSelection: GitChangeKeyboardSelection | null,
): {
  keyboardSelection: GitChangeKeyboardSelection;
  nextPath: string | null;
  selectedPaths: Set<string>;
} {
  const currentIndex = groupPaths.indexOf(path);
  const canContinueSelection = keyboardSelection !== null
    && keyboardSelection.focusPath === path
    && groupPaths.includes(keyboardSelection.anchorPath)
    && groupPaths.includes(keyboardSelection.focusPath);
  const currentSelection = canContinueSelection
    ? keyboardSelection
    : {
        anchorPath: path,
        focusPath: path,
        initiallySelectedPaths: new Set(selectedPaths),
      };
  if (currentIndex === -1) {
    return {
      keyboardSelection: currentSelection,
      nextPath: null,
      selectedPaths: new Set(selectedPaths),
    };
  }

  const nextPath = groupPaths[currentIndex + direction] ?? null;
  if (nextPath === null) {
    return {
      keyboardSelection: currentSelection,
      nextPath: null,
      selectedPaths: new Set(selectedPaths),
    };
  }

  const anchorIndex = groupPaths.indexOf(currentSelection.anchorPath);
  const rangePaths = (start: number, end: number): readonly string[] => groupPaths.slice(
    Math.min(start, end),
    Math.max(start, end) + 1,
  );
  const previousRange = rangePaths(anchorIndex, currentIndex);
  const nextRange = new Set(rangePaths(anchorIndex, currentIndex + direction));
  const nextSelectedPaths = new Set(selectedPaths);
  for (const candidate of previousRange) {
    if (!nextRange.has(candidate) && !currentSelection.initiallySelectedPaths.has(candidate)) {
      nextSelectedPaths.delete(candidate);
    }
  }
  for (const candidate of nextRange) nextSelectedPaths.add(candidate);
  return {
    keyboardSelection: { ...currentSelection, focusPath: nextPath },
    nextPath,
    selectedPaths: nextSelectedPaths,
  };
}

function changeLabel(change: GitWorkingTreeChange): string {
  const status = change.status.trim();
  if (status.includes("?")) return "新增";
  if (status.includes("D")) return "删除";
  if (status.includes("R")) return "重命名";
  if (status.includes("A")) return "新增";
  return "修改";
}

function changeLabelTone(change: GitWorkingTreeChange): string {
  const label = changeLabel(change);
  if (label === "新增") return "text-emerald-600 dark:text-emerald-400";
  if (label === "删除") return "text-red-600 dark:text-red-400";
  return "text-[var(--app-accent)]";
}

function splitPath(path: string): { directory: string; name: string } {
  const separator = path.lastIndexOf("/");
  return separator === -1
    ? { directory: "", name: path }
    : { directory: path.slice(0, separator), name: path.slice(separator + 1) };
}

export function GitReviewWorkspace({
  active,
  agentClient,
  gitReviewCache,
  projectId,
}: {
  active: boolean;
  agentClient: AgentClient;
  gitReviewCache: GitReviewCache;
  projectId: string;
}): ReactElement {
  const [dialog, setDialog] = useState<ReviewDialog>(null);
  const [branchName, setBranchName] = useState("");
  const [branchPickerOpen, setBranchPickerOpen] = useState(false);
  const [branchMenu, setBranchMenu] = useState<string | null>(null);
  const [branchQuery, setBranchQuery] = useState("");
  const [branchStartPoint, setBranchStartPoint] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [commitPanelHeight, setCommitPanelHeight] = useState(COMMIT_PANEL_DEFAULT_HEIGHT);
  const [isCommitPanelResizing, setIsCommitPanelResizing] = useState(false);
  const [diff, setDiff] = useState<GitFileDiff | null>(null);
  const [diffContextLines, setDiffContextLines] = useState(DEFAULT_DIFF_CONTEXT_LINES);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(() => gitReviewCache.peekSnapshot(projectId) === null);
  const [operation, setOperation] = useState<string | null>(null);
  const [keyboardSelection, setKeyboardSelection] = useState<GitChangeKeyboardSelection | null>(null);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(() => new Set());
  const [snapshot, setSnapshot] = useState<GitReviewSnapshot | null>(() => (
    gitReviewCache.peekSnapshot(projectId)
  ));
  const [toolbarMenuOpen, setToolbarMenuOpen] = useState(false);
  const [trackedExpanded, setTrackedExpanded] = useState(true);
  const [untrackedExpanded, setUntrackedExpanded] = useState(true);
  const commitMessageRef = useRef<HTMLTextAreaElement | null>(null);
  const commitPanelResizeCleanupRef = useRef<(() => void) | null>(null);
  const diffRequestRef = useRef(0);
  const selectedPathRef = useRef<string | null>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);
  const changeButtonRefs = useRef(new Map<string, HTMLButtonElement>());

  const getCommitPanelMaxHeight = useCallback((): number => (
    clampCommitPanelHeight(
      Number.POSITIVE_INFINITY,
      workspaceRef.current?.clientHeight ?? COMMIT_PANEL_DEFAULT_HEIGHT + COMMIT_PANEL_MIN_REVIEW_HEIGHT,
    )
  ), []);

  const setClampedCommitPanelHeight = useCallback((height: number): void => {
    setCommitPanelHeight(clampCommitPanelHeight(
      height,
      workspaceRef.current?.clientHeight ?? COMMIT_PANEL_DEFAULT_HEIGHT + COMMIT_PANEL_MIN_REVIEW_HEIGHT,
    ));
  }, []);

  useEffect(() => () => commitPanelResizeCleanupRef.current?.(), []);

  const requestDiff = useCallback((
    path: string,
    contextLines = DEFAULT_DIFF_CONTEXT_LINES,
  ): Promise<GitFileDiff> => (
    gitReviewCache.getFileDiff(projectId, path, contextLines)
  ), [gitReviewCache, projectId]);

  const loadDiff = useCallback(async (
    path: string | null,
    contextLines = DEFAULT_DIFF_CONTEXT_LINES,
  ): Promise<void> => {
    const request = diffRequestRef.current + 1;
    diffRequestRef.current = request;
    selectedPathRef.current = path;
    setSelectedPath(path);
    setDiffContextLines(contextLines);
    if (path === null) {
      setDiff(null);
      return;
    }
    const cached = gitReviewCache.peekFileDiff(projectId, path, contextLines);
    setDiff(cached);
    if (cached !== null) return;
    try {
      const next = await requestDiff(path, contextLines);
      if (diffRequestRef.current === request) setDiff(next);
    } catch (reason) {
      if (diffRequestRef.current === request) {
        setError(getUserErrorMessage(reason, "无法读取文件差异。"));
      }
    }
  }, [gitReviewCache, projectId, requestDiff]);

  const applySnapshot = useCallback((next: GitReviewSnapshot): void => {
    setSnapshot(next);
    setKeyboardSelection(null);
    setSelectedPaths((current) => {
      const availablePaths = new Set(next.changes.map((change) => change.path));
      const retainedPaths = new Set([...current].filter((path) => availablePaths.has(path)));
      return retainedPaths.size === current.size ? current : retainedPaths;
    });
    const selectedPath = selectedPathRef.current;
    const path = selectedPath !== null && next.changes.some((change) => change.path === selectedPath)
      ? selectedPath
      : null;
    void loadDiff(path);
  }, [loadDiff]);

  const toggleDiff = useCallback((path: string): void => {
    if (selectedPath === path) {
      diffRequestRef.current += 1;
      selectedPathRef.current = null;
      setSelectedPath(null);
      setDiff(null);
      setDiffContextLines(DEFAULT_DIFF_CONTEXT_LINES);
      return;
    }
    void loadDiff(path);
  }, [loadDiff, selectedPath]);

  const expandDiffContext = useCallback((): void => {
    if (selectedPath === null || diffContextLines >= EXPANDED_DIFF_CONTEXT_LINES) return;
    void loadDiff(selectedPath, EXPANDED_DIFF_CONTEXT_LINES);
  }, [diffContextLines, loadDiff, selectedPath]);

  const handleCommitPanelResizePointerDown = useCallback((
    event: ReactPointerEvent<HTMLDivElement>,
  ): void => {
    if (event.button !== 0) return;

    event.preventDefault();
    const divider = event.currentTarget;
    const originY = event.clientY;
    const baseHeight = commitPanelHeight;
    divider.setPointerCapture(event.pointerId);
    setIsCommitPanelResizing(true);

    const stop = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", stop);
      window.removeEventListener("pointercancel", stop);
      commitPanelResizeCleanupRef.current = null;
      setIsCommitPanelResizing(false);
    };
    const move = (moveEvent: PointerEvent): void => {
      setClampedCommitPanelHeight(baseHeight - (moveEvent.clientY - originY));
    };

    commitPanelResizeCleanupRef.current?.();
    commitPanelResizeCleanupRef.current = stop;
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", stop);
    window.addEventListener("pointercancel", stop);
  }, [commitPanelHeight, setClampedCommitPanelHeight]);

  const handleCommitPanelResizeKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>): void => {
    const step = 16;
    if (event.key === "Home") {
      event.preventDefault();
      setClampedCommitPanelHeight(COMMIT_PANEL_MIN_HEIGHT);
      return;
    }
    if (event.key === "End") {
      event.preventDefault();
      setClampedCommitPanelHeight(getCommitPanelMaxHeight());
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setClampedCommitPanelHeight(commitPanelHeight + step);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setClampedCommitPanelHeight(commitPanelHeight - step);
    }
  }, [commitPanelHeight, getCommitPanelMaxHeight, setClampedCommitPanelHeight]);

  const refresh = useCallback(async (): Promise<void> => {
    setIsLoading(true);
    setError(null);
    try {
      await gitReviewCache.refreshProject(projectId, { invalidateDiffs: true });
    } catch (reason) {
      setError(getUserErrorMessage(reason, "无法读取 Git 变更。"));
    } finally {
      setIsLoading(false);
    }
  }, [gitReviewCache, projectId]);

  const runOperation = useCallback(async (input: GitOperationInput): Promise<boolean> => {
    setOperation(input.action);
    setError(null);
    try {
      const next = await agentClient.runGitOperation(input);
      gitReviewCache.replaceSnapshot(projectId, next, { invalidateDiffs: true });
      return true;
    } catch (reason) {
      setError(getUserErrorMessage(reason, "Git 操作失败。"));
      return false;
    } finally {
      setOperation(null);
    }
  }, [agentClient, gitReviewCache, projectId]);

  useEffect(() => {
    return gitReviewCache.subscribe(projectId, applySnapshot);
  }, [applySnapshot, gitReviewCache, projectId]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    void gitReviewCache.warmProject(projectId).catch((reason: unknown) => {
      if (!disposed) setError(getUserErrorMessage(reason, "无法读取 Git 变更。"));
    }).finally(() => {
      if (!disposed) setIsLoading(false);
    });
    return () => {
      disposed = true;
    };
  }, [active, gitReviewCache, projectId]);

  const trackedChanges = snapshot?.changes.filter((change) => !change.status.trim().includes("?")) ?? [];
  const untrackedChanges = snapshot?.changes.filter((change) => change.status.trim().includes("?")) ?? [];
  const selectedChanges = snapshot?.changes.filter((change) => selectedPaths.has(change.path)) ?? [];
  const selectedChangePaths = selectedChanges.map((change) => change.path);
  const selectedTrackedPaths = trackedChanges.filter((change) => selectedPaths.has(change.path)).map((change) => change.path);
  const selectedUntrackedPaths = untrackedChanges.filter((change) => selectedPaths.has(change.path)).map((change) => change.path);
  const additions = snapshot?.changes.reduce((total, change) => total + (change.additions ?? 0), 0) ?? 0;
  const deletions = snapshot?.changes.reduce((total, change) => total + (change.deletions ?? 0), 0) ?? 0;
  const isBusy = operation !== null;
  const allTrackedSelected = allGitChangePathsSelected(selectedPaths, trackedChanges.map((change) => change.path));
  const allUntrackedSelected = allGitChangePathsSelected(selectedPaths, untrackedChanges.map((change) => change.path));
  const normalizedBranchQuery = branchQuery.trim().toLocaleLowerCase();
  const matchingBranches = snapshot?.branches.filter((branch) => [branch.name, branch.upstream ?? "", branch.current ? "当前" : ""]
    .some((value) => value.toLocaleLowerCase().includes(normalizedBranchQuery))) ?? [];
  const selectedChange = snapshot?.changes.find((change) => change.path === selectedPath) ?? null;
  const matchesBranchAction = (label: string): boolean => (
    normalizedBranchQuery.length === 0 || label.toLocaleLowerCase().includes(normalizedBranchQuery)
  );

  const focusCommitMessage = useCallback((): void => {
    setBranchPickerOpen(false);
    requestAnimationFrame(() => commitMessageRef.current?.focus());
  }, []);

  const openCreateBranchDialog = useCallback((startPoint: string | null = snapshot?.branch ?? null): void => {
    setBranchPickerOpen(false);
    setBranchMenu(null);
    setBranchName("");
    setBranchStartPoint(startPoint);
    setDialog("branch");
  }, [snapshot?.branch]);

  const submitCommit = useCallback(async (pushAfterCommit: boolean): Promise<void> => {
    const message = commitMessage.trim();
    if (message.length === 0 || selectedChangePaths.length === 0) return;
    const committed = await runOperation({ action: "commit", message, paths: selectedChangePaths, projectId });
    if (!committed) return;
    setCommitMessage("");
    setSelectedPaths(new Set());
    if (pushAfterCommit) {
      await runOperation({ action: "push", projectId });
    }
  }, [commitMessage, projectId, runOperation, selectedChangePaths]);

  const stageSelected = useCallback(async (paths: readonly string[]): Promise<void> => {
    if (paths.length === 0) return;
    await runOperation({ action: "stageFiles", paths: [...paths], projectId });
  }, [projectId, runOperation]);

  const untrackSelected = useCallback(async (paths: readonly string[]): Promise<void> => {
    if (paths.length === 0) return;
    await runOperation({ action: "untrackFiles", paths: [...paths], projectId });
  }, [projectId, runOperation]);

  const toggleChangeSelection = (path: string): void => {
    const wasSelected = selectedPaths.has(path);
    setKeyboardSelection(wasSelected ? null : {
      anchorPath: path,
      focusPath: path,
      initiallySelectedPaths: new Set(selectedPaths),
    });
    setSelectedPaths((current) => toggleGitChangeSelection(current, path));
  };

  const toggleChangeGroupSelection = (paths: readonly string[]): void => {
    setKeyboardSelection(null);
    setSelectedPaths((current) => toggleGitChangeGroupSelection(current, paths));
  };

  const handleChangeKeyboardSelection = (event: KeyboardEvent<HTMLElement>, path: string): void => {
    if (isBusy || !event.ctrlKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
    event.preventDefault();
    const groupPaths = (trackedChanges.some((change) => change.path === path)
      ? trackedChanges
      : untrackedChanges
    ).map((change) => change.path);
    const selection = extendGitChangeSelection(
      selectedPaths,
      groupPaths,
      path,
      event.key === "ArrowUp" ? -1 : 1,
      keyboardSelection,
    );
    setSelectedPaths(selection.selectedPaths);
    setKeyboardSelection(selection.keyboardSelection);
    const targetPath = selection.nextPath;
    if (targetPath !== null) {
      requestAnimationFrame(() => changeButtonRefs.current.get(targetPath)?.focus());
    }
  };

  const renderChange = (change: GitWorkingTreeChange): ReactElement => {
    const path = splitPath(change.path);
    const expanded = selectedPath === change.path;
    const selected = selectedPaths.has(change.path);
    return (
      <div className="border-b border-[var(--app-border)] last:border-b-0" key={`${change.status}:${change.path}`}>
        <div
          className={cn(
            "group flex min-w-0 items-center gap-0 rounded-[var(--app-radius)] px-1 py-1 text-left hover:bg-[var(--app-hover)]",
            expanded && "bg-[var(--app-selection)] text-[var(--app-selection-foreground)]",
          )}
        >
          <IconButton
            className="size-6"
            label={expanded ? `收起 ${change.path}` : `展开 ${change.path}`}
            onClick={() => toggleDiff(change.path)}
          >
            {expanded
              ? <ChevronDown aria-hidden="true" size={15} />
              : <ChevronRight aria-hidden="true" size={15} />}
          </IconButton>
          <input
            aria-label={selected ? `取消选择 ${change.path}` : `选择 ${change.path}`}
            checked={selected}
            className="ml-0.5 size-3 shrink-0 cursor-pointer accent-[var(--app-accent)] disabled:cursor-default"
            disabled={isBusy}
            type="checkbox"
            onChange={() => toggleChangeSelection(change.path)}
            onKeyDown={(event) => handleChangeKeyboardSelection(event, change.path)}
          />
          <button
            className="ml-2 flex min-w-0 flex-1 items-center gap-2 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
            ref={(element) => {
              if (element === null) changeButtonRefs.current.delete(change.path);
              else changeButtonRefs.current.set(change.path, element);
            }}
            type="button"
            onClick={(event) => {
              if (event.ctrlKey) {
                toggleChangeSelection(change.path);
                return;
              }
              toggleDiff(change.path);
            }}
            onKeyDown={(event) => handleChangeKeyboardSelection(event, change.path)}
          >
            <FileTypeIcon className="shrink-0" path={change.path} size={16} />
            <TooltipAnchor content={change.path}>
              <span className="min-w-0 flex-1 truncate text-xs font-medium">{path.name}</span>
            </TooltipAnchor>
            {path.directory.length > 0 ? (
              <span className="git-review-change-directory min-w-0 max-w-[42%] truncate text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{path.directory}</span>
            ) : null}
            <span className={cn("git-review-change-status shrink-0 text-[length:var(--app-font-size-caption)] font-medium", changeLabelTone(change))}>
              {changeLabel(change)}
            </span>
          </button>
          <span className="flex shrink-0 items-center gap-1.5 px-1 text-[length:var(--app-font-size-caption)]">
            {change.additions === null || change.deletions === null ? (
              <span className="text-[var(--app-muted-foreground)]">二进制</span>
            ) : (
              <>
                <span className="text-emerald-600 dark:text-emerald-400">+{change.additions}</span>
                <span className="text-red-600 dark:text-red-400">-{change.deletions}</span>
              </>
            )}
          </span>
        </div>
        {expanded ? (
          <div className="git-review-inline-diff">
            <DiffViewer
              diff={diff}
              expandedContext={diffContextLines >= EXPANDED_DIFF_CONTEXT_LINES}
              selectedPath={selectedPath}
              onExpandContext={expandDiffContext}
            />
          </div>
        ) : null}
      </div>
    );
  };

  return (
    <section ref={workspaceRef} className="git-review-workspace flex h-full min-h-0 w-full flex-col bg-[var(--app-panel)]" aria-label="Git 审阅">
      <header className="flex min-h-11 flex-none items-center gap-2 border-b border-[var(--app-border)] px-2.5">
        <Popover open={branchPickerOpen} onOpenChange={(open) => {
          setBranchPickerOpen(open);
          if (!open) {
            setBranchMenu(null);
            setBranchQuery("");
          }
        }}>
          <TooltipAnchor
            content={snapshot?.branch ?? "选择分支"}
            disabled={isBusy || snapshot?.branch === null}
          >
            <PopoverTrigger asChild>
              <button
                className="git-review-branch-trigger flex h-8 min-w-0 shrink items-center gap-2 rounded-[var(--app-radius)] px-2 text-left text-xs font-medium outline-none hover:bg-[var(--app-hover)] focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)] disabled:pointer-events-none disabled:opacity-40"
                disabled={isBusy || snapshot?.branch === null}
                type="button"
              >
                <GitBranch aria-hidden="true" className="shrink-0 text-[var(--app-muted-foreground)]" size={16} />
                <span className="min-w-0 flex-1 truncate">{snapshot?.branch ?? "选择分支"}</span>
                {snapshot !== null && snapshot.ahead > 0 ? <span className="shrink-0 text-[length:var(--app-font-size-caption)] text-emerald-600 dark:text-emerald-400">↑{snapshot.ahead}</span> : null}
                {snapshot !== null && snapshot.behind > 0 ? <span className="shrink-0 text-[length:var(--app-font-size-caption)] text-amber-600 dark:text-amber-400">↓{snapshot.behind}</span> : null}
                <ChevronDown aria-hidden="true" className="shrink-0 text-[var(--app-muted-foreground)]" size={14} />
              </button>
            </PopoverTrigger>
          </TooltipAnchor>
          <PopoverContent
            align="start"
            className="w-[min(440px,var(--radix-popover-content-available-width))] overflow-visible rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-1.5 text-[var(--app-foreground)] shadow-lg"
            side="bottom"
            sideOffset={4}
          >
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--app-muted-foreground)]" size={15} />
              <input
                autoFocus
                className="h-8 w-full rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-background)] py-1 pl-8 pr-2 text-xs outline-none placeholder:text-[var(--app-muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
                placeholder="搜索分支或操作"
                value={branchQuery}
                onChange={(event) => setBranchQuery(event.target.value)}
              />
            </div>
            {matchesBranchAction("更新项目") || matchesBranchAction("提交") || matchesBranchAction("推送") || matchesBranchAction("新建分支") ? (
              <div aria-label="Git 操作" className="my-1 flex items-center gap-1 border-b border-[var(--app-border)] pb-1" role="group">
                {matchesBranchAction("更新项目") ? (
                  <IconButton
                    disabled={isBusy || snapshot?.upstream === null || snapshot?.upstream === undefined}
                    label="更新项目"
                    onClick={() => {
                      setBranchPickerOpen(false);
                      void runOperation({ action: "pull", projectId });
                    }}
                  >
                    <ArrowDownToLine aria-hidden="true" size={15} />
                  </IconButton>
                ) : null}
                {matchesBranchAction("提交") ? (
                  <IconButton
                    label="提交…"
                    onClick={focusCommitMessage}
                  >
                    <GitCommitHorizontal aria-hidden="true" size={15} />
                  </IconButton>
                ) : null}
                {matchesBranchAction("推送") ? (
                  <IconButton
                    disabled={isBusy || snapshot?.branch === null || snapshot?.branch === undefined}
                    label="推送"
                    onClick={() => {
                      setBranchPickerOpen(false);
                      void runOperation({ action: "push", projectId });
                    }}
                  >
                    <ArrowUpFromLine aria-hidden="true" size={15} />
                  </IconButton>
                ) : null}
                {matchesBranchAction("新建分支") ? (
                  <IconButton
                    disabled={isBusy || snapshot?.isRepository !== true}
                    label="新建分支"
                    onClick={() => openCreateBranchDialog()}
                  >
                    <GitBranchPlus aria-hidden="true" size={15} />
                  </IconButton>
                ) : null}
              </div>
            ) : null}
            <div className="px-2 py-1 text-[length:var(--app-font-size-caption)] font-medium text-[var(--app-muted-foreground)]">
              本地分支
            </div>
            <div aria-label="本地分支" className="max-h-64 overflow-auto" role="list">
              {matchingBranches.map((branch) => (
                <div
                  className={cn(
                    "group flex min-w-0 items-center rounded-[var(--app-radius)] hover:bg-[var(--app-hover)]",
                    branch.current && "bg-[var(--app-selection)] text-[var(--app-selection-foreground)]",
                  )}
                  key={branch.name}
                  role="listitem"
                >
                  <TooltipAnchor content={branch.name}>
                    <button
                      className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-focus-ring)]"
                      type="button"
                      onClick={() => {
                        setBranchPickerOpen(false);
                        if (!branch.current) void runOperation({ action: "switchBranch", branch: branch.name, projectId });
                      }}
                    >
                      <span className="grid size-4 shrink-0 place-items-center text-[var(--app-accent)]">
                        {branch.current ? <Check aria-hidden="true" size={14} /> : null}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-xs font-medium">{branch.name}</span>
                        <span className="block truncate text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">
                          {branch.upstream ?? "尚未关联远程分支"}
                        </span>
                      </span>
                      {branch.current ? (
                        <span className="shrink-0 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">当前</span>
                      ) : null}
                    </button>
                  </TooltipAnchor>
                  <Popover open={branchMenu === branch.name} onOpenChange={(open) => setBranchMenu(open ? branch.name : null)}>
                    <PopoverTrigger asChild>
                      <IconButton className="mr-1 size-7 shrink-0" label={`${branch.name} 分支操作`}>
                        <Ellipsis aria-hidden="true" size={15} />
                      </IconButton>
                    </PopoverTrigger>
                    <PopoverContent
                      align="end"
                      className="w-48 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-1 text-xs text-[var(--app-foreground)] shadow-lg"
                      role="menu"
                      side="right"
                      sideOffset={5}
                    >
                      <ReviewMenuButton
                        disabled={branch.current || isBusy}
                        icon={<GitBranch aria-hidden="true" size={14} />}
                        label={branch.current ? "当前已签出" : "签出此分支"}
                        onClick={() => {
                          setBranchMenu(null);
                          setBranchPickerOpen(false);
                          if (!branch.current) void runOperation({ action: "switchBranch", branch: branch.name, projectId });
                        }}
                      />
                      <ReviewMenuButton
                        disabled={isBusy}
                        icon={<GitBranchPlus aria-hidden="true" size={14} />}
                        label="从此分支新建"
                        onClick={() => {
                          setBranchMenu(null);
                          openCreateBranchDialog(branch.name);
                        }}
                      />
                      <ReviewMenuButton
                        icon={<Copy aria-hidden="true" size={14} />}
                        label="复制分支名称"
                        onClick={() => {
                          setBranchMenu(null);
                          void navigator.clipboard.writeText(branch.name).catch((reason: unknown) => {
                            setError(getUserErrorMessage(reason, "无法复制分支名称。"));
                          });
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                </div>
              ))}
              {matchingBranches.length === 0 ? (
                <div className="px-2 py-4 text-center text-xs text-[var(--app-muted-foreground)]">未找到匹配的分支</div>
              ) : null}
            </div>
          </PopoverContent>
        </Popover>
        <IconButton
          className="git-review-toolbar-action"
          disabled={isBusy || snapshot?.isRepository !== true}
          label="新建分支"
          onClick={() => openCreateBranchDialog()}
        >
          <GitBranchPlus aria-hidden="true" size={15} />
        </IconButton>
        <IconButton
          className="git-review-toolbar-action"
          disabled={isBusy}
          label="提交…"
          onClick={focusCommitMessage}
        >
          <GitCommitHorizontal aria-hidden="true" size={15} />
        </IconButton>
        <IconButton
          className="git-review-toolbar-action git-review-toolbar-action--narrow"
          disabled={isBusy || snapshot?.upstream === null || snapshot?.upstream === undefined}
          label="更新项目（拉取）"
          onClick={() => void runOperation({ action: "pull", projectId })}
        >
          <ArrowDownToLine aria-hidden="true" size={15} />
        </IconButton>
        <IconButton
          className="git-review-toolbar-action"
          disabled={isBusy || snapshot?.branch === null || snapshot?.branch === undefined}
          label="推送"
          onClick={() => void runOperation({ action: "push", projectId })}
        >
          <ArrowUpFromLine aria-hidden="true" size={15} />
        </IconButton>
        <IconButton
          className="git-review-toolbar-action git-review-toolbar-action--optional"
          disabled={isLoading || isBusy}
          label="刷新 Git 变更"
          onClick={() => void refresh()}
        >
          {isLoading || isBusy
            ? <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
            : <RefreshCw aria-hidden="true" size={15} />}
        </IconButton>
        <Popover open={toolbarMenuOpen} onOpenChange={setToolbarMenuOpen}>
          <PopoverTrigger asChild>
            <IconButton className="git-review-toolbar-overflow" label="更多 Git 操作">
              <Ellipsis aria-hidden="true" size={16} />
            </IconButton>
          </PopoverTrigger>
          <PopoverContent
            align="end"
            className="w-48 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-1 text-xs text-[var(--app-foreground)] shadow-lg"
            role="menu"
            side="bottom"
            sideOffset={4}
          >
            <ReviewMenuButton
              disabled={isBusy || snapshot?.isRepository !== true}
              icon={<GitBranchPlus aria-hidden="true" size={14} />}
              label="新建分支"
              onClick={() => {
                setToolbarMenuOpen(false);
                openCreateBranchDialog();
              }}
            />
            <ReviewMenuButton
              icon={<GitCommitHorizontal aria-hidden="true" size={14} />}
              label="提交…"
              onClick={() => {
                setToolbarMenuOpen(false);
                focusCommitMessage();
              }}
            />
            <ReviewMenuButton
              disabled={isBusy || snapshot?.upstream === null || snapshot?.upstream === undefined}
              icon={<ArrowDownToLine aria-hidden="true" size={14} />}
              label="更新项目"
              onClick={() => {
                setToolbarMenuOpen(false);
                void runOperation({ action: "pull", projectId });
              }}
            />
            <ReviewMenuButton
              disabled={isBusy || snapshot?.branch === null || snapshot?.branch === undefined}
              icon={<ArrowUpFromLine aria-hidden="true" size={14} />}
              label="推送"
              onClick={() => {
                setToolbarMenuOpen(false);
                void runOperation({ action: "push", projectId });
              }}
            />
            <ReviewMenuButton
              disabled={isLoading || isBusy}
              icon={<RefreshCw aria-hidden="true" size={14} />}
              label="刷新 Git 变更"
              onClick={() => {
                setToolbarMenuOpen(false);
                void refresh();
              }}
            />
          </PopoverContent>
        </Popover>
      </header>

      {error !== null ? (
        <div className="mx-2.5 mt-2 rounded-[var(--app-radius)] bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-400" role="alert">
          {error}
        </div>
      ) : null}

      {snapshot !== null && !snapshot.isRepository ? (
        <div className="grid flex-1 place-items-center px-6 text-center text-sm text-[var(--app-muted-foreground)]">
          当前项目目录不是 Git 仓库。
        </div>
      ) : (
        <div className="git-review-content flex min-h-0 flex-1 flex-col">
          <div className="git-review-main min-h-0 flex-1">
            <div className="git-review-change-pane min-h-0 flex-1 overflow-auto p-1.5">
            {snapshot === null || snapshot.changes.length === 0 ? (
              <div className="grid h-full place-items-center px-4 text-center text-xs text-[var(--app-muted-foreground)]">
                {isLoading ? "正在读取变更…" : "工作区没有未提交变更"}
              </div>
            ) : (
              <div>
                <div className="flex h-9 items-center gap-1 px-1">
                  <strong className="text-xs font-semibold">更改</strong>
                  <span className="text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{snapshot.changes.length} 个文件</span>
                  <span className="ml-auto flex items-center gap-1.5 pr-1 text-[length:var(--app-font-size-caption)]">
                    <span className="text-emerald-600 dark:text-emerald-400">+{additions}</span>
                    <span className="text-red-600 dark:text-red-400">-{deletions}</span>
                  </span>
                </div>
                <div className="ml-3 border-l border-[var(--app-border)] pl-1">
                  {trackedChanges.length > 0 ? (
                    <section aria-label="已跟踪更改">
                      <div className="flex h-8 items-center gap-1">
                        <IconButton
                          className="size-6"
                          label={trackedExpanded ? "收起已跟踪更改" : "展开已跟踪更改"}
                          onClick={() => setTrackedExpanded((value) => !value)}
                        >
                          {trackedExpanded ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}
                        </IconButton>
                        <input
                          aria-label={allTrackedSelected ? "取消选择已跟踪更改" : "选择全部已跟踪更改"}
                          checked={allTrackedSelected}
                          className="ml-0.5 size-3 shrink-0 cursor-pointer accent-[var(--app-accent)] disabled:cursor-default"
                          disabled={isBusy}
                          ref={(element) => {
                            if (element !== null) element.indeterminate = selectedTrackedPaths.length > 0 && !allTrackedSelected;
                          }}
                          type="checkbox"
                          onChange={() => toggleChangeGroupSelection(trackedChanges.map((change) => change.path))}
                        />
                        <button
                          className="ml-1 flex h-full min-w-0 flex-1 items-center gap-1 rounded-[var(--app-radius)] px-1 text-left text-xs font-medium hover:bg-[var(--app-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
                          type="button"
                          onClick={() => setTrackedExpanded((value) => !value)}
                        >
                          <span>已跟踪更改</span>
                          <span className="text-[length:var(--app-font-size-caption)] font-normal text-[var(--app-muted-foreground)]">{trackedChanges.length} 个文件</span>
                        </button>
                        <IconButton
                          className="size-6 shrink-0"
                          disabled={isBusy || selectedTrackedPaths.length === 0}
                          label="取消跟踪已选文件（保留本地文件）"
                          onClick={() => void untrackSelected(selectedTrackedPaths)}
                        >
                          <Minus aria-hidden="true" size={14} />
                        </IconButton>
                      </div>
                      {trackedExpanded ? <div className="ml-3">{trackedChanges.map(renderChange)}</div> : null}
                    </section>
                  ) : null}
                  {untrackedChanges.length > 0 ? (
                    <section aria-label="未跟踪文件">
                      <div className="flex h-8 items-center gap-1">
                        <IconButton
                          className="size-6"
                          label={untrackedExpanded ? "收起未跟踪文件" : "展开未跟踪文件"}
                          onClick={() => setUntrackedExpanded((value) => !value)}
                        >
                          {untrackedExpanded ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}
                        </IconButton>
                        <input
                          aria-label={allUntrackedSelected ? "取消选择未跟踪文件" : "选择全部未跟踪文件"}
                          checked={allUntrackedSelected}
                          className="ml-0.5 size-3 shrink-0 cursor-pointer accent-[var(--app-accent)] disabled:cursor-default"
                          disabled={isBusy}
                          ref={(element) => {
                            if (element !== null) element.indeterminate = selectedUntrackedPaths.length > 0 && !allUntrackedSelected;
                          }}
                          type="checkbox"
                          onChange={() => toggleChangeGroupSelection(untrackedChanges.map((change) => change.path))}
                        />
                        <button
                          className="ml-1 flex h-full min-w-0 flex-1 items-center gap-1 rounded-[var(--app-radius)] px-1 text-left text-xs font-medium hover:bg-[var(--app-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
                          type="button"
                          onClick={() => setUntrackedExpanded((value) => !value)}
                        >
                          <span>未跟踪文件</span>
                          <span className="text-[length:var(--app-font-size-caption)] font-normal text-[var(--app-muted-foreground)]">{untrackedChanges.length} 个文件</span>
                        </button>
                        <IconButton
                          className="size-6 shrink-0"
                          disabled={isBusy || selectedUntrackedPaths.length === 0}
                          label="跟踪并暂存已选文件"
                          onClick={() => void stageSelected(selectedUntrackedPaths)}
                        >
                          <Plus aria-hidden="true" size={14} />
                        </IconButton>
                      </div>
                      {untrackedExpanded ? <div className="ml-3">{untrackedChanges.map(renderChange)}</div> : null}
                    </section>
                  ) : null}
                </div>
              </div>
            )}
            </div>
            <aside className="git-review-diff-pane min-h-0" aria-label="文件差异">
              <div className="flex h-9 min-w-0 flex-none items-center gap-2 border-b border-[var(--app-border)] px-2.5">
                {selectedChange === null ? (
                  <span className="text-xs font-medium text-[var(--app-muted-foreground)]">文件差异</span>
                ) : (
                  <>
                    <FileTypeIcon className="shrink-0" path={selectedChange.path} size={16} />
                    <TooltipAnchor content={selectedChange.path}>
                      <span className="min-w-0 flex-1 truncate text-xs font-medium">{selectedChange.path}</span>
                    </TooltipAnchor>
                    {selectedChange.additions === null || selectedChange.deletions === null ? (
                      <span className="shrink-0 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">二进制</span>
                    ) : (
                      <span className="flex shrink-0 items-center gap-1.5 text-[length:var(--app-font-size-caption)]">
                        <span className="text-emerald-600 dark:text-emerald-400">+{selectedChange.additions}</span>
                        <span className="text-red-600 dark:text-red-400">-{selectedChange.deletions}</span>
                      </span>
                    )}
                  </>
                )}
              </div>
              {selectedPath === null ? (
                <div className="grid min-h-0 flex-1 place-items-center px-5 text-center text-xs text-[var(--app-muted-foreground)]">
                  从左侧选择文件查看差异
                </div>
              ) : (
                <DiffViewer
                  diff={diff}
                  expandedContext={diffContextLines >= EXPANDED_DIFF_CONTEXT_LINES}
                  pane
                  selectedPath={selectedPath}
                  onExpandContext={expandDiffContext}
                />
              )}
            </aside>
          </div>
          <div
            aria-label="调整提交卡片高度"
            aria-orientation="horizontal"
            className={cn(
              "git-review-commit-resizer group relative mx-[5px] h-[5px] flex-none cursor-row-resize outline-none focus-visible:bg-[var(--app-focus-ring)]/20",
              isCommitPanelResizing && "bg-[var(--app-accent)]/30",
            )}
            role="separator"
            tabIndex={0}
            onKeyDown={handleCommitPanelResizeKeyDown}
            onPointerDown={handleCommitPanelResizePointerDown}
          >
            <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[var(--app-accent)] opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100" />
          </div>
          <footer
            className="git-review-commit-panel mx-[5px] mb-[5px] flex flex-none flex-col overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-2.5"
            style={{ height: `${commitPanelHeight}px` }}
          >
            <div className="flex h-8 flex-none items-center gap-2 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">
              <GitBranch aria-hidden="true" size={14} />
              <span className="min-w-0 flex-1 truncate">提交到 {snapshot?.branch ?? "当前分支"}</span>
              <span className="shrink-0">已选择 {selectedChangePaths.length} 个文件</span>
            </div>
            <label className="sr-only" htmlFor="git-review-commit-message">提交说明</label>
            <textarea
              id="git-review-commit-message"
              className="min-h-20 w-full flex-1 resize-none rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-background)] p-2 text-xs outline-none placeholder:text-[var(--app-muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
              placeholder="提交说明"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
            />
            <div className="mt-2 flex items-center gap-2">
              <DialogButton
                primary
                disabled={selectedChangePaths.length === 0 || commitMessage.trim().length === 0 || isBusy}
                label="提交"
                onClick={() => void submitCommit(false)}
              />
              <DialogButton
                disabled={selectedChangePaths.length === 0 || commitMessage.trim().length === 0 || isBusy || snapshot?.branch === null}
                label="提交并推送"
                onClick={() => void submitCommit(true)}
              />
            </div>
          </footer>
        </div>
      )}

      <Dialog open={dialog === "branch"} onOpenChange={(open) => setDialog(open ? "branch" : null)}>
        <DialogContent className="gap-4 p-4">
          <DialogHeader>
            <DialogTitle>新建分支</DialogTitle>
            <DialogDescription>未提交的修改会保留在工作区。</DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium" htmlFor="git-review-branch-name">分支名称</label>
            <input
              autoFocus
              id="git-review-branch-name"
              className="h-8 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-background)] px-2 text-xs outline-none placeholder:text-[var(--app-muted-foreground)] focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
              placeholder="例如 feature/settings-search"
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <label className="text-xs font-medium" htmlFor="git-review-branch-start-point">起点</label>
            <select
              className="h-8 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-background)] px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
              id="git-review-branch-start-point"
              value={branchStartPoint ?? ""}
              onChange={(event) => setBranchStartPoint(event.target.value || null)}
            >
              {snapshot?.branches.map((branch) => <option key={branch.name} value={branch.name}>{branch.name}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-xs">
            <input checked className="size-4 accent-[var(--app-accent)]" disabled type="checkbox" />
            创建后立即切换到新分支
          </label>
          <DialogFooter>
            <DialogButton label="取消" onClick={() => setDialog(null)} />
            <DialogButton
              primary
              disabled={branchName.trim().length === 0 || isBusy}
              label="创建分支"
              onClick={() => void runOperation({
                action: "createBranch",
                branch: branchName,
                projectId,
                ...(branchStartPoint === null ? {} : { startPoint: branchStartPoint }),
              }).then((ok) => {
                if (ok) {
                  setBranchName("");
                  setBranchStartPoint(null);
                  setDialog(null);
                }
              })}
            />
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </section>
  );
}

function DiffViewer({
  diff,
  expandedContext,
  onExpandContext,
  pane = false,
  selectedPath,
}: {
  diff: GitFileDiff | null;
  expandedContext: boolean;
  onExpandContext: () => void;
  pane?: boolean;
  selectedPath: string | null;
}): ReactElement {
  const viewerClassName = cn(
    "git-review-diff-viewer border-t border-[var(--app-border)]",
    pane && "git-review-diff-viewer--pane",
  );
  if (selectedPath === null) {
    return <></>;
  }
  if (diff === null) {
    return <div className={cn(viewerClassName, "grid h-20 place-items-center")}><LoaderCircle aria-hidden="true" className="animate-spin text-[var(--app-muted-foreground)]" size={17} /></div>;
  }
  if (diff.content.length === 0) {
    return <div className={cn(viewerClassName, "grid h-20 place-items-center text-xs text-[var(--app-muted-foreground)]")}>该文件没有可显示的文本差异</div>;
  }
  return (
    <div className={viewerClassName}>
      <DiffView
        presentation={createDiffPresentation(diff.content)}
        {...(expandedContext ? {} : { onExpandContext })}
      />
      {diff.truncated ? <div className="px-3 py-2 text-xs text-amber-600">差异内容过大，已截断显示。</div> : null}
    </div>
  );
}

function ReviewMenuButton({
  disabled,
  icon,
  label,
  onClick,
}: {
  disabled?: boolean;
  icon: ReactElement;
  label: string;
  onClick: () => void;
}): ReactElement {
  return (
    <button
      className="flex h-8 w-full items-center gap-2 rounded-[var(--app-radius)] px-2 text-left outline-none hover:bg-[var(--app-hover)] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--app-focus-ring)] disabled:pointer-events-none disabled:opacity-40"
      disabled={disabled}
      role="menuitem"
      type="button"
      onClick={onClick}
    >
      <span className="grid size-4 shrink-0 place-items-center text-[var(--app-muted-foreground)]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </button>
  );
}

function DialogButton({
  disabled,
  label,
  onClick,
  primary = false,
}: {
  disabled?: boolean;
  label: string;
  onClick: () => void;
  primary?: boolean;
}): ReactElement {
  return (
    <button
      className={cn(
        "h-8 rounded-[var(--app-radius)] px-3 text-xs font-medium outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)] disabled:pointer-events-none disabled:opacity-40",
        primary
          ? "bg-[var(--app-accent)] text-[var(--app-accent-foreground)] hover:opacity-90"
          : "border border-[var(--app-border)] hover:bg-[var(--app-hover)]",
      )}
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {label}
    </button>
  );
}
