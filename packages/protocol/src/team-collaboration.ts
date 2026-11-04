import { z } from "zod";

import { agentAvatarIconSchema } from "./agent-avatar.js";
import { conversationIdSchema, runIdSchema } from "./conversation.js";

const workItemIdSchema = z.string().uuid();
const isoTimestampSchema = z.string().datetime();
export const MAX_TEAM_COLLABORATION_OUTPUT_LENGTH = 280;

export const teamCollaborationPlanStatusSchema = z.enum(["active", "superseded"]);
export const teamCollaborationNodeKindSchema = z.enum([
  "team_lead",
  "standing",
  "ephemeral",
  "placeholder",
]);
export const teamCollaborationNodeRunStatusSchema = z.enum([
  "idle",
  "queued",
  "running",
  "completed",
  "failed",
  "blocked",
]);
export const teamCollaborationEdgeStateSchema = z.enum([
  "planned",
  "observed",
  "ad_hoc",
  "skipped",
]);

export const teamCollaborationPlanViewSchema = z.object({
  activatedAt: isoTimestampSchema,
  createdAt: isoTimestampSchema,
  id: z.string().uuid(),
  reason: z.string().trim().min(1).max(2_000),
  revision: z.number().int().positive(),
  status: teamCollaborationPlanStatusSchema,
}).strict();

export const teamCollaborationNodeViewSchema = z.object({
  agentId: z.string().trim().min(1).max(200).nullable(),
  avatarIcon: agentAvatarIconSchema.nullable(),
  conversationId: conversationIdSchema.nullable(),
  id: z.string().trim().min(1).max(300),
  kind: teamCollaborationNodeKindSchema,
  latestOutput: z.string().max(MAX_TEAM_COLLABORATION_OUTPUT_LENGTH).nullable(),
  latestOutputRunId: runIdSchema.nullable(),
  name: z.string().trim().min(1).max(300),
  position: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
  }).strict(),
  role: z.string().trim().min(1).max(300),
  runStatus: teamCollaborationNodeRunStatusSchema,
  taskIds: z.array(z.string().trim().min(1).max(300)).max(100),
}).strict();

const messageTypeCountsSchema = z.object({
  agent_result: z.number().int().nonnegative(),
  message: z.number().int().nonnegative(),
  notification: z.number().int().nonnegative(),
  task_result: z.number().int().nonnegative(),
}).strict();

export const teamCollaborationEdgeViewSchema = z.object({
  firstActivityAt: isoTimestampSchema.nullable(),
  fromNodeId: z.string().trim().min(1).max(300),
  id: z.string().trim().min(1).max(700),
  lastActivityAt: isoTimestampSchema.nullable(),
  messageCount: z.number().int().nonnegative(),
  messageTypes: messageTypeCountsSchema,
  purposes: z.array(z.string().trim().min(1).max(500)).max(20),
  state: teamCollaborationEdgeStateSchema,
  toNodeId: z.string().trim().min(1).max(300),
  unreadCount: z.number().int().nonnegative(),
}).strict();

export const teamCollaborationProjectionSchema = z.object({
  edges: z.array(teamCollaborationEdgeViewSchema).max(200),
  isLive: z.boolean(),
  nodes: z.array(teamCollaborationNodeViewSchema).max(100),
  plan: teamCollaborationPlanViewSchema.nullable(),
  summary: z.object({
    adHocRouteCount: z.number().int().nonnegative(),
    lastActivityAt: isoTimestampSchema.nullable(),
    messageCount: z.number().int().nonnegative(),
    observedRouteCount: z.number().int().nonnegative(),
    participantCount: z.number().int().nonnegative(),
    plannedRouteCount: z.number().int().nonnegative(),
  }).strict(),
  workItemId: workItemIdSchema,
}).strict();

export const getTeamCollaborationProjectionInputSchema = z.object({
  workItemId: workItemIdSchema,
}).strict();

export const teamCollaborationPlanRouteInputSchema = z.object({
  fromConversationId: conversationIdSchema,
  purpose: z.string().trim().min(1).max(500),
  toConversationId: conversationIdSchema,
}).strict().refine(
  (route) => route.fromConversationId !== route.toConversationId,
  { message: "A collaboration route must connect two different conversations." },
);

export const setTeamCollaborationPlanInputSchema = z.object({
  createdByConversationId: conversationIdSchema,
  reason: z.string().trim().min(1).max(2_000),
  routes: z.array(teamCollaborationPlanRouteInputSchema).min(1).max(80),
}).strict().superRefine((input, context) => {
  const routeKeys = new Set<string>();
  input.routes.forEach((route, index) => {
    const key = `${route.fromConversationId}:${route.toConversationId}`;
    if (routeKeys.has(key)) {
      context.addIssue({
        code: "custom",
        message: "A plan may define at most one directed route for each conversation pair.",
        path: ["routes", index],
      });
    }
    routeKeys.add(key);
  });
});

export type TeamCollaborationPlanStatus = z.infer<typeof teamCollaborationPlanStatusSchema>;
export type TeamCollaborationNodeKind = z.infer<typeof teamCollaborationNodeKindSchema>;
export type TeamCollaborationNodeRunStatus = z.infer<typeof teamCollaborationNodeRunStatusSchema>;
export type TeamCollaborationEdgeState = z.infer<typeof teamCollaborationEdgeStateSchema>;
export type TeamCollaborationPlanView = z.infer<typeof teamCollaborationPlanViewSchema>;
export type TeamCollaborationNodeView = z.infer<typeof teamCollaborationNodeViewSchema>;
export type TeamCollaborationEdgeView = z.infer<typeof teamCollaborationEdgeViewSchema>;
export type TeamCollaborationProjection = z.infer<typeof teamCollaborationProjectionSchema>;
export type GetTeamCollaborationProjectionInput = z.infer<
  typeof getTeamCollaborationProjectionInputSchema
>;
export type TeamCollaborationPlanRouteInput = z.infer<
  typeof teamCollaborationPlanRouteInputSchema
>;
export type SetTeamCollaborationPlanInput = z.infer<typeof setTeamCollaborationPlanInputSchema>;
