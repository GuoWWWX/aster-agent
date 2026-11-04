// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type TeamInstanceView } from "@agent/protocol";
import type { ProjectSession } from "../projects/project-session-model.js";
import { getArchivedSessions, getPinnedSessions, getProjectSessions, getTemporarySessions } from "../projects/project-session-model.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ConversationPath } from "./conversation-path.js";
import { conversationActivityRows } from "./conversation-activity.js";
import { conversationIdentity } from "./conversation-identity.js";

export const navSession = (id: string, extra: Partial<ProjectSession> = {}): ProjectSession => ({
  id, title: id, activeRunId: null, agentId: null, hasUnreadResult: false, isArchived: false, isPinned: false,
  lastRunStatus: null, modelSelection: null, parentConversationId: null, projectId: null, teamId: null,
  threadKind: "agent", workspaceRootPath: null, ...extra,
});
const agents = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents;
const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0]!;
const lead = navSession("lead", { threadKind: "team_lead", teamId: team.id, agentId: team.leadAgentId });
const instance: TeamInstanceView = { id: "group", name: "实际验收群", rootConversationId: lead.id, teamId: team.id,
  scope: "global", sourceConversationId: null, projectId: null, isArchived: false, createdAt: "2026-10-19T01:00:00Z", updatedAt: "2026-10-19T01:00:00Z" };
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); });

it("keeps internal coordinator/subagent roots out of all ordinary lists, including archived and pinned", () => {
  const sessions = [navSession("visible", { projectId: "project", isPinned: true }),
    navSession("coordinator", { projectId: "project", isPinned: true, coordinationTeamInstanceId: "group" }),
    navSession("child", { projectId: "project", threadKind: "subagent", isPinned: true })];
  expect(getProjectSessions(sessions, "project").map(s => s.id)).toEqual(["visible"]);
  expect(getTemporarySessions(sessions.map(s => ({ ...s, projectId: null }))).map(s => s.id)).toEqual(["visible"]);
  expect(getPinnedSessions(sessions).map(s => s.id)).toEqual(["visible"]);
  expect(getArchivedSessions(sessions.map(s => ({ ...s, isArchived: true }))).map(s => s.id)).toEqual(["visible"]);
});

it("shows the actual team name and member identity without a template prefix or group suffix", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const agent = agents.find(a => a.id === team.leadAgentId)!;
  const member = { ...lead, title: `${agent.name} · ${instance.name}` };
  const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  act(() => root?.render(<TooltipProvider><ConversationPath session={member} sessions={[member]} instances={[instance]} project={null}
    agents={agents} teams={[team]} headingId="heading" /></TooltipProvider>));
  expect(node.textContent).toBe(`${instance.name}${agent.name}`);
  expect(node.querySelector(".agent-profile-avatar")).not.toBeNull();
});

it("adds the parent conversation to a subagent path and locates it without navigation", () => {
  const parent = navSession("parent", { title: "原始对话" });
  const child = navSession("child", { title: "执行代理", threadKind: "subagent", parentConversationId: parent.id });
  const locate = vi.fn(); const node = document.createElement("div"); document.body.append(node); root = createRoot(node);
  act(() => root?.render(<TooltipProvider><ConversationPath session={child} sessions={[parent, child]} instances={[]} project={null}
    agents={agents} teams={[]} headingId="heading" onLocateSession={locate} /></TooltipProvider>));
  expect(node.textContent).toBe("临时对话原始对话执行代理");
  act(() => node.querySelector<HTMLButtonElement>('[aria-label="在左侧定位对话 原始对话"]')?.click());
  expect(locate).toHaveBeenCalledWith(parent.id);
});

it("keeps persistent team member activity on that member and hides background coordinators", () => {
  const member = navSession("member", { title: "需求分析师 · 实际验收群", teamId: team.id, parentConversationId: lead.id,
    hasUnreadResult: true, lastRunStatus: "completed" });
  const coordinator = navSession("coordinator", { coordinationTeamInstanceId: instance.id, hasUnreadResult: true });
  const rows = conversationActivityRows([lead, member, coordinator], {});
  expect(rows.map(row => row.session.id)).toEqual([member.id]);
  expect(conversationIdentity(member, agents, [instance], [lead, member]).title).toBe("需求分析师");
});

it("deduplicates a conversation and uses its latest unread timestamp", () => {
  const old = navSession("same", { hasUnreadResult: true, updatedAt: "2026-10-19T01:00:00Z" });
  const latest = { ...old, updatedAt: "2026-10-19T02:00:00Z" };
  expect(conversationActivityRows([old, latest], {})).toMatchObject([{ session: latest, updatedAt: latest.updatedAt }]);
  expect(conversationActivityRows([old, latest], {})).toHaveLength(1);
});
