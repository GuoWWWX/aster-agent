import {
  Copy,
  LoaderCircle,
  MessageSquareText,
  Minus,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Square,
  X,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useState,
  type CSSProperties,
  type ReactElement,
} from "react";

import type { WindowState } from "@agent/protocol";

import type { AgentClient } from "../../runtime/index.js";
import { IconButton } from "../ui/icon-button.js";

type AppTitlebarProps = {
  activeConversationId?: string | null;
  agentClient: AgentClient;
  conversationTabs?: readonly AppTitlebarConversationTab[];
  conversationTabsLeadingWidth: number;
  contextText: string;
  isFilePanelOpen: boolean;
  isProjectNavigatorOpen: boolean;
  onToggleFilePanel: () => void;
  onToggleProjectNavigator: () => void;
  onCloseAllConversationTabs?: () => void;
  onCloseConversationTab?: (conversationId: string) => void;
  onCloseOtherConversationTabs?: (conversationId: string) => void;
  onSelectConversationTab?: (conversationId: string) => void;
  showFilePanelControl?: boolean;
  showProjectNavigatorControl?: boolean;
};

export type AppTitlebarConversationTab = {
  icon?: ReactElement;
  id: string;
  isRunning: boolean;
  title: string;
};

type HostWindowState = {
  canControlWindow: boolean;
  isMaximized: boolean;
};

type ConversationTabContextMenuState = {
  conversationId: string;
  x: number;
  y: number;
};

const INITIAL_HOST_WINDOW_STATE: HostWindowState = {
  canControlWindow: false,
  isMaximized: false,
};

const CONVERSATION_TAB_WIDTH = 220;

export function AppTitlebar({
  activeConversationId = null,
  agentClient,
  conversationTabs = [],
  conversationTabsLeadingWidth,
  contextText,
  isFilePanelOpen,
  isProjectNavigatorOpen,
  onToggleFilePanel,
  onToggleProjectNavigator,
  onCloseAllConversationTabs,
  onCloseConversationTab,
  onCloseOtherConversationTabs,
  onSelectConversationTab,
  showFilePanelControl = true,
  showProjectNavigatorControl = true,
}: AppTitlebarProps): ReactElement {
  const [hostWindowState, setHostWindowState] = useState<HostWindowState>(
    INITIAL_HOST_WINDOW_STATE,
  );
  const [windowActionError, setWindowActionError] = useState<string | null>(
    null,
  );
  const [conversationTabContextMenu, setConversationTabContextMenu] =
    useState<ConversationTabContextMenuState | null>(null);

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

  useEffect(() => {
    if (conversationTabContextMenu === null) return;
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setConversationTabContextMenu(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [conversationTabContextMenu]);

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
      data-app-drag-region="true"
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

      {conversationTabs.length === 0 ? (
        <div className="app-titlebar__context" data-app-drag-region="true">
          {contextText}
        </div>
      ) : (
        <>
          <div
            aria-hidden="true"
            className="app-titlebar__conversation-leading"
            data-app-drag-region="true"
            style={{
              "--app-titlebar-conversation-leading-width": `${conversationTabsLeadingWidth}px`,
            } as CSSProperties}
          />
          <div
            className="app-titlebar__conversation-surface"
            data-app-drag-region="true"
          >
            <div
              aria-label="已打开的对话"
              className="app-titlebar__conversation-tabs"
              onDoubleClick={(event) => event.stopPropagation()}
              onWheel={(event) => {
                const tabs = event.currentTarget;
                if (tabs.scrollWidth <= tabs.clientWidth) return;
                const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY)
                  ? event.deltaX
                  : event.deltaY;
                if (delta === 0) return;
                event.preventDefault();
                const currentTabIndex = delta > 0
                  ? Math.floor(tabs.scrollLeft / CONVERSATION_TAB_WIDTH)
                  : Math.ceil(tabs.scrollLeft / CONVERSATION_TAB_WIDTH);
                const nextScrollLeft = Math.max(
                  0,
                  Math.min(
                    tabs.scrollWidth - tabs.clientWidth,
                    (currentTabIndex + Math.sign(delta)) * CONVERSATION_TAB_WIDTH,
                  ),
                );
                tabs.scrollLeft = nextScrollLeft;
              }}
              role="tablist"
            >
              {conversationTabs.map((tab) => {
                const isActive = tab.id === activeConversationId;
                return (
                  <div
                    className="app-titlebar__conversation-tab"
                    data-active={String(isActive)}
                    key={tab.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setConversationTabContextMenu({
                        conversationId: tab.id,
                        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 176)),
                        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 128)),
                      });
                    }}
                  >
                    <button
                      aria-selected={isActive}
                      className="app-titlebar__conversation-tab-select"
                      role="tab"
                      title={tab.title}
                      type="button"
                      onClick={() => onSelectConversationTab?.(tab.id)}
                    >
                      <span className="relative grid size-5 shrink-0 place-items-center overflow-visible">
                        {tab.icon ?? (tab.isRunning ? (
                          <LoaderCircle
                            aria-label={`${tab.title} 正在工作`}
                            className="animate-spin"
                            size={13}
                          />
                        ) : (
                          <MessageSquareText aria-hidden="true" size={13} />
                        ))}
                        {tab.icon !== undefined && tab.isRunning ? (
                          <LoaderCircle
                            aria-label={`${tab.title} 正在工作`}
                            className="absolute -right-0.5 -bottom-0.5 animate-spin rounded-full bg-[var(--app-titlebar)]"
                            size={9}
                          />
                        ) : null}
                      </span>
                      <span className="app-titlebar__conversation-tab-title">{tab.title}</span>
                    </button>
                    <button
                      aria-label={`关闭对话标签：${tab.title}`}
                      className="app-titlebar__conversation-tab-close"
                      title="关闭标签"
                      type="button"
                      onClick={() => onCloseConversationTab?.(tab.id)}
                    >
                      <X aria-hidden="true" size={12} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      )}

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

      {conversationTabContextMenu !== null ? createPortal(
        <>
          <div
            aria-hidden="true"
            className="app-titlebar__conversation-context-menu-backdrop"
            onMouseDown={() => setConversationTabContextMenu(null)}
          />
          <div
            aria-label="对话标签操作"
            className="app-titlebar__conversation-context-menu"
            role="menu"
            style={{
              left: conversationTabContextMenu.x,
              top: conversationTabContextMenu.y,
            }}
          >
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setConversationTabContextMenu(null);
                onCloseConversationTab?.(conversationTabContextMenu.conversationId);
              }}
            >
              <X aria-hidden="true" size={16} />
              关闭标签
            </button>
            <button
              disabled={conversationTabs.length <= 1}
              role="menuitem"
              type="button"
              onClick={() => {
                setConversationTabContextMenu(null);
                onCloseOtherConversationTabs?.(
                  conversationTabContextMenu.conversationId,
                );
              }}
            >
              <X aria-hidden="true" size={16} />
              关闭其他标签
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => {
                setConversationTabContextMenu(null);
                onCloseAllConversationTabs?.();
              }}
            >
              <X aria-hidden="true" size={16} />
              关闭全部标签
            </button>
          </div>
        </>,
        document.body,
      ) : null}
    </header>
  );
}
