// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationMessageItem, type ConversationRunEvent, type ConversationTimelineItem, type ConversationToolItem } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationWorkspace } from "./workspace-content.js";

const conversationId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
const continuationId = "00000000-0000-4000-8000-000000000003";
const session: ProjectSession = { id: conversationId, title: "工作过程生命周期", activeRunId: null, agentId: null,
  hasUnreadResult: false, isArchived: false, isPinned: false, lastRunStatus: null, modelSelection: null,
  parentConversationId: null, projectId: null, teamId: null, threadKind: "agent", workspaceRootPath: null };
const tool: ConversationToolItem = { id: "00000000-0000-4000-8000-000000000004", kind: "tool", conversationId,
  runId, batchId: null, createdAt: "2026-10-16T00:00:00Z", name: "read_file", arguments: '{"path":"first.ts"}',
  result: null, diff: null, status: "completed" };
const answer: ConversationMessageItem = { id: "00000000-0000-4000-8000-000000000005", kind: "message", conversationId,
  runId, createdAt: "2026-10-16T00:00:01Z", role: "assistant", content: "最终总结仍在输出", modelId: null, attachments: [], status: "streaming" };
let root: Root | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function flush(): Promise<void> { for (let i = 0; i < 10; i += 1) await Promise.resolve(); }
async function render(client: MockAgentClient, activeRunId: string | null): Promise<void> {
  await act(async () => { root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={{ ...session, activeRunId }} /></TooltipProvider>); await flush(); });
}
const header = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>(".conversation-run-activity > button")!;

it("keeps the working particles after the latest output instead of in the process heading", async () => {
  const client = new MockAgentClient();
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  const history = vi.spyOn(client, "listConversationTimeline").mockResolvedValue([tool, answer]);
  await render(client, runId);
  expect(header().querySelector("[data-model-working]")).toBeNull();
  const tail = container.querySelector(".conversation-work-tail")!;
  const output = container.querySelector('.chat-message-group[data-role="assistant"]')!;
  expect(output.compareDocumentPosition(tail) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  expect(container.querySelectorAll(".conversation-workspace__messages [data-model-working]")).toHaveLength(1);
  expect(tail.querySelector('[data-model-working][data-phase="writing"]')).not.toBeNull();
  history.mockResolvedValue([tool, { ...answer, status: "completed" }]);
  await act(async () => { emit({ type: "run.finished", conversationId, runId, status: "completed", error: null }); await flush(); });
  expect(container.querySelector(".conversation-work-tail")).toBeNull();
});

it.each([{ action: "inspect", language: "react", code: "example" }, { action: "inspect", sourceRef: "artifact:00000000-0000-4000-8000-000000000009" }])("restores all inspection images and their source language without creating a final presentation (%j)", async (argumentsValue) => {
  const client = new MockAgentClient();
  const images = Array.from({ length: 3 }, (_, index) => ({ id: crypto.randomUUID(), conversationId, messageId: tool.id,
    contextTokens: 1024, createdAt: tool.createdAt, kind: "image", mimeType: "image/jpeg", name: `phase-${index}.jpg`, projectPath: null, sizeBytes: 3, source: "browser", truncated: false }));
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([{ ...tool, name: "present_html", arguments: JSON.stringify(argumentsValue),
    result: JSON.stringify({ ok: true, value: { coordinateSpace: "screenshot_css_pixels", language: "react", width: 800, height: 600, mimeType: "image/jpeg", images } }) }, { ...answer, status: "completed" }]);
  const read = vi.spyOn(client, "readConversationAttachmentPreview").mockResolvedValue({ data: "AQID", mimeType: "image/jpeg" });
  await render(client, null);
  act(() => header().click());
  expect(container.textContent).toContain("已检查 React 预览");
  await act(async () => { container.querySelector<HTMLButtonElement>(".tool-timeline-item__toggle")!.click(); await flush(); });
  expect(read).toHaveBeenCalledTimes(3);
  expect(container.querySelectorAll('img[src="data:image/jpeg;base64,AQID"]')).toHaveLength(3);
  expect(container.querySelector("[data-html-delivery]")).toBeNull();
});

it("animates only the latest work segment across compaction and a new input, including after reopening", async () => {
  const client = new MockAgentClient();
  const user: ConversationMessageItem = { ...answer, id: crypto.randomUUID(), role: "user", content: "当前任务", status: "completed" };
  const compact: ConversationToolItem = { ...tool, id: crypto.randomUUID(), name: "compact_context", result: '{"durationMs":6000}' };
  const nextInput: ConversationMessageItem = { ...user, id: crypto.randomUUID(), content: "继续当前任务" };
  const oldOutput = { ...answer, id: crypto.randomUUID(), content: "早先的工作进展" };
  const wait: ConversationToolItem = { ...tool, id: crypto.randomUUID(), name: "wait_for_agent_message", status: "running" };
  const history = [user, oldOutput, compact, tool, nextInput, wait, { ...wait, id: crypto.randomUUID() }];
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue(history);
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  await render(client, runId);
  const assertLatestOnly = () => {
    const processes = container.querySelectorAll<HTMLDivElement>(".conversation-run-activity");
    expect(processes).toHaveLength(2);
    expect(processes[0]!.querySelector("[data-model-working]")).toBeNull();
    expect(processes[0]!.querySelector("button")?.disabled).toBe(false);
    expect(processes[1]!.querySelector("button")?.disabled).toBe(true);
    expect(container.querySelectorAll(".conversation-workspace__messages [data-model-working]")).toHaveLength(1);
    expect(processes[1]!.querySelector("[data-model-working]")).toBeNull();
    expect(container.querySelector(".conversation-work-tail [data-model-working]")).not.toBeNull();
  };
  assertLatestOnly();
  await act(async () => { emit({ type: "model.request_started", conversationId, runId }); await flush(); });
  assertLatestOnly();
  act(() => container.querySelector<HTMLButtonElement>(".conversation-run-activity > button")?.click());
  expect(container.textContent).toContain("早先的工作进展");
  assertLatestOnly();
  act(() => { root?.unmount(); root = createRoot(container); });
  await render(client, runId);
  assertLatestOnly();
  const runningCompaction = { ...compact, id: crypto.randomUUID(), status: "running" as const, result: null };
  await act(async () => { emit({ type: "tool.started", conversationId, runId, tool: runningCompaction }); await flush(); });
  expect(container.querySelectorAll(".conversation-workspace__messages [data-model-working]")).toHaveLength(0);
  await act(async () => {
    emit({ type: "tool.completed", conversationId, runId, tool: { ...runningCompaction, status: "completed" } });
    emit({ type: "model.request_started", conversationId, runId }); await flush();
  });
  assertLatestOnly();
  await act(async () => { emit({ type: "run.finished", conversationId, runId, status: "completed", error: null }); await flush(); });
  expect(container.querySelectorAll(".conversation-workspace__messages [data-model-working]")).toHaveLength(0);
});

it("moves the only working indicator to a new input before that input has any tools", async () => {
  const client = new MockAgentClient();
  const first: ConversationMessageItem = { ...answer, id: crypto.randomUUID(), role: "user", content: "第一段", status: "completed" };
  const next: ConversationMessageItem = { ...first, id: crypto.randomUUID(), content: "新的插队要求" };
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([first, tool, next]);
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  await render(client, runId);
  await act(async () => { emit({ type: "model.request_started", conversationId, runId }); await flush(); });
  expect(container.querySelector(".conversation-run-activity [data-model-working]")).toBeNull();
  expect(container.querySelectorAll(".conversation-workspace__messages [data-model-working]")).toHaveLength(1);
  expect(container.querySelector(".conversation-work-tail [data-model-working]")).not.toBeNull();
});

it("keeps an outstanding approval actionable when a later input owns the only working indicator", async () => {
  const client = new MockAgentClient();
  const first: ConversationMessageItem = { ...answer, id: crypto.randomUUID(), role: "user", content: "第一段", status: "completed" };
  const next: ConversationMessageItem = { ...first, id: crypto.randomUUID(), content: "新的补充要求" };
  const approval: ConversationToolItem = { ...tool, name: "write_file", arguments: '{"path":"fact.txt","content":"ok"}', status: "awaiting_approval" };
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([first, approval, next]);
  await render(client, runId);
  act(() => header().click());
  expect(container.textContent).not.toContain("该审批已随运行结束失效");
  const allow = Array.from(container.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent?.includes("允许一次"));
  expect(allow).toBeDefined(); expect(allow?.disabled).toBe(false);
  expect(container.querySelectorAll(".conversation-workspace__messages [data-model-working]")).toHaveLength(1);
  expect(container.querySelector('.conversation-work-tail [data-phase="thinking"]')).not.toBeNull();
});

it("keeps the only working indicator after an incoming group receipt while preserving earlier tools", async () => {
  const client = new MockAgentClient();
  const receipt: ConversationTimelineItem = { id: crypto.randomUUID(), kind: "agent_message", conversationId,
    runId: continuationId, senderConversationId: continuationId, senderTitle: "需求分析师", content: "公开回复已发送。",
    createdAt: "2026-10-16T00:00:05Z", messageType: "agent_result", readAt: null, replyInstruction: null, status: "unread", taskId: null, fileChanges: [] };
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([tool, receipt, { ...tool, id: crypto.randomUUID() }]);
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  await render(client, runId);
  await act(async () => { emit({ type: "model.request_started", conversationId, runId }); await flush(); });
  expect(container.querySelectorAll(".conversation-workspace__messages [data-model-working]")).toHaveLength(1);
  expect(container.querySelector(".conversation-run-activity [data-model-working]")).toBeNull();
  const source = container.querySelector(`[data-conversation-timeline-item="${receipt.id}"]`)!;
  const progress = container.querySelector(".conversation-run-progress")!;
  expect(source.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  act(() => header().click());
  act(() => container.querySelector<HTMLButtonElement>(".tool-activity-batch__toggle")?.click());
  expect(container.querySelectorAll(".tool-activity-row")).toHaveLength(2);
  expect(container.querySelectorAll(".conversation-workspace__messages [data-model-working]")).toHaveLength(1);
});

it("places a pending new request after cached history without animating that history", async () => {
  const client = new MockAgentClient();
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([tool, answer]);
  vi.spyOn(client, "sendConversationMessage").mockImplementation(() => new Promise(() => {}));
  await render(client, null);
  const composer = container.querySelector<HTMLTextAreaElement>('textarea[aria-label="输入任务"]')!;
  // React tracks the instance setter; input must go through the native setter.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  act(() => { setter?.call(composer, "新的请求"); composer.dispatchEvent(new InputEvent("input", { bubbles: true })); });
  act(() => container.querySelector<HTMLFormElement>("form")?.requestSubmit());
  expect(container.querySelectorAll(".conversation-workspace__messages [data-model-working]")).toHaveLength(1);
  expect(container.querySelector(".conversation-run-activity [data-model-working]")).toBeNull();
  const process = container.querySelector(".conversation-run-activity")!;
  const progress = container.querySelector(".conversation-run-progress")!;
  expect(process.compareDocumentPosition(progress) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
  act(() => emit({ type: "run.started", conversationId, runId: continuationId, modelId: "test-model" }));
  expect(container.querySelectorAll(".conversation-workspace__messages [data-model-working]")).toHaveLength(1);
  expect(process.compareDocumentPosition(container.querySelector(".conversation-run-progress")!) & Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
});

it("loads mention candidates in one hierarchy query instead of querying forks per conversation", async () => {
  const client = new MockAgentClient();
  for (let index = 0; index < 6; index += 1) await client.createConversation({});
  const forks = vi.spyOn(client, "listConversationForks");
  const hierarchy = vi.spyOn(client, "listConversationHierarchy");
  await render(client, null);
  expect(hierarchy).toHaveBeenCalled();
  expect(forks).not.toHaveBeenCalled();
});

it.each([false, true])("does not compile the private history for an inactive or group composer (group=%s)", async (group) => {
  const client = new MockAgentClient();
  const usage = vi.spyOn(client, "getConversationContextUsage");
  await act(async () => {
    root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={session}
      active={group} {...(group ? { groupChat: { instanceId: continuationId } } : {})} /></TooltipProvider>);
    await flush();
  });
  expect(usage).not.toHaveBeenCalled();
  if (!group) {
    await act(async () => {
      root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={session} active /></TooltipProvider>);
      await flush();
    });
    expect(usage).toHaveBeenCalled();
  }
});

it("retains a cached timeline across switches and refreshes only after background changes", async () => {
  const client = new MockAgentClient();
  const usageConversation = await client.createConversation({});
  const cachedUsage = await client.getConversationContextUsage({ conversationId: usageConversation.id, permissionMode: "full_access" });
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  const history = vi.spyOn(client, "listConversationTimeline").mockResolvedValue([{ ...answer, content: "cached answer", status: "completed" }]);
  const usage = vi.spyOn(client, "getConversationContextUsage").mockResolvedValue(cachedUsage);
  const pending = vi.spyOn(client, "listConversationPendingMessages").mockResolvedValue([]);
  const show = async (active: boolean): Promise<void> => {
    await act(async () => {
      root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={session} active={active} /></TooltipProvider>);
      await flush();
    });
  };
  await show(true);
  const initialCalls = history.mock.calls.length;
  const initialUsageCalls = usage.mock.calls.length;
  expect(container.textContent).toContain("cached answer");
  const messages = container.querySelector<HTMLElement>(".conversation-workspace__messages")!;
  Object.defineProperties(messages, { clientHeight: { configurable: true, value: 600 }, scrollHeight: { configurable: true, value: 1400 } });
  messages.scrollTop = 120;
  act(() => { messages.dispatchEvent(new Event("scroll")); });
  await show(false);
  await show(true);
  expect(history).toHaveBeenCalledTimes(initialCalls);
  expect(usage).toHaveBeenCalledTimes(initialUsageCalls);
  expect(container.querySelector(".conversation-workspace__messages")).toBe(messages);
  expect(messages.scrollTop).toBe(120);
  await show(false);
  pending.mockResolvedValue([{ id: continuationId, conversationId, createdAt: answer.createdAt, content: "queued while hidden", deliveryMode: "queue",
    attachmentIds: [], referencedConversationIds: [], referencedProjectPaths: [] }]);
  await act(async () => { emit({ type: "run.finished", conversationId, runId, status: "completed", error: null }); await flush(); });
  expect(history).toHaveBeenCalledTimes(initialCalls);
  history.mockResolvedValue([{ ...answer, content: "new background answer", status: "completed" }]);
  await show(true);
  expect(history).toHaveBeenCalledTimes(initialCalls + 1);
  expect(usage).toHaveBeenCalledTimes(initialUsageCalls + 1);
  expect(container.textContent).toContain("new background answer");
  expect(container.querySelector(".conversation-pending-queue")?.textContent).toContain("queued while hidden");
});

it.each([false, true])("reloads shared group messages only for their coordinator conversation (coordinator=%s)", async coordinator => {
  const client = new MockAgentClient();
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  const history = vi.spyOn(client, "listConversationTimeline").mockResolvedValue([]);
  await act(async () => {
    root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null}
      session={{ ...session, ...(coordinator ? { coordinationTeamInstanceId: continuationId } : {}) }} /></TooltipProvider>);
    await flush();
  });
  const calls = history.mock.calls.length;
  await act(async () => {
    emit({ type: "collaboration.changed", conversationId, ...(coordinator ? { teamInstanceId: continuationId } : {}) });
    await flush();
  });
  expect(history).toHaveBeenCalledTimes(calls + (coordinator ? 1 : 0));
});

it.each([true, false])("keeps a stream snapshot when history arrives afterwards (cached question=%s)", async (cachedQuestion) => {
  const client = new MockAgentClient();
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  const persisted: ConversationTimelineItem[] = [{ ...answer, id: continuationId, role: "user", content: "new question", status: "completed" }];
  const history = vi.spyOn(client, "listConversationTimeline").mockResolvedValue(cachedQuestion ? persisted : []);
  const show = async (active: boolean) => { await act(async () => {
    root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={{ ...session, activeRunId: runId }} active={active} /></TooltipProvider>);
    await flush();
  }); };
  await show(true); await show(false);
  act(() => emit({ type: "model.request_started", conversationId, runId }));
  let resolve: (items: ConversationTimelineItem[]) => void = () => {};
  history.mockResolvedValue(persisted).mockImplementationOnce(() => new Promise(done => { resolve = done; }));
  await show(true);
  await act(async () => {
    emit({ type: "assistant.delta", conversationId, runId, messageId: answer.id, modelId: "test-model", reset: true, delta: "complete snapshot" });
    resolve(persisted); await flush();
  });
  expect(container.textContent).toContain("new question");
  expect(container.textContent).toContain("complete snapshot");
  act(() => emit({ type: "assistant.delta", conversationId, runId, messageId: answer.id, modelId: "test-model", delta: " plus new output" }));
  expect(container.textContent).toContain("complete snapshot plus new output");
});

it("uses the running fallback before a model request and while a text-only final answer streams", async () => {
  const client = new MockAgentClient();
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([]);
  await render(client, null);
  await act(async () => { emit({ type: "run.started", conversationId, runId, modelId: "test-model" }); await flush(); });
  expect(container.querySelector(".conversation-run-activity")).toBeNull();
  expect(container.querySelector(".conversation-run-progress")?.textContent).toBe("推理中");
  await act(async () => { emit({ type: "assistant.delta", conversationId, runId, messageId: answer.id,
    modelId: "test-model", delta: "纯文本最终回答。" }); await flush(); });
  expect(container.querySelector(".conversation-run-progress")?.textContent).toBe("推理中");
  expect(container.textContent).not.toContain("已处理");
  expect(container.textContent).toContain("纯文本最终回答。");
});

it.each([runId, null])("keeps the outer process expanded while final text is streaming (activeRunId=%s)", async (activeRunId) => {
  const client = new MockAgentClient();
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([tool, answer]);
  await render(client, activeRunId);
  expect(header().textContent).toBe("推理中");
  expect(header().getAttribute("aria-expanded")).toBe("true");
  act(() => header().click());
  expect(header().getAttribute("aria-expanded")).toBe("true");
  expect(container.querySelector(".tool-activity-row")).not.toBeNull();
});

it("does not treat a completed tool or request placeholder as the turn's end and unlocks after run.finished", async () => {
  const client = new MockAgentClient();
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  const history = vi.spyOn(client, "listConversationTimeline").mockResolvedValue([tool, answer]);
  await render(client, runId);
  for (const event of [
    { type: "tool.completed", conversationId, runId, tool },
    { type: "model.request_started", conversationId, runId },
    { type: "assistant.delta", conversationId, runId, messageId: answer.id, modelId: "test-model", delta: "继续总结。" },
  ] satisfies ConversationRunEvent[]) {
    act(() => emit(event));
    act(() => header().click());
    expect(header().textContent).toBe("推理中");
    expect(header().getAttribute("aria-expanded")).toBe("true");
  }
  history.mockResolvedValue([tool, { ...answer, status: "completed", durationMs: 12_000 }]);
  await act(async () => { emit({ type: "run.finished", conversationId, runId, status: "completed", error: null }); await flush(); });
  expect(header().textContent).toBe("已处理 12秒");
  expect(header().disabled).toBe(false);
  act(() => header().click());
  expect(header().getAttribute("aria-expanded")).toBe("true");
  act(() => header().click());
  expect(header().getAttribute("aria-expanded")).toBe("false");
});

it.each([false, true])("locks an automatic Subagent continuation until its final run ends and sums the whole turn duration (withTool=%s)", async (withTool) => {
  const client = new MockAgentClient();
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  const first = { ...answer, status: "completed" as const, durationMs: 9_000, content: "已安排子代理。" };
  const nextTool = { ...tool, id: "00000000-0000-4000-8000-000000000006", runId: continuationId };
  const nextAnswer = { ...answer, id: "00000000-0000-4000-8000-000000000007", runId: continuationId };
  const timeline: ConversationTimelineItem[] = [tool, first, { id: "00000000-0000-4000-8000-000000000008", kind: "agent_message", conversationId,
    runId: continuationId, senderConversationId: continuationId, senderTitle: "Subagent", content: "核查已完成。", createdAt: "2026-10-16T00:00:02Z",
    messageType: "task_result", readAt: null, replyInstruction: null, status: "unread", taskId: null, fileChanges: [] }, ...(withTool ? [nextTool] : []), nextAnswer];
  const history = vi.spyOn(client, "listConversationTimeline").mockResolvedValue(timeline);
  await render(client, continuationId);
  expect(container.querySelectorAll(".conversation-run-activity")).toHaveLength(1);
  expect(header().textContent).toBe("推理中");
  act(() => header().click());
  expect(header().getAttribute("aria-expanded")).toBe("true");
  history.mockResolvedValue([...timeline.slice(0, -1), { ...nextAnswer, status: "completed", durationMs: 4_000 }]);
  await act(async () => { emit({ type: "run.finished", conversationId, runId: continuationId, status: "completed", error: null }); await flush(); });
  expect(header().textContent).toBe("已处理 13秒");
});

it("keeps a continuation request placeholder in the same outer work process before its final answer arrives", async () => {
  const client = new MockAgentClient();
  let emit: (event: ConversationRunEvent) => void = () => {};
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return () => {}; });
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([tool, { ...answer, status: "completed", durationMs: 9_000 }]);
  await render(client, continuationId);
  await act(async () => { emit({ type: "model.request_started", conversationId, runId: continuationId }); await flush(); });
  expect(container.querySelectorAll(".conversation-run-activity")).toHaveLength(1);
  expect(header().textContent).toBe("推理中");
  expect(header().disabled).toBe(true);
  await act(async () => { emit({ type: "assistant.delta", conversationId, runId: continuationId,
    messageId: "00000000-0000-4000-8000-000000000010", modelId: "test-model", delta: "自动续跑总结。" }); await flush(); });
  expect(container.querySelectorAll(".conversation-run-activity")).toHaveLength(1);
  expect(header().textContent).toBe("推理中");
  expect(container.textContent?.match(/自动续跑总结。/gu)).toHaveLength(1);
});

it.each(["batch", "detail"] as const)("keeps the bottom when expanding a %s and preserves the position while reading history", async (target) => {
  const client = new MockAgentClient();
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([tool, { ...tool, id: "00000000-0000-4000-8000-000000000009" }, { ...answer, status: "completed", durationMs: 12_000 }]);
  await render(client, null);
  act(() => header().click());
  const toggle = (): HTMLButtonElement => container.querySelector<HTMLButtonElement>(target === "batch"
    ? '.tool-activity-batch__toggle' : '.tool-activity-row button[aria-label="展开调用详情"], .tool-activity-row button[aria-label="收起调用详情"]')!;
  if (target === "detail") act(() => container.querySelector<HTMLButtonElement>(".tool-activity-batch__toggle")!.click());
  const messages = container.querySelector<HTMLElement>(".conversation-workspace__messages")!;
  const isExpanded = (): boolean => toggle().getAttribute("aria-expanded") === "true";
  let top = 600;
  Object.defineProperties(messages, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, get: () => 1200 + (isExpanded() ? 400 : 0) },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.min(value, messages.scrollHeight - messages.clientHeight); } },
  });
  act(() => { messages.dispatchEvent(new Event("scroll")); });
  act(() => toggle().click());
  expect(messages.scrollTop).toBe(1000);
  act(() => toggle().click());
  messages.scrollTop = 240;
  act(() => { messages.dispatchEvent(new Event("scroll")); });
  act(() => toggle().click());
  expect(messages.scrollTop).toBe(240);
});

it("keeps paginated HTML navigation anchored at the bottom through growth and shrinkage without moving history readers", async () => {
  const resizes = new Map<Element, () => void>();
  vi.stubGlobal("ResizeObserver", class {
    constructor(private callback: ResizeObserverCallback) {}
    observe(target: Element): void { resizes.set(target, () => this.callback([], this as unknown as ResizeObserver)); }
    disconnect(): void {}
  });
  const client = new MockAgentClient();
  const pages = [{ title: "A", kind: "code", html: "<p>A</p>" }, { title: "B", kind: "code", html: "<p>B</p>" }];
  vi.spyOn(client, "listConversationTimeline").mockResolvedValue([
    { ...tool, name: "present_html", arguments: JSON.stringify({ pages }), result: JSON.stringify({ ok: true, value: { presentation: { kind: "html_gallery", pages } } }) },
    { ...answer, status: "completed", durationMs: 12000 },
  ]);
  vi.spyOn(client, "htmlPreview").mockImplementation(input => Promise.resolve(input.kind === "code" ? {
    id: runId, title: "demo", source: input.html, url: "http://127.0.0.1:1234/preview",
  } : null));
  await render(client, null);
  const gallery = container.querySelector('[aria-label="HTML 方案对比"]')!;
  const frame = gallery.querySelector("iframe")!;
  const messages = container.querySelector<HTMLElement>(".conversation-workspace__messages")!;
  vi.spyOn(frame, "getBoundingClientRect").mockReturnValue(new DOMRect(0, 0, 720, 320));
  let top = 520;
  Object.defineProperties(messages, {
    clientHeight: { configurable: true, value: 600 },
    scrollHeight: { configurable: true, get: () => 800 + Number.parseFloat(frame.style.height) },
    scrollTop: { configurable: true, get: () => top, set: (value: number) => { top = Math.min(value, messages.scrollHeight - messages.clientHeight); } },
  });
  act(() => { messages.dispatchEvent(new Event("scroll")); });
  const resize = (height: number): void => {
    act(() => { window.dispatchEvent(new MessageEvent("message", { source: frame.contentWindow, origin: "null", data: { type: "html-preview.resize", id: runId, height } })); });
    act(() => { resizes.get(gallery)?.(); });
  };
  resize(480);
  expect(top).toBe(680);
  resize(160);
  expect(top).toBe(360);
  top = 240;
  act(() => { messages.dispatchEvent(new Event("scroll")); });
  resize(420);
  expect(top).toBe(240);
});
