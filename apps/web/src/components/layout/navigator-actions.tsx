import { Moon, PanelsTopLeft, Settings, Sun } from "lucide-react";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { IconButton } from "../ui/icon-button.js";

export function NavigatorPages() {
  const active = useWorkbenchUiStore((state) => state.activeActivity);
  return <nav aria-label="功能页面" className="shrink-0 border-b border-[var(--app-border)] px-2 py-1">
    <button type="button" aria-pressed={active === "team"} onClick={() => useWorkbenchUiStore.getState().setActiveActivity("team")}
      className={`flex h-8 w-full items-center gap-2 rounded-[var(--app-radius)] px-2 text-[length:var(--app-font-size-body)] hover:bg-[var(--app-hover)] ${active === "team" ? "bg-[var(--app-selection)] text-[var(--app-selection-foreground)]" : "text-[var(--app-foreground)]"}`}>
      <PanelsTopLeft size={16} aria-hidden="true" />任务看板
    </button>
  </nav>;
}

export function NavigatorFooter() {
  const theme = useWorkbenchUiStore((state) => state.themeMode);
  const active = useWorkbenchUiStore((state) => state.activeActivity);
  return <footer className="flex shrink-0 items-center justify-between border-t border-[var(--app-border)] px-2 py-1">
    <button type="button" aria-pressed={active === "settings"} onClick={() => useWorkbenchUiStore.getState().setSettings()}
      className="flex h-8 items-center gap-2 rounded-[var(--app-radius)] px-2 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)]">
      <Settings size={16} aria-hidden="true" />设置
    </button>
    <IconButton label={theme === "dark" ? "切换为浅色主题" : "切换为深色主题"} onClick={() => useWorkbenchUiStore.getState().toggleThemeMode()}>
      {theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
    </IconButton>
  </footer>;
}
