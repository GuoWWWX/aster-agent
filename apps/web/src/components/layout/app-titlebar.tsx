import {
  ArrowLeft,
  ArrowRight,
  Undo2,
  Redo2,
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
  Pin,
} from "lucide-react";
import { createPortal } from "react-dom";
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
  type ReactNode,
} from "react";

import type { WindowState } from "@agent/protocol";

import type { AgentClient } from "../../runtime/index.js";
import { IconButton } from "../ui/icon-button.js";
import { useUndoStore } from "../../stores/undo-store.js";
import { useTabReorder } from "../ui/use-tab-reorder.js";

type AppTitlebarProps = {
  activity?: ReactNode;
  onKeepConversationTab?: (id: string) => void;
  navigation?: { canGoBack: boolean; canGoForward: boolean; goBack: () => void; goForward: () => void };
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
  onMoveConversationTab?: (source: string, target: string, side: "before" | "after") => void;
  canToggleFilePanel?: boolean;
  showProjectNavigatorControl?: boolean;
};

export type AppTitlebarConversationTab = {
  kind?: "conversation" | "page";
  isPreview?: boolean;
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
  activity,
  onKeepConversationTab,
  navigation,
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
  onMoveConversationTab,
  canToggleFilePanel = true,
  showProjectNavigatorControl = true,
}: AppTitlebarProps): ReactElement {
  const tabsRef = useRef<HTMLDivElement>(null);
  const tabIds = conversationTabs.map((tab) => tab.id).join(",");
  useLayoutEffect(() => {
    const list = tabsRef.current;
    if (list === null) return;
    const revealActive = (): void => {
      const selected = list.querySelector<HTMLElement>('[data-active="true"]');
      if (selected === null) return;
      const bounds = list.getBoundingClientRect();
      const tab = selected.getBoundingClientRect();
      if (tab.left < bounds.left) list.scrollLeft += tab.left - bounds.left;
      else if (tab.right > bounds.right) list.scrollLeft += tab.right - bounds.right;
    };
    revealActive();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(revealActive);
    observer.observe(list);
    return () => observer.disconnect();
  }, [activeConversationId, tabIds]);
  const undoState = useUndoStore();
  const undo = (): void => { if (undoState.editor !== null) undoState.editor.undo(); else void undoState.undo(); };
  const redo = (): void => { if (undoState.editor !== null) undoState.editor.redo(); else void undoState.redo(); };
  useEffect(() => {
    const onFocus = (event: FocusEvent): void => {
      if (event.target !== useUndoStore.getState().editor?.element) useUndoStore.getState().setEditor(null);
    };
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented || event.isComposing) return;
      if (event.altKey && !event.ctrlKey && !event.metaKey && (event.key === "ArrowLeft" || event.key === "ArrowRight")) {
        event.preventDefault();
        if (event.key === "ArrowLeft") navigation?.goBack(); else navigation?.goForward();
        return;
      }
      const element = event.target instanceof Element ? event.target : null;
      if (element?.closest('input, textarea, [contenteditable="true"], .xterm')) return;
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      if (event.key.toLowerCase() === "z" || event.key.toLowerCase() === "y") {
        event.preventDefault();
        const state = useUndoStore.getState();
        if (event.shiftKey || event.key.toLowerCase() === "y") void state.redo(); else void state.undo();
      }
    };
    document.addEventListener("focusin", onFocus);
    window.addEventListener("keydown", onKeyDown);
    return () => { document.removeEventListener("focusin", onFocus); window.removeEventListener("keydown", onKeyDown); };
  }, [navigation]);
  const reorderTabProps = useTabReorder((source, target, side) => onMoveConversationTab?.(source, target, side));
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
      {...reorderTabProps.listProps}
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

      <div className="flex shrink-0 items-center" data-app-drag-region="false"
        onDoubleClick={(event) => event.stopPropagation()}>
        <IconButton label="返回" tooltip="返回上一个页面" size="titlebar" variant="titlebar"
          disabled={!navigation?.canGoBack} onClick={navigation?.goBack}>
          <ArrowLeft aria-hidden="true" size={16} />
        </IconButton>
        <IconButton label="前进" tooltip="前进到下一个页面" size="titlebar" variant="titlebar"
          disabled={!navigation?.canGoForward} onClick={navigation?.goForward}>
          <ArrowRight aria-hidden="true" size={16} />
        </IconButton>
        <span aria-hidden="true" className="mx-1 h-3 border-l border-[var(--app-border)]" />
        <IconButton label="撤销" tooltip={undoState.editor !== null ? "撤销输入（Ctrl+Z）" : `撤销${undoState.past.at(-1)?.label ?? ""}（Ctrl+Z）`}
          size="titlebar" variant="titlebar" disabled={undoState.busy || !(undoState.editor?.canUndo ?? undoState.past.length > 0)}
          onMouseDown={(event) => event.preventDefault()} onClick={undo}>
          <Undo2 aria-hidden="true" size={16} />
        </IconButton>
        <IconButton label="重做" tooltip={undoState.editor !== null ? "重做输入（Ctrl+Shift+Z）" : `重做${undoState.future.at(-1)?.label ?? ""}（Ctrl+Shift+Z）`}
          size="titlebar" variant="titlebar" disabled={undoState.busy || !(undoState.editor?.canRedo ?? undoState.future.length > 0)}
          onMouseDown={(event) => event.preventDefault()} onClick={redo}>
          <Redo2 aria-hidden="true" size={16} />
        </IconButton>
      </div>

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
              "--app-titlebar-conversation-leading-width": `${Math.max(0, conversationTabsLeadingWidth - 137)}px`,
            } as CSSProperties}
          />
          <div
            className="app-titlebar__conversation-surface"
            {...reorderTabProps.listProps}
            data-app-drag-region="true"
          >
            <div
              aria-label="已打开的页面"
              className="app-titlebar__conversation-tabs"
              ref={tabsRef}
              {...reorderTabProps.listProps}
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
                    className="app-titlebar__conversation-tab reorderable-tab"
                    {...reorderTabProps.tabProps(tab.id)}
                    data-active={String(isActive)}
                    key={tab.id}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      setConversationTabContextMenu({
                        conversationId: tab.id,
                        x: Math.max(8, Math.min(event.clientX, window.innerWidth - 176)),
                        y: Math.max(8, Math.min(event.clientY, window.innerHeight - 168)),
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
                      onDoubleClick={(event) => { event.stopPropagation(); if (tab.kind !== "page") onKeepConversationTab?.(tab.id); }}
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
                      <span className={`app-titlebar__conversation-tab-title${tab.isPreview ? " italic" : ""}`}>{tab.title}</span>
                    </button>
                    <button
                      aria-label={`关闭${tab.kind === "page" ? "页面" : "对话"}标签：${tab.title}`}
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

      <div data-app-drag-region="false" className="flex shrink-0 items-center" onDoubleClick={(event) => event.stopPropagation()}>{activity}</div>
      <div
        className="app-titlebar__panel-controls"
        onDoubleClick={(event) => event.stopPropagation()}
      >
        <IconButton
          aria-pressed={isFilePanelOpen}
          disabled={!canToggleFilePanel}
          label={isFilePanelOpen ? "收起右侧工作区" : "展开右侧工作区"}
          tooltip={!canToggleFilePanel ? "当前页面暂无可展开的右侧内容" : isFilePanelOpen ? "收起右侧工作区" : "展开右侧工作区"}
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
      </div>

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
      {undoState.error === null ? null : <div role="alert" className="absolute left-12 top-10 z-50 flex max-w-sm items-center gap-1 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-2 text-[length:var(--app-font-size-body)] text-[var(--app-destructive)]">
        {undoState.error}<IconButton label="关闭撤销错误" onClick={undoState.clearError}><X size={14} /></IconButton>
      </div>}

      {conversationTabContextMenu !== null ? createPortal(
        <>
          <div
            aria-hidden="true"
            className="app-titlebar__conversation-context-menu-backdrop"
            onMouseDown={() => setConversationTabContextMenu(null)}
          />
          <div
            aria-label="标签操作"
            className="app-titlebar__conversation-context-menu"
            role="menu"
            style={{
              left: conversationTabContextMenu.x,
              top: conversationTabContextMenu.y,
            }}
          >
            {conversationTabs.find((tab) => tab.id === conversationTabContextMenu.conversationId)?.isPreview ? (
              <button role="menuitem" type="button" onClick={() => {
                onKeepConversationTab?.(conversationTabContextMenu.conversationId);
                setConversationTabContextMenu(null);
              }}><Pin aria-hidden="true" size={16} />保留标签</button>
            ) : null}
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
