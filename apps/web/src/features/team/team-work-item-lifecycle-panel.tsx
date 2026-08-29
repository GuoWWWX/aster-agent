import {
  Check,
  CheckCircle2,
  CircleDotDashed,
  GitCommitHorizontal,
  GitMerge,
  ListChecks,
  RotateCcw,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState, type ReactElement } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import type {
  TeamFinalizationAction,
  TeamWorkItemPrototype,
} from "./team-runtime-prototype.js";

const FINALIZATION_LABEL: Record<TeamFinalizationAction, string> = {
  commit: "提交当前分支",
  complete: "仅确认完成",
  merge: "创建并合并 PR",
};

export function WorkItemLifecyclePanel({
  item,
  onApprove,
  onClaim,
  onFinishFinalization,
  onRequestRework,
}: {
  item: TeamWorkItemPrototype;
  onApprove: (action: TeamFinalizationAction, acceptedCriteria: readonly string[]) => void;
  onClaim: () => void;
  onFinishFinalization: () => void;
  onRequestRework: (request: string) => void;
}): ReactElement {
  if (item.status === "queued") return <QueuedPanel item={item} onClaim={onClaim} />;
  if (item.status === "awaiting_acceptance") {
    return <AcceptancePanel item={item} onApprove={onApprove} onRequestRework={onRequestRework} />;
  }
  if (item.status === "finalizing") {
    return <FinalizingPanel item={item} onFinishFinalization={onFinishFinalization} />;
  }
  return <CompletedPanel item={item} />;
}

function QueuedPanel({ item, onClaim }: { item: TeamWorkItemPrototype; onClaim: () => void }): ReactElement {
  return (
    <main className="team-command-panel team-lifecycle-panel" aria-labelledby="team-lifecycle-heading">
      <LifecycleHeader eyebrow="需求已收集 · 尚未执行" title={item.title} />
      <div className="team-lifecycle-panel__body">
        <section className="team-lifecycle-hero" data-tone="queued">
          <CircleDotDashed aria-hidden="true" size={22} />
          <div><strong>等待 Team Lead 领取</strong><p>当前需求仍可在左侧输入框中修改；领取后将锁定需求版本并开始方案设计。</p></div>
        </section>
        <section className="team-lifecycle-section">
          <SectionHeading icon={<ListChecks aria-hidden="true" size={15} />} label="预期验收条件" />
          <ul>{item.acceptance.map((criterion) => <li key={criterion}><Check aria-hidden="true" size={13} />{criterion}</li>)}</ul>
        </section>
        <div className="team-lifecycle-actions">
          <span>原型中由你手动模拟 Team Lead 领取。</span>
          <button type="button" onClick={onClaim}><Sparkles aria-hidden="true" size={14} />模拟领取并开始</button>
        </div>
      </div>
    </main>
  );
}

function AcceptancePanel({
  item,
  onApprove,
  onRequestRework,
}: {
  item: TeamWorkItemPrototype;
  onApprove: (action: TeamFinalizationAction, acceptedCriteria: readonly string[]) => void;
  onRequestRework: (request: string) => void;
}): ReactElement {
  const [accepted, setAccepted] = useState<string[]>([]);
  const [reworkRequest, setReworkRequest] = useState("");
  const [finalizationAction, setFinalizationAction] = useState<TeamFinalizationAction>("merge");
  const allAccepted = item.acceptance.length > 0 && accepted.length === item.acceptance.length;
  const toggleCriterion = (criterion: string): void => {
    setAccepted((current) => current.includes(criterion)
      ? current.filter((candidate) => candidate !== criterion)
      : [...current, criterion]);
  };
  return (
    <main className="team-command-panel team-lifecycle-panel" aria-labelledby="team-lifecycle-heading">
      <LifecycleHeader eyebrow={`第 ${item.acceptanceRound} 轮 · 等待用户验收`} title={item.title} />
      <div className="team-lifecycle-panel__body">
        <section className="team-lifecycle-hero" data-tone="acceptance">
          <ShieldCheck aria-hidden="true" size={22} />
          <div><strong>模型已完成，任务还没有结束</strong><p>逐项确认结果；有任何一项不满足就提交返工要求，不会自动进入最终状态。</p></div>
        </section>
        {item.delivery === null ? null : (
          <section className="team-delivery-summary">
            <div><strong>{item.delivery.changedFiles}</strong><span>变更文件</span></div>
            <div><strong>{item.delivery.commits}</strong><span>本地提交</span></div>
            <p>{item.delivery.summary}</p>
          </section>
        )}
        <fieldset className="team-acceptance-checklist">
          <legend>逐项验收 <span>{accepted.length}/{item.acceptance.length}</span></legend>
          {item.acceptance.map((criterion) => (
            <label key={criterion}>
              <input checked={accepted.includes(criterion)} type="checkbox" onChange={() => toggleCriterion(criterion)} />
              <span><CheckCircle2 aria-hidden="true" size={15} />{criterion}</span>
            </label>
          ))}
        </fieldset>
        <section className="team-rework-box">
          <label htmlFor="team-rework-request">需要返工</label>
          <textarea
            id="team-rework-request"
            placeholder="说明未通过项、期望结果或新的补充要求…"
            rows={3}
            value={reworkRequest}
            onChange={(event) => setReworkRequest(event.target.value)}
          />
          <button disabled={reworkRequest.trim().length === 0} type="button" onClick={() => onRequestRework(reworkRequest)}>
            <RotateCcw aria-hidden="true" size={14} />提交返工
          </button>
        </section>
        <section className="team-approval-box">
          <div><strong>全部通过后的收尾动作</strong><span>必须先勾选全部验收项</span></div>
          <Select value={finalizationAction} onValueChange={(value) => setFinalizationAction(value as TeamFinalizationAction)}>
            <SelectTrigger aria-label="选择验收通过后的收尾动作"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="commit"><GitCommitHorizontal aria-hidden="true" size={13} />提交当前分支</SelectItem>
              <SelectItem value="merge"><GitMerge aria-hidden="true" size={13} />创建并合并 PR</SelectItem>
              <SelectItem value="complete"><Check aria-hidden="true" size={13} />仅确认完成</SelectItem>
            </SelectContent>
          </Select>
          <button disabled={!allAccepted} type="button" onClick={() => onApprove(finalizationAction, accepted)}>
            <ShieldCheck aria-hidden="true" size={14} />验收通过并授权收尾
          </button>
        </section>
      </div>
    </main>
  );
}

function FinalizingPanel({ item, onFinishFinalization }: { item: TeamWorkItemPrototype; onFinishFinalization: () => void }): ReactElement {
  const action = item.finalizationAction ?? "complete";
  return (
    <main className="team-command-panel team-lifecycle-panel" aria-labelledby="team-lifecycle-heading">
      <LifecycleHeader eyebrow="用户已验收 · 正在收尾" title={item.title} />
      <div className="team-lifecycle-panel__body">
        <section className="team-lifecycle-hero" data-tone="finalizing">
          <Sparkles aria-hidden="true" size={22} />
          <div><strong>{FINALIZATION_LABEL[action]}</strong><p>验收结果已锁定，Team Lead 正在执行你授权的收尾动作，完成后才会进入最终状态。</p></div>
        </section>
        <div className="team-lifecycle-actions"><span>原型不会真实修改 Git。</span><button type="button" onClick={onFinishFinalization}>模拟收尾完成</button></div>
      </div>
    </main>
  );
}

function CompletedPanel({ item }: { item: TeamWorkItemPrototype }): ReactElement {
  return (
    <main className="team-command-panel team-lifecycle-panel" aria-labelledby="team-lifecycle-heading">
      <LifecycleHeader eyebrow="最终状态 · 已完成" title={item.title} />
      <div className="team-lifecycle-panel__body">
        <section className="team-lifecycle-hero" data-tone="completed">
          <CheckCircle2 aria-hidden="true" size={22} />
          <div><strong>执行、用户验收和收尾均已完成</strong><p>{item.delivery?.summary ?? "任务已经按用户确认的结果结束。"}</p></div>
        </section>
        <section className="team-lifecycle-section">
          <SectionHeading icon={<ShieldCheck aria-hidden="true" size={15} />} label="最终记录" />
          <dl>
            <div><dt>验收轮次</dt><dd>{item.acceptanceRound}</dd></div>
            <div><dt>收尾方式</dt><dd>{FINALIZATION_LABEL[item.finalizationAction ?? "complete"]}</dd></div>
            <div><dt>最后返工</dt><dd>{item.reworkRequest ?? "无"}</dd></div>
          </dl>
        </section>
      </div>
    </main>
  );
}

function LifecycleHeader({ eyebrow, title }: { eyebrow: string; title: string }): ReactElement {
  return <header className="team-lifecycle-panel__header"><span>{eyebrow}</span><h2 id="team-lifecycle-heading">{title}</h2></header>;
}

function SectionHeading({ icon, label }: { icon: ReactElement; label: string }): ReactElement {
  return <h3 className="team-lifecycle-section__heading">{icon}{label}</h3>;
}
