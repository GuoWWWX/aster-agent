import {
  Bot,
  Boxes,
  Code2,
  PackageCheck,
  ShieldCheck,
} from "lucide-react";
import { useState, type DragEvent, type ReactElement } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { TEAM_WORKFLOW_EXAMPLES } from "./team-workflow-examples.js";
import { createWorkflowEdge, wouldCreateWorkflowCycle } from "./team-workflow-graph.js";
import {
  WorkflowCanvas,
  createCanvasPositions,
  nextCanvasPosition,
  type WorkflowCanvasDragSource,
  type WorkflowCanvasPosition,
} from "./team-workflow-canvas.js";
import { WorkflowNodeInspector } from "./team-workflow-node-inspector.js";
import type {
  WorkflowDefinition,
  WorkflowNodeAction,
  WorkflowNodeDefinition,
  WorkflowNodeKind,
} from "./team-workflow-simulator.js";

type PaletteItem = {
  actionKind: WorkflowNodeAction["kind"];
  icon: typeof Bot;
  kind: WorkflowNodeKind;
  label: string;
};

const PALETTE: readonly PaletteItem[] = [
  { actionKind: "model", icon: Bot, kind: "solution", label: "模型节点" },
  { actionKind: "script", icon: Code2, kind: "testing", label: "脚本节点" },
  { actionKind: "model", icon: ShieldCheck, kind: "review", label: "评审节点" },
  { actionKind: "model", icon: PackageCheck, kind: "delivery", label: "交付节点" },
];

let generatedNodeSequence = 0;

export function WorkflowDesigner({ workItemTitle }: { workItemTitle?: string | undefined }): ReactElement {
  const initialWorkflow = TEAM_WORKFLOW_EXAMPLES[0] ?? missingWorkflow();
  const [workflowId, setWorkflowId] = useState(initialWorkflow.id);
  const [nodes, setNodes] = useState<WorkflowNodeDefinition[]>(() => cloneNodes(initialWorkflow));
  const [edges, setEdges] = useState(() => initialWorkflow.edges.map((edge) => ({ ...edge })));
  const [positions, setPositions] = useState<Record<string, WorkflowCanvasPosition>>(() => createCanvasPositions(initialWorkflow.nodes, initialWorkflow.edges));
  const [selectedNodeId, setSelectedNodeId] = useState(nodes[0]?.id ?? "");
  const [connectionSourceId, setConnectionSourceId] = useState<string | null>(null);
  const [dragSource, setDragSource] = useState<WorkflowCanvasDragSource | null>(null);
  const selectedNode = nodes.find((node) => node.id === selectedNodeId) ?? null;

  const selectTemplate = (workflow: WorkflowDefinition): void => {
    const nextNodes = cloneNodes(workflow);
    setWorkflowId(workflow.id);
    setNodes(nextNodes);
    setEdges(workflow.edges.map((edge) => ({ ...edge })));
    setPositions(createCanvasPositions(nextNodes, workflow.edges));
    setSelectedNodeId(nextNodes[0]?.id ?? "");
    setConnectionSourceId(null);
  };

  const insertPaletteNode = (item: PaletteItem, position = nextCanvasPosition(nodes.length)): void => {
    const inserted = createNodeFromPalette(item);
    setNodes((current) => [...current, inserted]);
    setPositions((current) => ({ ...current, [inserted.id]: position }));
    setSelectedNodeId(inserted.id);
  };

  const dropNode = (position: WorkflowCanvasPosition): void => {
    if (dragSource?.type === "palette") {
      const item = PALETTE.find((candidate) => candidate.label === dragSource.paletteId);
      if (item !== undefined) insertPaletteNode(item, position);
    }
    setDragSource(null);
  };

  const completeConnection = (targetNodeId: string): void => {
    if (connectionSourceId === null) return;
    const duplicate = edges.some((edge) => edge.fromNodeId === connectionSourceId && edge.toNodeId === targetNodeId);
    if (!duplicate && !wouldCreateWorkflowCycle(edges, connectionSourceId, targetNodeId)) {
      setEdges((current) => [...current, createWorkflowEdge(connectionSourceId, targetNodeId)]);
    }
    setConnectionSourceId(null);
  };

  return (
    <div className="workflow-designer">
      <WorkflowCanvas
        connectionSourceId={connectionSourceId}
        dragSource={dragSource}
        edges={edges}
        nodes={nodes}
        onBeginConnection={(nodeId) => {
          setConnectionSourceId(nodeId);
          setSelectedNodeId(nodeId);
        }}
        onCancelConnection={() => setConnectionSourceId(null)}
        onCompleteConnection={completeConnection}
        positions={positions}
        selectedNodeId={selectedNodeId}
        workItemTitle={workItemTitle}
        onDropNode={dropNode}
        onMoveNode={(nodeId, position) => setPositions((current) => ({ ...current, [nodeId]: position }))}
        onSelectNode={setSelectedNodeId}
        toolbar={(
          <section className="workflow-canvas-toolbar" aria-label="画布工具栏">
            <div className="workflow-canvas-toolbar__template">
              <Boxes aria-hidden="true" size={13} />
              <span>规划策略</span>
              <Select
                value={workflowId}
                onValueChange={(nextWorkflowId) => {
                  const workflow = TEAM_WORKFLOW_EXAMPLES.find((candidate) => candidate.id === nextWorkflowId);
                  if (workflow !== undefined) selectTemplate(workflow);
                }}
              >
                <SelectTrigger aria-label="选择规划策略" className="workflow-canvas-toolbar__select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TEAM_WORKFLOW_EXAMPLES.map((workflow) => (
                    <SelectItem key={workflow.id} value={workflow.id}>{workflow.name} · {workflow.nodes.length} 节点</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="workflow-canvas-toolbar__palette">
              <span>将任务节点拖到画布</span>
              {PALETTE.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    draggable
                    type="button"
                    onClick={() => insertPaletteNode(item)}
                    onDragEnd={() => setDragSource(null)}
                    onDragStart={(event) => beginPaletteDrag(event, item)}
                  >
                    <Icon aria-hidden="true" size={13} />{item.label}
                  </button>
                );
              })}
            </div>
          </section>
        )}
      />

      <WorkflowNodeInspector
        edges={edges}
        node={selectedNode}
        nodes={nodes}
        onChange={(updated) => setNodes((current) => current.map((node) => node.id === updated.id ? updated : node))}
        onEdgesChange={setEdges}
      />
    </div>
  );

  function beginPaletteDrag(event: DragEvent<HTMLButtonElement>, item: PaletteItem): void {
    event.dataTransfer.effectAllowed = "copy";
    event.dataTransfer.setData("text/plain", `workflow-palette:${item.label}`);
    setDragSource({ paletteId: item.label, type: "palette" });
  }
}

function cloneNodes(workflow: WorkflowDefinition): WorkflowNodeDefinition[] {
  return workflow.nodes.map((node) => ({
    ...node,
    actions: node.actions.map((action) => ({ ...action })),
    agentRoles: [...node.agentRoles],
    inputContract: [...node.inputContract],
    mockAgents: [...node.mockAgents],
    outputContract: [...node.outputContract],
  }));
}

function createNodeFromPalette(item: PaletteItem): WorkflowNodeDefinition {
  const source = TEAM_WORKFLOW_EXAMPLES.flatMap((workflow) => workflow.nodes).find((node) => node.kind === item.kind);
  if (source === undefined) throw new Error(`Missing workflow node example for ${item.kind}.`);
  generatedNodeSequence += 1;
  const id = `${item.kind}-draft-${generatedNodeSequence}`;
  return {
    ...source,
    actions: [createDraftAction(item.actionKind, id)],
    agentRoles: [...source.agentRoles],
    id,
    inputContract: [...source.inputContract],
    mockAgents: [...source.mockAgents],
    name: item.label,
    outputContract: [...source.outputContract],
  };
}

function createDraftAction(kind: WorkflowNodeAction["kind"], nodeId: string): WorkflowNodeAction {
  if (kind === "script") {
    return { id: `${nodeId}-script`, kind, label: "运行脚本", runtime: "powershell", script: "pnpm test" };
  }
  return {
    id: `${nodeId}-model`,
    kind,
    label: "调用模型",
    modelId: "gpt-5.6-terra",
    prompt: "根据上一步交接包完成当前节点目标，并输出结构化结果。",
    providerId: "OpenAI",
    reasoningEffort: "high",
  };
}

function missingWorkflow(): never {
  throw new Error("At least one workflow template is required.");
}
