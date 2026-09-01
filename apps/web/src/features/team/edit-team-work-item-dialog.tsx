import type { TeamWorkItemView } from "@agent/protocol";
import { Save } from "lucide-react";
import { useState, type FormEvent, type ReactElement } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../components/ui/dialog.js";

export function EditTeamWorkItemDialog({
  isSubmitting,
  item,
  onClose,
  onSubmit,
}: {
  isSubmitting: boolean;
  item: TeamWorkItemView | null;
  onClose: () => void;
  onSubmit: (input: { requirement: string; title: string; workItemId: string }) => Promise<void>;
}): ReactElement {
  return (
    <Dialog open={item !== null} onOpenChange={(open) => open ? undefined : onClose()}>
      <DialogContent className="border border-[var(--app-border)] p-0">
        {item === null ? null : (
          <EditTeamWorkItemForm
            key={item.id}
            isSubmitting={isSubmitting}
            item={item}
            onClose={onClose}
            onSubmit={onSubmit}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function EditTeamWorkItemForm({
  isSubmitting,
  item,
  onClose,
  onSubmit,
}: {
  isSubmitting: boolean;
  item: TeamWorkItemView;
  onClose: () => void;
  onSubmit: (input: { requirement: string; title: string; workItemId: string }) => Promise<void>;
}): ReactElement {
  const [title, setTitle] = useState(item.title);
  const [requirement, setRequirement] = useState(item.requirement);
  const canSubmit = title.trim().length > 0 && requirement.trim().length > 0 && !isSubmitting;
  const isRunning = item.status === "running" || item.status === "reviewing";
  const isFinished = item.status === "waiting_user" || item.status === "completed";

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    if (!canSubmit) return;
    try {
      await onSubmit({
        requirement: requirement.trim(),
        title: title.trim(),
        workItemId: item.id,
      });
      onClose();
    } catch {
      // The workspace keeps the dialog open and shows the mutation error above the active view.
    }
  };

  return (
    <form className="grid gap-[12px] p-[16px]" onSubmit={(event) => void submit(event)}>
          <DialogHeader className="pr-[30px]">
            <DialogTitle>修改团队任务</DialogTitle>
            <DialogDescription>
              {isRunning
                ? "保存后，最新任务内容会立即作为补充指令交给当前团队执行。"
                : isFinished
                  ? "这里修改任务记录，不会改写既有执行结果；需要重新执行时请再发起返工。"
                  : "保存后更新任务标题和完整需求，并保留此前的执行与审计记录。"}
            </DialogDescription>
          </DialogHeader>

          <label className="grid gap-[5px]">
            <span className="text-[length:var(--app-font-size-control)] font-semibold text-[var(--app-foreground)]">任务标题</span>
            <input
              aria-label="修改任务标题"
              className="h-[34px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[9px] text-[length:var(--app-font-size-body)] text-[var(--app-foreground)] outline-none focus:border-[var(--app-focus-ring)]"
              maxLength={300}
              value={title}
              onChange={(event) => setTitle(event.currentTarget.value)}
            />
          </label>

          <label className="grid gap-[5px]">
            <span className="text-[length:var(--app-font-size-control)] font-semibold text-[var(--app-foreground)]">任务需求</span>
            <textarea
              aria-label="修改任务需求"
              className="min-h-[180px] resize-y rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[9px] py-[7px] text-[length:var(--app-font-size-body)] leading-[1.55] text-[var(--app-foreground)] outline-none focus:border-[var(--app-focus-ring)]"
              maxLength={50_000}
              value={requirement}
              onChange={(event) => setRequirement(event.currentTarget.value)}
            />
          </label>

          <DialogFooter className="border-t border-[var(--app-border)] pt-[12px]">
            <button className="h-[32px] rounded-[var(--app-radius)] px-[10px] text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)] hover:bg-[var(--app-hover)]" type="button" onClick={onClose}>取消</button>
            <button
              className="inline-flex h-[32px] items-center gap-[5px] rounded-[var(--app-radius)] bg-[var(--app-accent)] px-[12px] text-[length:var(--app-font-size-control)] font-semibold text-white hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50"
              disabled={!canSubmit}
              type="submit"
            >
              <Save aria-hidden="true" size={14} />{isSubmitting ? "保存中" : "保存修改"}
            </button>
          </DialogFooter>
    </form>
  );
}
