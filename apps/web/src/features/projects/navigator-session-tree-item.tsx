import { ChevronDown, ChevronRight } from "lucide-react";
import type { MouseEvent, ReactElement } from "react";
import type { TeamInstanceView } from "@agent/protocol";
import type { ProjectSession, TeamInstanceNavigatorGroup } from "./project-session-model.js";
import { SessionButton, type SessionButtonProps } from "./navigator-session-button.js";
import { TeamInstanceTreeItem } from "./navigator-team-tree-item.js";

export function SessionTreeItem({
  activeSessionId,
  expandedTeamIds = new Set<string>(),
  subagentsExpanded,
  teamGroups = [],
  onArchiveTeam,
  onCreateTeam,
  onOpenTeamMember,
  onOpenTeamMenu,
  onToggleTeam,
  onToggleSubagents,
  ...buttonProps
}: SessionButtonProps & {
  activeSessionId: string | null;
  expandedTeamIds?: ReadonlySet<string>;
  subagentsExpanded: boolean;
  teamGroups?: readonly TeamInstanceNavigatorGroup[];
  onArchiveTeam?: (instance: TeamInstanceView) => void;
  onCreateTeam?: () => void;
  onOpenTeamMember?: (
    teamInstanceId: string,
    agentId: string,
    session: ProjectSession | null,
  ) => void;
  onOpenTeamMenu?: (event: MouseEvent, instance: TeamInstanceView) => void;
  onToggleTeam?: (instanceId: string) => void;
  onToggleSubagents: () => void;
}): ReactElement {
  const hasExpandableContent = teamGroups.length > 0;
  return (
    <div className="project-navigator__session-branch">
      <div className="project-navigator__session-branch-row">
        {hasExpandableContent ? (
          <button
            aria-expanded={subagentsExpanded}
            aria-label={`${subagentsExpanded ? "收起" : "展开"} ${buttonProps.session.title} 的对话团队`}
            className="project-navigator__session-toggle"
            title={`${teamGroups.length} 个对话团队`}
            type="button"
            onClick={onToggleSubagents}
          >
            {subagentsExpanded ? (
              <ChevronDown aria-hidden="true" size={13} />
            ) : (
              <ChevronRight aria-hidden="true" size={13} />
            )}
          </button>
        ) : (
          <span aria-hidden="true" className="project-navigator__session-toggle-spacer" />
        )}
        <SessionButton
          {...buttonProps}
          {...(onCreateTeam === undefined ? {} : { onCreateTeam })}
        />
      </div>
      {subagentsExpanded && hasExpandableContent ? (
        <div className="project-navigator__subagents" role="group" aria-label="对话团队">
          {onCreateTeam === undefined
            || onOpenTeamMember === undefined
            || onOpenTeamMenu === undefined
            || onToggleTeam === undefined
            ? null
            : (
              <>
                {teamGroups.map((group) => (
                  <TeamInstanceTreeItem
                    activeSessionId={activeSessionId}
                    expanded={expandedTeamIds.has(group.instance.id)}
                    group={group}
                    key={group.instance.id}
                    {...(onArchiveTeam === undefined
                      ? {}
                      : { onArchive: () => onArchiveTeam(group.instance) })}
                    onContextMenu={(event) => onOpenTeamMenu(event, group.instance)}
                    onOpenMember={(agentId, session) =>
                      onOpenTeamMember(group.instance.id, agentId, session)}
                    onToggle={() => onToggleTeam(group.instance.id)}
                  />
                ))}
              </>
            )}
        </div>
      ) : null}
    </div>
  );
}
