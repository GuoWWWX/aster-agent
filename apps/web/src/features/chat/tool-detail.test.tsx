import type { ConversationToolItem } from "@agent/protocol";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MockAgentClient } from "../../runtime/index.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { ToolDetail } from "./tool-detail.js";

const agentClient = new MockAgentClient();
const baseTool: ConversationToolItem = {
  id: "tool",
  kind: "tool",
  conversationId: "conversation",
  runId: "run",
  batchId: null,
  createdAt: "2026-10-19T00:00:00Z",
  name: "get_project_info",
  arguments: "{}",
  result: null,
  diff: null,
  status: "completed",
};

function renderTool(name: string, value: unknown, overrides: Partial<ConversationToolItem> = {}): string {
  return renderToStaticMarkup(<TooltipProvider><ToolDetail
    agentClient={agentClient}
    item={{ ...baseTool, name, result: JSON.stringify({ ok: true, value }), ...overrides }}
    onOpenProjectFile={undefined}
    onOpenSubagent={undefined}
    teamManaged={false}
  /></TooltipProvider>);
}

describe("structured tool detail boundaries", () => {
  it("preserves project facts and directory entry kinds", () => {
    expect(renderTool("get_project_info", { name: "Demo", rootPath: "D:/Demo" })).toContain("D:/Demo");
    const html = renderTool("list_directory", {
      directoryPath: "src",
      entries: [{ kind: "directory", name: "views", path: "src/views" }, { kind: "file", name: "app.ts", path: "src/app.ts" }],
      truncated: true,
    });
    expect(html).toContain("src · 2 项");
    expect(html).toContain('data-kind="directory"');
    expect(html).toContain("src/app.ts");
    expect(html).toContain("仅显示前 1000 项");
  });

  it("keeps requested file ranges visible before the file result arrives", () => {
    const html = renderTool("read_file", null, {
      arguments: JSON.stringify({ path: "src/app.ts", startLine: 20, lineCount: 10 }),
      result: null,
      status: "running",
    });
    expect(html).toContain("src/app.ts · 第 20-29 行");
    expect(html).toContain("正在执行");
  });

  it("keeps search locations and truncation feedback", () => {
    const html = renderTool("search_text", {
      matches: [{ line: 12, path: "src/app.ts", text: "const result = true;" }],
      mode: "literal",
      scannedFiles: 8,
      truncated: true,
    });
    expect(html).toContain("文本搜索 · 1 项 · 扫描 8 个文件");
    expect(html).toContain("src/app.ts:12");
    expect(html).toContain("搜索结果已达到数量限制");
  });

  it("preserves web result links and snippets", () => {
    const html = renderTool("web_search", {
      results: [{ title: "Example", hostname: "example.com", url: "https://example.com", description: "Result excerpt" }],
    });
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("Result excerpt");
  });

  it("preserves file discovery results and attachment offsets", () => {
    expect(renderTool("find_files", { pattern: "*.ts", matches: ["src/app.ts"], truncated: false })).toContain("*.ts · 1 个文件");
    const html = renderTool("read_attachment", {
      name: "notes.txt", content: "private content", startOffset: 0, endOffset: 10, totalCharacters: 50, truncated: true,
    });
    expect(html).toContain("notes.txt · 字符 0-10 / 50");
    expect(html).toContain("可继续按偏移量读取");
    expect(html).not.toContain("private content");
  });

  it("preserves project operation waiting results", () => {
    const html = renderTool("wait_for_project_operation", {
      operation: { conversationTitle: "Other conversation", operationId: "operation", scope: { kind: "file", path: "src/app.ts" }, status: "active" },
      waitStatus: "timeout",
    });
    expect(html).toContain("项目操作等待超时");
    expect(html).toContain("Other conversation · 进行中");
    expect(html).toContain("src/app.ts");
  });

  it("preserves readable conversation identities and their loaded context", () => {
    expect(renderTool("list_agent_conversations", {
      conversations: [{ conversationId: "peer", threadKind: "agent", title: "Research" }],
    })).toContain("Research");
    const html = renderTool("read_agent_conversation", { content: "Prior discussion", estimatedTokens: 120 });
    expect(html).toContain("对话上下文 · 约 120 tokens");
    expect(html).toContain("Prior discussion");
  });

  it("preserves received message text and timeout feedback", () => {
    const html = renderTool("wait_for_agent_message", {
      message: { content: "Ready for review", conversationId: "conversation", senderConversationId: "peer", senderTitle: "Reviewer" },
    });
    expect(html).toContain("Ready for review");
    expect(html).toContain("Reviewer");
    expect(renderTool("wait_for_agent_message", { message: null, status: "timeout" })).toContain("等待期间没有收到新消息");
  });

  it("preserves subagent names, status and results", () => {
    const html = renderTool("list_subagents", {
      tasks: [{ avatarIcon: null, childConversationId: "child", error: null, id: "task", name: "Reviewer", result: "All checks passed", status: "completed", title: "Review changes" }],
    });
    expect(html).toContain("Reviewer");
    expect(html).toContain("All checks passed");
    expect(html).toContain("已完成");
    expect(html).toContain('aria-label="在侧边打开 Subagent 对话：Reviewer"');
  });

  it("preserves skill identity and user questions", () => {
    const skill = renderTool("load_skill", { skill: { name: "imagegen" } });
    expect(skill).toContain("已加载技能 · imagegen");
    expect(skill).toContain("技能使用说明已载入本轮对话");
    expect(renderTool("request_user_input", {}, { arguments: JSON.stringify({ questions: [{ question: "Choose a theme" }] }) })).toContain("Choose a theme");
  });

  it("preserves the terminal command and actual completed output", () => {
    const html = renderTool("run_command", {
      workingDirectory: "D:/Demo", command: "pnpm test", commandId: "command", completedAt: "2026-10-19T00:00:02Z",
      startedAt: "2026-10-19T00:00:00Z", exitCode: 0, mode: "batch", stderr: "", stdout: "10 tests passed", status: "completed",
      timedOut: false, truncated: false, terminal: { displayName: "PowerShell", outputEncoding: "utf-8" },
    }, { arguments: JSON.stringify({ command: "pnpm test" }) });
    const text = html.replace(/<[^>]*>/gu, "");
    expect(html).toContain("PowerShell");
    expect(text).toContain("pnpm test");
    expect(text).toContain("10 tests passed");
  });

  it("preserves error details when structured results cannot be parsed", () => {
    const html = renderTool("search_text", null, { status: "failed", result: JSON.stringify({ ok: false, error: "Permission denied" }) });
    expect(html).toContain('role="alert"');
    expect(html).toContain("失败原因");
    expect(html).toContain("Permission denied");
  });
});
