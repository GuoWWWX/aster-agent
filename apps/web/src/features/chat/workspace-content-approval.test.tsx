// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  DEFAULT_AGENT_DIRECTORY_CONFIGURATION,
  serializeAgentError,
  type ConversationAttachment,
  type ConversationContextUsage,
  type ConversationAgentMessageItem,
  type ConversationPendingMessage,
  type ConversationRunEvent,
  type ConversationTaskList,
  type ConversationToolItem,
} from "@agent/protocol";

import { MockAgentClient } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useApplicationSettingsStore } from "../../stores/application-settings-store.js";
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
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
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
  vi.unstubAllGlobals();
});

describe("Automatic continuation answer", () => {
  it("renders one timer after a team request, never above its bubble", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "团队成员", activeRunId: RUN_ID });
    const request: ConversationAgentMessageItem = {
      id: MESSAGE_ID, kind: "agent_message", conversationId: PARENT_ID,
      senderConversationId: CHILD_ID, senderTitle: "Team Lead", content: "读取项目文件",
      createdAt: "2026-09-08T00:00:00.000Z", messageType: "message", readAt: null,
      runId: WORK_ITEM_ID, status: "unread", replyInstruction: "回报结果", taskId: null, fileChanges: [],
    };
    const tool: ConversationToolItem = { arguments: "{}", batchId: null, conversationId: PARENT_ID,
      createdAt: "2026-09-08T00:00:01.000Z", diff: null, id: TOOL_ID, kind: "tool",
      name: "read_file", result: null, runId: RUN_ID, status: "running" };
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([request, tool]);
    const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
    await act(async () => {
      root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={target} /></TooltipProvider>);
      await flushConversationWorkspace();
    });
    expect(container.textContent?.match(/已处理/g)).toHaveLength(1);
    expect(container.textContent?.indexOf("读取项目文件")).toBeLessThan(container.textContent?.indexOf("已处理") ?? -1);
  });
  it("keeps the old work timer frozen and starts a new one after a steer in the same Run", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "插队计时", activeRunId: RUN_ID });
    const first = { attachments: [], content: "开始", conversationId: PARENT_ID,
      createdAt: "2026-09-08T00:00:00.000Z", id: MESSAGE_ID, kind: "message" as const,
      modelId: null, role: "user" as const, runId: RUN_ID, status: "completed" as const };
    const steer = { ...first, id: CHILD_ID, content: "直接打印", createdAt: "2026-09-08T00:00:20.000Z" };
    const before: ConversationToolItem = { arguments: "{}", batchId: null, conversationId: PARENT_ID,
      createdAt: "2026-09-08T00:00:01.000Z", diff: null, id: TOOL_ID, kind: "tool",
      name: "list_directory", result: "[]", runId: RUN_ID, status: "completed" };
    const after = { ...before, createdAt: steer.createdAt, id: WORK_ITEM_ID, status: "running" as const };
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(steer.createdAt));
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([first, before, steer, after]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={target} /></TooltipProvider>);
      await flushConversationWorkspace();
    });
    const groups = container.querySelectorAll(".conversation-run-activity");
    expect(groups).toHaveLength(2);
    expect(groups[0]?.textContent).toContain("已处理 20秒");
    expect(groups[1]?.textContent).toContain("已处理 0秒");
  });

  it("renders one answer with both source anchors and one copy action without private receipt rows", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "续跑" });
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([
      { attachments: [], content: "已安排子代理。", conversationId: PARENT_ID,
        createdAt: "2026-09-08T00:00:00.000Z", id: MESSAGE_ID, kind: "message",
        modelId: null, role: "assistant", runId: RUN_ID, status: "completed" },
      { attachments: [], content: "已验证完成。", conversationId: PARENT_ID,
        createdAt: "2026-09-08T00:01:00.000Z", id: TOOL_ID, kind: "message",
        modelId: null, role: "assistant", runId: WORK_ITEM_ID, status: "completed" },
    ]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<TooltipProvider><ConversationWorkspace
        agentClient={client} project={null} relatedSessions={[target]} session={target}
      /></TooltipProvider>);
      await flushConversationWorkspace();
    });
    const answers = container.querySelectorAll('.chat-message-group[data-role="assistant"]');
    expect(answers).toHaveLength(1);
    expect(answers[0]?.textContent).toContain("已安排子代理。");
    expect(answers[0]?.textContent).toContain("已验证完成。");
    expect(container.querySelector(`[data-conversation-timeline-item="${MESSAGE_ID}"]`)).not.toBeNull();
    expect(container.querySelector(`[data-conversation-timeline-item="${TOOL_ID}"]`)).not.toBeNull();
    expect(container.querySelectorAll('button[aria-label="复制完整回复"]')).toHaveLength(1);
  });
});

describe("Conversation cache status", () => {
  it("keeps the last usage through failures and empty refreshes, then displays the next result", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "缓存统计" });
    const previousSetting = useApplicationSettingsStore.getState().showContextUsage;
    useApplicationSettingsStore.setState({ showContextUsage: true });
    let listener: (event: ConversationRunEvent) => void = () => undefined;
    vi.spyOn(client, "onConversationRunEvent").mockImplementation((next) => {
      listener = next;
      return () => undefined;
    });
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([]);
    const empty: ConversationContextUsage = {
      compressionMode: "percentage", compressionThresholdTokens: 80_000,
      estimatedAttachmentTokens: 0, estimatedConversationTokens: 0, estimatedInputTokens: 100,
      estimatedReferenceTokens: 0, estimatedSkillCatalogTokens: 0, estimatedSystemTokens: 100,
      estimatedTaskListTokens: 0, estimatedToolDefinitionTokens: 0, estimatedToolTokens: 0,
      historyCharacters: 0, includedMessageCount: 0, omittedMessageCount: 0,
      outputReserveTokens: 8_192, skillReserveTokens: 0,
    };
    const withUsage = (hitRate: number): ConversationContextUsage => ({
      ...empty,
      providerCache: {
        firstTokenLatencyMs: 250,
        cumulative: { cacheCreationInputTokens: 0, cachedInputTokens: hitRate * 100,
          hitRate, inputTokens: 100, reportedRequestCount: 1, requestCount: 1 },
        latest: { cacheCreationInputTokens: 0, cachedInputTokens: hitRate * 100,
          hitRate, inputTokens: 100, outputTokens: 10, trendDelta: null },
      },
    });
    const load = vi.spyOn(client, "getConversationContextUsage").mockResolvedValue(empty);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    const render = (current: ProjectSession) => (
      <TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={current} /></TooltipProvider>
    );
    const finish = async (status: "completed" | "failed") => {
      await act(async () => {
        listener({ type: "run.finished", conversationId: PARENT_ID, runId: RUN_ID,
          status, error: status === "failed" ? "请求失败" : null });
        await flushConversationWorkspace();
      });
    };
    const metric = () => container.querySelector('[data-cache-metric="本次命中率"]');
    try {
      await act(async () => { root?.render(render(target)); await flushConversationWorkspace(); });
      expect(metric()?.textContent).toContain("--");
      load.mockResolvedValue(withUsage(0.8));
      await finish("completed");
      expect(metric()?.textContent).toContain("80%");
      const completedStats = metric()?.closest("button")?.textContent;
      const pending = withUsage(0.8);
      pending.providerCache!.latest = null;
      pending.providerCache!.firstTokenLatencyMs = null;
      load.mockResolvedValue(pending);
      await act(async () => {
        listener({ type: "run.started", conversationId: PARENT_ID, runId: RUN_ID, modelId: "test-model" });
        listener({ type: "model.request_started", conversationId: PARENT_ID, runId: RUN_ID });
        await flushConversationWorkspace();
      });
      expect(metric()?.closest("button")?.textContent).toBe(completedStats);
      pending.providerCache!.firstTokenLatencyMs = 1200;
      await act(async () => {
        listener({ type: "model.first_token_received", conversationId: PARENT_ID, runId: RUN_ID, latencyMs: 1200 });
        await flushConversationWorkspace();
      });
      expect(metric()?.closest("button")?.textContent).toBe(completedStats);
      load.mockRejectedValue(new Error("IPC unavailable"));
      await finish("failed");
      expect(metric()?.textContent).toContain("80%");
      load.mockResolvedValue(empty);
      await finish("failed");
      expect(metric()?.textContent).toContain("80%");
      const nextResult = withUsage(0);
      nextResult.providerCache!.firstTokenLatencyMs = 1200;
      load.mockResolvedValue(nextResult);
      await finish("completed");
      expect(metric()?.textContent).toContain("0%");
      expect(container.querySelector('[data-cache-metric="首字"]')?.textContent).toContain("1.20s");
      expect(metric()?.textContent).not.toContain("80%");
      load.mockRejectedValue(new Error("Usage not received yet"));
      await act(async () => {
        listener({ type: "model.request_started", conversationId: PARENT_ID, runId: RUN_ID });
        await flushConversationWorkspace();
      });
      expect(metric()?.textContent).toContain("0%");
      await finish("failed");
      expect(metric()?.textContent).toContain("0%");
      load.mockResolvedValue(empty);
      await act(async () => {
        root?.render(render(session({ id: CHILD_ID, title: "新对话" })));
        await flushConversationWorkspace();
      });
      expect(metric()?.textContent).toContain("--");
    } finally {
      useApplicationSettingsStore.setState({ showContextUsage: previousSetting });
    }
  });
});

describe("Conversation timeline location", () => {
  it("loads only the window around an unloaded search result", async () => {
    const client = new MockAgentClient();
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue(Array.from({ length: 400 }, (_, index) => ({
      attachments: [], content: `历史消息 ${index}`, conversationId: PARENT_ID,
      createdAt: "2026-08-30T00:00:00.000Z", id: index === 100 ? MESSAGE_ID : crypto.randomUUID(),
      kind: "message" as const, modelId: null, role: "user" as const, runId: null,
      status: "completed" as const,
    })));
    const page = vi.spyOn(client, "listConversationTimelinePage");
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null}
        session={session({ id: PARENT_ID, title: "长历史" })}
        locateTimelineItem={{ id: MESSAGE_ID, requestId: 1 }} /></TooltipProvider>);
      await flushConversationWorkspace();
    });
    await act(async () => { await flushConversationWorkspace(); });
    expect(page).toHaveBeenCalledTimes(2);
    expect(page.mock.calls[1]?.[0]).toEqual({ conversationId: PARENT_ID, aroundItemId: MESSAGE_ID, limit: 120 });
    expect(container.querySelector(`[data-conversation-timeline-item="${MESSAGE_ID}"]`)).not.toBeNull();
    expect(container.textContent).not.toContain("历史消息 399");
  });

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

describe("Agent message live delivery", () => {
  it("shows a parent message in an already-open Subagent conversation", async () => {
    const client = new MockAgentClient();
    const child = session({
      id: CHILD_ID,
      parentConversationId: PARENT_ID,
      threadKind: "subagent",
      title: "实时返工",
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
          <ConversationWorkspace agentClient={client} project={null} session={child} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    const message: ConversationAgentMessageItem = {
      content: "请在原上下文中继续优化。",
      conversationId: CHILD_ID,
      createdAt: "2026-09-05T01:00:00.000Z",
      fileChanges: [],
      id: MESSAGE_ID,
      kind: "agent_message",
      messageType: "message",
      readAt: null,
      replyInstruction: "简要汇报修改结果。",
      runId: RUN_ID,
      senderConversationId: PARENT_ID,
      senderTitle: "主对话",
      status: "unread",
      taskId: null,
    };
    act(() => {
      runEventListener?.({
        conversationId: CHILD_ID,
        message,
        type: "agent_message.received",
      });
    });

    expect(container.textContent).toContain("请在原上下文中继续优化。");
    act(() => {
      runEventListener?.({
        conversationId: CHILD_ID,
        modelId: "test-model",
        runId: RUN_ID,
        type: "run.started",
      });
      runEventListener?.({
        conversationId: CHILD_ID,
        runId: RUN_ID,
        type: "model.request_started",
      });
      runEventListener?.({
        conversationId: CHILD_ID,
        delta: "正在检查现有实现。",
        messageId: "00000000-0000-4000-8000-000000000017",
        modelId: "test-model",
        runId: RUN_ID,
        type: "assistant.delta",
      });
    });
    expect(container.querySelector(".conversation-run-progress")).not.toBeNull();
    expect(container.textContent).toContain("正在检查现有实现。");
  });
});

describe("Subagent creation activity", () => {
  it("shows the created identity and opens its conversation in the side workspace", async () => {
    const client = new MockAgentClient();
    const parent = session({ id: PARENT_ID, title: "主对话" });
    const child = session({
      avatarIcon: "bug",
      id: CHILD_ID,
      parentConversationId: PARENT_ID,
      threadKind: "subagent",
      title: "像素头像验收",
    });
    const spawnTool: ConversationToolItem = {
      arguments: JSON.stringify({ icon: "bug", name: "像素头像验收", task: "检查头像" }),
      batchId: null,
      conversationId: PARENT_ID,
      createdAt: "2026-09-05T00:00:00.000Z",
      diff: null,
      executionMode: "serial",
      id: TOOL_ID,
      kind: "tool",
      name: "spawn_subagent",
      result: JSON.stringify({
        ok: true,
        value: {
          task: {
            avatarIcon: "bug",
            childConversationId: CHILD_ID,
            error: null,
            id: "00000000-0000-4000-8000-000000000007",
            name: "像素头像验收",
            result: null,
            status: "running",
            title: "像素头像验收",
          },
        },
      }),
      runId: RUN_ID,
      status: "completed",
    };
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([spawnTool]);
    const onOpenTeamConversation = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            onOpenTeamConversation={onOpenTeamConversation}
            project={null}
            relatedSessions={[parent, child]}
            session={parent}
          />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });
    expandWorkProcess(container);

    const openButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="在侧边打开 Subagent 对话：像素头像验收"]',
    );
    expect(openButton?.textContent).toContain("像素头像验收");
    expect(openButton?.textContent).toContain("已创建");

    act(() => openButton?.click());
    expect(onOpenTeamConversation).toHaveBeenCalledWith(child, PARENT_ID);
  });
});

describe("Communication tool identities", () => {
  it.each(["send_agent_message", "wait_for_agent_message", "read_agent_conversation"])(
    "%s shows a clickable Subagent in both the activity and result", async (name) => {
      const client = new MockAgentClient();
      const parent = session({ id: PARENT_ID, title: "主对话" });
      const child = session({ id: CHILD_ID, title: "核查助手", threadKind: "subagent", parentConversationId: PARENT_ID });
      const tool: ConversationToolItem = {
        arguments: JSON.stringify({ conversationId: CHILD_ID }), batchId: null,
        conversationId: PARENT_ID, createdAt: "2026-09-05T00:00:00.000Z", diff: null,
        executionMode: "serial", id: TOOL_ID, kind: "tool", name, runId: RUN_ID,
        status: "completed",
        result: JSON.stringify({ ok: true, value: name === "read_agent_conversation"
          ? { content: "已核对启动脚本", estimatedTokens: 12 }
          : { message: { content: "核对启动脚本", conversationId: name === "send_agent_message" ? CHILD_ID : PARENT_ID,
            senderConversationId: name === "send_agent_message" ? PARENT_ID : CHILD_ID, senderTitle: "核查助手" } } }),
      };
      vi.spyOn(client, "listConversationTimeline").mockResolvedValue([tool]);
      const onOpenTeamConversation = vi.fn();
      const container = document.createElement("div");
      document.body.append(container);
      root = createRoot(container);
      await act(async () => {
        root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null}
          relatedSessions={[parent, child]} session={parent} onOpenTeamConversation={onOpenTeamConversation}
        /></TooltipProvider>);
        await flushConversationWorkspace();
      });
      expandWorkProcess(container);
      const selector = 'button[aria-label="在侧边打开 Subagent：核查助手"]';
      const activity = container.querySelector<HTMLButtonElement>(selector);
      expect(activity).not.toBeNull();
      expect(activity?.querySelector('[data-subagent-avatar="generated"]')).not.toBeNull();
      act(() => activity?.click());
      expect(onOpenTeamConversation).toHaveBeenCalledWith(child, PARENT_ID);
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="展开调用详情"]')?.click());
      const identities = container.querySelectorAll<HTMLButtonElement>(selector);
      expect(identities).toHaveLength(2);
      act(() => identities[1]?.click());
      expect(onOpenTeamConversation).toHaveBeenCalledTimes(2);
      expect(container.textContent).not.toContain(CHILD_ID);
      expect(container.textContent).not.toContain(PARENT_ID);
    },
  );
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

  it.each([null, 8000])("renders partial file reads when totalLines is %s", async (totalLines) => {
    const client = new MockAgentClient();
    const target = session({ activeRunId: RUN_ID, id: PARENT_ID, title: "分段读取" });
    const tool: ConversationToolItem = {
      arguments: JSON.stringify({ path: "large.rs", startLine: 7495, endLine: 7540 }),
      batchId: null, conversationId: PARENT_ID, createdAt: "2026-09-08T00:00:00.000Z",
      diff: null, id: TOOL_ID, kind: "tool", name: "read_file", runId: RUN_ID, status: "running",
      result: JSON.stringify({ ok: true, value: { path: "large.rs", content: "分段源码", startLine: 7495,
        endLine: 7540, totalLines, nextStartLine: 7541 } }),
    };
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([tool]);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={target} /></TooltipProvider>);
      await flushConversationWorkspace();
    });
    expandWorkProcess(container);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="展开调用详情"]')?.click());
    expect(container.textContent).toContain("第 7495-7540 行");
    expect(container.textContent).toContain("分段源码");
    if (totalLines === null) expect(container.textContent).not.toContain("，共");
    else expect(container.textContent).toContain("共 8000 行");
  });

  it("defaults to collapsed and preserves user disclosure choices through tool updates", async () => {
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

    expect(container.querySelectorAll('button[aria-label="收起调用详情"]')).toHaveLength(0);
    expandWorkProcess(container);
    expect(container.querySelectorAll('button[aria-label="收起调用详情"]')).toHaveLength(0);
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="展开调用详情"]')?.click());
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
    expect(newestExpandedToggle?.closest("article")?.textContent).toContain("first.ts");
    expect(newestExpandedToggle?.closest("article")?.textContent).not.toContain("second-query");

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

    expect(container.querySelectorAll('button[aria-label="收起调用详情"]')).toHaveLength(1);
    act(() => newestExpandedToggle?.click());
    expect(container.querySelectorAll('button[aria-label="收起调用详情"]')).toHaveLength(0);
    act(() => container.querySelector<HTMLButtonElement>('button[title="收起工作过程"]')?.click());
    expandWorkProcess(container);
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

  it("shows image thumbnails and file cards below a completed attachment-view tool", async () => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "历史附件回看测试" });
    const imageAttachment = attachment({
      conversationId: PARENT_ID,
      id: "00000000-0000-4000-8000-000000000041",
      kind: "image",
      messageId: MESSAGE_ID,
      mimeType: "image/png",
      name: "history.png",
    });
    const documentAttachment = attachment({
      conversationId: PARENT_ID,
      id: "00000000-0000-4000-8000-000000000042",
      messageId: MESSAGE_ID,
      mimeType: "application/pdf",
      name: "history.pdf",
    });
    const tool: ConversationToolItem = {
      arguments: JSON.stringify({
        attachment_ids: [imageAttachment.id, documentAttachment.id],
      }),
      batchId: null,
      conversationId: PARENT_ID,
      createdAt: "2026-09-04T01:00:00.000Z",
      diff: null,
      executionMode: "parallel",
      id: TOOL_ID,
      kind: "tool",
      name: "view_attachments",
      result: JSON.stringify({
        ok: true,
        value: { attachments: [imageAttachment, documentAttachment] },
      }),
      runId: RUN_ID,
      status: "completed",
    };
    vi.spyOn(client, "listConversationTimeline").mockResolvedValue([tool]);
    const readPreview = vi.spyOn(client, "readConversationAttachmentPreview")
      .mockResolvedValue({ data: "AQID", mimeType: "image/png" });
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
    act(() => container.querySelector<HTMLButtonElement>(
      'button[aria-label="展开调用详情"]',
    )?.click());
    await act(async () => flushConversationWorkspace());

    const attachmentStrip = container.querySelector(
      ".tool-structured-result .conversation-attachments--message",
    );
    expect(attachmentStrip?.querySelector<HTMLImageElement>(
      'img[src="data:image/png;base64,AQID"]',
    )).not.toBeNull();
    expect(attachmentStrip?.querySelector(".conversation-attachment--file-card")?.textContent)
      .toContain("history.pdf");
    expect(readPreview).toHaveBeenCalledWith({
      attachmentId: imageAttachment.id,
      conversationId: PARENT_ID,
    });
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
    const target = session({
      activeRunId: RUN_ID,
      id: PARENT_ID,
      title: "模型重试测试",
    });
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

    expandWorkProcess(container);
    expect(container.textContent).toContain("模型请求重试");
    expect(container.textContent).toContain("正在重新连接 1/5 · 1 秒后重试");
    expect(container.textContent).not.toContain("HTTP 402");
    const retrySummaryButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label^="展开重试详情："]',
    );
    const retryTimelineItem = retrySummaryButton?.closest("section") ?? null;
    expect(retryTimelineItem?.closest(".conversation-run-activity")).not.toBeNull();
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
    expect(container.querySelector<HTMLElement>(
      'section[data-status="retrying"]',
    )).toBe(retryTimelineItem);
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
    const terminalRetry = [...container.querySelectorAll<HTMLElement>('[data-status="failed"]')]
      .find((element) => element.textContent?.includes("重新连接失败") === true) ?? null;
    expect(terminalRetry).not.toBeNull();
    expect(terminalRetry).toBe(retryTimelineItem);
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
  it.each(["restore", "send", "promote"])("shows %s steer as sent input, then places new tools below it without waiting for a history reload", async (mode) => {
    const client = new MockAgentClient();
    const target = session({ id: PARENT_ID, title: "插队", activeRunId: RUN_ID });
    const pending: ConversationPendingMessage = {
      attachmentIds: [WORK_ITEM_ID], content: "不用侧边终端直接", conversationId: PARENT_ID,
      createdAt: "2026-09-08T00:00:10.000Z", deliveryMode: "steer", id: CHILD_ID,
      referencedConversationIds: [], referencedProjectPaths: [],
    };
    const first = { attachments: [], content: "打印网址", conversationId: PARENT_ID,
      createdAt: "2026-09-08T00:00:00.000Z", id: MESSAGE_ID, kind: "message" as const,
      modelId: null, role: "user" as const, runId: RUN_ID, status: "completed" as const };
    const before: ConversationToolItem = { arguments: "{}", batchId: null, conversationId: PARENT_ID,
      createdAt: "2026-09-08T00:00:01.000Z", diff: null, id: TOOL_ID, kind: "tool",
      name: "terminal_control", result: "{}", runId: RUN_ID, status: "completed" };
    const consumed = { ...first, content: pending.content, id: pending.id, createdAt: "2026-09-08T00:00:20.000Z" };
    const after = { ...before, id: WORK_ITEM_ID, name: "run_command", createdAt: consumed.createdAt, status: "running" as const };
    vi.spyOn(Date, "now").mockReturnValue(Date.parse(consumed.createdAt));
    const history = vi.spyOn(client, "listConversationTimeline").mockResolvedValue([first, before]);
    vi.spyOn(client, "listConversationPendingMessages").mockResolvedValue(mode === "send" ? []
      : [{ ...pending, deliveryMode: mode === "promote" ? "queue" : "steer" }]);
    vi.spyOn(client, "promoteConversationPendingMessage").mockResolvedValue([pending]);
    vi.spyOn(client, "readConversationAttachmentPreview").mockResolvedValue({ data: "AQID", mimeType: "image/png" });
    let listener: (event: ConversationRunEvent) => void = () => undefined;
    vi.spyOn(client, "onConversationRunEvent").mockImplementation((callback) => {
      listener = callback;
      return () => undefined;
    });
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => {
      root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={target} /></TooltipProvider>);
      await flushConversationWorkspace();
    });
    // A slow snapshot must not delay consumption events or briefly remove the sent bubble.
    history.mockImplementation(() => new Promise(() => {}));
    await act(async () => {
      if (mode === "send") listener({ conversationId: PARENT_ID, pendingMessages: [pending], type: "pending_messages.updated" });
      if (mode === "promote") container.querySelector<HTMLButtonElement>('button[aria-label="直接发送"]')?.click();
      await flushConversationWorkspace();
    });
    expect(container.querySelector(".conversation-pending-queue")).toBeNull();
    const bubble = container.querySelector("[data-sent-steer]");
    expect(bubble?.textContent).toContain(pending.content);
    expect(bubble?.querySelector('button[aria-label="预览图片"]')).not.toBeNull();
    expect(container.querySelectorAll(".conversation-run-activity")).toHaveLength(1);
    // The original indicator remains the sole active timer until the boundary is consumed.
    const originalGroup = container.querySelector(".conversation-run-activity");
    act(() => {
      listener({ conversationId: PARENT_ID, consumedMessages: [consumed], pendingMessages: [], type: "pending_messages.updated" });
    });
    expect(container.querySelectorAll("[data-sent-steer]")).toHaveLength(0);
    expect([...container.querySelectorAll('.chat-message[data-role="user"]')]
      .filter((element) => element.textContent === pending.content)).toHaveLength(1);
    act(() => listener({ conversationId: PARENT_ID, runId: RUN_ID, tool: after, type: "tool.started" }));
    const groups = container.querySelectorAll(".conversation-run-activity");
    expect(groups).toHaveLength(2);
    expect(groups[0]).toBe(originalGroup);
    expect(groups[0]?.textContent).toContain("已处理 20秒");
    expect(groups[1]?.textContent).toContain("已处理 0秒");
    const boundary = container.querySelector(`[data-conversation-timeline-item="${pending.id}"]`)!;
    expect(boundary.compareDocumentPosition(groups[1]!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    // A late acceptance response cannot duplicate a message already consumed by the runtime.
    act(() => listener({ conversationId: PARENT_ID, pendingMessages: [pending], type: "pending_messages.updated" }));
    expect(container.querySelector("[data-sent-steer]")).toBeNull();
  });

  it.each([false, true])("shows attachment previews and reorders queued rows with hidden steer=%s", async (withSteer) => {
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
    const steer: ConversationPendingMessage = { ...pendingMessages[0]!, attachmentIds: [],
      id: CHILD_ID, content: "已经发送的补充", deliveryMode: "steer" };
    vi.spyOn(client, "getConversationPendingQueuePaused").mockResolvedValue(true);
    const toggleQueue = vi.spyOn(client, "setConversationPendingQueuePaused").mockResolvedValue(false);
    const sendMessage = vi.spyOn(client, "sendConversationMessage");
    vi.spyOn(client, "listConversationPendingMessages").mockResolvedValue(withSteer
      ? [pendingMessages[0]!, steer, pendingMessages[1]!] : pendingMessages);
    vi.spyOn(client, "readConversationAttachmentPreview")
      .mockResolvedValue({ data: "AQID", mimeType: "image/png" });
    const reorder = vi.spyOn(client, "reorderConversationPendingMessages")
      .mockResolvedValue(withSteer
        ? [pendingMessages[1]!, steer, pendingMessages[0]!]
        : [pendingMessages[1]!, pendingMessages[0]!]);
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
    expect(queue?.textContent).toContain("已暂停");
    await act(async () => {
      container.querySelector<HTMLButtonElement>('[aria-label="继续队列（本轮完成后依次发送）"]')?.click();
      await flushConversationWorkspace();
    });
    expect(toggleQueue).toHaveBeenCalledWith({ conversationId: PARENT_ID, paused: false });
    expect(sendMessage).not.toHaveBeenCalled();
    expect(queue?.textContent).not.toContain("已暂停");
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
    expect(handle.draggable).toBe(true);
    expect(firstRow.draggable).toBe(false);
    expect(queue?.textContent).not.toContain("排队中");
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
      pendingMessageIds: withSteer
        ? [pendingMessages[1]!.id, steer.id, pendingMessages[0]!.id]
        : [pendingMessages[1]!.id, pendingMessages[0]!.id],
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
      fileChanges: [],
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

  it("shows a child's pending approval above the parent composer and grants it for that conversation", async () => {
    const parent = session({ id: PARENT_ID, title: "主对话" });
    const child = session({
      activeRunId: RUN_ID,
      avatarIcon: null,
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
    const onOpenTeamConversation = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            onOpenTeamConversation={onOpenTeamConversation}
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
    const sourceButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="在侧边打开 Subagent 审批来源：Ping GitHub"]',
    );
    expect(sourceButton).not.toBeNull();
    expect(sourceButton?.querySelector('[data-subagent-avatar="generated"]')).not.toBeNull();
    act(() => sourceButton?.click());
    expect(onOpenTeamConversation).toHaveBeenCalledWith(child, PARENT_ID);
    expect(container.textContent).toContain("运行 ping -n 4 github.com");

    const allowButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("本对话允许") === true,
    );
    await act(async () => {
      allowButton?.click();
      await Promise.resolve();
    });

    expect(approve).toHaveBeenCalledWith({
      approved: true,
      runId: RUN_ID,
      scope: "session",
      toolId: TOOL_ID,
    });
    expect(container.textContent).not.toContain("Subagent 等待审批");
  });

  it("removes a child approval when it is approved from the child conversation", async () => {
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
    let runEventListener: ((event: ConversationRunEvent) => void) | null = null;
    vi.spyOn(client, "onConversationRunEvent").mockImplementation((listener) => {
      runEventListener = listener;
      return () => {
        runEventListener = null;
      };
    });
    vi.spyOn(client, "listConversationTimeline").mockImplementation(({ conversationId }) =>
      Promise.resolve(conversationId === CHILD_ID ? [approval] : [])
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
            relatedSessions={[parent, child]}
            session={parent}
          />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    expect(container.textContent).toContain("Subagent 等待审批");
    act(() => {
      runEventListener?.({
        conversationId: CHILD_ID,
        runId: RUN_ID,
        tool: { ...approval, status: "running" },
        type: "tool.started",
      });
    });
    expect(container.textContent).not.toContain("Subagent 等待审批");
  });

  it("removes a stale child approval after Main reports that it expired", async () => {
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
    vi.spyOn(client, "approveToolChange").mockRejectedValue(new Error(
      `Error invoking remote method 'conversation.approve_tool_change': Error: ${serializeAgentError({
      code: "APPROVAL_EXPIRED",
      id: "00000000-0000-4000-8000-000000000099",
      message: "该审批已失效，请查看工具的最新状态。",
      retryable: false,
      })}`,
    ));
    const refreshSessions = vi.fn().mockResolvedValue(undefined);
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            onRefreshSessions={refreshSessions}
            project={null}
            relatedSessions={[parent, child]}
            session={parent}
          />
        </TooltipProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const allowButton = [...container.querySelectorAll("button")].find(
      (button) => button.textContent?.includes("本对话允许") === true,
    );
    await act(async () => {
      allowButton?.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Subagent 等待审批");
    expect(container.textContent).not.toContain("该审批已失效");
    expect(refreshSessions).toHaveBeenCalledOnce();

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace
            agentClient={client}
            onRefreshSessions={refreshSessions}
            project={null}
            relatedSessions={[{ ...parent }, { ...child }]}
            session={parent}
          />
        </TooltipProvider>,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.textContent).not.toContain("Subagent 等待审批");
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
    await act(async () => {
      stopButton.click();
      await flushConversationWorkspace();
    });

    expect(cancel).toHaveBeenCalledWith({ conversationId: conversation.id });
  });

  it("keeps the main task list running while Subagents work and makes it closable after they stop", async () => {
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
      tasks: [
        {
          id: TOOL_ID,
          reason: null,
          status: "running",
          title: "核对任务状态",
        },
        {
          id: "00000000-0000-4000-8000-000000000099",
          reason: null,
          status: "running",
          title: "整理验证结果",
        },
      ],
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
    const activeDelegation = {
      ...stopped,
      activeSubagentCount: 2,
      lastRunStatus: "completed" as const,
    };
    const cancelDelegation = vi.spyOn(client, "cancelRun").mockResolvedValue();
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
      root?.render(renderWorkspace(activeDelegation));
      await flushConversationWorkspace();
    });

    expect(container.querySelector(".conversation-task-list")).not.toBeNull();
    expect(container.querySelector(".conversation-task-list .conversation-workspace__spin")).not.toBeNull();
    expect(container.querySelector(".conversation-task-list__summary")?.textContent)
      .toContain("2 项进行中");
    const delegationStop = container.querySelector<HTMLButtonElement>('[aria-label="停止任务"]');
    expect(delegationStop).not.toBeNull();
    await act(async () => { delegationStop?.click(); await flushConversationWorkspace(); });
    expect(cancelDelegation).toHaveBeenCalledWith({ conversationId: conversation.id });

    act(() => root?.unmount());
    root = createRoot(container);
    await act(async () => {
      root?.render(renderWorkspace(stopped));
      await flushConversationWorkspace();
    });

    expect(container.querySelector(".conversation-task-list .conversation-workspace__spin")).toBeNull();
    expect(container.querySelector(".conversation-task-list__summary")?.textContent)
      .toContain("0/2 已完成");
    expect(container.querySelector(".conversation-task-list__summary")?.textContent)
      .toContain("任务已停止");
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
        origin: "system",
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
    const referenced = session({ id: CHILD_ID, title: "你好你是 (1)", parentConversationId: target.id, threadKind: "subagent" });
    vi.spyOn(client, "listConversations").mockResolvedValue([
      conversation,
    ]);
    vi.spyOn(client, "listConversationForks").mockResolvedValue([]);
    const usage = vi.spyOn(client, "getConversationContextUsage");
    const send = vi.spyOn(client, "sendConversationMessage");
    const container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <TooltipProvider>
          <ConversationWorkspace agentClient={client} project={null} session={target} relatedSessions={[referenced]} />
        </TooltipProvider>,
      );
      await flushConversationWorkspace();
    });

    const textarea = container.querySelector<HTMLTextAreaElement>('[aria-label="输入任务"]');
    act(() => {
      setNativeTextValue(textarea, "先检查 /code");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      await flushConversationWorkspace();
    });

    expect(textarea?.dataset.queryActive).toBe("true");
    const skillOption = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.querySelector("strong")?.textContent === "/代码审查");
    expect(skillOption).toBeDefined();
    expect(skillOption?.lastElementChild?.textContent).toBe("系统");

    act(() => skillOption?.click());

    expect(textarea?.value).toBe("先检查 \u3000code-review ");
    expect(textarea?.dataset.queryActive).toBe("true");
    expect(container.querySelector("[data-composer-query]")?.textContent).toBe("\u3000code-review");
    expect(container.querySelector("[data-composer-reference-icon] svg")).not.toBeNull();
    expect(container.querySelector(".conversation-mentions--draft")).toBeNull();
    await act(async () => {
      textarea?.setSelectionRange(17, 17);
      textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true, cancelable: true }));
      await flushConversationWorkspace();
    });
    expect(textarea?.value).toBe("先检查 ");
    expect(container.querySelector("[data-composer-query]")).toBeNull();
    act(() => {
      setNativeTextValue(textarea, "@");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(container.querySelector('.conversation-mention-menu [role="presentation"]')?.textContent).toBe("对话");
    expect(container.querySelector('.conversation-mention-menu')?.textContent).toContain(referenced.title);
    expect(send).not.toHaveBeenCalled();
    act(() => {
      setNativeTextValue(textarea, "先看 @你好");
      textarea?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const referenceOption = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')]
      .find((option) => option.textContent?.includes(referenced.title));
    expect(referenceOption).toBeDefined();
    await act(async () => { referenceOption?.click(); await flushConversationWorkspace(); });
    expect(container.querySelector(".conversation-mentions--draft")).toBeNull();
    expect(container.querySelector("[data-composer-query]")?.textContent).toBe(`\u3000${referenced.title}`);
    expect(usage).toHaveBeenCalledWith(expect.objectContaining({ referencedConversationIds: [CHILD_ID] }));
    await act(async () => {
      textarea?.setSelectionRange(6, 6);
      textarea?.dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true, cancelable: true }));
      await flushConversationWorkspace();
    });
    expect(textarea?.value).toBe("先看  ");
    expect(container.querySelector("[data-composer-query]")).toBeNull();
    await act(async () => {
      textarea?.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await flushConversationWorkspace();
    });
    expect(send).toHaveBeenCalled();
    expect(send.mock.calls.at(-1)?.[0].referencedConversationIds).toBeUndefined();
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

    expect(textarea?.value).toBe(`\u3000${team.name} `);
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
