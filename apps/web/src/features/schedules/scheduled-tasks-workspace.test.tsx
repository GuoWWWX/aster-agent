// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MockAgentClient } from "../../runtime/index.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ScheduledTasksWorkspace } from "./scheduled-tasks-workspace.js";
let root: Root;
let container: HTMLDivElement;
let client: MockAgentClient;
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  client = new MockAgentClient();
  await act(async () => { root.render(<TooltipProvider><ScheduledTasksWorkspace agentClient={client} projects={[]} onOpenConversation={vi.fn()} /></TooltipProvider>); await Promise.resolve(); });
});
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks(); });
const button = (label: string): HTMLButtonElement => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.getAttribute("aria-label") === label || item.textContent?.trim() === label);
  if (!found) throw new Error(`Missing button ${label}`); return found;
};
describe("scheduled task workspace", () => {
  it("creates from a template, edits and pauses without losing the selected task", async () => {
    await act(async () => { button("每日项目巡检检查项目近期变更、测试状态和待处理问题，汇总需要关注的事项。").click(); await Promise.resolve(); });
    await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(await client.listScheduledTasks()).toMatchObject([{ name: "每日项目巡检", enabled: true }]);
    expect(button("立即执行").disabled).toBe(true);
    await act(async () => { button("暂停计划").click(); await Promise.resolve(); });
    expect(await client.listScheduledTasks()).toMatchObject([{ enabled: false }]);
    await act(async () => { button("编辑").click(); await Promise.resolve(); });
    expect(container.querySelector<HTMLInputElement>("form input")?.value).toBe("每日项目巡检");
    expect(container.textContent).toContain("编辑定时任务");
  });
  it("requires confirmation before removing a task", async () => {
    await act(async () => { button("每日项目巡检检查项目近期变更、测试状态和待处理问题，汇总需要关注的事项。").click(); container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    // Creation commits in the next render, then the form can be submitted.
    if (container.querySelector("form")) await act(async () => { container.querySelector("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await Promise.resolve(); });
    await act(async () => { button("删除定时任务 每日项目巡检").click(); await Promise.resolve(); });
    expect(await client.listScheduledTasks()).toHaveLength(1);
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("已生成的结果对话会保留");
    await act(async () => { button("取消").click(); await Promise.resolve(); });
    expect(await client.listScheduledTasks()).toHaveLength(1);
    await act(async () => { button("删除定时任务 每日项目巡检").click(); await Promise.resolve(); });
    await act(async () => { button("删除").click(); await Promise.resolve(); });
    expect(await client.listScheduledTasks()).toEqual([]);
    expect(container.textContent).toContain("安排任务");
  });
});
