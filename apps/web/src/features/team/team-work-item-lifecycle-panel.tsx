import {
  Check,
  CheckCircle2,
  CircleDotDashed,
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
  const [isReworkExpanded, setIsReworkExpanded] = useState(false);
  const [reworkRequest, setReworkRequest] = useState("");
  const finalizationAction: TeamFinalizationAction = "complete";
  const hasCompletionReport = item.delivery !== null;
  return (
    <main className="team-command-panel team-lifecycle-panel" aria-labelledby="team-lifecycle-heading">
      <LifecycleHeader
        eyebrow={`交付已完成，等待验收 · 第 ${item.acceptanceRound} 轮 · 完成于 ${formatTeamWorkItemTime(item.createdAt)}`}
        title="验收与交付"
        tone="success"
      />
      <div className="team-lifecycle-panel__body team-lifecycle-panel__body--acceptance">
        {item.delivery === null ? (
          <section className="m-[10px] grid gap-[3px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] p-[12px]">
            <strong className="text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]">完成说明</strong>
            <span className="text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">团队尚未生成可供验收的完成说明。</span>
          </section>
        ) : (
          <CompletionReport delivery={item.delivery} />
        )}
        <section className="grid min-w-0 gap-[8px] border-t border-[var(--app-border)] p-[10px]" data-original-acceptance="true">
          <div className="flex min-w-0 items-start justify-between gap-[10px]">
            <div className="min-w-0">
              <strong className="text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]">原始验收要求</strong>
              <p className="mt-[2px] text-[length:var(--app-font-size-caption)] leading-[1.5] text-[var(--app-muted-foreground)]">
                用于核对完成说明，无需逐项勾选。
              </p>
            </div>
            <span className="shrink-0 rounded-[var(--app-radius-small)] bg-[var(--app-panel-subtle)] px-[7px] py-[3px] text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">
              {item.acceptance.length} 项
            </span>
          </div>
          <ol className="m-0 grid min-w-0 list-none gap-[5px] p-0">
            {item.acceptance.map((criterion, index) => (
              <li key={criterion} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-[8px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel)] px-[9px] py-[7px]">
                <span className="inline-flex size-[20px] shrink-0 items-center justify-center rounded-[var(--app-radius-small)] bg-[var(--app-panel-subtle)] text-[length:var(--app-font-size-caption)] font-semibold text-[var(--app-muted-foreground)]">{index + 1}</span>
                <span className="min-w-0 whitespace-normal break-words text-[length:var(--app-font-size-control)] leading-[1.5] text-[var(--app-foreground)]">{cleanDeliveryResultItem(criterion)}</span>
              </li>
            ))}
          </ol>
        </section>
        <section className="team-approval-box team-approval-box--acceptance">
          <div>
            <strong>确认完成</strong>
            <span>确认完成说明符合原始需求后，任务将进入最终完成状态。</span>
          </div>
          <button disabled={!hasCompletionReport} type="button" onClick={() => onApprove(finalizationAction, item.acceptance)}>
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

function CompletionReport({
  delivery,
}: {
  delivery: NonNullable<TeamWorkItemPrototype["delivery"]>;
}): ReactElement {
  const resultItems = deliveryResultItems(delivery);
  const previewItems = resultItems.slice(0, 6);
  const remainingItems = resultItems.slice(6);

  return (
    <section className="grid min-w-0 gap-[10px] p-[10px]" data-completion-report="true">
      <header className="flex min-w-0 items-start justify-between gap-[10px]">
        <div className="flex min-w-0 items-start gap-[8px]">
          <span className="inline-flex size-[28px] shrink-0 items-center justify-center rounded-[var(--app-radius)] bg-[var(--app-status-success-bg)] text-[var(--app-status-success-fg)]">
            <CheckCircle2 aria-hidden="true" size={16} />
          </span>
          <div className="min-w-0">
            <strong className="text-[length:var(--app-font-size-body)] text-[var(--app-foreground)]">完成说明</strong>
            <p className="mt-[2px] text-[length:var(--app-font-size-caption)] leading-[1.5] text-[var(--app-muted-foreground)]">
              汇总团队完成内容、实现功能、验证情况与未决风险。
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-[var(--app-radius-small)] bg-[var(--app-status-success-bg)] px-[7px] py-[3px] text-[length:var(--app-font-size-caption)] font-medium text-[var(--app-status-success-fg)]">由 Team Lead 汇总</span>
      </header>
      <div className="grid min-w-0 gap-[6px] rounded-[var(--app-radius)] border border-[var(--app-border)] bg-[var(--app-panel-subtle)] p-[9px]">
        <strong className="text-[length:var(--app-font-size-caption)] text-[var(--app-muted-foreground)]">完成内容与功能</strong>
        <ol className="m-0 grid min-w-0 list-none gap-[6px] p-0">
          {previewItems.map((item, index) => (
            <li key={`${index}-${item}`} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-[7px] text-[length:var(--app-font-size-control)] leading-[1.5] text-[var(--app-foreground)]">
              <Check aria-hidden="true" className="mt-[3px] shrink-0 text-[var(--app-status-success-fg)]" size={13} />
              <span className="min-w-0 whitespace-normal break-words">{item}</span>
            </li>
          ))}
        </ol>
        {remainingItems.length > 0 ? (
          <details className="border-t border-[var(--app-border)] pt-[6px] text-[length:var(--app-font-size-control)] text-[var(--app-foreground)]">
            <summary className="cursor-pointer text-[var(--app-primary)]">查看其余 {remainingItems.length} 项</summary>
            <ol className="mt-[6px] grid min-w-0 list-none gap-[6px] p-0">
              {remainingItems.map((item, index) => (
                <li key={`${index}-${item}`} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-start gap-[7px] leading-[1.5]">
                  <Check aria-hidden="true" className="mt-[3px] shrink-0 text-[var(--app-status-success-fg)]" size={13} />
                  <span className="min-w-0 whitespace-normal break-words">{item}</span>
                </li>
              ))}
            </ol>
          </details>
        ) : null}
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
  return /^(?:完成说明|交付结果|完成内容|实现功能|验证结果|未决风险|结果摘要|总结|验收条件(?:逐项对应)?)[：:]?$/u.test(value);
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
        {item.delivery === null ? null : <CompletionReport delivery={item.delivery} />}
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

export function compactDeliverySummary(summary: string, maxLength = 160): string {
  const normalized = summary.replace(/\s+/gu, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength).trimEnd()}…`;
}

function LifecycleHeader({
  eyebrow,
  title,
  tone = "neutral",
}: {
  eyebrow: string;
  title: string;
  tone?: "neutral" | "success";
}): ReactElement {
  return <header className="team-lifecycle-panel__header"><span data-tone={tone}>{eyebrow}</span><h2 id="team-lifecycle-heading">{title}</h2></header>;
}

function SectionHeading({ icon, label }: { icon: ReactElement; label: string }): ReactElement {
  return <h3 className="team-lifecycle-section__heading">{icon}{label}</h3>;
}
