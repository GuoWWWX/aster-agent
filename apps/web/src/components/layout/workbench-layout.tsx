import type { CSSProperties, ReactElement, ReactNode } from "react";

import type { ActivityView, ThemeMode } from "../../stores/workbench-ui-store.js";

type WorkbenchLayoutProps = {
  activeActivity: ActivityView;
  children: ReactNode;
  hasProjectAccent: boolean;
  isConversationWorkspace: boolean;
  projectAccentStyle: CSSProperties | undefined;
  themeMode: ThemeMode;
  titlebar: ReactNode;
};

/** Shared outer frame for every workbench page; interactions stay in AppShell. */
export function WorkbenchLayout({
  activeActivity,
  children,
  hasProjectAccent,
  isConversationWorkspace,
  projectAccentStyle,
  themeMode,
  titlebar,
}: WorkbenchLayoutProps): ReactElement {
  return (
    <div className="app-shell" data-theme={themeMode} data-project-accent={hasProjectAccent || undefined} style={projectAccentStyle}>
      {titlebar}
      <div
        className="workbench-grid relative"
        data-active-activity={activeActivity}
        data-full-page={String(!isConversationWorkspace)}
      >
        {children}
      </div>
    </div>
  );
}
