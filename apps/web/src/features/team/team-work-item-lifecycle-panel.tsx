import {
  Check,
  CheckCircle2,
  CircleDotDashed,
  ExternalLink,
  FileText,
  GitCommitHorizontal,
  ListChecks,
  Maximize2,
  SendHorizontal,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { useState, type ReactElement } from "react";

import { IconButton } from "../../components/ui/icon-button.js";
import type {
  TeamFinalizationAction,
  TeamWorkItemPrototype,
} from "./team-runtime-prototype.js";
import { formatTeamWorkItemTime } from "./team-work-item-time.js";

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
      <LifecycleHeader eyebrow="需求已收集 · 等待调度" title="任务准备" />
      <div className="team-lifecycle-panel__body">
        <section className="team-lifecycle-hero" data-tone="queued">
          <CircleDotDashed aria-hidden="true" size={22} />
          <div><strong>等待可用的团队执行容量</strong><p>运行时会按团队容量自动领取需求；开始执行后会锁定当前需求版本。</p></div>
        </section>
        <section className="team-lifecycle-section">
          <SectionHeading icon={<ListChecks aria-hidden="true" size={15} />} label="预期验收条件" />
          <ul>{item.acceptance.map((criterion) => <li key={criterion}><Check aria-hidden="true" size={13} />{criterion}</li>)}</ul>
        </section>
        <div className="team-lifecycle-actions">
          <span>系统会自动调度；可手动刷新一次当前状态。</span>
          <button type="button" onClick={onClaim}><Sparkles aria-hidden="true" size={14} />刷新状态</button>
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
  const [accepted, setAccepted] = useState<string[]>([...item.acceptedCriteria]);
  const [isReworkExpanded, setIsReworkExpanded] = useState(false);
  const [reworkRequest, setReworkRequest] = useState("");
  const finalizationAction: TeamFinalizationAction = "complete";
  const allAccepted = item.acceptance.length > 0 && accepted.length === item.acceptance.length;
  const toggleCriterion = (criterion: string): void => {
    setAccepted((current) => current.includes(criterion)
      ? current.filter((candidate) => candidate !== criterion)
      : [...current, criterion]);
  };
  return (
    <main className="team-command-panel team-lifecycle-panel" aria-labelledby="team-lifecycle-heading">
      <LifecycleHeader eyebrow={`第 ${item.acceptanceRound} 轮 · 等待用户验收`} title="验收与交付" />
      <div className="team-lifecycle-panel__body team-lifecycle-panel__body--acceptance">
        <section className="team-acceptance-banner">
          <div><CheckCircle2 aria-hidden="true" size={15} /><strong>交付已完成，等待验收</strong></div>
          <span>完成于 {formatTeamWorkItemTime(item.createdAt)} <CheckCircle2 aria-hidden="true" size={13} /></span>
        </section>
        {item.delivery === null ? (
          <section className="team-acceptance-delivery__empty">
            <strong>交付结果</strong>
            <span>团队尚未生成可验收的交付结果。</span>
          </section>
        ) : (
          <AcceptanceDeliverySummary delivery={item.delivery} />
        )}
        <fieldset className="team-acceptance-checklist">
          <legend>验收清单 <span>已确认 {accepted.length}/{item.acceptance.length}</span></legend>
          {item.acceptance.map((criterion) => (
            <label key={criterion} title={criterion}>
              <input checked={accepted.includes(criterion)} type="checkbox" onChange={() => toggleCriterion(criterion)} />
              <span>{acceptanceCriterionLabel(criterion)}</span>
            </label>
          ))}
        </fieldset>
        <section className="team-approval-box team-approval-box--acceptance">
          <div>
            <strong>{allAccepted ? "全部验收项已确认" : "确认交付结果"}</strong>
            <span>{allAccepted ? "提交后，团队任务将进入最终完成状态。" : "勾选全部验收项后即可完成任务。"}</span>
          </div>
          <button disabled={!allAccepted} type="button" onClick={() => onApprove(finalizationAction, accepted)}>
            <ShieldCheck aria-hidden="true" size={14} />验收通过并完成任务
          </button>
        </section>
        <section className="team-rework-box team-rework-box--acceptance">
          <label htmlFor="team-rework-request">需要返工</label>
          <div className="team-rework-editor" data-expanded={isReworkExpanded}>
            <textarea
              id="team-rework-request"
              maxLength={500}
              placeholder="请描述需要返工的内容和原因…"
              rows={isReworkExpanded ? 6 : 2}
              value={reworkRequest}
              onChange={(event) => setReworkRequest(event.target.value)}
            />
            <div className="team-rework-editor__footer">
              <button disabled={reworkRequest.trim().length === 0} type="button" onClick={() => onRequestRework(reworkRequest.trim())}>
                <SendHorizontal aria-hidden="true" size={13} />发送返工要求
              </button>
              <div>
                <span>{reworkRequest.length} / 500</span>
                <IconButton className="size-6" label={isReworkExpanded ? "收起返工输入框" : "展开返工输入框"} onClick={() => setIsReworkExpanded((expanded) => !expanded)}>
                  <Maximize2 aria-hidden="true" size={12} />
                </IconButton>
              </div>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

function AcceptanceDeliverySummary({
  delivery,
}: {
  delivery: NonNullable<TeamWorkItemPrototype["delivery"]>;
}): ReactElement {
  const resultItems = deliveryResultItems(delivery);
  const previewItems = resultItems.slice(0, 3).map((item) => compactDeliverySummary(item, 100));

  return (
    <section className="team-acceptance-delivery">
      <div className="team-acceptance-delivery__metrics">
        <div><FileText aria-hidden="true" size={17} /><span>变更文件<strong>{delivery.changedFiles} 个</strong></span></div>
        <div><GitCommitHorizontal aria-hidden="true" size={17} /><span>提交记录<strong>{delivery.commits} 次</strong></span></div>
      </div>
      <div className="team-acceptance-delivery__preview">
        <header>
          <strong>交付结果</strong>
          <details>
            <summary>查看完整交付内容 <ExternalLink aria-hidden="true" size={12} /></summary>
            <ol>{resultItems.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol>
          </details>
        </header>
        <ul>{previewItems.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>
      </div>
    </section>
  );
}

export function deliveryResultItems(
  delivery: NonNullable<TeamWorkItemPrototype["delivery"]>,
): string[] {
  const summaryItems = delivery.summary
    .replace(/```[\s\S]*?```/gu, "")
    .replace(/\r/gu, "")
    .replace(/\s*---+\s*/gu, "\n")
    .replace(/([。！？；])\s*/gu, "$1\n")
    .replace(/\s+(?=(?:[-*+]\s+|\d+[.)]\s+))/gu, "\n")
    .split(/\n+/gu)
    .map(cleanDeliveryResultItem)
    .filter((item) => item.length > 0 && !isDeliverySectionHeading(item));
  const taskItems = delivery.tests.map(cleanDeliveryResultItem).filter((item) => item.length > 0);

  const resultItems = [...summaryItems, ...taskItems]
    .filter((item, index, items) => items.indexOf(item) === index);
  return resultItems.length === 0 ? ["团队已完成执行，暂无更详细的交付说明。"] : resultItems;
}

function cleanDeliveryResultItem(value: string): string {
  return value
    .trim()
    .replace(/^#{1,6}\s*/u, "")
    .replace(/^(?:[-*+]|\d+[.)])\s+/u, "")
    .replace(/^\[[ xX]\]\s*/u, "")
    .replace(/^✅\s*/u, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/gu, "$1")
    .replace(/(?:\*\*|__|`)/gu, "")
    .trim();
}

function isDeliverySectionHeading(value: string): boolean {
  return /^(?:交付结果|完成内容|结果摘要|总结|验收条件(?:逐项对应)?)[：:]?$/u.test(value);
}

function acceptanceCriterionLabel(criterion: string): string {
  const normalized = cleanDeliveryResultItem(criterion).replace(/[。；]$/u, "");
  const firstClause = normalized.split(/[，；。]/u)[0]?.trim() ?? normalized;
  return compactDeliverySummary(firstClause, 24);
}

function FinalizingPanel({ item, onFinishFinalization }: { item: TeamWorkItemPrototype; onFinishFinalization: () => void }): ReactElement {
  const action = item.finalizationAction ?? "complete";
  return (
    <main className="team-command-panel team-lifecycle-panel" aria-labelledby="team-lifecycle-heading">
      <LifecycleHeader eyebrow="用户已验收 · 正在收尾" title="收尾进度" />
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
      <LifecycleHeader eyebrow="最终状态 · 已完成" title="交付记录" />
      <div className="team-lifecycle-panel__body">
        <section className="team-lifecycle-hero" data-tone="completed">
          <CheckCircle2 aria-hidden="true" size={22} />
          <div><strong>执行、用户验收和收尾均已完成</strong><p>完整过程可在 Team Lead 对话中审计；这里保留交付摘要和最终记录。</p></div>
        </section>
        {item.delivery === null ? null : <DeliverySummary delivery={item.delivery} />}
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

function DeliverySummary({
  delivery,
}: {
  delivery: NonNullable<TeamWorkItemPrototype["delivery"]>;
}): ReactElement {
  const preview = compactDeliverySummary(delivery.summary);
  const isTruncated = preview.length < delivery.summary.length;

  return (
    <section className="team-delivery-summary">
      <div><strong>{delivery.changedFiles}</strong><span>变更文件</span></div>
      <div><strong>{delivery.commits}</strong><span>本地提交</span></div>
      <p className="line-clamp-3">{preview}</p>
      {isTruncated ? (
        <details className="team-delivery-summary__details">
          <summary>查看完整交付内容</summary>
          <p>{delivery.summary}</p>
        </details>
      ) : null}
    </section>
  );
}

export function compactDeliverySummary(summary: string, maxLength = 160): string {
  const normalized = summary.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength).trimEnd()}…`;
}

function LifecycleHeader({ eyebrow, title }: { eyebrow: string; title: string }): ReactElement {
  return <header className="team-lifecycle-panel__header"><span>{eyebrow}</span><h2 id="team-lifecycle-heading">{title}</h2></header>;
}

function SectionHeading({ icon, label }: { icon: ReactElement; label: string }): ReactElement {
  return <h3 className="team-lifecycle-section__heading">{icon}{label}</h3>;
}
