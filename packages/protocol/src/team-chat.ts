import { z } from "zod";
import { conversationModelSelectionSchema } from "./conversation.js";

export const teamChatCoordinatorSchema = z.object({
  agentId: z.string().min(1).max(200),
  modelSelection: conversationModelSelectionSchema.nullable().default(null),
}).strict();
export const teamChatCoordinationConversationInputSchema = z.object({
  teamInstanceId: z.string().uuid(), agentId: z.string().min(1).max(200).optional(),
}).strict();
export type TeamChatCoordinationConversationInput = z.infer<typeof teamChatCoordinationConversationInputSchema>;
export const teamChatCoordinationStepSchema = z.object({
  type: z.enum(["started", "model_requested", "retry_scheduled", "completed", "failed", "cancelled", "paused"]),
  at: z.string().datetime(), attempt: z.number().int().positive().max(100).optional(),
  modelId: z.string().min(1).max(200).optional(), detail: z.string().max(2000).optional(),
  recipientConversationIds: z.array(z.string().uuid()).max(32).optional(),
}).strict();
const teamChatCoordinationSchema = teamChatCoordinatorSchema.extend({
  status: z.enum(["pending", "completed", "failed", "cancelled", "paused"]), error: z.string().nullable(),
  contextSummary: z.string().max(2000).optional(),
  conversationId: z.string().uuid().optional(), runId: z.string().uuid().optional(), userMessageId: z.string().uuid().optional(), pendingMessageId: z.string().uuid().optional(),
  steps: z.array(teamChatCoordinationStepSchema).max(64).optional(),
});

export const postTeamChatInputSchema = z.object({
  teamInstanceId: z.string().uuid(), content: z.string().trim().min(1).max(16000),
  intent: z.enum(["notify", "request"]).default("request"),
  recipientConversationIds: z.array(z.string().uuid()).max(32).default([]),
  allMembers: z.boolean().default(false),
  taskContextId: z.string().uuid().nullable().default(null),
  replyToId: z.string().uuid().nullable().default(null),
  requestId: z.string().min(1).max(200),
  coordinator: teamChatCoordinatorSchema.optional(),
  supersedesId: z.string().uuid().nullable().default(null),
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
  coordinator: teamChatCoordinationSchema.nullable().optional(),
  supersedesId: z.string().uuid().nullable().optional(),
}).strict();
export const readTeamChatInputSchema = z.object({
  teamInstanceId: z.string().uuid(), beforeSequence: z.number().int().positive().optional(),
  afterSequence: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(50).default(30),
}).strict();
export const teamChatPageSchema = z.object({
  messages: z.array(teamChatMessageSchema).max(50), nextBeforeSequence: z.number().int().positive().nullable(),
  userReadSequence: z.number().int().nonnegative(), memberReadSequence: z.number().int().nonnegative(),
  coordinator: teamChatCoordinatorSchema.nullable().optional(),
  activity: z.object({
    status: z.enum(["idle", "coordinating", "working", "paused", "failed"]),
    activeMemberCount: z.number().int().nonnegative(), pendingDeliveryCount: z.number().int().nonnegative(),
  }).strict().optional(),
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
export type TeamChatActivity = NonNullable<TeamChatPage["activity"]>;
export type TeamChatMember = z.infer<typeof teamChatMemberSchema>;
export type TeamChatCoordinationStep = z.infer<typeof teamChatCoordinationStepSchema>;
export type MarkTeamChatReadInput = z.infer<typeof markTeamChatReadInputSchema>;
