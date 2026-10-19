import { Archive, ChevronDown, ChevronRight, MoreHorizontal, Send, UsersRound } from "lucide-react";
import type { DragEvent, MouseEvent, ReactElement } from "react";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { AgentAvatar } from "../team/agent-avatar.js";
import {
  isProjectSessionRunning as isSessionRunning,
  type ProjectSession,
  type TeamInstanceNavigatorGroup,
} from "./project-session-model.js";
import { SessionStatusIndicator } from "./navigator-session-status.js";

export function TeamInstanceTreeItem({
  activeSessionId,
  draggable,
  dragging,
  dropPosition,
  expanded,
  group,
  onArchive,
  onContextMenu,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onOpenMember,
  onToggle,
  projectName = null,
}: {
  activeSessionId: string | null;
  draggable?: boolean;
  dragging?: boolean;
  dropPosition?: "after" | "before" | null;
  expanded: boolean;
  group: TeamInstanceNavigatorGroup;
  onArchive?: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onDragEnd?: () => void;
  onDragOver?: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart?: (event: DragEvent<HTMLButtonElement>) => void;
  onDrop?: (event: DragEvent<HTMLDivElement>) => void;
  onOpenMember: (agentId: string, session: ProjectSession | null) => void;
  onToggle: () => void;
  projectName?: string | null;
}): ReactElement {
  const runningMemberCount = group.members.filter(({ session }) =>
    session !== null && isSessionRunning(session),
  ).length;
  return (
    <div className="project-navigator__session-branch">
      <div
        className="project-navigator__session-branch-row"
        data-dragging={dragging === true}
        data-drop-position={dropPosition ?? undefined}
        onContextMenu={onContextMenu}
        onDragOver={onDragOver}
        onDrop={onDrop}
      >
        <button
          aria-expanded={expanded}
          aria-label={`${expanded ? "收起" : "展开"} ${group.instance.name}`}
          className="project-navigator__session-toggle"
          type="button"
          onClick={onToggle}
        >
          {expanded ? <ChevronDown aria-hidden="true" size={13} /> : <ChevronRight aria-hidden="true" size={13} />}
        </button>
        <div className="project-navigator__session-shell">
          <button
            aria-label={`打开团队 ${group.instance.name} 群聊`}
            className="project-navigator__session project-navigator__team-instance-session"
            data-enabled={group.team.enabled}
            draggable={draggable === true}
            title={`${group.instance.name}${projectName === null ? "" : ` · ${projectName}`} · ${group.team.name}`}
            type="button"
            onClick={() => useWorkbenchUiStore.getState().openTeamChat({ instanceId: group.instance.id })}
            onDragEnd={onDragEnd}
            onDragStart={onDragStart}
          >
            <UsersRound aria-hidden="true" size={14} />
            <span className="project-navigator__session-title">
              {group.instance.name}{projectName === null ? "" : ` · ${projectName}`}
            </span>
            <span className="project-navigator__subagent-count" data-running={runningMemberCount > 0}>
              {group.members.length}
            </span>
          </button>
          <div className="project-navigator__session-actions">
            <button aria-label={`给团队 ${group.instance.name} 发任务`} title="打开团队任务看板" type="button" onClick={event => {
              event.stopPropagation();
              useWorkbenchUiStore.getState().openTeamWorkspace({ teamId: group.instance.teamId, instanceId: group.instance.id });
            }}><Send aria-hidden="true" size={13} /></button>
            {onArchive === undefined ? null : (
              <button
                aria-label={`归档团队 ${group.instance.name}`}
                title="归档团队"
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onArchive();
                }}
              >
                <Archive aria-hidden="true" size={13} />
              </button>
            )}
            <button aria-label={`更多 ${group.instance.name}`} title="更多" type="button" onClick={(event) => {
              event.stopPropagation();
              onContextMenu(event);
            }}>
              <MoreHorizontal aria-hidden="true" size={13} />
            </button>
          </div>
        </div>
      </div>
      {expanded ? (
        <div className="project-navigator__subagents project-navigator__team-members">
          {group.members.length === 0 ? (
            <p className="project-navigator__team-empty">
              {group.instance.scope === "conversation" ? "尚未启用成员" : "暂无成员"}
            </p>
          ) : group.members.map(({ profile, session }) => {
            const configuredRole = group.team.memberConfigurations[profile.id]?.role.trim();
            const role = configuredRole === undefined || configuredRole.length === 0
              ? profile.role
              : configuredRole;
            return (
              <button
                aria-current={session?.id === activeSessionId ? "page" : undefined}
                aria-label={`打开 ${profile.name} 的团队对话`}
                className="project-navigator__team-member"
                data-active={session?.id === activeSessionId}
                data-navigator-key={session === null ? undefined : `session:${session.id}`}
                key={session?.id ?? profile.id}
                title={`打开 ${profile.name} 的团队对话`}
                type="button"
                onClick={() => onOpenMember(profile.id, session)}
              >
                <AgentAvatar avatar={profile.avatar} size="compact" status={profile.status} />
                <span className="project-navigator__team-member-copy">
                  <span className="project-navigator__team-member-name">{profile.name}</span>
                  <span className="project-navigator__team-member-role">
                    {profile.id === group.team.leadAgentId ? `负责人 · ${role}` : role}
                  </span>
                </span>
                {session === null ? null : <SessionStatusIndicator session={session} />}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
