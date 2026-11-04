import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  it.each([false, true])("resumes interrupted snapshot migration (existing log: %s)", async (existing) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "thread-log-interrupted-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const log = new ThreadLog(path.join(directory, "conversations"));
    if (existing) log.append(conversation.id, { type: "user_message", payload: { content: "旧审计" } });
    const importer = new ThreadLogLegacyImporter(database, log, new EventProjector(database, log));
    const append = log.append.bind(log);
    const fault = vi.spyOn(log, "append").mockImplementation((id, input) => {
      if (input.type === "legacy_snapshot_imported") throw new Error("interrupted");
      return append(id, input);
    });
    expect(() => importer.importConversationIfMissing(conversation.id)).toThrow("interrupted");
    fault.mockRestore();
    expect(importer.importConversationIfMissing(conversation.id)).toBe(true);
    expect(importer.importConversationIfMissing(conversation.id)).toBe(false);
    expect(log.read(conversation.id)?.events.filter((event) => event.type === "conversation_created")).toHaveLength(1);
    database.close();
  });
  it.each([false, true])("completes SQL-first logs without rewriting history (creation present: %s)", async (created) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "thread-log-existing-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const run = database.createRunWithUserMessage(conversation.id, "保留旧消息", "test-model");
    database.finishRun(run.runId, "completed", null);
    const log = new ThreadLog(path.join(directory, "conversations"));
    if (created) {
      const snapshot = database.exportThreadLogLegacySnapshot(conversation.id);
      log.append(conversation.id, { type: "conversation_created", payload: {
        agent: snapshot.agent, conversation: snapshot.conversation,
      } });
    }
    log.append(conversation.id, { type: "user_message", payload: { content: "旧格式审计记录" } });
    const original = await readFile(log.getPath(conversation.id), "utf8");
    const projector = new EventProjector(database, log);
    const importer = new ThreadLogLegacyImporter(database, log, projector);
    expect(importer.importConversationIfMissing(conversation.id)).toBe(true);
    expect((await readFile(log.getPath(conversation.id), "utf8")).startsWith(original)).toBe(true);
    expect(importer.importConversationIfMissing(conversation.id)).toBe(false);
    database.activateVolatileConversationProjection();
    projector.projectAllConversationLogs({ releaseHistory: true });
    projector.ensureConversationHistoryProjected(conversation.id);
    expect(database.listContextMessages(conversation.id).map((message) => message.content)).toEqual(["保留旧消息"]);
    database.close();
  });
  it("exports an empty Conversation because its properties still belong in JSONL", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "thread-log-import-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const importer = new ThreadLogLegacyImporter(
      database,
      threadLog,
      new EventProjector(database, threadLog),
    );

    expect(importer.importConversationIfMissing(conversation.id)).toBe(true);
    expect(threadLog.hasConversation(conversation.id)).toBe(true);
    expect(threadLog.read(conversation.id)?.events.map((event) => event.type)).toEqual([
      "conversation_created",
      "legacy_snapshot_imported",
    ]);
  });

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

  it("rebuilds the volatile Conversation projection from JSONL after restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "thread-log-cutover-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "db.sqlite");
    const conversationsPath = path.join(directory, "conversations");
    const database = new AgentDatabase(databasePath);
    const conversation = database.createConversation(null);
    const run = database.createRunWithUserMessage(
      conversation.id,
      "只存在 JSONL 的用户消息",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "只存在 JSONL 的助手回复",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [],
    });
    database.finishRun(run.runId, "completed", null);
    const threadLog = new ThreadLog(conversationsPath);
    const initialProjector = new EventProjector(database, threadLog);
    new ThreadLogLegacyImporter(database, threadLog, initialProjector)
      .importMissingConversationLogs();
    database.activateVolatileConversationProjection();
    initialProjector.projectAllConversationLogs();
    database.finalizeJsonlConversationStorage();
    database.close();

    const reopened = new AgentDatabase(databasePath);
    const replay = new EventProjector(reopened, new ThreadLog(conversationsPath));
    replay.projectAllConversationLogs();

    expect(reopened.getConversation(conversation.id).lastRunStatus).toBe("completed");
    expect(reopened.listTimeline(conversation.id).map((item) => item.kind)).toEqual([
      "message",
      "message",
    ]);
    expect(reopened.listContextMessages(conversation.id).map((message) => message.content))
      .toEqual(["只存在 JSONL 的用户消息", "只存在 JSONL 的助手回复"]);
    reopened.close();
  });

  it("does not import a Conversation already marked for deletion", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "thread-log-import-pending-delete-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const run = database.createRunWithUserMessage(conversation.id, "将被删除的历史", "test-model");
    database.finishRun(run.runId, "completed", null);
    database.createConversationDeletionTask(conversation.id);
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const importer = new ThreadLogLegacyImporter(
      database,
      threadLog,
      new EventProjector(database, threadLog),
    );

    expect(importer.importMissingConversationLogs()).toEqual({
      importedConversationIds: [],
      skippedConversationIds: [],
    });
    expect(threadLog.hasConversation(conversation.id)).toBe(false);
  });

  it("does not rescan an unchanged JSONL file during corruption recovery", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "thread-log-import-signature-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    threadLog.append(conversation.id, {
      payload: { content: "保持不变" },
      type: "user_message",
    });
    const projector = new EventProjector(database, threadLog);
    projector.projectConversation(conversation.id);
    const importer = new ThreadLogLegacyImporter(database, threadLog, projector);
    const read = vi.spyOn(threadLog, "read");

    expect(importer.recoverUnreadableConversationLogs()).toEqual({
      quarantinedConversationIds: [],
    });
    expect(read).not.toHaveBeenCalled();
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
    const projector = new EventProjector(database, threadLog);
    projector.projectConversation(conversation.id);
    expect(projector.isConversationProjectionCurrent(conversation.id)).toBe(true);
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
