# LangChain 与 LangGraph 改造方案

> 文档状态：技术选型与迁移决策
> 决策日期：2026-08-19
> 适用范围：`apps/desktop` 的 Agent Runtime、模型适配、工具循环、Skill 上下文和可恢复执行
> 前置基线：`b009d52 checkpoint：LangGraph 改造前工作树`

## 1. 决策摘要

本项目采用 **LangChain Core/Provider + LangGraph**，替换当前 `AgentRuntime` 内部自研的模型/工具循环和状态流转。

`AgentRuntime` 不删除。它继续是 Electron Main、IPC 和现有业务调用方看到的应用入口与兼容 façade，负责项目边界、权限、审批、SQLite 业务事实、事件合同、Queue/Steer、Subagent 和错误映射。LangGraph 接管 façade 内部的执行图、节点循环、条件路由、中断恢复和图状态 Checkpoint。

这不是把所有业务搬进框架，也不是继续保留两套生产 Agent Loop：迁移完成后，旧的 `for` 循环和旧 Provider 协议解析从生产路径删除；Runtime 只保留应用边界适配。

## 2. 已确认的技术栈

| 层 | 最终选择 | 责任边界 |
| --- | --- | --- |
| 桌面容器 | Electron 43.4.x | Main、Preload、Renderer 生命周期和本机权限边界 |
| 运行时 | Node.js 24.x + TypeScript 6.x | 应用编排、工具、持久化和模型请求 |
| 图编排 | `@langchain/langgraph@1.4.10` | `StateGraph`、状态 reducer、条件边、循环、`interrupt`/`Command`、图级 Checkpoint |
| LangChain 基础层 | `@langchain/core@1.2.8` | `BaseChatModel`、消息、Tool/StructuredTool、Runnable 和中立模型合同 |
| OpenAI | `@langchain/openai@1.5.8` | Chat Completions 与 Responses 模型；OpenAI-compatible 端点使用 Chat Completions 配置 |
| Anthropic | `@langchain/anthropic@1.5.6` | Messages 模型、Tool Calling、Thinking 参数映射 |
| Google | `@langchain/google-genai@2.2.0` | Gemini Generate Content、Tool Calling 和 Thinking 参数映射 |
| 图 Checkpoint 合同 | `@langchain/langgraph-checkpoint`（由 LangGraph 引入） | `BaseCheckpointSaver`、Checkpoint/metadata/writes 合同 |
| 图 Checkpoint 存储 | 项目 `NodeSqliteCheckpointSaver`，基于现有 `node:sqlite` | 避免 Electron 原生 ABI 和重复 SQLite 驱动；保存图恢复状态，不替代业务数据库 |
| 业务数据库 | 现有 `AgentDatabase` + SQLite | 会话、消息、Run、Tool、审批、Subagent、附件和 UI 可见事实 |
| 校验 | Zod + JSON Schema | IPC、配置、Skill frontmatter、工具参数和持久化边界 |
| 上下文 | 现有 `ContextManager`/压缩器 + LangChain 消息转换 | Token 预算、历史裁剪、Checkpoint 摘要和附件策略仍由项目控制 |
| Skill | 现有 `SkillDocumentStore`/`parseSkillMarkdown` 加 Runtime `SkillCatalog/Loader` | 渐进发现、按需加载、版本/哈希快照和受预算约束的上下文注入 |
| 测试 | Vitest 4、Playwright | 图纯函数、适配器、Checkpoint、审批恢复、Runtime 合同和 UI 闭环 |

### 2.1 明确不采用

- 不采用 Vercel AI SDK 作为 Agent Runtime 或最终模型适配层。
- 不引入 `langchain` 元包、`@langchain/community` 或 AutoGen/CrewAI；只有出现明确的第二个真实消费者时才增加包。
- 不使用 `createReactAgent` 或旧 `AgentExecutor` 作为顶层运行时。它们无法直接表达本项目的业务事件、审批、Queue/Steer、Subagent 和原子终态合同。
- 不把 LangChain Memory 当作聊天历史事实源；UI 历史和业务持久化仍由 `AgentDatabase` 管理。
- 不把 `@langchain/langgraph-checkpoint-sqlite` 带入最终生产依赖。该包依赖 `better-sqlite3`，当前冒烟测试在 Node 24 中因缺少 native binding 直接失败，Electron ABI 还需要额外 rebuild；继续使用会引入与现有 `node:sqlite` 重复的驱动和打包风险。

## 3. 运行时职责分层

```text
Electron Bootstrap
  -> IPC Adapter
      -> AgentRuntime（应用 façade）
          -> LangGraphExecutor（图执行边界）
              -> LangChain ChatModel / StructuredTool
              -> NodeSqliteCheckpointSaver
          -> AgentDatabase（业务事实）
          -> Permission / Workspace / Tool adapters
```

### 3.1 AgentRuntime 保留职责

- 校验并接收 IPC 输入，解析会话、项目、权限和模型快照。
- 创建/取消/替换 Run，维护 Queue/Steer 和恢复入口。
- 在模型或工具节点外持久化用户可见消息、Tool 行、Run 终态和 Subagent 结果。
- 通过既有 `ConversationRunEvent` 向 Renderer 发事件，保持协议不变。
- 解析文件变更和命令审批；审批通过前不能产生副作用。
- 维护项目工作区、路径安全、命令进程树、冲突等待和错误脱敏。

### 3.2 LangGraph 负责的职责

- 图状态及 reducer：消息、工具回合计数、最后结果、激活 Skill 快照、挂起原因。
- `model -> tools -> model` 条件循环、完成边和最大步骤限制。
- 通过 `interrupt()` 暂停等待审批；通过 `new Command({ resume })` 恢复同一 `thread_id`。
- 在每个安全节点边界保存 Checkpoint，应用重启后从图状态继续。
- 为 Subagent/团队未来扩展保留子图和并行 `Send` 的能力，但本批不宣称完整团队 Supervisor 已实现。

## 4. LangGraph 图形状

```text
START
  -> prepare_context
  -> load_or_restore_skills
  -> model
       ├─ 无 tool call 且无待处理输入 -> finalize -> END
       ├─ 有 tool call -> tools
       ├─ 有 Steer/Agent 消息 -> prepare_context
       └─ 达到步骤上限 -> fail
  -> model
```

图状态只保存可恢复执行所需的结构化值，不把完整业务数据库行复制进去。模型节点使用 LangChain `BaseChatModel.bindTools()`；工具节点使用 LangChain Tool 合同和 LangGraph `ToolNode` 的 dispatch 语义，外层 Runtime wrapper 为每个调用补充参数校验、审计、事件、权限和副作用处理。需要顺序执行或审批的调用不能绕过 wrapper。

取消使用 Runtime 的 `AbortSignal` 传入 Graph/ChatModel/工具；取消不会重放已经开始的副作用。最大回合数由图状态和条件边共同限制，Runtime 不再维护第二个独立循环。

## 5. 模型适配方向

保留中立的 `ModelProviderAdapter` 作为应用端口，但实现改为 LangChain-backed adapter。这样上下文压缩、连接测试和现有测试调用方不需要同时改变，Provider 协议解析不再由项目手写。

```text
ModelConfiguration
  -> LangChainModelFactory
      openai-chat-completions -> ChatOpenAI({ useResponsesApi: false })
      openai-responses         -> ChatOpenAI({ useResponsesApi: true })
      anthropic-messages       -> ChatAnthropic
      google-gemini            -> ChatGoogleGenerativeAI
```

约束：

1. `maxRetries` 由 Runtime 的可观测重试策略控制，Provider SDK 不得隐式重放带副作用的回合。
2. `AbortSignal` 必须贯穿 ChatModel stream；收到可见文本或 Tool Call 后不能自动重放该请求。
3. Provider-specific reasoning、附件和原始响应只在 adapter 内转换；业务 Runtime 不判断供应商字段。
4. LangChain `AIMessage`/`ToolMessage` 只在图和 adapter 内使用；落库继续使用当前中立 `ModelMessage` 合同。
5. 旧 `model-protocol-adapter.ts`、`openai-compatible-adapter.ts` 和 AI SDK adapter 在新 adapter 通过回归后删除，不保留生产双路回退。

## 6. Skill 生命周期与上下文

Skill 正文不写入聊天 Timeline。它是本次 Run 的上下文输入和可恢复状态，遵循渐进加载：

```text
Level 0  工具 Schema 中提供 load_skill 的名称和一句话用途
Level 1  ContextBuilder 注入受预算限制的 name + description 目录
Level 2  模型调用 load_skill 后，加载 SKILL.md 正文到本次模型上下文
Level 3  需要时通过受控 reference 工具加载 references/templates 的单个文件
```

### 6.1 组件

- `SkillCatalog`：从 `SkillDocumentStore` 得到已启用、作用域匹配的元数据，不把任意目录暴露给模型。
- `SkillResolver`：按 Skill ID、当前 Project/Agent 范围和依赖检查可用性。
- `SkillLoader`：读取并解析 `SKILL.md`，使用 canonical path、版本和 SHA-256 内容哈希形成不可变快照。
- `SkillContextProvider`：按 ContextManager 预算返回系统上下文片段；Skill 指令置于明确分隔符中，不能覆盖系统安全、权限和项目边界。
- `SkillSnapshot`：写入 Graph State，并在 Run 快照/Checkpoint 中保存 `id/version/contentHash`。正文过大时保存到受控 Artifact，恢复时按哈希校验读取。

模型不会因为看到了摘要就“自动知道详细说明”。`load_skill` 必须是一个真实工具，工具描述明确说明何时调用；加载失败以结构化 Tool 错误返回，允许模型在同一图中修正参数。压缩后由 `SkillContextProvider` 根据快照重新组装正文，不依赖旧消息仍留在上下文中。

Skill 正文、reference 和脚本都视为不可信输入：脚本不能直接获得 Node/Shell/网络权限，所有副作用仍经过统一 ToolRegistry、PermissionPolicy、审批、超时、取消和审计。

## 7. Checkpoint 与恢复

LangGraph 的 Checkpoint 只负责图恢复，不替代现有业务状态：

- `thread_id` 使用稳定的 `runId`/图线程标识，不能使用模型提供的任意值。
- `NodeSqliteCheckpointSaver` 实现 LangGraph `BaseCheckpointSaver` 的 `getTuple/list/put/putWrites/deleteThread` 合同。
- Checkpoint 表和 writes 表使用独立命名空间或独立数据库文件，迁移由项目 `DatabaseMigrationRunner` 管理。
- 业务数据库先提交可见事实，再发事件；图 Checkpoint 只在节点安全边界写入，恢复时重新读取并校验业务 Run 状态。
- 已完成、取消或失败的 Run 清理对应图线程；历史 UI 消息和审计事实不删除。
- 删除/归档流程把 Checkpoint 文件或行纳入现有可恢复清理任务，不能只删业务行。

如果未来需要换成官方 Saver，只允许在 `CheckpointSaver` port 后替换；不能让 `better-sqlite3` 直接穿透到 Runtime 或 Electron composition root。

## 8. 迁移顺序与验证门槛

### 阶段 0：本决策文档和 API Spike（当前）

- 锁定包版本和边界。
- 验证 StateGraph、`interrupt/Command`、Provider 构造和 SQLite 原生模块风险。
- 不改生产 Agent Loop。

### 阶段 1：LangChain 模型端口

- 实现 LangChain-backed model registry 和中立消息转换。
- 用固定请求快照覆盖四种 API 格式、Tool Call、流式增量、Reasoning、附件、错误和取消。
- 通过后删除 AI SDK/手写 Provider 解析依赖。

### 阶段 2：纯图执行器

- 建立 `AgentGraphState`、model/tools/finalize 节点和条件边。
- 用 fake ChatModel 与 fake Tools 验证多轮、并行/顺序、最大步骤和 AbortSignal。
- 图测试不直接访问 Electron、SQLite 业务表或 Renderer。

### 阶段 3：Runtime façade 接入

- 将 `executeRun` 的内部循环替换为 Graph invoke/stream。
- 保持既有事件、消息、Tool 行、Queue/Steer、Subagent 和错误合同。
- 逐次补审批 `interrupt/resume`、取消、应用重启恢复和不可重放副作用测试。

### 阶段 4：Skill 与 Checkpoint

- 接入 `SkillCatalog/Resolver/Loader/ContextProvider` 和 Run 快照。
- 实现 `NodeSqliteCheckpointSaver`、迁移、清理和旧会话恢复。
- 验证 Skill 正文不进入 Timeline，压缩/恢复后仍按 hash 重建上下文。

### 阶段 5：收口

- 删除旧 `for` 循环、AI SDK 和手写 Provider 协议适配器。
- 更新业务、接口和工具文档的“当前实现状态”，未完成 MCP/Skill 能力不提前标记为 true。
- 执行全仓库 lint、typecheck、test、build 和 Electron 打包冒烟。

每个阶段先通过自动测试再进入下一阶段；不在生产中长期保留两套 Agent Loop。若阶段失败，回滚到本阶段前的 Git 提交，不用运行时 Feature Flag 掩盖两套语义差异。

## 9. 完成定义

以下条件全部满足才称为“LangGraph 改造完成”：

1. AgentRuntime 公共入口和 IPC 合同未破坏，内部模型/工具循环由 LangGraph 图执行。
2. 四种现有模型格式均由 LangChain Provider 适配并通过流式 Tool Calling 回归。
3. 工具参数、权限、审批、冲突、取消、超时和副作用审计行为与基线一致。
4. `interrupt/resume`、应用重启恢复和 Checkpoint 清理有自动测试。
5. Skill 按摘要 -> 正文 -> reference 渐进加载；正文不污染聊天历史，快照可复现。
6. UI 可见消息、Run 终态、Subagent 结果仍按业务数据库原子事实提交。
7. `@langchain/langgraph-checkpoint-sqlite`/`better-sqlite3` 不进入最终运行时依赖，除非完成 Electron ABI、打包和恢复的独立验收并重新记录决策。
8. 旧 AI SDK 和旧自研 Provider/Loop 代码已删除，且全套质量门禁通过。

## 10. 当前未宣称的能力

本方案本身不表示 MCP Runtime、完整 Skill Runtime、完整长期团队 Supervisor、受管浏览器或远程 Agent Server 已实现。代码和 Capability 只有在对应测试与端到端证据齐备后才更新为已实现。
