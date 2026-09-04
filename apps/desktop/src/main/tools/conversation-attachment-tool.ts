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
          "View one to four conversation attachments by their attachment IDs. Image bytes are returned as visual model input; non-visual files return safe metadata for identification. Use this for historical images that were not automatically repeated in context.",
        name: "view_attachments",
        parameters: modelToolParameters(viewAttachmentsInputSchema),
      },
    ];
  }

  public getExecutionPolicy(toolName: string): ToolExecutionPolicy {
    if (toolName !== "read_attachment" && toolName !== "view_attachments") {
      throw new Error(`Unknown attachment tool: ${toolName}`);
    }
    return { group: "read", kind: "parallel" };
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
