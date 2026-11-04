// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";
import { WorkItemInbox } from "./team-work-item-inbox.js";
import { formatTeamWorkItemTime } from "./team-work-item-time.js";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
});

describe("WorkItemInbox", () => {
  it("paginates the filtered task list ten items at a time", () => {
    const onFilterChange = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <TooltipProvider>
        <WorkItemInbox
          acceptanceCount={0}
          completedCount={0}
          draft=""
          editingItemId={null}
          filter="all"
          items={Array.from({ length: 12 }, (_, index) => workItem(index + 1))}
          processingCount={12}
          queuedCount={0}
          selectedId={null}
          onCancelEdit={vi.fn()}
          onDraftChange={vi.fn()}
          onEdit={vi.fn()}
          onFilterChange={onFilterChange}
          onSaveEdit={vi.fn()}
          onSelect={vi.fn()}
        />
      </TooltipProvider>,
    ));

    expect(container.textContent).toContain("1 / 2");
    expect(container.querySelector('[aria-label="按任务来源筛选"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="按优先级筛选"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="排序团队任务：更新时间降序"]')).not.toBeNull();
    const filters = [...container.querySelectorAll<HTMLButtonElement>('[aria-label="任务筛选"] [role="tab"]')];
    expect(filters.map((filterButton) => filterButton.textContent)).toEqual([
      "12全部",
      "0待执行",
      "12处理中",
      "0待验收",
      "0已完成",
    ]);
    expect(filters[0]?.getAttribute("aria-selected")).toBe("true");
    expect([...container.querySelectorAll('[data-metric-tone]')].map((metric) => metric.getAttribute("data-metric-tone"))).toEqual([
      "info",
      "info",
      "warning",
      "success",
      "success",
    ]);
    act(() => filters[2]?.click());
    expect(onFilterChange).toHaveBeenCalledWith("processing");
    expect(container.querySelector('[data-slot="badge"]')?.getAttribute("data-tone")).toBe("warning");
    expect(container.querySelector('[data-slot="badge"]')?.className).not.toContain("dark:");
    const project = container.querySelector('[data-work-item-project="true"]');
    expect(project?.textContent).toBe("Demo");
    expect(project?.getAttribute("title")).toBe("Demo");
    expect(project?.parentElement?.textContent).toBe("Demo来自对话");
    expect(renderedTitles(container)).toContain("任务 12");
    expect(renderedTitles(container)).not.toContain("任务 2");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="上一页"]')?.disabled).toBe(true);

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.click());

    expect(container.textContent).toContain("2 / 2");
    expect(renderedTitles(container)).toContain("任务 2");
    expect(renderedTitles(container)).not.toContain("任务 12");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.disabled).toBe(true);
  });

  it("shows status, priority, and formatted time on one metadata row", () => {
    const now = new Date(2026, 7, 31, 10, 45);
    expect(formatTeamWorkItemTime(new Date(2026, 7, 31, 8, 6).toISOString(), now)).toBe("08:06");
    expect(formatTeamWorkItemTime(new Date(2026, 7, 30, 18, 40).toISOString(), now)).toBe("昨天 18:40");
    expect(formatTeamWorkItemTime(new Date(2026, 7, 28, 9, 5).toISOString(), now)).toBe("08-28 09:05");
    expect(formatTeamWorkItemTime(new Date(2025, 11, 31, 23, 59).toISOString(), now)).toBe("2025-12-31 23:59");

    vi.useFakeTimers();
    vi.setSystemTime(now);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <TooltipProvider>
        <WorkItemInbox
          acceptanceCount={0}
          completedCount={0}
          draft=""
          editingItemId={null}
          filter="all"
          items={[workItem(1, new Date(2026, 7, 30, 18, 40).toISOString())]}
          processingCount={1}
          queuedCount={0}
          selectedId={null}
          onCancelEdit={vi.fn()}
          onDraftChange={vi.fn()}
          onEdit={vi.fn()}
          onFilterChange={vi.fn()}
          onSaveEdit={vi.fn()}
          onSelect={vi.fn()}
        />
      </TooltipProvider>,
    ));

    const metadata = container.querySelector('[data-work-item-meta="true"]');
    expect(Array.from(metadata?.children ?? []).map((element) => element.textContent)).toEqual([
      "执行中",
      "P2",
      "昨天 18:40",
    ]);
  });

  it("uses the same created, updated, and priority sorting as the board", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const items = [
      { ...workItem(1, "2026-08-28T10:00:00.000Z"), priority: "high" as const, title: "较早创建最近更新", updatedAt: "2026-08-30T10:00:00.000Z" },
      { ...workItem(2, "2026-08-29T10:00:00.000Z"), priority: "low" as const, title: "中间创建最早更新", updatedAt: "2026-08-28T10:00:00.000Z" },
      { ...workItem(3, "2026-08-30T10:00:00.000Z"), priority: "normal" as const, title: "最近创建中间更新", updatedAt: "2026-08-29T10:00:00.000Z" },
    ];

    act(() => root?.render(
      <TooltipProvider>
        <WorkItemInbox
          acceptanceCount={0}
          completedCount={0}
          draft=""
          editingItemId={null}
          filter="all"
          items={items}
          processingCount={3}
          queuedCount={0}
          selectedId={null}
          onCancelEdit={vi.fn()}
          onDraftChange={vi.fn()}
          onEdit={vi.fn()}
          onFilterChange={vi.fn()}
          onSaveEdit={vi.fn()}
          onSelect={vi.fn()}
        />
      </TooltipProvider>,
    ));

    expect(renderedTitles(container)).toEqual([
      "较早创建最近更新",
      "最近创建中间更新",
      "中间创建最早更新",
    ]);

    chooseSort(container, "创建时间升序");
    expect(renderedTitles(container)).toEqual([
      "较早创建最近更新",
      "中间创建最早更新",
      "最近创建中间更新",
    ]);

    chooseSort(container, "优先级升序");
    expect(renderedTitles(container)).toEqual([
      "中间创建最早更新",
      "最近创建中间更新",
      "较早创建最近更新",
    ]);
  });
});

function chooseSort(container: HTMLElement, label: string): void {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="排序团队任务："]');
  act(() => trigger?.click());
  const option = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    .find((candidate) => candidate.textContent?.includes(label));
  expect(option).not.toBeUndefined();
  act(() => option?.click());
}

function renderedTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>('[role="option"] strong')]
    .map((element) => element.textContent ?? "");
}

function workItem(index: number, createdAt = new Date(2026, 7, index, 10).toISOString()): TeamWorkItemPrototype {
  return {
    acceptance: [],
    acceptedCriteria: [],
    acceptanceRound: 1,
    createdAt,
    delivery: null,
    events: [],
    finalizationAction: null,
    id: `work-item-${index}`,
    nextAction: "继续执行",
    plan: "执行并验证",
    priority: "normal",
    project: "Demo",
    projectId: "00000000-0000-4000-8000-000000000001",
    reworkRequest: null,
    source: "conversation",
    status: "executing",
    tasks: [],
    title: `任务 ${index}`,
    updatedAt: createdAt,
  };
}
