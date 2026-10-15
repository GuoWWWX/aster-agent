import { htmlPresentationResultSchema, presentHtmlInputSchema } from "@agent/protocol";
import { toolErrorContent } from "../errors/tool-error.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { readHtmlPreviewFile } from "../preview/html-preview-file.js";
import type { ToolExecution } from "./project-tool-registry.js";

export class HtmlPresentationTool {
  public constructor(private readonly workspaceRoot: (conversationId: string) => Promise<string>) {}

  public getDefinitions(): ModelToolDefinition[] {
    return [{ name: "present_html", parameters: modelToolParameters(presentHtmlInputSchema),
      description: "Present an existing workspace HTML page to the user as a final delivery, with interactive preview and source tabs. Call this after creating and verifying the page, near the end of the task. Ordinary HTML project edits only need file changes; do not call unless the user wants to see the page in the conversation. This does not write files, start a dev server, or open a browser tab." }];
  }

  public async execute(conversationId: string, rawArguments: string, signal: AbortSignal): Promise<ToolExecution> {
    try {
      signal.throwIfAborted();
      const input = presentHtmlInputSchema.parse(parseToolArguments(rawArguments));
      await readHtmlPreviewFile(await this.workspaceRoot(conversationId), input.path);
      signal.throwIfAborted();
      const result = htmlPresentationResultSchema.parse({ ok: true, value: { presentation: { kind: "html", path: input.path } } });
      return { kind: "completed", isError: false, content: JSON.stringify(result) };
    } catch (error) {
      return { kind: "completed", isError: true, content: toolErrorContent(error, "tool:present_html") };
    }
  }
}
