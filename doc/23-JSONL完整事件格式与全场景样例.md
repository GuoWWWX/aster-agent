# Aster JSONL 完整事件格式与全场景样例

> 2026-09-07 · v2 存储合同与验收样例〔INFER〕。本稿取代第 22 篇的早期短 ID/简化消息样例，其属性来源、路径和附件原则仍有效。样例可逐行解析并通过校验，但不是当前 v1 应用可直接导入的文件，尚未实施迁移。所有 UUID、模型、结果、用量均为演示数据，没有真的执行模型或命令。

## 1. 完整样例入口

每份展开版把全部记录放在一个代码块中；物理 JSONL 仍然每条一行，不是一个大 JSON 或数组。

| 场景 | 全部展开记录 | 原始文件 | 记录数（含头） |
| --- | --- | --- | ---: |
| 普通项目对话 | [展开阅读](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000001/conversation.preview.md) | [JSONL](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000001/conversation.jsonl) | 71 |
| 无项目临时对话 | [展开阅读](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000002/conversation.preview.md) | [JSONL](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000002/conversation.jsonl) | 12 |
| Subagent（含返工） | [展开阅读](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000003/conversation.preview.md) | [JSONL](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000003/conversation.jsonl) | 34 |
| 新建侧边对话 | [展开阅读](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000004/conversation.preview.md) | [JSONL](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000004/conversation.jsonl) | 13 |
| 团队负责人 | [展开阅读](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000005/conversation.preview.md) | [JSONL](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000005/conversation.jsonl) | 21 |
| 团队成员 | [展开阅读](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000006/conversation.preview.md) | [JSONL](./examples/conversation-storage-complete/conversations/00000000-0000-4000-8000-000000000006/conversation.jsonl) | 13 |
| 团队关系/工作项 | [展开阅读](./examples/conversation-storage-complete/teams/00000000-0000-4000-8000-000000000191/team.preview.md) | [JSONL](./examples/conversation-storage-complete/teams/00000000-0000-4000-8000-000000000191/team.jsonl) | 4 |

配套：[演示配置](./examples/conversation-storage-complete/fixture-config.json)、[只读校验脚本](./examples/conversation-storage-complete/verify.mjs)。配置提供演示项目、供应商、Agent 和工具定义，不要求软件新增同名配置文件；附件目录附有真实 UTF-8 文本快照。

## 2. 五类场景共用一个格式

| 场景 | `mode` | `projectId` | `parentConversationId` | 创建来源 / 关联 |
| --- | --- | --- | --- | --- |
| 普通项目对话 | `persistent` | 项目 ID | 顶层为 `null` | `origin.kind=user`；AI 创建的长期助手可为 `conversation` 并记录父级 |
| 无项目临时对话 | `persistent` | `null` | 顶层为 `null` | 无项目不代表用完自动删除 |
| Subagent | `subagent` | 解析后的项目或 `null` | 创建它的对话 ID | `origin.kind=subagent`；完成可返工，显式结束不删除 |
| 新建侧边派生对话 | `persistent` | 创建时复制，之后独立 | 来源对话 ID | `origin.kind=side`；另有独立上下文快照 |
| 团队对话 | `persistent` | 工作项解析的项目或 `null` | 按真实创建来源，不强制等于负责人 | `origin.kind=team`；团队、职责、工作项另行关联 |

仅把已有普通对话/Subagent 在侧边打开，是同一对话的另一视图，不新建日志或改类型。新建侧边会话才有独立 ID；源对话后续消息不自动进入它。保留现有关闭语义：折叠侧栏、关闭已有对话的预览不删除原对话；用户关闭专门新建的临时侧边会话标签，才进入该侧边会话的可恢复删除流程，不能按“有父 ID”一概删除。

团队不是共享聊天历史：`team.jsonl` 保存成员与工作项事实，负责人和成员各有自己的对话日志。`teamId` 是模板，`teamInstanceId` 是实例。对话中的团队运行快照只审计当时关系，不反向覆盖当前团队成员。

## 3. 目录与公共事件信封

```text
<ASTER_HOME>/
  conversations/<conversationId>/
    conversation.jsonl
    attachments/<attachmentId>.<ext>
    artifacts/<artifactId>.<ext>
  teams/<teamInstanceId>/team.jsonl
  temp/
```

第一行 `thread_header` 只保存 `type, version: 2, conversationId, createdAt`。之后每行都是一个完整事件：

| 字段 | 规则 |
| --- | --- |
| `type` | 本行事件类型 |
| `version` | 本稿为 2；未知版本不能强行解释或覆盖 |
| `conversationId` | 所属对话 UUID，与文件头一致 |
| `eventId` | 应用生成的事件 UUID，重试去重依据 |
| `sequence` | 本文件从 1 连续递增；不是消息序号，不跨文件排序 |
| `createdAt` | UTC ISO 时间，不用文件修改时间代替 |
| `payload` | 对应事件的数据对象，不编码成转义 JSON 字符串 |

第一条业务事件必须为 `conversation_created`。正文换行在物理行中转义为 `\n`。跨文件关系用 ID，不用相同序号匹配。团队日志以 `team_header/teamInstanceId` 替换身份字段，其他信封规则相同；不能把多个对话混写到一个文件。

## 4. 完整属性与运行快照

`conversation_created.payload` 保存：

| 区域 | 字段 | 更新规则 |
| --- | --- | --- |
| `properties` | `parentConversationId, mode, title, agentId, avatarIcon, projectId, modelSelection, permissionMode, archivedAt, pinOrder` | 父级/类型固定，其余追加变更 |
| `modelSelection` | `providerId, modelId, reasoning` | 整体替换；供应商 ID 与供应商内模型名称共同定位 |
| `origin` | `kind, sourceConversationId, sourceMessageId, teamInstanceId` | 创建来源固定，无来源项为 `null` |

ID/创建时间在文件头；状态、更新时间、活跃 Run、未读从事件还原。不另维护一份可写元数据 JSON 或 SQLite 对话属性/索引表。完整属性及空值解释见[第 22 篇](./22-JSONL对话存储与归属设计.md#3-属性怎么保存)。

`run_started.executionSnapshot` 冻结当次使用的：

- `agentId, agentSnapshot`：名称、指令、技能和插件配置，不能只依赖以后可能变化的 Agent 配置。
- `modelSelection` 三项和 `modelProfile`：协议、端点、能力；端点不得含凭据，密钥不落盘。
- `permissionMode, toolManifest, contextPolicy`：权限、完整工具参数 Schema/版本和上下文策略。
- `projectId, projectName, projectRootPath, workspaceRootPath`：项目及实际工作区。
- `teamBinding`：当次模板、实例、角色和工作项；非团队为 `null`。

当前项目路径由项目配置维护；历史 Run 保留旧路径。无项目时项目三项为 `null`，显式绑定工作区后可单独有 `workspaceRootPath`；本样例未绑定，故也为 `null`。命令另存真实 `cwd`，不拿对话目录当工作区。导入历史不自动授予本机执行权限。

模型/思考/Agent/权限/标题/项目切换统一追加 `conversation_properties_changed { changes, actor }`：缺省字段不变，`null` 清空，嵌套对象整体替换。设置修改不改变当前 Run 快照，只影响后续运行；转项目必须先处理活动执行和审批。样例在不同供应商下使用同名 `demo-chat`，验证供应商不能省略。

## 5. 消息与模型输出

| 事件 | `payload` 字段 | 含义 |
| --- | --- | --- |
| `user_message` | `messageId, content, attachmentIds` | 用户输入与有序附件 |
| `conversation_message_sent` | `messageId, deliveryId, targetConversationId, replyToDeliveryId, content, attachmentIds, expectReply, deliveryMode, toolCallId` | 发件事实；创建工具附带的首条任务也记录投递 |
| `conversation_message_received` | `messageId, deliveryId, sourceConversationId, sourceMessageId, targetConversationId, replyToDeliveryId, content, attachmentIds, expectReply, deliveryMode` | 收件方自己的消息，不冒充用户本人授权 |
| `conversation_message_delivered` | `deliveryId, targetConversationId, targetMessageId` | 接收已落盘，不表示任务完成 |
| `run_started` | `runId, triggerMessageIds, contextCheckpointId, executionSnapshot` | 处理已保存输入并冻结配置 |
| `run_input_consumed` | `runId, messageIds, mode` | 活跃 Run 在安全边界消费新消息 |
| `model_call_started` | `runId, modelCallId, attemptId, modelSelection` | 实际模型请求；一个 Run 可有多次 |
| `assistant_message_started` | `messageId, runId, modelCallId, channel` | 开始过程说明、最终答复或供应商返回的思考内容/摘要 |
| `assistant_message_delta` | `messageId, partIndex, text` | 正文分段，`partIndex` 从 0 连续递增 |
| `assistant_message_finished` | `messageId, status, artifactIds` | 输出完成或中断，不再复制完整正文 |
| `model_call_finished` | `runId, modelCallId, finishReason, usage, providerState` | 请求终态、真实用量和协议状态；未知用量为 `null` |
| `run_terminal` | `runId, status, finalMessageId, error, pendingDeliveries` | Run 终态及待回传计划原子保存；最终回复通过 ID 引用 |
| `conversation_read` | `throughMessageId` | 阅读位置；时间就是事件时间 |
| `conversation_ended` | `actor, reason` | 明确结束，保留历史，不等于删除 |

同一 `messageId` 的 delta 拼成一个输出，UI 不生成多个气泡。非流式返回同样使用“开始→一个 delta→结束”；中断保留已落盘部分。供应商实际返回的 `reasoning_content/reasoning_summary` 与 `commentary/final` 分开保存；未返回的私有推理不采集。

收件按 `deliveryId` 去重，落盘后才确认；两端发件/收件是各自审计，不是同一对话重复历史。需要回复时通过 `replyToDeliveryId` 关联原交办，不让每条消息自动互相回复。收件可触发新 Run，也可在已有 Run 安全边界消费；未消费输入保持可恢复。样例展示同一个 Subagent 接收两次交办、分别运行和回传，不重新建对话。

`run_terminal.pendingDeliveries` 保存待回传消息的完整发件字段；无需回传时为空数组。运行完成与回传意图在同一行落盘，再按这些固定 ID 写发件、收件及确认事件。这样即使进程在“任务完成、尚未回传”之间退出，也能从终态计划重试投递；无需重新调用模型生成结果。接收确认去重，已收到的不会再触发一个 Run。

## 6. 工具与审批

| 事件 | `payload` 字段 | 规则 |
| --- | --- | --- |
| `tool_call_requested` | `runId, modelCallId, toolCallId, name, arguments` | 保存完整工具名称和参数对象 |
| `tool_execution_prepared` | `runId, toolCallId, operationId, cwd, approvalRequired` | 冻结执行意图；真实文件提案另带路径、Diff、前置条件 |
| `tool_approval_requested` | `approvalId, runId, toolCallId, scopeConversationId, requestedBy` | 请求者身份含对话/Agent ID、名称、头像 |
| `tool_approval_decided` | 同一审批/Run/Tool ID、`decision, actor, scopeConversationId` | 点击入口与实际权限主体分开 |
| `tool_started` | `runId, toolCallId, operationId` | 原工具开始，不因批准新建工具调用 |
| `tool_output_delta` | `toolCallId, stream, partIndex, text` | stdout/stderr 有序完整输出 |
| `tool_result` | `runId, toolCallId, status, value, error, artifactIds, outputComplete` | 工具唯一终态，成功/失败/取消都记录 |

工具调用和返回必须用原 `toolCallId` 对应；不能把失败丢掉，不能把结果当作用户输入。命令输出已在 delta 中时，`value` 只保存退出码等结构化结果，不再重复输出。长输出可以保存在产物文件，预览截断不等于删除原件。

主对话审批 Subagent 时，决定写入子对话原日志，保持原 `runId/toolCallId/approvalId`。`actor.viaConversationId` 表示点击入口，`scopeConversationId` 是被授权对话。样例用 `allow_once`；本对话允许还须明确授权范围和生命周期，不能从入口位置猜测。等待审批时执行已取消/重启中断才记过期；已接受的批准不能事后改成失效。导入/重放记录只展示事实，不恢复有效授权或重跑工具。

## 7. 压缩与侧边上下文

| 事件 | 字段 | 恢复规则 |
| --- | --- | --- |
| `context_compaction_started` | `checkpointId, previousCheckpointId, coveredThroughSequence, coveredThroughEventId, trigger, modelSelection` | 固定旧边界与实际摘要模型 |
| `context_compaction_completed` | 同一 ID/边界、`summary, usage, error` | 成功后才发布新 Checkpoint |
| `context_seeded` | `sourceConversationId, sourceThroughEventId, sourceThroughSequence, sourceCheckpointId, visibility, snapshot` | 新侧边对话的独立初始上下文 |

压缩覆盖用本日志“事件序号＋事件 ID”校验，不能切断工具请求/结果或覆盖未处理输入；范围只前进，失败保留旧摘要和原文。摘要保存目标、约束、事实、决定、待办及来源/附件引用。它只替代模型请求里的旧历史，原始记录一个也不删。样例为展示格式而手动压缩一段很短的完整历史，实际触发与保护轮数由上下文策略决定。

侧边快照必须自足：已覆盖部分复制摘要，未覆盖部分复制完整消息及匹配工具块；附件复制并用 `snapshot.attachmentIdMap` 重映射，不能只留父文件路径。样例在压缩边界分叉，因此尾部 `messages` 为空；`visibility=context_only` 表示继承内容不重复渲染为新气泡。来源 ID 用于追溯，不是唯一内容来源。Subagent 不写这类继承快照，只接收明确投递的任务背景。

## 8. 附件、其他过程与异常

- `attachment_imported`：`attachmentId, fileName, relativePath, mimeType, sizeBytes, importMethod`。`file_picker/paste` 是用户入口，`copy` 是派生对话复制。图片/PDF/Office 原件独立保存，JSONL 不塞 Base64；模型主动读取才产生读取工具记录，自动附图不伪造工具。
- 产物用 `artifact_published { artifactId, relativePath, mimeType, sizeBytes, contentHash }` 先登记再引用。完整历史需要的原件必须随备份保留，可重建缓存才放 `temp`。
- 任务清单用 `task_list_updated { taskListId, items, status }` 保存完整当前版本；条目包含 ID、标题、状态和必要原因，不强制绑定执行者。关闭也追加事件。
- 编辑消息用 `user_message_revised { messageId, revisionId, replacesRevisionId, content, attachmentIds, invalidatedRunIds }`，保留旧版本但从当前上下文排除被替代分支；取消排队用 `input_cancelled { messageId, reason }`。
- 模型失败用 `model_call_failed { runId, modelCallId, attemptId, error, retryable }`；再次尝试保留语义调用 ID、更换尝试 ID，不重放已完成工具。压缩失败用 `context_compaction_failed { checkpointId, error }`，审批过期用 `tool_approval_expired { approvalId, runId, toolCallId, reason }`。
- 失败/取消的 `run_terminal` 可以没有最终答复，此时 `finalMessageId=null`，保留部分输出与具体错误；不能为了结束 Run 编造成功结果。
- 耗时/用量/缓存是运行审计，Provider 不透明状态按协议保存，只在协议、端点、模型匹配时恢复；它不是提示词。日志不复制配置密钥，但用户消息可能自带敏感内容，备份仍需保护。

以上是同一信封的扩展合同；附带脚本只验证实际样例覆盖的事件，**不是生产全量 Schema、恢复执行器或导入器**，不能拿样例通过代替实现这些异常分支的测试。

## 9. 写入、恢复与验证

1. 每个文件单写者分配序号；附件/产物先安全发布，再追加引用。事件持久化后才更新内存索引和界面。
2. 按事件 ID、工具调用 ID、投递 ID 分别去重。读取日志绝不执行命令、批准操作或重新发送外部消息。
3. 尾部半行、中段损坏、未知版本和冲突引用要区分处理并保护原件；不能静默跳过坏记录当作完整历史。原始记录不能靠重新调用模型补造。
4. 运行中副作用可能已发生，不能凭旧日志/Graph Checkpoint 自动重跑；执行恢复状态与可读对话历史分开。
5. 备份含对话、附件、产物；团队另含成员日志和团队关系。项目代码、有效供应商配置、凭据需单独准备。删除采用可恢复清理任务。
6. 对话事实以 JSONL 为准，列表可重建内存索引，不要求 SQLite 对话属性/历史副本；项目、团队和执行恢复等独立领域不等于对话索引。

从仓库根目录运行：

```powershell
node doc/examples/conversation-storage-complete/verify.mjs
```

覆盖 6 个对话、8 次 Run、7 个工具调用、6 次跨对话投递、1 次压缩、1 份侧边快照及团队成员/工作项；14 个反例检查序号、模型/路径、审批主体、工具结果、分段、发送方、回执链、终态回传计划、压缩边界、附件越界等。展开版与原始 JSONL 自动对照。脚本只读样例，不调用模型、不执行样例命令、不修改用户数据。
