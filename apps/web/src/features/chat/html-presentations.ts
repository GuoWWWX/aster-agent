import { htmlPresentationResultSchema, type ConversationTimelineItem, type HtmlPresentationPage } from "@agent/protocol";

type DeliveryAnchor = {
  id: string;
  runId?: string | null;
  runIds?: readonly string[];
  continuationMessages?: readonly { runId: string | null }[];
};

export type HtmlDelivery = { id: string; displayRef?: string } & ({ path: string } | { pages: HtmlPresentationPage[] } | { code: string; language: "html" | "react" | "vue" });

export function htmlPresentationDelivery(item: ConversationTimelineItem): HtmlDelivery | null {
  if (item.kind !== "tool" || item.name !== "present_html" || item.status !== "completed" || item.result === null) return null;
  let value: unknown;
  try { value = JSON.parse(item.result); } catch { return null; }
  const parsed = htmlPresentationResultSchema.safeParse(value);
  if (!parsed.success) return null;
  const { presentation, displayRef } = parsed.data.value;
  const identity = { id: item.id, ...(displayRef === undefined ? {} : { displayRef }) };
  return presentation.kind === "html" ? { ...identity, path: presentation.path }
    : presentation.kind === "code" ? { ...identity, code: presentation.html, language: presentation.language }
    : { ...identity, pages: presentation.pages };
}

export function htmlPresentationDeliveries(timeline: readonly ConversationTimelineItem[], anchors: readonly DeliveryAnchor[], activeRunId: string | null): ReadonlyMap<string, HtmlDelivery[]> {
  const deliveries = new Map<string, HtmlDelivery[]>();
  const latestByPath = new Map<string, HtmlDelivery & { runId: string }>();
  for (const item of timeline) {
    if (item.kind !== "tool" || item.name !== "present_html" || item.status !== "completed" || item.result === null
      || item.runId === null || item.runId === activeRunId) continue;
    const delivery = htmlPresentationDelivery(item);
    if (delivery === null) continue;
    const key = "path" in delivery ? ["file", delivery.path] : "code" in delivery ? ["code", item.runId] : ["gallery", item.id];
    latestByPath.set(JSON.stringify(key), { ...delivery, runId: item.runId });
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
