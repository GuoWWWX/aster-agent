import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

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
  it.each(["completed", "failed"] as const)("persists viewed %s results through restart, checkpoints and lazy history reload", async (status) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "conversation-viewed-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const log = new ThreadLog(directory);
    const projector = new EventProjector(database, log);
    const service = new ConversationLifecycleService(database, log, projector);
    const parent = service.createConversation(null);
    const childCreation = database.prepareConversationCreation(null);
    childCreation.conversation.parentConversationId = parent.id;
    childCreation.conversation.threadKind = "subagent";
    const child = childCreation.conversation;
    log.append(child.id, { type: "conversation_created", payload: childCreation });
    projector.projectConversation(child.id);
    const unread = service.createConversation(null);
    const finish = (id: string) => {
      const runId = crypto.randomUUID();
      log.append(id, { type: "run_queued", payload: {
        runId, modelId: "test-model", messageId: crypto.randomUUID(), content: "请求",
      } });
      log.append(id, { type: "run_terminal", payload: {
        runId, status, modelId: "test-model", content: "结果", result: "结果",
        messageId: crypto.randomUUID(), error: null, assistantKind: "turn",
      } });
      projector.projectConversation(id);
    };
    for (const id of [parent.id, child.id, unread.id]) finish(id);
    projector.checkpointInactiveConversations();
    for (const id of [parent.id, child.id]) {
      expect(database.getConversation(id).hasUnreadResult).toBe(true);
      const before = database.getConversation(id);
      const context = log.readContext(id);
      const timeline = projector.listTimeline(id);
      expect(service.markConversationResultViewed(id)).toEqual({ ...before, hasUnreadResult: false });
      expect(log.read(id)?.events.at(-1)?.type).toBe("conversation_result_viewed");
      const count = log.read(id)?.events.length;
      service.markConversationResultViewed(id);
      expect(log.read(id)?.events).toHaveLength(count!);
      expect(log.readContext(id)).toEqual(context);
      expect(projector.listTimeline(id)).toEqual(timeline);
    }
    const verifyRestart = (releaseHistory = true) => {
      const restored = new AgentDatabase(":memory:");
      const next = new EventProjector(restored, new ThreadLog(directory));
      next.projectAllConversationLogs({ releaseHistory });
      for (const id of [parent.id, child.id]) {
        expect(restored.getConversation(id).hasUnreadResult).toBe(false);
        next.ensureConversationHistoryProjected(id);
        expect(restored.getConversation(id).hasUnreadResult).toBe(false);
      }
      expect(restored.getConversation(unread.id).hasUnreadResult).toBe(true);
      restored.close();
    };
    verifyRestart(); // Acknowledgement after the checkpoint.
    verifyRestart(false); // Full event replay without the startup shortcut.
    projector.checkpointInactiveConversations();
    verifyRestart(); // Acknowledgement included in the checkpoint.
    finish(parent.id);
    const restored = new AgentDatabase(":memory:");
    new EventProjector(restored, new ThreadLog(directory)).projectAllConversationLogs({ releaseHistory: true });
    expect(restored.getConversation(parent.id).hasUnreadResult).toBe(true);
    expect(restored.getConversation(child.id).hasUnreadResult).toBe(false);
    database.close();
    restored.close();
  });

  it("does not clear unread state when its durable acknowledgement fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "conversation-viewed-failure-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const log = new ThreadLog(directory);
    const projector = new EventProjector(database, log);
    const service = new ConversationLifecycleService(database, log, projector);
    const conversation = service.createConversation(null);
    const runId = crypto.randomUUID();
    log.append(conversation.id, { type: "run_created", payload: { runId, modelId: "test-model" } });
    log.append(conversation.id, { type: "run_finished", payload: { runId, status: "completed" } });
    projector.projectConversation(conversation.id);
    const append = vi.spyOn(log, "append").mockImplementationOnce(() => { throw new Error("disk full"); });
    expect(() => service.markConversationResultViewed(conversation.id)).toThrow("disk full");
    expect(database.getConversation(conversation.id).hasUnreadResult).toBe(true);
    append.mockRestore();
    // A crash after append but before projection must recover the acknowledgement.
    vi.spyOn(projector, "projectBusinessEvent").mockImplementationOnce(() => { throw new Error("projection failed"); });
    expect(() => service.markConversationResultViewed(conversation.id)).toThrow("projection failed");
    const restored = new AgentDatabase(":memory:");
    new EventProjector(restored, new ThreadLog(directory)).projectAllConversationLogs({ releaseHistory: true });
    expect(restored.getConversation(conversation.id).hasUnreadResult).toBe(false);
    database.close();
    restored.close();
  });

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

  it("restores the previous SQLite properties when the JSONL append fails", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "conversation-properties-failure-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const projector = new EventProjector(database, threadLog);
    const service = new ConversationLifecycleService(database, threadLog, projector);
    const conversation = service.createConversation(null);
    vi.spyOn(threadLog, "append").mockImplementationOnce(() => {
      throw Object.assign(new Error("disk full"), { code: "ENOSPC" });
    });

    expect(() => service.renameConversation(conversation.id, "不应留在 SQLite 中"))
      .toThrow("disk full");

    expect(database.getConversation(conversation.id).title).toBe(conversation.title);
    expect(threadLog.read(conversation.id)?.events).toHaveLength(1);
  });

  it("keeps a later automatic title when restoring an earlier property snapshot", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "conversation-properties-title-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const projector = new EventProjector(database, threadLog);
    const service = new ConversationLifecycleService(database, threadLog, projector);
    const conversation = service.createConversation(null);
    service.setConversationPermissionMode(conversation.id, "read_only");
    threadLog.append(conversation.id, {
      payload: {
        createdAt: "2026-09-07T02:00:00.000Z",
        title: "来自首条用户消息的标题",
      },
      type: "run_queued",
    });
    database.renameConversation(conversation.id, "损坏的 SQLite 标题");

    database.restoreThreadLogConversationProperties(
      conversation.id,
      threadLog.read(conversation.id)?.events ?? [],
    );

    expect(database.getConversation(conversation.id)).toMatchObject({
      permissionMode: "read_only",
      title: "来自首条用户消息的标题",
    });
  });

  it("validates only the final project binding when an old project was removed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "conversation-properties-project-"));
    temporaryDirectories.push(directory);
    const database = new AgentDatabase(":memory:");
    const projectId = crypto.randomUUID();
    database.saveProject({
      id: projectId,
      isPinned: false,
      name: "旧项目",
      rootPath: path.join(directory, "project"),
      showTeamsInNavigator: false,
    });
    const threadLog = new ThreadLog(path.join(directory, "conversations"));
    const projector = new EventProjector(database, threadLog);
    const service = new ConversationLifecycleService(database, threadLog, projector);
    const conversation = service.createConversation(projectId);
    service.setConversationProject(conversation.id, null);
    database.deleteProject(projectId);

    expect(() => projector.projectConversation(conversation.id)).not.toThrow();
    expect(database.getConversation(conversation.id).projectId).toBeNull();
  });
});
