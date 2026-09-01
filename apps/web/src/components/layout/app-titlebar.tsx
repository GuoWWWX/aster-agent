import {
  Copy,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Square,
  X,
} from "lucide-react";
import {
  useEffect,
  useState,
  type ReactElement,
} from "react";

import type { WindowState } from "@agent/protocol";

import type { AgentClient } from "../../runtime/index.js";
import { IconButton } from "../ui/icon-button.js";

type AppTitlebarProps = {
  agentClient: AgentClient;
  contextText: string;
  isFilePanelOpen: boolean;
  isProjectNavigatorOpen: boolean;
  onToggleFilePanel: () => void;
  onToggleProjectNavigator: () => void;
  showFilePanelControl?: boolean;
  showProjectNavigatorControl?: boolean;
};

type HostWindowState = {
  canControlWindow: boolean;
  isMaximized: boolean;
};

const INITIAL_HOST_WINDOW_STATE: HostWindowState = {
  canControlWindow: false,
  isMaximized: false,
};

export function AppTitlebar({
  agentClient,
  contextText,
  isFilePanelOpen,
  isProjectNavigatorOpen,
  onToggleFilePanel,
  onToggleProjectNavigator,
  showFilePanelControl = true,
  showProjectNavigatorControl = true,
}: AppTitlebarProps): ReactElement {
  const [hostWindowState, setHostWindowState] = useState<HostWindowState>(
    INITIAL_HOST_WINDOW_STATE,
  );
  const [windowActionError, setWindowActionError] = useState<string | null>(
    null,
  );

  useEffect(() => {
    let disposed = false;

    const applyWindowState = (windowState: WindowState): void => {
      if (!disposed) {
        setHostWindowState((current) => ({
          ...current,
          isMaximized: windowState.isMaximized,
        }));
      }
    };

    const unsubscribe = agentClient.onWindowStateChanged(applyWindowState);

    void Promise.all([
      agentClient.getRuntimeInfo(),
      agentClient.getWindowState(),
    ])
      .then(([runtimeInfo, windowState]) => {
        if (!disposed) {
          setHostWindowState({
            canControlWindow: runtimeInfo.capabilities.mode === "desktop",
            isMaximized: windowState.isMaximized,
          });
        }
      })
      .catch(() => {
        if (!disposed) {
          setHostWindowState(INITIAL_HOST_WINDOW_STATE);
        }
      });

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [agentClient]);

  function runWindowAction(action: () => Promise<void>): void {
    void action()
      .then(() => {
        setWindowActionError(null);
      })
      .catch(() => {
        setWindowActionError("窗口操作未完成");
      });
  }

  const { canControlWindow, isMaximized } = hostWindowState;
  const maximizeLabel = isMaximized ? "还原窗口" : "最大化窗口";

  return (
    <header
      className="app-titlebar"
      data-slot="app-titlebar"
      onDoubleClick={() => {
        if (canControlWindow) {
          runWindowAction(() => agentClient.toggleMaximizeWindow());
        }
      }}
    >
      {showProjectNavigatorControl ? (
        <IconButton
          aria-pressed={isProjectNavigatorOpen}
          label={isProjectNavigatorOpen ? "收起对话列表" : "展开对话列表"}
          size="titlebar"
          variant="titlebar"
          onClick={onToggleProjectNavigator}
          onDoubleClick={(event) => event.stopPropagation()}
        >
          {isProjectNavigatorOpen ? (
            <PanelLeftClose aria-hidden="true" size={16} />
          ) : (
            <PanelLeftOpen aria-hidden="true" size={16} />
          )}
        </IconButton>
      ) : (
        <div className="app-titlebar__brand" data-app-drag-region="true" />
      )}

      <div className="app-titlebar__context" data-app-drag-region="true">
        {contextText}
      </div>

      {showFilePanelControl ? <div
        className="app-titlebar__panel-controls"
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <IconButton
          aria-pressed={isFilePanelOpen}
          label={isFilePanelOpen ? "收起右侧工作区" : "展开右侧工作区"}
          size="titlebar"
          variant="titlebar"
          onClick={onToggleFilePanel}
        >
          {isFilePanelOpen ? (
            <PanelRightClose aria-hidden="true" size={16} />
          ) : (
            <PanelRightOpen aria-hidden="true" size={16} />
          )}
        </IconButton>
      </div> : null}

      <div
        className="app-titlebar__window-controls"
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <IconButton
          disabled={!canControlWindow}
          label={canControlWindow ? "最小化窗口" : "最小化窗口（仅桌面端可用）"}
          size="titlebar"
          variant="titlebar"
          onClick={() => runWindowAction(() => agentClient.minimizeWindow())}
        >
          <Minus aria-hidden="true" size={15} />
        </IconButton>
        <IconButton
          disabled={!canControlWindow}
          label={
            canControlWindow ? maximizeLabel : `${maximizeLabel}（仅桌面端可用）`
          }
          size="titlebar"
          variant="titlebar"
          onClick={() =>
            runWindowAction(() => agentClient.toggleMaximizeWindow())
          }
        >
          {isMaximized ? (
            <Copy aria-hidden="true" size={13} />
          ) : (
            <Square aria-hidden="true" size={13} />
          )}
        </IconButton>
        <IconButton
          disabled={!canControlWindow}
          label={canControlWindow ? "关闭窗口" : "关闭窗口（仅桌面端可用）"}
          size="titlebar"
          variant="destructive"
          onClick={() => runWindowAction(() => agentClient.closeWindow())}
        >
          <X aria-hidden="true" size={16} />
        </IconButton>
      </div>

      <span className="sr-only" role="status">
        {windowActionError}
      </span>
    </header>
  );
}
