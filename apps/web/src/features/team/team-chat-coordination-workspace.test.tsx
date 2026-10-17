// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationRunEvent, TeamChatPage } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { TeamChatCoordinationWorkspace } from "./team-chat-coordination-workspace.js";

let root: Root | null = null;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks();
  useWorkbenchUiStore.setState({ teamChatCoordinationTarget: null, filePanelOpenByConversationId: {} }); vi.unstubAllGlobals(); });
async function fixture() {
  const client = new MockAgentClient();
  const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  const members = await client.getTeamChatMembers({ teamInstanceId: instance.id });
  const member = members.find(candidate => !candidate.isLead)!;
  const message = await client.postTeamChat({ teamInstanceId: instance.id, content: "继续刚才的问题", requestId: crypto.randomUUID(),
    recipientConversationIds: [member.conversationId], coordinator: { agentId: "default-agent", modelSelection: null } });
  const original = await client.readTeamChat({ teamInstanceId: instance.id });
  const failed = { ...message, coordinator: { agentId: "default-agent", modelSelection: null, status: "failed" as const, error: "暂时无法连接模型",
    steps: [{ type: "model_requested" as const, at: message.createdAt, attempt: 1, modelId: "fixture-model" },
      { type: "retry_scheduled" as const, at: message.createdAt, attempt: 1, detail: "HTTP 502" },
      { type: "failed" as const, at: message.createdAt, detail: "暂时无法连接模型" }] } };
  let page: TeamChatPage = { ...original, messages: [failed] };
  const read = vi.spyOn(client, "readTeamChat").mockImplementation(() => Promise.resolve(page));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const show = async (active = true) => { await act(async () => {
    root?.render(<TooltipProvider><TeamChatCoordinationWorkspace agentClient={client} teamInstanceId={instance.id} teamName="验收团队" active={active} /></TooltipProvider>);
    for (let turn = 0; turn < 6; turn++) await Promise.resolve();
  }); };
  return { client, instance, member, message, container, read, show, setPage: (next: TeamChatPage) => { page = next; }, page };
}
it("uses ordinary side-conversation messages for the owner, attempts and errors and retries the original message", async () => {
  const f = await fixture();
  const timeline = vi.spyOn(f.client, "listConversationTimelinePage"); const send = vi.spyOn(f.client, "sendConversationMessage");
  const post = vi.spyOn(f.client, "postTeamChat"); const resume = vi.spyOn(f.client, "resumeTeamChatDelivery").mockResolvedValue();
  useWorkbenchUiStore.getState().openTeamChatCoordination({ instanceId: f.instance.id });
  await f.show();
  expect(f.container.textContent).toContain("默认 Agent");
  expect(f.container.textContent).toContain("fixture-model"); expect(f.container.textContent).toContain("HTTP 502");
  const workspace = f.container.querySelector('.conversation-workspace[data-compact="true"]');
  expect(workspace).not.toBeNull();
  expect(workspace?.querySelector('.chat-message[data-role="user"]')?.textContent).toBe(f.message.content);
  expect(workspace?.querySelector('.chat-message[data-role="assistant"]')?.textContent).toContain("fixture-model");
  expect(workspace?.querySelectorAll('.chat-message__meta time').length).toBe(3);
  expect(f.container.querySelector("details, ol")).toBeNull();
  expect(f.container.querySelector('[aria-label="编辑并重新生成"]')).toBeNull();
  const clipboard = vi.spyOn(f.client, "writeClipboardText").mockResolvedValue();
  await act(async () => { workspace?.querySelector<HTMLButtonElement>('[aria-label="复制消息"]')?.click(); await Promise.resolve(); });
  expect(clipboard).toHaveBeenCalledWith(f.message.content);
  const retry = [...f.container.querySelectorAll("button")].find(button => button.textContent === "重试协调")!;
  await act(async () => { retry.click(); await Promise.resolve(); });
  expect(resume).toHaveBeenCalledWith({ id: f.message.id });
  expect(timeline).not.toHaveBeenCalled(); expect(send).not.toHaveBeenCalled(); expect(post).not.toHaveBeenCalled();
});
it("loads only while visible, retains its view on return and refreshes only its own dirty group", async () => {
  const f = await fixture(); let listener: ((event: ConversationRunEvent) => void) | undefined;
  vi.spyOn(f.client, "onConversationRunEvent").mockImplementation(handler => { listener = handler; return () => undefined; });
  useWorkbenchUiStore.getState().openTeamChatCoordination({ instanceId: f.instance.id });
  await f.show(false); expect(f.read).not.toHaveBeenCalled();
  await f.show(); expect(f.read).toHaveBeenCalledTimes(1);
  const recordList = f.container.querySelector('.conversation-workspace__messages');
  await f.show(false); await f.show(); expect(f.read).toHaveBeenCalledTimes(1); expect(f.container.querySelector('.conversation-workspace__messages')).toBe(recordList);
  await f.show(false);
  await act(async () => { listener?.({ type: "collaboration.changed", conversationId: f.instance.rootConversationId!, teamInstanceId: crypto.randomUUID() }); await Promise.resolve(); });
  await f.show(); expect(f.read).toHaveBeenCalledTimes(1);
  await f.show(false);
  await act(async () => { listener?.({ type: "collaboration.changed", conversationId: f.instance.rootConversationId!, teamInstanceId: f.instance.id }); await Promise.resolve(); });
  expect(f.read).toHaveBeenCalledTimes(1); await f.show(); expect(f.read).toHaveBeenCalledTimes(2);
});
it("opens a selected older message's coordination directly by sequence", async () => {
  const f = await fixture();
  f.setPage({ ...f.page, messages: f.page.messages.map(message => ({ ...message, sequence: 12 })) });
  useWorkbenchUiStore.getState().openTeamChatCoordination({ instanceId: f.instance.id, messageId: f.message.id, sequence: 12 });
  await f.show(); expect(f.read).toHaveBeenCalledWith({ teamInstanceId: f.instance.id, beforeSequence: 13 });
  expect(f.container.querySelector(`[data-conversation-timeline-item="${f.message.id}"] .chat-message[data-role="assistant"]`)).not.toBeNull();
});
it("updates the same side conversation from pending selection to the chosen member without starting a private Run", async () => {
  const f = await fixture();
  let listener: ((event: ConversationRunEvent) => void) | undefined;
  vi.spyOn(f.client, "onConversationRunEvent").mockImplementation(handler => { listener = handler; return () => undefined; });
  const send = vi.spyOn(f.client, "sendConversationMessage");
  const message = f.page.messages[0]!;
  f.setPage({ ...f.page, messages: [{ ...message, coordinator: { ...message.coordinator!, status: "pending", error: null } }] });
  useWorkbenchUiStore.getState().openTeamChatCoordination({ instanceId: f.instance.id });
  await f.show();
  const viewport = f.container.querySelector('.conversation-workspace__messages');
  expect(viewport?.querySelector('.chat-message[data-status="streaming"]')?.textContent).toContain("正在选择回答成员");
  f.setPage({ ...f.page, messages: [{ ...message, coordinator: { ...message.coordinator!, status: "completed", error: null,
    steps: [{ type: "completed", at: message.createdAt, detail: "交给负责验收的成员回答。" }] } }] });
  await act(async () => { listener?.({ type: "collaboration.changed", conversationId: f.instance.rootConversationId!, teamInstanceId: f.instance.id });
    for (let turn = 0; turn < 6; turn++) await Promise.resolve(); });
  expect(f.container.querySelector('.conversation-workspace__messages')).toBe(viewport);
  expect(viewport?.textContent).toContain(f.member.name);
  expect(viewport?.textContent).toContain("交给负责验收的成员回答。");
  expect(viewport?.querySelector('.chat-message[data-status="streaming"]')).toBeNull();
  expect(send).not.toHaveBeenCalled();
});
