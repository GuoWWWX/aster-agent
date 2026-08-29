import { CheckCircle2, Circle, CircleDotDashed, ListChecks, ShieldCheck } from "lucide-react";
import type { ReactElement } from "react";

import type { TeamWorkItemPrototype } from "./team-runtime-prototype.js";

export function TeamLiveExecutionPanel({ item }: { item: TeamWorkItemPrototype }): ReactElement {
  return (
    <main className="team-command-panel team-lifecycle-panel" aria-labelledby="team-live-work-item-heading">
      <header className="team-lifecycle-panel__header">
        <span>真实执行状态 · {statusLabel(item.status)}</span>
        <h2 id="team-live-work-item-heading">{item.title}</h2>
      </header>
      <div className="team-lifecycle-panel__body">
        <section className="team-lifecycle-hero" data-tone={item.status === "blocked" ? "queued" : "acceptance"}>
          <CircleDotDashed aria-hidden="true" size={22} />
          <div><strong>{item.nextAction}</strong><p>{item.plan}</p></div>
        </section>
        <section className="team-lifecycle-section">
          <h3 className="team-lifecycle-section__heading"><ListChecks aria-hidden="true" size={15} />实时任务清单</h3>
          {item.tasks.length === 0 ? (
            <p>Agent 正在分析项目；创建任务清单后会在这里同步显示。</p>
          ) : (
            <ul>{item.tasks.map((task) => (
              <li key={task.id}>
                {task.status === "completed"
                  ? <CheckCircle2 aria-hidden="true" size={13} />
                  : <Circle aria-hidden="true" size={13} />}
                <span><strong>{task.title}</strong>{task.result}</span>
              </li>
            ))}</ul>
          )}
        </section>
        <section className="team-lifecycle-section">
          <h3 className="team-lifecycle-section__heading"><ShieldCheck aria-hidden="true" size={15} />验收条件</h3>
          <ul>{item.acceptance.map((criterion) => <li key={criterion}><Circle aria-hidden="true" size={13} />{criterion}</li>)}</ul>
        </section>
      </div>
    </main>
  );
}

function statusLabel(status: TeamWorkItemPrototype["status"]): string {
  if (status === "planning") return "方案整理中";
  if (status === "reviewing") return "测试与评审中";
  if (status === "blocked") return "需要处理";
  if (status === "reworking") return "返工中";
  return "执行中";
}
