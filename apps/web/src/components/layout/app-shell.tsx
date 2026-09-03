import { useEffect, useState, type CSSProperties, type ReactElement, type ReactNode } from "react";

import type { AgentClient } from "../../runtime/index.js";
import {
  FILE_PANEL_WIDTH_RANGE,
  PROJECT_NAVIGATOR_WIDTH_RANGE,
  resolveActiveSettingsWorkspaceTarget,
  useWorkbenchUiStore,
} from "../../stores/workbench-ui-store.js";
import { ActivityBar } from "./activity-bar.js";
import { AppTitlebar } from "./app-titlebar.js";
import type { AppTitlebarConversationTab } from "./app-titlebar.js";
import { ResizableDivider } from "./resizable-divider.js";

const TITLEBAR_CONTEXT = {
  conversations: "从左侧项目打开会话，或新建一个",
  settings: "Agent、团队、模型、工具与工作区偏好",
  tasks: "持续接收、规划和跟踪任务",
  team: "查看团队进度、Agent 状态与协作动态",
} as const;

const TITLEBAR_LEFT_CONTROL_WIDTH = 32;
const WORKBENCH_MAIN_LEFT_INSET = 58;
const WORKBENCH_NAVIGATOR_TO_MAIN_GAP = 5;

type AppShellProps = {
  activeConversationId?: string | null;
  agentClient: AgentClient;
  conversationTabs?: readonly AppTitlebarConversationTab[];
  filePanel: ReactNode;
  mainContent: ReactNode;
  projectNavigator: ReactNode;
  onCloseAllConversationTabs?: () => void;
  onCloseConversationTab?: (conversationId: string) => void;
  onCloseOtherConversationTabs?: (conversationId: string) => void;
  onSelectConversationTab?: (conversationId: string) => void;
};

export function AppShell({
  activeConversationId = null,
  agentClient,
  conversationTabs = [],
  filePanel,
  mainContent,
  projectNavigator,
  onCloseAllConversationTabs,
  onCloseConversationTab,
  onCloseOtherConversationTabs,
  onSelectConversationTab,
}: AppShellProps): ReactElement {
  const [isFilePanelResizing, setFilePanelResizing] = useState(false);
  const isFilePanelOpen = useWorkbenchUiStore(
    (state) => state.isFilePanelOpen,
  );
  const isSettingsFilePanelOpen = useWorkbenchUiStore(
    (state) => state.isSettingsFilePanelOpen,
  );
  const activeActivity = useWorkbenchUiStore((state) => state.activeActivity);
  const isProjectNavigatorOpen = useWorkbenchUiStore(
    (state) => state.isProjectNavigatorOpen,
  );
  const filePanelWidth = useWorkbenchUiStore((state) => state.filePanelWidth);
  const conversationFilePanelWidth = useWorkbenchUiStore((state) =>
    activeConversationId === null
      ? undefined
      : state.filePanelWidthsByConversationId[activeConversationId],
  );
  const projectNavigatorWidth = useWorkbenchUiStore(
    (state) => state.projectNavigatorWidth,
  );
  const setFilePanelOpen = useWorkbenchUiStore((state) => state.setFilePanelOpen);
  const setSettingsFilePanelOpen = useWorkbenchUiStore(
    (state) => state.setSettingsFilePanelOpen,
  );
  const setFilePanelWidth = useWorkbenchUiStore((state) => state.setFilePanelWidth);
  const setFilePanelWidthForConversation = useWorkbenchUiStore(
    (state) => state.setFilePanelWidthForConversation,
  );
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
  const toggleSettingsFilePanel = useWorkbenchUiStore(
    (state) => state.toggleSettingsFilePanel,
  );
  const toggleProjectNavigator = useWorkbenchUiStore(
    (state) => state.toggleProjectNavigator,
  );
  const configurationWorkspaceTarget = useWorkbenchUiStore(
    (state) => state.configurationWorkspaceTarget,
  );
  const agentPromptWorkspaceTarget = useWorkbenchUiStore(
    (state) => state.agentPromptWorkspaceTarget,
  );
  const settingsSection = useWorkbenchUiStore((state) => state.settingsSection);

  useEffect(() => {
    document.documentElement.dataset.theme = themeMode;
    return () => {
      document.documentElement.removeAttribute("data-theme");
    };
  }, [themeMode]);

  const isConversationWorkspace = activeActivity === "conversations";
  const activeSettingsWorkspaceTarget = resolveActiveSettingsWorkspaceTarget(
    activeActivity,
    settingsSection,
    agentPromptWorkspaceTarget,
    configurationWorkspaceTarget,
  );
  const isSettingsWorkspace = activeSettingsWorkspaceTarget !== null;
  const canShowFileWorkspace = isConversationWorkspace
    || activeActivity === "team"
    || isSettingsWorkspace;
  const activeFilePanelOpen = activeActivity === "settings"
    ? isSettingsFilePanelOpen
    : isFilePanelOpen;
  const setActiveFilePanelOpen = activeActivity === "settings"
    ? setSettingsFilePanelOpen
    : setFilePanelOpen;
  const toggleActiveFilePanel = activeActivity === "settings"
    ? toggleSettingsFilePanel
    : toggleFilePanel;
  const activeFilePanelWidth = isConversationWorkspace && activeConversationId !== null
    ? conversationFilePanelWidth ?? filePanelWidth
    : filePanelWidth;
  const filePanelStyle = { width: `${activeFilePanelWidth}px` } as CSSProperties;
  const projectNavigatorStyle = {
    width: `${projectNavigatorWidth}px`,
  } as CSSProperties;
  const conversationTabsLeadingWidth = WORKBENCH_MAIN_LEFT_INSET
    + (isProjectNavigatorOpen
      ? projectNavigatorWidth + WORKBENCH_NAVIGATOR_TO_MAIN_GAP
      : 0)
    - TITLEBAR_LEFT_CONTROL_WIDTH;

  return (
    <div className="app-shell" data-theme={themeMode}>
      <AppTitlebar
        activeConversationId={activeConversationId}
        agentClient={agentClient}
        conversationTabs={isConversationWorkspace ? conversationTabs : []}
        conversationTabsLeadingWidth={conversationTabsLeadingWidth}
        contextText={TITLEBAR_CONTEXT[activeActivity]}
        isFilePanelOpen={activeFilePanelOpen}
        isProjectNavigatorOpen={isProjectNavigatorOpen}
        onToggleFilePanel={toggleActiveFilePanel}
        onToggleProjectNavigator={toggleProjectNavigator}
        {...(onCloseAllConversationTabs === undefined ? {} : {
          onCloseAllConversationTabs,
        })}
        {...(onCloseConversationTab === undefined ? {} : {
          onCloseConversationTab,
        })}
        {...(onCloseOtherConversationTabs === undefined ? {} : {
          onCloseOtherConversationTabs,
        })}
        {...(onSelectConversationTab === undefined ? {} : {
          onSelectConversationTab,
        })}
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
        {canShowFileWorkspace && (activeFilePanelOpen || isFilePanelResizing) ? <ResizableDivider
          ariaLabel="调整右侧工作区宽度"
          className="workbench-resizable-divider--right"
          direction="from-end"
          liveResizeId="right-workspace"
          max={FILE_PANEL_WIDTH_RANGE.max}
          min={FILE_PANEL_WIDTH_RANGE.min}
          size={activeFilePanelWidth}
          onCollapsedChange={(isCollapsed) => setActiveFilePanelOpen(!isCollapsed)}
          onDraggingChange={setFilePanelResizing}
          onResize={(width) => {
            if (isConversationWorkspace && activeConversationId !== null) {
              setFilePanelWidthForConversation(activeConversationId, width);
              return;
            }
            setFilePanelWidth(width);
          }}
        /> : null}
        <div
          className="workbench-sidebar workbench-sidebar--right"
          hidden={!canShowFileWorkspace || !activeFilePanelOpen}
          style={filePanelStyle}
        >
          {filePanel}
        </div>
      </div>
    </div>
  );
}
