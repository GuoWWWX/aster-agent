import { Bot, Code2, Plus } from "lucide-react";
import type { ReactElement } from "react";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select.js";
import type {
  WorkflowModelAction,
  WorkflowNodeAction,
  WorkflowNodeDefinition,
  WorkflowReasoningEffort,
  WorkflowScriptAction,
} from "./team-workflow-simulator.js";

const MODEL_PROVIDERS = [
  { id: "OpenAI", models: ["gpt-5.6-terra", "gpt-5.6-sol", "gpt-5.6-luna"] },
  { id: "项目默认供应商", models: ["主力模型", "快速模型"] },
] as const;

let generatedActionSequence = 0;

export function WorkflowActionEditor({
  node,
  onChange,
}: {
  node: WorkflowNodeDefinition;
  onChange: (node: WorkflowNodeDefinition) => void;
}): ReactElement {
  const updateAction = (updated: WorkflowNodeAction): void => {
    onChange({ ...node, actions: node.actions.map((action) => action.id === updated.id ? updated : action) });
  };

  const appendAction = (kind: WorkflowNodeAction["kind"]): void => {
    generatedActionSequence += 1;
    const id = `${node.id}-${kind}-${generatedActionSequence}`;
    const action: WorkflowNodeAction = kind === "model"
      ? {
        id,
        kind,
        label: "调用模型",
        modelId: "gpt-5.6-terra",
        prompt: "读取节点输入容器，完成当前目标并返回结构化结果。",
        providerId: "OpenAI",
        reasoningEffort: "high",
      }
      : { id, kind, label: "运行脚本", runtime: "powershell", script: "pnpm test" };
    onChange({ ...node, actions: [...node.actions, action] });
  };

  return (
    <section className="workflow-action-editor">
      <header className="workflow-action-editor__heading">
        <div><Bot aria-hidden="true" size={13} /><strong>任务执行内容</strong></div>
        <div>
          <button type="button" onClick={() => appendAction("model")}><Plus aria-hidden="true" size={11} />模型</button>
          <button type="button" onClick={() => appendAction("script")}><Plus aria-hidden="true" size={11} />脚本</button>
        </div>
      </header>
      <p className="workflow-action-editor__hint">按列表顺序执行；脚本由 Runtime 的权限与工具层运行。</p>
      <div className="workflow-action-list">
        {node.actions.map((action, index) => action.kind === "model"
          ? <ModelActionForm key={action.id} action={action} index={index} onChange={updateAction} />
          : <ScriptActionForm key={action.id} action={action} index={index} onChange={updateAction} />)}
      </div>
    </section>
  );
}

function ModelActionForm({
  action,
  index,
  onChange,
}: {
  action: WorkflowModelAction;
  index: number;
  onChange: (action: WorkflowNodeAction) => void;
}): ReactElement {
  const provider = MODEL_PROVIDERS.find((candidate) => candidate.id === action.providerId) ?? MODEL_PROVIDERS[0];
  return (
    <article className="workflow-action-card" data-kind="model">
      <header><span><Bot aria-hidden="true" size={12} />步骤 {index + 1} · 模型</span><em>{action.modelId}</em></header>
      <label>步骤名称<input value={action.label} onChange={(event) => onChange({ ...action, label: event.target.value })} /></label>
      <label>供应商
        <Select value={action.providerId} onValueChange={(providerId) => {
          const nextProvider = MODEL_PROVIDERS.find((candidate) => candidate.id === providerId) ?? MODEL_PROVIDERS[0];
          onChange({ ...action, modelId: nextProvider.models[0], providerId });
        }}>
          <SelectTrigger aria-label={`步骤 ${index + 1} 的模型供应商`}><SelectValue /></SelectTrigger>
          <SelectContent>{MODEL_PROVIDERS.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.id}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label>模型
        <Select value={action.modelId} onValueChange={(modelId) => onChange({ ...action, modelId })}>
          <SelectTrigger aria-label={`步骤 ${index + 1} 的模型`}><SelectValue /></SelectTrigger>
          <SelectContent>{provider.models.map((modelId) => <SelectItem key={modelId} value={modelId}>{modelId}</SelectItem>)}</SelectContent>
        </Select>
      </label>
      <label>推理强度
        <Select value={action.reasoningEffort} onValueChange={(reasoningEffort) => onChange({ ...action, reasoningEffort: reasoningEffort as WorkflowReasoningEffort })}>
          <SelectTrigger aria-label={`步骤 ${index + 1} 的推理强度`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">自动</SelectItem>
            <SelectItem value="low">低</SelectItem>
            <SelectItem value="medium">中</SelectItem>
            <SelectItem value="high">高</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label>提示词<textarea value={action.prompt} onChange={(event) => onChange({ ...action, prompt: event.target.value })} /></label>
    </article>
  );
}

function ScriptActionForm({
  action,
  index,
  onChange,
}: {
  action: WorkflowScriptAction;
  index: number;
  onChange: (action: WorkflowNodeAction) => void;
}): ReactElement {
  return (
    <article className="workflow-action-card" data-kind="script">
      <header><span><Code2 aria-hidden="true" size={12} />步骤 {index + 1} · 脚本</span><em>{action.runtime}</em></header>
      <label>步骤名称<input value={action.label} onChange={(event) => onChange({ ...action, label: event.target.value })} /></label>
      <label>脚本环境
        <Select value={action.runtime} onValueChange={(runtime) => onChange({ ...action, runtime: runtime as WorkflowScriptAction["runtime"] })}>
          <SelectTrigger aria-label={`步骤 ${index + 1} 的脚本环境`}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="powershell">PowerShell</SelectItem>
            <SelectItem value="bash">Bash</SelectItem>
            <SelectItem value="javascript">JavaScript</SelectItem>
          </SelectContent>
        </Select>
      </label>
      <label>脚本内容<textarea className="workflow-script-editor" spellCheck={false} value={action.script} onChange={(event) => onChange({ ...action, script: event.target.value })} /></label>
    </article>
  );
}
