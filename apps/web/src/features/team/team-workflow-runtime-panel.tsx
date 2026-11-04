import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  CircleDotDashed,
  Clock3,
  PackageCheck,
  Play,
  RotateCcw,
  Sparkles,
  UsersRound,
} from "lucide-react";
import { useState, type ReactElement } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { TEAM_WORKFLOW_EXAMPLES } from "./team-workflow-examples.js";
import { workflowNodeLevels } from "./team-workflow-graph.js";
import {
  advanceWorkflowSimulation,
  createWorkflowSimulation,
  runWorkflowToCompletion,
  type WorkflowDefinition,
  type WorkflowSimulationState,
  type WorkflowStageRunStatus,
} from "./team-workflow-simulator.js";

const STAGE_STATUS_LABEL: Record<WorkflowStageRunStatus, string> = {
  completed: "已完成",
  queued: "等待上游",
  running: "执行中",
  waiting: "等待资源",
};

export function WorkflowRuntimePanel({
  onComplete,
  workItemTitle,
}: {
  onComplete?: () => void;
  workItemTitle: string;
}): ReactElement {
  const [workflowId, setWorkflowId] = useState(TEAM_WORKFLOW_EXAMPLES[0]?.id ?? "");
  const workflow = findWorkflow(workflowId);
  const [simulation, setSimulation] = useState<WorkflowSimulationState>(() => (
    createWorkflowSimulation(workflow, workItemTitle)
  ));
  const [selectedNodeId, setSelectedNodeId] = useState(workflow.nodes[0]?.id ?? "");
  const selectedNodeIndex = workflow.nodes.findIndex((node) => node.id === selectedNodeId);
  const selectedNode = workflow.nodes[selectedNodeIndex] ?? workflow.nodes[0];
  const selectedStage = simulation.stages[selectedNodeIndex] ?? simulation.stages[0];

  const selectWorkflow = (nextWorkflowId: string): void => {
    const nextWorkflow = findWorkflow(nextWorkflowId);
    setWorkflowId(nextWorkflowId);
    setSimulation(createWorkflowSimulation(nextWorkflow, workItemTitle));
    setSelectedNodeId(nextWorkflow.nodes[0]?.id ?? "");
  };

  const advance = (): void => {
    const next = advanceWorkflowSimulation(workflow, simulation);
    setSimulation(next);
    if (next.activeNodeIds.length > 0) {
      setSelectedNodeId(next.activeNodeIds[0] ?? selectedNodeId);
    }
    if (simulation.status !== "completed" && next.status === "completed") onComplete?.();
  };

  const runAll = (): void => {
    const completed = runWorkflowToCompletion(workflow, workItemTitle);
    setSimulation(completed);
    setSelectedNodeId(workflow.nodes.at(-1)?.id ?? "");
    onComplete?.();
  };

  const reset = (): void => {
    setSimulation(createWorkflowSimulation(workflow, workItemTitle));
    setSelectedNodeId(workflow.nodes[0]?.id ?? "");
  };

  return (
    <main className="team-command-panel workflow-runtime" aria-labelledby="workflow-runtime-heading">
      <header className="workflow-runtime__header">
        <div>
          <span>执行规划模拟 · {workItemTitle}</span>
          <h2 id="workflow-runtime-heading">{workflow.name}</h2>
        </div>
        <div className="workflow-runtime__actions">
          <Select value={workflow.id} onValueChange={selectWorkflow}>
            <SelectTrigger aria-label="选择规划策略" className="workflow-runtime__select">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TEAM_WORKFLOW_EXAMPLES.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>{candidate.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button aria-label="重置执行规划" className="workflow-icon-button" title="重置执行规划" type="button" onClick={reset}>
            <RotateCcw aria-hidden="true" size={14} />
          </button>
          <button disabled={simulation.status === "completed"} type="button" onClick={advance}>
            <Play aria-hidden="true" size={13} />推进一步
          </button>
          <button disabled={simulation.status === "completed"} type="button" onClick={runAll}>
            <Sparkles aria-hidden="true" size={13} />模拟跑完
          </button>
        </div>
      </header>

      <div className="workflow-summary-strip">
        <span><strong>{workflow.nodes.length}</strong>任务节点</span>
        <span><strong>{simulation.stages.filter((stage) => stage.status === "completed").length}</strong>已经完成</span>
        <span><strong>{simulation.temporaryAgentCount}</strong>临时 Agent</span>
        <span data-status={simulation.status}><strong>{simulation.status === "completed" ? "完成" : `第 ${simulation.step + 1} 步`}</strong>运行状态</span>
      </div>

      <div className="workflow-runtime__body">
        <WorkflowGraph
          simulation={simulation}
          workflow={workflow}
          selectedNodeId={selectedNode?.id ?? null}
          onSelectNode={setSelectedNodeId}
        />

        {selectedNode === undefined || selectedStage === undefined ? null : (
          <div className="workflow-stage-inspector">
            <section className="workflow-handoff-card">
              <SectionHeading icon={<PackageCheck aria-hidden="true" size={14} />} label="阶段输入容器" meta={STAGE_STATUS_LABEL[selectedStage.status]} />
              <div className="workflow-handoff-card__content">
                <p>{selectedStage.input}</p>
                <div>
                  {selectedNode.inputContract.map((field) => <span key={field}>{field}</span>)}
                </div>
              </div>
              {selectedStage.waitingReason === null ? null : (
                <div className="workflow-waiting-reason"><Clock3 aria-hidden="true" size={13} />{selectedStage.waitingReason}</div>
              )}
            </section>

            <section className="workflow-stage-card">
              <SectionHeading icon={<Bot aria-hidden="true" size={14} />} label={selectedNode.name} meta={selectedNode.description} />
              <dl className="workflow-stage-card__facts">
                <div><dt>执行模式</dt><dd>{executionModeLabel(selectedNode.executionMode)}</dd></div>
                <div><dt>Agent 数量</dt><dd>{selectedNode.minAgents}–{selectedNode.maxAgents}</dd></div>
                <div><dt>调度策略</dt><dd>{assignmentPolicyLabel(selectedNode.assignmentPolicy)}</dd></div>
              </dl>
              <div className="workflow-agent-chips">
                {selectedStage.assignedAgents.length === 0
                  ? <span><CircleDotDashed aria-hidden="true" size={12} />尚未分配</span>
                  : selectedStage.assignedAgents.map((agent) => <span key={agent}><UsersRound aria-hidden="true" size={12} />{agent}</span>)}
              </div>
            </section>

            <section className="workflow-output-card">
              <SectionHeading icon={<ArrowRight aria-hidden="true" size={14} />} label="阶段输出" meta="进入下一节点的交接包" />
              <p>{selectedStage.output ?? "节点完成后，将在这里生成结构化输出。"}</p>
              <div>{selectedNode.outputContract.map((field) => <span key={field}><Check aria-hidden="true" size={11} />{field}</span>)}</div>
            </section>
          </div>
        )}

        <section className="workflow-event-log">
          <SectionHeading icon={<Sparkles aria-hidden="true" size={14} />} label="模拟事件" meta={`${simulation.events.length} 条`} />
          <div>
            {simulation.events.slice().reverse().map((event) => (
              <article key={event.id} data-type={event.type}>
                <span />
                <p><strong>步骤 {event.step}</strong>{event.detail}</p>
              </article>
            ))}
          </div>
        </section>
      </div>
    </main>
  );
}

function WorkflowGraph({
  onSelectNode,
  selectedNodeId,
  simulation,
  workflow,
}: {
  onSelectNode: (nodeId: string) => void;
  selectedNodeId: string | null;
  simulation: WorkflowSimulationState;
  workflow: WorkflowDefinition;
}): ReactElement {
  const nodeLevels = workflowNodeLevels(workflow.nodes, workflow.edges);
  const levelGroups = workflow.nodes.reduce<Array<Array<(typeof workflow.nodes)[number]>>>((groups, node) => {
    const level = nodeLevels.get(node.id) ?? 0;
    const group = groups[level] ?? [];
    group.push(node);
    groups[level] = group;
    return groups;
  }, []);
  return (
    <section className="workflow-graph" aria-label="执行规划运行图">
      <header><div><strong>执行路径</strong><span>{workflow.description}</span></div><small>点击任务查看交接包</small></header>
      <div className="workflow-graph__dag">
        {levelGroups.map((nodesAtLevel, level) => (
          <div key={level} className="workflow-graph__level">
            <div>
              {nodesAtLevel.map((node) => {
                const index = workflow.nodes.findIndex((candidate) => candidate.id === node.id);
                const stage = simulation.stages[index];
                return (
                  <button
                    key={node.id}
                    aria-selected={selectedNodeId === node.id}
                    className="workflow-node"
                    data-status={stage?.status ?? "queued"}
                    type="button"
                    onClick={() => onSelectNode(node.id)}
                  >
                    <span>{stage?.status === "completed" ? <Check aria-hidden="true" size={13} /> : index + 1}</span>
                    <strong>{node.name}</strong>
                    <small>{stage === undefined ? "等待" : STAGE_STATUS_LABEL[stage.status]}</small>
                  </button>
                );
              })}
            </div>
            {level === levelGroups.length - 1 ? null : <ChevronRight aria-hidden="true" className="workflow-connector" size={16} />}
          </div>
        ))}
      </div>
    </section>
  );
}

function SectionHeading({ icon, label, meta }: { icon: ReactElement; label: string; meta: string }): ReactElement {
  return (
    <header className="workflow-section-heading">
      <div>{icon}<strong>{label}</strong></div>
      <span>{meta}</span>
    </header>
  );
}

function findWorkflow(workflowId: string): WorkflowDefinition {
  const workflow = TEAM_WORKFLOW_EXAMPLES.find((candidate) => candidate.id === workflowId)
    ?? TEAM_WORKFLOW_EXAMPLES[0];
  if (workflow === undefined) throw new Error("At least one workflow example is required.");
  return workflow;
}

function assignmentPolicyLabel(policy: WorkflowDefinition["nodes"][number]["assignmentPolicy"]): string {
  if (policy === "expand_if_busy") return "空闲优先，不足时扩容";
  if (policy === "wait_if_busy") return "空闲优先，否则等待";
  return "只复用现有 Agent";
}

function executionModeLabel(mode: WorkflowDefinition["nodes"][number]["executionMode"]): string {
  if (mode === "parallel") return "并行执行";
  if (mode === "quorum") return "多人一致通过";
  return "单 Agent 执行";
}
