import type { DatabaseSync } from "node:sqlite";
import {
  conversationAgentMessageItemSchema,
  teamCollaborationProjectionSchema,
  type ConversationAgentMessageItem,
  type TeamCollaborationProjection,
  type TeamWorkItemExecutionView,
  type TeamWorkItemView,
} from "@agent/protocol";
import { z } from "zod";

import { collaborationRunStatus, collaborationEdgeView, isTerminalTeamWorkItemStatus } from "./collaboration-row-mappers.js";
import { type DatabaseRow, asString, asNullableString, asNumber, parseJson } from "./database-row.js";

/** Reads the graph from persisted facts without claiming messages or mutating execution state. */
export class TeamCollaborationProjectionReader {
  public constructor(private readonly database: DatabaseSync) {}

  public read(
    workItem: Pick<TeamWorkItemView, "id" | "status">,
    execution: Pick<TeamWorkItemExecutionView, "agents">,
  ): TeamCollaborationProjection {
    const workItemId = workItem.id;
    const executionByConversationId = new Map(
      execution.agents.map((participant) => [participant.conversation.id, participant]),
    );
    const outputByConversationId = new Map(
      (this.database.prepare(
        `SELECT conversation_id, content, run_id
         FROM team_work_item_collaboration_outputs
         WHERE work_item_id = ?`,
      ).all(workItemId) as DatabaseRow[]).map((row) => [
        asString(row, "conversation_id"),
        {
          latestOutput: asString(row, "content"),
          latestOutputRunId: asString(row, "run_id"),
        },
      ]),
    );
    const nodePresentationByConversationId = new Map(
      execution.agents.map((participant) => [
        participant.conversation.id,
        {
          avatarIcon: participant.conversation.avatarIcon ?? null,
          ...(outputByConversationId.get(participant.conversation.id) ?? {
            latestOutput: null,
            latestOutputRunId: null,
          }),
        },
      ]),
    );
    const planRow = this.database.prepare(
      `SELECT * FROM team_collaboration_plans
       WHERE work_item_id = ? AND status = 'active'
       ORDER BY revision DESC LIMIT 1`,
    ).get(workItemId) as DatabaseRow | undefined;
    const planId = planRow === undefined ? null : asString(planRow, "id");
    const planNodeRows = planId === null
      ? []
      : this.database.prepare(
          "SELECT * FROM team_collaboration_plan_nodes WHERE plan_id = ? ORDER BY created_at ASC, rowid ASC",
        ).all(planId) as DatabaseRow[];
    const messageRows = this.database.prepare(
      `SELECT DISTINCT messages.payload_json
       FROM conversation_agent_messages AS messages
       LEFT JOIN team_work_item_member_assignments AS assignments
         ON assignments.message_id = messages.id
       WHERE messages.work_item_id = ? OR assignments.work_item_id = ?
       ORDER BY messages.created_at ASC`,
    ).all(workItemId, workItemId) as DatabaseRow[];
    const messages = messageRows.map((row) => conversationAgentMessageItemSchema.parse(
      parseJson(asString(row, "payload_json"), "Team collaboration message"),
    ));
    const actualConversationIds = new Set<string>();
    for (const message of messages) {
      actualConversationIds.add(message.senderConversationId);
      actualConversationIds.add(message.conversationId);
    }

    const nodes: TeamCollaborationProjection["nodes"] = [];
    const nodeIdByConversationId = new Map<string, string>();
    for (const row of planNodeRows) {
      const conversationId = asNullableString(row, "conversation_id");
      const participant = conversationId === null
        ? undefined
        : executionByConversationId.get(conversationId);
      const output = conversationId === null
        ? undefined
        : outputByConversationId.get(conversationId);
      const presentation = conversationId === null
        ? undefined
        : nodePresentationByConversationId.get(conversationId);
      const id = asString(row, "id");
      if (conversationId !== null) nodeIdByConversationId.set(conversationId, id);
      nodes.push({
        agentId: asNullableString(row, "stable_agent_id"),
        avatarIcon: presentation?.avatarIcon ?? null,
        conversationId,
        id,
        kind: z.enum(["team_lead", "standing", "ephemeral", "placeholder"])
          .parse(asString(row, "kind")),
        latestOutput: output?.latestOutput ?? null,
        latestOutputRunId: output?.latestOutputRunId ?? null,
        name: asString(row, "name_snapshot"),
        position: {
          x: asNumber(row, "position_x"),
          y: asNumber(row, "position_y"),
        },
        role: asString(row, "role_snapshot"),
        runStatus: collaborationRunStatus(participant?.conversation, workItem.status),
        taskIds: participant?.delegation === null || participant?.delegation === undefined
          ? []
          : [participant.delegation.id],
      });
    }

    for (const participant of execution.agents) {
      if (nodeIdByConversationId.has(participant.conversation.id)) continue;
      if (
        participant.depth !== 0
        && participant.delegation === null
        && !actualConversationIds.has(participant.conversation.id)
      ) continue;
      const positionX = 120 + participant.depth * 240;
      const lastPositionY = nodes.reduce((maximum, node) => (
        node.position.x === positionX ? Math.max(maximum, node.position.y) : maximum
      ), -30);
      const id = `conversation:${participant.conversation.id}`;
      const presentation = nodePresentationByConversationId.get(participant.conversation.id);
      nodeIdByConversationId.set(participant.conversation.id, id);
      nodes.push({
        agentId: participant.agent?.id ?? null,
        avatarIcon: presentation?.avatarIcon ?? null,
        conversationId: participant.conversation.id,
        id,
        kind: participant.depth === 0
          ? "team_lead"
          : participant.conversation.threadKind === "subagent" ? "ephemeral" : "standing",
        latestOutput: presentation?.latestOutput ?? null,
        latestOutputRunId: presentation?.latestOutputRunId ?? null,
        name: participant.agent?.name ?? participant.conversation.title,
        position: {
          x: positionX,
          y: lastPositionY + 120,
        },
        role: participant.agent?.role ?? (participant.depth === 0 ? "Team Lead" : "团队成员"),
        runStatus: collaborationRunStatus(participant.conversation, workItem.status),
        taskIds: participant.delegation === null ? [] : [participant.delegation.id],
      });
    }

    const messageGroups = new Map<string, ConversationAgentMessageItem[]>();
    for (const message of messages) {
      const key = `${message.senderConversationId}:${message.conversationId}`;
      const group = messageGroups.get(key) ?? [];
      group.push(message);
      messageGroups.set(key, group);
    }

    const edges: TeamCollaborationProjection["edges"] = [];
    const plannedRouteKeys = new Set<string>();
    if (planId !== null) {
      const routeRows = this.database.prepare(
        `SELECT routes.*, source.conversation_id AS from_conversation_id,
                target.conversation_id AS to_conversation_id
         FROM team_collaboration_plan_routes AS routes
         JOIN team_collaboration_plan_nodes AS source ON source.id = routes.from_node_id
         JOIN team_collaboration_plan_nodes AS target ON target.id = routes.to_node_id
         WHERE routes.plan_id = ? ORDER BY routes.created_at ASC, routes.rowid ASC`,
      ).all(planId) as DatabaseRow[];
      for (const row of routeRows) {
        const fromConversationId = asNullableString(row, "from_conversation_id");
        const toConversationId = asNullableString(row, "to_conversation_id");
        const routeKey = fromConversationId === null || toConversationId === null
          ? null
          : `${fromConversationId}:${toConversationId}`;
        if (routeKey !== null) plannedRouteKeys.add(routeKey);
        const activity = routeKey === null ? [] : messageGroups.get(routeKey) ?? [];
        edges.push(collaborationEdgeView({
          activity,
          fromNodeId: asString(row, "from_node_id"),
          id: asString(row, "id"),
          purposes: z.array(z.string().trim().min(1).max(500)).max(20).parse(
            parseJson(asString(row, "purposes_json"), "Team collaboration route purposes"),
          ),
          state: activity.length > 0
            ? "observed"
            : isTerminalTeamWorkItemStatus(workItem.status) ? "skipped" : "planned",
          toNodeId: asString(row, "to_node_id"),
        }));
      }
    }

    for (const [routeKey, activity] of messageGroups) {
      if (plannedRouteKeys.has(routeKey)) continue;
      const first = activity[0];
      if (first === undefined) continue;
      const fromNodeId = nodeIdByConversationId.get(first.senderConversationId);
      const toNodeId = nodeIdByConversationId.get(first.conversationId);
      if (fromNodeId === undefined || toNodeId === undefined) continue;
      edges.push(collaborationEdgeView({
        activity,
        fromNodeId,
        id: `actual:${routeKey}`,
        purposes: ["计划外通信"],
        state: "ad_hoc",
        toNodeId,
      }));
    }

    const lastActivityAt = messages.at(-1)?.createdAt ?? null;
    return teamCollaborationProjectionSchema.parse({
      edges,
      isLive: workItem.status === "running" || workItem.status === "reviewing",
      nodes,
      plan: planRow === undefined ? null : {
        activatedAt: asString(planRow, "activated_at"),
        createdAt: asString(planRow, "created_at"),
        id: asString(planRow, "id"),
        reason: asString(planRow, "reason"),
        revision: asNumber(planRow, "revision"),
        status: "active",
      },
      summary: {
        adHocRouteCount: edges.filter((edge) => edge.state === "ad_hoc").length,
        lastActivityAt,
        messageCount: messages.length,
        observedRouteCount: edges.filter((edge) => edge.messageCount > 0).length,
        participantCount: nodes.length,
        plannedRouteCount: edges.filter((edge) => edge.state !== "ad_hoc").length,
      },
      workItemId,
    });
  }
}
