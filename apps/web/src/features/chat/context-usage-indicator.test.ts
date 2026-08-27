import { describe, expect, it } from "vitest";

import type { ConversationContextUsage } from "@agent/protocol";

import { getContextUsageRows } from "./context-usage-indicator.js";

function usage(overrides: Partial<ConversationContextUsage> = {}): ConversationContextUsage {
  return {
    compressionMode: "percentage",
    compressionThresholdTokens: 80_000,
    estimatedAttachmentTokens: 0,
    estimatedConversationTokens: 1_400,
    estimatedInputTokens: 4_100,
    estimatedReferenceTokens: 0,
    estimatedSkillCatalogTokens: 200,
    estimatedSystemTokens: 2_000,
    estimatedTaskListTokens: 100,
    estimatedToolDefinitionTokens: 500,
    estimatedToolTokens: 200,
    historyCharacters: 4_800,
    includedMessageCount: 6,
    omittedMessageCount: 4,
    outputReserveTokens: 8_192,
    skillReserveTokens: 300,
    ...overrides,
  };
}

describe("getContextUsageRows", () => {
  it("groups context usage with indentation-only hierarchy", () => {
    const rows = getContextUsageRows(usage());

    expect(rows).toMatchObject([
      { label: "系统上下文", level: 0, tokens: 2_200 },
      { label: "基础系统提示词", level: 1, tokens: 1_400 },
      { label: "内置工具", level: 1, tokens: 500 },
      { label: "MCP 工具", level: 1, tokens: 0 },
      { label: "Skill 目录", level: 1, tokens: 200 },
      { label: "当前任务清单", level: 1, tokens: 100 },
      { label: "当前有效会话", level: 0, tokens: 1_600 },
      { label: "对话文本与压缩摘要", level: 1, tokens: 1_400 },
      { label: "工具调用与结果", level: 1, tokens: 200 },
      { label: "文件、图片与引用", level: 1, tokens: 0 },
      { label: "预留容量", level: 0, tokens: 8_492 },
      { label: "模型回复", level: 1, tokens: 8_192 },
      { label: "Skill 加载", level: 1, tokens: 300 },
    ]);
  });

  it("combines selected files, images, and references in the conversation detail", () => {
    const rows = getContextUsageRows(usage({
      estimatedAttachmentTokens: 140,
      estimatedReferenceTokens: 360,
    }));

    expect(rows.find((row) => row.label === "文件、图片与引用"))
      .toMatchObject({ level: 1, tokens: 500 });
  });
});
