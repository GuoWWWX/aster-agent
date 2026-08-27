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
    const service = new ConversationLifecycleService(
      database,
      threadLog,
      new EventProjector(database, threadLog),
    );

    const conversation = service.createConversation(null, { teamId: "team-alpha" });
    const log = threadLog.read(conversation.id);

    expect(log?.events).toHaveLength(1);
    expect(log?.events[0]).toMatchObject({
      conversationId: conversation.id,
      sequence: 1,
      type: "conversation_created",
      payload: {
        conversation: { id: conversation.id, teamId: "team-alpha" },
      },
    });
    expect(database.getThreadLogProjectionCursor(conversation.id)?.lastSequence).toBe(1);
  });
});
