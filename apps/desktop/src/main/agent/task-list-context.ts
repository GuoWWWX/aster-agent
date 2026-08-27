import {
  CONTEXT_MESSAGE_OVERHEAD_TOKENS,
  estimateContextTokens,
  type ConversationTaskList,
} from "@agent/protocol";

import type { ModelMessage } from "../model/model-contracts.js";

const MAX_CONTEXT_TASK_TITLE_CHARACTERS = 120;

const TASK_LIST_CONTEXT_HEADER = [
  "[当前任务清单｜动态运行状态]",
  "这是本对话当前唯一的权威任务状态；它会在每次模型调用前刷新。不要以旧的工具结果、聊天记录或压缩摘要中的任务状态替代它。",
  "需要调整时调用 update_task_list 并提交完整清单；同一时刻最多一个步骤为 running。清单不存在时才能 create_task_list；所有步骤完成后调用 close_task_list。",
].join("\n");

function contextTaskTitle(title: string): string {
  if (title.length <= MAX_CONTEXT_TASK_TITLE_CHARACTERS) return title;
  return `${title.slice(0, MAX_CONTEXT_TASK_TITLE_CHARACTERS - 1)}…`;
}

function taskListContextContent(taskList: ConversationTaskList): string {
  return [
    TASK_LIST_CONTEXT_HEADER,
    ...taskList.tasks.map((task, index) =>
      `${index + 1}. [${task.status}] ${contextTaskTitle(task.title)}`,
    ),
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
    role: "system",
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
