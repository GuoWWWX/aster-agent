// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationContextUsage, type ConversationRunEvent, type ConversationToolItem } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import { MockAgentClient } from "../../runtime/index.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useApplicationSettingsStore } from "../../stores/application-settings-store.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationWorkspace } from "./workspace-content.js";

let root: Root | null;
let container: HTMLDivElement;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  useApplicationSettingsStore.setState({ showContextUsage: true });
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => { root?.unmount(); await settle(); }); root = null; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
async function settle(): Promise<void> { for (let index = 0; index < 20; index++) await Promise.resolve(); }
const meterLabel = (): string | null => container.querySelector(".context-usage-indicator__trigger")?.getAttribute("aria-label") ?? null;
async function setup() {
  const client = new MockAgentClient();
  const conversation = await client.createConversation({});
  const current: ProjectSession = { ...conversation, pinOrder: conversation.pinOrder ?? null, permissionMode: "full_access" };
  const baseUsage = await client.getConversationContextUsage({ conversationId: conversation.id, permissionMode: "full_access" });
  const usage = (tokens: number): ConversationContextUsage => ({ ...baseUsage, estimatedInputTokens: tokens, skillReserveTokens: 0 });
  const listeners = new Set<(event: ConversationRunEvent) => void>();
  vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { listeners.add(listener); return () => listeners.delete(listener); });
  const read = vi.spyOn(client, "getConversationContextUsage").mockResolvedValue(usage(111));
  const show = async (active = true, session = current): Promise<void> => act(async () => {
    root?.render(<TooltipProvider><ConversationWorkspace active={active} agentClient={client} project={null} session={session} /></TooltipProvider>);
    await settle();
  });
  const emit = (conversationId = current.id, count = 1, completedOnly = false): void => {
    for (let index = 0; index < count; index++) {
      const tool: ConversationToolItem = { id: crypto.randomUUID(), kind: "tool", conversationId, runId: "run", createdAt: "2026-10-19T00:00:00Z",
        name: "read_file", arguments: "{}", batchId: null, diff: null, result: null, status: "running" };
      if (!completedOnly) for (const listener of [...listeners]) listener({ type: "tool.started", conversationId, runId: "run", tool });
      for (const listener of [...listeners]) listener({ type: "tool.completed", conversationId, runId: "run", tool: { ...tool, status: "completed" } });
    }
  };
  await show(); read.mockClear();
  return { client, current, usage, read, show, emit };
}

it("merges a 64-event tool burst into one in-flight read and one trailing refresh", async () => {
  const { usage, read, emit } = await setup();
  const pending: ((value: ConversationContextUsage) => void)[] = [];
  let inFlight = 0; let peak = 0;
  read.mockImplementation(() => { inFlight++; peak = Math.max(peak, inFlight); return new Promise(resolve => pending.push(value => { inFlight--; resolve(value); })); });
  await act(async () => { emit(undefined, 32); await settle(); });
  expect(read).toHaveBeenCalledTimes(1); expect(peak).toBe(1);
  await act(async () => { pending.shift()!(usage(222)); await settle(); });
  expect(read).toHaveBeenCalledTimes(2); expect(peak).toBe(1);
  await act(async () => { pending.shift()!(usage(333)); await settle(); });
  expect(read).toHaveBeenCalledTimes(2); expect(meterLabel()).toContain("333 tokens");
});

it("ignores a measurement completed while hidden and refreshes once on return", async () => {
  const { usage, read, show, emit } = await setup();
  const pending: ((value: ConversationContextUsage) => void)[] = [];
  read.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  await act(async () => { emit(); await settle(); });
  await show(false);
  await act(async () => { for (const finish of pending.splice(0)) finish(usage(444)); await settle(); });
  expect(meterLabel()).toContain("111 tokens");
  expect(read).toHaveBeenCalledTimes(1);
  await show(true);
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => { pending.shift()!(usage(555)); await settle(); });
  expect(meterLabel()).toContain("555 tokens");
});

it("keeps a hidden pending read in flight until it settles before sending the return refresh", async () => {
  const { usage, read, show, emit } = await setup();
  const pending: ((value: ConversationContextUsage) => void)[] = [];
  read.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  await act(async () => { emit(); await settle(); });
  await show(false); await show(true);
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { pending.shift()!(usage(444)); await settle(); });
  expect(read).toHaveBeenCalledTimes(2); expect(meterLabel()).toContain("111 tokens");
  await act(async () => { pending.shift()!(usage(555)); await settle(); });
  expect(meterLabel()).toContain("555 tokens");
});

it("starts changed permission parameters immediately but rejects previous measurements and trailing work", async () => {
  const { current, usage, read, show, emit } = await setup();
  const pending: ((value: ConversationContextUsage) => void)[] = [];
  read.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  await act(async () => { emit(); await settle(); });
  await show(true, { ...current, permissionMode: "request_approval" });
  await show(true, { ...current, permissionMode: "auto_review" });
  expect(read).toHaveBeenCalledTimes(3);
  await act(async () => { pending.shift()!(usage(222)); await settle(); });
  expect(read).toHaveBeenCalledTimes(3);
  expect(read.mock.lastCall?.[0].permissionMode).toBe("auto_review");
  expect(meterLabel()).toContain("111 tokens");
  await act(async () => { pending.shift()!(usage(222)); await settle(); });
  expect(meterLabel()).toContain("111 tokens");
  await act(async () => { pending.shift()!(usage(333)); await settle(); });
  expect(meterLabel()).toContain("333 tokens");
});

it("does not apply a previous conversation's late measurement to the new conversation", async () => {
  const { client, current, usage, read, show, emit } = await setup();
  const next = await client.createConversation({});
  const pending: ((value: ConversationContextUsage) => void)[] = [];
  read.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  await act(async () => { emit(current.id); await settle(); });
  await show(true, { ...next, pinOrder: next.pinOrder ?? null, permissionMode: "full_access" });
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => { pending.shift()!(usage(222)); await settle(); });
  expect(read.mock.lastCall?.[0].conversationId).toBe(next.id);
  expect(meterLabel()).not.toContain("222 tokens");
  await act(async () => { pending.shift()!(usage(333)); await settle(); });
  expect(meterLabel()).toContain("333 tokens");
});

it("reuses the in-flight slot when returning to an earlier parameter scope", async () => {
  const { current, usage, read, show, emit } = await setup();
  const pending: ((value: ConversationContextUsage) => void)[] = [];
  read.mockImplementation(() => new Promise(resolve => pending.push(resolve)));
  await act(async () => { emit(undefined, 1, true); await settle(); });
  await show(true, { ...current, permissionMode: "request_approval" });
  await show(true, current);
  expect(read).toHaveBeenCalledTimes(2);
  await act(async () => { pending.shift()!(usage(222)); await settle(); });
  expect(read).toHaveBeenCalledTimes(3); expect(read.mock.lastCall?.[0].permissionMode).toBe("full_access");
  expect(meterLabel()).toContain("111 tokens");
  await act(async () => { pending.shift()!(usage(222)); await settle(); });
  expect(meterLabel()).toContain("111 tokens");
  await act(async () => { pending.shift()!(usage(333)); await settle(); });
  expect(meterLabel()).toContain("333 tokens");
});

it.each(["rejected", "thrown"])("releases a %s read so a later event can refresh without an automatic retry loop", async failure => {
  const { usage, read, emit } = await setup();
  if (failure === "thrown") read.mockImplementationOnce(() => { throw new Error("temporary"); });
  else read.mockRejectedValueOnce(new Error("temporary"));
  read.mockResolvedValue(usage(444));
  await act(async () => { emit(undefined, 1, true); await settle(); });
  expect(read).toHaveBeenCalledTimes(1);
  expect(meterLabel()).toBe("正在统计上下文使用情况");
  await act(async () => { emit(undefined, 1, true); await settle(); });
  expect(read).toHaveBeenCalledTimes(2);
  expect(meterLabel()).toContain("444 tokens");
});

it("drops a queued refresh when the workspace unmounts before the current read returns", async () => {
  const { usage, read, emit } = await setup();
  let finish: (value: ConversationContextUsage) => void = () => {};
  read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { emit(); await settle(); });
  expect(read).toHaveBeenCalledTimes(1);
  await act(async () => { root?.unmount(); root = null; finish(usage(444)); await settle(); });
  expect(read).toHaveBeenCalledTimes(1);
});

it("disposes the prior client owner without blocking the new client's measurement", async () => {
  const { usage, read, emit } = await setup();
  let finish: (value: ConversationContextUsage) => void = () => {};
  read.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  await act(async () => { emit(); await settle(); });
  const nextClient = new MockAgentClient();
  const next = await nextClient.createConversation({});
  const nextSession: ProjectSession = { ...next, pinOrder: next.pinOrder ?? null, permissionMode: "full_access" };
  const nextRead = vi.spyOn(nextClient, "getConversationContextUsage").mockResolvedValue(usage(333));
  await act(async () => {
    root?.render(<TooltipProvider><ConversationWorkspace agentClient={nextClient} project={null} session={nextSession} /></TooltipProvider>);
    await settle();
  });
  expect(nextRead).toHaveBeenCalled(); expect(meterLabel()).toContain("333 tokens");
  await act(async () => { finish(usage(444)); await settle(); });
  expect(meterLabel()).toContain("333 tokens");
  expect(read).toHaveBeenCalledTimes(1);
});
