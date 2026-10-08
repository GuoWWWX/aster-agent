// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import type { ConversationSummary, ConversationToolItem, ConversationRunEvent, ConversationTimelinePage } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/index.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationActivity, conversationActivityRows, updateActivityTools } from "./conversation-activity.js";

const session = (id: string, extra: Partial<ProjectSession> = {}): ProjectSession => ({
  id, title: id, activeRunId: null, agentId: null, hasUnreadResult: false, isArchived: false,
  isPinned: false, lastRunStatus: null, modelSelection: null, parentConversationId: null,
  projectId: null, teamId: null, threadKind: "agent", workspaceRootPath: null, ...extra,
});
const tool: ConversationToolItem = { id: "tool", conversationId: "a", runId: "run", status: "awaiting_approval",
  arguments: "{}", batchId: null, createdAt: "2026-09-09T00:00:00Z", diff: null, kind: "tool", name: "exec_command", result: null };
const summary = (id: string, parentConversationId: string | null, threadKind: ConversationSummary["threadKind"]): ConversationSummary => ({
  activeSubagentCount: 0, activeRunId: null, agentId: null, archivedAt: null, createdAt: "2026-09-09T00:00:00Z",
  hasUnreadResult: false, id, isArchived: false, isPinned: false, lastRunStatus: null, modelSelection: null,
  parentConversationId, projectId: null, teamId: null, teamWorkItemId: null, threadKind, title: id,
  updatedAt: "2026-09-09T00:00:00Z", workspaceRootPath: null,
});
let root: Root | undefined;
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); });

it("prioritizes approval and does not duplicate aggregate parent activity", () => {
  const rows = conversationActivityRows([
    session("a", { activeRunId: "run", hasUnreadResult: true }),
    session("b", { hasUnreadResult: true }), session("c", { activeRunId: "run-c" }),
    session("parent", { activeSideConversationCount: 1, hasUnreadSideConversationResult: true }),
    session("archived", { isArchived: true, hasUnreadResult: true }),
  ], { tool });
  expect(rows.map(({ session: item, group }) => [item.id, group])).toEqual([["a", "待处理"], ["b", "未读"], ["c", "进行中"]]);
});

it("clears approval when tool resumes and removes finished runs", () => {
  const running = updateActivityTools({ tool }, { type: "tool.started", conversationId: "a", runId: "run", tool: { ...tool, status: "running" } });
  expect(conversationActivityRows([session("a", { activeRunId: "run" })], running)[0]?.status).toBe("执行工具");
  expect(updateActivityTools(running, { type: "run.finished", conversationId: "a", runId: "run", status: "completed", error: null })).toEqual({});
});

it("groups side conversations under their root and excludes subagents", () => {
  const rows = conversationActivityRows([
    session("main"),
    session("side", { parentConversationId: "main", hasUnreadResult: true }),
    session("nested", { parentConversationId: "side", activeRunId: "run" }),
    session("worker", { parentConversationId: "main", threadKind: "subagent", hasUnreadResult: true, activeRunId: "worker-run" }),
    session("worker-only-main"),
    session("worker-only", { parentConversationId: "worker-only-main", threadKind: "subagent", hasUnreadResult: true }),
  ], { pending: { conversationId: "nested", runId: "run", status: "awaiting_approval" } });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ session: { id: "main", title: "main" }, group: "待处理", hasUnreadResult: true });
});

it("surfaces a subagent approval on its root conversation without adding a subagent unread row", () => {
  const rows = conversationActivityRows([
    session("main", { updatedAt: "2026-09-09T00:00:00Z" }),
    session("worker", {
      activeRunId: "worker-run", parentConversationId: "main", threadKind: "subagent",
      updatedAt: "2026-09-09T00:01:00Z",
    }),
    session("unread-worker", { parentConversationId: "main", threadKind: "subagent", hasUnreadResult: true }),
  ], {
    approval: { conversationId: "worker", runId: "worker-run", status: "awaiting_approval" },
  });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ session: { id: "main" }, group: "待处理", approvalToolId: "approval", status: "等待审批" });
});

it("opening/searching the list never marks results read; selection only navigates", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new MockAgentClient();
  const mark = vi.spyOn(client, "markConversationResultViewed");
  const select = vi.fn();
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<ConversationActivity agentClient={client} projects={[]} sessions={[session("未读示例"), session("侧边未读", { parentConversationId: "未读示例", hasUnreadResult: true }), session("自动子代理", { threadKind: "subagent", hasUnreadResult: true })]} onSelect={select} />); await Promise.resolve(); });
  act(() => container.querySelector<HTMLButtonElement>("button")?.click());
  expect(document.body.textContent).toContain("未读示例");
  expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("对话动态，1 个未读");
  expect(document.body.textContent).not.toContain("侧边未读");
  expect(document.body.textContent).not.toContain("自动子代理");
  expect(mark).not.toHaveBeenCalled();
  const row = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find((button) => button.textContent?.includes("未读示例"));
  act(() => row?.click());
  expect(select).toHaveBeenCalledWith("未读示例");
  expect(mark).not.toHaveBeenCalled();
});

it("hydrates existing approvals without losing events arriving during the read", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new MockAgentClient();
  let listener: ((event: ConversationRunEvent) => void) | undefined;
  vi.spyOn(client, "onConversationRunEvent").mockImplementation((callback) => { listener = callback; return () => {}; });
  let resolvePage: ((page: ConversationTimelinePage) => void) | undefined;
  const read = vi.spyOn(client, "listConversationTimelinePage").mockImplementation(() => new Promise((resolve) => { resolvePage = resolve; }));
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<ConversationActivity agentClient={client} projects={[]} sessions={[session("a", { activeRunId: "run" }), session("inactive")]} onSelect={vi.fn()} />); await Promise.resolve(); });
  expect(read).toHaveBeenCalledTimes(1);
  act(() => listener?.({ type: "tool.completed", conversationId: "a", runId: "run", tool: { ...tool, status: "completed" } }));
  await act(async () => { resolvePage?.({ hasMore: false, nextBeforeSequence: null, items: [tool, { ...tool, id: "still-pending" }] }); await Promise.resolve(); });
  act(() => container.querySelector<HTMLButtonElement>("button")?.click());
  expect(document.body.textContent).toContain("等待审批");
  act(() => listener?.({ type: "tool.started", conversationId: "a", runId: "run", tool: { ...tool, id: "still-pending", status: "running" } }));
  expect(document.body.textContent).not.toContain("等待审批");
  expect(document.body.textContent).toContain("执行工具");
});

it("shows a live subagent approval before its session loads, then routes to its root", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new MockAgentClient();
  const hierarchy = vi.spyOn(client, "listConversationHierarchy").mockResolvedValue([
    summary("main", null, "agent"), summary("worker", "main", "subagent"),
  ]);
  let listener: ((event: ConversationRunEvent) => void) | undefined;
  vi.spyOn(client, "onConversationRunEvent").mockImplementation((callback) => { listener = callback; return () => {}; });
  const select = vi.fn();
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<ConversationActivity agentClient={client} projects={[]} sessions={[
    session("main"),
  ]} onSelect={select} />); await Promise.resolve(); });
  act(() => listener?.({ type: "tool.approval_requested", conversationId: "worker", runId: "worker-run", tool: {
    ...tool, conversationId: "worker", runId: "worker-run", status: "awaiting_approval",
  } }));
  const trigger = container.querySelector<HTMLButtonElement>("button[aria-label*='审批']");
  expect(trigger).not.toBeNull();
  expect(trigger?.getAttribute("aria-label")).toContain("1 个审批");
  expect(document.querySelector("[role='alert']")?.textContent).toContain("需要权限审批");
  const notice = document.querySelector<HTMLButtonElement>("[role='alert'] button");
  await act(async () => { notice?.click(); await Promise.resolve(); });
  expect(hierarchy).toHaveBeenCalledTimes(1);
  expect(select).toHaveBeenCalledWith("main", "tool");
  select.mockClear();
  act(() => trigger?.click());
  expect(document.body.textContent).toContain("待处理 · 1");
  expect(document.body.textContent).toContain("等待审批");
  expect(document.body.textContent).toContain("审批");
  expect(document.body.textContent).toContain("正在同步对话");
  act(() => trigger?.click());
  await act(async () => { root?.render(<ConversationActivity agentClient={client} projects={[]} sessions={[
    session("main"), session("worker", { parentConversationId: "main", threadKind: "subagent", activeRunId: "worker-run" }),
  ]} onSelect={select} />); await Promise.resolve(); });
  act(() => container.querySelector<HTMLButtonElement>("button[aria-label*='审批']")?.click());
  const row = document.querySelector<HTMLButtonElement>("section[aria-label='待处理'] button");
  act(() => row?.click());
  expect(select).toHaveBeenCalledWith("main", "tool");
});

it("approves a non-current conversation from the toast and activity list", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new MockAgentClient();
  const approve = vi.spyOn(client, "approveToolChange").mockResolvedValue();
  let listener: ((event: ConversationRunEvent) => void) | undefined;
  vi.spyOn(client, "onConversationRunEvent").mockImplementation((callback) => { listener = callback; return () => {}; });
  const select = vi.fn();
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<ConversationActivity agentClient={client} projects={[]} sessions={[
    session("main"), session("worker", { parentConversationId: "main", threadKind: "subagent", activeRunId: "worker-run" }),
  ]} onSelect={select} />); await Promise.resolve(); });
  const approvalEvent: ConversationRunEvent = { type: "tool.approval_requested", conversationId: "worker", runId: "worker-run", tool: {
    ...tool, conversationId: "worker", runId: "worker-run", status: "awaiting_approval",
  } };
  act(() => listener?.(approvalEvent));
  const toastApprove = document.querySelector<HTMLButtonElement>("[role='alert'] button[aria-label='允许一次']");
  expect(toastApprove).not.toBeNull();
  await act(async () => { toastApprove?.click(); await Promise.resolve(); });
  expect(approve).toHaveBeenCalledWith({ approved: true, runId: "worker-run", scope: "once", toolId: "tool" });
  expect(select).not.toHaveBeenCalled();

  // A new approval remains actionable from the persistent activity popover too.
  act(() => listener?.(approvalEvent));
  const trigger = container.querySelector<HTMLButtonElement>("button[aria-label*='审批']");
  act(() => trigger?.click());
  const sessionApprove = document.querySelector<HTMLButtonElement>("section[aria-label='待处理'] button[aria-label='本对话允许']");
  expect(sessionApprove).not.toBeNull();
  await act(async () => { sessionApprove?.click(); await Promise.resolve(); });
  expect(approve).toHaveBeenLastCalledWith({ approved: true, runId: "worker-run", scope: "session", toolId: "tool" });
  expect(select).not.toHaveBeenCalled();
});

it("does not offer session-wide approval for external file reads", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const client = new MockAgentClient();
  vi.spyOn(client, "approveToolChange").mockResolvedValue();
  let listener: ((event: ConversationRunEvent) => void) | undefined;
  vi.spyOn(client, "onConversationRunEvent").mockImplementation((callback) => { listener = callback; return () => {}; });
  const container = document.createElement("div"); document.body.append(container); root = createRoot(container);
  await act(async () => { root?.render(<ConversationActivity agentClient={client} projects={[]} sessions={[session("main", { activeRunId: "run" })]} onSelect={vi.fn()} />); await Promise.resolve(); });
  act(() => listener?.({ type: "tool.approval_requested", conversationId: "main", runId: "run", tool: {
    ...tool, conversationId: "main", runId: "run", name: "read_external_file", status: "awaiting_approval",
  } }));
  act(() => container.querySelector<HTMLButtonElement>("button[aria-label*='审批']")?.click());
  expect(document.querySelector("section[aria-label='待处理'] button[aria-label='允许一次']")).not.toBeNull();
  expect(document.querySelector("section[aria-label='待处理'] button[aria-label='本对话允许']")).toBeNull();
});
