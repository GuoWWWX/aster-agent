import {
  ArrowDownUp,
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarArrowDown,
  CalendarArrowUp,
  Check,
} from "lucide-react";
import { useState, type ReactElement } from "react";

import { IconButton } from "../../components/ui/icon-button.js";
import { Popover, PopoverContent, PopoverTrigger } from "../../components/ui/popover.js";
import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";

export type TeamWorkItemSort =
  | "created-ascending"
  | "created-descending"
  | "priority-ascending"
  | "priority-descending"
  | "updated-ascending"
  | "updated-descending";

export const DEFAULT_TEAM_WORK_ITEM_SORT: TeamWorkItemSort = "updated-descending";

const TEAM_WORK_ITEM_SORT_OPTIONS = [
  { icon: CalendarArrowDown, label: "更新时间降序", value: "updated-descending" },
  { icon: CalendarArrowUp, label: "更新时间升序", value: "updated-ascending" },
  { icon: CalendarArrowDown, label: "创建时间降序", value: "created-descending" },
  { icon: CalendarArrowUp, label: "创建时间升序", value: "created-ascending" },
  { icon: ArrowDownWideNarrow, label: "优先级降序", value: "priority-descending" },
  { icon: ArrowUpNarrowWide, label: "优先级升序", value: "priority-ascending" },
] satisfies readonly { icon: typeof CalendarArrowDown; label: string; value: TeamWorkItemSort }[];

export function TeamWorkItemSortButton({
  ariaLabel,
  onChange,
  value,
}: {
  ariaLabel: string;
  onChange: (sort: TeamWorkItemSort) => void;
  value: TeamWorkItemSort;
}): ReactElement {
  const [open, setOpen] = useState(false);
  const activeLabel = TEAM_WORK_ITEM_SORT_OPTIONS.find((option) => option.value === value)?.label
    ?? "更新时间降序";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <IconButton
          className="size-[30px] border border-[var(--app-border)] bg-[var(--app-panel)]"
          label={`${ariaLabel}：${activeLabel}`}
        >
          <ArrowDownUp aria-hidden="true" size={14} />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="w-[190px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] p-[4px] shadow-lg"
        side="bottom"
        sideOffset={4}
      >
        <p className="px-[8px] py-[5px] text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">排序方式</p>
        <div className="grid gap-[2px]" role="menu">
          {TEAM_WORK_ITEM_SORT_OPTIONS.map((option) => {
            const OptionIcon = option.icon;
            return (
              <button
                key={option.value}
                aria-checked={option.value === value}
                className="flex h-[30px] items-center justify-between gap-[8px] rounded-[var(--app-radius-small)] px-[8px] text-left text-[length:var(--app-font-size-control)] text-[var(--app-foreground)] hover:bg-[var(--app-hover)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--app-focus-ring)]"
                role="menuitemradio"
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
              >
                <span className="flex min-w-0 items-center gap-[7px]">
                  <OptionIcon aria-hidden="true" className="shrink-0 text-[var(--app-muted-foreground)]" size={14} />
                  <span>{option.label}</span>
                </span>
                {option.value === value ? <Check aria-hidden="true" className="shrink-0" size={14} /> : null}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function compareTeamWorkItems(
  left: TeamWorkItemPrototype,
  right: TeamWorkItemPrototype,
  sort: TeamWorkItemSort,
): number {
  if (sort === "priority-ascending" || sort === "priority-descending") {
    const rank = { high: 0, normal: 1, low: 2 } as const;
    const priorityOrder = rank[left.priority] - rank[right.priority];
    return (sort === "priority-descending" ? priorityOrder : -priorityOrder)
      || compareTimestamp(right.updatedAt, left.updatedAt);
  }
  const timeField = sort.startsWith("created") ? "createdAt" : "updatedAt";
  return sort.endsWith("ascending")
    ? compareTimestamp(left[timeField], right[timeField])
    : compareTimestamp(right[timeField], left[timeField]);
}

function compareTimestamp(left: string, right: string): number {
  const leftTime = Date.parse(left);
  const rightTime = Date.parse(right);
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return 0;
  return leftTime - rightTime;
}
