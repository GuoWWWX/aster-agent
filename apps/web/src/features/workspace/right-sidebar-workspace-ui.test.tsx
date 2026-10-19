// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RightSidebarWorkspace, RightSidebarEmptyState } from "./right-sidebar-workspace.js";

import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationRunEvent, type ConversationTimelineItem, type TeamInstanceView } from "@agent/protocol";
import { AppShell } from "../../components/layout/app-shell.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { useProjectTree } from "../projects/use-project-tree.js";
import { teamChatTabId } from "../chat/workbench-tabs.js";

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  useWorkbenchUiStore.setState({ activeActivity: "conversations", teamChatCoordinationTarget: null,
    filePanelOpenByConversationId: {}, filePanelWidthsByConversationId: {}, isProjectNavigatorOpen: false });
});

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});

describe("RightSidebarEmptyState", () => {
  it("does not pass the React click event to the browser opener", () => {
    const onOpenBrowser = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    act(() => root?.render(
      <RightSidebarEmptyState
        canOpenBrowser
        canOpenGitReview
        canOpenTerminal
        canCreateSideChat
        isCreatingChat={false}
        onCreateSideChat={vi.fn()}
        onOpenBrowser={onOpenBrowser}
        onOpenFiles={vi.fn()}
        onOpenGitReview={vi.fn()}
        onOpenTerminal={vi.fn()}
      />,
    ));

    const browserButton = container.querySelector<HTMLButtonElement>("button[aria-label='浏览器']");
    act(() => browserButton?.click());

    expect(onOpenBrowser).toHaveBeenCalledOnce();
    expect(onOpenBrowser).toHaveBeenCalledWith();
  });
});


async function coordinationFixture() {
  const client = new MockAgentClient();
  const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  const member = (await client.getTeamChatMembers({ teamInstanceId: instance.id })).find(candidate => !candidate.isLead)!;
  const message = await client.postTeamChat({ teamInstanceId: instance.id, content: "请安排验收", requestId: crypto.randomUUID(),
    recipientConversationIds: [member.conversationId], coordinator: { agentId: "default-agent", modelSelection: null } });
  const source = (await client.listConversationHierarchy()).find(session => session.id === instance.rootConversationId)!;
  const owner = { ...source, pinOrder: source.pinOrder ?? null };
  const coordinator = await client.getTeamChatCoordinationConversation({ teamInstanceId: instance.id, agentId: "default-agent" });
  const runId = crypto.randomUUID();
  const trace: ConversationTimelineItem[] = [
    { id: crypto.randomUUID(), kind: "message", role: "user", content: message.content, conversationId: coordinator.id, runId, attachments: [], modelId: null, createdAt: message.createdAt, status: "completed" },
    { id: crypto.randomUUID(), kind: "tool", name: "read_file", arguments: JSON.stringify({ path: "roster.txt" }), result: "完整的执行结果", conversationId: coordinator.id, runId, batchId: null, createdAt: message.createdAt, diff: null, status: "completed" },
    { id: crypto.randomUUID(), kind: "message", role: "assistant", content: "已结合资料选好了回答成员。", conversationId: coordinator.id, runId, attachments: [], modelId: "fixture", createdAt: message.createdAt, status: "completed" },
  ];
  const list = client.listConversationTimeline.bind(client);
  vi.spyOn(client, "listConversationTimeline").mockImplementation(input => input.conversationId === coordinator.id ? Promise.resolve(structuredClone(trace)) : list(input));
  const read = vi.spyOn(client, "listConversationTimelinePage");
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  function Harness({ group }: { group: TeamInstanceView | null }) {
    const tree = useProjectTree(client);
    return <TooltipProvider><AppShell activeConversationId={group === null ? owner.id : teamChatTabId(group.id)} agentClient={client}
      mainContent={<div>主对话</div>} projectNavigator={null} filePanel={<RightSidebarWorkspace
        activeProject={null} activeSession={owner} teamChat={group} agentClient={client} fileOpenRequest={null}
        teamMemberOpenRequest={null} onLocateProject={() => {}} onLocateSession={() => {}}
        onSessionViewed={() => {}} onSessionUpdated={() => {}} tree={tree} />} /></TooltipProvider>;
  }
  const show = async (group: TeamInstanceView | null = instance) => { await act(async () => {
    root?.render(<Harness group={group} />); for (let turn = 0; turn < 15; turn++) await Promise.resolve();
  }); };
  const open = async (group = instance) => { await act(async () => {
    useWorkbenchUiStore.getState().openTeamChatCoordination({ instanceId: group.id, agentId: "default-agent" });
    for (let turn = 0; turn < 15; turn++) await Promise.resolve();
  }); };
  return { client, instance, message, coordinator, owner, container, read, show, open };
}
function sidebarTab(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>('[role="tab"][title="默认 Agent · 后台协调"]')!;
}
it("opens coordination in the actual shared sidebar with the ordinary tab menu and closes without deleting its history", async () => {
  const f = await coordinationFixture();
  const send = vi.spyOn(f.client, "sendConversationMessage");
  const remove = vi.spyOn(f.client, "deleteConversation");
  await f.show(); await f.open();
  const panel = f.container.querySelector('.workbench-sidebar--right > .right-sidebar-workspace')!;
  expect(panel).not.toBeNull();
  expect(f.container.querySelectorAll('.right-sidebar-workspace')).toHaveLength(1);
  expect(panel.querySelectorAll('[role="tablist"]')).toHaveLength(1);
  expect(panel.querySelector('[aria-label="打开项目"]')).not.toBeNull();
  expect(panel.querySelector('[aria-label="刷新协调记录"]')).toBeNull();
  expect(panel.querySelector('.chat-message[data-role="user"]')?.textContent).toBe(f.message.content);
  expect(sidebarTab(f.container).getAttribute("aria-selected")).toBe("true");
  expect(panel.querySelector('[aria-label="输入任务"]')).not.toBeNull();
  expect(panel.querySelector('.conversation-workspace__composer')).not.toBeNull();
  const process = panel.querySelector<HTMLButtonElement>('[title="展开工作过程"]');
  if (process !== null) act(() => { process.click(); });
  expect(panel.textContent).toContain("已结合资料选好了回答成员。");
  expect(panel.querySelector('.tool-activity-row')).not.toBeNull();
  act(() => { panel.querySelector<HTMLButtonElement>('[aria-label="查看调用情况"]')!.click(); });
  const raw = document.querySelector('[aria-label="read_file 原始调用"]')!;
  expect(raw.textContent).toContain("roster.txt"); expect(raw.textContent).toContain("完整的执行结果");
  act(() => { document.querySelector<HTMLButtonElement>('[aria-label="关闭原始调用"]')!.click(); });
  act(() => { sidebarTab(f.container).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true })); });
  const menu = document.querySelector('[role="menu"]')!;
  expect(menu.textContent).toContain("关闭其他"); expect(menu.textContent).toContain("关闭全部");
  await act(async () => { [...menu.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "关闭全部")!.click(); await Promise.resolve(); });
  expect(f.container.querySelector<HTMLElement>('.workbench-sidebar--right')!.hidden).toBe(true);
  expect(sidebarTab(f.container)).toBeNull(); expect(remove).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled();
  await f.open();
  expect(sidebarTab(f.container).getAttribute("aria-selected")).toBe("true");
  expect((await f.client.readTeamChat({ teamInstanceId: f.instance.id })).messages.some(message => message.id === f.message.id)).toBe(true);
});
it("keeps the coordinator tab when the initial side-conversation load finishes in the same batch", async () => {
  const f = await coordinationFixture();
  let finishForks: (value: Awaited<ReturnType<typeof f.client.listConversationForks>>) => void = () => {};
  vi.spyOn(f.client, "listConversationForks").mockImplementation(() => new Promise(resolve => { finishForks = resolve; }));
  const resolveCoordinator = f.client.getTeamChatCoordinationConversation.bind(f.client);
  vi.spyOn(f.client, "getTeamChatCoordinationConversation").mockImplementation(async input => {
    const conversation = await resolveCoordinator(input);
    queueMicrotask(() => finishForks([]));
    return conversation;
  });
  await f.show(); await f.open();
  expect(sidebarTab(f.container)?.getAttribute("aria-selected")).toBe("true");
  expect(f.container.querySelector('.right-sidebar-workspace .chat-message[data-role="user"]')?.textContent).toBe(f.message.content);
  expect(f.container.querySelector('.right-sidebar-workspace [aria-label="输入任务"]')).not.toBeNull();
});
it("retains the shared panel, group viewport and width when switching to an ordinary conversation and back", async () => {
  const f = await coordinationFixture(); await f.show(); await f.open();
  const shell = f.container.querySelector('.right-sidebar-workspace');
  const viewport = f.container.querySelector<HTMLElement>('.conversation-workspace__messages')!;
  Object.defineProperties(viewport, { clientHeight: { configurable: true, value: 600 }, scrollHeight: { configurable: true, value: 2000 } });
  act(() => { viewport.scrollTop = 87; viewport.dispatchEvent(new Event("scroll")); });
  const reads = f.read.mock.calls.length;
  act(() => useWorkbenchUiStore.getState().setFilePanelWidthForConversation(teamChatTabId(f.instance.id), 680));
  await f.show(null);
  expect(f.container.querySelector('.right-sidebar-workspace')).toBe(shell);
  expect(sidebarTab(f.container)).toBeNull();
  expect(viewport.isConnected).toBe(true);
  await f.show();
  expect(f.container.querySelector('.conversation-workspace__messages')).toBe(viewport);
  expect(viewport.scrollTop).toBe(87); expect(f.read).toHaveBeenCalledTimes(reads);
  expect(sidebarTab(f.container).getAttribute("aria-selected")).toBe("true");
  expect(useWorkbenchUiStore.getState().filePanelWidthsByConversationId[teamChatTabId(f.instance.id)]).toBe(680);
});
it("keeps each room's coordination tab and reloads only the active room after hidden changes", async () => {
  const f = await coordinationFixture();
  const second = await f.client.createTeamInstance({ teamId: "default-team", scope: "global", name: "另一个群" });
  const listeners = new Set<(event: ConversationRunEvent) => void>();
  vi.spyOn(f.client, "onConversationRunEvent").mockImplementation(listener => { listeners.add(listener); return () => { listeners.delete(listener); }; });
  await f.show(); await f.open();
  const viewport = f.container.querySelector('.conversation-workspace__messages');
  await f.show(second); await f.open(second);
  const reads = f.read.mock.calls.length;
  await act(async () => {
    for (const listener of listeners) listener({ type: "run.finished", conversationId: f.coordinator.id, runId: crypto.randomUUID(), status: "completed", error: null });
    await Promise.resolve();
  });
  expect(f.read).toHaveBeenCalledTimes(reads);
  await f.show();
  expect(sidebarTab(f.container).getAttribute("aria-selected")).toBe("true");
  expect(viewport?.isConnected).toBe(true);
  expect(f.read).toHaveBeenCalledTimes(reads + 1);
  expect(f.read.mock.calls.at(-1)?.[0].conversationId).toBe(f.coordinator.id);
});

it("opens task details as one ordinary sidebar tab without replacing the primary chat", async () => {
  const f = await coordinationFixture();
  const task = await f.client.updateTaskContext({ conversationId: f.owner.id, title: "侧边任务定位", goal: "保持主群聊", requestId: crypto.randomUUID() });
  await f.show();
  await act(async () => { useWorkbenchUiStore.getState().openTaskList({ workspaceId: teamChatTabId(f.instance.id), scope: { teamInstanceId: f.instance.id }, taskId: task.id }); for (let turn = 0; turn < 15; turn++) await Promise.resolve(); });
  const shell = f.container.querySelector('.right-sidebar-workspace');
  expect(f.container.querySelectorAll('.right-sidebar-workspace')).toHaveLength(1);
  expect(shell?.querySelector('[role="tab"][title="任务列表"]')?.getAttribute("aria-selected")).toBe("true");
  expect(shell?.querySelector('[aria-label="任务详情"]')?.textContent).toContain("侧边任务定位");
  expect(f.container.textContent).toContain("主对话");
  expect(shell?.querySelector(".right-sidebar-workspace__empty")).toBeNull();
  await f.show(null); await f.show();
  expect(f.container.querySelector('.right-sidebar-workspace')).toBe(shell);
  expect(shell?.querySelector('[aria-label="任务详情"]')?.textContent).toContain("侧边任务定位");
});
