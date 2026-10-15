import { useEffect, useId, useRef, useState, type ReactElement } from "react";
import { ChevronDown, ChevronUp, FileDiff } from "lucide-react";
import { Popover, PopoverAnchor, PopoverContent } from "../../components/ui/popover.js";
import { cn } from "../../lib/cn.js";
import type { TaskFileChange, TaskFileChangeSummary } from "./task-file-change-summary.js";

function ChangeStats({ additions, deletions }: Pick<TaskFileChange, "additions" | "deletions">): ReactElement {
  return <span className="inline-flex shrink-0 gap-[5px] whitespace-nowrap tabular-nums"><span className="text-[var(--app-status-success-fg)]">+{additions}</span><span className="text-[var(--app-destructive)]">-{deletions}</span></span>;
}
const rowClass = "flex w-full min-w-0 items-center gap-[5px] rounded-[var(--app-radius)] border-0 bg-transparent px-2 py-1.5 text-left text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]";

export function ConversationChangesBadge({ summary, joined = false, onReview }: { summary: TaskFileChangeSummary; joined?: boolean; onReview: (path?: string) => void }): ReactElement {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const id = useId();
  const cancelClose = (): void => { if (timer.current !== null) { clearTimeout(timer.current); timer.current = null; } };
  const scheduleClose = (): void => { cancelClose(); timer.current = setTimeout(() => setOpen(false), 200); };
  const show = (): void => { cancelClose(); setOpen(true); };
  useEffect(() => () => { if (timer.current !== null) clearTimeout(timer.current); }, []);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverAnchor asChild><button type="button" data-conversation-change-summary aria-controls={open ? id : undefined} aria-expanded={open} aria-haspopup="dialog"
      aria-label={`查看 ${summary.files.length} 个文件的改动`} title="打开审阅" onPointerEnter={show} onPointerLeave={scheduleClose} onFocus={show} onBlur={scheduleClose}
      onClick={() => { cancelClose(); setOpen(false); onReview(); }}
      className={cn("inline-flex min-h-8 shrink-0 items-center gap-[5px] whitespace-nowrap border border-[var(--app-border)] bg-[var(--app-panel)] px-2 py-1 text-[length:var(--app-font-size-control)] font-medium text-[var(--app-foreground)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]", joined ? "rounded-none border-0 border-l" : "rounded-[var(--app-radius-pill)]")}>
      <span>{summary.files.length} 个文件已更改</span><ChangeStats additions={summary.additions} deletions={summary.deletions} />
    </button></PopoverAnchor>
    <PopoverContent id={id} side="top" align="center" sideOffset={5} aria-label="文件改动列表" onPointerEnter={cancelClose} onPointerLeave={scheduleClose} onFocusCapture={cancelClose} onBlurCapture={scheduleClose}
      onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => event.preventDefault()}
      className="max-h-[min(320px,45vh)] w-[min(320px,calc(100vw-20px))] overflow-y-auto rounded-[var(--app-radius-large)] border border-[var(--app-border)] bg-[var(--app-panel)] p-[5px] shadow-lg">
      {summary.files.map(file => <button className={rowClass} type="button" key={file.path} title={file.path} onClick={() => { setOpen(false); onReview(file.path); }}>
        <FileDiff size={14} className="shrink-0" /><span className="min-w-0 flex-1 truncate">{file.path}</span><ChangeStats additions={file.additions} deletions={file.deletions} />
      </button>)}
    </PopoverContent>
  </Popover>;
}

export function ConversationChangesCard({ summary, onReview }: { summary: TaskFileChangeSummary; onReview: (path?: string) => void }): ReactElement {
  const [expanded, setExpanded] = useState(false);
  const filesId = useId();
  return <section data-run-file-changes className="chat-message-group overflow-hidden rounded-[var(--app-radius-large)] border border-[var(--app-border)] bg-[var(--app-panel)] text-[var(--app-foreground)]" data-role="assistant" aria-label="本轮文件改动">
    <header className="flex min-w-0 items-center gap-[5px] border-b border-[var(--app-border)] p-2">
      <FileDiff size={17} className="shrink-0" /><div className="min-w-0 flex-1 text-[length:var(--app-font-size-body)]"><span className="font-medium">已编辑 {summary.files.length} 个文件</span><div><ChangeStats additions={summary.additions} deletions={summary.deletions} /></div></div>
      <button type="button" onClick={() => onReview()} className="shrink-0 rounded-[var(--app-radius)] border border-[var(--app-border)] bg-transparent px-2 py-1 text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)]">查看变更</button>
    </header>
    <div id={filesId} className="max-h-80 overflow-y-auto p-[5px]">{(expanded ? summary.files : summary.files.slice(0, 3)).map(file => <button key={file.path} type="button" data-changed-file={file.path} className={rowClass} title={file.path} onClick={() => onReview(file.path)}><span className="min-w-0 flex-1 truncate">{file.path}</span><ChangeStats additions={file.additions} deletions={file.deletions} /></button>)}</div>
    {summary.files.length > 3 ? <button className={rowClass} type="button" aria-controls={filesId} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? <>收起变更<ChevronUp size={14} /></> : <>再显示 {summary.files.length - 3} 个文件<ChevronDown size={14} /></>}</button> : null}
  </section>;
}
