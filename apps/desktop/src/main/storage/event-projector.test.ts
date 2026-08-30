import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { conversationToolItemSchema } from "@agent/protocol";

import { AgentDatabase } from "./agent-database.js";
import { ConversationAttachmentStore } from "./conversation-attachment-store.js";
import { EventProjector } from "./event-projector.js";
import { ThreadLog } from "./thread-log.js";
import { ProjectRegistry } from "../projects/project-registry.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true }),
    ),
  );
});

describe("EventProjector", () => {
  it("indexes each JSONL event once and advances a per-conversation cursor", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const first = threadLog.append(conversation.id, {
      payload: { content: "先建立日志", runId: crypto.randomUUID() },
      type: "user_message",
    });
    const second = threadLog.append(conversation.id, {
      payload: { modelId: "test-model", runId: crypto.randomUUID() },
      type: "run_created",
    });
    const projector = new EventProjector(database, threadLog);

    expect(projector.projectConversation(conversation.id)).toMatchObject({
      projectedEventCount: 2,
      cursor: {
        conversationId: conversation.id,
        lastEventId: second.eventId,
        lastSequence: second.sequence,
      },
    });
    expect(projector.projectConversation(conversation.id)).toMatchObject({
      projectedEventCount: 0,
      cursor: { lastEventId: second.eventId, lastSequence: second.sequence },
    });

    const third = threadLog.append(conversation.id, {
      payload: { runId: crypto.randomUUID(), status: "completed" },
      type: "run_finished",
    });
    expect(projector.projectConversation(conversation.id)).toMatchObject({
      projectedEventCount: 1,
      cursor: { lastEventId: third.eventId, lastSequence: third.sequence },
    });
    expect(database.getThreadLogProjectionCursor(conversation.id)?.lastSequence).toBe(3);
    expect(first.sequence).toBe(1);
    expect(projector.verifyConversation(conversation.id)).toEqual({
      indexedEventCount: 3,
      isConsistent: true,
      logEventCount: 3,
    });
  });

  it("catches up all known conversations without reading nonexistent logs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const logged = database.createConversation(null);
    const empty = database.createConversation(null);
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    threadLog.append(logged.id, {
      payload: { content: "有日志" },
      type: "user_message",
    });

    const result = new EventProjector(database, threadLog).projectAllConversationLogs();

    expect(result).toHaveLength(2);
    expect(database.getThreadLogProjectionCursor(logged.id)?.lastSequence).toBe(1);
    expect(database.getThreadLogProjectionCursor(empty.id)).toBeNull();
    expect(new EventProjector(database, threadLog).verifyAllConversationLogs()).toEqual(expect.arrayContaining([
      { indexedEventCount: 1, isConsistent: true, logEventCount: 1 },
      { indexedEventCount: 0, isConsistent: true, logEventCount: 0 },
    ]));
  });

  it("skips a persisted deletion-pending Conversation even when its JSONL still exists", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-pending-delete-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const active = database.createConversation(null);
    const pendingDeletion = database.createConversation(null);
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    threadLog.append(active.id, {
      payload: { content: "继续投影" },
      type: "user_message",
    });
    threadLog.append(pendingDeletion.id, {
      payload: { content: "不应在启动时复活" },
      type: "user_message",
    });
    database.createConversationDeletionTask(pendingDeletion.id);

    const projector = new EventProjector(database, threadLog);
    const results = projector.projectAllConversationLogs();

    expect(database.listProjectableConversationIds()).toEqual([active.id]);
    expect(results).toHaveLength(1);
    expect(database.getThreadLogProjectionCursor(active.id)?.lastSequence).toBe(1);
    expect(() => database.getThreadLogProjectionCursor(pendingDeletion.id)).toThrow("not found");
    expect(projector.verifyAllConversationLogs()).toHaveLength(1);
  });

  it("projects a newly appended event without replaying earlier indexed events", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const projector = new EventProjector(database, threadLog);
    const first = threadLog.append(conversation.id, {
      payload: { content: "第一条" },
      type: "user_message",
    });
    projector.projectEvent(conversation.id, first);
    const second = threadLog.append(conversation.id, {
      payload: { content: "第二条" },
      type: "assistant_message",
    });

    expect(projector.projectEvent(conversation.id, second)).toMatchObject({
      projectedEventCount: 1,
      cursor: { lastSequence: 2 },
    });
    expect(projector.verifyConversation(conversation.id)).toMatchObject({
      indexedEventCount: 2,
      isConsistent: true,
      logEventCount: 2,
    });
  });

  it("recovers a new Conversation written to JSONL before SQLite projection", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = database.prepareConversationCreation(null);
    threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });

    const result = new EventProjector(database, threadLog).projectAllConversationLogs();

    expect(result).toHaveLength(1);
    expect(database.getConversation(creation.conversation.id)).toMatchObject({
      id: creation.conversation.id,
      title: creation.conversation.title,
    });
    expect(database.getThreadLogProjectionCursor(creation.conversation.id)?.lastSequence).toBe(1);
  });

  it("rebuilds Run, timeline, model history, and tool result from rich ThreadLog events", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-business-recovery-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    source.projectConversationCreated(creation);
    const run = source.createRunWithUserMessage(
      creation.conversation.id,
      "检查恢复链路",
      "test-model",
    );
    threadLog.append(creation.conversation.id, {
      payload: {
        content: run.userMessage.content,
        message: run.userMessage,
        messageId: run.userMessage.id,
        modelContent: run.userMessage.content,
        runId: run.runId,
      },
      type: "user_message",
    });
    threadLog.append(creation.conversation.id, {
      payload: {
        createdAt: run.userMessage.createdAt,
        modelId: "test-model",
        runId: run.runId,
      },
      type: "run_created",
    });
    const assistant = source.appendAssistantTurn({
      content: "先调用目录工具。",
      conversationId: creation.conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [{ arguments: "{}", id: "call-directory", name: "list_directory" }],
    });
    threadLog.append(creation.conversation.id, {
      payload: {
        content: "先调用目录工具。",
        messageId: assistant?.id ?? crypto.randomUUID(),
        modelId: "test-model",
        runId: run.runId,
        timelineMessage: assistant,
        toolCalls: [{ arguments: "{}", id: "call-directory", name: "list_directory" }],
      },
      type: "assistant_message",
    });
    const startedTool = conversationToolItemSchema.parse({
      arguments: "{}",
      batchId: null,
      conversationId: creation.conversation.id,
      createdAt: new Date().toISOString(),
      diff: null,
      executionMode: "serial",
      id: crypto.randomUUID(),
      kind: "tool",
      name: "list_directory",
      result: null,
      runId: run.runId,
      status: "running",
    });
    source.appendToolStarted(startedTool);
    threadLog.append(creation.conversation.id, {
      payload: { runId: run.runId, tool: startedTool, toolCallId: "call-directory" },
      type: "tool_call_requested",
    });
    const completedTool = { ...startedTool, result: "{\"entries\":[]}", status: "completed" as const };
    source.completeTool({
      providerCallId: "call-directory",
      result: "{\"entries\":[]}",
      tool: completedTool,
    });
    threadLog.append(creation.conversation.id, {
      payload: {
        content: "{\"entries\":[]}",
        runId: run.runId,
        tool: completedTool,
        toolCallId: "call-directory",
      },
      type: "tool_result",
    });
    source.finishRun(run.runId, "completed", null);
    threadLog.append(creation.conversation.id, {
      payload: { error: null, runId: run.runId, status: "completed" },
      type: "run_finished",
    });

    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();

    expect(recovered.getConversation(creation.conversation.id).lastRunStatus).toBe("completed");
    expect(recovered.listTimeline(creation.conversation.id)).toEqual([
      expect.objectContaining({ content: "检查恢复链路", role: "user" }),
      expect.objectContaining({ content: "先调用目录工具。", role: "assistant" }),
      expect.objectContaining({ kind: "tool", name: "list_directory", status: "completed" }),
    ]);
    expect(recovered.listContextMessages(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "检查恢复链路", role: "user" }),
      expect.objectContaining({ content: "先调用目录工具。", role: "assistant" }),
      expect.objectContaining({ content: "{\"entries\":[]}", role: "tool", toolCallId: "call-directory" }),
    ]));
    source.close();
    recovered.close();
  });

  it("projects one write-ahead queued Run into SQLite and can replay it after a crash", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-write-ahead-run-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    const createdEvent = threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const projector = new EventProjector(source, threadLog);
    projector.projectBusinessEvent(creation.conversation.id, createdEvent);
    const attachmentId = crypto.randomUUID();
    source.createConversationAttachment({
      contextTokens: 64,
      conversationId: creation.conversation.id,
      createdAt: new Date().toISOString(),
      extractedTextPath: path.join(directory, "attachment.extracted.txt"),
      id: attachmentId,
      kind: "file",
      messageId: null,
      mimeType: "text/plain",
      name: "attachment.txt",
      pendingMessageId: null,
      projectPath: null,
      sizeBytes: 12,
      source: "upload",
      storedPath: path.join(directory, "attachment.txt"),
      truncated: false,
    });
    const queued = source.prepareRunWithUserMessage(
      creation.conversation.id,
      "先写日志，再建立 SQLite 投影",
      "test-model",
      [attachmentId],
    );

    expect(source.listTimeline(creation.conversation.id)).toEqual([]);
    expect(source.listContextMessages(creation.conversation.id)).toEqual([]);
    const queuedEvent = threadLog.append(creation.conversation.id, {
      payload: {
        content: queued.userMessage.content,
        createdAt: queued.runCreatedAt,
        executionSnapshot: queued.executionSnapshot,
        message: queued.userMessage,
        messageId: queued.userMessage.id,
        modelContent: queued.modelContent,
        modelId: queued.modelId,
        runId: queued.runId,
        title: queued.nextTitle,
      },
      type: "run_queued",
    });

    expect(projector.projectBusinessEvent(creation.conversation.id, queuedEvent)).toMatchObject({
      cursor: { lastSequence: 2 },
      projectedEventCount: 1,
    });
    expect(source.getConversation(creation.conversation.id)).toMatchObject({
      activeRunId: queued.runId,
      title: queued.nextTitle,
    });
    expect(source.listTimeline(creation.conversation.id)).toEqual([
      expect.objectContaining({ content: queued.userMessage.content, role: "user" }),
    ]);
    expect(source.listContextMessages(creation.conversation.id)).toEqual([
      expect.objectContaining({
        content: queued.modelContent,
        role: "user",
        runId: queued.runId,
      }),
    ]);
    expect(source.getConversationAttachment(creation.conversation.id, attachmentId).messageId)
      .toBe(queued.userMessage.id);

    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();
    expect(recovered.getConversation(creation.conversation.id)).toMatchObject({
      activeRunId: queued.runId,
      title: queued.nextTitle,
    });
    expect(recovered.listTimeline(creation.conversation.id)).toEqual([
      expect.objectContaining({ content: queued.userMessage.content, role: "user" }),
    ]);
    expect(recovered.listContextMessages(creation.conversation.id)).toEqual([
      expect.objectContaining({
        content: queued.modelContent,
        role: "user",
        runId: queued.runId,
      }),
    ]);
    expect(recovered.listQueuedRunRecoveries()).toEqual([
      expect.objectContaining({
        content: queued.userMessage.content,
        runId: queued.runId,
      }),
    ]);
    source.close();
    recovered.close();
  });

  it("projects a write-ahead terminal Run and replays its final Assistant turn", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-write-ahead-terminal-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    const creationEvent = threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const projector = new EventProjector(source, threadLog);
    projector.projectBusinessEvent(creation.conversation.id, creationEvent);
    const queued = source.prepareRunWithUserMessage(
      creation.conversation.id,
      "终态也应该先写 JSONL",
      "test-model",
    );
    const queuedEvent = threadLog.append(creation.conversation.id, {
      payload: {
        content: queued.userMessage.content,
        createdAt: queued.runCreatedAt,
        executionSnapshot: queued.executionSnapshot,
        message: queued.userMessage,
        messageId: queued.userMessage.id,
        modelContent: queued.modelContent,
        modelId: queued.modelId,
        runId: queued.runId,
        title: queued.nextTitle,
      },
      type: "run_queued",
    });
    projector.projectBusinessEvent(creation.conversation.id, queuedEvent);
    const startedEvent = threadLog.append(creation.conversation.id, {
      payload: { runId: queued.runId, writeAhead: true },
      type: "run_started",
    });
    projector.projectBusinessEvent(creation.conversation.id, startedEvent);
    const terminalEvent = threadLog.append(creation.conversation.id, {
      payload: {
        assistantKind: "turn",
        content: "终态已从日志投影。",
        error: null,
        messageId: crypto.randomUUID(),
        modelId: "test-model",
        result: "终态已从日志投影。",
        runId: queued.runId,
        status: "completed",
      },
      type: "run_terminal",
    });

    projector.projectBusinessEvent(creation.conversation.id, terminalEvent);
    expect(source.getConversation(creation.conversation.id)).toMatchObject({
      activeRunId: null,
      hasUnreadResult: true,
      lastRunStatus: "completed",
    });
    expect(source.listTimeline(creation.conversation.id)).toEqual([
      expect.objectContaining({ content: "终态也应该先写 JSONL", role: "user" }),
      expect.objectContaining({ content: "终态已从日志投影。", role: "assistant" }),
    ]);
    expect(source.listContextMessages(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "终态已从日志投影。", role: "assistant" }),
    ]));

    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();
    expect(recovered.getConversation(creation.conversation.id)).toMatchObject({
      activeRunId: null,
      hasUnreadResult: true,
      lastRunStatus: "completed",
    });
    expect(recovered.listContextMessages(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "终态也应该先写 JSONL", role: "user" }),
      expect.objectContaining({ content: "终态已从日志投影。", role: "assistant" }),
    ]));
    source.close();
    recovered.close();
  });

  it("catches up an unindexed write-ahead Run after older SQLite facts already exist", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-partial-write-ahead-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = database.prepareConversationCreation(null);
    const creationEvent = threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const projector = new EventProjector(database, threadLog);
    projector.projectBusinessEvent(creation.conversation.id, creationEvent);
    const oldRun = database.createRunWithUserMessage(
      creation.conversation.id,
      "旧 SQLite 事实",
      "test-model",
    );
    database.finishRun(oldRun.runId, "completed", null);
    const queued = database.prepareRunWithUserMessage(
      creation.conversation.id,
      "在 SQLite 投影前发生崩溃",
      "test-model",
    );
    threadLog.append(creation.conversation.id, {
      payload: {
        content: queued.userMessage.content,
        createdAt: queued.runCreatedAt,
        executionSnapshot: queued.executionSnapshot,
        message: queued.userMessage,
        messageId: queued.userMessage.id,
        modelContent: queued.modelContent,
        modelId: queued.modelId,
        runId: queued.runId,
        title: queued.nextTitle,
      },
      type: "run_queued",
    });

    projector.projectConversation(creation.conversation.id);

    expect(database.getConversation(creation.conversation.id).activeRunId).toBe(queued.runId);
    expect(database.listTimeline(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "旧 SQLite 事实", role: "user" }),
      expect.objectContaining({ content: "在 SQLite 投影前发生崩溃", role: "user" }),
    ]));
    expect(projector.verifyConversation(creation.conversation.id)).toMatchObject({
      isConsistent: true,
      logEventCount: 2,
    });
    database.close();
  });

  it("projects a write-ahead Assistant tool turn before the Tool runtime runs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-write-ahead-assistant-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    const creationEvent = threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const projector = new EventProjector(source, threadLog);
    projector.projectBusinessEvent(creation.conversation.id, creationEvent);
    const queued = source.prepareRunWithUserMessage(
      creation.conversation.id,
      "先保存工具计划",
      "test-model",
    );
    const queuedEvent = threadLog.append(creation.conversation.id, {
      payload: {
        content: queued.userMessage.content,
        createdAt: queued.runCreatedAt,
        executionSnapshot: queued.executionSnapshot,
        message: queued.userMessage,
        messageId: queued.userMessage.id,
        modelContent: queued.modelContent,
        modelId: queued.modelId,
        runId: queued.runId,
        title: queued.nextTitle,
      },
      type: "run_queued",
    });
    projector.projectBusinessEvent(creation.conversation.id, queuedEvent);
    const startedEvent = threadLog.append(creation.conversation.id, {
      payload: { runId: queued.runId, writeAhead: true },
      type: "run_started",
    });
    projector.projectBusinessEvent(creation.conversation.id, startedEvent);
    const assistantEvent = threadLog.append(creation.conversation.id, {
      payload: {
        content: "我先读取配置。",
        messageId: crypto.randomUUID(),
        modelId: "test-model",
        reasoningContent: "先分析配置来源。",
        runId: queued.runId,
        toolCalls: [{ arguments: "{}", id: "call-read", name: "read_file" }],
        writeAhead: true,
      },
      type: "assistant_message",
    });

    projector.projectBusinessEvent(creation.conversation.id, assistantEvent);
    const startedTool = conversationToolItemSchema.parse({
      arguments: "{}",
      batchId: null,
      conversationId: creation.conversation.id,
      createdAt: new Date().toISOString(),
      diff: null,
      executionMode: "serial",
      id: crypto.randomUUID(),
      kind: "tool",
      name: "read_file",
      result: null,
      runId: queued.runId,
      status: "running",
    });
    const toolStartedEvent = threadLog.append(creation.conversation.id, {
      payload: {
        runId: queued.runId,
        tool: startedTool,
        toolCallId: "call-read",
        writeAhead: true,
      },
      type: "tool_call_requested",
    });
    projector.projectBusinessEvent(creation.conversation.id, toolStartedEvent);
    const completedTool = { ...startedTool, result: "{\"ok\":true}", status: "completed" as const };
    const toolResultEvent = threadLog.append(creation.conversation.id, {
      payload: {
        content: completedTool.result,
        runId: queued.runId,
        tool: completedTool,
        toolCallId: "call-read",
        writeAhead: true,
      },
      type: "tool_result",
    });
    projector.projectBusinessEvent(creation.conversation.id, toolResultEvent);
    const checkpoint = source.prepareContextCheckpoint(
      creation.conversation.id,
      3,
      "已读取配置，等待下一步。",
    );
    const checkpointEvent = threadLog.append(creation.conversation.id, {
      payload: { ...checkpoint, writeAhead: true },
      type: "context_checkpoint",
    });
    projector.projectBusinessEvent(creation.conversation.id, checkpointEvent);
    expect(source.listTimeline(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "我先读取配置。",
        reasoningContent: "先分析配置来源。",
        role: "assistant",
      }),
      expect.objectContaining({ kind: "tool", name: "read_file", status: "completed" }),
    ]));
    expect(source.listContextMessages(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "我先读取配置。",
        role: "assistant",
        toolCalls: [{ arguments: "{}", id: "call-read", name: "read_file" }],
      }),
      expect.objectContaining({ content: "{\"ok\":true}", role: "tool", toolCallId: "call-read" }),
    ]));
    expect(source.getContextCheckpoint(creation.conversation.id)).toMatchObject({
      coveredThroughSequence: 3,
      summary: "已读取配置，等待下一步。",
    });

    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();
    expect(recovered.listTimeline(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "我先读取配置。",
        reasoningContent: "先分析配置来源。",
        role: "assistant",
      }),
      expect.objectContaining({ kind: "tool", name: "read_file", status: "completed" }),
    ]));
    expect(recovered.listContextMessages(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        content: "我先读取配置。",
        role: "assistant",
        toolCalls: [{ arguments: "{}", id: "call-read", name: "read_file" }],
      }),
      expect.objectContaining({ content: "{\"ok\":true}", role: "tool", toolCallId: "call-read" }),
    ]));
    expect(recovered.getContextCheckpoint(creation.conversation.id)).toMatchObject({
      coveredThroughSequence: 3,
      summary: "已读取配置，等待下一步。",
    });
    source.close();
    recovered.close();
  });

  it("rebuilds the latest pending-message snapshot without adding it to model history", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-pending-recovery-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    source.projectConversationCreated(creation);
    threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    source.enqueuePendingMessage({
      content: "当前 Run 完成后再执行这条消息",
      conversationId: creation.conversation.id,
      deliveryMode: "queue",
    });
    threadLog.append(creation.conversation.id, {
      payload: {
        pendingMessages: source.listPendingMessageRecords(creation.conversation.id),
      },
      type: "pending_messages_updated",
    });

    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();
    expect(recovered.listPendingMessages(creation.conversation.id)).toEqual([
      expect.objectContaining({ content: "当前 Run 完成后再执行这条消息", deliveryMode: "queue" }),
    ]);
    expect(recovered.listContextMessages(creation.conversation.id)).toEqual([]);
    source.close();
    recovered.close();
  });

  it("projects a write-ahead pending-input snapshot and reserves its attachment", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-write-ahead-pending-input-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    const creationEvent = threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const projector = new EventProjector(source, threadLog);
    projector.projectBusinessEvent(creation.conversation.id, creationEvent);
    const attachmentId = crypto.randomUUID();
    source.createConversationAttachment({
      contextTokens: 12,
      conversationId: creation.conversation.id,
      createdAt: new Date().toISOString(),
      extractedTextPath: null,
      id: attachmentId,
      kind: "file",
      messageId: null,
      mimeType: "text/plain",
      name: "queued.txt",
      pendingMessageId: null,
      projectPath: null,
      sizeBytes: 12,
      source: "upload",
      storedPath: path.join(directory, "queued.txt"),
      truncated: false,
    });
    const pending = source.preparePendingMessage({
      attachmentIds: [attachmentId],
      content: "当前 Run 完成后再处理",
      conversationId: creation.conversation.id,
      deliveryMode: "queue",
    });
    expect(source.listPendingMessages(creation.conversation.id)).toEqual([]);
    const pendingEvent = threadLog.append(creation.conversation.id, {
      payload: { pendingMessages: [pending], writeAhead: true },
      type: "pending_messages_updated",
    });

    projector.projectBusinessEvent(creation.conversation.id, pendingEvent);
    expect(source.listPendingMessages(creation.conversation.id)).toEqual([
      expect.objectContaining({ content: "当前 Run 完成后再处理", id: pending.message.id }),
    ]);
    expect(source.getConversationAttachment(creation.conversation.id, attachmentId).pendingMessageId)
      .toBe(pending.message.id);
    const cancellationEvent = threadLog.append(creation.conversation.id, {
      payload: { pendingMessageId: pending.message.id, writeAhead: true },
      type: "pending_message_cancelled",
    });
    projector.projectBusinessEvent(creation.conversation.id, cancellationEvent);
    expect(source.listPendingMessages(creation.conversation.id)).toEqual([]);
    expect(source.getConversationAttachment(creation.conversation.id, attachmentId).pendingMessageId)
      .toBeNull();
    source.close();
  });

  it("consumes a queued input through one write-ahead Run event", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-write-ahead-pending-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    const createdEvent = threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const projector = new EventProjector(source, threadLog);
    projector.projectBusinessEvent(creation.conversation.id, createdEvent);
    const pending = source.enqueuePendingMessage({
      content: "排队后再执行",
      conversationId: creation.conversation.id,
      deliveryMode: "queue",
    });
    const pendingEvent = threadLog.append(creation.conversation.id, {
      payload: { pendingMessages: source.listPendingMessageRecords(creation.conversation.id) },
      type: "pending_messages_updated",
    });
    projector.projectEvent(creation.conversation.id, pendingEvent);
    const queued = source.prepareRunFromPendingMessage(pending.id, "test-model", pending.content);
    const queuedEvent = threadLog.append(creation.conversation.id, {
      payload: {
        content: queued.userMessage.content,
        createdAt: queued.runCreatedAt,
        executionSnapshot: queued.executionSnapshot,
        message: queued.userMessage,
        messageId: queued.userMessage.id,
        modelContent: queued.modelContent,
        modelId: queued.modelId,
        pendingMessageId: pending.id,
        runId: queued.runId,
        title: queued.nextTitle,
      },
      type: "run_queued",
    });

    projector.projectBusinessEvent(creation.conversation.id, queuedEvent);
    expect(source.listPendingMessages(creation.conversation.id)).toEqual([]);
    expect(source.listTimeline(creation.conversation.id)).toEqual([
      expect.objectContaining({ content: "排队后再执行", role: "user" }),
    ]);

    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();
    expect(recovered.listPendingMessages(creation.conversation.id)).toEqual([]);
    expect(recovered.listTimeline(creation.conversation.id)).toEqual([
      expect.objectContaining({ content: "排队后再执行", role: "user" }),
    ]);
    expect(recovered.listQueuedRunRecoveries()).toEqual([
      expect.objectContaining({ runId: queued.runId }),
    ]);
    source.close();
    recovered.close();
  });

  it("consumes a write-ahead Steer message into the active Run", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-write-ahead-steer-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    const creationEvent = threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const projector = new EventProjector(source, threadLog);
    projector.projectBusinessEvent(creation.conversation.id, creationEvent);
    const run = source.prepareRunWithUserMessage(
      creation.conversation.id,
      "正在执行的任务",
      "test-model",
    );
    const queuedEvent = threadLog.append(creation.conversation.id, {
      payload: {
        content: run.userMessage.content,
        createdAt: run.runCreatedAt,
        executionSnapshot: run.executionSnapshot,
        message: run.userMessage,
        messageId: run.userMessage.id,
        modelContent: run.modelContent,
        modelId: run.modelId,
        runId: run.runId,
        title: run.nextTitle,
      },
      type: "run_queued",
    });
    projector.projectBusinessEvent(creation.conversation.id, queuedEvent);
    const startedEvent = threadLog.append(creation.conversation.id, {
      payload: { runId: run.runId, writeAhead: true },
      type: "run_started",
    });
    projector.projectBusinessEvent(creation.conversation.id, startedEvent);
    const pending = source.preparePendingMessage({
      content: "补充约束：不要修改配置",
      conversationId: creation.conversation.id,
      deliveryMode: "steer",
    });
    const pendingEvent = threadLog.append(creation.conversation.id, {
      payload: { pendingMessages: [pending], writeAhead: true },
      type: "pending_messages_updated",
    });
    projector.projectBusinessEvent(creation.conversation.id, pendingEvent);
    const consumed = source.preparePendingMessageConsumption(
      pending.message.id,
      run.runId,
      pending.message.content,
    );
    const userEvent = threadLog.append(creation.conversation.id, {
      payload: {
        content: consumed.userMessage.content,
        message: consumed.userMessage,
        messageId: consumed.userMessage.id,
        modelContent: consumed.modelContent,
        pendingMessageId: consumed.pendingMessageId,
        runId: run.runId,
        writeAhead: true,
      },
      type: "user_message",
    });

    projector.projectBusinessEvent(creation.conversation.id, userEvent);
    expect(source.listPendingMessages(creation.conversation.id)).toEqual([]);
    expect(source.listTimeline(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "补充约束：不要修改配置", role: "user", runId: run.runId }),
    ]));
    expect(source.listContextMessages(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "补充约束：不要修改配置", role: "user", runId: run.runId }),
    ]));

    // Simulate a process crash after the JSONL append, but before a later
    // process has indexed the event stream. Recovery must replay the pending
    // snapshot before consuming the Steer message into the active Run.
    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();
    expect(recovered.listPendingMessages(creation.conversation.id)).toEqual([]);
    expect(recovered.listTimeline(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "补充约束：不要修改配置", role: "user", runId: run.runId }),
    ]));
    expect(recovered.listContextMessages(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ content: "补充约束：不要修改配置", role: "user", runId: run.runId }),
    ]));
    source.close();
    recovered.close();
  });

  it("rebuilds AttachmentStore metadata from JSONL references without logging paths", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-attachment-recovery-"));
    temporaryDirectories.push(directory);
    const managedRoot = path.join(directory, "conversation-files");
    const source = new AgentDatabase(":memory:");
    const sourceAttachments = new ConversationAttachmentStore(
      source,
      new ProjectRegistry(source),
      managedRoot,
    );
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    source.projectConversationCreated(creation);
    threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const attachment = await sourceAttachments.importBytes(creation.conversation.id, {
      bytes: Buffer.from("# 设计说明\n附件恢复必须保留受管快照。", "utf8"),
      mimeType: "text/markdown",
      name: "design.md",
    });
    const run = source.prepareRunWithUserMessage(
      creation.conversation.id,
      "阅读附件",
      "test-model",
      [attachment.id],
      "阅读附件",
    );
    threadLog.append(creation.conversation.id, {
      payload: {
        attachmentRefs: [attachment],
        content: run.userMessage.content,
        createdAt: run.runCreatedAt,
        executionSnapshot: run.executionSnapshot,
        message: run.userMessage,
        messageId: run.userMessage.id,
        modelContent: run.modelContent,
        modelId: run.modelId,
        runId: run.runId,
        title: run.nextTitle,
      },
      type: "run_queued",
    });

    const recovered = new AgentDatabase(":memory:");
    const recoveredAttachments = new ConversationAttachmentStore(
      recovered,
      new ProjectRegistry(recovered),
      managedRoot,
    );
    new EventProjector(
      recovered,
      threadLog,
      (reference) => recoveredAttachments.resolveThreadLogPaths(reference),
    ).projectAllConversationLogs();

    expect(recovered.getConversationAttachment(creation.conversation.id, attachment.id)).toMatchObject({
      id: attachment.id,
      messageId: run.userMessage.id,
      name: "design.md",
    });
    expect(recoveredAttachments.toModelAttachments(
      creation.conversation.id,
      [attachment.id],
      false,
    )).toEqual([
      expect.objectContaining({ kind: "text", name: "design.md" }),
    ]);
    source.close();
    recovered.close();
  });

  it("restores pending attachment reservations from a write-ahead queue snapshot", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-pending-attachment-"));
    temporaryDirectories.push(directory);
    const managedRoot = path.join(directory, "conversation-files");
    const source = new AgentDatabase(":memory:");
    const sourceAttachments = new ConversationAttachmentStore(
      source,
      new ProjectRegistry(source),
      managedRoot,
    );
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    source.projectConversationCreated(creation);
    threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const run = source.prepareRunWithUserMessage(
      creation.conversation.id,
      "正在执行",
      "test-model",
    );
    threadLog.append(creation.conversation.id, {
      payload: {
        content: run.userMessage.content,
        createdAt: run.runCreatedAt,
        executionSnapshot: run.executionSnapshot,
        message: run.userMessage,
        messageId: run.userMessage.id,
        modelContent: run.modelContent,
        modelId: run.modelId,
        runId: run.runId,
        title: run.nextTitle,
      },
      type: "run_queued",
    });
    const attachment = await sourceAttachments.importBytes(creation.conversation.id, {
      bytes: Buffer.from("只在队列中保留的附件", "utf8"),
      mimeType: "text/plain",
      name: "queued.txt",
    });
    const pending = source.preparePendingMessage({
      attachmentIds: [attachment.id],
      content: "完成后阅读该附件",
      conversationId: creation.conversation.id,
    });
    threadLog.append(creation.conversation.id, {
      payload: {
        attachmentRefs: [attachment],
        pendingMessages: [pending],
        writeAhead: true,
      },
      type: "pending_messages_updated",
    });

    const recovered = new AgentDatabase(":memory:");
    const recoveredAttachments = new ConversationAttachmentStore(
      recovered,
      new ProjectRegistry(recovered),
      managedRoot,
    );
    new EventProjector(
      recovered,
      threadLog,
      (reference) => recoveredAttachments.resolveThreadLogPaths(reference),
    ).projectAllConversationLogs();

    expect(recovered.listPendingMessages(creation.conversation.id)).toEqual([
      expect.objectContaining({ attachmentIds: [attachment.id], id: pending.message.id }),
    ]);
    expect(recovered.getConversationAttachment(creation.conversation.id, attachment.id))
      .toMatchObject({ pendingMessageId: pending.message.id });
    source.close();
    recovered.close();
  });

  it("replaces a completed user turn through one write-ahead Run event", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-write-ahead-replace-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    const createdEvent = threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const projector = new EventProjector(source, threadLog);
    projector.projectBusinessEvent(creation.conversation.id, createdEvent);
    const first = source.prepareRunWithUserMessage(
      creation.conversation.id,
      "原始任务",
      "test-model",
    );
    const firstEvent = threadLog.append(creation.conversation.id, {
      payload: {
        content: first.userMessage.content,
        createdAt: first.runCreatedAt,
        executionSnapshot: first.executionSnapshot,
        message: first.userMessage,
        messageId: first.userMessage.id,
        modelContent: first.modelContent,
        modelId: first.modelId,
        runId: first.runId,
        title: first.nextTitle,
      },
      type: "run_queued",
    });
    projector.projectBusinessEvent(creation.conversation.id, firstEvent);
    source.finishRun(first.runId, "completed", null);
    const finishedEvent = threadLog.append(creation.conversation.id, {
      payload: { error: null, runId: first.runId, status: "completed" },
      type: "run_finished",
    });
    projector.projectEvent(creation.conversation.id, finishedEvent);
    const replacement = source.prepareLatestUserMessageReplacement({
      content: "修正后的任务",
      conversationId: creation.conversation.id,
      messageId: first.userMessage.id,
      modelContent: "修正后的任务",
      modelId: "test-model",
    });
    const replacementEvent = threadLog.append(creation.conversation.id, {
      payload: {
        content: replacement.userMessage.content,
        createdAt: replacement.runCreatedAt,
        executionSnapshot: replacement.executionSnapshot,
        message: replacement.userMessage,
        messageId: replacement.userMessage.id,
        modelContent: replacement.modelContent,
        modelId: replacement.modelId,
        previousRunId: replacement.previousRunId,
        runId: replacement.runId,
        title: replacement.nextTitle,
      },
      type: "run_replaced",
    });

    projector.projectBusinessEvent(creation.conversation.id, replacementEvent);
    expect(source.listTimeline(creation.conversation.id)).toEqual([
      expect.objectContaining({
        content: "修正后的任务",
        id: first.userMessage.id,
        runId: replacement.runId,
      }),
    ]);
    expect(source.listContextMessages(creation.conversation.id)).toEqual([
      expect.objectContaining({ content: "修正后的任务", runId: replacement.runId }),
    ]);

    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();
    expect(recovered.listTimeline(creation.conversation.id)).toEqual([
      expect.objectContaining({
        content: "修正后的任务",
        id: first.userMessage.id,
        runId: replacement.runId,
      }),
    ]);
    expect(recovered.listContextMessages(creation.conversation.id)).toEqual([
      expect.objectContaining({ content: "修正后的任务", runId: replacement.runId }),
    ]);
    source.close();
    recovered.close();
  });

  it("marks a recovered in-flight Run failed instead of replaying its side effects", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-interrupted-run-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    source.projectConversationCreated(creation);
    threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const run = source.createRunWithUserMessage(
      creation.conversation.id,
      "不要重放这次运行",
      "test-model",
    );
    threadLog.append(creation.conversation.id, {
      payload: {
        content: run.userMessage.content,
        message: run.userMessage,
        messageId: run.userMessage.id,
        modelContent: run.userMessage.content,
        runId: run.runId,
      },
      type: "user_message",
    });
    threadLog.append(creation.conversation.id, {
      payload: { modelId: "test-model", runId: run.runId },
      type: "run_created",
    });
    threadLog.append(creation.conversation.id, {
      payload: { runId: run.runId },
      type: "run_started",
    });

    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();
    expect(recovered.getConversation(creation.conversation.id).lastRunStatus).toBe("running");

    recovered.interruptRecoveredThreadLogRuns();
    expect(recovered.getConversation(creation.conversation.id).lastRunStatus).toBe("failed");
    expect(recovered.listQueuedRunRecoveries()).toEqual([]);
    source.close();
    recovered.close();
  });

  it("restores a pending Tool approval before startup marks its Run interrupted", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-approval-recovery-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const creation = source.prepareConversationCreation(null);
    source.projectConversationCreated(creation);
    threadLog.append(creation.conversation.id, {
      payload: creation,
      type: "conversation_created",
    });
    const run = source.createRunWithUserMessage(
      creation.conversation.id,
      "等待命令审批",
      "test-model",
    );
    threadLog.append(creation.conversation.id, {
      payload: {
        content: run.userMessage.content,
        message: run.userMessage,
        messageId: run.userMessage.id,
        modelContent: run.userMessage.content,
        runId: run.runId,
      },
      type: "user_message",
    });
    threadLog.append(creation.conversation.id, {
      payload: { modelId: "test-model", runId: run.runId },
      type: "run_created",
    });
    threadLog.append(creation.conversation.id, {
      payload: { runId: run.runId },
      type: "run_started",
    });
    const tool = conversationToolItemSchema.parse({
      arguments: '{"command":"npm test"}',
      batchId: null,
      conversationId: creation.conversation.id,
      createdAt: new Date().toISOString(),
      diff: null,
      executionMode: "serial",
      id: crypto.randomUUID(),
      kind: "tool",
      name: "run_command",
      result: null,
      runId: run.runId,
      status: "running",
    });
    threadLog.append(creation.conversation.id, {
      payload: { runId: run.runId, tool, toolCallId: "call-command" },
      type: "tool_call_requested",
    });
    threadLog.append(creation.conversation.id, {
      payload: {
        permissionTool: "run_command",
        runId: run.runId,
        toolId: tool.id,
      },
      type: "tool_approval_requested",
    });

    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();
    expect(recovered.listTimeline(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: tool.id, status: "awaiting_approval" }),
    ]));
    recovered.interruptRecoveredThreadLogRuns();
    expect(recovered.getConversation(creation.conversation.id).lastRunStatus).toBe("failed");
    expect(recovered.listTimeline(creation.conversation.id)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: tool.id,
        result: "审批已失效：所属运行已经结束。",
        status: "cancelled",
      }),
    ]));
    source.close();
    recovered.close();
  });

  it("rebuilds task-list and Subagent relations after dependent Conversations and Runs", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "event-projector-subagent-recovery-"));
    temporaryDirectories.push(directory);
    const source = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const parentCreation = source.prepareConversationCreation(null);
    source.projectConversationCreated(parentCreation);
    threadLog.append(parentCreation.conversation.id, {
      payload: parentCreation,
      type: "conversation_created",
    });
    const parentRun = source.createRunWithUserMessage(
      parentCreation.conversation.id,
      "委派一次检查",
      "test-model",
    );
    threadLog.append(parentCreation.conversation.id, {
      payload: { modelId: "test-model", runId: parentRun.runId },
      type: "run_created",
    });

    const child = source.forkConversation(parentCreation.conversation.id, "subagent");
    threadLog.append(child.id, {
      payload: { agent: null, conversation: child },
      type: "conversation_created",
    });
    const childRun = source.createRunWithUserMessage(child.id, "检查恢复关系", "test-model");
    threadLog.append(child.id, {
      payload: { modelId: "test-model", runId: childRun.runId },
      type: "run_created",
    });
    const task = source.createSubagentTask({
      childConversationId: child.id,
      parentConversationId: parentCreation.conversation.id,
      sourceRunId: parentRun.runId,
      task: "检查恢复关系",
      title: "恢复关系检查",
    });
    const startedTask = source.assignSubagentTaskRun(task.id, childRun.runId);
    const taskList = source.createTaskList(parentCreation.conversation.id, [
      { status: "running", title: "等待 Subagent" },
    ]);
    threadLog.append(parentCreation.conversation.id, {
      payload: { task: startedTask },
      type: "subagent_task_created",
    });
    threadLog.append(parentCreation.conversation.id, {
      payload: { taskList },
      type: "task_list_updated",
    });
    source.finishRun(childRun.runId, "completed", null);
    const completedTask = source.completeSubagentTaskByRun({
      error: null,
      result: "恢复关系检查完成。",
      status: "completed",
      targetRunId: childRun.runId,
    });
    if (completedTask === null) throw new Error("Expected the Subagent task to be completed.");
    const resultMessage = source.deliverSubagentTaskResult(completedTask.id);
    if (resultMessage === null) throw new Error("Expected the Subagent result message to be delivered.");
    threadLog.append(child.id, {
      payload: {
        error: null,
        result: completedTask.result,
        runId: childRun.runId,
        status: "completed",
      },
      type: "run_finished",
    });
    threadLog.append(parentCreation.conversation.id, {
      payload: {
        task: { ...completedTask, resultMessageId: resultMessage.id },
      },
      type: "subagent_task_completed",
    });
    threadLog.append(parentCreation.conversation.id, {
      payload: {
        content: resultMessage.content,
        message: resultMessage,
        messageId: resultMessage.id,
        runId: childRun.runId,
        senderConversationId: child.id,
        taskId: completedTask.id,
      },
      type: "agent_message",
    });
    threadLog.append(parentCreation.conversation.id, {
      payload: { messageId: resultMessage.id },
      type: "agent_message_read",
    });

    const recovered = new AgentDatabase(":memory:");
    new EventProjector(recovered, threadLog).projectAllConversationLogs();

    expect(recovered.getTaskList(parentCreation.conversation.id)?.tasks).toMatchObject([
      { status: "running", title: "等待 Subagent" },
    ]);
    expect(recovered.listSubagentTasks(parentCreation.conversation.id)).toEqual([
      expect.objectContaining({
        childConversationId: child.id,
        id: startedTask.id,
        resultMessageId: resultMessage.id,
        sourceRunId: parentRun.runId,
        status: "completed",
        targetRunId: childRun.runId,
      }),
    ]);
    expect(recovered.listUndeliveredSubagentTasks()).toEqual([]);
    expect(recovered.listUnreadAgentMessages(parentCreation.conversation.id)).toEqual([]);
    source.close();
    recovered.close();
  });
});
