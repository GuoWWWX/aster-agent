import { ThreadLog } from "./thread-log.js";
import { ThreadLogTimeline, type ThreadLogTimelineIndex } from "./thread-log-timeline.js";
import { applyContextIndexEvent, createContextIndex, type ThreadLogContextIndex } from "./thread-log-context-index.js";
import type { ThreadLogSourceSignature } from "./thread-log-contracts.js";

export type ThreadLogReadIndexes = {
  source: ThreadLogSourceSignature | null;
  timeline: ThreadLogTimelineIndex;
  context: ThreadLogContextIndex;
};
export interface ThreadLogReadIndexLoader {
  read(log: ThreadLog, conversationId: string): Promise<ThreadLogReadIndexes | null>;
}

/** One canonical scan builds both body-free read indexes in the worker. */
export function buildThreadLogReadIndexes(log: ThreadLog, conversationId: string): ThreadLogReadIndexes | null {
  const source = log.getSourceSignature(conversationId);
  const context = createContextIndex();
  const reader = new ThreadLogTimeline(log, (event, record) => applyContextIndexEvent(context, event, record));
  const timeline = reader.readIndex(conversationId);
  context.cursor = timeline.cursor;
  if (!sameSource(source, log.getSourceSignature(conversationId))) return null;
  return { source, timeline, context };
}

export function restoreThreadLogReadIndexes(log: ThreadLog, timeline: ThreadLogTimeline, conversationId: string, snapshot: ThreadLogReadIndexes): boolean {
  if (!sameSource(snapshot.source, log.getSourceSignature(conversationId))) return false;
  log.restoreContextIndex(conversationId, snapshot.context);
  timeline.restoreIndex(conversationId, snapshot.timeline);
  return true;
}

function sameSource(left: ThreadLogSourceSignature | null, right: ThreadLogSourceSignature | null): boolean {
  return left?.sizeBytes === right?.sizeBytes && left?.modifiedAtMs === right?.modifiedAtMs;
}
