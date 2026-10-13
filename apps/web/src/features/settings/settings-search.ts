import type { SettingsSection } from "../../stores/workbench-ui-store.js";

export type SettingsSearchItem = {
  section: SettingsSection;
  label: string;
  selector: string;
  keywords?: string;
  agentView?: "agents" | "teams";
};

// Index setting names and aliases, never configuration values or credentials.
export const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
  { section: "general", label: "显示上下文与缓存用量", selector: '[aria-label="显示上下文与缓存用量"]', keywords: "Token 消耗" },
  { section: "general", label: "发送快捷键", selector: '[aria-label="发送快捷键"]', keywords: "Enter Ctrl 回车" },
  { section: "general", label: "运行中消息投递", selector: '[aria-label="运行中消息默认投递方式"]', keywords: "排队 插队" },
  { section: "general", label: "对话列表", selector: '[aria-label="显示对话列表"]', keywords: "侧栏 显示 隐藏" },
  { section: "general", label: "右侧工作区", selector: '[aria-label="显示右侧工作区"]', keywords: "面板 显示 隐藏" },
  { section: "general", label: "Aster 数据目录", selector: "#storage-location-heading", keywords: "存储 路径 文件夹" },
  { section: "appearance", label: "主题", selector: '[aria-label="主题"]', keywords: "浅色 深色 暗色 light dark" },
  { section: "appearance", label: "界面字号", selector: '[aria-label="界面字号"]', keywords: "字体 大小" },
  { section: "appearance", label: "对话字号", selector: '[aria-label="对话字号"]', keywords: "字体 大小 聊天" },
  { section: "appearance", label: "代码编辑器字号", selector: '[aria-label="代码编辑器字号"]', keywords: "字体 大小" },
  { section: "appearance", label: "对话目录宽度", selector: '[aria-label="对话目录宽度"]', keywords: "面板 尺寸 侧栏" },
  { section: "appearance", label: "设置菜单宽度", selector: '[aria-label="设置菜单宽度"]', keywords: "面板 尺寸 侧栏" },
  { section: "appearance", label: "右侧工作区宽度", selector: '[aria-label="右侧工作区宽度"]', keywords: "面板 尺寸" },
  { section: "permissions", label: "新对话权限模式", selector: '[aria-label="新对话权限模式"]', keywords: "规划 请求审批 完全访问" },
  { section: "permissions", label: "审批处理方式", selector: '[aria-label="审批处理方式"]', keywords: "由我确认 AI 帮我审批" },
  { section: "permissions", label: "文件读取权限", selector: '[aria-label="文件读取权限"]', keywords: "工具 直接允许 请求审批 禁用" },
  { section: "permissions", label: "工作区搜索权限", selector: '[aria-label="工作区搜索权限"]', keywords: "工具 直接允许 请求审批 禁用" },
  { section: "permissions", label: "文件修改权限", selector: '[aria-label="文件修改权限"]', keywords: "工具 写入 直接允许 请求审批 禁用" },
  { section: "permissions", label: "命令与终端权限", selector: '[aria-label="命令与终端权限"]', keywords: "工具 执行 命令权限 直接允许 请求审批 禁用" },
  { section: "permissions", label: "浏览器操作权限", selector: '[aria-label="浏览器操作权限"]', keywords: "工具 直接允许 请求审批 禁用" },
  { section: "models", label: "供应商名称", selector: '[name="providerName"]' },
  { section: "models", label: "官网地址", selector: '[name="providerWebsiteUrl"]' },
  { section: "models", label: "API 格式", selector: '[aria-label="API 格式"]', keywords: "OpenAI Responses Chat Completions Anthropic" },
  { section: "models", label: "请求地址", selector: '[name="baseUrl"]', keywords: "Base URL 接口" },
  { section: "models", label: "API Key", selector: '[name="apiKey"]', keywords: "密钥 令牌" },
  { section: "models", label: "备注", selector: '[name="providerNote"]' },
  { section: "models", label: "模型名称", selector: '[aria-label$="的模型名称"]', keywords: "模型 ID" },
  { section: "models", label: "推理强度", selector: '[aria-label*="的已启用推理强度"]', keywords: "思考 reasoning" },
  { section: "models", label: "上下文窗口", selector: '[aria-label$="的上下文窗口"]', keywords: "Token 容量" },
  { section: "models", label: "默认模型", selector: '[aria-label="选择默认模型"]' },
  { section: "models", label: "上下文自动压缩", selector: '[aria-label="压缩阈值模式"]', keywords: "阈值 百分比 Token" },
  { section: "agents", label: "Agent 名称", selector: '[aria-label="名称"]', agentView: "agents" },
  { section: "agents", label: "Agent 角色", selector: '[aria-label="角色"]', agentView: "agents" },
  { section: "agents", label: "Agent 用途说明", selector: '[aria-label="用途说明"]', agentView: "agents" },
  { section: "agents", label: "Agent 提示词", selector: '[id^="agent-instructions-"]', keywords: "系统指令 prompt", agentView: "agents" },
  { section: "agents", label: "Agent 模型策略", selector: "#agent-model-strategy-heading", keywords: "继承对话 自动选择 固定模型", agentView: "agents" },
  { section: "agents", label: "Agent 权限规则", selector: '[id^="agent-permissions-"]', keywords: "工具 匹配规则", agentView: "agents" },
  { section: "agents", label: "团队名称", selector: '[aria-label="团队名称"]', agentView: "teams" },
  { section: "agents", label: "团队说明", selector: '[aria-label="团队说明"]', agentView: "teams" },
  { section: "agents", label: "团队指令", selector: '[aria-label="团队指令"]', keywords: "提示词 prompt", agentView: "teams" },
  { section: "agents", label: "团队成员编排", selector: '.team-members-section', keywords: "添加 Agent", agentView: "teams" },
  { section: "agents", label: "团队项目范围", selector: '[aria-label="团队项目范围"]', agentView: "teams" },
  { section: "mcp", label: "名称", selector: '[data-config-path="name"]' },
  { section: "mcp", label: "ID", selector: '[data-config-path="id"]' },
  { section: "mcp", label: "传输方式", selector: '[data-config-path="transport"]', keywords: "stdio HTTP" },
  { section: "mcp", label: "命令", selector: '[data-config-path="command"]', keywords: "启动 stdio" },
  { section: "mcp", label: "URL", selector: '[data-config-path="url"]', keywords: "连接地址 HTTP" },
  { section: "mcp", label: "参数", selector: '[data-config-path="args"]' },
  { section: "mcp", label: "环境变量", selector: '[data-config-path="env"]' },
  { section: "mcp", label: "请求头", selector: '[data-config-path="headers"]', keywords: "headers" },
  { section: "mcp", label: "作用域", selector: '[data-config-path="scope"]', keywords: "全局 项目" },
  { section: "skills", label: "Skill 目录", selector: '[aria-label="新建 Skill 的目录"]', keywords: "扫描 路径 文件夹" },
  { section: "skills", label: "SKILL.md 路径", selector: '[data-settings-field="SKILL.md 路径"]', keywords: "文档 文件" },
  { section: "skills", label: "MCP 依赖", selector: '[data-settings-field="MCP 依赖"]' },
  { section: "skills", label: "作用域", selector: '[data-settings-field="作用域"]', keywords: "全局 项目" },
  { section: "browser", label: "默认搜索引擎", selector: '[aria-label="默认搜索引擎"]', keywords: "Bing Google 百度" },
  { section: "browser", label: "新标签默认缩放", selector: '[aria-label="新浏览器标签默认缩放"]', keywords: "比例 页面大小" },
  { section: "browser", label: "下载目录", selector: "#browser-download-directory", keywords: "保存路径 文件夹" },
  { section: "browser", label: "下载前询问保存位置", selector: '[aria-label="下载前询问保存位置"]', keywords: "下载 弹窗" },
  { section: "browser", label: "密码保存", selector: '[aria-label="保存并自动填充密码"]', keywords: "自动填充 登录" },
  { section: "browser", label: "已保存的密码", selector: "#browser-saved-passwords", keywords: "查看密码 登录账号" },
  { section: "browser", label: "清除浏览数据", selector: "#browser-privacy-heading", keywords: "缓存 Cookie 历史 密码 删除" },
  { section: "terminal", label: "默认 Shell", selector: '[aria-label="侧边终端默认 Shell"]', keywords: "PowerShell cmd bash" },
  { section: "terminal", label: "启动路径", selector: '[aria-label="终端启动路径"]', keywords: "工作目录 文件夹" },
  { section: "terminal", label: "输出字符集", selector: '[aria-label="输出字符集"]', keywords: "编码 UTF GBK 中文乱码" },
  { section: "terminal", label: "字体预设", selector: '[aria-label="终端字体预设"]' },
  { section: "terminal", label: "自定义字体栈", selector: '[aria-label="终端自定义字体"]' },
  { section: "terminal", label: "字号", selector: '[aria-label="终端字号"]', keywords: "字体 大小" },
  { section: "terminal", label: "行高", selector: '[aria-label="终端行高"]', keywords: "行距" },
];

export function matchesSettingsQuery(query: string, ...text: string[]): boolean {
  const searchable = text.join(" ").toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every((word) => searchable.includes(word));
}
