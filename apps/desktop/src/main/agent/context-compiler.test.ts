import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ContextCompiler } from "./context-compiler.js";

describe("ContextCompiler", () => {
  it("keeps only the latest user images inline and turns historical images into references", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "agent-context-images-"));
    const database = new AgentDatabase(":memory:");
    try {
      const conversation = database.createConversation(null);
      const attachments = new ConversationAttachmentStore(
        database,
        new ProjectRegistry(database),
        path.join(root, "attachments"),
      );
      const imageBytes = Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nksAAAAASUVORK5CYII=",
        "base64",
      );
      const historicalImage = await attachments.importBytes(conversation.id, {
        bytes: imageBytes,
        mimeType: "image/png",
        name: "historical.png",
      });
      const first = database.createRunWithUserMessage(
        conversation.id,
        "先看这张历史图片",
        "test-model",
        [historicalImage.id],
      );
      database.appendAssistantTurn({
        content: "已经看过历史图片。",
        conversationId: conversation.id,
        messageId: crypto.randomUUID(),
        modelId: "test-model",
        runId: first.runId,
        toolCalls: [],
      });
      database.finishRun(first.runId, "completed", null);
      const currentImage = await attachments.importBytes(conversation.id, {
        bytes: imageBytes,
        mimeType: "image/png",
        name: "current.png",
      });
      database.createRunWithUserMessage(
        conversation.id,
        "再看这张新图片",
        "test-model",
        [currentImage.id],
      );

      const context = new ContextCompiler(database, attachments).compile({
        contextCompressionConfiguration: {
          mode: "tokens",
          percentageThreshold: 80,
          tokenThreshold: 20_000,
        },
        contextWindowTokens: 30_000,
        conversationId: conversation.id,
        includeImageData: true,
        estimatedSkillCatalogTokens: 0,
        outputReserveTokens: 1_000,
        reservedSkillTokens: 0,
        systemMessage: {
          attachments: [], content: "系统指令", role: "system", toolCallId: null, toolCalls: [],
        },
        toolDefinitions: [],
      });
      const users = context.messages.filter((message) => message.role === "user");

      expect(users[0]?.attachments).toEqual([
        expect.objectContaining({ kind: "text", name: "historical.png", readState: "metadata_only" }),
      ]);
      expect(users[0]?.attachments[0]?.kind === "text" && users[0].attachments[0].content)
        .toContain("view_attachments");
      const currentAttachment = users.at(-1)?.attachments[0];
      expect(currentAttachment).toMatchObject({ kind: "image", name: "current.png" });
      expect(currentAttachment?.kind === "image" ? typeof currentAttachment.data : null)
        .toBe("string");
    } finally {
      database.close();
      await rm(root, { force: true, recursive: true });
    }
  });

  it("builds the model context from persisted messages and applies the checkpoint", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const first = database.createRunWithUserMessage(
      conversation.id,
      "登录页需要补充表单校验",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "历史决定：复用现有表单校验组件。",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: first.runId,
      toolCalls: [],
    });
    database.finishRun(first.runId, "completed", null);
    database.saveContextCheckpoint(
      conversation.id,
      2,
      JSON.stringify({ decisions: ["复用现有表单校验组件"] }),
    );
    const second = database.createRunWithUserMessage(
      conversation.id,
      "继续检查登录页的表单校验",
      "test-model",
    );
    database.finishRun(second.runId, "completed", null);

    const context = new ContextCompiler(database, null).compile({
      contextCompressionConfiguration: {
        mode: "tokens",
        percentageThreshold: 80,
        tokenThreshold: 10_000,
      },
      contextWindowTokens: 20_000,
      conversationId: conversation.id,
      includeImageData: false,
      estimatedSkillCatalogTokens: 0,
      outputReserveTokens: 1_000,
      reservedSkillTokens: 0,
      systemMessage: {
        attachments: [],
        content: "系统指令",
        role: "system",
        toolCallId: null,
        toolCalls: [],
      },
      toolDefinitions: [],
    });

    expect(context.messages[0]).toMatchObject({ role: "system", content: "系统指令" });
    expect(context.messages.map((message) => message.content)).toContain("继续检查登录页的表单校验");
    expect(context.messages.some((message) => message.content.includes("structured compression checkpoint"))).toBe(true);
    expect(context.messages.some((message) => message.content === "登录页需要补充表单校验")).toBe(false);
    expect(context.usage.omittedMessageCount).toBe(2);
    database.close();
  });

  it("does not send incomplete tool calls to the model", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const run = database.createRunWithUserMessage(conversation.id, "检查状态", "test-model");
    database.appendAssistantTurn({
      content: "",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: run.runId,
      toolCalls: [{ arguments: "{}", id: "call-incomplete", name: "read_file" }],
    });

    const context = new ContextCompiler(database, null).compile({
      contextCompressionConfiguration: {
        mode: "tokens",
        percentageThreshold: 80,
        tokenThreshold: 10_000,
      },
      contextWindowTokens: 20_000,
      conversationId: conversation.id,
      includeImageData: false,
      estimatedSkillCatalogTokens: 0,
      outputReserveTokens: 1_000,
      reservedSkillTokens: 0,
      systemMessage: {
        attachments: [], content: "系统指令", role: "system", toolCallId: null, toolCalls: [],
      },
      toolDefinitions: [],
    });

    expect(context.messages.some((message) => message.toolCalls.length > 0)).toBe(false);
    database.close();
  });

  it("keeps provider replay for tool results but removes it from completed final replies", () => {
    const database = new AgentDatabase(":memory:");
    const conversation = database.createConversation(null);
    const first = database.createRunWithUserMessage(
      conversation.id,
      "读取配置并给出结论",
      "test-model",
    );
    const toolCall = {
      arguments: '{"path":"config.json"}',
      id: "call-read-config",
      name: "read_file",
    };
    const toolProviderState = {
      apiFormat: "openai-responses" as const,
      baseUrl: "https://example.test/v1",
      modelId: "test-model",
      payload: [{ id: "reasoning-tool", type: "reasoning" }],
    };
    const finalProviderState = {
      ...toolProviderState,
      payload: [{ id: "reasoning-final", type: "reasoning" }],
    };
    database.appendAssistantTurn({
      content: "我先读取配置。",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      providerState: toolProviderState,
      runId: first.runId,
      toolCalls: [toolCall],
    });
    const tool = {
      arguments: toolCall.arguments,
      batchId: null,
      conversationId: conversation.id,
      createdAt: new Date().toISOString(),
      diff: null,
      id: crypto.randomUUID(),
      kind: "tool" as const,
      name: toolCall.name,
      result: '{"theme":"dark"}',
      runId: first.runId,
      status: "completed" as const,
    };
    database.appendToolStarted({ ...tool, result: null, status: "running" });
    database.completeTool({
      providerCallId: toolCall.id,
      result: tool.result,
      tool,
    });
    database.appendAssistantTurn({
      content: "配置使用深色主题。",
      conversationId: conversation.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      providerState: finalProviderState,
      runId: first.runId,
      toolCalls: [],
    });
    database.finishRun(first.runId, "completed", null);
    database.createRunWithUserMessage(conversation.id, "继续处理新问题", "test-model");

    const context = new ContextCompiler(database, null).compile({
      contextCompressionConfiguration: {
        mode: "tokens",
        percentageThreshold: 80,
        tokenThreshold: 10_000,
      },
      contextWindowTokens: 20_000,
      conversationId: conversation.id,
      includeImageData: false,
      estimatedSkillCatalogTokens: 0,
      outputReserveTokens: 1_000,
      reservedSkillTokens: 0,
      systemMessage: {
        attachments: [], content: "系统指令", role: "system", toolCallId: null, toolCalls: [],
      },
      toolDefinitions: [],
    });

    const toolAssistant = context.messages.find((message) =>
      message.role === "assistant" && message.toolCalls.length > 0
    );
    const finalAssistant = context.messages.find((message) =>
      message.role === "assistant" && message.content === "配置使用深色主题。"
    );
    expect(toolAssistant?.providerState).toEqual(toolProviderState);
    expect(finalAssistant?.providerState).toBeUndefined();
    database.close();
  });

  it("prefers the canonical JSONL history while retaining SQLite for search", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "agent-context-log-"));
    const database = new AgentDatabase(":memory:");
    try {
      const conversation = database.createConversation(null);
      database.createRunWithUserMessage(conversation.id, "SQLite 中的旧输入", "test-model");
      const log = new ThreadLog(directory);
      log.append(conversation.id, {
        payload: {
          attachmentIds: [],
          content: "界面文本",
          modelContent: "JSONL 中的规范模型输入",
          runId: "run-from-log",
        },
        type: "user_message",
      });

      const context = new ContextCompiler(database, null, log).compile({
        contextCompressionConfiguration: {
          mode: "tokens",
          percentageThreshold: 80,
          tokenThreshold: 10_000,
        },
        contextWindowTokens: 20_000,
        conversationId: conversation.id,
        includeImageData: false,
        estimatedSkillCatalogTokens: 0,
        outputReserveTokens: 1_000,
        reservedSkillTokens: 0,
        systemMessage: {
          attachments: [], content: "系统指令", role: "system", toolCallId: null, toolCalls: [],
        },
        toolDefinitions: [],
      });

      expect(context.messages.map((message) => message.content)).toContain("JSONL 中的规范模型输入");
      expect(context.messages.map((message) => message.content)).not.toContain("SQLite 中的旧输入");
    } finally {
      database.close();
      await rm(directory, { force: true, recursive: true });
    }
  });
});
