// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TeamCollaborationProjection } from "@agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CollaborationGraph } from "./collaboration-graph.js";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

describe("CollaborationGraph", () => {
  it("renders planned and actual routes and opens a participant conversation", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onOpenConversation = vi.fn();
    act(() => root?.render(
      <CollaborationGraph
        onOpenConversation={onOpenConversation}
        projection={projectionFixture()}
        title="协作测试"
        variant="embedded"
      />,
    ));

    expect(container.textContent).toContain("协作测试");
    expect(container.textContent).toContain("计划 v1 · 2 条消息");
    expect(container.textContent).toContain("实现 · 2");
    expect(container.textContent).toContain("计划外");
    expect(container.querySelectorAll('[role="button"]')).toHaveLength(2);

    act(() => {
      container.querySelector<SVGGElement>('[aria-label^="开发 Agent"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(onOpenConversation).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000202",
    );
  });

  it("keeps the board mini graph free of headings and animated detail labels", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => root?.render(
      <CollaborationGraph projection={projectionFixture()} variant="mini" />,
    ));

    expect(container.textContent).not.toContain("计划 v1");
    expect(container.textContent).not.toContain("实现 · 2");
    expect(container.querySelectorAll("svg circle").length).toBeGreaterThan(0);
  });
});

function projectionFixture(): TeamCollaborationProjection {
  return {
    edges: [{
      firstActivityAt: "2026-08-31T08:01:00.000Z",
      fromNodeId: "lead",
      id: "route",
      lastActivityAt: "2026-08-31T08:02:00.000Z",
      messageCount: 2,
      messageTypes: {
        agent_result: 1,
        message: 1,
        notification: 0,
        task_result: 0,
      },
      purposes: ["实现"],
      state: "observed",
      toNodeId: "member",
      unreadCount: 1,
    }],
    nodes: [{
      agentId: "lead",
      conversationId: "00000000-0000-4000-8000-000000000201",
      id: "lead",
      kind: "team_lead",
      name: "Team Lead",
      position: { x: 120, y: 90 },
      role: "负责人",
      runStatus: "running",
      taskIds: [],
    }, {
      agentId: "developer",
      conversationId: "00000000-0000-4000-8000-000000000202",
      id: "member",
      kind: "standing",
      name: "开发 Agent",
      position: { x: 360, y: 90 },
      role: "开发",
      runStatus: "completed",
      taskIds: [],
    }],
    plan: {
      activatedAt: "2026-08-31T08:00:00.000Z",
      createdAt: "2026-08-31T08:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000203",
      reason: "协作测试",
      revision: 1,
      status: "active",
    },
    summary: {
      adHocRouteCount: 0,
      lastActivityAt: "2026-08-31T08:02:00.000Z",
      messageCount: 2,
      observedRouteCount: 1,
      participantCount: 2,
      plannedRouteCount: 1,
    },
    workItemId: "00000000-0000-4000-8000-000000000204",
  };
}
