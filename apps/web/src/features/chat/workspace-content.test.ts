import { describe, expect, it } from "vitest";

import type {
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
  fileChangeSummary,
  formatToolPayload,
  formatConversationTime,
  formatRunDuration,
  getConversationRunProgressInsertIndex,
  getConversationRunDurationInsertIndexes,
  getRepeatedAssistantFailureMessageIds,
  getFinalCompletedAssistantMessageIds,
  getLatestActiveToolId,
  groupToolBatches,
  modelRetryStatusLabel,
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
} from "./workspace-content.js";

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

  it("classifies model failures into a quote title and full detail", () => {
    const presentation = describeConversationError(
      "模型服务暂时不可用，请稍后再试。 接口错误：HTTP 502：gateway timeout。",
    );

    expect(presentation.category).toBe("provider");
    expect(presentation.title).toBe("模型服务返回错误");
    expect(presentation.summary).toBe("模型服务返回错误");
    expect(presentation.detail).toContain("HTTP 502");
  });

  it("keeps tool failures under the tool scope", () => {
    const presentation = describeConversationError(
      "命令执行失败：进程退出代码 1。",
      "tool",
    );

    expect(presentation.category).toBe("tool");
    expect(presentation.title).toBe("工具调用失败");
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
