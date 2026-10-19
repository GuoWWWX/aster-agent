import { FileText, Globe2, ListTodo, MessageSquarePlus, SquareCheckBig, Terminal, UsersRound, X } from "lucide-react";
import { useEffect, useRef, type ReactElement, type MouseEvent } from "react";
import type { TeamInstanceView } from "@agent/protocol";
import { FileTypeIcon } from "../../components/ui/file-type-icon.js";
import { TooltipAnchor } from "../../components/ui/tooltip.js";
import { useTabReorder } from "../../components/ui/use-tab-reorder.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { conversationIdentity } from "../chat/conversation-identity.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { AgentAvatar, SubagentAvatar } from "../team/agent-avatar.js";
import { scrollWorkspaceTabsOnWheel } from "./sidebar-tab-model.js";
import type { SidebarTab } from "./sidebar-workspace-types.js";

export function SidebarWorkspaceTabs({
  activeTabId,
  tabs,
  sessions,
  teamInstances,
  onActivate,
  onClose,
  onContextMenu,
  onMove,
}: {
  activeTabId: string | null;
  tabs: readonly SidebarTab[];
  sessions: readonly ProjectSession[];
  teamInstances: readonly TeamInstanceView[];
  onActivate: (tab: SidebarTab) => void;
  onClose: (tab: SidebarTab) => void;
  onContextMenu: (tab: SidebarTab, event: MouseEvent<HTMLButtonElement>) => void;
  onMove: (source: string, target: string, side: "before" | "after") => void;
}): ReactElement {
  const agentProfiles = useAgentDirectoryStore(state => state.agents);
  const reorderTabProps = useTabReorder(onMove);
  const workspaceTabsRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const workspaceTabs = workspaceTabsRef.current;
    if (workspaceTabs === null) return;

    const handleWheel = (event: WheelEvent) => {
      scrollWorkspaceTabsOnWheel(workspaceTabs, event);
    };
    workspaceTabs.addEventListener("wheel", handleWheel, { passive: false });
    return () => workspaceTabs.removeEventListener("wheel", handleWheel);
  }, []);

  return (
    <div
      aria-label="已打开文件和侧边聊天"
      className="right-sidebar-workspace__tabs"
      {...reorderTabProps.listProps}
      ref={workspaceTabsRef}
      role="tablist"
    >
      {tabs.map((tab) => {
        const tabAgentId = tab.kind === "chat" ? tab.session.agentId : null;
        const tabAgent = tabAgentId !== null
          ? agentProfiles.find((agent) => agent.id === tabAgentId)
          : undefined;
        return (
          <div
            className="right-sidebar-workspace__tab-shell reorderable-tab"
            {...reorderTabProps.tabProps(tab.id)}
            data-active={String(activeTabId === tab.id)}
            key={tab.id}
          >
            <TooltipAnchor content={tab.kind === "file" || tab.kind === "configuration-file" ? tab.path : tab.name}>
            <button
              aria-label={tab.name}
              aria-selected={activeTabId === tab.id}
              className="right-sidebar-workspace__tab"
              role="tab"
              type="button"
              onClick={(event) => {
                if (event.button !== 0) return;
                onActivate(tab);
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                onContextMenu(tab, event);
              }}
            >
              {tab.kind === "chat" ? (
                tab.session.threadKind === "subagent" ? (
                  <SubagentAvatar
                    icon={tab.session.avatarIcon}
                    seed={tab.session.id}
                    size="compact"
                  />
                ) : tabAgent === undefined ? (
                  <MessageSquarePlus aria-hidden="true" size={14} />
                ) : (
                  <AgentAvatar avatar={tabAgent.avatar} size="compact" />
                )
              ) : tab.kind === "task-list" ? (
                <ListTodo aria-hidden="true" size={14} />
              ) : (tab.kind === "git-review" || tab.kind === "conversation-review") ? (
                <SquareCheckBig aria-hidden="true" size={14} />
              ) : tab.kind === "terminal" || tab.kind === "background-command" ? (
                <Terminal aria-hidden="true" size={14} />
              ) : tab.kind === "managed-browser" ? (
                <Globe2 aria-hidden="true" size={14} />
              ) : tab.kind === "group-details" ? (
                <UsersRound aria-hidden="true" size={14} />
              ) : tab.kind === "agent-prompt" ? (
                <FileText aria-hidden="true" size={14} />
              ) : (
                <FileTypeIcon
                  javaDeclarationKind={tab.kind === "file" ? tab.javaDeclarationKind : undefined}
                  path={tab.path}
                  size={14}
                />
              )}
              <span>{tab.kind === "chat" ? conversationIdentity(tab.session, agentProfiles, teamInstances, sessions).title : tab.name}</span>
              {tab.kind === "managed-browser" && tab.background === true ? <small className="shrink-0 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">后台</small> : null}
            </button>
            </TooltipAnchor>
            <TooltipAnchor content={`关闭 ${tab.name}`}>
            <button
              aria-label={`关闭 ${tab.name}`}
              className="right-sidebar-workspace__tab-close"
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onClose(tab);
              }}
            >
              <X aria-hidden="true" size={12} />
            </button>
            </TooltipAnchor>
          </div>
        );
      })}
    </div>
  );
}
