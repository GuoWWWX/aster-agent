import { Check } from "lucide-react";
import type { ReactElement } from "react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../../components/ui/select.js";
import { MERMAID_THEMES, type MermaidThemeId } from "../../../lib/mermaid-theme-settings.js";

type ThemePair = { name: string; light: MermaidThemeId; dark: MermaidThemeId };
const visualPresets: readonly (ThemePair & { colors: readonly string[] })[] = [
  { name: "原生多色", light: "redux-color", dark: "redux-dark-color", colors: ["#c4dcff", "#f9c967", "#aa80d8", "#7053c7"] },
  { name: "简洁灰阶", light: "redux", dark: "redux-dark", colors: ["#d8dce4", "#b5bac5", "#7c8494", "#4b5260"] },
  { name: "柔和渐变", light: "neo", dark: "neo-dark", colors: ["#d7efff", "#ded7ff", "#c8a3e8", "#adb8f3"] },
  { name: "传统主题", light: "default", dark: "dark", colors: ["#dcd6ed", "#e8edc2", "#b6d3d6", "#e6c1c6"] },
];
const themePairs: readonly ThemePair[] = [...visualPresets,
  { name: "森林", light: "forest", dark: "forest" },
  { name: "中性", light: "neutral", dark: "neutral" },
  { name: "基础", light: "base", dark: "base" },
];

export function mermaidThemeLabel(id: MermaidThemeId): string {
  return MERMAID_THEMES.find(theme => theme.id === id)!.label;
}

export function MermaidThemePresets({ light, dark, onChange }: { light: MermaidThemeId; dark: MermaidThemeId; onChange: (pair: { light: MermaidThemeId; dark: MermaidThemeId }) => void }): ReactElement {
  const selectedPair = themePairs.find(pair => pair.light === light && pair.dark === dark);
  return <section className="@container space-y-3" aria-label="整体配色方案">
    <h3 className="text-[length:var(--app-font-size-body)] font-medium">整体配色方案</h3>
    <div className="grid grid-cols-2 gap-[5px] @min-[440px]:grid-cols-4">
      {visualPresets.map(preset => <button key={preset.name} type="button" aria-pressed={selectedPair?.name === preset.name} onClick={() => onChange({ light: preset.light, dark: preset.dark })} className="relative flex min-w-0 flex-col items-center gap-2 rounded-[var(--app-radius)] border border-[var(--app-border)] px-2 py-3 text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)] aria-pressed:border-[var(--app-accent)] aria-pressed:bg-[var(--app-selection)]">
        <span aria-hidden="true" className="flex items-center justify-center gap-1">{preset.colors.map(color => <span key={color} data-mermaid-color-swatch="" className="h-5 w-4 rounded-[var(--app-radius-small)]" style={{ background: color }} />)}</span>
        <span className="font-medium">{preset.name}</span>
        {selectedPair?.name === preset.name && <Check aria-hidden="true" className="absolute right-1 top-1 size-3.5 text-[var(--app-accent)]" />}
      </button>)}
    </div>
    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-[5px]">
      <span className="text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">整体选择</span>
      <Select value={selectedPair?.name ?? "custom"} onValueChange={name => { const pair = themePairs.find(item => item.name === name); if (pair) onChange({ light: pair.light, dark: pair.dark }); }}>
        <SelectTrigger aria-label="整体选择主题" className="w-full"><SelectValue>{selectedPair?.name ?? "自定义深浅搭配"}</SelectValue></SelectTrigger>
        <SelectContent className="max-h-80">
          <SelectItem value="custom" disabled>自定义深浅搭配</SelectItem>
          {themePairs.map(pair => <SelectItem key={pair.name} value={pair.name} className="h-auto min-h-9 py-2"><span className="flex min-w-0 flex-col items-start gap-0.5"><span>{pair.name}</span><span className="text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">{mermaidThemeLabel(pair.light)} / {mermaidThemeLabel(pair.dark)}</span></span></SelectItem>)}
        </SelectContent>
      </Select>
    </div>
  </section>;
}
