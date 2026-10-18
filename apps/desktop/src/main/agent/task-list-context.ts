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
  "This list is progress metadata, not authorization to resume work. It may contain unfinished steps from a different request. Follow the current message and its assigned scope; do not add casual discussion or acknowledgements to an unrelated list, or update/close that list just to finish the current turn. Pending steps can remain while you await input or another member.",
  "Update only when a step actually changes; repeating an identical list does not advance work. A completed public answer or internal receipt can end this turn without touching unrelated steps.",
  "Call update_task_list once with the complete list and all currently known step changes, including completing one step and starting the next. Multiple tasks may be running at once. A blocked or failed task requires a short reason. In the final update set close=true with every step completed, avoiding a separate close_task_list call.",
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
