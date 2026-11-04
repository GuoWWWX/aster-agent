import type { AgentProfile, TeamInstanceView } from "@agent/protocol";
import { MessageSquareText, UsersRound } from "lucide-react";
import type { ReactElement } from "react";
import type { ProjectSession } from "../projects/project-session-model.js";
import { AgentAvatar, SubagentAvatar } from "../team/agent-avatar.js";

export function sessionTeamInstance(
  session: ProjectSession, sessions: readonly ProjectSession[], instances: readonly TeamInstanceView[],
): TeamInstanceView | undefined {
  if (session.teamId === null || session.threadKind === "subagent") return undefined;
  const byId = new Map(sessions.map(item => [item.id, item]));
  let current: ProjectSession | undefined = session;
  const visited = new Set<string>();
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id);
    const instance = instances.find(item => !item.isArchived && item.rootConversationId === current?.id);
    if (instance !== undefined) return instance;
    current = current.parentConversationId === null ? undefined : byId.get(current.parentConversationId);
  }
  return undefined;
}

export function conversationIdentity(
  session: ProjectSession, agents: readonly AgentProfile[], instances: readonly TeamInstanceView[] = [],
  sessions: readonly ProjectSession[] = [],
) {
  const group = instances.find(instance => session.id === `team-chat:${instance.id}`);
  if (group !== undefined) return { kind: "group" as const, title: group.name };
  if (session.threadKind === "subagent") return { kind: "subagent" as const, title: session.title };
  if (session.teamId !== null) {
    const agent = agents.find(item => item.id === session.agentId);
    const instance = sessionTeamInstance(session, sessions, instances);
    const suffix = instance === undefined ? undefined : ` · ${instance.name}`;
    const title = suffix !== undefined && session.title.endsWith(suffix)
      ? session.title.slice(0, -suffix.length) : agent?.name ?? session.title;
    return { kind: "member" as const, title, avatar: agent?.avatar };
  }
  return { kind: "conversation" as const, title: session.title };
}

export function ConversationIdentityIcon({ session, identity }: {
  session: ProjectSession; identity: ReturnType<typeof conversationIdentity>;
}): ReactElement {
  if (identity.kind === "group") return <UsersRound aria-hidden="true" size={16} className="shrink-0" />;
  if (identity.kind === "member") return <AgentAvatar avatar={identity.avatar ?? { kind: "icon", icon: session.avatarIcon ?? "bot" }} size="compact" />;
  if (identity.kind === "subagent") return <SubagentAvatar icon={session.avatarIcon} seed={session.id} size="compact" />;
  return <MessageSquareText aria-hidden="true" size={14} className="shrink-0" />;
}
