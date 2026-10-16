import { createContext, useContext, useEffect, useReducer, type ComponentProps, type ReactNode } from "react";
import type { ConversationRunEvent } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";
import { ModelWorkingIndicator, type ModelWorkPhase } from "../../components/ui/model-working-indicator.js";

type WorkState = { phase: ModelWorkPhase; tools: Readonly<Record<string, ModelWorkPhase>> };
type WorkStates = Readonly<Record<string, WorkState>>;
const WorkContext = createContext<WorkStates>({});

export function toolWorkPhase(name: string): ModelWorkPhase {
  if (name.startsWith("wait_for_") || name === "request_user_input") return "waiting";
  if (["web_search", "search_text", "find_files", "read_file", "read_external_file", "read_attachment", "list_directory", "get_project_info"].includes(name)) return "searching";
  return "executing";
}

/** A transient view of Runtime events, never a replacement for the Run lifecycle. */
export function updateConversationWorkState(states: WorkStates, event: ConversationRunEvent): WorkStates {
  if (!("runId" in event)) return states;
  const current = states[event.runId];
  if (event.type === "run.finished") {
    if (current === undefined) return states;
    const next = { ...states }; delete next[event.runId]; return next;
  }
  let phase: ModelWorkPhase;
  let tools = current?.tools ?? {};
  switch (event.type) {
    case "run.started":
    case "model.request_started": phase = "thinking"; break;
    case "assistant.reasoning_delta": phase = "thinking"; break;
    case "assistant.delta": phase = "writing"; break;
    case "model.retry_updated": phase = event.retry.status === "retrying" ? "waiting" : "thinking"; break;
    case "tool.approval_requested":
    case "tool.started":
      phase = event.type === "tool.approval_requested" ? "waiting" : toolWorkPhase(event.tool.name);
      if (tools[event.tool.id] === phase && current?.phase === phase) return states;
      tools = { ...tools, [event.tool.id]: phase };
      break;
    case "tool.completed": {
      if (!(event.tool.id in tools)) return states;
      const remaining = { ...tools }; delete remaining[event.tool.id]; tools = remaining;
      phase = Object.values(tools).at(-1) ?? "thinking";
      break;
    }
    default: return states;
  }
  if (current?.phase === phase && current.tools === tools) return states;
  return { ...states, [event.runId]: { phase, tools } };
}

export function ConversationWorkProvider({ agentClient, children }: { agentClient: AgentClient; children: ReactNode }) {
  const [states, dispatch] = useReducer(updateConversationWorkState, {});
  useEffect(() => agentClient.onConversationRunEvent(dispatch), [agentClient]);
  return <WorkContext.Provider value={states}>{children}</WorkContext.Provider>;
}

export function ConversationWorkIndicator({ runId, fallback = "thinking", ...props }: Omit<ComponentProps<typeof ModelWorkingIndicator>, "phase"> & {
  runId: string | null;
  fallback?: ModelWorkPhase;
}) {
  const states = useContext(WorkContext);
  return <ModelWorkingIndicator {...props} phase={runId === null ? fallback : states[runId]?.phase ?? fallback} />;
}
