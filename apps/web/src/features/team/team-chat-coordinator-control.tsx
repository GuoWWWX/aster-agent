import { useState, type ReactElement } from "react";
import { Pause } from "lucide-react";
import type { AgentProfile, TeamChatActivity } from "@agent/protocol";
import { IconButton } from "../../components/ui/icon-button.js";
import { ModelWorkingIndicator } from "../../components/ui/model-working-indicator.js";
import type { AgentClient } from "../../runtime/agent-client.js";
import { getUserErrorMessage } from "../../runtime/index.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { AgentAvatar } from "./agent-avatar.js";

export function TeamChatCoordinatorControl({ agentClient, teamInstanceId, agent, activity, active }: {
  agentClient: AgentClient; teamInstanceId: string; agent: AgentProfile;
  activity: TeamChatActivity | null; active: boolean;
}): ReactElement {
  const [pausing, setPausing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = activity?.status === "coordinating" || activity?.status === "working";
  const description = pausing ? "正在暂停…" : activity?.status === "coordinating" ? "正在协调群聊"
    : activity?.status === "working" ? activity.activeMemberCount > 0 ? `${activity.activeMemberCount} 位成员正在处理` : "等待成员开始处理"
    : activity?.status === "paused" ? "已暂停" : activity?.status === "failed" ? "协调失败，点击查看" : "空闲";
  const pause = async (): Promise<void> => {
    setPausing(true); setError(null);
    try { await agentClient.pauseTeamChat({ teamInstanceId }); }
    catch (reason) { setError(getUserErrorMessage(reason, "暂停失败，请重试")); }
    finally { setPausing(false); }
  };
  return <div className="flex min-h-[96px] shrink-0 flex-col items-center justify-center gap-[5px] px-[5px] py-[5px]" aria-label="群聊协调 Agent">
    <div className="relative">
      <button type="button" aria-label="查看后台协调" title={`${agent.name} · ${description}`}
        className="block rounded-[var(--app-radius)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-2"
        onClick={() => useWorkbenchUiStore.getState().openTeamChatCoordination({ instanceId: teamInstanceId, agentId: agent.id })}>
        <AgentAvatar avatar={agent.avatar} size="large" />
      </button>
      <IconButton label="暂停本群任务" tooltip="暂停本群协调及成员执行，保留已完成内容" size="compact" variant="quiet"
        className="absolute left-full top-1/2 ml-[5px] -translate-y-1/2" disabled={!busy || pausing} onClick={() => void pause()}>
        <Pause aria-hidden="true" size={16} />
      </IconButton>
    </div>
    <div className="flex h-[20px] max-w-full items-center justify-center gap-[5px] text-[length:var(--app-font-size-control)] text-[var(--app-muted-foreground)]" aria-live="polite">
      {active && (busy || pausing) ? <ModelWorkingIndicator size={14} phase={pausing ? "waiting" : activity?.status === "coordinating" ? "thinking" : "executing"} /> : null}
      <span className="truncate" role={error === null ? undefined : "alert"} title={error ?? description}>{error === null ? description : "暂停失败，请重试"}</span>
    </div>
  </div>;
}
