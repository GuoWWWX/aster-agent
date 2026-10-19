import { randomUUID } from "node:crypto";
import type { ConversationToolItem } from "@agent/protocol";
import type { ToolExecution } from "../tools/project-tool-registry.js";
import type { CachedGraphToolResult, LangChainToolResultEnvelope } from "./runtime-tool-results.js";

type ToolCallIdentity = { runId: string; callId: string };
type CallReplayState = {
  started?: ConversationToolItem;
  completed?: CachedGraphToolResult;
  prepared?: ToolExecution;
  intentRecorded?: boolean;
  inFlight?: Promise<LangChainToolResultEnvelope>;
};
type RunReplayState = {
  calls: Map<string, CallReplayState>;
  batchIds: Map<string, string>;
};

/** Run-local replay facts only; persistence, permissions and notifications stay in the Runtime. */
export class RuntimeToolCallLedger {
  private readonly runs = new Map<string, RunReplayState>();

  public getStarted(call: ToolCallIdentity): ConversationToolItem | undefined {
    return this.findCall(call)?.started;
  }

  public rememberStarted(call: ToolCallIdentity, tool: ConversationToolItem): void {
    this.callState(call).started = tool;
  }

  public getPrepared(call: ToolCallIdentity): ToolExecution | undefined {
    return this.findCall(call)?.prepared;
  }

  public rememberPrepared(call: ToolCallIdentity, execution: ToolExecution): void {
    this.callState(call).prepared = execution;
  }

  public releasePreparation(call: ToolCallIdentity): void {
    const state = this.findCall(call);
    if (state === undefined) return;
    delete state.started;
    delete state.prepared;
  }

  public getCompleted(call: ToolCallIdentity): CachedGraphToolResult | undefined {
    return this.findCall(call)?.completed;
  }

  public rememberCompleted(call: ToolCallIdentity, result: CachedGraphToolResult): void {
    this.callState(call).completed = result;
  }

  public hasExecutionIntent(call: ToolCallIdentity): boolean {
    return this.findCall(call)?.intentRecorded === true;
  }

  public recordExecutionIntent(call: ToolCallIdentity): void {
    this.callState(call).intentRecorded = true;
  }

  public batchId(runId: string, callIds: readonly string[]): string {
    const batches = this.runState(runId).batchIds;
    const key = callIds.join(",");
    const existing = batches.get(key);
    if (existing !== undefined) return existing;
    const id = randomUUID();
    batches.set(key, id);
    return id;
  }

  public releaseBatch(runId: string, callIds: readonly string[]): void {
    this.runs.get(runId)?.batchIds.delete(callIds.join(","));
  }

  /** Completed calls and sibling ToolNode replays must never execute the same side effect twice. */
  public executeOnce(
    call: ToolCallIdentity,
    execute: () => Promise<LangChainToolResultEnvelope>,
  ): Promise<LangChainToolResultEnvelope> {
    const current = this.findCall(call);
    if (current?.completed !== undefined) return Promise.resolve(current.completed.envelope);
    if (current?.inFlight !== undefined) return current.inFlight;
    const execution = execute();
    this.callState(call).inFlight = execution;
    const clearInFlight = (): void => {
      const state = this.findCall(call);
      if (state?.inFlight === execution) delete state.inFlight;
    };
    void execution.then(clearInFlight, clearInFlight);
    return execution;
  }

  public disposeRun(runId: string): void {
    this.runs.delete(runId);
  }

  private findCall(call: ToolCallIdentity): CallReplayState | undefined {
    return this.runs.get(call.runId)?.calls.get(call.callId);
  }

  private callState(call: ToolCallIdentity): CallReplayState {
    const calls = this.runState(call.runId).calls;
    const existing = calls.get(call.callId);
    if (existing !== undefined) return existing;
    const state: CallReplayState = {};
    calls.set(call.callId, state);
    return state;
  }

  private runState(runId: string): RunReplayState {
    const existing = this.runs.get(runId);
    if (existing !== undefined) return existing;
    const state: RunReplayState = { calls: new Map(), batchIds: new Map() };
    this.runs.set(runId, state);
    return state;
  }
}
