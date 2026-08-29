import { describe, expect, it } from "vitest";

import type { ConversationSummary, ModelReasoningOption } from "@agent/protocol";

import {
  shouldDeleteSidebarChat,
  nextTerminalTabName,
  nextWorkspaceTabName,
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
