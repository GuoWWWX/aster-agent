import type {
  TeamFinalizationAction,
  TeamWorkItemPrototype,
  TeamWorkItemStatus,
} from "./team-runtime-prototype.js";

export type WorkItemFilter = "all" | "queued" | "processing" | "acceptance" | "completed";

export type WorkItemLifecycleAction =
  | { type: "claim" }
  | { type: "execution_completed" }
  | { request: string; type: "request_rework" }
  | { acceptedCriteria: readonly string[]; action: TeamFinalizationAction; type: "approve" }
  | { type: "finalization_completed" };

const PROCESSING_STATUSES: readonly TeamWorkItemStatus[] = [
  "planning",
  "executing",
  "reviewing",
  "blocked",
  "reworking",
  "finalizing",
];

export function canEditWorkItem(item: TeamWorkItemPrototype): boolean {
  return item.status === "queued";
}

export function matchesWorkItemFilter(
  item: TeamWorkItemPrototype,
  filter: WorkItemFilter,
): boolean {
  if (filter === "all") return true;
  if (filter === "queued") return item.status === "queued";
  if (filter === "acceptance") return item.status === "awaiting_acceptance";
  if (filter === "completed") return item.status === "completed";
  return PROCESSING_STATUSES.includes(item.status);
}

export function isProcessingWorkItem(item: TeamWorkItemPrototype): boolean {
  return PROCESSING_STATUSES.includes(item.status);
}

export function transitionWorkItem(
  item: TeamWorkItemPrototype,
  action: WorkItemLifecycleAction,
): TeamWorkItemPrototype {
  if (action.type === "claim" && item.status === "queued") {
    return { ...item, nextAction: "Team Lead 正在制定方案并分配执行 Agent。", status: "planning" };
  }
  if (action.type === "execution_completed" && isProcessingWorkItem(item) && item.status !== "finalizing") {
    return { ...item, nextAction: "等待用户逐项验收执行结果。", status: "awaiting_acceptance" };
  }
  if (action.type === "request_rework" && item.status === "awaiting_acceptance") {
    const request = action.request.trim();
    if (request.length === 0) return item;
    return {
      ...item,
      acceptedCriteria: [],
      acceptanceRound: item.acceptanceRound + 1,
      nextAction: "团队正在根据用户反馈重新规划并执行。",
      reworkRequest: request,
      status: "reworking",
    };
  }
  if (action.type === "approve" && item.status === "awaiting_acceptance") {
    const acceptedCriteria = item.acceptance.filter((criterion) => action.acceptedCriteria.includes(criterion));
    if (acceptedCriteria.length !== item.acceptance.length || item.acceptance.length === 0) return item;
    return {
      ...item,
      acceptedCriteria,
      finalizationAction: action.action,
      nextAction: "Team Lead 正在执行用户批准的收尾操作。",
      status: "finalizing",
    };
  }
  if (action.type === "finalization_completed" && item.status === "finalizing") {
    return { ...item, nextAction: "任务已经结束，无待处理动作。", status: "completed" };
  }
  return item;
}
