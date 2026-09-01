import { z } from "zod";

import {
  conversationIdSchema,
  conversationAgentBindingSchema,
  conversationModelSelectionSchema,
  conversationPermissionModeSchema,
  conversationRunStatusSchema,
  conversationSummarySchema,
  conversationTaskSchema,
} from "./conversation.js";
import { projectIdSchema } from "./project.js";
import { teamInstanceIdSchema, teamInstanceNameSchema } from "./team-instance.js";

const teamIdSchema = z.string().trim().min(1).max(200);
const workItemIdSchema = z.string().uuid();
const isoTimestampSchema = z.string().datetime();

export const teamWorkItemStatusSchema = z.enum([
  "inbox",
  "triaging",
  "needs_clarification",
  "planned",
  "queued",
  "running",
  "waiting_user",
  "blocked",
  "reviewing",
  "completed",
  "failed",
  "cancelled",
]);

export const teamWorkItemPrioritySchema = z.enum(["high", "normal", "low"]);
export const teamWorkItemExecutionScopeSchema = z.enum(["project", "conversation"]);

export const teamWorkItemEventSchema = z.object({
  createdAt: isoTimestampSchema,
  detail: z.string().trim().min(1).max(2_000),
  id: z.string().uuid(),
  sequence: z.number().int().positive(),
  type: z.enum([
    "received",
    "updated",
    "planned",
    "scheduled",
    "run_started",
    "task_updated",
    "review_ready",
    "commented",
    "rework_requested",
    "accepted",
    "deleted",
    "blocked",
    "failed",
    "cancelled",
  ]),
}).strict();

export const teamWorkItemViewSchema = z.object({
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).max(20),
  acceptedCriteria: z.array(z.string().trim().min(1).max(1_000)).max(20),
  activeRunId: z.string().uuid().nullable(),
  blockedReason: z.string().trim().min(1).max(4_000).nullable(),
  completedAt: isoTimestampSchema.nullable(),
  createdAt: isoTimestampSchema,
  events: z.array(teamWorkItemEventSchema).max(200),
  executionConversationId: z.string().uuid().nullable(),
  executionScope: teamWorkItemExecutionScopeSchema,
  id: workItemIdSchema,
  instanceName: teamInstanceNameSchema.optional(),
  modelSelection: conversationModelSelectionSchema,
  participantConversationIds: z.array(conversationIdSchema).max(100).optional(),
  permissionMode: conversationPermissionModeSchema,
  priority: teamWorkItemPrioritySchema,
  projectId: projectIdSchema,
  requirement: z.string().trim().min(1).max(50_000),
  resultSummary: z.string().trim().min(1).max(20_000).nullable(),
  revision: z.number().int().positive(),
  sourceConversationId: conversationIdSchema.nullable().default(null),
  status: teamWorkItemStatusSchema,
  tasks: z.array(conversationTaskSchema).max(20),
  teamId: teamIdSchema,
  teamInstanceId: teamInstanceIdSchema.optional(),
  title: z.string().trim().min(1).max(300),
  updatedAt: isoTimestampSchema,
}).strict();

/**
 * A real participant in a WorkItem execution tree. The root is the Team Lead
 * execution conversation; every other entry is created through a persisted
 * Subagent task relationship below that root.
 */
export const teamWorkItemExecutionAgentSchema = z.object({
  agent: conversationAgentBindingSchema.nullable(),
  conversation: conversationSummarySchema,
  delegation: z.object({
    id: z.string().uuid(),
    status: conversationRunStatusSchema,
    title: z.string().trim().min(1).max(300),
  }).strict().nullable(),
  depth: z.number().int().nonnegative(),
}).strict();

export const teamWorkItemExecutionViewSchema = z.object({
  agents: z.array(teamWorkItemExecutionAgentSchema),
  workItemId: workItemIdSchema,
}).strict();

export const teamWorkItemListSchema = z.array(teamWorkItemViewSchema).max(1_000);

export const listTeamWorkItemsInputSchema = z.object({
  projectId: projectIdSchema.optional(),
  teamId: teamIdSchema.optional(),
}).strict();

export const submitTeamWorkItemInputSchema = z.object({
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
  executionScope: teamWorkItemExecutionScopeSchema.default("project"),
  instanceName: teamInstanceNameSchema.optional(),
  modelSelection: conversationModelSelectionSchema.optional(),
  permissionMode: conversationPermissionModeSchema.default("ask_before_changes"),
  priority: teamWorkItemPrioritySchema.default("normal"),
  projectId: projectIdSchema,
  requirement: z.string().trim().min(1).max(50_000),
  sourceConversationId: conversationIdSchema.optional(),
  teamId: teamIdSchema,
  teamInstanceId: teamInstanceIdSchema.optional(),
  title: z.string().trim().min(1).max(300),
}).strict().superRefine((input, context) => {
  if (input.executionScope === "conversation" && input.sourceConversationId === undefined) {
    context.addIssue({
      code: "custom",
      message: "Conversation-scoped Team work requires a source conversation.",
      path: ["sourceConversationId"],
    });
  }
});

/** A requirement edit is audited and may be delivered to an active Team Run. */
export const updateTeamWorkItemInputSchema = z.object({
  requirement: z.string().trim().min(1).max(50_000),
  title: z.string().trim().min(1).max(300),
  workItemId: workItemIdSchema,
}).strict();

/**
 * A Team WorkItem owns one permission policy for its execution tree. This is
 * separate from queued requirement edits because it may change while working.
 */
export const updateTeamWorkItemPermissionInputSchema = z.object({
  permissionMode: conversationPermissionModeSchema,
  workItemId: workItemIdSchema,
}).strict();

export const teamWorkItemReferenceInputSchema = z.object({
  workItemId: workItemIdSchema,
}).strict();

export const getTeamWorkItemExecutionInputSchema = teamWorkItemReferenceInputSchema;

export const deleteTeamWorkItemInputSchema = teamWorkItemReferenceInputSchema;

export const publishTeamWorkItemInputSchema = teamWorkItemReferenceInputSchema;

export const acceptTeamWorkItemInputSchema = z.object({
  acceptedCriteria: z.array(z.string().trim().min(1).max(1_000)).max(20),
  workItemId: workItemIdSchema,
}).strict();

export const requestTeamWorkItemReworkInputSchema = z.object({
  feedback: z.string().trim().min(1).max(20_000),
  workItemId: workItemIdSchema,
}).strict();

/**
 * A WorkItem comment is durable task context. It does not send a message to an
 * Agent or start a Run; rework remains an explicit, separate action.
 */
export const addTeamWorkItemCommentInputSchema = z.object({
  content: z.string().trim().min(1).max(2_000),
  workItemId: workItemIdSchema,
}).strict();

export type TeamWorkItemStatus = z.infer<typeof teamWorkItemStatusSchema>;
export type TeamWorkItemPriority = z.infer<typeof teamWorkItemPrioritySchema>;
export type TeamWorkItemExecutionScope = z.infer<typeof teamWorkItemExecutionScopeSchema>;
export type TeamWorkItemEvent = z.infer<typeof teamWorkItemEventSchema>;
export type TeamWorkItemView = z.infer<typeof teamWorkItemViewSchema>;
export type TeamWorkItemExecutionAgent = z.infer<typeof teamWorkItemExecutionAgentSchema>;
export type TeamWorkItemExecutionView = z.infer<typeof teamWorkItemExecutionViewSchema>;
export type ListTeamWorkItemsInput = z.infer<typeof listTeamWorkItemsInputSchema>;
export type SubmitTeamWorkItemInput = Omit<
  z.output<typeof submitTeamWorkItemInputSchema>,
  "executionScope"
> & {
  executionScope?: TeamWorkItemExecutionScope;
};
export type UpdateTeamWorkItemInput = z.infer<typeof updateTeamWorkItemInputSchema>;
export type UpdateTeamWorkItemPermissionInput = z.infer<
  typeof updateTeamWorkItemPermissionInputSchema
>;
export type TeamWorkItemReferenceInput = z.infer<typeof teamWorkItemReferenceInputSchema>;
export type GetTeamWorkItemExecutionInput = z.infer<typeof getTeamWorkItemExecutionInputSchema>;
export type DeleteTeamWorkItemInput = z.infer<typeof deleteTeamWorkItemInputSchema>;
export type PublishTeamWorkItemInput = z.infer<typeof publishTeamWorkItemInputSchema>;
export type AcceptTeamWorkItemInput = z.infer<typeof acceptTeamWorkItemInputSchema>;
export type RequestTeamWorkItemReworkInput = z.infer<typeof requestTeamWorkItemReworkInputSchema>;
export type AddTeamWorkItemCommentInput = z.infer<typeof addTeamWorkItemCommentInputSchema>;
