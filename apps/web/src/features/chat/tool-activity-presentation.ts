import type { ConversationToolItem } from "@agent/protocol";
import { createDiffPresentation } from "../../components/diff/diff-view.js";
import { parseCommandResult } from "./command-tool-result-model.js";
import { isRecord, parseToolPayload, parseToolValue } from "./tool-result-payload.js";
import { fileNameFromPath } from "./workspace-tool-result-model.js";

export function toolStatusLabel(status: ConversationToolItem["status"]): string {
  switch (status) {
    case "running":
      return "执行中";
    case "awaiting_approval":
      return "等待确认";
    case "completed":
      return "已完成";
    case "failed":
      return "失败";
    case "rejected":
      return "已拒绝";
    case "cancelled":
      return "已失效";
  }
}

export function workspaceTerminalApprovalLabel(item: ConversationToolItem): string | null {
  if (item.name === "create_terminal" || item.name === "open_terminal") {
    return "等待确认后打开侧边终端";
  }
  if (item.name === "execute_terminal_command") return "等待确认后向侧边终端发送命令";
  if (item.name !== "terminal_control") return null;
  const argumentsValue = parseToolPayload(item.arguments);
  switch (argumentsValue?.action) {
    case "create":
      return "等待确认后打开侧边终端";
    case "write":
      return "等待确认后向侧边终端发送命令";
    case "close":
      return "等待确认后关闭侧边终端";
    default:
      return "等待确认后操作侧边终端";
  }
}

export function toolActivityLabel(item: ConversationToolItem, teamManaged = false): string {
  const argumentsValue = parseToolPayload(item.arguments);
  const path = typeof argumentsValue?.path === "string" ? argumentsValue.path : null;
  const completed = item.status === "completed";

  switch (item.name) {
    case "run_command": {
      const description = typeof argumentsValue?.description === "string" ? argumentsValue.description.trim() : "";
      if (description.length > 0) return description;
      const command = typeof argumentsValue?.command === "string" ? argumentsValue.command : null;
      const commandResult = item.result === null ? null : parseCommandResult(item.result);
      const mode = argumentsValue?.mode === "service"
        || commandResult?.mode === "service"
        || (argumentsValue?.mode === undefined && typeof argumentsValue?.serviceName === "string")
        ? "service"
        : "batch";
      const serviceName = typeof argumentsValue?.serviceName === "string"
        ? argumentsValue.serviceName
        : command;
      if (mode === "service") {
        if (commandResult?.status === "running") {
          return serviceName === null ? "服务已启动" : `已启动 ${serviceName}`;
        }
        if (commandResult?.status === "completed") {
          return serviceName === null ? "服务已结束" : `${serviceName} 已结束`;
        }
        return serviceName === null ? "启动后台服务" : `启动 ${serviceName}`;
      }
      if (commandResult?.status === "running") {
        return command === null ? "命令正在后台运行" : `后台运行 ${command}`;
      }
      return command === null
        ? (completed ? "已运行命令" : "运行命令")
        : `${completed ? "已运行" : "运行"} ${command}`;
    }
    case "terminal_control": {
      const action = typeof argumentsValue?.action === "string" ? argumentsValue.action : null;
      switch (action) {
        case "create":
          return completed ? "侧边终端已打开" : "打开侧边终端";
        case "list":
          return completed ? "已查看侧边终端" : "查看侧边终端";
        case "write": {
          const command = typeof argumentsValue?.command === "string"
            ? argumentsValue.command
            : null;
          return command === null
            ? (completed ? "命令已发送到侧边终端" : "向侧边终端发送命令")
            : `${completed ? "已发送" : "发送"} ${command}`;
        }
        case "read":
          return completed ? "已读取侧边终端输出" : "读取侧边终端输出";
        case "close":
          return completed ? "侧边终端已关闭" : "关闭侧边终端";
        default:
          return completed ? "侧边终端操作已完成" : "操作侧边终端";
      }
    }
    case "wait_for_commands": {
      const commandIds = Array.isArray(argumentsValue?.commandIds) ? argumentsValue.commandIds : [];
      return completed
        ? `已等待 ${commandIds.length} 条后台命令`
        : `等待 ${commandIds.length} 条后台命令`;
    }
    case "stop_command":
      return completed ? "后台命令已停止" : "停止后台命令";
    case "list_project_operations":
      return completed ? "已查看项目操作" : "查看项目操作";
    case "wait_for_project_operation":
      return completed ? "项目操作等待结束" : "等待项目操作";
    case "read_file":
      return path === null
        ? (completed ? "已读取文件" : "读取文件")
        : `${completed ? "已读取" : "读取"} ${fileNameFromPath(path)}`;
    case "read_external_file":
      return path === null
        ? (completed ? "已读取工作区外文件" : "读取工作区外文件")
        : `${completed ? "已读取" : "读取"} ${path}`;
    case "read_attachment":
      return completed ? "已读取附件" : "读取附件";
    case "view_image":
      return `${completed ? "已查看" : "查看"} 1 张图像`;
    case "generate_images": {
      const result = item.result === null ? null : parseToolPayload(item.result);
      const value = isRecord(result?.value) ? result.value : null;
      const count = completed && typeof value?.count === "number" ? value.count : typeof argumentsValue?.count === "number" ? argumentsValue.count : 1;
      return `${completed ? "已生成" : "生成"} ${count} 张图片`;
    }
    case "load_skill": {
      const result = item.result === null ? null : parseToolPayload(item.result);
      const value = isRecord(result?.value) ? result.value : null;
      const skill = isRecord(value?.skill) ? value.skill : null;
      return `${completed ? "已加载技能" : "加载技能"}${typeof skill?.name === "string" ? ` · ${skill.name}` : ""}`;
    }
    case "present_html": {
      const value = item.result === null ? null : parseToolValue(item.result);
      const presentation = isRecord(value?.presentation) ? value.presentation : null;
      const reuseLabel = typeof argumentsValue?.sourceRef === "string" ? " · 复用源码" : "";
      const sourceLanguage = argumentsValue?.language ?? value?.language ?? presentation?.language;
      const language = sourceLanguage === "react" ? "React" : sourceLanguage === "vue" ? "Vue" : "HTML";
      if (argumentsValue?.action === "inspect") return `${completed ? "已检查" : "检查"} ${language} 预览${reuseLabel}`;
      const pages = argumentsValue?.pages ?? presentation?.pages;
      if (Array.isArray(pages)) return `${completed ? "已展示" : "展示"} ${pages.length} 个 HTML 方案${reuseLabel}`;
      const sourcePath = path ?? (typeof presentation?.path === "string" ? presentation.path : null);
      return `${completed ? "已展示" : "展示"} ${language}${sourcePath === null ? "" : ` · ${sourcePath}`}${reuseLabel}`;
    }
    case "view_attachments": {
      if (Array.isArray(argumentsValue?.paths)) return `${completed ? "已查看" : "查看"} ${argumentsValue.paths.length} 张图像`;
      const attachmentIds = Array.isArray(argumentsValue?.attachment_ids)
        ? argumentsValue.attachment_ids
        : [];
      return `${completed ? "已查看" : "查看"} ${attachmentIds.length} 个附件`;
    }
    case "list_directory":
      return path === null || path.length === 0 ? "查看工作区目录" : `查看 ${path}`;
    case "search_text": {
      const query = typeof argumentsValue?.query === "string" ? argumentsValue.query : null;
      return query === null ? "搜索文本" : `搜索 “${query}”`;
    }
    case "web_search": {
      const query = typeof argumentsValue?.query === "string" ? argumentsValue.query : null;
      return query === null ? "搜索网页" : `搜索网页 “${query}”`;
    }
    case "find_files": {
      const pattern = typeof argumentsValue?.pattern === "string" ? argumentsValue.pattern : null;
      return pattern === null ? "查找文件" : `查找 ${pattern}`;
    }
    case "computer_use": {
      const action = typeof argumentsValue?.action === "string" ? argumentsValue.action : "";
      const labels: Record<string, string> = { list: "查看授权软件", launch: "启动软件", observe: "查看窗口", screenshot: "截取窗口", click: "点击窗口", type: "输入文字", key: "按键", scroll: "滚动窗口" };
      return labels[action] ?? "电脑控制";
    }
    case "browser_control": {
      const action = typeof argumentsValue?.action === "string" ? argumentsValue.action : null;
      switch (action) {
        case "open":
          return completed ? "网页已打开" : "打开网页";
        case "list":
          return completed ? "已查看网页标签列表" : "查看网页标签列表";
        case "observe":
          return completed ? "已查看页面" : "查看页面";
        case "screenshot":
          return completed ? "已截取页面" : "截取页面";
        case "navigate":
          return completed ? "已跳转网页" : "跳转网页";
        case "back":
          return completed ? "网页已后退" : "后退网页";
        case "forward":
          return completed ? "网页已前进" : "前进网页";
        case "reload":
          return completed ? "网页已刷新" : "刷新网页";
        case "stop":
          return completed ? "网页加载已停止" : "停止网页加载";
        case "click":
          return completed ? "已点击页面元素" : "点击页面元素";
        case "move":
          return completed ? "已移动页面指针" : "移动页面指针";
        case "mouse_down":
          return completed ? "已按下页面鼠标" : "按下页面鼠标";
        case "mouse_up":
          return completed ? "已松开页面鼠标" : "松开页面鼠标";
        case "drag":
          return completed ? "已拖动页面元素" : "拖动页面元素";
        case "fill":
          return completed ? "已填写页面" : "填写页面";
        case "type":
          return completed ? "已向页面输入文字" : "向页面输入文字";
        case "select":
          return completed ? "已选择页面选项" : "选择页面选项";
        case "key":
          return completed ? "已向页面发送按键" : "向页面发送按键";
        case "scroll":
          return completed ? "已滚动页面" : "滚动页面";
        case "wait":
          return completed ? "页面等待结束" : "等待页面";
        case "close":
          return completed ? "网页已关闭" : "关闭网页";
        case "close_tabs":
          return completed ? "网页标签已关闭" : "关闭网页标签";
        case "show":
          return completed ? "已显示网页标签" : "显示网页标签";
        default:
          return `${completed ? "浏览器调用已结束" : "执行浏览器调用"} · ${action ?? "未记录操作类型"}`;
      }
    }
    case "write_file": {
      const overwrites = argumentsValue?.overwrite === true;
      if (!overwrites) return completed ? "文件已创建" : "创建文件";
      return completed ? "文件已编辑" : "编辑文件";
    }
    case "replace_in_file":
      return completed ? "文件已编辑" : "编辑文件";
    case "delete_file":
      return completed ? "文件已删除" : "删除文件";
    case "apply_patch":
      return completed ? "文件已编辑" : "编辑文件";
    case "get_project_info":
      return "读取项目信息";
    case "request_user_input":
      return "提问";
    case "create_task_list":
      return completed ? "任务清单已创建" : "创建任务清单";
    case "update_task_list":
      return completed ? "任务清单已更新" : "更新任务清单";
    case "close_task_list":
      return completed ? "任务清单已关闭" : "关闭任务清单";
    case "list_agent_conversations":
      return completed
        ? (teamManaged ? "已查看团队成员对话" : "已查看 Agent 对话")
        : (teamManaged ? "查看团队成员对话" : "查看 Agent 对话");
    case "read_agent_conversation":
      return completed
        ? (teamManaged ? "已读取团队成员对话" : "已读取 Agent 对话")
        : (teamManaged ? "读取团队成员对话" : "读取 Agent 对话");
    case "send_agent_message":
      return completed
        ? (teamManaged ? "团队成员消息已发送" : "Agent 消息已发送")
        : (teamManaged ? "发送团队成员消息" : "发送 Agent 消息");
    case "wait_for_agent_message":
      return completed
        ? (teamManaged ? "团队成员消息等待结束" : "Agent 消息等待结束")
        : (teamManaged ? "等待团队成员消息" : "等待 Agent 消息");
    case "spawn_subagent":
      return completed
        ? (teamManaged ? "团队成员已启动" : "Subagent 已启动")
        : (teamManaged ? "启动团队成员" : "启动 Subagent");
    case "list_subagents":
      return completed
        ? (teamManaged ? "已查看团队成员" : "已查看 Subagent")
        : (teamManaged ? "查看团队成员" : "查看 Subagent");
    case "wait_for_subagents":
      return completed
        ? (teamManaged ? "团队成员等待结束" : "Subagent 等待结束")
        : (teamManaged ? "等待团队成员" : "等待 Subagent");
    default:
      return item.name;
  }
}

type ToolBatchCategory = {
  iconToolName: string;
  label: (count: number) => string;
  names: readonly string[];
  priority: number;
};

export const TOOL_BATCH_CATEGORIES: readonly ToolBatchCategory[] = [
  {
    iconToolName: "write_file",
    label: (count) => `编辑 ${count} 个文件`,
    names: ["write_file", "replace_in_file", "apply_patch", "delete_file"],
    priority: 100,
  },
  {
    iconToolName: "terminal_control",
    label: (count) => `操作 ${count} 次侧边终端`,
    names: [
      "terminal_control",
      "create_terminal",
      "open_terminal",
      "execute_terminal_command",
      "read_terminal_output",
    ],
    priority: 95,
  },
  {
    iconToolName: "run_command",
    label: (count) => `运行 ${count} 条命令`,
    names: ["run_command", "wait_for_commands", "stop_command"],
    priority: 90,
  },
  {
    iconToolName: "read_file",
    label: (count) => `读取 ${count} 个文件`,
    names: ["read_file", "read_external_file", "read_attachment", "view_attachments", "view_image"],
    priority: 80,
  },
  {
    iconToolName: "search_text",
    label: (count) => `查询 ${count} 项信息`,
    names: ["list_directory", "search_text", "web_search", "find_files", "get_project_info"],
    priority: 70,
  },
  {
    iconToolName: "list_project_operations",
    label: (count) => `协调 ${count} 项项目操作`,
    names: ["list_project_operations", "wait_for_project_operation"],
    priority: 60,
  },
  {
    iconToolName: "browser_control",
    label: (count) => `操作 ${count} 次浏览器`,
    names: ["browser_control"],
    priority: 55,
  },
  {
    iconToolName: "create_task_list",
    label: (count) => `管理 ${count} 项任务`,
    names: ["create_task_list", "update_task_list", "close_task_list"],
    priority: 50,
  },
  {
    iconToolName: "spawn_subagent",
    label: (count) => `执行 ${count} 次 Agent 协作`,
    names: [
      "list_agent_conversations",
      "read_agent_conversation",
      "send_agent_message",
      "wait_for_agent_message",
      "spawn_subagent",
      "list_subagents",
      "wait_for_subagents",
    ],
    priority: 40,
  },
];

function toolBatchCategoryCounts(tools: ConversationToolItem[]): Array<{
  category: ToolBatchCategory;
  count: number;
}> {
  return TOOL_BATCH_CATEGORIES
    .map((category) => ({
      category,
      count: tools.filter((tool) => category.names.includes(tool.name)).length,
    }))
    .filter(({ count }) => count > 0);
}

export function representativeToolName(tools: ConversationToolItem[]): string {
  return toolBatchCategoryCounts(tools)
    .sort((left, right) => right.category.priority - left.category.priority)[0]
    ?.category.iconToolName ?? tools[0]?.name ?? "tool";
}

export function toolBatchLabel(
  tools: ConversationToolItem[],
  teamManaged = false,
): string {
  const labels = toolBatchCategoryCounts(tools)
    .sort((left, right) => right.category.priority - left.category.priority)
    .slice(0, 2)
    .map(({ category, count }) => (
      teamManaged && category.iconToolName === "spawn_subagent"
        ? `协调 ${count} 次团队成员`
        : category.label(count)
    ));

  return labels.length > 0 ? labels.join("，") : `调用了 ${tools.length} 个工具`;
}

function isActiveTool(item: ConversationToolItem): boolean {
  return item.status === "running" || item.status === "awaiting_approval";
}

/** Returns the last active tool in display order for a collapsed batch summary. */
export function latestActiveTool(
  tools: readonly ConversationToolItem[],
): ConversationToolItem | null {
  return tools.findLast(isActiveTool) ?? null;
}

/** Describes the tool that is currently holding a collapsed batch open. */
export function toolBatchCurrentToolLabel(
  tools: readonly ConversationToolItem[],
  teamManaged = false,
): string | null {
  const activeTool = latestActiveTool(tools);
  if (activeTool === null) return null;
  const state = activeTool.status === "awaiting_approval" ? "等待审批" : "正在执行";
  const fileChange = fileChangeSummary(activeTool);
  const label = fileChange === null ? toolActivityLabel(activeTool, teamManaged)
    : `${fileChange.action} ${fileChange.path}`;
  return `${state}：${label}`;
}

/** Returns a mode only when the whole visible batch shares one scheduler mode. */
export function toolBatchExecutionMode(
  tools: readonly ConversationToolItem[],
): "parallel" | "serial" | null {
  if (tools.length < 2) return null;
  const modes = new Set(tools.map((tool) => tool.executionMode ?? "serial"));
  if (modes.size !== 1) return null;
  const mode = [...modes][0];
  return mode === "parallel" || mode === "serial" ? mode : null;
}

type FileChangeSummary = {
  action: string;
  additions: number | null;
  deletions: number | null;
  path: string;
};

export function fileChangeSummary(item: ConversationToolItem): FileChangeSummary | null {
  if (!isFileChangeToolName(item.name)) return null;

  const argumentsValue = parseToolPayload(item.arguments);
  const argumentPath = typeof argumentsValue?.path === "string"
    ? argumentsValue.path
    : null;
  const diffPayload = item.diff
    ?? (typeof argumentsValue?.patch === "string" ? argumentsValue.patch : null);
  const presentation = diffPayload === null ? null : createDiffPresentation(diffPayload);
  const path = presentation?.path !== undefined && presentation.path !== "文件变更"
    ? presentation.path
    : argumentPath;
  if (path === null || path === undefined || path.length === 0) return null;

  return {
    action: fileChangeActionLabel(item),
    additions: presentation?.additions ?? null,
    deletions: presentation?.deletions ?? null,
    path,
  };
}

function fileChangeActionLabel(item: ConversationToolItem): string {
  const completed = item.status === "completed";
  switch (item.name) {
    case "write_file": {
      const argumentsValue = parseToolPayload(item.arguments);
      const overwrites = argumentsValue?.overwrite === true;
      return overwrites
        ? (completed ? "已编辑" : "编辑文件")
        : (completed ? "已创建" : "创建文件");
    }
    case "delete_file":
      return completed ? "已删除" : "删除文件";
    case "apply_patch":
    case "replace_in_file":
      return completed ? "已编辑" : "编辑文件";
    default:
      return toolActivityLabel(item);
  }
}

function isFileChangeToolName(name: string): boolean {
  return name === "write_file"
    || name === "replace_in_file"
    || name === "apply_patch"
    || name === "delete_file";
}
