import { codeBlockReferenceSchema, htmlPresentationResultSchema, presentHtmlInputSchema, presentHtmlToolInputSchema, resolveMessageCodeBlock, type ConversationToolItem } from "@agent/protocol";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments, ToolArgumentsError } from "../model/tool-arguments.js";
import { HTML_PREVIEW_MAX_BYTES, readHtmlPreviewFile } from "../preview/html-preview-file.js";
import type { ToolExecution } from "./project-tool-registry.js";
import type { PreviewInspector } from "../preview/preview-inspector.js";

type PresentationSource = Partial<Pick<z.infer<typeof presentHtmlInputSchema>, "code" | "language" | "path" | "pages">> & { sourceRef?: string };
type SourceHistoryItem = Pick<ConversationToolItem, "name" | "status" | "arguments" | "result">
  | { id: string; role: string; status: string; content: string };
const sourceResultSchema = z.object({ ok: z.literal(true), value: z.record(z.string(), z.unknown()) }).passthrough();

/** Resolve original source from the existing conversation history, including after restart. */
export function resolveHtmlPresentationSource(history: readonly SourceHistoryItem[], reference: string): PresentationSource | null {
  if (reference === "latest" || codeBlockReferenceSchema.safeParse(reference).success) {
    const block = resolveMessageCodeBlock(history.filter(item => "role" in item), reference);
    return block === null ? null : { code: block.code, language: block.language, sourceRef: block.sourceRef };
  }
  for (const item of [...history].reverse()) {
    if (!("name" in item) || item.name !== "present_html" || item.status !== "completed" || item.result === null) continue;
    try {
      const result = sourceResultSchema.safeParse(JSON.parse(item.result));
      if (!result.success || (result.data.value.sourceRef !== reference && result.data.value.displayRef !== reference)) continue;
      const args = presentHtmlInputSchema.safeParse(JSON.parse(item.arguments));
      if (!args.success || args.data.sourceRef !== undefined) continue;
      const { code, language, path, pages } = args.data;
      return { code, language, path, pages };
    } catch { /* Ignore malformed historical tool records; never guess a replacement source. */ }
  }
  return null;
}

export class HtmlPresentationTool {
  public constructor(private readonly workspaceRoot: (conversationId: string) => Promise<string>, private readonly inspector: Pick<PreviewInspector, "inspect"> | null = null,
    private readonly readSource?: (conversationId: string, reference: string) => PresentationSource | null,
    private readonly viewport: () => { width: number; height: number } = () => ({ width: 1280, height: 800 })) {}

  public getDefinitions(allowInspection = true): ModelToolDefinition[] {
    return [{ name: "present_html", parameters: modelToolParameters(allowInspection ? presentHtmlToolInputSchema : presentHtmlToolInputSchema.safeExtend({ action: z.literal("present").default("present") })),
      description: "Inspect existing assistant code fences or workspace HTML files. Output a complete html/react/jsx/tsx/vue fence in assistant text first, alongside this tool call; use sourceRef=latest to select it, or reuse an exact returned sourceRef. Never send source code as tool arguments. "
        + (allowInspection ? "action=inspect returns screenshots and a final-answer displayRef. frames and intervalMs check animation phases in one call; optional actions check requested interactions. Omit width/height for the current application viewport. Only add other sizes or repeat checks for an explicit requirement or observed defect. " : "Only action=present is available. Have an execution member verify the result, then reference its original source/file. ")
        + "Place [Preview](EXACT_RETURNED_displayRef) alone between final-answer paragraphs; the UI displays the original code block there without repeating source. No additional present call is needed for an inspected code fence. action=present remains for existing HTML files and file comparisons. Load ui-verification for detailed visual checks." }];
  }

  public async execute(conversationId: string, rawArguments: string, signal: AbortSignal, allowInspection = true): Promise<ToolExecution> {
    try {
      signal.throwIfAborted();
      const requested = presentHtmlToolInputSchema.parse(parseToolArguments(rawArguments));
      let source: PresentationSource = {};
      if (requested.sourceRef !== undefined) {
        const resolved = this.readSource?.(conversationId, requested.sourceRef);
        if (resolved == null) throw new ToolArgumentsError("Source reference is not available in this conversation.", [{ code: "invalid_reference", path: ["sourceRef"], message: "Output a complete assistant code fence and use latest, or use an exact returned sourceRef from this conversation." }]);
        source = resolved;
      }
      const sourceRef = source.sourceRef ?? requested.sourceRef ?? `artifact:${randomUUID()}`;
      const currentViewport = this.viewport();
      const input = presentHtmlInputSchema.parse({ ...requested, ...source, sourceRef: undefined,
        width: requested.width ?? Math.max(320, Math.min(1920, Math.floor(currentViewport.width))),
        height: requested.height ?? Math.max(240, Math.min(1440, Math.floor(currentViewport.height))) });
      const codeReference = codeBlockReferenceSchema.safeParse(sourceRef).success;
      const paths = input.path !== undefined ? [input.path] : input.pages?.flatMap(page => page.kind === "file" ? [page.path] : []) ?? [];
      if (paths.length > 0) {
        const root = await this.workspaceRoot(conversationId);
        for (const path of paths) {
          signal.throwIfAborted();
          await readHtmlPreviewFile(root, path);
        }
      }
      const inlineBytes = Buffer.byteLength(input.code ?? "") + (input.pages?.reduce((bytes, page) => bytes + (page.kind === "code" ? Buffer.byteLength(page.html) : 0), 0) ?? 0);
      if (inlineBytes > HTML_PREVIEW_MAX_BYTES) throw new Error("方案中的 HTML 内容合计不能超过 1 MB。");
      signal.throwIfAborted();
      if (input.action === "inspect") {
        if (!allowInspection || this.inspector === null) throw new Error("当前会话无法直接截图检查；请由具有执行权限的 Agent 验证，不要声称已经检查页面。");
        const inspected = await this.inspector.inspect({ source: input.path !== undefined ? { kind: "file", path: input.path, conversationId }
          : { kind: "code", html: input.code!, language: input.language, conversationId }, width: input.width, height: input.height,
          frames: input.frames, intervalMs: input.intervalMs, actions: input.actions, signal });
        if (inspected.isError) return inspected;
        const result = sourceResultSchema.parse(JSON.parse(inspected.content));
        return { ...inspected, content: JSON.stringify({ ...result, value: { ...result.value, sourceRef, language: input.language,
          ...(codeReference ? { displayRef: sourceRef, note: "Inspect these screenshots before claiming correctness. Final delivery may reference displayRef to show the original assistant code block; do not resend its source or call present again." } : {}) } }) };
      }
      if (codeReference) return { kind: "completed", isError: false, content: JSON.stringify({ ok: true, value: { displayRef: sourceRef, sourceRef, language: input.language } }) };
      const presentation = input.path !== undefined ? { kind: "html", path: input.path } : input.code !== undefined
        ? { kind: "code", html: input.code, language: input.language } : { kind: "html_gallery", pages: input.pages };
      const result = htmlPresentationResultSchema.parse({ ok: true, value: { presentation, sourceRef, displayRef: `artifact:${randomUUID()}` } });
      return { kind: "completed", isError: false, content: JSON.stringify(result) };
    } catch (error) {
      if (signal.aborted) throw error;
      return { kind: "completed", isError: true, content: toolErrorContent(error, "tool:present_html") };
    }
  }
}
