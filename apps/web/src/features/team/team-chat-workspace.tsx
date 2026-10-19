import { teamChatTabId } from "../chat/workbench-tabs.js";
import { type ReactElement } from "react";
import { UsersRound, Search, Settings2 } from "lucide-react";
import type { ConversationSummary, ProjectSummary, TeamInstanceView } from "@agent/protocol";
import type { AgentClient } from "../../runtime/agent-client.js";
import { ConversationWorkspace } from "../chat/workspace-content.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { LoadingState } from "../../components/ui/loading.js";
import { TaskListLauncher } from "./task-context-directory.js";
import { TeamChatCoordinationResults } from "./team-chat-coordination-results.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";

export function TeamChatWorkspace({ agentClient, instance, active, focusMessageId, onOpenConversation, onOpenFile, sessions, projects, onSessionUpdated }: {
  agentClient: AgentClient; instance: TeamInstanceView; active: boolean; focusMessageId?: string;
  sessions: readonly ProjectSession[]; projects: readonly ProjectSummary[]; onSessionUpdated: (conversation: ConversationSummary) => void;
  onOpenConversation: (conversation: ConversationSummary, messageId?: string) => void;
  onOpenFile?: (conversationId: string, path: string) => void;
}): ReactElement {
  const lead = sessions.find(session => session.id === instance.rootConversationId);
  const sourceAgentId = sessions.find(session => session.id === instance.sourceConversationId)?.agentId;
  return <section aria-label={`${instance.name}群聊对话`} className="conversation-workspace">
    <header className="conversation-workspace__header">
      <div className="conversation-workspace__path"><UsersRound size={14} /><strong className="min-w-0 truncate">{instance.name}</strong><span>群聊</span></div>
      <div className="flex shrink-0 items-center gap-[5px]">
        <button type="button" aria-label="查询群聊历史消息" title="聊天记录" className="rounded-[var(--app-radius)] p-1 hover:bg-[var(--app-hover)]" onClick={() => useWorkbenchUiStore.getState().openTeamChatDetails({ instanceId: instance.id, section: "history" })}><Search size={14} /></button>
        <button type="button" aria-label="群资料与设置" title="群资料与设置" className="rounded-[var(--app-radius)] p-1 hover:bg-[var(--app-hover)]" onClick={() => useWorkbenchUiStore.getState().openTeamChatDetails({ instanceId: instance.id, section: "info" })}><Settings2 size={14} /></button>
        <TeamChatCoordinationResults agentClient={agentClient} teamInstanceId={instance.id} active={active} />
        <TaskListLauncher agentClient={agentClient} scope={{ teamInstanceId: instance.id }} workspaceId={teamChatTabId(instance.id)} active={active} />
      </div>
    </header>
    <div className="conversation-workspace__surface">
      {lead === undefined ? <LoadingState label="正在加载团队对话" /> : <ConversationWorkspace agentClient={agentClient} session={lead} active={active}
        project={projects.find(project => project.id === lead.projectId) ?? null} projects={projects} relatedSessions={sessions} onSessionUpdated={onSessionUpdated}
        onOpenTeamConversation={(conversation, _sourceConversationId, messageId) => { void agentClient.listConversationHierarchy().then(hierarchy => { const original = hierarchy.find(item => item.id === conversation.id); if (original) onOpenConversation(original, messageId); }); }}
        groupChat={{ instanceId: instance.id, ...(onOpenFile === undefined ? {} : { onOpenFile }), ...(sourceAgentId == null ? {} : { initialAgentId: sourceAgentId }), ...(focusMessageId === undefined ? {} : { focusMessageId }) }} />}
    </div>
  </section>;
}
