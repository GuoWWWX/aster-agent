// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationRunEvent, type TeamChatMember, type TeamChatMessage, type TeamChatPage } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { TeamChatCoordinationResults } from "./team-chat-coordination-results.js";

let root: Root | null = null;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  useWorkbenchUiStore.setState(useWorkbenchUiStore.getInitialState(), true);
});
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); });
async function flush() { for (let i = 0; i < 15; i++) await Promise.resolve(); }
async function fixture() {
  const client = new MockAgentClient(); const instanceId = crypto.randomUUID(); const memberId = crypto.randomUUID();
  const message: TeamChatMessage = {
    id: crypto.randomUUID(), teamInstanceId: instanceId, sequence: 1, content: "需求分析师你好", senderConversationId: null,
    senderName: "你", intent: "request", recipientConversationIds: [memberId], taskContextId: null, replyToId: null,
    createdAt: new Date().toISOString(), rootMessageId: crypto.randomUUID(), depth: 0, sourceRunId: null,
    deliveries: [{ id: crypto.randomUUID(), conversationId: memberId, status: "completed", runId: null, error: null }],
    coordinator: { agentId: "default", modelSelection: null, status: "completed", error: null, userMessageId: crypto.randomUUID(),
      contextSummary: "不应出现在结果视图的上下文记忆", steps: [{ type: "completed", at: new Date().toISOString(), detail: "交给被点名的需求分析师回应。" }] },
  };
  let page: TeamChatPage = { messages: [message], nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0 };
  const read = vi.spyOn(client, "readTeamChat").mockImplementation(() => Promise.resolve(structuredClone(page)));
  const roster: TeamChatMember[] = [{ conversationId: memberId, name: "需求分析师", role: "需求澄清与验收定义", isLead: false, isArchived: false }];
  vi.spyOn(client, "getTeamChatMembers").mockResolvedValue(roster);
  const mark = vi.spyOn(client, "markTeamChatRead"); let listener: ((event: ConversationRunEvent) => void) | undefined;
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { listener = callback; return () => { listener = undefined; }; });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const show = async (active = true) => { await act(async () => {
    root?.render(<TooltipProvider><TeamChatCoordinationResults agentClient={client} teamInstanceId={instanceId} active={active} /></TooltipProvider>); await flush();
  }); };
  const click = async (label: string) => { await act(async () => { document.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!.click(); await flush(); }); };
  const change = async (teamInstanceId = instanceId) => { await act(async () => { listener?.({ type: "collaboration.changed", conversationId: memberId, teamInstanceId }); await flush(); }); };
  await show();
  return { client, instanceId, memberId, message, read, mark, show, click, change, setPage: (next: TeamChatPage) => { page = next; } };
}

it("loads only when opened, displays routing outcomes and opens the existing focused side conversation", async () => {
  const f = await fixture(); expect(f.read).not.toHaveBeenCalled();
  await f.click("查看协调结果");
  expect(f.read).toHaveBeenCalledExactlyOnceWith({ teamInstanceId: f.instanceId, limit: 50 });
  const view = document.querySelector('[aria-label="协调结果"]')!;
  expect(view.textContent).toContain(f.message.content); expect(view.textContent).toContain("交给被点名的需求分析师回应。");
  expect(view.textContent).toContain("需求分析师"); expect(view.textContent).toContain("已分流");
  expect(view.textContent).not.toContain("不应出现在结果视图"); expect(f.mark).not.toHaveBeenCalled();
  await f.click("查看这条消息的完整协调对话");
  expect(useWorkbenchUiStore.getState().teamChatCoordinationTarget).toMatchObject({ instanceId: f.instanceId, messageId: f.message.id,
    sequence: 1, timelineItemId: f.message.coordinator!.userMessageId });
  expect(document.querySelector('[aria-label="协调结果"]')).toBeNull();
});

it("updates this group's visible outcomes and stops reading when closed or inactive", async () => {
  const f = await fixture(); await f.click("查看协调结果");
  await f.change(crypto.randomUUID()); expect(f.read).toHaveBeenCalledTimes(1);
  f.setPage({ messages: [{ ...f.message, coordinator: { ...f.message.coordinator!, status: "failed", error: "服务暂时不可用" } }],
    nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0 });
  await f.change(); expect(f.read).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[aria-label="协调结果"]')?.textContent).toContain("服务暂时不可用");
  await f.click("关闭协调结果"); await f.change(); expect(f.read).toHaveBeenCalledTimes(2);
  await f.click("查看协调结果"); await f.show(false); const reads = f.read.mock.calls.length;
  expect(document.querySelector('[aria-label="协调结果"]')).toBeNull();
  await f.change(); expect(f.read).toHaveBeenCalledTimes(reads);
});

it("distinguishes pending, paused, cancelled, notification and member delivery failure from a completed task", async () => {
  const f = await fixture();
  f.setPage({ messages: [
    ...(["pending", "paused", "cancelled"] as const).map((status, i) => ({ ...f.message, id: crypto.randomUUID(), sequence: i + 2,
      coordinator: { ...f.message.coordinator!, status, steps: [] }, recipientConversationIds: [], deliveries: [] })),
    { ...f.message, id: crypto.randomUUID(), sequence: 5, intent: "notify", recipientConversationIds: [], deliveries: [] },
    { ...f.message, deliveries: [{ ...f.message.deliveries[0]!, status: "failed", error: "成员请求失败" }] },
  ], nextBeforeSequence: 1, userReadSequence: 0, memberReadSequence: 0 });
  await f.click("查看协调结果"); const text = document.querySelector('[aria-label="协调结果"]')!.textContent;
  for (const label of ["正在协调", "已暂停", "已取消", "仅通知", "成员请求失败", "查看更早记录请打开完整对话"]) expect(text).toContain(label);
  expect(text).not.toContain("任务已完成");
});

it("shows read errors and empty history and retries without running a model", async () => {
  const f = await fixture(); f.read.mockRejectedValueOnce(new Error("读取暂时失败"));
  await f.click("查看协调结果"); expect(document.querySelector('[role="alert"]')?.textContent).toContain("读取暂时失败");
  f.setPage({ messages: [], nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0 });
  await f.click("重试读取协调结果"); expect(document.querySelector('[aria-label="协调结果"]')?.textContent).toContain("暂无协调结果");
  expect(f.read).toHaveBeenCalledTimes(2); expect(f.mark).not.toHaveBeenCalled();
});

it("coalesces changes during a read and ignores a result after the popover closes", async () => {
  const f = await fixture(); let resolve!: (page: TeamChatPage) => void;
  f.read.mockImplementationOnce(() => new Promise<TeamChatPage>(done => { resolve = done; }));
  await f.click("查看协调结果");
  await f.change(); await f.change(); await f.change(); expect(f.read).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({ messages: [], nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0 }); await flush(); });
  expect(f.read).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[aria-label="协调结果"]')?.textContent).toContain(f.message.content);
  await f.click("关闭协调结果");
  f.read.mockImplementationOnce(() => new Promise<TeamChatPage>(done => { resolve = done; }));
  await f.click("查看协调结果"); await f.click("关闭协调结果");
  await act(async () => { resolve({ messages: [f.message], nextBeforeSequence: null, userReadSequence: 0, memberReadSequence: 0 }); await flush(); });
  expect(document.querySelector('[aria-label="协调结果"]')).toBeNull();
  expect(f.read).toHaveBeenCalledTimes(3);
});
