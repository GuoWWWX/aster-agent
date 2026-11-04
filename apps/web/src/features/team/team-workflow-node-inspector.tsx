import { ArrowRight, Bot, Box, GitBranch, Link2, SlidersHorizontal } from "lucide-react";
import type { ReactElement } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import { WorkflowActionEditor } from "./team-workflow-action-editor.js";
import { createWorkflowEdge, wouldCreateWorkflowCycle } from "./team-workflow-graph.js";
import type {
  WorkflowAssignmentPolicy,
  WorkflowEdgeDefinition,
  WorkflowExecutionMode,
  WorkflowNodeDefinition,
} from "./team-workflow-simulator.js";

const AVAILABLE_ROLES = [
  "Team Lead",
  "架构 Agent",
  "开发 Agent",
  "测试 Agent",
  "代码评审 Agent",
] as const;

export function WorkflowNodeInspector({
  edges,
  node,
  nodes,
  onChange,
  onEdgesChange,
}: {
  edges: readonly WorkflowEdgeDefinition[];
  node: WorkflowNodeDefinition | null;
  nodes: readonly WorkflowNodeDefinition[];
  onChange: (node: WorkflowNodeDefinition) => void;
  onEdgesChange: (edges: WorkflowEdgeDefinition[]) => void;
}): ReactElement {
  if (node === null) {
    return (
      <aside className="workflow-designer-panel workflow-node-inspector workflow-node-inspector--empty">
        <SlidersHorizontal aria-hidden="true" size={20} />
        <p>选择一个任务节点，配置执行方式和 Agent 策略。</p>
      </aside>
    );
  }

  const toggleRole = (role: string): void => {
    const nextRoles = node.agentRoles.includes(role)
      ? node.agentRoles.filter((candidate) => candidate !== role)
      : [...node.agentRoles, role];
    if (nextRoles.length === 0) return;
    onChange({ ...node, agentRoles: nextRoles });
  };

  const toggleDownstreamNode = (targetNodeId: string): void => {
    const existing = edges.find((edge) => edge.fromNodeId === node.id && edge.toNodeId === targetNodeId);
    if (existing !== undefined) {
      onEdgesChange(edges.filter((edge) => edge.id !== existing.id));
      return;
    }
    if (wouldCreateWorkflowCycle(edges, node.id, targetNodeId)) return;
    onEdgesChange([...edges, createWorkflowEdge(node.id, targetNodeId)]);
  };

  return (
    <aside className="workflow-designer-panel workflow-node-inspector" aria-labelledby="workflow-node-inspector-heading">
      <header className="workflow-designer-panel__heading">
        <div><SlidersHorizontal aria-hidden="true" size={14} /><h2 id="workflow-node-inspector-heading">任务节点配置</h2></div>
        <span>{node.kind}</span>
      </header>
      <div className="workflow-node-inspector__body">
        <section>
          <label htmlFor="workflow-node-name">节点名称</label>
          <input
            id="workflow-node-name"
            maxLength={80}
            value={node.name}
            onChange={(event) => onChange({ ...node, name: event.target.value })}
          />
          <label htmlFor="workflow-node-description">职责说明</label>
          <textarea
            id="workflow-node-description"
            maxLength={500}
            value={node.description}
            onChange={(event) => onChange({ ...node, description: event.target.value })}
          />
        </section>

        <WorkflowActionEditor node={node} onChange={onChange} />

        <section>
          <SectionTitle icon={<Link2 aria-hidden="true" size={13} />} title="分支与汇总" />
          <p className="workflow-connection-hint">勾选多个下游可并行分叉；多个上游连接同一节点时会等待全部完成。</p>
          <div className="workflow-connection-options">
            {nodes.filter((candidate) => candidate.id !== node.id).map((candidate) => {
              const connected = edges.some((edge) => edge.fromNodeId === node.id && edge.toNodeId === candidate.id);
              const disabled = !connected && wouldCreateWorkflowCycle(edges, node.id, candidate.id);
              return (
                <label key={candidate.id} data-disabled={disabled}>
                  <input checked={connected} disabled={disabled} type="checkbox" onChange={() => toggleDownstreamNode(candidate.id)} />
                  <span>{node.name}</span><ArrowRight aria-hidden="true" size={11} /><strong>{candidate.name}</strong>
                </label>
              );
            })}
          </div>
        </section>

        <section>
          <SectionTitle icon={<GitBranch aria-hidden="true" size={13} />} title="执行策略" />
          <label htmlFor="workflow-node-mode">节点模式</label>
          <Select
            value={node.executionMode}
            onValueChange={(value) => onChange({ ...node, executionMode: value as WorkflowExecutionMode })}
          >
            <SelectTrigger id="workflow-node-mode" aria-label="节点执行模式"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="single">单 Agent 执行</SelectItem>
              <SelectItem value="parallel">多 Agent 并行</SelectItem>
              <SelectItem value="quorum">多人一致通过</SelectItem>
            </SelectContent>
          </Select>
          <label htmlFor="workflow-node-assignment">资源不足时</label>
          <Select
            value={node.assignmentPolicy}
            onValueChange={(value) => onChange({ ...node, assignmentPolicy: value as WorkflowAssignmentPolicy })}
          >
            <SelectTrigger id="workflow-node-assignment" aria-label="Agent 调度策略"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="reuse">只复用现有 Agent</SelectItem>
              <SelectItem value="expand_if_busy">允许创建临时 Agent</SelectItem>
              <SelectItem value="wait_if_busy">等待 Agent 释放</SelectItem>
            </SelectContent>
          </Select>
          <div className="workflow-node-inspector__numbers">
            <label>最少 Agent<input min={1} max={8} type="number" value={node.minAgents} onChange={(event) => {
              const minAgents = clampAgentCount(event.target.value);
              onChange({ ...node, minAgents, maxAgents: Math.max(node.maxAgents, minAgents) });
            }} /></label>
            <label>最多 Agent<input min={node.minAgents} max={8} type="number" value={node.maxAgents} onChange={(event) => {
              onChange({ ...node, maxAgents: Math.max(node.minAgents, clampAgentCount(event.target.value)) });
            }} /></label>
          </div>
        </section>

        <section>
          <SectionTitle icon={<Bot aria-hidden="true" size={13} />} title="候选 Agent" />
          <div className="workflow-role-options">
            {AVAILABLE_ROLES.map((role) => (
              <label key={role}>
                <input checked={node.agentRoles.includes(role)} type="checkbox" onChange={() => toggleRole(role)} />
                <span>{role}</span>
              </label>
            ))}
          </div>
        </section>

        <section>
          <SectionTitle icon={<Box aria-hidden="true" size={13} />} title="交接合同" />
          <ContractList label="输入容器" values={node.inputContract} />
          <ContractList label="阶段输出" values={node.outputContract} />
        </section>
      </div>
    </aside>
  );
}

function clampAgentCount(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 1;
  return Math.min(8, Math.max(1, Math.round(parsed)));
}

function ContractList({ label, values }: { label: string; values: readonly string[] }): ReactElement {
  return (
    <div className="workflow-contract-list">
      <strong>{label}</strong>
      <div>{values.map((value) => <span key={value}>{value}</span>)}</div>
    </div>
  );
}

function SectionTitle({ icon, title }: { icon: ReactElement; title: string }): ReactElement {
  return <h3 className="workflow-inspector-section-title">{icon}{title}</h3>;
}
