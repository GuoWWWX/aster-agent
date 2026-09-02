// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AGENT_DIRECTORY_CONFIGURATION,
  type ConversationAttachment,
  type ConversationAgentMessageItem,
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
