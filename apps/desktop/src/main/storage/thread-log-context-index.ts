import { z } from "zod";
import type { ThreadLogContext, ThreadLogEvent, ThreadLogRecordLocation, ThreadLogScanCursor } from "./thread-log-contracts.js";
import { applyContextEvent, readNullableString } from "./thread-log-context-projection.js";

const skillSnapshotResultSchema = z.object({ ok: z.literal(true), value: z.object({ loaded: z.literal(true), skill: z.object({
  id: z.string().min(1).max(80), version: z.string().min(1).max(120), contentHash: z.string().regex(/^[a-f0-9]{64}$/u),
}) }) });
export type ThreadLogSkillSnapshot = z.infer<typeof skillSnapshotResultSchema>["value"]["skill"];
export function skillSnapshotFromResult(content: string): ThreadLogSkillSnapshot | null {
  let value: unknown;
  try { value = JSON.parse(content); } catch { return null; }
  const result = skillSnapshotResultSchema.safeParse(value);
  return result.success ? result.data.value.skill : null;
}

export type ThreadLogContextIndex = {
  context: ThreadLogContext;
  checkpointOffset: number;
  locations: { record: ThreadLogRecordLocation; legacyIndex: number }[];
  cursor: ThreadLogScanCursor | null;
  skills: Map<string, ThreadLogSkillSnapshot & { runId: string | null }>;
  coveredSearch?: { key: string; hits: { position: number; start: number }[] };
};

export function createContextIndex(): ThreadLogContextIndex {
  return { context: { checkpoint: null, messages: [] }, checkpointOffset: -1, locations: [], cursor: null, skills: new Map() };
}

/** Retain offsets and usage metadata, never historical bodies or provider payloads. */
export function applyContextIndexEvent(target: ThreadLogContextIndex, event: ThreadLogEvent, record: ThreadLogRecordLocation): void {
  const replaced = event.type === "run_superseded" ? event.payload.runId
    : event.type === "run_replaced" ? event.payload.previousRunId : undefined;
  if (typeof replaced === "string" && replaced.length > 0) {
    target.locations = target.locations.filter((_, position) => target.context.messages[position]?.runId !== replaced);
    for (const [id, snapshot] of target.skills) if (snapshot.runId === replaced) target.skills.delete(id);
  }
  if (event.type === "tool_result" && event.payload.toolName === "load_skill" && event.payload.status === "completed" && typeof event.payload.content === "string") {
    const snapshot = skillSnapshotFromResult(event.payload.content);
    if (snapshot !== null) {
      target.skills.delete(snapshot.id);
      target.skills.set(snapshot.id, { ...snapshot, runId: readNullableString(event.payload.runId) });
      if (target.skills.size > 200) target.skills.delete(target.skills.keys().next().value!);
    }
  }
  const oldLength = target.locations.length;
  const checkpoint = target.context.checkpoint;
  applyContextEvent(target.context, event);
  if (target.context.checkpoint !== checkpoint) target.checkpointOffset = target.context.checkpoint === null ? -1 : record.offset;
  for (let position = oldLength; position < target.context.messages.length; position += 1) {
    const message = target.context.messages[position]!;
    target.locations.push({ record, legacyIndex: position - oldLength });
    message.content = "";
    message.toolCalls = [];
    if (message.providerState?.usage !== undefined || message.providerState?.firstTokenLatencyMs !== undefined) {
      message.providerState = { ...message.providerState, payload: null };
    } else delete message.providerState;
  }
}
