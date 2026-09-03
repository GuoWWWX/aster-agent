import {
  ListTodo,
  MessageSquareText,
  Moon,
  Settings,
  Sun,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import type { ReactElement } from "react";

import { useWorkbenchUiStore, type ActivityView } from "../../stores/workbench-ui-store.js";
import { IconButton } from "../ui/icon-button.js";

type ActivityItem = {
  icon: LucideIcon;
  id: ActivityView;
  label: string;
};

const ACTIVITY_ITEMS: readonly ActivityItem[] = [
  { id: "conversations", label: "对话", icon: MessageSquareText },
  { id: "team", label: "团队", icon: UsersRound },
  { id: "tasks", label: "任务", icon: ListTodo },
];

export function ActivityBar(): ReactElement {
  const activeActivity = useWorkbenchUiStore((state) => state.activeActivity);
  const setActiveActivity = useWorkbenchUiStore(
    (state) => state.setActiveActivity,
  );
  const themeMode = useWorkbenchUiStore((state) => state.themeMode);
  const toggleThemeMode = useWorkbenchUiStore(
    (state) => state.toggleThemeMode,
  );
  const setSettings = useWorkbenchUiStore((state) => state.setSettings);
  const ThemeIcon = themeMode === "dark" ? Sun : Moon;
  const themeLabel = themeMode === "dark" ? "切换为浅色主题" : "切换为深色主题";

  return (
    <aside
      className="activity-bar"
      aria-label="主导航"
      data-app-drag-region="true"
      data-slot="activity-bar"
    >
      <nav className="activity-bar__navigation" aria-label="工作区视图">
        {ACTIVITY_ITEMS.map((item) => {
          const ItemIcon = item.icon;
          const isActive = activeActivity === item.id;

          return (
            <IconButton
              key={item.id}
              aria-pressed={isActive}
              label={item.label}
              size="activity"
              variant={isActive ? "selected" : "quiet"}
              onClick={() => setActiveActivity(item.id)}
            >
              <ItemIcon aria-hidden="true" size={18} strokeWidth={1.8} />
            </IconButton>
          );
        })}
      </nav>

      <div
        aria-hidden="true"
        className="activity-bar__spacer"
        data-app-drag-region="true"
      />

      <div className="activity-bar__footer">
        <IconButton
          label={themeLabel}
          size="compact"
          variant="quiet"
          onClick={toggleThemeMode}
        >
          <ThemeIcon aria-hidden="true" size={16} strokeWidth={1.8} />
        </IconButton>
        <IconButton
          aria-pressed={activeActivity === "settings"}
          label="设置"
          size="activity"
          variant={activeActivity === "settings" ? "selected" : "quiet"}
          onClick={setSettings}
        >
          <Settings aria-hidden="true" size={18} strokeWidth={1.8} />
        </IconButton>
      </div>
    </aside>
  );
}
