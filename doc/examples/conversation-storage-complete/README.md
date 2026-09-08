# JSONL 全场景样例包

v2 存储格式示例，不是当前应用导入包；项目路径、模型、输出均为演示值。

[完整格式说明](../../23-JSONL完整事件格式与全场景样例.md)

| 场景 | 全部展开记录 | 原始文件 |
| --- | --- | --- |
| 普通项目对话 | [展开阅读](./conversations/00000000-0000-4000-8000-000000000001/conversation.preview.md) | [JSONL](./conversations/00000000-0000-4000-8000-000000000001/conversation.jsonl) |
| 无项目临时对话 | [展开阅读](./conversations/00000000-0000-4000-8000-000000000002/conversation.preview.md) | [JSONL](./conversations/00000000-0000-4000-8000-000000000002/conversation.jsonl) |
| Subagent（含返工） | [展开阅读](./conversations/00000000-0000-4000-8000-000000000003/conversation.preview.md) | [JSONL](./conversations/00000000-0000-4000-8000-000000000003/conversation.jsonl) |
| 新建侧边对话 | [展开阅读](./conversations/00000000-0000-4000-8000-000000000004/conversation.preview.md) | [JSONL](./conversations/00000000-0000-4000-8000-000000000004/conversation.jsonl) |
| 团队负责人 | [展开阅读](./conversations/00000000-0000-4000-8000-000000000005/conversation.preview.md) | [JSONL](./conversations/00000000-0000-4000-8000-000000000005/conversation.jsonl) |
| 团队成员 | [展开阅读](./conversations/00000000-0000-4000-8000-000000000006/conversation.preview.md) | [JSONL](./conversations/00000000-0000-4000-8000-000000000006/conversation.jsonl) |
| 团队关系/工作项 | [展开阅读](./teams/00000000-0000-4000-8000-000000000191/team.preview.md) | [JSONL](./teams/00000000-0000-4000-8000-000000000191/team.jsonl) |

`fixture-config.json` 是演示配置及文件清单；附件目录含真实文本快照。每份展开版只有一个 JSON 代码块，原始文件每条记录独占一行。

从仓库根目录运行 `node doc/examples/conversation-storage-complete/verify.mjs` 校验正例和反例。脚本不执行任何样例工具。
