# 无项目对话示例（展开阅读）

> 拟议 v2 示例，使用虚构短 ID，不可直接导入当前应用。以下在一个代码块内按顺序展开所有记录；实际 JSONL 每个对象独占一行。

[查看原始 JSONL](./conversation.jsonl)

本例没有项目或独立工作区绑定，`projectName`、`projectRootPath`、`workspaceRootPath` 均为 `null`；日志仍持久保存在自己的对话目录。初始空闲、无已读位置、无未读结果均由创建记录还原。

```json
{
  "type": "thread_header",
  "version": 2,
  "conversationId": "c-loose",
  "createdAt": "2026-09-07T02:00:00.000Z"
}

{
  "type": "conversation_created",
  "version": 2,
  "conversationId": "c-loose",
  "eventId": "c-loose-e1",
  "sequence": 1,
  "createdAt": "2026-09-07T02:00:00.000Z",
  "payload": {
    "properties": {
      "parentConversationId": null,
      "mode": "persistent",
      "title": "无项目讨论",
      "agentId": "agent-dev",
      "avatarIcon": null,
      "projectId": null,
      "modelSelection": {
        "providerId": "provider-a",
        "modelId": "model-a",
        "reasoning": {
          "kind": "effort",
          "value": "medium"
        }
      },
      "permissionMode": "read_only",
      "archivedAt": null,
      "pinOrder": null
    }
  }
}
```
