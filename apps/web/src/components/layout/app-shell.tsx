import type { CSSProperties, ReactElement, ReactNode } from "react";

import type { AgentClient } from "../../runtime/index.js";
import {
  FILE_PANEL_WIDTH_RANGE,
  PROJECT_NAVIGATOR_WIDTH_RANGE,
  useWorkbenchUiStore,
} from "../../stores/workbench-ui-store.js";
import { ActivityBar } from "./activity-bar.js";
import { AppTitlebar } from "./app-titlebar.js";
import { ResizableDivider } from "./resizable-divider.js";

const TITLEBAR_CONTEXT = {
  conversations: "从左侧项目打开会话，或新建一个",
  settings: "Agent、团队、模型、工具与工作区偏好",
  tasks: "持续接收、规划和跟踪任务",
  team: "查看团队进度、Agent 状态与协作动态",
} as const;

type AppShellProps = {
  agentClient: AgentClient;
  filePanel: ReactNode;
  mainContent: ReactNode;
  projectNavigator: ReactNode;
};

export function AppShell({
  agentClient,
  filePanel,
  mainContent,
  projectNavigator,
}: AppShellProps): ReactElement {
  const isFilePanelOpen = useWorkbenchUiStore(
    (state) => state.isFilePanelOpen,
  );
  const activeActivity = useWorkbenchUiStore((state) => state.activeActivity);
  const isProjectNavigatorOpen = useWorkbenchUiStore(
    (state) => state.isProjectNavigatorOpen,
  );
  const filePanelWidth = useWorkbenchUiStore((state) => state.filePanelWidth);
  const projectNavigatorWidth = useWorkbenchUiStore(
    (state) => state.projectNavigatorWidth,
  );
  const setFilePanelOpen = useWorkbenchUiStore((state) => state.setFilePanelOpen);
  const setFilePanelWidth = useWorkbenchUiStore((state) => state.setFilePanelWidth);
  const setProjectNavigatorOpen = useWorkbenchUiStore(
    (state) => state.setProjectNavigatorOpen,
  );
  const setProjectNavigatorWidth = useWorkbenchUiStore(
    (state) => state.setProjectNavigatorWidth,
  );
  const themeMode = useWorkbenchUiStore((state) => state.themeMode);
  const toggleFilePanel = useWorkbenchUiStore(
    (state) => state.toggleFilePanel,
  );
  const toggleProjectNavigator = useWorkbenchUiStore(
    (state) => state.toggleProjectNavigator,
  );
  const configurationWorkspaceTarget = useWorkbenchUiStore(
    (state) => state.configurationWorkspaceTarget,
  );
  const isConversationWorkspace = activeActivity === "conversations";
  const canShowFileWorkspace = isConversationWorkspace || (
    activeActivity === "settings" && configurationWorkspaceTarget !== null
  );
  const filePanelStyle = { width: `${filePanelWidth}px` } as CSSProperties;
  const projectNavigatorStyle = {
    width: `${projectNavigatorWidth}px`,
  } as CSSProperties;

  return (
    <div className="app-shell" data-theme={themeMode}>
      <AppTitlebar
        agentClient={agentClient}
        contextText={TITLEBAR_CONTEXT[activeActivity]}
        isFilePanelOpen={isFilePanelOpen}
        isProjectNavigatorOpen={isProjectNavigatorOpen}
        onToggleFilePanel={toggleFilePanel}
        onToggleProjectNavigator={toggleProjectNavigator}
        showFilePanelControl={canShowFileWorkspace}
        showProjectNavigatorControl={isConversationWorkspace}
      />
      <div
        className="workbench-grid"
        data-active-activity={activeActivity}
        data-full-page={String(!isConversationWorkspace)}
      >
        <ActivityBar />
        {isConversationWorkspace && isProjectNavigatorOpen ? (
          <div
            className="workbench-sidebar workbench-sidebar--left"
            style={projectNavigatorStyle}
          >
            {projectNavigator}
          </div>
        ) : null}
        {isConversationWorkspace ? <ResizableDivider
          ariaLabel={
            isProjectNavigatorOpen ? "调整项目栏宽度" : "拖动展开项目栏"
          }
          className="workbench-resizable-divider--left"
          collapsed={!isProjectNavigatorOpen}
          direction="from-start"
          max={PROJECT_NAVIGATOR_WIDTH_RANGE.max}
          min={PROJECT_NAVIGATOR_WIDTH_RANGE.min}
          size={projectNavigatorWidth}
          onCollapsedChange={(isCollapsed) =>
            setProjectNavigatorOpen(!isCollapsed)
          }
          onResize={setProjectNavigatorWidth}
        /> : null}
        <main className="workbench-main" aria-label="主要工作区">
          {mainContent}
        </main>
        {canShowFileWorkspace ? <ResizableDivider
          ariaLabel={isFilePanelOpen ? "调整右侧工作区宽度" : "拖动展开右侧工作区"}
          className={
            isFilePanelOpen
              ? "workbench-resizable-divider--right"
              : "workbench-resizable-divider--right workbench-resizable-divider--right-collapsed"
          }
          collapsed={!isFilePanelOpen}
          direction="from-end"
          max={FILE_PANEL_WIDTH_RANGE.max}
          min={FILE_PANEL_WIDTH_RANGE.min}
          size={filePanelWidth}
          onCollapsedChange={(isCollapsed) => setFilePanelOpen(!isCollapsed)}
          onResize={setFilePanelWidth}
        /> : null}
        {canShowFileWorkspace && isFilePanelOpen ? (
          <div
            className="workbench-sidebar workbench-sidebar--right"
            style={filePanelStyle}
          >
            {filePanel}
          </div>
        ) : null}
      </div>
    </div>
  );
}
