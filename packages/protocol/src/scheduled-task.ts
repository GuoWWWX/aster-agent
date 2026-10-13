import { z } from "zod";
import { conversationPermissionModeSchema } from "./conversation.js";

const timezoneSchema = z.string().min(1).max(100).refine((value) => {
  try { new Intl.DateTimeFormat("en", { timeZone: value }); return true; } catch { return false; }
}, "Invalid timezone");
const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
export const scheduledTaskRecurrenceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("once"), at: z.iso.datetime() }).strict(),
  z.object({ kind: z.literal("daily"), time: timeSchema, timezone: timezoneSchema }).strict(),
  z.object({ kind: z.literal("weekly"), time: timeSchema, timezone: timezoneSchema,
    weekdays: z.array(z.number().int().min(0).max(6)).min(1).max(7)
      .refine((days) => new Set(days).size === days.length, "Duplicate weekday"),
  }).strict(),
]);
const configurationShape = {
  name: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(30_000),
  projectId: z.string().uuid().nullable(),
  agentId: z.string().trim().min(1).max(200).nullable(),
  permissionMode: conversationPermissionModeSchema,
  enabled: z.boolean(),
  recurrence: scheduledTaskRecurrenceSchema,
};
export const saveScheduledTaskInputSchema = z.object({ id: z.string().uuid().optional(), ...configurationShape }).strict();
export const scheduledTaskReferenceSchema = z.object({ id: z.string().uuid() }).strict();
export const scheduledTaskExecutionSchema = z.object({
  id: z.string().uuid(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime().nullable(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  conversationId: z.string().uuid().nullable(),
  runId: z.string().uuid().nullable(),
  error: z.string().max(4000).nullable(),
}).strict();
export const scheduledTaskSchema = z.object({
  id: z.string().uuid(), ...configurationShape,
  createdAt: z.iso.datetime(), updatedAt: z.iso.datetime(),
  nextRunAt: z.iso.datetime().nullable(),
  executions: z.array(scheduledTaskExecutionSchema).max(20),
}).strict();
export const scheduledTaskListSchema = z.array(scheduledTaskSchema).max(100);
export const scheduledTaskStateSchema = z.object({ version: z.literal(1), tasks: scheduledTaskListSchema }).strict();
export const saveScheduledTaskIpcArgumentsSchema = z.tuple([saveScheduledTaskInputSchema]);
export const scheduledTaskReferenceIpcArgumentsSchema = z.tuple([scheduledTaskReferenceSchema]);
export type ScheduledTaskRecurrence = z.infer<typeof scheduledTaskRecurrenceSchema>;
export type ScheduledTask = z.infer<typeof scheduledTaskSchema>;
export type ScheduledTaskExecution = z.infer<typeof scheduledTaskExecutionSchema>;
export type SaveScheduledTaskInput = z.infer<typeof saveScheduledTaskInputSchema>;
export type ScheduledTaskReference = z.infer<typeof scheduledTaskReferenceSchema>;
