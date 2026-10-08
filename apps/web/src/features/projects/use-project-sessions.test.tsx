// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationRunEvent, ConversationSummary } from "@agent/protocol";

import type { AgentClient } from "../../runtime/index.js";
import { useProjectSessions } from "./use-project-sessions.js";

let root: Root | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("useProjectSessions", () => {
  it("loads the complete conversation hierarchy through one client request", async () => {
    const conversations = [
      createConversation("00000000-0000-4000-8000-000000000001"),
      createConversation("00000000-0000-4000-8000-000000000002"),
      createConversation("00000000-0000-4000-8000-000000000003"),
    ];
    const listConversationHierarchy = vi.fn(() => Promise.resolve(conversations));
    const client = {
      listConversationHierarchy,
      onConversationRunEvent: vi.fn(() => () => {}),
    } as unknown as AgentClient;

    function Harness(): null {
      useProjectSessions(client, null);
      return null;
    }

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => { root?.render(<Harness />); });
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });

    expect(listConversationHierarchy).toHaveBeenCalledTimes(1);
  });

  it("refreshes the session list when a run event references an unknown conversation", async () => {
    const conversation = createConversation();
    let conversations: ConversationSummary[] = [];
    let emit: ((event: ConversationRunEvent) => void) | null = null;
    const listConversationHierarchy = vi.fn(() => Promise.resolve(conversations));
    const client = {
      listConversationForks: vi.fn(() => Promise.resolve([])),
      listConversationHierarchy,
      onConversationRunEvent(listener: (event: ConversationRunEvent) => void) {
        emit = listener;
        return () => { emit = null; };
      },
    } as unknown as AgentClient;

    function Harness(): null {
      useProjectSessions(client, null);
      return null;
    }

    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => {
      root?.render(<Harness />);
    });
    await act(async () => { await Promise.resolve(); });
    expect(listConversationHierarchy).toHaveBeenCalledTimes(1);

    conversations = [conversation];
    act(() => {
      emit?.({
        conversationId: conversation.id,
        modelId: "gpt-5.6-luna",
        runId: "9aebec3e-5de5-4c63-b38d-58292cd064ed",
        type: "run.started",
      });
    });
    await act(async () => { await Promise.resolve(); });

    expect(listConversationHierarchy).toHaveBeenCalledTimes(2);
  });
});

function createConversation(id = "2e5b4e34-f4cc-46ff-95c8-9cdf52b41c1b"): ConversationSummary {
  return {
    activeSubagentCount: 0,
    activeRunId: null,
    agentId: null,
    archivedAt: null,
    createdAt: "2026-09-13T00:00:00.000Z",
    hasUnreadResult: false,
    id,
    isArchived: false,
    isPinned: false,
    lastRunStatus: null,
    modelSelection: null,
    parentConversationId: null,
    projectId: null,
    teamId: null,
    teamWorkItemId: null,
    threadKind: "agent",
    title: "后台会话",
    updatedAt: "2026-09-13T00:00:00.000Z",
    workspaceRootPath: null,
  };
}
