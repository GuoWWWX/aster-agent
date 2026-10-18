import type { AgentProfile, AgentTeam, ProjectSummary, TeamInstanceView } from "@agent/protocol";
import { ChevronRight, Folder, MessageSquareText, UsersRound } from "lucide-react";
import { TooltipAnchor } from "../../components/ui/tooltip.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationIdentityIcon, conversationIdentity, sessionTeamInstance } from "./conversation-identity.js";

export function ConversationPath({ session, sessions, project, agents, teams, instances, headingId, onLocateProject, onLocateSession }: {
  session: ProjectSession; sessions: readonly ProjectSession[]; project: ProjectSummary | null;
  agents: readonly AgentProfile[]; teams: readonly AgentTeam[]; instances: readonly TeamInstanceView[];
  headingId: string; onLocateProject?: ((id: string) => void) | undefined; onLocateSession?: ((id: string) => void) | undefined;
}) {
  const identity = conversationIdentity(session, agents, instances, sessions);
  const instance = sessionTeamInstance(session, sessions, instances);
  const isMember = identity.kind === "member";
  const teamName = instance?.name ?? teams.find(team => team.id === session.teamId)?.name ?? "团队会话";
  const parent = session.threadKind === "subagent" ? sessions.find(item => item.id === session.parentConversationId) : undefined;
  return <div className="conversation-workspace__path" aria-label="对话路径">
    {isMember ? <TooltipAnchor content={teamName}><span className="conversation-workspace__path-temporary conversation-workspace__path-team">
      <UsersRound aria-hidden="true" size={16} /><span>{teamName}</span>
    </span></TooltipAnchor> : project !== null ? <TooltipAnchor content={project.name}><button type="button" className="conversation-workspace__path-link conversation-workspace__path-link--project"
      aria-label={`在左侧定位项目 ${project.name}`} onClick={() => onLocateProject?.(project.id)}>
      <Folder aria-hidden="true" size={14} /><span>{project.name}</span>
    </button></TooltipAnchor> : <span className="conversation-workspace__path-temporary whitespace-nowrap"><MessageSquareText aria-hidden="true" size={14} />临时对话</span>}
    {parent === undefined ? null : <><ChevronRight aria-hidden="true" size={12} className="shrink-0" />
      <TooltipAnchor content={parent.title}><button type="button" className="conversation-workspace__path-link conversation-workspace__path-link--conversation"
        aria-label={`在左侧定位对话 ${parent.title}`} onClick={() => onLocateSession?.(parent.id)}>
        <MessageSquareText aria-hidden="true" size={14} /><span>{parent.title}</span>
      </button></TooltipAnchor></>}
    <ChevronRight aria-hidden="true" size={12} className="shrink-0" />
    <TooltipAnchor content={identity.title}><button type="button" className="conversation-workspace__path-link conversation-workspace__path-link--conversation"
      aria-label={`在左侧定位对话 ${identity.title}`} onClick={() => onLocateSession?.(session.id)}>
      <ConversationIdentityIcon session={session} identity={identity} /><h1 id={headingId}>{identity.title}</h1>
    </button></TooltipAnchor>
  </div>;
}
