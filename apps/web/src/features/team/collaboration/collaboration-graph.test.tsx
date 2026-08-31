// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TeamCollaborationProjection } from "@agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyCollaborationAssistantDelta,
  CollaborationGraph,
} from "./collaboration-graph.js";

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
    expect(container.textContent).not.toContain("实现 · 2");
    expect(container.textContent).toContain("计划外");
    expect(container.textContent).toContain("正在检查代码细节");
    expect(container.querySelector('[data-agent-icon="code"]')).not.toBeNull();
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

  it("stops an observed route animation when its sender is no longer running", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const projection = projectionFixture();

    act(() => root?.render(
      <CollaborationGraph projection={projection} variant="conversation" />,
    ));
    expect(container.querySelector('svg path[marker-end]')?.getAttribute("class"))
      .toContain("animation:team-collaboration-flow");

    projection.nodes[0]!.runStatus = "completed";
    act(() => root?.render(
      <CollaborationGraph projection={projection} variant="conversation" />,
    ));
    const stoppedRoute = container.querySelector<SVGPathElement>('svg path[marker-end]');
    expect(stoppedRoute?.getAttribute("class")).not.toContain("animation:team-collaboration-flow");
  });

  it("draws reciprocal communication as parallel straight routes without visible labels", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const projection = projectionFixture();
    projection.edges = [
      ...projection.edges,
      {
        ...projection.edges[0]!,
        fromNodeId: "member",
        id: "return-route",
        messageCount: 1,
        purposes: ["结果回传"],
        toNodeId: "lead",
      },
    ];
    act(() => root?.render(
      <CollaborationGraph projection={projection} variant="conversation" />,
    ));

    const routes = [...container.querySelectorAll<SVGPathElement>("svg path[marker-end]")];
    const routePaths = routes.map((route) => route.getAttribute("d"));
    const visibleSvgText = [...container.querySelectorAll<SVGTextElement>("svg text")]
      .map((node) => node.textContent)
      .join(" ");
    expect(routes).toHaveLength(2);
    expect(routePaths.every((path) => path?.includes(" L "))).toBe(true);
    expect(routePaths.every((path) => !path?.includes(" C "))).toBe(true);
    expect(new Set(routePaths)).toHaveLength(2);
    expect(visibleSvgText).not.toContain("实现");
    expect(visibleSvgText).not.toContain("结果回传");
  });

  it("replaces an older output when a new Run starts streaming and then appends deltas", () => {
    const projection = projectionFixture();
    const first = applyCollaborationAssistantDelta(projection, {
      conversationId: "00000000-0000-4000-8000-000000000202",
      delta: "开始处理",
      messageId: "00000000-0000-4000-8000-000000000211",
      modelId: "test-model",
      runId: "00000000-0000-4000-8000-000000000212",
      type: "assistant.delta",
    });
    const second = applyCollaborationAssistantDelta(first, {
      conversationId: "00000000-0000-4000-8000-000000000202",
      delta: "，正在验证。",
      messageId: "00000000-0000-4000-8000-000000000211",
      modelId: "test-model",
      runId: "00000000-0000-4000-8000-000000000212",
      type: "assistant.delta",
    });

    expect(second.nodes[1]).toMatchObject({
      latestOutput: "开始处理，正在验证。",
      latestOutputRunId: "00000000-0000-4000-8000-000000000212",
    });
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
      avatarIcon: "crown",
      conversationId: "00000000-0000-4000-8000-000000000201",
      id: "lead",
      kind: "team_lead",
      latestOutput: null,
      latestOutputRunId: null,
      name: "Team Lead",
      position: { x: 120, y: 90 },
      role: "负责人",
      runStatus: "running",
      taskIds: [],
    }, {
      agentId: "developer",
      avatarIcon: "code",
      conversationId: "00000000-0000-4000-8000-000000000202",
      id: "member",
      kind: "standing",
      latestOutput: "正在检查代码细节",
      latestOutputRunId: "00000000-0000-4000-8000-000000000210",
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
