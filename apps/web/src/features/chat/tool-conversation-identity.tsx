import { createContext, useContext, type ReactElement } from "react";
import type { ConversationToolItem } from "@agent/protocol";

import type { AgentProfile } from "../../stores/agent-directory-store.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { AgentAvatar, SubagentAvatar } from "../team/agent-avatar.js";

type ConversationTarget = { id: string; title?: string };

export const ToolConversationContext = createContext<{
  sessions: ReadonlyMap<string, ProjectSession>;
  avatars: ReadonlyMap<string, AgentProfile["avatar"]>;
  open: ((session: ProjectSession) => void) | undefined;
}>({ sessions: new Map(), avatars: new Map(), open: undefined });

/** Sending targets the recipient; receiving targets the sender, never the inbox owner. */
export function toolConversationTarget(
  item: Pick<ConversationToolItem, "name" | "arguments" | "result" | "conversationId">,
): ConversationTarget | null {
  if (!["send_agent_message", "wait_for_agent_message", "read_agent_conversation"].includes(item.name)) {
    return null;
  }
  const args = parseRecord(item.arguments);
  const result = record(parseRecord(item.result)?.value);
  const message = record(result?.message);
  const requestedId = typeof args?.conversationId === "string" ? args.conversationId : null;
  if (item.name === "wait_for_agent_message") {
    const id = typeof message?.senderConversationId === "string" ? message.senderConversationId : requestedId;
    return id === null ? null : {
      id,
      ...(typeof message?.senderTitle === "string" ? { title: message.senderTitle } : {}),
    };
  }
  if (item.name === "send_agent_message") {
    const id = typeof message?.conversationId === "string" ? message.conversationId : requestedId;
    return id === null ? null : { id };
  }
  return { id: requestedId ?? item.conversationId };
}

export function conversationTypeLabel(session: Pick<ProjectSession, "threadKind" | "teamId" | "parentConversationId" | "projectId">): string {
  if (session.threadKind === "subagent") return "Subagent";
  if (session.threadKind === "team_lead") return "团队负责人";
  if (session.teamId !== null) return "团队成员";
  if (session.parentConversationId !== null) return "侧边对话";
  return session.projectId === null ? "临时对话" : "对话";
}

export function ToolConversationIdentity({
  target,
  action,
}: {
  target: ConversationTarget;
  action?: string;
}): ReactElement {
  const context = useContext(ToolConversationContext);
  const session = context.sessions.get(target.id);
  const title = session?.title ?? target.title ?? "对话不可用";
  const kind = session === undefined ? "对话" : conversationTypeLabel(session);
  const content = <>
    {/* The legacy timeline span rule must not shrink identity metadata or avatars. */}
    <span className="inline-flex shrink-0!">
    {session?.threadKind === "subagent" ? (
      <SubagentAvatar icon={session.avatarIcon} seed={session.id} size="compact" />
    ) : (
      <AgentAvatar avatar={context.avatars.get(target.id) ?? { kind: "icon", icon: "bot" }} size="compact" />
    )}
    </span>
    <span className="shrink-0! text-[var(--app-muted-foreground)]">{kind}</span>
    <span className="min-w-0 truncate text-[var(--app-foreground)]">{title}</span>
    {action === undefined ? null : <span className="shrink-0! text-[var(--app-muted-foreground)]">{action}</span>}
  </>;
  const className = "inline-flex min-w-0 max-w-full items-center gap-[6px] align-middle [font:inherit]";
  if (session === undefined || context.open === undefined) {
    return <span className={className} title={title}>{content}</span>;
  }
  return (
    <button
      aria-label={`在侧边打开 ${kind}：${title}`}
      className={`${className} cursor-pointer overflow-hidden border-0 bg-transparent p-0 text-left hover:opacity-80 focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-2`}
      onClick={() => context.open?.(session)}
      title={`${kind}：${title}`}
      type="button"
    >{content}</button>
  );
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

function parseRecord(value: string | null): Record<string, unknown> | null {
  if (value === null) return null;
  try {
    return record(JSON.parse(value));
  } catch {
    return null;
  }
}
