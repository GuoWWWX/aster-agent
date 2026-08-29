import { Bot, Code2, GripVertical, Network } from "lucide-react";
import { useRef, type CSSProperties, type DragEvent, type KeyboardEvent, type PointerEvent, type ReactElement, type ReactNode } from "react";

import { workflowNodeLevels } from "./team-workflow-graph.js";
import type { WorkflowEdgeDefinition, WorkflowNodeDefinition } from "./team-workflow-simulator.js";

export type WorkflowCanvasPosition = { x: number; y: number };
export type WorkflowCanvasDragSource = { paletteId: string; type: "palette" };

type WorkflowNodePointerDrag = {
  offsetX: number;
  offsetY: number;
  pointerId: number;
};

const CANVAS_WIDTH = 1800;
const CANVAS_HEIGHT = 760;
const NODE_WIDTH = 220;
const NODE_HEIGHT = 112;
const GRID_X = 285;
const GRID_Y = 165;

export function WorkflowCanvas({
  connectionSourceId,
  dragSource,
  edges,
  nodes,
  onBeginConnection,
  onCancelConnection,
  onCompleteConnection,
  onDropNode,
  onMoveNode,
  onSelectNode,
  positions,
  selectedNodeId,
  toolbar,
  workItemTitle,
}: {
  connectionSourceId: string | null;
  dragSource: WorkflowCanvasDragSource | null;
  edges: readonly WorkflowEdgeDefinition[];
  nodes: readonly WorkflowNodeDefinition[];
  onBeginConnection: (nodeId: string) => void;
  onCancelConnection: () => void;
  onCompleteConnection: (nodeId: string) => void;
  onDropNode: (position: WorkflowCanvasPosition) => void;
  onMoveNode: (nodeId: string, position: WorkflowCanvasPosition) => void;
  onSelectNode: (nodeId: string) => void;
  positions: Readonly<Record<string, WorkflowCanvasPosition>>;
  selectedNodeId: string;
  toolbar: ReactNode;
  workItemTitle?: string | undefined;
}): ReactElement {
  const dropOnCanvas = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const bounds = event.currentTarget.getBoundingClientRect();
    onDropNode(clampWorkflowCanvasPosition({
      x: event.clientX - bounds.left - NODE_WIDTH / 2,
      y: event.clientY - bounds.top - NODE_HEIGHT / 2,
    }));
  };

  return (
    <main className="workflow-designer-panel workflow-canvas" aria-labelledby="workflow-canvas-heading">
      <header className="workflow-designer-panel__heading">
        <div><Network aria-hidden="true" size={14} /><h2 id="workflow-canvas-heading">执行规划画布</h2></div>
        <span>{connectionSourceId === null
          ? `${workItemTitle === undefined ? "规划草案" : `当前需求：${workItemTitle}`} · 节点实时跟随鼠标 · 连线需手动完成`
          : "请选择目标节点的左侧端点 · Esc 取消"}</span>
      </header>
      {toolbar}
      <div className="workflow-canvas__body">
        <div
          className="workflow-canvas__surface"
          data-connecting={connectionSourceId !== null}
          data-drag-active={dragSource !== null}
          onKeyDown={(event) => {
            if (event.key === "Escape") onCancelConnection();
          }}
          onDragOver={(event) => {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }}
          onDrop={dropOnCanvas}
        >
          <svg aria-hidden="true" className="workflow-canvas__edges" height={CANVAS_HEIGHT} width={CANVAS_WIDTH}>
            <defs>
              <marker id="workflow-arrow" markerHeight="7" markerWidth="7" orient="auto" refX="6" refY="3.5">
                <path d="M 0 0 L 7 3.5 L 0 7 Z" />
              </marker>
            </defs>
            {edges.map((edge) => (
              <path key={edge.id} d={edgePath(positionOf(positions, edge.fromNodeId), positionOf(positions, edge.toNodeId))} markerEnd="url(#workflow-arrow)" />
            ))}
          </svg>
          {nodes.map((node, index) => (
            <CanvasNode
              key={node.id}
              index={index}
              node={node}
              position={positionOf(positions, node.id)}
              selected={selectedNodeId === node.id}
              connectionActive={connectionSourceId !== null}
              connectionSource={connectionSourceId === node.id}
              onBeginConnection={onBeginConnection}
              onCompleteConnection={onCompleteConnection}
              onMove={onMoveNode}
              onSelect={onSelectNode}
            />
          ))}
        </div>
      </div>
    </main>
  );
}

function CanvasNode({
  connectionActive,
  connectionSource,
  index,
  node,
  onBeginConnection,
  onCompleteConnection,
  onMove,
  onSelect,
  position,
  selected,
}: {
  connectionActive: boolean;
  connectionSource: boolean;
  index: number;
  node: WorkflowNodeDefinition;
  onBeginConnection: (nodeId: string) => void;
  onCompleteConnection: (nodeId: string) => void;
  onMove: (nodeId: string, position: WorkflowCanvasPosition) => void;
  onSelect: (nodeId: string) => void;
  position: WorkflowCanvasPosition;
  selected: boolean;
}): ReactElement {
  const pointerDragRef = useRef<WorkflowNodePointerDrag | null>(null);
  const style = { "--workflow-node-x": `${position.x}px`, "--workflow-node-y": `${position.y}px` } as CSSProperties;
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (!event.altKey) return;
    const delta = event.shiftKey ? 5 : 20;
    const offset = keyOffset(event.key, delta);
    if (offset === null) return;
    event.preventDefault();
    onMove(node.id, clampWorkflowCanvasPosition({ x: position.x + offset.x, y: position.y + offset.y }));
  };

  const beginPointerDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return;
    const nodeBounds = event.currentTarget.parentElement?.getBoundingClientRect();
    if (nodeBounds === undefined) return;
    pointerDragRef.current = {
      offsetX: event.clientX - nodeBounds.left,
      offsetY: event.clientY - nodeBounds.top,
      pointerId: event.pointerId,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    onSelect(node.id);
  };

  const movePointerDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    const drag = pointerDragRef.current;
    if (drag === null || drag.pointerId !== event.pointerId) return;
    const surface = event.currentTarget.closest<HTMLElement>(".workflow-canvas__surface");
    if (surface === null) return;
    event.preventDefault();
    onMove(node.id, workflowCanvasPositionFromPointer(
      event.clientX,
      event.clientY,
      surface.getBoundingClientRect(),
      drag,
    ));
  };

  const finishPointerDrag = (event: PointerEvent<HTMLButtonElement>): void => {
    if (pointerDragRef.current?.pointerId !== event.pointerId) return;
    pointerDragRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  return (
    <article
      className="workflow-canvas-node"
      data-selected={selected}
      style={style}
    >
      <button
        aria-label={`${index + 1}. ${node.name}，${node.actions.length} 个执行步骤`}
        aria-selected={selected}
        className="workflow-canvas-node__body"
        type="button"
        onClick={() => onSelect(node.id)}
        onKeyDown={handleKeyDown}
        onPointerCancel={finishPointerDrag}
        onPointerDown={beginPointerDrag}
        onPointerMove={movePointerDrag}
        onPointerUp={finishPointerDrag}
      >
        <header><GripVertical aria-hidden="true" size={13} /><span>{index + 1}</span><strong>{node.name}</strong><em>{node.minAgents}–{node.maxAgents} Agent</em></header>
        <p>{node.description}</p>
        <div className="workflow-canvas-node__actions">
          {node.actions.length === 0 ? <span>人工节点</span> : node.actions.map((action) => (
            <span key={action.id} data-kind={action.kind}>
              {action.kind === "model" ? <Bot aria-hidden="true" size={11} /> : <Code2 aria-hidden="true" size={11} />}
              {action.label}
            </span>
          ))}
        </div>
      </button>
      <button
        aria-label={`连接到${node.name}`}
        className="workflow-canvas-node__port workflow-canvas-node__port--input"
        disabled={!connectionActive || connectionSource}
        title="连接到此节点"
        type="button"
        onClick={() => onCompleteConnection(node.id)}
      />
      <button
        aria-label={`从${node.name}开始连线`}
        aria-pressed={connectionSource}
        className="workflow-canvas-node__port workflow-canvas-node__port--output"
        title="从此节点开始连线"
        type="button"
        onClick={() => onBeginConnection(node.id)}
      />
    </article>
  );
}

export function createCanvasPositions(
  nodes: readonly WorkflowNodeDefinition[],
  edges: readonly WorkflowEdgeDefinition[],
): Record<string, WorkflowCanvasPosition> {
  const levels = workflowNodeLevels(nodes, edges);
  const levelGroups = new Map<number, string[]>();
  for (const node of nodes) {
    const level = levels.get(node.id) ?? 0;
    levelGroups.set(level, [...(levelGroups.get(level) ?? []), node.id]);
  }
  const positions: Record<string, WorkflowCanvasPosition> = {};
  for (const [level, nodeIds] of levelGroups) {
    nodeIds.forEach((nodeId, row) => {
      positions[nodeId] = { x: 45 + level * GRID_X, y: 55 + row * GRID_Y };
    });
  }
  return positions;
}

export function nextCanvasPosition(index: number): WorkflowCanvasPosition {
  const row = Math.floor(index / 3);
  const columnInRow = index % 3;
  const column = row % 2 === 0 ? columnInRow : 2 - columnInRow;
  return { x: 45 + column * GRID_X, y: 55 + row * GRID_Y };
}

function positionOf(positions: Readonly<Record<string, WorkflowCanvasPosition>>, nodeId: string): WorkflowCanvasPosition {
  return positions[nodeId] ?? { x: 45, y: 55 };
}

export function workflowCanvasPositionFromPointer(
  clientX: number,
  clientY: number,
  surfaceBounds: Pick<DOMRect, "left" | "top">,
  pointerOffset: Pick<WorkflowNodePointerDrag, "offsetX" | "offsetY">,
): WorkflowCanvasPosition {
  return clampWorkflowCanvasPosition({
    x: clientX - surfaceBounds.left - pointerOffset.offsetX,
    y: clientY - surfaceBounds.top - pointerOffset.offsetY,
  });
}

export function clampWorkflowCanvasPosition(position: WorkflowCanvasPosition): WorkflowCanvasPosition {
  return {
    x: Math.max(15, Math.min(CANVAS_WIDTH - NODE_WIDTH - 15, Math.round(position.x))),
    y: Math.max(15, Math.min(CANVAS_HEIGHT - NODE_HEIGHT - 15, Math.round(position.y))),
  };
}

function edgePath(from: WorkflowCanvasPosition, to: WorkflowCanvasPosition): string {
  const startX = from.x + NODE_WIDTH;
  const startY = from.y + NODE_HEIGHT / 2;
  const endX = to.x;
  const endY = to.y + NODE_HEIGHT / 2;
  const bend = Math.max(55, Math.abs(endX - startX) * 0.42);
  const direction = endX >= startX ? 1 : -1;
  return `M ${startX} ${startY} C ${startX + bend * direction} ${startY}, ${endX - bend * direction} ${endY}, ${endX} ${endY}`;
}

function keyOffset(key: string, delta: number): WorkflowCanvasPosition | null {
  if (key === "ArrowLeft") return { x: -delta, y: 0 };
  if (key === "ArrowRight") return { x: delta, y: 0 };
  if (key === "ArrowUp") return { x: 0, y: -delta };
  if (key === "ArrowDown") return { x: 0, y: delta };
  return null;
}
