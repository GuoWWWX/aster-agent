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
    expect(reference.content).toContain("省略更早");
    database.close();
  });

  it("caps the shared reference budget independently of a very large model window", () => {
    expect(resolveConversationReferenceBudget(10_000)).toBe(1_500);
    expect(resolveConversationReferenceBudget(1_000_000)).toBe(8_192);
  });
});
