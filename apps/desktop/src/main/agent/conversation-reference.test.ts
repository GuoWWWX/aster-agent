import { describe, expect, it } from "vitest";

import { estimateContextTokens } from "@agent/protocol";

import { AgentDatabase } from "../storage/agent-database.js";
import {
  buildConversationReferenceBundle,
  resolveConversationReferenceBudget,
} from "./conversation-reference.js";

function finishTurn(
  database: AgentDatabase,
  conversationId: string,
  userContent: string,
  assistantContent: string,
): void {
  const run = database.createRunWithUserMessage(conversationId, userContent, "test-model");
  database.appendAssistantTurn({
    content: assistantContent,
    conversationId,
    messageId: crypto.randomUUID(),
    modelId: "test-model",
    runId: run.runId,
    toolCalls: [],
  });
  database.finishRun(run.runId, "completed", null);
}

describe("conversation references", () => {
  it("uses the latest checkpoint and only messages after the covered sequence", () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    finishTurn(database, source.id, "压缩前问题", "压缩前回答");
    database.renameConversation(source.id, "来源对话");
    const covered = database.listContextMessages(source.id).at(-1)?.sequence;
    if (covered === undefined) throw new Error("Expected source messages.");
    database.saveContextCheckpoint(source.id, covered, "最新压缩摘要");
    finishTurn(database, source.id, "压缩后问题", "压缩后回答");

    const reference = buildConversationReferenceBundle({
      budgetTokens: 2_000,
      currentConversationId: current.id,
      database,
      referencedConversationIds: [source.id],
    });

    expect(reference.content).toContain("最新压缩摘要");
    expect(reference.content).toContain("压缩后问题");
    expect(reference.content).toContain("压缩后回答");
    expect(reference.content).not.toContain("压缩前问题");
    database.close();
  });

  it("keeps the newest uncompressed history inside a hard token budget", () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    for (let turn = 1; turn <= 8; turn += 1) {
      finishTurn(
        database,
        source.id,
        `问题-${turn}-${"x".repeat(600)}`,
        `回答-${turn}-${"y".repeat(600)}`,
      );
    }
    database.renameConversation(source.id, "长对话");

    const reference = buildConversationReferenceBundle({
      budgetTokens: 700,
      currentConversationId: current.id,
      database,
      referencedConversationIds: [source.id],
    });

    expect(estimateContextTokens(reference.content)).toBeLessThanOrEqual(700);
    expect(reference.estimatedTokens).toBeLessThanOrEqual(700);
    expect(reference.content).toContain("问题-8-");
    expect(reference.content).not.toContain("问题-1-");
    expect(reference.content).toContain("Reference budget omitted");
    expect(reference.pagination[0]?.hasMore).toBe(true);
    const nextBeforeSequence = reference.pagination[0]?.nextBeforeSequence;
    if (nextBeforeSequence === null || nextBeforeSequence === undefined) {
      throw new Error("Expected a pagination cursor.");
    }
    const nextPage = buildConversationReferenceBundle({
      beforeSequence: nextBeforeSequence,
      budgetTokens: 700,
      currentConversationId: current.id,
      database,
      referencedConversationIds: [source.id],
    });
    expect(nextPage.content).toContain("问题-7-");
    expect(nextPage.content).not.toContain("问题-8-");
    database.close();
  });

  it("prioritizes an older matching turn and keeps its complete run context", () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    finishTurn(
      database,
      source.id,
      "ORION-7443 的部署参数放在哪里？",
      "ORION-7443 使用 7443 端口，配置位于 config/orion.json。",
    );
    for (let turn = 1; turn <= 8; turn += 1) {
      finishTurn(
        database,
        source.id,
        `普通问题-${turn}-${"x".repeat(500)}`,
        `普通回答-${turn}-${"y".repeat(500)}`,
      );
    }

    const reference = buildConversationReferenceBundle({
      budgetTokens: 900,
      currentConversationId: current.id,
      database,
      query: "查找 ORION-7443 的部署信息",
      referencedConversationIds: [source.id],
    });

    expect(reference.content).toContain("ORION-7443 的部署参数");
    expect(reference.content).toContain("config/orion.json");
    expect(estimateContextTokens(reference.content)).toBeLessThanOrEqual(900);
    database.close();
  });

  it("can retrieve relevant history from before the latest checkpoint", () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    finishTurn(database, source.id, "记录 FALCON-9087 的结论", "FALCON-9087 应启用只读模式。");
    const covered = database.listContextMessages(source.id).at(-1)?.sequence;
    if (covered === undefined) throw new Error("Expected source messages.");
    database.saveContextCheckpoint(source.id, covered, "此前讨论已经归档。");
    finishTurn(database, source.id, "最近的问题", "最近的回答");

    const reference = buildConversationReferenceBundle({
      budgetTokens: 800,
      currentConversationId: current.id,
      database,
      query: "FALCON-9087 的结论是什么",
      referencedConversationIds: [source.id],
    });

    expect(reference.content).toContain("FALCON-9087 应启用只读模式");
    expect(reference.content).toContain("最近的问题");
    database.close();
  });

  it("can continue a targeted search before a returned message sequence", () => {
    const database = new AgentDatabase(":memory:");
    const current = database.createConversation(null);
    const source = database.createConversation(null);
    finishTurn(database, source.id, "SEARCH-PAGE 旧问题", "SEARCH-PAGE 旧回答");
    const recentRun = database.createRunWithUserMessage(
      source.id,
      "SEARCH-PAGE 新问题",
      "test-model",
    );
    database.appendAssistantTurn({
      content: "SEARCH-PAGE 新回答",
      conversationId: source.id,
      messageId: crypto.randomUUID(),
      modelId: "test-model",
      runId: recentRun.runId,
      toolCalls: [],
    });
    database.finishRun(recentRun.runId, "completed", null);
    const recentUserSequence = database.listContextMessages(source.id)
      .find((message) => message.runId === recentRun.runId && message.role === "user")
      ?.sequence;
    if (recentUserSequence === undefined) throw new Error("Expected recent user message.");

    const reference = buildConversationReferenceBundle({
      beforeSequence: recentUserSequence,
      budgetTokens: 1_000,
      currentConversationId: current.id,
      database,
      query: "SEARCH-PAGE",
      referencedConversationIds: [source.id],
    });

    expect(reference.content).toContain("SEARCH-PAGE 旧问题");
    expect(reference.content).toContain("SEARCH-PAGE 旧回答");
    expect(reference.content).not.toContain("SEARCH-PAGE 新问题");
    expect(reference.pagination[0]).toMatchObject({
      beforeSequence: recentUserSequence,
      conversationId: source.id,
    });
    database.close();
  });

  it("caps the shared reference budget independently of a very large model window", () => {
    expect(resolveConversationReferenceBudget(10_000)).toBe(1_500);
    expect(resolveConversationReferenceBudget(1_000_000)).toBe(12_288);
  });
});
