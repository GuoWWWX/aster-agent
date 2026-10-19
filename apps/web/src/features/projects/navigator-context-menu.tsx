import {
  Archive,
  ArchiveRestore,
  Copy,
  Eye,
  EyeOff,
  FolderOpen,
  Pencil,
  Pin,
  PinOff,
  Settings2,
  Trash2,
  UsersRound,
} from "lucide-react";
import { useEffect, type ReactElement } from "react";
import type { ProjectSummary, TeamInstanceView } from "@agent/protocol";
import { isProjectSessionRunning as isSessionRunning, type ProjectSession } from "./project-session-model.js";
import type { NavigatorContextMenu, NavigatorMenuTarget } from "./navigator-types.js";

export function NavigatorContextMenuView({
  menu,
  canCreateTeam,
  canOpenDirectory,
  onCreateTeam,
  onProjectPathAction,
  projectHasRunningSession,
  onClose,
  onDeleteSession,
  onDeleteTeamInstance,
  onEditTeamInstance,
  onRemoveProject,
  onRename,
  onSetArchived,
  onSetPinned,
  onSetProjectPinned,
  onSetProjectTeamsInNavigator,
  onSetTeamInstanceArchived,
}: {
  menu: NavigatorContextMenu;
  canCreateTeam: boolean;
  canOpenDirectory: boolean;
  onCreateTeam: (target: NavigatorMenuTarget) => void;
  onProjectPathAction: (project: ProjectSummary, action: "copy" | "open") => void;
  projectHasRunningSession: boolean;
  onClose: () => void;
  onDeleteSession: (session: ProjectSession) => void;
  onDeleteTeamInstance: (instance: TeamInstanceView) => void;
  onEditTeamInstance: (instance: TeamInstanceView) => void;
  onRemoveProject: (project: ProjectSummary) => void;
  onRename: (target: NavigatorMenuTarget) => void;
  onSetArchived: (session: ProjectSession, archived: boolean) => void;
  onSetPinned: (session: ProjectSession, pinned: boolean) => void;
  onSetProjectPinned: (project: ProjectSummary, pinned: boolean) => void;
  onSetProjectTeamsInNavigator: (
    project: ProjectSummary,
    showTeamsInNavigator: boolean,
  ) => void;
  onSetTeamInstanceArchived: (instance: TeamInstanceView, archived: boolean) => void;
}): ReactElement {
  const target = menu.target;
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
  const sessionIsRunning = target.kind === "session" && (
    isSessionRunning(target.session)
  );
  const sessionIsManagedTeamWorkItem = target.kind === "session"
    && target.session.teamWorkItemId !== null
    && target.session.teamWorkItemId !== undefined
    && !target.session.isArchived;

  return (
    <>
      <div
        aria-hidden="true"
        className="project-navigator__context-menu-backdrop"
        data-native-view-overlay=""
        onMouseDown={onClose}
      />
      <div
        className="project-navigator__context-menu"
        role="menu"
        style={{ left: menu.x, top: menu.y, maxHeight: `calc(100vh - ${menu.y + 8}px)`, overflowY: "auto" }}
      >
        {target.kind !== "team-instance" && (target.kind === "project" || (!target.session.isArchived && !target.session.teamWorkItemId)) ? (
          <button role="menuitem" type="button" disabled={!canCreateTeam}
            title={!canCreateTeam ? "请先在设置中配置团队模板" : undefined}
            onClick={() => onCreateTeam(target)}>
            <UsersRound aria-hidden="true" size={15} />创建团队
          </button>
        ) : null}
        {target.kind === "team-instance" ? (
          <>
            <button role="menuitem" type="button" onClick={() => onRename(target)}>
              <Pencil aria-hidden="true" size={15} />
              重命名团队
            </button>
            <button
              disabled={target.instance.scope === "conversation"}
              role="menuitem"
              title={target.instance.scope === "conversation"
                ? "对话团队保留原对话的项目归属"
                : undefined}
              type="button"
              onClick={() => onEditTeamInstance(target.instance)}
            >
              <Settings2 aria-hidden="true" size={15} />
              编辑团队
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => onSetTeamInstanceArchived(target.instance, true)}
            >
              <Archive aria-hidden="true" size={15} />
              归档团队
            </button>
            <div className="project-navigator__context-menu-separator" role="separator" />
            <button
              className="project-navigator__context-menu-danger"
              role="menuitem"
              type="button"
              onClick={() => onDeleteTeamInstance(target.instance)}
            >
              <Trash2 aria-hidden="true" size={15} />
              删除团队
            </button>
          </>
        ) : target.kind === "session" ? (
          <>
            <button role="menuitem" type="button" onClick={() => onRename(target)}>
              <Pencil aria-hidden="true" size={15} />
              重命名
            </button>
            <button
              role="menuitem"
              type="button"
              onClick={() => onSetPinned(target.session, !target.session.isPinned)}
            >
              {target.session.isPinned ? (
                <PinOff aria-hidden="true" size={15} />
              ) : (
                <Pin aria-hidden="true" size={15} />
              )}
              {target.session.isPinned ? "取消置顶" : "置顶"}
            </button>
            <button
              disabled={sessionIsRunning || sessionIsManagedTeamWorkItem}
              role="menuitem"
              title={sessionIsManagedTeamWorkItem
                ? "团队执行对话由 WorkItem 生命周期保留"
                : sessionIsRunning ? "运行中的对话不能归档" : undefined}
              type="button"
              onClick={() =>
                onSetArchived(target.session, !target.session.isArchived)
              }
            >
              {target.session.isArchived ? (
                <ArchiveRestore aria-hidden="true" size={15} />
              ) : (
                <Archive aria-hidden="true" size={15} />
              )}
              {target.session.isArchived ? "取消归档" : "归档"}
            </button>
            <div className="project-navigator__context-menu-separator" role="separator" />
            <button
              className="project-navigator__context-menu-danger"
              disabled={sessionIsRunning || sessionIsManagedTeamWorkItem}
              role="menuitem"
              title={sessionIsManagedTeamWorkItem
                ? "团队执行对话由 WorkItem 生命周期保留"
                : sessionIsRunning ? "运行中的对话不能删除" : undefined}
              type="button"
              onClick={() => onDeleteSession(target.session)}
            >
              <Trash2 aria-hidden="true" size={15} />
              删除对话
            </button>
          </>
        ) : (
          <>
            <button
              role="menuitem"
              type="button"
              onClick={() => onSetProjectPinned(target.project, target.project.isPinned !== true)}
            >
              {target.project.isPinned === true ? (
                <PinOff aria-hidden="true" size={15} />
              ) : (
                <Pin aria-hidden="true" size={15} />
              )}
              {target.project.isPinned === true ? "取消置顶项目" : "置顶项目"}
            </button>
            <button role="menuitem" type="button" onClick={() => onRename(target)}>
              <Pencil aria-hidden="true" size={15} />
              重命名
            </button>
            <button
              aria-checked={target.project.showTeamsInNavigator === true}
              role="menuitemcheckbox"
              type="button"
              onClick={() => onSetProjectTeamsInNavigator(
                target.project,
                target.project.showTeamsInNavigator !== true,
              )}
            >
              {target.project.showTeamsInNavigator === true ? (
                <Eye aria-hidden="true" size={15} />
              ) : (
                <EyeOff aria-hidden="true" size={15} />
              )}
              在项目中显示团队
            </button>
            <div className="project-navigator__context-menu-separator" role="separator" />
            <button role="menuitem" type="button" onClick={() => onProjectPathAction(target.project, "copy")}>
              <Copy aria-hidden="true" size={15} />复制项目路径
            </button>
            <button role="menuitem" type="button" disabled={!canOpenDirectory} onClick={() => onProjectPathAction(target.project, "open")}>
              <FolderOpen aria-hidden="true" size={15} />在资源管理器打开
            </button>
            <div className="project-navigator__context-menu-separator" role="separator" />
            <button
              className="project-navigator__context-menu-danger"
              disabled={projectHasRunningSession}
              role="menuitem"
              title={projectHasRunningSession ? "项目中有正在运行的对话" : undefined}
              type="button"
              onClick={() => onRemoveProject(target.project)}
            >
              <Trash2 aria-hidden="true" size={15} />
              移除项目
            </button>
          </>
        )}
      </div>
    </>
  );
}
