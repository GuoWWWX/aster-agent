

const MAX_AGENT_RESULT_RECEIPT_LENGTH = 1_000;

const AGENT_RESULT_RECEIPT_TRUNCATION = "\n\n[完整结果保留在执行 Agent 对话，可按需读取]";

function agentResultContent(input: {
  error: string | null;
  result: string | null;
  status: "completed" | "failed" | "cancelled";
}): string {
  if (input.status === "completed") {
    return input.result?.trim() || "本轮执行已结束，未提供总结。可按 conversationId 和 runId 读取本轮记录，或要求原 Agent 补充说明；结束不代表任务已验收。";
  }
  if (input.status === "cancelled") {
    return "Agent 处理本次协作消息时被取消。";
  }
  return `Agent 处理本次协作消息失败：${input.error ?? "未知错误"}`;
}

export function agentResultReceiptContent(input: {
  error: string | null;
  result: string | null;
  status: "completed" | "failed" | "cancelled";
}): string {
  const content = agentResultContent(input);
  if (input.status !== "completed") {
    return content.slice(0, MAX_AGENT_RESULT_RECEIPT_LENGTH);
  }
  const divider = /\n\s*---+\s*(?:\n|$)/u.exec(content);
  const receipt = divider?.index === undefined
    ? content
    : content.slice(0, divider.index).trimEnd();
  const hasMoreDetail = divider !== null || receipt.length < content.length;
  if (!hasMoreDetail && receipt.length <= MAX_AGENT_RESULT_RECEIPT_LENGTH) return receipt;
  const receiptBudget = MAX_AGENT_RESULT_RECEIPT_LENGTH - AGENT_RESULT_RECEIPT_TRUNCATION.length;
  return `${receipt.slice(0, receiptBudget).trimEnd()}${AGENT_RESULT_RECEIPT_TRUNCATION}`;
}
