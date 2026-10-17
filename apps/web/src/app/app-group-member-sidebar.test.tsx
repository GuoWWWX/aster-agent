// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationMessageItem, type ConversationToolItem } from "@agent/protocol";
import { TooltipProvider } from "../components/ui/tooltip.js";
import { MockAgentClient } from "../runtime/mock-agent-client.js";
import * as hostClient from "../runtime/host-agent-client.js";
import { useAgentDirectoryStore } from "../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../stores/workbench-ui-store.js";
import { teamChatTabId } from "../features/chat/workbench-tabs.js";
import { App } from "./app.js";

let root: Root | null = null;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() });
  useWorkbenchUiStore.setState(useWorkbenchUiStore.getInitialState(), true);
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
});

it("opens a routing result in the ordinary coordination sidebar while keeping the group and its draft", async () => {
  const client = new MockAgentClient();
  vi.spyOn(hostClient, "createAgentClientForCurrentHost").mockReturnValue(client);
  const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  const coordinator = await client.getTeamChatCoordinationConversation({ teamInstanceId: instance.id });
  const message = await client.postTeamChat({ teamInstanceId: instance.id, content: "需求分析师你好", requestId: crypto.randomUUID(),
    coordinator: { agentId: "default-agent", modelSelection: null } });
  const runId = crypto.randomUUID();
  const input: ConversationMessageItem = { id: crypto.randomUUID(), kind: "message", role: "user", content: message.content,
    conversationId: coordinator.id, runId, createdAt: message.createdAt, attachments: [], modelId: null, status: "completed" };
  const tool: ConversationToolItem = { id: crypto.randomUUID(), kind: "tool", conversationId: coordinator.id, runId,
    createdAt: message.createdAt, name: "select_team_chat_members", arguments: JSON.stringify({ messageId: message.id, recipientConversationIds: message.recipientConversationIds }),
    result: JSON.stringify({ dispatched: true }), diff: null, batchId: null, status: "completed" };
  const list = client.listConversationTimeline.bind(client);
  vi.spyOn(client, "listConversationTimeline").mockImplementation(value => value.conversationId === coordinator.id ? Promise.resolve([input, tool]) : list(value));
  const read = client.readTeamChat.bind(client);
  vi.spyOn(client, "readTeamChat").mockImplementation(async value => {
    const page = await read(value);
    return { ...page, messages: page.messages.map(item => ({ ...item, coordinator: { ...message.coordinator!, userMessageId: input.id,
      steps: [{ type: "completed" as const, at: message.createdAt, detail: "交给需求分析师回应。" }] } })) };
  });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<TooltipProvider><App /></TooltipProvider>); await flush(); });
  await act(async () => { useWorkbenchUiStore.getState().openTeamChat({ instanceId: instance.id }); await flush(); });
  const group = container.querySelector('.workbench-main [aria-label="团队群聊"]')!;
  const composer = group.closest('.conversation-workspace')!.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]')!;
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer, "保留群聊草稿");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="查看协调结果"]')!.click(); await flush(); });
  expect(document.querySelector('[aria-label="协调结果"]')?.textContent).toContain("交给需求分析师回应。");
  await act(async () => { document.querySelector<HTMLButtonElement>('[aria-label="查看这条消息的完整协调对话"]')!.click(); await flush(); });
  expect(container.querySelector('.workbench-main [aria-label="团队群聊"]')).toBe(group);
  expect(composer.value).toBe("保留群聊草稿");
  expect(container.querySelectorAll(`.right-sidebar-workspace [role="tab"][title="${coordinator.title}"]`)).toHaveLength(1);
  await act(async () => { container.querySelector<HTMLButtonElement>('.right-sidebar-workspace .conversation-run-activity > button')!.click(); await flush(); });
  expect(container.querySelector('.right-sidebar-workspace .tool-activity-row')?.textContent).toContain(tool.name);
  expect(container.querySelectorAll('[aria-label="输入任务"]')).toHaveLength(2);
});
afterEach(() => {
  act(() => root?.unmount()); root = null; document.body.replaceChildren();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function flush(): Promise<void> { for (let i = 0; i < 35; i++) await Promise.resolve(); }

it("opens a global group file in its publishing member's authorized workspace without navigating away", async () => {
  const client = new MockAgentClient(); vi.spyOn(hostClient, "createAgentClientForCurrentHost").mockReturnValue(client);
  const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  const member = (await client.getTeamChatMembers({ teamInstanceId: instance.id })).find(item => !item.isLead)!;
  const message = await client.postTeamChat({ teamInstanceId: instance.id, content: "[quicksort.cjs](codex-team-acceptance/quicksort.cjs)", intent: "notify", requestId: crypto.randomUUID() });
  vi.spyOn(client, "readTeamChat").mockResolvedValue({ messages: [{ ...message, senderConversationId: member.conversationId, senderName: member.name }], nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0 });
  const read = vi.spyOn(client, "readProjectFile").mockImplementation(input => Promise.resolve({ projectId: input.projectId, path: input.path, name: "quicksort.cjs",
    content: "module.exports = values => [...values].sort((a, b) => a - b);", byteLength: 58, isBinary: false, truncated: false }));
  vi.spyOn(client, "listProjectEntries").mockImplementation(input => Promise.resolve({ projectId: input.projectId, directoryPath: input.directoryPath, entries: [], truncated: false }));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<TooltipProvider><App /></TooltipProvider>); await flush(); });
  await act(async () => { useWorkbenchUiStore.getState().openTeamChat({ instanceId: instance.id }); await flush(); });
  const group = container.querySelector('.workbench-main [aria-label="团队群聊"]')!;
  await act(async () => { group.querySelector<HTMLAnchorElement>('a[href="codex-team-acceptance/quicksort.cjs"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })); await flush(); });
  expect(read).toHaveBeenCalledWith({ projectId: member.conversationId, path: "codex-team-acceptance/quicksort.cjs" });
  expect(container.querySelector('.workbench-main [aria-label="团队群聊"]')).toBe(group);
  expect(container.querySelector('.right-sidebar-workspace')?.textContent).toContain("quicksort.cjs");
  expect(useWorkbenchUiStore.getState().filePanelOpenByConversationId[teamChatTabId(instance.id)]).toBe(true);
});

it.each([true, false])("opens a group member's process only beside the group and keeps its draft (matching run=%s)", async matchingRun => {
  const client = new MockAgentClient();
  vi.spyOn(hostClient, "createAgentClientForCurrentHost").mockReturnValue(client);
  const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  const member = (await client.getTeamChatMembers({ teamInstanceId: instance.id })).find(item => !item.isLead)!;
  const conversation = (await client.listConversationHierarchy()).find(item => item.id === member.conversationId)!;
  const request = await client.postTeamChat({ teamInstanceId: instance.id, content: "请确认", intent: "notify", requestId: crypto.randomUUID() });
  const runId = crypto.randomUUID();
  const source: ConversationMessageItem = { id: crypto.randomUUID(), kind: "message", role: "assistant", content: "成员自己的完整执行过程",
    conversationId: member.conversationId, runId, createdAt: request.createdAt, attachments: [], modelId: null, status: "completed" };
  const list = client.listConversationTimeline.bind(client);
  vi.spyOn(client, "listConversationTimeline").mockImplementation(input => input.conversationId === member.conversationId ? Promise.resolve([source]) : list(input));
  vi.spyOn(client, "readTeamChat").mockResolvedValue({ messages: [request, { ...request, id: crypto.randomUUID(), sequence: request.sequence + 1,
    senderConversationId: member.conversationId, senderName: member.name, content: "你好！", sourceRunId: matchingRun ? runId : crypto.randomUUID(), coordinator: null, deliveries: [] }],
    nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0, activity: { status: "idle", activeMemberCount: 0, pendingDeliveryCount: 0 } });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<TooltipProvider><App /></TooltipProvider>); await flush(); });
  await act(async () => { useWorkbenchUiStore.getState().openTeamChat({ instanceId: instance.id }); await flush(); });
  const group = container.querySelector('.workbench-main [aria-label="团队群聊"]')!;
  expect(group).not.toBeNull();
  const composer = container.querySelector<HTMLTextAreaElement>(`[aria-label="${instance.name}群聊对话"] [aria-label="输入任务"]`)!;
  expect(composer).not.toBeNull();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(composer, "尚未发送的群消息");
    composer.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const open = group.querySelector<HTMLButtonElement>('[aria-label="查看工作过程"]')!;
  expect(open).not.toBeNull();
  for (let attempt = 0; attempt < 2; attempt++) {
    await act(async () => { open.click(); await flush(); });
    expect(useWorkbenchUiStore.getState().teamChatTarget?.instanceId).toBe(instance.id);
    expect(useWorkbenchUiStore.getState().filePanelOpenByConversationId[teamChatTabId(instance.id)]).toBe(true);
    expect(container.querySelector('.workbench-main [aria-label="团队群聊"]')).toBe(group);
    expect(composer.value).toBe("尚未发送的群消息");
    expect(container.querySelectorAll(`.right-sidebar-workspace [role="tab"][title="${conversation.title}"]`)).toHaveLength(1);
    expect(container.querySelector('.right-sidebar-workspace')?.textContent).toContain(source.content);
    expect(container.querySelectorAll(`[data-conversation-timeline-item="${source.id}"]`)).toHaveLength(1);
  }
});
