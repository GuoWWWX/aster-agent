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
          onFilterChange={vi.fn()}
          onSaveEdit={vi.fn()}
          onSelect={vi.fn()}
        />
      </TooltipProvider>,
    ));

    expect(container.textContent).toContain("1 / 2");
    expect(container.querySelector('[aria-label="按任务来源筛选"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="按优先级筛选"]')).not.toBeNull();
    expect([...container.querySelectorAll('[data-metric-tone]')].map((metric) => metric.getAttribute("data-metric-tone"))).toEqual([
      "info",
      "warning",
      "success",
      "success",
    ]);
    expect(container.querySelector('[data-slot="badge"]')?.getAttribute("data-tone")).toBe("warning");
    expect(container.querySelector('[data-slot="badge"]')?.className).not.toContain("dark:");
    expect(renderedTitles(container)).toContain("任务 1");
    expect(renderedTitles(container)).not.toContain("任务 11");
    expect(container.querySelector<HTMLButtonElement>('[aria-label="上一页"]')?.disabled).toBe(true);

    act(() => container.querySelector<HTMLButtonElement>('[aria-label="下一页"]')?.click());

    expect(container.textContent).toContain("2 / 2");
    expect(renderedTitles(container)).toContain("任务 11");
    expect(renderedTitles(container)).not.toContain("任务 1");
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
});

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
    reworkRequest: null,
    source: "conversation",
    status: "executing",
    tasks: [],
    title: `任务 ${index}`,
  };
}
