import { CheckCircle2, ChevronRight, CircleDotDashed, ClipboardList, Clock3 } from "lucide-react";
import type { ReactElement } from "react";

import type { TeamWorkItemPrototype, TeamWorkItemStatus } from "./team-runtime-prototype.js";

type WorkItemBoardColumnId = "acceptance" | "completed" | "processing" | "queued";

type WorkItemBoardColumn = {
  id: WorkItemBoardColumnId;
  label: string;
};

const BOARD_COLUMNS: readonly WorkItemBoardColumn[] = [
  { id: "queued", label: "待执行" },
  { id: "processing", label: "处理中" },
  { id: "acceptance", label: "待验收" },
  { id: "completed", label: "已完成" },
];

const STATUS_LABEL: Record<TeamWorkItemStatus, string> = {
  awaiting_acceptance: "等待用户验收",
  blocked: "需要处理",
  completed: "已完成",
  executing: "执行中",
  finalizing: "收尾中",
  planning: "规划中",
  queued: "尚未执行",
  reworking: "返工中",
  reviewing: "测试评审",
};

export function TeamWorkItemBoard({
  items,
  onOpen,
}: {
  items: readonly TeamWorkItemPrototype[];
  onOpen: (workItemId: string) => void;
}): ReactElement {
  return (
    <section className="team-workitem-board" aria-labelledby="team-workitem-board-heading">
      <header className="team-command-panel team-command-panel__heading team-workitem-board__heading">
        <div>
          <ClipboardList aria-hidden="true" size={14} />
          <h2 id="team-workitem-board-heading">需求状态看板</h2>
          <span>{items.length} 个需求</span>
        </div>
      </header>
      <div className="team-workitem-board__columns">
        {BOARD_COLUMNS.map((column) => {
          const columnItems = items.filter((item) => workItemBoardColumnForStatus(item.status) === column.id);
          return (
            <section key={column.id} className="team-workitem-board__column" data-column={column.id} aria-labelledby={`team-board-${column.id}`}>
              <header>
                <div>{column.id === "completed" ? <CheckCircle2 aria-hidden="true" size={13} /> : column.id === "queued" ? <Clock3 aria-hidden="true" size={13} /> : <CircleDotDashed aria-hidden="true" size={13} />}</div>
                <h3 id={`team-board-${column.id}`}>{column.label}</h3>
                <span>{columnItems.length}</span>
              </header>
              <div className="team-workitem-board__list">
                {columnItems.length === 0 ? (
                  <p>暂无需求</p>
                ) : columnItems.map((item) => (
                  <button key={item.id} type="button" onClick={() => onOpen(item.id)}>
                    <span className="team-workitem-board__card-title">
                      <strong>{item.title}</strong>
                      <ChevronRight aria-hidden="true" size={13} />
                    </span>
                    <small data-status={item.status}>{STATUS_LABEL[item.status]}</small>
                    <span>{item.project} · {item.source === "conversation" ? "来自对话" : "直接投递"}</span>
                    <p>{item.nextAction}</p>
                    <time>{item.createdAt}</time>
                  </button>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </section>
  );
}

export function workItemBoardColumnForStatus(status: TeamWorkItemStatus): WorkItemBoardColumnId {
  if (status === "queued") return "queued";
  if (status === "awaiting_acceptance") return "acceptance";
  if (status === "completed") return "completed";
  return "processing";
}
