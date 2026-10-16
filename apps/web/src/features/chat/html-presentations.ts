import { htmlPresentationResultSchema, type ConversationTimelineItem, type HtmlPresentationPage } from "@agent/protocol";

type DeliveryAnchor = {
  id: string;
  runId?: string | null;
  runIds?: readonly string[];
  continuationMessages?: readonly { runId: string | null }[];
};

type HtmlDelivery = { id: string } & ({ path: string } | { pages: HtmlPresentationPage[] });

export function htmlPresentationDeliveries(timeline: readonly ConversationTimelineItem[], anchors: readonly DeliveryAnchor[], activeRunId: string | null): ReadonlyMap<string, HtmlDelivery[]> {
  const deliveries = new Map<string, HtmlDelivery[]>();
  const latestByPath = new Map<string, HtmlDelivery & { runId: string }>();
  for (const item of timeline) {
    if (item.kind !== "tool" || item.name !== "present_html" || item.status !== "completed" || item.result === null
      || item.runId === null || item.runId === activeRunId) continue;
    let value: unknown;
    try { value = JSON.parse(item.result); } catch { continue; }
    const parsed = htmlPresentationResultSchema.safeParse(value);
    if (!parsed.success) continue;
    const presentation = parsed.data.value.presentation;
    if (presentation.kind === "html") latestByPath.set(JSON.stringify(["file", presentation.path]), { id: item.id, path: presentation.path, runId: item.runId });
    else latestByPath.set(JSON.stringify(["gallery", item.id]), { id: item.id, pages: presentation.pages, runId: item.runId });
  }
  for (const { runId, ...delivery } of latestByPath.values()) {
    const anchor = anchors.findLast(candidate => candidate.runId === runId || candidate.runIds?.includes(runId)
      || candidate.continuationMessages?.some(message => message.runId === runId));
    if (anchor === undefined) continue;
    const entries = deliveries.get(anchor.id) ?? [];
    entries.push(delivery);
    deliveries.set(anchor.id, entries);
  }
  return deliveries;
}
