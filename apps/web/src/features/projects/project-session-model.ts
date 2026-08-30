import type {
  AgentProfile,
  AgentTeam,
  ConversationSummary,
  ConversationRunEvent,
  ConversationRunStatus,
  ConversationThreadKind,
  TeamInstanceView,
  TeamWorkItemView,
} from "@agent/protocol";

export type ProjectSession = {
  activeSideConversationCount?: number;
  activeSubagentCount?: number;
  activeRunId: string | null;
  agentId: string | null;
  avatarIcon?: ConversationSummary["avatarIcon"];
  hasFailedUnreadSideConversationResult?: boolean;
  hasUnreadResult: boolean;
  hasUnreadSideConversationResult?: boolean;
  id: string;
  isArchived: boolean;
  isPinned: boolean;
  lastRunStatus: ConversationRunStatus | null;
  modelSelection: ConversationSummary["modelSelection"];
  parentConversationId: string | null;
  pinOrder?: number | null;
  projectId: string | null;
  subagentTaskStatus?: ConversationSummary["subagentTaskStatus"];
  teamId: string | null;
  teamWorkItemId?: ConversationSummary["teamWorkItemId"];
  threadKind: ConversationThreadKind;
  title: string;
  workspaceRootPath: string | null;
};

export type TeamNavigatorUsage = {
  lead: ProjectSession;
  members: ProjectSession[];
  sourceSession: ProjectSession | null;
};

export type TeamNavigatorGroup = {
  configuredMembers: AgentProfile[];
  dedicatedUsages: TeamNavigatorUsage[];
  sharedUsages: TeamNavigatorUsage[];
  team: AgentTeam;
};

export type TeamInstanceNavigatorMember = {
  profile: AgentProfile;
  session: ProjectSession | null;
};

export type TeamInstanceNavigatorGroup = {
  instance: TeamInstanceView;
  members: TeamInstanceNavigatorMember[];
  team: AgentTeam;
};

type SessionRunEvent = Extract<
  ConversationRunEvent,
  { type: "run.finished" | "run.started" }
>;

function hasActiveRun(session: ProjectSession): boolean {
  return session.activeRunId !== null;
}

export function aggregateSideConversationState(
  sessions: readonly ProjectSession[],
): ProjectSession[] {
  const sideConversationsByParent = new Map<string, ProjectSession[]>();
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  for (const session of sessions) {
    const rootId = session.teamWorkItemId !== null && session.teamWorkItemId !== undefined
      ? resolveConversationRootId(session, sessionsById)
      : session.parentConversationId;
    if (
      rootId === null
      || (session.threadKind !== "agent"
        && (session.teamWorkItemId === null || session.teamWorkItemId === undefined))
    ) continue;
    const siblings = sideConversationsByParent.get(rootId) ?? [];
    siblings.push(session);
    sideConversationsByParent.set(rootId, siblings);
  }

  return sessions.map((session) => {
    if (session.parentConversationId !== null) return session;
    const sideConversations = sideConversationsByParent.get(session.id) ?? [];
    return {
      ...session,
      activeSideConversationCount: sideConversations.filter(hasActiveRun).length,
      hasFailedUnreadSideConversationResult: sideConversations.some(
        (sideConversation) => sideConversation.hasUnreadResult
          && sideConversation.lastRunStatus === "failed",
      ),
      hasUnreadSideConversationResult: sideConversations.some(
        (sideConversation) => sideConversation.hasUnreadResult,
      ),
    };
  });
}

export function getSessionFamilyResultIds(
  sessions: readonly ProjectSession[],
  sessionId: string,
): string[] {
  const selected = sessions.find((session) => session.id === sessionId);
  if (
    selected === undefined
    || selected.threadKind === "subagent"
    || (selected.teamWorkItemId !== null && selected.teamWorkItemId !== undefined)
  ) return [sessionId];
  const parentId = selected.parentConversationId ?? selected.id;
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  return sessions.flatMap((session) => {
    const isOrdinaryResultGroupMember = session.id === parentId
      || (
        session.parentConversationId === parentId
        && session.threadKind === "agent"
        && (session.teamWorkItemId === null || session.teamWorkItemId === undefined)
      );
    const isManagedTeamConversation = selected.id === parentId
      && session.teamWorkItemId !== null
      && session.teamWorkItemId !== undefined
      && resolveConversationRootId(session, sessionsById) === parentId;
    return isOrdinaryResultGroupMember || isManagedTeamConversation ? [session.id] : [];
  });
}

export function updateSessionRunState(
  sessions: ProjectSession[],
  event: SessionRunEvent,
): ProjectSession[] {
  if (!sessions.some((session) => session.id === event.conversationId)) {
    return sessions;
  }
  return sessions.map((session) => {
    if (session.id !== event.conversationId) return session;
    if (event.type === "run.started") {
      return {
        ...session,
        activeRunId: event.runId,
        hasUnreadResult: false,
        lastRunStatus: "running",
      };
    }
    return {
      ...session,
      activeRunId: null,
      hasUnreadResult: event.status === "completed" || event.status === "failed",
      lastRunStatus: event.status,
    };
  });
}

export function getProjectSessions(
  sessions: readonly ProjectSession[],
  projectId: string,
): ProjectSession[] {
  return sortPinnedSessions(
    sessions.filter(
      (session) =>
        !session.isArchived
        && session.parentConversationId === null
        && session.threadKind === "agent"
        && session.projectId === projectId,
    ),
  );
}

export function getTemporarySessions(
  sessions: readonly ProjectSession[],
): ProjectSession[] {
  return sortPinnedSessions(
    sessions.filter(
      (session) =>
        !session.isArchived
        && session.parentConversationId === null
        && session.threadKind === "agent"
        && session.projectId === null,
    ),
  );
}

export function getPinnedSessions(
  sessions: readonly ProjectSession[],
): ProjectSession[] {
  return sortPinnedSessions(
    sessions.filter(
      (session) =>
        !session.isArchived
        && session.parentConversationId === null
        && session.threadKind === "agent"
        && session.isPinned,
    ),
  );
}

export function getSubagentSessions(
  sessions: readonly ProjectSession[],
  parentConversationId: string,
): ProjectSession[] {
  return sessions.filter(
    (session) =>
      !session.isArchived
      && session.parentConversationId === parentConversationId
      && session.threadKind === "subagent",
  );
}

export function groupSubagentSessionsByParent(
  sessions: readonly ProjectSession[],
  teamWorkItems: readonly Pick<
    TeamWorkItemView,
    "executionScope" | "participantConversationIds" | "sourceConversationId"
  >[] = [],
): Map<string, ProjectSession[]> {
  const grouped = new Map<string, ProjectSession[]>();
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const conversationParticipantsBySource = new Map<string, Set<string>>();
  for (const workItem of teamWorkItems) {
    if (
      workItem.executionScope !== "conversation"
      || workItem.sourceConversationId === null
    ) continue;
    const participants = conversationParticipantsBySource.get(
      workItem.sourceConversationId,
    ) ?? new Set<string>();
    for (const conversationId of workItem.participantConversationIds ?? []) {
      participants.add(conversationId);
    }
    conversationParticipantsBySource.set(workItem.sourceConversationId, participants);
  }
  for (const session of sessions) {
    if (session.parentConversationId === null || session.isArchived) continue;
    if (session.teamWorkItemId !== null && session.teamWorkItemId !== undefined) {
      const rootId = resolveConversationRootId(session, sessionsById);
      if (rootId === null) continue;
      const visibleParticipants = conversationParticipantsBySource.get(rootId);
      if (visibleParticipants !== undefined && !visibleParticipants.has(session.id)) {
        continue;
      }
      const members = grouped.get(rootId) ?? [];
      members.push(session);
      grouped.set(rootId, members);
      continue;
    }
    if (session.threadKind !== "subagent") continue;
    const subagents = grouped.get(session.parentConversationId) ?? [];
    subagents.push(session);
    grouped.set(session.parentConversationId, subagents);
  }
  return grouped;
}

export function getTeamNavigatorGroups(
  teams: readonly AgentTeam[],
  sessions: readonly ProjectSession[],
  agents: readonly AgentProfile[],
): TeamNavigatorGroup[] {
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const leadsByTeam = new Map<string, ProjectSession[]>();
  for (const session of sessions) {
    if (
      session.isArchived
      || session.threadKind !== "team_lead"
      || session.teamId === null
    ) continue;
    const leads = leadsByTeam.get(session.teamId) ?? [];
    leads.push(session);
    leadsByTeam.set(session.teamId, leads);
  }

  return teams.map((team) => {
    const usages = (leadsByTeam.get(team.id) ?? []).map((lead) => ({
      lead,
      members: sessions.filter(
        (session) =>
          !session.isArchived
          && session.parentConversationId === lead.id
          && session.teamId === team.id,
      ),
      sourceSession: lead.parentConversationId === null
        ? null
        : sessionsById.get(lead.parentConversationId) ?? null,
    }));
    const sharedUsages = usages.filter((usage) =>
      usage.lead.parentConversationId === null
      && usage.lead.projectId === null
      && (
        usage.lead.teamWorkItemId === null
        || usage.lead.teamWorkItemId === undefined
      ),
    );
    return {
      configuredMembers: team.memberIds.flatMap((memberId) => {
        const member = agentsById.get(memberId);
        return member === undefined ? [] : [member];
      }),
      dedicatedUsages: usages.filter((usage) => !sharedUsages.includes(usage)),
      sharedUsages,
      team,
    };
  });
}

export function getTeamInstanceNavigatorGroups(
  instances: readonly TeamInstanceView[],
  teams: readonly AgentTeam[],
  sessions: readonly ProjectSession[],
  agents: readonly AgentProfile[],
  workItems: readonly Pick<
    TeamWorkItemView,
    "participantConversationIds" | "teamInstanceId"
  >[],
): TeamInstanceNavigatorGroup[] {
  const teamsById = new Map(teams.map((team) => [team.id, team]));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const sessionsById = new Map(sessions.map((session) => [session.id, session]));

  return instances.flatMap((instance) => {
    const team = teamsById.get(instance.teamId);
    if (team === undefined) return [];
    const root = instance.rootConversationId === null
      ? null
      : sessionsById.get(instance.rootConversationId) ?? null;
    const configuredSessions = new Map<string, ProjectSession>();
    if (root?.agentId !== null && root?.agentId !== undefined) {
      configuredSessions.set(root.agentId, root);
    }
    for (const session of sessions) {
      if (session.parentConversationId !== root?.id || session.agentId === null) continue;
      if (!configuredSessions.has(session.agentId)) {
        configuredSessions.set(session.agentId, session);
      }
    }

    let visibleAgentIds = team.memberIds;
    if (instance.scope === "conversation") {
      const participantIds = new Set(workItems.flatMap((workItem) =>
        workItem.teamInstanceId === instance.id
          ? workItem.participantConversationIds ?? []
          : [],
      ));
      visibleAgentIds = team.memberIds.filter((agentId) => {
        const session = configuredSessions.get(agentId);
        return session !== undefined && participantIds.has(session.id);
      });
    }

    return [{
      instance,
      members: visibleAgentIds.flatMap((agentId) => {
        const profile = agentsById.get(agentId);
        return profile === undefined
          ? []
          : [{ profile, session: configuredSessions.get(agentId) ?? null }];
      }),
      team,
    }];
  });
}

export function getTeamSharedMemberSession(
  group: TeamNavigatorGroup,
  agentId: string,
  activeProjectId: string | null = null,
): ProjectSession | null {
  const projectUsage = activeProjectId === null
    ? []
    : group.dedicatedUsages.filter((usage) =>
        usage.lead.projectId === activeProjectId
        && usage.lead.parentConversationId === null,
      );
  for (const usage of [...projectUsage, ...group.sharedUsages]) {
    if (agentId === group.team.leadAgentId) return usage.lead;
    const member = usage.members.find((session) => session.agentId === agentId);
    if (member !== undefined) return member;
  }
  return null;
}

function resolveConversationRootId(
  session: ProjectSession,
  sessionsById: ReadonlyMap<string, ProjectSession>,
): string | null {
  let current = session;
  const visited = new Set<string>();
  while (current.parentConversationId !== null) {
    if (visited.has(current.id)) return null;
    visited.add(current.id);
    const parent = sessionsById.get(current.parentConversationId);
    if (parent === undefined) return null;
    current = parent;
  }
  return current.threadKind === "agent" ? current.id : null;
}

export function getArchivedSessions(
  sessions: readonly ProjectSession[],
): ProjectSession[] {
  return sortPinnedSessions(
    sessions.filter(
      (session) => session.isArchived && session.parentConversationId === null,
    ),
  );
}

function sortPinnedSessions(sessions: readonly ProjectSession[]): ProjectSession[] {
  return [...sessions].sort(
    (left, right) => Number(right.isPinned) - Number(left.isPinned),
  );
}

export function createProjectSession(
  projectId: string | null,
  sessions: readonly ProjectSession[],
  id: string,
): ProjectSession {
  const nextSessionNumber =
    (projectId === null
      ? getTemporarySessions(sessions)
      : getProjectSessions(sessions, projectId)
    ).length + 1;

  return {
    activeSubagentCount: 0,
    activeRunId: null,
    agentId: null,
    avatarIcon: null,
    hasUnreadResult: false,
    id,
    isArchived: false,
    isPinned: false,
    lastRunStatus: null,
    modelSelection: null,
    parentConversationId: null,
    pinOrder: null,
    projectId,
    teamId: null,
    teamWorkItemId: null,
    threadKind: "agent",
    title: nextSessionNumber === 1 ? "新会话" : `新会话 ${nextSessionNumber}`,
    workspaceRootPath: null,
  };
}
