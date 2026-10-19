import { Eye, Palette, PanelRight, RefreshCw, Type } from "lucide-react";
import { SettingsSectionHeader } from "../components/settings-section-header.js";
import { type ReactElement } from "react";
import { DEFAULT_APPLICATION_SETTINGS } from "@agent/protocol";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../components/ui/select.js";
import { useWorkbenchUiStore, type ThemeMode } from "../../../stores/workbench-ui-store.js";
import {
  SettingsCategoryHeading,
  SettingsConfigurationCard,
} from "../components/settings-configuration-card.js";

export function AppearanceSettings(): ReactElement {
  const setThemeMode = useWorkbenchUiStore((state) => state.setThemeMode);
  const themeMode = useWorkbenchUiStore((state) => state.themeMode);
  const uiFontSize = useWorkbenchUiStore((state) => state.uiFontSize);
  const chatFontSize = useWorkbenchUiStore((state) => state.chatFontSize);
  const codeFontSize = useWorkbenchUiStore((state) => state.codeFontSize);
  const setFontSize = useWorkbenchUiStore((state) => state.setAppearanceFontSize);
  const settingsWidth = useWorkbenchUiStore((state) => state.settingsNavigationWidth);
  const projectWidth = useWorkbenchUiStore((state) => state.projectNavigatorWidth);
  const fileWidth = useWorkbenchUiStore((state) => state.filePanelWidth);
  const setSettingsWidth = useWorkbenchUiStore((state) => state.setSettingsNavigationWidth);
  const setProjectWidth = useWorkbenchUiStore((state) => state.setProjectNavigatorWidth);
  const setFileWidth = useWorkbenchUiStore((state) => state.setFilePanelWidth);

  return (
    <SettingsSectionHeader eyebrow="应用界面" title="外观">
      <section className="settings-general-category" aria-labelledby="theme-heading">
        <SettingsCategoryHeading id="theme-heading" icon={Palette}>主题</SettingsCategoryHeading>
        <SettingsConfigurationCard>
        <div className="flex flex-wrap gap-[5px]" role="group" aria-label="主题">
          <ThemeButton mode="light" selected={themeMode} onSelect={setThemeMode} label="浅色" />
          <ThemeButton mode="dark" selected={themeMode} onSelect={setThemeMode} label="深色" />
        </div>
        </SettingsConfigurationCard>
      </section>

      <section className="settings-general-category" aria-labelledby="appearance-font-heading">
        <SettingsCategoryHeading id="appearance-font-heading" icon={Type}>字体与阅读</SettingsCategoryHeading>
        <SettingsConfigurationCard className="p-0">
          {([
            { field: "uiFontSize", value: uiFontSize, min: 12, max: 18, label: "界面字号", description: "菜单、设置、列表和按钮的文字大小，标题随比例调整。" },
            { field: "chatFontSize", value: chatFontSize, min: 12, max: 24, label: "对话字号", description: "用户消息与 AI 回复的正文大小。" },
            { field: "codeFontSize", value: codeFontSize, min: 10, max: 24, label: "代码编辑器字号", description: "源文件与配置文件代码编辑器的文字大小；终端排版在终端页设置。" },
          ] as const).map(({ field, value, min, max, label, description }) => (
            <article key={field} className="settings-general-row">
              <div><h4>{label}</h4><p>{description}</p></div>
              <Select value={String(value)} onValueChange={(size) => setFontSize(field, Number(size))}>
                <SelectTrigger aria-label={label} className="settings-general-select"><SelectValue /></SelectTrigger>
                <SelectContent align="end">
                  {Array.from({ length: max - min + 1 }, (_, index) => min + index).map((size) => (
                    <SelectItem key={size} value={String(size)}>{size} px{size === DEFAULT_APPLICATION_SETTINGS.appearance[field] ? "（默认）" : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </article>
          ))}
          <div className="border-t border-[var(--app-border)] p-4" aria-label="字体预览">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <span className="flex items-center gap-2 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]"><Eye aria-hidden="true" size={15} />实时预览</span>
              <button className="settings-secondary-button" type="button" onClick={() => {
                for (const field of ["uiFontSize", "chatFontSize", "codeFontSize"] as const) setFontSize(field, DEFAULT_APPLICATION_SETTINGS.appearance[field]);
              }}><RefreshCw aria-hidden="true" size={14} />恢复默认字号</button>
            </div>
            <p className="mb-2 text-[length:var(--app-font-size-body)]">设置与工作区 · Aster 123</p>
            <p className="mb-2" style={{ fontSize: `${chatFontSize}px` }}>你好，今天我们一起完成这个项目。</p>
            <pre className="overflow-x-auto font-mono" style={{ fontSize: `${codeFontSize}px` }}>const message = "Hello, Aster";</pre>
          </div>
        </SettingsConfigurationCard>
      </section>

      <section className="settings-general-category" aria-labelledby="appearance-panels-heading">
        <SettingsCategoryHeading id="appearance-panels-heading" icon={PanelRight}>面板尺寸</SettingsCategoryHeading>
        <SettingsConfigurationCard className="p-0">
          {[
            { label: "对话目录宽度", value: projectWidth, min: 220, max: 420, set: setProjectWidth },
            { label: "设置菜单宽度", value: settingsWidth, min: 200, max: 360, set: setSettingsWidth },
            { label: "右侧工作区宽度", value: fileWidth, min: 320, max: 960, set: setFileWidth },
          ].map(({ label, value, min, max, set }) => (
            <article key={label} className="settings-general-row">
              <div><h4>{label}</h4><p>也可以拖动面板边界调整，修改后自动记住。</p></div>
              <div className="flex shrink-0 items-center gap-2">
                <input aria-label={label} className="h-8 w-24 rounded-[var(--app-radius)] border border-[var(--app-border)] px-2 text-[length:var(--app-font-size-control)] outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]" min={min} max={max} type="number" step={1} value={value} onChange={(event) => {
                  const width = event.currentTarget.valueAsNumber;
                  if (Number.isFinite(width)) set(width);
                }} />
                <span className="text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]">px</span>
              </div>
            </article>
          ))}
        </SettingsConfigurationCard>
      </section>
    </SettingsSectionHeader>
  );
}

function ThemeButton({
  label,
  mode,
  onSelect,
  selected,
}: {
  label: string;
  mode: ThemeMode;
  onSelect: (mode: ThemeMode) => void;
  selected: ThemeMode;
}): ReactElement {
  return (
    <button
      aria-pressed={selected === mode}
      className="w-44 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-3 text-left text-[length:var(--app-font-size-body)] aria-pressed:border-[var(--app-selection-border)] aria-pressed:bg-[var(--app-selection)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]"
      type="button"
      onClick={() => onSelect(mode)}
    >
      <span aria-hidden="true" className={`mb-3 flex h-20 overflow-hidden rounded-[var(--app-radius-small)] border ${mode === "light" ? "border-[#dedede] bg-[#ffffff]" : "border-[#393b40] bg-[#202020]"}`}>
        <span className={`w-1/3 border-r ${mode === "light" ? "border-[#dedede] bg-[#f5f5f5]" : "border-[#393b40] bg-[#282828]"}`} />
        <span className="flex flex-1 flex-col gap-2 p-3">
          {[0, 1, 2].map((line) => <span key={line} className={`h-1.5 rounded-sm ${mode === "light" ? "bg-[#dedede]" : "bg-[#393b40]"}`} />)}
        </span>
      </span>
      {label}
    </button>
  );
}
