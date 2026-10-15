import { htmlPresentationResultSchema, type ConversationTimelineItem } from "@agent/protocol";

type DeliveryAnchor = {
  id: string;
  runId?: string | null;
  runIds?: readonly string[];
  continuationMessages?: readonly { runId: string | null }[];
};

export function htmlPresentationDeliveries(timeline: readonly ConversationTimelineItem[], anchors: readonly DeliveryAnchor[], activeRunId: string | null): ReadonlyMap<string, { id: string; path: string }[]> {
  const deliveries = new Map<string, { id: string; path: string }[]>();
  for (const item of timeline) {
    if (item.kind !== "tool" || item.name !== "present_html" || item.status !== "completed" || item.result === null
      || item.runId === null || item.runId === activeRunId) continue;
    let value: unknown;
    try { value = JSON.parse(item.result); } catch { continue; }
    const parsed = htmlPresentationResultSchema.safeParse(value);
    if (!parsed.success) continue;
    const runId = item.runId;
    const anchor = anchors.findLast(candidate => candidate.runId === runId || candidate.runIds?.includes(runId)
      || candidate.continuationMessages?.some(message => message.runId === runId));
    if (anchor === undefined) continue;
    const entries = deliveries.get(anchor.id) ?? [];
    entries.push({ id: item.id, path: parsed.data.value.presentation.path });
    deliveries.set(anchor.id, entries);
  }
  return deliveries;
}
