export type WorkflowNodeKind =
  | "solution"
  | "architecture"
  | "development"
  | "testing"
  | "review"
  | "delivery";

export type WorkflowAssignmentPolicy = "reuse" | "expand_if_busy" | "wait_if_busy";
export type WorkflowExecutionMode = "single" | "parallel" | "quorum";
export type WorkflowSimulationDecision = "reuse" | "expand" | "wait";
export type WorkflowStageRunStatus = "queued" | "waiting" | "running" | "completed";
export type WorkflowReasoningEffort = "auto" | "low" | "medium" | "high";

export type WorkflowModelAction = {
  id: string;
  kind: "model";
  label: string;
  modelId: string;
  prompt: string;
  providerId: string;
  reasoningEffort: WorkflowReasoningEffort;
};

export type WorkflowScriptAction = {
  id: string;
  kind: "script";
  label: string;
  runtime: "bash" | "javascript" | "powershell";
  script: string;
};

export type WorkflowNodeAction = WorkflowModelAction | WorkflowScriptAction;

export type WorkflowNodeDefinition = {
  actions: WorkflowNodeAction[];
  agentRoles: string[];
  assignmentPolicy: WorkflowAssignmentPolicy;
  description: string;
  executionMode: WorkflowExecutionMode;
  id: string;
  inputContract: string[];
  kind: WorkflowNodeKind;
  maxAgents: number;
  minAgents: number;
  mockAgents: string[];
  mockOutput: string;
  name: string;
  outputContract: string[];
  simulationDecision: WorkflowSimulationDecision;
};

export type WorkflowEdgeDefinition = {
  fromNodeId: string;
  id: string;
  toNodeId: string;
};

export type WorkflowDefinition = {
  description: string;
  edges: WorkflowEdgeDefinition[];
  id: string;
  name: string;
  nodes: WorkflowNodeDefinition[];
};

export type WorkflowStageRun = {
  assignedAgents: string[];
  input: string;
  nodeId: string;
  output: string | null;
  status: WorkflowStageRunStatus;
  waitingReason: string | null;
};

export type WorkflowSimulationEvent = {
  detail: string;
  id: string;
  nodeId: string | null;
  step: number;
  type: "stage_started" | "stage_completed" | "capacity_expanded" | "capacity_waiting" | "agent_released" | "workflow_completed";
};

export type WorkflowSimulationState = {
  activeNodeIds: string[];
  events: WorkflowSimulationEvent[];
  stages: WorkflowStageRun[];
  status: "running" | "completed";
  step: number;
  temporaryAgentCount: number;
  workflowId: string;
};

export function createWorkflowSimulation(
  workflow: WorkflowDefinition,
  workItemTitle = "示例项目任务",
): WorkflowSimulationState {
  const initial: WorkflowSimulationState = {
    activeNodeIds: [],
    events: [],
    stages: workflow.nodes.map((node) => ({
      assignedAgents: [],
      input: incomingEdges(workflow, node.id).length === 0
        ? `用户任务：${workItemTitle}`
        : "等待上游交接包",
      nodeId: node.id,
      output: null,
      status: "queued",
      waitingReason: null,
    })),
    status: workflow.nodes.length === 0 ? "completed" : "running",
    step: 0,
    temporaryAgentCount: 0,
    workflowId: workflow.id,
  };
  return workflow.nodes.length === 0 ? initial : activateReadyStages(workflow, initial);
}

export function advanceWorkflowSimulation(
  workflow: WorkflowDefinition,
  state: WorkflowSimulationState,
): WorkflowSimulationState {
  if (state.status === "completed") return state;
  if (state.activeNodeIds.length === 0) {
    throw new Error("Workflow cannot make progress; check for a cycle or disconnected dependency.");
  }

  const step = state.step + 1;
  let stages = state.stages;
  const events = [...state.events];
  for (const nodeId of state.activeNodeIds) {
    const nodeIndex = workflow.nodes.findIndex((node) => node.id === nodeId);
    const node = workflow.nodes[nodeIndex];
    const stage = stages[nodeIndex];
    if (node === undefined || stage === undefined) throw new Error("Workflow references a missing active node.");
    if (stage.status === "waiting") {
      stages = replaceStage(stages, nodeIndex, {
        ...stage,
        assignedAgents: node.mockAgents,
        status: "running",
        waitingReason: null,
      });
      events.push(
        createEvent(step, node.id, "agent_released", `${node.mockAgents.join("、")} 已释放。`),
        createEvent(step, node.id, "stage_started", `${node.name} 已获得所需 Agent。`),
      );
    } else if (stage.status === "running") {
      stages = replaceStage(stages, nodeIndex, { ...stage, output: node.mockOutput, status: "completed" });
      events.push(createEvent(step, node.id, "stage_completed", `${node.name} 完成，输出已写入交接包。`));
    }
  }

  const allCompleted = stages.every((stage) => stage.status === "completed");
  if (allCompleted) {
    return {
      ...state,
      activeNodeIds: [],
      events: [...events, createEvent(step, null, "workflow_completed", "全部分支已汇总，最终交付包已生成。")],
      stages,
      status: "completed",
      step,
    };
  }

  return activateReadyStages(workflow, {
    ...state,
    activeNodeIds: stages.filter((stage) => stage.status === "running" || stage.status === "waiting").map((stage) => stage.nodeId),
    events,
    stages,
    step,
  });
}

export function runWorkflowToCompletion(
  workflow: WorkflowDefinition,
  workItemTitle = "示例项目任务",
): WorkflowSimulationState {
  let state = createWorkflowSimulation(workflow, workItemTitle);
  const maxSteps = Math.max(1, workflow.nodes.length * 3);
  for (let iteration = 0; iteration < maxSteps && state.status !== "completed"; iteration += 1) {
    state = advanceWorkflowSimulation(workflow, state);
  }
  if (state.status !== "completed") throw new Error("Workflow simulation exceeded its step limit.");
  return state;
}

function activateReadyStages(
  workflow: WorkflowDefinition,
  state: WorkflowSimulationState,
): WorkflowSimulationState {
  const readyNodeIds = workflow.nodes.filter((node, index) => {
    if (state.stages[index]?.status !== "queued") return false;
    const predecessors = incomingEdges(workflow, node.id).map((edge) => edge.fromNodeId);
    return predecessors.every((nodeId) => stageByNodeId(state.stages, nodeId)?.status === "completed");
  }).map((node) => node.id);

  let next = state;
  for (const nodeId of readyNodeIds) next = activateStage(workflow, next, nodeId);
  return next;
}

function activateStage(
  workflow: WorkflowDefinition,
  state: WorkflowSimulationState,
  nodeId: string,
): WorkflowSimulationState {
  const nodeIndex = workflow.nodes.findIndex((node) => node.id === nodeId);
  const node = workflow.nodes[nodeIndex];
  const stage = state.stages[nodeIndex];
  if (node === undefined || stage === undefined) throw new Error("Workflow cannot activate a missing stage.");
  const predecessorOutputs = incomingEdges(workflow, nodeId).map((edge) => {
    const predecessor = workflow.nodes.find((candidate) => candidate.id === edge.fromNodeId);
    const output = stageByNodeId(state.stages, edge.fromNodeId)?.output;
    return `${predecessor?.name ?? edge.fromNodeId}：${output ?? "等待输出"}`;
  });
  const preparedStage = predecessorOutputs.length === 0 ? stage : { ...stage, input: predecessorOutputs.join("\n") };
  const waiting = node.simulationDecision === "wait";
  const expanded = node.simulationDecision === "expand";
  return {
    ...state,
    activeNodeIds: [...state.activeNodeIds, node.id],
    events: [
      ...state.events,
      ...(waiting
        ? [createEvent(state.step, node.id, "capacity_waiting", `${node.name} 没有空闲 Agent，已进入等待队列。`)]
        : [
          ...(expanded ? [createEvent(state.step, node.id, "capacity_expanded", `${node.name} 触发弹性扩容。`)] : []),
          createEvent(state.step, node.id, "stage_started", `${node.name} 分配给 ${node.mockAgents.join("、")}。`),
        ]),
    ],
    stages: replaceStage(state.stages, nodeIndex, {
      ...preparedStage,
      assignedAgents: waiting ? [] : node.mockAgents,
      status: waiting ? "waiting" : "running",
      waitingReason: waiting ? "符合能力要求的 Agent 正在执行其他任务" : null,
    }),
    temporaryAgentCount: state.temporaryAgentCount + (expanded ? 1 : 0),
  };
}

function incomingEdges(workflow: WorkflowDefinition, nodeId: string): WorkflowEdgeDefinition[] {
  return workflow.edges.filter((edge) => edge.toNodeId === nodeId);
}

function stageByNodeId(stages: readonly WorkflowStageRun[], nodeId: string): WorkflowStageRun | undefined {
  return stages.find((stage) => stage.nodeId === nodeId);
}

function createEvent(
  step: number,
  nodeId: string | null,
  type: WorkflowSimulationEvent["type"],
  detail: string,
): WorkflowSimulationEvent {
  return { detail, id: `${step}-${type}-${nodeId ?? "workflow"}`, nodeId, step, type };
}

function replaceStage(
  stages: readonly WorkflowStageRun[],
  index: number,
  stage: WorkflowStageRun,
): WorkflowStageRun[] {
  return stages.map((candidate, candidateIndex) => candidateIndex === index ? stage : candidate);
}
