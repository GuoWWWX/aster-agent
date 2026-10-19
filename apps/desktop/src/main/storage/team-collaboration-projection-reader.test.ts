import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "./agent-database.js";
import { TeamCollaborationProjectionReader } from "./team-collaboration-projection-reader.js";

const databases: AgentDatabase[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture(start = true) {
  const database = new AgentDatabase(":memory:");
  databases.push(database);
  database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  const modelSelection = { modelId: "fixture", providerId: randomUUID(), reasoning: null };
  const workItem = database.createTeamWorkItem({
    acceptanceCriteria: [], executionScope: "project", modelSelection,
    permissionMode: "full_access", priority: "normal", projectId: null,
    requirement: "检查协作图的只读投影。", teamId: "default-team", title: "协作图边界",
  }, modelSelection);
  const lead = database.createConversation(null, {
    agent: { id: "lead", name: "负责人", role: "负责人", isDefault: false, instructions: "" },
    modelSelection, teamId: "default-team", threadKind: "team_lead",
  });
  const member = database.createConversation(null, {
    agent: { id: "developer", name: "开发成员", role: "开发", isDefault: false, instructions: "" },
    modelSelection, parentConversationId: lead.id, teamId: "default-team", threadKind: "agent",
  });
  database.bindTeamMemberConversation({
    agentId: "developer", conversationId: member.id, teamExecutionConversationId: lead.id,
  });
  const run = database.createRunWithUserMessage(lead.id, "开始处理", modelSelection.modelId);
  if (start) database.startTeamWorkItem(workItem.id, lead.id, run.runId);
  return { database, lead, member, run, workItem };
}

describe("Team collaboration projection boundary", () => {
  it("reads a historical plan snapshot with absent live participants on a query-only connection", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec(`
        CREATE TABLE team_work_item_collaboration_outputs (conversation_id TEXT, content TEXT, run_id TEXT, work_item_id TEXT);
        CREATE TABLE team_collaboration_plans (
          id TEXT, work_item_id TEXT, status TEXT, revision INTEGER,
          created_at TEXT, activated_at TEXT, reason TEXT
        );
        CREATE TABLE team_collaboration_plan_nodes (
          id TEXT, plan_id TEXT, stable_agent_id TEXT, conversation_id TEXT,
          kind TEXT, name_snapshot TEXT, role_snapshot TEXT, position_x INTEGER,
          position_y INTEGER, created_at TEXT
        );
        CREATE TABLE conversation_agent_messages (id TEXT, payload_json TEXT, work_item_id TEXT, created_at TEXT);
        CREATE TABLE team_work_item_member_assignments (message_id TEXT, work_item_id TEXT);
        CREATE TABLE team_collaboration_plan_routes (
          id TEXT, plan_id TEXT, from_node_id TEXT, to_node_id TEXT,
          purposes_json TEXT, created_at TEXT
        );
      `);
      const workItemId = randomUUID();
      const planId = randomUUID();
      const sourceId = randomUUID();
      const targetId = randomUUID();
      const createdAt = "2026-10-19T00:00:00.000Z";
      database.prepare("INSERT INTO team_collaboration_plans VALUES (?, ?, 'active', 1, ?, ?, ?)")
        .run(planId, workItemId, createdAt, createdAt, "保留原计划");
      const insertNode = database.prepare(
        "INSERT INTO team_collaboration_plan_nodes VALUES (?, ?, NULL, NULL, 'placeholder', ?, ?, ?, ?, ?)",
      );
      insertNode.run(sourceId, planId, "原负责人", "负责人", 120, 90, createdAt);
      insertNode.run(targetId, planId, "原成员", "检查", 360, 90, createdAt);
      database.prepare("INSERT INTO team_collaboration_plan_routes VALUES (?, ?, ?, ?, ?, ?)")
        .run(randomUUID(), planId, sourceId, targetId, JSON.stringify(["原检查路线"]), createdAt);
      database.exec("PRAGMA query_only = ON");

      const projection = new TeamCollaborationProjectionReader(database)
        .read({ id: workItemId, status: "completed" }, { agents: [] });
      expect(projection.nodes).toEqual([
        expect.objectContaining({ id: sourceId, conversationId: null, name: "原负责人", position: { x: 120, y: 90 } }),
        expect.objectContaining({ id: targetId, conversationId: null, name: "原成员", position: { x: 360, y: 90 } }),
      ]);
      expect(projection.edges).toEqual([expect.objectContaining({
        fromNodeId: sourceId, toNodeId: targetId, state: "skipped", purposes: ["原检查路线"],
      })]);
      expect(projection.isLive).toBe(false);
      expect(projection.summary).toMatchObject({ participantCount: 2, plannedRouteCount: 1, messageCount: 0 });
    } finally {
      database.close();
    }
  });

  it("omits an inactive persistent member until a real WorkItem message involves it, without marking the message read", () => {
    const { database, lead, member, run, workItem } = fixture();
    const initial = database.getTeamCollaborationProjection(workItem.id);
    expect(initial.nodes.map(node => node.conversationId)).toEqual([lead.id]);
    expect(initial.plan).toBeNull();
    const message = database.sendAgentMessage({
      content: "请参与检查。", runId: run.runId,
      senderConversationId: lead.id, targetConversationId: member.id,
    });
    database.recordTeamCollaborationMessage({ message, workItemId: workItem.id });

    const projection = database.getTeamCollaborationProjection(workItem.id);
    expect(projection.nodes.map(node => node.conversationId)).toEqual([lead.id, member.id]);
    expect(projection.edges).toEqual([expect.objectContaining({
      state: "ad_hoc", messageCount: 1, unreadCount: 1,
      messageTypes: { agent_result: 0, message: 1, notification: 0, task_result: 0 },
    })]);
    expect(database.getTeamCollaborationProjection(workItem.id)).toEqual(projection);
    expect(database.listUnreadAgentMessages(member.id).map(item => item.id)).toContain(message.id);
  });

  it("keeps an unobserved planned route until the WorkItem becomes terminal", () => {
    const { database, lead, member, run, workItem } = fixture();
    database.setTeamCollaborationPlan({
      createdByConversationId: lead.id, reason: "等待成员检查。",
      routes: [{ fromConversationId: lead.id, toConversationId: member.id, purpose: "独立检查" }],
    });
    const active = database.getTeamCollaborationProjection(workItem.id);
    expect(active.isLive).toBe(true);
    expect(active.nodes.map(node => node.conversationId)).toEqual([lead.id, member.id]);
    expect(active.edges).toEqual([expect.objectContaining({ state: "planned", messageCount: 0 })]);
    database.finishRun(run.runId, "failed", "终止本轮");
    database.finishTeamWorkItemRun({
      conversationId: lead.id, error: "终止本轮", resultSummary: null,
      runId: run.runId, status: "failed", workItemId: workItem.id,
    });

    const terminal = database.getTeamCollaborationProjection(workItem.id);
    expect(terminal.isLive).toBe(false);
    expect(terminal.edges).toEqual([expect.objectContaining({ state: "skipped", messageCount: 0 })]);
    expect(terminal.summary).toMatchObject({ plannedRouteCount: 1, observedRouteCount: 0 });
    expect(terminal.nodes.find(node => node.conversationId === lead.id)?.runStatus).toBe("failed");
  });

  it("keeps an unbound WorkItem empty and validates unknown WorkItem identity first", () => {
    const { database, workItem } = fixture(false);
    expect(database.getTeamCollaborationProjection(workItem.id)).toMatchObject({
      edges: [], isLive: false, nodes: [], plan: null,
      summary: { messageCount: 0, participantCount: 0, lastActivityAt: null },
    });
    expect(() => database.getTeamCollaborationProjection(randomUUID())).toThrow("WorkItem was not found");
  });
});
