import { describe, expect, it } from "vitest";

import type { ConversationToolItem } from "@agent/protocol";

import {
  createRestoredRunProgresses,
  fileChangeSummary,
  formatToolPayload,
  formatConversationTime,
  formatRunDuration,
  getConversationRunDurationInsertIndexes,
  getFinalCompletedAssistantMessageIds,
  groupToolBatches,
  describeConversationError,
  representativeToolName,
  stripLegacyErrorInstanceId,
  toolBatchLabel,
  toolBatchExecutionMode,
} from "./workspace-content.js";

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

  it("inserts a completed run duration before its tool calls", () => {
    const indexes = getConversationRunDurationInsertIndexes([
      { kind: "message", role: "user" },
      { kind: "tool_batch" },
      { durationMs: 21_000, kind: "message", role: "assistant" },
    ]);

    expect([...indexes.entries()]).toEqual([[1, [21_000]]]);
  });

  it("shows one duration when a completed run contains multiple assistant messages", () => {
    const indexes = getConversationRunDurationInsertIndexes([
      { kind: "message", role: "user" },
      { durationMs: 40_000, kind: "message", role: "assistant", runId: "run-1" },
      { durationMs: 40_000, kind: "message", role: "assistant", runId: "run-1" },
    ]);

    expect([...indexes.entries()]).toEqual([[1, [40_000]]]);
  });

  it("keeps legacy messages without a run id to one duration per user turn", () => {
    const indexes = getConversationRunDurationInsertIndexes([
      { kind: "message", role: "user" },
      { durationMs: 40_000, kind: "message", role: "assistant" },
      { durationMs: 40_000, kind: "message", role: "assistant" },
    ]);

    expect([...indexes.entries()]).toEqual([[1, [40_000]]]);
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
