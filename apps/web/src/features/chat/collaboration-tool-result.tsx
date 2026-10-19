import type { ConversationToolItem } from "@agent/protocol";
import type { ReactElement } from "react";
import { SubagentAvatar } from "../team/agent-avatar.js";
import {
  parseAgentConversationListResult,
  parseAgentConversationReadResult,
  parseAgentMessageToolResult,
  parseSubagentToolResult,
  subagentTaskStatusLabel,
} from "./collaboration-tool-result-model.js";
import { ToolConversationIdentity, toolConversationTargets } from "./tool-conversation-identity.js";
import { StructuredToolResult, ToolResultNotice } from "./tool-result-content.js";

export function AgentConversationListResult({
  payload,
  status,
}: {
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseAgentConversationListResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;

  return (
    <StructuredToolResult summary={`Agent 对话 · ${result.length} 项`}>
      {result.length === 0 ? (
        <p className="tool-directory-listing__empty">没有可协作的其他对话</p>
      ) : (
        <ul className="tool-search-results">
          {result.map((conversation) => (
            <li key={conversation.conversationId}>
              <ToolConversationIdentity target={{ id: conversation.conversationId, title: conversation.title }} />
            </li>
          ))}
        </ul>
      )}
    </StructuredToolResult>
  );
}

export function AgentConversationReadResult({
  item,
  payload,
  status,
}: {
  item: ConversationToolItem;
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseAgentConversationReadResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;
  const target = toolConversationTargets(item)[0] ?? null;

  return (
    <StructuredToolResult summary={`对话上下文 · 约 ${result.estimatedTokens} tokens`}>
      {target === null ? null : <ToolConversationIdentity target={target} />}
      <pre>{result.content}</pre>
    </StructuredToolResult>
  );
}

export function AgentMessageToolResult({
  item,
  mode,
  payload,
  status,
}: {
  item: ConversationToolItem;
  mode: "received" | "sent";
  payload: string | null;
  status: ConversationToolItem["status"];
}): ReactElement {
  const result = payload === null ? null : parseAgentMessageToolResult(payload);
  const targets = toolConversationTargets(item);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;
  if (result.messages.length === 0) {
    return (
      <StructuredToolResult summary="消息等待结束">
        {targets.map(target => <ToolConversationIdentity key={target.id} target={target} />)}
        <p className="tool-directory-listing__empty">等待期间没有收到新消息</p>
      </StructuredToolResult>
    );
  }

  return (
    <StructuredToolResult summary={mode === "sent" ? "消息已发送" : "收到消息"}>
      <dl className="tool-read-facts">
        <div>
          <dt>{mode === "sent" ? "目标对话" : "发送方"}</dt>
          <dd className="flex min-w-0 flex-wrap gap-[5px]">{targets.length === 0 ? "对话不可用" : targets.map(target => <ToolConversationIdentity key={target.id} target={target} />)}</dd>
        </div>
        <div>
          <dt>消息内容</dt>
          <dd>{result.messages[0]?.content}</dd>
        </div>
      </dl>
    </StructuredToolResult>
  );
}

export function SubagentToolResult({
  onOpenSubagent,
  payload,
  status,
  teamManaged,
}: {
  onOpenSubagent: ((conversationId: string) => void) | undefined;
  payload: string | null;
  status: ConversationToolItem["status"];
  teamManaged: boolean;
}): ReactElement {
  const result = payload === null ? null : parseSubagentToolResult(payload);
  if (result === null) return <ToolResultNotice result={payload} status={status} />;
  const summary = result.waitStatus === "timeout"
    ? `${teamManaged ? "团队成员等待超时" : "Subagent 等待超时"} · ${result.tasks.length} 项`
    : `${teamManaged ? "团队成员执行" : "Subagent"} · ${result.tasks.length} 项`;

  return (
    <StructuredToolResult summary={summary}>
      <ul className="tool-search-results">
        {result.tasks.map((task) => (
          <li key={task.id}>
            <button
              aria-label={`在侧边打开 Subagent 对话：${task.name}`}
              className="flex w-full min-w-0 cursor-pointer flex-col items-start gap-[2px] border-0 bg-transparent p-0 text-left text-inherit hover:text-[var(--app-accent)] focus-visible:rounded-[var(--app-radius-small)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-2 disabled:cursor-default disabled:text-inherit"
              disabled={onOpenSubagent === undefined}
              title={`在侧边打开 ${task.name}`}
              type="button"
              onClick={() => onOpenSubagent?.(task.childConversationId)}
            >
              <span className="tool-subagent-result__identity">
                <SubagentAvatar
                  icon={task.avatarIcon}
                  seed={task.childConversationId}
                  size="compact"
                />
                <span className="tool-search-results__path">{task.name}</span>
              </span>
              <span className="tool-search-results__excerpt">
                {subagentTaskStatusLabel(task.status)}
              </span>
            </button>
            {task.result !== null || task.error !== null ? (
              <span className="tool-search-results__excerpt">
                {task.result ?? task.error}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </StructuredToolResult>
  );
}
