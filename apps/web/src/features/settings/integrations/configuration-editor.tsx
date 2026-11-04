import { LoadingState } from "../../../components/ui/loading.js";
import {
  Braces,
  ChevronLeft,
  ChevronRight,
  CirclePlus,
  PanelRight,
  SlidersHorizontal,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { type ReactElement, type ReactNode } from "react";
import { type ConfigurationScope } from "@agent/protocol";
import { IconButton } from "../../../components/ui/icon-button.js";
import { SettingsDirectoryDeleteButton } from "../components/settings-directory-delete-button.js";
import { DocumentCodeEditor } from "../../../components/editor/document-code-editor.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { useWorkbenchUiStore } from "../../../stores/workbench-ui-store.js";
import { type AutoSaveState } from "../use-queued-auto-save.js";
import { autoSaveStateLabel, nextConfigurationId } from "../configuration-state.js";

const CONFIGURATIONS_PER_PAGE = 8;

export type ConfigurationEditorMode = "visual" | "json";

export function ConfigurationModeSwitch({
  mode,
  onChange,
}: {
  mode: ConfigurationEditorMode;
  onChange: (mode: ConfigurationEditorMode) => void;
}): ReactElement {
  return (
    <div className="settings-segmented" role="group" aria-label="配置方式">
      <button aria-pressed={mode === "visual"} type="button" onClick={() => onChange("visual")}>
        <SlidersHorizontal aria-hidden="true" size={14} />
        图形
      </button>
      <button aria-pressed={mode === "json"} type="button" onClick={() => onChange("json")}>
        <Braces aria-hidden="true" size={14} />
        JSON
      </button>
    </div>
  );
}

export function ConfigurationStatus({ error }: { error: string | null }): ReactElement {
  return (
    error === null ? <LoadingState label="正在读取配置…" className="h-full flex-1" /> : <div className="settings-configuration-status" role="alert">{error}</div>
  );
}

export function ConfigurationList({
  actionLabel,
  addDisabled = false,
  emptyLabel,
  headingLabel,
  icon: Icon,
  items,
  onAdd,
  onDelete,
  onSelect,
  selectedId,
}: {
  actionLabel: string;
  addDisabled?: boolean;
  emptyLabel: string;
  headingLabel: string;
  icon: LucideIcon;
  items: { enabled: boolean; id: string; name: string; summary: string; deleteDisabledReason?: string | undefined }[];
  onAdd: () => void;
  onDelete: (id: string) => void;
  onSelect: (id: string) => void;
  selectedId: string | null;
}): ReactElement {
  const selectedIndex = items.findIndex((item) => item.id === selectedId);
  const pageCount = Math.max(1, Math.ceil(items.length / CONFIGURATIONS_PER_PAGE));
  const currentPage = selectedIndex < 0
    ? 0
    : Math.floor(selectedIndex / CONFIGURATIONS_PER_PAGE);
  const pagedItems = items.slice(
    currentPage * CONFIGURATIONS_PER_PAGE,
    (currentPage + 1) * CONFIGURATIONS_PER_PAGE,
  );

  function selectPage(page: number): void {
    const firstItem = items[page * CONFIGURATIONS_PER_PAGE];
    if (firstItem !== undefined) onSelect(firstItem.id);
  }

  return (
    <aside className="settings-integration-list">
      <header className="settings-integration-list__heading">
        <strong>{headingLabel}</strong>
        <IconButton disabled={addDisabled} label={actionLabel} size="compact" onClick={onAdd}>
          <CirclePlus aria-hidden="true" size={18} />
        </IconButton>
      </header>
      <div className="settings-integration-list__items">
        {items.length === 0 ? <p>{emptyLabel}</p> : pagedItems.map((item) => (
          <div key={item.id} className="group/directory relative" data-active={selectedId === item.id}>
          <button
            aria-pressed={selectedId === item.id}
            className="settings-integration-list__item"
            data-active={selectedId === item.id}
            title={`选择 ${item.name}`}
            type="button"
            onClick={() => onSelect(item.id)}
          >
            <span className="settings-integration-list__icon"><Icon aria-hidden="true" size={15} /></span>
            <span className="settings-integration-list__identity">
              <strong>{item.name}</strong>
              <small>{item.summary}</small>
            </span>
            <span className="settings-integration-list__status" data-enabled={item.enabled} />
          </button>
          <SettingsDirectoryDeleteButton
            disabled={item.deleteDisabledReason !== undefined}
            {...(item.deleteDisabledReason === undefined ? {} : { disabledReason: item.deleteDisabledReason })}
            label={`删除 ${item.name}`}
            onDelete={() => onDelete(item.id)}
          />
          </div>
        ))}
      </div>
      <footer className="settings-integration-list__footer">
        <span className="settings-provider-list__count">共 {items.length} 项</span>
        <div
          aria-label={`${headingLabel}分页`}
          className="settings-provider-list__pagination-controls"
        >
          <button
            aria-label="上一页"
            disabled={currentPage === 0}
            title="上一页"
            type="button"
            onClick={() => selectPage(Math.max(0, currentPage - 1))}
          >
            <ChevronLeft aria-hidden="true" size={14} />
          </button>
          <span aria-label={`第 ${currentPage + 1} 页，共 ${pageCount} 页`}>
            {currentPage + 1} / {pageCount}
          </span>
          <button
            aria-label="下一页"
            disabled={currentPage >= pageCount - 1}
            title="下一页"
            type="button"
            onClick={() => selectPage(Math.min(pageCount - 1, currentPage + 1))}
          >
            <ChevronRight aria-hidden="true" size={14} />
          </button>
        </div>
      </footer>
    </aside>
  );
}

export function ConfigurationEmpty({
  icon: Icon,
  label,
  onAdd,
}: {
  icon: LucideIcon;
  label: string;
  onAdd: () => void;
}): ReactElement {
  return (
    <div className="settings-integration-empty">
      <Icon aria-hidden="true" size={24} />
      <button className="settings-secondary-button" type="button" onClick={onAdd}>
        <CirclePlus aria-hidden="true" size={15} />
        {label}
      </button>
    </div>
  );
}

export function ConfigurationEditorHeader({
  enabled,
  fileActionLabel,
  icon: Icon,
  name,
  onOpenFile,
  onToggle,
}: {
  enabled: boolean;
  fileActionLabel: string;
  icon: LucideIcon;
  name: string;
  onOpenFile: () => void;
  onToggle: (enabled: boolean) => void;
}): ReactElement {
  return (
    <header className="settings-integration-editor__header">
      <span className="settings-configuration-row__icon"><Icon aria-hidden="true" size={16} /></span>
      <div>
        <h3>基本配置</h3>
        <p>{name.trim() || "未命名配置"}</p>
      </div>
      <button className="settings-secondary-button" type="button" onClick={onOpenFile}>
        <PanelRight aria-hidden="true" size={15} />
        {fileActionLabel}
      </button>
      <label className="settings-switch" data-config-path="enabled">
        <input
          aria-label={enabled ? "停用配置" : "启用配置"}
          checked={enabled}
          type="checkbox"
          onChange={(event) => onToggle(event.target.checked)}
        />
        <span aria-hidden="true" />
      </label>
    </header>
  );
}

export function ConfigurationField({
  children,
  className = "",
  configPath,
  label,
}: {
  children: ReactNode;
  className?: string;
  configPath?: string;
  label: string;
}): ReactElement {
  return (
    <label className={`settings-field ${className}`.trim()} data-config-path={configPath} data-settings-field={label}>
      <span>{label}</span>
      {children}
    </label>
  );
}

export function ScopeField({
  configPath,
  onChange,
  scope,
}: {
  configPath?: string;
  onChange: (scope: ConfigurationScope) => void;
  scope: ConfigurationScope;
}): ReactElement {
  return (
    <ConfigurationField {...(configPath === undefined ? {} : { configPath })} label="作用域">
      <Select value={scope} onValueChange={(value) => onChange(value as ConfigurationScope)}>
        <SelectTrigger className="settings-select-trigger"><SelectValue /></SelectTrigger>
        <SelectContent align="start">
          <SelectItem value="user">用户</SelectItem>
          <SelectItem value="team">团队</SelectItem>
          <SelectItem value="project">项目</SelectItem>
        </SelectContent>
      </Select>
    </ConfigurationField>
  );
}

export function KeyValueEditor({
  configPath,
  label,
  onChange,
  value,
}: {
  configPath?: string;
  label: string;
  onChange: (value: Record<string, string>) => void;
  value: Record<string, string>;
}): ReactElement {
  const entries = Object.entries(value);

  function updateEntry(index: number, key: string, entryValue: string): void {
    onChange(Object.fromEntries(entries.map(([currentKey, currentValue], currentIndex) =>
      currentIndex === index ? [key, entryValue] : [currentKey, currentValue],
    )));
  }

  function addEntry(): void {
    const key = nextConfigurationId("KEY", Object.keys(value));
    onChange({ ...value, [key]: "" });
  }

  return (
    <section className="settings-key-value-editor" data-config-path={configPath}>
      <header>
        <h4>{label}</h4>
        <button aria-label={`添加${label}`} title={`添加${label}`} type="button" onClick={addEntry}>
          <CirclePlus aria-hidden="true" size={15} />
        </button>
      </header>
      {entries.length === 0 ? <p>暂无{label}</p> : entries.map(([key, entryValue], index) => (
        <div key={`${key}-${index}`} className="settings-key-value-editor__row">
          <input aria-label={`${label}名称`} value={key} onChange={(event) => updateEntry(index, event.target.value, entryValue)} />
          <input aria-label={`${label}值`} value={entryValue} onChange={(event) => updateEntry(index, key, event.target.value)} />
          <button
            aria-label={`删除${key}`}
            title={`删除${key}`}
            type="button"
            onClick={() => onChange(Object.fromEntries(entries.filter((_, currentIndex) => currentIndex !== index)))}
          >
            <Trash2 aria-hidden="true" size={14} />
          </button>
        </div>
      ))}
    </section>
  );
}

export function ConfigurationEditorFooter({
  error,
  saveState,
}: {
  error: string | null;
  saveState: AutoSaveState;
}): ReactElement {
  return (
    <footer className="settings-integration-editor__footer">
      <div>
        {error === null ? <span>{autoSaveStateLabel(saveState)}</span> : <p role="alert">{error}</p>}
      </div>
    </footer>
  );
}

export function JsonConfigurationEditor({
  error,
  saveState,
  label,
  onChange,
  onCommit,
  value,
}: {
  error: string | null;
  saveState: AutoSaveState;
  label: string;
  onChange: (value: string) => void;
  onCommit: () => void;
  value: string;
}): ReactElement {
  const isDark = useWorkbenchUiStore((state) => state.themeMode === "dark");
  return (
    <div className="settings-json-editor">
      <div className="settings-json-editor__toolbar">
        <span><Braces aria-hidden="true" size={15} />{label}</span>
        {saveState === "idle" ? null : <small>{autoSaveStateLabel(saveState)}</small>}
      </div>
      <DocumentCodeEditor
        ariaLabel={label}
        isDark={isDark}
        language="json"
        value={value}
        onChange={onChange}
        onSave={onCommit}
      />
      {error === null ? null : <p className="settings-operation-error" role="alert">{error}</p>}
    </div>
  );
}
