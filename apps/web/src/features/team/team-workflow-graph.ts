import type { WorkflowEdgeDefinition, WorkflowNodeDefinition } from "./team-workflow-simulator.js";

export function workflowNodeLevels(
  nodes: readonly WorkflowNodeDefinition[],
  edges: readonly WorkflowEdgeDefinition[],
): ReadonlyMap<string, number> {
  const levels = new Map(nodes.map((node) => [node.id, 0]));
  for (let pass = 0; pass < nodes.length; pass += 1) {
    for (const edge of edges) {
      const fromLevel = levels.get(edge.fromNodeId) ?? 0;
      const toLevel = levels.get(edge.toNodeId) ?? 0;
      if (toLevel <= fromLevel) levels.set(edge.toNodeId, fromLevel + 1);
    }
  }
  return levels;
}

export function wouldCreateWorkflowCycle(
  edges: readonly WorkflowEdgeDefinition[],
  fromNodeId: string,
  toNodeId: string,
): boolean {
  if (fromNodeId === toNodeId) return true;
  const adjacency = new Map<string, string[]>();
  for (const edge of [...edges, createWorkflowEdge(fromNodeId, toNodeId)]) {
    const targets = adjacency.get(edge.fromNodeId) ?? [];
    targets.push(edge.toNodeId);
    adjacency.set(edge.fromNodeId, targets);
  }
  const pending = [toNodeId];
  const visited = new Set<string>();
  while (pending.length > 0) {
    const nodeId = pending.pop();
    if (nodeId === undefined || visited.has(nodeId)) continue;
    if (nodeId === fromNodeId) return true;
    visited.add(nodeId);
    pending.push(...(adjacency.get(nodeId) ?? []));
  }
  return false;
}

export function createWorkflowEdge(fromNodeId: string, toNodeId: string): WorkflowEdgeDefinition {
  return { fromNodeId, id: `${fromNodeId}-${toNodeId}`, toNodeId };
}
