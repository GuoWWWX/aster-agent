import { z } from "zod";
import { conversationIdSchema, conversationMessageDeliveryModeSchema, conversationTimelinePageInputSchema } from "./conversation.js";

export const localControlCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("projects.list"), input: z.object({}).strict() }).strict(),
  z.object({ command: z.literal("conversations.list"), input: z.object({}).strict() }).strict(),
  z.object({ command: z.literal("conversations.create"), input: z.object({
    projectId: z.string().uuid().nullable().optional(),
    agentId: z.string().trim().min(1).max(200).optional(),
  }).strict() }).strict(),
  z.object({ command: z.literal("conversations.read"), input: conversationTimelinePageInputSchema }).strict(),
  z.object({ command: z.literal("messages.send"), input: z.object({
    conversationId: conversationIdSchema,
    content: z.string().trim().min(1).max(100_000),
    deliveryMode: conversationMessageDeliveryModeSchema.optional(),
  }).strict() }).strict(),
  z.object({ command: z.literal("runs.cancel"), input: z.object({ conversationId: conversationIdSchema }).strict() }).strict(),
]);

export type LocalControlCommand = z.infer<typeof localControlCommandSchema>;
