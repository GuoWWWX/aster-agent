# Aster 目录结构与 JSONC 配置

> 2026-09-07 · 目录、统一 JSONC、单库与对话目录迁移已实现；JSONL v2 和对话 SQLite 投影移除仍按第 22 篇继续迁移。

## 1. 数据根目录

`<ASTER_HOME>` 默认是 `<用户主目录>/.aster`，Windows 如 `C:\Users\<用户名>\.aster`。设置页可选择自定义目录，重启后生效；也可用绝对路径环境变量 `ASTER_HOME` 指定，兼容旧变量 `AGENT_HOME`。

解析优先级是 `ASTER_HOME`、`AGENT_HOME`、用户选择、默认目录。环境变量存在时设置页只读。用户选择保存在 Electron `appData/aster-agent/storage-location.json`；该稳定启动指针不放进可移动的数据目录，否则启动前无法定位 `settings.jsonc`。显示名、默认目录名、环境变量名和稳定 ID 统一定义在 `packages/protocol/src/application-metadata.ts`。〔FACT｜`apps/desktop/src/main/storage/application-storage-location-store.ts`〕

```text
<ASTER_HOME>/
├── settings.jsonc                       唯一应用配置，用户可编辑
├── db.sqlite                            项目、团队、清理、执行检查点与统一迁移版本
├── conversations/
│   └── <conversationId>/
│       ├── conversation.jsonl           属性及完整对话事件
│       ├── attachments/                 已导入原件，包含未发送草稿附件
│       └── artifacts/                   需要保留的大输出、Diff、截图
├── skills/<skillId>/                    SKILL.md、脚本与资源
├── plugins/<pluginId>/                  plugin.json、代码与资源
├── mcp/<serverId>/                      MCP 辅助脚本与资源
├── workspaces/<conversationId>/         无项目且未手动绑定目录时的默认工作区
├── temp/                               可重建缩略图、提取缓存和中间文件
├── logs/                               脱敏诊断日志
└── electron-profile/                    Electron 本机状态，位置规则见下文
```

- 普通、无项目、Subagent、侧边、团队成员对话都按 ID 平级存放。归属从 JSONL 属性和 SQL 关系读取，不从目录名推算；格式见[第 22 篇](./22-JSONL对话存储与归属设计.md)。
- 项目名称、根目录、置顶和排序仍存 `projects` 表，不再复制进配置文件。项目代码、`.git/`、用户下载/另存的文件位于各自目录；本方案不自动创建项目内 `.aster/settings.jsonc` 或覆盖项目权限。
- 目录按需创建。全部 SQL 数据已只用一个 `db.sqlite`；最终保留表见[第 21 篇](./21-数据库实体关系图.md)。迁移期间仍有可重建的对话投影表。运行时可能出现 `db.sqlite-wal`、`db.sqlite-shm`，它们是同一数据库的辅助文件，不是另一个数据库，不要在运行中手动删除。
- Electron 状态沿用现有规则：显式设置管理根目录时用 `electron-profile/`，否则仍在 Electron 默认 `userData`。网站 Cookie、缓存、页面 `localStorage`、本机标签/面板状态不是模型配置，也不混入 JSONL。〔FACT｜`apps/desktop/src/main/storage/agent-home.ts:65`〕
- 切换目录不在运行中搬动已打开的 SQLite、JSONL 或 Electron Profile。重启后使用新目录；原目录保留且不自动删除或复制，用户可切回。恢复默认只修改启动指针。

### 1.1 工作目录的选择

对话记录始终在 `conversations/`；模型读取、创建、修改工作文件及执行命令使用下表中的工作区，不在对话数据目录直接操作。

| 条件 | 实际工作目录 |
| --- | --- |
| `projectId` 非空 | 对应 `projects.root_path` |
| `projectId` 为 `null`，用户手动绑定了目录 | 已授权的绑定目录 |
| `projectId` 为 `null`，未手动绑定目录 | `<ASTER_HOME>/workspaces/<conversationId>/` |

- 默认工作区在首次确需文件或命令操作时按需创建，只聊天或打开页面不创建。它不新增项目表记录，`projectId`、项目名称和项目根路径仍为 `null`。
- 手动绑定、解绑记录在 JSONL；默认工作区路径由管理根目录与对话 ID 解析，不再存一份可写路径。解绑清空的是手动绑定，后续操作回到默认工作区；Run 快照保存当时实际工作目录。
- 已绑定的项目或目录不可用时提示修复，不静默改用默认工作区。
- 文件与命令操作沿用对话权限。Main 校验工作区边界，不能仅靠设置命令 `cwd` 实现隔离；默认工作区不授予访问其他对话、上级配置或数据库的权限。
- `workspaces/` 中是需要保留的工作文件，不是缓存。归档、切换项目或绑定目录不自动搬移、删除旧文件；已发送附件、有效草稿和历史产物也不能按临时缓存清空。
- 备份对话时一并纳入其已有的 `workspaces/<conversationId>/`。永久删除时明确提示自有工作目录的清理范围，再走可恢复清理流程；不删除用户项目或手动绑定的外部目录。

## 2. `settings.jsonc` 分区

UTF-8，一个完整对象。支持 `//`、`/* ... */` 注释及尾逗号；不是 JSONL，不允许任意 JavaScript 表达式。只在根层保留一个配置格式 `version`，与 JSONL 的版本独立。

| 字段 | 类型 | 内容 |
| --- | --- | --- |
| `version` | integer | 本版为 `1`；用于格式迁移，不是软件版本 |
| `general` | object | 默认权限模式、审批方式、Queue/Steer、发送快捷键、用量显示 |
| `appearance` | object | 主题、导航与面板默认布局；不代替各对话已保存的面板状态 |
| `permissionPolicies` | object | 各类工具的默认策略；不保存“允许一次”等活跃授权 |
| `agents` | array | Agent 配置：ID、名称、头像、角色、指令、模型策略、能力和权限规则 |
| `teams` | array | 团队模板：负责人、成员及职责、指令、启用与容量；不是已创建的团队实例 |
| `providers` | array | 供应商 ID、名称、接口格式、地址、`apiKey`、模型列表及能力选项 |
| `defaultModelSelection` | object / null | 默认 `{ providerId, modelId, reasoning }`，无配置时为 `null` |
| `recentSelection` | object / null | 最近用户选择的三项模型配置及 `updatedAt`，仅用于新对话初始化 |
| `modelCatalog` | object | 默认上下文窗口和模型能力匹配规则，不重复保存供应商密钥 |
| `contextCompression` | object | 全局压缩阈值；模型单独指定时使用模型配置 |
| `terminal` | object | Shell、可执行路径、编码、字体及行高 |
| `browser` | object | 搜索引擎、默认缩放、下载前询问 |
| `integrations` | object | MCP 服务配置、技能注册、启用状态与额外技能目录 |
| `plugins` | array | 插件开关，每项仅 `{ id, enabled }`；目录信息从文件扫描 |

供应商保留可选 `icon`、`note`、`websiteUrl`；模型保留 `contextCompression`、`reasoningOptions`、连接状态及最近成功时间。其余分区沿用现有业务字段，不因合并文件丢失用户配置。

`providers[].id` 使用稳定 UUID；`models[].modelId` 是该供应商接口的模型名称，不是另造 UUID。两者组合定位模型。`reasoning` 使用 `effort`、`custom_effort` 或 `token_budget`，不指定时为 `null`；必须是该模型支持的选项。

## 3. 配置示例

示例覆盖全部分区，省略的普通字段按默认值补齐；数组显式写 `[]` 表示空列表。地址、模型名称和能力数值仅作示意，使用时填写实际服务信息。当前版本已经读写该结构；字段仍须符合对应 Schema，未知字段不保证生效。

```jsonc
{
  "version": 1,
  "general": {
    "defaultPermissionMode": "ask_before_changes",
    "approvalReviewer": "user",
    "defaultMessageDeliveryMode": "queue",
    "sendShortcut": "enter",
    "showContextUsage": true
  },
  "appearance": {
    "themeMode": "dark",
    "projectNavigatorOpen": true,
    "projectNavigatorWidth": 288,
    "filePanelOpen": false,
    "filePanelWidth": 520
  },
  "permissionPolicies": {
    "workspace-read": "allow",
    "workspace-search": "allow",
    "command-run": "ask",
    "patch-write": "ask",
    "browser-control": "ask",
    "git-write": "unavailable"
  },

  // 可以配置多个供应商；密钥允许手动以明文填写。
  "providers": [
    {
      "id": "00000000-0000-4000-8000-0000000000c9",
      "name": "示例供应商",
      "apiFormat": "openai-chat-completions",
      "baseUrl": "https://api.example.com/v1",
      "apiKey": "",
      "models": [
        {
          "modelId": "demo-chat",
          "displayName": "示例模型",
          "contextWindow": 128000,
          "reasoningOptions": [
            { "kind": "effort", "value": "medium", "enabled": true }
          ]
        }
      ]
    }
  ],
  "defaultModelSelection": {
    "providerId": "00000000-0000-4000-8000-0000000000c9",
    "modelId": "demo-chat",
    "reasoning": { "kind": "effort", "value": "medium" }
  },
  "recentSelection": null,
  "modelCatalog": {
    "defaultContextWindow": 128000,
    "models": []
  },

  // Agent 是可复用的配置；具体对话及其工作状态不在这里保存。
  "agents": [
    {
      "id": "default-agent",
      "name": "默认 Agent",
      "avatar": { "kind": "icon", "icon": "bot" },
      "enabled": true,
      "isDefault": true,
      "description": "通用助手",
      "role": "通用执行",
      "instructions": "根据用户目标处理任务，并核对执行结果。",
      "modelStrategy": "inherit",
      "model": "当前对话模型",
      "capabilityScope": "inherit_all",
      "skillIds": [],
      "mcpServerIds": [],
      "permissions": { "allow": [] }
    }
  ],
  "teams": [
    {
      "id": "demo-team",
      "name": "示例团队",
      "enabled": true,
      "description": "团队模板，不会因读取配置自动创建对话",
      "instructions": "围绕当前任务协作。",
      "leadAgentId": "default-agent",
      "memberIds": ["default-agent"],
      "memberConfigurations": {},
      "maxWorkers": 3,
      "projectScope": "all"
    }
  ],
  "contextCompression": {
    "mode": "percentage",
    "percentageThreshold": 80,
    "tokenThreshold": 100000
  },
  "terminal": {
    "shell": "system",
    "shellPaths": { "pwsh": "", "powershell": "", "cmd": "", "bash": "" },
    "outputEncoding": "auto",
    "fontFamily": "Consolas, monospace",
    "fontSize": 12,
    "lineHeight": 1.55
  },
  "browser": {
    "searchEngine": "bing",
    "defaultZoomPercent": 100,
    "askForDownloadLocation": false
  },
  "integrations": {
    "mcpServers": [],
    "skills": [],
    "skillDirectories": []
  },
  // 插件不存在时也保留设置；这里不会自动安装插件。
  "plugins": [
    {
      "id": "example-plugin",
      "enabled": false
    }
  ]
}
```

MCP 的 `command`、`args`、`env`、`headers`、`url` 等服务定义统一在 `integrations.mcpServers`；技能入口用 `integrations.skills[].entryPath`。资源相对路径以 `<ASTER_HOME>` 解析，外部路径必须显式配置。`mcp/` 不再维护另一份可写服务配置；第三方资源自带的 `plugin.json` 等文件保持其原格式。

### 插件目录与开关

- `plugins[].id` 对应清单中的稳定插件 ID，同一 ID 只能配置一次；`enabled` 必须为布尔值。名称、版本、路径、清单和内容哈希从 `plugins/` 扫描取得，不复制进 JSONC 或 SQLite。
- 插件缺失或校验失败时不可用，但保留用户开关，恢复文件后仍沿用。有效插件没有显式开关时沿用当前默认启用行为；启用不等于执行，不跳过工具审批。〔FACT｜当前默认值见 `apps/desktop/src/main/storage/agent-database.ts:3440`〕
- 启动、安装/移除或用户刷新时扫描并校验清单、重复 ID、路径和资源范围；列表查询只读内存目录。开关变化只更新配置和内存，不重复扫描全部文件。插件内容使用前仍验证边界，不信任缓存路径。
- 备份时保存插件文件与开关，不备份扫描缓存。当前实现从目录扫描插件并把开关写入 JSONC，不再保留插件目录 SQL 表。〔FACT｜`apps/desktop/src/main/plugins/plugin-catalog.ts`〕

## 4. 读取、修改与生效

- 读取：JSONC 解析 → 字段、类型、唯一 ID、模型与成员引用校验 → 应用默认值。不用正则删除注释，不把配置当代码执行。
- 修改：Main 统一串行写入，按字段修改语法树，保留注释、缩进及无关字段；再写同目录临时文件、原子替换。保存前核对文件是否被外部修改；有冲突就重新读取，不覆盖用户编辑。
- 错误：指出字段或行列，不输出密钥；无效配置保留原文件和上次有效内存配置。首次启动无有效配置时提示修复，不自动覆盖为默认文件。新文件缺失时先按 §5 迁移旧配置；新旧配置均不存在才创建默认配置。
- 用户编辑与界面设置操作同一份文件。保存校验通过后刷新配置；新 Shell/浏览器默认项用于新实例。正在执行的 Run 保留已冻结快照；后续 Run 解析新配置，历史不变。
- 已有对话恢复自己的 Agent、模型、思考与权限选择，不被全局默认重置。新子对话未指定模型时复制父对话选择；普通新对话使用有效最近选择，再兜底到默认模型。对话内切换追加 JSONL 事件。
- `apiKey` 可以明文保存，空字符串表示未填写；需要认证的服务在执行前提示补齐。不强制加密，不再另建 `credentials.json`。Main 调用服务时才使用密钥，不通过模型目录、日志、Run 快照或 JSONL 输出；配置工作区通用读取工具也不能把整份配置暴露给模型。
- 配置文件限制当前系统用户访问，不提交 Git。分享/导出默认去除密钥及敏感 MCP 环境变量、请求头；完整备份明确提示包含凭据。注释中也不要填写密钥，分享时需一并检查注释。

## 5. 旧配置、数据库迁移与备份

启动时按下表迁移旧存储。旧文件和旧库只读导入、保留为备份；已有 `settings.jsonc` 的值优先。〔FACT｜`apps/desktop/src/main/bootstrap/index.ts`；`apps/desktop/src/main/settings/settings-jsonc-file.ts`〕

| 旧存储 | 新位置 |
| --- | --- |
| `application-settings.json` | `general`、`appearance`、`permissionPolicies`；`agentDirectory.agents/teams` 提到根层 `agents/teams` |
| `model-credentials.json` | `providers`、`defaultModelSelection`、`recentSelection`；`encryptedApiKey` 解密后写 `apiKey` |
| `model-catalog.json` | `modelCatalog` |
| `context-compression-settings.json` | `contextCompression` |
| `terminal-settings.json` | `terminal` |
| `browser-settings.json` | `browser` |
| `integration-settings.json` | `integrations`；旧 `mcp/<id>/mcp.json` 作为编辑副本核对后停止双写 |
| 旧 `agent.sqlite → plugin_catalog` | `id`、`enabled` 合入 `plugins`；名称、版本、路径、清单、哈希和扫描更新时间改为扫描计算 |
| 旧 `agent.sqlite`、`langgraph-checkpoints.sqlite` | 统一为 `db.sqlite`；按目标结构转换后导入，只保留一份 `schema_migrations`，详见[单库迁移](./21-数据库实体关系图.md#91-单库生命周期与迁移) |

迁移逐个校验旧格式，去掉各文件的外层版本号，保留 ID、能力、默认/最近选择、用户规则及可选字段。旧默认供应商/模型组合为 `defaultModelSelection`，原来未指定思考程度时写 `reasoning: null`。密钥只在本机解密；解密失败则保留旧文件并提示重新输入，不写入假成功结果。

新文件校验成功并原子落盘后才切换读取；已有 `settings.jsonc` 不得被旧文件覆盖。旧文件先保留备份，不同时双写，清理由用户确认。迁移后的明文文件按同样的访问限制保护。

插件迁移从旧库备份读取全部开关（包括 `false`）。按 ID 仅补齐 JSONC 缺失项，已有用户设置优先；保留暂时缺失插件的设置。原子保存并重新读取核对后，新 `db.sqlite` 不再创建插件目录表。旧库作为备份保持不变；重试不覆盖新设置，也不再次启用被禁用插件。

备份配置用 `settings.jsonc` 加技能/插件/MCP 资源；备份对话需 JSONL、附件、产物及其已有的默认工作目录；项目、团队和执行恢复统一备份 `db.sqlite`。项目代码和用户绑定目录另行备份。SQLite 使用一致性备份或停机复制，不单独复制运行中的主库文件。需要完整恢复桌面状态时另备份实际 Electron `userData`；临时缓存和已轮转的诊断日志不作为业务恢复依据。

`storage-location.json` 只是机器级启动指针，不属于可移动数据备份。把数据目录迁移到另一台机器后，在目标机器设置页重新选择该目录即可。

## 6. 关联定义

- [应用与 Agent/团队字段](../packages/protocol/src/application-settings.ts)、[模型与思考选项](../packages/protocol/src/conversation.ts)：当前字段依据；本文只调整配置落盘分组，示例未展开全部可选字段。
- [终端](../packages/protocol/src/terminal.ts)、[浏览器](../packages/protocol/src/browser.ts)、[压缩](../packages/protocol/src/context-compression.ts)、[集成](../packages/protocol/src/integration.ts)：各分区业务参数。
- [目标 ER 图](./21-数据库实体关系图.md)、[JSONL 结构](./22-JSONL对话存储与归属设计.md)：配置以外的数据，不在本文重复定义。
