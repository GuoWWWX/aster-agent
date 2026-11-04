import type { ConversationTimelineItem, ConversationToolItem } from "@agent/protocol";

type Anchor = { id: string; runId?: string | null; runIds?: readonly string[]; continuationMessages?: readonly { runId: string | null }[] };

/** Keep image outputs visible when the work transcript collapses, including live placeholders. */
export function imageGenerationDeliveries(timeline: readonly ConversationTimelineItem[], anchors: readonly Anchor[]): ReadonlyMap<string, ConversationToolItem[]> {
  const result = new Map<string, ConversationToolItem[]>();
  for (const item of timeline) {
    if (item.kind !== "tool" || item.name !== "generate_images" || item.runId === null) continue;
    const anchor = anchors.findLast(candidate => candidate.runId === item.runId || candidate.runIds?.includes(item.runId) || candidate.continuationMessages?.some(message => message.runId === item.runId));
    if (anchor === undefined) continue;
    const items = result.get(anchor.id) ?? []; items.push(item); result.set(anchor.id, items);
  }
  return result;
}
