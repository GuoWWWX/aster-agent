import {
  MAX_TEAM_COLLABORATION_OUTPUT_LENGTH,
  type ConversationAgentMessageItem,
  type ConversationSummary,
  type TeamWorkItemStatus,
  type TeamCollaborationProjection,
} from "@agent/protocol";

export function collaborationRunStatus(
  conversation: ConversationSummary | undefined,
  workItemStatus: TeamWorkItemStatus,
): TeamCollaborationProjection["nodes"][number]["runStatus"] {
  if (conversation?.activeRunId !== null && conversation?.activeRunId !== undefined) {
    return "running";
  }
  if (conversation?.lastRunStatus === "queued" || conversation?.lastRunStatus === "running") {
    return conversation.lastRunStatus;
  }
  if (conversation?.lastRunStatus === "failed") return "failed";
  if (conversation?.lastRunStatus === "completed") return "completed";
  if (conversation?.lastRunStatus === "cancelled" || workItemStatus === "blocked") return "blocked";
  return "idle";
}

export function collaborationOutputExcerpt(content: string): string | null {
  const normalized = content.replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) return null;
  const characters = Array.from(normalized);
  return characters.length <= MAX_TEAM_COLLABORATION_OUTPUT_LENGTH
    ? normalized
    : `…${characters.slice(-(MAX_TEAM_COLLABORATION_OUTPUT_LENGTH - 1)).join("")}`;
}

export function collaborationEdgeView(input: {
  activity: readonly ConversationAgentMessageItem[];
  fromNodeId: string;
  id: string;
  purposes: string[];
  state: TeamCollaborationProjection["edges"][number]["state"];
  toNodeId: string;
}): TeamCollaborationProjection["edges"][number] {
  const firstActivityAt = input.activity[0]?.createdAt ?? null;
  const lastActivityAt = input.activity.at(-1)?.createdAt ?? null;
  return {
    firstActivityAt,
    fromNodeId: input.fromNodeId,
    id: input.id,
    lastActivityAt,
    messageCount: input.activity.length,
    messageTypes: {
      agent_result: input.activity.filter((message) => message.messageType === "agent_result").length,
      message: input.activity.filter((message) => message.messageType === "message").length,
      notification: input.activity.filter((message) => message.messageType === "notification").length,
      task_result: input.activity.filter((message) => message.messageType === "task_result").length,
    },
    purposes: input.purposes,
    state: input.state,
    toNodeId: input.toNodeId,
    unreadCount: input.activity.filter((message) => message.status === "unread").length,
  };
}

export function isTerminalTeamWorkItemStatus(status: TeamWorkItemStatus): boolean {
  return status === "completed"
    || status === "failed"
    || status === "cancelled";
}
