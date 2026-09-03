// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AGENT_DIRECTORY_CONFIGURATION,
  type ConversationAttachment,
  type ConversationAgentMessageItem,
  type ConversationPendingMessage,
  type ConversationRunEvent,
  type ConversationTaskList,
  type ConversationToolItem,
} from "@agent/protocol";

import { MockAgentClient } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useWorkbenchUiStore } from "../../stores/workbench-ui-store.js";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationWorkspace, WorkspaceContent } from "./workspace-content.js";

const PARENT_ID = "00000000-0000-4000-8000-000000000001";
const CHILD_ID = "00000000-0000-4000-8000-000000000002";
const RUN_ID = "00000000-0000-4000-8000-000000000003";
const TOOL_ID = "00000000-0000-4000-8000-000000000004";
const WORK_ITEM_ID = "00000000-0000-4000-8000-000000000005";
const MESSAGE_ID = "00000000-0000-4000-8000-000000000006";

function session(input: Partial<ProjectSession> & Pick<ProjectSession, "id" | "title">): ProjectSession {
  return {
    activeRunId: null,
    agentId: null,
    hasUnreadResult: false,
    isArchived: false,
    isPinned: false,
    lastRunStatus: null,
    modelSelection: null,
    parentConversationId: null,
    projectId: null,
    teamId: null,
    threadKind: "agent",
    workspaceRootPath: null,
    ...input,
  };
}

let root: Root | null = null;

function expandWorkProcess(container: HTMLElement): void {
  act(() => container.querySelector<HTMLButtonElement>(
    'button[title="展开工作过程"]',
  )?.click());
}

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  useWorkbenchUiStore.setState({ activeActivity: "conversations" });
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("Conversation timeline location", () => {
  it("scrolls the requested message into view after the timeline loads", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "Team Lead · 默认团队" });
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([{
      attachments: [],
      content: "需要定位的任务消息",
      conversationId: PARENT_ID,
      createdAt: "2026-08-30T00:00:00.000Z",
      id: MESSAGE_ID,
      kind: "message",
      modelId: null,
      role: "user",
      runId: null,
      status: "completed",
    }]);
    const originalScrollIntoView = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            locateTimelineItem={{ id: MESSAGE_ID, requestId: 1 }}
            project={null}
            session={target}
          />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    expect(container.querySelector(
      `[data-conversation-timeline-item="${MESSAGE_ID}"]`,
    )).not.toBeNull();
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "smooth", block: "center" });

    if (originalScrollIntoView === undefined) {
      Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
    } else {
      Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView);
    }
  });
});

describe("Conversation scroll navigation", () => {
  it("opens uncached conversations at the latest message and restores a cached position", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "切换对话滚动位置测试" });
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const renderWorkspace = async (active: boolean): Promise<void> => {
      await act(async () => {
        root?.render(
          <TooltipProvider>
            <ConversationWorkspace
              active={active}
              agentClient={client}
              project={null}
              session={target}
            />
          </TooltipProvider>,
        );
        await flushConversationWorkspace();
      });
    };

    await renderWorkspace(false);
    const messages = container.querySelector<HTMLElement>(
      '.conversation-workspace__messages[aria-label="对话记录"]',
    );
    expect(messages).not.toBeNull();
    if (messages === null) return;
    Object.defineProperties(messages, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1_200, writable: true },
      scrollTop: { configurable: true, value: 0, writable: true },
    });

    await renderWorkspace(true);
    expect(messages.scrollTop).toBe(1_200);

    messages.scrollTop = 240;
    act(() => {
      messages.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(container.querySelector('button[aria-label="回到对话底部"]')).not.toBeNull();
    await renderWorkspace(false);
    messages.scrollTop = 0;

    await renderWorkspace(true);
    expect(messages.scrollTop).toBe(240);

    messages.scrollTop = 600;
    act(() => {
      messages.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    await renderWorkspace(false);
    Object.defineProperty(messages, "scrollHeight", {
      configurable: true,
      value: 1_800,
      writable: true,
    });
    messages.scrollTop = 0;

    await renderWorkspace(true);
    expect(messages.scrollTop).toBe(1_800);
  });

  it("shows a centered return button away from the bottom and scrolls to the latest message", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "滚动到底部测试" });
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace agentClient={client} project={null} session={target} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    const messages = container.querySelector<HTMLElement>(
      '.conversation-workspace__messages[aria-label="对话记录"]',
    );
    expect(messages).not.toBeNull();
    if (messages === null) return;
    Object.defineProperties(messages, {
      clientHeight: { configurable: true, value: 600 },
      scrollHeight: { configurable: true, value: 1_200 },
      scrollTop: { configurable: true, value: 500, writable: true },
    });
    const scrollTo = vi.fn();
    Object.defineProperty(messages, "scrollTo", {
      configurable: true,
      value: scrollTo,
    });

    expect(container.querySelector('button[aria-label="回到对话底部"]')).toBeNull();
    act(() => {
      messages.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    const returnButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="回到对话底部"]',
    );
    expect(returnButton).not.toBeNull();
    expect(returnButton?.className).toContain("left-1/2");
    expect(returnButton?.className).toContain("rounded-full");

    act(() => returnButton?.click());
    expect(scrollTo).toHaveBeenCalledWith({ behavior: "smooth", left: 0, top: 1_200 });

    messages.scrollTop = 600;
    act(() => {
      messages.dispatchEvent(new Event("scroll", { bubbles: true }));
    });
    expect(container.querySelector('button[aria-label="回到对话底部"]')).toBeNull();
  });
});

describe("Tool activity disclosure", () => {
  it("keeps reasoning before and after a tool in one reasoning disclosure", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "连续思考测试" });
    const assistantMessage = (
      id: string,
      content: string,
      reasoningContent?: string,
    ) => ({
      attachments: [],
      completedAt: "2026-09-03T00:00:10.000Z",
      content,
      conversationId: PARENT_ID,
      createdAt: "2026-09-03T00:00:00.000Z",
      durationMs: content.length > 0 ? 8_000 : null,
      id,
      kind: "message" as const,
      modelId: "deepseek-v4-flash",
      ...(reasoningContent === undefined ? {} : { reasoningContent }),
      role: "assistant" as const,
      runId: RUN_ID,
      status: "completed" as const,
    });
    const inspectedTool: ConversationToolItem = {
      arguments: "{}",
      batchId: null,
      conversationId: PARENT_ID,
      createdAt: "2026-09-03T00:00:04.000Z",
      diff: null,
      id: TOOL_ID,
      kind: "tool",
      name: "list_agent_conversations",
      result: "[]",
      runId: RUN_ID,
      status: "completed",
    };
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([
      assistantMessage("reasoning-before-tool", "", "先检查可用的 Agent 对话。"),
      inspectedTool,
      assistantMessage("reasoning-after-tool", "", "已经取得结果，继续形成结论。"),
      assistantMessage("final-answer", "工具顺序测试完成。"),
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace agentClient={client} project={null} session={target} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    expandWorkProcess(container);
    const reasoningButtons = container.querySelectorAll<HTMLButtonElement>(
      'button[title="展开思考过程"]',
    );
    expect(reasoningButtons).toHaveLength(1);
    expect(reasoningButtons[0]?.querySelector(".lucide-eye")).not.toBeNull();
    expect(reasoningButtons[0]?.closest("section")?.className).not.toContain("border");
    act(() => reasoningButtons[0]?.click());
    const reasoningBlock = reasoningButtons[0]?.closest("section");
    expect(reasoningButtons[0]?.nextElementSibling?.id).toBe(
      reasoningButtons[0]?.getAttribute("aria-controls"),
    );
    expect(reasoningBlock?.textContent).toContain("先检查可用的 Agent 对话。");
    expect(reasoningBlock?.textContent).toContain("已查看 Agent 对话");
    expect(reasoningBlock?.textContent).toContain("已经取得结果，继续形成结论。");
  });

  it("keeps only the newest running tool open and closes it when it completes", async () => {
    const client = new MockAgentClient();
    const target = session({
      activeRunId: RUN_ID,
      id: PARENT_ID,
      title: "工具自动展开测试",
    });
    const firstTool: ConversationToolItem = {
      arguments: JSON.stringify({ path: "src/first.ts" }),
      batchId: null,
      conversationId: PARENT_ID,
      createdAt: "2026-09-04T00:00:00.000Z",
      diff: null,
      id: TOOL_ID,
      kind: "tool",
      name: "read_file",
      result: null,
      runId: RUN_ID,
      status: "running",
    };
    const secondTool: ConversationToolItem = {
      ...firstTool,
      arguments: JSON.stringify({ query: "second-query" }),
      createdAt: "2026-09-04T00:00:01.000Z",
      id: "00000000-0000-4000-8000-000000000014",
      name: "search_text",
    };
    let runEventListener: ((event: ConversationRunEvent) => void) | null = null;
    vi.spyOn(client, "onConversationRunEvent").mockImplementation((listener) => {
      runEventListener = listener;
      return () => {
        runEventListener = null;
      };
    });
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([firstTool]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace agentClient={client} project={null} session={target} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    expect(container.querySelectorAll('button[aria-label="收起调用详情"]')).toHaveLength(1);
    expect(container.textContent).toContain("first.ts");
    expect(container.textContent).not.toContain("执行中");
    expect(container.querySelector(
      'article[data-status="running"] .tool-timeline-item__label-text',
    )?.textContent).toContain("first.ts");

    act(() => {
      runEventListener?.({
        conversationId: PARENT_ID,
        runId: RUN_ID,
        tool: secondTool,
        type: "tool.started",
      });
    });

    const newestExpandedToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="收起调用详情"]',
    );
    expect(container.querySelectorAll('button[aria-label="收起调用详情"]')).toHaveLength(1);
    expect(newestExpandedToggle?.closest("article")?.textContent).toContain("second-query");
    expect(newestExpandedToggle?.closest("article")?.textContent).not.toContain("first.ts");

    act(() => {
      runEventListener?.({
        conversationId: PARENT_ID,
        runId: RUN_ID,
        tool: {
          ...secondTool,
          result: JSON.stringify({ ok: true, value: { matches: [] } }),
          status: "completed",
        },
        type: "tool.completed",
      });
    });

    expect(container.querySelectorAll('button[aria-label="收起调用详情"]')).toHaveLength(0);
  });

  it("toggles a command batch and command detail from their muted summary text", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "命令测试" });
    const batchId = "00000000-0000-4000-8000-000000000010";
    const commands = ["ping -n 1 www.baidu.com", "ping -n 1 www.qq.com", "ping -n 1 www.wikipedia.org"]
      .map((command, index): ConversationToolItem => ({
        arguments: JSON.stringify({ command }),
        batchId,
        conversationId: PARENT_ID,
        createdAt: `2026-08-30T00:00:0${index}.000Z`,
        diff: null,
        executionMode: "parallel",
        id: `00000000-0000-4000-8000-00000000001${index + 1}`,
        kind: "tool",
        name: "run_command",
        result: null,
        runId: RUN_ID,
        status: "completed",
      }));
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue(commands);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace agentClient={client} project={null} session={target} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    expandWorkProcess(container);
    const batchSummary = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.includes("运行 3 条命令") === true,
    );
    expect(batchSummary?.getAttribute("aria-expanded")).toBe("false");
    expect(batchSummary?.className).toContain("text-[var(--app-muted-foreground)]");
    expect(batchSummary?.className).toContain("hover:text-[var(--app-foreground)]");
    expect(container.textContent).not.toContain("并行执行");

    act(() => batchSummary?.click());
    expect(batchSummary?.getAttribute("aria-expanded")).toBe("true");

    const commandSummary = [...container.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent === "已运行 ping -n 1 www.baidu.com",
    );
    expect(commandSummary?.getAttribute("aria-expanded")).toBe("false");
    expect(commandSummary?.className).toContain("text-[var(--app-muted-foreground)]");
    expect(commandSummary?.className).toContain("hover:text-[var(--app-foreground)]");

    act(() => commandSummary?.click());
    expect(commandSummary?.getAttribute("aria-expanded")).toBe("true");
    act(() => commandSummary?.click());
    expect(commandSummary?.getAttribute("aria-expanded")).toBe("false");
  });

  it("renders a failed tool result like a compact normal tool payload", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "工具失败样式测试" });
    const errorDetail = "提交的数据无效：字段 icon Invalid option: expected one of bot, sparkles, compass";
    const failedTool: ConversationToolItem = {
      arguments: JSON.stringify({ icon: "unknown-icon", name: "头像验收" }),
      batchId: null,
      conversationId: PARENT_ID,
      createdAt: "2026-09-02T12:00:00.000Z",
      diff: null,
      executionMode: "serial",
      id: TOOL_ID,
      kind: "tool",
      name: "spawn_subagent",
      result: JSON.stringify({ error: errorDetail, ok: false }),
      runId: RUN_ID,
      status: "failed",
    };
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([failedTool]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace agentClient={client} project={null} session={target} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    expandWorkProcess(container);
    const detailToggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="展开调用详情"]',
    );
    act(() => detailToggle?.click());

    const errorResult = container.querySelector<HTMLElement>(
      '.tool-timeline-item__payload[role="alert"][data-status="failed"]',
    );
    expect(errorResult).not.toBeNull();
    expect(errorResult?.className).toContain("tool-structured-result");
    expect(errorResult?.textContent).toContain("失败原因");
    expect(errorResult?.textContent).toContain(errorDetail);
    expect(errorResult?.querySelector(".tool-structured-result__content")).not.toBeNull();
    expect(errorResult?.querySelector("svg")?.getAttribute("class"))
      .toContain("text-[var(--app-status-danger-fg)]");
    expect(errorResult?.querySelector(".tool-timeline-item__payload-label span")?.className)
      .toContain("text-[var(--app-status-danger-fg)]");
    expect(errorResult?.querySelector("[data-tool-error-detail]")?.className).toContain("max-h-40");
    expect(container.querySelector('.conversation-error-quote[data-scope="tool"]')).toBeNull();
  });

  it("shows a file icon and opens a changed file from the result header", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "文件修改结果测试" });
    const onOpenProjectFile = vi.fn();
    const path = "src/BubbleSort.java";
    const fileTool: ConversationToolItem = {
      arguments: JSON.stringify({ path }),
      batchId: null,
      conversationId: PARENT_ID,
      createdAt: "2026-09-02T12:00:00.000Z",
      diff: [
        `--- ${path}`,
        `+++ ${path}`,
        "@@ -1 +1,2 @@",
        " class BubbleSort {}",
        "+// sorted",
      ].join("\n"),
      executionMode: "serial",
      id: TOOL_ID,
      kind: "tool",
      name: "replace_in_file",
      result: JSON.stringify({ ok: true, value: { path } }),
      runId: RUN_ID,
      status: "completed",
    };
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([fileTool]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            onOpenProjectFile={onOpenProjectFile}
            project={null}
            session={target}
          />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    expandWorkProcess(container);
    act(() => container.querySelector<HTMLButtonElement>(
      'button[aria-label="展开调用详情"]',
    )?.click());

    const fileButtons = container.querySelectorAll<HTMLButtonElement>(
      `button[aria-label="在侧边工作区打开文件 ${path}"]`,
    );
    expect(fileButtons).toHaveLength(2);
    const resultHeaderButton = fileButtons[1];
    expect(resultHeaderButton?.className).toContain("inline-flex");
    expect(resultHeaderButton?.querySelector(".file-type-icon--java")).not.toBeNull();
    expect(fileButtons[0]?.querySelector("span.truncate")?.className).not.toContain("border-b");
    const fileResult = resultHeaderButton?.closest(".tool-file-change");
    expect(fileResult?.className).toContain("tool-timeline-item__payload");
    expect(fileResult?.className).toContain("tool-structured-result");
    expect(fileResult?.querySelector(".tool-file-change__surface")).toBeNull();
    expect(fileResult?.querySelector(".tool-structured-result__content > .tool-diff-view"))
      .not.toBeNull();

    act(() => resultHeaderButton?.click());
    expect(onOpenProjectFile).toHaveBeenCalledWith(path);
  });
});

describe("Model request retry timeline", () => {
  it("shows retry progress immediately and keeps the terminal failure in the conversation", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "模型重试测试" });
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const height = this.classList.contains("conversation-workspace__composer-overlay") ? 196 : 0;
      return {
        bottom: height,
        height,
        left: 0,
        right: 0,
        toJSON: () => ({}),
        top: 0,
        width: 0,
        x: 0,
        y: 0,
      };
    });
    let runEventListener: ((event: ConversationRunEvent) => void) | null = null;
    vi.spyOn(client, "onConversationRunEvent").mockImplementation((listener) => {
      runEventListener = listener;
      return () => {
        runEventListener = null;
      };
    });
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace agentClient={client} project={null} session={target} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    const retry = {
      attempt: 1,
      conversationId: PARENT_ID,
      createdAt: "2026-09-02T00:00:00.000Z",
      id: "00000000-0000-4000-8000-000000000007",
      kind: "model_retry" as const,
      maxAttempts: 5,
      reason: "接口错误：HTTP 402：Insufficient Balance",
      retryInMs: 1_000,
      runId: RUN_ID,
      status: "retrying" as const,
      updatedAt: "2026-09-02T00:00:01.000Z",
    };

    vi.useFakeTimers();
    vi.setSystemTime(new Date(retry.updatedAt));
    act(() => {
      runEventListener?.({
        conversationId: PARENT_ID,
        retry,
        runId: RUN_ID,
        type: "model.retry_updated",
      });
    });

    expect(container.textContent).toContain("模型请求重试");
    expect(container.textContent).toContain("正在重新连接 1/5 · 1 秒后重试");
    expect(container.textContent).not.toContain("HTTP 402");
    const retrySummaryButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="展开重试详情："]',
    );
    expect(retrySummaryButton?.className).toContain("flex-[0_1_auto]");
    expect(retrySummaryButton?.className).not.toContain("flex-1");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(container.textContent).toContain("正在重新连接 1/5 · 即将重试");
    expect(container.querySelector('button[aria-label="查看重试原因"]')).toBeNull();
    expect(retrySummaryButton?.getAttribute("aria-expanded")).toBe("false");

    act(() => retrySummaryButton?.click());
    expect(retrySummaryButton?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("HTTP 402");

    act(() => {
      vi.setSystemTime(new Date("2026-09-02T00:00:03.000Z"));
      runEventListener?.({
        conversationId: PARENT_ID,
        retry: {
          ...retry,
          attempt: 2,
          retryInMs: 2_000,
          updatedAt: "2026-09-02T00:00:03.000Z",
        },
        runId: RUN_ID,
        type: "model.retry_updated",
      });
    });

    expect(container.textContent).toContain("正在重新连接 2/5 · 2 秒后重试");
    act(() => {
      vi.advanceTimersByTime(1_000);
    });
    expect(container.textContent).toContain("正在重新连接 2/5 · 1 秒后重试");
    expect(container.querySelectorAll('[data-status="retrying"]')).toHaveLength(1);

    act(() => {
      runEventListener?.({
        conversationId: PARENT_ID,
        retry: {
          ...retry,
          attempt: 5,
          retryInMs: null,
          status: "failed",
          updatedAt: "2026-09-02T00:00:36.000Z",
        },
        runId: RUN_ID,
        type: "model.retry_updated",
      });
    });

    expect(container.textContent).toContain("重新连接失败 · 已重试 5/5");
    const terminalRetry = container.querySelector<HTMLElement>('[data-status="failed"]');
    expect(terminalRetry).not.toBeNull();
    expect(terminalRetry?.className).toContain("shrink-0");
    expect(terminalRetry?.className).not.toContain("bg-[var(--app-panel)]");
    expect(container.querySelector<HTMLElement>("[data-conversation-composer-clearance]")?.style.height)
      .toBe("196px");
  });
});

describe("Run progress indicator", () => {
  it("reuses the pending indicator when run.started arrives before message submission resolves", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "运行进度测试" });
    let runEventListener: ((event: ConversationRunEvent) => void) | null = null;
    vi.spyOn(client, "onConversationRunEvent").mockImplementation((listener) => {
      runEventListener = listener;
      return () => {
        runEventListener = null;
      };
    });
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([]);
    vi.spyOn(client, "sendConversationMessage").mockImplementation(() => new Promise(() => {}));
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace agentClient={client} project={null} session={target} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    const composer = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入任务"]');
    // React tracks the instance setter, so the test must call the native setter with the textarea as receiver.
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const valueSetter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    act(() => {
      valueSetter?.call(composer, "检查重复分隔线");
      composer?.dispatchEvent(new InputEvent("input", { bubbles: true }));
    });
    act(() => container.querySelector<HTMLFormElement>("form")?.requestSubmit());

    expect(container.querySelectorAll(".conversation-run-progress")).toHaveLength(1);

    act(() => {
      runEventListener?.({
        conversationId: PARENT_ID,
        modelId: "test-model",
        runId: RUN_ID,
        type: "run.started",
      });
    });

    expect(container.querySelectorAll(".conversation-run-progress")).toHaveLength(1);
  });
});

describe("Pending message queue", () => {
  it("shows attachment previews and reorders rows from the drag handle", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "待发送队列测试" });
    const imageAttachmentId = "00000000-0000-4000-8000-000000000017";
    const pendingMessages: ConversationPendingMessage[] = [
      {
        attachmentIds: [imageAttachmentId],
        content: "带图片的消息",
        conversationId: PARENT_ID,
        createdAt: "2026-09-03T12:00:00.000Z",
        deliveryMode: "queue",
        id: "00000000-0000-4000-8000-000000000018",
        referencedConversationIds: [],
        referencedProjectPaths: [],
      },
      {
        attachmentIds: [],
        content: "第二条消息",
        conversationId: PARENT_ID,
        createdAt: "2026-09-03T12:01:00.000Z",
        deliveryMode: "queue",
        id: "00000000-0000-4000-8000-000000000019",
        referencedConversationIds: [],
        referencedProjectPaths: [],
      },
    ];
    vi.spyOn(client, "listConversationPendingMessages").mockResolvedValue(pendingMessages);
    vi.spyOn(client, "readConversationAttachmentPreview")
      .mockResolvedValue({ data: "AQID", mimeType: "image/png" });
    const reorder = vi.spyOn(client, "reorderConversationPendingMessages")
      .mockResolvedValue([pendingMessages[1]!, pendingMessages[0]!]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace agentClient={client} project={null} session={target} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    const queue = container.querySelector<HTMLElement>(".conversation-pending-queue");
    const rows = Array.from(container.querySelectorAll<HTMLElement>(
      ".conversation-pending-queue__item",
    ));
    expect(queue).not.toBeNull();
    expect(rows).toHaveLength(2);
    expect(container.querySelector(".conversation-pending-queue__position")).toBeNull();
    expect(container.querySelector('[aria-label="上移"]')).toBeNull();
    expect(container.querySelector('[aria-label="下移"]')).toBeNull();
    const preview = rows[0]?.querySelector<HTMLImageElement>(
      'img[src="data:image/png;base64,AQID"]',
    );
    expect(preview).not.toBeNull();
    expect(
      preview?.closest(".conversation-pending-queue__attachments")?.nextElementSibling?.textContent,
    ).toBe("带图片的消息");

    const firstRow = rows[0];
    const secondRow = rows[1];
    const handle = firstRow?.querySelector<HTMLElement>(
      '.conversation-pending-queue__drag-handle',
    );
    if (firstRow === undefined || secondRow === undefined || handle === null || handle === undefined) {
      throw new Error("Expected draggable pending message rows.");
    }
    vi.spyOn(firstRow, "getBoundingClientRect").mockReturnValue({
      bottom: 38,
      height: 38,
      left: 0,
      right: 480,
      top: 0,
      width: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    vi.spyOn(secondRow, "getBoundingClientRect").mockReturnValue({
      bottom: 76,
      height: 38,
      left: 0,
      right: 480,
      top: 38,
      width: 480,
      x: 0,
      y: 38,
      toJSON: () => ({}),
    });
    const dataTransfer = {
      dropEffect: "none",
      effectAllowed: "none",
      setData: vi.fn(),
      setDragImage: vi.fn(),
    };
    const dispatchDragEvent = (element: HTMLElement, type: string, clientY: number): void => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperties(event, {
        clientX: { value: 12 },
        clientY: { value: clientY },
        dataTransfer: { value: dataTransfer },
      });
      element.dispatchEvent(event);
    };

    act(() => dispatchDragEvent(handle, "dragstart", 10));
    act(() => dispatchDragEvent(secondRow, "dragover", 70));
    expect(secondRow.dataset.dropPosition).toBe("after");
    await act(async () => {
      dispatchDragEvent(secondRow, "drop", 70);
      await flushConversationWorkspace();
    });

    expect(reorder).toHaveBeenCalledWith({
      conversationId: PARENT_ID,
      pendingMessageIds: [pendingMessages[1]!.id, pendingMessages[0]!.id],
    });
  });
});

describe("Subagent approval queue", () => {
  it("shows the configured Agent identity above the message bubble", async () => {
    const configuredAgent = {
      ...DEFAULT_AGENT_DIRECTORY_CONFIGURATION.agents[0]!,
      avatar: { icon: "hammer", kind: "icon" } as const,
      id: "00000000-0000-4000-8000-000000000010",
      name: "Implementer",
    };
    useAgentDirectoryStore.getState().hydrate({
      ...structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION),
      agents: [configuredAgent],
    });
    const parent = session({ id: PARENT_ID, title: "Team Lead · 默认团队" });
    const worker = session({
      agentId: configuredAgent.id,
      avatarIcon: "bot",
      id: CHILD_ID,
      parentConversationId: PARENT_ID,
      teamId: "default-team",
      title: "Implementer · 默认团队",
    });
    const message: ConversationAgentMessageItem = {
      content: "你好，团队测试通过。",
      conversationId: PARENT_ID,
      createdAt: "2026-08-30T00:00:00.000Z",
      id: TOOL_ID,
      kind: "agent_message",
      messageType: "agent_result",
      readAt: "2026-08-30T00:00:01.000Z",
      replyInstruction: null,
      runId: RUN_ID,
      senderConversationId: CHILD_ID,
      senderTitle: worker.title,
      status: "read",
      taskId: null,
    };
    const client = new MockAgentClient();
    vi.spyOn(client, "listConversationTimeline").mockImplementation(({ conversationId }) =>
      Promise.resolve(conversationId === PARENT_ID ? [message] : [])
    );
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            project={null}
            relatedSessions={[parent]}
            session={parent}
          />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    const source = container.querySelector<HTMLButtonElement>(
      '[aria-label="打开来源对话 Implementer · 默认团队"]',
    );
    expect(source).not.toBeNull();
    expect(source?.closest(".chat-message")).toBeNull();
    expect(source?.parentElement?.matches('.chat-message-group[data-role="user"]')).toBe(true);
    expect(source?.nextElementSibling?.matches(".chat-message")).toBe(true);
    expect(source?.querySelector(".agent-profile-avatar .lucide-hammer")).not.toBeNull();
    expect(source?.textContent).toBe("Implementer · 默认团队");
    expect(source?.textContent).not.toContain("Agent 处理结果");
    expect(source?.textContent).not.toContain("来自");
  });

  it("adds the same removable attachment drafts from file selection and clipboard paste", async () => {
    const createObjectUrl = vi.spyOn(URL, "createObjectURL")
      .mockReturnValue("blob:clipboard-image-preview");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const client = new MockAgentClient();
    const status = await client.saveModelConfiguration({
      apiKey: "test-key",
      apiFormat: "openai-chat-completions",
      baseUrl: "https://fixture.invalid/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "Attachment test model",
        modelId: "attachment-test-model",
        reasoningOptions: [],
      }],
      providerName: "Test",
    });
    if (status.providerId === null || status.modelId === null) {
      throw new Error("Mock model configuration did not return a selected model.");
    }
    const sourceSession = session({
      id: PARENT_ID,
      modelSelection: {
        modelId: status.modelId,
        providerId: status.providerId,
        reasoning: null,
      },
      title: "附件测试",
    });
    const selectedAttachment = attachment({
      conversationId: sourceSession.id,
      id: "00000000-0000-4000-8000-000000000011",
      name: "selected.txt",
    });
    const pastedAttachment = attachment({
      conversationId: sourceSession.id,
      id: "00000000-0000-4000-8000-000000000012",
      kind: "image",
      mimeType: "image/png",
      name: "clipboard.png",
    });
    const capabilities = await client.getCapabilities();
    vi.spyOn(client, "getCapabilities").mockResolvedValue({
      ...capabilities,
      mode: "desktop",
    });
    const choose = vi.spyOn(client, "chooseConversationAttachments")
      .mockResolvedValue([selectedAttachment]);
    const importBytes = vi.spyOn(client, "importConversationAttachmentBytes")
      .mockResolvedValue([selectedAttachment, pastedAttachment]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            project={null}
            relatedSessions={[sourceSession]}
            session={sourceSession}
          />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    const addButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="添加文件或图片，也可直接粘贴"]',
    );
    await act(async () => {
      addButton?.click();
      await flushConversationWorkspace();
    });
    expect(choose).toHaveBeenCalledWith({ conversationId: sourceSession.id });
    expect(container.textContent).toContain("selected.txt");
    expect(container.textContent).toContain("TXT");

    const file = new File(["image-bytes"], "clipboard.png", { type: "image/png" });
    const pasteEvent = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(pasteEvent, "clipboardData", {
      value: { files: [file], items: [] },
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]');
    await act(async () => {
      textarea?.dispatchEvent(pasteEvent);
      await flushConversationWorkspace();
    });

    expect(pasteEvent.defaultPrevented).toBe(true);
    expect(importBytes).toHaveBeenCalledWith({
      base64: "aW1hZ2UtYnl0ZXM=",
      conversationId: sourceSession.id,
      mimeType: "image/png",
      name: "clipboard.png",
    });
    expect(createObjectUrl).toHaveBeenCalledWith(file);
    expect(container.querySelector<HTMLImageElement>(
      '.conversation-attachment--image-preview img[src="blob:clipboard-image-preview"]',
    )).not.toBeNull();
    expect(container.textContent).not.toContain("clipboard.png");

    const previewEvents: Event[] = [];
    const handlePreview = (event: Event): void => {
      previewEvents.push(event);
    };
    window.addEventListener("md-king:open-media-preview", handlePreview);
    act(() => container.querySelector<HTMLButtonElement>(
      '[aria-label="预览图片 clipboard.png"]',
    )?.click());
    window.removeEventListener("md-king:open-media-preview", handlePreview);
    const previewEvent = previewEvents[0] as CustomEvent<{
      alt?: string;
      src: string;
    }> | undefined;
    expect(previewEvent?.detail).toEqual({
      alt: "clipboard.png",
      src: "blob:clipboard-image-preview",
      title: "clipboard.png",
    });
  });

  it("renders sent user attachments above message content and edits their final selection", async () => {
    const client = new MockAgentClient();
    const status = await client.saveModelConfiguration({
      apiKey: "test-key",
      apiFormat: "openai-chat-completions",
      baseUrl: "https://fixture.invalid/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "Attachment preview model",
        modelId: "attachment-preview-model",
        reasoningOptions: [],
      }],
      providerName: "Test",
    });
    if (status.providerId === null || status.modelId === null) {
      throw new Error("Mock model configuration did not return a selected model.");
    }
    const sourceSession = session({
      id: PARENT_ID,
      modelSelection: {
        modelId: status.modelId,
        providerId: status.providerId,
        reasoning: null,
      },
      title: "已发送附件预览测试",
    });
    const imageAttachment = attachment({
      conversationId: sourceSession.id,
      id: "00000000-0000-4000-8000-000000000013",
      kind: "image",
      messageId: MESSAGE_ID,
      mimeType: "image/png",
      name: "screenshot.png",
    });
    const fileAttachment = attachment({
      conversationId: sourceSession.id,
      id: "00000000-0000-4000-8000-000000000014",
      messageId: MESSAGE_ID,
      name: "very-long-document-name-for-horizontal-overflow.txt",
    });
    const addedAttachment = attachment({
      conversationId: sourceSession.id,
      id: "00000000-0000-4000-8000-000000000015",
      name: "added-while-editing.txt",
    });
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([{
      attachments: [imageAttachment, fileAttachment],
      content: "",
      conversationId: sourceSession.id,
      createdAt: "2026-09-03T01:08:00.000Z",
      id: MESSAGE_ID,
      kind: "message",
      modelId: status.modelId,
      role: "user",
      runId: RUN_ID,
      status: "completed",
    }]);
    const readPreview = vi.spyOn(client, "readConversationAttachmentPreview")
      .mockResolvedValue({ data: "AQID", mimeType: "image/png" });
    const capabilities = await client.getCapabilities();
    vi.spyOn(client, "getCapabilities").mockResolvedValue({
      ...capabilities,
      mode: "desktop",
    });
    const chooseAttachments = vi.spyOn(client, "chooseConversationAttachments")
      .mockResolvedValue([addedAttachment]);
    const replaceMessage = vi.spyOn(client, "replaceLatestConversationMessage")
      .mockResolvedValue({
        runId: "00000000-0000-4000-8000-000000000016",
        userMessage: {
          attachments: [imageAttachment, addedAttachment],
          content: "",
          conversationId: sourceSession.id,
          createdAt: "2026-09-03T01:09:00.000Z",
          id: MESSAGE_ID,
          kind: "message",
          modelId: status.modelId,
          role: "user",
          runId: "00000000-0000-4000-8000-000000000016",
          status: "completed",
        },
      });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            project={null}
            relatedSessions={[sourceSession]}
            session={sourceSession}
          />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    const messageAttachments = container.querySelector<HTMLElement>(
      ".conversation-attachments--message",
    );
    const messageBubble = container.querySelector<HTMLElement>(
      '.chat-message[data-role="user"]',
    );
    expect(messageBubble?.textContent).toBe("");
    expect(messageBubble?.querySelector(".conversation-attachments--message")).toBeNull();
    expect(messageAttachments?.nextElementSibling).toBe(messageBubble);
    expect(messageAttachments?.querySelector<HTMLImageElement>(
      'img[src="data:image/png;base64,AQID"]',
    )).not.toBeNull();
    expect(messageAttachments?.querySelector(".conversation-attachment--file-card"))
      .not.toBeNull();
    expect(readPreview).toHaveBeenCalledWith({
      attachmentId: imageAttachment.id,
      conversationId: sourceSession.id,
    });

    if (messageAttachments !== null) {
      Object.defineProperties(messageAttachments, {
        clientWidth: { configurable: true, value: 200 },
        scrollLeft: { configurable: true, value: 0, writable: true },
        scrollWidth: { configurable: true, value: 500 },
      });
      const wheelEvent = new Event("wheel", { bubbles: true, cancelable: true });
      Object.defineProperties(wheelEvent, {
        deltaX: { value: 0 },
        deltaY: { value: 40 },
      });
      act(() => {
        messageAttachments.dispatchEvent(wheelEvent);
      });
      expect(messageAttachments.scrollLeft).toBe(40);
      expect(wheelEvent.defaultPrevented).toBe(true);
    }

    const editButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="编辑并重新生成"]',
    );
    await act(async () => {
      editButton?.click();
      await flushConversationWorkspace();
    });

    const editingAttachments = container.querySelector(
      ".conversation-attachments--draft",
    );
    expect(editingAttachments?.querySelectorAll(".conversation-attachment")).toHaveLength(2);
    expect(editingAttachments?.querySelector<HTMLImageElement>(
      'img[src="data:image/png;base64,AQID"]',
    )).not.toBeNull();
    expect(editingAttachments?.querySelectorAll('[aria-label^="移除附件"]')).toHaveLength(2);

    const removeFile = editingAttachments?.querySelector<HTMLButtonElement>(
      '[aria-label="移除附件 very-long-document-name-for-horizontal-overflow.txt"]',
    );
    act(() => removeFile?.click());
    expect(container.querySelector(".conversation-attachments--draft")?.textContent)
      .not.toContain("very-long-document-name-for-horizontal-overflow.txt");

    const addButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="添加文件或图片，也可直接粘贴"]',
    );
    await act(async () => {
      addButton?.click();
      await flushConversationWorkspace();
    });
    expect(chooseAttachments).toHaveBeenCalledWith({ conversationId: sourceSession.id });
    expect(container.textContent).toContain("added-while-editing.txt");

    const saveButton = container.querySelector<HTMLButtonElement>(
      '[aria-label="保存并重新生成"]',
    );
    await act(async () => {
      saveButton?.click();
      await flushConversationWorkspace();
    });
    expect(replaceMessage).toHaveBeenCalledWith(expect.objectContaining({
      attachmentIds: [imageAttachment.id, addedAttachment.id],
      content: "",
      conversationId: sourceSession.id,
      messageId: MESSAGE_ID,
    }));
  });

  it("shows a child's pending approval above the parent composer and submits it", async () => {
    const parent = session({ id: PARENT_ID, title: "主对话" });
    const child = session({
      activeRunId: RUN_ID,
      id: CHILD_ID,
      parentConversationId: PARENT_ID,
      threadKind: "subagent",
      title: "Ping GitHub",
    });
    const approval: ConversationToolItem = {
      arguments: '{"command":"ping -n 4 github.com"}',
      batchId: null,
      conversationId: CHILD_ID,
      createdAt: "2026-08-28T00:00:00.000Z",
      diff: null,
      id: TOOL_ID,
      kind: "tool",
      name: "run_command",
      result: null,
      runId: RUN_ID,
      status: "awaiting_approval",
    };
    const client = new MockAgentClient();
    vi.spyOn(client, "listConversationTimeline").mockImplementation(({ conversationId }) =>
      Promise.resolve(conversationId === CHILD_ID ? [approval] : [])
    );
    const approve = vi.spyOn(client, "approveToolChange").mockResolvedValue();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            project={null}
            relatedSessions={[parent, child]}
            session={parent}
          />
        </TooltipProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).toContain("Subagent 等待审批");
    expect(container.textContent).toContain("Ping GitHub");
    expect(container.textContent).toContain("运行 ping -n 4 github.com");

    const allowButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("仅本次允许") === true,
    );
    await act(async () => {
      allowButton?.click();
      await Promise.resolve();
    });

    expect(approve).toHaveBeenCalledWith({
      approved: true,
      runId: RUN_ID,
      scope: "once",
      toolId: TOOL_ID,
    });
  });

  it("keeps a managed Team WorkItem conversation controllable from its side Tab", async () => {
    const client = new MockAgentClient();
    const status = await client.saveModelConfiguration({
      apiKey: "test-key",
      apiFormat: "openai-chat-completions",
      baseUrl: "https://fixture.invalid/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "DeepSeek V4 Flash",
        modelId: "deepseek-v4-flash",
        reasoningOptions: [],
      }],
      providerName: "DeepSeek",
    });
    if (status.providerId === null || status.modelId === null) {
      throw new Error("Mock model configuration did not return a selected model.");
    }
    const conversation = await client.createConversation({
      modelSelection: {
        modelId: status.modelId,
        providerId: status.providerId,
        reasoning: null,
      },
      projectId: null,
    });
    const managed = session({
      activeRunId: RUN_ID,
      id: conversation.id,
      modelSelection: conversation.modelSelection,
      teamWorkItemId: WORK_ITEM_ID,
      title: "Team Lead · 受管任务",
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    const cancel = vi.spyOn(client, "cancelRun").mockResolvedValue();
    await act(async () => {
      root?.render(
        <TooltipProvider>
          <WorkspaceContent
            activeProject={null}
            activeSession={managed}
            agentClient={client}
            canAddProjects={false}
            isAddingProject={false}
            isCreatingSession={false}
            projects={[]}
            sessions={[managed]}
            onAddProject={() => Promise.resolve(null)}
            onCreateProjectSession={() => undefined}
            onCreateTemporarySession={() => undefined}
            onForkConversation={() => Promise.resolve(undefined)}
            onLocateProject={() => undefined}
            onLocateSession={() => undefined}
            onOpenTeamConversation={() => undefined}
            onProjectSelected={() => undefined}
            onSessionSelected={() => undefined}
            onSessionUpdated={() => undefined}
            onSessionViewed={() => undefined}
          />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    expect(container.querySelector('textarea[aria-label="输入任务"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="模型"]')).not.toBeNull();
    expect(container.querySelector('[aria-label="权限模式"]')).not.toBeNull();
    expect((container.querySelector('[aria-label="模型"]') as HTMLButtonElement).disabled).toBe(false);
    expect((container.querySelector('[aria-label="权限模式"]') as HTMLButtonElement).disabled).toBe(false);

    const stopButton = container.querySelector('[aria-label="停止任务"]') as HTMLButtonElement;
    act(() => {
      stopButton.click();
    });

    expect(cancel).toHaveBeenCalledWith({ runId: RUN_ID });
  });

  it("keeps a stopped Team task list compact, closable, and out of the running state", async () => {
    const client = new MockAgentClient();
    const status = await client.saveModelConfiguration({
      apiKey: "test-key",
      apiFormat: "openai-chat-completions",
      baseUrl: "https://fixture.invalid/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "DeepSeek V4 Flash",
        modelId: "deepseek-v4-flash",
        reasoningOptions: [],
      }],
      providerName: "DeepSeek",
    });
    if (status.providerId === null || status.modelId === null) {
      throw new Error("Mock model configuration did not return a selected model.");
    }
    const conversation = await client.createConversation({
      modelSelection: {
        modelId: status.modelId,
        providerId: status.providerId,
        reasoning: null,
      },
      projectId: null,
    });
    const taskList: ConversationTaskList = {
      closedAt: null,
      conversationId: conversation.id,
      createdAt: "2026-08-29T00:00:00.000Z",
      status: "active",
      tasks: [{
        id: TOOL_ID,
        reason: null,
        status: "running",
        title: "核对任务状态",
      }],
      updatedAt: "2026-08-29T00:00:00.000Z",
    };
    vi.spyOn(client, "getConversationTaskList").mockResolvedValue(taskList);
    const closeTaskList = vi.spyOn(client, "closeConversationTaskList").mockResolvedValue();
    const stopped = session({
      id: conversation.id,
      lastRunStatus: "cancelled",
      modelSelection: conversation.modelSelection,
      subagentTaskStatus: "completed",
      teamWorkItemId: WORK_ITEM_ID,
      title: "Team Lead · 已停止任务",
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const renderWorkspace = (activeSession: ProjectSession) => (
      <TooltipProvider>
        <WorkspaceContent
          activeProject={null}
          activeSession={activeSession}
          agentClient={client}
          canAddProjects={false}
          isAddingProject={false}
          isCreatingSession={false}
          projects={[]}
          sessions={[activeSession]}
          onAddProject={() => Promise.resolve(null)}
          onCreateProjectSession={() => undefined}
          onCreateTemporarySession={() => undefined}
          onForkConversation={() => Promise.resolve(undefined)}
          onLocateProject={() => undefined}
          onLocateSession={() => undefined}
          onOpenTeamConversation={() => undefined}
          onProjectSelected={() => undefined}
          onSessionSelected={() => undefined}
          onSessionUpdated={() => undefined}
          onSessionViewed={() => undefined}
        />
      </TooltipProvider>
    );

    await act(async () => {
      root?.render(renderWorkspace(stopped));
      await flushConversationWorkspace();
    });

    expect(container.querySelector(".conversation-task-list")).not.toBeNull();
    expect(container.querySelector(".conversation-task-list .conversation-workspace__spin")).toBeNull();
    const closeButton = container.querySelector('[aria-label="关闭任务清单"]') as HTMLButtonElement;
    expect(closeButton).not.toBeNull();

    await act(async () => {
      closeButton.click();
      await Promise.resolve();
    });

    expect(closeTaskList).toHaveBeenCalledWith({ conversationId: conversation.id });
  });

  it("highlights active composer queries and offers enabled Skills through slash commands", async () => {
    const client = new MockAgentClient();
    const status = await client.saveModelConfiguration({
      apiKey: "test-key",
      apiFormat: "openai-chat-completions",
      baseUrl: "https://fixture.invalid/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "DeepSeek V4 Flash",
        modelId: "deepseek-v4-flash",
        reasoningOptions: [],
      }],
      providerName: "DeepSeek",
    });
    if (status.providerId === null || status.modelId === null) {
      throw new Error("Mock model configuration did not return a selected model.");
    }
    vi.spyOn(client, "getIntegrationConfiguration").mockResolvedValue({
      mcpServers: [],
      skillDirectories: [],
      skills: [{
        description: "检查实现中的缺陷与回归风险",
        enabled: true,
        entryPath: "C:/skills/code-review/SKILL.md",
        id: "code-review",
        mcpDependencies: [],
        name: "代码审查",
        scope: "user",
        version: "1.0.0",
      }],
      version: 1,
    });
    const conversation = await client.createConversation({
      modelSelection: {
        modelId: status.modelId,
        providerId: status.providerId,
        reasoning: null,
      },
      projectId: null,
    });
    const target = session({
      id: conversation.id,
      modelSelection: conversation.modelSelection,
      title: "Skill 斜杠菜单测试",
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace agentClient={client} project={null} session={target} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]');
    act(() => {
      setNativeTextValue(textarea, "/code");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await flushConversationWorkspace();
    });

    expect(textarea?.dataset.queryActive).toBe("true");
    const skillOption = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent?.includes("/code-review · 代码审查") === true);
    expect(skillOption).toBeDefined();

    act(() => skillOption?.click());

    expect(textarea?.value).toBe("/code-review ");
    expect(textarea?.dataset.queryActive).toBeUndefined();
  });

  it("offers Teams through @ mentions without a direct composer handoff control", async () => {
    const client = new MockAgentClient();
    const status = await client.saveModelConfiguration({
      apiKey: "test-key",
      apiFormat: "openai-chat-completions",
      baseUrl: "https://fixture.invalid/v1",
      models: [{
        contextWindow: 128_000,
        displayName: "DeepSeek V4 Flash",
        modelId: "deepseek-v4-flash",
        reasoningOptions: [],
      }],
      providerName: "DeepSeek",
    });
    if (status.providerId === null || status.modelId === null) {
      throw new Error("Mock model configuration did not return a selected model.");
    }
    const project = {
      id: "00000000-0000-4000-8000-000000000001",
      isPinned: false,
      name: "Team dispatch fixture",
      rootPath: "C:/team-dispatch-fixture",
    };
    const conversation = await client.createConversation({
      modelSelection: {
        modelId: status.modelId,
        providerId: status.providerId,
        reasoning: null,
      },
      projectId: project.id,
    });
    const sourceSession = session({
      id: conversation.id,
      modelSelection: conversation.modelSelection,
      projectId: project.id,
      title: "项目主对话",
    });
    const send = vi.spyOn(client, "sendConversationMessage");
    const team = DEFAULT_AGENT_DIRECTORY_CONFIGURATION.teams[0];
    if (team === undefined) throw new Error("Default Team fixture is unavailable.");
    const teamInstance = await client.createTeamInstance({
      projectId: project.id,
      scope: "project",
      teamId: team.id,
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            project={project}
            relatedSessions={[sourceSession]}
            session={sourceSession}
            teamInstances={[teamInstance]}
          />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });
    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]');
    act(() => {
      setNativeTextValue(textarea, "@默认");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(textarea?.dataset.queryActive).toBe("true");
    const teamMention = [...container.querySelectorAll<HTMLButtonElement>(
      '[role="option"]',
    )].find((option) => option.textContent?.includes(team.name) === true);
    expect(teamMention).toBeDefined();
    await act(async () => {
      teamMention?.click();
      await flushConversationWorkspace();
    });

    expect(textarea?.value).toBe(`@${team.name} `);
    expect(container.querySelector('[aria-label="交给团队"]')).toBeNull();
    expect(container.querySelector(`[aria-label="交给 ${team.name} 并自动分发"]`)).toBeNull();
    await act(async () => {
      textarea?.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushConversationWorkspace();
    });
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      content: `@${team.name}`,
      conversationId: conversation.id,
    }));
  });
});

async function flushConversationWorkspace(): Promise<void> {
  for (let index = 0; index < 3; index += 1) {
    await new Promise<void>((resolve) => window.setTimeout(resolve, 0));
    await Promise.resolve();
  }
}

function setNativeTextValue(
  element: HTMLTextAreaElement | null,
  value: string,
): void {
  if (element === null) throw new Error("Expected a conversation textarea.");
  const descriptor = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value");
  if (descriptor === undefined) throw new Error("Textarea value setter is unavailable.");
  Reflect.set(HTMLTextAreaElement.prototype, "value", value, element);
}

function attachment(
  input: Pick<ConversationAttachment, "conversationId" | "id" | "name">
    & Partial<ConversationAttachment>,
): ConversationAttachment {
  return {
    contextTokens: 1,
    createdAt: "2026-08-30T00:00:00.000Z",
    kind: "file",
    messageId: null,
    mimeType: "text/plain",
    projectPath: null,
    sizeBytes: 11,
    source: "upload",
    truncated: false,
    ...input,
  };
}
