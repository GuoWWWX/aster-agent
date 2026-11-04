import { Archive, ArchiveRestore, MessageSquareText, MoreHorizontal, Scale } from "lucide-react";
import type { DragEvent, MouseEvent, ReactElement } from "react";
import { IconButton } from "../../components/ui/icon-button.js";
import { isProjectSessionRunning as isSessionRunning, type ProjectSession } from "./project-session-model.js";
import { SessionStatusIndicator, sessionStatusLabel } from "./navigator-session-status.js";

export type SessionButtonProps = {
  menuOpen?: boolean;
  active: boolean;
  archived?: boolean;
  draggable: boolean;
  dragging: boolean;
  dropPosition: "after" | "before" | null;
  located: boolean;
  session: ProjectSession;
  onArchive: (archived: boolean) => void;
  onContextMenu: (event: MouseEvent) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDragStart: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
  onPin: (pinned: boolean) => void;
  onSelect: (sessionId: string) => void;
  onKeep?: (sessionId: string) => void;
};

export function SessionButton({
  active,
  menuOpen = false,
  archived = false,
  draggable,
  dragging,
  dropPosition,
  located,
  session,
  onArchive,
  onContextMenu,
  onDragEnd,
  onDragOver,
  onDragStart,
  onDrop,
  onSelect,
  onKeep,
}: SessionButtonProps & {
  onCreateTeam?: () => void;
}): ReactElement {
  const statusLabel = sessionStatusLabel(session);
  const archiveDisabled = isSessionRunning(session) || (!!session.teamWorkItemId && !archived);

  return (
    <div
      className="project-navigator__session-shell"
      data-menu-open={menuOpen}
      data-dragging={dragging}
      data-drop-position={dropPosition ?? undefined}
      data-pinned={session.isPinned}
      draggable={draggable}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDragStart={onDragStart}
      onDrop={onDrop}
    >
      <button
        aria-current={active ? "page" : undefined}
        className="project-navigator__session"
        data-active={active}
        data-located={located}
        data-navigator-key={`session:${session.id}`}
        data-run-status={session.lastRunStatus ?? "idle"}
        title={statusLabel === null ? session.title : `${session.title} · ${statusLabel}`}
        type="button"
        onClick={() => onSelect(session.id)}
        onDoubleClick={() => onKeep?.(session.id)}
        onContextMenu={onContextMenu}
      >
        {session.threadKind === "team_lead" ? (
          <Scale aria-label="Team Lead 对话" size={14} />
        ) : (
          <MessageSquareText aria-hidden="true" size={14} />
        )}
        <span className="project-navigator__session-title">{session.title}</span>
        <SessionStatusIndicator session={session} />
      </button>
      <div className="project-navigator__session-actions">
        <IconButton
          label={`${archived ? "取消归档" : "归档"} ${session.title}`}
          tooltip={archived ? "取消归档" : "归档"}
          disabled={archiveDisabled}
          onClick={(event) => {
            event.stopPropagation();
            onArchive(!archived);
          }}
        >
          {archived ? <ArchiveRestore aria-hidden="true" size={15} /> : <Archive aria-hidden="true" size={15} />}
        </IconButton>
        <IconButton label={`更多 ${session.title}`} tooltip="更多" aria-haspopup="menu" aria-expanded={menuOpen} onClick={(event) => {
          event.stopPropagation();
          onContextMenu(event);
        }}>
          <MoreHorizontal aria-hidden="true" size={15} />
        </IconButton>
      </div>
    </div>
  );
}
