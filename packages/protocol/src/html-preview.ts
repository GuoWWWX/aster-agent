import { z } from "zod";

const owner = { conversationId: z.string().uuid() };
export const htmlPreviewRequestSchema = z.discriminatedUnion("kind", [
  z.object({ ...owner, kind: z.literal("file"), path: z.string().trim().min(1).max(4096) }).strict(),
  z.object({ ...owner, kind: z.literal("code"), html: z.string().min(1).max(1_000_000) }).strict(),
  z.object({ ...owner, kind: z.literal("release"), id: z.string().uuid() }).strict(),
  z.object({ ...owner, kind: z.literal("browser"), id: z.string().uuid() }).strict(),
]);
export const htmlPreviewSchema = z.object({
  id: z.string().uuid(),
  title: z.string().min(1).max(4096),
  url: z.string().url().refine(value => { const url = new URL(value); return url.protocol === "http:" && url.hostname === "127.0.0.1" && !url.username && !url.password; }),
  source: z.string().max(1_000_000),
}).strict();
export const htmlPreviewResponseSchema = htmlPreviewSchema.nullable();
export const HTML_PREVIEW_MAX_HEIGHT = 20_000;
export const htmlPreviewResizeMessageSchema = z.object({
  type: z.literal("html-preview.resize"),
  id: z.string().uuid(),
  height: z.number().int().min(1).max(HTML_PREVIEW_MAX_HEIGHT),
}).strict();
export type HtmlPreviewRequest = z.infer<typeof htmlPreviewRequestSchema>;
export type HtmlPreview = z.infer<typeof htmlPreviewSchema>;
