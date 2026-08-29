import {
  Bot,
  MessageSquareText,
  Scale,
  UsersRound,
} from "lucide-react";
import type { ReactElement } from "react";
import type {
  ConversationSummary,
  TeamWorkItemExecutionAgent,
  TeamWorkItemExecutionView,
} from "@agent/protocol";

import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";

export function TeamOperations({
  execution,
  item,
  onOpenConversation,
}: {
  execution: TeamWorkItemExecutionView | null;
  item: TeamWorkItemPrototype | null;
  onOpenConversation: (conversation: ConversationSummary) => void;
}): ReactElement {
  const members = execution?.agents ?? [];
  const lead = members.find((member) => member.depth === 0) ?? null;
  const activeWorkers = members.filter(isMemberActive).length;
  const maxDepth = members.reduce((maximum, member) => Math.max(maximum, member.depth), 0);
  return (
    <aside className="team-command-panel team-operations" aria-labelledby="team-operations-heading">
      <PanelHeading id="team-operations-heading" label="实际执行成员" meta={`${activeWorkers}/${members.length} 执行中`} />
      <section className="team-supervisor">
        <div className="team-supervisor__identity">
          <span><Scale aria-hidden="true" size={16} /></span>
          <div>
            <strong>{lead === null ? "等待 Team Lead" : memberName(lead)}</strong>
            <small>{lead?.agent?.role.trim() || "全局管理 Agent"}</small>
          </div>
          <em>{lead === null ? "待命" : memberStatus(lead)}</em>
        </div>
        <p>{lead === null
          ? "等待 Team Lead 领取当前工作项后生成真实执行会话。"
          : "成员状态和任务分派来自当前工作项的持久化对话记录。"}</p>
        <div className="team-supervisor__capacity">
          <span><UsersRound aria-hidden="true" size={13} />实际成员 {members.length}</span>
          <span>活跃 {activeWorkers}</span>
          <span>协作层级 {maxDepth}</span>
        </div>
      </section>

      <section className="team-roster-section">
        <SectionHeading icon={<Bot aria-hidden="true" size={14} />} label="当前成员" meta="持久对话" />
        <div className="team-roster-list">
          {members.length === 0 ? <p className="team-operations__empty">尚无实际成员会话</p> : null}
          {members.map((member) => (
            <button
              aria-label={`打开 ${memberName(member)} 的对话`}
              key={member.conversation.id}
              className="team-worker-row w-full appearance-none border-0 bg-transparent text-left hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-[-2px]"
              data-status={isMemberActive(member) ? "active" : "waiting"}
              type="button"
              onClick={() => onOpenConversation(member.conversation)}
            >
              <span className="team-worker-row__avatar"><Bot aria-hidden="true" size={14} /></span>
              <div>
                <strong>{memberName(member)}{member.depth > 0 ? <em>成员</em> : null}</strong>
                <small>{memberAssignment(member)} · {memberStatus(member)}</small>
              </div>
              <span className="team-worker-row__state" />
            </button>
          ))}
        </div>
      </section>

      <section className="team-event-section">
        <SectionHeading icon={<MessageSquareText aria-hidden="true" size={14} />} label="协作动态" meta="当前任务" />
        <div className="team-event-list">
          {item?.events.slice().reverse().map((event) => (
            <article key={event.id} className="team-event-row" data-type={event.type}>
              <span aria-hidden="true" />
              <div><p><strong>{event.actor}</strong>{event.detail}</p><time>{event.time}</time></div>
            </article>
          )) ?? null}
        </div>
      </section>
    </aside>
  );
}

function memberName(member: TeamWorkItemExecutionAgent): string {
  return member.agent?.name ?? member.conversation.title;
}

function memberAssignment(member: TeamWorkItemExecutionAgent): string {
  if (member.delegation !== null) return member.delegation.title;
  return member.depth === 0 ? "Team Lead 执行会话" : "等待 Team Lead 分派任务";
}

function isMemberActive(member: TeamWorkItemExecutionAgent): boolean {
  return member.conversation.activeRunId !== null
    || member.delegation?.status === "queued"
    || member.delegation?.status === "running";
}

function memberStatus(member: TeamWorkItemExecutionAgent): string {
  if (member.conversation.activeRunId !== null || member.delegation?.status === "running") {
    return "执行中";
  }
  if (member.delegation?.status === "queued") return "等待调度";
  if (member.delegation?.status === "completed") return "已完成";
  if (member.delegation?.status === "failed") return "执行失败";
  if (member.delegation?.status === "cancelled") return "已取消";
  if (member.conversation.lastRunStatus === "completed") return "已完成";
  if (member.conversation.lastRunStatus === "failed") return "执行失败";
  if (member.conversation.lastRunStatus === "cancelled") return "已取消";
  return "待命";
}

function PanelHeading({ id, label, meta }: { id: string; label: string; meta: string }): ReactElement {
  return (
    <header className="team-command-panel__heading">
      <h2 id={id}>{label}</h2>
      <span>{meta}</span>
    </header>
  );
}

function SectionHeading({
  icon,
  label,
  meta,
}: {
  icon: ReactElement;
  label: string;
  meta: string;
}): ReactElement {
  return (
    <div className="team-section-heading team-section-heading--padded">
      <div>{icon}<h3>{label}</h3></div>
      <span>{meta}</span>
    </div>
  );
}
