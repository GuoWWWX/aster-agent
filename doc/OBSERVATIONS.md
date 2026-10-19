# 工程与工具审查观察记录

2026-10-18 工具审查范围及逐组入口见 [工具设计复核](./11-AI工具体系与生命周期设计.md#工具与提示词复核2026-10-18)，2026-10-19 工程结构核对见下文。这里区分已证实缺陷与可选改进，不把推断当成失败原因。

| 编号 | 严重度／类别 | 定位与现象 | 处理状态 |
| --- | --- | --- | --- |
| T1 | 高／缺陷 | 〔OBSERVE｜缺陷｜高〕LangChainModelAdapter.assistantToolCalls：真实 Responses 最终函数参数完整，SDK 流式调用却被执行为空对象；两轮共四次任务更新因此失败。 | 已修复；最终 completed 快照优先，JSON／Schema 校验不放宽 |
| T2 | 中／矛盾 | 〔OBSERVE｜矛盾｜中〕base-system.md 的命令段曾声称工具只在进程退出后返回，与 run_command 的 running 回执不符。 | 已修复；依赖步骤和成功结论前读取真实终态 |
| T3 | 中／矛盾 | 〔OBSERVE｜矛盾｜中〕AgentCommunicationTool.getDefinitions 总说明曾把所有忙碌接收方描述为立即投递，与自己的子代理默认 queue 不符。 | 已修复；总说明与 deliveryMode 参数及既有队列测试对齐 |
| T4 | 低／歧义 | 〔OBSERVE｜歧义｜低〕TaskListTool.getDefinitions 仍称 task list，未说明关闭清单不影响持久任务。 | 已修复；明确 local execution checklist 与 persistent task records |
| T5 | 中／缺陷 | 〔OBSERVE｜缺陷｜中〕AgentRuntime.collaborationContext：动态任务摘要曾漏掉 completionRequested；历史同一任务出现 completed → running → completed 的多余修订。 | 已修复；每轮带待确认标记，明确申请成功后不重提、不为状态对齐改回进行中 |
| T6 | 低／可选改进 | 〔OBSERVE｜债务｜低〕AgentRuntime.createToolHandlerRegistry：常规文件、命令及协作工具共同暴露；纯路由角色仍可取得较宽工具集合。 | 已实现角色收窄；六种身份由同一范围控制展示、策略及执行，提示词按实际工具裁剪。伪造越界写入在 Handler 前拒绝；不据此宣称固定性能提升 |
| T7 | 低／可选改进 | 〔OBSERVE｜债务｜低〕UserQuestionTool.execute 返回 questionId/status 等直接字段，多数执行工具返回 ok/value。各自调用端已有合同，尚无证据表明这是本轮参数丢失原因。 | 待裁决；如统一，须同时迁移上下文、UI、恢复快照及测试，不能只包一层对象 |
| T8 | 中／歧义 | 〔OBSERVE｜歧义｜中〕真实快速协作把未领取的队列预览 ID 当作已接受消息登记任务，来源校验失败。 | 已修复；预览专用字段和状态、先交办再领取再处理原文，校验错误明确恢复步骤。独立目标实测各一份记录及唯一原消息来源 |
| T9 | 中／缺陷 | 〔OBSERVE｜缺陷｜中〕群聊协调者可列出全局群任务，但读详情仍走普通会话所有者检查。 | 已修复；仅按当前群实例校验详情读取，跨群拒绝，未扩大任务修改权限 |
| T10 | 中／缺陷 | 〔OBSERVE｜缺陷｜中〕开发重启后安全暂停的队列，领取曾抛普通异常并显示 INTERNAL_ERROR，模型可能继续无效等待。 | 已修复；显式 queue_paused/user_resume_required，保留暂停，不自动重放；正常忙碌子代理排队另用新对话完整验收 |

〔FACT｜apps/desktop/src/main/model/tool-arguments.ts:37〕JSON 参数仍须为对象；工具自己的 Zod Schema 继续校验必填、UUID、范围和业务约束。真实空对象不凭空补齐字段。

〔INFER〕优先级应是“修复参数传输 → 消除提示词与执行合同冲突 → 按失败类型回归”。工具数量多或说明较长本身，不足以证明某次工具失败。角色范围现已按明确会话身份收窄；更细的专业岗位限制仍需明确能力合同，不从自然语言名称猜测权限。

## 代码结构核对（2026-10-19）

本节保留首次规范梳理时的源码快照（实施起点 `82a5aff`），行数包括空行和注释，只用于提示规模，不凭行数断言存在运行缺陷；之后的代码整理进展见下节。新增规模要求是评审约束，尚未建立自动行数门禁。

初次记录 4 项中等规模债务、2 项低等文档矛盾；文档矛盾已修正，代码整改分批进行。

### 中等严重度：代码规模债务

| 编号 | 严重度／类别 | 定位与现象 | 建议及处理状态 |
| --- | --- | --- | --- |
| S1 | 中／债务 | 〔OBSERVE｜债务｜中〕`apps/web/src/features/chat/workspace-content.tsx:1` 原有 9,768 行。 | 第二批迁出时间线投影、工具结果解析／展示、附件与错误；现 6,573 行，输入与事件等生命周期尚未拆分 |
| S2 | 中／债务 | 〔OBSERVE｜债务｜中〕`apps/web/src/features/settings/settings-workspace.tsx:1` 原有 4,552 行。 | 首批已按菜单页和局部职责迁出，总入口现 213 行；局部页面及共享组件继续按规则维护 |
| S3 | 中／债务 | 〔OBSERVE｜债务｜中〕`apps/desktop/src/main/agent/agent-runtime.ts:1` 原有 6,678 行。 | 首批迁出辅助策略，第二批迁出工作区工具装配与重连观察；现 5,809 行，审批／协作及图执行包装仍需分批整理 |
| S4 | 中／债务 | 〔OBSERVE｜债务｜中〕`apps/desktop/src/main/storage/agent-database.ts:1` 原有 12,009 行。 | 首批迁出合同／映射，第二批迁出建表与35版迁移；现 9,311 行，事务和领域方法仍需分批整理 |

行数依据为两批实施起点及当前源码的完整物理行计数，核对日期 2026-10-19。后续改动重新计数，不把本表当成持续更新的指标仪表盘。〔FACT｜`apps/web/src/features/chat/workspace-content.tsx:1`、`apps/web/src/features/settings/settings-workspace.tsx:1`、`apps/desktop/src/main/agent/agent-runtime.ts:1`、`apps/desktop/src/main/storage/agent-database.ts:1`〕

### 低等严重度：文档漂移

| 编号 | 严重度／类别 | 现象 | 处理状态 |
| --- | --- | --- | --- |
| S5 | 低／矛盾 | 〔OBSERVE｜矛盾｜低〕第 06／07 篇目录图混有未建立的 `pages` 和独立 Package，圆角基线与现有 3／5／7px Token 不一致。 | 已修复描述；规划 Package 保留为未来方案，未删除规划内容 |
| S6 | 低／矛盾 | 〔OBSERVE｜矛盾｜低〕README 把 `pnpm build` 描述为完整类型检查，但 Desktop 构建使用 tsup，完整检查另有 `typecheck`。 | 已修复描述；不改脚本。〔FACT｜`apps/desktop/package.json:17`、`apps/web/package.json:11`〕 |

### 本次同步范围与归宿

| 产物 | 类型／角色 | 本次处理 |
| --- | --- | --- |
| `apps/web/src`、`apps/desktop/src`、`packages/protocol` 及根／工作区脚本配置 | PRACTICE／结构与实现事实 | 只读核对目录、入口、主题 Token、存储与命令；不是全仓功能审计 |
| `README.md` | DESCRIPTION／门面 | 补当前能力、架构、数据分工、真实目录和规范入口 |
| 第 06／07／13 篇 | DESCRIPTION／规范 | 补目录／命名、私有与共享归属、文件规模、复用／设计原则及前后端性能规则 |
| `AGENTS.md`、`CONTRIBUTING.md`、`文档索引.md`、本文件 | DESCRIPTION／执行入口、索引与观察 | 同步约束入口、纯文档验证方式和遗留规模债务 |
| 历史需求、迁移计划和架构候选图 | DESCRIPTION／历史与规划 | 本轮不重写；已关联的未来 Package 明确标为未建立，保留原规划供后续决策 |

本次经验：先把实际目录与目标边界分开，再写新增文件放置规则；否则规范会诱导创建重复 `pages` 根目录或空壳 Package。文件规模必须与职责和状态所有权一起审查，机械分文件仍可能保留原耦合。

2026-10-19 设置页示例补充：第 06 篇 §5.1.1 增加总入口、菜单页面、设置内共享布局和多文件局部功能的组织示例；第 07 篇提供对应入口。已核对现有 SettingsSectionHeader 与 SettingsConfigurationCard／Group，说明复用现有实现，目录图明确属于渐进拆分目标；本轮仍只改文档，没有迁移设置页源码，也未新增代码缺陷判断。

以上为仅更新规范时的记录，当时尚未开始代码拆分；后续实施与验收以下节为准。原 T7 的既有待裁决状态保持不变。

## 首批结构实施（2026-10-19）

本批在同一未合并的工程规范分支实施，目标是明确全局外壳、设置页和后端辅助模块的职责；未重写协议、数据库迁移、事务、审批策略或 Agent 执行循环。

| 范围 | 实施与验证边界 |
| --- | --- |
| 全局 Layout | AppShell 管理交互，WorkbenchLayout 提供所有功能页共用的纯外框；新增跨页回归验证外壳／侧栏不重建，主题和面板偏好保留 |
| 设置 | 入口缩至 213 行；菜单页分别归位，设置专用共享组件留在 settings/components；模型 controller 统一草稿、队列和异步请求，各局部展示通过窄合同组合 |
| 设置依赖修正 | 阈值纯计算归入 model-provider-state，controller 不反向依赖展示 TSX；连续编辑回归确认合并保存、输入焦点和展开状态保持 |
| 后端 | 原类主体与原调用 API 保留；类型、映射、纯策略按职责迁出，没有从小模块反向导入大入口造成运行时循环依赖 |
| 验收方式 | 各块先跑专项回归，再做根级类型／Lint、扩大测试和构建；浏览器 fixture 使用当前 worktree 编译与 MockAgentClient，不打开另一个桌面窗口，也不读取／复制用户配置 |

〔FACT｜`apps/web/src/features/settings/settings-workspace.tsx:43`、`apps/web/src/components/layout/workbench-layout.tsx:16`、`apps/desktop/src/main/agent/agent-runtime.ts:303`、`apps/desktop/src/main/storage/agent-database.ts:187`〕当前实施已落到上述模块；不能把辅助代码迁出等同于两个后端大类已达标。

实施验收：前端 1,177、后端 1,475、Protocol 252、脚本 19 项，共 2,923 个不同测试用例通过；根级 Lint、Typecheck、Build 通过。后端首次完整执行有两个套件因本工作区缺 Electron 二进制而加载失败，旧下载镜像返回 404；补齐已安装的同版本依赖后，这两个文件的 11 项单独重跑通过，其余 1,464 项已通过。会操作真实桌面的 Windows native control 测试文件（7 项）未执行，不把它们计入通过数。构建仍有既有的大包体提示。

全局 Layout 3 文件 26 项专项、设置 11 文件 98 项专项及后端 418 项专项均已先行验证，包含新增的跨页状态保留、跨区域合并保存／输入焦点回归。真实浏览器 fixture 覆盖 12 个设置菜单 × 两个窗口尺寸 × 浅深主题共 48 个场景，保留 4 张截图并检查页面脚本错误；本批未进行安装包和真实桌面窗口启停验收。

### 本批旁路发现：既有保存边界

| 编号 | 严重度／类别 | 定位与现象 | 处理状态 |
| --- | --- | --- | --- |
| S7 | 中／风险 | 〔OBSERVE｜风险｜中〕模型页 450ms 延时保存的 effect 在卸载时只清理 timer；编辑后立即切页可能取消尚未发出的最后一笔保存。原实现已有同一逻辑。 | 已独立修复（`24b3950`）：离开前提交最后完整快照，写队列归同一 AgentClient，失败草稿仅存内存并可在重进时恢复；旧结果不串 Provider，新建 Provider 以创建前后 ID 差集定位，避免 URL 规范化导致重复创建 |

〔FACT｜`apps/web/src/features/settings/models/model-settings-save-queue.ts:11`、`apps/web/src/features/settings/models/use-model-settings-autosave.test.tsx:1`〕结构迁移时曾保留原保存策略；后续独立修复已通过模型／设置 3 文件 48 项回归，包含 11 项新增生命周期用例。450ms 连续编辑合并保留，密钥未写入浏览器持久存储。

## 第二批结构实施（2026-10-19）

继续使用同一未合并的工程规范分支。三位执行代理分别独占聊天、存储和 Runtime，主代理复核后逐块提交；未修改协议、产品功能、模型请求内容、审批策略或已有迁移。每块先跑基线，阶段回归通过后才扩展。

| 独立提交 | 边界与规模变化 | 定向验证 |
| --- | --- | --- |
| `f81d8d2` 存储 schema 生命周期 | Database 10,888 → 9,311 行；迁出 V1／旧库兼容、TEMP 投影和 35 版有序迁移，保留连接、事务及启动恢复 | 两阶段各 103 项；storage 全域 17 文件 302 项通过 |
| `e57e36e` 工具装配与重连观察 | Runtime 6,015 → 5,809 行；装配依赖使用窄接口，重连通过持久化、事件和连接状态回调参与原 LangGraph 执行 | 原 260 项基线、工具块 271 项、含 LangGraph 的最终 294 项通过；新增 17 项 |
| `a087e7b` 聊天投影与工具展示 | 工作区 9,768 → 6,573 行；提取 15 个 chat 内具名模块，不改变状态 owner、key、DOM 和展示分支 | 阶段 251／254 项；chat 最终 44 文件 482 项通过，含新增 12 项 |

〔FACT｜`apps/desktop/src/main/storage/agent-schema-migrations.ts:9`、`apps/desktop/src/main/agent/runtime-workspace-tool-handlers.ts:69`、`apps/desktop/src/main/agent/runtime-model-retry-policy.ts:22`、`apps/web/src/features/chat/tool-detail.tsx:49`〕新增业务模块共 22 个，均少于 1,000 行，最大 963 行；依赖扫描未发现涉及新模块的运行时循环。数据库核对保留 222 个公开声明、297 个原方法体；15 个迁出方法经连接参数替换后 AST 和 SQL 字面量等价。聊天 166 个原顶层函数体均等价，独立复核覆盖工具分支、图片索引、复制和跳转回调。

真实浏览器 Mock 夹具覆盖 1440×900／1024×680、浅深主题及完成／运行／审批共 12 个场景，4 张截图经检查；额外验证重新渲染后工具展开状态和输入草稿保留、命令输出可见，未发现脚本错误或页面横向溢出。该证据不替代安装包或真实模型验收。

### 本批验证时发现的既有测试边界

并行执行前后端测试与静态检查时，后端初次完整执行为 1,489 通过、3 失败：两个真实执行 64 轮的 Runtime 测试触发默认 5 秒门限，群聊集成测试在默认 1 秒 `vi.waitFor` 内未等到完整汇总。原用例及相应执行路径与本批起点一致；降低并发、保留原门限重跑两个文件，179 项全部通过。未修改测试超时、断言或业务核心来取得通过；最终整体结果见下文。

最终自动化回归：Web 157 文件 1,189 项、Desktop 串行 136 文件 1,492 项、Protocol 26 文件 252 项、根脚本 19 项，合计 2,952 个不同用例通过。后端第二次完整执行使用 `--maxWorkers=1`，未调整时间限制，失败用例均在该次完整执行中通过；会操作真实桌面的 `windows-driver.test.ts` 7 项排除在运行范围外，未计入通过数。根级 Lint、Typecheck、Build 通过，仍有既有的大包体提示。当前同分支 `pnpm dev` 窗口、HTTP Renderer 和本机控制只读查询均响应正常。未验证安装包或真实供应商模型调用，也没有把纯结构整理宣称为性能提升。

后续可独立改进测试：群聊用例改为事件驱动的终态等待，保留整体门限；64 轮用例补齐失败时的 Runtime／工具释放。现有证据说明负载敏感，不能据此认定群聊消息丢失。〔OBSERVE｜风险｜低｜`apps/desktop/src/main/agent/collaboration.integration.test.ts:571`、`apps/desktop/src/main/agent/agent-runtime.test.ts:4067`〕

剩余边界：三个入口仍超过 1,000 行，本轮为渐进迁移，不宣称大文件已全部达标。聊天的请求／事件、输入、队列与审批，Runtime 的协作和执行包装，以及 Database 的领域事务／日志恢复仍需各自基线与分块验收；侧边工作区、项目导航等其他大文件未在本轮改动。

## 第三批结构与行为复核（2026-10-19）

本批继续审查前后端职责、事务与资源生命周期。下表是已提交边界；“审查覆盖”与“整改完成”分别记录，不以入口行数下降代替正确性验证。〔FACT｜`apps/desktop/src/main/agent/agent-runtime.ts:1`、`apps/desktop/src/main/storage/agent-database.ts:1`〕

| 范围 | 已提交边界与定向证据 |
| --- | --- |
| Runtime | 摘要计算与持久化编排分开；统一工具权限分类但每次读取当前配置；六组工具回放状态按 Run 归属；批调度只接策略、准备和 ToolNode 三个动作。摘要、权限、回放、批调度先后通过 463／267／282／296 项相关回归。审批、事实提交、通知及 LangGraph 循环仍在原入口 |
| SQLite | 历史、上下文摘要、团队协作只读投影、附件元数据、Run 事件写入各自归属；附件取消／删除与 completeRun 外层事务原位。Run 仓储最终 372 项串行回归通过，220 个 public 签名、379 条 SQL 字面量及终态顺序保持 |
| IPC | 135 个 Handler 按领域迁出，所有 172 个 Handler 共用原注册器／错误边界；独立 AST 核对注册次序与回调一致。38 项 IPC 回归包含全部 invoke 通道的非可信来源拒绝与统一释放 |
| 模型 | Provider 回放恢复、SDK 消息转换、版本配置 Schema／纯迁移分别迁出；计量、首字时间、流式、取消与错误仍归 Adapter，凭据解码与配置文件 IO 仍归 Store。Model／Graph／Runtime 311 项回归通过；V1–V6 与空 JSONC／无效引用另有 8 项边界测试 |
| JSONL | 合同与纯上下文投影分开；整个 ThreadLog 类的追加、扫描、字节游标、恢复与缓存主体不变。356 项存储／上下文回归通过，独立投影新增 9 项 |
| 命令工具 | 进程、输出解码、超时、取消和释放统一归 CommandSessionRunner；Registry 保留审批、工作目录解析和项目冲突锁。13 项新增特征回归及相关 22 文件 382 项通过；16 个公开入口、批任务持锁／服务启动后释放及原权限范围保持 |
| 侧边工作区 | 文件／配置／提示词预览、标签菜单与会话选择归属分开，文件队列、迟到读取和冲突草稿保持。78 项 workspace 回归含 4 项新增生命周期测试 |
| 项目导航 | 行、状态、菜单和管理弹窗局部组件化；展开／定位与拖放分别持有状态。50 项 projects 回归含 2 项定位和卸载取消 RAF 测试；21 个迁出函数 AST 等价 |
| 编辑器 | 公式／列表、图片、Mermaid、行内 Widget 分模块；Effect 实例仍单一，表格阅读监听与拖动状态独立。图表主题与串行渲染缓存分开；Widget、预览与 Markdown 原 133 项回归通过，销毁清理修复后 136 项通过 |

上述边界可直接从实现入口及相邻具名模块核对。〔FACT｜`apps/desktop/src/main/ipc/ipc-handler-context.ts:1`、`apps/desktop/src/main/storage/conversation-run-event-repository.ts:1`、`apps/desktop/src/main/model/langchain-model-messages.ts:1`、`apps/desktop/src/main/storage/thread-log-context-projection.ts:1`、`apps/web/src/features/workspace/use-project-file-previews.ts:1`、`apps/web/src/features/projects/use-navigator-expansion.ts:1`、`apps/web/src/components/editor/cm/widget-effects.ts:1`〕

### 已复现并独立修复的行为问题

| 编号 | 定位与现象 | 状态与证据 |
| --- | --- | --- |
| S8 | 〔OBSERVE｜缺陷｜中〕仅打开后台或隔离浏览页时，清理操作漏掉持久浏览分区 | 已修复（`2989e49`）；两例先失败，相关 40 项通过，保留打开会话 |
| S9 | 〔OBSERVE｜缺陷｜低〕表格拖动中销毁 Widget，影像移除但落点提示仍留在 body | 已修复（`2c80b90`）；拖动、脏草稿与销毁三例中清理例先失败，修复后 136 项编辑器／Markdown 回归通过 |
| S10 | 〔OBSERVE｜缺陷｜中〕Agent 自定义能力使用固定示例目录，真实 Skill／MCP 无法选择 | 已修复（`8719343`）；改读集成元数据，首次待定不误标缺失，失败不清选择，停用／已删除引用可移除，7 项新用例及相关 37 项通过 |
| S11 | 〔OBSERVE｜缺陷｜中〕取消／重复审批或决定持久化失败后，旧审批仍可能留下会话授权；并行回放可能再次请求审批或跳过兄弟工具的拒绝 | 已修复（`495ca8e`）；每个 pending 保留原决定，仅成功持久化后授予权限。16 项新增回归与原并发峰值测试共 17 项定向通过，130 项按名称过滤；完整回归另记，过滤项不计入通过 |
| S12 | 〔OBSERVE｜缺陷｜中〕恢复事件／COMMIT 失败后，SQL 回滚但暂停或结果内存投影残留 | 已修复（`b26ae4e`）；按修改 key 记录首个旧值并随事务恢复，9 项新增红绿测试含实际延迟外键 COMMIT 失败，相关 170 项通过 |
| S13 | 〔OBSERVE｜缺陷｜中〕删除团队来源对话绕过活动任务保护，物理删除实例后留下无法启动的排队任务 | 已修复（`80a2574`）；新建与重试删除意图均在清理 IO 前检查，历史实例保留隐藏墓碑和原绑定，14 项新增回归及相关 164 项通过；保留原归档行为 |
| S14 | 〔OBSERVE｜缺陷｜低〕自定义能力两列选项数量不同时，被同高 Grid 撑出首行错位 | 已修复（`a5653e3`）；内容顶部对齐，四组尺寸／主题的首项偏差从 30px 变为 0，相关 7 项通过 |
| S15 | 〔OBSERVE｜缺陷｜中〕窄窗 Agent／团队目录按百分比分配高度，扣除标题与统计后只剩一行多；新建末项可能不在可视区 | 已修复（`9e6a6c0`）；窄容器上下自然布局、目录 280px 保留三完整行，条目内部滚动，选中项仅调整目录 scrollTop。37 项相关回归包含 3 项局部滚动测试，16 组真实浏览器场景通过 |

〔FACT｜`apps/desktop/src/main/windows/managed-browser-controller.ts:474`、`apps/web/src/components/editor/cm/table-reorder-interaction.ts:66`、`apps/web/src/features/settings/agents/agent-capability-editor.tsx:17`〕S7 的模型页保存修复另见上表；以上行为修复与结构迁移分别提交。

〔FACT｜`apps/desktop/src/main/agent/agent-runtime.ts:1971`、`apps/desktop/src/main/storage/agent-database.ts:1195`、`apps/desktop/src/main/storage/agent-database.ts:8108`、`apps/desktop/src/main/storage/conversation-deletion-service.ts:90`〕审批中间补丁曾使原 40ms 并发回归失败，独立复跑与调用轨迹确认是已决兄弟工具被重复通知，不能归因于负载；保留原断言，修正回放后原峰值 4 恢复。早期并行门禁另有旧 64 轮用例 5 秒超时，最终完整串行结果再单独记录，未放宽门限。

可视化边界：Mock AppShell／设置主矩阵为两个尺寸、浅深主题、12 个设置分区与对话动态，共 52 个场景，额外 4 组自定义能力截图。该矩阵最初只看异常与横向溢出，不能证明目录可用；用户指出 S15 后补充四尺寸 × 两主题 × Agent／团队的 16 场景，核对完整可视行数、列表／页面滚动范围、新建与末项选中以及详情末尾可达。1024×680 的列表高度由约 86.8px 增至 184px，完整行 1→3；1024×600 为 0→3，宽屏几何保持。520px 探测低于原 Shell 600px 最小高度，原有整页纵向溢出单独保留，未改 Shell 或伪称通过系统缩放验收。〔FACT｜`apps/web/src/features/settings/agent-team-settings.css:1047`、`apps/web/src/features/settings/components/settings-directory-list.tsx:4`〕

### 审查覆盖与继续整改边界

Runtime 按 AST 逐项盘点 113 个构造器／方法；Database 在 Run 仓储拆分前的 8,585 行快照中盘点 297 个成员、220 个 public 方法、59 个 withTransaction 入口及独立手动事务，没有把未归类方法静默遗漏。此证据是职责／依赖／生命周期清单，不是所有业务路径都已证明，也不表示两个大入口达标。〔FACT｜`apps/desktop/src/main/agent/agent-runtime.ts:1`、`apps/desktop/src/main/storage/agent-database.ts:1`〕

| 状态 | 剩余职责与保留原因 |
| --- | --- |
| 已审查、需继续分块 | 聊天工作区的请求／事件／输入／队列／审批；Runtime 的 Registry 装配、Queue／Steer、协作唤醒和审批恢复；Database 的团队／WorkItem、Fork、跨领域创建与 JSONL 恢复。跨事务与重放边界必须先有对应特征回归，不能整段搬进接受 Facade 的仓储 |
| 已审查、需继续分块 | Git review 的分支／提交／差异／选区与 resize 生命周期，Team 工作区的任务／成员／协作数据刷新，Agent／Team 设置的剩余管理／头像／权限区域。尚未把这些仅审查部分标记为已整改 |
| 已审查、保留当前实现 | Model Adapter 的流式／计量／Abort owner，ThreadLog 的字节扫描和恢复 owner，数据库终态与跨聚合事务，迁移版本与原子文件写入；拆成薄转发层不能提供额外安全性时不为行数拆分 |
| 已确认的规划边界 | MCP 当前无执行接入，Capability 为 false，带 MCP 依赖的 Skill 不广告／加载；自定义 MCP ID 只保存配置，不视为已生效的执行过滤。4 文件 36 项相关回归通过，不在本批扩建 MCP Runtime |

〔FACT｜`apps/web/src/features/workspace/git-review-workspace.tsx:209`、`apps/web/src/features/team/team-workspace.tsx:107`、`apps/web/src/features/settings/agent-team-settings.tsx:1`、`apps/desktop/src/main/ipc/desktop-capabilities.ts:1`、`apps/desktop/src/main/agent/skill-runtime.ts:73`〕Team 数据刷新可能重复请求、100ms 补读 timer 未集中持有，属于待复现的生命周期／性能观察，不据源码规模直接认定用户消息丢失。〔OBSERVE｜风险｜低〕

### 本批最终验证

冻结业务源码后，Desktop 使用 `vitest run --maxWorkers=1 --exclude src/main/computer-use/windows-driver.test.ts` 完整串行执行：154 文件、1,739 项通过，原 64 轮与并发审批用例均在原门限／断言下通过，无名称过滤；会操作真实桌面的 7 项 Windows native control 用例未运行，未计入通过数。Web 随后完整执行 163 文件、1,219 项通过；Protocol 26 文件 252 项、根脚本 19 项通过，合计 3,229 个不同用例。

最后的根级 `pnpm lint`、`pnpm typecheck`、`pnpm build` 全部通过。构建保留既有大包体提示，不将结构拆分宣称为加载速度提升。94 个新增业务模块规模与依赖扫描通过，涉及新模块的运行时循环为零；变更 Markdown 的本地链接、锚点、围栏和七组目录清单检查通过。未验证安装包、真实供应商请求或完整历史用户库升级；Mock 浏览器场景与实际开发服务只读健康检查分别记录，不互相替代。

## 多对话并发专项复核（2026-10-19）

本批在第三批之后继续逐项复现和整改，不覆盖旧批次的验证快照。统计为 **6 项代码问题、1 项文档漂移**；以下表格按独立修复边界计数，文档中的四处同源漂移合计一项。〔FACT｜`apps/desktop/src/main/agent/agent-runtime-summary-lifecycle.test.ts:90`、`apps/desktop/src/main/storage/agent-conversation-directory.test.ts:34`、`apps/web/src/features/chat/workspace-context-usage.test.tsx:49`〕

| 编号 | 类别／程度 | 已复现的问题 | 修复和定向验证 |
| --- | --- | --- | --- |
| S16 | 〔OBSERVE｜缺陷｜中〕 | 可见 Run 已结束的摘要不受退出等待管理，迟到后可访问已关闭或删除的持久层 | 已修复 `32c6ef5`：按 Run 注册、abort、drain，写前核对可投影状态。11 项新回归；摘要／取消相关 47 项通过，名称过滤的其他用例不计入通过 |
| S17 | 〔OBSERVE｜性能｜中〕 | Agent 目录逐个点查，取消前置亦调用全量 N+1 | 已修复 `8d7bc61`：复用现有批量目录投影，保留 DTO、谱系、过滤和两个入口不同排序；11 项新回归、相关 179 项通过 |
| S18 | 〔OBSERVE｜性能｜中〕 | 隐藏工作区的后台程序菜单仍订阅、读取和轮询 | 已修复 `ca1fa13`：透传 active，隐藏停止，返回补读，迟到旧值丢弃。8 个隐藏菜单 × 10 次事件读取 80→0；相关 55 项通过，后代命令查询合同保留 |
| S19 | 〔OBSERVE｜性能｜中〕 | 活动 Run 集合变化重读全部历史并重建四读者队列，实际峰值绕过限制 | 已修复 `c4420b7`：增量队列保留已完成 Run，旧请求收尾前占用名额；1→16 个 Run 的读取 136→16，慢响应峰值 58→4。9 项新回归，相关 20 项通过 |
| S20 | 〔OBSERVE｜性能｜中〕 | 64 次工具事件产生 64 次相同上下文编译请求，隐藏／换参迟到结果可覆盖 | 已修复 `2d62609`：同作用域一个在途加一次最新待刷新，64→2 次、峰值 64→1。10 项新回归，相关 69 项通过；跨作用域保持立即读取，不声称全局串行 |
| S21 | 〔OBSERVE｜性能｜中〕 | 同一关键词重复编译仍读取最近 1,000 条已覆盖历史正文 | 已修复 `30889ce`：每索引仅保留最近查询指纹和最多 24 个片段位置；6 项新回归及原 ThreadLog／ContextCompiler 共 35 项通过。查询／边界／替换／改写失效及返回值新鲜性有覆盖 |
| S22 | 〔OBSERVE｜矛盾｜低〕 | 文档把固定 WorkerPool、有界子进程池和全局 Run 并发槽写为当前实现 | 已修正文档 00／05／08 的现状与验收描述；14 补摘要生命周期。代码没有新增线程池或更换执行循环 |

〔FACT｜`apps/desktop/src/main/storage/agent-database.ts:698`、`apps/desktop/src/main/storage/thread-log.ts:448`、`apps/web/src/features/chat/background-programs.tsx:28`、`apps/web/src/features/chat/conversation-activity-hydration.ts:29`、`apps/web/src/features/chat/conversation-context-usage-refresh.ts:12`〕上述计数型测试使用受控 Promise／临时库，不依赖供应商，不将减少 IPC 数量等同于真实网络时延改善。

### 同规模性能对照

以下旧新版本交替运行，各暖读阶段 5 个样本，中位耗时仅代表本地夹具；计时期间不并行运行构建／类型检查。先前可能与编译重叠的一组目录数据单独保留，表内采用空闲复测。原返回的完整 DTO 逐组相等。〔FACT｜`apps/desktop/src/main/storage/agent-conversation-directory.test.ts:34`、`apps/desktop/src/main/storage/thread-log-covered-search.test.ts:34`〕

| 规模与操作 | 旧→新中位耗时 | 工作量旧→新 |
| --- | --- | --- |
| 1,000 个无 Run／WorkItem 的会话，目录 | 119.20→8.01ms | prepare 1,001→1 |
| 同规模，取消的同步前置 `getConversation + listAgentConversations` | 119.32→7.96ms | prepare 1,002→2；排队 abort 回调最长 134.06→9.10ms |
| 1,000 covered + 8 tail、每条约 2KiB，无关键词命中，暖编译 | 61.29→5.10ms | 实际 readSync 字节 2,321,937→2,154 |
| 同一历史，两条关键词命中，暖编译 | 51.11→4.01ms | 实际 readSync 字节 2,321,983→6,840 |

覆盖检索对照含 88 个样本、12 组阶段；追加一个未覆盖尾消息后仍复用，首次冷检索仍约 4.64MB／1,011 次 readSync，没有将冷建计为改善。读取测试初版把大缓冲 EOF 探测算成正文读取，已改按实际返回字节计数，业务断言不变；类型门禁还发现新测试的 spy 泛型选错重载，改为 `MockInstance<typeof fs.readSync>` 后重跑。取消前置微基准不等于完整 UI 取消 SLO，旧版整批导入记录仍可能整体解析。〔FACT｜`apps/desktop/src/main/storage/thread-log-covered-search.test.ts:30`、`apps/desktop/src/main/storage/thread-log.ts:544`〕

本地忽略目录 `.git/validation-concurrency-audit/` 保留红绿日志、原实现基准 bundle、前后 JSON、独立复核和最终门禁记录；计时数据来源分别为 `agent-directory-compare-idle-results.json` 与 `covered-search-compare-results.json`，不含真实对话或凭据。文档同步范围：00／05／08 为架构现状，12 为进度，13 为并发性能规范，14／16 为生命周期及上下文合同，本文件登记问题；README／索引的模块入口不变，不另建平行报告。无待裁决的删除文档实体。

### 保留边界

〔OBSERVE｜风险｜低〕全局模型／命令资源预算、真实长时高并发与低端机器容量仍需明确负载和策略后实测，不能因没有统一池就断定应加入。Gemini 的请求指纹未经过统一 fetch 采样入口，是已记录的诊断覆盖限制；本次没有更换 SDK 网络层。其他 Team／Review 刷新、隐藏计时器和历史回放重复读取仍是候选，需要分别复现；不把候选计入已修复数量，也不把本专项结束写成整个项目审查完成。〔FACT｜`apps/desktop/src/main/model/model-adapter-registry.ts:26`、`apps/web/src/features/team/team-workspace.tsx:107`、`apps/web/src/features/workspace/git-review-workspace.tsx:209`〕

### 本专项最终门禁

全部业务源码冻结后，Desktop `vitest run --maxWorkers=1 --exclude src/main/computer-use/windows-driver.test.ts` 为 157 文件／1,767 项通过，Web 串行为 165 文件／1,242 项通过，Protocol 为 26 文件／252 项通过，根脚本 19 项通过，合计 **3,280 个不同用例**。没有名称筛选，没有放宽原 64 轮或并发断言；7 项真实桌面控制用例未执行，未计入通过数。Web 日志保留 jsdom 未实现 Canvas 的既有诊断信息，测试结果仍通过。

根级 lint、修正新测试类型后的根级 typecheck、最终两文件定向 lint、根级 build 均通过；构建仍有既有大包体提示。96 个新增业务模块、230 个可达模块的规模与运行时依赖扫描无错误。8 份变更文档的链接、锚点、围栏及目录清单检查通过。基准、门禁和独立代码复核分别保留，不以其证明安装包、真实供应商时延或长时容量；未生成安装包、未调用真实供应商、未切换用户数据目录。

## Responses 跨 Run 短问答缓存复核（2026-10-19）

| 编号 | 类别／程度 | 现象与原因 | 状态 |
| --- | --- | --- | --- |
| S23 | 〔OBSERVE｜缺陷｜中〕 | 连续工具循环可高命中，但同一长对话后续短问答持续约 25.7%；技能／任务目录等临时快照作为末尾 user 发送，隐式缓存写入点包含下一 Run 不再保留于原位置的快照 | 已修复：只在 Responses 序列化带标记的纯文本快照为 assistant 参考内容；真实用户、Graph／JSONL、权限与其他 API 不变。不发送推断支持的扩展参数 |

〔FACT｜`apps/desktop/src/main/model/langchain-model-messages.ts:35`、`apps/desktop/src/main/model/langchain-model-messages.test.ts:19`、`apps/desktop/src/main/model/responses-runtime-context-cache.test.ts:12`〕先用旧实现复现角色回归：1 失败／17 通过；修复后的转换、SDK、回放和运行快照相关 5 文件 101 项通过。诊断旧版只能核对前 32 条消息，补充最多 28 个累计前缀采样，两个新增／增强回归先失败，修复后相关 3 文件 84 项通过；这些集合重叠，不相加。

实际验收沿用原开发窗口、原配置及用户指定对话，短问答明确不调用工具或修改作品。修复前两轮 input 85,130／85,182，cached 均 21,888（约 25.7%）；前 128 条消息、工具和设置均一致，说明单看字节前缀不够。修复后首轮 input 85,420、cached 21,888，为边界切换后的冷请求；后两轮分别为 84,224／85,474（98.54%）和 84,224／85,529（98.47%），前 144 条消息采样一致，全部成功且工具调用为 0。首字耗时约 3.0–6.8 秒，并未随缓存比例单调下降；不将命中提升等同于供应商首字速度保证。完整摘要与指纹保留在本地忽略目录 `.git/validation-pelican-cache/`，不提交真实会话、用户作品源码或凭据。

验收过程曾出现源码已改而监听构建未更新：磁盘 bundle 仍为旧转换，三轮旧构建结果单独保留为 `live-results-old-build.json`，不计作修复后结果。随后通过标准 Desktop build 触发现有开发监督器重启，核对 bundle 中的新转换代码及新 Main PID 后才执行上述正式三轮。未为验收另开应用或数据目录；不把这次构建漏更观察直接认定为已修复的 watcher 缺陷。〔FACT｜`scripts/electron-dev.mjs:81`、`apps/desktop/tsup.config.ts:3`〕

最终后端完整串行回归为 158 文件／1,773 项通过，原 64 轮、取消、审批与模型回放断言未放宽；排除 7 项真实桌面控制用例，未计入通过数。随后 lint 发现新 wire 测试中不必要的 async 和不安全的对象字符串转换，修正为显式字符串校验及 Promise.resolve，单独复跑该用例通过，产品源码未再变化。根级 lint、typecheck、build 和四份变更文档的本地链接／锚点／目录检查通过；构建保留既有大包体提示。本轮无前端或 Protocol 修改，其测试未重复运行，沿用前批记录；真实模型调用仅为上述受控短问答，未把这个结果推广为所有供应商或所有工作场景都达到固定比例。
