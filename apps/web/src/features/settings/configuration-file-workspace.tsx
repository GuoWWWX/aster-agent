import {
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Eye,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  LoaderCircle,
  RefreshCw,
  Trash2,
  X,
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
  ConfigurationWorkspaceDirectoryListing,
  ConfigurationWorkspaceEntry,
  ConfigurationWorkspaceFile,
  ConfigurationWorkspaceKind,
} from "@agent/protocol";

import {
  DocumentCodeEditor,
  type DocumentCodeLanguage,
} from "../../components/editor/document-code-editor.js";
import { AgentMarkdown } from "../../components/markdown/agent-markdown.js";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import "./configuration-file-workspace.css";

type FilePreviewState = {
  error: string | null;
  file: ConfigurationWorkspaceFile | null;
  isLoading: boolean;
};

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

function parentPath(path: string): string {
  const lastSlash = path.lastIndexOf("/");
  return lastSlash < 0 ? "" : path.slice(0, lastSlash);
}

function isSafeEntryName(value: string): boolean {
  return (
    value.length > 0
    && !value.includes("/")
    && !value.includes("\\")
    && value !== "."
    && value !== ".."
  );
}

function isMarkdownFile(path: string): boolean {
  const extension = path.split(".").at(-1)?.toLocaleLowerCase("en-US");
  return extension === "md" || extension === "mdx";
}

function entryPath(parent: string, name: string): string {
  return parent.length === 0 ? name : `${parent}/${name}`;
}

export function ConfigurationFileWorkspace({
  agentClient,
  configurationId,
  kind,
  onClose,
  onConfigurationChanged,
  title,
}: {
  agentClient: AgentClient;
  configurationId: string;
  kind: ConfigurationWorkspaceKind;
  onClose: () => void;
  onConfigurationChanged?: () => void;
  title: string;
}): ReactElement {
  const isDark = useWorkbenchUiStore((state) => state.themeMode === "dark");
  const [entriesByDirectory, setEntriesByDirectory] = useState<
    Record<string, readonly ConfigurationWorkspaceEntry[]>
  >({});
  const [expandedDirectories, setExpandedDirectories] = useState<Set<string>>(
    () => new Set([""]),
  );
  const [loadingDirectories, setLoadingDirectories] = useState<Set<string>>(
    () => new Set([""]),
  );
  const [rootPath, setRootPath] = useState("");
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewState>({
    error: null,
    file: null,
    isLoading: false,
  });
  const [draft, setDraft] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [showPreview, setShowPreview] = useState(false);
  const latestReadRequestRef = useRef(0);
  const activeFileTokenRef = useRef(0);
  const autoSaveTimerRef = useRef<number | undefined>(undefined);
  const draftRef = useRef("");
  const pendingSaveCountRef = useRef(0);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());

  const clearAutoSaveTimer = useCallback((): void => {
    if (autoSaveTimerRef.current === undefined) return;
    window.clearTimeout(autoSaveTimerRef.current);
    autoSaveTimerRef.current = undefined;
  }, []);

  const selectedEntry = useMemo(() => {
    if (selectedPath === null) return null;
    for (const entries of Object.values(entriesByDirectory)) {
      const entry = entries.find((candidate) => candidate.path === selectedPath);
      if (entry !== undefined) return entry;
    }
    return preview.file === null
      ? null
      : {
        isProtected: preview.file.isProtected,
        kind: "file" as const,
        name: preview.file.name,
        path: preview.file.path,
      };
  }, [entriesByDirectory, preview.file, selectedPath]);

  const loadDirectory = useCallback(async (
    directoryPath: string,
  ): Promise<ConfigurationWorkspaceDirectoryListing | null> => {
    setLoadingDirectories((current) => new Set(current).add(directoryPath));
    try {
      const listing = await agentClient.listConfigurationWorkspaceEntries({
        configurationId,
        directoryPath,
        kind,
      });
      setEntriesByDirectory((current) => ({ ...current, [directoryPath]: listing.entries }));
      setRootPath(listing.rootPath);
      return listing;
    } catch (reason) {
      setOperationError(getUserErrorMessage(reason, "无法读取配置目录。"));
      return null;
    } finally {
      setLoadingDirectories((current) => {
        const next = new Set(current);
        next.delete(directoryPath);
        return next;
      });
    }
  }, [agentClient, configurationId, kind]);

  const readFile = useCallback(async (path: string): Promise<void> => {
    clearAutoSaveTimer();
    const requestId = latestReadRequestRef.current + 1;
    latestReadRequestRef.current = requestId;
    activeFileTokenRef.current = requestId;
    setPreview((current) => ({ ...current, error: null, isLoading: true }));
    setOperationError(null);
    try {
      const file = await agentClient.readConfigurationWorkspaceFile({
        configurationId,
        kind,
        path,
      });
      if (latestReadRequestRef.current !== requestId) return;
      const content = file.content ?? "";
      setPreview({ error: null, file, isLoading: false });
      setDraft(content);
      draftRef.current = content;
      setSavedContent(content);
      setIsDirty(false);
      setShowPreview(false);
      setSelectedPath(path);
    } catch (reason) {
      if (latestReadRequestRef.current !== requestId) return;
      setPreview({
        error: getUserErrorMessage(reason, "无法读取配置文件。"),
        file: null,
        isLoading: false,
      });
      setDraft("");
      draftRef.current = "";
      setSavedContent("");
      setIsDirty(false);
    }
  }, [agentClient, clearAutoSaveTimer, configurationId, kind]);

  useEffect(() => {
    let active = true;
    void agentClient.listConfigurationWorkspaceEntries({
      configurationId,
      directoryPath: "",
      kind,
    }).then(
      (listing) => {
        if (!active) return;
        setEntriesByDirectory({ "": listing.entries });
        setRootPath(listing.rootPath);
        setLoadingDirectories(new Set());
        const initialFile = listing.entries.find(
          (entry) => entry.kind === "file" && entry.isProtected,
        ) ?? listing.entries.find((entry) => entry.kind === "file");
        if (initialFile !== undefined) void readFile(initialFile.path);
      },
      (reason: unknown) => {
        if (!active) return;
        setLoadingDirectories(new Set());
        setOperationError(getUserErrorMessage(reason, "无法打开配置文件工作区。"));
      },
    );
    return () => {
      active = false;
    };
  }, [agentClient, configurationId, kind, readFile]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      requestClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  useEffect(() => {
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, []);

  async function refreshTree(): Promise<void> {
    setOperationError(null);
    const directories = [...expandedDirectories].sort((left, right) => left.length - right.length);
    const listings = await Promise.all(directories.map((directoryPath) =>
      agentClient.listConfigurationWorkspaceEntries({
        configurationId,
        directoryPath,
        kind,
      })
    ));
    setEntriesByDirectory(Object.fromEntries(
      listings.map((listing) => [listing.directoryPath, listing.entries]),
    ));
    setRootPath(listings[0]?.rootPath ?? rootPath);
  }

  function toggleDirectory(path: string): void {
    const isExpanded = expandedDirectories.has(path);
    setExpandedDirectories((current) => {
      const next = new Set(current);
      if (isExpanded) next.delete(path);
      else next.add(path);
      return next;
    });
    if (!isExpanded) void loadDirectory(path);
  }

  async function createEntry(entryKind: "directory" | "file"): Promise<void> {
    const selectedDirectory = selectedEntry?.kind === "directory"
      ? selectedEntry.path
      : selectedEntry === null ? "" : parentPath(selectedEntry.path);
    const name = window.prompt(
      entryKind === "directory" ? "新建目录名称" : "新建文件名称",
    )?.trim();
    if (name === undefined) return;
    if (!isSafeEntryName(name)) {
      setOperationError("名称不能包含路径分隔符，且不能是 . 或 ..。");
      return;
    }
    try {
      const created = await agentClient.createConfigurationWorkspaceEntry({
        configurationId,
        entryKind,
        kind,
        path: entryPath(selectedDirectory, name),
      });
      await loadDirectory(selectedDirectory);
      if (created.kind === "directory") setSelectedPath(created.path);
      else openFile(created.path);
    } catch (reason) {
      setOperationError(getUserErrorMessage(reason, "无法新建配置文件。"));
    }
  }

  async function deleteSelected(): Promise<void> {
    if (selectedEntry === null || selectedEntry.isProtected) return;
    if (!window.confirm(`确定删除 ${selectedEntry.name} 吗？`)) return;
    if (!await flushCurrentFile()) return;
    try {
      await agentClient.deleteConfigurationWorkspaceEntry({
        configurationId,
        kind,
        path: selectedEntry.path,
      });
      const parent = parentPath(selectedEntry.path);
      await loadDirectory(parent);
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
      if (preview.file?.path === selectedEntry.path) {
        setPreview({ error: null, file: null, isLoading: false });
        setDraft("");
        draftRef.current = "";
        setSavedContent("");
        setIsDirty(false);
      }
      setSelectedPath(null);
    } catch (reason) {
      setOperationError(getUserErrorMessage(reason, "无法删除配置项目。"));
    }
  }

  const enqueueSave = useCallback((
    file: ConfigurationWorkspaceFile,
    content: string,
    fileToken: number,
  ): Promise<boolean> => {
    if (
      file.content === null
      || file.isBinary
      || file.truncated
    ) return Promise.resolve(true);
    if (activeFileTokenRef.current === fileToken) setOperationError(null);
    pendingSaveCountRef.current += 1;
    setIsSaving(true);
    const operation = saveQueueRef.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const saved = await agentClient.writeConfigurationWorkspaceFile({
            configurationId,
            content,
            kind,
            path: file.path,
          });
          const persistedContent = saved.content ?? content;
          if (activeFileTokenRef.current === fileToken) {
            setOperationError(null);
            setPreview((current) => current.file?.path === saved.path
              ? { error: null, file: saved, isLoading: false }
              : current);
            setSavedContent(persistedContent);
            if (draftRef.current === content) {
              if (persistedContent !== content) {
                draftRef.current = persistedContent;
                setDraft(persistedContent);
              }
              setIsDirty(false);
            } else {
              setIsDirty(true);
            }
          }
          await loadDirectory(parentPath(saved.path));
          if (saved.isProtected) onConfigurationChanged?.();
          return true;
        } catch (reason) {
          if (activeFileTokenRef.current === fileToken) {
            setOperationError(getUserErrorMessage(reason, "无法保存配置文件。"));
          }
          return false;
        }
      })
      .finally(() => {
        pendingSaveCountRef.current -= 1;
        if (pendingSaveCountRef.current === 0) setIsSaving(false);
      });
    saveQueueRef.current = operation.then(() => undefined);
    return operation;
  }, [agentClient, configurationId, kind, loadDirectory, onConfigurationChanged]);

  const flushCurrentFile = useCallback(async (): Promise<boolean> => {
    clearAutoSaveTimer();
    const file = preview.file;
    if (
      file === null
      || !isDirty
      || file.content === null
      || file.isBinary
      || file.truncated
    ) return true;
    return enqueueSave(file, draft, activeFileTokenRef.current);
  }, [clearAutoSaveTimer, draft, enqueueSave, isDirty, preview.file]);

  const saveFile = useCallback((): Promise<boolean> => (
    flushCurrentFile()
  ), [flushCurrentFile]);

  function requestClose(): void {
    void flushCurrentFile().then((saved) => {
      if (saved) onClose();
    });
  }

  function openFile(path: string): void {
    if (path === preview.file?.path) return;
    void flushCurrentFile().then((saved) => {
      if (saved) void readFile(path);
    });
  }

  useEffect(() => {
    const file = preview.file;
    if (
      !isDirty
      || file === null
      || file.content === null
      || file.isBinary
      || file.truncated
    ) return undefined;
    const fileToken = activeFileTokenRef.current;
    const timer = window.setTimeout(() => {
      if (autoSaveTimerRef.current === timer) autoSaveTimerRef.current = undefined;
      void enqueueSave(file, draft, fileToken);
    }, 450);
    autoSaveTimerRef.current = timer;
    return () => {
      window.clearTimeout(timer);
      if (autoSaveTimerRef.current === timer) autoSaveTimerRef.current = undefined;
    };
  }, [draft, enqueueSave, isDirty, preview.file]);

  useEffect(() => () => {
    clearAutoSaveTimer();
  }, [clearAutoSaveTimer]);

  const activeFile = preview.file;
  const canEdit = activeFile !== null
    && activeFile.content !== null
    && !activeFile.isBinary
    && !activeFile.truncated;
  const canPreviewMarkdown = activeFile !== null && isMarkdownFile(activeFile.path) && canEdit;

  return createPortal(
    <div
      aria-label={`${title} 文件工作区`}
      aria-modal="true"
      className="configuration-file-workspace__backdrop"
      data-theme={isDark ? "dark" : "light"}
      role="dialog"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <section className="configuration-file-workspace">
        <header className="configuration-file-workspace__header">
          <div className="configuration-file-workspace__heading">
            <span className="configuration-file-workspace__heading-icon">
              <FolderOpen aria-hidden="true" size={18} />
            </span>
            <div>
              <h2>{title} 文件工作区</h2>
              <p title={rootPath}>{rootPath || "正在定位配置目录"}</p>
            </div>
          </div>
          <button
            aria-label="关闭文件工作区"
            className="configuration-file-workspace__icon-button"
            title="关闭文件工作区"
            type="button"
            onClick={requestClose}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>
        <div className="configuration-file-workspace__body">
          <aside className="configuration-file-workspace__tree" aria-label="配置文件树">
            <header className="configuration-file-workspace__tree-toolbar">
              <strong>文件</strong>
              <div>
                <button
                  aria-label="刷新文件树"
                  className="configuration-file-workspace__icon-button"
                  title="刷新文件树"
                  type="button"
                  onClick={() => void refreshTree().catch((reason: unknown) => {
                    setOperationError(getUserErrorMessage(reason, "无法刷新配置文件树。"));
                  })}
                >
                  <RefreshCw aria-hidden="true" size={15} />
                </button>
                <button
                  aria-label="新建文件"
                  className="configuration-file-workspace__icon-button"
                  title="新建文件"
                  type="button"
                  onClick={() => void createEntry("file")}
                >
                  <FileText aria-hidden="true" size={15} />
                </button>
                <button
                  aria-label="新建目录"
                  className="configuration-file-workspace__icon-button"
                  title="新建目录"
                  type="button"
                  onClick={() => void createEntry("directory")}
                >
                  <FolderPlus aria-hidden="true" size={15} />
                </button>
              </div>
            </header>
            <div className="configuration-file-workspace__tree-content" role="tree">
              <ConfigurationWorkspaceTree
                entriesByDirectory={entriesByDirectory}
                expandedDirectories={expandedDirectories}
                loadingDirectories={loadingDirectories}
                selectedPath={selectedPath}
                onOpenFile={openFile}
                onSelectDirectory={setSelectedPath}
                onToggleDirectory={toggleDirectory}
              />
            </div>
          </aside>
          <section className="configuration-file-workspace__editor" aria-label="文件预览和编辑">
            <header className="configuration-file-workspace__editor-toolbar">
              <div className="configuration-file-workspace__file-title">
                {activeFile === null ? (
                  <span>选择文件以编辑</span>
                ) : (
                  <>
                    <FileTypeIcon path={activeFile.path} size={16} />
                    <span title={activeFile.path}>{activeFile.path}</span>
                    {activeFile.isProtected ? <small>入口文件</small> : null}
                  </>
                )}
              </div>
              <div className="configuration-file-workspace__editor-actions">
                {canPreviewMarkdown ? (
                  <button
                    aria-label={showPreview ? "切换到编辑" : "切换到 Markdown 预览"}
                    className="configuration-file-workspace__icon-button"
                    title={showPreview ? "切换到编辑" : "切换到 Markdown 预览"}
                    type="button"
                    onClick={() => setShowPreview((current) => !current)}
                  >
                    {showPreview ? <FileText aria-hidden="true" size={15} /> : <Eye aria-hidden="true" size={15} />}
                  </button>
                ) : null}
                <button
                  aria-label="保存文件"
                  className="configuration-file-workspace__icon-button"
                  disabled={!canEdit || !isDirty || isSaving}
                  title="保存文件"
                  type="button"
                  onClick={() => void saveFile()}
                >
                  {isSaving ? (
                    <LoaderCircle aria-hidden="true" className="configuration-file-workspace__spin" size={15} />
                  ) : (
                    <Check aria-hidden="true" size={16} />
                  )}
                </button>
                <button
                  aria-label="删除所选项目"
                  className="configuration-file-workspace__icon-button configuration-file-workspace__icon-button--danger"
                  disabled={selectedEntry === null || selectedEntry.isProtected}
                  title={selectedEntry?.isProtected ? "入口文件不可删除" : "删除所选项目"}
                  type="button"
                  onClick={() => void deleteSelected()}
                >
                  <Trash2 aria-hidden="true" size={15} />
                </button>
              </div>
            </header>
            {operationError === null ? null : (
              <p className="configuration-file-workspace__error" role="alert">
                <CirclePlus aria-hidden="true" size={15} />
                {operationError}
              </p>
            )}
            <div className="configuration-file-workspace__editor-content">
              {preview.isLoading ? (
                <div className="configuration-file-workspace__state" role="status">
                  <LoaderCircle aria-hidden="true" className="configuration-file-workspace__spin" size={18} />
                  正在读取文件
                </div>
              ) : preview.error !== null ? (
                <div className="configuration-file-workspace__state" role="alert">
                  <p>{preview.error}</p>
                  {selectedPath === null ? null : (
                    <button className="settings-secondary-button" type="button" onClick={() => void readFile(selectedPath)}>
                      重试
                    </button>
                  )}
                </div>
              ) : activeFile === null ? (
                <div className="configuration-file-workspace__state">从左侧文件树选择一个文件</div>
              ) : activeFile.isBinary || activeFile.content === null ? (
                <div className="configuration-file-workspace__state">二进制文件不可预览或编辑</div>
              ) : activeFile.truncated ? (
                <div className="configuration-file-workspace__state">
                  <p>文件超过预览大小限制，仅显示前 2 MB，不能直接保存。</p>
                  <DocumentCodeEditor
                    readOnly
                    ariaLabel={`${activeFile.name} 文件内容`}
                    className="configuration-file-workspace__read-only-editor"
                    isDark={isDark}
                    language={languageForPath(activeFile.path)}
                    value={draft}
                    onChange={() => undefined}
                  />
                </div>
              ) : showPreview && canPreviewMarkdown ? (
                <div className="configuration-file-workspace__markdown-preview">
                  <AgentMarkdown content={draft} />
                </div>
              ) : (
                <DocumentCodeEditor
                  ariaLabel={`${activeFile.name} 文件编辑器`}
                  className="configuration-file-workspace__code-editor"
                  isDark={isDark}
                  language={languageForPath(activeFile.path)}
                  value={draft}
                  onChange={(value) => {
                    setDraft(value);
                    draftRef.current = value;
                    setIsDirty(value !== savedContent);
                  }}
                  onSave={() => void saveFile()}
                />
              )}
            </div>
            <footer className="configuration-file-workspace__footer">
              <span>
                {activeFile === null
                  ? ""
                  : activeFile.truncated
                    ? "只读预览"
                    : isSaving
                      ? "正在保存"
                      : isDirty
                      ? "有未保存改动"
                      : "已保存"}
              </span>
              {activeFile?.isProtected ? <span>入口文件可编辑，不可删除</span> : null}
            </footer>
          </section>
        </div>
      </section>
    </div>,
    document.body,
  );
}

function ConfigurationWorkspaceTree({
  entriesByDirectory,
  expandedDirectories,
  loadingDirectories,
  selectedPath,
  onOpenFile,
  onSelectDirectory,
  onToggleDirectory,
}: {
  entriesByDirectory: Record<string, readonly ConfigurationWorkspaceEntry[]>;
  expandedDirectories: ReadonlySet<string>;
  loadingDirectories: ReadonlySet<string>;
  selectedPath: string | null;
  onOpenFile: (path: string) => void;
  onSelectDirectory: (path: string) => void;
  onToggleDirectory: (path: string) => void;
}): ReactElement {
  function renderDirectory(directoryPath: string, depth: number): ReactElement[] {
    const entries = entriesByDirectory[directoryPath] ?? [];
    return entries.flatMap((entry) => {
      const isDirectory = entry.kind === "directory";
      const isExpanded = expandedDirectories.has(entry.path);
      const row = (
        <div
          key={entry.path}
          className="configuration-file-workspace__tree-row"
          data-selected={selectedPath === entry.path || selectedPath?.startsWith(`${entry.path}/`) === true}
          style={{ paddingLeft: `${8 + depth * 16}px` }}
        >
          {isDirectory ? (
            <button
              aria-label={`${isExpanded ? "收起" : "展开"}${entry.name}`}
              className="configuration-file-workspace__tree-toggle"
              type="button"
              onClick={() => onToggleDirectory(entry.path)}
            >
              {loadingDirectories.has(entry.path) ? (
                <LoaderCircle aria-hidden="true" className="configuration-file-workspace__spin" size={13} />
              ) : isExpanded ? (
                <ChevronDown aria-hidden="true" size={14} />
              ) : (
                <ChevronRight aria-hidden="true" size={14} />
              )}
            </button>
          ) : <span className="configuration-file-workspace__tree-spacer" />}
          <button
            className="configuration-file-workspace__tree-item"
            title={entry.path}
            type="button"
            onClick={() => {
              if (isDirectory) onSelectDirectory(entry.path);
              else onOpenFile(entry.path);
            }}
          >
            {isDirectory ? (
              isExpanded ? <FolderOpen aria-hidden="true" size={15} /> : <Folder aria-hidden="true" size={15} />
            ) : <FileTypeIcon path={entry.path} size={15} />}
            <span>{entry.name}</span>
            {entry.isProtected ? <small>入口</small> : null}
          </button>
        </div>
      );
      if (!isDirectory || !isExpanded) return [row];
      return [row, ...renderDirectory(entry.path, depth + 1)];
    });
  }

  const rootEntries = renderDirectory("", 0);
  return rootEntries.length === 0 ? (
    <div className="configuration-file-workspace__tree-empty">目录为空</div>
  ) : <>{rootEntries}</>;
}
