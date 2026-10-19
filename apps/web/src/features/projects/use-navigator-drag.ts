import { useState, type DragEvent } from "react";
import type { ProjectSession } from "./project-session-model.js";
import type { NavigatorDragItem, NavigatorDropIndicator } from "./navigator-types.js";
import { reorderIdentifiers } from "./navigator-model.js";

function setDragPreview(event: DragEvent<HTMLElement>): void {
  const bounds = event.currentTarget.getBoundingClientRect();
  const preview = event.currentTarget.cloneNode(true) as HTMLElement;
  preview.classList.add("project-navigator__drag-preview");
  preview.style.width = `${bounds.width}px`;
  preview.style.height = `${bounds.height}px`;
  document.body.append(preview);
  event.dataTransfer.setDragImage(
    preview,
    Math.max(0, event.clientX - bounds.left),
    Math.max(0, event.clientY - bounds.top),
  );
  window.setTimeout(() => preview.remove(), 0);
}

/** Owns drag feedback, within-group reordering and cross-project conversation moves. */
export function useNavigatorDrag({
  normalizedQuery,
  sessions,
  onSetSessionProject,
  onReorderProjects,
  onReorderSessions,
  onReorderTeamInstances,
  onSessionMoved,
}: {
  normalizedQuery: string;
  sessions: readonly ProjectSession[];
  onSetSessionProject: (sessionId: string, projectId: string | null) => Promise<boolean>;
  onReorderProjects: (projectIds: string[]) => Promise<boolean>;
  onReorderSessions: (sessionIds: string[]) => Promise<boolean>;
  onReorderTeamInstances: (instanceIds: string[]) => Promise<boolean>;
  onSessionMoved: (projectId: string | null) => void;
}) {
  const [dragItem, setDragItem] = useState<NavigatorDragItem | null>(null);
  const [dropIndicator, setDropIndicator] = useState<NavigatorDropIndicator | null>(null);
  const [dropProjectId, setDropProjectId] = useState<string | null | undefined>(undefined);
  function startDrag(
    event: DragEvent<HTMLElement>,
    item: NavigatorDragItem,
    actionsSelector: string,
  ): void {
    if (
      normalizedQuery.length > 0
      || (event.target as Element).closest(actionsSelector) !== null
    ) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", `${item.kind}:${item.id}`);
    setDragPreview(event);
    setDragItem(item);
    setDropIndicator(null);
    setDropProjectId(undefined);
  }

  function updateDropIndicator(
    event: DragEvent<HTMLElement>,
    target: NavigatorDragItem,
  ): void {
    if (dragItem?.kind === "session" && target.kind === "session"
      && dragItem.groupKey !== target.groupKey) {
      const projectId = target.groupKey === "session:temporary"
        ? null
        : target.groupKey.startsWith("session:project:")
          ? target.groupKey.slice("session:project:".length)
          : undefined;
      if (projectId !== undefined && updateProjectDrop(event, projectId)) return;
    }
    setDropProjectId(undefined);
    if (
      dragItem === null
      || dragItem.kind !== target.kind
      || dragItem.groupKey !== target.groupKey
      || dragItem.id === target.id
    ) {
      setDropIndicator(null);
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropIndicator({
      id: target.id,
      kind: target.kind,
      position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    });
  }

  function finishDrag(): void {
    setDragItem(null);
    setDropIndicator(null);
    setDropProjectId(undefined);
  }

  function updateProjectDrop(event: DragEvent<HTMLElement>, projectId: string | null): boolean {
    if (dragItem?.kind !== "session") return false;
    const source = sessions.find((session) => session.id === dragItem.id);
    if (source === undefined || source.projectId === projectId) return false;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropIndicator(null);
    setDropProjectId(projectId);
    return true;
  }

  function moveSessionToProject(event: DragEvent<HTMLElement>, projectId: string | null): boolean {
    if (dragItem?.kind !== "session") return false;
    event.preventDefault();
    event.stopPropagation();
    const session = sessions.find((candidate) => candidate.id === dragItem.id);
    finishDrag();
    if (session === undefined || session.projectId === projectId) return true;
    void onSetSessionProject(session.id, projectId).then((moved) => {
      if (!moved) return;
      onSessionMoved(projectId);
    });
    return true;
  }

  function dropItem(
    event: DragEvent<HTMLElement>,
    target: NavigatorDragItem,
    groupIds: readonly string[],
  ): void {
    event.preventDefault();
    event.stopPropagation();
    if (dragItem?.kind === "session" && target.kind === "session"
      && dragItem.groupKey !== target.groupKey) {
      const projectId = target.groupKey === "session:temporary"
        ? null
        : target.groupKey.startsWith("session:project:")
          ? target.groupKey.slice("session:project:".length)
          : undefined;
      if (projectId !== undefined) {
        moveSessionToProject(event, projectId);
        return;
      }
    }
    if (
      dragItem === null
      || dropIndicator === null
      || dragItem.kind !== target.kind
      || dragItem.groupKey !== target.groupKey
    ) {
      finishDrag();
      return;
    }
    const reordered = reorderIdentifiers(
      groupIds,
      dragItem.id,
      target.id,
      dropIndicator.position,
    );
    finishDrag();
    if (reordered.every((identifier, index) => identifier === groupIds[index])) return;
    if (target.kind === "project") {
      void onReorderProjects(reordered);
    } else if (target.kind === "session") {
      void onReorderSessions(reordered);
    } else {
      void onReorderTeamInstances(reordered);
    }
  }

  return {
    dragItem,
    dropIndicator,
    dropProjectId,
    startDrag,
    updateDropIndicator,
    finishDrag,
    updateProjectDrop,
    moveSessionToProject,
    dropItem,
  };
}
