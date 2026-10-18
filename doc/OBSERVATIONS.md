# 工具与提示词审查观察记录

本次范围及逐组工具入口见 [工具设计复核](./11-AI工具体系与生命周期设计.md#工具与提示词复核2026-10-18)。这里区分已证实缺陷与可选改进，不把推断当成失败原因。扫描日期：2026-10-18。

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
