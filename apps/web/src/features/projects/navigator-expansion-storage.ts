import type { NavigatorExpansionState } from "./navigator-types.js";

const NAVIGATOR_EXPANSION_STORAGE_KEY = "agent-workbench.project-navigator-expansion.v1";
const DEFAULT_NAVIGATOR_EXPANSION_STATE: NavigatorExpansionState = {
  collapsedProjectIds: [],
  expandedProjectIds: [],
  expandedSessionIds: [],
  expandedTeamIds: [],
  pinnedGroupExpanded: true,
  projectsGroupExpanded: true,
  teamsGroupExpanded: true,
  temporaryGroupExpanded: false,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readBoolean(
  record: Record<string, unknown>,
  key: string,
  fallback: boolean,
): boolean {
  const value = record[key];
  return typeof value === "boolean" ? value : fallback;
}

function readStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : [];
}

export function loadNavigatorExpansionState(): NavigatorExpansionState {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem(NAVIGATOR_EXPANSION_STORAGE_KEY) ?? "null",
    );
    if (!isRecord(value)) return DEFAULT_NAVIGATOR_EXPANSION_STATE;
    return {
      collapsedProjectIds: readStringArray(value, "collapsedProjectIds"),
      expandedProjectIds: readStringArray(value, "expandedProjectIds"),
      expandedSessionIds: readStringArray(value, "expandedSessionIds"),
      expandedTeamIds: readStringArray(value, "expandedTeamIds"),
      pinnedGroupExpanded: readBoolean(value, "pinnedGroupExpanded", true),
      projectsGroupExpanded: readBoolean(value, "projectsGroupExpanded", true),
      teamsGroupExpanded: readBoolean(value, "teamsGroupExpanded", true),
      temporaryGroupExpanded: readBoolean(value, "temporaryGroupExpanded", false),
    };
  } catch {
    return DEFAULT_NAVIGATOR_EXPANSION_STATE;
  }
}

export function saveNavigatorExpansionState(state: NavigatorExpansionState): void {
  try {
    window.localStorage.setItem(NAVIGATOR_EXPANSION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Keep tree disclosure usable when renderer storage is unavailable.
  }
}
