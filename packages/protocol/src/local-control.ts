import { z } from "zod";
import { approveToolChangeInputSchema, conversationIdSchema, conversationMessageDeliveryModeSchema, conversationModelSelectionSchema, conversationReferenceInputSchema, conversationTimelinePageInputSchema, renameConversationInputSchema, saveModelConfigurationInputSchema, setConversationArchivedInputSchema, setConversationPermissionModeInputSchema } from "./conversation.js";
import { answerUserQuestionInputSchema } from "./user-question.js";
import { stopBackgroundCommandInputSchema, readBackgroundCommandInputSchema } from "./background-command.js";
import { postTeamChatInputSchema, readTeamChatInputSchema } from "./team-chat.js";
import { teamInstanceReferenceInputSchema } from "./team-instance.js";

export const localControlCommandSchema = z.discriminatedUnion("command", [
  z.object({ command: z.literal("projects.list"), input: z.object({}).strict() }).strict(),
  z.object({ command: z.literal("conversations.list"), input: z.object({}).strict() }).strict(),
  z.object({ command: z.literal("models.configure"), input: saveModelConfigurationInputSchema }).strict(),
  z.object({ command: z.literal("models.status"), input: z.object({}).strict() }).strict(),
  z.object({ command: z.literal("team_chat.post"), input: postTeamChatInputSchema }).strict(),
  z.object({ command: z.literal("team_chat.read"), input: readTeamChatInputSchema }).strict(),
  z.object({ command: z.literal("team_chat.members"), input: teamInstanceReferenceInputSchema }).strict(),
  z.object({ command: z.literal("user_questions.list"), input: conversationReferenceInputSchema }).strict(),
  z.object({ command: z.literal("user_questions.answer"), input: answerUserQuestionInputSchema }).strict(),
  z.object({ command: z.literal("approvals.resolve"), input: approveToolChangeInputSchema }).strict(),
  z.object({ command: z.literal("background_commands.list"), input: conversationReferenceInputSchema }).strict(),
  z.object({ command: z.literal("background_commands.read"), input: readBackgroundCommandInputSchema }).strict(),
  z.object({ command: z.literal("background_commands.stop"), input: stopBackgroundCommandInputSchema }).strict(),
  z.object({ command: z.literal("conversations.set_permission"), input: setConversationPermissionModeInputSchema }).strict(),
  z.object({ command: z.literal("conversations.rename"), input: renameConversationInputSchema }).strict(),
  z.object({ command: z.literal("conversations.archive"), input: setConversationArchivedInputSchema }).strict(),
  z.object({ command: z.literal("conversations.open"), input: z.object({ conversationId: conversationIdSchema }).strict() }).strict(),
  z.object({ command: z.literal("conversations.create"), input: z.object({
    projectId: z.string().uuid().nullable().optional(),
    agentId: z.string().trim().min(1).max(200).optional(),
    modelSelection: conversationModelSelectionSchema.optional(),
  }).strict() }).strict(),
  z.object({ command: z.literal("conversations.read"), input: conversationTimelinePageInputSchema }).strict(),
  z.object({ command: z.literal("messages.send"), input: z.object({
    conversationId: conversationIdSchema,
    content: z.string().trim().min(1).max(100_000),
    deliveryMode: conversationMessageDeliveryModeSchema.optional(),
  }).strict() }).strict(),
  z.object({ command: z.literal("runs.cancel"), input: z.object({ conversationId: conversationIdSchema }).strict() }).strict(),
]);

export type LocalControlCommand = z.infer<typeof localControlCommandSchema>;
