import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";

import {
  aggregateSideConversationState,
  createProjectSession,
  getArchivedSessions,
  getPinnedSessions,
  getProjectSessions,
  getSubagentSessions,
  getTeamInstanceNavigatorGroups,
  getTemporarySessions,
  getTeamSharedMemberSession,
  getTeamNavigatorGroups,
  groupSubagentSessionsByParent,
  getSessionFamilyResultIds,
  updateSessionRunState,
  type ProjectSession,
} from "./project-session-model.js";

describe("project session model", () => {
  it("aggregates side conversation running and unread state into its parent", () => {
    const parent = createProjectSession("project-a", [], "parent");
    const runningSide: ProjectSession = {
      ...createProjectSession("project-a", [parent], "running-side"),
      activeRunId: "run-side",
      lastRunStatus: "running",
      parentConversationId: parent.id,
    };
    const completedSide: ProjectSession = {
      ...createProjectSession("project-a", [parent], "completed-side"),
      hasUnreadResult: true,
      lastRunStatus: "completed",
      parentConversationId: parent.id,
    };
    const failedSide: ProjectSession = {
      ...createProjectSession("project-a", [parent], "failed-side"),
      hasUnreadResult: true,
      lastRunStatus: "failed",
      parentConversationId: parent.id,
    };

    expect(aggregateSideConversationState([parent, runningSide, completedSide, failedSide])[0])
      .toMatchObject({
        activeSideConversationCount: 1,
        hasFailedUnreadSideConversationResult: true,
        hasUnreadSideConversationResult: true,
      });
  });

  it("does not keep a Team parent running after its member clears activeRunId", () => {
    const parent = createProjectSession("project-a", [], "parent");
    const member: ProjectSession = {
      ...createProjectSession("project-a", [parent], "member"),
      lastRunStatus: "running",
      parentConversationId: parent.id,
      teamId: "default-team",
      teamWorkItemId: "work-item-1",
      threadKind: "agent",
    };

    expect(aggregateSideConversationState([parent, member])[0])
      .toMatchObject({ activeSideConversationCount: 0 });
  });

  it("marks a completed run unread even when its conversation remains selected", () => {
    const session = createProjectSession("project-a", [], "session");
    const [running] = updateSessionRunState([session], {
      conversationId: session.id,
      modelId: "model",
      runId: "run-1",
      type: "run.started",
    });
    const [finished] = updateSessionRunState([running!], {
      agentError: null,
      conversationId: session.id,
      error: null,
      runId: "run-1",
      status: "completed",
      type: "run.finished",
    });

    expect(running).toMatchObject({ activeRunId: "run-1", hasUnreadResult: false });
    expect(finished).toMatchObject({ activeRunId: null, hasUnreadResult: true });
  });

  it("keeps the session collection stable for an unknown Agent run", () => {
    const sessions = [createProjectSession("project-a", [], "session")];

    expect(updateSessionRunState(sessions, {
      conversationId: "unknown-agent-conversation",
      modelId: "model",
      runId: "run-1",
      type: "run.started",
    })).toBe(sessions);
  });

  it("acknowledges the parent and ordinary side conversations as one result group", () => {
    const parent = createProjectSession("project-a", [], "parent");
    const side: ProjectSession = {
      ...createProjectSession("project-a", [parent], "side"),
      parentConversationId: parent.id,
    };
    const subagent: ProjectSession = {
      ...createProjectSession("project-a", [parent], "subagent"),
      parentConversationId: parent.id,
      threadKind: "subagent",
    };

    expect(getSessionFamilyResultIds([parent, side, subagent], side.id))
      .toEqual([parent.id, side.id]);
  });

  it("acknowledges every managed Team conversation when its source conversation is viewed", () => {
    const source = createProjectSession("project-a", [], "source");
    const lead: ProjectSession = {
      ...createProjectSession("project-a", [source], "lead"),
      parentConversationId: source.id,
      teamId: "default-team",
      teamWorkItemId: "work-item-1",
      threadKind: "team_lead",
    };
    const worker: ProjectSession = {
      ...createProjectSession("project-a", [source, lead], "worker"),
      parentConversationId: lead.id,
      teamId: "default-team",
      teamWorkItemId: "work-item-1",
      threadKind: "subagent",
    };

    expect(getSessionFamilyResultIds([source, lead, worker], source.id))
      .toEqual([source.id, lead.id, worker.id]);
    expect(getSessionFamilyResultIds([source, lead, worker], lead.id))
      .toEqual([lead.id]);
    expect(getSessionFamilyResultIds([source, lead, worker], worker.id))
      .toEqual([worker.id]);
  });

  it("keeps sessions scoped to their project", () => {
    const sessions: ProjectSession[] = [
      {
        activeRunId: null,
        agentId: null,
        hasUnreadResult: false,
        id: "session-a",
        isArchived: false,
        isPinned: false,
        lastRunStatus: null,
        modelSelection: null,
        parentConversationId: null,
        projectId: "project-a",
        teamId: null,
        threadKind: "agent",
        title: "需求梳理",
        workspaceRootPath: null,
      },
      {
        activeRunId: null,
        agentId: null,
        hasUnreadResult: false,
        id: "session-b",
        isArchived: false,
        isPinned: false,
        lastRunStatus: null,
        modelSelection: null,
        parentConversationId: null,
        projectId: "project-b",
        teamId: null,
        threadKind: "agent",
        title: "实现",
        workspaceRootPath: null,
      },
    ];

    expect(getProjectSessions(sessions, "project-a")).toEqual([
      {
        activeRunId: null,
        agentId: null,
        hasUnreadResult: false,
        id: "session-a",
        isArchived: false,
        isPinned: false,
        lastRunStatus: null,
        modelSelection: null,
        parentConversationId: null,
        projectId: "project-a",
        teamId: null,
        threadKind: "agent",
        title: "需求梳理",
        workspaceRootPath: null,
      },
    ]);
  });

  it("names new sessions relative to the current project", () => {
    const firstSession = createProjectSession("project-a", [], "session-a-1");
    const secondSession = createProjectSession(
      "project-a",
      [firstSession],
      "session-a-2",
    );
    const otherProjectSession = createProjectSession(
      "project-b",
      [firstSession, secondSession],
      "session-b-1",
    );

    expect(firstSession.title).toBe("新会话");
    expect(secondSession.title).toBe("新会话 2");
    expect(otherProjectSession.title).toBe("新会话");
  });

  it("keeps temporary sessions outside every project", () => {
    const temporarySession = createProjectSession(null, [], "temporary-session");
    const projectSession = createProjectSession(
      "project-a",
      [temporarySession],
      "project-session",
    );

    expect(temporarySession).toEqual({
      activeSubagentCount: 0,
      activeRunId: null,
      agentId: null,
      avatarIcon: null,
      hasUnreadResult: false,
      id: "temporary-session",
      isArchived: false,
      isPinned: false,
      lastRunStatus: null,
      modelSelection: null,
      parentConversationId: null,
      pinOrder: null,
      projectId: null,
      teamId: null,
      teamWorkItemId: null,
      threadKind: "agent",
      title: "新会话",
      workspaceRootPath: null,
    });
    expect(getTemporarySessions([temporarySession, projectSession])).toEqual([
      temporarySession,
    ]);
    expect(getProjectSessions([temporarySession, projectSession], "project-a")).toEqual([
      projectSession,
    ]);
  });

  it("keeps archived sessions separate and preserves stored pinned order", () => {
    const regular = createProjectSession("project-a", [], "regular");
    const pinnedFirst = {
      ...createProjectSession("project-a", [regular], "pinned"),
      isPinned: true,
      pinOrder: 1,
    };
    const pinnedSecond = {
      ...createProjectSession("project-a", [regular, pinnedFirst], "pinned-second"),
      isPinned: true,
      pinOrder: 2,
    };
    const archived = {
      ...createProjectSession("project-a", [regular, pinnedFirst, pinnedSecond], "archived"),
      isArchived: true,
    };

    expect(getProjectSessions(
      [regular, archived, pinnedSecond, pinnedFirst],
      "project-a",
    )).toEqual([
      pinnedSecond,
      pinnedFirst,
      regular,
    ]);
    expect(getPinnedSessions([regular, archived, pinnedSecond, pinnedFirst])).toEqual([
      pinnedSecond,
      pinnedFirst,
    ]);
    expect(getArchivedSessions([regular, archived, pinnedSecond, pinnedFirst])).toEqual([
      archived,
    ]);
  });

  it("keeps Subagents under their parent conversation instead of top-level groups", () => {
    const parent = createProjectSession("project-a", [], "parent");
    const sideConversation: ProjectSession = {
      ...createProjectSession("project-a", [parent], "side-conversation"),
      parentConversationId: parent.id,
      threadKind: "agent",
      title: "侧边聊天",
    };
    const subagent: ProjectSession = {
      ...createProjectSession("project-a", [parent], "subagent"),
      parentConversationId: parent.id,
      threadKind: "subagent",
      title: "检查测试覆盖",
    };

    expect(getProjectSessions([parent, subagent], "project-a")).toEqual([parent]);
    expect(getPinnedSessions([{ ...subagent, isPinned: true }])).toEqual([]);
    expect(getSubagentSessions([parent, sideConversation, subagent], parent.id)).toEqual([
      subagent,
    ]);
    expect(groupSubagentSessionsByParent([parent, sideConversation, subagent])).toEqual(
      new Map([[parent.id, [subagent]]]),
    );
  });

  it("keeps all managed Team members below their source conversation", () => {
    const source = createProjectSession("project-a", [], "source");
    const lead: ProjectSession = {
      ...createProjectSession("project-a", [source], "lead"),
      parentConversationId: source.id,
      teamId: "default-team",
      teamWorkItemId: "work-item-1",
      threadKind: "team_lead",
      title: "Team Lead · 实现需求",
    };
    const worker: ProjectSession = {
      ...createProjectSession("project-a", [source, lead], "worker"),
      parentConversationId: lead.id,
      teamId: "default-team",
      teamWorkItemId: "work-item-1",
      threadKind: "subagent",
      title: "实现 Agent",
    };

    expect(getProjectSessions([source, lead, worker], "project-a")).toEqual([source]);
    expect(groupSubagentSessionsByParent([source, lead, worker])).toEqual(
      new Map([[source.id, [lead, worker]]]),
    );
    expect(aggregateSideConversationState([{ ...source }, lead, {
      ...worker,
      activeRunId: "run-worker",
      lastRunStatus: "running",
    }])[0]).toMatchObject({ activeSideConversationCount: 1 });
  });

  it("builds one Team navigator reference for each conversation-scoped execution", () => {
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0]!;
    const configuredMembers = team.memberIds.map((memberId) =>
      DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents.find((agent) => agent.id === memberId)!,
    );
    const source = {
      ...createProjectSession("project-a", [], "source"),
      title: "实现登录页",
    };
    const lead: ProjectSession = {
      ...createProjectSession("project-a", [source], "lead"),
      parentConversationId: source.id,
      teamId: team.id,
      teamWorkItemId: "work-item-1",
      threadKind: "team_lead",
      title: "Team Lead · 实现登录页",
    };
    const worker: ProjectSession = {
      ...createProjectSession("project-a", [source, lead], "worker"),
      parentConversationId: lead.id,
      teamId: team.id,
      teamWorkItemId: "work-item-1",
      threadKind: "agent",
      title: "前端开发",
    };

    expect(getTeamNavigatorGroups(
      [team],
      [source, lead, worker],
      DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents,
    )).toEqual([{
      configuredMembers,
      dedicatedUsages: [{
        lead,
        members: [worker],
        sourceSession: source,
      }],
      sharedUsages: [],
      team,
    }]);
  });

  it("keeps shared Team conversations out of project and pinned conversation groups", () => {
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0]!;
    const configuredMembers = team.memberIds.map((memberId) =>
      DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents.find((agent) => agent.id === memberId)!,
    );
    const sharedLead: ProjectSession = {
      ...createProjectSession("project-a", [], "shared-lead"),
      isPinned: true,
      projectId: null,
      teamId: team.id,
      teamWorkItemId: null,
      threadKind: "team_lead",
      title: "Team Lead · 共享会话",
    };

    expect(getProjectSessions([sharedLead], "project-a")).toEqual([]);
    expect(getPinnedSessions([sharedLead])).toEqual([]);
    const [group] = getTeamNavigatorGroups(
      [team],
      [sharedLead],
      DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents,
    );
    expect(group).toEqual({
      configuredMembers,
      dedicatedUsages: [],
      sharedUsages: [{
        lead: sharedLead,
        members: [],
        sourceSession: null,
      }],
      team,
    });
    expect(getTeamSharedMemberSession(group!, team.leadAgentId)).toEqual(sharedLead);
    expect(getTeamSharedMemberSession(group!, "missing-agent")).toBeNull();
  });

  it("shows a project-scoped Team WorkItem as one project execution instance", () => {
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0]!;
    const executionLead: ProjectSession = {
      ...createProjectSession("project-a", [], "execution-lead"),
      teamId: team.id,
      teamWorkItemId: "work-item-1",
      threadKind: "team_lead",
      title: "Team Lead · 项目执行",
    };
    const architect: ProjectSession = {
      ...createProjectSession("project-a", [executionLead], "architect"),
      agentId: "solution-architect",
      parentConversationId: executionLead.id,
      teamId: team.id,
      teamWorkItemId: "work-item-1",
      threadKind: "agent",
      title: "架构师 · 默认团队",
    };

    const [group] = getTeamNavigatorGroups(
      [team],
      [executionLead, architect],
      DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents,
    );

    expect(group?.sharedUsages).toEqual([]);
    expect(group?.dedicatedUsages).toEqual([{
      lead: executionLead,
      members: [architect],
      sourceSession: null,
    }]);
    expect(getTeamSharedMemberSession(group!, "solution-architect")).toBeNull();
    expect(getTeamSharedMemberSession(group!, team.leadAgentId, "project-a"))
      .toEqual(executionLead);
    expect(getTeamSharedMemberSession(group!, "solution-architect", "project-a"))
      .toEqual(architect);
  });

  it("shows configured Teams even before they have a conversation", () => {
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0]!;
    const configuredMembers = team.memberIds.map((memberId) =>
      DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents.find((agent) => agent.id === memberId)!,
    );

    expect(getTeamNavigatorGroups(
      [team],
      [],
      DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents,
    )).toEqual([{
      configuredMembers,
      dedicatedUsages: [],
      sharedUsages: [],
      team,
    }]);
  });

  it("groups project Team instances under their project and keeps only used conversation members", () => {
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0]!;
    const source = createProjectSession("project-a", [], "source");
    const isolatedLead: ProjectSession = {
      ...createProjectSession("project-a", [source], "isolated-lead"),
      agentId: team.leadAgentId,
      parentConversationId: source.id,
      teamId: team.id,
      teamWorkItemId: "00000000-0000-4000-8000-000000000101",
      threadKind: "team_lead",
    };
    const usedMember: ProjectSession = {
      ...createProjectSession("project-a", [source, isolatedLead], "used-member"),
      agentId: "frontend-engineer",
      parentConversationId: isolatedLead.id,
      teamId: team.id,
      teamWorkItemId: isolatedLead.teamWorkItemId ?? null,
      threadKind: "agent",
    };
    const unusedMember: ProjectSession = {
      ...usedMember,
      id: "unused-member",
    };
    const workItem = {
      executionConversationId: isolatedLead.id,
      executionScope: "conversation" as const,
      id: isolatedLead.teamWorkItemId!,
      instanceName: "登录专项组",
      participantConversationIds: [isolatedLead.id, usedMember.id],
      projectId: "project-a",
      sourceConversationId: source.id,
      teamId: team.id,
    };

    const grouped = groupSubagentSessionsByParent(
      [source, isolatedLead, usedMember, unusedMember],
      [workItem],
    );
    expect(grouped.get(source.id)?.map((session) => session.id))
      .toEqual([isolatedLead.id, usedMember.id]);

    const instanceId = "00000000-0000-4000-8000-000000000102";
    const instanceGroups = getTeamInstanceNavigatorGroups(
      [{
        createdAt: "2026-08-30T00:00:00.000Z",
        id: instanceId,
        isArchived: false,
        name: "登录专项组",
        projectId: "project-a",
        rootConversationId: isolatedLead.id,
        scope: "conversation",
        sourceConversationId: source.id,
        teamId: team.id,
        updatedAt: "2026-08-30T00:00:00.000Z",
      }],
      [team],
      [source, isolatedLead, usedMember, unusedMember],
      DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents,
      [{
        participantConversationIds: [isolatedLead.id, usedMember.id],
        teamInstanceId: instanceId,
      }],
    );
    expect(instanceGroups[0]?.members.map(({ profile }) => profile.id)).toEqual([
      team.leadAgentId,
      "frontend-engineer",
    ]);
  });
});
