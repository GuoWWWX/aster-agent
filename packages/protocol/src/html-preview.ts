import { z } from "zod";
import { relativeProjectPathSchema } from "./project.js";

const presentationPathSchema = relativeProjectPathSchema.min(1).max(4096)
    .refine(value => /\.html?$/iu.test(value) && !/[:?#\r\n]/u.test(value), "Use a workspace-relative HTML file path.")
    .describe("Existing HTML entry file relative to the current conversation workspace.");
const pageTitle = z.string().trim().min(1).max(100).describe("Short, distinctive option name shown in the page selector.");
export const htmlPresentationPageSchema = z.discriminatedUnion("kind", [
  z.object({ title: pageTitle, kind: z.literal("file"), path: presentationPathSchema }).strict(),
  z.object({ title: pageTitle, kind: z.literal("code"), html: z.string().min(1).max(1_000_000).describe("Self-contained HTML, including fragments; no file is required.") }).strict(),
]);
const presentationPagesSchema = z.array(htmlPresentationPageSchema).min(2).max(12)
  .refine(pages => pages.reduce((length, page) => length + (page.kind === "code" ? page.html.length : 0), 0) <= 1_000_000,
    "Combined inline HTML cannot exceed 1,000,000 characters.");
export const presentHtmlInputSchema = z.object({
  path: presentationPathSchema.optional(),
  pages: presentationPagesSchema.optional().describe("Related alternatives for the user to compare and choose, presented in one paginated card. Use instead of path only when multiple options are requested."),
}).strict().refine(input => (input.path !== undefined) !== (input.pages !== undefined), "Provide exactly one of path or pages.");
export const htmlPresentationResultSchema = z.object({
  ok: z.literal(true),
  value: z.object({ presentation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("html"), path: presentationPathSchema }).strict(),
    z.object({ kind: z.literal("html_gallery"), pages: presentationPagesSchema }).strict(),
  ]) }).strict(),
}).strict();
export type HtmlPresentationPage = z.infer<typeof htmlPresentationPageSchema>;

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
