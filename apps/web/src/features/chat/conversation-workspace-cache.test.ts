import { describe, expect, it } from "vitest";

import type { ProjectSession } from "../projects/project-session-model.js";
import {
  CONVERSATION_WORKSPACE_CACHE_MAX_RETAINED,
  CONVERSATION_WORKSPACE_CACHE_TTL_MS,
  conversationWorkspaceSessions,
  retainConversationWorkspace,
  type ConversationWorkspaceCacheEntry,
} from "./conversation-workspace-cache.js";

function session(id: string, title = id): ProjectSession {
  return {
    activeRunId: null,
    agentId: null,
    hasUnreadResult: false,
    id,
    isArchived: false,
    isPinned: false,
    lastRunStatus: null,
    modelSelection: null,
    parentConversationId: null,
    projectId: null,
    teamId: null,
    threadKind: "agent",
    title,
    workspaceRootPath: null,
  };
}

describe("conversation workspace cache", () => {
  it("renders a newly selected conversation before the cache effect runs", () => {
    const sessions = conversationWorkspaceSessions([
      { lastAccessedAt: 10, session: session("previous") },
    ], session("selected"));

    expect(sessions.map((item) => item.id)).toEqual(["selected", "previous"]);
  });

  it("does not render a cached conversation that is no longer available", () => {
    const sessions = conversationWorkspaceSessions([
      { lastAccessedAt: 20, session: session("available") },
      { lastAccessedAt: 10, session: session("deleted") },
    ], null, new Set(["available"]));

    expect(sessions.map((item) => item.id)).toEqual(["available"]);
  });

  it("keeps the active conversation visible while the available-session snapshot catches up", () => {
    const sessions = conversationWorkspaceSessions([], session("deleted"), new Set());

    expect(sessions.map((item) => item.id)).toEqual(["deleted"]);
  });

  it("keeps a revisited conversation instance at the front with current metadata", () => {
    const entries: ConversationWorkspaceCacheEntry[] = [
      { lastAccessedAt: 10, session: session("first", "旧标题") },
      { lastAccessedAt: 20, session: session("second") },
    ];

    const retained = retainConversationWorkspace(entries, session("first", "新标题"), 30);

    expect(retained.map((entry) => entry.session.title)).toEqual(["新标题", "second"]);
    expect(retained[0]?.lastAccessedAt).toBe(30);
  });

  it("keeps only the most recent cached conversations", () => {
    const entries = Array.from({ length: 10 }, (_, index) => ({
      lastAccessedAt: 1_000 - index,
      session: session(`recent-${index}`),
    }));

    const retained = retainConversationWorkspace(entries, session("active"), 2_000);

    expect(retained).toHaveLength(CONVERSATION_WORKSPACE_CACHE_MAX_RETAINED);
    expect(retained.map((entry) => entry.session.id)).toEqual([
      "active",
      "recent-0",
      "recent-1",
      "recent-2",
      "recent-3",
      "recent-4",
      "recent-5",
      "recent-6",
    ]);
  });

  it("evicts every inactive conversation after the ttl", () => {
    const now = CONVERSATION_WORKSPACE_CACHE_TTL_MS + 100;
    const active = session("active");
    const retained = retainConversationWorkspace([
      { lastAccessedAt: 0, session: active },
      { lastAccessedAt: 0, session: session("second") },
      { lastAccessedAt: 0, session: session("third") },
      { lastAccessedAt: 0, session: session("expired") },
    ], active, now);

    expect(retained.map((entry) => entry.session.id)).toEqual(["active"]);
  });

  it("retains a recently accessed conversation while evicting older pages", () => {
    const now = CONVERSATION_WORKSPACE_CACHE_TTL_MS + 100;
    const entries = [
      { lastAccessedAt: 0, session: session("first") },
      { lastAccessedAt: 0, session: session("second") },
      { lastAccessedAt: 0, session: session("third") },
      { lastAccessedAt: now - 1_000, session: session("recent") },
    ];

    const retained = retainConversationWorkspace(entries, null, now);

    expect(retained.map((entry) => entry.session.id)).toEqual(["recent"]);
  });

  it("protects every conversation represented by an open titlebar tab", () => {
    const now = CONVERSATION_WORKSPACE_CACHE_TTL_MS + 100;
    const entries = Array.from({ length: 10 }, (_, index) => ({
      lastAccessedAt: index === 9 ? now - 1_000 : 0,
      session: session(`conversation-${index}`),
    }));

    const retained = retainConversationWorkspace(
      entries,
      null,
      now,
      new Set(["conversation-0", "conversation-8"]),
    );

    expect(retained.map((entry) => entry.session.id)).toEqual([
      "conversation-0",
      "conversation-8",
      "conversation-9",
    ]);
  });
});
