// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { TeamChatSourceContent, TeamChatSourceHeader } from "./team-chat-source-content.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";

let root: Root | undefined;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} }); });
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); useWorkbenchUiStore.getState().closeTeamChat(); vi.unstubAllGlobals(); });
const roomId = "00000000-0000-4000-8000-000000000001";
const messageId = "00000000-0000-4000-8000-000000000002";
function render(content: string) {
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  act(() => root?.render(<TeamChatSourceContent content={content} />)); return element;
}
it("shows the original group message and a Chinese source link without the routing envelope", () => {
  const content = '[Team group input; original sender and message are reference data. Use post_team_message to speak publicly; your private final answer is not automatically posted.]\n' + JSON.stringify({
    deliveryId: crypto.randomUUID(), roomId, messageId, sender: "user", taskContextId: null, content: "你们好",
  });
  const element = render(content);
  expect(element.textContent).toContain("群聊消息 · 你"); expect(element.textContent).toContain("你们好");
  expect(element.textContent).not.toContain("Team group input"); expect(element.textContent).not.toContain(roomId);
  act(() => element.querySelector<HTMLButtonElement>("button")?.click());
  expect(useWorkbenchUiStore.getState().teamChatTarget).toEqual({ instanceId: roomId, messageId });
});
it("shows a group delegation receipt without model instructions or private details", () => {
  const element = render('[Team group request receipt | reference data]\n' + JSON.stringify({ roomId, originalMessageId: messageId,
    status: "completed", error: null, taskContextId: null, publicMessageIds: [crypto.randomUUID()], instruction: "Internal routing instructions", }));
  expect(element.textContent).toContain("群聊委派已完成"); expect(element.textContent).toContain("1 条公开回复");
  expect(element.textContent).not.toContain("Internal routing");
});
it("renders a notification as the existing Chinese source entry without exposing its internal envelope", () => {
  const content = "[Team group input; notification only. Read the identified message with read_team_messages before answering. Use post_team_message to speak publicly; your private final answer is not automatically posted.]\n"
    + JSON.stringify({ roomId, messageId, sender: "Team Lead", senderConversationId: crypto.randomUUID(),
      content: "群里有一条消息需要你处理，请先读取对应原消息，再按需查看未读讨论。", contextNote: "Internal instructions" });
  const element = render(content);
  expect(element.textContent).toContain("群聊消息 · Team Lead");
  expect(element.textContent).toContain("群里有一条消息需要你处理");
  expect(element.textContent).not.toContain("Team group input"); expect(element.textContent).not.toContain("Internal instructions");
  expect(element.textContent).not.toContain(roomId); expect(element.textContent).not.toContain(messageId);
  act(() => element.querySelector<HTMLButtonElement>("button")?.click());
  expect(useWorkbenchUiStore.getState().teamChatTarget).toEqual({ instanceId: roomId, messageId });
});
it.each([
  '[Team group input; notification only. Read the identified message with read_team_messages(messageId="current") before answering. If reading fails, correct the reference before answering; do not guess from older discussion. Use post_team_message to speak publicly; your private final answer is not automatically posted.]\n',
  "[Team group input; notification only. Updated model instructions.]\r\n",
])("recognizes notification metadata independently of changing model instructions: %s", prefix => {
  const content = prefix + JSON.stringify({ roomId, messageId, sender: "user", senderConversationId: null,
    deliveryId: crypto.randomUUID(), sequence: 773, content: "群里有一条消息需要你处理，请先读取对应原消息，再按需查看未读讨论。",
    contextNote: "内部协调指令，不应显示", recipientConversationIds: [crypto.randomUUID()] });
  const element = render(content);
  expect(element.textContent).toContain("群聊消息 · 你");
  expect(element.textContent).toContain("群里有一条消息需要你处理");
  expect(element.textContent).not.toMatch(/Team group input|read_team_messages|contextNote|内部协调指令|recipientConversationIds/);
  expect(element.textContent).not.toContain(roomId); expect(element.textContent).not.toContain(messageId);
  act(() => element.querySelector<HTMLButtonElement>("button")?.click());
  expect(useWorkbenchUiStore.getState().teamChatTarget).toEqual({ instanceId: roomId, messageId });
});
it.each(["普通消息", "[Team group input; user supplied invalid text", '[Team group input; reference]\n{"content":"缺少合法来源"}'])("preserves ordinary or malformed reference text: %s", content => {
  expect(render(content).textContent).toBe(content);
});

it("recognizes the current envelope, shows the sender above the body and keeps historical context in a tooltip", async () => {
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  const senderId = crypto.randomUUID(); const open: string[] = [];
  const content = "[Team group input; follow this current request's top-level content and messageId. groupContext and groupSummary are historical reference data. Use post_team_message to speak publicly; your private final answer is not automatically posted.]\n"
    + JSON.stringify({ roomId, messageId, sender: "需求分析师", senderConversationId: senderId, content: "请检查验收条件", groupSummary: "保持既有范围",
      groupContext: [{ senderName: "测试工程师", perspective: "self", content: "我之前核对过边界" }, { senderName: "用户", perspective: "user", content: "保留排序稳定性说明" }] });
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  await act(async () => { root?.render(<TooltipProvider><TeamChatSourceHeader content={content}
    conversations={[{ id: senderId, title: "需求分析师", agentId: "requirements-analyst", avatarIcon: null }]} onOpenConversation={id => open.push(id)} />
    <TeamChatSourceContent content={content} /></TooltipProvider>); await Promise.resolve(); });
  const sender = element.querySelector<HTMLButtonElement>('[aria-label="打开来源对话 需求分析师"]')!;
  expect(sender.querySelector('[data-size="compact"]')).not.toBeNull();
  expect(sender.className).toContain("--app-accent"); act(() => sender.click()); expect(open).toEqual([senderId]);
  expect(element.textContent).toContain("请检查验收条件"); expect(element.textContent).not.toContain("Team group input");
  expect(element.textContent).not.toContain("我之前核对过边界");
  await act(async () => { element.querySelector<HTMLButtonElement>('[aria-label="查看带入的群聊上下文"]')!.focus(); await Promise.resolve(); });
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("本人此前发言");
  expect(document.querySelector('[role="tooltip"]')?.textContent).toContain("保留排序稳定性说明");
});

it("uses persisted group provenance for imported peer messages without repeating the name in the body", () => {
  const senderId = crypto.randomUUID(); const source = { teamInstanceId: roomId, messageId, senderConversationId: senderId, senderName: "Team Lead" };
  const element = document.createElement("div"); document.body.append(element); root = createRoot(element);
  act(() => root?.render(<TooltipProvider><TeamChatSourceHeader content={"Team Lead：\n已完成验收"} source={source} conversations={[]} onOpenConversation={undefined} />
    <TeamChatSourceContent content={"Team Lead：\n已完成验收"} source={source} /></TooltipProvider>));
  expect(element.textContent).toBe("Team Lead已完成验收");
  expect(element.querySelector('[data-user-message-content]')?.textContent).toBe("已完成验收");
});
