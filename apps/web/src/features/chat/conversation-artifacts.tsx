import type { ReactNode } from "react";
import { imageGenerationResultSchema, type ConversationTimelineItem } from "@agent/protocol";
import type { AgentClient } from "../../runtime/index.js";
import { HtmlPreviewCard } from "../../components/html-preview/html-preview-card.js";
import { HtmlPreviewGallery } from "../../components/html-preview/html-preview-gallery.js";
import { GeneratedImagesResult } from "./generated-images-result.js";
import { htmlPresentationDelivery, type HtmlDelivery } from "./html-presentations.js";

export function HtmlDeliveryPreview({ delivery, cacheTtlMs, onResize }: { delivery: HtmlDelivery; cacheTtlMs: number; onResize: () => void }) {
  return <div data-html-delivery={delivery.id}>
    {"pages" in delivery ? <HtmlPreviewGallery pages={delivery.pages} cacheTtlMs={cacheTtlMs} onResize={onResize} />
      : "code" in delivery ? <HtmlPreviewCard source={{ kind: "code", html: delivery.code, language: delivery.language }} />
      : <HtmlPreviewCard source={{ kind: "file", path: delivery.path }} />}
  </div>;
}

/** Markdown can only select existing outputs; it never supplies a file path or source code. */
export function conversationArtifacts(timeline: readonly ConversationTimelineItem[], agentClient: AgentClient,
  options: { cacheTtlMs: number; onResize: () => void }): ReadonlyMap<string, { toolId: string; content: ReactNode }> {
  const artifacts = new Map<string, { toolId: string; content: ReactNode }>();
  for (const item of timeline) {
    const html = htmlPresentationDelivery(item);
    if (html?.displayRef !== undefined) artifacts.set(html.displayRef, { toolId: item.id, content: <HtmlDeliveryPreview delivery={html} {...options} /> });
    if (item.kind !== "tool" || item.name !== "generate_images" || item.result === null) continue;
    let value: unknown;
    try { value = JSON.parse(item.result); } catch { continue; }
    const images = imageGenerationResultSchema.safeParse(value);
    if (!images.success || images.data.value.displayRef === undefined || images.data.value.images.length === 0
      || images.data.value.images.some(image => image.conversationId !== item.conversationId || image.messageId !== item.id)) continue;
    artifacts.set(images.data.value.displayRef, { toolId: item.id, content: <GeneratedImagesResult agentClient={agentClient} item={item} /> });
  }
  return artifacts;
}
