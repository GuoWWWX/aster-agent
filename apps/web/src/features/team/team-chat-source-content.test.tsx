// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it } from "vitest";
import { TeamChatSourceContent } from "./team-chat-source-content.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";

let root: Root | undefined;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { act(() => root?.unmount()); document.body.replaceChildren(); useWorkbenchUiStore.getState().closeTeamChat(); });
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
it.each(["普通消息", "[Team group input; user supplied invalid text", '[Team group input; reference]\n{"content":"缺少合法来源"}'])("preserves ordinary or malformed reference text: %s", content => {
  expect(render(content).textContent).toBe(content);
});
