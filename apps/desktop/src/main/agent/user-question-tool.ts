import { z } from "zod";
import { userQuestionPromptSchema, type ConversationRunEvent } from "@agent/protocol";
import { modelToolParameters, parseToolArguments, ToolArgumentsError } from "../model/tool-arguments.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { UserQuestionService } from "./user-question-service.js";

const optionSchema = z.object({
  text: z.string().trim().min(1).max(200).describe("One short, complete choice sentence in the user's language, e.g. Export the report as Markdown. Do not use only a format name or abbreviation."),
  recommended: z.boolean().describe("Required on every option: true for exactly one AI-recommended choice, false for the others."),
}).strict();
const requestQuestionSchema = userQuestionPromptSchema.extend({
  options: z.array(optionSchema).max(6).default([]).refine(
    options => options.length === 0 || options.filter(option => option.recommended).length === 1,
    "Set recommended:true on exactly one option and recommended:false on the others.",
  ),
});
const requestSchema = z.object({ questions: z.array(requestQuestionSchema).min(1).max(3) }).strict();
const waitSchema = z.object({ questionIds: z.array(z.string().uuid()).min(1).max(10), waitFor: z.enum(["any", "all"]).default("any"), timeoutMs: z.number().int().min(1).max(600000).optional() }).strict();
export class UserQuestionTool {
  public constructor(private readonly service: UserQuestionService) {}
  public getDefinitions(): ModelToolDefinition[] { return [
    { name: "request_user_input", description: "Ask the user up to three questions. Keep each question to one short sentence. When useful, offer 2–6 mutually exclusive choices. Each option has text containing one short, complete choice sentence in the user's language, plus a required recommended boolean. For example: {text: 'Export the report as Markdown.', recommended: true} and {text: 'Export the report as JSON.', recommended: false}. Never split a choice into label and description, or use only an abbreviation such as Markdown. Exactly one option must be recommended:true. With no suggested choices, omit options. The user may choose one or write their own answer and attach images/files. Returns immediately with a question ID; continue independent work, then finish normally when nothing remains. User answers are delivered asynchronously at a safe boundary or wake an idle conversation. Use wait_for_user_input only when the next step depends on the answer.", parameters: modelToolParameters(requestSchema) },
    { name: "wait_for_user_input", description: "Explicitly wait for selected question IDs from this conversation or its Subagents. any/all are supported. Waiting uses no model polling. Timeout does not cancel questions; normal run cancellation interrupts the wait.", parameters: modelToolParameters(waitSchema) },
  ]; }
  public async execute(input: { toolName: string; rawArguments: string; conversationId: string; runId: string; toolCallId: string; signal: AbortSignal; emit: (event: ConversationRunEvent) => void }) {
    const args = parseToolArguments(input.rawArguments);
    if (input.toolName === "request_user_input") {
      const parsed = requestSchema.safeParse(args);
      if (!parsed.success) throw new ToolArgumentsError("Invalid question arguments. Each option needs a complete choice sentence in text and a recommended boolean; exactly one choice must be recommended. Do not use label or description.", parsed.error.issues.map(issue => ({
        code: issue.code, message: issue.message, path: issue.path.filter((part): part is string | number => typeof part === "string" || typeof part === "number"),
      })));
      const questions = parsed.data.questions.map(question => ({ ...question,
        options: question.options.map(option => ({ label: option.text, recommended: option.recommended })),
      }));
      const question = this.service.request({ conversationId: input.conversationId, runId: input.runId, toolCallId: input.toolCallId, questions }, input.emit);
      return { kind: "completed" as const, isError: false, content: JSON.stringify({ questionId: question.id, status: question.status, delivery: "asynchronous", instruction: "Continue work that does not depend on the answer. Do not repeat the same questions in your final response." }) };
    }
    const parsed = waitSchema.parse(args);
    const result = await this.service.wait(input.conversationId, parsed.questionIds, parsed.waitFor, parsed.timeoutMs, input.signal);
    return { kind: "completed" as const, isError: false, content: JSON.stringify(result) };
  }
}
