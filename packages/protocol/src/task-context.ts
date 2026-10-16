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
}).strict();
export const taskContextDetailSchema = z.object({
  task: taskContextSchema,
  sources: z.array(taskSourceSchema.extend({ available: z.boolean(), title: z.string(), sequence: z.number().int().positive() })),
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
