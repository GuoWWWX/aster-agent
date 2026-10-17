import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { MessageSquareText, RefreshCw, X } from "lucide-react";
import type { ConversationMessageItem, TeamChatCoordinationStep, TeamChatMember, TeamChatMessage } from "@agent/protocol";
import type { AgentClient } from "../../runtime/agent-client.js";
import { getUserErrorMessage } from "../../runtime/index.js";
import { WorkbenchPanel } from "../../components/layout/panel.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { teamChatTabId } from "../chat/workbench-tabs.js";
import { formatConversationTime } from "../chat/chat-message-meta.js";
import { ConversationWorkspace } from "../chat/workspace-content.js";
import { AgentAvatar } from "./agent-avatar.js";

const stepLabels: Record<TeamChatCoordinationStep["type"], string> = {
  started: "开始后台协调", model_requested: "请求协调模型", retry_scheduled: "暂时失败，准备自动重试",
  completed: "已确定投递对象", failed: "协调未完成", cancelled: "协调已停止",
};

function coordinationTranscript(messages: readonly TeamChatMessage[], members: readonly TeamChatMember[]): ConversationMessageItem[] {
  return messages.flatMap(message => {
    const coordinator = message.coordinator!;
    const steps = coordinator.steps ?? [];
    const modelId = steps.findLast(step => step.modelId !== undefined)?.modelId ?? coordinator.modelSelection?.modelId ?? null;
    const terminal = steps.findLast(step => step.type === "completed" || step.type === "failed" || step.type === "cancelled");
    const completedAt = coordinator.status === "pending" ? null : terminal?.at ?? message.createdAt;
    const base = { attachments: [], conversationId: message.teamInstanceId, createdAt: message.createdAt, runId: null, modelId };
    const source: ConversationMessageItem = { ...base, id: `${message.id}:source`, kind: "message", content: message.content, role: "user", status: "completed" };
    const process = steps.filter(step => step.type !== "completed" && step.type !== "failed" && step.type !== "cancelled")
      .map(step => `${formatConversationTime(step.at)} ${stepLabels[step.type]}${step.attempt === undefined ? "" : ` · 第 ${step.attempt} 次`}${step.modelId === undefined ? "" : ` · ${step.modelId}`}${step.detail === undefined ? "" : `\n\n${step.detail}`}`).join("\n\n");
    const recipients = message.recipientConversationIds.map(id => members.find(member => member.conversationId === id)?.name ?? id).join("、");
    const result = coordinator.status === "pending" ? "正在选择回答成员…"
      : coordinator.status === "failed" ? coordinator.error ?? terminal?.detail ?? "协调未完成，可以重试。"
      : coordinator.status === "cancelled" ? terminal?.detail ?? "协调已停止。"
      : `${terminal?.detail ?? "已完成协调。"}\n\n${recipients ? `交给：${recipients}` : message.intent === "notify" ? "本条为通知，无需唤醒成员。" : "本次没有需要唤醒的成员。"}`;
    const response: ConversationMessageItem = { ...base, id: message.id, kind: "message", role: "assistant", content: result, completedAt,
      status: coordinator.status === "pending" ? "streaming" : coordinator.status === "failed" ? "failed" : "completed" };
    return [source, ...(process ? [{ ...base, id: `${message.id}:process`, kind: "message" as const, role: "assistant" as const, status: "completed" as const,
      content: process, completedAt: steps.at(-1)?.at ?? message.createdAt }] : []), response];
  });
}

/** The group's JSONL trace is presented through the ordinary compact conversation workspace. */
export function TeamChatCoordinationWorkspace({ agentClient, teamInstanceId, teamName, active }: {
  agentClient: AgentClient; teamInstanceId: string; teamName: string; active: boolean;
}): ReactElement {
  const agents = useAgentDirectoryStore(state => state.agents);
  const target = useWorkbenchUiStore(state => state.teamChatCoordinationTarget);
  const panelOpen = useWorkbenchUiStore(state => state.filePanelOpenByConversationId[teamChatTabId(teamInstanceId)] ?? false);
  const visible = active && panelOpen;
  const focus = target?.instanceId === teamInstanceId ? target : null;
  const [messages, setMessages] = useState<TeamChatMessage[]>([]);
  const [members, setMembers] = useState<TeamChatMember[]>([]);
  const [cursor, setCursor] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const loaded = useRef(false); const dirty = useRef(true); const version = useRef(0);
  const revision = useRef(0);
  const knownIds = useRef(new Set<string>()); const handledFocus = useRef<string | null>(null);
  const load = useCallback(async (beforeSequence?: number): Promise<void> => {
    const request = ++version.current; const startRevision = revision.current; setLoading(true);
    try {
      const [page, roster] = await Promise.all([agentClient.readTeamChat({ teamInstanceId, ...(beforeSequence === undefined ? {} : { beforeSequence }) }),
        agentClient.getTeamChatMembers({ teamInstanceId })]);
      if (request !== version.current) return;
      const records = page.messages.filter(message => message.coordinator != null);
      for (const message of records) knownIds.current.add(message.id);
      setMessages(previous => [...new Map([...previous, ...records].map(message => [message.id, message])).values()].sort((a, b) => a.sequence - b.sequence));
      if (!loaded.current || beforeSequence !== undefined) setCursor(page.nextBeforeSequence);
      setMembers(roster); loaded.current = true; dirty.current = revision.current !== startRevision; setError(null);
    } catch (reason) { if (request === version.current) setError(getUserErrorMessage(reason, "无法加载协调记录")); }
    finally { if (request === version.current) setLoading(false); }
  }, [agentClient, teamInstanceId]);
  useEffect(() => {
    if (!visible) return;
    const newFocus = focus !== null && handledFocus.current !== focus.requestId;
    if (newFocus) handledFocus.current = focus.requestId;
    if (newFocus && focus?.sequence !== undefined && focus.messageId !== undefined && !knownIds.current.has(focus.messageId)) void load(focus.sequence + 1);
    else if (!loaded.current || dirty.current) void load();
  }, [visible, focus, load]);
  useEffect(() => () => { version.current += 1; }, []);
  useEffect(() => agentClient.onConversationRunEvent(event => {
    if (event.type !== "collaboration.changed" || event.teamInstanceId !== teamInstanceId) return;
    revision.current += 1; dirty.current = true;
    if (visible) void load();
  }), [agentClient, load, teamInstanceId, visible]);
  const retry = async (messageId: string): Promise<void> => {
    setRetryingId(messageId);
    try { await agentClient.resumeTeamChatDelivery({ id: messageId }); await load(); }
    catch (reason) { setError(getUserErrorMessage(reason, "无法继续协调")); }
    finally { setRetryingId(null); }
  };
  const items = useMemo(() => coordinationTranscript(messages, members), [messages, members]);
  const owner = agents.find(agent => agent.id === messages.at(-1)?.coordinator?.agentId);
  const title = `${owner?.name ?? "群聊 Agent"} · 后台协调`;
  const close = (): void => useWorkbenchUiStore.getState().setFilePanelOpenForConversation(teamChatTabId(teamInstanceId), false);
  return <WorkbenchPanel className="right-sidebar-workspace" aria-label="群聊后台协调对话">
    <div className="right-sidebar-workspace__main">
      <div className="right-sidebar-workspace__tabs-row">
        <div role="tablist" aria-label="群聊侧边工作区" className="right-sidebar-workspace__tabs">
          <div className="right-sidebar-workspace__tab-shell" data-active="true">
            <button type="button" role="tab" aria-selected="true" className="right-sidebar-workspace__tab" title={title}>
              {owner === undefined ? <MessageSquareText aria-hidden="true" size={14} /> : <AgentAvatar avatar={owner.avatar} size="compact" />}<span className="truncate">{title}</span>
            </button>
            <IconButton label="关闭协调对话" className="right-sidebar-workspace__tab-close" size="compact" variant="quiet" onClick={close}><X size={12} /></IconButton>
          </div>
        </div>
        <IconButton label="刷新协调记录" size="compact" variant="quiet" disabled={loading} onClick={() => void load()}><RefreshCw size={14} /></IconButton>
        <IconButton label="关闭侧边工作区" size="compact" variant="quiet" onClick={close}><X size={14} /></IconButton>
      </div>
      <ConversationWorkspace active={visible} agentClient={agentClient} compact
        locateTimelineItem={focus?.messageId === undefined ? null : { id: focus.messageId, requestId: focus.requestId }}
        transcript={{ title: `${teamName} / ${title}`, avatar: owner?.avatar ?? null, items, loading, error, retryingMessageId: retryingId,
          onRetryMessage: id => void retry(id), onLoadOlder: cursor === null ? undefined : () => void load(cursor) }} />
    </div>
  </WorkbenchPanel>;
}
