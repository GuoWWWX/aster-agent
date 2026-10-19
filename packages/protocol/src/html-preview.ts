import { z } from "zod";
import { relativeProjectPathSchema } from "./project.js";
export const codePreviewLanguageSchema = z.enum(["html", "react", "vue"]);
export type CodePreviewLanguage = z.infer<typeof codePreviewLanguageSchema>;

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
const previewActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("click"), x: z.number().int().nonnegative(), y: z.number().int().nonnegative() }).strict(),
  z.object({ action: z.literal("key"), key: z.enum(["Tab", "Enter", "Space", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Escape", "Home", "End"]) }).strict(),
]);
export const presentHtmlInputSchema = z.object({
  action: z.enum(["present", "inspect"]).default("present").describe("present delivers the final result; inspect returns rendered screenshot evidence without delivering it."),
  code: z.string().min(1).max(1_000_000).optional().describe("Self-contained HTML, a React default-exported component/JSX expression, or a Vue SFC."),
  language: codePreviewLanguageSchema.default("html"),
  width: z.number().int().min(320).max(1920).default(1280),
  height: z.number().int().min(240).max(1440).default(800),
  frames: z.number().int().min(1).max(3).default(1).describe("For inspect, capture up to three phases of the same page; use more than one for animation."),
  intervalMs: z.number().int().min(100).max(2000).default(500).describe("Delay between inspection frames; no extra browser setup is needed."),
  actions: z.array(previewActionSchema).max(12).default([]).describe("For inspect, replay optional click(x,y) or key(key) actions on a fresh page before capturing. Coordinates must come from a same-size screenshot; Tab/Enter can check buttons without guessing."),
  path: presentationPathSchema.optional(),
  pages: presentationPagesSchema.optional().describe("Related alternatives for the user to compare and choose, presented in one paginated card. Use instead of path only when multiple options are requested."),
}).strict().refine(input => [input.path, input.pages, input.code].filter(value => value !== undefined).length === 1, "Provide exactly one of path, pages or code.")
  .refine(input => input.action !== "inspect" || input.pages === undefined, "Inspect one source at a time using code or path.")
  .refine(input => input.actions.length === 0 || input.action === "inspect", "Only inspect accepts actions.")
  .refine(input => input.actions.every(action => action.action !== "click" || (action.x < input.width && action.y < input.height)), "Click coordinates must be inside the inspection viewport.");
export const htmlPresentationResultSchema = z.object({
  ok: z.literal(true),
  value: z.object({ presentation: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("html"), path: presentationPathSchema }).strict(),
    z.object({ kind: z.literal("code"), html: z.string().min(1).max(1_000_000), language: codePreviewLanguageSchema }).strict(),
    z.object({ kind: z.literal("html_gallery"), pages: presentationPagesSchema }).strict(),
  ]) }).strict(),
}).strict();
export type HtmlPresentationPage = z.infer<typeof htmlPresentationPageSchema>;

const owner = { conversationId: z.string().uuid() };
export const htmlPreviewRequestSchema = z.discriminatedUnion("kind", [
  z.object({ ...owner, kind: z.literal("file"), path: z.string().trim().min(1).max(4096) }).strict(),
  z.object({ ...owner, kind: z.literal("code"), html: z.string().min(1).max(1_000_000), language: codePreviewLanguageSchema.optional() }).strict(),
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
