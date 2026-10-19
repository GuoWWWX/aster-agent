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

本轮仅梳理工程规范和 README，未改实现。下表为合并后的源码快照，行数包括空行和注释，只用于提示规模，不凭行数断言存在运行缺陷。新增规模要求是评审约束，尚未建立自动行数门禁。

本轮记录 4 项中等规模债务、2 项低等文档矛盾；文档矛盾已修正，4 项规模债务未改代码。

### 中等严重度：代码规模债务

| 编号 | 严重度／类别 | 定位与现象 | 建议及处理状态 |
| --- | --- | --- | --- |
| S1 | 中／债务 | 〔OBSERVE｜债务｜中〕`apps/web/src/features/chat/workspace-content.tsx:1` 共 9,768 行。 | 按页面编排、消息展示、输入与生命周期分批迁出；已确认规模，未拆分 |
| S2 | 中／债务 | 〔OBSERVE｜债务｜中〕`apps/web/src/features/settings/settings-workspace.tsx:1` 共 4,552 行。 | 按设置分区提取页面内组件与表单行为，通用控件沿共享层复用；已确认规模，未拆分 |
| S3 | 中／债务 | 〔OBSERVE｜债务｜中〕`apps/desktop/src/main/agent/agent-runtime.ts:1` 共 6,678 行。 | 按上下文、协作、运行生命周期等现有职责逐项收口，保留单一编排入口；已确认规模，未拆分 |
| S4 | 中／债务 | 〔OBSERVE｜债务｜中〕`apps/desktop/src/main/storage/agent-database.ts:1` 共 12,009 行。 | 按领域查询／写入与迁移职责渐进提取，保留事务、恢复和 JSONL 归属；已确认规模，未拆分 |

行数依据为上述文件在本轮起点的完整物理行计数，核对日期 2026-10-19。后续改动重新计数，不把本表当成持续更新的指标仪表盘。〔FACT｜`apps/web/src/features/chat/workspace-content.tsx:1`、`apps/web/src/features/settings/settings-workspace.tsx:1`、`apps/desktop/src/main/agent/agent-runtime.ts:1`、`apps/desktop/src/main/storage/agent-database.ts:1`〕

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

本轮没有新增待裁决项。S1–S4 留作后续独立整改依据，不宣称已修复；原 T7 的既有待裁决状态保持不变。
