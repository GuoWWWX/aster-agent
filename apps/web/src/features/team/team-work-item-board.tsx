import {
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDotDashed,
  Clock3,
  FolderKanban,
  MoreHorizontal,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import { useMemo, useState, type ReactElement } from "react";

import { IconButton } from "../../components/ui/icon-button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";
import type { TeamWorkItemPrototype, TeamWorkItemStatus } from "./team-runtime-prototype.js";
import {
  compareTeamWorkItems,
  DEFAULT_TEAM_WORK_ITEM_SORT,
  TeamWorkItemSortButton,
  type TeamWorkItemSort,
} from "./team-work-item-sort.js";
import { formatTeamWorkItemTime } from "./team-work-item-time.js";

type WorkItemBoardColumnId = "acceptance" | "completed" | "processing" | "queued";
type BoardPriorityFilter = "all" | TeamWorkItemPrototype["priority"];
type BoardPageSize = 6 | 12 | 24;

type WorkItemBoardColumn = {
  id: WorkItemBoardColumnId;
  label: string;
};

const BOARD_COLUMNS: readonly WorkItemBoardColumn[] = [
  { id: "queued", label: "待执行" },
  { id: "processing", label: "处理中" },
  { id: "acceptance", label: "待验收" },
  { id: "completed", label: "已完成" },
];
const DEFAULT_BOARD_PAGE_SIZE: BoardPageSize = 6;
const INITIAL_PAGES: Record<WorkItemBoardColumnId, number> = {
  acceptance: 1,
  completed: 1,
  processing: 1,
  queued: 1,
};
const INITIAL_PAGE_SIZES: Record<WorkItemBoardColumnId, BoardPageSize> = {
  acceptance: DEFAULT_BOARD_PAGE_SIZE,
  completed: DEFAULT_BOARD_PAGE_SIZE,
  processing: DEFAULT_BOARD_PAGE_SIZE,
  queued: DEFAULT_BOARD_PAGE_SIZE,
};

const STATUS_LABEL: Record<TeamWorkItemStatus, string> = {
  awaiting_acceptance: "待验收",
  blocked: "待处理",
  completed: "已完成",
  executing: "执行中",
  finalizing: "收尾中",
  planning: "规划中",
  queued: "待执行",
  reworking: "返工中",
  reviewing: "评审中",
};

export function TeamWorkItemBoard({
  items,
  onDelete,
  onEdit,
  onOpen,
}: {
  items: readonly TeamWorkItemPrototype[];
  onDelete?: (workItemId: string) => Promise<void>;
  onEdit?: (workItemId: string) => void;
  onOpen: (workItemId: string) => void;
}): ReactElement {
  const [query, setQuery] = useState("");
  const [priority, setPriority] = useState<BoardPriorityFilter>("all");
  const [sort, setSort] = useState<TeamWorkItemSort>(DEFAULT_TEAM_WORK_ITEM_SORT);
  const [pages, setPages] = useState(INITIAL_PAGES);
  const [pageSizes, setPageSizes] = useState(INITIAL_PAGE_SIZES);
  const [deleteTarget, setDeleteTarget] = useState<TeamWorkItemPrototype | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const visibleItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    return items
      .filter((item) => priority === "all" || item.priority === priority)
      .filter((item) => normalizedQuery.length === 0 || [
        item.title,
        item.project,
        item.nextAction,
      ].some((value) => value.toLocaleLowerCase().includes(normalizedQuery)))
      .toSorted((left, right) => compareTeamWorkItems(left, right, sort));
  }, [items, priority, query, sort]);

  const confirmDelete = async (): Promise<void> => {
    if (deleteTarget === null || onDelete === undefined || isDeleting) return;
    setIsDeleting(true);
    try {
      await onDelete(deleteTarget.id);
      setDeleteTarget(null);
    } catch {
      // Keep the confirmation open; the workspace reports the mutation error.
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="team-workitem-board" aria-label="需求状态看板">
      <header className="flex min-w-0 flex-wrap items-center gap-[5px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[8px] py-[5px]">
        <div className="mr-auto flex min-w-[150px] items-baseline gap-[5px]">
          <strong className="text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]">需求状态看板</strong>
          <span className="text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{visibleItems.length}/{items.length} 个任务</span>
        </div>
        <label className="flex h-[30px] w-[300px] max-w-full flex-none items-center gap-[5px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[8px] focus-within:border-[var(--app-focus-ring)]">
          <Search aria-hidden="true" className="shrink-0 text-[var(--app-muted-foreground)]" size={13} />
          <input
            aria-label="搜索看板任务"
            className="min-w-0 flex-1 bg-transparent text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] outline-none placeholder:text-[var(--app-muted-foreground)]"
            placeholder="搜索标题、项目或阶段说明"
            value={query}
            onChange={(event) => {
              setQuery(event.currentTarget.value);
              setPages(INITIAL_PAGES);
            }}
          />
        </label>
        <Select value={priority} onValueChange={(value) => {
          setPriority(value as BoardPriorityFilter);
          setPages(INITIAL_PAGES);
        }}>
          <SelectTrigger aria-label="按优先级过滤看板任务" className="h-[30px] w-[110px] bg-[var(--app-panel)] text-[length:var(--app-font-size-control)]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">全部</SelectItem>
            <SelectItem value="high">P1 · 高</SelectItem>
            <SelectItem value="normal">P2 · 普通</SelectItem>
            <SelectItem value="low">P3 · 低</SelectItem>
          </SelectContent>
        </Select>
        <TeamWorkItemSortButton
          ariaLabel="排序看板任务"
          value={sort}
          onChange={(value) => {
            setSort(value);
            setPages(INITIAL_PAGES);
          }}
        />
      </header>

      <div className="team-workitem-board__columns">
        {BOARD_COLUMNS.map((column) => {
          const columnItems = visibleItems.filter((item) => workItemBoardColumnForStatus(item.status) === column.id);
          const pageSize = pageSizes[column.id];
          const pageCount = Math.max(1, Math.ceil(columnItems.length / pageSize));
          const page = Math.min(pages[column.id], pageCount);
          const pageItems = columnItems.slice((page - 1) * pageSize, page * pageSize);
          return (
            <section key={column.id} className="team-workitem-board__column" data-column={column.id} aria-labelledby={`team-board-${column.id}`}>
              <header>
                <div>{column.id === "completed" ? <CheckCircle2 aria-hidden="true" size={13} /> : column.id === "queued" ? <Clock3 aria-hidden="true" size={13} /> : <CircleDotDashed aria-hidden="true" size={13} />}</div>
                <h3 id={`team-board-${column.id}`}>{column.label}</h3>
                <span>{columnItems.length}</span>
              </header>
              <div className="team-workitem-board__list">
                {pageItems.length === 0 ? (
                  <p>{query.trim().length > 0 || priority !== "all" ? "没有匹配任务" : "暂无需求"}</p>
                ) : pageItems.map((item) => (
                  <article key={item.id} className="team-workitem-board__card group relative">
                    <button className="team-workitem-board__card-main" type="button" onClick={() => onOpen(item.id)}>
                      <span className="team-workitem-board__card-title pr-[24px]">
                        <strong>{item.title}</strong>
                        <ChevronRight aria-hidden="true" size={13} />
                      </span>
                      <span className="flex min-w-0 items-center justify-between gap-[5px]">
                        <span
                          className="inline-flex min-w-0 max-w-[68%] items-center gap-[3px] rounded-[var(--app-radius-small)] bg-[var(--app-status-info-bg)] px-[5px] py-[2px] text-[var(--app-status-info-fg)]"
                          data-work-item-project="true"
                          title={item.project}
                        >
                          <FolderKanban aria-hidden="true" className="shrink-0" size={11} />
                          <span className="overflow-hidden text-ellipsis whitespace-nowrap">{item.project}</span>
                        </span>
                        <small data-status={item.status}>{STATUS_LABEL[item.status]}</small>
                      </span>
                      <p>{item.nextAction}</p>
                      <span className="flex min-w-0 items-center justify-between gap-[5px] text-[length:var(--app-font-size-caption)]">
                        <span>{item.source === "conversation" ? "来自对话" : "直接投递"}</span>
                        <time>{formatTeamWorkItemTime(item.createdAt)}</time>
                      </span>
                    </button>
                    {onDelete === undefined && onEdit === undefined ? null : (
                      <Popover>
                        <PopoverTrigger asChild>
                          <IconButton className="absolute right-[4px] top-[4px] z-10 size-[25px] bg-[var(--app-panel)] opacity-80 shadow-sm hover:opacity-100" label={`管理任务：${item.title}`}>
                            <MoreHorizontal aria-hidden="true" size={14} />
                          </IconButton>
                        </PopoverTrigger>
                        <PopoverContent align="end" className="grid w-[132px] gap-[3px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-[4px] shadow-lg" side="bottom" sideOffset={4}>
                          {onEdit === undefined ? null : (
                            <button className="flex h-[30px] items-center gap-[7px] rounded-[var(--app-radius-small)] px-[8px] text-left text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] hover:bg-[var(--app-hover)]" type="button" onClick={() => onEdit(item.id)}>
                              <Pencil aria-hidden="true" size={13} />修改任务
                            </button>
                          )}
                          {onDelete === undefined ? null : (
                            <button className="flex h-[30px] items-center gap-[7px] rounded-[var(--app-radius-small)] px-[8px] text-left text-[length:var(--app-font-size-control)] text-[var(--app-destructive)] hover:bg-[var(--app-status-danger-bg)]" type="button" onClick={() => setDeleteTarget(item)}>
                              <Trash2 aria-hidden="true" size={13} />删除任务
                            </button>
                          )}
                        </PopoverContent>
                      </Popover>
                    )}
                  </article>
                ))}
              </div>
              <footer className="flex h-[34px] items-center justify-between border-t border-[var(--app-border)] px-[6px] text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">
                <span>本页 {pageItems.length} 条</span>
                <span className="flex items-center gap-[3px]">
                  <Select value={String(pageSize)} onValueChange={(value) => {
                    setPageSizes((current) => ({
                      ...current,
                      [column.id]: Number(value) as BoardPageSize,
                    }));
                    setPages((current) => ({ ...current, [column.id]: 1 }));
                  }}>
                    <SelectTrigger aria-label={`${column.label}每页显示条数`} className="h-[24px] w-[82px] bg-[var(--app-panel)] text-[length:var(--app-font-size-caption)]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="w-[108px] min-w-[108px] max-w-[108px]">
                      <SelectItem className="whitespace-nowrap" value="6">
                        6 条/页
                      </SelectItem>
                      <SelectItem className="whitespace-nowrap" value="12">
                        12 条/页
                      </SelectItem>
                      <SelectItem className="whitespace-nowrap" value="24">
                        24 条/页
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="min-w-[48px] whitespace-nowrap text-center">第 {page}/{pageCount} 页</span>
                  <IconButton className="size-[24px]" disabled={page <= 1} label={`${column.label}上一页`} onClick={() => setPages((current) => ({ ...current, [column.id]: page - 1 }))}>
                    <ChevronLeft aria-hidden="true" size={13} />
                  </IconButton>
                  <IconButton className="size-[24px]" disabled={page >= pageCount} label={`${column.label}下一页`} onClick={() => setPages((current) => ({ ...current, [column.id]: page + 1 }))}>
                    <ChevronRight aria-hidden="true" size={13} />
                  </IconButton>
                </span>
              </footer>
            </section>
          );
        })}
      </div>

      <Dialog open={deleteTarget !== null} onOpenChange={(open) => open ? undefined : setDeleteTarget(null)}>
        <DialogContent className="border border-[var(--app-border)] p-0">
          <div className="grid gap-[12px] p-[16px]">
            <DialogHeader className="pr-[30px]">
              <DialogTitle>删除任务</DialogTitle>
              <DialogDescription>
                {deleteTarget?.status === "executing" || deleteTarget?.status === "reviewing"
                  ? "该任务正在执行。删除后会停止相关 Agent Run，并从看板移除；历史执行记录仍会保留。"
                  : "任务会从看板移除，已有执行和审计记录仍会保留。"}
              </DialogDescription>
            </DialogHeader>
            <p className="m-0 rounded-[var(--app-radius)] bg-[var(--app-panel-subtle)] px-[10px] py-[8px] text-[length:var(--app-font-size-body)] font-semibold text-[var(--app-foreground)]">{deleteTarget?.title}</p>
            <DialogFooter className="border-t border-[var(--app-border)] pt-[12px]">
              <button className="h-[32px] rounded-[var(--app-radius)] px-[10px] text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)]" type="button" onClick={() => setDeleteTarget(null)}>取消</button>
              <button className="inline-flex h-[32px] items-center gap-[5px] rounded-[var(--app-radius)] bg-[var(--app-destructive)] px-[12px] text-[length:var(--app-font-size-control)] font-semibold text-white hover:brightness-95 disabled:cursor-wait disabled:opacity-50" disabled={isDeleting} type="button" onClick={() => void confirmDelete()}>
                <Trash2 aria-hidden="true" size={14} />{isDeleting ? "删除中" : "确认删除"}
              </button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}

export function workItemBoardColumnForStatus(status: TeamWorkItemStatus): WorkItemBoardColumnId {
  if (status === "queued") return "queued";
  if (status === "awaiting_acceptance") return "acceptance";
  if (status === "completed") return "completed";
  return "processing";
}
