import { describe, expect, it } from "vitest";

import type { ConversationMessageItem, ConversationToolItem } from "@agent/protocol";

import { formatConversationRunMarkdown } from "./conversation-copy.js";

const conversationId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";

function message(content: string): ConversationMessageItem {
  return {
    attachments: [],
    content,
    conversationId,
    createdAt: "2026-01-01T00:00:00.000Z",
    id: "00000000-0000-4000-8000-000000000003",
    kind: "message",
    modelId: "model",
    role: "assistant",
    runId,
    status: "completed",
  };
}

function tool(name: string, options: Partial<ConversationToolItem> = {}): ConversationToolItem {
  return {
    arguments: "{}",
    batchId: null,
    conversationId,
    createdAt: "2026-01-01T00:00:00.000Z",
    diff: null,
    id: "00000000-0000-4000-8000-000000000004",
    kind: "tool",
    name,
    result: null,
    runId,
    status: "completed",
    ...options,
  };
}

describe("formatConversationRunMarkdown", () => {
  it("keeps a plain assistant response compatible", () => {
    const result = formatConversationRunMarkdown([], message("# 已完成\n\n正文"));
    expect(result).toBe("## 模型回复\n\n# 已完成\n\n正文\n");
  });

  it("exports commands, stdout, stderr and execution metadata", () => {
    const command = tool("run_command", {
      arguments: JSON.stringify({ command: "pnpm test", shell: "powershell" }),
      result: JSON.stringify({
        ok: true,
        value: {
          command: "pnpm test",
          exitCode: 1,
          status: "failed",
          stderr: "failed output",
          stdout: "test output",
          terminal: { shell: "powershell" },
          timedOut: false,
          truncated: false,
        },
      }),
    });
    const result = formatConversationRunMarkdown([command], message("完成"));
    expect(result).toContain("## 执行命令");
    expect(result).toContain("```powershell\npnpm test\n```");
    expect(result).toContain("### stdout\n\n```text\ntest output\n```");
    expect(result).toContain("### stderr\n\n```text\nfailed output\n```");
    expect(result).toContain("退出码：1");
  });

  it("exports file diffs and preserves mixed timeline order", () => {
    const read = tool("read_file", {
      arguments: JSON.stringify({ path: "src/a.ts" }),
      result: JSON.stringify({ ok: true, value: { content: "const a = 1;", endLine: 1, path: "src/a.ts", startLine: 1 } }),
    });
    const change = tool("replace_in_file", {
      diff: "--- a/src/a.ts\n+++ b/src/a.ts\n@@\n-old\n+new",
      arguments: JSON.stringify({ path: "src/a.ts" }),
    });
    const result = formatConversationRunMarkdown([read, change], message("已修改"));
    expect(result.indexOf("## 读取文件")).toBeLessThan(result.indexOf("## 文件变更"));
    expect(result).toContain("路径：src/a.ts");
    expect(result).toContain("```diff\n--- a/src/a.ts");
  });

  it("keeps intermediate assistant messages and tools in timeline order", () => {
    const intermediate = { ...message("先读取文件"), id: "00000000-0000-4000-8000-000000000005" };
    const command = tool("run_command", {
      arguments: JSON.stringify({ command: "echo done" }),
      result: JSON.stringify({ ok: true, value: { command: "echo done", status: "completed", stdout: "done", stderr: "", timedOut: false, truncated: false } }),
    });
    const final = message("任务完成");
    const result = formatConversationRunMarkdown([intermediate, command, final], final);
    expect(result.indexOf("先读取文件")).toBeLessThan(result.indexOf("## 执行命令"));
    expect(result.indexOf("## 执行命令")).toBeLessThan(result.indexOf("任务完成"));
  });

  it("uses a longer fence when tool output contains backticks", () => {
    const command = tool("run_command", {
      arguments: JSON.stringify({ command: "echo code" }),
      result: JSON.stringify({ ok: true, value: { command: "echo code", status: "completed", stdout: "```\ninside", stderr: "", timedOut: false, truncated: false } }),
    });
    const result = formatConversationRunMarkdown([command], message("完成"));
    expect(result).toContain("````text\n```\ninside\n````");
  });

  it("renders bounded errors without exposing internal error ids", () => {
    const failed = tool("search_text", {
      result: JSON.stringify({ ok: false, error: "请求失败 request_id=abc-123" }),
    });
    const result = formatConversationRunMarkdown([failed], message("失败"));
    expect(result).toContain("错误：请求失败");
    expect(result).not.toContain("abc-123");
  });
});
