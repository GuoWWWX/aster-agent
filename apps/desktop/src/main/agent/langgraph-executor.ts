import { Annotation, END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph-checkpoint";

import type {
  ModelMessage,
  ModelToolCall,
  ModelTurnResult,
} from "../model/model-contracts.js";
import type { SkillSnapshotRef } from "./skill-runtime.js";

export type AgentGraphState = {
  activeSkills: SkillSnapshotRef[];
  hasFollowUpInput: boolean;
  hasSuccessfulToolExecution: boolean;
  lastResult: ModelTurnResult | null;
  messages: ModelMessage[];
  pendingToolCalls: ModelToolCall[];
  turns: number;
};

type AgentGraphUpdate = {
  activeSkills?: SkillSnapshotRef[];
  hasFollowUpInput?: boolean;
  hasSuccessfulToolExecution?: boolean;
  lastResult?: ModelTurnResult | null;
  messages?: ModelMessage[];
  pendingToolCalls?: ModelToolCall[];
  turns?: number;
};

const AgentGraphAnnotation = Annotation.Root({
  activeSkills: Annotation<SkillSnapshotRef[]>({
    reducer: (current, next) => {
      const merged = new Map(current.map((skill) => [skill.id, skill]));
      for (const skill of next) merged.set(skill.id, skill);
      return [...merged.values()];
    },
    default: () => [],
  }),
  hasFollowUpInput: Annotation<boolean>({
    reducer: (_current, next) => next,
    default: () => false,
  }),
  hasSuccessfulToolExecution: Annotation<boolean>({
    reducer: (_current, next) => next,
    default: () => false,
  }),
  lastResult: Annotation<ModelTurnResult | null>({
    reducer: (_current, next) => next,
    default: () => null,
  }),
  messages: Annotation<ModelMessage[]>({
    reducer: (current, next) => [...current, ...next],
    default: () => [],
  }),
  pendingToolCalls: Annotation<ModelToolCall[]>({
    reducer: (_current, next) => next,
    default: () => [],
  }),
  turns: Annotation<number>({
    reducer: (_current, next) => next,
    default: () => 0,
  }),
});

type AgentGraphStateValue = typeof AgentGraphAnnotation.State;

export type AgentGraphModelPreparation = {
  contextMessages?: ModelMessage[];
  messages: ModelMessage[];
  hasFollowUpInput: boolean;
};

export type AgentGraphToolExecution = {
  activeSkills?: SkillSnapshotRef[];
  messages: ModelMessage[];
  successful: boolean;
};

export type AgentGraphCallbacks = {
  beforeModel(state: AgentGraphStateValue): Promise<AgentGraphModelPreparation>;
  executeTools(
    calls: readonly ModelToolCall[],
    state: AgentGraphStateValue,
  ): Promise<AgentGraphToolExecution>;
  hasFollowUpInput?(): boolean | Promise<boolean>;
  callModel(
    messages: readonly ModelMessage[],
    turn: number,
  ): Promise<ModelTurnResult>;
};

export type LangGraphExecutorInput = {
  callbacks: AgentGraphCallbacks;
  checkpointer?: BaseCheckpointSaver;
  initialMessages: readonly ModelMessage[];
  maxSteps: number;
  signal: AbortSignal;
  threadId: string;
};

function assistantMessage(result: ModelTurnResult): ModelMessage {
  return {
    attachments: [],
    content: result.content,
    ...(result.providerState === undefined
      ? {}
      : { providerState: result.providerState }),
    role: "assistant",
    toolCallId: null,
    toolCalls: result.toolCalls,
  };
}

function modelInputMessages(
  stateMessages: readonly ModelMessage[],
  preparedMessages: readonly ModelMessage[],
  contextMessages: readonly ModelMessage[],
): ModelMessage[] {
  const messages = [...stateMessages, ...preparedMessages];
  if (contextMessages.length === 0) return messages;
  const firstSystemIndex = messages.findIndex((message) => message.role === "system");
  if (firstSystemIndex < 0) return [...contextMessages, ...messages];
  const system = messages[firstSystemIndex];
  if (system === undefined) return [...contextMessages, ...messages];
  return [system, ...contextMessages, ...messages.filter((_message, index) => index !== firstSystemIndex)];
}

function routeAfterModel(state: AgentGraphStateValue, maxSteps: number): "tools" | "model" | typeof END {
  if (state.pendingToolCalls.length > 0) return "tools";
  if (state.lastResult === null) return END;
  if (state.hasFollowUpInput) {
    if (state.turns >= maxSteps) {
      throw new Error(`Agent exceeded the ${maxSteps}-turn tool loop limit.`);
    }
    return "model";
  }
  return END;
}

/**
 * Runs the bounded Agent graph. External side effects remain callback-owned;
 * this module only owns graph state, routing, and cancellation propagation.
 */
export class LangGraphExecutor {
  public async invoke(input: LangGraphExecutorInput): Promise<AgentGraphState> {
    if (!Number.isInteger(input.maxSteps) || input.maxSteps < 1) {
      throw new Error("LangGraph maxSteps must be a positive integer.");
    }
    input.signal.throwIfAborted();

    const graph = new StateGraph(AgentGraphAnnotation)
      .addNode("model", async (state): Promise<AgentGraphUpdate> => {
        input.signal.throwIfAborted();
        if (state.turns >= input.maxSteps) {
          throw new Error(`Agent exceeded the ${input.maxSteps}-turn tool loop limit.`);
        }
        const prepared = await input.callbacks.beforeModel(state);
        const messages = modelInputMessages(
          state.messages,
          prepared.messages,
          prepared.contextMessages ?? [],
        );
        const result = await input.callbacks.callModel(messages, state.turns);
        input.signal.throwIfAborted();
        const callbackFollowUpInput = await input.callbacks.hasFollowUpInput?.() ?? false;
        const hasFollowUpInput = result.toolCalls.length === 0
          && (prepared.hasFollowUpInput || callbackFollowUpInput);
        return {
          hasFollowUpInput,
          lastResult: result,
          messages: [...prepared.messages, assistantMessage(result)],
          pendingToolCalls: result.toolCalls,
          turns: state.turns + 1,
        };
      })
      .addNode("tools", async (state): Promise<AgentGraphUpdate> => {
        input.signal.throwIfAborted();
        const execution = await input.callbacks.executeTools(state.pendingToolCalls, state);
        input.signal.throwIfAborted();
        return {
          activeSkills: execution.activeSkills ?? [],
          hasSuccessfulToolExecution:
            state.hasSuccessfulToolExecution || execution.successful,
          messages: execution.messages,
          pendingToolCalls: [],
        };
      })
      .addEdge(START, "model")
      .addEdge("tools", "model")
      .addConditionalEdges(
        "model",
        (state) => routeAfterModel(state, input.maxSteps),
        { model: "model", tools: "tools", [END]: END },
      )
      .compile(input.checkpointer === undefined ? undefined : { checkpointer: input.checkpointer });

    const result = await graph.invoke(
      {
        messages: [...input.initialMessages],
      },
      {
        configurable: { thread_id: input.threadId },
        signal: input.signal,
      },
    );
    return result;
  }
}
