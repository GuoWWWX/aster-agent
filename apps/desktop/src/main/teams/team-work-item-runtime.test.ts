import {
  DEFAULT_AGENT_DIRECTORY_CONFIGURATION,
  type ConversationModelSelection,
  type ConversationRunEvent,
  type SendConversationMessageInput,
} from "@agent/protocol";
import { afterEach, describe, expect, it } from "vitest";

import type { AgentRuntime } from "../agent/agent-runtime.js";
import type { ModelCredentialStore } from "../model/model-credential-store.js";
import type { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import type { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { TeamWorkItemRuntime } from "./team-work-item-runtime.js";

const databases: AgentDatabase[] = [];

afterEach(() => {
  databases.splice(0).forEach((database) => database.close());
});

describe("TeamWorkItemRuntime", () => {
  it("runs a WorkItem through AgentRuntime and stops for user acceptance", () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000001",
      isPinned: false,
      name: "Runtime fixture",
      rootPath: "D:\\workspace\\runtime-fixture",
    };
    database.saveProject(project);
    const sourceConversation = database.createConversation(project.id);
    const selection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000002",
      reasoning: { kind: "effort" as const, value: "high" as const },
    };
    const finish = { current: null as ((event: ConversationRunEvent) => void) | null };
    const sendInputs: SendConversationMessageInput[] = [];
    let executionConversationId: string | null = null;
    const executionConversationOptions: Parameters<AgentDatabase["createConversation"]>[1][] = [];
    const lifecycle = {
      createConversation(projectId: string | null, options: Parameters<AgentDatabase["createConversation"]>[1]) {
        executionConversationOptions.push(options ?? {});
        const conversation = database.createConversation(projectId, options);
        if (options?.threadKind === "team_lead") executionConversationId = conversation.id;
        return conversation;
      },
    } as unknown as ConversationLifecycleService;
    const agentRuntime = {
      sendMessage(
        input: SendConversationMessageInput,
        emit: (event: ConversationRunEvent) => void,
        options?: { beforeRunScheduled?: (accepted: { runId: string; userMessage: unknown }) => void },
      ) {
        sendInputs.push(input);
        if (sendInputs.length > 1) {
          return { kind: "pending" as const, pendingMessage: {} };
        }
        const run = database.createRunWithUserMessage(
          input.conversationId,
          input.content,
          input.modelId ?? selection.modelId,
        );
        options?.beforeRunScheduled?.({ runId: run.runId, userMessage: run.userMessage });
        finish.current = emit;
        return { kind: "started" as const, runId: run.runId, userMessage: run.userMessage };
      },
    } as unknown as AgentRuntime;
    const runtime = new TeamWorkItemRuntime(
      database,
      lifecycle,
      agentRuntime,
      {
        getPreferredSelection: () => selection,
        resolveSelection: (rawSelection: ConversationModelSelection) => rawSelection,
      } as unknown as ModelCredentialStore,
      { getProject: () => project } as unknown as ProjectRegistry,
      { getConfiguration: () => structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION) },
    );
    const emitted: ConversationRunEvent[] = [];

    const submitted = runtime.submit({
      acceptanceCriteria: ["自动化测试通过"],
      modelSelection: selection,
      permissionMode: "full_access",
      priority: "high",
      projectId: project.id,
      requirement: "实现一个简单函数并补测试。",
      sourceConversationId: sourceConversation.id,
      teamId: "default-team",
      title: "实现简单函数",
    }, (event) => emitted.push(event));
    const running = runtime.list({ teamId: "default-team" })[0];

    expect(submitted.status).toBe("queued");
    expect(running).toMatchObject({
      modelSelection: selection,
      status: "running",
    });
    expect(typeof running?.executionConversationId).toBe("string");
    expect(executionConversationOptions.find((options) => options?.threadKind === "team_lead")).toMatchObject({
      parentConversationId: sourceConversation.id,
      threadKind: "team_lead",
    });
    if (running === undefined || running.activeRunId === null || executionConversationId === null) {
      throw new Error("Runtime fixture did not start a Team WorkItem Run.");
    }
    expect(database.getConversation(executionConversationId)).toMatchObject({
      parentConversationId: sourceConversation.id,
      teamWorkItemId: submitted.id,
    });
    expect(emitted.some((event) => event.type === "conversation.updated")).toBe(true);
    const execution = runtime.getExecution({ workItemId: submitted.id });
    expect(execution.workItemId).toBe(submitted.id);
    expect(execution.agents[0]).toMatchObject({
      agent: { id: DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0]?.leadAgentId },
      conversation: { id: executionConversationId },
      delegation: null,
      depth: 0,
    });
    expect(execution.agents.some((agent) => agent.depth === 1)).toBe(true);
    const updatedSelection: ConversationModelSelection = {
      modelId: "deepseek-v4-flash-fast",
      providerId: selection.providerId,
      reasoning: null,
    };
    expect(runtime.updateModelSelection(executionConversationId, updatedSelection)).toMatchObject({
      id: executionConversationId,
      modelSelection: updatedSelection,
    });
    expect(database.getTeamWorkItem(submitted.id)).toMatchObject({
      modelSelection: updatedSelection,
    });
    expect(runtime.sendExecutionGuidance({
      agent: {
        avatarIcon: null,
        id: "unmanaged-agent",
        instructions: "不要使用这个 Agent。",
        isDefault: false,
        name: "Unmanaged Agent",
        role: "unmanaged",
      },
      content: "停止文件修改，只汇报当前进度。",
      conversationId: executionConversationId,
      deliveryMode: "queue",
      modelId: "unmanaged-model",
      permissionMode: "read_only",
      providerId: "00000000-0000-4000-8000-000000000099",
    }, () => undefined)).toMatchObject({ kind: "pending" });
    expect(sendInputs.at(-1)).toMatchObject({
      content: "停止文件修改，只汇报当前进度。",
      conversationId: executionConversationId,
      deliveryMode: "steer",
      modelId: updatedSelection.modelId,
      permissionMode: "full_access",
      providerId: updatedSelection.providerId,
    });
    expect(sendInputs.at(-1)).not.toHaveProperty("agent");
    const finishRun = finish.current;
    if (finishRun === null) throw new Error("Runtime fixture did not retain its event callback.");
    database.appendAssistantTurn({
      content: "实现完成，测试通过。",
      conversationId: executionConversationId,
      messageId: crypto.randomUUID(),
      modelId: selection.modelId,
      runId: running.activeRunId,
      toolCalls: [],
    });
    database.finishRun(running.activeRunId, "completed", null);
    finishRun({
      agentError: null,
      conversationId: executionConversationId,
      error: null,
      runId: running.activeRunId,
      status: "completed",
      type: "run.finished",
    });

    expect(runtime.list({ teamId: "default-team" })[0]).toMatchObject({
      activeRunId: null,
      resultSummary: "实现完成，测试通过。",
      status: "waiting_user",
    });
    expect(emitted.at(-1)?.type).toBe("run.finished");
  });

  it("rejects an invalid rework before creating an unowned Run", () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000011",
      isPinned: false,
      name: "Rework fixture",
      rootPath: "D:\\workspace\\rework-fixture",
    };
    database.saveProject(project);
    const selection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000012",
      reasoning: null,
    };
    const workItem = database.createTeamWorkItem({
      acceptanceCriteria: [],
      modelSelection: selection,
      permissionMode: "full_access",
      priority: "normal",
      projectId: project.id,
      requirement: "等待执行。",
      teamId: "default-team",
      title: "等待执行",
    }, selection);
    let sendCalls = 0;
    const runtime = new TeamWorkItemRuntime(
      database,
      {} as ConversationLifecycleService,
      {
        sendMessage() {
          sendCalls += 1;
          throw new Error("must not run");
        },
      } as unknown as AgentRuntime,
      {
        getPreferredSelection: () => selection,
        resolveSelection: () => selection,
      } as unknown as ModelCredentialStore,
      { getProject: () => project } as unknown as ProjectRegistry,
      { getConfiguration: () => structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION) },
    );

    expect(() => runtime.requestRework({ feedback: "不应启动", workItemId: workItem.id }, () => undefined))
      .toThrow("Only a WorkItem waiting for user acceptance");
    expect(sendCalls).toBe(0);
  });

  it("keeps work in the queue for a paused Team without starting a Team Lead Run", () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000021",
      isPinned: false,
      name: "Paused team fixture",
      rootPath: "D:\\workspace\\paused-team",
    };
    database.saveProject(project);
    const configuration = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    configuration.teams[0] = { ...configuration.teams[0]!, enabled: false };
    let sendCalls = 0;
    const selection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000022",
      reasoning: null,
    };
    const runtime = new TeamWorkItemRuntime(
      database,
      {} as ConversationLifecycleService,
      {
        sendMessage() {
          sendCalls += 1;
          throw new Error("A paused Team must not start a Run.");
        },
      } as unknown as AgentRuntime,
      {
        getPreferredSelection: () => selection,
        resolveSelection: () => selection,
      } as unknown as ModelCredentialStore,
      { getProject: () => project } as unknown as ProjectRegistry,
      { getConfiguration: () => configuration },
    );

    const submitted = runtime.submit({
      acceptanceCriteria: [],
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: "团队暂停期间仍应接收需求。",
      teamId: "default-team",
      title: "暂停团队入箱",
    }, () => undefined);

    expect(submitted.status).toBe("queued");
    expect(runtime.list({ teamId: "default-team" })[0]).toMatchObject({
      activeRunId: null,
      status: "queued",
    });
    expect(sendCalls).toBe(0);
  });

  it("automatically starts new Team Lead instances until capacity, then dispatches queued work after completion", () => {
    const database = new AgentDatabase(":memory:");
    databases.push(database);
    const configuration = structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION);
    configuration.teams[0] = { ...configuration.teams[0]!, maxWorkers: 2 };
    database.syncTeamDirectory(configuration);
    const project = {
      id: "00000000-0000-4000-8000-000000000031",
      isPinned: false,
      name: "Capacity fixture",
      rootPath: "D:\\workspace\\team-capacity",
    };
    database.saveProject(project);
    const selection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000032",
      reasoning: null,
    };
    const finishCallbacks = new Map<string, (event: ConversationRunEvent) => void>();
    const lifecycle = {
      createConversation(projectId: string | null, options: Parameters<AgentDatabase["createConversation"]>[1]) {
        return database.createConversation(projectId, options);
      },
    } as unknown as ConversationLifecycleService;
    const runtime = new TeamWorkItemRuntime(
      database,
      lifecycle,
      {
        sendMessage(
          input: { content: string; conversationId: string; modelId?: string },
          emit: (event: ConversationRunEvent) => void,
          options?: { beforeRunScheduled?: (accepted: { runId: string; userMessage: unknown }) => void },
        ) {
          const run = database.createRunWithUserMessage(
            input.conversationId,
            input.content,
            input.modelId ?? selection.modelId,
          );
          options?.beforeRunScheduled?.({ runId: run.runId, userMessage: run.userMessage });
          finishCallbacks.set(input.conversationId, emit);
          return { kind: "started" as const, runId: run.runId, userMessage: run.userMessage };
        },
      } as unknown as AgentRuntime,
      {
        getPreferredSelection: () => selection,
        resolveSelection: () => selection,
      } as unknown as ModelCredentialStore,
      { getProject: () => project } as unknown as ProjectRegistry,
      { getConfiguration: () => configuration },
    );
    const sourceOne = database.createConversation(project.id);
    const sourceTwo = database.createConversation(project.id);
    const submit = (title: string, sourceConversationId: string) => runtime.submit({
      acceptanceCriteria: [],
      permissionMode: "ask_before_changes",
      priority: "normal",
      projectId: project.id,
      requirement: `${title} 的需求。`,
      sourceConversationId,
      teamId: "default-team",
      title,
    }, () => undefined);

    submit("第一个任务", sourceOne.id);
    submit("第二个任务", sourceTwo.id);
    submit("第三个任务", sourceOne.id);
    const initial = runtime.list({ teamId: "default-team" });
    const running = initial.filter((item) => item.status === "running");
    const queued = initial.find((item) => item.title === "第三个任务");

    expect(running).toHaveLength(2);
    expect(new Set(running.map((item) => item.executionConversationId)).size).toBe(2);
    expect(queued).toMatchObject({ executionConversationId: null, status: "queued" });
    const first = running[0];
    if (first?.activeRunId === null || first?.activeRunId === undefined || first.executionConversationId === null) {
      throw new Error("The first Team Lead Run was not created.");
    }
    database.appendAssistantTurn({
      content: "第一个任务已完成。",
      conversationId: first.executionConversationId,
      messageId: crypto.randomUUID(),
      modelId: selection.modelId,
      runId: first.activeRunId,
      toolCalls: [],
    });
    database.finishRun(first.activeRunId, "completed", null);
    const finish = finishCallbacks.get(first.executionConversationId);
    if (finish === undefined) throw new Error("The first Team Lead callback was not retained.");
    finish({
      agentError: null,
      conversationId: first.executionConversationId,
      error: null,
      runId: first.activeRunId,
      status: "completed",
      type: "run.finished",
    });

    const afterCompletion = runtime.list({ teamId: "default-team" });
    const dispatched = afterCompletion.find((item) => item.title === "第三个任务");
    expect(afterCompletion.filter((item) => item.status === "running")).toHaveLength(2);
    expect(dispatched).toMatchObject({ status: "running" });
    expect(dispatched?.executionConversationId).toBe(first.executionConversationId);
    expect(database.getConversation(dispatched?.executionConversationId ?? "").threadKind).toBe("team_lead");
  });
});
