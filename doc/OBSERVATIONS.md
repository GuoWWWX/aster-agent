# 工具与提示词审查观察记录

本次范围及逐组工具入口见 [工具设计复核](./11-AI工具体系与生命周期设计.md#工具与提示词复核2026-10-18)。这里区分已证实缺陷与可选改进，不把推断当成失败原因。扫描日期：2026-10-18。

| 编号 | 严重度／类别 | 定位与现象 | 处理状态 |
| --- | --- | --- | --- |
| T1 | 高／缺陷 | 〔OBSERVE｜缺陷｜高〕LangChainModelAdapter.assistantToolCalls：真实 Responses 最终函数参数完整，SDK 流式调用却被执行为空对象；两轮共四次任务更新因此失败。 | 已修复；最终 completed 快照优先，JSON／Schema 校验不放宽 |
| T2 | 中／矛盾 | 〔OBSERVE｜矛盾｜中〕base-system.md 的命令段曾声称工具只在进程退出后返回，与 run_command 的 running 回执不符。 | 已修复；依赖步骤和成功结论前读取真实终态 |
| T3 | 中／矛盾 | 〔OBSERVE｜矛盾｜中〕AgentCommunicationTool.getDefinitions 总说明曾把所有忙碌接收方描述为立即投递，与自己的子代理默认 queue 不符。 | 已修复；总说明与 deliveryMode 参数及既有队列测试对齐 |
| T4 | 低／歧义 | 〔OBSERVE｜歧义｜低〕TaskListTool.getDefinitions 仍称 task list，未说明关闭清单不影响持久任务。 | 已修复；明确 local execution checklist 与 persistent task records |
| T5 | 中／缺陷 | 〔OBSERVE｜缺陷｜中〕AgentRuntime.collaborationContext：动态任务摘要曾漏掉 completionRequested；历史同一任务出现 completed → running → completed 的多余修订。 | 已修复；每轮带待确认标记，明确申请成功后不重提、不为状态对齐改回进行中 |
| T6 | 低／可选改进 | 〔OBSERVE｜债务｜低〕AgentRuntime.createToolHandlerRegistry：常规文件、命令及协作工具共同暴露；纯路由角色仍可取得较宽工具集合。现有角色／权限检查不能直接视为缺陷，但候选工具和重复说明可增加选择负担。 | 待裁决；先以固定路由案例比较工具选择正确率、请求体和输入 Token，再决定按角色收窄；本轮不更改权限或工具集合 |
| T7 | 低／可选改进 | 〔OBSERVE｜债务｜低〕UserQuestionTool.execute 返回 questionId/status 等直接字段，多数执行工具返回 ok/value。各自调用端已有合同，尚无证据表明这是本轮参数丢失原因。 | 待裁决；如统一，须同时迁移上下文、UI、恢复快照及测试，不能只包一层对象 |

〔FACT｜apps/desktop/src/main/model/tool-arguments.ts:37〕JSON 参数仍须为对象；工具自己的 Zod Schema 继续校验必填、UUID、范围和业务约束。真实空对象不凭空补齐字段。

〔INFER〕优先级应是“修复参数传输 → 消除提示词与执行合同冲突 → 按失败类型回归”。工具数量多或说明较长本身，不足以证明某次工具失败；是否按角色进一步收窄，应由对照实验决定。
