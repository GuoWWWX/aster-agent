import { z } from "zod";

import type { ModelToolDefinition } from "../model/model-contracts.js";
import type { ModelMessageAttachment } from "../model/model-contracts.js";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { toolErrorContent } from "../errors/tool-error.js";
import type { ToolExecutionPolicy } from "./tool-execution-policy.js";

const readAttachmentInputSchema = z
  .object({
    attachment_id: z.string().uuid().describe("Attachment UUID shown in the attachment context."),
    limit: z.number().int().min(1).max(50_000).default(20_000)
      .describe("Maximum number of extracted-text characters to return."),
    offset: z.number().int().nonnegative().default(0)
      .describe("Zero-based character offset in the full extracted text.")
  })
  .strict();

const viewAttachmentsInputSchema = z
  .object({
    attachment_ids: z.array(z.string().uuid()).min(1).max(4)
      .describe("One to four attachment UUIDs shown in attachment context."),
  })
  .strict();

const viewImagesInputSchema = z.object({
  paths: z.array(z.string().min(1).max(4096)).min(1).max(4)
    .describe("One to four image paths. Copy attachments/... paths from image context for uploaded/pasted images. Other paths are workspace-relative; use ./attachments/... for the workspace's own attachments directory. Never pass attachment IDs or guess a stored filename."),
}).strict();

type ConversationAttachmentToolResult = {
  content: string;
  isError: boolean;
  modelAttachments?: ModelMessageAttachment[];
};

export class ConversationAttachmentTool {
  public constructor(private readonly attachments: ConversationAttachmentStore) {}

  public getDefinitions(): ModelToolDefinition[] {
    return [
      {
        description:
          "Read a character range from the full extracted text of a conversation attachment. Use this when an attachment preview says that its middle content was omitted.",
        name: "read_attachment",
        parameters: modelToolParameters(readAttachmentInputSchema),
      },
      {
        description:
          "View one to four images by path, mixing workspace images and uploaded/pasted conversation images. Returns visual model input and a row of clickable thumbnails. Use this directly to inspect, describe or show images; do not start an HTTP server or open a browser for local images.",
        name: "view_attachments",
        parameters: modelToolParameters(viewImagesInputSchema),
      },
    ];
  }

  public getExecutionPolicy(toolName: string): ToolExecutionPolicy {
    if (toolName !== "read_attachment" && toolName !== "view_attachments") {
      throw new Error(`Unknown attachment tool: ${toolName}`);
    }
    return { group: "read", kind: "parallel" };
  }

  public async viewImages(conversationId: string, rawArguments: string,
    readProjectImage: (imagePath: string) => Promise<ConversationAttachmentToolResult>,
    signal: AbortSignal): Promise<ConversationAttachmentToolResult> {
    try {
      const { paths } = viewImagesInputSchema.parse(parseToolArguments(rawArguments));
      const items: unknown[] = [];
      const modelAttachments: ModelMessageAttachment[] = [];
      for (const imagePath of paths) {
        signal.throwIfAborted();
        if (imagePath.startsWith("attachments/")) {
          const result = this.attachments.viewImagePath(conversationId, imagePath);
          items.push({ attachment: result.attachments[0] });
          modelAttachments.push(...result.modelAttachments);
        } else {
          const result = await readProjectImage(imagePath);
          if (result.isError) return result;
          const parsed = z.object({ ok: z.literal(true), value: z.object({ image: z.object({
            projectId: z.string().uuid(), path: z.string(), mimeType: z.string(),
          }) }) }).parse(JSON.parse(result.content));
          items.push({ image: parsed.value.image });
          modelAttachments.push(...(result.modelAttachments ?? []));
        }
      }
      signal.throwIfAborted();
      return { content: JSON.stringify({ ok: true, value: { items } }), isError: false, modelAttachments };
    } catch (error) {
      return { content: toolErrorContent(error, "tool:view_attachments"), isError: true };
    }
  }

  public execute(
    toolName: string,
    conversationId: string,
    rawArguments: string,
  ): ConversationAttachmentToolResult {
    try {
      if (toolName === "view_attachments") {
        const input = viewAttachmentsInputSchema.parse(parseToolArguments(rawArguments));
        const viewed = this.attachments.viewAttachments(conversationId, input.attachment_ids);
        return {
          content: JSON.stringify({ ok: true, value: { attachments: viewed.attachments } }),
          isError: false,
          ...(viewed.modelAttachments.length === 0
            ? {}
            : { modelAttachments: viewed.modelAttachments }),
        };
      }
      if (toolName !== "read_attachment") {
        throw new Error(`Unknown attachment tool: ${toolName}`);
      }
      const input = readAttachmentInputSchema.parse(parseToolArguments(rawArguments));
      return {
        content: JSON.stringify({
          ok: true,
          value: this.attachments.readText(
            conversationId,
            input.attachment_id,
            input.offset,
            input.limit
          )
        }),
        isError: false
      };
    } catch (error) {
      return {
        content: toolErrorContent(error, "tool:read_attachment"),
        isError: true
      };
    }
  }
}

export function isConversationAttachmentToolName(name: string): boolean {
  return name === "read_attachment" || name === "view_attachments";
}
