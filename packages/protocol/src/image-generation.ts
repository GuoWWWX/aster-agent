import { z } from "zod";
import { conversationAttachmentSchema } from "./conversation.js";

export const imageGenerationResultSchema = z.object({
  ok: z.literal(true),
  value: z.object({ images: z.array(conversationAttachmentSchema).max(10), count: z.number().int().min(1).max(10),
    requestedCount: z.number().int().min(1).max(10), modelId: z.string(), providerId: z.string(),
    readPaths: z.array(z.string()).max(10).optional(), notice: z.string().optional() }),
});
