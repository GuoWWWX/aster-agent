import { ChevronRight, Folder, PanelRightClose, PanelRightOpen } from "lucide-react";
import { useEffect, useRef, type ReactElement } from "react";
import type { ProjectEntry } from "@agent/protocol";
import { DocumentCodeEditor } from "../../components/editor/document-code-editor.js";
import { LiveMarkdownEditor, type LiveMarkdownEditorHandle } from "../../components/editor/live-markdown-editor.js";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { LoadingState } from "../../components/ui/loading.js";
import { ProjectImageViewer } from "./project-image-viewer.js";
import {
  directoryLabelForFile,
  isMarkdownFile,
  isProjectPreviewImagePath,
  languageForPath,
  type ProjectImageNavigation,
} from "./sidebar-file-model.js";
import type { FilePreviewState, ProjectFileTab } from "./sidebar-workspace-types.js";

export function FilePreview({
  imageNavigation,
  isDark,
  isTreeCollapsed,
  state,
  tab,
  onChange,
  onDirty,
  onLocateDirectory,
  onLocateFile,
  onNavigateImage,
  onOverwrite,
  onReload,
  onRequestSave,
  onToggleTree,
}: {
  imageNavigation: ProjectImageNavigation | null;
  isDark: boolean;
  isTreeCollapsed: boolean;
  state: FilePreviewState | undefined;
  tab: ProjectFileTab;
  onChange: (value: string) => void;
  onDirty: (content: string) => void;
  onLocateDirectory: () => void;
  onLocateFile: () => void;
  onNavigateImage: (entry: ProjectEntry) => void;
  onOverwrite: () => void | Promise<void>;
  onReload: () => void;
   onRequestSave: (content?: string) => void;
  onToggleTree: () => void;
}): ReactElement {
  const file = state?.file ?? null;
  const isImagePreview = isProjectPreviewImagePath(tab.path);
  const editorRef = useRef<LiveMarkdownEditorHandle | null>(null);
  const canEdit = file !== null
    && file.content !== null
    && !file.isBinary
    && !file.truncated;
  const draft = state?.draft ?? file?.content ?? "";

  useEffect(() => {
    editorRef.current?.requestMeasure();
  }, [tab.id, isTreeCollapsed]);

  return (
    <section className="right-sidebar-file" aria-label={tab.name}>
      <header className="right-sidebar-file__header">
        <div className="right-sidebar-file__path" aria-label="文件路径">
          <button
            aria-label={`在文件树定位目录 ${directoryLabelForFile(tab.path)}`}
            className="right-sidebar-file__path-link right-sidebar-file__path-link--directory"
            title={directoryLabelForFile(tab.path)}
            type="button"
            onClick={onLocateDirectory}
          >
            <Folder
              aria-hidden="true"
              className="right-sidebar-file__directory-icon"
              size={14}
              strokeWidth={1.75}
            />
            <span className="right-sidebar-file__directory">
              {directoryLabelForFile(tab.path)}
            </span>
          </button>
          <ChevronRight
            aria-hidden="true"
            className="right-sidebar-file__path-separator"
            size={12}
            strokeWidth={1.75}
          />
          <button
            aria-label={`在文件树定位文件 ${tab.name}`}
            className="right-sidebar-file__path-link right-sidebar-file__path-link--file"
            title={tab.path}
            type="button"
            onClick={onLocateFile}
          >
            <FileTypeIcon
              className="right-sidebar-file__type-icon"
              javaDeclarationKind={tab.javaDeclarationKind}
              path={tab.path}
              size={14}
            />
            <span className="right-sidebar-file__name">{tab.name}</span>
          </button>
        </div>
        <div className="right-sidebar-file__actions">
          {state?.isSaving ? (
            <span className="text-[var(--app-muted-foreground)] text-[var(--app-font-size-caption)]" role="status">
              保存中
            </span>
          ) : state?.isDirty ? (
            <span className="text-[var(--app-accent)] text-[var(--app-font-size-caption)]" role="status">
              未保存
            </span>
          ) : null}
          <IconButton
            label={isTreeCollapsed ? "展开文件树" : "收起文件树"}
            size="compact"
            variant="quiet"
            onClick={onToggleTree}
          >
            {isTreeCollapsed ? (
              <PanelRightOpen aria-hidden="true" size={14} />
            ) : (
              <PanelRightClose aria-hidden="true" size={14} />
            )}
          </IconButton>
        </div>
      </header>
      {state === undefined || state.isLoading ? (
        <LoadingState label="正在读取文件" className="h-full flex-1" />
      ) : isImagePreview ? (
        state.error !== null || state.imageDataUrl === null ? (
          <div className="right-sidebar-file__state">
            <p>{state.error ?? "无法预览图片"}</p>
            <button type="button" onClick={onReload}>重试</button>
          </div>
        ) : (
          <ProjectImageViewer
            key={tab.id}
            currentIndex={imageNavigation?.currentIndex ?? 0}
            dataUrl={state.imageDataUrl}
            fileName={tab.name}
            hasNext={imageNavigation?.next !== null && imageNavigation?.next !== undefined}
            hasPrevious={imageNavigation?.previous !== null && imageNavigation?.previous !== undefined}
            total={imageNavigation?.total ?? 1}
            onNext={() => {
              if (imageNavigation?.next !== null && imageNavigation?.next !== undefined) {
                onNavigateImage(imageNavigation.next);
              }
            }}
            onPrevious={() => {
              if (imageNavigation?.previous !== null && imageNavigation?.previous !== undefined) {
                onNavigateImage(imageNavigation.previous);
              }
            }}
          />
        )
      ) : state.error !== null && file === null ? (
        <div className="right-sidebar-file__state">
          <p>{state.error}</p>
          <button type="button" onClick={onReload}>重试</button>
        </div>
      ) : file === null || file.isBinary || file.content === null ? (
        <div className="right-sidebar-file__state">二进制文件不可预览</div>
      ) : (
        <>
          {file.truncated ? (
            <div className="right-sidebar-file__notice">文件较大，仅显示前 2 MB，只读模式</div>
          ) : null}
          {state.conflict === "locked" ? (
            <div className="right-sidebar-file__notice" role="status">
              Agent 正在修改，稍后自动重试保存
            </div>
          ) : null}
          {state.conflict === "stale" ? (
            <div className="right-sidebar-file__notice flex items-center gap-2" role="alert">
              <span className="min-w-0 flex-1">文件已在别处更改，当前草稿尚未覆盖。</span>
              <button className="shrink-0" type="button" onClick={onReload}>重新加载</button>
              <button className="shrink-0" type="button" onClick={() => void onOverwrite()}>仍然覆盖</button>
            </div>
          ) : null}
          {state.error !== null ? (
            <div className="right-sidebar-file__notice" role="alert">{state.error}</div>
          ) : null}
          {isMarkdownFile(tab.path) ? (
            <LiveMarkdownEditor
              ref={editorRef}
              className="right-sidebar-file__editor"
              contentRevision={state?.contentRevision ?? 0}
              documentKey={tab.id}
              initialContent={draft}
              isDark={isDark}
              markdownSourcePath={tab.path}
              onDocChanged={onChange}
              onDirty={onDirty}
              onRequestSave={onRequestSave}
              readOnly={!canEdit}
            />
          ) : (
            <DocumentCodeEditor
              ariaLabel={`${tab.name} 文件内容`}
              className="right-sidebar-file__editor"
              isDark={isDark}
              language={languageForPath(tab.path)}
              value={draft}
              readOnly={!canEdit}
              onChange={onChange}
              onSave={onRequestSave}
            />
          )}
        </>
      )}
    </section>
  );
}
