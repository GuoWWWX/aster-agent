import { htmlPresentationResultSchema, presentHtmlInputSchema } from "@agent/protocol";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { HTML_PREVIEW_MAX_BYTES, readHtmlPreviewFile } from "../preview/html-preview-file.js";
import type { ToolExecution } from "./project-tool-registry.js";
import type { PreviewInspector } from "../preview/preview-inspector.js";

export class HtmlPresentationTool {
  public constructor(private readonly workspaceRoot: (conversationId: string) => Promise<string>, private readonly inspector: Pick<PreviewInspector, "inspect"> | null = null) {}

  public getDefinitions(allowInspection = true): ModelToolDefinition[] {
    return [{ name: "present_html", parameters: modelToolParameters(allowInspection ? presentHtmlInputSchema : presentHtmlInputSchema.safeExtend({ action: z.literal("present").default("present") })),
      description: "Preview or deliver self-contained UI. Use code with language=html/react/vue, an existing HTML path, or pages for requested alternatives. "
        + (allowInspection ? "action=inspect returns screenshot evidence; frames>1 checks animation phases. Optional actions replay click(x,y)/key(key) before capture; Tab/Enter checks keyboard buttons. Each inspection starts fresh and closes the page; do not reopen its temporary URL. Then use action=present (default) for final delivery. " : "Only action=present is available. Have an execution member verify the result, then deliver its original source/file. ")
        + "Place [Preview](EXACT_RETURNED_displayRef) alone in a final-answer paragraph to display the delivered UI there; never inside a sentence or code fence. Do not repeat the source. React/Vue imports are bundled locally; arbitrary packages need a real project. No files, visible browser or ad hoc server are created. Load ui-verification for detailed checks." }];
  }

  public async execute(conversationId: string, rawArguments: string, signal: AbortSignal, allowInspection = true): Promise<ToolExecution> {
    try {
      signal.throwIfAborted();
      const input = presentHtmlInputSchema.parse(parseToolArguments(rawArguments));
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
        return await this.inspector.inspect({ source: input.path !== undefined ? { kind: "file", path: input.path, conversationId }
          : { kind: "code", html: input.code!, language: input.language, conversationId }, width: input.width, height: input.height,
          frames: input.frames, intervalMs: input.intervalMs, actions: input.actions, signal });
      }
      const presentation = input.path !== undefined ? { kind: "html", path: input.path } : input.code !== undefined
        ? { kind: "code", html: input.code, language: input.language } : { kind: "html_gallery", pages: input.pages };
      const result = htmlPresentationResultSchema.parse({ ok: true, value: { presentation, displayRef: `artifact:${randomUUID()}` } });
      return { kind: "completed", isError: false, content: JSON.stringify(result) };
    } catch (error) {
      if (signal.aborted) throw error;
      return { kind: "completed", isError: true, content: toolErrorContent(error, "tool:present_html") };
    }
  }
}
