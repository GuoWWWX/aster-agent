import { z } from "zod";

export const taskContextStatusSchema = z.enum(["pending", "running", "blocked", "completed", "failed", "cancelled"]);
export const taskSourceSchema = z.object({
  kind: z.enum(["conversation", "group"]),
  containerId: z.string().uuid(),
  messageId: z.string().uuid(),
  runId: z.string().uuid().nullable().default(null),
  purpose: z.enum(["request", "decision", "progress", "result", "verification"]).default("progress"),
}).strict();
export const taskContextSchema = z.object({
  id: z.string().uuid(), title: z.string().trim().min(1).max(300),
  goal: z.string().trim().min(1).max(4000), summary: z.string().max(4000),
  decisions: z.string().max(4000), nextStep: z.string().max(2000),
  status: taskContextStatusSchema, ownerConversationId: z.string().uuid(),
  projectId: z.string().uuid().nullable(), teamInstanceId: z.string().uuid().nullable(),
  workItemId: z.string().uuid().nullable(), workItemStatus: z.string().max(40).nullable().default(null), revision: z.number().int().positive(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
  mergedIntoId: z.string().uuid().nullable(),
  completionRequested: z.boolean().optional(),
  completedBy: z.enum(["user", "agent"]).nullable().optional(),
  userMessageCount: z.number().int().nonnegative().optional(),
}).strict();
export const listTaskContextsInputSchema = z.object({
  conversationId: z.string().uuid().optional(), projectId: z.string().uuid().optional(),
  teamInstanceId: z.string().uuid().optional(), query: z.string().trim().max(300).optional(),
  status: taskContextStatusSchema.optional(), beforeId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(20).default(20),
}).strict();
export const taskContextPageSchema = z.object({
  items: z.array(taskContextSchema).max(20), nextBeforeId: z.string().uuid().nullable(),
  unclassified: z.array(taskSourceSchema).max(10).default([]),
  total: z.number().int().nonnegative().optional(),
}).strict();
export const taskContextDetailSchema = z.object({
  task: taskContextSchema,
  sources: z.array(taskSourceSchema.extend({ available: z.boolean(), title: z.string(), sequence: z.number().int().positive(),
    content: z.string().nullable().optional(), role: z.enum(["user", "assistant"]).nullable().optional(), createdAt: z.string().datetime().nullable().optional() })),
  nextBeforeSourceSequence: z.number().int().positive().nullable(),
}).strict();
export const updateTaskContextInputSchema = z.object({
  id: z.string().uuid().optional(), expectedRevision: z.number().int().positive().optional(),
  conversationId: z.string().uuid(), title: z.string().trim().min(1).max(300),
  goal: z.string().trim().min(1).max(4000), summary: z.string().max(4000).default(""),
  decisions: z.string().max(4000).default(""), nextStep: z.string().max(2000).default(""),
  status: taskContextStatusSchema.default("running"), source: taskSourceSchema.optional(),
  requestId: z.string().min(1).max(200),
}).strict().refine(input => input.id === undefined || input.expectedRevision !== undefined,
  { message: "Updating a task requires expectedRevision.", path: ["expectedRevision"] });
export const taskContextReferenceSchema = z.object({ id: z.string().uuid() }).strict();
export const getTaskContextInputSchema = taskContextReferenceSchema.extend({
  beforeSourceSequence: z.number().int().positive().optional(),
  limit: z.number().int().min(1).max(50).default(20),
});
export const linkTaskContextInputSchema = z.object({
  id: z.string().uuid(), source: taskSourceSchema, remove: z.boolean().default(false),
}).strict();
export const mergeTaskContextsInputSchema = z.object({
  id: z.string().uuid(), intoId: z.string().uuid(), expectedRevision: z.number().int().positive(),
}).strict();
export type TaskContext = z.infer<typeof taskContextSchema>;
export type TaskSource = z.infer<typeof taskSourceSchema>;
export type ListTaskContextsInput = z.input<typeof listTaskContextsInputSchema>;
export type TaskContextPage = z.infer<typeof taskContextPageSchema>;
export type TaskContextDetail = z.infer<typeof taskContextDetailSchema>;
export type UpdateTaskContextInput = z.input<typeof updateTaskContextInputSchema>;
export type LinkTaskContextInput = z.input<typeof linkTaskContextInputSchema>;
export type MergeTaskContextsInput = z.infer<typeof mergeTaskContextsInputSchema>;

export const taskContextScopeSchema = z.object({
  conversationId: z.string().uuid().optional(), teamInstanceId: z.string().uuid().optional(),
}).strict().refine(input => (input.conversationId === undefined) !== (input.teamInstanceId === undefined), "Select one task scope.");
export const taskCompletionPolicySchema = z.object({ allowAgentCompletion: z.boolean() }).strict();
export const setTaskCompletionPolicyInputSchema = taskContextScopeSchema.safeExtend({ allowAgentCompletion: z.boolean() });
export const resolveChatReferencesInputSchema = taskContextScopeSchema.safeExtend({ ids: z.array(z.string().uuid()).min(1).max(20) });
export const chatReferenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("task"), id: z.string().uuid(), title: z.string(), ownerConversationId: z.string().uuid(), teamInstanceId: z.string().uuid().nullable() }).strict(),
  z.object({ kind: z.literal("message"), id: z.string().uuid(), sourceKind: z.enum(["conversation", "group"]), containerId: z.string().uuid(),
    senderName: z.string(), senderConversationId: z.string().uuid().nullable().optional(), content: z.string(), createdAt: z.string().datetime() }).strict(),
]);
export const chatReferencesSchema = z.array(chatReferenceSchema).max(20);
export type TaskContextScope = z.infer<typeof taskContextScopeSchema>;
export type TaskCompletionPolicy = z.infer<typeof taskCompletionPolicySchema>;
export type SetTaskCompletionPolicyInput = z.infer<typeof setTaskCompletionPolicyInputSchema>;
export type ResolveChatReferencesInput = z.infer<typeof resolveChatReferencesInputSchema>;
export type ChatReference = z.infer<typeof chatReferenceSchema>;
