import { ChevronDown, ChevronRight, FileDiff, RefreshCw } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from "react";

import { createDiffPresentation, DiffView } from "../../components/diff/diff-view.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { getUserErrorMessage, type AgentClient } from "../../runtime/index.js";
import { collectFileChangeReview, type ReviewedFileChange } from "../chat/task-file-change-summary.js";

export function ConversationReviewWorkspace({ agentClient, conversationId, runId, active, requestedFile }: {
  agentClient: AgentClient;
  conversationId: string;
  runId: string | null;
  active: boolean;
  requestedFile: { path: string; requestId: string } | null;
}): ReactElement {
  const [files, setFiles] = useState<ReviewedFileChange[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const requestedPath = requestedFile?.path;
  const requestId = requestedFile?.requestId;
  const [expandedRequestId, setExpandedRequestId] = useState(requestId);
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set(requestedPath === undefined ? [] : [requestedPath]));
  if (expandedRequestId !== requestId) {
    setExpandedRequestId(requestId);
    if (requestedPath !== undefined) setExpanded(current => new Set([...current, requestedPath]));
  }
  const rows = useRef(new Map<string, HTMLElement>());
  const locatedRequest = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let sequence = 0;
    const refresh = async (): Promise<void> => {
      const request = ++sequence;
      try {
        const timeline = await agentClient.listConversationTimeline({ conversationId });
        if (disposed || request !== sequence) return;
        const next = collectFileChangeReview(runId === null ? timeline : timeline.filter(item => item.runId === runId));
        setFiles(next); setError(null); setLoaded(true);
        setExpanded(current => current.size > 0 || next[0] === undefined ? current : new Set([next[0].path]));
      } catch (cause) {
        if (!disposed && request === sequence) { setError(getUserErrorMessage(cause, "无法读取对话变更。")); setLoaded(true); }
      }
    };
    void refresh();
    const unsubscribe = agentClient.onConversationRunEvent(event => {
      if ((event.type === "tool.completed" || event.type === "run.finished")
        && event.conversationId === conversationId && (runId === null || event.runId === runId)) void refresh();
    });
    return () => { disposed = true; unsubscribe(); };
  }, [active, agentClient, conversationId, revision, runId]);

  useLayoutEffect(() => {
    if (!active || requestedPath === undefined || locatedRequest.current === requestId
      || !files.some(file => file.path === requestedPath)) return;
    rows.current.get(requestedPath)?.scrollIntoView({ block: "start" });
    locatedRequest.current = requestId;
  }, [active, files, requestedPath, requestId]);

  const additions = files.reduce((total, file) => total + file.additions, 0);
  const deletions = files.reduce((total, file) => total + file.deletions, 0);
  return <section aria-label="对话文件审阅" className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-[var(--app-panel)] text-[var(--app-foreground)]">
    <header className="flex shrink-0 items-center gap-[5px] border-b border-[var(--app-border)] px-3 py-2 text-[length:var(--app-font-size-control)]">
      <FileDiff size={14} /><strong className="min-w-0 flex-1">本轮变更 · {files.length} 个文件</strong>
      <span className="text-[var(--app-status-success-fg)]">+{additions}</span><span className="text-[var(--app-destructive)]">-{deletions}</span>
      <IconButton label="刷新对话变更" size="compact" onClick={() => setRevision(value => value + 1)}><RefreshCw size={14} /></IconButton>
    </header>
    {error === null ? null : <p role="alert" className="m-0 p-2 text-[length:var(--app-font-size-body)] text-[var(--app-destructive)]">{error}</p>}
    <div className="min-h-0 flex-1 overflow-auto">
      {files.length === 0 ? <p className="p-3 text-[length:var(--app-font-size-body)] text-[var(--app-muted-foreground)]">{loaded ? "本轮没有可显示的文件变更。" : "正在读取变更…"}</p> : null}
      {files.map(file => <article key={file.path} data-review-file={file.path} ref={element => { if (element === null) rows.current.delete(file.path); else rows.current.set(file.path, element); }} className="min-w-0 border-b border-[var(--app-border)]">
        <button type="button" aria-expanded={expanded.has(file.path)} title={file.path} onClick={() => setExpanded(current => {
          const next = new Set(current); if (next.has(file.path)) next.delete(file.path); else next.add(file.path); return next;
        })} className="flex w-full items-center gap-[5px] border-0 bg-transparent px-3 py-2 text-left text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">
          {expanded.has(file.path) ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
          <span className="min-w-0 flex-1 truncate">{file.path}</span><span className="shrink-0 text-[var(--app-status-success-fg)]">+{file.additions}</span><span className="shrink-0 text-[var(--app-destructive)]">-{file.deletions}</span>
        </button>
        {expanded.has(file.path) ? file.diffs.map((diff, index) => <div key={index}>
          {file.diffs.length > 1 ? <div className="border-t border-[var(--app-border)] px-3 py-1 text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">第 {index + 1} 次修改</div> : null}
          <DiffView presentation={createDiffPresentation(diff)} />
        </div>) : null}
      </article>)}
    </div>
  </section>;
}
