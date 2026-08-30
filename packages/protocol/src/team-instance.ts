import { z } from "zod";

import { conversationIdSchema } from "./conversation.js";
import { projectIdSchema } from "./project.js";

export const teamInstanceIdSchema = z.string().uuid();
export const teamInstanceNameSchema = z.string().trim().min(1).max(120);
export const teamInstanceScopeSchema = z.enum(["global", "project", "conversation"]);

export const teamInstanceViewSchema = z.object({
  createdAt: z.string().datetime(),
  id: teamInstanceIdSchema,
  isArchived: z.boolean(),
  name: teamInstanceNameSchema,
  projectId: projectIdSchema.nullable(),
  rootConversationId: conversationIdSchema.nullable(),
  scope: teamInstanceScopeSchema,
  sourceConversationId: conversationIdSchema.nullable(),
  teamId: z.string().trim().min(1).max(200),
  updatedAt: z.string().datetime(),
}).strict();

export const teamInstanceListSchema = z.array(teamInstanceViewSchema).max(1_000);

export const listTeamInstancesInputSchema = z.object({
  includeArchived: z.boolean().default(false),
  projectId: projectIdSchema.optional(),
  sourceConversationId: conversationIdSchema.optional(),
}).strict();

export const createTeamInstanceInputSchema = z.object({
  name: teamInstanceNameSchema.optional(),
  projectId: projectIdSchema.optional(),
  scope: teamInstanceScopeSchema,
  sourceConversationId: conversationIdSchema.optional(),
  teamId: z.string().trim().min(1).max(200),
}).strict().superRefine((input, context) => {
  if (input.scope === "global") {
    if (input.projectId !== undefined || input.sourceConversationId !== undefined) {
      context.addIssue({
        code: "custom",
        message: "A global Team instance cannot belong to a project or conversation.",
        path: ["scope"],
      });
    }
    return;
  }
  if (input.projectId === undefined) {
    context.addIssue({
      code: "custom",
      message: "A project or conversation Team instance requires a project.",
      path: ["projectId"],
    });
  }
  if (input.scope === "conversation" && input.sourceConversationId === undefined) {
    context.addIssue({
      code: "custom",
      message: "A conversation Team instance requires a source conversation.",
      path: ["sourceConversationId"],
    });
  }
  if (input.scope === "project" && input.sourceConversationId !== undefined) {
    context.addIssue({
      code: "custom",
      message: "A project Team instance cannot belong to one conversation.",
      path: ["sourceConversationId"],
    });
  }
});

export const teamInstanceReferenceInputSchema = z.object({
  teamInstanceId: teamInstanceIdSchema,
}).strict();

export const renameTeamInstanceInputSchema = teamInstanceReferenceInputSchema.extend({
  name: teamInstanceNameSchema,
  projectId: projectIdSchema.nullable().optional(),
}).strict();

export const reorderTeamInstancesInputSchema = z.object({
  teamInstanceIds: z.array(teamInstanceIdSchema).min(1).max(1_000),
}).strict().superRefine((input, context) => {
  if (new Set(input.teamInstanceIds).size !== input.teamInstanceIds.length) {
    context.addIssue({
      code: "custom",
      message: "Team instance order contains duplicate identifiers.",
      path: ["teamInstanceIds"],
    });
  }
});

export const setTeamInstanceArchivedInputSchema = teamInstanceReferenceInputSchema.extend({
  archived: z.boolean(),
}).strict();

export const ensureTeamInstanceMemberConversationInputSchema =
  teamInstanceReferenceInputSchema.extend({
    agentId: z.string().trim().min(1).max(200),
  }).strict();

export type TeamInstanceScope = z.infer<typeof teamInstanceScopeSchema>;
export type TeamInstanceView = z.infer<typeof teamInstanceViewSchema>;
export type ListTeamInstancesInput = z.infer<typeof listTeamInstancesInputSchema>;
export type CreateTeamInstanceInput = z.infer<typeof createTeamInstanceInputSchema>;
export type TeamInstanceReferenceInput = z.infer<typeof teamInstanceReferenceInputSchema>;
export type RenameTeamInstanceInput = z.infer<typeof renameTeamInstanceInputSchema>;
export type ReorderTeamInstancesInput = z.infer<typeof reorderTeamInstancesInputSchema>;
export type SetTeamInstanceArchivedInput = z.infer<typeof setTeamInstanceArchivedInputSchema>;
export type EnsureTeamInstanceMemberConversationInput = z.infer<
  typeof ensureTeamInstanceMemberConversationInputSchema
>;
