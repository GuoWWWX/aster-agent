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
