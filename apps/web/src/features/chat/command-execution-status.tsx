import { useEffect, useState, type ReactElement } from "react";
import type { ConversationToolItem } from "@agent/protocol";

export type CommandExecutionState = {
  status: ConversationToolItem["status"];
  startedAt: string | null;
  completedAt: string | null;
  timedOut: boolean;
};

export function CommandExecutionStatus({ execution, showDuration = true }: {
  execution: CommandExecutionState;
  showDuration?: boolean;
}): ReactElement {
  const label = execution.timedOut ? "超时" : {
    awaiting_approval: "待审批", running: "运行中", completed: "已完成", failed: "失败", cancelled: "已停止", rejected: "已拒绝",
  }[execution.status];
  return <span data-command-execution-status={execution.status}
    className="inline-flex !flex-none items-center gap-[5px] whitespace-nowrap text-[length:var(--app-font-size-body)] font-normal text-[var(--app-muted-foreground)]">
    <span className={execution.status === "failed" || execution.timedOut ? "text-[var(--app-destructive)]" : ""}>{label}</span>
    {showDuration ? <CommandElapsed key={execution.startedAt} execution={execution} /> : null}
  </span>;
}

function CommandElapsed({ execution }: { execution: CommandExecutionState }): ReactElement | null {
  const startedAt = Date.parse(execution.startedAt ?? "");
  const completedAt = Date.parse(execution.completedAt ?? "");
  const running = execution.status === "running" && !Number.isFinite(completedAt);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running || !Number.isFinite(startedAt)) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [running, startedAt]);
  if (execution.status === "awaiting_approval" || !Number.isFinite(startedAt)
    || (!running && !Number.isFinite(completedAt))) return null;
  const seconds = Math.max(0, Math.floor(((running ? now : completedAt) - startedAt) / 1_000));
  return <span data-command-duration="" className="!flex-none tabular-nums"
    aria-label={`${running ? "已运行" : "用时"} ${seconds} 秒`}>{seconds}s</span>;
}
