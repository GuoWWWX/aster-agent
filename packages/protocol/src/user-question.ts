import { z } from "zod";

const id = z.string().uuid();
export const userQuestionPromptSchema = z.object({
  id: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(200),
  question: z.string().trim().min(1).max(4000),
  options: z.array(z.object({ label: z.string().trim().min(1).max(200), description: z.string().max(1000).optional() }).strict()).max(6).default([]),
}).strict();
export const userQuestionAnswersSchema = z.record(z.string().min(1).max(80), z.string().trim().min(1).max(8000));
export const userQuestionSchema = z.object({
  id,
  conversationId: id,
  displayConversationId: id,
  runId: id,
  toolCallId: z.string().min(1).max(200),
  teamWorkItemId: id.nullable().default(null),
  sourceTitle: z.string().max(200),
  questions: z.array(userQuestionPromptSchema).min(1).max(3).refine((questions) => new Set(questions.map((item) => item.id)).size === questions.length, "Question IDs must be unique."),
  status: z.enum(["pending", "answered", "cancelled"]),
  answers: userQuestionAnswersSchema.nullable(),
  createdAt: z.iso.datetime(),
  answeredAt: z.iso.datetime().nullable(),
  viewed: z.boolean(),
  deliveryComplete: z.boolean().default(false),
}).strict().superRefine((question, context) => {
  if (question.status === "answered") {
    if (question.answers === null || question.answeredAt === null || question.questions.some((prompt) => !question.answers?.[prompt.id])
      || Object.keys(question.answers ?? {}).length !== question.questions.length) context.addIssue({ code: "custom", message: "Answered questions require a complete answer and timestamp." });
  } else if (question.answers !== null || question.answeredAt !== null || question.deliveryComplete) {
    context.addIssue({ code: "custom", message: "Unanswered questions cannot contain delivered answers." });
  }
});
export const answerUserQuestionInputSchema = z.object({ questionId: id, answers: userQuestionAnswersSchema }).strict();
export const userQuestionReferenceSchema = z.object({ questionId: id }).strict();
export type UserQuestion = z.infer<typeof userQuestionSchema>;
export type UserQuestionPrompt = z.infer<typeof userQuestionPromptSchema>;
export type AnswerUserQuestionInput = z.infer<typeof answerUserQuestionInputSchema>;
