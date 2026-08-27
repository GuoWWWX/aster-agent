# 模型接入、MCP、Skill 与 Agent 对话设计

> 文档状态：模型与 Skill Runtime 已落地；声明式 Plugin Catalog 已落地；MCP Runtime 仍未实现
> 更新时间：2026-08-27
> 适用范围：模型配置、Agent 模型选择、MCP、Skill、Agent Thread 和相关 UI

## 1. 核心结论

本产品把模型、MCP、Skill 和 Agent 对话视为基础能力，不作为后期插件市场的附属功能：

- 用户可以登记多个厂商、多个端点和多个模型，并为团队或 Agent 选择。
- 每个 Agent 都有独立、持久化、可查看的逻辑对话 Thread，临时 Subagent 也不例外；这里的 Thread 不是操作系统线程。
- 新 Agent 默认继承创建它的当前对话模型；用户配置、对话指定或显式锁定可以覆盖继承。
- Team Lead 可以在允许的候选模型中为任务选模型，但用户始终可以修改常驻 Agent 后续使用的模型。
- MCP 提供外部工具、资源和提示能力；Skill 提供工作方法、说明、模板和受控脚本，两者不能混为一谈。
- MCP 和 Skill 最终调用本机、网络或第三方能力时，仍经过统一权限、审批、超时、取消和审计。

设计原则是“支持多种接入方式”，不是承诺第一天内置所有厂商。任何新厂商通过 `ModelProviderAdapter` 接入，不能把供应商判断散落在 Agent Loop 和 UI 中。

## 2. 需要补齐的产品能力

### 2.1 P0 基础能力

1. **模型中心**：管理供应商、请求地址、对话协议、凭据、模型列表、上下文窗口、别名、能力和连接状态。
2. **Agent 模型策略**：支持继承、固定和自动选择，并显示实际生效模型。
3. **Agent 对话中心**：可以打开 Team Lead、常驻 Agent 和临时 Agent 的独立 Thread。
4. **MCP 管理器**：安装或登记、启停、连接测试、能力发现、权限范围和日志。
5. **Skill 管理器**：发现、启停、版本、适用范围、依赖和按需加载。
6. **能力兼容检查**：模型必须满足 Tool Calling、结构化输出、图片和上下文窗口等当前任务要求。
7. **运行快照与审计**：每个 Run 记录所用模型、选用原因、启用的 MCP/Skill 和配置版本。
8. **密钥管理**：凭据使用 Electron `safeStorage`，Renderer、SQLite、日志和导出文件不包含明文。

### 2.2 基础闭环稳定后

- 可配置的失败回退链、限流退避和供应商熔断。
- Token、费用、延迟和成功率统计，以及团队/Agent 预算。
- 配置导入导出，但密钥默认不导出。
- 供应商模型列表同步和变更提示。
- Skill 仓库、签名、更新和兼容性管理。
- MCP OAuth、远程账户授权和更细的组织级策略。

开放插件市场、第三方 UI 注入和无人审查的任意代码插件仍不进入 MVP。

## 3. 模型接入架构

### 3.1 核心对象

```ts
type ModelRef = {
  providerId: string;
  modelId: string;
};

type ProviderEndpoint = {
  id: string;
  protocolAdapterId: string;
  baseUrl: string;
  requestPathOverride?: string;
  credentialRef?: string;
};

type ModelCapabilities = {
  streaming: boolean;
  toolCalling: boolean;
  structuredOutput: boolean;
  vision: boolean;
  reasoning: boolean;
};

type ModelLimits = {
  contextWindowTokens: number;
  maxInputTokens?: number;
  maxOutputTokens: number;
  reservedOutputTokens: number;
  source: "discovered" | "built_in" | "user";
};

type ModelRole =
  | "agent"
  | "router"
  | "summarizer"
  | "vision"
  | "embedding"
  | "reranker"
  | "speech";

type ModelProfile = {
  id: string;
  providerId: string;
  modelId: string;
  displayName: string;
  roles: ModelRole[];
  capabilities: ModelCapabilities;
  limits: ModelLimits;
  enabled: boolean;
};
```

- `Provider` 表示一个供应商或兼容协议端点。
- `ProviderEndpoint` 把请求地址与对话协议分开；同一个地址可以建立多个不同协议配置，同一协议也可以配置多个地址。
- `ModelProfile` 表示该端点下一个用户可选模型。
- `ModelRef` 是跨模块传递的稳定引用，不能只传一个可能重名的模型字符串。
- 不同模型类型可以进入同一注册表，但只有包含 `agent` 角色的生成模型能作为 Agent 主模型；embedding、reranker 或 speech 模型只能用于对应专用能力。
- 能力数据可以来自适配器发现或用户覆盖；覆盖后必须标明来源，不能假装是供应商确认值。

### 3.2 Provider Adapter

`ModelProviderAdapter` 统一提供：

```ts
interface ModelProviderAdapter {
  testConnection(input: ProviderConnectionInput): Promise<ConnectionResult>;
  listModels(input: ListProviderModelsInput): Promise<DiscoveredModel[]>;
  stream(input: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
  countTokens?(input: TokenCountInput): Promise<TokenCountResult>;
}
```

边界规则：

- Agent Core 只依赖统一 `ModelEvent`，不判断供应商名称。
- 供应商 SDK、鉴权头、请求参数和 Tool Calling 差异留在 Adapter 内。
- OpenAI-compatible 是一种 Adapter，不是整个模型层的唯一协议。
- 用户在 Provider 配置中选择 `protocolAdapterId`，并自行填写 Base URL；需要时允许覆盖请求路径、非敏感 Header 和基础请求参数。
- 敏感 Header 值只能保存为凭据引用，不能混入普通 JSON 配置。
- 内置 Adapter 可以覆盖 Chat Completions、Responses、Messages、Generate Content 或本地 Chat 等常见协议；新增协议通过注册新的 Adapter 实现，不在 Agent Loop 中增加条件判断。
- “任意协议”表示用户可以从已安装的协议 Adapter 中选择并配置地址；完全未知的请求/流式响应格式仍需要对应 Adapter，不能只靠修改 URL 自动兼容。
- 本地模型服务只要有对应 Adapter 或兼容端点，就与云模型使用同一注册方式。
- Provider 不支持列出模型时，允许用户手工填写模型 ID 和能力，但必须标为手工配置并通过实际连接测试。
- 未知模型不能自动宣称支持 Tool Calling、Vision 或某个上下文长度；必须探测、配置或明确标为未知。

### 3.2.1 当前实现边界

当前 Desktop 生产路径使用 LangChain Provider 实现四种 `ModelProviderAdapter` 格式；Agent Runtime 不按供应商分支，Skill 仍通过独立 Runtime 渐进注入：

- `openai-chat-completions` 和 `openai-responses` 使用 `@langchain/openai`，`anthropic-messages` 使用 `@langchain/anthropic`，`google-gemini` 使用 `@langchain/google-genai`；项目保留中立消息、Tool、附件和 Provider State 合同。
- OpenAI-compatible Responses 端点若在 SSE 的 `output_text` 块中省略可选的 `annotations` 数组，Adapter 会在流式边界补为空数组后再交给 LangChain，保持流式输出和 Provider State 语义不变；这类兼容处理只在 Adapter 内完成，不下沉到 Runtime 或持久化消息。
- 设置中的“测试模型”会按已选的四种协议分别走真实 Adapter、请求路径、鉴权头和流式解析；空响应或无法转换的模型响应归类为 `MODEL_RESPONSE_INVALID`，HTTP 认证、限流、超时和网关错误继续按状态映射，不能仅凭 `/models` 能列出模型就视为可用于 Agent 对话。
- 同一供应商内的 `modelId` 必须唯一；标准 `effort`、供应商自定义 `custom_effort` 和 `token_budget` 分属独立的推理选项键空间，可配置同值但不同类型的选项。
- 用户填写 Base URL 与 API Key 后，Desktop Main 按协议拉取模型目录；密钥不回传 Renderer，API Key 仍只经 Electron `safeStorage` 加密后写入独立凭据文件。
- Provider SDK 的协议、流式、Tool Calling、Reasoning 和附件转换均封装在 LangChain-backed Adapter；Runtime 只负责可观测重试、上下文、权限、工具和业务事件。
- `SkillRuntime` 先向模型提供当前作用域内的名称/描述目录，模型调用 `load_skill` 后才把 `SKILL.md` 正文注入下一轮上下文；正文不写入 Timeline，reference 只允许已激活 Skill 的 `references/` 与 `templates/` 有界读取。
- 带 MCP 依赖的 Skill 在 MCP Runtime 尚未可用时不会进入目录；Skill 脚本执行、MCP Server 调用和真实 Provider 端点的 Electron 手工验收仍属于后续批次。

### 3.2.2 声明式 Plugin Catalog 的当前边界

`<AGENT_HOME>/plugins/<package>/plugin.json` 可以声明 `skills`、`mcp` 与 `templates` 目录。启动时 `PluginCatalog` 只校验 manifest、目录边界、符号链接、文件/总字节上限并计算内容哈希；有效包写入 SQLite `plugin_catalog`，启用状态通过 `plugin.list` / `plugin.set_enabled` IPC 查询和修改。新建 Run 会冻结已启用 Plugin 的 `id / version / contentHash`，运行中的 Run 不受之后启停影响。〔FACT｜`apps/desktop/src/main/plugins/plugin-catalog.ts`；`apps/desktop/src/main/storage/agent-database.ts`；`packages/protocol/src/plugin.ts`〕

这不是第三方代码执行或 UI 注入机制：当前 Catalog 不执行 Plugin JavaScript，也不会直接把 Plugin 的 MCP/Skill 目录注册为可调用能力；贡献接入仍须分别走现有 Skill / MCP 配置和 `ToolRuntime` 权限链。MCP Runtime 尚未实现，因此 Plugin 的 MCP 声明不能被当作已连接服务。〔FACT｜`apps/desktop/src/main/plugins/plugin-catalog.ts`〕

完整技术选型、LangGraph 图边界、Checkpoint 和恢复策略见[LangChain 与 LangGraph 改造方案](./15-LangChain与LangGraph改造方案.md)；新增协议时只扩展 Adapter、配置表单和能力映射，Agent Loop 不增加厂商条件判断。

### 3.3 上下文窗口配置

- 每个 Model Profile 都可以配置 `contextWindowTokens`、`maxOutputTokens`、输出预留和可选输入上限。
- 供应商发现值、内置值和用户覆盖值都记录 `source`；用户覆盖优先，但 UI 必须标明这是手工值。
- `ContextBuilder` 的可用输入预算按“上下文窗口 - 输出预留 - Tool Schema - 安全余量”计算，不能把整个窗口都用于历史消息。
- 切换模型或修改窗口配置后，从下一次模型调用重新计算预算；已有消息和历史 Run 不修改。
- 配置值超过服务端真实限制时，Adapter 将错误映射为模型配置错误，并提示用户修正，不能静默截断后假装请求完整。
- 不知道窗口大小时不猜一个极大值；模型先处于“窗口待确认”状态，完成连接测试或用户填写后才用于长上下文任务。

### 3.4 配置范围

模型配置分四层：

| 范围 | 用途 |
| --- | --- |
| 应用 | 可用供应商、全局默认模型、通用别名 |
| Team | 团队允许模型、预算和默认策略 |
| Agent Profile | 某类 Agent 的默认模型或候选集合 |
| Agent Instance | 用户对这个具体 Agent 的持久覆盖 |

下层只能在上层允许的模型集合中选择，不能通过对话绕过管理员禁用、密钥范围或预算限制。

## 4. 创建 Agent 时如何选择模型

### 4.1 三种选择模式

```ts
type AgentModelPolicy =
  | { mode: "inherit" }
  | { mode: "fixed"; modelRef: ModelRef; userLocked: boolean }
  | { mode: "auto"; allowedModels: ModelRef[]; userLocked: boolean };
```

- `inherit`：默认模式，继承创建 Agent 的父 Thread 当前生效模型。
- `fixed`：固定使用用户或 Profile 指定的模型。
- `auto`：Team Lead/ModelRouter 从允许且兼容的模型中选择。

普通临时 Agent 默认使用 `inherit`，避免为了简单任务无意义地切换模型。只有任务能力、成本、上下文或用户要求存在明确差异时才使用 `auto` 或 `fixed`。

### 4.2 选择优先级

从高到低依次为：

1. 用户通过当前对话或模型选择器发出的明确指定。
2. 用户对该 Agent 保存的持久模型覆盖。
3. 创建 Agent 时显式传入的模型。
4. Agent Profile 或 Team 中由用户配置的默认模型。
5. `auto` 模式下 ModelRouter 的兼容模型选择。
6. 创建该 Agent 的父对话当前生效模型。
7. 没有父对话时使用应用全局默认模型。

“当前对话模型”指创建 Agent 时根据父 Thread 当前策略解析出的有效 `ModelRef`：固定模式使用当前选中模型，自动模式优先沿用最近 Run 的实际模型并重新检查可用性。它不是 UI 中可能已经失效的显示名称。如果该模型已被禁用、凭据不可用或不满足任务能力，系统必须说明原因并让用户选择或按已配置的 `auto` 策略路由，不能静默使用未知模型。

### 4.3 AI 自动选择

ModelRouter 先确定性过滤，再评分：

1. 供应商和模型当前可用。
2. 满足任务需要的 Tool Calling、结构化输出、Vision 和上下文能力。
3. 位于 Team/Agent 允许集合内。
4. 不超过用户配置的费用、Token 和并发预算。
5. 再比较任务匹配度、延迟、成本和近期成功率。

选择结果保存 `selectionSource` 和 `selectionReason`。AI 只能在候选集合中选择，不能自行新增供应商、读取密钥或解除用户锁定。

## 5. 通过对话指定和动态更改模型

用户可以使用两种等价入口：

- 在 Agent 对话标题栏使用模型选择器。
- 在 Team Lead 或目标 Agent 对话中说“让代码审查 Agent 后续使用 X 模型”。

自然语言指令必须解析成结构化命令，并在对话中显示目标 Agent、目标模型和作用范围。模型名称匹配不唯一时必须要求用户选择，不能猜测供应商。

支持两个作用范围：

| 范围 | 行为 |
| --- | --- |
| `next_run` | 只覆盖下一次 Run，完成后恢复原策略 |
| `agent_default` | 修改该 Agent 后续 Run 的持久策略 |

切换规则：

- 不在一次正在进行的模型调用中间切换。
- Agent 正在流式输出时，新模型从下一次 Turn 生效；用户要求立即切换时，先取消当前 Run，再创建新 Run。
- 正在执行的工具调用继续按原审批和取消合同处理，模型切换不会重放工具。
- Thread、历史消息和 Artifact 不变；`ContextBuilder` 按新模型窗口和能力重新构建下一次上下文。
- 每个 Run 的 `modelSnapshot` 创建后不可变，UI 显示该 Run 实际使用的模型，而不是只显示 Agent 当前默认值。
- 切换成功、失败和自动回退都生成可见系统事件。

## 6. 所有 Agent 都是可查看的对话

### 6.1 Thread 归属

本文中的 `Thread` 是逻辑对话链，建议代码实体命名为 `AgentConversation` 或 `AgentConversationThread`；它与 Node `worker_threads`、CPU 线程和操作系统进程没有一一对应关系。

- Team Lead 有长期 Team Thread。
- 每个常驻 Agent 有长期 Agent Thread。
- 每个临时 Subagent 也有独立 Agent Thread，并关联来源 Task、父 Thread 和创建原因。
- Agent Instance 可以结束，Thread 和已提交消息不能随运行资源一起删除。

### 6.2 UI 行为

团队面板中的每个 Agent 都可以打开对话窗口，至少展示：

- Agent 名称、角色、状态和当前项目。
- 当前模型、选择来源和是否被用户锁定。
- 完整用户可见消息、工具调用、审批、Artifact 和 Run 分界。
- 来源任务、父 Agent、委派要求和最终结果。
- 更改模型、继续对话、取消 Run 和返回 Team Lead 的操作。

临时 Agent 完成后默认不占运行资源，但对话仍可查看。用户继续向其发消息时，在同一 Thread 下创建新的 Run 或可恢复实例，不修改已经完成的 Run。

### 6.3 直接对话与团队调度

用户可以直接与常驻 Agent 或可恢复的临时 Agent 对话，但任何会产生项目修改的新请求都必须形成可追踪的 WorkItem/Task，避免出现 Team Lead 和任务板看不到的隐形工作。Team Lead 保留团队总览，不必接收所有子 Agent 原始消息；默认只接收结构化结果和引用。

### 6.4 运行与线程模型

Agent 使用逻辑状态和按需 Run，不采用“一个 Agent 一个 OS 线程/进程”：

```text
Agent Profile + Conversation + 历史消息
  -> 空闲时只存在 SQLite/内存索引
  -> 收到任务后创建 Run
  -> Scheduler 取得并发槽
  -> 异步模型流 + 受限工具执行
  -> Run 结束后释放运行资源
```

- 模型 HTTP 流、MCP 连接和事件写入优先使用 Node 异步 I/O，由共享事件循环处理。
- CPU 密集解析、索引或压缩才进入固定大小的 `worker_threads` 池，池大小按机器能力和实测调整，不按 Agent 数量创建。
- Shell、MCP `stdio` 和浏览器可以创建子进程，但由各自的并发池、超时和生命周期管理，不与常驻 Agent 数量绑定。
- 默认同一 Agent Conversation 只有一个活动 Run，保证消息和副作用顺序；不同 Agent 的 Run 可以在全局并发上限内并行。
- 常驻或临时 Agent 结束后不保留专属线程、进程、模型连接或浏览器页面；需要继续时从持久状态恢复。
- 调度上限综合内存、活跃 Run、模型供应商限流、工具进程、浏览器页面和用户预算，不直接等于 CPU 逻辑线程数。

## 7. MCP 接入设计

### 7.1 支持范围

MCP Client 至少支持：

- 本地 `stdio` Server。
- 远程 Streamable HTTP Server。
- Tools、Resources 和 Prompts 的发现与调用。
- Server 启停、连接测试、超时、取消、重连和健康状态。
- 应用、Team、Project 和 Agent 四级启用范围。

旧式传输或供应商私有扩展只在真实兼容需求出现后增加，不在核心中写条件分支。

### 7.2 权限边界

- 用户显式登记或安装 MCP Server。
- Server 配置中的密钥和敏感环境变量使用凭据引用，不明文落 SQLite。
- MCP 返回的工具权限映射到本产品的 `read/write/execute/network` 权限。
- 工具调用仍经过 Schema 校验、项目边界、审批、超时、输出上限和审计。
- MCP Server 声称“已获授权”不能替代本产品审批。
- Agent 只能看到当前 Team、Project 和自身范围内启用的能力。

### 7.3 生命周期与稳定性

- 本地 Server 由 `McpManager` 管理进程树，应用退出时清理。
- Server 崩溃不会导致 Agent Runtime 退出；当前调用得到结构化失败。
- 能力清单带版本或内容哈希；Run 保存实际使用的能力快照。
- 工具、Resource 或 Prompt 清单变化时重新验证，不把旧 Schema 无限缓存。
- 日志限制大小并脱敏，完整大输出写入 Artifact。

## 8. Skill 接入设计

### 8.1 Skill 与 MCP 的区别

| 类型 | 主要内容 | 是否直接提供外部能力 |
| --- | --- | --- |
| Skill | 指令、流程、领域知识、模板、示例和可选脚本 | 否 |
| MCP | 工具、资源、Prompt 和远程/本地服务能力 | 是 |

Skill 可以声明依赖某些 MCP 或本机工具，但启用 Skill 不等于自动批准这些工具。

### 8.2 Skill 包结构

```text
<skill-name>/
├─ SKILL.md            # 必需入口；frontmatter 元数据、工作方法和约束
├─ references/         # 按需加载的参考资料
├─ templates/          # 输出模板
└─ scripts/            # 可选脚本，仍通过受控工具执行
```

规则：

- 不强制再创建一份重复 manifest；来源、版本、内容哈希和启用范围由 `SKILL.md` 元数据与本地注册表共同记录。
- Skill 来源分为内置、用户和项目，优先级和启用范围明确。
- 同一 Skill ID 的版本冲突必须可见，不静默覆盖。
- 默认只向模型提供名称和摘要，匹配当前任务后再加载正文和相关资料。
- Skill 的脚本不能直接获得 Node、Shell、文件或网络权限，必须通过 ToolRegistry。
- 每个 Run 记录实际加载的 Skill ID、版本和内容哈希，便于复现。
- Skill 更新不能修改已完成 Run 的历史快照。

## 9. 数据与事件

SQLite 至少补充以下实体或等价结构：

```text
model_providers
provider_endpoints
protocol_adapters
model_profiles
agent_model_policies
run_model_snapshots
mcp_servers
mcp_capabilities
skills
agent_skills
run_skill_snapshots
```

关键事件：

```text
agent.model_selected
agent.model_changed
model.connection_changed
mcp.server_started
mcp.server_stopped
mcp.capabilities_changed
skill.enabled
skill.disabled
```

Run 快照至少记录：`providerId`、`modelId`、`protocolAdapterId`、请求地址引用、选择来源、能力快照、上下文窗口、实际输入预算、启用的 MCP 能力和 Skill 版本。密钥、完整环境变量和供应商私有敏感响应不进入事件。

## 10. 验收场景

1. 配置两个不同供应商、至少两种对话协议和三个模型，自定义请求地址与上下文窗口后分别完成连接测试并能在同一 Team 中选择。
2. 未配置 Agent 默认模型时，新 Subagent 继承父对话实际模型。
3. 用户创建 Agent 时指定模型，实际 Run 和 UI 模型标识一致。
4. Team Lead 在 `auto` 模式选择兼容模型，UI 展示选择原因；用户随后将常驻 Agent 锁定到另一模型。
5. Agent 流式输出期间修改模型，当前 Turn 不混用模型，下一 Turn 使用新模型且 Thread 历史完整。
6. 切换到更小上下文模型后重新构建上下文，不沿用旧 Token 预算，也不删除原消息。
7. 打开任一临时 Agent 对话，能查看来源任务、消息、工具、审批、模型和最终结果；应用重启后仍存在。
8. 登记一个本地 MCP Server 和一个远程 MCP Server，完成能力发现、调用、取消和异常恢复。
9. MCP 工具尝试越过项目边界时被拒绝，Skill 脚本请求命令时仍出现正常审批。
10. 启用一个依赖 MCP 的 Skill，Run 快照记录 Skill 版本与 MCP 能力；禁用后新 Run 不再加载，历史 Run 不变化。
11. 登记一个 embedding 模型和一个不支持 Tool Calling 的聊天模型；两者不会被错误分配给需要工具的编码任务，纯对话场景仍可按能力使用聊天模型。
12. 创建大量空闲 Agent 后，OS 线程和子进程数不随 Agent 数量线性增长；启动超过并发上限的 Run 时多余任务排队，完成后运行资源释放。

## 11. 实施顺序

1. 先定义 `ModelRef`、能力矩阵、Provider Adapter 和 Mock 合同测试。
2. 实现模型中心、凭据保存和至少两类真实 Provider Adapter 验证，证明不是单一兼容协议硬编码。
3. 实现 Agent Thread、模型策略、继承和用户切换，再接 Team Lead 自动路由。
4. 实现 MCP Manager 的 `stdio` 与 Streamable HTTP、能力发现和统一权限映射。
5. 实现本地 Skill 发现、按需加载、依赖检查和 Run 快照。
6. 最后增加自动回退、成本路由、远程授权和 Skill 分发。

所有步骤先用 Mock 和固定本地服务做确定性测试，再接真实外部服务。供应商、MCP 或 Skill 接入失败不能阻塞已有本地文件、会话和 UI 功能。
