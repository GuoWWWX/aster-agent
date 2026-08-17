import { z } from "zod";

import type { ModelToolDefinition } from "../model/openai-compatible-adapter.js";
import { parseToolArguments } from "../model/tool-arguments.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { toolErrorContent } from "../errors/tool-error.js";

const readAttachmentInputSchema = z
  .object({
    attachment_id: z.string().uuid(),
    limit: z.number().int().min(1).max(50_000).default(20_000),
    offset: z.number().int().nonnegative().default(0)
  })
  .strict();

export class ConversationAttachmentTool {
  public constructor(private readonly attachments: ConversationAttachmentStore) {}

  public getDefinitions(): ModelToolDefinition[] {
    return [{
      description:
        "Read a character range from the full extracted text of a conversation attachment. Use this when an attachment preview says that its middle content was omitted.",
      name: "read_attachment",
      parameters: {
        additionalProperties: false,
        properties: {
          attachment_id: {
            description: "Attachment UUID shown in the attachment context.",
            format: "uuid",
            type: "string"
          },
          limit: {
            default: 20_000,
            maximum: 50_000,
            minimum: 1,
            type: "integer"
          },
          offset: {
            default: 0,
            minimum: 0,
            type: "integer"
          }
        },
        required: ["attachment_id"],
        type: "object"
      }
    }];
  }

  public execute(
    conversationId: string,
    rawArguments: string
  ): { content: string; isError: boolean } {
    try {
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
  return name === "read_attachment";
}
