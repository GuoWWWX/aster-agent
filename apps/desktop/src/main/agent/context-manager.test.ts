import { describe, expect, it } from "vitest";

import type { StoredContextMessage } from "../storage/agent-database.js";
import {
  buildManagedContext,
  parseContextSummary
} from "./context-manager.js";

function message(
  sequence: number,
  role: StoredContextMessage["role"],
  content: string,
  overrides: Partial<StoredContextMessage> = {}
): StoredContextMessage {
  return {
    attachmentIds: [],
    content,
    role,
    runId: `run-${sequence}`,
    sequence,
    toolCallId: null,
    toolCalls: [],
    ...overrides
  };
}

function build(sourceMessages: StoredContextMessage[], threshold = 5_000) {
  return buildManagedContext({
    checkpoint: null,
    compressionMode: "tokens",
    compressionThresholdTokens: threshold,
    estimatedSystemTokens: 100,
    estimatedToolDefinitionTokens: 100,
    outputReserveTokens: 500,
    sourceMessages
  });
}

describe("context manager", () => {
  it("counts attachment tokens separately and lets them trigger old-turn compaction", () => {
    const source = [1, 2, 3, 4].map((turn) => ({
      ...message(turn, "user", `第 ${turn} 轮`),
      attachments: [{
        content: `attachment ${turn}`,
        contextTokens: 2_500,
        id: `attachment-${turn}`,
        kind: "text" as const,
        mimeType: "text/plain",
        name: `notes-${turn}.txt`,
        projectPath: null,
        readState: "full" as const,
        source: "upload" as const,
        truncated: false
      }]
    }));

    const plan = buildManagedContext({
      checkpoint: null,
      compressionMode: "tokens",
      compressionThresholdTokens: 6_000,
      estimatedSystemTokens: 100,
      estimatedToolDefinitionTokens: 100,
      outputReserveTokens: 500,
      sourceMessages: source
    });

    expect(plan.compactionCandidates.map((item) => item.sequence)).toEqual([1]);
    expect(plan.usage.estimatedAttachmentTokens).toBe(5_000);
    expect(plan.usage.estimatedInputTokens).toBeGreaterThanOrEqual(5_100);
    expect(plan.messages.flatMap((item) => item.attachments).map((item) => item.id))
      .toEqual(["attachment-3", "attachment-4"]);
  });

  it("prunes an old large tool result while preserving its call/result pair", () => {
    const largeOutput = `begin\n${"ordinary output\n".repeat(1_500)}ERROR failed build\nend`;
    const source = [
      message(1, "user", "第一轮"),
      message(2, "assistant", "", {
        toolCalls: [{ arguments: "{}", id: "call-old", name: "run_command" }]
      }),
      message(3, "tool", largeOutput, { toolCallId: "call-old" }),
      message(4, "user", "第二轮"),
      message(5, "assistant", "第二轮完成"),
      message(6, "user", "第三轮")
    ];

    const plan = build(source);
    const toolResult = plan.messages.find((item) => item.role === "tool");
    const toolCall = plan.messages.find((item) => item.toolCalls.length > 0);

    expect(toolCall?.toolCalls[0]?.id).toBe("call-old");
    expect(toolResult?.toolCallId).toBe("call-old");
    expect(toolResult?.content).toContain("工具输出已裁剪");
    expect(toolResult?.content).toContain("ERROR failed build");
    expect(toolResult?.content.length).toBeLessThan(largeOutput.length);
    expect(plan.compactionCandidates).toEqual([]);
  });

  it("offers only complete old turns for compaction and protects the latest two", () => {
    const source = [1, 2, 3, 4].flatMap((turn) => [
      message(turn * 10, "user", `第${turn}轮-${"x".repeat(8_000)}`, { runId: `run-${turn}` }),
      message(turn * 10 + 1, "assistant", `第${turn}轮完成`, { runId: `run-${turn}` })
    ]);

    const plan = build(source, 6_000);

    expect(plan.compactionCandidates.map((item) => item.runId)).toEqual([
      "run-1",
      "run-1"
    ]);
    expect(plan.compactionCandidates.some((item) => item.runId === "run-3")).toBe(false);
    expect(plan.compactionCandidates.some((item) => item.runId === "run-4")).toBe(false);
    expect(plan.messages.some((item) => item.content.startsWith("第3轮-"))).toBe(true);
    expect(plan.messages.some((item) => item.content.startsWith("第4轮-"))).toBe(true);
    expect(plan.messages.some((item) => item.content.startsWith("第1轮-"))).toBe(false);
  });

  it("replaces covered source messages with the persisted checkpoint", () => {
    const source = [
      message(1, "user", "旧问题"),
      message(2, "assistant", "旧回答"),
      message(3, "user", "当前问题")
    ];
    const plan = buildManagedContext({
      checkpoint: {
        conversationId: "conversation-id",
        coveredThroughSequence: 2,
        createdAt: "2026-08-16T00:00:00.000Z",
        summary: JSON.stringify({ goals: ["保留旧目标"] }),
        updatedAt: "2026-08-16T00:00:00.000Z"
      },
      compressionMode: "tokens",
      compressionThresholdTokens: 10_000,
      estimatedSystemTokens: 100,
      estimatedToolDefinitionTokens: 100,
      outputReserveTokens: 500,
      sourceMessages: source
    });

    expect(plan.messages[0]?.role).toBe("system");
    expect(plan.messages[0]?.content).toContain("保留旧目标");
    expect(plan.messages.some((item) => item.content === "旧问题")).toBe(false);
    expect(plan.messages.some((item) => item.content === "当前问题")).toBe(true);
    expect(plan.usage.omittedMessageCount).toBe(2);
  });

  it("appends keyword-retrieved history after the chronological context", () => {
    const source = [
      message(1, "user", "当前问题"),
      message(2, "assistant", "当前回答"),
    ];
    const plan = buildManagedContext({
      checkpoint: null,
      compressionMode: "tokens",
      compressionThresholdTokens: 10_000,
      estimatedSystemTokens: 100,
      estimatedToolDefinitionTokens: 100,
      outputReserveTokens: 500,
      relevantMessages: [
        message(10, "user", "历史上讨论过登录页表单校验"),
        message(11, "assistant", "当时决定复用现有校验组件"),
      ],
      sourceMessages: source,
    });

    expect(plan.messages.slice(0, 2).map((item) => item.content)).toEqual([
      "当前问题",
      "当前回答",
    ]);
    const related = plan.messages.at(-1);
    expect(related?.role).toBe("system");
    expect(related?.content).toContain("相关历史");
    expect(related?.content).toContain("登录页表单校验");
    expect(related?.content).toContain("复用现有校验组件");
    expect(plan.usage.estimatedReferenceTokens).toBeGreaterThan(0);
  });

  it("reserves Skill capacity before selecting historical turns", () => {
    const source = [1, 2, 3].flatMap((turn) => [
      message(turn * 10, "user", `第${turn}轮-${"x".repeat(2_000)}`),
      message(turn * 10 + 1, "assistant", `第${turn}轮完成`),
    ]);
    const withoutSkillReservation = buildManagedContext({
      checkpoint: null,
      compressionMode: "tokens",
      compressionThresholdTokens: 4_000,
      estimatedSystemTokens: 100,
      estimatedToolDefinitionTokens: 100,
      outputReserveTokens: 500,
      sourceMessages: source,
    });
    const withSkillReservation = buildManagedContext({
      checkpoint: null,
      compressionMode: "tokens",
      compressionThresholdTokens: 4_000,
      estimatedSystemTokens: 100,
      estimatedToolDefinitionTokens: 100,
      outputReserveTokens: 500,
      reservedSkillTokens: 2_500,
      sourceMessages: source,
    });

    expect(withSkillReservation.usage.estimatedSystemTokens)
      .toBe(withoutSkillReservation.usage.estimatedSystemTokens + 2_500);
    expect(withSkillReservation.usage.skillReserveTokens).toBe(2_500);
    expect(withSkillReservation.messages.length)
      .toBeLessThan(withoutSkillReservation.messages.length);
  });

  it("reserves mutable task-list capacity before selecting historical turns", () => {
    const source = [1, 2, 3].flatMap((turn) => [
      message(turn * 10, "user", `第${turn}轮-${"x".repeat(2_000)}`),
      message(turn * 10 + 1, "assistant", `第${turn}轮完成`),
    ]);
    const withoutTaskListReservation = buildManagedContext({
      checkpoint: null,
      compressionMode: "tokens",
      compressionThresholdTokens: 4_000,
      estimatedSystemTokens: 100,
      estimatedToolDefinitionTokens: 100,
      outputReserveTokens: 500,
      sourceMessages: source,
    });
    const withTaskListReservation = buildManagedContext({
      checkpoint: null,
      compressionMode: "tokens",
      compressionThresholdTokens: 4_000,
      estimatedSystemTokens: 100,
      estimatedToolDefinitionTokens: 100,
      outputReserveTokens: 500,
      reservedTaskListTokens: 2_500,
      sourceMessages: source,
    });

    expect(withTaskListReservation.usage.estimatedSystemTokens)
      .toBe(withoutTaskListReservation.usage.estimatedSystemTokens + 2_500);
    expect(withTaskListReservation.usage.estimatedTaskListTokens).toBe(2_500);
    expect(withTaskListReservation.messages.length)
      .toBeLessThan(withoutTaskListReservation.messages.length);
  });

  it("accepts fenced structured summaries and rejects incomplete ones", () => {
    const complete = {
      artifactRefs: [],
      commands: ["pnpm test"],
      constraints: [],
      decisions: [],
      errors: [],
      filesChanged: [],
      filesRead: [],
      goals: ["完成上下文管理"],
      pendingWork: [],
      rejectedApproaches: [],
      requirements: [],
      taskStatus: [],
      testResults: ["tests passed"]
    };

    expect(parseContextSummary(`\`\`\`json\n${JSON.stringify(complete)}\n\`\`\``))
      .toBe(JSON.stringify(complete));
    expect(() => parseContextSummary(JSON.stringify({ goals: [] }))).toThrow();
  });
});
