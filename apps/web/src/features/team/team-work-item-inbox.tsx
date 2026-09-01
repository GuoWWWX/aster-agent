import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  CircleDotDashed,
  ClipboardList,
  Clock3,
  Inbox,
  ListFilter,
  Pencil,
  Search,
  SendHorizontal,
  X,
} from "lucide-react";
import { useMemo, useState, type FormEvent, type ReactElement } from "react";

import { Badge } from "../../components/ui/badge.js";
import { IconButton } from "../../components/ui/icon-button.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";

import type { TeamWorkItemPrototype, TeamWorkItemStatus } from "./team-runtime-prototype.js";
import { canEditWorkItem, type WorkItemFilter } from "./team-work-item-lifecycle.js";
import { formatTeamWorkItemTime } from "./team-work-item-time.js";

export type { WorkItemFilter } from "./team-work-item-lifecycle.js";

const STATUS_LABEL: Record<TeamWorkItemStatus, string> = {
  blocked: "需要处理",
  completed: "已完成",
  executing: "执行中",
  finalizing: "收尾中",
  planning: "规划中",
  queued: "待执行",
  reworking: "返工中",
  reviewing: "测试评审",
  awaiting_acceptance: "待用户验收",
};

const PAGE_SIZE = 10;

export function WorkItemInbox({
  allowQueuedEditing = true,
  acceptanceCount,
  completedCount,
  draft,
  editingItemId,
  filter,
  items,
  onCancelEdit,
  onDraftChange,
  onEdit,
  onFilterChange,
  onSelect,
  onSaveEdit,
  processingCount,
  queuedCount,
  selectedId,
}: {
  allowQueuedEditing?: boolean;
  acceptanceCount: number;
  completedCount: number;
  draft: string;
  editingItemId: string | null;
  filter: WorkItemFilter;
  items: readonly TeamWorkItemPrototype[];
  onCancelEdit: () => void;
  onDraftChange: (draft: string) => void;
  onEdit: (id: string) => void;
  onFilterChange: (filter: WorkItemFilter) => void;
  onSelect: (id: string) => void;
  onSaveEdit: () => void;
  processingCount: number;
  queuedCount: number;
  selectedId: string | null;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [priorityFilter, setPriorityFilter] = useState<TeamWorkItemPrototype["priority"] | "all">("all");
  const [sourceFilter, setSourceFilter] = useState<TeamWorkItemPrototype["source"] | "all">("all");
  const visibleItems = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return items.filter((item) => {
      if (sourceFilter !== "all" && item.source !== sourceFilter) return false;
      if (priorityFilter !== "all" && item.priority !== priorityFilter) return false;
      if (normalized.length === 0) return true;
      return item.title.toLocaleLowerCase().includes(normalized)
        || item.project.toLocaleLowerCase().includes(normalized);
    });
  }, [items, priorityFilter, query, sourceFilter]);
  const pageCount = Math.max(1, Math.ceil(visibleItems.length / PAGE_SIZE));
  const [page, setPage] = useState(1);
  const currentPage = Math.min(page, pageCount);
  const pageItems = useMemo(
    () => visibleItems.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE),
    [currentPage, visibleItems],
  );

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSaveEdit();
  };
  return (
    <section
      className="team-command-panel grid min-h-0 grid-rows-[40px_auto_auto_auto_minmax(0,1fr)_auto_auto]"
      aria-labelledby="team-inbox-heading"
    >
      <PanelHeading id="team-inbox-heading" label="需求与任务" meta={`${queuedCount} 个待执行`} />
      <div aria-label="任务概况" className="grid grid-cols-4 gap-[5px] border-b border-[var(--app-border)] p-[10px]">
        <InboxMetric icon={<ClipboardList aria-hidden="true" size={16} />} label="待执行" tone="info" value={queuedCount} />
        <InboxMetric icon={<Clock3 aria-hidden="true" size={16} />} label="处理中" tone="warning" value={processingCount} />
        <InboxMetric icon={<CircleDotDashed aria-hidden="true" size={16} />} label="待验收" tone="success" value={acceptanceCount} />
        <InboxMetric icon={<CheckCircle2 aria-hidden="true" size={16} />} label="已完成" tone="success" value={completedCount} />
      </div>
      <div className="flex min-w-0 items-center gap-[2px] overflow-x-auto border-b border-[var(--app-border)] px-[5px] py-[5px]" role="tablist" aria-label="任务筛选">
        {([["all", "全部"], ["queued", "待执行"], ["processing", "处理中"], ["acceptance", "待验收"], ["completed", "已完成"]] as const)
          .map(([id, label]) => (
            <button
              key={id}
              aria-selected={filter === id}
              className={filter === id
                ? "h-[26px] shrink-0 rounded-[var(--app-radius-small)] bg-[var(--app-selection)] px-[8px] text-[length:var(--app-font-size-control)] font-semibold text-[var(--app-selection-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1"
                : "h-[26px] shrink-0 rounded-[var(--app-radius-small)] bg-transparent px-[8px] text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)] hover:text-[var(--app-foreground)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1"}
              role="tab"
              type="button"
              onClick={() => {
                setPage(1);
                onFilterChange(id);
              }}
            >
              {label}
            </button>
          ))}
      </div>
      <div aria-label="任务搜索与筛选" className="grid grid-cols-[105px_minmax(0,1fr)_32px] gap-[5px] border-b border-[var(--app-border)] px-[10px] py-[7px]">
        <Select value={sourceFilter} onValueChange={(value) => {
          setSourceFilter(value as TeamWorkItemPrototype["source"] | "all");
          setPage(1);
        }}>
          <SelectTrigger aria-label="按任务来源筛选" className="h-[30px] w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部类型</SelectItem>
            <SelectItem value="conversation">来自对话</SelectItem>
            <SelectItem value="direct">直接投递</SelectItem>
          </SelectContent>
        </Select>
        <label className="flex h-[30px] min-w-0 items-center gap-[5px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[8px] text-[var(--app-muted-foreground)] focus-within:border-[var(--app-accent)] focus-within:ring-1 focus-within:ring-[var(--app-focus-ring)]">
          <Search aria-hidden="true" size={14} />
          <input
            aria-label="搜索团队任务"
            className="min-w-0 flex-1 border-0 bg-transparent text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] outline-none placeholder:text-[var(--app-muted-foreground)]"
            placeholder="搜索任务标题或项目"
            type="search"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </label>
        <Select value={priorityFilter} onValueChange={(value) => {
          setPriorityFilter(value as TeamWorkItemPrototype["priority"] | "all");
          setPage(1);
        }}>
          <SelectTrigger
            aria-label="按优先级筛选"
            className={priorityFilter === "all"
              ? "h-[30px] w-[32px] justify-center px-0"
              : "h-[30px] w-[32px] justify-center border-[var(--app-accent)] bg-[var(--app-selection)] px-0 text-[var(--app-accent)]"}
            showIndicator={false}
          >
            <ListFilter aria-hidden="true" size={14} />
          </SelectTrigger>
          <SelectContent className="w-[132px] max-w-[132px]">
            <SelectItem value="all">全部优先级</SelectItem>
            <SelectItem value="high">P1 · 高</SelectItem>
            <SelectItem value="normal">P2 · 中</SelectItem>
            <SelectItem value="low">P3 · 低</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grid min-h-0 auto-rows-max content-start overflow-auto" role="listbox" aria-label="团队任务">
        {visibleItems.length === 0 ? (
          <div className="team-runtime-empty">
            <Inbox aria-hidden="true" size={19} />
            当前筛选下没有任务
          </div>
        ) : pageItems.map((item) => (
          <article
            key={item.id}
            aria-selected={item.id === selectedId}
            className={item.id === selectedId
              ? "group relative min-w-0 border-b border-[var(--app-border)] border-l-2 border-l-[var(--app-accent)] bg-[var(--app-selection)]"
              : "group relative min-w-0 border-b border-[var(--app-border)] border-l-2 border-l-transparent bg-[var(--app-panel)] hover:bg-[var(--app-hover)]"}
            data-status={item.status}
            role="option"
          >
            <button
              className="grid w-full min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-[8px] bg-transparent px-[10px] py-[10px] text-left focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-[-2px]"
              type="button"
              onClick={() => onSelect(item.id)}
            >
              <span className={workItemIconClass(item.status)}>
                <WorkItemStatusIcon status={item.status} />
              </span>
              <span className="grid min-w-0 gap-[3px]">
                <strong className="overflow-hidden text-[length:var(--app-font-size-body)] text-[var(--app-foreground)] text-ellipsis whitespace-nowrap">
                  {item.title}
                </strong>
                <span className="overflow-hidden text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)] text-ellipsis whitespace-nowrap">
                  {item.project} · {item.source === "conversation" ? "来自对话" : "直接投递"}
                </span>
              </span>
              <span className="flex shrink-0 items-center gap-[8px] self-center whitespace-nowrap" data-work-item-meta="true">
                <Badge className="min-h-[18px] px-[6px] py-[1px]" tone={statusBadgeTone(item.status)}>
                  {STATUS_LABEL[item.status]}
                </Badge>
                <span className="min-w-[18px] text-center text-[length:var(--app-font-size-caption)] font-medium text-[var(--app-muted-foreground)]">{priorityLabel(item.priority)}</span>
                <time className="text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{formatTeamWorkItemTime(item.createdAt)}</time>
              </span>
            </button>
            {allowQueuedEditing && canEditWorkItem(item) ? (
              <button
                aria-label={`编辑需求：${item.title}`}
                className="absolute top-[8px] right-[8px] grid h-[24px] w-[24px] place-items-center rounded-[var(--app-radius-small)] border border-[var(--app-border)] bg-[var(--app-panel)] text-[var(--app-muted-foreground)] opacity-0 shadow-sm hover:bg-[var(--app-hover)] focus-visible:opacity-100 focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1 group-hover:opacity-100"
                title="执行前可以修改"
                type="button"
                onClick={() => onEdit(item.id)}
              >
                <Pencil aria-hidden="true" size={12} />
              </button>
            ) : null}
          </article>
        ))}
      </div>
      <footer className="flex h-[44px] items-center justify-between gap-[5px] border-t border-[var(--app-border)] px-[10px] text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">
        <span>共 {visibleItems.length} 条</span>
        <nav aria-label="任务列表分页" className="flex items-center gap-[3px]">
          <IconButton className="size-7 border border-[var(--app-border)]" disabled={currentPage <= 1} label="上一页" onClick={() => setPage((current) => Math.max(1, current - 1))}>
            <ChevronLeft aria-hidden="true" size={14} />
          </IconButton>
          <span className="min-w-[34px] text-center font-medium text-[var(--app-foreground)]">{currentPage} / {pageCount}</span>
          <IconButton className="size-7 border border-[var(--app-border)]" disabled={currentPage >= pageCount} label="下一页" onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>
            <ChevronRight aria-hidden="true" size={14} />
          </IconButton>
        </nav>
      </footer>
      {editingItemId === null ? null : (
        <form className="team-inbox-composer" onSubmit={submit}>
          <div className="team-inbox-composer__editing">
            <span>正在修改待执行需求</span>
            <button aria-label="取消修改" title="取消修改" type="button" onClick={onCancelEdit}>
              <X aria-hidden="true" size={13} />
            </button>
          </div>
          <div>
            <textarea
              aria-label="修改待执行需求"
              maxLength={50_000}
              placeholder="修改尚未自动分发的需求…"
              rows={2}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
            />
            <button
              aria-label="保存需求"
              disabled={draft.trim().length === 0}
              title="保存修改"
              type="submit"
            >
              <SendHorizontal aria-hidden="true" size={15} />
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function InboxMetric({
  icon,
  label,
  tone,
  value,
}: {
  icon: ReactElement;
  label: string;
  tone: "info" | "success" | "warning";
  value: number;
}): ReactElement {
  return (
    <div className="grid min-w-0 place-items-center gap-[5px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[4px] py-[9px]" data-metric-tone={tone}>
      <div className="flex items-center justify-center gap-[6px]">
        <span className={metricIconClass(tone)}>{icon}</span>
        <strong className="text-[length:var(--app-font-size-subtitle)] leading-none text-[var(--app-foreground)]">{value}</strong>
      </div>
      <span className="overflow-hidden text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)] text-ellipsis whitespace-nowrap">{label}</span>
    </div>
  );
}

function metricIconClass(tone: "info" | "success" | "warning"): string {
  if (tone === "warning") return "text-[var(--app-status-warning-fg)]";
  if (tone === "success") return "text-[var(--app-status-success-fg)]";
  return "text-[var(--app-status-info-fg)]";
}

function WorkItemStatusIcon({ status }: { status: TeamWorkItemStatus }): ReactElement {
  if (status === "blocked") return <CircleAlert aria-hidden="true" size={14} />;
  if (status === "completed") return <CheckCircle2 aria-hidden="true" size={14} />;
  if (status === "executing" || status === "reworking" || status === "reviewing") {
    return <Clock3 aria-hidden="true" size={14} />;
  }
  if (status === "awaiting_acceptance" || status === "finalizing") {
    return <CircleDotDashed aria-hidden="true" size={14} />;
  }
  return <ClipboardList aria-hidden="true" size={14} />;
}

function workItemIconClass(status: TeamWorkItemStatus): string {
  const base = "grid h-[28px] w-[28px] place-items-center rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)]";
  if (status === "completed") return `${base} text-[var(--app-status-success-fg)]`;
  if (status === "executing" || status === "reworking" || status === "reviewing") {
    return `${base} text-[var(--app-status-warning-fg)]`;
  }
  if (status === "blocked") return `${base} text-[var(--app-status-danger-fg)]`;
  return `${base} text-[var(--app-status-info-fg)]`;
}

function statusBadgeTone(status: TeamWorkItemStatus): "danger" | "info" | "success" | "warning" {
  if (status === "completed") return "success";
  if (status === "executing" || status === "reworking" || status === "reviewing" || status === "finalizing") {
    return "warning";
  }
  if (status === "blocked") return "danger";
  return "info";
}

function priorityLabel(priority: TeamWorkItemPrototype["priority"]): "P1" | "P2" | "P3" {
  if (priority === "high") return "P1";
  if (priority === "normal") return "P2";
  return "P3";
}

function PanelHeading({ id, label, meta }: { id: string; label: string; meta: string }): ReactElement {
  return (
    <header className="team-command-panel__heading">
      <h2 id={id}>{label}</h2>
      <span>{meta}</span>
    </header>
  );
}
