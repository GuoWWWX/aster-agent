import { randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentDatabase } from "./agent-database.js";

const databases: AgentDatabase[] = [];
const connections: DatabaseSync[] = [];
const directories: string[] = [];

afterEach(async () => {
  for (const connection of connections.splice(0)) connection.close();
  for (const database of databases.splice(0)) database.close();
  await Promise.all(directories.splice(0).map(directory => rm(directory, { force: true, recursive: true })));
});

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "agent-conversation-directory-"));
  directories.push(directory);
  const databasePath = path.join(directory, "db.sqlite");
  const database = new AgentDatabase(databasePath);
  databases.push(database);
  const sql = new DatabaseSync(databasePath);
  connections.push(sql);
  return { database, sql };
}

function expectOriginalDirectoryProjection(database: AgentDatabase, sql: DatabaseSync) {
  const ids = sql.prepare(
    "SELECT id FROM conversations WHERE is_archived = 0 AND deletion_pending = 0 ORDER BY updated_at DESC, rowid DESC",
  ).all().map(row => {
    if (typeof row.id !== "string") throw new Error("Expected a fixture conversation ID.");
    return row.id;
  });
  const expected = ids.map(id => database.getConversation(id));
  expect(database.listAgentConversations()).toEqual(expected);
  return expected;
}

describe("Agent conversation directory projection", () => {
  it("keeps updated-time and insertion ordering independently of navigator pin/sort order, excluding archived and deleting rows", async () => {
    const { database, sql } = await fixture();
    const first = database.createConversation(null, {
      agent: { id: "fixture-agent", name: "专属身份", role: "检查", isDefault: false, instructions: "" },
      modelSelection: { providerId: randomUUID(), modelId: "fixture-model", reasoning: null },
    });
    const second = database.createConversation(null);
    const third = database.createConversation(null);
    const archived = database.createConversation(null);
    const deleting = database.createConversation(null);
    database.setConversationArchived(archived.id, true);
    database.createConversationDeletionTask(deleting.id);
    sql.prepare("UPDATE conversations SET updated_at = ?, is_pinned = 0, sort_order = 0").run("2026-10-01T00:00:00.000Z");
    sql.prepare("UPDATE conversations SET is_pinned = 1, sort_order = -1 WHERE id = ?").run(first.id);
    sql.prepare("UPDATE conversations SET updated_at = ? WHERE id = ?").run("2026-10-02T00:00:00.000Z", second.id);

    const rows = expectOriginalDirectoryProjection(database, sql);
    expect(rows.map(row => row.id)).toEqual([second.id, third.id, first.id]);
    expect(rows.at(-1)).toMatchObject({ agentId: "fixture-agent", modelSelection: first.modelSelection, isPinned: true });
    expect(database.listConversationHierarchy()[0]?.id).toBe(first.id);
  });

  it("retains active/latest Run status and registered Subagent state without treating side conversations as Subagents", async () => {
    const { database, sql } = await fixture();
    const parent = database.createConversation(null);
    const parentRun = database.createRunWithUserMessage(parent.id, "父任务", "fixture");
    database.markRunRunning(parentRun.runId);
    const child = database.forkConversation(parent.id, "subagent");
    const childRun = database.createRunWithUserMessage(child.id, "子任务", "fixture");
    const task = database.createSubagentTask({
      childConversationId: child.id, parentConversationId: parent.id, sourceRunId: parentRun.runId,
      task: "独立检查", title: "独立检查",
    });
    database.assignSubagentTaskRun(task.id, childRun.runId);
    const side = database.forkConversation(parent.id, "side");
    const finished = database.createRunWithUserMessage(side.id, "侧边讨论", "fixture");
    database.finishRun(finished.runId, "completed", null);

    const rows = expectOriginalDirectoryProjection(database, sql);
    expect(rows.find(row => row.id === parent.id)).toMatchObject({
      activeRunId: parentRun.runId, activeSubagentCount: 1, lastRunStatus: "running",
    });
    expect(rows.find(row => row.id === child.id)).toMatchObject({
      activeRunId: childRun.runId, parentConversationId: parent.id, subagentTaskStatus: "running",
    });
    expect(rows.find(row => row.id === side.id)).toMatchObject({ activeRunId: null, lastRunStatus: "completed", subagentTaskStatus: null });
  });

  it.each(["running", "reviewing", "waiting_user", "planned", "queued", "completed"] as const)(
    "preserves %s WorkItem ownership across members and registered descendants of a reused execution root", async status => {
      const { database, sql } = await fixture();
      database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
      const instance = database.createTeamInstance({ scope: "global", teamId: "default-team" });
      const lead = database.createConversation(null, { teamId: instance.teamId, threadKind: "team_lead" });
      database.bindTeamExecutionConversation({
        conversationId: lead.id, projectId: null, sourceConversationId: null, teamId: instance.teamId, teamInstanceId: instance.id,
      });
      const member = database.createConversation(null, {
        parentConversationId: lead.id, teamId: instance.teamId, threadKind: "agent",
        agent: { id: "developer", name: "开发成员", role: "开发", isDefault: false, instructions: "" },
      });
      database.bindTeamMemberConversation({ agentId: "developer", conversationId: member.id, teamExecutionConversationId: lead.id });
      const memberRun = database.createRunWithUserMessage(member.id, "独立检查", "fixture");
      const child = database.forkConversation(member.id, "subagent");
      const childTask = database.createSubagentTask({
        childConversationId: child.id, parentConversationId: member.id, sourceRunId: memberRun.runId,
        task: "成员的子任务", title: "成员的子任务",
      });
      expect(childTask.parentConversationId).toBe(member.id);
      const side = database.forkConversation(member.id, "side");
      const unregistered = database.forkConversation(side.id, "subagent");
      const selection = { providerId: randomUUID(), modelId: "fixture", reasoning: null };
      const createWork = () => database.createTeamWorkItem({
        acceptanceCriteria: [], executionScope: "project", permissionMode: "full_access", priority: "normal", projectId: null,
        requirement: "保留原谱系", teamId: instance.teamId, teamInstanceId: instance.id, title: "复用执行根",
      }, selection);
      const old = createWork();
      const current = createWork();
      sql.prepare("UPDATE team_work_items SET status = 'completed', execution_conversation_id = ?, updated_at = ? WHERE id = ?")
        .run(lead.id, "2026-10-19T12:00:00.000Z", old.id);
      sql.prepare("UPDATE team_work_items SET status = ?, execution_conversation_id = ?, updated_at = ? WHERE id = ?")
        .run(status, lead.id, "2026-10-19T11:00:00.000Z", current.id);
      const expectedOwner = status === "completed" ? old.id : current.id;

      const rows = expectOriginalDirectoryProjection(database, sql);
      for (const id of [lead.id, member.id, child.id]) {
        expect(rows.find(row => row.id === id)?.teamWorkItemId).toBe(expectedOwner);
      }
      for (const id of [side.id, unregistered.id]) {
        expect(rows.find(row => row.id === id)?.teamWorkItemId).toBeNull();
      }
      for (const row of database.listConversationHierarchy()) {
        expect(row).toEqual(database.getConversation(row.id));
      }
      sql.prepare("UPDATE team_work_items SET status = ?, updated_at = ? WHERE id IN (?, ?)")
        .run(status, "2026-10-19T12:00:00.000Z", old.id, current.id);
      expect(expectOriginalDirectoryProjection(database, sql).find(row => row.id === child.id)?.teamWorkItemId).toBe(current.id);
    },
  );

  it("keeps group coordination identity on the coordinator without assigning it to ordinary members", async () => {
    const { database, sql } = await fixture();
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const instance = database.createTeamInstance({ scope: "global", teamId: "default-team" });
    const coordinator = database.createConversation(null);
    const unrelated = database.createConversation(null);
    database.collaboration.bindCoordinatorConversation(instance.id, "default-agent", coordinator.id);

    const rows = expectOriginalDirectoryProjection(database, sql);
    expect(rows.find(row => row.id === coordinator.id)?.coordinationTeamInstanceId).toBe(instance.id);
    expect(rows.find(row => row.id === unrelated.id)?.coordinationTeamInstanceId).toBeUndefined();
    expect(database.listConversationHierarchy().find(row => row.id === coordinator.id)).toEqual(database.getConversation(coordinator.id));
  });

  it.each(["sqlite", "jsonl-temp"] as const)("keeps the %s directory to one SQL statement as the result set grows", async storage => {
    const { database } = await fixture();
    if (storage === "jsonl-temp") {
      database.activateVolatileConversationProjection();
      database.finalizeJsonlConversationStorage();
    }
    const queries = vi.spyOn(DatabaseSync.prototype, "prepare");
    try {
      for (const count of [0, 2, 12]) {
        while (database.listAllConversationIds().length < count) database.createConversation(null);
        const expected = database.listAllConversationIds().map(id => database.getConversation(id));
        queries.mockClear();
        const rows = database.listAgentConversations();
        expect(queries).toHaveBeenCalledTimes(1);
        expect(rows).toHaveLength(count);
        expect(rows).toEqual(expect.arrayContaining(expected));
      }
    } finally {
      queries.mockRestore();
    }
  });
});
