import { z } from "zod";

import {
  conversationModelSelectionSchema,
  conversationPermissionModeSchema,
  conversationTaskSchema,
} from "./conversation.js";
import { projectIdSchema } from "./project.js";

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

export const teamWorkItemEventSchema = z.object({
  createdAt: isoTimestampSchema,
  detail: z.string().trim().min(1).max(2_000),
  id: z.string().uuid(),
  sequence: z.number().int().positive(),
  type: z.enum([
    "received",
    "planned",
    "scheduled",
    "run_started",
    "task_updated",
    "review_ready",
    "rework_requested",
    "accepted",
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
  id: workItemIdSchema,
  modelSelection: conversationModelSelectionSchema,
  permissionMode: conversationPermissionModeSchema,
  priority: teamWorkItemPrioritySchema,
  projectId: projectIdSchema,
  requirement: z.string().trim().min(1).max(50_000),
  resultSummary: z.string().trim().min(1).max(20_000).nullable(),
  revision: z.number().int().positive(),
  status: teamWorkItemStatusSchema,
  tasks: z.array(conversationTaskSchema).max(20),
  teamId: teamIdSchema,
  title: z.string().trim().min(1).max(300),
  updatedAt: isoTimestampSchema,
}).strict();

export const teamWorkItemListSchema = z.array(teamWorkItemViewSchema).max(1_000);

export const listTeamWorkItemsInputSchema = z.object({
  projectId: projectIdSchema.optional(),
  teamId: teamIdSchema.optional(),
}).strict();

export const submitTeamWorkItemInputSchema = z.object({
  acceptanceCriteria: z.array(z.string().trim().min(1).max(1_000)).max(20).default([]),
  modelSelection: conversationModelSelectionSchema.optional(),
  permissionMode: conversationPermissionModeSchema.default("ask_before_changes"),
  priority: teamWorkItemPrioritySchema.default("normal"),
  projectId: projectIdSchema,
  requirement: z.string().trim().min(1).max(50_000),
  teamId: teamIdSchema,
  title: z.string().trim().min(1).max(300),
}).strict();

export const teamWorkItemReferenceInputSchema = z.object({
  workItemId: workItemIdSchema,
}).strict();

export const acceptTeamWorkItemInputSchema = z.object({
  acceptedCriteria: z.array(z.string().trim().min(1).max(1_000)).max(20),
  workItemId: workItemIdSchema,
}).strict();

export const requestTeamWorkItemReworkInputSchema = z.object({
  feedback: z.string().trim().min(1).max(20_000),
  workItemId: workItemIdSchema,
}).strict();

export type TeamWorkItemStatus = z.infer<typeof teamWorkItemStatusSchema>;
export type TeamWorkItemPriority = z.infer<typeof teamWorkItemPrioritySchema>;
export type TeamWorkItemEvent = z.infer<typeof teamWorkItemEventSchema>;
export type TeamWorkItemView = z.infer<typeof teamWorkItemViewSchema>;
export type ListTeamWorkItemsInput = z.infer<typeof listTeamWorkItemsInputSchema>;
export type SubmitTeamWorkItemInput = z.infer<typeof submitTeamWorkItemInputSchema>;
export type TeamWorkItemReferenceInput = z.infer<typeof teamWorkItemReferenceInputSchema>;
export type AcceptTeamWorkItemInput = z.infer<typeof acceptTeamWorkItemInputSchema>;
export type RequestTeamWorkItemReworkInput = z.infer<typeof requestTeamWorkItemReworkInputSchema>;
