import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationRunEvent } from "@agent/protocol";
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
    const selection = {
      modelId: "deepseek-v4-flash",
      providerId: "00000000-0000-4000-8000-000000000002",
      reasoning: { kind: "effort" as const, value: "high" as const },
    };
    const finish = { current: null as ((event: ConversationRunEvent) => void) | null };
    let executionConversationId: string | null = null;
    const lifecycle = {
      createConversation(projectId: string | null, options: Parameters<AgentDatabase["createConversation"]>[1]) {
        const conversation = database.createConversation(projectId, options);
        executionConversationId = conversation.id;
        return conversation;
      },
    } as unknown as ConversationLifecycleService;
    const agentRuntime = {
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
        resolveSelection: () => selection,
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
    if (running === undefined || running.activeRunId === null || executionConversationId === null) {
      throw new Error("Runtime fixture did not start a Team WorkItem Run.");
    }
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
});
