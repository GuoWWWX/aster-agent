import type { AgentTeam, ConversationRunEvent, ConversationSummary } from "@agent/protocol";
import { updateSessionRunState, type ProjectSession } from "../projects/project-session-model.js";

export function toProjectSession(conversation: ConversationSummary): ProjectSession {
  return {
    ...(conversation.coordinationTeamInstanceId === undefined ? {} : { coordinationTeamInstanceId: conversation.coordinationTeamInstanceId }),
    activeSubagentCount: conversation.activeSubagentCount,
    activeRunId: conversation.activeRunId,
    agentId: conversation.agentId,
    hasUnreadResult: conversation.hasUnreadResult,
    id: conversation.id,
    isArchived: conversation.isArchived,
    isPinned: conversation.isPinned,
    lastRunStatus: conversation.lastRunStatus,
    modelSelection: conversation.modelSelection,
    parentConversationId: conversation.parentConversationId,
    pinOrder: conversation.pinOrder ?? null,
    projectId: conversation.projectId,
    subagentTaskStatus: conversation.subagentTaskStatus,
    teamId: conversation.teamId,
    teamWorkItemId: conversation.teamWorkItemId,
    threadKind: conversation.threadKind,
    title: conversation.title,
    updatedAt: conversation.updatedAt,
    workspaceRootPath: conversation.workspaceRootPath,
  };
}

export function upsertSideSession(
  sessions: ProjectSession[],
  conversation: ConversationSummary,
): ProjectSession[] {
  const session = toProjectSession(conversation);
  return sessions.some((candidate) => candidate.id === session.id)
    ? sessions.map((candidate) => candidate.id === session.id ? session : candidate)
    : [...sessions, session];
}

export function updateSideSessionsForRunEvent(
  sessions: ProjectSession[],
  event: ConversationRunEvent,
): ProjectSession[] {
  if (
    event.type !== "conversation.updated"
    && event.type !== "run.started"
    && event.type !== "run.finished"
  ) {
    return sessions;
  }
  const conversationId = event.type === "conversation.updated"
    ? event.conversation.id
    : event.conversationId;
  const existingIndex = sessions.findIndex((session) => session.id === conversationId);
  if (existingIndex < 0) return sessions;
  const existing = sessions[existingIndex];
  if (existing === undefined) return sessions;
  const updated = event.type === "conversation.updated"
    ? toProjectSession(event.conversation)
    : updateSessionRunState([existing], event)[0] ?? existing;
  if (updated === existing) return sessions;
  const next = [...sessions];
  next[existingIndex] = updated;
  return next;
}

export type TeamMembership = Pick<AgentTeam, "id" | "leadAgentId" | "memberIds">;
type SidebarConversation = Pick<
  ConversationSummary,
  "agentId" | "parentConversationId" | "teamId" | "threadKind"
> & { teamWorkItemId?: string | null };
type SidebarConversationSource = Pick<ConversationSummary, "id" | "teamId" | "threadKind">;

export function isManagedTeamMember(
  conversation: { teamWorkItemId?: string | null },
): boolean {
  return conversation.teamWorkItemId !== null && conversation.teamWorkItemId !== undefined;
}

export function isDirectTeamMemberConversation(
  conversation: SidebarConversation,
  sourceConversation: SidebarConversationSource | null,
  team: TeamMembership | null,
): boolean {
  if (
    sourceConversation === null
    || sourceConversation.threadKind !== "team_lead"
    || sourceConversation.teamId === null
    || team?.id !== sourceConversation.teamId
    || conversation.threadKind !== "agent"
    || conversation.parentConversationId !== sourceConversation.id
    || conversation.teamId !== team.id
    || conversation.agentId === null
  ) {
    return false;
  }
  return conversation.agentId !== team.leadAgentId && team.memberIds.includes(conversation.agentId);
}

export function isAutoOpenedSideConversation(
  conversation: SidebarConversation,
  sourceConversation: SidebarConversationSource | null,
  team: TeamMembership | null,
): boolean {
  return conversation.threadKind === "agent"
    && !isManagedTeamMember(conversation)
    && !isDirectTeamMemberConversation(conversation, sourceConversation, team);
}

/** Durable Agent work is retained for audit; closing its side tab only hides the tab. */
export function shouldDeleteSidebarChat(
  conversation: SidebarConversation,
  sourceConversation: SidebarConversationSource | null = null,
  team: TeamMembership | null = null,
): boolean {
  // A missing or switched owner is not evidence that a Team conversation is disposable.
  if (conversation.teamId !== null && (
    sourceConversation?.id !== conversation.parentConversationId
    || team?.id !== conversation.teamId
  )) return false;
  return conversation.threadKind !== "subagent"
    && !isManagedTeamMember(conversation)
    && !isDirectTeamMemberConversation(conversation, sourceConversation, team);
}

export function shouldLoadSideConversations(
  conversation: { teamWorkItemId?: string | null } | null,
): boolean {
  return !isManagedTeamMember(conversation ?? {});
}
