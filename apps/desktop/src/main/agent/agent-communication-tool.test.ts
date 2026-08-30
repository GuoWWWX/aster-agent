import { describe, expect, it } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION } from "@agent/protocol";

import { AgentDatabase } from "../storage/agent-database.js";
import { agentMessageModelContent } from "../storage/agent-database.js";
import { AgentCommunicationTool } from "./agent-communication-tool.js";

describe("AgentCommunicationTool", () => {
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
