// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ConversationRunEvent, ConversationSummary } from "@agent/protocol";

import type { AgentClient } from "../../runtime/index.js";
import { useProjectSessions } from "./use-project-sessions.js";
import { ConversationActivity } from "../chat/conversation-activity.js";

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
  it("opens and acknowledges the unread Team member represented by a read Lead's activity row", async () => {
    const lead = { ...createConversation(), title: "Team Lead · 默认团队", threadKind: "team_lead" as const, teamWorkItemId: crypto.randomUUID() };
    const member = { ...createConversation(crypto.randomUUID()), title: "前端开发 · 默认团队", parentConversationId: lead.id,
      teamWorkItemId: lead.teamWorkItemId, hasUnreadResult: true, lastRunStatus: "completed" as const };
    const live = { ...createConversation(crypto.randomUUID()), title: "正在执行的对话", activeRunId: crypto.randomUUID(), lastRunStatus: "running" as const };
    const mark = vi.fn((input: { conversationId: string }) => Promise.resolve({
      ...[lead, member, live].find((conversation) => conversation.id === input.conversationId)!, hasUnreadResult: false,
    }));
    const client = {
      listConversationHierarchy: () => Promise.resolve([lead, member, live]),
      listConversationTimelinePage: () => Promise.resolve({ items: [], hasMore: false, nextBeforeSequence: null }),
      markConversationResultViewed: mark, onConversationRunEvent: () => () => {},
    } as unknown as AgentClient;
    const navigate = vi.fn();
    let controller!: ReturnType<typeof useProjectSessions>;
    function Harness(): ReactElement {
      controller = useProjectSessions(client, null);
      return <ConversationActivity agentClient={client} projects={[]} sessions={controller.sessions}
        onSelect={(id, _itemId, ownerId?: string) => {
          navigate(id, ownerId);
          controller.selectSession(ownerId ?? id);
          if (ownerId !== undefined) controller.markSessionResultViewed(id, true);
        }} />;
    }
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => { root?.render(<Harness />); await Promise.resolve(); });
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    const row = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes(lead.title));
    await act(async () => { row?.click(); await Promise.resolve(); });
    expect(navigate).toHaveBeenCalledExactlyOnceWith(member.id, lead.id);
    expect(mark).toHaveBeenCalledExactlyOnceWith({ conversationId: member.id });
    expect(controller.activeSessionId).toBe(lead.id);
    expect(controller.sessions.find(({ id }) => id === member.id)?.hasUnreadResult).toBe(false);
    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("对话动态，0 个未读");
    act(() => container.querySelector<HTMLButtonElement>("button")?.click());
    expect(document.body.textContent).not.toContain(lead.title);
    expect(document.body.textContent).toContain(live.title);
  });

  it("marks only the visible conversation when the caller requests selected-only acknowledgement", async () => {
    const parent = { ...createConversation(), hasUnreadResult: true, lastRunStatus: "completed" as const };
    const side = { ...createConversation(crypto.randomUUID()), parentConversationId: parent.id, hasUnreadResult: true, lastRunStatus: "completed" as const };
    const mark = vi.fn((input: { conversationId: string }) => Promise.resolve({
      ...[parent, side].find((conversation) => conversation.id === input.conversationId)!, hasUnreadResult: false,
    }));
    const client = {
      listConversationHierarchy: () => Promise.resolve([parent, side]),
      markConversationResultViewed: mark,
      onConversationRunEvent: () => () => {},
    } as unknown as AgentClient;
    let controller!: ReturnType<typeof useProjectSessions>;
    function Harness(): null { controller = useProjectSessions(client, null); return null; }
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => { root?.render(<Harness />); await Promise.resolve(); });
    await act(async () => { controller.markSessionResultViewed(side.id, true); await Promise.resolve(); });
    expect(mark).toHaveBeenCalledExactlyOnceWith({ conversationId: side.id });
    expect(controller.sessions.find((session) => session.id === parent.id)?.hasUnreadResult).toBe(true);
    expect(controller.sessions.find((session) => session.id === side.id)?.hasUnreadResult).toBe(false);
  });

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
