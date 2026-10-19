import type { ModelMessage } from "./model-contracts.js";

/** Runtime facts are reference text; genuine user/media input must retain its semantics. */
export function isTextRuntimeContext(message: ModelMessage): boolean {
  return message.role === "user" && message.runtimeContext !== undefined && message.attachments.length === 0;
}

/** Keep the replayable conversation prefix independent of graph-only state snapshots. */
export function withLatestRuntimeContextAtTail(messages: readonly ModelMessage[]): ModelMessage[] {
  const history: ModelMessage[] = [];
  const latest = new Map<ModelMessage["runtimeContext"], ModelMessage>();
  for (const message of messages) {
    if (isTextRuntimeContext(message)) latest.set(message.runtimeContext, message);
    else history.push(message);
  }
  for (const kind of ["queue", "skills", "checklist", "directory"] as const) {
    const message = latest.get(kind);
    if (message !== undefined) history.push(message);
  }
  return history;
}
