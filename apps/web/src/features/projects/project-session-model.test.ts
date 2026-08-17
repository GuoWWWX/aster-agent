import { describe, expect, it } from "vitest";

import {
  createProjectSession,
  getArchivedSessions,
  getPinnedSessions,
  getProjectSessions,
  getSubagentSessions,
  getTemporarySessions,
  type ProjectSession,
} from "./project-session-model.js";

describe("project session model", () => {
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
      activeRunId: null,
      agentId: null,
      hasUnreadResult: false,
      id: "temporary-session",
      isArchived: false,
      isPinned: false,
      lastRunStatus: null,
      parentConversationId: null,
      pinOrder: null,
      projectId: null,
      teamId: null,
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
  });
});
