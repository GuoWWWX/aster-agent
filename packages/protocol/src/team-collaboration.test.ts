import { describe, expect, it } from "vitest";

import {
  setTeamCollaborationPlanInputSchema,
  teamCollaborationProjectionSchema,
} from "./team-collaboration.js";

const leadConversationId = "00000000-0000-4000-8000-000000000101";
const memberConversationId = "00000000-0000-4000-8000-000000000102";

describe("Team collaboration protocol", () => {
  it("accepts a bounded plan and rejects duplicate directed routes", () => {
    const plan = {
      createdByConversationId: leadConversationId,
      reason: "先实现，再回传结果。",
      routes: [{
        fromConversationId: leadConversationId,
        purpose: "分派实现",
        toConversationId: memberConversationId,
      }],
    };
    expect(setTeamCollaborationPlanInputSchema.parse(plan)).toEqual(plan);
    expect(() => setTeamCollaborationPlanInputSchema.parse({
      ...plan,
      routes: [...plan.routes, ...plan.routes],
    })).toThrow("at most one directed route");
    expect(() => setTeamCollaborationPlanInputSchema.parse({
      ...plan,
      routes: [{
        fromConversationId: leadConversationId,
        purpose: "错误自连接",
        toConversationId: leadConversationId,
      }],
    })).toThrow("different conversations");
  });

  it("validates the renderer projection without message bodies", () => {
    const projection = teamCollaborationProjectionSchema.parse({
      edges: [{
        firstActivityAt: "2026-08-31T08:01:00.000Z",
        fromNodeId: "lead",
        id: "lead:member",
        lastActivityAt: "2026-08-31T08:01:00.000Z",
        messageCount: 1,
        messageTypes: {
          agent_result: 0,
          message: 1,
          notification: 0,
          task_result: 0,
        },
        purposes: ["分派实现"],
        state: "observed",
        toNodeId: "member",
        unreadCount: 1,
      }],
      nodes: [{
        agentId: "team-lead",
        conversationId: leadConversationId,
        id: "lead",
        kind: "team_lead",
        name: "Team Lead",
        position: { x: 120, y: 90 },
        role: "负责人",
        runStatus: "running",
        taskIds: [],
      }, {
        agentId: "developer",
        conversationId: memberConversationId,
        id: "member",
        kind: "standing",
        name: "开发 Agent",
        position: { x: 360, y: 90 },
        role: "开发",
        runStatus: "queued",
        taskIds: [],
      }],
      plan: {
        activatedAt: "2026-08-31T08:00:00.000Z",
        createdAt: "2026-08-31T08:00:00.000Z",
        id: "00000000-0000-4000-8000-000000000103",
        reason: "先实现，再回传结果。",
        revision: 1,
        status: "active",
      },
      summary: {
        adHocRouteCount: 0,
        lastActivityAt: "2026-08-31T08:01:00.000Z",
        messageCount: 1,
        observedRouteCount: 1,
        participantCount: 2,
        plannedRouteCount: 1,
      },
      workItemId: "00000000-0000-4000-8000-000000000104",
    });
    expect(projection.edges[0]?.state).toBe("observed");
    expect("content" in projection.edges[0]!).toBe(false);
  });
});
