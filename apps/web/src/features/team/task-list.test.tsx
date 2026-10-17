// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { TaskListLauncher, TaskListWorkspace } from "./task-context-directory.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
let root: Root | null = null;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); useWorkbenchUiStore.setState({ taskListViewRequest: null }); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); });
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const mount = () => { const node = document.createElement("div"); document.body.append(node); root = createRoot(node); return node; };
it("loads the header dropdown on demand, searches, paginates, and opens a task in the existing workspace", async () => {
  const client = new MockAgentClient(); const owner = await client.createConversation({});
  for (let i = 0; i < 7; i++) await client.updateTaskContext({ conversationId: owner.id, title: `验收任务 ${i}`, goal: "验收", requestId: crypto.randomUUID() });
  const read = vi.spyOn(client, "listTaskContexts"); const node = mount();
  await act(async () => { root?.render(<TooltipProvider><TaskListLauncher agentClient={client} scope={{ conversationId: owner.id }} workspaceId={owner.id} /></TooltipProvider>); await flush(); });
  expect(read).not.toHaveBeenCalled();
  await act(async () => { node.querySelector<HTMLButtonElement>('[aria-label="查看任务列表"]')!.click(); await flush(); });
  expect(document.querySelectorAll('[aria-label="任务"] li')).toHaveLength(5);
  expect(document.body.textContent).toContain("共 7 项");
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="下一页任务"]')!.click(); await flush(); });
  expect(document.querySelectorAll('[aria-label="任务"] li')).toHaveLength(2);
  expect(document.body.textContent).toContain("2 / 2");
  const search = document.querySelector<HTMLInputElement>('[aria-label="搜索任务或用户消息"]')!;
  act(() => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(search, "验收任务 2"); search.dispatchEvent(new Event("input", { bubbles: true })); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 240)); await flush(); });
  expect(document.querySelectorAll('[aria-label="任务"] li')).toHaveLength(1);
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="任务"] button')!.click(); await flush(); });
  expect(useWorkbenchUiStore.getState().taskListViewRequest).toMatchObject({ workspaceId: owner.id, scope: { conversationId: owner.id } });
  expect(document.querySelector('[aria-label="搜索任务或用户消息"]')).toBeNull();
});
it("shows original user messages by conversation, excludes Agent work logs, and lets the user confirm completion", async () => {
  const client = new MockAgentClient(); const owner = await client.createConversation({});
  const task = await client.updateTaskContext({ conversationId: owner.id, title: "跨对话来源", goal: "保留用户原消息", summary: "已实现关联", requestId: crypto.randomUUID() });
  const original = client.getTaskContext.bind(client); const messageId = crypto.randomUUID(); const createdAt = new Date().toISOString();
  vi.spyOn(client, "getTaskContext").mockImplementation(async input => ({ ...await original(input), sources: [
    { kind: "conversation", containerId: owner.id, messageId, runId: null, purpose: "request", available: true, sequence: 1, title: "需求讨论", content: "跨对话关联时要保留这条用户原话。", role: "user", createdAt },
    { kind: "conversation", containerId: owner.id, messageId: crypto.randomUUID(), runId: null, purpose: "progress", available: true, sequence: 2, title: "需求讨论", content: "不应出现在用户消息列表里的 Agent 日志", role: "assistant", createdAt },
  ] }));
  const open = vi.fn(); const node = mount();
  await act(async () => { root?.render(<TooltipProvider><TaskListWorkspace agentClient={client} scope={{ conversationId: owner.id }} requestedTaskId={task.id} onOpenConversation={open} /></TooltipProvider>); await flush(); });
  expect(node.textContent).toContain("跨对话关联时要保留这条用户原话。"); expect(node.textContent).not.toContain("Agent 日志");
  expect(node.querySelector<HTMLInputElement>('[role="switch"]')!.checked).toBe(false);
  await act(async () => { [...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "确认完成")!.click(); await flush(); });
  expect((await client.getTaskContext({ id: task.id })).task).toMatchObject({ status: "completed", completedBy: "user" });
  await act(async () => { node.querySelector<HTMLInputElement>('[role="switch"]')!.click(); await flush(); });
  expect(await client.getTaskCompletionPolicy({ conversationId: owner.id })).toEqual({ allowAgentCompletion: true });
  await act(async () => { [...node.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent?.includes("定位原消息"))!.click(); await flush(); });
  expect(open).toHaveBeenCalledWith(expect.objectContaining({ id: owner.id }), messageId);
  expect(node.textContent).not.toContain(task.id); expect(node.textContent).not.toContain(messageId);
});

it("refreshes new group tasks, defers hidden changes, and reuses a clean cached page", async () => {
  const client = new MockAgentClient(); const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  const read = vi.spyOn(client, "listTaskContexts"); const node = mount();
  const show = async (active: boolean) => { await act(async () => { root?.render(<TooltipProvider><TaskListWorkspace agentClient={client} scope={{ teamInstanceId: instance.id }} active={active} onOpenConversation={() => {}} /></TooltipProvider>); await flush(); }); };
  await show(true); expect(node.textContent).toContain("暂无任务");
  let task: Awaited<ReturnType<typeof client.updateTaskContext>>;
  await act(async () => { task = await client.updateTaskContext({ conversationId: instance.rootConversationId!, title: "新建的群任务", goal: "及时刷新", requestId: crypto.randomUUID() }); });
  await act(async () => { await new Promise(resolve => setTimeout(resolve, 240)); await flush(); });
  expect(node.textContent).toContain("新建的群任务");
  await show(false); const reads = read.mock.calls.length;
  await act(async () => { await client.updateTaskContext({ conversationId: task!.ownerConversationId, id: task!.id, expectedRevision: task!.revision, title: "后台已更新的任务", goal: task!.goal, requestId: crypto.randomUUID() }); await flush(); });
  expect(read).toHaveBeenCalledTimes(reads);
  await show(true); expect(node.textContent).toContain("后台已更新的任务");
  const refreshed = read.mock.calls.length; await show(false); await show(true); expect(read).toHaveBeenCalledTimes(refreshed);
});

it("keeps a change dirty when an older list response arrives before the pane is hidden", async () => {
  const client = new MockAgentClient(); const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  let finish: (page: Awaited<ReturnType<typeof client.listTaskContexts>>) => void = () => {};
  vi.spyOn(client, "listTaskContexts").mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  const node = mount();
  const show = async (active: boolean) => { await act(async () => { root?.render(<TooltipProvider><TaskListWorkspace agentClient={client} scope={{ teamInstanceId: instance.id }} active={active} onOpenConversation={() => {}} /></TooltipProvider>); await flush(); }); };
  await show(true);
  await act(async () => { await client.updateTaskContext({ conversationId: instance.rootConversationId!, title: "请求期间新增的任务", goal: "不能丢失脏标记", requestId: crypto.randomUUID() }); finish({ items: [], nextBeforeId: null, unclassified: [], total: 0 }); await flush(); });
  await show(false); await show(true);
  expect(node.textContent).toContain("请求期间新增的任务");
});
