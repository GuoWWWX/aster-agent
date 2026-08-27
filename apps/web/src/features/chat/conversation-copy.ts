import type {
  ConversationMessageItem,
  ConversationTimelineItem,
  ConversationToolItem,
} from "@agent/protocol";
import { redactErrorIdentifiers } from "@agent/protocol";

type RecordValue = Record<string, unknown>;

const TOOL_LABELS: Readonly<Record<string, string>> = {
  apply_patch: "文件变更",
  delete_file: "文件变更",
  find_files: "查找文件",
  list_agent_conversations: "Agent 对话",
  list_directory: "目录内容",
  list_project_operations: "项目操作",
  list_subagents: "Subagent",
  read_agent_conversation: "Agent 对话",
  read_attachment: "读取附件",
  read_file: "读取文件",
  replace_in_file: "文件变更",
  run_command: "执行命令",
  search_text: "文本搜索",
  send_agent_message: "Agent 消息",
  spawn_subagent: "Subagent",
  stop_command: "停止命令",
  wait_for_agent_message: "Agent 消息等待",
  wait_for_commands: "命令等待",
  wait_for_project_operation: "项目操作等待",
  wait_for_subagents: "Subagent 等待",
  web_search: "网页搜索",
  write_file: "文件变更",
};

/**
 * Builds the user-facing export for one completed Assistant run. Timeline
 * remains the source of truth, while internal envelopes and audit identifiers
 * stay out of the copied Markdown.
 */
export function formatConversationRunMarkdown(
  timeline: readonly ConversationTimelineItem[],
  assistantMessage: ConversationMessageItem,
): string {
  const runId = assistantMessage.runId;
  const runItems = runId === null
    ? []
    : timeline.filter(
      (item): item is ConversationMessageItem | ConversationToolItem =>
        item.runId === runId && (item.kind === "message" || item.kind === "tool"),
    );
  const assistantItems = runItems.filter(
    (item): item is ConversationMessageItem =>
      item.kind === "message" && item.role === "assistant",
  );
  const primaryMessage = assistantItems.find((item) => item.id === assistantMessage.id)
    ?? assistantMessage;
  const sections: string[] = [];
  let hasPrimaryMessage = false;
  for (const item of runItems) {
    if (item.kind === "message") {
      if (item.role !== "assistant" || item.content.length === 0) continue;
      const isPrimary = item.id === primaryMessage.id;
      sections.push(`${isPrimary ? "## 模型回复" : "## 模型回复（补充）"}\n\n${item.content}`);
      hasPrimaryMessage ||= isPrimary;
      continue;
    }
    sections.push(formatToolItem(item));
  }

  if (!hasPrimaryMessage) sections.push(`## 模型回复\n\n${primaryMessage.content}`);

  return `${sections.join("\n\n").trimEnd()}\n`;
}

function formatToolItem(item: ConversationToolItem): string {
  switch (item.name) {
    case "run_command":
      return formatCommand(item);
    case "write_file":
    case "replace_in_file":
    case "apply_patch":
    case "delete_file":
      return formatFileChange(item);
    case "read_file":
    case "read_attachment":
      return formatRead(item);
    case "web_search":
      return formatWebSearch(item);
    case "search_text":
      return formatSearch(item);
    case "find_files":
      return formatFindFiles(item);
    case "list_directory":
      return formatDirectory(item);
    default:
      return formatGenericTool(item);
  }
}

function formatCommand(item: ConversationToolItem): string {
  const args = parseRecord(item.arguments);
  const result = parseRecord(item.result);
  const value = recordValue(result?.value);
  const command = stringValue(value?.command) ?? stringValue(args?.command) ?? "（命令参数不可用）";
  const terminal = recordValue(value?.terminal);
  const shell = stringValue(terminal?.shell) ?? stringValue(args?.shell) ?? "text";
  const status = stringValue(value?.status) ?? item.status;
  const exitCode = numberOrNull(value?.exitCode);
  const stdout = stringValue(value?.stdout) ?? "";
  const stderr = stringValue(value?.stderr) ?? "";
  const details = [
    `状态：${commandStatusLabel(status)}`,
    ...(exitCode === null ? [] : [`退出码：${exitCode}`]),
    ...(value?.timedOut === true ? ["已超时"] : []),
    ...(value?.truncated === true ? ["输出已截断"] : []),
  ];
  const error = result === null || result.ok !== true ? errorText(result) : null;

  return [
    "## 执行命令",
    "",
    fence(command, shellLanguage(shell)),
    "",
    details.join(" · "),
    "",
    "### stdout",
    "",
    fence(stdout, "text"),
    "",
    "### stderr",
    "",
    fence(stderr, "text"),
    ...(error === null ? [] : ["", `错误：${error}`]),
  ].join("\n");
}

function formatFileChange(item: ConversationToolItem): string {
  const args = parseRecord(item.arguments);
  const result = parseRecord(item.result);
  const value = recordValue(result?.value);
  const path = diffPath(item.diff) ?? stringValue(value?.path) ?? stringValue(args?.path) ?? "（路径不可用）";
  const diff = item.diff ?? stringValue(args?.patch);
  const error = result === null || result.ok !== true ? errorText(result) : null;

  return [
    "## 文件变更",
    "",
    `路径：${path}`,
    "",
    fence(diff ?? "（没有可显示的 Diff）", "diff"),
    ...(error === null ? [] : ["", `错误：${error}`]),
  ].join("\n");
}

function formatRead(item: ConversationToolItem): string {
  const args = parseRecord(item.arguments);
  const result = parseRecord(item.result);
  const value = recordValue(result?.value);
  const path = stringValue(value?.path) ?? stringValue(value?.name) ?? stringValue(args?.path) ?? "（路径不可用）";
  const content = stringValue(value?.content);
  const range = typeof value?.startLine === "number" && typeof value.endLine === "number"
    ? `（第 ${value.startLine}-${value.endLine} 行）`
    : "";
  const error = result === null || result.ok !== true ? errorText(result) : null;

  return [
    `## ${TOOL_LABELS[item.name] ?? item.name}`,
    "",
    `路径：${path}${range}`,
    "",
    fence(content ?? "（没有可显示的内容）", "text"),
    ...(error === null ? [] : ["", `错误：${error}`]),
  ].join("\n");
}

function formatWebSearch(item: ConversationToolItem): string {
  const result = parseRecord(item.result);
  const value = recordValue(result?.value);
  const results = Array.isArray(value?.results) ? value.results : [];
  const lines = results.flatMap((entry, index) => {
    const record = recordValue(entry);
    const title = stringValue(record?.title);
    const url = stringValue(record?.url);
    if (title === null || url === null) return [];
    const description = stringValue(record?.description);
    return [`${index + 1}. [${title}](${url})${description === null ? "" : ` - ${description}`}`];
  });
  return formatListTool(item, lines, "没有返回网页结果。");
}

function formatSearch(item: ConversationToolItem): string {
  const result = parseRecord(item.result);
  const value = recordValue(result?.value);
  const matches = Array.isArray(value?.matches) ? value.matches : [];
  const lines = matches.flatMap((entry) => {
    const record = recordValue(entry);
    const path = stringValue(record?.path);
    const line = typeof record?.line === "number" ? String(record.line) : null;
    const text = stringValue(record?.text);
    return path === null || line === null ? [] : [`- ${path}:${line}${text === null ? "" : ` ${text}`}`];
  });
  return formatListTool(item, lines, "没有匹配结果。");
}

function formatFindFiles(item: ConversationToolItem): string {
  const result = parseRecord(item.result);
  const value = recordValue(result?.value);
  const matches = Array.isArray(value?.matches)
    ? value.matches.filter((entry): entry is string => typeof entry === "string")
    : [];
  return formatListTool(item, matches.map((entry) => `- ${entry}`), "没有找到文件。");
}

function formatDirectory(item: ConversationToolItem): string {
  const result = parseRecord(item.result);
  const value = recordValue(result?.value);
  const entries = Array.isArray(value?.entries) ? value.entries : [];
  const lines = entries.flatMap((entry) => {
    const record = recordValue(entry);
    const path = stringValue(record?.path);
    const kind = stringValue(record?.kind);
    return path === null ? [] : [`- ${kind === null ? "条目" : kind}：${path}`];
  });
  return formatListTool(item, lines, "目录为空。");
}

function formatListTool(item: ConversationToolItem, lines: readonly string[], empty: string): string {
  const result = parseRecord(item.result);
  const error = result === null || result.ok !== true ? errorText(result) : null;
  return [
    `## ${TOOL_LABELS[item.name] ?? item.name}`,
    "",
    lines.length === 0 ? empty : lines.join("\n"),
    ...(error === null ? [] : ["", `错误：${error}`]),
  ].join("\n");
}

function formatGenericTool(item: ConversationToolItem): string {
  const result = parseRecord(item.result);
  const error = result === null || result.ok !== true ? errorText(result) : null;
  const value = recordValue(result?.value);
  const summary = value === null
    ? "工具已调用，但没有可导出的结构化结果。"
    : Object.entries(value)
      .filter(([key, entry]) => key !== "id" && typeof entry !== "object" && typeof entry !== "function")
      .map(([key, entry]) => `${key}：${String(entry)}`)
      .join("\n") || "工具已调用，但没有可导出的结构化结果。";
  return [
    `## ${TOOL_LABELS[item.name] ?? item.name}`,
    "",
    `状态：${commandStatusLabel(item.status)}`,
    "",
    summary,
    ...(error === null ? [] : ["", `错误：${error}`]),
  ].join("\n");
}

function parseRecord(payload: string | null): RecordValue | null {
  if (payload === null) return null;
  try {
    const value: unknown = JSON.parse(payload);
    return recordValue(value);
  } catch {
    return null;
  }
}

function recordValue(value: unknown): RecordValue | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as RecordValue
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function numberOrNull(value: unknown): number | null {
  return typeof value === "number" ? value : null;
}

function errorText(result: RecordValue | null): string {
  const error = stringValue(result?.error);
  if (error !== null) return redactErrorIdentifiers(error);
  const agentError = recordValue(result?.agentError);
  return redactErrorIdentifiers(stringValue(agentError?.message) ?? "工具调用失败。");
}

function diffPath(diff: string | null): string | null {
  if (diff === null) return null;
  for (const line of diff.split(/\r?\n/u)) {
    if (!line.startsWith("+++ ") && !line.startsWith("--- ")) continue;
    const candidate = line.slice(4).split("\t", 1)[0] ?? "";
    if (candidate === "/dev/null") continue;
    return candidate.replace(/^[ab][\\/]/u, "");
  }
  return null;
}

function shellLanguage(shell: string): string {
  switch (shell) {
    case "powershell":
    case "pwsh":
      return "powershell";
    case "cmd":
      return "bat";
    case "bash":
      return "bash";
    default:
      return "text";
  }
}

function commandStatusLabel(status: string): string {
  switch (status) {
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "cancelled":
      return "已停止";
    case "awaiting_approval":
      return "等待确认";
    case "running":
      return "执行中";
    default:
      return status;
  }
}

function fence(content: string, language: string): string {
  const longestRun = Math.max(0, ...([...content.matchAll(/`+/gu)].map((match) => match[0].length)));
  const marker = "`".repeat(Math.max(3, longestRun + 1));
  return `${marker}${language}\n${content}\n${marker}`;
}
