import { z } from "zod";
import { userQuestionPromptSchema, type ConversationRunEvent } from "@agent/protocol";
import { modelToolParameters, parseToolArguments } from "../model/tool-arguments.js";
import type { ModelToolDefinition } from "../model/model-contracts.js";
import { UserQuestionService } from "./user-question-service.js";

const requestSchema = z.object({ questions: z.array(userQuestionPromptSchema).min(1).max(3) }).strict();
const waitSchema = z.object({ questionIds: z.array(z.string().uuid()).min(1).max(10), waitFor: z.enum(["any", "all"]).default("any"), timeoutMs: z.number().int().min(1).max(600000).optional() }).strict();
export class UserQuestionTool {
  public constructor(private readonly service: UserQuestionService) {}
  public getDefinitions(): ModelToolDefinition[] { return [
    { name: "request_user_input", description: "Ask the user up to three questions. Returns immediately with a question ID; continue independent work, then finish normally when nothing remains. User answers are delivered asynchronously at a safe boundary or wake an idle conversation. Use wait_for_user_input only when the next step depends on the answer.", parameters: modelToolParameters(requestSchema) },
    { name: "wait_for_user_input", description: "Explicitly wait for selected question IDs from this conversation or its Subagents. any/all are supported. Waiting uses no model polling. Timeout does not cancel questions; normal run cancellation interrupts the wait.", parameters: modelToolParameters(waitSchema) },
  ]; }
  public async execute(input: { toolName: string; rawArguments: string; conversationId: string; runId: string; toolCallId: string; signal: AbortSignal; emit: (event: ConversationRunEvent) => void }) {
    const args = parseToolArguments(input.rawArguments);
    if (input.toolName === "request_user_input") {
      const parsed = requestSchema.parse(args);
      const question = this.service.request({ conversationId: input.conversationId, runId: input.runId, toolCallId: input.toolCallId, questions: parsed.questions }, input.emit);
      return { kind: "completed" as const, isError: false, content: JSON.stringify({ questionId: question.id, status: question.status, delivery: "asynchronous", instruction: "Continue work that does not depend on the answer. Do not repeat the same questions in your final response." }) };
    }
    const parsed = waitSchema.parse(args);
    const result = await this.service.wait(input.conversationId, parsed.questionIds, parsed.waitFor, parsed.timeoutMs, input.signal);
    return { kind: "completed" as const, isError: false, content: JSON.stringify(result) };
  }
}
