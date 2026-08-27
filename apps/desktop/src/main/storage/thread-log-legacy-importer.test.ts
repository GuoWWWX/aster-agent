import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { AgentDatabase } from "./agent-database.js";
import { EventProjector } from "./event-projector.js";
import { ThreadLog } from "./thread-log.js";
import { ThreadLogLegacyImporter } from "./thread-log-legacy-importer.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("ThreadLogLegacyImporter", () => {
  it("imports each SQLite-first Conversation once and preserves its context snapshot", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "thread-log-import-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const run = database.createRunWithUserMessage(
      conversation.id,
      "旧会话用户消息",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "旧会话助手回复",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [],
    });
    database.finishRun(run.runId, "completed", null);
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const importer = new ThreadLogLegacyImporter(
      database,
      threadLog,
      new EventProjector(database, threadLog),
    );

    expect(importer.importMissingConversationLogs()).toEqual({
      importedConversationIds: [conversation.id],
      skippedConversationIds: [],
    });
    const log = threadLog.read(conversation.id);
    expect(log?.events.map((event) => event.type)).toEqual([
      "conversation_created",
      "legacy_snapshot_imported",
    ]);
    expect(log?.events[1]?.payload).toMatchObject({
      modelMessages: [
        { content: "旧会话用户消息", role: "user" },
        { content: "旧会话助手回复", role: "assistant" },
      ],
    });
    expect(importer.importMissingConversationLogs()).toEqual({
      importedConversationIds: [],
      skippedConversationIds: [conversation.id],
    });

    const recoveredDatabase = new AgentDatabase(":memory:");
    const recovery = new EventProjector(recoveredDatabase, threadLog);
    recovery.projectAllConversationLogs();

    expect(recoveredDatabase.getConversation(conversation.id).lastRunStatus).toBe("completed");
    expect(recoveredDatabase.listContextMessages(conversation.id).map((message) => message.content))
      .toEqual(["旧会话用户消息", "旧会话助手回复"]);
    expect(recoveredDatabase.listTimeline(conversation.id)).toHaveLength(2);
  });

  it("recovers a Fork only after its parent Conversation is projected", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "thread-log-import-"));
    temporaryDirectories.push(directory);
    const sourceDatabase = new AgentDatabase(":memory:");
    const parent = sourceDatabase.createConversation(null);
    const child = sourceDatabase.forkConversation(parent.id, "side");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const sourceProjector = new EventProjector(sourceDatabase, threadLog);
    const importer = new ThreadLogLegacyImporter(sourceDatabase, threadLog, sourceProjector);
    importer.importMissingConversationLogs();

    const recoveredDatabase = new AgentDatabase(":memory:");
    new EventProjector(recoveredDatabase, threadLog).projectAllConversationLogs();

    expect(recoveredDatabase.getConversation(child.id).parentConversationId).toBe(parent.id);
  });

  it("quarantines an unreadable log and rebuilds a usable SQLite snapshot", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "thread-log-import-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const run = database.createRunWithUserMessage(conversation.id, "保留的用户消息", "test-model");
    database.finishRun(run.runId, "completed", null);
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    threadLog.append(conversation.id, {
      payload: { content: "将被替换的损坏日志" },
      type: "user_message",
    });
    await writeFile(threadLog.getPath(conversation.id), [
      JSON.stringify({
        conversationId: conversation.id,
        createdAt: new Date().toISOString(),
        type: "thread_header",
        version: 1,
      }),
      "not-json",
      JSON.stringify({}),
      "",
    ].join("\n"), "utf8");
    const projector = new EventProjector(database, threadLog);
    const importer = new ThreadLogLegacyImporter(database, threadLog, projector);

    expect(importer.recoverUnreadableConversationLogs()).toEqual({
      quarantinedConversationIds: [conversation.id],
    });
    expect(threadLog.readContext(conversation.id)?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "保留的用户消息", role: "user" }),
    ]));
    expect(projector.verifyConversation(conversation.id).isConsistent).toBe(true);
  });
});
