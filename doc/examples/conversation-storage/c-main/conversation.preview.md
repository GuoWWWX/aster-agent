# 主对话示例（展开阅读）

> 拟议 v2 示例，使用虚构短 ID，不可直接导入当前应用。以下在一个代码块内按顺序展开所有记录；实际 JSONL 每个对象独占一行。

[查看原始 JSONL](./conversation.jsonl)

```json
{
  "type": "thread_header",
  "version": 2,
  "conversationId": "c-main",
  "createdAt": "2026-09-07T01:00:00.000Z"
}

{
  "type": "conversation_created",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e1",
  "sequence": 1,
  "createdAt": "2026-09-07T01:00:00.000Z",
  "payload": {
    "properties": {
      "parentConversationId": null,
      "mode": "persistent",
      "title": "项目 A 检查",
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

{
  "type": "attachment_imported",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e2",
  "sequence": 2,
  "createdAt": "2026-09-07T01:00:00.100Z",
  "payload": {
    "attachmentId": "att-image",
    "fileName": "截图.png",
    "relativePath": "attachments/att-image.png",
    "mimeType": "image/png",
    "sizeBytes": 12800,
    "importMethod": "paste"
  }
}

{
  "type": "attachment_imported",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e3",
  "sequence": 3,
  "createdAt": "2026-09-07T01:00:00.200Z",
  "payload": {
    "attachmentId": "att-sheet",
    "fileName": "统计表.xlsx",
    "relativePath": "attachments/att-sheet.xlsx",
    "mimeType": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "sizeBytes": 8192,
    "importMethod": "file_picker"
  }
}

{
  "type": "user_message",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e4",
  "sequence": 4,
  "createdAt": "2026-09-07T01:00:01.000Z",
  "payload": {
    "messageId": "u1",
    "content": "你好，先确认这两个附件的名称，不用分析内容。",
    "attachmentIds": [
      "att-image",
      "att-sheet"
    ]
  }
}

{
  "type": "run_started",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e5",
  "sequence": 5,
  "createdAt": "2026-09-07T01:00:02.000Z",
  "payload": {
    "runId": "r1",
    "userMessageId": "u1",
    "executionSnapshot": {
      "agentId": "agent-dev",
      "modelSelection": {
        "providerId": "provider-a",
        "modelId": "model-a",
        "reasoning": {
          "kind": "effort",
          "value": "medium"
        }
      },
      "permissionMode": "ask_before_changes",
      "projectId": "project-a",
      "projectName": "项目 A",
      "projectRootPath": "D:/demo/project-a",
      "workspaceRootPath": "D:/demo/project-a"
    }
  }
}

{
  "type": "run_terminal",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e6",
  "sequence": 6,
  "createdAt": "2026-09-07T01:00:03.000Z",
  "payload": {
    "runId": "r1",
    "status": "completed",
    "assistantMessage": {
      "messageId": "a1",
      "content": "你好，已收到截图.png和统计表.xlsx，暂未分析内容。"
    }
  }
}

{
  "type": "conversation_properties_changed",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e7",
  "sequence": 7,
  "createdAt": "2026-09-07T01:01:00.000Z",
  "payload": {
    "changes": {
      "agentId": "agent-review",
      "modelSelection": {
        "providerId": "provider-b",
        "modelId": "model-b",
        "reasoning": {
          "kind": "effort",
          "value": "high"
        }
      },
      "permissionMode": "read_only"
    }
  }
}

{
  "type": "conversation_properties_changed",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e8",
  "sequence": 8,
  "createdAt": "2026-09-07T01:02:00.000Z",
  "payload": {
    "changes": {
      "projectId": "project-b",
      "title": "项目 B 复查"
    }
  }
}

{
  "type": "user_message",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e9",
  "sequence": 9,
  "createdAt": "2026-09-07T01:02:01.000Z",
  "payload": {
    "messageId": "u2",
    "content": "请再说一句你好。",
    "attachmentIds": []
  }
}

{
  "type": "run_started",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e10",
  "sequence": 10,
  "createdAt": "2026-09-07T01:02:02.000Z",
  "payload": {
    "runId": "r2",
    "userMessageId": "u2",
    "executionSnapshot": {
      "agentId": "agent-review",
      "modelSelection": {
        "providerId": "provider-b",
        "modelId": "model-b",
        "reasoning": {
          "kind": "effort",
          "value": "high"
        }
      },
      "permissionMode": "read_only",
      "projectId": "project-b",
      "projectName": "项目 B",
      "projectRootPath": "D:/demo/project-b",
      "workspaceRootPath": "D:/demo/project-b"
    }
  }
}

{
  "type": "run_terminal",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e11",
  "sequence": 11,
  "createdAt": "2026-09-07T01:02:03.000Z",
  "payload": {
    "runId": "r2",
    "status": "completed",
    "assistantMessage": {
      "messageId": "a2",
      "content": "你好，我是审查助手。"
    }
  }
}

{
  "type": "conversation_read",
  "version": 2,
  "conversationId": "c-main",
  "eventId": "c-main-e12",
  "sequence": 12,
  "createdAt": "2026-09-07T01:02:04.000Z",
  "payload": {
    "throughMessageId": "a2"
  }
}
```
