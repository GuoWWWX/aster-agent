import {
  Bot,
  MessageSquareText,
  Scale,
  Sparkles,
  UsersRound,
} from "lucide-react";
import type { ReactElement } from "react";

import type {
  TeamWorkItemPrototype,
  TeamWorkerPrototype,
} from "./team-runtime-prototype.js";

export function TeamOperations({
  item,
  temporaryCount,
  workers,
}: {
  item: TeamWorkItemPrototype | null;
  temporaryCount: number;
  workers: readonly TeamWorkerPrototype[];
}): ReactElement {
  const activeWorkers = workers.filter(
    (worker) => worker.status === "active" || worker.status === "reviewing",
  ).length;
  return (
    <aside className="team-command-panel team-operations" aria-labelledby="team-operations-heading">
      <PanelHeading id="team-operations-heading" label="团队调度" meta={`${activeWorkers}/${workers.length} 工作中`} />
      <section className="team-supervisor">
        <div className="team-supervisor__identity">
          <span><Scale aria-hidden="true" size={16} /></span>
          <div><strong>Team Lead</strong><small>全局管理 Agent</small></div>
          <em>在线</em>
        </div>
        <p>负责接单、制定方案、分配开发、触发测试评审，并在通过后生成统一交付。</p>
        <div className="team-supervisor__capacity">
          <span><UsersRound aria-hidden="true" size={13} />常驻 4</span>
          <span><Sparkles aria-hidden="true" size={13} />临时 {temporaryCount}</span>
          <span>上限 6</span>
        </div>
      </section>

      <section className="team-roster-section">
        <SectionHeading icon={<Bot aria-hidden="true" size={14} />} label="当前成员" meta="自动扩缩容" />
        <div className="team-roster-list">
          {workers.map((worker) => (
            <article key={worker.id} className="team-worker-row" data-status={worker.status}>
              <span className="team-worker-row__avatar"><Bot aria-hidden="true" size={14} /></span>
              <div>
                <strong>{worker.name}{worker.kind === "temporary" ? <em>临时</em> : null}</strong>
                <small>{worker.role} · {worker.assignment}</small>
              </div>
              <span className="team-worker-row__state" />
            </article>
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
