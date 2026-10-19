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
| S7 | 中／风险 | 〔OBSERVE｜风险｜中〕模型页 450ms 延时保存的 effect 在卸载时只清理 timer；编辑后立即切页可能取消尚未发出的最后一笔保存。原实现已有同一逻辑。 | 已确认代码路径，未混入结构重构；后续独立修复须覆盖编辑后立即离开、合并保存、失败恢复和卸载后结果归属 |

〔FACT｜`apps/web/src/features/settings/models/use-model-settings-controller.ts:222`〕保留原保存策略是本批结构兼容范围；已有连续编辑测试覆盖当前页的合并保存，不代表已经覆盖或修复切页 flush。

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
