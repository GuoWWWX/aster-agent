// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";
import { TeamWorkItemBoard } from "./team-work-item-board.js";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("TeamWorkItemBoard view", () => {
  it("promotes the project into a dedicated card badge", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(<TooltipProvider><TeamWorkItemBoard items={[WORK_ITEM]} onOpen={vi.fn()} /></TooltipProvider>));

    const project = container.querySelector('[data-work-item-project="true"]');
    expect(project?.textContent).toBe("演示项目");
    expect(project?.getAttribute("title")).toBe("演示项目");
    expect(container.textContent).toContain("来自对话");
    expect(container.textContent).not.toContain("演示项目 · 来自对话");
  });

  it("searches tasks and paginates each status column independently", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const items = Array.from({ length: 7 }, (_, index) => ({
      ...WORK_ITEM,
      id: `work-item-${index + 1}`,
      title: index === 6 ? "第七个独立任务" : `验收任务 ${index + 1}`,
    }));

    act(() => root?.render(<TooltipProvider><TeamWorkItemBoard items={items} onOpen={vi.fn()} /></TooltipProvider>));

    expect(container.querySelectorAll(".team-workitem-board__card")).toHaveLength(6);
    expect(container.textContent).toContain("本页 6 条");
    expect(container.textContent).toContain("第 1/2 页");
    const nextPage = container.querySelector<HTMLButtonElement>('button[aria-label="待验收下一页"]');
    act(() => nextPage?.click());
    expect(container.textContent).toContain("第七个独立任务");
    expect(container.textContent).toContain("本页 1 条");
    expect(container.textContent).toContain("第 2/2 页");

    const search = container.querySelector<HTMLInputElement>('input[aria-label="搜索看板任务"]');
    act(() => {
      if (search === null) return;
      setNativeInputValue(search, "第七个");
      search.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    expect(container.querySelectorAll(".team-workitem-board__card")).toHaveLength(1);
    expect(container.textContent).toContain("1/7 个任务");
  });

  it("shows card management and board filter controls", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <TooltipProvider><TeamWorkItemBoard
        items={[WORK_ITEM]}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onEdit={vi.fn()}
        onOpen={vi.fn()}
      /></TooltipProvider>,
    ));

    expect(container.querySelector('button[aria-label^="管理任务"]')).not.toBeNull();
    expect(container.querySelector('button[aria-label="按优先级过滤看板任务"]')).not.toBeNull();
    const sortButton = container.querySelector<HTMLButtonElement>('button[aria-label="排序看板任务：更新时间降序"]');
    expect(sortButton).not.toBeNull();
    expect(sortButton?.textContent).toBe("");
    act(() => sortButton?.click());
    expect(document.body.textContent).toContain("创建时间降序");
    expect(document.body.textContent).toContain("更新时间升序");
    expect(document.body.textContent).not.toContain("新 → 旧");
    expect(document.body.textContent).not.toContain("高 → 低");
    const pageSizeControls = container.querySelectorAll('button[aria-label$="每页显示条数"]');
    expect(pageSizeControls).toHaveLength(4);
    expect([...pageSizeControls].every((control) => control.textContent?.includes("6 条/页"))).toBe(true);
  });

  it("sorts by created time, updated time, and priority in both directions", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const items = [
      { ...WORK_ITEM, createdAt: new Date(2026, 7, 28, 10).toISOString(), id: "high-old", priority: "high" as const, title: "高优先级较早任务", updatedAt: new Date(2026, 7, 30, 10).toISOString() },
      { ...WORK_ITEM, createdAt: new Date(2026, 7, 29, 10).toISOString(), id: "low-middle", priority: "low" as const, title: "低优先级中间任务", updatedAt: new Date(2026, 7, 28, 10).toISOString() },
      { ...WORK_ITEM, createdAt: new Date(2026, 7, 30, 10).toISOString(), id: "normal-new", priority: "normal" as const, title: "普通优先级最新任务", updatedAt: new Date(2026, 7, 29, 10).toISOString() },
    ];

    act(() => root?.render(<TooltipProvider><TeamWorkItemBoard items={items} onOpen={vi.fn()} /></TooltipProvider>));

    expect(renderedCardTitles(container)).toEqual([
      "高优先级较早任务",
      "普通优先级最新任务",
      "低优先级中间任务",
    ]);

    chooseBoardSort(container, "更新时间升序");
    expect(renderedCardTitles(container)).toEqual([
      "低优先级中间任务",
      "普通优先级最新任务",
      "高优先级较早任务",
    ]);

    chooseBoardSort(container, "创建时间降序");
    expect(renderedCardTitles(container)).toEqual([
      "普通优先级最新任务",
      "低优先级中间任务",
      "高优先级较早任务",
    ]);

    chooseBoardSort(container, "创建时间升序");
    expect(renderedCardTitles(container)).toEqual([
      "高优先级较早任务",
      "低优先级中间任务",
      "普通优先级最新任务",
    ]);

    chooseBoardSort(container, "优先级降序");
    expect(renderedCardTitles(container)).toEqual([
      "高优先级较早任务",
      "普通优先级最新任务",
      "低优先级中间任务",
    ]);

    chooseBoardSort(container, "优先级升序");
    expect(renderedCardTitles(container)).toEqual([
      "低优先级中间任务",
      "普通优先级最新任务",
      "高优先级较早任务",
    ]);
  });
});

function chooseBoardSort(container: HTMLElement, label: string): void {
  const trigger = container.querySelector<HTMLButtonElement>('button[aria-label^="排序看板任务："]');
  act(() => trigger?.click());
  const option = [...document.body.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]')]
    .find((candidate) => candidate.textContent?.includes(label));
  expect(option).not.toBeUndefined();
  act(() => option?.click());
}

function renderedCardTitles(container: HTMLElement): string[] {
  return [...container.querySelectorAll<HTMLElement>(".team-workitem-board__card-title strong")]
    .map((title) => title.textContent ?? "");
}

function setNativeInputValue(input: HTMLInputElement, value: string): void {
  // React tracks the instance setter, so the test must invoke the native setter with the input as its receiver.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set as
    | ((this: HTMLInputElement, value: string) => void)
    | undefined;
  setter?.call(input, value);
}

const WORK_ITEM: TeamWorkItemPrototype = {
  acceptance: [],
  acceptedCriteria: [],
  acceptanceRound: 1,
  createdAt: new Date(2026, 7, 30, 10).toISOString(),
  delivery: null,
  events: [],
  finalizationAction: null,
  id: "work-item-project-badge",
  nextAction: "等待用户验收或提交返工要求。",
  plan: "执行并验证",
  priority: "normal",
  project: "演示项目",
  projectId: "00000000-0000-4000-8000-000000000001",
  reworkRequest: null,
  source: "conversation",
  status: "awaiting_acceptance",
  tasks: [],
  title: "验证项目归属展示",
  updatedAt: new Date(2026, 7, 30, 10).toISOString(),
};
