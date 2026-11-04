import { useMemo, type ReactNode } from "react";
import MarkdownIt from "markdown-it";
import { conversationAttachmentSchema, type ConversationAttachment, type ConversationTimelineItem } from "@agent/protocol";
import { MediaPreviewScope, type MediaPreviewImage } from "../../components/media/media-preview-request.js";
import type { AgentClient } from "../../runtime/index.js";

export function imageDisplayName(image: Pick<ConversationAttachment, "name" | "projectPath" | "source">): string {
  if (image.projectPath !== null) return image.projectPath;
  if (!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(image.name)) return image.name;
  return image.source === "generated" ? "生成图片" : image.source === "browser" ? "网页截图"
    : image.source === "computer" ? "桌面截图" : "图片附件";
}

function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
const markdown = new MarkdownIt({ html: false });

export function conversationPreviewImages(items: readonly ConversationTimelineItem[], conversationId: string, client: AgentClient,
  rootPath?: string | null): MediaPreviewImage[] {
  const images = new Map<string, MediaPreviewImage>();
  const attachment = (value: unknown) => {
    const parsed = conversationAttachmentSchema.safeParse(value);
    if (!parsed.success || parsed.data.kind !== "image" || parsed.data.conversationId !== conversationId) return;
    const image = parsed.data, name = imageDisplayName(image);
    const label = image.projectPath !== null && rootPath && !/^(?:[a-z]:[\\/]|\/)/iu.test(name)
      ? `${rootPath.replace(/[\\/]$/u, "")}/${name}` : name;
    images.set(image.id, { key: image.id, label, load: async () => {
      const preview = await client.readConversationAttachmentPreview({ conversationId, attachmentId: image.id });
      return `data:${preview.mimeType};base64,${preview.data}`;
    } });
  };
  const projectImage = (value: unknown) => {
    if (!record(value) || typeof value.projectId !== "string" || typeof value.path !== "string") return;
    const projectId = value.projectId, path = value.path;
    const key = `project:${projectId}:${path}`;
    images.set(key, { key, label: rootPath && !/^(?:[a-z]:[\\/]|\/)/iu.test(path)
      ? `${rootPath.replace(/[\\/]$/u, "")}/${path}` : path, load: async () => {
      const result = await client.readProjectPreviewImage({ projectId, sourcePath: path, path: path.split(/[\\/]/u).at(-1) ?? path });
      return `data:${result.mimeType};base64,${result.data}`;
    } });
  };
  for (const item of items) {
    if (item.conversationId !== conversationId) continue;
    if (item.kind === "message") {
      item.attachments.forEach(attachment);
      if (item.content.includes("![")) for (const block of markdown.parse(item.content, {})) for (const token of block.children ?? []) {
        const attribute = token.type === "image" ? token.attrGet("src") : null;
        const src = typeof attribute === "string" ? attribute : null;
        if (src) images.set(src, { key: src, label: token.content || "对话图片", load: () => Promise.resolve(src) });
      }
    } else if (item.kind === "tool" && item.result !== null) {
      let result: unknown;
      try { result = JSON.parse(item.result); } catch { continue; }
      if (!record(result) || result.ok !== true || !record(result.value)) continue;
      const value = result.value;
      for (const field of ["images", "attachments"] as const) if (Array.isArray(value[field])) for (const image of value[field]) attachment(image);
      if (record(value.image)) { attachment(value.image); projectImage(value.image); }
      if (Array.isArray(value.items)) for (const entry of value.items) if (record(entry)) {
        attachment(entry.attachment); projectImage(entry.image);
      }
    }
  }
  return [...images.values()];
}

export function ConversationImagePreviewScope({ client, conversationId, timeline, rootPath, children }: {
  client: AgentClient; conversationId: string; timeline: readonly ConversationTimelineItem[]; rootPath?: string | null; children: ReactNode;
}) {
  const gallery = useMemo(() => ({ images: conversationPreviewImages(timeline, conversationId, client, rootPath),
    loadImages: async (signal?: AbortSignal) => {
      let beforeSequence: number | undefined;
      const pages: MediaPreviewImage[][] = [];
      for (;;) {
        signal?.throwIfAborted();
        const page = await client.listConversationTimelinePage({ conversationId, limit: 200, ...(beforeSequence === undefined ? {} : { beforeSequence }) });
        pages.unshift(conversationPreviewImages(page.items, conversationId, client, rootPath));
        if (!page.hasMore || page.nextBeforeSequence === null || page.nextBeforeSequence === beforeSequence) break;
        beforeSequence = page.nextBeforeSequence;
      }
      const all = new Map(pages.flat().map(image => [image.key, image]));
      for (const image of conversationPreviewImages(timeline, conversationId, client, rootPath)) all.set(image.key, image);
      return [...all.values()];
    },
  }), [client, conversationId, timeline, rootPath]);
  return <MediaPreviewScope gallery={gallery}>{children}</MediaPreviewScope>;
}
