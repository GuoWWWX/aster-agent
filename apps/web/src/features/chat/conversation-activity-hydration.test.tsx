// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ConversationTimelinePage, ConversationToolItem } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/index.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationActivity } from "./conversation-activity.js";

const session = (index: number, runId = `run-${index}`): ProjectSession => ({ id: `session-${index}`, title: `Session ${index}`, activeRunId: runId,
  agentId: null, hasUnreadResult: false, isArchived: false, isPinned: false, lastRunStatus: "running", modelSelection: null,
  parentConversationId: null, projectId: null, teamId: null, threadKind: "agent", workspaceRootPath: null });
const emptyPage: ConversationTimelinePage = { items: [], hasMore: false, nextBeforeSequence: null };
const approval = (runId: string): ConversationToolItem => ({ id: `tool-${runId}`, kind: "tool", conversationId: "session-0", runId,
  createdAt: "2026-10-19T00:00:00Z", name: "run_command", arguments: "{}", batchId: null, diff: null, result: null, status: "awaiting_approval" });
let root: Root | null;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root?.unmount(); await settle(); }); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); });
async function settle(): Promise<void> { for (let index = 0; index < 12; index++) await Promise.resolve(); }
async function render(client: MockAgentClient, sessions: ProjectSession[]): Promise<void> {
  await act(async () => { root?.render(<ConversationActivity agentClient={client} projects={[]} sessions={sessions} onSelect={() => {}} />); await settle(); });
}
async function open(): Promise<void> { await act(async () => { container.querySelector<HTMLButtonElement>("button")?.click(); await settle(); }); }

it("hydrates each unchanged run once as sixteen other live runs join", async () => {
  const client = new MockAgentClient();
  const read = vi.spyOn(client, "listConversationTimelinePage").mockResolvedValue(emptyPage);
  for (let count = 1; count <= 16; count++) await render(client, Array.from({ length: count }, (_, index) => session(index)));
  expect(read).toHaveBeenCalledTimes(16);
  expect(read.mock.calls.filter(([input]) => input.conversationId === "session-0")).toHaveLength(1);
});

it("keeps four total reads in flight across rapid run-set changes, then drains the current queue", async () => {
  const client = new MockAgentClient();
  let inFlight = 0; let peak = 0;
  const pending: (() => void)[] = [];
  const read = vi.spyOn(client, "listConversationTimelinePage").mockImplementation(() => {
    inFlight++; peak = Math.max(peak, inFlight);
    return new Promise(resolve => pending.push(() => { inFlight--; resolve(emptyPage); }));
  });
  for (let count = 1; count <= 16; count++) await render(client, Array.from({ length: count }, (_, index) => session(index)));
  expect(read).toHaveBeenCalledTimes(4); expect(peak).toBe(4);
  while (pending.length > 0) await act(async () => { for (const resolve of pending.splice(0)) resolve(); await settle(); });
  expect(read).toHaveBeenCalledTimes(16); expect(peak).toBe(4); expect(inFlight).toBe(0);
});

it("ignores the removed run's late approval after the same conversation starts another run", async () => {
  const client = new MockAgentClient();
  const pages: ((page: ConversationTimelinePage) => void)[] = [];
  vi.spyOn(client, "listConversationTimelinePage").mockImplementation(() => new Promise(resolve => pages.push(resolve)));
  const approve = vi.spyOn(client, "approveToolChange").mockResolvedValue();
  await render(client, [session(0, "old")]); await render(client, [session(0, "new")]);
  await act(async () => { pages[1]!({ ...emptyPage, items: [approval("new")] }); await settle(); });
  await act(async () => { pages[0]!({ ...emptyPage, items: [approval("old")] }); await settle(); });
  await open();
  const button = document.querySelector<HTMLButtonElement>("section[aria-label='待处理'] button[aria-label='允许一次']");
  expect(button).not.toBeNull();
  await act(async () => { button?.click(); await settle(); });
  expect(approve).toHaveBeenCalledWith({ approved: true, runId: "new", scope: "once", toolId: "tool-new" });
});

it("does not restore approvals from a run removed while its history was pending", async () => {
  const client = new MockAgentClient();
  let finish: (page: ConversationTimelinePage) => void = () => {};
  vi.spyOn(client, "listConversationTimelinePage").mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await render(client, [session(0)]); await render(client, [{ ...session(0), activeRunId: null }]);
  await act(async () => { finish({ ...emptyPage, items: [approval("run-0")] }); await settle(); });
  expect(container.querySelector("button")?.getAttribute("aria-label")).not.toContain("审批");
});

it("retries failed runs without re-reading successfully hydrated runs", async () => {
  const client = new MockAgentClient();
  let failed = false;
  const read = vi.spyOn(client, "listConversationTimelinePage").mockImplementation(({ conversationId }) => {
    if (conversationId === "session-1" && !failed) { failed = true; return Promise.reject(new Error("temporary")); }
    return Promise.resolve(emptyPage);
  });
  await render(client, [session(0), session(1)]); await open();
  const retry = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(button => button.textContent === "重试");
  expect(retry).not.toBeUndefined();
  await act(async () => { retry?.click(); await settle(); });
  expect(read.mock.calls.filter(([input]) => input.conversationId === "session-0")).toHaveLength(1);
  expect(read.mock.calls.filter(([input]) => input.conversationId === "session-1")).toHaveLength(2);
  expect(document.body.textContent).not.toContain("部分动态暂不可用");
});

it("does not start queued reads after unmount", async () => {
  const client = new MockAgentClient();
  const pending: (() => void)[] = [];
  const read = vi.spyOn(client, "listConversationTimelinePage").mockImplementation(() => new Promise(resolve => pending.push(() => resolve(emptyPage))));
  await render(client, Array.from({ length: 8 }, (_, index) => session(index)));
  await act(async () => { root?.unmount(); root = null; for (const finish of pending) finish(); await settle(); });
  expect(read).toHaveBeenCalledTimes(4);
});

it("keeps removed requests in the concurrency budget until they settle", async () => {
  const client = new MockAgentClient();
  const pending: (() => void)[] = [];
  const read = vi.spyOn(client, "listConversationTimelinePage").mockImplementation(() => new Promise(resolve => pending.push(() => resolve(emptyPage))));
  await render(client, Array.from({ length: 4 }, (_, index) => session(index, "old")));
  await render(client, Array.from({ length: 8 }, (_, index) => session(index, "new")));
  expect(read).toHaveBeenCalledTimes(4);
  await act(async () => { for (const finish of pending.splice(0)) finish(); await settle(); });
  expect(read).toHaveBeenCalledTimes(8);
  while (pending.length > 0) await act(async () => { for (const finish of pending.splice(0)) finish(); await settle(); });
  expect(read).toHaveBeenCalledTimes(12);
});

it("pages only to the current run boundary and retains pending approvals", async () => {
  const client = new MockAgentClient();
  const read = vi.spyOn(client, "listConversationTimelinePage")
    .mockResolvedValueOnce({ items: [approval("run-0")], hasMore: true, nextBeforeSequence: 50 })
    .mockResolvedValueOnce({ items: [{ ...approval("older"), id: "older" }], hasMore: true, nextBeforeSequence: 10 });
  await render(client, [session(0)]);
  expect(read).toHaveBeenCalledTimes(2);
  expect(read).toHaveBeenLastCalledWith({ conversationId: "session-0", limit: 50, beforeSequence: 50 });
  await open();
  expect(document.querySelector("section[aria-label='待处理'] button[aria-label='允许一次']")).not.toBeNull();
});

it("does not start a second hydration generation during StrictMode effect replay", async () => {
  const client = new MockAgentClient();
  const read = vi.spyOn(client, "listConversationTimelinePage").mockResolvedValue(emptyPage);
  await act(async () => {
    root?.render(<StrictMode><ConversationActivity agentClient={client} projects={[]} sessions={[session(0), session(1)]} onSelect={() => {}} /></StrictMode>);
    await settle();
  });
  expect(read).toHaveBeenCalledTimes(2);
});
