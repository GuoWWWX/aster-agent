import { X } from "lucide-react";
import type { ReactElement } from "react";
import type { AgentTeam, ProjectSummary } from "@agent/protocol";
import { Spinner } from "../../components/ui/loading.js";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../../components/ui/select.js";
import type { NavigatorDialog } from "./navigator-types.js";

const UNASSOCIATED_PROJECT_SELECT_VALUE = "__unassociated_project__";

export function NavigatorManagementDialog({
  dialog,
  draftName,
  draftProjectId,
  draftTeamId,
  isSubmitting,
  onCancel,
  onDraftNameChange,
  onDraftProjectIdChange,
  onDraftTeamIdChange,
  onSubmit,
  teams,
  projects,
}: {
  dialog: NavigatorDialog;
  draftName: string;
  draftProjectId: string;
  draftTeamId: string;
  isSubmitting: boolean;
  onCancel: () => void;
  onDraftNameChange: (value: string) => void;
  onDraftProjectIdChange: (value: string) => void;
  onDraftTeamIdChange: (value: string) => void;
  onSubmit: () => void;
  teams: readonly AgentTeam[];
  projects: readonly ProjectSummary[];
}): ReactElement {
  const isCreate = dialog.kind === "create-team-instance";
  const isEditTeam = dialog.kind === "edit-team-instance";
  const isRename = dialog.kind === "rename-project"
    || dialog.kind === "rename-session"
    || dialog.kind === "rename-team-instance";
  const title = dialog.kind === "rename-project"
    ? "重命名项目"
    : dialog.kind === "rename-session"
      ? "重命名对话"
      : dialog.kind === "rename-team-instance"
        ? "重命名团队"
        : dialog.kind === "edit-team-instance"
          ? "编辑团队"
        : dialog.kind === "create-team-instance"
          ? dialog.scope === "global"
            ? "创建团队"
            : dialog.scope === "project"
              ? "创建项目团队"
              : "创建对话团队"
      : dialog.kind === "remove-project"
        ? "移除项目"
        : dialog.kind === "delete-team-instance"
          ? "删除团队"
          : "删除对话";
  const description = dialog.kind === "remove-project"
    ? `将从工作区移除“${dialog.project.name}”，并删除本软件中的相关对话记录。磁盘文件不会被删除。`
    : dialog.kind === "delete-session"
      ? `将删除“${dialog.session.title}”及其对话记录。本次软件运行期间可通过左上角撤销；关闭软件后无法撤销。`
      : dialog.kind === "delete-team-instance"
        ? `将删除团队“${dialog.instance.name}”。现有对话与执行记录会保留用于审计。`
      : null;

  return (
    <div className="project-navigator__dialog-backdrop" data-native-view-overlay="">
      <form
        aria-labelledby="navigator-management-dialog-title"
        aria-modal="true"
        className="project-navigator__dialog"
        role="dialog"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <div className="project-navigator__dialog-header">
          <h2 id="navigator-management-dialog-title">{title}</h2>
          <button aria-label="关闭" disabled={isSubmitting} type="button" onClick={onCancel}>
            <X aria-hidden="true" size={15} />
          </button>
        </div>
        {isCreate ? (
          <>
            {dialog.kind === "create-team-instance" && dialog.scope !== "conversation" ? (
              <div className="project-navigator__dialog-field">
                <span id="navigator-team-project-label">关联项目</span>
                <Select
                  value={draftProjectId || UNASSOCIATED_PROJECT_SELECT_VALUE}
                  onValueChange={(value) => onDraftProjectIdChange(
                    value === UNASSOCIATED_PROJECT_SELECT_VALUE ? "" : value,
                  )}
                >
                  <SelectTrigger
                    aria-labelledby="navigator-team-project-label"
                    autoFocus
                    className="w-full"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="start">
                    <SelectItem value={UNASSOCIATED_PROJECT_SELECT_VALUE}>不关联项目</SelectItem>
                    {projects.map((project) => (
                      <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
            <div className="project-navigator__dialog-field">
              <span id="navigator-team-template-label">团队模板</span>
              <Select
                value={draftTeamId}
                onValueChange={onDraftTeamIdChange}
              >
                <SelectTrigger
                  aria-labelledby="navigator-team-template-label"
                  autoFocus={dialog.kind !== "create-team-instance" || dialog.scope === "conversation"}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent align="start">
                  {teams.map((team) => (
                    <SelectItem key={team.id} value={team.id}>
                      {team.name}{team.enabled ? "" : "（已暂停）"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="project-navigator__dialog-field">
              <span>团队名（可选）</span>
              <input
                maxLength={120}
                placeholder="留空时使用模板名称，重名会自动编号"
                value={draftName}
                onChange={(event) => onDraftNameChange(event.target.value)}
              />
            </label>
          </>
        ) : isEditTeam ? (
          <div className="project-navigator__dialog-field">
            <span id="navigator-edit-team-project-label">关联项目</span>
            <Select
              value={draftProjectId || UNASSOCIATED_PROJECT_SELECT_VALUE}
              onValueChange={(value) => onDraftProjectIdChange(
                value === UNASSOCIATED_PROJECT_SELECT_VALUE ? "" : value,
              )}
            >
              <SelectTrigger
                aria-labelledby="navigator-edit-team-project-label"
                autoFocus
                className="w-full"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent align="start">
                <SelectItem value={UNASSOCIATED_PROJECT_SELECT_VALUE}>不关联项目</SelectItem>
                {projects.map((project) => (
                  <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : isRename ? (
          <label className="project-navigator__dialog-field">
            <span>名称</span>
            <input
              autoFocus
              maxLength={dialog.kind === "rename-team-instance" ? 120 : 200}
              value={draftName}
              onChange={(event) => onDraftNameChange(event.target.value)}
            />
          </label>
        ) : (
          <p>{description}</p>
        )}
        <div className="project-navigator__dialog-actions">
          <button disabled={isSubmitting} type="button" onClick={onCancel}>
            取消
          </button>
          <button
            className={isCreate || isRename || isEditTeam
              ? "project-navigator__dialog-primary"
              : "project-navigator__dialog-danger"}
            disabled={isSubmitting
              || (isRename && draftName.trim().length === 0)
              || (isCreate && draftTeamId.length === 0)}
            type="submit"
          >
            {isSubmitting
              ? <><Spinner size={14} className="mr-[5px]" />处理中…</>
              : isCreate ? "创建" : isRename || isEditTeam ? "保存" : "确认"}
          </button>
        </div>
      </form>
    </div>
  );
}
