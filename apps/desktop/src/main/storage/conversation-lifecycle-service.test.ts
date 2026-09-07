import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "./agent-database.js";
import { ConversationLifecycleService } from "./conversation-lifecycle-service.js";
import { EventProjector } from "./event-projector.js";
import { ThreadLog } from "./thread-log.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("ConversationLifecycleService", () => {
  it("writes a root Conversation creation event before projecting it to SQLite", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "conversation-lifecycle-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const providerId = crypto.randomUUID();
    const service = new ConversationLifecycleService(
      database,
      threadLog,
      new EventProjector(database, threadLog),
      {
        getPreferredSelection: () => ({
          modelId: "recent-model",
          providerId,
          reasoning: { kind: "effort", value: "high" },
        }),
      },
    );

    const conversation = service.createConversation(null, { teamId: "team-alpha" });
    const log = threadLog.read(conversation.id);

    expect(log?.events).toHaveLength(1);
    expect(log?.events[0]).toMatchObject({
      conversationId: conversation.id,
      sequence: 1,
      type: "conversation_created",
      payload: {
        conversation: {
          id: conversation.id,
          modelSelection: {
            modelId: "recent-model",
            providerId,
            reasoning: { kind: "effort", value: "high" },
          },
          teamId: "team-alpha",
        },
      },
    });
    expect(database.getThreadLogProjectionCursor(conversation.id)?.lastSequence).toBe(1);
  });

  it("records mutable properties in JSONL and restores the SQLite projection", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "conversation-properties-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const projector = new EventProjector(database, threadLog);
    const service = new ConversationLifecycleService(database, threadLog, projector);
    const providerId = crypto.randomUUID();
    const conversation = service.createConversation(null);

    service.renameConversation(conversation.id, "JSONL 属性恢复");
    service.setConversationModelSelection(conversation.id, {
      modelId: "durable-model",
      providerId,
      reasoning: { kind: "effort", value: "medium" },
    });
    service.setConversationPermissionMode(conversation.id, "read_only");
    service.setConversationPinned(conversation.id, true);

    expect(threadLog.read(conversation.id)?.events.at(-1)).toMatchObject({
      type: "conversation_properties_changed",
      payload: {
        changed: ["pin"],
        properties: {
          isPinned: true,
          modelSelection: {
            modelId: "durable-model",
            providerId,
          },
          permissionMode: "read_only",
          title: "JSONL 属性恢复",
        },
      },
    });

    database.renameConversation(conversation.id, "损坏的 SQLite 投影");
    database.setConversationModelSelection(conversation.id, {
      modelId: "wrong-model",
      providerId,
      reasoning: null,
    });
    database.setConversationPinned(conversation.id, false);
    database.setConversationPermissionMode(conversation.id, "full_access");

    projector.projectConversation(conversation.id);

    expect(database.getConversation(conversation.id)).toMatchObject({
      isPinned: true,
      modelSelection: {
        modelId: "durable-model",
        providerId,
        reasoning: { kind: "effort", value: "medium" },
      },
      permissionMode: "read_only",
      title: "JSONL 属性恢复",
    });
  });
});
