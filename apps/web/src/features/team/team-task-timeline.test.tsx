// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TeamCollaborationProjection, TeamWorkItemView } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { TeamTaskTimeline } from "./team-task-timeline.js";

let root: Root | null = null;
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); });
afterEach(() => { act(() => root?.unmount()); root = null; document.body.replaceChildren(); });

it("groups rework by task, filters actual participants, ignores stale reads and refreshes updated summaries", async () => {
  const client = new MockAgentClient();
  const draft = { acceptanceCriteria: [], priority: "normal" as const, permissionMode: "full_access" as const,
    projectId: null, requirement: "需求", teamId: "default-team" };
  const first = await client.submitTeamWorkItem({ ...draft, title: "第一个任务" });
  const second = await client.submitTeamWorkItem({ ...draft, title: "第二个任务" });
  const memberId = crypto.randomUUID();
  first.participantConversationIds = [memberId];
  second.participantConversationIds = [memberId];
  const node = { id: memberId, agentId: "tester", avatarIcon: null, conversationId: memberId,
    kind: "standing" as const, latestOutput: "测试结果", latestOutputRunId: null, name: "测试成员", position: { x: 0, y: 0 },
    role: "测试", runStatus: "completed" as const, taskIds: [] };
  const projection = (item: TeamWorkItemView): TeamCollaborationProjection => ({ workItemId: item.id, nodes: [node, { ...node, id: "unused", conversationId: crypto.randomUUID(), name: "未参与成员" }],
    edges: [], isLive: false, plan: null, summary: { adHocRouteCount: 0, lastActivityAt: null, messageCount: 0, observedRouteCount: 0, participantCount: 1, plannedRouteCount: 0 } });
  let resolveOld!: (value: TeamCollaborationProjection) => void;
  const read = vi.spyOn(client, "getTeamCollaborationProjection").mockImplementation(id => id === first.id
    ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(projection(second)));
  const openMember = vi.fn();
  const openTask = vi.fn();
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  const render = (items: TeamWorkItemView[]) => root?.render(<TeamTaskTimeline agentClient={client} items={items} onOpenTask={openTask} onOpenMember={openMember} />);
  await act(async () => { render([first, second]); await Promise.resolve(); });
  const expand = (title: string) => container.querySelector<HTMLButtonElement>('[aria-label="查看任务摘要 ' + title + '"]')?.click();
  await act(async () => { expand(first.title); await Promise.resolve(); });
  await act(async () => { expand(second.title); await Promise.resolve(); });
  expect(container.textContent).toContain("测试结果");
  expect(container.textContent).not.toContain("未参与成员");
  await act(async () => { resolveOld({ ...projection(first), nodes: [{ ...node, latestOutput: "过期结果" }] }); await Promise.resolve(); });
  expect(container.textContent).not.toContain("过期结果");
  act(() => [...container.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "测试成员")?.click());
  expect(openMember).toHaveBeenCalledWith(second.id, memberId);
  read.mockResolvedValue({ ...projection(second), nodes: [{ ...node, latestOutput: "返工后的新结果" }] });
  await act(async () => { render([first, { ...second, revision: 2, updatedAt: "2026-10-16T00:00:00.000Z" }]); await Promise.resolve(); });
  expect(container.textContent).toContain("返工后的新结果");
  expect(container.querySelectorAll("ol > li")).toHaveLength(2);
  expect(container.textContent).toContain("第 2 轮");
});
