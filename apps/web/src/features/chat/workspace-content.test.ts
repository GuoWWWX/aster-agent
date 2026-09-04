import { describe, expect, it } from "vitest";

import type {
  ConversationAgentMessageItem,
  ConversationMessageItem,
  ConversationModelRetryItem,
  ConversationModelSelection,
  ConversationToolItem,
  ModelRuntimeStatus,
} from "@agent/protocol";

import {
  createRestoredRunProgresses,
  collectSubagentPendingApprovals,
  commandTerminalClipboardText,
  commandTerminalHeaderLabel,
  contextCompactionLabel,
  contextCompactionDurationMs,
  contextCompactionTooltip,
  fileChangeSummary,
  formatToolPayload,
  formatConversationTime,
  formatRunDuration,
  forceableContextCompactionId,
  getConversationRunProgressInsertIndex,
  getConversationRunDurationInsertIndexes,
  getModelActivityInsertIndex,
  getRepeatedAssistantFailureMessageIds,
  getFinalCompletedAssistantMessageIds,
  getLatestActiveToolId,
  groupToolBatches,
  groupRunActivities,
  isRunningContextCompaction,
  modelRetryStatusLabel,
  normalizeModelActivityPreview,
  parseAttachmentViewResult,
  projectSubagentMessagesForParentTimeline,
  projectTimelineForActiveRun,
  describeConversationError,
  representativeToolName,
  reasoningEndpointColor,
  resolveConversationPathIconKind,
  resolveConversationPathScope,
  resolveInitialConversationModelSelection,
  runtimeBadgeLabel,
  resolveSubmittedTeamGraphTitle,
  stripLegacyErrorInstanceId,
  submittedTeamWorkItems,
  toolBatchLabel,
  toolBatchExecutionMode,
  stripLeadingThinkingSummary,
} from "./workspace-content.js";

describe("model activity preview", () => {
  it("removes emphasis markers and separates adjacent reasoning summaries", () => {
    expect(normalizeModelActivityPreview(
      "**Analyzing repeated password prompts****Planning SSH command encoding tests**",
    )).toBe("Analyzing repeated password prompts · Planning SSH command encoding tests");
    expect(normalizeModelActivityPreview("***Inspecting files***")).toBe("Inspecting files");
    expect(normalizeModelActivityPreview("Searching src/**/*.ts")).toBe("Searching src/**/*.ts");
  });
});

describe("attachment view result", () => {
  it("parses public attachment references returned by the image viewer tool", () => {
    const attachment = {
      contextTokens: 0,
      conversationId: "00000000-0000-4000-8000-000000000001",
      createdAt: "2026-09-04T06:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000002",
      kind: "image",
      messageId: "00000000-0000-4000-8000-000000000003",
      mimeType: "image/png",
      name: "screen.png",
      projectPath: null,
      sizeBytes: 128,
      source: "upload",
      truncated: false,
    } as const;

    expect(parseAttachmentViewResult(JSON.stringify({
      ok: true,
      value: { attachments: [attachment] },
    }))).toEqual([attachment]);
    expect(parseAttachmentViewResult(JSON.stringify({
      ok: true,
      value: { attachments: [{ ...attachment, storedPath: "C:/private/screen.png" }] },
    }))).toBeNull();
  });
});

describe("Team WorkItem collaboration graph placement", () => {
  it("extracts a submitted WorkItem only from its successful tool result", () => {
    const tool: ConversationToolItem = {
      arguments: "{}",
      batchId: null,
      conversationId: "00000000-0000-4000-8000-000000000211",
      createdAt: "2026-08-31T08:00:00.000Z",
      diff: null,
      executionMode: "serial",
      id: "00000000-0000-4000-8000-000000000212",
      kind: "tool",
      name: "submit_team_work_item",
      result: JSON.stringify({
        ok: true,
        value: {
          id: "00000000-0000-4000-8000-000000000213",
          teamId: "team-default",
          teamInstanceId: "00000000-0000-4000-8000-000000000215",
          title: "实现 Agent 协作图",
        },
      }),
      runId: "00000000-0000-4000-8000-000000000214",
      status: "completed",
    };
    expect(submittedTeamWorkItems(tool)).toEqual([{
      id: "00000000-0000-4000-8000-000000000213",
      teamId: "team-default",
      teamInstanceId: "00000000-0000-4000-8000-000000000215",
      title: "实现 Agent 协作图",
    }]);
    expect(submittedTeamWorkItems({ ...tool, status: "failed" })).toEqual([]);
  });

  it("uses the submitted Team instance name for the graph title", () => {
    const workItem = {
      id: "00000000-0000-4000-8000-000000000213",
      teamId: "team-default",
      teamInstanceId: "00000000-0000-4000-8000-000000000215",
      title: "实现 Agent 协作图",
    };

    expect(resolveSubmittedTeamGraphTitle(
      workItem,
      [{ id: workItem.teamInstanceId, name: "默认团队" }],
      [{ id: workItem.teamId, name: "默认团队模板" }],
    )).toBe("默认团队 · Agent 协作图");
    expect(resolveSubmittedTeamGraphTitle(workItem, [], [
      { id: workItem.teamId, name: "默认团队模板" },
    ])).toBe("默认团队模板 · Agent 协作图");
  });
});

describe("conversation path scope", () => {
  it("shows a shared team member conversation under the team hierarchy", () => {
    expect(resolveConversationPathScope(
      null,
      { teamId: "team-default", teamWorkItemId: null },
      [{ id: "team-default", name: "默认团队" }],
    )).toEqual({ kind: "team", label: "默认团队" });
  });

  it("keeps ordinary project and temporary conversation paths unchanged", () => {
    expect(resolveConversationPathScope(
      { name: "Demo" },
      { teamId: "team-default", teamWorkItemId: null },
      [{ id: "team-default", name: "默认团队" }],
    )).toEqual({ kind: "project", label: "Demo" });
    expect(resolveConversationPathScope(
      null,
      { teamId: null, teamWorkItemId: null },
      [],
    )).toEqual({ kind: "temporary", label: "临时对话" });
  });

  it("uses the same icon categories as the conversation tree", () => {
    expect(resolveConversationPathIconKind("project", {
      avatarIcon: "sparkles",
      parentConversationId: null,
      threadKind: "agent",
    })).toBe("conversation");
    expect(resolveConversationPathIconKind("team", {
      avatarIcon: "sparkles",
      parentConversationId: null,
      threadKind: "agent",
    })).toBe("agent");
    expect(resolveConversationPathIconKind("project", {
      avatarIcon: "sparkles",
      parentConversationId: "source",
      threadKind: "agent",
    })).toBe("agent");
    expect(resolveConversationPathIconKind("project", {
      avatarIcon: null,
      parentConversationId: "source",
      threadKind: "team_lead",
    })).toBe("team_lead");
  });
});

describe("command terminal presentation", () => {
  it("shows only the shell name in the terminal header", () => {
    expect(commandTerminalHeaderLabel({ displayName: "PWSH（PowerShell 7）" }))
      .toBe("PWSH（PowerShell 7）");
    expect(commandTerminalHeaderLabel(null)).toBe("命令行");
  });

  it("copies the visible command and output without internal metadata", () => {
    expect(commandTerminalClipboardText("Get-Location", "D:\\Code\\Project"))
      .toBe("$ Get-Location\n\nD:\\Code\\Project");
    expect(commandTerminalClipboardText("Write-Output ok", ""))
      .toBe("$ Write-Output ok");
  });
});

describe("Subagent approvals", () => {
  it("restores only approvals that belong to each Subagent's active run", () => {
    const activeTool = {
      ...tool("run_command", { arguments: '{"command":"ping github.com"}' }),
      status: "awaiting_approval" as const,
    };
    const staleTool = {
      ...activeTool,
      id: "00000000-0000-4000-8000-000000000099",
      runId: "00000000-0000-4000-8000-000000000098",
    };
    const approvals = collectSubagentPendingApprovals(
      [{ activeRunId: activeTool.runId, id: activeTool.conversationId, title: "Ping GitHub" }],
      new Map([[activeTool.conversationId, [activeTool, staleTool]]]),
    );

    expect(approvals).toEqual([{
      childConversationId: activeTool.conversationId,
      childTitle: "Ping GitHub",
      tool: activeTool,
    }]);
  });
});

describe("initial conversation model selection", () => {
  const recentSelection = {
    modelId: "recent-model",
    providerId: "00000000-0000-4000-8000-000000000001",
    reasoning: { kind: "effort", value: "high" },
  } satisfies ConversationModelSelection;
  const status = { recentSelection } as ModelRuntimeStatus;

  it("uses the shared recent model and reasoning for a legacy conversation without a snapshot", () => {
    expect(resolveInitialConversationModelSelection(null, status)).toBe(recentSelection);
  });

  it("keeps a conversation snapshot ahead of the shared recent selection", () => {
    const sessionSelection = {
      ...recentSelection,
      modelId: "conversation-model",
      reasoning: { kind: "effort", value: "low" },
    } satisfies ConversationModelSelection;

    expect(resolveInitialConversationModelSelection(sessionSelection, status))
      .toBe(sessionSelection);
  });
});

describe("reasoning strength color progression", () => {
  it("moves through blue, light blue, blue-violet, and deep purple stops", () => {
    expect(reasoningEndpointColor(0)).toBe("var(--reasoning-blue)");
    expect(reasoningEndpointColor(34)).toBe("var(--reasoning-light-blue)");
    expect(reasoningEndpointColor(68)).toBe("var(--reasoning-blue-violet)");
    expect(reasoningEndpointColor(100)).toBe("var(--reasoning-maximum)");
  });

  it("interpolates between adjacent stops and clamps invalid progress", () => {
    expect(reasoningEndpointColor(51)).toBe(
      "color-mix(in srgb, var(--reasoning-light-blue) 50%, var(--reasoning-blue-violet) 50%)",
    );
    expect(reasoningEndpointColor(-10)).toBe("var(--reasoning-blue)");
    expect(reasoningEndpointColor(Number.NaN)).toBe("var(--reasoning-blue)");
  });
});

function tool(
  name: string,
  options: { arguments?: string; diff?: string | null } = {},
): ConversationToolItem {
  return {
    arguments: options.arguments ?? "{}",
    batchId: null,
    conversationId: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-01-01T00:00:00.000Z",
    diff: options.diff ?? null,
    id: `00000000-0000-4000-8000-${name.padEnd(12, "0").slice(0, 12)}`,
    kind: "tool",
    name,
    result: null,
    runId: "00000000-0000-4000-8000-000000000002",
    status: "completed",
  };
}

function assistantMessage(
  id: string,
  content: string,
  options: {
    durationMs?: number | null;
    modelId?: string;
    reasoningContent?: string;
    status?: ConversationMessageItem["status"];
  } = {},
): ConversationMessageItem {
  return {
    attachments: [],
    completedAt: "2026-01-01T00:00:30.000Z",
    content,
    conversationId: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-01-01T00:00:00.000Z",
    durationMs: options.durationMs ?? null,
    id,
    kind: "message",
    modelId: options.modelId ?? "deepseek-v4-flash",
    ...(options.reasoningContent === undefined
      ? {}
      : { reasoningContent: options.reasoningContent }),
    role: "assistant",
    runId: "00000000-0000-4000-8000-000000000002",
    status: options.status ?? "completed",
  };
}

function subagentTaskResult(): ConversationAgentMessageItem {
  return {
    content: "Subagent 已完成 Ping。",
    conversationId: "00000000-0000-4000-8000-000000000001",
    createdAt: "2026-01-01T00:00:30.000Z",
    id: "00000000-0000-4000-8000-taskresult00",
    kind: "agent_message",
    messageType: "task_result",
    readAt: null,
    replyInstruction: null,
    runId: "00000000-0000-4000-8000-000000000003",
    senderConversationId: "00000000-0000-4000-8000-000000000004",
    senderTitle: "Ping Subagent",
    status: "unread",
    taskId: "00000000-0000-4000-8000-000000000005",
  };
}

describe("run activity projection", () => {
  it("hides legacy Subagent messages and removes their receipt divider before grouping", () => {
    const legacyNotification = {
      ...subagentTaskResult(),
      content: "已执行 ping，结果正常。",
      messageType: "notification" as const,
    };
    const finalAnswer = assistantMessage(
      "assistant-final",
      "Subagent 已完成 Ping。\n\n---\n\n解析 IP：198.18.0.211。",
      { durationMs: 89_000 },
    );
    const projected = projectSubagentMessagesForParentTimeline(
      [tool("spawn_subagent"), legacyNotification, finalAnswer],
      new Set([legacyNotification.senderConversationId]),
    );

    expect(projected).toHaveLength(2);
    expect(projected[1]).toMatchObject({
      content: "Subagent 已完成 Ping。\n\n解析 IP：198.18.0.211。",
      id: finalAnswer.id,
    });
    expect(groupRunActivities(projected)[0]).toMatchObject({
      durationMs: 89_000,
      kind: "run_activity",
    });
  });

  it("preserves normal Agent messages and intentional Markdown dividers", () => {
    const persistentAgentMessage = {
      ...subagentTaskResult(),
      content: "长期 Agent 已完成。",
      messageType: "message" as const,
      senderConversationId: "00000000-0000-4000-8000-000000000099",
    };
    const finalAnswer = assistantMessage(
      "assistant-final",
      "第一部分。\n\n---\n\n第二部分。",
      { durationMs: 10_000 },
    );

    expect(projectSubagentMessagesForParentTimeline(
      [persistentAgentMessage, finalAnswer],
      new Set(["00000000-0000-4000-8000-000000000004"]),
    )).toEqual([persistentAgentMessage, finalAnswer]);
  });

  it("keeps interleaved DeepSeek reasoning and tools in one work process", () => {
    const firstReasoning = assistantMessage("assistant-reasoning-1", "", {
      reasoningContent: "先读取配置。",
    });
    const secondReasoning = assistantMessage("assistant-reasoning-2", "", {
      reasoningContent: "配置已读取，继续检查日志。",
    });
    const finalAnswer = assistantMessage("assistant-final", "问题已经处理。", {
      durationMs: 30_000,
      reasoningContent: "汇总工具结果。",
    });
    const firstTool = tool("read_file");
    const secondTool = {
      ...tool("search_text"),
      id: "00000000-0000-4000-8000-second000000",
    };

    const projected = groupRunActivities([
      firstReasoning,
      firstTool,
      secondReasoning,
      secondTool,
      finalAnswer,
    ]);

    expect(projected).toHaveLength(2);
    expect(projected[0]).toMatchObject({
      durationMs: 30_000,
      kind: "run_activity",
      runId: firstReasoning.runId,
    });
    expect(projected[0]?.kind === "run_activity"
      ? projected[0].items.map((item) => item.kind)
      : []).toEqual([
      "activity_reasoning",
      "tool",
      "activity_reasoning",
      "tool",
      "activity_reasoning",
    ]);
    expect(projected[1]).toMatchObject({
      content: "问题已经处理。",
      durationMs: null,
      id: "assistant-final",
      kind: "message",
    });
    expect(projected[1]?.kind === "message" ? projected[1].reasoningContent : null)
      .toBeUndefined();
  });

  it("keeps a model retry at its original position inside the work process", () => {
    const firstTool = tool("run_command");
    const retry: ConversationModelRetryItem = {
      attempt: 1,
      conversationId: firstTool.conversationId,
      createdAt: "2026-09-02T00:00:01.000Z",
      id: "00000000-0000-4000-8000-retry000000",
      kind: "model_retry",
      maxAttempts: 5,
      reason: "连接暂时中断",
      retryInMs: null,
      runId: firstTool.runId,
      status: "completed",
      updatedAt: "2026-09-02T00:00:02.000Z",
    };
    const secondTool = {
      ...tool("read_file"),
      id: "00000000-0000-4000-8000-second000000",
    };
    const finalAnswer = assistantMessage("assistant-final", "处理完成。", {
      durationMs: 12_000,
    });

    const projected = groupRunActivities([firstTool, retry, secondTool, finalAnswer]);

    expect(projected).toHaveLength(2);
    expect(projected[0]?.kind === "run_activity"
      ? projected[0].items.map((item) => item.kind)
      : []).toEqual(["tool", "model_retry", "tool"]);
    expect(projected[1]).toMatchObject({ content: "处理完成。", kind: "message" });
  });

  it("moves tool preambles into the work process but keeps the final answer outside", () => {
    const preamble = assistantMessage("assistant-preamble", "我先检查一下项目。", {
      reasoningContent: "需要读取目录。",
    });
    const finalAnswer = assistantMessage("assistant-final", "检查完成。", {
      durationMs: 12_000,
    });

    const projected = groupRunActivities([preamble, tool("read_file"), finalAnswer]);

    expect(projected[0]?.kind === "run_activity"
      ? projected[0].items.map((item) => item.kind)
      : []).toEqual(["activity_reasoning", "activity_progress", "tool"]);
    expect(projected[0]?.kind === "run_activity"
      ? projected[0].items[1]
      : null).toMatchObject({ content: "我先检查一下项目。" });
    expect(projected[1]).toMatchObject({ content: "检查完成。", kind: "message" });
  });

  it("hides a leading tagged thinking summary from completed work history", () => {
    const taggedSummary = assistantMessage(
      "assistant-tagged-reasoning",
      "<thinking>Reading backend command surface</thinking>",
    );
    const finalAnswer = assistantMessage("assistant-final", "检查完成。", {
      durationMs: 12_000,
    });

    const projected = groupRunActivities([taggedSummary, tool("read_file"), finalAnswer]);

    expect(projected[0]?.kind === "run_activity"
      ? projected[0].items.map((item) => item.kind)
      : []).toEqual(["tool"]);
    expect(JSON.stringify(projected)).not.toContain("Reading backend command surface");
    expect(JSON.stringify(projected)).not.toContain("<thinking>");
    expect(stripLeadingThinkingSummary(
      "<think>先检查项目</think>\n\n最终回答",
    )).toBe("最终回答");
    expect(stripLeadingThinkingSummary(
      "<thinking>只是一段摘要</thinking>",
    )).toBe("");
  });

  it("keeps a plain answer unchanged when the run has no reasoning or tools", () => {
    const finalAnswer = assistantMessage("assistant-final", "直接回答。", {
      durationMs: 5_000,
    });

    expect(groupRunActivities([finalAnswer])).toEqual([finalAnswer]);
  });

  it("moves a tool-only run duration onto its work process", () => {
    const finalAnswer = assistantMessage("assistant-final", "命令执行完成。", {
      durationMs: 8_000,
    });

    const projected = groupRunActivities([tool("run_command"), finalAnswer]);

    expect(projected[0]).toMatchObject({ durationMs: 8_000, kind: "run_activity" });
    expect(projected[1]).toMatchObject({
      content: "命令执行完成。",
      durationMs: null,
      kind: "message",
    });
  });

  it("combines a Subagent continuation duration into the existing work process", () => {
    const firstAnswer = assistantMessage("assistant-first", "Subagent 已完成 Ping。", {
      durationMs: 89_000,
    });
    const continuationAnswer = {
      ...assistantMessage("assistant-continuation", "解析 IP：198.18.0.211。", {
        durationMs: 4_000,
      }),
      runId: "00000000-0000-4000-8000-000000000006",
    };

    const projected = groupRunActivities([
      tool("spawn_subagent"),
      firstAnswer,
      subagentTaskResult(),
      continuationAnswer,
    ]);

    expect(projected[0]).toMatchObject({
      durationMs: 93_000,
      kind: "run_activity",
    });
    expect(projected[1]).toMatchObject({ durationMs: null, id: "assistant-first" });
    expect(projected[3]).toMatchObject({
      durationMs: null,
      id: "assistant-continuation",
    });
    expect([...getConversationRunDurationInsertIndexes(projected).entries()]).toEqual([]);
  });

  it("combines an automatic continuation's activity into one work process", () => {
    const firstRunId = "00000000-0000-4000-8000-000000000002";
    const continuationRunId = "00000000-0000-4000-8000-000000000006";
    const firstAnswer = assistantMessage("assistant-first", "Subagent 正在后台执行。", {
      durationMs: 9_000,
    });
    const continuationReasoning = {
      ...assistantMessage("assistant-continuation-reasoning", "", {
        reasoningContent: "收到 Subagent 结果，继续核对。",
      }),
      runId: continuationRunId,
    };
    const continuationTool = {
      ...tool("read_file"),
      id: "00000000-0000-4000-8000-continuationtool",
      runId: continuationRunId,
    };
    const continuationAnswer = {
      ...assistantMessage("assistant-continuation", "结果已经核对完成。", {
        durationMs: 4_000,
      }),
      runId: continuationRunId,
    };

    const projected = groupRunActivities([
      { ...tool("spawn_subagent"), runId: firstRunId },
      firstAnswer,
      subagentTaskResult(),
      continuationReasoning,
      continuationTool,
      continuationAnswer,
    ]);

    expect(projected.filter((item) => item.kind === "run_activity")).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      durationMs: 13_000,
      kind: "run_activity",
      runId: firstRunId,
      runIds: [firstRunId, continuationRunId],
    });
    expect(projected[0]?.kind === "run_activity"
      ? projected[0].items.map((item) => item.kind)
      : []).toEqual(["tool", "activity_reasoning", "tool"]);
    expect(projected.at(-1)).toMatchObject({
      content: "结果已经核对完成。",
      durationMs: null,
      kind: "message",
    });
  });

  it("hides legacy GPT-5.6 reasoning summaries from completed work processes", () => {
    const summary = assistantMessage("assistant-summary", "", {
      modelId: "gpt-5.6-terra",
      reasoningContent: "Preparing subagent to ping Alibaba site",
    });
    const finalAnswer = assistantMessage("assistant-final", "任务完成。", {
      durationMs: 10_000,
      modelId: "gpt-5.6-terra",
    });

    const projected = groupRunActivities([summary, tool("spawn_subagent"), finalAnswer]);

    expect(projected[0]?.kind === "run_activity"
      ? projected[0].items.map((item) => item.kind)
      : []).toEqual(["tool"]);
    expect(projected[1]).toMatchObject({ content: "任务完成。", kind: "message" });
  });

  it("hides a legacy GPT-5.6 summary even when the run used no tools", () => {
    const finalAnswer = assistantMessage("assistant-final", "直接回答。", {
      durationMs: 4_000,
      modelId: "gpt-5.6-terra",
      reasoningContent: "Drafting concise response",
    });

    const projected = groupRunActivities([finalAnswer]);

    expect(projected).toHaveLength(1);
    expect(projected[0]).toMatchObject({
      content: "直接回答。",
      durationMs: 4_000,
      kind: "message",
    });
    expect(projected[0]?.kind === "message" ? projected[0].reasoningContent : null)
      .toBeUndefined();
  });

  it("keeps context compaction as a standalone divider outside the work process", () => {
    const compaction = {
      ...tool("compact_context"),
      result: JSON.stringify({ compressedMessageCount: 6, trigger: "automatic" }),
    };
    const finalAnswer = assistantMessage("assistant-final", "继续回答。", {
      durationMs: 7_000,
      reasoningContent: "完整思考",
    });

    const projected = groupRunActivities([compaction, tool("read_file"), finalAnswer]);

    expect(projected).toHaveLength(3);
    expect(projected[0]).toMatchObject({ kind: "tool", name: "compact_context" });
    expect(projected[1]).toMatchObject({ kind: "run_activity" });
    expect(projected[2]).toMatchObject({ content: "继续回答。", kind: "message" });
  });
});

describe("run progress duration", () => {
  it("restores the running indicator when an active conversation is reopened", () => {
    expect(createRestoredRunProgresses(null, 1_000)).toEqual([]);
    expect(createRestoredRunProgresses("run-1", 1_000)).toEqual([{
      anchorTimelineItemId: null,
      outputStartedAt: null,
      runId: "run-1",
      startedAt: 1_000,
    }]);
  });

  it("uses the requested compact Chinese duration formats", () => {
    const startedAt = 0;

    expect(formatRunDuration(startedAt, 59_000)).toBe("59秒");
    expect(formatRunDuration(startedAt, 61_000)).toBe("1分 1秒");
    expect(formatRunDuration(startedAt, 3_661_000)).toBe("1小时 1分 1秒");
    expect(formatRunDuration(startedAt, 90_061_000)).toBe("1天 1小时 1分 1秒");
  });

  it("uses the compaction divider as the run timer while compression is active", () => {
    const running = {
      ...tool("compact_context"),
      createdAt: "2026-09-03T12:00:00.000Z",
      status: "running" as const,
    };
    const completed = {
      ...running,
      result: JSON.stringify({ compressedMessageCount: 7, durationMs: 72_000 }),
      status: "completed" as const,
    };

    expect(isRunningContextCompaction(running)).toBe(true);
    expect(isRunningContextCompaction(completed)).toBe(false);
    expect(contextCompactionDurationMs(running, Date.parse("2026-09-03T12:01:05.000Z")))
      .toBe(65_000);
    expect(contextCompactionDurationMs(completed, Date.parse("2026-09-03T12:02:00.000Z")))
      .toBe(72_000);
    expect(contextCompactionDurationMs({ ...completed, result: null }, Date.now())).toBeNull();
    expect(contextCompactionTooltip(completed, Date.parse("2026-09-03T12:02:00.000Z")))
      .toBe("已处理 7 条历史消息 · 用时 1分 12秒");
  });

  it("reports failed and cancelled compaction without claiming record impact", () => {
    const compaction = tool("compact_context");

    expect(contextCompactionLabel({ ...compaction, status: "failed" }))
      .toBe("上下文压缩失败");
    expect(contextCompactionLabel({
      ...compaction,
      arguments: JSON.stringify({ trigger: "manual" }),
      status: "cancelled",
    }))
      .toBe("上下文压缩已暂停");
    expect(contextCompactionLabel({ ...compaction, status: "cancelled" }))
      .toBe("上下文压缩已取消");
  });

  it("keeps completed compaction compact and moves details into its tooltip", () => {
    const completed = {
      ...tool("compact_context"),
      result: JSON.stringify({
        compressedMessageCount: 23,
        durationMs: 65_000,
        trigger: "manual",
      }),
      status: "completed" as const,
    };
    const failed = {
      ...tool("compact_context"),
      result: JSON.stringify({
        durationMs: 9_000,
        error: { message: "模型上下文长度超出限制。" },
        trigger: "manual",
      }),
      status: "failed" as const,
    };

    expect(contextCompactionLabel(completed)).toBe("已压缩");
    expect(contextCompactionTooltip(completed)).toBe("已处理 23 条历史消息 · 用时 1分 5秒");
    expect(contextCompactionTooltip(failed))
      .toBe("模型上下文长度超出限制。 · 用时 9秒");
  });

  it("offers force compaction only until the user sends another message", () => {
    const failed = { ...tool("compact_context"), status: "failed" as const };
    const paused = {
      ...tool("compact_context", { arguments: JSON.stringify({ trigger: "manual" }) }),
      status: "cancelled" as const,
    };

    expect(forceableContextCompactionId([failed], null)).toBe(failed.id);
    expect(forceableContextCompactionId([paused], null)).toBe(paused.id);
    expect(forceableContextCompactionId([failed], "active-run")).toBeNull();
    expect(forceableContextCompactionId([
      failed,
      {
        ...assistantMessage("next-user", "继续对话"),
        role: "user" as const,
      },
    ], null)).toBeNull();
  });

  it("keeps model retry progress and terminal status explicit", () => {
    expect(modelRetryStatusLabel({
      attempt: 2,
      maxAttempts: 5,
      retryInMs: 2_000,
      status: "retrying",
    })).toBe("正在重新连接 2/5 · 2 秒后重试");
    expect(modelRetryStatusLabel({
      attempt: 2,
      maxAttempts: 5,
      retryInMs: null,
      status: "completed",
    })).toBe("连接已恢复 · 重试 2 次");
    expect(modelRetryStatusLabel({
      attempt: 5,
      maxAttempts: 5,
      retryInMs: null,
      status: "failed",
    })).toBe("重新连接失败 · 已重试 5/5");
  });

  it("keeps a restored running indicator at the top of the active assistant turn", () => {
    const timeline = [
      { id: "user-1", kind: "message", role: "user" },
      { id: "assistant-1", kind: "message", role: "assistant" },
      { id: "tool-batch-1", kind: "tool_batch", tools: [{ id: "tool-1" }] },
    ];

    expect(getConversationRunProgressInsertIndex(timeline, null)).toBe(1);
    expect(getConversationRunProgressInsertIndex(timeline, "tool-1")).toBe(1);
  });

  it("keeps the running indicator with its anchored user turn", () => {
    const timeline = [
      { id: "user-1", kind: "message", role: "user" },
      { id: "assistant-1", kind: "message", role: "assistant" },
      { id: "user-2", kind: "message", role: "user" },
      { id: "assistant-2", kind: "message", role: "assistant" },
      { id: "tool-batch-2", kind: "tool_batch", tools: [{ id: "tool-2" }] },
    ];

    expect(getConversationRunProgressInsertIndex(timeline, "tool-2")).toBe(3);
  });

  it("places resumed model activity below the retry it supersedes", () => {
    const timeline = [
      { id: "user-1", kind: "message", role: "user", runId: null },
      {
        id: "run-activity-1",
        items: [{ id: "retry-1", kind: "model_retry", runId: "run-1" }],
        kind: "run_activity",
        runId: "run-1",
      },
    ];

    expect(getModelActivityInsertIndex(timeline, "run-1", "user-1")).toBe(1);
    expect(getModelActivityInsertIndex(timeline, "run-2", "user-1")).toBe(1);
  });

  it("finds a tool anchor inside a combined work process", () => {
    const timeline = [
      { id: "user-1", kind: "message", role: "user" },
      { id: "run-activity-1", items: [{ id: "tool-1" }], kind: "run_activity" },
    ];

    expect(getConversationRunProgressInsertIndex(timeline, "tool-1")).toBe(1);
  });

  it("inserts a completed run duration before its tool calls", () => {
    const indexes = getConversationRunDurationInsertIndexes([
      { kind: "message", role: "user" },
      { kind: "tool_batch" },
      { durationMs: 21_000, kind: "message", role: "assistant" },
    ]);

    expect([...indexes.entries()]).toEqual([[1, [21_000]]]);
  });

  it("keeps a failed retry-only run duration in the conversation", () => {
    const indexes = getConversationRunDurationInsertIndexes([
      { kind: "message", role: "user" },
      {
        durationMs: 37_000,
        kind: "model_retry",
        runId: "run-1",
        status: "failed",
      },
    ]);

    expect([...indexes.entries()]).toEqual([[1, [37_000]]]);
  });

  it("shows one duration when a completed run contains multiple assistant messages", () => {
    const indexes = getConversationRunDurationInsertIndexes([
      { kind: "message", role: "user" },
      { durationMs: 40_000, kind: "message", role: "assistant", runId: "run-1" },
      { durationMs: 40_000, kind: "message", role: "assistant", runId: "run-1" },
    ]);

    expect([...indexes.entries()]).toEqual([[1, [40_000]]]);
  });

  it("combines automatic continuation runs into one duration for the user turn", () => {
    const indexes = getConversationRunDurationInsertIndexes([
      { kind: "message", role: "user" },
      { durationMs: 40_000, kind: "message", role: "assistant", runId: "run-1" },
      { durationMs: 21_000, kind: "message", role: "assistant", runId: "run-2" },
    ]);

    expect([...indexes.entries()]).toEqual([[1, [61_000]]]);
  });

  it("keeps legacy messages without a run id to one duration per user turn", () => {
    const indexes = getConversationRunDurationInsertIndexes([
      { kind: "message", role: "user" },
      { durationMs: 40_000, kind: "message", role: "assistant" },
      { durationMs: 40_000, kind: "message", role: "assistant" },
    ]);

    expect([...indexes.entries()]).toEqual([[1, [40_000]]]);
  });

  it("keeps each Agent message Run duration beside its own result", () => {
    const indexes = getConversationRunDurationInsertIndexes([
      { kind: "agent_message" },
      { durationMs: 11_000, kind: "message", role: "assistant", runId: "run-1" },
      { kind: "agent_message" },
      { durationMs: 1_000, kind: "message", role: "assistant", runId: "run-2" },
    ]);

    expect([...indexes.entries()]).toEqual([
      [1, [11_000]],
      [3, [1_000]],
    ]);
  });

  it("shows the completion time only on the final message of a run", () => {
    const ids = getFinalCompletedAssistantMessageIds([
      { id: "intermediate", kind: "message", role: "assistant", runId: "run-1", status: "completed" },
      { id: "command", kind: "tool", runId: "run-1" },
      { id: "final", kind: "message", role: "assistant", runId: "run-1", status: "completed" },
    ]);

    expect([...ids]).toEqual(["final"]);
  });
});

describe("runtime model badge", () => {
  it("shows the active conversation model instead of the application default", () => {
    expect(runtimeBadgeLabel(false, "deepseek-v4-flash")).toBe("deepseek-v4-flash");
  });

  it("keeps the preview runtime label", () => {
    expect(runtimeBadgeLabel(true, "deepseek-v4-flash")).toBe("浏览器预览");
  });
});

describe("tool detail auto expansion", () => {
  it("expands only the latest running or approval-blocked tool", () => {
    expect(getLatestActiveToolId([
      { id: "tool-1", kind: "tool", status: "running" },
      { id: "tool-2", kind: "tool", status: "completed" },
      { id: "tool-3", kind: "tool", status: "running" },
    ])).toBe("tool-3");

    expect(getLatestActiveToolId([
      { id: "tool-1", kind: "tool", status: "completed" },
      { id: "tool-2", kind: "tool", status: "awaiting_approval" },
    ])).toBe("tool-2");
  });

  it("keeps completed tool results collapsed by default", () => {
    expect(getLatestActiveToolId([
      { id: "tool-1", kind: "tool", status: "completed" },
      { id: "tool-2", kind: "tool", status: "failed" },
    ])).toBeNull();
  });

  it("does not reopen an older running tool after the newest call completes", () => {
    expect(getLatestActiveToolId([
      { id: "tool-1", kind: "tool", status: "running" },
      { id: "tool-2", kind: "tool", status: "completed" },
    ])).toBeNull();
  });
});

describe("conversation message time", () => {
  const now = new Date(2026, 7, 27, 16, 30);

  it("uses a contextual local timestamp for recent and historical messages", () => {
    expect(formatConversationTime(new Date(2026, 7, 27, 9, 5).toISOString(), now)).toBe("09:05");
    expect(formatConversationTime(new Date(2026, 7, 26, 9, 5).toISOString(), now)).toBe("昨天 09:05");
    expect(formatConversationTime(new Date(2026, 6, 3, 9, 5).toISOString(), now)).toBe("7月3日 09:05");
    expect(formatConversationTime(new Date(2025, 11, 3, 9, 5).toISOString(), now))
      .toBe("2025年12月3日 09:05");
  });
});

describe("conversation error display", () => {
  it("shows the same adjacent failure only once after an automatic continuation", () => {
    const duplicateIds = getRepeatedAssistantFailureMessageIds([
      {
        content: "模型返回了无法处理的响应，请重试或切换模型。",
        id: "failure-1",
        kind: "message",
        role: "assistant",
        runId: "run-1",
        status: "failed",
      },
      {
        content: "模型返回了无法处理的响应，请重试或切换模型。",
        id: "failure-2",
        kind: "message",
        role: "assistant",
        runId: "run-2",
        status: "failed",
      },
    ]);

    expect([...duplicateIds]).toEqual(["failure-2"]);
  });

  it("keeps distinct failures and failures from separate user turns", () => {
    const duplicateIds = getRepeatedAssistantFailureMessageIds([
      {
        content: "第一次失败",
        id: "failure-1",
        kind: "message",
        role: "assistant",
        runId: "run-1",
        status: "failed",
      },
      {
        content: "第二次失败",
        id: "failure-2",
        kind: "message",
        role: "assistant",
        runId: "run-2",
        status: "failed",
      },
      { content: "重试", id: "user-2", kind: "message", role: "user" },
      {
        content: "第二次失败",
        id: "failure-3",
        kind: "message",
        role: "assistant",
        runId: "run-3",
        status: "failed",
      },
    ]);

    expect([...duplicateIds]).toEqual([]);
  });

  it("hides correlation ids persisted by older desktop builds", () => {
    expect(stripLegacyErrorInstanceId(
      "模型未返回可显示内容。（错误编号：123e4567-e89b-42d3-a456-426614174000)",
    )).toBe("模型未返回可显示内容。");
  });

  it("hides internal agent error ids from raw tool payloads", () => {
    const visible = formatToolPayload(JSON.stringify({
      agentError: {
        code: "MODEL_PROVIDER_UNAVAILABLE",
        details: {
          providerMessage: "upstream unavailable, request_id=req_abc123",
          status: 503,
          technicalMessage: "trace id: 123e4567-e89b-42d3-a456-426614174000",
        },
        id: "123e4567-e89b-42d3-a456-426614174000",
        message: "模型服务暂时不可用。",
      },
      error: "模型服务暂时不可用。 接口错误：HTTP 503：upstream unavailable",
    }));

    expect(visible).toContain("upstream unavailable");
    expect(visible).not.toContain("123e4567-e89b-42d3-a456-426614174000");
    expect(visible).not.toContain("req_abc123");
    expect(visible).not.toContain('"id"');
  });

  it("separates a model failure's user message from its technical detail", () => {
    const presentation = describeConversationError(
      "模型服务暂时不可用，请稍后再试。 接口错误：HTTP 502：gateway timeout。",
    );

    expect(presentation.category).toBe("provider");
    expect(presentation.title).toBe("模型服务返回错误");
    expect(presentation.summary).toBe("模型服务返回错误");
    expect(presentation.message).toBe("模型服务暂时不可用，请稍后再试。");
    expect(presentation.technicalDetail).toBe("接口错误：HTTP 502：gateway timeout。");
    expect(presentation.detail).toContain("HTTP 502");
  });

  it("does not let a hidden Subagent result split an automatic continuation", () => {
    const indexes = getConversationRunDurationInsertIndexes([
      { kind: "message", role: "user" },
      { kind: "agent_message", messageType: "task_result" },
      { durationMs: 11_000, kind: "message", role: "assistant", runId: "run-1" },
    ]);

    expect([...indexes.entries()]).toEqual([[1, [11_000]]]);
  });

  it("presents legacy LangGraph recursion failures as a controlled run limit", () => {
    const presentation = describeConversationError(
      "软件内部发生错误，请重试。 内部错误详情：GraphRecursionError: Recursion limit of 25 reached without hitting a stop condition.",
    );

    expect(presentation.category).toBe("limit");
    expect(presentation.title).toBe("执行达到安全上限");
    expect(presentation.message).toContain("请缩小任务范围或补充停止条件");
    expect(presentation.technicalDetail).toContain("GraphRecursionError");
    expect(presentation.message).not.toContain("GraphRecursionError");
  });

  it("keeps internal implementation details out of the visible error message", () => {
    const presentation = describeConversationError(
      "软件内部发生错误，请重试。 内部错误详情：SqliteError: database is locked",
    );

    expect(presentation.category).toBe("internal");
    expect(presentation.message).toBe("软件内部发生错误，请稍后重试。如果持续出现，请重新启动软件。");
    expect(presentation.technicalDetail).toContain("SqliteError");
  });

  it("keeps tool failures under the tool scope", () => {
    const presentation = describeConversationError(
      "命令执行失败：进程退出代码 1。",
      "tool",
    );

    expect(presentation.category).toBe("tool");
    expect(presentation.title).toBe("工具调用失败");
    expect(presentation.message).toContain("进程退出代码");
    expect(presentation.detail).toContain("进程退出代码");
  });

  it("does not present local operation failures as model failures", () => {
    const presentation = describeConversationError(
      "无法从这条回复创建分支对话。",
      "operation",
    );

    expect(presentation.category).toBe("internal");
    expect(presentation.title).toBe("操作失败");
    expect(presentation.summary).toBe("无法从这条回复创建分支对话。");
  });

  it("classifies an upstream 504 as a model timeout", () => {
    const presentation = describeConversationError(
      "模型请求失败。接口错误：HTTP 504：gateway timeout。",
    );

    expect(presentation.category).toBe("timeout");
    expect(presentation.title).toBe("模型请求超时");
  });
});

describe("tool batch execution mode", () => {
  it("uses one live activity slot while the model resumes reasoning", () => {
    const first = tool("read_file");
    const second = {
      ...tool("run_command"),
      id: "00000000-0000-4000-8000-second000000",
      status: "running" as const,
    };

    expect(projectTimelineForActiveRun([first, second], first.runId, false))
      .toEqual([]);
  });

  it("shows only currently active tools in the live activity slot", () => {
    const first = tool("read_file");
    const second = {
      ...tool("run_command"),
      id: "00000000-0000-4000-8000-second000000",
      status: "running" as const,
    };

    expect(projectTimelineForActiveRun([first, second], first.runId, true))
      .toEqual([second]);
  });

  it("restores every tool after the run finishes", () => {
    const first = tool("read_file");
    const second = {
      ...tool("run_command"),
      id: "00000000-0000-4000-8000-second000000",
    };

    expect(projectTimelineForActiveRun([first, second], null, false))
      .toEqual([first, second]);
  });

  it("groups consecutive tools into one collapsible batch", () => {
    const first = tool("run_command");
    const second = {
      ...tool("run_command"),
      batchId: "00000000-0000-4000-8000-000000000003",
      id: "00000000-0000-4000-8000-second000000",
    };

    expect(groupToolBatches([first, second])).toHaveLength(1);
  });

  it("keeps model retry progress outside adjacent tool batches", () => {
    const first = tool("run_command");
    const retry: ConversationModelRetryItem = {
      attempt: 1,
      conversationId: first.conversationId,
      createdAt: "2026-09-02T00:00:00.000Z",
      id: "00000000-0000-4000-8000-retry000000",
      kind: "model_retry",
      maxAttempts: 5,
      reason: "接口错误：HTTP 402：Insufficient Balance",
      retryInMs: 1_000,
      runId: first.runId,
      status: "retrying",
      updatedAt: "2026-09-02T00:00:01.000Z",
    };
    const second = {
      ...tool("run_command"),
      id: "00000000-0000-4000-8000-second000000",
    };

    expect(groupToolBatches([first, retry, second]).map((item) => item.kind))
      .toEqual(["tool", "model_retry", "tool"]);
  });

  it("identifies a parallel batch from runtime metadata", () => {
    const first = tool("run_command");
    const second = { ...tool("run_command"), id: "00000000-0000-4000-8000-second000000" };
    expect(toolBatchExecutionMode([
      { ...first, executionMode: "parallel", batchId: "00000000-0000-4000-8000-batch000000" },
      { ...second, executionMode: "parallel", batchId: "00000000-0000-4000-8000-batch000000" },
    ])).toBe("parallel");
  });

  it("does not label a mixed batch as parallel", () => {
    const first = tool("run_command");
    const second = { ...tool("run_command"), id: "00000000-0000-4000-8000-second000000" };
    expect(toolBatchExecutionMode([
      { ...first, executionMode: "parallel" },
      { ...second, executionMode: "serial" },
    ])).toBeNull();
  });
});

describe("tool batch summary", () => {
  it("shows the highest-priority two categories and uses the highest-priority icon", () => {
    const tools = [tool("read_file"), tool("run_command"), tool("write_file"), tool("apply_patch")];

    expect(toolBatchLabel(tools)).toBe("编辑 2 个文件，运行 1 条命令");
    expect(representativeToolName(tools)).toBe("write_file");
  });

  it("orders command execution before file reads", () => {
    const tools = [tool("read_file"), tool("run_command")];

    expect(toolBatchLabel(tools)).toBe("运行 1 条命令，读取 1 个文件");
    expect(representativeToolName(tools)).toBe("run_command");
  });

  it("uses team-member terminology for a managed team execution", () => {
    expect(toolBatchLabel([tool("spawn_subagent"), tool("wait_for_subagents")], true))
      .toBe("协调 2 次团队成员");
  });

  it("summarizes the unified browser tool as browser activity", () => {
    expect(toolBatchLabel([tool("browser_control")])).toBe("操作 1 次浏览器");
    expect(representativeToolName([tool("browser_control")])).toBe("browser_control");
  });

  it("keeps the persistent side-terminal tool separate from ordinary commands", () => {
    expect(toolBatchLabel([tool("terminal_control"), tool("run_command")]))
      .toBe("操作 1 次侧边终端，运行 1 条命令");
    expect(representativeToolName([tool("terminal_control")])).toBe("terminal_control");
  });
});

describe("file change summary", () => {
  it("extracts the file name and added/deleted line counts", () => {
    const summary = fileChangeSummary(tool("replace_in_file", {
      diff: [
        "--- src/convert.rs",
        "+++ src/convert.rs",
        "@@ -1,2 +1,4 @@",
        " context",
        "-old",
        "+new",
        "+added",
      ].join("\n"),
    }));

    expect(summary).toEqual({
      action: "已编辑",
      additions: 2,
      deletions: 1,
      path: "src/convert.rs",
    });
  });

  it("uses the deleted file header instead of /dev/null", () => {
    const summary = fileChangeSummary(tool("delete_file", {
      diff: [
        "--- src/obsolete.txt",
        "+++ /dev/null",
        "@@ -1 +0,0 @@",
        "-gone",
      ].join("\n"),
    }));

    expect(summary?.path).toBe("src/obsolete.txt");
    expect(summary?.additions).toBe(0);
    expect(summary?.deletions).toBe(1);
  });
});
