// @vitest-environment jsdom

import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { TeamCollaborationProjection } from "@agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { TooltipProvider } from "../../../components/ui/tooltip.js";
import type { AgentClient } from "../../../runtime/agent-client.js";
import {
  applyCollaborationAssistantDelta,
  CollaborationGraph,
  CollaborationProjectionGraph,
} from "./collaboration-graph.js";

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function renderGraph(graph: ReactElement): void {
  root?.render(<TooltipProvider>{graph}</TooltipProvider>);
}

describe("CollaborationGraph", () => {
  it("renders a single route treatment and opens a participant conversation", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onOpenConversation = vi.fn();
    act(() => renderGraph(
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
    expect(container.textContent).not.toContain("计划路线");
    expect(container.textContent).not.toContain("已发生");
    expect(container.textContent).not.toContain("计划外");
    expect(container.textContent).toContain("2 个 Agent · 1 条活跃路线");
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

  it("navigates to the full Agent conversation when Ctrl-clicking a participant", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onOpenConversation = vi.fn();
    const onNavigateToConversation = vi.fn();
    act(() => renderGraph(
      <CollaborationGraph
        onNavigateToConversation={onNavigateToConversation}
        onOpenConversation={onOpenConversation}
        projection={projectionFixture()}
        variant="embedded"
      />,
    ));

    act(() => {
      container.querySelector<SVGGElement>('[aria-label^="开发 Agent"]')?.dispatchEvent(
        new MouseEvent("click", { bubbles: true, ctrlKey: true }),
      );
    });

    expect(onNavigateToConversation).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000202",
    );
    expect(onOpenConversation).not.toHaveBeenCalled();
  });

  it("preserves side opening and direct navigation through the loaded projection graph", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const projection = projectionFixture();
    const onOpenConversation = vi.fn();
    const onNavigateToConversation = vi.fn();
    const agentClient = {
      getTeamCollaborationProjection: vi.fn(() => Promise.resolve(projection)),
      onConversationRunEvent: vi.fn(() => () => undefined),
    } as unknown as AgentClient;

    await act(async () => {
      renderGraph(
        <CollaborationProjectionGraph
          agentClient={agentClient}
          onNavigateToConversation={onNavigateToConversation}
          onOpenConversation={onOpenConversation}
          variant="conversation"
          workItemId={projection.workItemId}
        />,
      );
      await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    });

    const member = container.querySelector<SVGGElement>('[aria-label^="开发 Agent"]');
    expect(member).not.toBeNull();
    act(() => {
      member?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      member?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    });
    expect(onOpenConversation).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000202",
    );
    expect(onNavigateToConversation).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000202",
    );

    act(() => {
      member?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 120,
        clientY: 80,
      }));
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.textContent).toContain("在侧边打开");
    expect(menu?.textContent).toContain("跳转到 Agent 对话");
  });

  it("offers side opening and direct navigation from an Agent node context menu", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const onOpenConversation = vi.fn();
    const onNavigateToConversation = vi.fn();
    act(() => renderGraph(
      <CollaborationGraph
        onNavigateToConversation={onNavigateToConversation}
        onOpenConversation={onOpenConversation}
        projection={projectionFixture()}
        variant="embedded"
      />,
    ));

    const member = container.querySelector<SVGGElement>('[aria-label^="开发 Agent"]');
    act(() => {
      member?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 120,
        clientY: 80,
      }));
    });
    const menu = document.querySelector<HTMLElement>('[role="menu"]');
    expect(menu?.textContent).toContain("在侧边打开");
    expect(menu?.textContent).toContain("跳转到 Agent 对话");

    act(() => {
      [...(menu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])]
        .find((button) => button.textContent?.includes("在侧边打开"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onOpenConversation).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000202",
    );

    act(() => {
      member?.dispatchEvent(new MouseEvent("contextmenu", {
        bubbles: true,
        clientX: 120,
        clientY: 80,
      }));
    });
    const reopenedMenu = document.querySelector<HTMLElement>('[role="menu"]');
    act(() => {
      [...(reopenedMenu?.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]') ?? [])]
        .find((button) => button.textContent?.includes("跳转到 Agent 对话"))
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(onNavigateToConversation).toHaveBeenCalledWith(
      "00000000-0000-4000-8000-000000000202",
    );
  });

  it("keeps the board mini graph free of headings and animated detail labels", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => renderGraph(
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

    act(() => renderGraph(
      <CollaborationGraph projection={projection} variant="conversation" />,
    ));
    expect(container.querySelector('svg path[marker-end]')?.getAttribute("class"))
      .toContain("animation:team-collaboration-flow");

    const completedProjection = {
      ...projection,
      nodes: projection.nodes.map((node) => node.id === "lead"
        ? { ...node, runStatus: "completed" as const }
        : node),
    };
    act(() => renderGraph(
      <CollaborationGraph projection={completedProjection} variant="conversation" />,
    ));
    const stoppedRoute = container.querySelector<SVGPathElement>('svg path[marker-end]');
    expect(stoppedRoute?.getAttribute("class")).not.toContain("animation:team-collaboration-flow");
  });

  it("keeps a historical route static when a reused Agent conversation runs a later WorkItem", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const historicalProjection = {
      ...projectionFixture(),
      isLive: false,
    };

    act(() => renderGraph(
      <CollaborationGraph projection={historicalProjection} variant="conversation" />,
    ));

    expect(container.querySelector('svg path[marker-end]')?.getAttribute("class"))
      .not.toContain("animation:team-collaboration-flow");
  });

  it("keeps inactive ad-hoc communication neutral instead of treating it as an error", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const projection = projectionFixture();
    projection.isLive = false;
    projection.edges = projection.edges.map((edge) => ({ ...edge, state: "ad_hoc" }));

    act(() => renderGraph(
      <CollaborationGraph projection={projection} variant="conversation" />,
    ));

    const route = container.querySelector<SVGPathElement>("svg path[marker-end]");
    expect(route?.getAttribute("class")).toContain("stroke-[var(--app-muted-foreground)]");
    expect(route?.getAttribute("class")).not.toContain("stroke-[var(--app-destructive)]");
    expect(route?.getAttribute("marker-end")).toContain("normal");
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
    act(() => renderGraph(
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
    expect(container.querySelector('[data-variant="conversation"]')?.getAttribute("class"))
      .toContain("w-[min(960px,calc(100%-12px))]");
    expect(visibleSvgText).not.toContain("实现");
    expect(visibleSvgText).not.toContain("结果回传");
  });

  it("lays a staged collaboration left-to-right and curves the long return to Team Lead", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const projection = projectionFixture();
    const architect = {
      ...projection.nodes[1]!,
      id: "architect",
      name: "架构师",
      position: { x: 40, y: -80 },
    };
    const tester = {
      ...projection.nodes[1]!,
      id: "tester",
      name: "测试工程师",
      position: { x: 40, y: 80 },
    };
    projection.nodes = [projection.nodes[0]!, projection.nodes[1]!, architect, tester];
    projection.edges = [
      projection.edges[0]!,
      {
        ...projection.edges[0]!,
        fromNodeId: "member",
        id: "member-to-architect",
        toNodeId: "architect",
      },
      {
        ...projection.edges[0]!,
        fromNodeId: "architect",
        id: "architect-to-tester",
        toNodeId: "tester",
      },
      {
        ...projection.edges[0]!,
        fromNodeId: "tester",
        id: "tester-to-lead",
        toNodeId: "lead",
      },
    ];
    act(() => renderGraph(
      <CollaborationGraph projection={projection} variant="conversation" />,
    ));

    expect(container.querySelector('[data-agent-node="lead"]')?.getAttribute("transform"))
      .toBe("translate(0 0)");
    expect(container.querySelector('[data-agent-node="member"]')?.getAttribute("transform"))
      .toBe("translate(240 0)");
    expect(container.querySelector('[data-agent-node="architect"]')?.getAttribute("transform"))
      .toBe("translate(480 0)");
    expect(container.querySelector('[data-agent-node="tester"]')?.getAttribute("transform"))
      .toBe("translate(720 0)");
    const paths = [...container.querySelectorAll<SVGPathElement>("svg path[marker-end]")];
    expect(paths.slice(0, 3).every((path) => path.getAttribute("d")?.includes(" L "))).toBe(true);
    expect(paths[3]?.getAttribute("d")).toContain(" C ");
  });

  it("zooms the canvas only for Ctrl-wheel while it is hovered", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => renderGraph(
      <CollaborationGraph projection={projectionFixture()} variant="conversation" />,
    ));

    const canvas = container.querySelector<HTMLElement>("[data-collaboration-canvas]");
    const svg = canvas?.querySelector("svg");
    mockCanvasBounds(canvas);
    const initialViewBox = svg?.getAttribute("viewBox");
    act(() => {
      canvas?.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        clientX: 450,
        clientY: 120,
        ctrlKey: true,
        deltaY: -120,
      }));
    });
    expect(canvas?.getAttribute("data-zoom")).toBe("1.10");
    expect(svg?.getAttribute("viewBox")).not.toBe(initialViewBox);
    expect(viewBoxNumbers(svg?.getAttribute("viewBox"))[0])
      .toBeGreaterThan(viewBoxNumbers(initialViewBox)[0]!);

    act(() => {
      canvas?.dispatchEvent(new WheelEvent("wheel", {
        bubbles: true,
        deltaY: -120,
      }));
    });
    expect(canvas?.getAttribute("data-zoom")).toBe("1.10");
  });

  it("pans from blank canvas space and locates the full graph again", () => {
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    act(() => renderGraph(
      <CollaborationGraph projection={projectionFixture()} variant="conversation" />,
    ));

    const canvas = container.querySelector<HTMLElement>("[data-collaboration-canvas]");
    const svg = canvas?.querySelector("svg");
    mockCanvasBounds(canvas);
    const initialViewBox = svg?.getAttribute("viewBox");
    act(() => {
      canvas?.dispatchEvent(new MouseEvent("pointerdown", {
        bubbles: true,
        button: 0,
        clientX: 300,
        clientY: 120,
      }));
      canvas?.dispatchEvent(new MouseEvent("pointermove", {
        bubbles: true,
        button: 0,
        clientX: 360,
        clientY: 150,
      }));
      canvas?.dispatchEvent(new MouseEvent("pointerup", {
        bubbles: true,
        button: 0,
        clientX: 360,
        clientY: 150,
      }));
    });
    expect(svg?.getAttribute("viewBox")).not.toBe(initialViewBox);

    act(() => {
      container.querySelector<HTMLButtonElement>('button[aria-label="定位并适配协作图"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(canvas?.getAttribute("data-zoom")).toBe("1.00");
    expect(svg?.getAttribute("viewBox")).toBe(initialViewBox);
  });

  it("replaces an older output when a new Run starts streaming and then appends deltas", () => {
    const projection = projectionFixture();
    const first = applyCollaborationAssistantDelta(projection, {
      conversationId: "00000000-0000-4000-8000-000000000202",
      delta: "开始处理",
      messageId: "00000000-0000-4000-8000-000000000211",
      modelId: "test-model",
      runId: "00000000-0000-4000-8000-000000000212",
      teamWorkItemId: projection.workItemId,
      type: "assistant.delta",
    }, projection.workItemId);
    const second = applyCollaborationAssistantDelta(first, {
      conversationId: "00000000-0000-4000-8000-000000000202",
      delta: "，正在验证。",
      messageId: "00000000-0000-4000-8000-000000000211",
      modelId: "test-model",
      runId: "00000000-0000-4000-8000-000000000212",
      teamWorkItemId: projection.workItemId,
      type: "assistant.delta",
    }, projection.workItemId);

    expect(second.nodes[1]).toMatchObject({
      latestOutput: "开始处理，正在验证。",
      latestOutputRunId: "00000000-0000-4000-8000-000000000212",
    });
  });

  it("ignores a later WorkItem's assistant output on a historical graph", () => {
    const projection = projectionFixture();
    const updated = applyCollaborationAssistantDelta(projection, {
      conversationId: "00000000-0000-4000-8000-000000000202",
      delta: "后续任务的输出",
      messageId: "00000000-0000-4000-8000-000000000211",
      modelId: "test-model",
      runId: "00000000-0000-4000-8000-000000000212",
      teamWorkItemId: "00000000-0000-4000-8000-000000000213",
      type: "assistant.delta",
    }, projection.workItemId);

    expect(updated).toBe(projection);
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
    isLive: true,
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

function mockCanvasBounds(canvas: HTMLElement | null): void {
  if (canvas === null) throw new Error("Expected collaboration canvas.");
  Object.defineProperty(canvas, "getBoundingClientRect", {
    configurable: true,
    value: () => ({
      bottom: 300,
      height: 300,
      left: 0,
      right: 600,
      top: 0,
      width: 600,
      x: 0,
      y: 0,
    }),
  });
}

function viewBoxNumbers(viewBox: string | null | undefined): number[] {
  return (viewBox ?? "").split(" ").map(Number);
}
