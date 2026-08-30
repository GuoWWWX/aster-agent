import { describe, expect, it } from "vitest";

import {
  aggregateSideConversationState,
  createProjectSession,
  getArchivedSessions,
  getPinnedSessions,
  getProjectSessions,
  getSubagentSessions,
  getTemporarySessions,
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
});
