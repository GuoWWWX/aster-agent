import {
  conversationAgentBindingSchema,
  conversationPermissionModeSchema,
  conversationSummarySchema,
} from "@agent/protocol";
import { z } from "zod";

export const conversationMutablePropertySchema = z.enum([
  "agent",
  "archive",
  "avatar",
  "modelSelection",
  "permissionMode",
  "pin",
  "project",
  "title",
  "workspace",
]);

export const conversationMutablePropertiesSchema = conversationSummarySchema.pick({
  agentId: true,
  archivedAt: true,
  avatarIcon: true,
  isArchived: true,
  isPinned: true,
  modelSelection: true,
  permissionMode: true,
  pinOrder: true,
  projectId: true,
  title: true,
  updatedAt: true,
  workspaceRootPath: true,
}).extend({
  permissionMode: conversationPermissionModeSchema,
});

export const conversationPropertiesChangedPayloadSchema = z.object({
  agent: conversationAgentBindingSchema.nullable(),
  changed: z.array(conversationMutablePropertySchema).min(1),
  properties: conversationMutablePropertiesSchema,
}).strict();

export type ConversationMutableProperty = z.infer<typeof conversationMutablePropertySchema>;
export type ConversationPropertiesChangedPayload = z.infer<
  typeof conversationPropertiesChangedPayloadSchema
>;
