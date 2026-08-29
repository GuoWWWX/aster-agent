import {
  ArrowLeft,
  ArrowRight,
  EllipsisVertical,
  LoaderCircle,
  RefreshCw,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from "react";

import type { ManagedBrowserCommandInput, ManagedBrowserSession } from "@agent/protocol";

import { IconButton } from "../../components/ui/icon-button.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";

export function ManagedBrowserWorkspace({
  active,
  agentClient,
  initialUrl,
  session,
  onSessionChanged,
}: {
  active: boolean;
  agentClient: AgentClient;
  initialUrl: string;
  session: ManagedBrowserSession | null;
  onSessionChanged: (session: ManagedBrowserSession) => void;
}): ReactElement {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const mountedRef = useRef(false);
  const onSessionChangedRef = useRef(onSessionChanged);
  const sessionRef = useRef(session);
  const openingRef = useRef(false);
  const [address, setAddress] = useState(session?.url ?? initialUrl);
  const addressRef = useRef(address);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    onSessionChangedRef.current = onSessionChanged;
  }, [onSessionChanged]);

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
      if (event.sessionId === sessionRef.current?.sessionId) setError(event.message);
    });
    return () => {
      mountedRef.current = false;
      dispose();
    };
  }, [agentClient]);

  useEffect(() => {
    if (!active || sessionRef.current !== null || openingRef.current) return;
    openingRef.current = true;
    void agentClient.openManagedBrowser({ url: addressRef.current }).then((opened) => {
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
  }, [active, agentClient, session]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (surface === null) return undefined;
    const updateBounds = (): void => {
      const current = sessionRef.current;
      if (current === null) return;
      const bounds = surface.getBoundingClientRect();
      void agentClient.setManagedBrowserBounds({
        height: Math.max(0, Math.round(bounds.height)),
        sessionId: current.sessionId,
        visible: active,
        width: Math.max(0, Math.round(bounds.width)),
        x: Math.max(0, Math.round(bounds.x)),
        y: Math.max(0, Math.round(bounds.y)),
      }).catch(() => undefined);
    };
    const observer = new ResizeObserver(updateBounds);
    observer.observe(surface);
    window.addEventListener("resize", updateBounds);
    updateBounds();
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateBounds);
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
  }, [active, agentClient, session?.sessionId]);

  const command = (value: ManagedBrowserCommandInput["command"]): void => {
    const current = sessionRef.current;
    if (current !== null) {
      void agentClient.commandManagedBrowser({ command: value, sessionId: current.sessionId })
        .catch((reason: unknown) => setError(getUserErrorMessage(reason, "浏览器操作失败。")));
    }
  };
  const navigate = (event: FormEvent): void => {
    event.preventDefault();
    const current = sessionRef.current;
    if (current === null) return;
    setError(null);
    void agentClient.navigateManagedBrowser({ sessionId: current.sessionId, url: address }).catch((reason: unknown) => {
      setError(getUserErrorMessage(reason, "网页打开失败。"));
    });
  };

  return (
    <section className="flex h-full min-h-0 w-full flex-col bg-[var(--app-panel)]" aria-label="内置浏览器">
      <form className="flex h-11 flex-none items-center gap-1.5 border-b border-[var(--app-border)] px-2" onSubmit={navigate}>
        <button aria-label="后退" className="grid size-7 place-items-center rounded-md hover:bg-[var(--app-hover)] disabled:opacity-40" disabled={!session?.canGoBack} type="button" onClick={() => command("back")}><ArrowLeft aria-hidden="true" size={15} /></button>
        <button aria-label="前进" className="grid size-7 place-items-center rounded-md hover:bg-[var(--app-hover)] disabled:opacity-40" disabled={!session?.canGoForward} type="button" onClick={() => command("forward")}><ArrowRight aria-hidden="true" size={15} /></button>
        <button aria-label={session?.isLoading ? "停止" : "刷新"} className="grid size-7 place-items-center rounded-md hover:bg-[var(--app-hover)]" type="button" onClick={() => command(session?.isLoading ? "stop" : "reload")}>
          {session?.isLoading ? <X aria-hidden="true" size={15} /> : <RefreshCw aria-hidden="true" size={15} />}
        </button>
        <input aria-label="网址或搜索内容" className="h-7 min-w-0 flex-1 rounded-md border border-[var(--app-border)] bg-[var(--app-input)] px-2 text-xs outline-none focus:border-[var(--app-accent)]" placeholder="输入网址或搜索内容" value={address} onChange={(event) => setAddress(event.target.value)} />
        {session === null ? <LoaderCircle aria-hidden="true" className="animate-spin text-[var(--app-muted-foreground)]" size={15} /> : null}
        <div className="flex shrink-0 items-center gap-0.5 text-[var(--app-muted-foreground)]">
          <IconButton label="缩小网页" size="compact" variant="quiet" onClick={() => command("zoomOut")}>
            <ZoomOut aria-hidden="true" size={15} />
          </IconButton>
          <span
            aria-label={`网页缩放 ${session?.zoomPercent ?? 100}%`}
            className="w-10 text-center text-[var(--app-font-size-caption)] tabular-nums"
            title="按 Ctrl 并滚动鼠标滚轮可调整缩放"
          >
            {session?.zoomPercent ?? 100}%
          </span>
          <IconButton label="放大网页" size="compact" variant="quiet" onClick={() => command("zoomIn")}>
            <ZoomIn aria-hidden="true" size={15} />
          </IconButton>
        </div>
        <IconButton label="浏览器菜单" size="compact" variant="quiet" onClick={() => command("showMenu")}>
          <EllipsisVertical aria-hidden="true" size={15} />
        </IconButton>
      </form>
      {error !== null ? <div className="border-b border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-600 dark:text-red-400" role="alert">{error}</div> : null}
      <div className="min-h-0 flex-1 bg-white" ref={surfaceRef} />
    </section>
  );
}
