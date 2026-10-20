import { useState, type ReactElement } from "react";
import { Palette, RotateCcw, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "../../../components/ui/dialog.js";
import { IconButton } from "../../../components/ui/icon-button.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select.js";
import { MERMAID_DIAGRAM_TYPES, MERMAID_THEMES, normalizeMermaidThemes, type MermaidThemeId, type MermaidThemeSettings, type MermaidDiagramType } from "../../../lib/mermaid-theme-settings.js";
import { useWorkbenchUiStore } from "../../../stores/workbench-ui-store.js";
import { SettingsCategoryHeading, SettingsConfigurationCard } from "../components/settings-configuration-card.js";
import { MermaidThemePreview } from "./mermaid-theme-preview.js";

const themePairs: readonly { name: string; light: MermaidThemeId; dark: MermaidThemeId }[] = [
  { name: "原生多色", light: "redux-color", dark: "redux-dark-color" },
  { name: "简洁灰阶", light: "redux", dark: "redux-dark" },
  { name: "柔和渐变", light: "neo", dark: "neo-dark" },
  { name: "传统主题", light: "default", dark: "dark" },
  { name: "森林", light: "forest", dark: "forest" },
  { name: "中性", light: "neutral", dark: "neutral" },
  { name: "基础", light: "base", dark: "base" },
];

function ThemeSelect({ label, value, inherit = false, onChange }: { label: string; value: string; inherit?: boolean; onChange: (value: string) => void }): ReactElement {
  return <Select value={value} onValueChange={onChange}>
    <SelectTrigger aria-label={label} className="h-8 w-full min-w-0 text-[length:var(--app-font-size-control)]"><SelectValue /></SelectTrigger>
    <SelectContent className="max-h-64">
      {inherit && <SelectItem value="inherit">跟随全局</SelectItem>}
      {MERMAID_THEMES.map(theme => <SelectItem key={theme.id} value={theme.id}>{theme.label}</SelectItem>)}
    </SelectContent>
  </Select>;
}

export function MermaidAppearanceSettings(): ReactElement {
  const [open, setOpen] = useState(false);
  const value = useWorkbenchUiStore(state => state.mermaidThemes);
  const save = useWorkbenchUiStore(state => state.setMermaidThemes);
  return <section className="settings-general-category" aria-labelledby="mermaid-theme-heading">
    <SettingsCategoryHeading id="mermaid-theme-heading" icon={Palette}>Mermaid 图表配色</SettingsCategoryHeading>
    <SettingsConfigurationCard className="p-0">
      <article className="settings-general-row">
        <div><h4>图表主题</h4><p>对话内容和侧边 Markdown 文档共用。浅色 {value.light} / 深色 {value.dark}。</p></div>
        <button type="button" className="settings-secondary-button" onClick={() => setOpen(true)}>配置图表配色</button>
      </article>
    </SettingsConfigurationCard>
    <Dialog open={open} onOpenChange={setOpen}>
      {open && <MermaidThemeDialog value={value} onApply={settings => { save(settings); setOpen(false); }} onCancel={() => setOpen(false)} />}
    </Dialog>
  </section>;
}

export function MermaidThemeDialog({ value, onApply, onCancel }: { value: MermaidThemeSettings; onApply: (settings: MermaidThemeSettings) => void; onCancel: () => void }): ReactElement {
  const [draft, setDraft] = useState(() => normalizeMermaidThemes(value));
  const [presetName, setPresetName] = useState("");
  const [previewType, setPreviewType] = useState<MermaidDiagramType>("flowchart");
  const selectedPair = themePairs.find(pair => pair.light === draft.light && pair.dark === draft.dark);
  const setOverride = (type: MermaidDiagramType, mode: "light" | "dark", theme: string): void => {
    const pair = { ...draft.diagrams[type] };
    if (theme === "inherit") delete pair[mode];
    else pair[mode] = MERMAID_THEMES.find(item => item.id === theme)!.id;
    setDraft(normalizeMermaidThemes({ ...draft, diagrams: { ...draft.diagrams, [type]: pair } }));
    setPreviewType(type);
  };
  const savePreset = (): void => {
    const name = presetName.trim();
    if (!name) return;
    const preset = { name, light: draft.light, dark: draft.dark, diagrams: structuredClone(draft.diagrams) };
    const presets = draft.presets.some(item => item.name === name) ? draft.presets.map(item => item.name === name ? preset : item) : [...draft.presets, preset];
    setDraft({ ...draft, presets });
    setPresetName(name);
  };
  return <DialogContent aria-describedby="mermaid-theme-description" className="flex max-h-[90dvh] w-[calc(100vw-20px)] max-w-[1100px] flex-col gap-0 overflow-hidden p-0">
    <header className="shrink-0 border-b border-[var(--app-border)] px-4 py-3 pr-12"><DialogTitle>Mermaid 图表主题</DialogTitle><p id="mermaid-theme-description" className="mt-1 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">默认深浅配色、各图表单独设置及自定义组合；应用后自动保存。</p></header>
    <div className="@container min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable]">
      <div className="grid min-w-0 gap-[5px] p-4 @min-[800px]:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)]">
        <div className="min-w-0 space-y-5">
          <section className="space-y-2" aria-label="整体配色方案">
            <h3 className="text-[length:var(--app-font-size-body)] font-medium">整体配色方案</h3>
            <div className="grid grid-cols-2 gap-[5px]">
              {themePairs.slice(0, 4).map(pair => <button key={pair.name} type="button" aria-pressed={selectedPair?.name === pair.name} onClick={() => setDraft({ ...draft, light: pair.light, dark: pair.dark })} className="rounded-[var(--app-radius)] border border-[var(--app-border)] px-2 py-2 text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)] aria-pressed:bg-[var(--app-selection)] aria-pressed:text-[var(--app-selection-foreground)]">{pair.name}</button>)}
            </div>
            <Select value={selectedPair?.name ?? "custom"} onValueChange={name => { const pair = themePairs.find(item => item.name === name); if (pair) setDraft({ ...draft, light: pair.light, dark: pair.dark }); }}>
              <SelectTrigger aria-label="整体选择主题"><SelectValue /></SelectTrigger>
              <SelectContent><SelectItem value="custom" disabled>自定义深浅搭配</SelectItem>{themePairs.map(pair => <SelectItem key={pair.name} value={pair.name}>{pair.name} · {pair.light} / {pair.dark}</SelectItem>)}</SelectContent>
            </Select>
          </section>
          <section className="space-y-2" aria-label="我的组合">
            <h3 className="text-[length:var(--app-font-size-body)] font-medium">我的组合</h3>
            <div className="flex min-w-0 items-center gap-[5px]">
              <input aria-label="组合名称" placeholder="输入组合名称" maxLength={40} value={presetName} onChange={event => setPresetName(event.target.value)} onKeyDown={event => { if (event.key === "Enter" && !event.nativeEvent.isComposing) { event.preventDefault(); savePreset(); } }} className="h-8 min-w-0 flex-1 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-transparent px-2 text-[length:var(--app-font-size-control)]" />
              <button type="button" className="settings-secondary-button" disabled={!presetName.trim()} onClick={savePreset}>{draft.presets.some(item => item.name === presetName.trim()) ? "更新同名组合" : "保存为组合"}</button>
            </div>
            {draft.presets.length > 0 && <ul className="m-0 max-h-32 list-none overflow-y-auto p-0 [scrollbar-gutter:stable]">{draft.presets.map(preset => <li key={preset.name} className="flex min-w-0 items-center gap-[5px]">
              <button type="button" aria-label={`应用组合：${preset.name}`} className="min-w-0 flex-1 truncate rounded-[var(--app-radius)] p-2 text-left text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)]" onClick={() => { setDraft(normalizeMermaidThemes({ ...draft, light: preset.light, dark: preset.dark, diagrams: preset.diagrams })); setPresetName(preset.name); }}>{preset.name} · {preset.light} / {preset.dark}</button>
              <IconButton label={`删除组合：${preset.name}`} onClick={() => { setDraft({ ...draft, presets: draft.presets.filter(item => item.name !== preset.name) }); if (presetName === preset.name) setPresetName(""); }}><Trash2 aria-hidden="true" size={16} /></IconButton>
            </li>)}</ul>}
            <p className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">组合的新增、更新和删除随底部“应用配置”一起保存。</p>
          </section>
          <section className="space-y-2" aria-label="默认主题">
            <h3 className="text-[length:var(--app-font-size-body)] font-medium">默认主题</h3>
            <div className="grid grid-cols-2 gap-[5px]">{(["light", "dark"] as const).map(mode => <div key={mode} className="min-w-0 space-y-1"><span className="block text-[length:var(--app-font-size-control)]">{mode === "light" ? "浅色模式" : "深色模式"}</span><ThemeSelect label={`${mode === "light" ? "浅色" : "深色"}默认主题`} value={draft[mode]} onChange={theme => setDraft({ ...draft, [mode]: theme })} /></div>)}</div>
          </section>
          <section className="space-y-2" aria-label="按图表类型设置">
            <div className="flex items-center justify-between gap-[5px]"><h3 className="text-[length:var(--app-font-size-body)] font-medium">按图表类型设置</h3><button type="button" className="settings-secondary-button" disabled={!Object.keys(draft.diagrams).length} onClick={() => setDraft({ ...draft, diagrams: {} })}>清除单独设置</button></div>
            <div className="max-h-80 overflow-auto rounded-[var(--app-radius)] border border-[var(--app-border)] [scrollbar-gutter:stable]">
              <table className="w-full table-fixed text-[length:var(--app-font-size-control)]"><thead className="sticky top-0 z-10 bg-[var(--app-panel-subtle)] text-left"><tr><th className="w-[26%] p-2 font-medium">图表类型</th><th className="w-[37%] p-2 font-medium">浅色</th><th className="p-2 font-medium">深色</th></tr></thead>
                <tbody>{MERMAID_DIAGRAM_TYPES.map(type => <tr key={type.id} className="border-t border-[var(--app-border)]"><th className="p-2 text-left font-normal"><button type="button" onClick={() => setPreviewType(type.id)} className="hover:underline">{type.label}{draft.diagrams[type.id] && <span aria-label="已单独设置" className="ml-1 text-[var(--app-accent)]">●</span>}</button></th>{(["light", "dark"] as const).map(mode => <td key={mode} className="p-1"><ThemeSelect label={`${type.label}${mode === "light" ? "浅色" : "深色"}主题`} value={draft.diagrams[type.id]?.[mode] ?? "inherit"} inherit onChange={theme => setOverride(type.id, mode, theme)} /></td>)}</tr>)}</tbody>
              </table>
            </div>
          </section>
        </div>
        <section className="min-w-0 space-y-3" aria-label="实时预览">
          <h3 className="text-[length:var(--app-font-size-body)] font-medium">实时预览</h3>
          <Select value={previewType} onValueChange={type => setPreviewType(MERMAID_DIAGRAM_TYPES.find(item => item.id === type)!.id)}><SelectTrigger aria-label="预览图表类型"><SelectValue /></SelectTrigger><SelectContent>{MERMAID_DIAGRAM_TYPES.map(type => <SelectItem key={type.id} value={type.id}>{type.label}</SelectItem>)}</SelectContent></Select>
          <div className="grid grid-cols-2 gap-[5px]"><MermaidThemePreview type={previewType} dark={false} settings={draft} /><MermaidThemePreview type={previewType} dark settings={draft} /></div>
          <p className="text-[length:var(--app-font-size-control)] leading-relaxed text-[var(--app-muted-foreground)]">全部 11 个主题都可用于浅色和深色模式。图表源码中的主题和手动配色优先保留，低对比度文字与连线会自动校正。</p>
        </section>
      </div>
    </div>
    <footer className="flex shrink-0 items-center justify-between gap-[5px] border-t border-[var(--app-border)] px-4 py-3">
      <button type="button" className="settings-secondary-button" onClick={() => setDraft(normalizeMermaidThemes({ presets: draft.presets }))}><RotateCcw aria-hidden="true" size={14} />恢复默认</button>
      <div className="flex items-center gap-[5px]"><button type="button" className="settings-secondary-button" onClick={onCancel}>取消</button><button type="button" className="settings-primary-button" onClick={() => onApply(normalizeMermaidThemes(draft))}>应用配置</button></div>
    </footer>
  </DialogContent>;
}
