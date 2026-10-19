import { z } from "zod";
import type { ModelProviderState, ModelToolCall } from "../model/model-contracts.js";

const threadLogEventTypeSchema = z.enum([
  "group_message",
  "user_question_updated",
 "agent_message",
  "agent_message_read",
 "assistant_message",
  "conversation_created",
  "conversation_properties_changed",
  "conversation_result_viewed",
  "conversation_execution_paused",
  "agent_messages_consumed",
  "state_checkpoint",
  "context_checkpoint",
  "legacy_snapshot_imported",
  "model_retry_updated",
  "pending_message_cancelled",
  "pending_messages_updated",
  "run_queued",
  "run_created",
  "run_replaced",
  "run_terminal",
 "run_started",
 "run_finished",
 "run_superseded",
 "runtime_activity_updated",
  "subagent_task_completed",
  "subagent_task_created",
  "subagent_task_ended",
  "task_list_updated",
  "turn_summary_updated",
  "tool_approval_decided",
  "tool_approval_auto_reviewed",
  "tool_approval_expired",
  "tool_approval_requested",
  "tool_call_requested",
  "tool_execution_prepared",
  "tool_result",
  "user_message",
  "user_message_replaced",
]);

const threadLogPayloadSchema = z.record(z.string(), z.unknown());

export const threadLogHeaderSchema = z.object({
  conversationId: z.string().uuid(),
  createdAt: z.string().datetime(),
  type: z.literal("thread_header"),
  version: z.literal(1),
}).strict();

export const threadLogEventSchema = z.object({
  conversationId: z.string().uuid(),
  createdAt: z.string().datetime(),
  eventId: z.string().uuid(),
  payload: threadLogPayloadSchema,
  sequence: z.number().int().positive(),
  type: threadLogEventTypeSchema,
  version: z.literal(1),
}).strict();

export type ThreadLogEvent = z.infer<typeof threadLogEventSchema>;
export type ThreadLogEventInput = {
  payload: Record<string, unknown>;
  type: z.infer<typeof threadLogEventTypeSchema>;
};
export type ThreadLogRead = {
  events: ThreadLogEvent[];
  header: z.infer<typeof threadLogHeaderSchema>;
};

export type ThreadLogSourceSignature = {
  modifiedAtMs: number;
  sizeBytes: number;
};

export type ThreadLogRecordLocation = { offset: number; length: number };
export type ThreadLogScanCursor = {
  header: z.infer<typeof threadLogHeaderSchema>;
  offset: number;
  sequence: number;
  generation: number;
};

/** A model-visible message reconstructed from the canonical ThreadLog. */
export type ThreadLogContextMessage = {
  attachmentIds: string[];
  content: string;
  providerState?: ModelProviderState;
  role: "assistant" | "tool" | "user";
  runId: string | null;
  sequence: number;
  toolCallId: string | null;
  toolCalls: ModelToolCall[];
};

export type ThreadLogContextCheckpoint = {
  coveredThroughSequence: number;
  createdAt: string;
  summary: string;
  updatedAt: string;
};

export type ThreadLogContext = {
  checkpoint: ThreadLogContextCheckpoint | null;
  messages: ThreadLogContextMessage[];
};
