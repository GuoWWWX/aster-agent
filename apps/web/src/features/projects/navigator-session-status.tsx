import type { ReactElement } from "react";
import { ConversationWorkIndicator } from "../chat/conversation-work-state.js";
import { isProjectSessionRunning as isSessionRunning, type ProjectSession } from "./project-session-model.js";

export function hasUnreadSessionResult(session: ProjectSession): boolean {
  return session.hasUnreadSideConversationResult === true
    || (session.hasUnreadResult
      && (session.lastRunStatus === "completed" || session.lastRunStatus === "failed"));
}

function hasFailedUnreadSessionResult(session: ProjectSession): boolean {
  return session.hasFailedUnreadSideConversationResult === true
    || (session.hasUnreadResult && session.lastRunStatus === "failed");
}

export function sessionStatusLabel(session: ProjectSession): string | null {
  if (isSessionRunning(session)) return "正在运行";
  if (!hasUnreadSessionResult(session)) return null;
  return hasFailedUnreadSessionResult(session) ? "上次运行失败" : "上次运行完成";
}

export function SessionStatusIndicator({
  session,
}: { session: ProjectSession }): ReactElement | null {
  if (isSessionRunning(session)) {
    return (
      <ConversationWorkIndicator runId={session.activeRunId} aria-label="正在运行" className="project-navigator__session-status project-navigator__session-status--running" size={14} />
    );
  }
  if (hasFailedUnreadSessionResult(session)) {
    return (
      <span
        aria-label="上次运行失败"
        title="有未读的失败结果"
        className="project-navigator__session-status project-navigator__session-status--failed"
        role="img"
      />
    );
  }
  if (hasUnreadSessionResult(session)) {
    return (
      <span
        aria-label="上次运行完成"
        title="有未读回复"
        className="project-navigator__session-status project-navigator__session-status--completed"
        role="img"
      />
    );
  }
  return null;
}
