// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationMessageItem } from "@agent/protocol";
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
afterEach(() => {
  act(() => root?.unmount()); root = null; document.body.replaceChildren();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
  vi.restoreAllMocks(); vi.unstubAllGlobals();
});
async function flush(): Promise<void> { for (let i = 0; i < 35; i++) await Promise.resolve(); }

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
