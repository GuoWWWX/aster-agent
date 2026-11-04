import {
  type ConversationAgentMessageItem,
  type ConversationRunFileChange,
  type ConversationToolItem,
} from "@agent/protocol";

function agentMessageFileChangeLines(message: ConversationAgentMessageItem): string[] {
  if (message.fileChanges.length === 0) return [];
  return [
    "Built-in file changes recorded for this run:",
    ...message.fileChanges.map((change) => `- ${change.toolName}: ${change.path}`),
    "This bounded list does not include file changes made indirectly by shell commands.",
  ];
}

export function runFileChangesFromTool(tool: ConversationToolItem): ConversationRunFileChange[] {
  if (tool.status !== "completed") return [];
  if (
    tool.name !== "write_file"
    && tool.name !== "replace_in_file"
    && tool.name !== "delete_file"
    && tool.name !== "apply_patch"
  ) {
    return [];
  }
  try {
    const parsed = JSON.parse(tool.arguments) as unknown;
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return [];
    const record = parsed as Record<string, unknown>;
    if (tool.name === "apply_patch") {
      if (typeof record.patch !== "string") return [];
      return [...record.patch.matchAll(/^(?:--- a\/|\+\+\+ b\/|\*\*\* Update File: )([^\t\r\n]+)$/gmu)]
        .map((match) => match[1]?.trim())
        .filter((path): path is string => path !== undefined && path.length > 0)
        .map((path) => ({ path, toolName: "apply_patch" as const }));
    }
    if (typeof record.path !== "string" || record.path.trim().length === 0) return [];
    return [{
      path: record.path.trim(),
      toolName: tool.name,
    }];
  } catch {
    return [];
  }
}

export function agentMessageModelContent(message: ConversationAgentMessageItem): string {
  if (message.messageType === "task_result") {
    return [
      "[Subagent task result]",
      `Subagent conversation: ${message.senderTitle}`,
      `Subagent conversationId: ${message.senderConversationId}`,
      ...(message.runId === null ? [] : [`Run ID: ${message.runId}`]),
      ...(message.executionStatus === undefined ? [] : [`Execution status: ${message.executionStatus}; summary: ${message.summaryStatus ?? "missing"}`]),
      ...(message.taskId === null ? [] : [`Task ID: ${message.taskId}`]),
      "This is a private completion receipt from a reusable Subagent. Synthesize it into your response. When the summary is missing, truncated, or insufficient to assess the work, use read_agent_conversation with conversationId and runId to read or search this execution. Do not retrieve the full child history merely to repeat an adequate receipt. Continue the same Subagent with send_agent_message for follow-up. End it only after accepting its work and deciding no follow-up is needed.",
      ...agentMessageFileChangeLines(message),
      "Assess the receipt against the original scope before accepting it. For code changes, inspect relevant changes when the receipt cannot establish preservation of existing behavior; a passing build alone is not functional verification. Request follow-up from the same Subagent if evidence is missing.",
      "Completion receipt:",
      message.content
    ].join("\n");
  }
  if (message.messageType === "agent_result") {
    return [
      "[Agent result]",
      `Executor conversation: ${message.senderTitle}`,
      `Executor conversationId: ${message.senderConversationId}`,
      ...(message.runId === null ? [] : [`Run ID: ${message.runId}`]),
      ...(message.executionStatus === undefined ? [] : [`Execution status: ${message.executionStatus}; summary: ${message.summaryStatus ?? "missing"}`]),
      ...(message.taskId === null ? [] : [`Original collaboration message ID: ${message.taskId}`]),
      "This is a bounded completion receipt, not the executor's full answer. Full details remain only in the executor conversation; use read_agent_conversation with a chosen maxTokens budget when needed. Do not reply again unless follow-up work is required.",
      ...agentMessageFileChangeLines(message),
      "Completion receipt:",
      message.content,
    ].join("\n");
  }
  if (message.messageType === "notification") {
    return [
      "[Agent collaboration notification]",
      `Sender conversation: ${message.senderTitle}`,
      `Sender conversationId: ${message.senderConversationId}`,
      "This progress or notification message does not request an automatic result. Continue the current work as appropriate.",
      "Message:",
      message.content,
    ].join("\n");
  }
  return [
    "[Agent collaboration request]",
    `Sender conversation: ${message.senderTitle}`,
    `Sender conversationId: ${message.senderConversationId}`,
    "Complete the requested work in this persistent conversation. Start the final answer with the concise completion receipt requested below, add a standalone Markdown --- line, then keep full details after the divider in this conversation. The runtime can return only a bounded completion receipt before the divider. Call send_agent_message only for progress, clarification, or another proactive message.",
    `Completion receipt request: ${message.replyInstruction ?? "Summarize the conclusion, key evidence, and unresolved risks concisely."}`,
    "Message:",
    message.content
  ].join("\n");
}

const MAX_SUBAGENT_RESULT_SUMMARY_LENGTH = 2_000;

const SUBAGENT_RESULT_SUMMARY_TRUNCATION = "\n\n[完成回执已截断，可读取完整子对话]";

export function subagentResultSummaryContent(input: {
  content: string;
  status: "completed" | "failed" | "cancelled";
}): string {
  const divider = input.status === "completed"
    ? /\n\s*---+\s*(?:\n|$)/u.exec(input.content)
    : null;
  const extracted = divider?.index === undefined
    ? input.content
    : input.content.slice(0, divider.index).trimEnd();
  const summary = extracted.trim().length === 0 ? input.content : extracted;
  if (summary.length <= MAX_SUBAGENT_RESULT_SUMMARY_LENGTH) return summary;
  const contentBudget = MAX_SUBAGENT_RESULT_SUMMARY_LENGTH
    - SUBAGENT_RESULT_SUMMARY_TRUNCATION.length;
  return `${summary.slice(0, contentBudget).trimEnd()}${SUBAGENT_RESULT_SUMMARY_TRUNCATION}`;
}
