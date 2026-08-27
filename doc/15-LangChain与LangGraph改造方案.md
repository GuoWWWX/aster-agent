# LangChain 与 LangGraph 改造方案

> 文档状态：技术选型与迁移决策；生产主链已迁移到 `createAgent`，Desktop 与全仓 lint/typecheck/test/build 已通过，桌面端已重启加载最新构建；真实 Provider、审批和恢复场景仍需手工验收
> 决策日期：2026-08-19
> 适用范围：`apps/desktop` 的 Agent Runtime、模型适配、工具循环、Skill 上下文和可恢复执行
> 前置基线：`b009d52 checkpoint：LangGraph 改造前工作树`

## 1. 决策摘要

本项目采用 **LangChain Core/Provider + LangGraph**，替换当前 `AgentRuntime` 内部自研的模型/工具循环和状态流转。

`AgentRuntime` 不删除。它继续是 Electron Main、IPC 和现有业务调用方看到的应用入口与兼容 façade，负责项目边界、权限、审批、SQLite 业务事实、事件合同、Queue/Steer、Subagent 和错误映射。LangGraph 接管 façade 内部的执行图、节点循环、条件路由、中断恢复和图状态 Checkpoint。

当前代码使用 `langchain@1.5.9` 的 `createAgent + createMiddleware` 作为生产主链，已接入自定义 SQLite Checkpoint、LangGraph `interrupt/Command` 审批恢复、框架 `ToolNode` 调度、`modelCallLimitMiddleware`、`beforeAgent` 上下文初始化和自定义模型重试 Middleware。Runtime wrapper 仍保留参数边界、权限、审计、事件和项目操作锁；框架负责模型/工具循环、重试控制与图恢复，项目负责业务事实和副作用合同。

这不是把所有业务搬进框架，也不是继续保留两套生产 Agent Loop：迁移完成后，旧的 `for` 循环和旧 Provider 协议解析从生产路径删除；Runtime 只保留应用边界适配。

## 2. 已确认的技术栈

| 层 | 最终选择 | 责任边界 |
| --- | --- | --- |
| 桌面容器 | Electron 43.4.x | Main、Preload、Renderer 生命周期和本机权限边界 |
| 运行时 | Node.js 24.x + TypeScript 6.x | 应用编排、工具、持久化和模型请求 |
| Agent 主链 | `langchain@1.5.9` | `createAgent`、`createMiddleware`、内置模型调用次数限制和标准 `model -> tools -> model` 循环 |
| 图运行时 | `@langchain/langgraph@1.4.10` | `ToolNode`、状态 reducer、`interrupt`/`Command`、图级 Checkpoint 和执行控制 |
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
- 不引入 `@langchain/community`、AutoGen 或 CrewAI；已有 LangChain/LangGraph 能力足够时不再并行引入第二套 Agent 框架。
- 不使用已废弃的 `createReactAgent` 或旧 `AgentExecutor`。生产顶层运行时使用当前 LangChain `createAgent`，项目业务通过 Middleware 和 Runtime callback 接入。
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

- 图状态及 reducer：模型消息、模型调用计数、Runtime 回合数、上下文是否已初始化、成功工具标记和激活 Skill 快照。
- `createAgent` 的 `model -> tools -> model` 条件循环和完成边；最大模型调用次数由 `modelCallLimitMiddleware` 按同一 `thread_id` 计数。
- `createMiddleware.beforeAgent` 在 Run 图线程首次进入时调用 Runtime 的 Context Builder，写入本轮初始上下文；同一线程后续 Queue/Steer 或审批恢复不会重复追加上下文。
- 自定义 `wrapModelCall` Middleware 执行可取消、可观测的模型重试；Runtime 只提供重试判定、退避、等待和事件/终态回调。
- 通过 `interrupt()` 暂停等待审批；通过 `new Command({ resume })` 恢复同一 `thread_id`。
- 在每个安全节点边界保存 Checkpoint。当前应用重启只恢复尚未开始执行的 queued Run；已进入图的 running Run 保守标记失败，不跨进程重放副作用。
- 为 Subagent/团队未来扩展保留子图和并行 `Send` 的能力，但本批不宣称完整团队 Supervisor 已实现。

## 4. LangGraph 图形状

```text
START
  -> createAgent.beforeAgent（Runtime Context Builder 初始化历史、附件、Checkpoint 和工具预算）
  -> createAgent.beforeModel（注入 Queue/Steer、Agent 消息和激活 Skill 上下文）
  -> createAgent.model（Runtime 的 CallbackChatModel 调用 LangChain Provider Adapter）
       └─ wrapModelCall Middleware（无可见输出/可重试错误时按 Runtime 策略重试）
       ├─ 有 tool call -> tools
       ├─ 无 tool call 且有待处理输入 -> 同一 thread 再次 invoke，从 beforeModel 开始
       ├─ 无 tool call 且无待处理输入 -> END
       └─ 达到步骤上限 -> fail
  -> createAgent.tools
       ├─ 普通结果 -> model
       └─ 审批 interrupt -> Command({ resume }) 后从同一工具节点恢复
```

图状态只保存可恢复执行所需的结构化值，不把完整业务数据库行复制进去。`CallbackChatModel` 把 `createAgent` 的模型节点接到项目中立 Model Port；真正的 Provider 调用仍由 LangChain-backed Adapter 完成，并保留流式事件、脱敏重试和模型快照合同。工具回合使用 `createAgent` 自带 ToolNode；Runtime batch coordinator 收到完整 Tool Call 批次后按业务调度策略分组，安全并发窗口再交给 LangGraph `ToolNode` 执行。所有调用仍经过 Registry 的参数、权限、审计、取消和副作用边界。

外层固定使用 `version: "v1"`，使一轮多个 Tool Call 进入同一个 ToolNode 批次；`v2` 会拆成独立 `Send`，Runtime 将无法在首个文件写入前统一准备整批 Diff 和 `expectedContent`。外层 ToolNode 的并发只调用同一个批次协调器，真正的只读/命令并发宽度与副作用顺序仍由 Runtime 决定。

Queue/Steer 在模型已经返回无工具结果后到达时，Executor 会在同一 `thread_id` 上用空消息再次 `invoke`，并保留 `contextPrepared` 状态，确保只重新经过 `beforeModel` 注入持久化输入。不使用 `afterModel.jumpTo("model")`，因为该跳转会绕过 `beforeModel`，导致持久化输入无法被注入。

取消使用 Runtime 的 `AbortSignal` 传入 Graph、ChatModel 和工具；取消不会重放已经开始的副作用。Runtime 只提供上限配置和错误映射，不再维护第二个 Agent 工具循环。

模型调用上限和图递归上限是两层不同的保护：`modelCallLimitMiddleware` 按同一 `thread_id` 统计真实模型调用，项目的 `MAX_AGENT_LOOPS` 映射为该限制；LangGraph 的 `recursionLimit` 统计 `createAgent` 内部所有图节点步数（包括 Middleware、模型和 ToolNode），不能直接把它当成模型轮数。当前 Executor 为每个 Run 设置 `max(25, maxSteps * 8 + 8)` 的图预算，给每轮的框架节点留出空间，避免默认 25 步在多 Tool Call 场景下提前触发；任一保护触发都会转换为受控的模型运行限制错误，不把原始 `GraphRecursionError` 泄露为“软件内部错误”。

### 4.1 框架能力采用矩阵

| 能力 | 当前做法 | 结论 |
| --- | --- | --- |
| Agent Loop、路由、ToolNode | `createAgent` + `createMiddleware` | 使用框架 |
| 模型调用次数限制 | `modelCallLimitMiddleware`，按 Run 的 `thread_id` 计数 | 使用框架 |
| Provider 请求与 Tool Calling | LangChain Provider 包 + 项目中立 Adapter | 使用框架，保留业务端口 |
| Checkpoint | LangGraph `BaseCheckpointSaver` 合同 + `NodeSqliteCheckpointSaver` | 使用框架合同，自有存储适配 |
| 工具审批 | LangGraph `interrupt/Command` + Runtime 的 Diff/命令审批事实 | 使用框架执行控制；不使用通用 HITL Middleware |
| 工具错误 | ToolNode 消息合同 + Runtime 持久化失败 Tool 行和事件 | 组合使用；通用错误 Middleware 不能替代审计事实 |
| 模型重试 | LangGraph Executor 的自定义 `wrapModelCall` Middleware；Runtime 提供流式感知、重试判定、退避等待、UI 事件和终态回调 | 不使用 LangChain 内置重试；需要保留已有文本后禁止重放、空响应策略和脱敏合同 |
| 上下文压缩 | 项目 ContextManager + LangChain 消息转换 | 不使用内置摘要；必须保留原始历史、增量摘要、相关历史、附件和 Skill 统一预算 |
| Skill | SkillRuntime + Graph State 快照 + beforeAgent 初始上下文 / beforeModel 临时注入 | 框架保存恢复状态，正文解析和预算由项目实现 |
| Subagent、跨 Agent 通信 | 每个执行 Run 仍使用 `createAgent`；对话、消息、队列和唤醒写业务 SQLite | 不使用短生命周期内存子 Agent 替代持久化业务对话 |
| 单轮 Tool Call 总量和副作用调度 | Runtime 每轮 32、读 8、非只读模式下默认并行命令 4，文件/通信有序；询问模式逐条审批后进入并行窗口，`parallel=false` 可降级命令 | 框架累计 Tool 限制语义不同，保留项目策略 |

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

Anthropic 的配置 `baseUrl` 延续项目原有的版本化格式（例如 `https://api.anthropic.com/v1`）；Adapter 会在交给 SDK 前移除末尾的 `v1`，因为 Anthropic SDK 会固定追加 `/v1/messages`。Google 的配置 `baseUrl` 可以填写官方格式 `https://generativelanguage.googleapis.com/v1beta`，Adapter 会把末尾的 `v1`、`v1beta` 或 `v1alpha` 拆成 SDK 的 `apiVersion`，避免 Provider 再次拼接同一个版本路径。`@google/generative-ai@0.24.1` 的公开 `RequestOptions` 没有自定义 `fetch` 字段，因此 Google 请求使用 SDK 的全局 `fetch`；Adapter 的自定义请求注入仅对 OpenAI 和 Anthropic 生效，不能把 Google 的测试替换钩子当成生产网络代理能力。

约束：

1. `maxRetries`、可重试错误和空响应规则由 Runtime 提供给 Graph Middleware；Provider SDK 不得隐式重放带副作用的回合。
2. `AbortSignal` 必须贯穿 ChatModel stream；收到可见文本或 Tool Call 后不能自动重放该请求。
3. Provider-specific reasoning、附件和原始响应只在 adapter 内转换；业务 Runtime 不判断供应商字段。
4. LangChain `AIMessage`/`ToolMessage` 只在图和 adapter 内使用；落库继续使用当前中立 `ModelMessage` 合同。
5. 旧 `model-protocol-adapter.ts`、`openai-compatible-adapter.ts` 和 AI SDK adapter 在新 adapter 通过回归后删除，不保留生产双路回退。
6. 新快照只写 LangChain 版本 2；迁移期只读转换 AI SDK 版本 1 的 Assistant Provider State。OpenAI Chat 的兼容端点字段 `reasoning_content` 由 Adapter 在序列化后的请求体中窄范围补回，其他 Provider 使用 LangChain 原生消息块。

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

Agent `capabilityScope=custom` 时，`skillIds` 必须进入同一个 `SkillRuntimeContext`，同时约束目录、`load_skill`、`read_skill_reference` 和压缩/恢复后的正文重建；`inherit_all` 不增加此 Agent 过滤。`project` 与 `team` 作用域分别要求当前 Project 和团队会话。Reference 必须在读取前检查文件大小，并用 fatal UTF-8 解码拒绝二进制或损坏文本。

模型不会因为看到了摘要就“自动知道详细说明”。`load_skill` 必须是一个真实工具，工具描述明确说明何时调用；加载失败以结构化 Tool 错误返回，允许模型在同一图中修正参数。压缩后由 `SkillContextProvider` 根据快照重新组装正文，不依赖旧消息仍留在上下文中。

ContextManager 在每次历史裁剪前为 Skill Runtime 固定预留正文预算：`max(1024, min(12000, floor(effectiveContextWindow * 0.12)))`，无模型窗口时使用 48,000 Token 作为保守基准。预算计入 `estimatedSystemTokens` 和固定上下文开销，因此 Skill 激活不会把历史裁剪结果推过本轮阈值。

一次 Graph Run 首次进入 `createAgent.beforeAgent` 时调用 Runtime 的 `prepareContext`，把系统规则、Checkpoint、未覆盖历史、相关历史、附件和工具预算形成初始消息状态。`contextPrepared` 随 Graph State 持久化；同一 Run 的 Queue/Steer 追加和审批 `Command({ resume })` 只重新经过 `beforeModel`，不会再次追加同一份历史。Skill 激活正文仍由 `beforeModel` 按快照和预算临时注入。

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

### 阶段 0：本决策文档和 API Spike（已完成）

- 锁定包版本和边界。
- 验证 StateGraph、`interrupt/Command`、Provider 构造和 SQLite 原生模块风险。
- 不改生产 Agent Loop。

### 阶段 1：LangChain 模型端口（已完成）

- 实现 LangChain-backed model registry 和中立消息转换。
- 用固定请求快照覆盖四种 API 格式、Tool Call、流式增量、Reasoning、附件、错误和取消。
- 通过后删除 AI SDK/手写 Provider 解析依赖。

### 阶段 2：图执行器（已完成）

- 使用 `createAgent + createMiddleware` 建立 Runtime bridge，不手写第二套 model/tools 条件循环。
- 用 fake ChatModel 与 fake Tools 验证多轮、批次工具、最大模型调用次数、Checkpoint 和 AbortSignal。
- 图测试不直接访问 Electron、SQLite 业务表或 Renderer。

### 阶段 3：Runtime façade 接入（已完成）

- 将 `executeRun` 的内部循环替换为 Graph invoke/stream。
- 保持既有事件、消息、Tool 行、Queue/Steer、Subagent 和错误合同。
- 使用 LangGraph `interrupt/Command` 承接逐次审批；恢复时按 interrupt namespace keyed resume，并缓存已完成 ToolCall 结果，避免节点重放副作用。running Run 仍按保守失败策略处理。

### 阶段 4：Skill 与 Checkpoint（主链已完成）

- 接入 `SkillCatalog/Resolver/Loader/ContextProvider` 和 Run 快照。
- 实现 `NodeSqliteCheckpointSaver`、迁移、清理和 queued Run 恢复；running Run 的自动恢复仍禁止，避免副作用重放。
- 验证 Skill 正文不进入 Timeline，压缩/恢复后仍按 hash 重建上下文。
- ContextManager 在历史裁剪前预留 Skill 正文预算，正文注入和上下文用量估算使用同一预算。

### 阶段 5：收口（自动门禁已通过，手工验收进行中）

- 删除旧 Agent `for` 循环、AI SDK 和手写 Provider 协议适配器；生产主链统一为 `createAgent`。
- 更新业务、接口和工具文档的“当前实现状态”，未完成 MCP/Skill 能力不提前标记为 true。
- Desktop lint、typecheck、test、build 与根 lint/typecheck/test/build 已通过；本轮桌面端已真启动并加载最新构建。强制退出恢复和真实 Provider/Skill 仍待手工验收。

每个阶段先通过自动测试再进入下一阶段；不在生产中长期保留两套 Agent Loop。若阶段失败，回滚到本阶段前的 Git 提交，不用运行时 Feature Flag 掩盖两套语义差异。

## 9. 完成定义

以下条件全部满足才称为“LangGraph 改造完成”：

1. AgentRuntime 公共入口和 IPC 合同未破坏，内部模型/工具循环由 LangChain `createAgent`/LangGraph 图执行。
2. 四种现有模型格式均由 LangChain Provider 适配并通过流式 Tool Calling 回归。
3. 工具参数、权限、审批、冲突、取消、超时和副作用审计行为与基线一致。
4. `interrupt/resume`、多工具审批恢复、已完成副作用不重放、安全的应用重启恢复和 Checkpoint 清理有自动测试；当前只完成 queued Run 恢复，running Run 仍保守失败。
5. Skill 按摘要 -> 正文 -> reference 渐进加载；正文不污染聊天历史，快照可复现。
6. UI 可见消息、Run 终态、Subagent 结果仍按业务数据库原子事实提交。
7. `@langchain/langgraph-checkpoint-sqlite`/`better-sqlite3` 不进入最终运行时依赖，除非完成 Electron ABI、打包和恢复的独立验收并重新记录决策。
8. 旧 AI SDK 和旧自研 Provider/Loop 代码已删除，且全套质量门禁通过。

## 10. 当前未宣称的能力

本方案本身不表示 MCP Runtime、Skill 脚本执行、running Run 自动恢复、完整长期团队 Supervisor、受管浏览器或远程 Agent Server 已实现。代码和 Capability 只有在对应测试与端到端证据齐备后才更新为已实现。
