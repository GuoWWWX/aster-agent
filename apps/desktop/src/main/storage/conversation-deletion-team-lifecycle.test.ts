import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentDatabase } from "./agent-database.js";
import { ConversationDeletionService } from "./conversation-deletion-service.js";

const databases = new Set<AgentDatabase>();
const directories: string[] = [];
afterEach(async () => {
  for (const database of databases) database.close();
  databases.clear();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

function serviceFixture(database: AgentDatabase) {
  const files = vi.fn(() => Promise.resolve(undefined));
  const checkpoints = vi.fn(() => Promise.resolve(undefined));
  const logs = vi.fn(() => Promise.resolve(undefined));
  const unmount = vi.fn();
  const service = new ConversationDeletionService(database,
    { deleteUnreferencedConversationFiles: files }, { unmountConversationWorkspace: unmount },
    { deleteThreads: checkpoints }, { deleteConversations: logs });
  return { service, files, checkpoints, logs, unmount };
}

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "deletion-team-lifecycle-"));
  directories.push(directory);
  const databasePath = path.join(directory, "db.sqlite");
  const database = new AgentDatabase(databasePath);
  databases.add(database);
  database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  const projectId = randomUUID();
  database.saveProject({ id: projectId, isPinned: false, name: "删除边界", rootPath: directory });
  const source = database.createConversation(projectId);
  const instance = database.createTeamInstance({
    teamId: "default-team", scope: "conversation", projectId, sourceConversationId: source.id, name: "专属团队",
  });
  const selection = { modelId: "fixture", providerId: randomUUID(), reasoning: null };
  const workItem = database.createTeamWorkItem({
    acceptanceCriteria: [], executionScope: "conversation", permissionMode: "full_access", priority: "normal",
    projectId, sourceConversationId: source.id, teamId: instance.teamId, teamInstanceId: instance.id,
    requirement: "保留隔离关系", title: "来源对话任务",
  }, selection);
  const sql = (operation: (connection: DatabaseSync) => void) => {
    const connection = new DatabaseSync(databasePath);
    try { operation(connection); } finally { connection.close(); }
  };
  return { database, databasePath, instance, projectId, selection, source, sql, workItem, ...serviceFixture(database) };
}

describe("conversation deletion and conversation-scoped Team lifecycle", () => {
  it.each(["queued", "planned", "running", "reviewing"] as const)(
    "blocks source deletion before intent or IO when its Team has %s work", async status => {
      const f = await fixture();
      f.sql(connection => { connection.prepare("UPDATE team_work_items SET status = ? WHERE id = ?").run(status, f.workItem.id); });
      expect(() => f.database.deleteTeamInstance(f.instance.id)).toThrow("active work");
      await expect(f.service.requestDeletion(f.source.id)).rejects.toThrow("active work");
      expect(f.database.listIncompleteConversationDeletionTasks()).toEqual([]);
      expect(f.database.getConversation(f.source.id).id).toBe(f.source.id);
      expect(f.database.getTeamWorkItem(f.workItem.id).status).toBe(status);
      expect(f.files).not.toHaveBeenCalled();
      expect(f.checkpoints).not.toHaveBeenCalled();
      expect(f.logs).not.toHaveBeenCalled();
      expect(f.unmount).not.toHaveBeenCalled();
    },
  );

  it.each(["failed", "running"] as const)(
    "blocks legacy %s cleanup before IO after restart, continues other jobs and retries once unblocked", async status => {
      const f = await fixture();
      f.database.failTeamWorkItemBeforeRun(f.workItem.id, "准备旧版本失败意图");
      const task = f.database.createConversationDeletionTask(f.source.id);
      f.sql(connection => {
        connection.prepare("UPDATE team_work_items SET status = 'queued' WHERE id = ?").run(f.workItem.id);
        connection.prepare("UPDATE conversation_deletion_tasks SET status = ?, retry_count = 1 WHERE id = ?").run(status, task.id);
      });
      f.database.close();
      databases.delete(f.database);
      const restored = new AgentDatabase(f.databasePath);
      databases.add(restored);
      const retry = serviceFixture(restored);
      await expect(retry.service.resumeIncompleteTasks()).resolves.toBeUndefined();
      expect(restored.listIncompleteConversationDeletionTasks()).toContainEqual(expect.objectContaining({
        id: task.id, status: "failed",
      }));
      expect(restored.listIncompleteConversationDeletionTasks().find(candidate => candidate.id === task.id)?.lastError)
        .toContain("active work");
      expect(retry.files).not.toHaveBeenCalled();
      expect(retry.checkpoints).not.toHaveBeenCalled();
      expect(retry.logs).not.toHaveBeenCalled();
      expect(restored.getTeamInstance(f.instance.id).sourceConversationId).toBe(f.source.id);

      const other = restored.createConversation(f.projectId);
      restored.createConversationDeletionTask(other.id);
      await retry.service.resumeIncompleteTasks();
      expect(restored.hasConversation(other.id)).toBe(false);
      expect(retry.files).toHaveBeenCalledExactlyOnceWith([other.id], []);
      expect(retry.logs).toHaveBeenCalledExactlyOnceWith([other.id]);
      expect(retry.checkpoints).toHaveBeenCalledOnce();
      retry.files.mockClear(); retry.checkpoints.mockClear(); retry.logs.mockClear();

      restored.failTeamWorkItemBeforeRun(f.workItem.id, "已停止待办工作");
      await retry.service.resumeIncompleteTasks();
      expect(restored.hasConversation(f.source.id)).toBe(false);
      expect(restored.listIncompleteConversationDeletionTasks()).toEqual([]);
      expect(retry.files).toHaveBeenCalledExactlyOnceWith([f.source.id], []);
      expect(retry.logs).toHaveBeenCalledExactlyOnceWith([f.source.id]);
      expect(restored.getTeamWorkItem(f.workItem.id)).toMatchObject({
        executionScope: "conversation", teamInstanceId: f.instance.id, instanceName: f.instance.name, status: "failed",
      });
    },
  );

  it.each(["failed", "completed"] as const)("retains %s WorkItem identity and instance name in a hidden tombstone", async status => {
    const f = await fixture();
    f.sql(connection => { connection.prepare("UPDATE team_work_items SET status = ? WHERE id = ?").run(status, f.workItem.id); });
    await expect(f.service.requestDeletion(f.source.id)).resolves.toBe("completed");
    expect(f.database.getTeamWorkItem(f.workItem.id)).toMatchObject({
      executionScope: "conversation", instanceName: f.instance.name, sourceConversationId: null,
      teamInstanceId: f.instance.id, status,
    });
    expect(f.database.listTeamInstances({ includeArchived: true })).toEqual([]);
    expect(() => f.database.getTeamInstance(f.instance.id)).toThrow("not found");
    f.sql(connection => {
      const tombstone = connection.prepare("SELECT id, name, scope, source_conversation_id, root_conversation_id, archived_at, deleted_at FROM team_instances WHERE id = ?")
        .get(f.instance.id);
      expect(tombstone).toMatchObject({
          id: f.instance.id, name: f.instance.name, scope: "conversation", source_conversation_id: null,
          root_conversation_id: null,
        });
      expect(tombstone?.archived_at).toBeTypeOf("string");
      expect(tombstone?.deleted_at).toBeTypeOf("string");
      expect(connection.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    });
  });

  it("rejects republishing an isolated task during deletion and after its source has been removed", async () => {
    const f = await fixture();
    f.database.failTeamWorkItemBeforeRun(f.workItem.id, "暂不执行");
    f.database.createConversationDeletionTask(f.source.id);
    expect(() => f.database.publishTeamWorkItem(f.workItem.id)).toThrow();
    expect(f.database.getTeamWorkItem(f.workItem.id).status).toBe("failed");
    await f.service.resumeIncompleteTasks();
    expect(() => f.database.publishTeamWorkItem(f.workItem.id)).toThrow();
    expect(f.database.getTeamWorkItem(f.workItem.id)).toMatchObject({ status: "failed", executionScope: "conversation" });
  });

  it("still republishes an isolated historical task whose instance and source remain available", async () => {
    const f = await fixture();
    f.database.failTeamWorkItemBeforeRun(f.workItem.id, "临时失败");
    expect(f.database.publishTeamWorkItem(f.workItem.id)).toMatchObject({
      status: "queued", executionScope: "conversation", sourceConversationId: f.source.id, teamInstanceId: f.instance.id,
    });
  });

  it("preserves publication when the source is archived but has not been deleted", async () => {
    const f = await fixture();
    f.database.failTeamWorkItemBeforeRun(f.workItem.id, "临时失败");
    f.database.setConversationArchived(f.source.id, true);
    expect(f.database.publishTeamWorkItem(f.workItem.id)).toMatchObject({
      status: "queued", executionScope: "conversation", sourceConversationId: f.source.id, teamInstanceId: f.instance.id,
    });
  });

  it("makes the execution child unavailable to rework and answer-entry guards before cleanup IO", async () => {
    const f = await fixture();
    const lead = f.database.createConversation(f.projectId, {
      parentConversationId: f.source.id, threadKind: "team_lead", teamId: f.instance.teamId,
    });
    f.sql(connection => {
      connection.prepare("UPDATE team_work_items SET status = 'waiting_user', execution_conversation_id = ? WHERE id = ?")
        .run(lead.id, f.workItem.id);
    });
    expect(f.database.createConversationDeletionTask(f.source.id).conversationIds).toEqual([f.source.id, lead.id]);
    expect(() => f.database.getConversation(lead.id)).toThrow("Conversation was not found");
    expect(f.database.getTeamWorkItem(f.workItem.id).status).toBe("waiting_user");
    expect(f.files).not.toHaveBeenCalled();
    expect(f.checkpoints).not.toHaveBeenCalled();
    expect(f.logs).not.toHaveBeenCalled();
  });

  it.each(["global", "project"] as const)("still republishes a valid %s historical task", async scope => {
    const f = await fixture();
    const projectId = scope === "global" ? null : f.projectId;
    const instance = f.database.createTeamInstance({
      scope, teamId: "default-team", ...(projectId === null ? {} : { projectId }),
    });
    const item = f.database.createTeamWorkItem({
      acceptanceCriteria: [], executionScope: "project", permissionMode: "full_access", priority: "normal",
      projectId, teamId: instance.teamId, teamInstanceId: instance.id, requirement: "有效历史任务", title: "重新发布",
    }, f.selection);
    f.database.failTeamWorkItemBeforeRun(item.id, "临时失败");
    expect(f.database.publishTeamWorkItem(item.id)).toMatchObject({ status: "queued", teamInstanceId: instance.id, projectId });
  });
});
