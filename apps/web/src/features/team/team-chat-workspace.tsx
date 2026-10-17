import { useState, type ReactElement } from "react";
import { ListTree, UsersRound, Workflow } from "lucide-react";
import type { ConversationSummary, ProjectSummary, TeamInstanceView } from "@agent/protocol";
import type { AgentClient } from "../../runtime/agent-client.js";
import { ConversationWorkspace } from "../chat/workspace-content.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { LoadingState } from "../../components/ui/loading.js";
import { TaskContextDirectory } from "./task-context-directory.js";
import { IconButton } from "../../components/ui/icon-button.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";

export function TeamChatWorkspace({ agentClient, instance, active, focusMessageId, onOpenConversation, sessions, projects, onSessionUpdated }: {
  agentClient: AgentClient; instance: TeamInstanceView; active: boolean; focusMessageId?: string;
  sessions: readonly ProjectSession[]; projects: readonly ProjectSummary[]; onSessionUpdated: (conversation: ConversationSummary) => void;
  onOpenConversation: (conversation: ConversationSummary, messageId?: string) => void;
}): ReactElement {
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [previousFocus, setPreviousFocus] = useState(focusMessageId);
  if (previousFocus !== focusMessageId) { setPreviousFocus(focusMessageId); setDirectoryOpen(false); }
  const lead = sessions.find(session => session.id === instance.rootConversationId);
  const sourceAgentId = sessions.find(session => session.id === instance.sourceConversationId)?.agentId;
  return <section aria-label={`${instance.name}群聊对话`} className="conversation-workspace">
    <header className="conversation-workspace__header">
      <div className="conversation-workspace__path"><UsersRound size={14} /><strong className="min-w-0 truncate">{instance.name}</strong><span>群聊</span></div>
      <IconButton label="查看后台协调" size="compact" variant="quiet" onClick={() => useWorkbenchUiStore.getState().openTeamChatCoordination({ instanceId: instance.id })}><Workflow size={14} /></IconButton>
      <button type="button" className="inline-flex shrink-0 items-center gap-[5px] rounded-[var(--app-radius)] px-2 py-1 text-[length:var(--app-font-size-control)] hover:bg-[var(--app-hover)]" aria-expanded={directoryOpen} onClick={() => setDirectoryOpen(value => !value)}><ListTree size={14} />{directoryOpen ? "返回群聊" : "任务上下文"}</button>
    </header>
    <div className={directoryOpen ? "hidden" : "conversation-workspace__surface"}>
      {lead === undefined ? <LoadingState label="正在加载团队对话" /> : <ConversationWorkspace agentClient={agentClient} session={lead} active={active && !directoryOpen}
        project={projects.find(project => project.id === lead.projectId) ?? null} projects={projects} relatedSessions={sessions} onSessionUpdated={onSessionUpdated}
        onOpenTeamConversation={(conversation, _sourceConversationId, messageId) => { void agentClient.listConversationHierarchy().then(hierarchy => { const original = hierarchy.find(item => item.id === conversation.id); if (original) onOpenConversation(original, messageId); }); }}
        groupChat={{ instanceId: instance.id, ...(sourceAgentId == null ? {} : { initialAgentId: sourceAgentId }), ...(focusMessageId === undefined ? {} : { focusMessageId }) }} />}
    </div>
    {directoryOpen ? <div className="flex min-h-0 flex-1 p-3"><TaskContextDirectory agentClient={agentClient} teamInstanceId={instance.id} onOpenConversation={onOpenConversation} /></div> : null}
  </section>;
}
