# AI Agent 产品与技术方案总览

> 文档状态：初稿  
> 更新时间：2026-08-15  
> 当前阶段：需求与技术准备  
> 适用范围：本地桌面 AI Agent 第一阶段，不包含 Java 服务端方案

## 1. 文档目的

本文档用于统一产品目标、核心诉求、需求边界、技术选型和实施顺序，作为后续原型、架构设计、任务拆分和验收的基础。

当前不直接进入完整功能开发。首先需要确认最小产品边界，并通过技术原型验证浏览器控制、终端执行、模型工具调用和桌面打包等高风险链路。

## 2. 产品定位

本产品第一阶段是一款本地优先的桌面 AI Agent 团队工作台，同时要求 React UI 可以脱离 Electron 在普通浏览器中渲染。用户持续向一个长期存在的团队负责人投递想法和任务；负责人能直接处理简单任务，也能按任务需要委派临时 Subagent、复用常驻 Agent 或组织少量 Worker 并行协作。团队在用户明确授权的项目内读取资料、修改文件、执行命令、操作 Git，并通过受控浏览器完成网页访问和交互。桌面端提供完整本机能力；独立 Web UI 是否连接远程 Agent Runtime，属于后续部署能力。

新产品明确复用现有 `md-king` 的 React UI、工作台布局、Markdown 编辑器、实时预览、Word 预览和相关样式，不重新开发一套编辑与渲染界面。在这套成熟界面上增加会话、任务、工具调用、审批、终端和受管浏览器能力。新产品不是单纯的 Markdown 工具扩展，而是以“可执行任务的 Agent 工作台”为核心。

目标用户主要包括：

- 需要 AI 协助完成开发、文档和资料处理任务的个人用户。
- 同时使用 Windows、PowerShell、WSL、Git 和浏览器的技术用户。
- 希望看到 Agent 实际过程，并对文件写入、命令和网页提交保持控制的用户。

## 3. 核心诉求

### 3.1 真正完成任务

产品不能停留在聊天和建议层面。Agent 应能在授权范围内形成“理解任务 -> 制定步骤 -> 调用工具 -> 检查结果 -> 继续或纠正 -> 汇报”的闭环。

### 3.2 本地优先

项目文件、终端、Git、浏览器状态和会话记录默认保存在本机。除模型请求和用户主动启用的外部服务外，不依赖远程业务后端才能工作。

### 3.3 过程透明

用户应能看到：

- Agent 当前在做什么以及为什么做。
- 调用了哪个工具、使用了哪些参数。
- 命令的实时输出、退出码和耗时。
- 文件修改前后的 Diff。
- 哪些操作正在等待授权。
- 任务最终完成、失败或被阻塞的原因。

### 3.4 操作可控

读取、写入、执行、联网和网页提交必须有明确的权限边界。高风险操作不能因为模型给出了工具调用就直接执行。

### 3.5 可恢复

长任务不能只存在于内存。应用异常退出或用户重启后，应能恢复会话、工具调用记录和任务状态，并明确哪些步骤已完成、哪些步骤不能安全重放。

### 3.6 长期稳定使用

大文档、大目录、长输出和长会话不能导致界面持续卡死或内存无限增长。所有性能结论都需要在发布构建下通过可复现基准验证。

### 3.7 为扩展留边界，不提前建设插件市场

第一阶段实现统一工具协议、基础 MCP Client 和本地 Skill 管理，但不建设插件商店、任意 UI 插件加载和复杂的第三方插件生命周期。

### 3.8 复用已经完成并验证的能力

`md-king` 已经完成的 Markdown 编辑、实时渲染、Word 分页预览、文件树、文档标签、主题和布局属于新产品的既有资产。Agent 项目只为新工作流调整页面组合和系统接口，不用通用组件替换已经达到预期效果的实现。

### 3.9 持续接单和按需组队

团队负责人应长期存在，并在旧任务运行时继续接收新任务。系统根据任务复杂度选择直接执行、轻量委派或团队协作，不能把简单任务强行拆成冗长流程。缺少合适能力且确有并行收益时，负责人可以在预算和并发上限内创建临时 Agent；完整规则见[多 Agent 团队与任务调度设计](./05-多Agent团队与任务调度设计.md)。

## 4. 第一阶段产品边界

### 4.1 P0：必须具备

1. **会话与任务**
   - 创建、继续、停止和恢复会话。
   - 流式显示模型输出和 Agent 执行过程。
   - 明确区分模型消息、工具调用、工具结果、审批和系统事件。

2. **工作区**
   - 项目会话自动绑定项目根目录；临时对话可通过系统目录选择器显式附加一个会话工作目录。
   - 浏览目录、按文件名跨层查找、读取文件、搜索文本。
   - 所有文件能力默认限制在工作区根目录内。

3. **文件修改**
   - 以补丁或明确的文件写入操作修改内容。
   - 写入前后生成可审查 Diff。
   - 支持接受、拒绝或撤销本轮尚未提交的修改。

4. **终端与命令**
   - 支持 PowerShell 和常用非交互命令。
   - 实时返回 stdout、stderr、退出码和耗时。
   - 支持取消、超时和终止进程树。

5. **Git**
   - 查看仓库状态和 Diff。
   - 第一阶段不默认允许 Agent 自动提交或推送。

6. **模型接入**
   - 支持配置多个供应商、请求地址、对话协议和模型，OpenAI-compatible 只是其中一种 Adapter。
   - 每个模型可配置上下文窗口、输入/输出上限和输出预留。
   - 支持流式响应和结构化 Tool Calling。
   - 新 Agent 支持继承、固定或自动选择模型，用户可以通过 UI 或对话修改后续模型。
   - 模型密钥保存在系统凭据存储中。

7. **MCP 与 Skill**
   - 支持本地和远程 MCP Server 的配置、能力发现、启停与健康检查。
   - 支持内置、用户和项目 Skill 的发现、启停、依赖与按需加载。
   - MCP 和 Skill 调用统一经过项目权限、审批、超时、取消和审计。

8. **权限与审批**
   - 工作区外访问、文件写入、命令执行和网页提交具有独立策略。
   - 审批界面必须展示真实操作对象，不能只显示笼统的“是否允许”。

9. **浏览器 Agent 原型**
   - 打开受管浏览器页面。
   - 获取页面结构或可操作元素快照。
   - 支持导航、点击、输入、等待和截图。
   - 使用独立浏览器 Profile，不直接接管用户日常浏览器数据。

10. **多 Agent 团队**
   - 一个长期 Team Lead 持续接收用户投递的任务。
   - AI 可以根据复杂度主动把 WorkItem 拆成可恢复的任务列表，并逐项完成或动态修订。
   - 任务列表与 Agent 数量解耦，同一 Agent 也可以顺序完成全部 Task。
   - 简单任务直接执行，复杂任务可委派临时 Subagent 或启动少量 Worker。
   - 支持可恢复的常驻 Agent Thread、共享任务列表、依赖、消息和状态。
   - Team Lead、常驻 Agent 和临时 Subagent 都有可查看的独立 Thread。
   - 自动扩容受并发、Token、时间、权限和文件冲突限制。
   - 一个团队可登记多个项目，但每个执行任务只绑定一个主项目。

11. **上下文与长期记忆**
   - UI 保留完整本地历史，模型上下文按 Token 预算构建。
   - Team、Project、Agent Thread 和单次 Task 的摘要分层保存，不能混成一段公共长对话。
   - 大型工具输出和 Agent 交付物使用 Artifact，负责人只接收相关摘要和引用。
   - 当前任务、未完成审批、用户明确约束和项目边界不得被压缩丢失。

### 4.2 P1：基础闭环稳定后增加

- Bash、WSL 和更多 Shell 适配。
- 多标签浏览器、下载和上传处理。
- 自动模型回退链、成本路由、供应商熔断和更细的预算策略。
- MCP OAuth、远程账户授权、Skill 分发和版本更新。
- 更高级的跨任务记忆检索、摘要重建和长期任务检查点策略。
- 工作区文件监听和外部修改冲突提示。
- 可配置的只读工具自动授权规则。
- 应用自动更新和崩溃恢复完善。

### 4.3 P2：暂不进入第一阶段

- 多人实时协作。
- 云端任务调度和远程执行集群。
- 企业 SSO、组织权限和集中审计服务。
- 开放式插件市场和任意第三方 UI 插件。
- 内置向量数据库和通用知识库平台。
- 自动 Git 推送、自动发布和默认无人值守执行。
- 自研大模型或本地模型推理框架。

## 5. 技术选型

### 5.1 总体选择

第一阶段采用以 TypeScript 为主的桌面架构：

```text
Electron + React + TypeScript
Node.js Agent Runtime
SQLite + MCP + 受控本地工具
浏览器自动化引擎
```

选择 Electron 的主要原因是浏览器能力属于核心需求。Electron 自带 Chromium，跨平台页面行为相对一致，也便于展示受控网页、管理页面生命周期并接入 Chromium DevTools Protocol。

现阶段不引入 Java。Rust 也不作为 Agent 编排或命令执行的必需层；只有后续出现明确的系统级性能、安全或沙箱需求时，才评估增加小型原生辅助程序。

### 5.2 具体技术

| 领域 | 选择 | 用途与边界 |
| --- | --- | --- |
| 桌面运行时 | Electron | 窗口、系统集成、进程生命周期、浏览器容器 |
| 前端 | React + TypeScript + Vite | 独立 Web UI，同时作为 Electron Renderer；承载 Agent 工作台、Markdown、Diff、终端和审批界面 |
| UI 设计系统 | shadcn/ui `radix-nova` + Radix + Tailwind CSS 4 + CVA + Lucide | 沿用 md-king 的视觉语言，以项目自有组件源码和语义 Token 维护 |
| 包管理 | pnpm workspace | 管理桌面端、Agent Core、工具和公共协议包 |
| 状态管理 | 继续使用 md-king 现有 Zustand Store 模式 | 管理 UI 级会话、面板和交互状态；持久数据不只存在 Store 中 |
| Agent Runtime | Node.js + TypeScript + LangGraph | `AgentRuntime` 保留为应用 façade；LangGraph 接管内部执行图、循环、条件路由、中断恢复和图状态 Checkpoint |
| 模型层 | LangChain Core/Provider + `ModelProviderAdapter` | 由 LangChain Provider 负责协议、流式和 Tool Calling；中立 Adapter 合同、上下文预算和业务事件仍由项目维护 |
| 图状态存储 | LangGraph `BaseCheckpointSaver` + 项目 `node:sqlite` 适配器 | 使用现有 SQLite 能力保存可恢复图状态；不把 `better-sqlite3` 直接带入 Electron |
| 数据校验 | Zod + JSON Schema | 工具入参、IPC 消息、配置和模型结构化输出校验 |
| 工具扩展 | 官方 MCP TypeScript SDK | 接入外部工具；不赋予 MCP Server 隐式本机权限 |
| 浏览器自动化 | Playwright / CDP | 页面导航、定位、交互、截图和下载；具体嵌入方式先做 PoC |
| 内嵌网页 | Electron WebContentsView | 显示受管网页；不与应用 Renderer 共用权限上下文 |
| Markdown 编辑器 | 直接复用 md-king `LiveMarkdownEditor` | 保留现有 CodeMirror 6 基础、Lezer Markdown、实时装饰、表格、图片、Mermaid、Callout、链接和编辑交互 |
| Markdown/Word 预览 | 直接复用 md-king `WordPreviewPage` 及相关样式与分页逻辑 | 保留现有 markdown-it、KaTeX、Mermaid、模板样式和分页预览效果 |
| 终端 UI | xterm.js | 展示交互式终端和实时输出 |
| PTY | node-pty（P1） | PowerShell、Bash、WSL 等交互终端；不阻塞第一阶段非交互命令闭环 |
| 子进程 | Node child_process | 非交互命令、超时、取消和输出采集 |
| 文件监听 | chokidar | 监测工作区被外部程序修改 |
| 文本搜索 | 随应用分发 ripgrep | 快速搜索代码与大目录文本 |
| Git | 系统 Git CLI | 保持与用户仓库行为一致，避免重复实现 Git |
| 本地数据库 | SQLite + Drizzle ORM | 会话、事件、审批、设置和恢复检查点 |
| 密钥存储 | Electron `safeStorage` | 加密后写入独立凭据文件，不在 SQLite、日志或普通配置中保存明文密钥 |
| 日志 | pino | 本地结构化日志、运行诊断和错误定位 |
| 单元测试 | Vitest 4 | 覆盖 Agent Core、权限策略、工具、协议和 Renderer Adapter |
| 端到端测试 | Playwright | Electron UI、浏览器工具和关键任务闭环测试 |
| Electron 构建 | tsup + electron-builder | 构建 Main/Preload，打包 Web 资源与桌面安装包 |

### 当前稳定版本基线

依赖默认使用当日可用的最新稳定版，不主动引入 RC、beta 或 nightly。当前基线为：

| 组件 | 版本 |
| --- | --- |
| Node.js | 24.x |
| pnpm | 10.15.x |
| Electron | 43.4.x |
| React / React DOM | 19.2.x |
| Vite | 8.2.x |
| TypeScript | 6.0.x |
| ESLint | 10.8.x |
| Zustand | 5.0.15 |
| Radix Select | 2.3.7 |
| markdown-it | 15.0.x |

TypeScript 7 已发布，但当前稳定 `typescript-eslint` 尚未支持其编译 API，因此此项目暂时固定在兼容的最新 6.0.x；当 lint 生态完成支持后再升级，不能为了版本号牺牲 CI 可用性。

### 5.3 明确不采用的方案

- 不采用 Python 作为第一阶段 Agent 主运行时。需要 OCR、数据处理或本地模型时，可作为独立 MCP 工具接入。
- 不采用 Rust 重写 Node 已能可靠完成的文件、Git 和命令能力。
- 不使用 Vercel AI SDK 或 LangChain 高层 AgentExecutor 接管业务生命周期；本项目采用 LangGraph 图作为内部编排，并保留 AgentRuntime 的应用边界。详细决策见[LangChain 与 LangGraph 改造方案](./15-LangChain与LangGraph改造方案.md)。
- 不让 Renderer 直接获得 Node、文件系统、Shell 或密钥权限。
- 不在第一阶段设计“万物皆插件”的复杂架构。

### 5.4 md-king 复用边界

CodeMirror 6 是 `md-king` 编辑器的底层能力，不是用来替换现有渲染效果的新方案。现有效果来自以下代码共同组成的完整编辑与预览系统：

- `LiveMarkdownEditor`：编辑器生命周期、输入、搜索、快捷键和变更调度。
- `cm/live-preview`：Obsidian 式实时预览、可见区装饰和块级组件。
- `cm/widgets`：表格、图片、Mermaid、任务列表、Callout 和链接等交互组件。
- `cm/theme` 与项目 CSS：编辑器排版、颜色、暗色主题和组件外观。
- `WordPreviewPage`：基于 markdown-it 的 Word 样式分页预览。
- `AppShell`、文件树和文档标签：现有桌面工作台布局。

这些模块原则上整体迁移和复用，不使用 CodeMirror 默认主题或新的通用 Markdown Renderer 重做。需要改造的是运行时边界：原来通过 Tauri API 调用系统能力的代码，改为调用统一的 `AgentClient` 接口；Electron 中由 Preload IPC 实现，独立 Web 中由 HTTP/WebSocket 或 Mock Adapter 实现。纯 React、TypeScript、CodeMirror 和 CSS 代码尽量保持不变。

如果新 Agent 第一阶段继续保留 DOCX 转换能力，应单独评估现有 Rust/Pandoc 转换核心是作为 sidecar 保留，还是后续迁移。该问题不影响前端 Markdown 编辑与渲染代码的直接复用。

## 6. 软件架构

```text
┌──────────────── Shared React Web UI ──────────────┐
│ Chat / Task / Markdown / Diff / xterm / Approval │
└───────────────┬───────────────────┬───────────────┘
                │ DesktopTransport  │ WebTransport
                │ Preload IPC       │ HTTP/WebSocket
┌───────────────▼──────────────┐    │
│ Electron Main               │    │ Future Web Server
│ Permission / Lifecycle      │    │ (not in phase 1)
└───────────────┬──────────────┘    │
                └───────────┬───────┘
┌───────────────────────────▼───────────────────────┐
│ Agent Runtime / Storage / Controlled Tools        │
│ Model / Context / File / Git / Process / PTY / MCP│
└───────────────────────────┬───────────────────────┘
                            │
┌───────────────────────────▼───────────────────────┐
│ Managed Browser / CDP / Playwright / Profile      │
└───────────────────────────────────────────────────┘
```

### 6.1 Renderer

Renderer 只负责展示和用户交互。必须启用 `contextIsolation`，关闭 `nodeIntegration`。所有系统能力都通过有限、具名、经过校验的 Preload API 调用。

### 6.2 Electron Main

Main 进程负责窗口、IPC、安全策略、审批协调和进程生命周期。它不承载大量同步计算，避免阻塞整个桌面应用。

### 6.3 Agent Runtime

Agent Runtime 负责 Team Lead、任务调度、Agent 生命周期以及模型与工具之间的循环，但没有绕过权限策略的能力。建议与 Main 保持清晰模块边界；是否使用 Electron `utilityProcess` 独立运行，在原型阶段通过崩溃隔离和通信成本验证后确定。

### 6.4 Tool Runtime

所有本机操作都建模为结构化工具：

```text
list_files       read_file        search_text
apply_patch      write_file       git_status
git_diff         run_command      terminal_input
browser_control  load_skill       read_skill_reference
```

每个工具至少包含：工具标识、用途说明、输入 Schema、权限级别、超时、可取消性、结果大小限制和审计字段。

### 6.5 Session Event Store

会话不能只保存最终聊天文本。SQLite 中应追加记录关键事件，例如：

```text
user_message
assistant_delta
assistant_message
tool_requested
approval_requested
approval_resolved
tool_started
tool_output
tool_completed
tool_failed
task_checkpoint
task_completed
task_cancelled
```

恢复时以已完成事件为事实来源，不能自动重放未确认的写操作、命令或网页提交。

### 6.6 UI 运行模式

同一套 `apps/web` React UI 支持三种运行模式：

| 模式 | UI | Agent 能力 | 第一阶段状态 |
| --- | --- | --- | --- |
| 浏览器预览/开发 | Vite 浏览器页面 | Mock 数据或有限演示能力 | 支持 |
| Electron 桌面版 | Electron 加载同一 Web UI | 完整本机文件、Git、Shell、PTY 和受管浏览器 | 主交付目标 |
| 完整 Web 版 | 浏览器页面连接 Node Agent Server | 远程工作区、容器/沙箱和远程浏览器 | 后续阶段 |

浏览器中的普通网页不能直接获得用户本机文件系统、Shell、Git 和 PTY 权限。完整 Web 版必须新增服务端鉴权、工作区隔离、任务队列、远程执行沙箱和 WebSocket 流式通道，不能让前端直接复用 Electron IPC。

Electron 的 `WebContentsView` 只存在于桌面版。未来 Web 版如需展示 Agent 操作浏览器，应由服务端 Playwright 控制远程浏览器并传回截图、语义快照和事件；不能依赖 `iframe` 嵌入任意网站，因为会受到 CSP、`X-Frame-Options` 和跨域限制。

## 7. Agent 核心设计

单个执行 Agent 仍采用可控的小型 Agent Loop；团队层在 Agent Loop 外负责持续收件、任务拆分、路由和生命周期，不把自由群聊当成调度器：

```text
接收用户任务
  -> 构建当前上下文
  -> 请求模型
  -> 解析模型输出或工具调用
  -> 校验工具参数和权限
  -> 必要时等待用户审批
  -> 执行工具并记录事件
  -> 将有限结果返回模型
  -> 检查完成、失败、取消或继续条件
```

核心模块保持在以下边界：

- `ModelAdapter`：屏蔽模型供应商协议差异。
- `AgentLoop`：控制一次任务的模型与工具循环。
- `TeamSupervisor`：长期接收任务、决定直接执行或委派，并对最终交付负责。
- `TaskScheduler`：维护任务依赖、候选过滤、租约、并发和预算。
- `AgentRegistry`：保存 Agent Profile、常驻成员、临时实例和项目熟悉度。
- `ContextBuilder`：选择当前任务所需内容，避免无限堆积上下文。
- `ToolRegistry`：注册工具、Schema 和执行器。
- `PermissionPolicy`：判断允许、拒绝或需要用户审批。
- `SessionEventStore`：持久化消息、工具与任务事件。
- `McpManager`：启动、连接和关闭外部 MCP Server。
- `BrowserController`：管理受管浏览器、页面和 Profile。

模型不能直接执行 JavaScript、Shell 或文件写入。模型只能生成符合 Schema 的工具请求。

### 7.1 会话、任务轮次与消息

团队与单 Agent 对话采用两个层级，避免把持续收件、任务分解和模型轮次混为一谈：

```text
Team
  ├─ Team Lead Thread
  ├─ Projects
  └─ WorkItem
      └─ Task（绑定一个 Project，可形成依赖图）
          └─ Agent Thread / Run
```

单个 Agent 的执行记录仍采用：

```text
Session（会话）
  └─ Run（一次用户任务）
      ├─ Turn（一次模型推理及其后续工具循环）
      ├─ Message / Content Block
      ├─ Tool Call / Tool Result
      └─ Artifact（完整日志、Diff、截图等附件）
```

- `Session`：用户在侧边栏看到的一条对话，可包含多次连续任务。
- `Run`：从一条用户请求开始，到完成、失败、取消或阻塞结束。
- `Turn`：一次模型请求与响应；模型调用工具后可以产生下一个 Turn。
- `Message`：用户、模型或系统可见消息。
- `Content Block`：文本、推理状态、工具调用、工具结果、审批、图片和引用等结构化内容。
- `Artifact`：不适合直接塞进消息正文的大型内容，例如完整终端日志、网页快照、截图和大 Diff。

`WorkItem` 是用户持续投递的一项需求或想法；`Task` 是可调度、可验收且绑定单一项目的执行单元。Team Lead Thread、常驻 Agent Thread 和临时 Agent Run 分别持久化，不能共享一段无限增长的原始上下文。

这里的 `Thread` 表示逻辑对话链，不是操作系统线程。Agent 空闲时只保留数据库状态；产生 Run 后才由共享异步调度器、固定 Worker Pool 和受限子进程池执行，不为每个 Agent 常驻一个线程或进程。

当前会话的完整事实以 SQLite 事件和本地 Artifact 为准。Zustand 只保存当前页面需要的内存状态，不作为会话唯一数据源。

### 7.2 UI 对话与模型上下文分离

用户界面可以展示完整历史，但模型不应在每次请求中收到整段历史。二者必须分开：

```text
本地完整会话
  原始消息 + 工具调用 + 完整结果 + 审批 + Artifact

模型本次上下文
  系统规则
  + 当前任务与权限
  + 历史结构化摘要
  + 最近完整消息
  + 当前相关文件/工具结果
```

压缩只生成新的上下文材料，不能修改或删除原始消息。用户仍能展开查看压缩前的对话、命令和工具结果。

### 7.3 上下文预算

`ContextBuilder` 在每次请求前根据当前模型的上下文窗口计算预算：

```text
可用输入预算
= 模型上下文上限
- 预留输出 Token
- 系统提示词
- 工具 Schema
- 安全余量
```

输入内容按以下优先级装配：

1. 系统规则、权限边界和当前工作区。
2. 当前用户请求和当前 Run 的完整消息。
3. 尚未解决的错误、审批和工具调用结果。
4. 最近若干轮完整对话。
5. 旧对话的结构化摘要。
6. 与当前任务相关的文件片段、搜索结果和 Artifact 摘要。

不按固定“保留最近 N 条消息”作为唯一策略，因为一条终端输出可能比几十条普通消息更大。所有判断以模型 Token 预算和内容优先级为准。

### 7.4 分层压缩策略

采用四层上下文，而不是反复总结整段对话：

| 层级 | 内容 | 处理方式 |
| --- | --- | --- |
| L0 | 当前用户请求、未完成工具调用、审批 | 永不压缩 |
| L1 | 当前 Run 和最近完整对话 | 尽量保留原文 |
| L2 | 较早对话 | 转为结构化会话摘要 |
| L3 | 大日志、网页快照、文件和 Diff | 本地保存 Artifact，只向模型提供索引和相关片段 |

建议在预计输入达到可用预算约 `70%` 时后台准备压缩，在接近 `85%` 时必须先完成压缩再继续调用。阈值需要按不同模型和真实任务基准调整，不能写死在 UI 中。

### 7.5 增量摘要

压缩只处理尚未摘要的旧前缀。每份摘要记录自己覆盖到哪个 `event_id`，下一次从该位置继续，避免每轮重新总结整个会话。

结构化摘要至少包含：

```text
用户目标
当前任务状态
已经确认的需求和约束
关键技术决定及原因
已读取或修改的文件
重要工具结果、命令、错误和测试
用户明确否定的方案
尚未完成事项
下一步建议
```

摘要不能只写成自然语言段落。文件路径、命令、错误文本、标识符、测试结果和用户约束应以结构化字段保存，降低摘要遗漏关键事实的风险。

生成新摘要后执行基本校验：

- 覆盖范围必须连续，不能跳过事件。
- 当前未完成任务和未处理审批必须保留。
- 用户明确要求、禁止事项和已经作出的技术决定必须保留。
- 文件路径、工具调用 ID 和 Artifact 引用必须仍能解析。
- 新摘要写入成功后才允许模型使用，原始事件始终保留。

### 7.6 工具输出压缩

工具结果是上下文膨胀的主要来源，应在进入模型前单独处理：

- 小结果直接进入上下文。
- 长终端输出保留开头、结尾、错误行和匹配行，完整内容写入 Artifact。
- 搜索结果限制每个文件和全局命中数量，保留路径与行号。
- 大文件只传递与任务相关的片段，不把整文件反复加入上下文。
- Diff 保留文件列表和相关区块，超大 Diff 存为 Artifact。
- 浏览器 DOM 使用语义快照和可操作元素，不发送完整页面源码。
- 图片按模型能力和当前任务选择性发送，不在后续每轮重复附带。

工具输出截断必须明确标注，向模型提供 Artifact ID，允许模型在需要时调用工具继续读取，不能让模型误以为截断内容就是完整结果。

### 7.7 会话恢复与压缩可见性

- 应用重启后从 SQLite 事件恢复 Session、Run、消息和工具状态。
- 运行中断时，将 Run 标记为 `interrupted`，不自动重放命令、写文件或网页提交。
- UI 在发生上下文压缩时记录一个轻量事件，例如“较早对话已整理为上下文摘要”。
- 用户可以查看当前摘要及其覆盖范围，也可以回看所有原始消息。
- 切换模型后重新按新模型的窗口计算上下文，不复用旧模型的 Token 估算。
- 删除会话时同时处理数据库记录、Artifact 和浏览器临时 Profile，避免只删 UI 列表项。

### 7.8 第一阶段实现范围

P0 只实现一条主分支，不做复杂的对话树：

- 创建、重命名、继续、停止和删除会话。
- 每条用户请求对应一个 Run。
- 原始事件完整持久化。
- 最近消息 + 单份增量结构化摘要。
- 工具大输出 Artifact 化。
- Token 预算触发压缩。
- 中断恢复和压缩记录可查看。

编辑旧消息后创建分支、多个摘要层级合并、跨会话长期记忆和自动知识库检索放到后续阶段。它们不应阻塞第一版对话闭环。

### 7.9 对话存储方案

正式存储采用 **SQLite 数据库 + Artifact 文件目录**，JSON 只作为导入导出和调试格式，不作为运行时主数据库。

```text
应用数据目录/
├─ agent.db                    # 团队、项目、任务、会话、事件、摘要和 Artifact 索引
└─ artifacts/
   └─ <session-id>/
      ├─ terminal-<id>.log     # 完整终端输出
      ├─ diff-<id>.patch       # 大型 Diff
      ├─ browser-<id>.json     # 网页语义快照
      └─ screenshot-<id>.png   # 浏览器截图
```

SQLite 至少包含以下逻辑表：

| 表 | 主要内容 |
| --- | --- |
| `teams` / `projects` | 长期团队、已授权项目和团队项目关系 |
| `work_items` / `tasks` | 持续收件、项目级任务、依赖、优先级和当前状态 |
| `agent_profiles` / `agent_instances` | 能力定义、常驻/临时 Agent、负载和生命周期 |
| `agent_threads` / `agent_messages` | Team Lead 与成员的持续对话、委派和 Agent 间消息 |
| `sessions` | 会话标题、创建时间、最近活动时间和状态 |
| `runs` | 每次用户任务的开始、结束、状态和所用模型 |
| `messages` | 用户、模型和系统消息及完成状态 |
| `content_blocks` | 文本、工具调用、工具结果、审批和引用等结构化消息块 |
| `events` | 任务执行过程的追加式事件流和顺序号 |
| `summaries` | 结构化上下文摘要及其覆盖的事件范围 |
| `artifacts` | 外部文件的相对路径、类型、大小、哈希和所属会话 |

关系、时间、状态和顺序字段使用普通数据库列；不同类型消息的可变内容可以存为经过 Zod 校验的 JSON 字段。这样保留 JSON 的灵活性，同时具备 SQLite 的事务、索引、查询和迁移能力。

不使用“每个会话一个 JSON 文件”作为主存储，主要原因是：

- 流式消息和工具事件会频繁追加，整文件反复读写成本高。
- 应用异常退出时更容易留下半写入或损坏文件。
- 会话列表、全文搜索、分页和状态筛选需要扫描大量文件。
- 消息、工具、审批、摘要和附件之间的关联难以维护。
- 数据结构升级时缺少可靠的事务和 Migration。

数据库运行要求：

- 开启 WAL，提高读取列表与后台写入并行时的稳定性。
- 开启外键约束，并使用版本化 Migration 管理 Schema。
- 一次工具状态变更或消息完成使用事务提交。
- 流式模型输出先在内存聚合，按时间或块大小批量落盘，不为每个 Token 单独写数据库。
- 应用退出或 Run 结束时强制刷新剩余缓冲区。
- Artifact 使用相对路径并记录 SHA-256、大小和 MIME 类型。
- 删除会话时通过统一清理流程处理数据库记录和 Artifact，失败时保留可重试记录。

SQLite 默认不提供内容加密。第一阶段依赖操作系统用户目录权限保护会话文件；模型 API Key 不进入 SQLite，必须存入系统 Credential Store。后续如果确定存在本地会话加密需求，再评估 SQLCipher 或字段级加密，不能把普通 SQLite 宣称为已加密存储。

导出时生成版本化 JSON 清单，并将相关 Artifact 一并打包：

```text
conversation-export.zip
├─ manifest.json
├─ conversation.json
└─ artifacts/
```

导入前校验版本、Schema、文件大小和哈希。导入数据只恢复会话内容，不自动执行其中记录的命令、工具调用或网页操作。

## 8. 权限与安全基线

### 8.1 文件权限

- 工作区由用户主动选择并持久授权。
- 会话只保存授权根目录；模型工具接收相对路径，当前根目录由 Runtime 根据会话动态注入，不由模型查询或传入。
- 路径必须规范化后再检查是否位于工作区内。
- 符号链接、目录穿越和 Windows 路径差异必须有测试。
- 文件外部变化时，覆盖前要求重新读取并提示冲突。

### 8.2 命令权限

- 命令执行显示完整命令、工作目录和目标环境。
- 区分只读命令、修改性命令和高风险命令。
- 不仅依赖字符串黑名单；审批、工作目录和进程隔离共同生效。
- 支持超时、取消、输出上限和整个进程树终止。
- 默认不允许后台遗留长期进程，明确启动的服务除外。

### 8.3 浏览器权限

- Agent 使用独立 Profile。
- DOM 快照、截图和下载均视为可能包含敏感信息。
- 上传文件、发送消息、提交表单、支付和删除操作必须审批。
- 网页内容属于不可信输入，不能通过页面文字改变系统权限策略。
- 浏览器页面和应用 UI 使用不同的安全上下文。

### 8.4 MCP 权限

- MCP Server 必须由用户显式配置或安装。
- 每个 MCP Server 声明可见工具和启动命令。
- MCP 工具仍经过本产品的权限策略，不因协议接入而自动可信。
- 子进程环境变量按最小范围传递，不默认继承全部密钥。

## 9. UI 与交互原则

第一屏就是可使用的 Agent 工作台，不制作营销式首页。整体视觉、标题栏、活动栏、文件树、标签页、编辑器、Word 预览、主题和可调整面板优先沿用 `md-king`。在此基础上扩展为稳定的三栏或可收起布局：

- 左侧：工作区、会话和文件导航。
- 中间：聊天、任务步骤、工具调用和审批。
- 右侧：文件、Diff、终端或浏览器等上下文视图。

### 9.1 md-king 布局复用原则

Agent 桌面端不重新设计一套应用外壳，直接以 `md-king` 当前布局为基线：

- 复用 `AppShell` 的全屏桌面工作台结构。
- 复用 `AppTitlebar` 的窗口标题栏和窗口操作区域。
- 复用 `ActivityBar` 的主功能切换方式，并增加 Agent、浏览器等入口。
- 复用文件树、目录宽度调整和显示/收起行为。
- 复用文档标签、编辑器区域、文档大纲和侧边抽屉。
- 复用编辑器与预览区域的可调整、收起和放大交互。
- 复用亮色/暗色主题、色彩变量、字体、图标和紧凑型桌面视觉规范。
- 复用现有响应式与长文档性能保护，不因接入 Agent 退回到全量渲染。

Agent 功能以增量方式进入现有布局：

```text
标题栏：继续使用 md-king 标题栏
活动栏：新增 Agent、工作区、浏览器等主入口
左侧栏：文件树或会话/任务列表
中央工作台：Agent 对话/任务过程，或现有 Markdown 编辑器
右侧工作区：Markdown/Word 预览、Diff、终端、浏览器
底部或浮层：审批、状态和长任务进度
```

具体页面组合可以随 Agent 工作流调整，但组件视觉、拖拽尺寸、折叠逻辑和交互习惯保持一致。只有现有布局确实无法承载 Agent 工作流时才局部改造，不以“换成 Electron”为理由重写 UI。

迁移复用的是视觉和交互合同，不是原样复制现有页面结构。AppShell、标题栏和活动栏按新项目分层重新实现；CodeMirror、Markdown 和预览等行为复杂模块在测试保护下迁移。详细规则见[界面迁移与设计系统规范](./07-界面迁移与设计系统规范.md)。

关键交互要求：

- 工具运行状态不能导致布局跳动。
- 长输出采用虚拟化、折叠和截断，原始日志可按需查看。
- Diff 必须区分模型建议、已写入工作区和已提交到 Git 的状态。
- 审批卡展示精确对象；MVP 只提供“本次批准/拒绝”，会话级授权在权限模型稳定后再增加。
- 长任务持续显示当前阶段、运行时间、取消入口和最近事件。
- Markdown、代码块、表格和工具输出在大内容下保持可滚动和可复制。

## 10. 非功能需求

### 10.1 稳定性

- 单个工具失败不能导致整个应用退出。
- 浏览器或 Agent Worker 崩溃后，UI 保持可用并能呈现失败原因。
- 应用退出时正确终止由其启动的临时进程。
- 数据库写入具备事务边界，避免半条事件破坏会话恢复。

### 10.2 性能

当前不虚构固定性能数字。建立发布构建基线后，再将指标转为验收阈值。至少测量：

- 冷启动和首次可交互时间。
- 大目录扫描、文件树展开和全文搜索。
- 长会话渲染时的 DOM 数量与内存增长。
- 大 Markdown、超长工具输出和大 Diff 的渲染。
- 模型流式输出期间的 UI 响应性。
- 连续任务、浏览器多页面和 PTY 长时间运行的资源释放。
- 应用重启后的任务恢复时间和一致性。

### 10.3 跨平台

第一阶段以 Windows 为主验证环境，同时避免将核心协议绑定到 PowerShell。Shell、路径、进程终止、凭据存储和打包均通过平台适配层封装，为后续 macOS 和 Linux 验证保留边界。

### 10.4 可测试性

- Agent Loop 使用模拟模型输出做确定性测试。
- 工具 Schema、权限判断和路径边界必须有单元测试。
- 文件与 Git 工具使用临时仓库做集成测试。
- 命令取消、超时和进程树终止使用真实子进程测试。
- 浏览器工具使用固定本地测试站点，不依赖不稳定公网页面。
- 发布包必须做安装、启动、升级和卸载冒烟测试。

## 11. 建议的代码仓库结构

### 11.1 项目数量

第一阶段建立 **1 个 Git 仓库、2 个应用入口、5 个公共 package，共 7 个 pnpm workspace 模块**。其中 `apps/web` 是可独立在浏览器中渲染的 React UI，`apps/desktop` 是加载该 UI 的 Electron 壳。第一阶段不启动 Java、Python 或远程服务项目。

| 模块 | 类型 | 职责 |
| --- | --- | --- |
| `apps/web` | React/Vite 应用 | 复用的 md-king UI、Agent 工作台和跨宿主 `AgentClient` 接口 |
| `apps/desktop` | Electron 应用 | Main、Preload、窗口与本机 Runtime 装配；加载 `apps/web` |
| `packages/protocol` | 纯 TypeScript 库 | IPC、事件、消息、工具、审批等 Zod Schema 与公共协议 |
| `packages/agent-core` | 纯 TypeScript 库 | Team Lead、任务调度、Agent Loop、模型适配、上下文构建和压缩 |
| `packages/storage` | Node.js 库 | SQLite、团队/任务/会话事件、摘要、Artifact 索引和 Migration |
| `packages/local-tools` | Node.js 库 | 文件、搜索、Patch、Git、命令、PTY 和 MCP 进程管理 |
| `packages/browser-runtime` | Node.js 库/独立运行单元 | 受管浏览器、Profile、页面快照、CDP/Playwright 工具 |

这里的“7 个模块”仍属于同一个软件和同一个仓库，不是 7 套需要分别部署的后端服务。`packages` 也不等于后端目录：`protocol` 是前后端共享协议，`agent-core` 是不依赖 UI 的核心业务；`storage`、`local-tools` 和 `browser-runtime` 才是 Node 本地执行模块。

### 11.2 目录结构

```text
Agent/
├─ doc/
├─ apps/
│  ├─ web/
│  │  └─ src/
│  │     ├─ components/       # md-king UI 与 Agent 组件
│  │     ├─ pages/            # Agent、编辑器、设置等页面
│  │     └─ runtime/          # Desktop/Web/Mock AgentClient 适配
│  └─ desktop/
│     ├─ package.json
│     └─ src/
│        ├─ main/             # Electron Main、加载 apps/web、窗口和权限入口
│        └─ preload/          # 暴露给 Web UI 的最小类型化 IPC
├─ packages/
│  ├─ protocol/               # IPC、消息、模型、MCP、Skill、工具和审批 Schema
│  ├─ agent-core/             # Team、调度、Agent Loop、模型、Skill、Context、压缩
│  ├─ storage/                # 团队/任务/会话 SQLite、Artifact 和 Migration
│  ├─ local-tools/           # 文件、Git、命令、PTY、MCP
│  └─ browser-runtime/       # 浏览器生命周期和自动化
├─ scripts/                  # 构建、打包和开发辅助脚本
└─ tests/
   ├─ fixtures/
   └─ e2e/
```

### 11.3 模块依赖方向

```text
desktop/main ───────> agent-core ───────> protocol
      │                    │
      ├────────────> storage ───────────> protocol
      ├────────────> local-tools ───────> protocol
      └────────────> browser-runtime ───> protocol

desktop ──────────── loads ─────────────> web
web ────────────────────────────────────> protocol

future web-server ──> agent-core / storage / tools
```

- `protocol` 不依赖任何其他业务模块，避免 IPC 两端类型漂移。
- `agent-core` 不直接访问 Electron UI，通过接口调用工具和存储。
- `local-tools` 和 `browser-runtime` 不依赖 Renderer，防止系统权限进入页面。
- `storage` 不依赖 Agent 的具体界面，保证会话恢复可独立测试。
- 模块之间不允许循环依赖。

### 11.4 暂时不拆出的模块

- **UI 组件库**：`apps/web` 本身就是桌面与浏览器共用的 UI 应用。出现第二套独立 UI 产品后再抽取组件 package。
- **model-adapters**：第一阶段模型适配放在 `agent-core/models`；接入多个差异明显的供应商后再独立成包。
- **mcp-runtime**：第一阶段放在 `local-tools/mcp`；只有其生命周期和权限模型明显独立后再拆包。
- **shared**：不建立含义不清的公共包；真正跨边界的类型进入 `protocol`。
- **插件 SDK**：第一阶段没有第三方插件开发者，不提前创建。
- **远程后端**：本地闭环尚未稳定前，不建立账号、同步、团队和任务调度服务。

### 11.5 md-king 与 Agent 的关系

`md-king` 是现有源码资产和迁移来源，不作为 Agent 运行时必须同时启动的第二个项目。第一阶段将其 AppShell、编辑器、预览和样式迁入 `apps/web`，并将 Tauri 调用替换为统一 `AgentClient` 接口。桌面运行时使用 Preload IPC Adapter；浏览器开发预览使用 Mock Adapter；未来完整 Web 版使用 HTTP/WebSocket Adapter。

暂不建立跨两个 Git 仓库的共享 UI package，以免在产品边界尚未稳定时引入联动发布。Agent UI 稳定后，再根据 `md-king` 是否继续独立演进决定是否抽取共享包。

如果确定保留 DOCX 转换和 Word/WPS 快捷粘贴，可以增加可选的 `sidecars/docx-converter`，复用现有 Rust/Pandoc 核心。该模块不属于第一阶段默认的 7 个模块，必须在产品需求确认后再加入。

## 12. 技术验证清单

正式搭建产品骨架前，先完成以下小型 PoC：

1. **Electron 安全 IPC**
   - Renderer 通过有限 Preload API 请求读取临时工作区文件。
   - 验证 Renderer 无法直接访问 Node 和任意文件路径。

2. **模型 Tool Calling**
   - 模型连续调用 `list_files -> read_file`，工具参数经过 Zod 校验。
   - 验证流式消息、工具事件和取消行为。

3. **终端与进程管理**
   - 启动 PowerShell、持续读取输出、发送输入并取消。
   - 验证子进程树没有残留。

4. **浏览器控制**
   - 在用户可见的受管页面中完成导航、快照、点击、输入和截图。
   - 重点验证 Playwright/CDP 与 Electron `WebContentsView` 的稳定连接方式。
   - 如果无法稳定控制同一可见页面，应在“Electron CDP 直控”和“独立 Playwright Chromium”之间选定一种，不维护两份不同步的网页状态。

5. **事件持久化与恢复**
   - 执行中强制关闭应用，重启后恢复消息和已完成工具记录。
   - 未完成写操作不得自动重放。

6. **发布构建基线**
   - 在 Windows 发布包中验证模型、SQLite、node-pty、ripgrep 和浏览器能力。
   - 记录安装包大小、冷启动、空闲内存和持续任务资源曲线。

## 13. 分阶段实施路线

### 阶段 0：技术原型

完成第 12 节的验证，不追求完整 UI。输出每条链路的实测结论和风险决定。

### 阶段 1：最小可用 Agent

完成单 Agent 的文件读取与搜索、补丁修改、命令执行、Diff、审批和模型 Provider 基础合同，形成端到端任务闭环；随后加入模型中心、至少两类 Provider Adapter、MCP、Skill 和 Agent 独立 Thread。

### 阶段 2：团队调度、浏览器与任务恢复

加入最多三个 Worker、自动扩容、多项目任务绑定、Agent 模型继承与动态切换、受管浏览器工具、会话事件恢复、上下文控制、取消机制和长任务稳定性测试。

### 阶段 3：扩展与跨平台

增加模型回退与成本路由、MCP 远程授权、Skill 分发、WSL/Bash 适配，并开始 macOS/Linux 验证。是否开放插件体系由真实扩展需求决定。

## 14. 当前已确定事项

- 产品形态为本地桌面 AI Agent 团队工作台，而不是纯聊天客户端。
- React UI 独立位于 `apps/web`，既作为 Electron Renderer，也可以在普通浏览器中渲染。
- 复用 `md-king` 已验证的 CodeMirror、Markdown 渲染和 Word 预览行为，不重新实现 Markdown 渲染器；迁移时按最小依赖闭包拆分并保留测试基线。
- 以 `md-king` 的 AppShell、标题栏、活动栏、文件树、标签页和可调整面板作为视觉与交互基线，按 Agent 项目的组件分层和宿主边界重新实现外壳。
- 浏览器控制是重要能力，因此桌面壳优先选择 Electron。
- 主技术语言为 TypeScript，前端使用 React，Agent Runtime 使用 Node.js。
- 第一阶段不引入 Java 后端，也不要求 Rust 执行层。
- 文件、Shell、Git、浏览器和 MCP 都必须经过统一工具及权限边界。
- 会话采用事件记录，支持审计和恢复。
- 对话主存储采用 SQLite，大型结果使用 Artifact 文件目录，JSON 仅用于导入导出。
- 第一阶段先建立闭环和稳定性，不建设多人平台与插件市场。
- Team Lead 长期存在并持续接单；简单任务直接处理，复杂任务才委派或组队。
- Team 可登记多个 Project，但每个 Task 只有一个主 Project，跨项目需求拆成子任务。
- 每个 Agent 都有独立可查看的 Thread；模型默认继承父对话，也可由用户指定、自动路由或动态修改。
- MCP 和 Skill 属于基础能力，完整规则见[模型接入、MCP、Skill 与 Agent 对话设计](./08-模型接入、MCP、Skill与Agent对话设计.md)。
- MVP 只有 Team Lead 能创建 Worker，默认最多三个并发 Worker，禁止递归组队。

## 15. 开工默认决定与需验证事项

### 15.1 开工默认决定

为避免实现阶段静默选择，第一阶段按以下基线开工：

1. 首要场景是 Windows 本地编码 Agent。
2. 桌面端交付完整能力，Web 端先保证同一 UI 可渲染并使用 Mock Runtime。
3. 模型通过 `ModelProviderAdapter` 接入；先用一个真实 Provider 打通闭环，再以第二类 Provider 合同测试证明多厂商边界。
4. 工作区内读取和搜索默认允许；模型发起的文件写入、Patch 和命令逐次审批。
5. PowerShell 非交互命令进入 MVP；WSL、SSH、Bash 和交互式 PTY 放到 P1。
6. `md-king` UI 迁移到 `apps/web`，第一阶段不建立跨仓库共享 UI package。
7. DOCX 转换和 Word/WPS 快捷粘贴不进入 MVP，继续保留在原 `md-king` 产品。
8. SQLite 是第一阶段会话事实来源，JSON/JSONL 只用于导出或诊断。
9. 多 Agent 采用“管理者保持最终所有权”的分层调度，不采用无边界群聊。
10. 团队支持多个已登记项目；任务执行前必须解析到唯一主项目。

### 15.2 必须通过 PoC 决定

以下问题不能只靠文档推断，必须用运行结果确定：

1. Electron `WebContentsView`、CDP 与 Playwright 能否稳定控制用户看到的同一页面。
2. `better-sqlite3` 在 Electron 发布包中的 ABI rebuild、Migration 和首次启动是否稳定。
3. Windows 取消命令时能否可靠终止完整进程树。
4. 迁移后的长 Markdown、长会话、大 Diff 和长工具输出是否保持可接受的 DOM 与内存规模。
5. 至少两类 Provider Adapter 对可配置请求地址、对话协议、上下文窗口、流式 Tool Calling、取消和能力声明是否符合统一合同。
6. 本地与远程 MCP Server 的能力发现、取消、异常恢复和权限映射是否稳定。

PoC 失败时必须记录替代决定并更新本文档，不能在实现中长期保留两套未定方案。

## 16. 关联文档

- [第一阶段需求与验收标准](./01-第一阶段需求与验收标准.md)
- [多 Agent 团队与任务调度设计](./05-多Agent团队与任务调度设计.md)
- [前后端接口与数据约定](./02-前后端接口与数据约定.md)
- [md-king 迁移与开发计划](./03-md-king迁移与开发计划.md)
- [前后端模块与编码规范](./06-前后端模块与编码规范.md)
- [界面迁移与设计系统规范](./07-界面迁移与设计系统规范.md)
- [模型接入、MCP、Skill 与 Agent 对话设计](./08-模型接入、MCP、Skill与Agent对话设计.md)
- [能力路线图与扩展时机](./09-能力路线图与扩展时机.md)
