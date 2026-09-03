import { Plus, Send } from "lucide-react";
import { useState, type FormEvent, type ReactElement } from "react";
import type {
  ProjectSummary,
  TeamInstanceView,
  TeamWorkItemPriority,
} from "@agent/protocol";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../../components/ui/dialog.js";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";

export type NewTeamWorkItemDraft = {
  acceptanceCriteria: string[];
  priority: TeamWorkItemPriority;
  projectId: string;
  requirement: string;
  teamInstanceId: string;
  title: string;
};

export function NewTeamWorkItemDialog({
  defaultProjectId,
  isSubmitting,
  onSubmit,
  projects,
  teamInstances,
}: {
  defaultProjectId: string | null;
  isSubmitting: boolean;
  onSubmit: (draft: NewTeamWorkItemDraft) => Promise<void>;
  projects: readonly ProjectSummary[];
  teamInstances: readonly TeamInstanceView[];
}): ReactElement {
  const [open, setOpen] = useState(false);
  const initialInstance = teamInstances[0] ?? null;
  const [teamInstanceId, setTeamInstanceId] = useState(initialInstance?.id ?? "");
  const [projectId, setProjectId] = useState(
    initialInstance?.scope === "project"
      ? initialInstance.projectId ?? ""
      : defaultProjectId ?? projects[0]?.id ?? "",
  );
  const [priority, setPriority] = useState<TeamWorkItemPriority>("normal");
  const [title, setTitle] = useState("");
  const [requirement, setRequirement] = useState("");
  const [acceptance, setAcceptance] = useState("");

  const selectedInstance = teamInstances.find((instance) => instance.id === teamInstanceId) ?? null;
  const availableProjects = selectedInstance?.scope === "project"
    ? projects.filter((project) => project.id === selectedInstance.projectId)
    : projects;
  const canSubmit = teamInstanceId.length > 0
    && projectId.length > 0
    && title.trim().length > 0
    && requirement.trim().length > 0
    && !isSubmitting;

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await onSubmit({
        acceptanceCriteria: acceptance
          .split(/\r?\n/u)
          .map((criterion) => criterion.trim())
          .filter((criterion, index, criteria) => (
            criterion.length > 0 && criteria.indexOf(criterion) === index
          )),
        priority,
        projectId,
        requirement: requirement.trim(),
        teamInstanceId,
        title: title.trim(),
      });
    } catch {
      return;
    }
    setOpen(false);
    setTitle("");
    setRequirement("");
    setAcceptance("");
    setPriority("normal");
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          const instance = teamInstances[0] ?? null;
          setTeamInstanceId(instance?.id ?? "");
          setProjectId(instance?.scope === "project"
            ? instance.projectId ?? ""
            : defaultProjectId ?? projects[0]?.id ?? "");
        }
        setOpen(nextOpen);
      }}
    >
      <DialogTrigger asChild>
        <button
          aria-label="新建团队任务"
          className="inline-flex h-[30px] items-center gap-[5px] rounded-[var(--app-radius)] bg-[var(--app-primary-action)] px-[10px] text-[length:var(--app-font-size-control)] font-semibold text-[var(--app-primary-action-foreground)] shadow-sm hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-1"
          disabled={projects.length === 0 || teamInstances.length === 0}
          type="button"
        >
          <Plus aria-hidden="true" size={14} />新建任务
        </button>
      </DialogTrigger>
      <DialogContent className="border border-[var(--app-border)] p-0">
        <form className="grid gap-[12px] p-[16px]" onSubmit={(event) => void submit(event)}>
          <DialogHeader className="pr-[30px]">
            <DialogTitle>新建团队任务</DialogTitle>
            <DialogDescription>
              任务会关联到所选项目，并由当前团队直接进入调度队列。
            </DialogDescription>
          </DialogHeader>

          <div className="grid grid-cols-2 gap-[10px]">
            <Field label="团队实例">
              <Select
                value={teamInstanceId}
                onValueChange={(value) => {
                  const instance = teamInstances.find((candidate) => candidate.id === value) ?? null;
                  setTeamInstanceId(value);
                  setProjectId(instance?.scope === "project"
                    ? instance.projectId ?? ""
                    : defaultProjectId ?? projects[0]?.id ?? "");
                }}
              >
                <SelectTrigger aria-label="选择团队实例" className="h-[32px] w-full bg-[var(--app-panel)] text-[length:var(--app-font-size-control)]">
                  <SelectValue placeholder="选择团队实例" />
                </SelectTrigger>
                <SelectContent>
                  {teamInstances.map((instance) => (
                    <SelectItem key={instance.id} value={instance.id}>
                      {instance.name}{instance.scope === "global" ? " · 全局" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="所属项目">
              <Select value={projectId} onValueChange={setProjectId}>
                <SelectTrigger aria-label="选择任务项目" className="h-[32px] w-full bg-[var(--app-panel)] text-[length:var(--app-font-size-control)]" disabled={selectedInstance?.scope === "project"}>
                  <SelectValue placeholder="选择项目" />
                </SelectTrigger>
                <SelectContent>
                  {availableProjects.map((project) => (
                    <SelectItem key={project.id} value={project.id}>{project.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          </div>

          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-[10px]">
            <Field label="任务标题">
              <input
                aria-label="任务标题"
                className="h-[34px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[9px] text-[length:var(--app-font-size-body)] text-[var(--app-foreground)] outline-none placeholder:text-[var(--app-muted-foreground)] focus:border-[var(--app-focus-ring)]"
                maxLength={300}
                placeholder="一句话说明要完成什么"
                value={title}
                onChange={(event) => setTitle(event.currentTarget.value)}
              />
            </Field>
            <Field label="优先级">
              <Select value={priority} onValueChange={(value) => setPriority(value as TeamWorkItemPriority)}>
                <SelectTrigger aria-label="选择任务优先级" className="h-[32px] w-full bg-[var(--app-panel)] text-[length:var(--app-font-size-control)]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="high">P1 · 高</SelectItem>
                  <SelectItem value="normal">P2 · 普通</SelectItem>
                  <SelectItem value="low">P3 · 低</SelectItem>
                </SelectContent>
              </Select>
            </Field>
          </div>

          <Field label="任务需求">
            <textarea
              aria-label="任务需求"
              className="min-h-[110px] resize-y rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[9px] py-[7px] text-[length:var(--app-font-size-body)] leading-[1.55] text-[var(--app-foreground)] outline-none placeholder:text-[var(--app-muted-foreground)] focus:border-[var(--app-focus-ring)]"
              maxLength={50_000}
              placeholder="写清目标、范围、限制和期望结果"
              value={requirement}
              onChange={(event) => setRequirement(event.currentTarget.value)}
            />
          </Field>

          <Field hint="每行一项，可稍后在验收区逐项确认" label="验收条件">
            <textarea
              aria-label="验收条件"
              className="min-h-[72px] resize-y rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[9px] py-[7px] text-[length:var(--app-font-size-control)] leading-[1.5] text-[var(--app-foreground)] outline-none placeholder:text-[var(--app-muted-foreground)] focus:border-[var(--app-focus-ring)]"
              placeholder={"例如：关键路径测试通过\n例如：交付结果包含变更摘要"}
              value={acceptance}
              onChange={(event) => setAcceptance(event.currentTarget.value)}
            />
          </Field>

          <DialogFooter className="border-t border-[var(--app-border)] pt-[12px]">
            <button
              className="h-[32px] rounded-[var(--app-radius)] px-[10px] text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)]"
              type="button"
              onClick={() => setOpen(false)}
            >
              取消
            </button>
            <button
              aria-label="创建并发布团队任务"
              className="inline-flex h-[32px] items-center gap-[5px] rounded-[var(--app-radius)] bg-[var(--app-primary-action)] px-[12px] text-[length:var(--app-font-size-control)] font-semibold text-[var(--app-primary-action-foreground)] hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSubmit}
              type="submit"
            >
              <Send aria-hidden="true" size={14} />{isSubmitting ? "创建中" : "创建并发布"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({
  children,
  hint,
  label,
}: {
  children: ReactElement;
  hint?: string;
  label: string;
}): ReactElement {
  return (
    <label className="grid min-w-0 gap-[5px]">
      <span className="flex items-center justify-between gap-[5px] text-[length:var(--app-font-size-control)] font-semibold text-[var(--app-foreground)]">
        {label}
        {hint === undefined ? null : (
          <small className="font-normal text-[var(--app-muted-foreground)]">{hint}</small>
        )}
      </span>
      {children}
    </label>
  );
}
