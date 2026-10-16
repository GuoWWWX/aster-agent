import { htmlPresentationResultSchema, presentHtmlInputSchema } from "@agent/protocol";
import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { HTML_PREVIEW_MAX_BYTES, readHtmlPreviewFile } from "../preview/html-preview-file.js";
import type { ToolExecution } from "./project-tool-registry.js";

export class HtmlPresentationTool {
  public constructor(private readonly workspaceRoot: (conversationId: string) => Promise<string>) {}

  public getDefinitions(): ModelToolDefinition[] {
    return [{ name: "present_html", parameters: modelToolParameters(presentHtmlInputSchema),
      description: "Deliver HTML near the end of the task after verification. Use path for an existing workspace page, or pages for multiple named design alternatives in one paginated comparison card. Each option can be inline HTML (kind=code, html; fragments supported, no file required) or an existing file (kind=file, path). Prefer pages when the user requests multiple designs to compare or choose; do not group unrelated pages automatically. This does not write files, start a dev server, open a browser, or end the run." }];
  }

  public async execute(conversationId: string, rawArguments: string, signal: AbortSignal): Promise<ToolExecution> {
    try {
      signal.throwIfAborted();
      const input = presentHtmlInputSchema.parse(parseToolArguments(rawArguments));
      const paths = input.path !== undefined ? [input.path] : input.pages!.flatMap(page => page.kind === "file" ? [page.path] : []);
      if (paths.length > 0) {
        const root = await this.workspaceRoot(conversationId);
        for (const path of paths) {
          signal.throwIfAborted();
          await readHtmlPreviewFile(root, path);
        }
      }
      const inlineBytes = input.pages?.reduce((bytes, page) => bytes + (page.kind === "code" ? Buffer.byteLength(page.html) : 0), 0) ?? 0;
      if (inlineBytes > HTML_PREVIEW_MAX_BYTES) throw new Error("方案中的 HTML 内容合计不能超过 1 MB。");
      signal.throwIfAborted();
      const presentation = input.path !== undefined ? { kind: "html", path: input.path } : { kind: "html_gallery", pages: input.pages };
      const result = htmlPresentationResultSchema.parse({ ok: true, value: { presentation } });
      return { kind: "completed", isError: false, content: JSON.stringify(result) };
    } catch (error) {
      return { kind: "completed", isError: true, content: toolErrorContent(error, "tool:present_html") };
    }
  }
}
