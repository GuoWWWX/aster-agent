import type { ProjectSummary, TeamInstanceScope, TeamInstanceView } from "@agent/protocol";
import type { ProjectSession } from "./project-session-model.js";

export type NavigatorMenuTarget =
  | { kind: "project"; project: ProjectSummary }
  | { kind: "session"; session: ProjectSession }
  | { kind: "team-instance"; instance: TeamInstanceView };

export type NavigatorContextMenu = {
  target: NavigatorMenuTarget;
  x: number;
  y: number;
};

export type NavigatorDialog =
  | {
      kind: "create-team-instance";
      projectId: string | null;
      scope: TeamInstanceScope;
      sourceConversationId: string | null;
    }
  | { kind: "delete-team-instance"; instance: TeamInstanceView }
  | { kind: "delete-session"; session: ProjectSession }
  | { kind: "edit-team-instance"; instance: TeamInstanceView }
  | { kind: "remove-project"; project: ProjectSummary }
  | { kind: "rename-project"; project: ProjectSummary }
  | { kind: "rename-session"; session: ProjectSession }
  | { kind: "rename-team-instance"; instance: TeamInstanceView };

export type NavigatorExpansionState = {
  collapsedProjectIds: string[];
  expandedProjectIds: string[];
  expandedSessionIds: string[];
  expandedTeamIds: string[];
  pinnedGroupExpanded: boolean;
  projectsGroupExpanded: boolean;
  teamsGroupExpanded: boolean;
  temporaryGroupExpanded: boolean;
};

export type NavigatorDragItem = {
  groupKey: string;
  id: string;
  kind: "project" | "session" | "team-instance";
};

export type NavigatorDropIndicator = {
  id: string;
  kind: "project" | "session" | "team-instance";
  position: "after" | "before";
};

export type NavigatorSortOption = "custom" | "name-ascending" | "name-descending";

export type ProjectNavigatorLocateRequest = {
  id: string;
  kind: "project" | "session";
  requestId: number;
};
