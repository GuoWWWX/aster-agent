import { agentAvatarIconSchema, type AgentAvatarIcon, type ConversationToolItem } from "@agent/protocol";
import { parseToolPayload, parseToolValue } from "./tool-result-payload.js";

export function parseAgentConversationListResult(payload: string): Array<{
  conversationId: string;
  threadKind: string;
  title: string;
}> | null {
  const result = parseToolValue(payload);
  if (!Array.isArray(result?.conversations)) return null;
  const conversations = result.conversations.map((conversation) => {
    if (conversation === null || typeof conversation !== "object") return null;
    const value = conversation as Record<string, unknown>;
    return typeof value.conversationId === "string" &&
      typeof value.threadKind === "string" &&
      typeof value.title === "string"
      ? {
        conversationId: value.conversationId,
        threadKind: value.threadKind,
        title: value.title,
      }
      : null;
  });
  return conversations.every((conversation) => conversation !== null)
    ? conversations.filter((conversation) => conversation !== null)
    : null;
}

export function parseAgentConversationReadResult(payload: string): {
  content: string;
  estimatedTokens: number;
} | null {
  const result = parseToolValue(payload);
  return typeof result?.content === "string" && typeof result.estimatedTokens === "number"
    ? { content: result.content, estimatedTokens: result.estimatedTokens }
    : null;
}

type AgentMessageResultPayload = {
  content: string;
  conversationId: string;
  senderConversationId: string;
  senderTitle: string;
};

export function parseAgentMessageToolResult(payload: string): {
  messages: AgentMessageResultPayload[];
} | null {
  const result = parseToolValue(payload);
  if (result === null) return null;
  if (result.message === null && result.status === "timeout") return { messages: [] };
  const values = Array.isArray(result.messages) ? result.messages : [result.message];
  const messages: AgentMessageResultPayload[] = [];
  for (const value of values) {
    if (value === null || typeof value !== "object") return null;
    const message = value as Record<string, unknown>;
    if (typeof message.content !== "string" ||
    typeof message.conversationId !== "string" ||
    typeof message.senderConversationId !== "string" ||
    typeof message.senderTitle !== "string") return null;
    messages.push({ content: message.content, conversationId: message.conversationId,
      senderConversationId: message.senderConversationId, senderTitle: message.senderTitle });
  }
  return { messages };
}

type SubagentToolTaskPayload = {
  avatarIcon: AgentAvatarIcon | null;
  childConversationId: string;
  error: string | null;
  id: string;
  name: string;
  result: string | null;
  status: string;
  title: string;
};

type SpawnSubagentActivity = {
  action: "创建中" | "已创建" | "创建失败" | "已取消";
  avatarIcon: AgentAvatarIcon | null;
  childConversationId: string | null;
  name: string;
};

export function spawnSubagentActivity(
  item: ConversationToolItem,
  status: ConversationToolItem["status"] = item.status,
): SpawnSubagentActivity | null {
  if (item.name !== "spawn_subagent") return null;

  const result = item.result === null ? null : parseSubagentToolResult(item.result);
  const task = result?.tasks[0];
  const argumentsValue = parseToolPayload(item.arguments);
  const argumentIcon = argumentsValue?.icon === undefined
    ? null
    : agentAvatarIconSchema.safeParse(argumentsValue.icon);
  const action = status === "failed"
    ? "创建失败"
    : status === "cancelled"
      ? "已取消"
      : status === "completed"
        ? "已创建"
        : "创建中";

  return {
    action,
    avatarIcon: task?.avatarIcon
      ?? (argumentIcon !== null && argumentIcon.success ? argumentIcon.data : null),
    childConversationId: task?.childConversationId ?? null,
    name: task?.name
      ?? (typeof argumentsValue?.name === "string" && argumentsValue.name.trim().length > 0
        ? argumentsValue.name.trim()
        : "Subagent"),
  };
}

export function parseSubagentToolResult(payload: string): {
  tasks: SubagentToolTaskPayload[];
  waitStatus: string | null;
} | null {
  const result = parseToolValue(payload);
  if (result === null) return null;
  const rawTasks = Array.isArray(result.tasks)
    ? result.tasks
    : result.task === null || typeof result.task !== "object"
      ? null
      : [result.task];
  if (rawTasks === null) return null;
  const tasks = rawTasks.map((rawTask) => {
    if (rawTask === null || typeof rawTask !== "object") return null;
    const task = rawTask as Record<string, unknown>;
    const avatarIcon = task.avatarIcon === null || task.avatarIcon === undefined
      ? null
      : agentAvatarIconSchema.safeParse(task.avatarIcon);
    return typeof task.childConversationId === "string"
      && typeof task.id === "string"
      && typeof task.status === "string"
      && typeof task.title === "string"
      && (avatarIcon === null || avatarIcon.success)
      && (task.result === null || typeof task.result === "string")
      && (task.error === null || typeof task.error === "string")
      ? {
        avatarIcon: avatarIcon === null ? null : avatarIcon.data,
        childConversationId: task.childConversationId,
        error: task.error,
        id: task.id,
        name: typeof task.name === "string" ? task.name : task.title,
        result: task.result,
        status: task.status,
        title: task.title,
      }
      : null;
  });
  if (!tasks.every((task) => task !== null)) return null;
  return {
    tasks: tasks.filter((task) => task !== null),
    waitStatus: typeof result.status === "string" ? result.status : null,
  };
}

export function subagentTaskStatusLabel(status: string): string {
  switch (status) {
    case "queued":
      return "等待启动";
    case "running":
      return "正在运行";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已取消";
    case "ended":
      return "已结束";
    default:
      return status;
  }
}
