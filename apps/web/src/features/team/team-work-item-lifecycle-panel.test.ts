// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../components/ui/tooltip.js";
import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";
import {
  compactDeliverySummary,
  deliveryResultItems,
  WorkItemLifecyclePanel,
} from "./team-work-item-lifecycle-panel.js";

describe("compactDeliverySummary", () => {
  it("keeps short summaries intact after normalizing whitespace", () => {
    expect(compactDeliverySummary("  已完成\n并通过验证  ")).toBe("已完成 并通过验证");
  });

  it("keeps a long delivery compact until the user expands it", () => {
    expect(compactDeliverySummary("a".repeat(300))).toHaveLength(161);
    expect(compactDeliverySummary("a".repeat(300)).endsWith("…")).toBe(true);
  });

  it("turns a Team Lead markdown result into concise delivery list items", () => {
    expect(deliveryResultItems({
      changedFiles: 0,
      commits: 0,
      summary: "已完成团队协作。\n\n**验收条件逐项对应：**\n1. ✅ 两位 Worker 均已回复。\n2. ✅ Team Lead 已汇总最终结果。",
      tests: [],
    })).toEqual([
      "已完成团队协作。",
      "两位 Worker 均已回复。",
      "Team Lead 已汇总最终结果。",
    ]);
  });

  it("matches the acceptance prototype structure", () => {
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const item: TeamWorkItemPrototype = {
      acceptance: [
        "Team Lead 创建了名为“问候员甲”和“问候员乙”的两位 Worker，并等待两位成员完整回复",
        "功能验证通过",
        "代码规范合规",
        "文档更新完整",
      ],
      acceptedCriteria: [],
      acceptanceRound: 2,
      createdAt: "10:25",
      delivery: {
        changedFiles: 12,
        commits: 6,
        summary: "新增导出格式支持并优化大数据量导出性能。",
        tests: ["单元测试通过"],
      },
      events: [],
      finalizationAction: null,
      id: "acceptance-item",
      nextAction: "等待用户验收",
      plan: "实现并验证",
      priority: "normal",
      project: "Demo",
      projectId: "00000000-0000-4000-8000-000000000001",
      reworkRequest: null,
      source: "conversation",
      status: "awaiting_acceptance",
      tasks: [],
      title: "验收任务",
      updatedAt: "10:25",
    };

    const onApprove = vi.fn();
    const onRequestRework = vi.fn();
    act(() => root.render(createElement(
      TooltipProvider,
      null,
      createElement(WorkItemLifecyclePanel, {
        item,
        onApprove,
        onClaim: vi.fn(),
        onFinishFinalization: vi.fn(),
        onRequestRework,
      }),
    )));

    expect(container.textContent).toContain("交付已完成，等待验收");
    expect(container.textContent).toContain("完成于 10:25");
    expect(container.querySelector(".team-lifecycle-panel__header")?.textContent)
      .toContain("交付已完成，等待验收");
    expect(container.querySelector('.team-lifecycle-panel__header [data-tone="success"]'))
      .not.toBeNull();
    expect(container.querySelector(".team-acceptance-banner")).toBeNull();
    expect(container.textContent).toContain("完成说明");
    expect(container.textContent).toContain("由 Team Lead 汇总");
    expect(container.textContent).toContain("完成内容与功能");
    expect(container.textContent).not.toContain("变更文件12 个");
    expect(container.textContent).not.toContain("提交记录6 次");
    expect(container.textContent).toContain("用于核对完成说明，无需逐项勾选。");
    expect(container.textContent).toContain("原始验收要求");
    expect(container.textContent).toContain("Team Lead 创建了名为“问候员甲”和“问候员乙”的两位 Worker，并等待两位成员完整回复");
    expect(container.querySelectorAll('[data-completion-report="true"] li')).toHaveLength(2);
    expect(container.querySelectorAll('[data-original-acceptance="true"] li')).toHaveLength(4);
    expect(container.querySelectorAll('[data-original-acceptance="true"] input')).toHaveLength(0);
    expect(container.querySelector<HTMLTextAreaElement>('#team-rework-request')?.maxLength).toBe(500);
    expect(container.querySelector('[aria-label="展开返工输入框"]')).not.toBeNull();
    const approvalButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("验收通过并完成任务"));
    const reworkButton = [...container.querySelectorAll<HTMLButtonElement>("button")]
      .find((button) => button.textContent?.includes("发送返工要求"));
    expect(approvalButton?.disabled).toBe(false);
    expect(reworkButton?.disabled).toBe(true);
    expect(container.textContent).not.toContain("模型已完成，任务还没有结束");

    act(() => approvalButton?.click());
    expect(onApprove).toHaveBeenCalledWith("complete", item.acceptance);

    const textarea = container.querySelector<HTMLTextAreaElement>('#team-rework-request');
    act(() => {
      if (textarea === null) return;
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
        ?.call(textarea, "请补充失败场景测试");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(reworkButton?.disabled).toBe(false);
    act(() => reworkButton?.click());
    expect(onRequestRework).toHaveBeenCalledWith("请补充失败场景测试");

    act(() => root.unmount());
    container.remove();
  });
});
