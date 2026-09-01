import { MessageSquareText, UserRound } from "lucide-react";
import type { ReactElement } from "react";
import type {
  ConversationSummary,
  TeamWorkItemExecutionAgent,
  TeamWorkItemExecutionView,
} from "@agent/protocol";

import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";
import { AgentAvatar } from "./agent-avatar.js";

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
  const activeWorkers = members.filter(isMemberActive).length;
  const waitingAcceptanceCount = item?.status === "awaiting_acceptance" ? 1 : 0;
  return (
    <aside
      aria-label="团队执行信息"
      className="team-operations grid min-h-0 grid-rows-[145px_minmax(220px,280px)_minmax(320px,1fr)] gap-[5px] overflow-hidden"
      data-team-runtime-layout="operations"
    >
      <section className="team-command-panel grid min-h-0 grid-rows-[40px_minmax(0,1fr)]" data-team-operations-card="summary">
        <PanelHeading id="team-operations-heading" label="执行概况" meta={`${activeWorkers} 运行中`} />
        <div aria-label="执行汇总" className="grid grid-cols-3 gap-[5px] p-[10px]">
          <SummaryMetric label="本次参与" value={members.length} />
          <SummaryMetric label="运行中" value={activeWorkers} />
          <SummaryMetric label="等待验收" value={waitingAcceptanceCount} />
        </div>
      </section>

      <section className="team-command-panel grid min-h-0 grid-rows-[35px_minmax(0,1fr)]" data-team-operations-card="members">
        <SectionHeading label="成员列表" meta={`${members.length} 位成员`} />
        <div className="grid min-h-0 auto-rows-max content-start overflow-auto border-t border-[var(--app-border)]">
          {members.length === 0 ? (
            <p className="m-0 px-[10px] py-[12px] text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">
              尚无实际成员会话
            </p>
          ) : members.map((member) => (
            <button
              aria-label={`打开 ${memberName(member)} 的对话`}
              key={member.conversation.id}
              className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-[5px] border-0 border-t border-[var(--app-border)] bg-transparent px-[10px] py-[8px] text-left first:border-t-0 hover:bg-[var(--app-hover)] focus-visible:outline-2 focus-visible:outline-[var(--app-focus-ring)] focus-visible:outline-offset-[-2px]"
              type="button"
              onClick={() => onOpenConversation(member.conversation)}
            >
              <AgentAvatar
                avatar={{ icon: member.conversation.avatarIcon ?? "bot", kind: "icon" }}
                size="compact"
              />
              <span className="grid min-w-0 gap-[2px]">
                <strong className="overflow-hidden text-[length:var(--app-font-size-body)] text-[var(--app-foreground)] text-ellipsis whitespace-nowrap">
                  {memberName(member)}
                </strong>
                <small className="overflow-hidden text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)] text-ellipsis whitespace-nowrap">
                  {memberAssignment(member)}
                </small>
              </span>
              <span
                data-member-work-state={isMemberActive(member) ? "working" : "idle"}
                className={isMemberActive(member)
                ? "inline-flex items-center gap-[4px] text-[length:var(--app-font-size-caption)] font-semibold text-[var(--app-accent)]"
                : "inline-flex items-center gap-[4px] text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]"}
              >
                <i
                  aria-hidden="true"
                  className={isMemberActive(member)
                    ? "h-[6px] w-[6px] rounded-[var(--app-radius-pill)] bg-[var(--app-accent)]"
                    : "h-[6px] w-[6px] rounded-[var(--app-radius-pill)] bg-[var(--app-border)]"}
                />
                {memberStatus(member)}
              </span>
            </button>
          ))}
        </div>
      </section>

      <section className="team-command-panel grid min-h-0 grid-rows-[35px_minmax(0,1fr)]" data-team-operations-card="activity">
        <SectionHeading icon={<MessageSquareText aria-hidden="true" size={14} />} label="协作动态" meta="当前任务" />
        <div className="grid min-h-0 auto-rows-max content-start overflow-auto border-t border-[var(--app-border)]">
          {item === null || item.events.length === 0 ? (
            <p className="m-0 px-[10px] py-[12px] text-[length:var(--app-font-size-auxiliary)] text-[var(--app-muted-foreground)]">暂无协作动态</p>
          ) : item.events.slice().reverse().map((event) => {
            const actorMember = findMemberForActor(members, event.actor);
            return (
              <article
                key={event.id}
                className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-[8px] border-t border-[var(--app-border)] px-[10px] py-[8px] first:border-t-0"
              >
                <ActivityActorAvatar actor={event.actor} member={actorMember} />
                <p className="m-0 min-w-0 text-[length:var(--app-font-size-auxiliary)] leading-[1.45] text-[var(--app-muted-foreground)]">
                  <strong className="mr-[3px] text-[var(--app-foreground)]">{event.actor}</strong>
                  {event.detail}
                </p>
                <time className="text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{event.time}</time>
              </article>
            );
          })}
        </div>
      </section>
    </aside>
  );
}

function memberName(member: TeamWorkItemExecutionAgent): string {
  return member.agent?.name ?? member.conversation.title;
}

function findMemberForActor(
  members: readonly TeamWorkItemExecutionAgent[],
  actor: string,
): TeamWorkItemExecutionAgent | null {
  const normalizedActor = actor.trim().toLocaleLowerCase();
  return members.find((member) => {
    const name = memberName(member).trim().toLocaleLowerCase();
    const title = member.conversation.title.trim().toLocaleLowerCase();
    return name === normalizedActor || title.startsWith(normalizedActor);
  }) ?? null;
}

function ActivityActorAvatar({
  actor,
  member,
}: {
  actor: string;
  member: TeamWorkItemExecutionAgent | null;
}): ReactElement {
  if (member !== null) {
    return (
      <span data-activity-member-avatar={member.conversation.id}>
        <AgentAvatar
          avatar={{ icon: member.conversation.avatarIcon ?? "bot", kind: "icon" }}
          size="compact"
        />
      </span>
    );
  }
  return (
    <span className="grid h-[28px] w-[28px] place-items-center rounded-[var(--app-radius)] bg-[var(--app-panel-subtle)] text-[var(--app-muted-foreground)]">
      {actor === "用户" ? <UserRound aria-hidden="true" size={14} /> : <MessageSquareText aria-hidden="true" size={14} />}
    </span>
  );
}

function SummaryMetric({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <div className="grid min-w-0 place-items-center gap-[2px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] px-[4px] py-[8px]">
      <strong className="text-[length:var(--app-font-size-title)] text-[var(--app-foreground)]">{value}</strong>
      <span className="text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{label}</span>
    </div>
  );
}

function memberAssignment(member: TeamWorkItemExecutionAgent): string {
  if (member.delegation !== null) return member.delegation.title;
  return member.depth === 0 ? "Team Lead 执行会话" : "等待 Team Lead 分派任务";
}

function isMemberActive(member: TeamWorkItemExecutionAgent): boolean {
  return member.conversation.activeRunId !== null
    || member.delegation?.status === "running";
}

function memberStatus(member: TeamWorkItemExecutionAgent): string {
  return isMemberActive(member) ? "工作中" : "空闲";
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
  icon?: ReactElement;
  label: string;
  meta: string;
}): ReactElement {
  return (
    <div className="flex h-[35px] items-center justify-between gap-[5px] px-[10px]">
      <div className="flex min-w-0 items-center gap-[5px]">
        {icon}
        <h3 className="m-0 overflow-hidden text-[length:var(--app-font-size-body)] text-[var(--app-foreground)] text-ellipsis whitespace-nowrap">{label}</h3>
      </div>
      <span className="shrink-0 text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">{meta}</span>
    </div>
  );
}
