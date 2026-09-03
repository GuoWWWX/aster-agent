import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";

import { AgentDatabase } from "../storage/agent-database.js";
import { agentMessageModelContent } from "../storage/agent-database.js";
import { AgentCommunicationTool } from "./agent-communication-tool.js";

describe("AgentCommunicationTool", () => {
  it("separates universal conversation reads from coordination tools", () => {
    const database = new AgentDatabase(":memory:");
    const tool = new AgentCommunicationTool(database);

    expect(tool.getConversationReadDefinitions().map((definition) => definition.name)).toEqual([
      "list_agent_conversations",
      "read_agent_conversation",
    ]);
    expect(tool.getCoordinationDefinitions().map((definition) => definition.name)).toEqual([
      "send_agent_message",
      "set_team_collaboration_plan",
      "wait_for_agent_message",
    ]);
    database.close();
  });

  it("accepts empty JSON arguments for no-parameter operations", async () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const tool = new AgentCommunicationTool(database);
    const input = {
      conversationId: conversation.id,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      toolName: "list_agent_conversations",
    } as const;

    await expect(tool.execute({ ...input, arguments: "" })).resolves.toMatchObject({ isError: false });
    await expect(tool.execute({ ...input, arguments: "{}" })).resolves.toMatchObject({ isError: false });
    database.close();
  });

  it("delivers a message to a waiting Agent conversation", async () => {
    const database = new AgentDatabase(":memory:");
    const sender = database.createConversation(null);
    database.renameConversation(sender.id, "负责人");
    const target = database.createConversation(null);
    const tool = new AgentCommunicationTool(database);
    const signal = new AbortController().signal;
    const waiting = tool.execute({
      arguments: JSON.stringify({ conversationId: sender.id, timeoutMs: 5_000 }),
      conversationId: target.id,
      runId: crypto.randomUUID(),
      signal,
      toolName: "wait_for_agent_message",
    });

    await tool.execute({
      arguments: JSON.stringify({
        content: "操作完成，可以继续。",
        conversationId: target.id,
      }),
      conversationId: sender.id,
      runId: crypto.randomUUID(),
      signal,
      toolName: "send_agent_message",
    });

    const result = await waiting;
    expect(result.isError).toBe(false);
    expect(result.content).toContain("操作完成，可以继续。");
    expect(result.content).toContain(sender.id);
    expect(result.content).toContain("负责人");
    expect(result.content).toContain("senderConversationId");
    expect(database.listUnreadAgentMessages(target.id)).toEqual([]);
    database.close();
  });

  it("returns a bounded compressed conversation snapshot", async () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    const run = database.createRunWithUserMessage(source.id, "历史问题", "test-model");
    database.finishRun(run.runId, "completed", null);
    const tool = new AgentCommunicationTool(database);

    const result = await tool.execute({
      arguments: JSON.stringify({ conversationId: source.id, maxTokens: 512 }),
      conversationId: current.id,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      toolName: "read_agent_conversation",
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("历史问题");
    expect(JSON.parse(result.content)).toMatchObject({
      value: {
        historyScope: "all",
        requestedHistoryScope: "compressed",
      },
    });
    database.close();
  });

  it("allows an Agent to query its own conversation history", async () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const run = database.createRunWithUserMessage(
      conversation.id,
      "SELF-HISTORY-731 的用户问题",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "SELF-HISTORY-731 的模型回答",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [],
    });
    database.finishRun(run.runId, "completed", null);
    const tool = new AgentCommunicationTool(database);

    const result = await tool.execute({
      arguments: JSON.stringify({
        query: "SELF-HISTORY-731",
      }),
      conversationId: conversation.id,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      toolName: "read_agent_conversation",
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("SELF-HISTORY-731 的用户问题");
    expect(result.content).toContain("SELF-HISTORY-731 的模型回答");
    database.close();
  });

  it("defaults to checkpoint-covered history and can opt into all history", async () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    const coveredRun = database.createRunWithUserMessage(
      source.id,
      "COVERED-HISTORY-419 的用户问题",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "COVERED-HISTORY-419 的模型回答",
      conversationId: source.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: coveredRun.runId,
      toolCalls: [],
    });
    database.finishRun(coveredRun.runId, "completed", null);
    const coveredThroughSequence = database.listContextMessages(source.id).at(-1)?.sequence;
    if (coveredThroughSequence === undefined) throw new Error("Expected covered messages.");
    database.saveContextCheckpoint(source.id, coveredThroughSequence, "已压缩旧历史。");
    const recentRun = database.createRunWithUserMessage(
      source.id,
      "RECENT-HISTORY-420 的用户问题",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "RECENT-HISTORY-420 的模型回答",
      conversationId: source.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: recentRun.runId,
      toolCalls: [],
    });
    database.finishRun(recentRun.runId, "completed", null);
    const tool = new AgentCommunicationTool(database);
    const common = {
      conversationId: current.id,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      toolName: "read_agent_conversation",
    } as const;

    const coveredResult = await tool.execute({
      ...common,
      arguments: JSON.stringify({
        conversationId: source.id,
        query: "COVERED-HISTORY-419",
      }),
    });
    const defaultRecentResult = await tool.execute({
      ...common,
      arguments: JSON.stringify({
        conversationId: source.id,
        query: "RECENT-HISTORY-420",
      }),
    });
    const allHistoryResult = await tool.execute({
      ...common,
      arguments: JSON.stringify({
        conversationId: source.id,
        historyScope: "all",
        query: "RECENT-HISTORY-420",
      }),
    });

    expect(coveredResult.content).toContain("COVERED-HISTORY-419 的用户问题");
    expect(defaultRecentResult.content).not.toContain("RECENT-HISTORY-420 的用户问题");
    expect(allHistoryResult.content).toContain("RECENT-HISTORY-420 的用户问题");
    expect(JSON.parse(coveredResult.content)).toMatchObject({
      value: {
        checkpointCoveredThroughSequence: coveredThroughSequence,
        historyScope: "compressed",
        requestedHistoryScope: "compressed",
      },
    });
    expect(JSON.parse(allHistoryResult.content)).toMatchObject({
      value: {
        historyScope: "all",
        requestedHistoryScope: "all",
      },
    });
    database.close();
  });

  it("reads persisted Subagent and archived conversations by id", async () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const parent = database.createConversation(null);
    const parentRun = database.createRunWithUserMessage(parent.id, "父任务", "test-model");
    database.finishRun(parentRun.runId, "completed", null);
    const subagent = database.forkConversation(parent.id);
    const subagentRun = database.createRunWithUserMessage(subagent.id, "子任务证据", "test-model");
    database.createSubagentTask({
      childConversationId: subagent.id,
      parentConversationId: parent.id,
      sourceRunId: parentRun.runId,
      task: "子任务证据",
      title: "证据检查",
    });
    database.finishRun(subagentRun.runId, "completed", null);
    const archived = database.createConversation(null);
    const archivedRun = database.createRunWithUserMessage(
      archived.id,
      "归档对话证据",
      "test-model",
    );
    database.finishRun(archivedRun.runId, "completed", null);
    database.setConversationArchived(archived.id, true);
    const tool = new AgentCommunicationTool(database);
    const common = {
      conversationId: current.id,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      toolName: "read_agent_conversation",
    } as const;

    const subagentResult = await tool.execute({
      ...common,
      arguments: JSON.stringify({ conversationId: subagent.id, maxTokens: 512 }),
    });
    const archivedResult = await tool.execute({
      ...common,
      arguments: JSON.stringify({ conversationId: archived.id, maxTokens: 512 }),
    });

    expect(database.getConversation(subagent.id).threadKind).toBe("subagent");
    expect(subagentResult.isError).toBe(false);
    expect(subagentResult.content).toContain("子任务证据");
    expect(archivedResult.isError).toBe(false);
    expect(archivedResult.content).toContain("归档对话证据");
    database.close();
  });

  it("searches a bounded Agent conversation snapshot by query", async () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    const evidence = database.createRunWithUserMessage(
      source.id,
      "auth rotation alpha 917 的验证证据位于旧消息。",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "auth rotation alpha 917 需要保留旧版密钥直到验证完成。",
      conversationId: source.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: evidence.runId,
      toolCalls: [],
    });
    database.finishRun(evidence.runId, "completed", null);
    const coveredThroughSequence = database.listContextMessages(source.id).at(-1)?.sequence;
    if (coveredThroughSequence === undefined) throw new Error("Expected source messages.");
    database.saveContextCheckpoint(source.id, coveredThroughSequence, "旧记录已压缩。");
    for (let index = 0; index < 12; index += 1) {
      const recent = database.createRunWithUserMessage(
        source.id,
        `无关的新消息 ${index} ${"占用读取预算".repeat(40)}`,
        "test-model",
      );
      database.finishRun(recent.runId, "completed", null);
    }
    database.renameConversation(source.id, "来源会话");
    const tool = new AgentCommunicationTool(database);
    const common = {
      conversationId: current.id,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      toolName: "read_agent_conversation",
    } as const;

    const defaultResult = await tool.execute({
      ...common,
      arguments: JSON.stringify({ conversationId: source.id, maxTokens: 512 }),
    });
    const searchedResult = await tool.execute({
      ...common,
      arguments: JSON.stringify({
        conversationId: source.id,
        maxTokens: 512,
        query: "auth rotation alpha 917",
      }),
    });

    expect(defaultResult.content).toContain("auth rotation alpha 917");
    expect(defaultResult.content).not.toContain("无关的新消息");
    expect(searchedResult.isError).toBe(false);
    expect(searchedResult.content).toContain("auth rotation alpha 917");
    expect(searchedResult.content).toContain("保留旧版密钥");
    expect(JSON.parse(searchedResult.content)).toMatchObject({
      value: { query: "auth rotation alpha 917" },
    });
    database.close();
  });

  it("finds a one-character message through a one-character query", async () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    const run = database.createRunWithUserMessage(source.id, "甲", "test-model");
    database.appendAssistantTurn({
      content: "这是单字问题的回答。",
      conversationId: source.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [],
    });
    database.finishRun(run.runId, "completed", null);
    const tool = new AgentCommunicationTool(database);

    const result = await tool.execute({
      arguments: JSON.stringify({
        conversationId: source.id,
        maxTokens: 512,
        query: "甲",
      }),
      conversationId: current.id,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      toolName: "read_agent_conversation",
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("[User]\\n甲");
    expect(result.content).toContain("这是单字问题的回答");
    database.close();
  });

  it("continues a conversation search before a message sequence", async () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    const oldRun = database.createRunWithUserMessage(source.id, "CURSOR-441 旧问题", "test-model");
    database.appendAssistantTurn({
      content: "CURSOR-441 旧回答",
      conversationId: source.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: oldRun.runId,
      toolCalls: [],
    });
    database.finishRun(oldRun.runId, "completed", null);
    const recentRun = database.createRunWithUserMessage(source.id, "CURSOR-441 新问题", "test-model");
    database.finishRun(recentRun.runId, "completed", null);
    const recentSequence = database.listContextMessages(source.id)
      .find((message) => message.runId === recentRun.runId)
      ?.sequence;
    if (recentSequence === undefined) throw new Error("Expected recent message.");
    const tool = new AgentCommunicationTool(database);

    const result = await tool.execute({
      arguments: JSON.stringify({
        beforeSequence: recentSequence,
        conversationId: source.id,
        maxTokens: 12_288,
        query: "CURSOR-441",
      }),
      conversationId: current.id,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      toolName: "read_agent_conversation",
    });

    expect(result.isError).toBe(false);
    expect(result.content).toContain("CURSOR-441 旧回答");
    expect(result.content).not.toContain("CURSOR-441 新问题");
    expect(JSON.parse(result.content)).toMatchObject({
      value: {
        pagination: { beforeSequence: recentSequence, conversationId: source.id },
      },
    });
    database.close();
  });

  it("persists concurrent Agent messages without losing deliveries", async () => {
    const database = new AgentDatabase(":memory:");
    const sender = database.createConversation(null);
    const target = database.createConversation(null);
    const tool = new AgentCommunicationTool(database);
    const signal = new AbortController().signal;
    const contents = Array.from({ length: 20 }, (_, index) => `并发消息-${index}`);

    const results = await Promise.all(contents.map((content) => tool.execute({
      arguments: JSON.stringify({ content, conversationId: target.id }),
      conversationId: sender.id,
      runId: crypto.randomUUID(),
      signal,
      toolName: "send_agent_message",
    })));

    expect(results.every((result) => !result.isError)).toBe(true);
    const unread = database.listUnreadAgentMessages(target.id);
    expect(unread).toHaveLength(contents.length);
    expect(new Set(unread.map((message) => message.content))).toEqual(new Set(contents));
    database.close();
  });

  it("distinguishes delegated work from progress notifications", async () => {
    const database = new AgentDatabase(":memory:");
    const sender = database.createConversation(null);
    const target = database.createConversation(null);
    const tool = new AgentCommunicationTool(database);
    const signal = new AbortController().signal;

    await tool.execute({
      arguments: JSON.stringify({ content: "请处理并回传结果", conversationId: target.id }),
      conversationId: sender.id,
      runId: crypto.randomUUID(),
      signal,
      toolName: "send_agent_message",
    });
    await tool.execute({
      arguments: JSON.stringify({
        content: "当前进度 50%",
        conversationId: target.id,
        expectReply: false,
      }),
      conversationId: sender.id,
      runId: crypto.randomUUID(),
      signal,
      toolName: "send_agent_message",
    });

    expect(database.listUnreadAgentMessages(target.id).map((message) => message.messageType))
      .toEqual(["message", "notification"]);
    database.close();
  });

  it("persists a bounded completion-receipt instruction for delegated work", async () => {
    const database = new AgentDatabase(":memory:");
    const sender = database.createConversation(null);
    const target = database.createConversation(null);
    const tool = new AgentCommunicationTool(database);

    const result = await tool.execute({
      arguments: JSON.stringify({
        content: "检查登录方案",
        conversationId: target.id,
        replyInstruction: "只回结论、验证证据和未解决风险，最多三点。",
      }),
      conversationId: sender.id,
      runId: crypto.randomUUID(),
      signal: new AbortController().signal,
      toolName: "send_agent_message",
    });

    expect(result.isError).toBe(false);
    const message = database.listUnreadAgentMessages(target.id)[0];
    expect(message?.replyInstruction).toBe("只回结论、验证证据和未解决风险，最多三点。");
    expect(message === undefined ? "" : agentMessageModelContent(message)).toContain(
      "只回结论、验证证据和未解决风险，最多三点。",
    );
    database.close();
  });

  it("reports explicit Agent status and read metadata", async () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const target = database.createConversation(null);
    database.renameConversation(target.id, "架构师");
    const run = database.createRunWithUserMessage(target.id, "分析方案", "test-model");
    const tool = new AgentCommunicationTool(database);
    const signal = new AbortController().signal;

    const listResult = await tool.execute({
      arguments: "{}",
      conversationId: current.id,
      runId: crypto.randomUUID(),
      signal,
      toolName: "list_agent_conversations",
    });
    expect(listResult.isError).toBe(false);
    expect(JSON.parse(listResult.content)).toMatchObject({
      value: {
        conversations: [expect.objectContaining({
          activeRunId: run.runId,
          activeSubagentCount: 0,
          conversationId: target.id,
          status: "running",
          title: "分析方案",
        })],
      },
    });

    const readResult = await tool.execute({
      arguments: JSON.stringify({ conversationId: target.id, maxTokens: 512 }),
      conversationId: current.id,
      runId: crypto.randomUUID(),
      signal,
      toolName: "read_agent_conversation",
    });
    expect(readResult.isError).toBe(false);
    expect(JSON.parse(readResult.content)).toMatchObject({
      value: {
        conversation: {
          activeRunId: run.runId,
          conversationId: target.id,
          status: "running",
        },
      },
    });
    database.close();
  });

  it("lets only the running WorkItem Team Lead publish an advisory collaboration plan", async () => {
    const database = new AgentDatabase(":memory:");
    database.syncTeamDirectory(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
    const project = {
      id: "00000000-0000-4000-8000-000000000121",
      isPinned: false,
      name: "Plan tool fixture",
      rootPath: "D:\\workspace\\plan-tool",
    };
    const modelSelection = {
      modelId: "test-model",
      providerId: "00000000-0000-4000-8000-000000000122",
      reasoning: null,
    };
    database.saveProject(project);
    const workItem = database.createTeamWorkItem({
      acceptanceCriteria: [],
      modelSelection,
      permissionMode: "full_access",
      priority: "normal",
      projectId: project.id,
      requirement: "验证计划工具权限。",
      teamId: "default-team",
      title: "计划工具",
    }, modelSelection);
    const lead = database.createConversation(project.id, {
      agent: {
        id: "team-lead",
        instructions: "负责团队。",
        isDefault: true,
        name: "Team Lead",
        role: "负责人",
      },
      modelSelection,
      teamId: "default-team",
      threadKind: "team_lead",
    });
    const member = database.createConversation(project.id, {
      agent: {
        id: "developer",
        instructions: "负责开发。",
        isDefault: false,
        name: "开发 Agent",
        role: "开发",
      },
      modelSelection,
      parentConversationId: lead.id,
      teamId: "default-team",
      threadKind: "agent",
    });
    database.bindTeamMemberConversation({
      agentId: "developer",
      conversationId: member.id,
      teamExecutionConversationId: lead.id,
    });
    const run = database.createRunWithUserMessage(lead.id, "开始执行", modelSelection.modelId);
    database.startTeamWorkItem(workItem.id, lead.id, run.runId);
    const tool = new AgentCommunicationTool(database);
    const argumentsValue = JSON.stringify({
      reason: "由开发 Agent 完成后回传。",
      routes: [{
        fromConversationId: lead.id,
        purpose: "分派实现",
        toConversationId: member.id,
      }],
    });

    const published = await tool.execute({
      arguments: argumentsValue,
      conversationId: lead.id,
      runId: run.runId,
      signal: new AbortController().signal,
      toolName: "set_team_collaboration_plan",
    });
    expect(published.isError).toBe(false);
    expect(JSON.parse(published.content)).toMatchObject({
      value: { plan: { revision: 1 }, workItemId: workItem.id },
    });

    const rejected = await tool.execute({
      arguments: argumentsValue,
      conversationId: member.id,
      runId: run.runId,
      signal: new AbortController().signal,
      toolName: "set_team_collaboration_plan",
    });
    expect(rejected.isError).toBe(true);
    expect(rejected.content).toContain("Only the current WorkItem Team Lead");
    database.close();
  });
});
