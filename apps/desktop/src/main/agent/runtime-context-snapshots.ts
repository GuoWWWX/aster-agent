import type { ModelMessage } from "../model/model-contracts.js";

type RuntimeContextKind = NonNullable<ModelMessage["runtimeContext"]>;

/** Append only changed runtime facts; keep previous request prefixes at their original positions. */
export function changedRuntimeContexts(
  history: readonly ModelMessage[],
  current: Record<RuntimeContextKind, ModelMessage | null | undefined>,
): ModelMessage[] {
  const additions: ModelMessage[] = [];
  for (const kind of ["queue", "skills", "checklist", "directory"] as const) {
    const previous = history.findLast(message => message.runtimeContext === kind);
    const next = current[kind];
    if (previous === undefined && next == null) continue;
    const content = next == null
      ? `[Runtime ${kind} context] No active entries. This supersedes the earlier ${kind} snapshot.`
      : `${next.content}\n[Latest ${kind} state; supersedes earlier ${kind} snapshots.]`;
    if (previous?.content === content) continue;
    additions.push({ attachments: [], role: "user", toolCallId: null, toolCalls: [], ...next, content, runtimeContext: kind });
  }
  return additions;
}
