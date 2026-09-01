import { describe, expect, it, vi } from "vitest";

import type {
  ConversationRunEvent,
  ConversationSummary,
  ModelReasoningOption,
} from "@agent/protocol";

import {
  isAutoOpenedSideConversation,
  shouldDeleteSidebarChat,
  shouldLoadSideConversations,
  nextTerminalTabName,
  nextWorkspaceTabName,
  scrollWorkspaceTabsOnWheel,
  updateSideSessionsForRunEvent,
  upsertSideSession,
} from "./right-sidebar-workspace.js";

const PROVIDER_ID = "00000000-0000-4000-8000-000000000001";
const PARENT_ID = "00000000-0000-4000-8000-000000000002";

function sideConversation(
  id: string,
  modelId: string,
  reasoning: ModelReasoningOption,
): ConversationSummary {
  const now = "2026-08-27T00:00:00.000Z";
  return {
    activeSubagentCount: 0,
    activeRunId: null,
    agentId: null,
    archivedAt: null,
    createdAt: now,
    hasUnreadResult: false,
    id,
    isArchived: false,
    isPinned: false,
    lastRunStatus: null,
    modelSelection: {
      modelId,
      providerId: PROVIDER_ID,
      reasoning,
    },
    parentConversationId: PARENT_ID,
    pinOrder: null,
    projectId: null,
    teamId: null,
    teamWorkItemId: null,
    threadKind: "agent",
    title: "侧边聊天",
    updatedAt: now,
    workspaceRootPath: null,
  };
}

describe("right sidebar side session state", () => {
  const teamLead = {
    ...sideConversation(PARENT_ID, "model-a", { kind: "effort", value: "medium" }),
    agentId: "team-lead",
    parentConversationId: null,
    teamId: "default-team",
    threadKind: "team_lead" as const,
    title: "Team Lead · 默认团队",
  };
  const team = {
    id: "default-team",
    leadAgentId: "team-lead",
    memberIds: ["team-lead", "requirements-analyst"],
  };

  it("does not treat a Team Lead's durable member as a side chat", () => {
    const member = {
      ...sideConversation("00000000-0000-4000-8000-000000000005", "model-a", {
        kind: "effort",
        value: "medium",
      }),
      agentId: "requirements-analyst",
      teamId: "default-team",
      title: "需求分析师 · 默认团队",
    };

    expect(isAutoOpenedSideConversation(member, teamLead, team)).toBe(false);
    expect(shouldDeleteSidebarChat(member, teamLead, team)).toBe(false);
  });

  it("keeps a Team Lead's manually created side chat as an ordinary side chat", () => {
    const sideChat = {
      ...sideConversation("00000000-0000-4000-8000-000000000006", "model-a", {
        kind: "effort",
        value: "medium",
      }),
      agentId: "team-lead",
      teamId: "default-team",
    };

    expect(isAutoOpenedSideConversation(sideChat, teamLead, team)).toBe(true);
    expect(shouldDeleteSidebarChat(sideChat, teamLead, team)).toBe(true);
  });

  it("only hides a managed team member when its side tab closes", () => {
    const managedMember = {
      ...sideConversation("00000000-0000-4000-8000-000000000005", "model-a", {
        kind: "effort",
        value: "medium",
      }),
      teamWorkItemId: "00000000-0000-4000-8000-000000000006",
      threadKind: "subagent" as const,
    };

    expect(shouldDeleteSidebarChat(managedMember)).toBe(false);
    expect(shouldDeleteSidebarChat(sideConversation("00000000-0000-4000-8000-000000000007", "model-a", {
      kind: "effort",
      value: "medium",
    }))).toBe(true);
  });

  it("does not try to load side chats for a managed Team WorkItem conversation", () => {
    const managedMember = {
      ...sideConversation("00000000-0000-4000-8000-000000000005", "model-a", {
        kind: "effort",
        value: "medium",
      }),
      teamWorkItemId: "00000000-0000-4000-8000-000000000006",
    };

    expect(shouldLoadSideConversations(managedMember)).toBe(false);
    expect(shouldLoadSideConversations(sideConversation("00000000-0000-4000-8000-000000000007", "model-a", {
      kind: "effort",
      value: "medium",
    }))).toBe(true);
  });

  it("keeps each side conversation model selection after another session changes", () => {
    const firstId = "00000000-0000-4000-8000-000000000003";
    const secondId = "00000000-0000-4000-8000-000000000004";
    const sessions = upsertSideSession(
      upsertSideSession([], sideConversation(firstId, "model-a", {
        kind: "effort",
        value: "high",
      })),
      sideConversation(secondId, "model-b", {
        kind: "effort",
        value: "low",
      }),
    );

    const updated = upsertSideSession(sessions, sideConversation(firstId, "model-c", {
      kind: "effort",
      value: "xhigh",
    }));

    expect(updated.find((session) => session.id === firstId)?.modelSelection).toMatchObject({
      modelId: "model-c",
      reasoning: { kind: "effort", value: "xhigh" },
    });
    expect(updated.find((session) => session.id === secondId)?.modelSelection).toMatchObject({
      modelId: "model-b",
      reasoning: { kind: "effort", value: "low" },
    });
  });

  it("keeps the side-session state stable for unrelated Agent tool events", () => {
    const sessions = upsertSideSession([], sideConversation(
      "00000000-0000-4000-8000-000000000003",
      "model-a",
      { kind: "effort", value: "high" },
    ));
    const event: ConversationRunEvent = {
      conversationId: PARENT_ID,
      runId: "00000000-0000-4000-8000-000000000010",
      tool: {
        arguments: "{}",
        batchId: null,
        conversationId: PARENT_ID,
        createdAt: "2026-08-30T00:00:00.000Z",
        diff: null,
        id: "00000000-0000-4000-8000-000000000009",
        kind: "tool",
        name: "list_agent_conversations",
        result: null,
        runId: "00000000-0000-4000-8000-000000000010",
        status: "running",
      },
      type: "tool.started",
    };

    expect(updateSideSessionsForRunEvent(sessions, event)).toBe(sessions);
  });
});

describe("right sidebar terminal tabs", () => {
  it("gives each new terminal in a project a distinct tab label", () => {
    expect(nextTerminalTabName([], "project-a")).toBe("终端");
    expect(nextTerminalTabName([
      { kind: "terminal", name: "终端", projectId: "project-a" },
      { kind: "terminal", name: "终端 (2)", projectId: "project-a" },
      { kind: "terminal", name: "终端", projectId: "project-b" },
    ], "project-a")).toBe("终端 (1)");
  });

  it("keeps an Agent-provided terminal label distinct from every open tab", () => {
    expect(nextWorkspaceTabName([
      { name: "构建日志" },
      { name: "构建日志 (1)" },
      { name: "README.md" },
    ], "构建日志")).toBe("构建日志 (2)");
  });
});

describe("right sidebar workspace tab scrolling", () => {
  it("converts a vertical wheel gesture into horizontal tab scrolling", () => {
    const preventDefault = vi.fn();
    const tabs = { clientWidth: 300, scrollLeft: 100, scrollWidth: 800 };

    scrollWorkspaceTabsOnWheel(tabs, {
      deltaMode: 0,
      deltaX: 0,
      deltaY: 120,
      preventDefault,
    });

    expect(tabs.scrollLeft).toBe(220);
    expect(preventDefault).toHaveBeenCalledOnce();
  });

  it("uses horizontal trackpad movement and clamps at the tab strip edges", () => {
    const preventDefault = vi.fn();
    const tabs = { clientWidth: 300, scrollLeft: 100, scrollWidth: 800 };

    scrollWorkspaceTabsOnWheel(tabs, {
      deltaMode: 0,
      deltaX: -160,
      deltaY: 20,
      preventDefault,
    });

    expect(tabs.scrollLeft).toBe(0);
    expect(preventDefault).toHaveBeenCalledOnce();

    preventDefault.mockClear();
    scrollWorkspaceTabsOnWheel(tabs, {
      deltaMode: 0,
      deltaX: -160,
      deltaY: 0,
      preventDefault,
    });

    expect(tabs.scrollLeft).toBe(0);
    expect(preventDefault).not.toHaveBeenCalled();
  });
});
