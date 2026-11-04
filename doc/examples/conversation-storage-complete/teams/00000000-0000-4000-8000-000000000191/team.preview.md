# 团队关系与工作项

> 团队不是一个共享消息文件：成员分别拥有对话日志，本文件保存团队成员关系与工作项。此处为展开阅读版。

[原始 JSONL](./team.jsonl)

```json
{
  "type": "team_header",
  "version": 2,
  "teamInstanceId": "00000000-0000-4000-8000-000000000191",
  "createdAt": "2026-09-07T02:02:14.000Z"
}

{
  "type": "team_created",
  "version": 2,
  "teamInstanceId": "00000000-0000-4000-8000-000000000191",
  "eventId": "00000000-0000-4000-8000-0000000004ae",
  "sequence": 1,
  "createdAt": "2026-09-07T02:02:15.000Z",
  "payload": {
    "teamId": "00000000-0000-4000-8000-000000000192",
    "name": "演示检查团队",
    "projectId": "00000000-0000-4000-8000-000000000065",
    "members": [
      {
        "conversationId": "00000000-0000-4000-8000-000000000005",
        "role": "lead"
      },
      {
        "conversationId": "00000000-0000-4000-8000-000000000006",
        "role": "member"
      }
    ]
  }
}

{
  "type": "team_work_item_created",
  "version": 2,
  "teamInstanceId": "00000000-0000-4000-8000-000000000191",
  "eventId": "00000000-0000-4000-8000-0000000004b1",
  "sequence": 2,
  "createdAt": "2026-09-07T02:02:17.000Z",
  "payload": {
    "workItemId": "00000000-0000-4000-8000-000000000193",
    "sourceConversationId": "00000000-0000-4000-8000-000000000005",
    "sourceMessageId": "00000000-0000-4000-8000-0000000004af",
    "title": "明确检查范围"
  }
}

{
  "type": "team_work_item_completed",
  "version": 2,
  "teamInstanceId": "00000000-0000-4000-8000-000000000191",
  "eventId": "00000000-0000-4000-8000-0000000004e1",
  "sequence": 3,
  "createdAt": "2026-09-07T02:02:47.000Z",
  "payload": {
    "workItemId": "00000000-0000-4000-8000-000000000193",
    "resultConversationId": "00000000-0000-4000-8000-000000000005",
    "resultMessageId": "00000000-0000-4000-8000-0000000004da",
    "status": "completed"
  }
}
```
