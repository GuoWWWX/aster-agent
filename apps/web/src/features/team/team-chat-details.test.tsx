// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type TeamChatPage } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { TeamChatDetails } from "./team-chat-details.js";

let root: Root | null = null;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION)); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); });
const flush = async () => { for (let i = 0; i < 15; i++) await Promise.resolve(); };
const change = (element: HTMLInputElement | HTMLSelectElement, value: string) => {
  Object.getOwnPropertyDescriptor(element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(element, value);
  element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
};

it("queries only on request, keeps applied filters when paging and does not mark results read", async () => {
  const client = new MockAgentClient(); const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  const member = (await client.getTeamChatMembers({ teamInstanceId: instance.id }))[0]!;
  const source = await client.postTeamChat({ teamInstanceId: instance.id, content: "匹配目标", intent: "notify", requestId: crypto.randomUUID() });
  const page: TeamChatPage = { messages: [source], nextBeforeSequence: 12, memberReadSequence: 0, userReadSequence: 0 };
  const read = vi.spyOn(client, "readTeamChat").mockResolvedValue(page); const mark = vi.spyOn(client, "markTeamChatRead");
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  const show = async (active: boolean) => { await act(async () => { root?.render(<TooltipProvider><TeamChatDetails agentClient={client} instance={instance} active={active}
    section="history" onSectionChanged={() => undefined} onOpenMember={() => undefined} onRename={() => Promise.resolve(true)} /></TooltipProvider>); await flush(); }); };
  await show(true); expect(read).not.toHaveBeenCalled();
  act(() => { change(element.querySelector('[aria-label="消息关键词"]')!, "目标"); change(element.querySelector('[aria-label="消息发送者"]')!, member.conversationId); change(element.querySelector('[aria-label="开始日期"]')!, "2026-10-01"); change(element.querySelector('[aria-label="结束日期"]')!, "2026-10-18"); });
  await act(async () => { element.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush(); });
  const criteria = read.mock.calls[0]![0]; expect(criteria).toMatchObject({ teamInstanceId: instance.id, query: "目标", senderConversationId: member.conversationId });
  expect(criteria.createdAfter).toBe(new Date("2026-10-01T00:00:00").toISOString()); expect(mark).not.toHaveBeenCalled();
  act(() => change(element.querySelector('[aria-label="消息关键词"]')!, "尚未提交的新条件"));
  await act(async () => { [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "继续查询更早记录")!.click(); await flush(); });
  expect(read.mock.calls[1]![0]).toEqual({ ...criteria, beforeSequence: 12 });
  await show(false); await client.postTeamChat({ teamInstanceId: instance.id, content: "隐藏时的新消息", intent: "notify", requestId: crypto.randomUUID() });
  await act(flush); expect(read).toHaveBeenCalledTimes(2);
  await show(true); expect(read).toHaveBeenCalledTimes(2); expect(element.textContent).toContain("匹配目标");
  read.mockRejectedValueOnce(new Error("temporary"));
  await act(async () => { element.querySelector('form')!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); await flush(); });
  expect(element.querySelector('[role="alert"]')).not.toBeNull();
  await act(async () => { [...element.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === "重试查询")!.click(); await flush(); });
  expect(read).toHaveBeenCalledTimes(4); expect(element.querySelector('[role="alert"]')).toBeNull();
});
