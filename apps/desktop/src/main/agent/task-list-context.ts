import {
  CONTEXT_MESSAGE_OVERHEAD_TOKENS,
  estimateContextTokens,
  type ConversationTaskList,
} from "@agent/protocol";

import type { ModelMessage } from "../model/model-contracts.js";

const MAX_CONTEXT_TASK_TITLE_CHARACTERS = 120;
const MAX_CONTEXT_TASK_REASON_CHARACTERS = 240;

const TASK_LIST_CONTEXT_HEADER = [
  "[Current task list | live state]",
  "This is the only authoritative task state for this conversation and is refreshed before every model call. Do not replace it with task state from older tool results, chat history, or compression summaries.",
  "To change it, call update_task_list with the complete list. At most one step may be running. A blocked or failed step requires a short reason. Call create_task_list only when no list exists, and close_task_list after all steps finish.",
].join("\n");

function contextTaskTitle(title: string): string {
  if (title.length <= MAX_CONTEXT_TASK_TITLE_CHARACTERS) return title;
  return `${title.slice(0, MAX_CONTEXT_TASK_TITLE_CHARACTERS - 1)}…`;
}

function contextTaskReason(reason: string): string {
  if (reason.length <= MAX_CONTEXT_TASK_REASON_CHARACTERS) return reason;
  return `${reason.slice(0, MAX_CONTEXT_TASK_REASON_CHARACTERS - 1)}…`;
}

function taskListContextContent(taskList: ConversationTaskList): string {
  return [
    TASK_LIST_CONTEXT_HEADER,
    ...taskList.tasks.map((task, index) => [
      `${index + 1}. [${task.status}] ${contextTaskTitle(task.title)}`,
      task.status !== "blocked" && task.status !== "failed"
        ? null
        : task.reason === null ? null : `   Reason: ${contextTaskReason(task.reason)}`,
    ].filter((line): line is string => line !== null).join("\n")),
  ].join("\n");
}

/**
 * The task list is mutable working state, not conversation history. It is
 * injected ephemerally for one model call and never added to the graph state.
 */
export function activeTaskListContextMessage(
  taskList: ConversationTaskList | null,
): ModelMessage | null {
  if (taskList === null || taskList.status !== "active") return null;
  return {
    attachments: [],
    content: taskListContextContent(taskList),
    // Keep mutable state at the request tail. A secondary system message would
    // have to precede history for Anthropic compatibility and would invalidate
    // the provider's cached prefix whenever task progress changes.
    role: "user",
    toolCallId: null,
    toolCalls: [],
  };
}

/** Returns the exact budget used by the currently active dynamic block. */
export function activeTaskListContextTokens(taskList: ConversationTaskList | null): number {
  const message = activeTaskListContextMessage(taskList);
  return message === null
    ? 0
    : estimateContextTokens(message.content) + CONTEXT_MESSAGE_OVERHEAD_TOKENS;
}
