import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectSession, TeamInstanceNavigatorGroup } from "./project-session-model.js";
import type { ProjectNavigatorLocateRequest } from "./navigator-types.js";
import { loadNavigatorExpansionState, saveNavigatorExpansionState } from "./navigator-expansion-storage.js";

/** Owns navigation expansion, persistence and the locate request's reveal/scroll lifecycle. */
export function useNavigatorExpansion({
  activeProjectId,
  locateRequest,
  sessions,
}: {
  activeProjectId: string | null;
  locateRequest: ProjectNavigatorLocateRequest | null;
  sessions: readonly ProjectSession[];
}) {
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [initialExpansionState] = useState(loadNavigatorExpansionState);
  const [projectSessionLimits, setProjectSessionLimits] = useState<Record<string, number>>({});
  const [expandedProjectIds, setExpandedProjectIds] = useState<ReadonlySet<string>>(
    () => new Set(initialExpansionState.expandedProjectIds),
  );
  const [expandedSessionIds, setExpandedSessionIds] = useState<ReadonlySet<string>>(
    () => new Set(initialExpansionState.expandedSessionIds),
  );
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<ReadonlySet<string>>(
    () => new Set(initialExpansionState.collapsedProjectIds),
  );
  const [isProjectsGroupExpanded, setIsProjectsGroupExpanded] = useState(
    initialExpansionState.projectsGroupExpanded,
  );
  const [isTeamsGroupExpanded, setIsTeamsGroupExpanded] = useState(
    initialExpansionState.teamsGroupExpanded,
  );
  const [isPinnedGroupExpanded, setIsPinnedGroupExpanded] = useState(
    initialExpansionState.pinnedGroupExpanded,
  );
  const [isTemporaryGroupExpanded, setIsTemporaryGroupExpanded] = useState(
    initialExpansionState.temporaryGroupExpanded,
  );
  const [expandedTeamIds, setExpandedTeamIds] = useState<ReadonlySet<string>>(
    () => new Set(initialExpansionState.expandedTeamIds),
  );
  useEffect(() => {
    saveNavigatorExpansionState({
      collapsedProjectIds: [...collapsedProjectIds],
      expandedProjectIds: [...expandedProjectIds],
      expandedSessionIds: [...expandedSessionIds],
      expandedTeamIds: [...expandedTeamIds],
      pinnedGroupExpanded: isPinnedGroupExpanded,
      projectsGroupExpanded: isProjectsGroupExpanded,
      teamsGroupExpanded: isTeamsGroupExpanded,
      temporaryGroupExpanded: isTemporaryGroupExpanded,
    });
  }, [
    collapsedProjectIds,
    expandedProjectIds,
    expandedSessionIds,
    expandedTeamIds,
    isPinnedGroupExpanded,
    isProjectsGroupExpanded,
    isTeamsGroupExpanded,
    isTemporaryGroupExpanded,
  ]);

  useEffect(() => {
    if (locateRequest === null) return undefined;

    const locatedSession = locateRequest.kind === "session"
      ? sessions.find((session) => session.id === locateRequest.id)
      : undefined;
    const locatedProjectId =
      locateRequest.kind === "project"
        ? locateRequest.id
        : locatedSession?.projectId ?? null;

    const targetKey = `${locateRequest.kind}:${locateRequest.id}`;
    let secondFrame = 0;
    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      if (locatedSession?.isPinned === true) {
        setIsPinnedGroupExpanded(true);
      } else if (locatedSession?.projectId === null) {
        setIsTemporaryGroupExpanded(true);
      } else if (locatedProjectId !== null) {
        setIsProjectsGroupExpanded(true);
        setExpandedProjectIds((current) => new Set(current).add(locatedProjectId));
        setCollapsedProjectIds((current) => {
          const next = new Set(current);
          next.delete(locatedProjectId);
          return next;
        });
      }
      const locatedParentId = locatedSession?.parentConversationId ?? null;
      if (locatedParentId !== null) {
        setExpandedSessionIds((current) =>
          new Set(current).add(locatedParentId),
        );
      } else if (locatedSession?.threadKind === "team_lead") {
        setExpandedSessionIds((current) =>
          new Set(current).add(locatedSession.id),
        );
      }
    });
    const firstFrame = window.requestAnimationFrame(() => {
      secondFrame = window.requestAnimationFrame(() => {
        const target = Array.from(
          bodyRef.current?.querySelectorAll<HTMLElement>("[data-navigator-key]") ?? [],
        ).find((element) => element.dataset.navigatorKey === targetKey);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
      });
    });

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(firstFrame);
      window.cancelAnimationFrame(secondFrame);
    };
  }, [locateRequest, sessions]);

  const toggleProjectExpansion = (projectId: string, isExpanded: boolean) => {
    if (isExpanded) setProjectSessionLimits((current) => ({ ...current, [projectId]: 5 }));
    setExpandedProjectIds((current) => {
      const next = new Set(current);
      if (isExpanded) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (isExpanded) {
        next.add(projectId);
      } else {
        next.delete(projectId);
      }
      return next;
    });
  };

  function isProjectExpanded(projectId: string): boolean {
    return expandedProjectIds.has(projectId)
      || (projectId === activeProjectId && !collapsedProjectIds.has(projectId));
  }

  function toggleSessionExpansion(sessionId: string): void {
    setExpandedSessionIds((current) => {
      const next = new Set(current);
      if (next.has(sessionId)) next.delete(sessionId);
      else next.add(sessionId);
      return next;
    });
  }

  const revealProject = useCallback((projectId: string | null): void => {
    if (projectId === null) setIsTemporaryGroupExpanded(true);
    else {
      setIsProjectsGroupExpanded(true);
      setExpandedProjectIds(current => new Set(current).add(projectId));
      setCollapsedProjectIds(current => {
        const next = new Set(current); next.delete(projectId); return next;
      });
    }
  }, []);
  function toggleTeamExpansion(instanceId: string): void {
    setExpandedTeamIds(current => {
      const next = new Set(current);
      if (next.has(instanceId)) next.delete(instanceId); else next.add(instanceId);
      return next;
    });
  }
  function toggleGroup(group: "projects" | "teams" | "pinned" | "temporary"): void {
    if (group === "projects") setIsProjectsGroupExpanded(current => !current);
    else if (group === "teams") setIsTeamsGroupExpanded(current => !current);
    else if (group === "pinned") setIsPinnedGroupExpanded(current => !current);
    else setIsTemporaryGroupExpanded(current => !current);
  }
  function setAllExpanded(expanded: boolean, projectIds: readonly string[], teamGroups: readonly TeamInstanceNavigatorGroup[]): void {
    setIsProjectsGroupExpanded(expanded);
    setIsTeamsGroupExpanded(expanded);
    setIsPinnedGroupExpanded(expanded);
    setIsTemporaryGroupExpanded(expanded);
    setExpandedProjectIds(new Set(expanded ? projectIds : []));
    setExpandedSessionIds(new Set(expanded ? teamGroups.flatMap(group => group.instance.scope === "conversation" && group.instance.sourceConversationId !== null ? [group.instance.sourceConversationId] : []) : []));
    setExpandedTeamIds(new Set(expanded ? teamGroups.map(group => group.instance.id) : []));
    setCollapsedProjectIds(new Set(expanded ? [] : projectIds));
    if (!expanded) setProjectSessionLimits({});
  }
  function showMoreProjectSessions(projectId: string, limit: number): void {
    setProjectSessionLimits(current => ({ ...current, [projectId]: limit }));
  }
  return {
    bodyRef,
    projectSessionLimits,
    expandedSessionIds,
    expandedTeamIds,
    isProjectsGroupExpanded,
    isTeamsGroupExpanded,
    isPinnedGroupExpanded,
    isTemporaryGroupExpanded,
    isProjectExpanded,
    toggleProjectExpansion,
    toggleSessionExpansion,
    toggleTeamExpansion,
    toggleGroup,
    setAllExpanded,
    revealProject,
    showMoreProjectSessions,
  };
}
