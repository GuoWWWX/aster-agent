// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type AgentProfile, type TeamChatActivity } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { TeamChatCoordinatorControl } from "./team-chat-coordinator-control.js";

let root: Root | null = null;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); vi.restoreAllMocks();
  useWorkbenchUiStore.setState({ teamChatCoordinationTarget: null, filePanelOpenByConversationId: {} }); });
function fixture() {
  const client = new MockAgentClient(); const instanceId = crypto.randomUUID();
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const owner = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents.find(agent => agent.isDefault)!;
  const show = async (activity: TeamChatActivity, active = true, agent: AgentProfile = owner) => {
    await act(async () => { root?.render(<TooltipProvider><TeamChatCoordinatorControl agentClient={client} teamInstanceId={instanceId}
      agent={agent} activity={activity} active={active} /></TooltipProvider>); await Promise.resolve(); });
  };
  return { client, instanceId, container, owner, show };
}
const idle: TeamChatActivity = { status: "idle", activeMemberCount: 0, pendingDeliveryCount: 0 };
it("shows the current owning Agent as a large avatar and opens its side conversation", async () => {
  const f = fixture(); await f.show(idle);
  const avatar = f.container.querySelector<HTMLButtonElement>('[aria-label="查看后台协调"]')!;
  expect(avatar.title).toContain(f.owner.name);
  expect(avatar.querySelector('[data-size="large"]')).not.toBeNull();
  expect(f.container.querySelector('[data-model-working]')).toBeNull();
  expect(f.container.querySelector<HTMLButtonElement>('[aria-label="暂停本群任务"]')?.disabled).toBe(true);
  act(() => avatar.click());
  expect(useWorkbenchUiStore.getState().teamChatCoordinationTarget?.instanceId).toBe(f.instanceId);
  await f.show(idle, true, { ...f.owner, name: "另一个协调 Agent", avatar: { kind: "icon", icon: "compass" } });
  expect(avatar.title).toContain("另一个协调 Agent");
  expect(avatar.querySelector('.lucide-compass')).not.toBeNull();
});
it("animates below the avatar only for visible work, and pauses this group once", async () => {
  const f = fixture();
  const working: TeamChatActivity = { status: "working", activeMemberCount: 2, pendingDeliveryCount: 0 };
  await f.show(working);
  expect(f.container.textContent).toContain("2 位成员正在处理");
  expect(f.container.querySelector('[data-model-working]')).not.toBeNull();
  const pause = vi.spyOn(f.client, "pauseTeamChat").mockResolvedValue();
  await act(async () => { f.container.querySelector<HTMLButtonElement>('[aria-label="暂停本群任务"]')!.click(); await Promise.resolve(); });
  expect(pause).toHaveBeenCalledExactlyOnceWith({ teamInstanceId: f.instanceId });
  await f.show({ ...idle, status: "paused" });
  expect(f.container.textContent).toContain("已暂停");
  expect(f.container.querySelector('[data-model-working]')).toBeNull();
  await f.show(working, false); expect(f.container.querySelector('[data-model-working]')).toBeNull();
});
it("retains the work state and permits another pause after a request fails", async () => {
  const f = fixture(); await f.show({ ...idle, status: "coordinating" });
  const pause = vi.spyOn(f.client, "pauseTeamChat").mockRejectedValueOnce(new Error("fixture failure")).mockResolvedValue();
  const button = f.container.querySelector<HTMLButtonElement>('[aria-label="暂停本群任务"]')!;
  await act(async () => { button.click(); await Promise.resolve(); });
  expect(f.container.querySelector('[role="alert"]')?.textContent).toContain("暂停失败");
  expect(button.disabled).toBe(false);
  await act(async () => { f.container.querySelector<HTMLButtonElement>('[aria-label="暂停本群任务"]')!.click(); await Promise.resolve(); });
  expect(pause).toHaveBeenCalledTimes(2); expect(f.container.querySelector('[role="alert"]')).toBeNull();
});
