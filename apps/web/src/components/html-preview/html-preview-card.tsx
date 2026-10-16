import { createContext, useContext, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from "react";
import { CircleAlert, CodeXml, Copy, ExternalLink, LoaderCircle, Play } from "lucide-react";
import { htmlPreviewResizeMessageSchema, type HtmlPreview } from "@agent/protocol";
import type { AgentClient } from "../../runtime/agent-client.js";
import { IconButton } from "../ui/icon-button.js";
import { CodeSourceView } from "../markdown/code-source-view.js";

export const HtmlPreviewContext = createContext<{ client: AgentClient; conversationId: string } | null>(null);
export type HtmlPreviewSource = { kind: "code"; html: string } | { kind: "file"; path: string };
export function HtmlPreviewScope({ client, conversationId, children }: { client: AgentClient; conversationId: string; children: ReactNode }): ReactElement {
  const value = useMemo(() => ({ client, conversationId }), [client, conversationId]);
  return <HtmlPreviewContext.Provider value={value}>{children}</HtmlPreviewContext.Provider>;
}

export function HtmlPreviewCard({ source, embedded = false, initialMode = "preview" }: {
  source: HtmlPreviewSource; embedded?: boolean; initialMode?: "preview" | "source";
}): ReactElement {
  const context = useContext(HtmlPreviewContext);
  const [revision, setRevision] = useState(0);
  const [mode, setMode] = useState(initialMode);
  const [requested, setRequested] = useState(initialMode === "preview" || source.kind === "file");
  const value = source.kind === "code" ? source.html : source.path;
  return <HtmlPreviewContent key={`${context?.conversationId}:${source.kind}:${value}:${revision}:${requested}`} source={source} embedded={embedded} mode={mode} requested={requested}
    onModeChange={next => { setMode(next); if (next === "preview") { setRequested(true); setRevision(current => current + 1); } }} />;
}

function HtmlPreviewContent({ source, embedded, mode, requested, onModeChange }: {
  source: HtmlPreviewSource; embedded: boolean;
  mode: "preview" | "source"; requested: boolean; onModeChange: (mode: "preview" | "source") => void;
}): ReactElement {
  const context = useContext(HtmlPreviewContext);
  const [preview, setPreview] = useState<HtmlPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openingBrowser, setOpeningBrowser] = useState(false);
  const [height, setHeight] = useState(320);
  const frameRef = useRef<HTMLIFrameElement>(null);
  const kind = source.kind;
  const value = source.kind === "code" ? source.html : source.path;
  useEffect(() => {
    if (context === null || !requested) return;
    let alive = true;
    let owned: string | undefined;
    const release = (id: string): void => { void context.client.htmlPreview({ kind: "release", id, conversationId: context.conversationId }).catch(() => undefined); };
    void context.client.htmlPreview({ conversationId: context.conversationId, ...(kind === "code" ? { kind, html: value } : { kind, path: value }) }).then(result => {
      if (result === null) throw new Error("无法创建 HTML 预览。");
      if (!alive) { release(result.id); return; }
      owned = result.id; setPreview(result);
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "HTML 预览加载失败。"); });
    return () => { alive = false; if (owned !== undefined) release(owned); };
  }, [context, kind, value, requested]);
  useEffect(() => {
    if (preview === null || mode !== "preview") return;
    const frame = frameRef.current;
    if (frame === null) return;
    let lastWidth = 0;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const width = entry.contentRect.width;
      if (width > 0 && width !== lastWidth) frame.contentWindow?.postMessage({ type: "html-preview.measure", id: preview.id }, "*");
      lastWidth = width;
    });
    observer.observe(frame);
    const resize = (event: MessageEvent<unknown>): void => {
      if (event.source !== frame.contentWindow || event.origin !== "null" || frame.getBoundingClientRect().width === 0) return;
      const message = htmlPreviewResizeMessageSchema.safeParse(event.data);
      if (message.success && message.data.id === preview.id) setHeight(Math.min(520, Math.max(160, message.data.height)));
    };
    window.addEventListener("message", resize);
    return () => { observer.disconnect(); window.removeEventListener("message", resize); };
  }, [preview, mode]);
  const sourceText = source.kind === "code" ? source.html : preview?.source;
  const title = source.kind === "file" ? source.path.split(/[\\/]/u).at(-1) : "html";
  return <section aria-label="HTML 页面预览" className={embedded
    ? "min-w-0 overflow-hidden bg-[var(--app-panel)] text-[var(--app-foreground)]"
    : "my-[5px] min-w-0 overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] text-[var(--app-foreground)]"}>
    <header className="flex min-w-0 flex-wrap items-center gap-[5px] border-b border-[var(--app-border)] px-2 py-1">
      <CodeXml size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-control)]" title={source.kind === "file" ? source.path : "HTML 代码块"}>{title}</span>
      {error !== null ? <IconButton label="HTML 预览错误" tooltip={error} size="compact" className="text-[var(--app-destructive)]"><CircleAlert size={14} /></IconButton> : null}
      <IconButton label={mode === "source" ? "预览 HTML" : "显示源码"} size="compact" onClick={() => onModeChange(mode === "source" ? "preview" : "source")}>
        {mode === "source" ? <Play size={14} /> : <CodeXml size={14} />}
      </IconButton>
      <IconButton label="在侧边浏览器打开 HTML" tooltip={openingBrowser ? "正在打开侧边浏览器…" : "在侧边浏览器打开 HTML"} size="compact" disabled={preview === null || openingBrowser} aria-busy={openingBrowser} onClick={() => {
        if (preview === null || context === null || openingBrowser) return;
        setOpeningBrowser(true);
        void context.client.htmlPreview({ kind: "browser", id: preview.id, conversationId: context.conversationId }).then(() => setError(null))
          .catch(reason => setError(reason instanceof Error ? reason.message : "浏览器打开失败。")).finally(() => setOpeningBrowser(false));
      }}>{openingBrowser ? <LoaderCircle size={14} className="animate-spin" /> : <ExternalLink size={14} />}</IconButton>
      <IconButton label="复制代码" size="compact" disabled={sourceText === undefined} onClick={() => {
        if (sourceText !== undefined) void navigator.clipboard.writeText(sourceText).catch(() => setError("复制失败，请重试。"));
      }}><Copy size={14} /></IconButton>
    </header>
    {mode === "source" && sourceText !== undefined
      ? <CodeSourceView source={sourceText} language="html" />
      : preview === null ? error === null ? <p role="status" className="m-0 p-2 text-[length:var(--app-font-size-control)]">正在加载页面…</p> : null
      : <iframe ref={frameRef} title={`${preview.title} 页面效果`} src={preview.url} sandbox="allow-scripts" referrerPolicy="no-referrer"
        className="block w-full border-0 bg-white" style={{ height }} onLoad={() => {
          frameRef.current?.contentWindow?.postMessage({ type: "html-preview.measure", id: preview.id }, "*");
        }} />}
  </section>;
}
