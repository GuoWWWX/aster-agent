import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";

import { AgentDatabase, type RunExecutionSnapshot } from "./agent-database.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { force: true, recursive: true })
    )
  );
});

describe("AgentDatabase", () => {
  it("records the current schema version and keeps it stable across restarts", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const firstDatabase = new AgentDatabase(databasePath);
    firstDatabase.close();

    const firstMetadata = new DatabaseSync(databasePath);
    const firstRow = firstMetadata
      .prepare(
        "SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1",
      )
      .get() as Record<string, unknown>;
    firstMetadata.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    reopenedDatabase.close();

    const secondMetadata = new DatabaseSync(databasePath);
    const secondRow = secondMetadata
      .prepare(
        "SELECT version, name, applied_at FROM schema_migrations ORDER BY version DESC LIMIT 1",
      )
      .get() as Record<string, unknown>;
    const migrationCount = secondMetadata
      .prepare("SELECT COUNT(*) AS count FROM schema_migrations")
      .get() as Record<string, unknown>;
    secondMetadata.close();

    expect(firstRow.version).toBe(16);
    expect(firstRow.name).toBe("team-instance-sort-order");
    expect(secondRow).toEqual(firstRow);
    expect(migrationCount.count).toBe(16);
  });

  it("preserves legacy Team execution scope when migrating version 12 data", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000061",
      isPinned: false,
      name: "Team scope migration fixture",
      rootPath: "D:\\workspace\\team-scope-migration",
    };
    const selection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000062",
      reasoning: null,
    };
    database.saveProject(project);
    const source = database.createConversation(project.id);
    const projectScoped = database.createTeamWorkItem({
      acceptanceCriteria: [],
      modelSelection: selection,
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: "旧版无来源任务。",
      teamId: "default-team",
      title: "旧版项目任务",
    }, selection);
    const conversationScoped = database.createTeamWorkItem({
      acceptanceCriteria: [],
      executionScope: "conversation",
      modelSelection: selection,
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: "旧版有来源任务。",
      sourceConversationId: source.id,
      teamId: "default-team",
      title: "旧版对话任务",
    }, selection);
    database.close();

    const legacy = new DatabaseSync(databasePath);
    legacy.exec("ALTER TABLE team_work_items DROP COLUMN execution_scope");
    legacy.exec("DELETE FROM schema_migrations WHERE version >= 13");
    legacy.close();

    const migrated = new AgentDatabase(databasePath);
    expect(migrated.getTeamWorkItem(projectScoped.id).executionScope).toBe("project");
    expect(migrated.getTeamWorkItem(conversationScoped.id).executionScope).toBe("conversation");
    migrated.close();
  });

  it("searches persisted conversation messages by bounded keyword matches", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const first = database.createRunWithUserMessage(
      conversation.id,
      "实现登录页",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "登录页使用 src/login.tsx，需要补充表单校验。",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: first.runId,
      toolCalls: [],
    });
    database.finishRun(first.runId, "completed", null);
    const second = database.createRunWithUserMessage(
      conversation.id,
      "继续处理其他页面",
      "test-model",
    );
    database.finishRun(second.runId, "completed", null);

    const matches = database.searchContextMessages({
      conversationId: conversation.id,
      excludeSequences: [
        database.listContextMessages(conversation.id).at(-1)?.sequence ?? 0,
      ],
      limit: 5,
      query: "login.tsx 表单校验",
    });

    expect(matches.some((message) => message.content.includes("src/login.tsx"))).toBe(true);
    expect(matches.some((message) => message.content === "继续处理其他页面")).toBe(false);
    database.close();
  });

  it("persists full reasoning for display without adding it to model-visible text", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const run = database.createRunWithUserMessage(conversation.id, "请分析", "test-model");
    const message = database.appendAssistantTurn({
      content: "",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      reasoningContent: "完整思考过程",
      runId: run.runId,
      toolCalls: [],
    });

    expect(message).toMatchObject({ content: "", reasoningContent: "完整思考过程" });
    expect(database.listTimeline(conversation.id)).toContainEqual(
      expect.objectContaining({ reasoningContent: "完整思考过程" }),
    );
    expect(database.listModelMessages(conversation.id).at(-1)?.content).toBe("");
    database.close();
  });

  it("keeps the context search index synchronized across restart, edit, and deletion", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-search-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const firstDatabase = new AgentDatabase(databasePath);
    const conversation = firstDatabase.createConversation(null);
    const firstRun = firstDatabase.createRunWithUserMessage(
      conversation.id,
      "初始查询",
      "test-model",
    );
    firstDatabase.appendAssistantTurn({
      content: "工具结果已保存到旧路径。",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: firstRun.runId,
      toolCalls: [],
    });
    firstDatabase.finishRun(firstRun.runId, "completed", null);
    expect(firstDatabase.searchContextMessages({
      conversationId: conversation.id,
      query: "旧路径",
    })).toHaveLength(1);
    firstDatabase.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(reopenedDatabase.searchContextMessages({
      conversationId: conversation.id,
      query: "旧路径",
    })).toHaveLength(1);

    const editableRun = reopenedDatabase.createRunWithUserMessage(
      conversation.id,
      "旧词",
      "test-model",
    );
    reopenedDatabase.finishRun(editableRun.runId, "completed", null);
    const replacement = reopenedDatabase.replaceLatestUserMessage({
      content: "新词",
      conversationId: conversation.id,
      messageId: editableRun.userMessage.id,
      modelContent: "新词",
      modelId: "test-model",
    });
    reopenedDatabase.finishRun(replacement.runId, "cancelled", null);
    expect(reopenedDatabase.searchContextMessages({
      conversationId: conversation.id,
      query: "旧词",
    })).toHaveLength(0);
    expect(reopenedDatabase.searchContextMessages({
      conversationId: conversation.id,
      query: "新词",
    })).toHaveLength(1);

    const deletionTask = reopenedDatabase.createConversationDeletionTask(conversation.id);
    reopenedDatabase.completeConversationDeletionTask(deletionTask.id);
    reopenedDatabase.close();

    const rawDatabase = new DatabaseSync(databasePath);
    const indexRows = rawDatabase
      .prepare("SELECT COUNT(*) AS count FROM model_message_search WHERE conversation_id = ?")
      .get(conversation.id) as { count: number };
    rawDatabase.close();
    expect(indexRows.count).toBe(0);
  });

  it("searches Tool Call arguments and falls back for short or invalid queries", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const run = database.createRunWithUserMessage(
      conversation.id,
      "读取配置",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "开始读取文件。",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [{
        arguments: JSON.stringify({ path: "src/xy.ts" }),
        id: "call-read-config",
        name: "read_file",
      }],
    });
    database.finishRun(run.runId, "completed", null);

    expect(database.searchContextMessages({
      conversationId: conversation.id,
      query: "src/xy.ts",
    })).toHaveLength(1);
    expect(database.searchContextMessages({
      conversationId: conversation.id,
      query: "xy",
    })).toHaveLength(1);
    expect(database.searchContextMessages({
      conversationId: conversation.id,
      query: "!!! ---",
    })).toEqual([]);
    database.close();
  });

  it("refuses to open a database from a newer schema version", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const futureDatabase = new DatabaseSync(databasePath);
    futureDatabase.exec(`
      CREATE TABLE schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
      INSERT INTO schema_migrations (version, name, applied_at)
      VALUES (99, 'future', '2026-08-18T00:00:00.000Z');
    `);
    futureDatabase.close();

    expect(() => new AgentDatabase(databasePath)).toThrow(
      "newer than supported version 16",
    );
  });

  it("stores Team membership as SQLite relationships and routes only a bound Team Lead", () => {
    const database = new AgentDatabase(":memory:");
    const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    database.syncTeamDirectory(directory);

    expect(database.listTeams().map((team) => team.id)).toEqual([
      "release-review-team",
      "default-team",
    ]);
    expect(database.listTeamMembers("default-team")).toEqual([
      expect.objectContaining({ agentId: "team-lead", role: "任务分诊、调度与交付" }),
      expect.objectContaining({ agentId: "requirements-analyst", role: "需求澄清与验收定义" }),
      expect.objectContaining({ agentId: "solution-architect", role: "技术方案与架构边界" }),
      expect.objectContaining({ agentId: "frontend-engineer", role: "前端实现与交互验证" }),
      expect.objectContaining({ agentId: "backend-engineer", role: "后端实现与数据安全" }),
      expect.objectContaining({ agentId: "qa-engineer", role: "测试设计与质量验收" }),
    ]);

    const lead = directory.agents.find((agent) => agent.id === "team-lead");
    if (lead === undefined) throw new Error("Team Lead fixture is unavailable.");
    const coordinator = database.createConversation(null, {
      agent: {
        id: lead.id,
        instructions: lead.instructions,
        isDefault: lead.isDefault,
        name: lead.name,
        role: lead.role,
      },
      teamId: "default-team",
      threadKind: "team_lead",
    });
    database.setTeamCoordinatorConversation("default-team", coordinator.id);

    expect(database.getTeamCoordinatorConversationId("default-team")).toBe(coordinator.id);
    database.syncTeamDirectory({ ...directory, teams: [directory.teams[0]!] });
    expect(database.getTeamCoordinatorConversationId("default-team")).toBe(coordinator.id);
    expect(() => database.getTeamCoordinatorConversationId("release-review-team"))
      .toThrow("Team was not found");
    database.close();
  });

  it("persists Team WorkItem execution, rework, and user acceptance", () => {
    const database = new AgentDatabase(":memory:");
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000001",
      isPinned: false,
      name: "Team fixture",
      rootPath: "D:\\workspace\\team-fixture",
    };
    database.saveProject(project);
    const modelSelection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000002",
      reasoning: { kind: "effort" as const, value: "high" as const },
    };
    const created = database.createTeamWorkItem({
      acceptanceCriteria: ["测试通过"],
      modelSelection,
      permissionMode: "full_access",
      priority: "high",
      projectId: project.id,
      requirement: "实现一个可测试的加法函数。",
      teamId: "default-team",
      title: "实现加法函数",
    }, modelSelection);

    expect(created).toMatchObject({
      executionScope: "project",
      revision: 1,
      status: "queued",
    });
    expect(created.events.map((event) => event.type)).toEqual(["received", "scheduled"]);
    expect(database.updateTeamWorkItem({
      requirement: "实现一个可测试的加法函数，并验证负数边界。",
      title: "实现加法函数和边界测试",
      workItemId: created.id,
    })).toMatchObject({
      requirement: "实现一个可测试的加法函数，并验证负数边界。",
      title: "实现加法函数和边界测试",
    });

    const execution = database.createConversation(project.id);
    const firstRun = database.createRunWithUserMessage(execution.id, "开始执行", modelSelection.modelId);
    database.createTaskList(execution.id, [{ status: "running", title: "实现与测试" }]);
    expect(database.startTeamWorkItem(created.id, execution.id, firstRun.runId)).toMatchObject({
      activeRunId: firstRun.runId,
      status: "running",
      tasks: [expect.objectContaining({ title: "实现与测试" })],
    });
    expect(() => database.updateTeamWorkItem({
      requirement: "不应覆盖已开始执行的需求。",
      title: "不应覆盖",
      workItemId: created.id,
    })).toThrow("Only a queued Team WorkItem");
    expect(database.updateTeamWorkItemPermission({
      permissionMode: "read_only",
      workItemId: created.id,
    })).toMatchObject({ permissionMode: "read_only", status: "running" });
    const latestWorkItemEvent = database.getTeamWorkItem(created.id).events.at(-1);
    expect(latestWorkItemEvent?.type).toBe("updated");
    expect(latestWorkItemEvent?.detail).toContain("权限");
    database.finishRun(firstRun.runId, "completed", null);
    expect(database.finishTeamWorkItemRun({
      conversationId: execution.id,
      error: null,
      resultSummary: "实现完成，测试通过。",
      runId: firstRun.runId,
      status: "completed",
      workItemId: created.id,
    })).toMatchObject({ resultSummary: "实现完成，测试通过。", status: "waiting_user" });

    const secondRun = database.createRunWithUserMessage(execution.id, "补充边界测试", modelSelection.modelId);
    expect(database.startTeamWorkItemRework(created.id, secondRun.runId, "补充负数测试"))
      .toMatchObject({ revision: 2, status: "running" });
    database.finishRun(secondRun.runId, "completed", null);
    database.finishTeamWorkItemRun({
      conversationId: execution.id,
      error: null,
      resultSummary: "已补充负数测试。",
      runId: secondRun.runId,
      status: "completed",
      workItemId: created.id,
    });
    expect(() => database.acceptTeamWorkItem({
      acceptedCriteria: [],
      workItemId: created.id,
    })).toThrow("Every acceptance criterion");
    const accepted = database.acceptTeamWorkItem({
      acceptedCriteria: created.acceptanceCriteria,
      workItemId: created.id,
    });
    expect(accepted).toMatchObject({
      revision: 2,
      status: "completed",
    });
    expect(typeof accepted.completedAt).toBe("string");
    database.close();
  });

  it("records the normal project conversation that submitted a Team WorkItem", () => {
    const database = new AgentDatabase(":memory:");
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000071",
      isPinned: false,
      name: "Team source fixture",
      rootPath: "D:\\workspace\\team-source",
    };
    database.saveProject(project);
    const sourceConversation = database.createConversation(project.id);
    const selection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000072",
      reasoning: null,
    };

    const created = database.createTeamWorkItem({
      acceptanceCriteria: [],
      modelSelection: selection,
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: "从项目对话交给团队。",
      sourceConversationId: sourceConversation.id,
      teamId: "default-team",
      title: "对话来源任务",
    }, selection);

    expect(created).toMatchObject({
      executionScope: "project",
      sourceConversationId: sourceConversation.id,
    });
    const isolated = database.createTeamWorkItem({
      acceptanceCriteria: [],
      executionScope: "conversation",
      modelSelection: selection,
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: "仅复用当前对话的团队上下文。",
      sourceConversationId: sourceConversation.id,
      teamId: "default-team",
      title: "对话隔离任务",
    }, selection);
    expect(isolated.executionScope).toBe("conversation");
    const otherProject = {
      ...project,
      id: "00000000-0000-4000-8000-000000000073",
      name: "Other project",
      rootPath: "D:\\workspace\\team-source-other",
    };
    database.saveProject(otherProject);
    const otherConversation = database.createConversation(otherProject.id);
    expect(() => database.createTeamWorkItem({
      acceptanceCriteria: [],
      modelSelection: selection,
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: "不能跨项目伪造来源。",
      sourceConversationId: otherConversation.id,
      teamId: "default-team",
      title: "来源校验",
    }, selection)).toThrow("source conversation must belong");
    database.close();
  });

  it("keeps project-scoped Team executions separate across projects", () => {
    const database = new AgentDatabase(":memory:");
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const firstProject = {
      id: "00000000-0000-4000-8000-000000000074",
      isPinned: false,
      name: "First project",
      rootPath: "D:\\workspace\\team-scope-first",
    };
    const secondProject = {
      ...firstProject,
      id: "00000000-0000-4000-8000-000000000075",
      name: "Second project",
      rootPath: "D:\\workspace\\team-scope-second",
    };
    database.saveProject(firstProject);
    database.saveProject(secondProject);
    const firstLead = database.createConversation(firstProject.id, {
      teamId: "default-team",
      threadKind: "team_lead",
    });
    const secondLead = database.createConversation(secondProject.id, {
      teamId: "default-team",
      threadKind: "team_lead",
    });
    database.bindTeamExecutionConversation({
      conversationId: firstLead.id,
      projectId: firstProject.id,
      sourceConversationId: null,
      teamId: "default-team",
    });
    database.bindTeamExecutionConversation({
      conversationId: secondLead.id,
      projectId: secondProject.id,
      sourceConversationId: null,
      teamId: "default-team",
    });

    expect(database.getTeamExecutionConversation({
      projectId: firstProject.id,
      sourceConversationId: null,
      teamId: "default-team",
    })?.id).toBe(firstLead.id);
    expect(database.getTeamExecutionConversation({
      projectId: secondProject.id,
      sourceConversationId: null,
      teamId: "default-team",
    })?.id).toBe(secondLead.id);
    database.close();
  });

  it("allocates stable unique Team instance names inside a project", () => {
    const database = new AgentDatabase(":memory:");
    const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    directory.teams[1]!.name = directory.teams[0]!.name;
    database.syncTeamDirectory(directory);
    const project = {
      id: "00000000-0000-4000-8000-000000000076",
      isPinned: false,
      name: "Named Team fixture",
      rootPath: "D:\\workspace\\named-team",
    };
    database.saveProject(project);
    const source = database.createConversation(project.id);
    const selection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000077",
      reasoning: null,
    };
    const create = (teamId: string, instanceName?: string) => database.createTeamWorkItem({
      acceptanceCriteria: [],
      ...(instanceName === undefined ? {} : { instanceName }),
      permissionMode: "ask_before_changes" as const,
      priority: "normal" as const,
      projectId: project.id,
      requirement: "验证团队实例命名。",
      sourceConversationId: source.id,
      teamId,
      title: "团队实例命名",
    }, selection);

    const first = create(directory.teams[0]!.id);
    const duplicateTemplateName = create(directory.teams[1]!.id);
    const reused = create(directory.teams[0]!.id, "不应覆盖已有名称");

    expect(first.instanceName).toBe(directory.teams[0]!.name);
    expect(duplicateTemplateName.instanceName).toBe(`${directory.teams[0]!.name} (1)`);
    expect(reused.instanceName).toBe(first.instanceName);
    database.close();
  });

  it("keeps conversation Team instance names scoped to their source conversation", () => {
    const database = new AgentDatabase(":memory:");
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000078",
      isPinned: false,
      name: "Conversation Team fixture",
      rootPath: "D:\\workspace\\conversation-team",
    };
    database.saveProject(project);
    const firstSource = database.createConversation(project.id);
    const secondSource = database.createConversation(project.id);
    const selection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000079",
      reasoning: null,
    };
    const create = (sourceConversationId: string) => database.createTeamWorkItem({
      acceptanceCriteria: [],
      executionScope: "conversation",
      instanceName: "专项小组",
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: "验证对话团队隔离。",
      sourceConversationId,
      teamId: "default-team",
      title: "对话团队隔离",
    }, selection);

    expect(create(firstSource.id).instanceName).toBe("专项小组");
    expect(create(firstSource.id).instanceName).toBe("专项小组");
    expect(create(secondSource.id).instanceName).toBe("专项小组");
    database.close();
  });

  it("persists the custom order of visible Team instances", () => {
    const database = new AgentDatabase(":memory:");
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000080",
      isPinned: false,
      name: "Team order fixture",
      rootPath: "D:\\workspace\\team-order",
    };
    database.saveProject(project);
    const first = database.createTeamInstance({
      name: "全局团队",
      scope: "global",
      teamId: "default-team",
    });
    const second = database.createTeamInstance({
      name: "项目团队",
      projectId: project.id,
      scope: "project",
      teamId: "default-team",
    });

    expect(database.listTeamInstances().map((instance) => instance.id)).toEqual([
      first.id,
      second.id,
    ]);
    expect(database.reorderTeamInstances([second.id, first.id]).map((instance) => instance.id))
      .toEqual([second.id, first.id]);
    expect(() => database.reorderTeamInstances([first.id, first.id])).toThrow(
      "duplicate identifiers",
    );
    expect(() => database.reorderTeamInstances([first.id])).toThrow(
      "include every visible Team",
    );
    database.close();
  });

  it("keeps the latest bounded Team WorkItem event projection after repeated queued edits", () => {
    const database = new AgentDatabase(":memory:");
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000081",
      isPinned: false,
      name: "Team event cap fixture",
      rootPath: "D:\\workspace\\team-event-cap",
    };
    database.saveProject(project);
    const modelSelection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000082",
      reasoning: null,
    };
    const created = database.createTeamWorkItem({
      acceptanceCriteria: [],
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: "持续编辑的需求。",
      teamId: "default-team",
      title: "持续编辑",
    }, modelSelection);

    let updated = created;
    for (let index = 1; index <= 205; index += 1) {
      updated = database.updateTeamWorkItem({
        requirement: `第 ${index} 次修改的需求。`,
        title: `第 ${index} 次修改`,
        workItemId: created.id,
      });
    }

    expect(updated).toMatchObject({
      requirement: "第 205 次修改的需求。",
      title: "第 205 次修改",
    });
    expect(updated.events).toHaveLength(200);
    expect(updated.events[0]?.sequence).toBe(8);
    expect(updated.events.at(-1)).toMatchObject({ sequence: 207, type: "updated" });
    database.close();
  });

  it("does not recover a reserved Team WorkItem root or unbound Subagent Run while preserving a side chat Run", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-team-recovery-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000090",
      isPinned: false,
      name: "Interrupted Team fixture",
      rootPath: "D:\\workspace\\interrupted-team",
    };
    database.saveProject(project);
    const modelSelection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000091",
      reasoning: null,
    };
    const workItem = database.createTeamWorkItem({
      acceptanceCriteria: [],
      modelSelection,
      permissionMode: "full_access",
      priority: "normal",
      projectId: project.id,
      requirement: "验证重启后不会重放团队执行。",
      teamId: "default-team",
      title: "阻止重放团队执行",
    }, modelSelection);
    const root = database.createConversation(project.id, {
      modelSelection,
      teamId: "default-team",
      threadKind: "team_lead",
    });
    database.reserveTeamWorkItemExecution(workItem.id, root.id);
    database.createRunWithUserMessage(
      root.id,
      "开始受管执行",
      modelSelection.modelId,
    );
    const unboundSubagent = database.forkConversation(root.id, "subagent");
    database.createRunWithUserMessage(
      unboundSubagent.id,
      "尚未写入委派关系的 Subagent Run",
      modelSelection.modelId,
    );
    const sideChat = database.forkConversation(root.id, "side");
    const sideRun = database.createRunWithUserMessage(
      sideChat.id,
      "这是可恢复的普通侧边对话",
      modelSelection.modelId,
    );
    database.close();

    const reopened = new AgentDatabase(databasePath);
    expect(reopened.listQueuedRunRecoveries().map((recovery) => recovery.runId)).toEqual([
      sideRun.runId,
    ]);
    expect(reopened.blockInterruptedTeamWorkItems()).toBe(1);
    expect(reopened.getTeamWorkItem(workItem.id)).toMatchObject({
      activeRunId: null,
      status: "blocked",
    });
    expect(reopened.getConversation(root.id)).toMatchObject({
      activeRunId: null,
      lastRunStatus: "failed",
    });
    expect(reopened.getConversation(unboundSubagent.id)).toMatchObject({
      activeRunId: null,
      lastRunStatus: "failed",
    });
    expect(reopened.listQueuedRunRecoveries().map((recovery) => recovery.runId)).toEqual([
      sideRun.runId,
    ]);
    reopened.close();
  });

  it("keeps a WorkItem running until every delegated execution branch is terminal", () => {
    const database = new AgentDatabase(":memory:");
    const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    database.syncTeamDirectory(directory);
    const project = {
      id: "00000000-0000-4000-8000-000000000015",
      isPinned: false,
      name: "Delegation completion fixture",
      rootPath: "D:\\workspace\\delegation-completion",
    };
    database.saveProject(project);
    const modelSelection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000016",
      reasoning: null,
    };
    const lead = directory.agents.find((agent) => agent.id === "team-lead");
    if (lead === undefined) throw new Error("Team Lead fixture is unavailable.");
    const workItem = database.createTeamWorkItem({
      acceptanceCriteria: ["所有委派完成后再验收"],
      modelSelection,
      permissionMode: "full_access",
      priority: "normal",
      projectId: project.id,
      requirement: "验证后台委派完成条件。",
      teamId: "default-team",
      title: "等待所有委派完成",
    }, modelSelection);
    const root = database.createConversation(project.id, {
      agent: {
        id: lead.id,
        instructions: lead.instructions,
        isDefault: lead.isDefault,
        name: lead.name,
        role: lead.role,
      },
      modelSelection,
      teamId: "default-team",
      threadKind: "team_lead",
    });
    const rootRun = database.createRunWithUserMessage(root.id, "开始执行", modelSelection.modelId);
    database.startTeamWorkItem(workItem.id, root.id, rootRun.runId);
    const worker = database.forkConversation(root.id, "subagent");
    const workerRun = database.createRunWithUserMessage(worker.id, "执行实现", modelSelection.modelId);
    const workerTask = database.createSubagentTask({
      childConversationId: worker.id,
      parentConversationId: root.id,
      sourceRunId: rootRun.runId,
      task: "执行实现",
      title: "实现",
    });
    database.assignSubagentTaskRun(workerTask.id, workerRun.runId);
    const nestedWorker = database.forkConversation(worker.id, "subagent");
    const nestedRun = database.createRunWithUserMessage(
      nestedWorker.id,
      "独立复核",
      modelSelection.modelId,
    );
    const nestedTask = database.createSubagentTask({
      childConversationId: nestedWorker.id,
      parentConversationId: worker.id,
      sourceRunId: workerRun.runId,
      task: "独立复核",
      title: "复核",
    });
    database.assignSubagentTaskRun(nestedTask.id, nestedRun.runId);

    database.finishRun(rootRun.runId, "completed", null);
    expect(database.finishTeamWorkItemRun({
      conversationId: root.id,
      error: null,
      resultSummary: "Team Lead 的首轮说明",
      runId: rootRun.runId,
      status: "completed",
      workItemId: workItem.id,
    })).toMatchObject({ activeRunId: null, resultSummary: null, status: "running" });
    expect(database.countActiveSubagentTasksInExecutionTree(root.id)).toBe(2);

    database.finishRun(workerRun.runId, "completed", null);
    database.completeSubagentTaskByRun({
      error: null,
      result: "实现已完成",
      status: "completed",
      targetRunId: workerRun.runId,
    });
    expect(database.getConversation(root.id).activeSubagentCount).toBe(0);
    expect(database.countActiveSubagentTasksInExecutionTree(root.id)).toBe(1);

    const intermediateContinuation = database.createTeamWorkItemContinuationRun({
      conversationId: root.id,
      modelId: modelSelection.modelId,
      workItemId: workItem.id,
    });
    database.finishRun(intermediateContinuation.runId, "completed", null);
    expect(database.finishTeamWorkItemRun({
      conversationId: root.id,
      error: null,
      resultSummary: "等待复核",
      runId: intermediateContinuation.runId,
      status: "completed",
      workItemId: workItem.id,
    })).toMatchObject({ activeRunId: null, status: "running" });

    database.finishRun(nestedRun.runId, "completed", null);
    database.completeSubagentTaskByRun({
      error: null,
      result: "复核已完成",
      status: "completed",
      targetRunId: nestedRun.runId,
    });
    expect(database.countActiveSubagentTasksInExecutionTree(root.id)).toBe(0);

    const lateSender = database.createConversation(null);
    const lateResult = database.sendAgentMessage({
      content: "最后一条成员结果已经送达。",
      runId: crypto.randomUUID(),
      senderConversationId: lateSender.id,
      targetConversationId: root.id,
    });
    const unreadContinuation = database.createTeamWorkItemContinuationRun({
      conversationId: root.id,
      modelId: modelSelection.modelId,
      workItemId: workItem.id,
    });
    database.finishRun(unreadContinuation.runId, "completed", null);
    expect(database.finishTeamWorkItemRun({
      conversationId: root.id,
      error: null,
      resultSummary: "尚有未汇总结果",
      runId: unreadContinuation.runId,
      status: "completed",
      workItemId: workItem.id,
    })).toMatchObject({ activeRunId: null, status: "running" });
    database.markAgentMessagesRead([lateResult.id]);

    const finalContinuation = database.createTeamWorkItemContinuationRun({
      conversationId: root.id,
      modelId: modelSelection.modelId,
      workItemId: workItem.id,
    });
    database.finishRun(finalContinuation.runId, "completed", null);
    expect(database.finishTeamWorkItemRun({
      conversationId: root.id,
      error: null,
      resultSummary: "所有结果已汇总",
      runId: finalContinuation.runId,
      status: "completed",
      workItemId: workItem.id,
    })).toMatchObject({
      activeRunId: null,
      resultSummary: "所有结果已汇总",
      status: "waiting_user",
    });
    database.close();
  });

  it("projects a WorkItem execution conversation and recursive Subagents without side chats", () => {
    const database = new AgentDatabase(":memory:");
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000021",
      isPinned: false,
      name: "Execution lineage fixture",
      rootPath: "D:\\workspace\\execution-lineage",
    };
    const modelSelection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000022",
      reasoning: null,
    };
    database.saveProject(project);
    const workItem = database.createTeamWorkItem({
      acceptanceCriteria: [],
      modelSelection,
      permissionMode: "full_access",
      priority: "normal",
      projectId: project.id,
      requirement: "验证真实执行谱系。",
      teamId: "default-team",
      title: "验证执行谱系",
    }, modelSelection);

    expect(database.getTeamWorkItemExecution(workItem.id)).toEqual({
      agents: [],
      workItemId: workItem.id,
    });

    const execution = database.createConversation(project.id, {
      agent: {
        id: "team-lead",
        instructions: "负责总体执行。",
        isDefault: true,
        name: "Team Lead",
        role: "负责人",
      },
      modelSelection,
      teamId: "default-team",
      threadKind: "agent",
    });
    const executionRun = database.createRunWithUserMessage(
      execution.id,
      "开始执行",
      modelSelection.modelId,
    );
    database.startTeamWorkItem(workItem.id, execution.id, executionRun.runId);

    const direct = database.forkConversation(execution.id, "subagent");
    database.bindConversationAgent(direct.id, {
      id: "investigator",
      instructions: "检查实现。",
      isDefault: false,
      name: "调查 Agent",
      role: "调查",
    });
    const directRun = database.createRunWithUserMessage(direct.id, "调查问题", modelSelection.modelId);
    const directTask = database.createSubagentTask({
      childConversationId: direct.id,
      parentConversationId: execution.id,
      sourceRunId: executionRun.runId,
      task: "调查问题",
      title: "调查问题",
    });
    database.assignSubagentTaskRun(directTask.id, directRun.runId);

    const recursive = database.forkConversation(direct.id, "subagent");
    database.bindConversationAgent(recursive.id, {
      id: "reviewer",
      instructions: "复核调查结论。",
      isDefault: false,
      name: "复核 Agent",
      role: "复核",
    });
    const recursiveRun = database.createRunWithUserMessage(
      recursive.id,
      "复核调查结论",
      modelSelection.modelId,
    );
    const recursiveTask = database.createSubagentTask({
      childConversationId: recursive.id,
      parentConversationId: direct.id,
      sourceRunId: directRun.runId,
      task: "复核调查结论",
      title: "复核调查结论",
    });
    database.assignSubagentTaskRun(recursiveTask.id, recursiveRun.runId);

    const sideChat = database.forkConversation(execution.id, "side");
    const sideChatSubagent = database.forkConversation(sideChat.id, "subagent");
    const lineage = database.getTeamWorkItemExecution(workItem.id);

    expect(database.getConversation(execution.id).teamWorkItemId).toBe(workItem.id);
    expect(database.getConversation(direct.id).teamWorkItemId).toBe(workItem.id);
    expect(database.getConversation(recursive.id).teamWorkItemId).toBe(workItem.id);
    expect(database.getConversation(sideChat.id).teamWorkItemId).toBeNull();
    expect(database.getConversation(sideChatSubagent.id).teamWorkItemId).toBeNull();
    expect(database.isTeamWorkItemExecutionTreeConversation(execution.id)).toBe(true);
    expect(database.isTeamWorkItemExecutionTreeConversation(direct.id)).toBe(true);
    expect(database.isTeamWorkItemExecutionTreeConversation(sideChat.id)).toBe(false);
    expect(database.isTeamWorkItemExecutionTreeConversation(sideChatSubagent.id)).toBe(false);

    expect(lineage.agents.map((entry) => entry.conversation.id)).toEqual([
      execution.id,
      direct.id,
      recursive.id,
    ]);
    expect(lineage.agents).toMatchObject([
      {
        agent: { id: "team-lead", name: "Team Lead" },
        conversation: { activeRunId: executionRun.runId, id: execution.id },
        delegation: null,
        depth: 0,
      },
      {
        agent: { id: "investigator", name: "调查 Agent" },
        conversation: { activeRunId: directRun.runId, id: direct.id, subagentTaskStatus: "running" },
        delegation: { id: directTask.id, status: "running", title: "调查问题" },
        depth: 1,
      },
      {
        agent: { id: "reviewer", name: "复核 Agent" },
        conversation: { activeRunId: recursiveRun.runId, id: recursive.id, subagentTaskStatus: "running" },
        delegation: { id: recursiveTask.id, status: "running", title: "复核调查结论" },
        depth: 2,
      },
    ]);
    expect(lineage.agents.some((entry) => entry.conversation.id === sideChat.id)).toBe(false);

    database.finishRun(recursiveRun.runId, "completed", null);
    database.completeSubagentTaskByRun({
      error: null,
      result: "复核完成。",
      status: "completed",
      targetRunId: recursiveRun.runId,
    });
    expect(() => database.createConversationDeletionTask(recursive.id)).toThrow(
      "Managed Team WorkItem conversations are retained",
    );
    expect(database.getTeamWorkItemExecution(workItem.id).agents.map((entry) => entry.conversation.id))
      .toEqual([execution.id, direct.id, recursive.id]);

    const retainedRootWorkItem = database.createTeamWorkItem({
      acceptanceCriteria: [],
      modelSelection,
      permissionMode: "full_access",
      priority: "normal",
      projectId: project.id,
      requirement: "验证待删除根对话不会投影。",
      teamId: "default-team",
      title: "验证待删除执行根",
    }, modelSelection);
    const retainedRoot = database.createConversation(project.id, {
      agent: {
        id: "team-lead",
        instructions: "负责总体执行。",
        isDefault: true,
        name: "Team Lead",
        role: "负责人",
      },
      modelSelection,
      teamId: "default-team",
      threadKind: "agent",
    });
    const retainedRootRun = database.createRunWithUserMessage(
      retainedRoot.id,
      "开始执行",
      modelSelection.modelId,
    );
    database.startTeamWorkItem(retainedRootWorkItem.id, retainedRoot.id, retainedRootRun.runId);
    database.finishRun(retainedRootRun.runId, "completed", null);
    expect(() => database.setConversationArchived(retainedRoot.id, true)).toThrow(
      "Managed Team WorkItem conversations are retained",
    );
    expect(() => database.createConversationDeletionTask(retainedRoot.id)).toThrow(
      "Managed Team WorkItem conversations are retained",
    );
    expect(() => database.setConversationModelSelection(retainedRoot.id, modelSelection)).toThrow(
      "Managed Team WorkItem conversations use the WorkItem's frozen model selection",
    );
    expect(() => database.setConversationProject(retainedRoot.id, null)).toThrow(
      "Managed Team WorkItem conversations retain their WorkItem project binding",
    );
    expect(database.getTeamWorkItemExecution(retainedRootWorkItem.id).agents.map((entry) => entry.conversation.id))
      .toEqual([retainedRoot.id]);
    expect(database.getTeamWorkItem(retainedRootWorkItem.id)).toMatchObject({ tasks: [] });
    expect(database.listTeamWorkItems({ teamId: "default-team" }))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ id: retainedRootWorkItem.id, tasks: [] }),
      ]));
    database.close();
  });

  it("keeps Plugin discovery data queryable without resetting a user's enabled state", () => {
    const database = new AgentDatabase(":memory:");
    const record = {
      contentHash: "a".repeat(64),
      id: "example.plugin",
      manifestJson: '{"version":1,"id":"example.plugin"}',
      name: "Example Plugin",
      rootPath: "C:\\Users\\example\\.agent\\plugins\\example",
      version: "1.0.0",
    };

    database.syncPluginCatalog([record]);
    expect(database.listPluginCatalog()).toEqual([
      expect.objectContaining({ ...record, enabled: true }),
    ]);

    database.setPluginEnabled(record.id, false);
    database.syncPluginCatalog([{ ...record, contentHash: "b".repeat(64) }]);
    expect(database.listPluginCatalog()).toEqual([
      expect.objectContaining({
        ...record,
        contentHash: "b".repeat(64),
        enabled: false,
      }),
    ]);
    database.syncPluginCatalog([]);
    expect(database.listPluginCatalog()).toEqual([]);
    database.close();
  });

  it("renames and removes registered projects without touching their root path", () => {
    const database = new AgentDatabase(":memory:");
    const project = {
      id: "00000000-0000-4000-8000-000000000001",
      isPinned: false,
      name: "原项目名",
      rootPath: "D:\\workspace\\project",
    };
    database.saveProject(project);
    const conversation = database.createConversation(project.id);

    database.saveProject({ ...project, name: "新项目名" });
    expect(database.listProjects()).toEqual([{ ...project, name: "新项目名" }]);
    database.deleteProject(project.id);
    expect(database.listProjects()).toEqual([]);
    expect(() => database.getConversation(conversation.id)).toThrow("not found");
    database.close();
  });

  it("persists project pin state and orders pinned projects first", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const firstDatabase = new AgentDatabase(databasePath);
    const firstProject = {
      id: "00000000-0000-4000-8000-000000000001",
      isPinned: false,
      name: "普通项目",
      rootPath: "D:\\workspace\\regular-project",
    };
    const pinnedProject = {
      id: "00000000-0000-4000-8000-000000000002",
      isPinned: true,
      name: "置顶项目",
      rootPath: "D:\\workspace\\pinned-project",
    };

    firstDatabase.saveProject(firstProject);
    firstDatabase.saveProject(pinnedProject);
    expect(firstDatabase.listProjects()).toEqual([pinnedProject, firstProject]);
    firstDatabase.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(reopenedDatabase.listProjects()).toEqual([pinnedProject, firstProject]);
    reopenedDatabase.close();
  });

  it("persists the opt-in project team navigator visibility", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const project = {
      id: "00000000-0000-4000-8000-000000000001",
      isPinned: false,
      name: "团队导航项目",
      rootPath: "D:\\workspace\\team-navigation",
      showTeamsInNavigator: true,
    };
    const firstDatabase = new AgentDatabase(databasePath);
    firstDatabase.saveProject(project);
    expect(firstDatabase.listProjects()).toEqual([project]);
    firstDatabase.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(reopenedDatabase.listProjects()).toEqual([project]);
    reopenedDatabase.close();
  });

  it("persists manual project order inside a pin group", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const projects = [1, 2, 3].map((index) => ({
      id: `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
      isPinned: false,
      name: `项目 ${index}`,
      rootPath: `D:\\workspace\\project-${index}`,
    }));
    projects.forEach((project) => database.saveProject(project));

    database.reorderProjects([projects[2]!.id, projects[0]!.id, projects[1]!.id]);
    expect(database.listProjects().map((project) => project.id)).toEqual([
      projects[2]!.id,
      projects[0]!.id,
      projects[1]!.id,
    ]);
    database.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(reopenedDatabase.listProjects().map((project) => project.id)).toEqual([
      projects[2]!.id,
      projects[0]!.id,
      projects[1]!.id,
    ]);
    reopenedDatabase.close();
  });

  it("migrates existing project-bound databases for temporary conversations", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec(`
      CREATE TABLE projects (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );
      CREATE TABLE conversations (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
    legacyDatabase.close();

    const database = new AgentDatabase(databasePath);
    const conversation = database.createConversation(null);

    expect(conversation.projectId).toBeNull();
    expect(database.listConversations()).toEqual([conversation]);
    database.close();

    const metadata = new DatabaseSync(databasePath);
    expect(metadata.prepare("SELECT version FROM schema_migrations ORDER BY version").all()).toEqual([
      { version: 1 },
      { version: 2 },
      { version: 3 },
      { version: 4 },
      { version: 5 },
      { version: 6 },
      { version: 7 },
      { version: 8 },
      { version: 9 },
      { version: 10 },
      { version: 11 },
      { version: 12 },
      { version: 13 },
      { version: 14 },
      { version: 15 },
      { version: 16 },
    ]);
    metadata.close();
  });

  it("reports the latest run status and only exposes active run identifiers", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);

    expect(conversation).toMatchObject({
      activeRunId: null,
      hasUnreadResult: false,
      lastRunStatus: null
    });

    const creation = database.createRunWithUserMessage(
      conversation.id,
      "检查状态",
      "test-model"
    );
    expect(database.getConversation(conversation.id)).toMatchObject({
      activeRunId: creation.runId,
      lastRunStatus: "queued"
    });

    database.markRunRunning(creation.runId);
    expect(database.getConversation(conversation.id)).toMatchObject({
      activeRunId: creation.runId,
      lastRunStatus: "running"
    });

    database.finishRun(creation.runId, "completed", null);
    expect(database.getConversation(conversation.id)).toMatchObject({
      activeRunId: null,
      hasUnreadResult: true,
      lastRunStatus: "completed"
    });

    expect(database.markConversationResultViewed(conversation.id)).toMatchObject({
      hasUnreadResult: false,
      lastRunStatus: "completed"
    });

    const failedRun = database.createRunWithUserMessage(
      conversation.id,
      "再次检查状态",
      "test-model"
    );
    expect(database.getConversation(conversation.id)).toMatchObject({
      activeRunId: failedRun.runId,
      hasUnreadResult: false,
      lastRunStatus: "queued"
    });
    database.finishRun(failedRun.runId, "failed", "测试失败");
    expect(database.getConversation(conversation.id)).toMatchObject({
      activeRunId: null,
      hasUnreadResult: true,
      lastRunStatus: "failed"
    });
    expect(database.markConversationResultViewed(conversation.id).hasUnreadResult).toBe(false);
    database.close();
  });

  it("rejects duplicate terminal transitions and terminal state rollback", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const creation = database.createRunWithUserMessage(
      conversation.id,
      "检查状态转换",
      "test-model",
    );

    database.markRunRunning(creation.runId);
    database.finishRun(creation.runId, "completed", null);

    expect(() => database.finishRun(creation.runId, "completed", null))
      .toThrow("Run state transition is not allowed");
    expect(() => database.markRunRunning(creation.runId))
      .toThrow("Run state transition is not allowed");
    expect(() => database.finishRun(crypto.randomUUID(), "completed", null))
      .toThrow("Run was not found.");
    expect(database.getConversation(conversation.id)).toMatchObject({
      activeRunId: null,
      lastRunStatus: "completed",
    });
    database.close();
  });

  it("persists a conversation model selection and copies it into forks", () => {
    const database = new AgentDatabase(":memory:");
    const providerId = crypto.randomUUID();
    const parent = database.createConversation(null, {
      modelSelection: {
        modelId: "selected-model",
        providerId,
        reasoning: { kind: "effort", value: "high" },
      },
    });

    expect(database.getConversation(parent.id).modelSelection).toEqual({
      modelId: "selected-model",
      providerId,
      reasoning: { kind: "effort", value: "high" },
    });
    expect(database.forkConversation(parent.id, "side").modelSelection)
      .toEqual(parent.modelSelection);

    expect(database.setConversationModelSelection(parent.id, {
      modelId: "next-model",
      providerId,
      reasoning: null,
    }).modelSelection).toEqual({
      modelId: "next-model",
      providerId,
      reasoning: null,
    });
    database.close();
  });

  it("commits a final Assistant message, Run state, and Subagent result together", () => {
    const database = new AgentDatabase(":memory:");
    const parent = database.createConversation(null);
    const parentRun = database.createRunWithUserMessage(parent.id, "委派任务", "test-model");
    const child = database.forkConversation(parent.id);
    const childRun = database.createRunWithUserMessage(child.id, "检查实现", "test-model");
    const task = database.createSubagentTask({
      childConversationId: child.id,
      parentConversationId: parent.id,
      sourceRunId: parentRun.runId,
      task: "检查实现",
      title: "检查实现",
    });
    database.assignSubagentTaskRun(task.id, childRun.runId);
    database.markRunRunning(childRun.runId);

    const completed = database.completeRun({
      assistant: {
        content: "检查完成，未发现阻塞问题。",
        kind: "turn",
        messageId: crypto.randomUUID(),
        modelId: "test-model",
      },
      conversationId: child.id,
      error: null,
      result: "检查完成，未发现阻塞问题。",
      runId: childRun.runId,
      status: "completed",
    });

    expect(completed.assistantMessage).toMatchObject({
      content: "检查完成，未发现阻塞问题。",
      runId: childRun.runId,
      status: "completed",
    });
    expect(completed.subagentTask).toMatchObject({
      id: task.id,
      result: "检查完成，未发现阻塞问题。",
      status: "completed",
    });
    expect(completed.subagentResultMessage).toMatchObject({
      conversationId: parent.id,
      messageType: "task_result",
      senderConversationId: child.id,
      taskId: task.id,
    });
    expect(database.getConversation(child.id)).toMatchObject({
      activeRunId: null,
      hasUnreadResult: true,
      lastRunStatus: "completed",
      subagentTaskStatus: "completed",
    });
    expect(database.getSubagentTask(task.id)).toMatchObject({
      resultMessageId: completed.subagentResultMessage?.id,
      status: "completed",
    });
    expect(database.listUnreadAgentMessages(parent.id)).toEqual([
      completed.subagentResultMessage,
    ]);
    database.close();
  });

  it("persists only catalog-backed Conversation avatar icons", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-avatar-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const conversation = database.createConversation(null);

    expect(database.setConversationAvatarIcon(conversation.id, "bug").avatarIcon).toBe("bug");
    expect(() => database.setConversationAvatarIcon(conversation.id, "<svg />")).toThrow();
    database.close();

    const reopened = new AgentDatabase(databasePath);
    expect(reopened.getConversation(conversation.id).avatarIcon).toBe("bug");
    reopened.close();
  });

  it("derives an Assistant reply completion time and total Run duration for the timeline", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-27T08:00:00.000Z"));
      const database = new AgentDatabase(":memory:");
      const conversation = database.createConversation(null);
      const run = database.createRunWithUserMessage(conversation.id, "检查耗时", "test-model");
      database.markRunRunning(run.runId);

      vi.setSystemTime(new Date("2026-08-27T08:01:17.000Z"));
      database.completeRun({
        assistant: {
          content: "回答完成。",
          kind: "turn",
          messageId: crypto.randomUUID(),
          modelId: "test-model",
        },
        conversationId: conversation.id,
        error: null,
        result: "回答完成。",
        runId: run.runId,
        status: "completed",
      });

      const assistant = database.listTimeline(conversation.id).find((item) =>
        item.kind === "message" && item.role === "assistant",
      );
      expect(assistant).toMatchObject({
        completedAt: "2026-08-27T08:01:17.000Z",
        durationMs: 77_000,
      });
      database.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it("rolls back every final Run write when one terminal write fails", async () => {
    const triggerTables = [
      "model_messages",
      "conversation_timeline",
      "runs",
      "subagent_tasks",
      "conversation_agent_messages",
    ] as const;

    for (const table of triggerTables) {
      const directory = await mkdtemp(path.join(os.tmpdir(), "agent-run-transaction-"));
      temporaryDirectories.push(directory);
      const databasePath = path.join(directory, "agent.sqlite");
      const database = new AgentDatabase(databasePath);
      try {
        const parent = database.createConversation(null);
        const parentRun = database.createRunWithUserMessage(
          parent.id,
          "委派任务",
          "test-model",
        );
        const child = database.forkConversation(parent.id);
        const childRun = database.createRunWithUserMessage(child.id, "检查实现", "test-model");
        const task = database.createSubagentTask({
          childConversationId: child.id,
          parentConversationId: parent.id,
          sourceRunId: parentRun.runId,
          task: "检查实现",
          title: "检查实现",
        });
        database.assignSubagentTaskRun(task.id, childRun.runId);
        database.markRunRunning(childRun.runId);
        const childModelMessageCount = database.listModelMessages(child.id).length;
        const childTimelineCount = database.listTimeline(child.id).length;

        const injection = new DatabaseSync(databasePath);
        injection.exec(
          `CREATE TRIGGER fail_final_run_${table}
           BEFORE ${table === "runs" || table === "subagent_tasks" ? "UPDATE" : "INSERT"}
           ON ${table}
           BEGIN
             SELECT RAISE(ABORT, 'injected final run failure');
           END;`,
        );
        injection.close();

        expect(() => database.completeRun({
          assistant: {
            content: "检查完成。",
            kind: "turn",
            messageId: crypto.randomUUID(),
            modelId: "test-model",
          },
          conversationId: child.id,
          error: null,
          result: "检查完成。",
          runId: childRun.runId,
          status: "completed",
        })).toThrow("injected final run failure");

        expect(database.getConversation(child.id)).toMatchObject({
          activeRunId: childRun.runId,
          hasUnreadResult: false,
          lastRunStatus: "running",
        });
        expect(database.listModelMessages(child.id)).toHaveLength(childModelMessageCount);
        expect(database.listTimeline(child.id)).toHaveLength(childTimelineCount);
        expect(database.getSubagentTask(task.id)).toMatchObject({
          result: null,
          resultMessageId: null,
          status: "running",
        });
        expect(database.listUnreadAgentMessages(parent.id)).toEqual([]);
        expect(database.getConversation(parent.id).hasUnreadResult).toBe(false);
      } finally {
        database.close();
      }
    }
  });

  it("preserves an atomically completed Run across restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-run-recovery-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const firstDatabase = new AgentDatabase(databasePath);
    const conversation = firstDatabase.createConversation(null);
    const run = firstDatabase.createRunWithUserMessage(
      conversation.id,
      "完成后重启",
      "test-model",
    );
    firstDatabase.markRunRunning(run.runId);
    firstDatabase.completeRun({
      assistant: {
        content: "这条最终回答只能保存一次。",
        kind: "turn",
        messageId: crypto.randomUUID(),
        modelId: "test-model",
      },
      conversationId: conversation.id,
      error: null,
      result: "这条最终回答只能保存一次。",
      runId: run.runId,
      status: "completed",
    });
    firstDatabase.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(reopenedDatabase.getConversation(conversation.id)).toMatchObject({
      activeRunId: null,
      hasUnreadResult: true,
      lastRunStatus: "completed",
    });
    expect(reopenedDatabase.listTimeline(conversation.id).filter((item) =>
      item.kind === "message" && item.role === "assistant",
    )).toHaveLength(1);
    expect(reopenedDatabase.listModelMessages(conversation.id).filter((message) =>
      message.content === "这条最终回答只能保存一次。",
    )).toHaveLength(1);
    reopenedDatabase.close();
  });

  it("replaces only the latest user message and removes its old answer", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const first = database.createRunWithUserMessage(
      conversation.id,
      "保留的上一轮",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "保留的上一轮回答",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: first.runId,
      toolCalls: [],
    });
    database.finishRun(first.runId, "completed", null);
    const second = database.createRunWithUserMessage(
      conversation.id,
      "需要修改的任务",
      "test-model",
      [],
      "需要修改的任务\n\n[保留的隐藏引用]",
    );
    database.appendAssistantTurn({
      content: "应被覆盖的旧回答",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: second.runId,
      toolCalls: [],
    });
    database.finishRun(second.runId, "completed", null);
    const lastSequence = database.listContextMessages(conversation.id).at(-1)?.sequence;
    if (lastSequence === undefined) throw new Error("Expected stored context messages.");
    database.saveContextCheckpoint(conversation.id, lastSequence, "包含旧回答的摘要");

    const creation = database.replaceLatestUserMessage({
      content: "修改后的任务",
      conversationId: conversation.id,
      messageId: second.userMessage.id,
      modelContent: "修改后的任务\n\n[保留的隐藏引用]",
      modelId: "replacement-model",
    });

    expect(creation.runId).not.toBe(second.runId);
    expect(creation.userMessage).toMatchObject({
      content: "修改后的任务",
      id: second.userMessage.id,
      runId: creation.runId,
    });
    expect(database.listTimeline(conversation.id).map((item) =>
      item.kind === "message" ? item.content : item.kind
    )).toEqual([
      "保留的上一轮",
      "保留的上一轮回答",
      "修改后的任务",
    ]);
    expect(database.listModelMessages(conversation.id).map((message) => message.content)).toEqual([
      "保留的上一轮",
      "保留的上一轮回答",
      "修改后的任务\n\n[保留的隐藏引用]",
    ]);
    expect(database.getContextCheckpoint(conversation.id)).toBeNull();
    expect(database.getConversation(conversation.id)).toMatchObject({
      activeRunId: creation.runId,
      hasUnreadResult: false,
      lastRunStatus: "queued",
    });
    database.finishRun(creation.runId, "cancelled", null);
    expect(() => database.replaceLatestUserMessage({
      content: "不允许改旧消息",
      conversationId: conversation.id,
      messageId: first.userMessage.id,
      modelContent: "不允许改旧消息",
      modelId: "test-model",
    })).toThrow("latest sent user message");
    database.close();
  });

  it("persists a workspace for a temporary conversation and copies it to forks", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const workspaceRootPath = "D:\\workspace\\temporary";

    const updated = database.setConversationWorkspaceRoot(
      conversation.id,
      workspaceRootPath
    );
    const fork = database.forkConversation(conversation.id);

    expect(updated.workspaceRootPath).toBe(workspaceRootPath);
    expect(fork.workspaceRootPath).toBe(workspaceRootPath);
    expect(database.listConversationWorkspaces()).toEqual([
      { conversationId: conversation.id, rootPath: workspaceRootPath },
      { conversationId: fork.id, rootPath: workspaceRootPath }
    ]);
    expect(database.setConversationWorkspaceRoot(conversation.id, null).workspaceRootPath)
      .toBeNull();
    database.close();
  });

  it("moves a new conversation between a project and the temporary group", () => {
    const database = new AgentDatabase(":memory:");
    const project = {
      id: "00000000-0000-4000-8000-000000000001",
      isPinned: false,
      name: "目标项目",
      rootPath: "D:\\workspace\\target",
    };
    database.saveProject(project);
    const conversation = database.createConversation(null);
    database.setConversationWorkspaceRoot(conversation.id, "D:\\workspace\\temporary");

    expect(database.setConversationProject(conversation.id, project.id)).toMatchObject({
      projectId: project.id,
      workspaceRootPath: null,
    });
    expect(database.setConversationProject(conversation.id, null)).toMatchObject({
      projectId: null,
      workspaceRootPath: null,
    });
    expect(() => database.setConversationProject(
      conversation.id,
      "00000000-0000-4000-8000-000000000099",
    )).toThrow("not found");
    database.close();
  });

  it("restores a temporary conversation workspace after reopening the database", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const firstDatabase = new AgentDatabase(databasePath);
    const conversation = firstDatabase.createConversation(null);
    firstDatabase.setConversationWorkspaceRoot(conversation.id, directory);
    firstDatabase.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(reopenedDatabase.getConversation(conversation.id).workspaceRootPath).toBe(directory);
    expect(reopenedDatabase.listConversationWorkspaces()).toEqual([
      { conversationId: conversation.id, rootPath: directory }
    ]);
    reopenedDatabase.close();
  });

  it("persists unread results across database reopen", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");

    const firstDatabase = new AgentDatabase(databasePath);
    const conversation = firstDatabase.createConversation(null);
    const run = firstDatabase.createRunWithUserMessage(
      conversation.id,
      "持久化状态",
      "test-model",
    );
    firstDatabase.finishRun(run.runId, "completed", null);
    firstDatabase.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(reopenedDatabase.getConversation(conversation.id).hasUnreadResult).toBe(true);
    expect(reopenedDatabase.markConversationResultViewed(conversation.id).hasUnreadResult).toBe(
      false,
    );
    reopenedDatabase.close();
  });

  it("persists a monotonic context checkpoint without deleting source messages", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const firstDatabase = new AgentDatabase(databasePath);
    const conversation = firstDatabase.createConversation(null);
    const run = firstDatabase.createRunWithUserMessage(
      conversation.id,
      "需要长期保留的原始消息",
      "test-model"
    );
    firstDatabase.appendAssistantTurn({
      content: "原始回复也必须保留",
      conversationId: conversation.id,
      messageId: "00000000-0000-4000-8000-000000000099",
      modelId: "test-model",
      runId: run.runId,
      toolCalls: []
    });
    const contextMessages = firstDatabase.listContextMessages(conversation.id);
    const coveredThroughSequence = contextMessages.at(-1)?.sequence;
    if (coveredThroughSequence === undefined) throw new Error("Expected a context message.");

    const checkpoint = firstDatabase.saveContextCheckpoint(
      conversation.id,
      coveredThroughSequence,
      JSON.stringify({ goals: ["继续实现上下文管理"] })
    );
    expect(checkpoint.coveredThroughSequence).toBe(coveredThroughSequence);
    expect(firstDatabase.listModelMessages(conversation.id)).toHaveLength(2);
    expect(() => firstDatabase.saveContextCheckpoint(
      conversation.id,
      coveredThroughSequence - 1,
      "invalid regression"
    )).toThrow();
    firstDatabase.finishRun(run.runId, "completed", null);
    firstDatabase.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(reopenedDatabase.getContextCheckpoint(conversation.id)).toMatchObject({
      conversationId: conversation.id,
      coveredThroughSequence,
      summary: JSON.stringify({ goals: ["继续实现上下文管理"] })
    });
    expect(reopenedDatabase.listModelMessages(conversation.id).map((message) => message.content))
      .toEqual(["需要长期保留的原始消息", "原始回复也必须保留"]);
    const deletionTask = reopenedDatabase.createConversationDeletionTask(conversation.id);
    reopenedDatabase.completeConversationDeletionTask(deletionTask.id);
    expect(reopenedDatabase.getContextCheckpoint(conversation.id)).toBeNull();
    reopenedDatabase.close();
  });

  it("persists model provider state across reopen and conversation forks", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const providerState = {
      apiFormat: "anthropic-messages" as const,
      baseUrl: "https://api.anthropic.com",
      modelId: "claude-sonnet-4-5",
      payload: [
        { signature: "signed-thinking", thinking: "summary", type: "thinking" },
        { id: "toolu_1", input: { path: "package.json" }, name: "read_file", type: "tool_use" },
      ],
    };
    const firstDatabase = new AgentDatabase(databasePath);
    const conversation = firstDatabase.createConversation(null);
    const run = firstDatabase.createRunWithUserMessage(
      conversation.id,
      "检查项目配置",
      providerState.modelId
    );
    firstDatabase.appendAssistantTurn({
      content: "",
      conversationId: conversation.id,
      messageId: "00000000-0000-4000-8000-000000000098",
      modelId: providerState.modelId,
      providerState,
      runId: run.runId,
      toolCalls: [{ arguments: '{"path":"package.json"}', id: "toolu_1", name: "read_file" }]
    });
    firstDatabase.finishRun(run.runId, "completed", null);
    firstDatabase.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(reopenedDatabase.listModelMessages(conversation.id)[1]?.providerState)
      .toEqual(providerState);
    const fork = reopenedDatabase.forkConversation(conversation.id);
    expect(reopenedDatabase.listModelMessages(fork.id)[1]?.providerState).toEqual(providerState);
    reopenedDatabase.close();
  });

  it("persists pin order and moves repinned conversations behind existing pins", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const firstDatabase = new AgentDatabase(databasePath);
    const firstConversation = firstDatabase.createConversation(null);
    const secondConversation = firstDatabase.createConversation(null);
    const archivedConversation = firstDatabase.createConversation(null);

    expect(firstDatabase.setConversationPinned(secondConversation.id, true)).toMatchObject({
      isPinned: true,
    });
    expect(firstDatabase.setConversationPinned(firstConversation.id, true)).toMatchObject({
      isPinned: true,
    });
    const archived = firstDatabase.setConversationArchived(archivedConversation.id, true);
    expect(archived).toMatchObject({
      isArchived: true,
    });
    expect(archived.archivedAt).not.toBeNull();
    expect(
      firstDatabase.setConversationArchived(archivedConversation.id, false).archivedAt,
    ).toBeNull();
    firstDatabase.setConversationArchived(archivedConversation.id, true);
    expect(firstDatabase.listConversations().map((conversation) => conversation.id)).toEqual([
      secondConversation.id,
      firstConversation.id,
      archivedConversation.id,
    ]);

    firstDatabase.setConversationPinned(secondConversation.id, false);
    firstDatabase.setConversationPinned(secondConversation.id, true);
    expect(firstDatabase.listConversations().map((conversation) => conversation.id)).toEqual([
      firstConversation.id,
      secondConversation.id,
      archivedConversation.id,
    ]);
    firstDatabase.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    const reopenedConversations = reopenedDatabase.listConversations();
    expect(reopenedConversations.map((conversation) => conversation.id)).toEqual([
      firstConversation.id,
      secondConversation.id,
      archivedConversation.id,
    ]);
    expect(reopenedConversations[0]?.pinOrder).toBeLessThan(
      reopenedConversations[1]?.pinOrder ?? 0,
    );
    expect(reopenedDatabase.getConversation(archivedConversation.id)).toMatchObject({
      isArchived: true,
      isPinned: false,
      pinOrder: null,
    });
    reopenedDatabase.close();
  });

  it("selects only expired archive roots for recoverable deletion", async () => {
    const database = new AgentDatabase(":memory:");
    const expired = database.createConversation(null);
    const expiredFork = database.forkConversation(expired.id);
    database.setConversationArchived(expired.id, true);
    const cutoff = new Date(Date.now() + 5).toISOString();

    await new Promise((resolve) => setTimeout(resolve, 10));
    const retained = database.createConversation(null);
    database.setConversationArchived(retained.id, true);
    const visible = database.createConversation(null);

    expect(database.listExpiredArchivedConversationRootIds(cutoff)).toEqual([expired.id]);
    const deletionTask = database.createConversationDeletionTask(expired.id);
    expect(deletionTask.conversationIds).toEqual([expired.id, expiredFork.id]);
    database.completeConversationDeletionTask(deletionTask.id);
    expect(() => database.getConversation(expired.id)).toThrow("not found");
    expect(() => database.getConversation(expiredFork.id)).toThrow("not found");
    expect(database.getConversation(retained.id).isArchived).toBe(true);
    expect(database.getConversation(visible.id).isArchived).toBe(false);
    database.close();
  });

  it("adds an archive timestamp when migrating archived conversations", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const conversation = database.createConversation(null);
    database.setConversationArchived(conversation.id, true);
    database.close();

    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec("ALTER TABLE conversations DROP COLUMN archived_at");
    legacyDatabase.exec("DELETE FROM schema_migrations");
    legacyDatabase.close();

    const migratedDatabase = new AgentDatabase(databasePath);
    const migratedConversation = migratedDatabase.getConversation(conversation.id);
    expect(migratedConversation.isArchived).toBe(true);
    expect(migratedConversation.archivedAt).not.toBeNull();
    migratedDatabase.close();
  });

  it("migrates an existing database to recoverable conversation deletion", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const conversation = database.createConversation(null);
    database.close();

    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.exec("DROP TABLE conversation_deletion_tasks");
    legacyDatabase.exec("ALTER TABLE conversations DROP COLUMN deletion_pending");
    legacyDatabase.exec("DELETE FROM schema_migrations");
    legacyDatabase.close();

    const migratedDatabase = new AgentDatabase(databasePath);
    const task = migratedDatabase.createConversationDeletionTask(conversation.id);
    expect(task).toMatchObject({
      conversationIds: [conversation.id],
      retryCount: 0,
      status: "pending",
    });
    expect(migratedDatabase.listConversations()).toEqual([]);
    migratedDatabase.completeConversationDeletionTask(task.id);
    expect(migratedDatabase.listIncompleteConversationDeletionTasks()).toEqual([]);
    migratedDatabase.close();
  });

  it("persists manual conversation order and rejects cross-group moves", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const first = database.createConversation(null);
    const second = database.createConversation(null);
    const third = database.createConversation(null);

    database.reorderConversations([second.id, first.id, third.id]);
    expect(database.listConversations().map((conversation) => conversation.id)).toEqual([
      second.id,
      first.id,
      third.id,
    ]);
    database.setConversationPinned(third.id, true);
    expect(() => database.reorderConversations([second.id, third.id, first.id])).toThrow(
      "one visible group",
    );
    database.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(
      reopenedDatabase.listConversations()
        .filter((conversation) => !conversation.isPinned)
        .map((conversation) => conversation.id),
    ).toEqual([second.id, first.id]);
    reopenedDatabase.close();
  });

  it("does not archive a conversation while it is running", () => {
    const database = new AgentDatabase(":memory:");
    const project = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "运行中项目",
      rootPath: "D:\\workspace\\running-project",
    };
    database.saveProject(project);
    const conversation = database.createConversation(project.id);
    database.createRunWithUserMessage(conversation.id, "保持运行", "test-model");

    expect(() => database.setConversationArchived(conversation.id, true)).toThrow(
      "running conversation",
    );
    expect(() => database.createConversationDeletionTask(conversation.id)).toThrow(
      "running conversation",
    );
    expect(() => database.deleteProject(project.id)).toThrow(
      "running conversations",
    );
    database.close();
  });

  it("keeps a queued user Run recoverable across restart but does not resume an in-flight Run", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-queued-recovery-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const first = new AgentDatabase(databasePath);
    const conversation = first.createConversation(null);
    const executionSnapshot: RunExecutionSnapshot = {
      apiFormat: "openai-chat-completions",
      baseUrl: "https://example.test/v1",
      contextCompressionConfiguration: {
        mode: "percentage",
        percentageThreshold: 80,
        tokenThreshold: 100_000,
      },
      contextWindow: null,
      modelId: "test-model",
      permissionMode: "ask_before_changes",
      plugins: [{
        contentHash: "a".repeat(64),
        id: "example.plugin",
        version: "1.0.0",
      }],
      providerId: null,
      reasoning: null,
      reasoningOptions: [],
      toolManifest: [{
        contentHash: "b".repeat(64),
        name: "read_file",
      }],
    };
    const queued = first.createRunWithUserMessage(
      conversation.id,
      "重启后继续",
      "test-model",
      [],
      undefined,
      executionSnapshot,
    );
    first.close();

    const reopened = new AgentDatabase(databasePath);
    expect(reopened.listQueuedRunRecoveries()).toEqual([{
      attachmentIds: [],
      content: "重启后继续",
      conversationId: conversation.id,
      executionSnapshot,
      modelId: "test-model",
      runId: queued.runId,
    }]);
    expect(reopened.getConversation(conversation.id).lastRunStatus).toBe("queued");
    reopened.markRunRunning(queued.runId);
    reopened.close();

    const afterInFlight = new AgentDatabase(databasePath);
    expect(afterInFlight.listQueuedRunRecoveries()).toEqual([]);
    expect(afterInFlight.getConversation(conversation.id).lastRunStatus).toBe("failed");
    afterInFlight.close();
  });

  it("persists a task list through creation and removes it when closed", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const firstDatabase = new AgentDatabase(databasePath);
    const conversation = firstDatabase.createConversation(null);

    const taskList = firstDatabase.createTaskList(conversation.id, [
      { status: "completed", title: "分析需求" },
      { reason: "等待用户批准修改", status: "blocked", title: "实现功能" },
      { status: "pending", title: "验证结果" }
    ]);
    expect(taskList.status).toBe("active");
    expect(typeof taskList.createdAt).toBe("string");
    expect(taskList.tasks.map((task) => task.status)).toEqual([
      "completed",
      "blocked",
      "pending"
    ]);
    expect(() => firstDatabase.createTaskList(conversation.id, [
      { status: "pending", title: "重复创建" },
      { status: "pending", title: "重复创建后的步骤" }
    ])).toThrow("active task list already exists");
    expect(() => firstDatabase.updateTaskList(conversation.id, [
      { status: "running", title: "步骤一" },
      { status: "running", title: "步骤二" }
    ])).toThrow("only have one running task");
    firstDatabase.close();

    const reopenedDatabase = new AgentDatabase(databasePath);
    expect(reopenedDatabase.getTaskList(conversation.id)?.tasks).toMatchObject([
      { status: "completed", title: "分析需求" },
      { reason: "等待用户批准修改", status: "blocked", title: "实现功能" },
      { status: "pending", title: "验证结果" }
    ]);
    expect(reopenedDatabase.getTaskList(conversation.id)?.tasks.map((task) => task.status))
      .toEqual(["completed", "blocked", "pending"]);
    reopenedDatabase.closeTaskList(conversation.id);
    expect(reopenedDatabase.getTaskList(conversation.id)).toBeNull();
    reopenedDatabase.close();
  });

  it("persists Team Lead, Agent, and Subagent identities with isolated checkpoints", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const leadAgent = {
      id: "team-lead",
      instructions: "保持主任务所有权并汇总结果。",
      isDefault: false,
      name: "Team Lead",
      role: "接单与调度",
    };
    const workerAgent = {
      id: "explorer",
      instructions: "只读调查并返回证据。",
      isDefault: false,
      name: "Explorer",
      role: "事实调查",
    };
    const lead = database.createConversation(null, {
      agent: leadAgent,
      teamId: "default-team",
      threadKind: "team_lead",
    });
    const worker = database.createConversation(null, {
      agent: workerAgent,
      teamId: "default-team",
      threadKind: "agent",
    });
    const leadRun = database.createRunWithUserMessage(lead.id, "主任务", "test-model");
    database.finishRun(leadRun.runId, "completed", null);
    const subagent = database.forkConversation(lead.id);
    database.bindConversationAgent(subagent.id, workerAgent);
    const subagentRun = database.createRunWithUserMessage(
      subagent.id,
      "调查支线",
      "test-model",
    );
    database.createSubagentTask({
      childConversationId: subagent.id,
      parentConversationId: lead.id,
      sourceRunId: leadRun.runId,
      task: "调查支线",
      title: "调查支线"
    });
    database.finishRun(subagentRun.runId, "completed", null);

    const leadSequence = database.listContextMessages(lead.id).at(-1)?.sequence;
    const subagentSequence = database.listContextMessages(subagent.id).at(-1)?.sequence;
    if (leadSequence === undefined || subagentSequence === undefined) {
      throw new Error("Context fixture messages were not stored.");
    }
    database.saveContextCheckpoint(lead.id, leadSequence, "主对话摘要");
    database.saveContextCheckpoint(subagent.id, subagentSequence, "Subagent 摘要");
    database.close();

    const reopened = new AgentDatabase(databasePath);
    expect(reopened.getConversation(lead.id)).toMatchObject({
      agentId: "team-lead",
      parentConversationId: null,
      teamId: "default-team",
      threadKind: "team_lead",
    });
    expect(reopened.getConversation(worker.id)).toMatchObject({
      agentId: "explorer",
      parentConversationId: null,
      teamId: "default-team",
      threadKind: "agent",
    });
    expect(reopened.getConversation(subagent.id)).toMatchObject({
      agentId: "explorer",
      parentConversationId: lead.id,
      teamId: "default-team",
      threadKind: "subagent",
    });
    expect(reopened.getConversationAgentBinding(subagent.id)).toEqual(workerAgent);
    expect(reopened.getContextCheckpoint(lead.id)?.summary).toBe("主对话摘要");
    expect(reopened.getContextCheckpoint(subagent.id)?.summary).toBe("Subagent 摘要");
    reopened.close();
  });

  it("persists Agent messages in the recipient timeline and marks them read", () => {
    const database = new AgentDatabase(":memory:");
    const sender = database.createConversation(null);
    const target = database.createConversation(null);
    database.renameConversation(sender.id, "负责人");

    const message = database.sendAgentMessage({
      content: "文件处理完后请通知我。",
      replyInstruction: "仅回三点摘要。",
      runId: crypto.randomUUID(),
      senderConversationId: sender.id,
      targetConversationId: target.id,
    });

    expect(database.listUnreadAgentMessages(target.id)).toEqual([message]);
    expect(database.listTimeline(target.id)).toContainEqual(message);
    const modelContent = database.listModelMessages(target.id).at(-1)?.content;
    expect(modelContent).toContain("Sender conversation: 负责人");
    expect(modelContent).toContain(`Sender conversationId: ${sender.id}`);
    expect(modelContent).toContain("Call send_agent_message");
    expect(modelContent).toContain("仅回三点摘要。");
    expect(database.getConversation(target.id).hasUnreadResult).toBe(true);

    database.markAgentMessagesRead([message.id]);
    expect(database.listUnreadAgentMessages(target.id)).toEqual([]);
    const timelineMessage = database.listTimeline(target.id)
      .find((item) => item.kind === "agent_message" && item.id === message.id);
    expect(timelineMessage?.kind).toBe("agent_message");
    if (timelineMessage?.kind === "agent_message") {
      expect(timelineMessage.status).toBe("read");
      expect(typeof timelineMessage.readAt).toBe("string");
    }
    database.close();
  });

  it("uses persistent Team Agent names for message senders and stable conversation titles", () => {
    const database = new AgentDatabase(":memory:");
    const directory = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    database.syncTeamDirectory(directory);
    const leadProfile = directory.agents.find((agent) => agent.id === "team-lead");
    const architectProfile = directory.agents.find((agent) => agent.id === "solution-architect");
    if (leadProfile === undefined || architectProfile === undefined) {
      throw new Error("The default Team Agent fixtures are missing.");
    }
    const lead = database.createConversation(null, {
      agent: {
        id: leadProfile.id,
        instructions: leadProfile.instructions,
        isDefault: leadProfile.isDefault,
        name: leadProfile.name,
        role: leadProfile.role,
      },
      teamId: "default-team",
      threadKind: "team_lead",
    });
    database.renameConversation(lead.id, "请进行一次可见的团队协作测试");
    const architect = database.createConversation(null, {
      agent: {
        id: architectProfile.id,
        instructions: architectProfile.instructions,
        isDefault: architectProfile.isDefault,
        name: architectProfile.name,
        role: architectProfile.role,
      },
      parentConversationId: lead.id,
      teamId: "default-team",
      threadKind: "agent",
    });
    const historic = database.sendAgentMessage({
      content: "你好，架构师！",
      messageType: "notification",
      runId: crypto.randomUUID(),
      senderConversationId: lead.id,
      targetConversationId: architect.id,
    });
    expect(historic.senderTitle).toBe("请进行一次可见的团队协作测试");

    const instance = database.createTeamInstance({
      name: "默认团队",
      scope: "global",
      teamId: "default-team",
    });
    database.setTeamInstanceRoot(instance.id, lead.id);
    database.bindTeamMemberConversation({
      agentId: architectProfile.id,
      conversationId: architect.id,
      teamExecutionConversationId: lead.id,
    });
    database.renameConversation(lead.id, "Team Lead · 默认团队");
    database.renameConversation(architect.id, "架构师 · 默认团队");

    const restoredHistoric = database.listTimeline(architect.id)
      .find((item) => item.kind === "agent_message" && item.id === historic.id);
    expect(restoredHistoric).toMatchObject({ senderTitle: "Team Lead · 默认团队" });
    const current = database.sendAgentMessage({
      content: "请继续评审。",
      messageType: "notification",
      runId: crypto.randomUUID(),
      senderConversationId: lead.id,
      targetConversationId: architect.id,
    });
    expect(current.senderTitle).toBe("Team Lead · 默认团队");

    const run = database.createRunWithUserMessage(lead.id, "新的团队任务", "test-model");
    expect(database.getConversation(lead.id).title).toBe("Team Lead · 默认团队");
    database.finishRun(run.runId, "completed", null);
    database.close();
  });

  it("migrates legacy parent, side, and Subagent conversation identities", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-database-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const parent = database.createConversation(null);
    const parentRun = database.createRunWithUserMessage(parent.id, "主任务", "test-model");
    database.finishRun(parentRun.runId, "completed", null);
    const side = database.forkConversation(parent.id);
    const subagent = database.forkConversation(parent.id);
    const subagentRun = database.createRunWithUserMessage(
      subagent.id,
      "调查支线",
      "test-model"
    );
    database.createSubagentTask({
      childConversationId: subagent.id,
      parentConversationId: parent.id,
      sourceRunId: parentRun.runId,
      task: "调查支线",
      title: "调查支线"
    });
    database.finishRun(subagentRun.runId, "completed", null);
    database.close();

    const legacyDatabase = new DatabaseSync(databasePath);
    legacyDatabase.prepare(
      "UPDATE conversations SET thread_kind = 'standard' WHERE id = ?",
    ).run(parent.id);
    legacyDatabase.prepare(
      "UPDATE conversations SET thread_kind = 'standard' WHERE id = ?",
    ).run(side.id);
    legacyDatabase.prepare(
      "UPDATE conversations SET thread_kind = 'standard' WHERE id = ?",
    ).run(subagent.id);
    legacyDatabase.exec("DELETE FROM schema_migrations");
    legacyDatabase.close();

    const migrated = new AgentDatabase(databasePath);
    expect(migrated.getConversation(parent.id)).toMatchObject({
      parentConversationId: null,
      threadKind: "agent",
    });
    expect(migrated.getConversation(side.id)).toMatchObject({
      parentConversationId: parent.id,
      threadKind: "agent",
    });
    expect(migrated.getConversation(subagent.id)).toMatchObject({
      parentConversationId: parent.id,
      threadKind: "subagent",
    });
    migrated.close();
  });

  it("forks a hidden side conversation from a read-only context snapshot", () => {
    const database = new AgentDatabase(":memory:");
    const mainConversation = database.createConversation(null);
    const parentAgent = {
      id: "reviewer",
      instructions: "保持审查上下文连续。",
      isDefault: false,
      name: "Reviewer",
      role: "代码审查",
    };
    database.bindConversationAgent(mainConversation.id, parentAgent);
    const mainRun = database.createRunWithUserMessage(
      mainConversation.id,
      "主对话已有上下文",
      "test-model"
    );
    database.appendAssistantTurn({
      content: "主对话已有回复",
      conversationId: mainConversation.id,
      messageId: "00000000-0000-4000-8000-000000000201",
      modelId: "test-model",
      runId: mainRun.runId,
      toolCalls: []
    });
    database.finishRun(mainRun.runId, "completed", null);
    const coveredThroughSequence = database.listContextMessages(mainConversation.id).at(-1)?.sequence;
    if (coveredThroughSequence === undefined) throw new Error("Expected parent context messages.");
    database.saveContextCheckpoint(
      mainConversation.id,
      coveredThroughSequence,
      JSON.stringify({ goals: ["继承最新压缩摘要"] })
    );
    const recentRun = database.createRunWithUserMessage(
      mainConversation.id,
      "压缩之后的新消息",
      "test-model"
    );
    database.appendAssistantTurn({
      content: "压缩之后的新回复",
      conversationId: mainConversation.id,
      messageId: "00000000-0000-4000-8000-000000000202",
      modelId: "test-model",
      runId: recentRun.runId,
      toolCalls: []
    });
    database.finishRun(recentRun.runId, "completed", null);

    const sideConversation = database.forkConversation(mainConversation.id, "side");

    expect(database.listConversations()).toEqual([
      database.getConversation(mainConversation.id)
    ]);
    expect(database.listConversationForks(mainConversation.id)).toEqual([
      sideConversation
    ]);
    expect(database.listTimeline(sideConversation.id)).toEqual([]);
    expect(database.isConversationFork(mainConversation.id)).toBe(false);
    expect(database.isConversationFork(sideConversation.id)).toBe(true);
    expect(sideConversation.threadKind).toBe("agent");
    expect(sideConversation.agentId).toBe(parentAgent.id);
    expect(database.getConversationAgentBinding(sideConversation.id)).toEqual(parentAgent);
    expect(database.listModelMessages(sideConversation.id).map((message) => message.content)).toEqual([
      "主对话已有回复",
      "压缩之后的新消息",
      "压缩之后的新回复",
    ]);
    const sourceCheckpoint = database.getContextCheckpoint(mainConversation.id);
    const sideCheckpoint = database.getContextCheckpoint(sideConversation.id);
    expect(sideCheckpoint).toMatchObject({
      conversationId: sideConversation.id,
      summary: sourceCheckpoint?.summary
    });
    expect(database.listContextMessages(sideConversation.id).find(
      (message) => message.sequence === sideCheckpoint?.coveredThroughSequence
    )?.content).toBe("主对话已有回复");
    expect(database.listContextMessages(sideConversation.id)
      .filter((message) => message.sequence > (sideCheckpoint?.coveredThroughSequence ?? 0))
      .map((message) => message.content)).toEqual([
        "压缩之后的新消息",
        "压缩之后的新回复",
      ]);

    const sideRun = database.createRunWithUserMessage(
      sideConversation.id,
      "只写入侧边聊天",
      "test-model"
    );
    database.finishRun(sideRun.runId, "completed", null);
    expect(database.listModelMessages(mainConversation.id)).toHaveLength(4);
    expect(database.listModelMessages(sideConversation.id)).toHaveLength(4);

    const deletionTask = database.createConversationDeletionTask(mainConversation.id);
    database.completeConversationDeletionTask(deletionTask.id);
    expect(() => database.getConversation(sideConversation.id)).toThrow(
      "Conversation was not found"
    );
    database.close();
  });

  it("forks the complete model context when the source has no checkpoint", () => {
    const database = new AgentDatabase(":memory:");
    const source = database.createConversation(null);
    const run = database.createRunWithUserMessage(source.id, "从第一条消息开始", "test-model");
    database.appendAssistantTurn({
      content: "完整上下文回复",
      conversationId: source.id,
      messageId: "00000000-0000-4000-8000-000000000205",
      modelId: "test-model",
      runId: run.runId,
      toolCalls: []
    });
    database.finishRun(run.runId, "completed", null);

    const sideConversation = database.forkConversation(source.id, "side");

    expect(database.getContextCheckpoint(sideConversation.id)).toBeNull();
    expect(database.listModelMessages(sideConversation.id).map((message) => message.content))
      .toEqual(["从第一条消息开始", "完整上下文回复"]);
    expect(database.listTimeline(sideConversation.id)).toEqual([]);
    database.close();
  });

  it("creates numbered sibling conversations from a completed assistant reply", () => {
    const database = new AgentDatabase(":memory:");
    const source = database.createConversation(null);
    const firstRun = database.createRunWithUserMessage(
      source.id,
      "第一轮问题",
      "test-model",
    );
    const firstAssistantMessageId = "00000000-0000-4000-8000-000000000211";
    database.appendAssistantTurn({
      content: "第一轮回复",
      conversationId: source.id,
      messageId: firstAssistantMessageId,
      modelId: "test-model",
      runId: firstRun.runId,
      toolCalls: [],
    });
    database.finishRun(firstRun.runId, "completed", null);

    const secondRun = database.createRunWithUserMessage(
      source.id,
      "第二轮问题",
      "test-model",
    );
    const secondAssistantMessageId = "00000000-0000-4000-8000-000000000212";
    database.appendAssistantTurn({
      content: "第二轮回复",
      conversationId: source.id,
      messageId: secondAssistantMessageId,
      modelId: "test-model",
      runId: secondRun.runId,
      toolCalls: [],
    });
    database.finishRun(secondRun.runId, "completed", null);
    const latestSequence = database.listContextMessages(source.id).at(-1)?.sequence;
    if (latestSequence === undefined) throw new Error("Expected source context messages.");
    database.saveContextCheckpoint(
      source.id,
      latestSequence,
      JSON.stringify({ goals: ["只属于第二轮之后的未来摘要"] }),
    );

    const fork = database.forkConversation(source.id, "sibling", firstAssistantMessageId);
    const secondFork = database.forkConversation(source.id, "sibling", firstAssistantMessageId);

    expect(fork).toMatchObject({
      parentConversationId: null,
      projectId: source.projectId,
      threadKind: "agent",
      title: "第一轮问题 (1)",
    });
    expect(secondFork.title).toBe("第一轮问题 (2)");
    expect(database.listConversationForks(source.id)).toEqual([]);
    expect(database.listModelMessages(fork.id).map((message) => message.content)).toEqual([
      "第一轮问题",
      "第一轮回复",
    ]);
    expect(database.getContextCheckpoint(fork.id)).toBeNull();
    const forkTimeline = database.listTimeline(fork.id);
    expect(forkTimeline.map((item) => item.kind === "tool" ? item.name : item.content)).toEqual([
      "第一轮问题",
      "第一轮回复",
    ]);
    expect(forkTimeline.every((item) => item.conversationId === fork.id)).toBe(true);
    const forkTimelineRunIds = new Set(forkTimeline.map((item) => item.runId));
    expect(forkTimelineRunIds.size).toBe(1);
    expect(forkTimelineRunIds.has(null)).toBe(false);
    expect(forkTimelineRunIds.has(firstRun.runId)).toBe(false);
    expect(forkTimeline.map((item) => item.id)).not.toEqual(
      database.listTimeline(source.id).slice(0, forkTimeline.length).map((item) => item.id),
    );
    const copiedAssistant = forkTimeline.find(
      (item) => item.kind === "message" && item.role === "assistant",
    );
    if (copiedAssistant?.kind !== "message") {
      throw new Error("Expected the copied assistant reply.");
    }
    const nestedFork = database.forkConversation(fork.id, "sibling", copiedAssistant.id);
    expect(database.listModelMessages(nestedFork.id).map((message) => message.content)).toEqual([
      "第一轮问题",
      "第一轮回复",
    ]);
    expect(database.listTimeline(nestedFork.id).map(
      (item) => item.kind === "tool" ? item.name : item.content,
    )).toEqual(["第一轮问题", "第一轮回复"]);
    expect(database.listTimeline(nestedFork.id).map((item) => item.id)).not.toEqual(
      forkTimeline.map((item) => item.id),
    );
    const forkRun = database.createRunWithUserMessage(
      fork.id,
      "从分叉位置继续",
      "test-model",
    );
    expect(forkRun.conversation.title).toBe("第一轮问题 (1)");
    database.finishRun(forkRun.runId, "completed", null);
    expect(database.listTimeline(source.id).map(
      (item) => item.kind === "tool" ? item.name : item.content,
    )).toEqual(["第一轮问题", "第一轮回复", "第二轮问题", "第二轮回复"]);
    expect(database.listTimeline(fork.id).map(
      (item) => item.kind === "tool" ? item.name : item.content,
    )).toEqual(["第一轮问题", "第一轮回复", "从分叉位置继续"]);
    expect(() => database.forkConversation(source.id, "sibling", firstRun.userMessage.id))
      .toThrow("completed assistant message");
    expect(() => database.forkConversation(
      source.id,
      "sibling",
      "00000000-0000-4000-8000-000000000299",
    )).toThrow("not found");

    const unrelated = database.createConversation(null);
    const unrelatedRun = database.createRunWithUserMessage(
      unrelated.id,
      "其他对话问题",
      "test-model",
    );
    const unrelatedAssistantMessageId = "00000000-0000-4000-8000-000000000213";
    database.appendAssistantTurn({
      content: "其他对话回复",
      conversationId: unrelated.id,
      messageId: unrelatedAssistantMessageId,
      modelId: "test-model",
      runId: unrelatedRun.runId,
      toolCalls: [],
    });
    expect(() => database.forkConversation(source.id, "sibling", unrelatedAssistantMessageId))
      .toThrow("not found");

    const deletionTask = database.createConversationDeletionTask(source.id);
    database.completeConversationDeletionTask(deletionTask.id);
    expect(database.getConversation(fork.id).title).toBe("第一轮问题 (1)");
    expect(database.getConversation(secondFork.id).title).toBe("第一轮问题 (2)");
    database.close();
  });

  it("only forks from the final assistant reply after a tool cycle", () => {
    const database = new AgentDatabase(":memory:");
    const source = database.createConversation(null);
    const run = database.createRunWithUserMessage(source.id, "检查文件", "test-model");
    const toolCall = {
      arguments: '{"path":"package.json"}',
      id: "tool-call-1",
      name: "read_file",
    };
    const beforeToolMessageId = "00000000-0000-4000-8000-000000000214";
    database.appendAssistantTurn({
      content: "我先读取文件。",
      conversationId: source.id,
      messageId: beforeToolMessageId,
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [toolCall],
    });
    const tool = {
      arguments: toolCall.arguments,
      batchId: null,
      conversationId: source.id,
      createdAt: new Date().toISOString(),
      diff: null,
      id: "00000000-0000-4000-8000-000000000215",
      kind: "tool" as const,
      name: toolCall.name,
      result: "package.json content",
      runId: run.runId,
      status: "completed" as const,
    };
    database.appendToolStarted({ ...tool, result: null, status: "running" });
    database.completeTool({
      providerCallId: toolCall.id,
      result: tool.result,
      tool,
    });
    const finalMessageId = "00000000-0000-4000-8000-000000000216";
    database.appendAssistantTurn({
      content: "文件检查完成。",
      conversationId: source.id,
      messageId: finalMessageId,
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [],
    });

    expect(() => database.forkConversation(source.id, "sibling", beforeToolMessageId))
      .toThrow("final assistant reply");
    const fork = database.forkConversation(source.id, "sibling", finalMessageId);
    expect(database.listModelMessages(fork.id).map((message) => message.content)).toEqual([
      "检查文件",
      "我先读取文件。",
      "package.json content",
      "文件检查完成。",
    ]);
    expect(database.listTimeline(fork.id).map((item) => item.kind)).toEqual([
      "message",
      "message",
      "tool",
      "message",
    ]);
    expect(database.listTimeline(fork.id).find((item) => item.kind === "tool")).toMatchObject({
      name: "read_file",
      result: "package.json content",
      status: "completed",
    });
    database.close();
  });

  it("persists a Subagent result and delivers it to the parent conversation", () => {
    const database = new AgentDatabase(":memory:");
    const parent = database.createConversation(null);
    const parentRun = database.createRunWithUserMessage(parent.id, "委派任务", "test-model");
    const child = database.forkConversation(parent.id);
    database.renameConversation(child.id, "检查实现");
    const childRun = database.createRunWithUserMessage(child.id, "检查当前实现", "test-model");
    const task = database.createSubagentTask({
      childConversationId: child.id,
      parentConversationId: parent.id,
      sourceRunId: parentRun.runId,
      task: "检查当前实现",
      title: "检查实现",
    });
    database.assignSubagentTaskRun(task.id, childRun.runId);
    expect(database.getConversation(parent.id).activeSubagentCount).toBe(1);
    expect(database.listConversations()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        activeSubagentCount: 1,
        id: parent.id,
      }),
    ]));
    database.finishRun(childRun.runId, "completed", null);
    const fullResult = `检查完成，没有发现问题。\n${"详细检查记录".repeat(400)}`;
    database.completeSubagentTaskByRun({
      error: null,
      result: fullResult,
      status: "completed",
      targetRunId: childRun.runId,
    });

    const message = database.deliverSubagentTaskResult(task.id);

    expect(message).toMatchObject({
      conversationId: parent.id,
      messageType: "task_result",
      senderConversationId: child.id,
      taskId: task.id,
    });
    expect(message?.content).toContain("检查完成，没有发现问题。");
    expect(message?.content).toContain("摘要已截断，可读取完整子对话");
    expect(message?.content.length).toBeLessThanOrEqual(2_000);
    expect(message?.content).not.toBe(fullResult);
    expect(database.getSubagentTask(task.id)).toMatchObject({
      resultMessageId: message?.id,
      status: "completed",
    });
    expect(database.getConversation(child.id).subagentTaskStatus).toBe("completed");
    expect(database.getConversation(parent.id).activeSubagentCount).toBe(0);
    expect(database.listContextMessages(parent.id).at(-1)?.content).toContain(
      "[Subagent task result]",
    );
    expect(database.listTimeline(parent.id).some((item) =>
      item.kind === "agent_message" && item.messageType === "task_result"
    )).toBe(false);
    expect(() => database.sendAgentMessage({
      content: "继续处理",
      runId: parentRun.runId,
      senderConversationId: parent.id,
      targetConversationId: child.id,
    })).toThrow("read-only");
    expect(database.deliverSubagentTaskResult(task.id)).toBeNull();
    database.close();
  });

  it("marks an interrupted Subagent task failed for delivery after restart", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-subagent-recovery-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const parent = database.createConversation(null);
    const parentRun = database.createRunWithUserMessage(parent.id, "委派任务", "test-model");
    const child = database.forkConversation(parent.id);
    const childRun = database.createRunWithUserMessage(child.id, "长时间任务", "test-model");
    const task = database.createSubagentTask({
      childConversationId: child.id,
      parentConversationId: parent.id,
      sourceRunId: parentRun.runId,
      task: "长时间任务",
      title: "长时间任务",
    });
    database.assignSubagentTaskRun(task.id, childRun.runId);
    database.close();

    const reopened = new AgentDatabase(databasePath);
    const recoveredTask = reopened.getSubagentTask(task.id);
    expect(recoveredTask).toMatchObject({
      error: "Application stopped before the Subagent finished.",
      status: "failed",
    });
    expect(typeof recoveredTask.resultMessageId).toBe("string");
    expect(reopened.listUndeliveredSubagentTasks()).toEqual([]);
    expect(reopened.listUnreadAgentMessages(parent.id)).toEqual([
      expect.objectContaining({ messageType: "task_result", taskId: task.id }),
    ]);
    reopened.close();
  });

  it("reorders and edits pending messages without changing identity or attachment bindings", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const referencedConversation = database.createConversation(null);
    const attachmentId = crypto.randomUUID();
    database.createConversationAttachment({
      contextTokens: 12,
      conversationId: conversation.id,
      createdAt: new Date().toISOString(),
      extractedTextPath: null,
      id: attachmentId,
      kind: "file",
      messageId: null,
      mimeType: "text/plain",
      name: "notes.txt",
      pendingMessageId: null,
      projectPath: null,
      sizeBytes: 24,
      source: "upload",
      storedPath: "D:\\managed\\notes.txt",
      truncated: false,
    });

    const first = database.enqueuePendingMessage({
      content: "第一条",
      conversationId: conversation.id,
    });
    const second = database.enqueuePendingMessage({
      attachmentIds: [attachmentId],
      content: "第二条",
      conversationId: conversation.id,
      referencedConversationIds: [referencedConversation.id],
      referencedProjectPaths: ["src/index.ts"],
    });
    const third = database.enqueuePendingMessage({
      content: "第三条",
      conversationId: conversation.id,
    });

    database.reorderPendingMessages(conversation.id, [third.id, second.id, first.id]);
    const edited = database.updatePendingMessage(second.id, "第二条，编辑后发送");

    expect(edited.map((message) => [message.id, message.content])).toEqual([
      [third.id, "第三条"],
      [second.id, "第二条，编辑后发送"],
      [first.id, "第一条"],
    ]);
    expect(edited[1]).toMatchObject({
      attachmentIds: [attachmentId],
      referencedConversationIds: [referencedConversation.id],
      referencedProjectPaths: ["src/index.ts"],
    });
    expect(database.getConversationAttachment(conversation.id, attachmentId)).toMatchObject({
      messageId: null,
      pendingMessageId: second.id,
    });

    const promoted = database.promotePendingMessage(first.id);
    expect(promoted.map((message) => message.id)).toEqual([third.id, second.id, first.id]);
    expect(promoted[2]?.deliveryMode).toBe("steer");

    const remaining = database.deletePendingMessage(second.id);
    expect(remaining.map((message) => message.id)).toEqual([third.id, first.id]);
    expect(database.getConversationAttachment(conversation.id, attachmentId)).toMatchObject({
      messageId: null,
      pendingMessageId: null,
    });
    expect(database.listDraftConversationAttachments(conversation.id)).toHaveLength(1);
    database.close();
  });

  it("persists pending message order and edits after reopening SQLite", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-pending-messages-"));
    temporaryDirectories.push(directory);
    const databasePath = path.join(directory, "agent.sqlite");
    const database = new AgentDatabase(databasePath);
    const conversation = database.createConversation(null);
    const first = database.enqueuePendingMessage({
      content: "重启后第二个发送",
      conversationId: conversation.id,
    });
    const second = database.enqueuePendingMessage({
      content: "编辑前",
      conversationId: conversation.id,
    });
    database.reorderPendingMessages(conversation.id, [second.id, first.id]);
    database.updatePendingMessage(second.id, "重启后第一个发送");
    database.close();

    const reopened = new AgentDatabase(databasePath);
    expect(reopened.listPendingMessages(conversation.id).map((message) => ({
      content: message.content,
      id: message.id,
    }))).toEqual([
      { content: "重启后第一个发送", id: second.id },
      { content: "重启后第二个发送", id: first.id },
    ]);
    expect(reopened.listConversationIdsWithPendingMessages()).toEqual([conversation.id]);
    reopened.close();
  });

});
