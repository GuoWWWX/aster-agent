import { z } from "zod";

export const postTeamChatInputSchema = z.object({
  teamInstanceId: z.string().uuid(), content: z.string().trim().min(1).max(16000),
  intent: z.enum(["notify", "request"]).default("request"),
  recipientConversationIds: z.array(z.string().uuid()).max(32).default([]),
  allMembers: z.boolean().default(false),
  taskContextId: z.string().uuid().nullable().default(null),
  replyToId: z.string().uuid().nullable().default(null),
  requestId: z.string().min(1).max(200),
}).strict().refine(input => new Set(input.recipientConversationIds).size === input.recipientConversationIds.length,
  { message: "Recipients must be unique.", path: ["recipientConversationIds"] });
export const teamChatDeliverySchema = z.object({
  id: z.string().uuid(), conversationId: z.string().uuid(),
  status: z.enum(["pending", "delivered", "consumed", "completed", "failed", "cancelled"]),
  runId: z.string().uuid().nullable(), error: z.string().nullable(),
});
export const teamChatMessageSchema = z.object({
  id: z.string().uuid(), teamInstanceId: z.string().uuid(), sequence: z.number().int().positive(),
  content: z.string(), senderConversationId: z.string().uuid().nullable(), senderName: z.string(),
  intent: z.enum(["notify", "request"]), recipientConversationIds: z.array(z.string().uuid()),
  taskContextId: z.string().uuid().nullable(), replyToId: z.string().uuid().nullable(),
  createdAt: z.string().datetime(), rootMessageId: z.string().uuid(), depth: z.number().int().nonnegative(),
  sourceRunId: z.string().uuid().nullable(), deliveries: z.array(teamChatDeliverySchema),
}).strict();
export const readTeamChatInputSchema = z.object({
  teamInstanceId: z.string().uuid(), beforeSequence: z.number().int().positive().optional(),
  afterSequence: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(50).default(30),
}).strict();
export const teamChatPageSchema = z.object({
  messages: z.array(teamChatMessageSchema).max(50), nextBeforeSequence: z.number().int().positive().nullable(),
  userReadSequence: z.number().int().nonnegative(), memberReadSequence: z.number().int().nonnegative(),
}).strict();
export const markTeamChatReadInputSchema = z.object({
  teamInstanceId: z.string().uuid(), throughSequence: z.number().int().nonnegative(),
}).strict();
export const teamChatMemberSchema = z.object({
  conversationId: z.string().uuid(), name: z.string(), role: z.string(), isLead: z.boolean(), isArchived: z.boolean(),
});
export type PostTeamChatInput = z.input<typeof postTeamChatInputSchema>;
export type ReadTeamChatInput = z.input<typeof readTeamChatInputSchema>;
export type TeamChatMessage = z.infer<typeof teamChatMessageSchema>;
export type TeamChatPage = z.infer<typeof teamChatPageSchema>;
export type TeamChatMember = z.infer<typeof teamChatMemberSchema>;
export type MarkTeamChatReadInput = z.infer<typeof markTeamChatReadInputSchema>;
