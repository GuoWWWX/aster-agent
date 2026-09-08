# Aster JSONL 对话存储与归属设计

> 2026-09-07。§1 为当前实现〔FACT〕；v2 记录格式为后续演进〔INFER〕。第 23 篇及 `doc/examples/` 展示 v2 场景，最新属性规则以本文为准。

## 1. 当前存储

- 日志：`<ASTER_HOME>/conversations/<conversationId>/conversation.jsonl`；旧平铺文件启动时迁入该目录，冲突时保留旧文件备份。
- 对话属性、消息、Run、工具、审批、任务清单、Agent 消息、Subagent 状态和压缩摘要只持久化到 JSONL。首次升级先将旧 SQLite 会话完整导出并验证回放，再删除 `db.sqlite` 中的对话表。
- 旧日志已存在不代表导出完成：缺少创建记录或完整迁移快照时，从旧库追加补齐，原有行不重写；中断后检查记录继续导入。恢复以迁移快照为基线，只重放后续业务事件。旧消息内嵌附件也恢复引用；启动快照格式升级为 `2`，格式 `1` 重新回放后生成完整快照。〔FACT｜`thread-log-legacy-importer.ts`；`event-projector.ts`；`agent-database.ts`〕
- 页面分页和搜索直接读取 JSONL；内存只缓存消息 ID、顺序、文件偏移与更新位置，最多缓存 4 条对话的位置索引。追加时扫描新增记录，外部修改时重建；不建立 SQLite FTS。
- 页面首屏只取最新 120 项，接近顶部时提前约 1.5 个视口加载上一页并保持滚动锚点；搜索直接加载命中位置附近一页，不加载中间全部消息，定位后可继续向前或向后翻页。
- 启动优先恢复 JSONL 内的轻量状态快照，只回放快照后的记录；没有可用快照时按最多 128 个事件或约 1 MB 分批回放。每条非活跃对话恢复后释放历史正文，具体边界见 §5。
- 未完成边界：列表及部分执行状态仍依赖进程内 SQLite `TEMP` 表；任务清单、事件索引与回放游标已改用内存 Map。首次建立消息位置索引仍须扫描对应文件，未压缩消息过多时仍可能占用较大内存；不能据此宣称全部改造完成。
- 项目归属来自属性，不从文件路径推算。

依据：〔FACT｜`apps/desktop/src/main/storage/agent-home.ts`；`thread-log.ts`；`conversation-lifecycle-service.ts`；`event-projector.ts`〕。改进后的全量存储与 ER 图见[第 21 篇](./21-数据库实体关系图.md)。

## 2. 目标目录与分工

```text
<ASTER_HOME>/
  conversations/
    <conversationId>/
      conversation.jsonl    属性、变更、完整对话过程
      attachments/          附件原件，按附件 ID 命名
      artifacts/            必须保留的大输出、Diff、截图
  workspaces/<conversationId>/ 无项目且未手动绑定目录时的工作文件，按需创建
  temp/                     可清理、可重建的中间文件
```

| 数据 | 存储 |
| --- | --- |
| 对话属性和全部过程 | JSONL 为唯一主数据；不要求 SQLite 对话属性表或索引表 |
| 列表、搜索、状态查询 | 从 JSONL 重建有界内存视图；不建立持久对话索引或 SQLite FTS |
| 项目、团队运行数据 | `db.sqlite`；项目用 `projects`，团队保留实例、执行范围、实际成员、工作项、工作项事件 5 张表 |
| Agent、团队模板、模型、全局设置 | 统一 `settings.jsonc`；完整目录和配置结构见[第 24 篇](./24-Aster目录结构与JSONC配置.md) |
| 执行恢复、删除清理 | 同一 `db.sqlite` 中的检查点表和清理任务表，不替代对话历史 |

团队模板及模板成员只保存在 `settings.jsonc`。协作计划、分配和结果引用合并到工作项事件；工作项通信携带 `teamWorkItemId`、`workItemRevision`，分配/回执另带 `assignmentId`（普通协作可为空），正文仍在各自 JSONL。

普通、无项目、Subagent、侧边和团队成员对话使用同一目录结构，按 ID 平级存放。改名、转项目、变更团队不改目录；未来若支持项目内存储，使用 `.aster/conversations/<id>/`。无项目不等于可自动删除。

`conversations/` 保存对话数据，`workspaces/` 保存默认工作文件；两者不合并，也不在对话目录里嵌套 `workspace/`。项目、手动绑定和默认目录的选择规则见[第 24 篇 §1.1](./24-Aster目录结构与JSONC配置.md#11-工作目录的选择)。

### 2.1 附件

按钮选择、粘贴文件和粘贴截图共用导入流程；纯文本粘贴进入正文。

| 字段 | 含义 |
| --- | --- |
| `attachmentId` | 稳定 UUID；消息和工具引用，不以文件名去重 |
| `fileName` | 展示名称；截图无名称时自动生成 |
| `relativePath` | 相对对话目录，例如 `attachments/<id>.png` |
| `mimeType`、`sizeBytes` | 校验后的类型和字节数 |
| `importMethod`（可选） | `file_picker` / `paste` / `copy` |

- 导入复制原始字节，后续原文件变化不影响快照。先写临时文件并校验，再发布文件、追加 `attachment_imported`；失败保留恢复状态。
- 消息通过有序 `attachmentIds` 关联附件；JSONL 不存二进制或 Base64。原件在 `attachments/`，可重建提取/缩略图在 `temp/`，必须回放的派生结果在 `artifacts/`。
- 模型取得名称、ID、类型、大小；`read_attachment` / `view_attachments` 按 ID 读取，后端校验所属对话和路径。项目文件仍按工作区路径读取。
- 每条消息最多 10 个附件、单文件最多 25 MB；校验类型、字节和路径，限制解析资源，不执行附件中的宏、脚本或指令。
- 发送失败保留草稿；有效草稿需跨重启保存。未发送附件移除后记丢弃事件，无引用才清理；编辑、归档、压缩不破坏历史附件。
- 跨对话转交时复制快照并生成目标 ID，子对话不自动取得父附件。缺失文件显示原因，不阻塞其他历史。
- 修改存储根目录默认仅影响新对话；旧目录经校验迁移。备份包含 JSONL、原件和产物。

| 内容 | 模型读取 | 界面 |
| --- | --- | --- |
| 本轮新图片 | 视觉模型默认随输入接收；用户要求只存不读时仅给引用 | 消息缩略图 |
| 历史图片 | 按需调用 `view_attachments`，支持多张 | 工具展开区并排缩略图 |
| 文本、代码 | 默认给说明，`read_attachment` 按需分段读取 | 文件卡片及实际读取文本 |
| PDF、Word、Excel、PPT | 支持的解析器按页/段落/工作表读取；扫描页需渲染或 OCR | 文件名、类型、大小卡片及读取结果 |
| 不支持、损坏、加密文件 | 保存原件并返回不能读取的原因 | 文件卡片和错误说明 |

图片/文件条等高，超出裁切、滚轮横向翻找，图片可放大。只为真实工具调用生成记录，自动附图不伪造调用。导入不等于已发送或已读取；能力/预算不足要提示。历史附件按需发送，保持已有请求前缀；裁剪要标明且不丢原件、全文或本轮必读内容。

现有附件工具已使用 ID 入参〔FACT｜`apps/desktop/src/main/tools/conversation-attachment-tool.ts:12`〕；上面的新目录、事件与格式扩展属于目标方案。

## 3. 属性与记录

UTF-8 JSONL：每行一个完整对象，无外层数组、行间逗号；字符串换行写为 `\n`。`version: 2` 是拟议文件格式版本，不是软件、模型版本或轮数。

### 不可变属性

`conversationId`、`createdAt` 位于 `thread_header` 根层；其余放入 `thread_header.properties`。

| 字段 | 含义 |
| --- | --- |
| `conversationId` | 对话 UUID；创建后不变 |
| `createdAt` | 创建时间；不随修改、运行或搬迁更新 |
| `mode` | `persistent` / `subagent`；改变类型需新建对话 |
| `parentConversationId` | 固定父级；顶层为 `null`，不随项目/团队变化 |
| `origin` | 创建来源：`creationMethod`、`sourceConversationId`、`sourceMessageId`、`teamInstanceId`；无来源项为 `null` |

下表是创建示例，后三列属于 `origin`；`origin.teamInstanceId` 记录创建时的团队，不代表当前归属。

| 场景 | `mode` | `parentConversationId` | `creationMethod` | `sourceConversationId` | `sourceMessageId` | `teamInstanceId` |
| --- | --- | --- | --- | --- | --- | --- |
| 用户普通对话 | persistent | null | user | null | null | null |
| 用户无项目对话 | persistent | null | user | null | null | null |
| 对话创建长期助手 | persistent | c-main | conversation | c-main | null | null |
| 临时任务 Subagent | subagent | c-main | subagent | c-main | null | null |
| 新建侧边对话 | persistent | c-main | side | c-main | null | null |
| 团队入口创建成员 | persistent | null | team | null | null | team-instance-a |
| 顶层对话回复处分叉 | persistent | null | fork | c-main | m-reply-10 | null |

- 有明确触发消息就记录 `sourceMessageId`；团队由其他对话发起时也记录实际来源。
- 无项目由 `projectId: null` 表示。在侧边打开已有对话不新建记录、不修改来源。
- Fork 记录源对话和分叉点，复制截至该点的历史、所需附件并重映射内部 ID，之后独立追加。兄弟分叉继承源对话的父级，不能把来源 ID 当父 ID。

### 可变配置

初始值完整写入 `conversation_created.properties`；变更追加 `conversation_properties_changed.changes`。

| 字段 | 含义 |
| --- | --- |
| `title` | 标题 |
| `agentId` | 所用 Agent 配置 ID |
| `avatarIcon` | 对话头像；`null` 时按对话 ID 生成像素头像 |
| `projectId` | 项目 ID；无项目为 `null` |
| `workspaceRootPath` | 无项目对话的手动工作区；未绑定为 `null` |
| `modelSelection.providerId` | 应用中的供应商配置 ID |
| `modelSelection.modelId` | 该供应商接口中的模型名称 |
| `modelSelection.reasoning` | 思考配置，例如 `{ kind: "effort", value: "high" }`；可为 `null` |
| `permissionMode` | 当前权限偏好，不等于临时授权 |
| `archivedAt` | 归档时间；未归档为 `null` |
| `pinOrder` | 置顶顺序；未置顶为 `null` |

模型以 `providerId + modelId` 定位，三项选择整体保存；`reasoning: null` 不一概表示关闭思考。密钥和接入地址留在供应商配置中。AI 创建时未指定就复制父对话的模型选择，之后独立；显式选择需校验有效性。配置缺失仍可读历史，执行前重新选择。

### 运行与阅读状态

由事件还原，不作为独立可写配置：

| 字段 | 来源 / 含义 |
| --- | --- |
| `status` | 创建、Run 和显式生命周期事件 |
| `statusChangedAt` | 最近真实状态转换时间 |
| `endedAt` | 显式结束时间；未结束为 `null` |
| `updatedAt` | 最近业务事件时间，含属性和已读更新 |
| `lastActivityAt` | 最近消息/运行活动，不含改名、已读更新 |
| `activeRunId` | 当前 Run；未运行为 `null` |
| `lastRunStatus` | 最近 Run 终态；未运行为 `null` |
| `throughMessageId` | `conversation_read` 记录的已读位置；初始为 `null` |
| `lastReadAt` | 最近已读事件时间；初始为 `null` |
| `hasUnread` | 已读位置与后续需提醒结果比较；初始为 `false` |

初始空闲，更新时间取创建时间。工作完成、显式结束、归档、删除是不同操作；`completed` 表示本轮完成，仍可继续工作。

### 项目、路径与关联信息

| 信息 | 取得方式 |
| --- | --- |
| `projectName`、`projectRootPath` | 按 `projectId` 查项目配置；根路径为 `projects.root_path`，不在对话属性重复维护 |
| `workspaceRootPath` | 有项目时取项目根路径；无项目时优先用 JSONL 中的手动绑定，否则解析为 `<ASTER_HOME>/workspaces/<conversationId>/` |
| `conversationDirectory`、`logFilePath` | 本机定位器解析对话目录及 `conversation.jsonl` |
| `attachmentsDirectory`、`artifactsDirectory` | 对话目录下的 `attachments/`、`artifacts/` |
| `tempDirectory` | 按存储/执行设置解析，仅放可清理中间文件 |
| `agentName`、供应商/模型显示名 | 配置 ID 查询；历史需要时保存当时快照 |
| `teamId`、`teamInstanceId`、`teamRole` | 当前团队成员关系 |
| `teamWorkItemId` | 本次团队工作项/运行绑定，不固化为对话属性 |
| 子对话、Subagent 数量 | 按父 ID、类型、状态查询，不重复保存计数 |
| 消息、工具、审批、通信、任务清单、压缩、用量、错误、产物 | 各自事件和 ID |
| 实际 Agent 指令、工具/技能/插件、上下文配置 | 执行快照及过程事件，不复制密钥 |
| 侧栏、标签、滚动位置 | 独立 UI 状态；关闭已有对话预览不删除对话 |
| 删除进度 | 独立可恢复清理任务 |

无项目时项目 ID、名称、根路径均为 `null`，但实际工作区可以是手动绑定目录或默认工作目录。解绑事件中的 `null` 仅清空手动绑定，不表示没有默认工作区；按需创建目录不新增项目记录。命令 `cwd` 和 Run 的 `workspaceRootPath` 保存实际执行路径，不冒充项目根；受管绝对路径不必全部暴露给前端/模型。

每个 `run_started.executionSnapshot` 保存实际 `agentId`、`modelSelection`、`permissionMode`、`projectId`、`projectName`、`projectRootPath`、`workspaceRootPath`。项目改名/搬迁、模型/Agent 切换不改旧快照；移机后重新确认路径和授权。

旧字段对应：`id → conversationId`；`hasUnreadResult → hasUnread`；`isArchived/isPinned` 由时间/顺序推导；`threadKind` 拆为 `mode` 与团队职责；`subagentTaskStatus` 归入统一状态；`activeSubagentCount` 仅作查询结果。当前工作区绑定仍在 `conversations.workspace_root_path`。

### 读写规则

1. 第一行写 `thread_header`；第二行写唯一的 `conversation_created`。两条完整落盘后才发布新对话。
2. 文件头后每条事件带 `type`、`version`、`conversationId`、`eventId`、`sequence`、`createdAt`；序号从 1 连续递增。
3. 不使用 `payload`；固定/初始属性用 `properties`，变更用 `changes`，Run 快照用 `executionSnapshot`。
4. `changes` 仅允许上表的 9 个顶层可变字段；固定字段、未知字段必须拒绝。未出现不变，`null` 只清空可空字段，嵌套对象整体替换。
5. 加载文件头、初始配置，再重放变更；状态单独由事件还原。不改旧行，不另存可写 `metadata.json`，配置变更不覆盖历史 Run。
6. 单对话单写入者；可靠落盘后更新内存和界面，按事件 ID 去重。不支持的版本拒绝写入并保留原件。

### 完整属性与两轮问答示例

13 条虚构记录；为便于阅读展开显示，实际 JSONL 每条压成一行。短 ID 仅用于示例，正式生成 UUID；v2 尚不能由当前 v1 应用导入。

```json
{
  "type": "thread_header",
  "version": 2,
  "conversationId": "c-main",
  "createdAt": "2026-09-07T01:00:00.000Z",
  "properties": {
    "mode": "persistent",
    "parentConversationId": null,
    "origin": {
      "creationMethod": "user",
      "sourceConversationId": null,
      "sourceMessageId": null,
      "teamInstanceId": null
    }
  }
}

{
  "type": "conversation_created",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e1",
  "sequence": 1,
  "createdAt": "2026-09-07T01:00:00.000Z",
  "properties": {
    "title": "项目 A 检查",
    "agentId": "agent-dev",
    "avatarIcon": null,
    "projectId": "project-a",
    "modelSelection": {
      "providerId": "provider-a",
      "modelId": "model-a",
      "reasoning": {
        "kind": "effort",
        "value": "medium"
      }
    },
    "permissionMode": "ask_before_changes",
    "archivedAt": null,
    "pinOrder": null
  }
}

{
  "type": "attachment_imported",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e2",
  "sequence": 2,
  "createdAt": "2026-09-07T01:00:00.100Z",
  "attachmentId": "att-image",
  "fileName": "截图.png",
  "relativePath": "attachments/att-image.png",
  "mimeType": "image/png",
  "sizeBytes": 12800,
  "importMethod": "paste"
}

{
  "type": "attachment_imported",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e3",
  "sequence": 3,
  "createdAt": "2026-09-07T01:00:00.200Z",
  "attachmentId": "att-sheet",
  "fileName": "统计表.xlsx",
  "relativePath": "attachments/att-sheet.xlsx",
  "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "sizeBytes": 8192,
  "importMethod": "file_picker"
}

{
  "type": "user_message",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e4",
  "sequence": 4,
  "createdAt": "2026-09-07T01:00:01.000Z",
  "messageId": "u1",
  "content": "你好，先确认这两个附件的名称，不用分析内容。",
  "attachmentIds": [
    "att-image",
    "att-sheet"
  ]
}

{
  "type": "run_started",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e5",
  "sequence": 5,
  "createdAt": "2026-09-07T01:00:02.000Z",
  "runId": "r1",
  "userMessageId": "u1",
  "executionSnapshot": {
    "agentId": "agent-dev",
    "modelSelection": {
      "providerId": "provider-a",
      "modelId": "model-a",
      "reasoning": {
        "kind": "effort",
        "value": "medium"
      }
    },
    "permissionMode": "ask_before_changes",
    "projectId": "project-a",
    "projectName": "项目 A",
    "projectRootPath": "D:/demo/project-a",
    "workspaceRootPath": "D:/demo/project-a"
  }
}

{
  "type": "run_terminal",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e6",
  "sequence": 6,
  "createdAt": "2026-09-07T01:00:03.000Z",
  "runId": "r1",
  "status": "completed",
  "assistantMessage": {
    "messageId": "a1",
    "content": "你好，已收到截图.png和统计表.xlsx，暂未分析内容。"
  }
}

{
  "type": "conversation_properties_changed",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e7",
  "sequence": 7,
  "createdAt": "2026-09-07T01:01:00.000Z",
  "changes": {
    "agentId": "agent-review",
    "modelSelection": {
      "providerId": "provider-b",
      "modelId": "model-b",
      "reasoning": {
        "kind": "effort",
        "value": "high"
      }
    },
    "permissionMode": "read_only"
  }
}

{
  "type": "conversation_properties_changed",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e8",
  "sequence": 8,
  "createdAt": "2026-09-07T01:02:00.000Z",
  "changes": {
    "projectId": "project-b",
    "title": "项目 B 复查"
  }
}

{
  "type": "user_message",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e9",
  "sequence": 9,
  "createdAt": "2026-09-07T01:02:01.000Z",
  "messageId": "u2",
  "content": "请再说一句你好。",
  "attachmentIds": []
}

{
  "type": "run_started",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e10",
  "sequence": 10,
  "createdAt": "2026-09-07T01:02:02.000Z",
  "runId": "r2",
  "userMessageId": "u2",
  "executionSnapshot": {
    "agentId": "agent-review",
    "modelSelection": {
      "providerId": "provider-b",
      "modelId": "model-b",
      "reasoning": {
        "kind": "effort",
        "value": "high"
      }
    },
    "permissionMode": "read_only",
    "projectId": "project-b",
    "projectName": "项目 B",
    "projectRootPath": "D:/demo/project-b",
    "workspaceRootPath": "D:/demo/project-b"
  }
}

{
  "type": "run_terminal",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e11",
  "sequence": 11,
  "createdAt": "2026-09-07T01:02:03.000Z",
  "runId": "r2",
  "status": "completed",
  "assistantMessage": {
    "messageId": "a2",
    "content": "你好，我是审查助手。"
  }
}

{
  "type": "conversation_read",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e12",
  "sequence": 12,
  "createdAt": "2026-09-07T01:02:04.000Z",
  "throughMessageId": "a2"
}
```

| 还原结果 | Agent | 供应商 / 模型 / 思考 | 权限 | 项目 / 当时路径 |
| --- | --- | --- | --- | --- |
| 初始配置、r1 | agent-dev | provider-a / model-a / medium | ask_before_changes | project-a / D:/demo/project-a |
| 当前配置、r2 | agent-review | provider-b / model-b / high | read_only | project-b / D:/demo/project-b |

两个项目的名称和路径另行登记在项目配置中；首轮快照不变。已读位置为 `a2`，`hasUnread = false`。附件元数据为虚构，不附真实文件。示例未展示的工具、审批等实际过程同样必须保存。

## 4. 移动与 Fork

| 操作 | 修改 | 保留 |
| --- | --- | --- |
| 改名、排序、置顶 | 标题或排序记录 | ID、路径、归属、历史 |
| 搬到另一磁盘 | 本机定位信息 | 业务属性和历史 |
| 转项目、关联/取消项目 | 追加 `projectId` 变更 | ID、父级、类型、历史、模型与附件 |
| 移动项目目录 | 项目根路径；项目内日志重新定位 | 项目/对话 ID、旧 Run 快照 |
| 加入/退出团队 | 团队成员关系 | 父级、类型、历史 |
| Fork | 新 ID、源对话/分叉点及复制内容的 ID 映射 | 源对话和分叉点前的历史 |

- 转项目只影响选定对话；运行、排队、审批或旧资源占用期间禁止改绑，团队托管对话走团队入口。
- 转移/解绑清除失效手动绑定与临时授权，后续按项目、手动绑定或默认工作区重新解析；旧工作文件不因此自动搬移或删除。归属看属性和成员关系，不看文件路径。
- 物理迁移暂停写入、复制校验、切换定位并保存恢复进度；成功前保留源文件。

## 5. 加载、备份与恢复

- v1 按 256 KB 分块逐行校验和回放，不用一次性读取整个文件字节；文件末尾仅有未完成 JSON 时截断到最后完整换行，完整但无效的记录拒绝加载且不改原文件。
- 模型编译使用增量位置索引，只读取最新压缩摘要及未覆盖正文；索引不保留正文、工具参数或供应商隐藏推理数据。历史关联检索直接读 JSONL，在最近 1000 条已覆盖用户/模型消息中返回最多 24 条、每条约 4000 字符的片段，不查询 SQL。统计只读索引中的供应商用量，已废弃 Run 不计入。日志损坏明确报错，不回退到旧 SQL 历史。〔FACT｜`thread-log.ts`；`context-compiler.ts`〕
- 位置索引最多保留 4 个对话。仍需完整历史的引用工具使用逐条回放；其正文热缓存最多 4 个对话、估算总量 16 MiB。该预算不是进程内存上限，未压缩尾部及单条超大事件仍需要读取正文。`read_agent_conversation` 按序列游标选择最多 1000 条候选消息，关键词检索补取命中的 Run，最终受 token 预算限制。
- 任务清单运行态使用内存 Map，JSONL 事件及启动快照负责持久化和恢复；事件批次失败时清单与 SQL 运行态一起回滚。旧任务清单表仅用于迁移前兼容，迁移后不建立 TEMP 清单表。〔FACT｜`agent-database.ts`〕
- 空闲对话在启动恢复后及正常退出时向同一 JSONL 追加 `state_checkpoint`，只保存属性和业务状态，不复制历史消息。状态未变不重复追加；有活跃 Run、待处理消息或活跃子任务时跳过，快照正文超过 1 MiB 时也跳过。启动在末尾 8 MiB 内反向查找兼容快照，找到后只回放后续事件；没有可用快照则正常全量流式回放。原始历史保留，分页和模型上下文仍读原事件。〔FACT｜`event-projector.ts`；`thread-log.ts`〕
- 时间线支持前向、后向和按消息 ID 定位，三种游标互斥；后端按文件偏移读取当前页正文。位置索引每 128 条记录让出事件循环，冷构建排队防止相互驱逐；搜索每 64 条消息让出执行时间、跳过工具正文，只保留有界命中结果。旧导入日志的整包快照兼容读取，一次页面请求只解析一次该快照。
- 属性修改先校验，再追加 JSONL 并更新内存投影；追加失败会恢复修改前的内存快照。多对话排序无法跨文件原子提交，失败时为已经写入的日志追加补偿快照并保留原始错误。
- 备份包含该对话 JSONL、附件、产物及其已有的 `workspaces/<conversationId>/`；父/子对话、团队数据、项目代码和手动绑定目录另行纳入，见[第 21 篇 §10](./21-数据库实体关系图.md)。无需再备份 SQLite 对话表。
- 导入遇到同 ID 冲突、损坏或未知版本时保护原件；引用缺失可看历史，执行前重新绑定配置与工作区。
- 路径禁止越界；正文和配置按私有数据保护。恢复不重跑已完成工具、不恢复旧审批授权；启动中断的 Run、审批、模型重试和 Subagent 回执写回 JSONL，避免下一次启动恢复成旧状态。
- 首次迁移在同一事务中移除旧对话表和跨存储 SQL 外键，清理 WAL 并压缩数据库；任一 JSONL 无法验证时终止启动，不删除旧数据。
- 剩余工作：移除执行状态的临时 SQL 依赖，降低首次上下文重建的峰值内存。无可用快照的日志仍需流式全量恢复；现有文件位置索引可重建，不能成为主数据。
- 删除对话只移除 ThreadLog 自有的 `conversation.jsonl` 及其隔离备份；附件和其他产物由引用清理流程决定，不能递归删除整个对话目录。共享附件只有最后一个引用移除后才删除。
