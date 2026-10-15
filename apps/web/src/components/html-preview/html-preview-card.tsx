import { createContext, useContext, useEffect, useMemo, useState, type ReactElement, type ReactNode } from "react";
import { CodeXml, ExternalLink, RefreshCw, X } from "lucide-react";
import type { HtmlPreview } from "@agent/protocol";
import type { AgentClient } from "../../runtime/agent-client.js";
import { IconButton } from "../ui/icon-button.js";

export const HtmlPreviewContext = createContext<{ client: AgentClient; conversationId: string } | null>(null);
export type HtmlPreviewSource = { kind: "code"; html: string } | { kind: "file"; path: string };
export function HtmlPreviewScope({ client, conversationId, children }: { client: AgentClient; conversationId: string; children: ReactNode }): ReactElement {
  const value = useMemo(() => ({ client, conversationId }), [client, conversationId]);
  return <HtmlPreviewContext.Provider value={value}>{children}</HtmlPreviewContext.Provider>;
}

export function HtmlPreviewCard({ source, onClose }: { source: HtmlPreviewSource; onClose: () => void }): ReactElement {
  const context = useContext(HtmlPreviewContext);
  const [revision, setRevision] = useState(0);
  const value = source.kind === "code" ? source.html : source.path;
  return <HtmlPreviewContent key={`${context?.conversationId}:${source.kind}:${value}:${revision}`} source={source} onClose={onClose} onRefresh={() => setRevision(current => current + 1)} />;
}

function HtmlPreviewContent({ source, onClose, onRefresh }: { source: HtmlPreviewSource; onClose: () => void; onRefresh: () => void }): ReactElement {
  const context = useContext(HtmlPreviewContext);
  const [preview, setPreview] = useState<HtmlPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"preview" | "source">("preview");
  const kind = source.kind;
  const value = source.kind === "code" ? source.html : source.path;
  useEffect(() => {
    if (context === null) return;
    let alive = true;
    let owned: string | undefined;
    const release = (id: string): void => { void context.client.htmlPreview({ kind: "release", id, conversationId: context.conversationId }).catch(() => undefined); };
    void context.client.htmlPreview({ conversationId: context.conversationId, ...(kind === "code" ? { kind, html: value } : { kind, path: value }) }).then(result => {
      if (result === null) throw new Error("无法创建 HTML 预览。");
      if (!alive) { release(result.id); return; }
      owned = result.id; setPreview(result);
    }).catch(reason => { if (alive) setError(reason instanceof Error ? reason.message : "HTML 预览加载失败。"); });
    return () => { alive = false; if (owned !== undefined) release(owned); };
  }, [context, kind, value]);
  const buttonClass = "rounded-[var(--app-radius-small)] border-0 bg-transparent px-2 py-1 text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] aria-pressed:bg-[var(--app-selection)] aria-pressed:text-[var(--app-selection-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]";
  return <section aria-label="HTML 页面预览" className="my-[5px] min-w-0 overflow-hidden rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] text-[var(--app-foreground)]">
    <header className="flex min-w-0 flex-wrap items-center gap-[5px] border-b border-[var(--app-border)] px-2 py-1">
      <CodeXml size={15} className="shrink-0" /><span className="min-w-0 flex-1 truncate text-[length:var(--app-font-size-control)]" title={source.kind === "file" ? source.path : "HTML 示例"}>{preview?.title ?? (source.kind === "file" ? source.path.split(/[\\/]/u).at(-1) : "HTML 示例")}</span>
      <button className={buttonClass} type="button" aria-pressed={mode === "preview"} onClick={() => setMode("preview")}>预览</button>
      <button className={buttonClass} type="button" aria-pressed={mode === "source"} onClick={() => setMode("source")}>源码</button>
      <IconButton label="刷新 HTML 预览" size="compact" onClick={onRefresh}><RefreshCw size={14} /></IconButton>
      <IconButton label="在侧边浏览器打开 HTML" size="compact" disabled={preview === null} onClick={() => {
        if (preview !== null && context !== null) void context.client.htmlPreview({ kind: "browser", id: preview.id, conversationId: context.conversationId }).catch(reason => setError(reason instanceof Error ? reason.message : "浏览器打开失败。"));
      }}><ExternalLink size={14} /></IconButton>
      <IconButton label="关闭 HTML 预览" size="compact" onClick={onClose}><X size={14} /></IconButton>
    </header>
    {error !== null ? <p role="alert" className="m-0 p-2 text-[length:var(--app-font-size-control)] text-[var(--app-destructive)]">{error}</p> : null}
    {preview === null ? error === null ? <p role="status" className="m-0 p-2 text-[length:var(--app-font-size-control)]">正在加载页面…</p> : null : mode === "source"
      ? <pre className="m-0 max-h-96 overflow-auto p-2 text-[length:var(--app-font-size-control)]"><code>{preview.source}</code></pre>
      : <div className="h-80 min-h-48 resize-y overflow-auto bg-white"><iframe title={`${preview.title} 页面效果`} src={preview.url} sandbox="allow-scripts" referrerPolicy="no-referrer" className="block h-full min-h-48 w-full border-0" /></div>}
  </section>;
}

export function HtmlFilePreview({ path }: { path: string }): ReactElement | null {
  const context = useContext(HtmlPreviewContext);
  const [open, setOpen] = useState(true);
  if (context === null || !/\.html?$/iu.test(path)) return null;
  return open ? <HtmlPreviewCard source={{ kind: "file", path }} onClose={() => setOpen(false)} />
    : <button type="button" className="my-[5px] border-0 bg-transparent text-[length:var(--app-font-size-control)] text-[var(--app-accent)]" onClick={() => setOpen(true)}>预览 HTML：{path}</button>;
}
