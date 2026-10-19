import { Check, ChevronRight, FolderOpen, PanelRightClose, PanelRightOpen } from "lucide-react";
import type { ReactElement } from "react";
import { DocumentCodeEditor } from "../../components/editor/document-code-editor.js";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { LoadingState, Spinner } from "../../components/ui/loading.js";
import { languageForPath } from "./sidebar-file-model.js";
import type { ConfigurationFilePreviewState, ConfigurationFileTab } from "./sidebar-workspace-types.js";

export function ConfigurationFilePreview({
  isDark,
  isTreeCollapsed,
  state,
  tab,
  onChange,
  onReload,
  onSave,
  onToggleTree,
}: {
  isDark: boolean;
  isTreeCollapsed: boolean;
  state: ConfigurationFilePreviewState | undefined;
  tab: ConfigurationFileTab;
  onChange: (value: string) => void;
  onReload: () => void;
  onSave: () => void;
  onToggleTree: () => void;
}): ReactElement {
  const file = state?.file ?? null;
  const canEdit = file !== null
    && file.content !== null
    && !file.isBinary
    && !file.truncated
    && file.readOnly !== true;
  const status = state === undefined || state.isLoading
    ? "正在读取文件"
    : state.isSaving
      ? "正在保存"
      : state.isDirty
        ? "有未保存改动"
        : file?.readOnly === true ? "系统技能 · 只读" : "已保存";
  return (
    <section className="right-sidebar-file right-sidebar-config-file" aria-label={tab.name}>
      <header className="right-sidebar-file__header">
        <div className="right-sidebar-file__path" aria-label="配置文件路径">
          <span className="right-sidebar-config-file__workspace" title={tab.title}>
            <FolderOpen aria-hidden="true" size={14} />
            {tab.title}
          </span>
          <ChevronRight
            aria-hidden="true"
            className="right-sidebar-file__path-separator"
            size={12}
            strokeWidth={1.75}
          />
          <span className="right-sidebar-config-file__path" title={tab.path}>
            <FileTypeIcon className="right-sidebar-file__type-icon" path={tab.path} size={14} />
            {tab.path}
          </span>
        </div>
        <div className="right-sidebar-file__actions">
          <IconButton
            disabled={!canEdit || state?.isDirty !== true || state?.isSaving === true}
            label="立即保存文件"
            size="compact"
            variant="quiet"
            onClick={onSave}
          >
            {state?.isSaving ? (
              <Spinner aria-hidden="true" size={14} />
            ) : (
              <Check aria-hidden="true" size={15} />
            )}
          </IconButton>
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
      ) : state.error !== null ? (
        <div className="right-sidebar-file__state" role="alert">
          <p>{state.error}</p>
          <button type="button" onClick={onReload}>重试</button>
        </div>
      ) : file === null || file.isBinary || file.content === null ? (
        <div className="right-sidebar-file__state">二进制文件不可预览或编辑</div>
      ) : (
        <>
          {file.truncated ? (
            <div className="right-sidebar-file__notice">文件较大，仅显示前 2 MB，不能直接保存</div>
          ) : null}
          <DocumentCodeEditor
            readOnly={!canEdit}
            ariaLabel={`${tab.name} 文件编辑器`}
            className="right-sidebar-file__editor"
            isDark={isDark}
            language={languageForPath(tab.path)}
            value={state.draft}
            onChange={onChange}
            onSave={onSave}
          />
        </>
      )}
      <footer className="right-sidebar-config-file__footer">
        <span>{status}</span>
        {file?.isProtected ? <span>入口文件可编辑，不可删除</span> : null}
      </footer>
    </section>
  );
}
