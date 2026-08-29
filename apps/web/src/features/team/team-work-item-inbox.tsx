import { ChevronRight, Inbox, Pencil, SendHorizontal, X } from "lucide-react";
import type { FormEvent, ReactElement } from "react";

import type { TeamWorkItemPrototype, TeamWorkItemStatus } from "./team-runtime-prototype.js";
import { canEditWorkItem, type WorkItemFilter } from "./team-work-item-lifecycle.js";

export type { WorkItemFilter } from "./team-work-item-lifecycle.js";

const STATUS_LABEL: Record<TeamWorkItemStatus, string> = {
  blocked: "需要处理",
  completed: "已完成",
  executing: "执行中",
  finalizing: "收尾中",
  planning: "规划中",
  queued: "待执行",
  reworking: "返工中",
  reviewing: "测试评审",
  awaiting_acceptance: "待用户验收",
};

export function WorkItemInbox({
  acceptanceCount,
  completedCount,
  draft,
  editingItemId,
  filter,
  items,
  onCancelEdit,
  onDraftChange,
  onEdit,
  onFilterChange,
  onSelect,
  onSubmit,
  processingCount,
  queuedCount,
  selectedId,
}: {
  acceptanceCount: number;
  completedCount: number;
  draft: string;
  editingItemId: string | null;
  filter: WorkItemFilter;
  items: readonly TeamWorkItemPrototype[];
  onCancelEdit: () => void;
  onDraftChange: (draft: string) => void;
  onEdit: (id: string) => void;
  onFilterChange: (filter: WorkItemFilter) => void;
  onSelect: (id: string) => void;
  onSubmit: () => void;
  processingCount: number;
  queuedCount: number;
  selectedId: string | null;
}): ReactElement {
  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onSubmit();
  };
  return (
    <section className="team-command-panel team-inbox-panel" aria-labelledby="team-inbox-heading">
      <PanelHeading id="team-inbox-heading" label="需求与任务" meta={`${queuedCount} 个待执行`} />
      <div className="team-inbox-summary" aria-label="任务概况">
        <span><strong>{queuedCount}</strong>待执行</span>
        <span><strong>{processingCount}</strong>处理中</span>
        <span><strong>{acceptanceCount}</strong>待验收</span>
        <span><strong>{completedCount}</strong>已完成</span>
      </div>
      <div className="team-inbox-filters" role="tablist" aria-label="任务筛选">
        {([["all", "全部"], ["queued", "待执行"], ["processing", "处理中"], ["acceptance", "待验收"], ["completed", "已完成"]] as const)
          .map(([id, label]) => (
            <button
              key={id}
              aria-selected={filter === id}
              role="tab"
              type="button"
              onClick={() => onFilterChange(id)}
            >
              {label}
            </button>
          ))}
      </div>
      <div className="team-workitem-list" role="listbox" aria-label="团队任务">
        {items.length === 0 ? (
          <div className="team-runtime-empty">
            <Inbox aria-hidden="true" size={19} />
            当前筛选下没有任务
          </div>
        ) : items.map((item) => (
          <article
            key={item.id}
            aria-selected={item.id === selectedId}
            className="team-workitem-row"
            data-status={item.status}
            role="option"
          >
            <span className="team-workitem-row__status" aria-hidden="true" />
            <button className="team-workitem-row__content" type="button" onClick={() => onSelect(item.id)}>
              <span className="team-workitem-row__title">
                <strong>{item.title}</strong>
                <ChevronRight aria-hidden="true" size={14} />
              </span>
              <span>{item.project} · {item.source === "conversation" ? "来自对话" : "直接投递"}</span>
              <span className="team-workitem-row__meta">
                <small data-status={item.status}>{STATUS_LABEL[item.status]}</small>
                <time>{item.createdAt}</time>
              </span>
            </button>
            {canEditWorkItem(item) ? (
              <button
                aria-label={`编辑需求：${item.title}`}
                className="team-workitem-row__edit"
                title="执行前可以修改"
                type="button"
                onClick={() => onEdit(item.id)}
              >
                <Pencil aria-hidden="true" size={12} />
              </button>
            ) : null}
          </article>
        ))}
      </div>
      <form className="team-inbox-composer" onSubmit={submit}>
        {editingItemId === null ? (
          <p>直接向团队发送需求，Team Lead 领取前可以修改。</p>
        ) : (
          <div className="team-inbox-composer__editing">
            <span>正在修改待执行需求</span>
            <button aria-label="取消修改" title="取消修改" type="button" onClick={onCancelEdit}>
              <X aria-hidden="true" size={13} />
            </button>
          </div>
        )}
        <div>
          <textarea
            aria-label={editingItemId === null ? "向团队发送需求" : "修改待执行需求"}
            maxLength={600}
            placeholder="描述需要团队持续推进的需求…"
            rows={2}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
          />
          <button
            aria-label={editingItemId === null ? "发送需求" : "保存需求"}
            disabled={draft.trim().length === 0}
            title={editingItemId === null ? "发送需求" : "保存修改"}
            type="submit"
          >
            <SendHorizontal aria-hidden="true" size={15} />
          </button>
        </div>
      </form>
    </section>
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
