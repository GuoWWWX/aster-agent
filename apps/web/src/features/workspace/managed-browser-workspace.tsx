import { LoadingState, Spinner } from "../../components/ui/loading.js";
import {
  ArrowLeft,
  ArrowRight,
  Download,
  EllipsisVertical,
  RefreshCw,
  X,
} from "lucide-react";
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type ReactElement,
} from "react";

import type {
  ManagedBrowserCommandInput,
  ManagedBrowserSession,
  ManagedBrowserWorkspaceAddAction,
  ManagedBrowserWorkspaceTabAction,
} from "@agent/protocol";

import { IconButton } from "../../components/ui/icon-button.js";
import {
  LIVE_PANEL_RESIZE_EVENT,
  type LivePanelResizeDetail,
} from "../../components/layout/live-panel-resize.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { createManagedBrowserBoundsDispatcher } from "./managed-browser-bounds-dispatcher.js";

type BrowserToolbarCommand = Exclude<
  ManagedBrowserCommandInput["command"],
  | "setColorScheme"
  | "showDownloads"
  | "showFind"
  | "showMenu"
  | "showWorkspaceAddMenu"
  | "showWorkspaceTabMenu"
>;

export type ManagedBrowserWorkspaceMenuRequest =
  | {
    canCreateSideChat: boolean;
    canOpenGitReview: boolean;
    canOpenTerminal: boolean;
    id: number;
    kind: "add";
    x: number;
    y: number;
  }
  | {
    canCloseOthers: boolean;
    id: number;
    kind: "tab";
    x: number;
    y: number;
  };

export function ManagedBrowserWorkspace({
  active,
  agentClient,
  colorScheme,
  conversationId,
  initialUrl,
  menuRequest,
  session,
  onSessionChanged,
  onWorkspaceAddMenuAction,
  onWorkspaceTabMenuAction,
}: {
  active: boolean;
  agentClient: AgentClient;
  colorScheme: "light" | "dark";
  conversationId?: string;
  initialUrl: string;
  menuRequest: ManagedBrowserWorkspaceMenuRequest | null;
  session: ManagedBrowserSession | null;
  onSessionChanged: (session: ManagedBrowserSession) => void;
  onWorkspaceAddMenuAction: (action: ManagedBrowserWorkspaceAddAction) => void;
  onWorkspaceTabMenuAction: (action: ManagedBrowserWorkspaceTabAction) => void;
}): ReactElement {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const scheduleBoundsRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);
  const onSessionChangedRef = useRef(onSessionChanged);
  const onWorkspaceAddMenuActionRef = useRef(onWorkspaceAddMenuAction);
  const onWorkspaceTabMenuActionRef = useRef(onWorkspaceTabMenuAction);
  const sessionRef = useRef(session);
  const activeRef = useRef(active);
  const openingRef = useRef(false);
  const handledMenuRequestIdRef = useRef<number | null>(null);
  const [address, setAddress] = useState(session?.url ?? initialUrl);
  const addressRef = useRef(address);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSessionChangedRef.current = onSessionChanged;
    onWorkspaceAddMenuActionRef.current = onWorkspaceAddMenuAction;
    onWorkspaceTabMenuActionRef.current = onWorkspaceTabMenuAction;
  }, [onSessionChanged, onWorkspaceAddMenuAction, onWorkspaceTabMenuAction]);

  useEffect(() => {
    sessionRef.current = session;
  }, [session]);

  useEffect(() => {
    addressRef.current = address;
  }, [address]);

  useEffect(() => {
    mountedRef.current = true;
    const dispose = agentClient.onManagedBrowserEvent((event) => {
      if (event.type === "state") {
        if (event.session.sessionId !== sessionRef.current?.sessionId) return;
        sessionRef.current = event.session;
        setAddress(event.session.url);
        onSessionChangedRef.current(event.session);
        setError(null);
        return;
      }
      if (event.type === "openSettings") {
        if (event.sessionId !== sessionRef.current?.sessionId) return;
        const workbench = useWorkbenchUiStore.getState();
        workbench.setSettingsSection("browser");
        workbench.setSettings();
        return;
      }
      if (event.type === "workspaceAddMenu") {
        if (event.sessionId === sessionRef.current?.sessionId) {
          onWorkspaceAddMenuActionRef.current(event.action);
        }
        return;
      }
      if (event.type === "workspaceTabMenu") {
        if (event.sessionId === sessionRef.current?.sessionId) {
          onWorkspaceTabMenuActionRef.current(event.action);
        }
        return;
      }
      if (event.type === "openGlobalSearch") return;
      if (event.sessionId === sessionRef.current?.sessionId) setError(event.message);
    });
    return () => {
      mountedRef.current = false;
      dispose();
      const current = sessionRef.current;
      // StrictMode replays effects synchronously; only a real unmount loses ownership.
      queueMicrotask(() => {
        if (!mountedRef.current && current !== null) {
          void agentClient.closeManagedBrowser({ sessionId: current.sessionId }).catch(() => undefined);
        }
      });
    };
  }, [agentClient]);

  useEffect(() => {
    if (!active || sessionRef.current !== null || openingRef.current) return;
    openingRef.current = true;
    const initialAddress = addressRef.current.trim();
    void agentClient.openManagedBrowser({ ...(initialAddress.length === 0 ? {} : { url: initialAddress }),
      ...(conversationId === undefined ? {} : { conversationId }) }).then((opened) => {
      if (!mountedRef.current) {
        return agentClient.closeManagedBrowser({ sessionId: opened.sessionId });
      }
      sessionRef.current = opened;
      setAddress(opened.url);
      onSessionChangedRef.current(opened);
    }).catch((reason: unknown) => {
      if (mountedRef.current) setError(getUserErrorMessage(reason, "内置浏览器启动失败。"));
    }).finally(() => {
      openingRef.current = false;
    });
  }, [active, agentClient, conversationId, session]);

  useEffect(() => {
    if (menuRequest == null || handledMenuRequestIdRef.current === menuRequest.id) return;
    const current = sessionRef.current;
    if (current === null) return;
    handledMenuRequestIdRef.current = menuRequest.id;
    const commandInput: ManagedBrowserCommandInput = menuRequest.kind === "add"
      ? {
        canCreateSideChat: menuRequest.canCreateSideChat,
        canOpenGitReview: menuRequest.canOpenGitReview,
        canOpenTerminal: menuRequest.canOpenTerminal,
        command: "showWorkspaceAddMenu",
        sessionId: current.sessionId,
        x: menuRequest.x,
        y: menuRequest.y,
      }
      : {
        canCloseOthers: menuRequest.canCloseOthers,
        command: "showWorkspaceTabMenu",
        sessionId: current.sessionId,
        x: menuRequest.x,
        y: menuRequest.y,
      };
    void agentClient.commandManagedBrowser(commandInput).catch((reason: unknown) => {
      setError(getUserErrorMessage(reason, "无法打开工作区菜单。"));
    });
  }, [agentClient, menuRequest, session?.sessionId]);

  useEffect(() => {
    const current = sessionRef.current;
    if (current === null) return;
    void agentClient.commandManagedBrowser({
      colorScheme,
      command: "setColorScheme",
      sessionId: current.sessionId,
    }).catch((reason: unknown) => {
      setError(getUserErrorMessage(reason, "无法同步浏览器主题。"));
    });
  }, [agentClient, colorScheme, session?.sessionId]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return undefined;
    let animationFrame: number | null = null;
    const observedElements = new Set<Element>();
    const dispatcher = createManagedBrowserBoundsDispatcher((input) => (
      agentClient.setManagedBrowserBounds(input)
    ));
    const measureBounds = (): void => {
      const current = sessionRef.current;
      if (current === null) return;
      const bounds = surface.getBoundingClientRect();
      let left = Math.max(0, bounds.left);
      let top = Math.max(0, bounds.top);
      let right = Math.min(window.innerWidth, bounds.right);
      let bottom = Math.min(window.innerHeight, bounds.bottom);
      for (let parent = surface.parentElement; parent !== null; parent = parent.parentElement) {
        const style = window.getComputedStyle(parent);
        const clipX = /^(hidden|clip|scroll|auto)$/u.test(style.overflowX || style.overflow);
        const clipY = /^(hidden|clip|scroll|auto)$/u.test(style.overflowY || style.overflow);
        if (!clipX && !clipY) continue;
        const parentBounds = parent.getBoundingClientRect();
        if (clipX) {
          left = Math.max(left, parentBounds.left + parent.clientLeft);
          right = Math.min(right, parentBounds.left + parent.clientLeft + parent.clientWidth);
        }
        if (clipY) {
          top = Math.max(top, parentBounds.top + parent.clientTop);
          bottom = Math.min(bottom, parentBounds.top + parent.clientTop + parent.clientHeight);
        }
        if (!observedElements.has(parent)) { observer.observe(parent); observedElements.add(parent); }
      }
      for (const element of observedElements) {
        if (!element.isConnected) { observer.unobserve(element); observedElements.delete(element); }
      }
      const x = Math.ceil(left);
      const y = Math.ceil(top);
      const width = Math.max(0, Math.floor(right) - x);
      const height = Math.max(0, Math.floor(bottom) - y);
      dispatcher.push({
        height,
        sessionId: current.sessionId,
        visible: activeRef.current && width > 0 && height > 0,
        width,
        x,
        y,
      });
    };
    const scheduleBounds = (): void => {
      if (animationFrame !== null) return;
      animationFrame = window.requestAnimationFrame(() => {
        animationFrame = null;
        measureBounds();
      });
    };
    const handleLiveResize = (event: Event): void => {
      const detail = (event as CustomEvent<LivePanelResizeDetail>).detail;
      if (detail.id !== "right-workspace") return;
      measureBounds();
      if (detail.phase === "end") scheduleBounds();
    };
    // ResizeObserver already runs after layout and before paint. Send its latest
    // geometry immediately so the native view can join the same visual frame.
    const observer = new ResizeObserver(measureBounds);
    observer.observe(surface);
    observedElements.add(surface);
    window.addEventListener(LIVE_PANEL_RESIZE_EVENT, handleLiveResize);
    window.addEventListener("resize", scheduleBounds);
    window.addEventListener("scroll", scheduleBounds, true);
    scheduleBoundsRef.current = scheduleBounds;
    measureBounds();
    return () => {
      scheduleBoundsRef.current = null;
      observer.disconnect();
      window.removeEventListener(LIVE_PANEL_RESIZE_EVENT, handleLiveResize);
      window.removeEventListener("resize", scheduleBounds);
      window.removeEventListener("scroll", scheduleBounds, true);
      if (animationFrame !== null) window.cancelAnimationFrame(animationFrame);
      dispatcher.stop();
      const current = sessionRef.current;
      if (current !== null) {
        void agentClient.setManagedBrowserBounds({
          height: 0,
          sessionId: current.sessionId,
          visible: false,
          width: 0,
          x: 0,
          y: 0,
        }).catch(() => undefined);
      }
    };
  }, [agentClient, session?.sessionId]);

  useEffect(() => {
    activeRef.current = active;
    scheduleBoundsRef.current?.();
  }, [active, session?.sessionId]);

  const command = (value: BrowserToolbarCommand): void => {
    const current = sessionRef.current;
    if (current !== null) {
      void agentClient.commandManagedBrowser({ command: value, sessionId: current.sessionId })
        .catch((reason: unknown) => setError(getUserErrorMessage(reason, "浏览器操作失败。")));
    }
  };
  const showAnchoredMenu = (
    value: "showDownloads" | "showMenu",
    event: MouseEvent<HTMLButtonElement>,
  ): void => {
    const current = sessionRef.current;
    if (current === null) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    void agentClient.commandManagedBrowser({
      command: value,
      sessionId: current.sessionId,
      x: Math.max(0, Math.round(bounds.right)),
      y: Math.max(0, Math.round(bounds.bottom)),
    }).catch((reason: unknown) => setError(getUserErrorMessage(reason, "浏览器菜单打开失败。")));
  };
  const navigate = (event: FormEvent): void => {
    event.preventDefault();
    const current = sessionRef.current;
    if (current === null || address.trim().length === 0) return;
    setError(null);
    void agentClient.navigateManagedBrowser({ sessionId: current.sessionId, url: address }).catch((reason: unknown) => {
      setError(getUserErrorMessage(reason, "网页打开失败。"));
    });
  };
  const handleFindShortcut = (event: KeyboardEvent<HTMLElement>): void => {
    if (!(event.ctrlKey || event.metaKey) || event.shiftKey || event.altKey) return;
    if (event.key.toLocaleLowerCase() !== "f") return;
    const current = sessionRef.current;
    const bounds = surfaceRef.current?.getBoundingClientRect();
    if (current === null || bounds === undefined) return;
    event.preventDefault();
    void agentClient.commandManagedBrowser({
      command: "showFind",
      sessionId: current.sessionId,
      x: Math.max(0, Math.round(bounds.right)),
      y: Math.max(0, Math.round(bounds.top)),
    }).catch((reason: unknown) => setError(getUserErrorMessage(reason, "页面查找打开失败。")));
  };

  return (
    <section className="flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden bg-[var(--app-panel)]" aria-label="内置浏览器" data-managed-browser-workspace onKeyDownCapture={handleFindShortcut}>
      <form className="flex h-11 flex-none items-center gap-1 border-b border-[var(--app-border)] px-2" onSubmit={navigate}>
        <div className="flex shrink-0 items-center gap-0.5">
          <button aria-label="后退" className="grid size-7 place-items-center rounded-md hover:bg-[var(--app-hover)] disabled:opacity-40" disabled={!session?.canGoBack} type="button" onClick={() => command("back")}><ArrowLeft aria-hidden="true" size={15} /></button>
          <button aria-label="前进" className="grid size-7 place-items-center rounded-md hover:bg-[var(--app-hover)] disabled:opacity-40" disabled={!session?.canGoForward} type="button" onClick={() => command("forward")}><ArrowRight aria-hidden="true" size={15} /></button>
          <button aria-label={session?.isLoading ? "停止" : "刷新"} className="grid size-7 place-items-center rounded-md hover:bg-[var(--app-hover)]" type="button" onClick={() => command(session?.isLoading ? "stop" : "reload")}>
            {session?.isLoading ? <X aria-hidden="true" size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
          </button>
        </div>
        <input aria-label="网址或搜索内容" className="h-7 min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-input)] px-2 text-xs outline-none focus:border-[var(--app-accent)]" placeholder="输入网址或搜索内容" value={address} onChange={(event) => setAddress(event.target.value)} onFocus={(event) => event.currentTarget.select()} />
        {session === null ? <Spinner aria-hidden="true" className="text-[var(--app-muted-foreground)]" size={15} /> : null}
        <div className="flex shrink-0 items-center gap-0">
          <IconButton label="下载内容" size="compact" variant="quiet" onClick={(event) => showAnchoredMenu("showDownloads", event)}>
            <Download aria-hidden="true" size={15} />
          </IconButton>
          <IconButton label="浏览器菜单" size="compact" variant="quiet" onClick={(event) => showAnchoredMenu("showMenu", event)}>
            <EllipsisVertical aria-hidden="true" size={15} />
          </IconButton>
        </div>
      </form>
      {error !== null ? <div className="border-b border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{error}</div> : null}
      <div
        className="min-h-0 flex-1 bg-[var(--app-canvas)]"
        data-managed-browser-surface
        ref={surfaceRef}
      >
        {session === null && error === null ? <LoadingState label="正在打开浏览器…" className="h-full" /> : null}
      </div>
    </section>
  );
}
