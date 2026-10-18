// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ConversationRunEvent } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { ConversationActivity } from "./conversation-activity.js";
import { teamChatTabId } from "./workbench-tabs.js";

let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); });

it("shows one group row, updates its time, opens the group, and clears on persisted read notification", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new MockAgentClient();
  const group = await client.createTeamInstance({ teamId: "default-team", name: "协作群", scope: "global" });
  const message = await client.postTeamChat({ teamInstanceId: group.id, content: "结果", intent: "notify", requestId: "activity" });
  let timestamp = "2026-10-19T01:00:00Z", readSequence = 0;
  const read = vi.spyOn(client, "readTeamChat").mockImplementation(() => Promise.resolve({ messages: [{ ...message,
    senderConversationId: group.rootConversationId, sequence: 2, createdAt: timestamp }], userReadSequence: readSequence,
    memberReadSequence: 0, nextBeforeSequence: null }));
  const mark = vi.spyOn(client, "markTeamChatRead");
  const listeners: ((event: ConversationRunEvent) => void)[] = [];
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { listeners.push(listener); return () => {
    const index = listeners.indexOf(listener); if (index >= 0) listeners.splice(index, 1);
  }; });
  const select = vi.fn(); const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<ConversationActivity agentClient={client} projects={[]} sessions={[]}
    teamInstances={[group]} onSelect={select} />); await Promise.resolve(); });
  expect(container.querySelector("button")?.getAttribute("aria-label")).toContain("1 个未读");
  await act(async () => { container.querySelector<HTMLButtonElement>("button")?.click(); await Promise.resolve(); });
  const row = () => document.querySelector<HTMLButtonElement>('[aria-label="协作群，有新回复"]');
  expect(row()?.querySelector("svg.lucide-users-round")).not.toBeNull();
  expect(document.querySelectorAll('[aria-label="协作群，有新回复"]')).toHaveLength(1);
  expect(row()?.querySelector("time")?.dateTime).toBe(timestamp);
  expect(mark).not.toHaveBeenCalled();
  timestamp = "2026-10-19T02:00:00Z";
  await act(async () => { listeners.forEach(listener => listener({ type: "collaboration.changed", conversationId: group.rootConversationId!, teamInstanceId: group.id }));
    await new Promise(resolve => setTimeout(resolve, 120)); });
  expect(document.querySelectorAll('[aria-label="协作群，有新回复"]')).toHaveLength(1);
  expect(row()?.querySelector("time")?.dateTime).toBe(timestamp);
  await act(async () => { row()?.click(); await Promise.resolve(); });
  expect(select).toHaveBeenCalledWith(teamChatTabId(group.id));
  readSequence = 2;
  await act(async () => { listeners.forEach(listener => listener({ type: "collaboration.changed", conversationId: group.rootConversationId!, teamInstanceId: group.id }));
    await new Promise(resolve => setTimeout(resolve, 120)); });
  expect(container.querySelector("button")?.getAttribute("aria-label")).toContain("0 个未读");
  expect(read).toHaveBeenCalledWith({ teamInstanceId: group.id, limit: 30 });
  expect(mark).not.toHaveBeenCalled();
});
