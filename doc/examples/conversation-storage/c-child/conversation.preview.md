# 子对话示例（展开阅读）

> 拟议 v2 示例，使用虚构短 ID，不可直接导入当前应用。以下在一个代码块内按顺序展开所有记录；实际 JSONL 每个对象独占一行。

[查看原始 JSONL](./conversation.jsonl)

关联项目配置为 `project-a / 项目 A / D:/demo/project-a`，当前 `workspaceRootPath` 解析为同一路径；没有 Run，所以还没有执行路径快照。初始空闲、无已读位置、无未读结果均由创建记录还原，不额外重复保存。

```json
{
  "type": "thread_header",
  "version": 2,
  "conversationId": "c-child",
  "createdAt": "2026-09-07T01:00:04.000Z"
}

{
  "type": "conversation_created",
  "version": 2,
  "conversationId": "c-child",
  "eventId": "c-child-e1",
  "sequence": 1,
  "createdAt": "2026-09-07T01:00:04.000Z",
  "payload": {
    "properties": {
      "parentConversationId": "c-main",
      "mode": "subagent",
      "title": "检查助手",
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
}
```
