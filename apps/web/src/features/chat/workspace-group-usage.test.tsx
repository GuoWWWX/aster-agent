// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DEFAULT_AGENT_DIRECTORY_CONFIGURATION, type ConversationContextUsage, type ConversationRunEvent } from "@agent/protocol";
import { TooltipProvider } from "../../components/ui/tooltip.js";
import type { AgentClient } from "../../runtime/agent-client.js";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { useAgentDirectoryStore } from "../../stores/agent-directory-store.js";
import { useApplicationSettingsStore } from "../../stores/application-settings-store.js";
import type { ProjectSession } from "../projects/project-session-model.js";
import { ConversationWorkspace } from "./workspace-content.js";

let root: Root | undefined;
let container: HTMLDivElement;
const flush = async () => { for (let index = 0; index < 25; index++) await Promise.resolve(); };
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  useAgentDirectoryStore.getState().hydrate(structuredClone(DEFAULT_AGENT_DIRECTORY_CONFIGURATION));
  useApplicationSettingsStore.getState().setShowContextUsage(true);
  container = document.createElement("div"); document.body.append(container); root = createRoot(container);
});
afterEach(() => { act(() => root?.unmount()); root = undefined; document.body.replaceChildren(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function fixture() {
  const mock = new MockAgentClient(); const client: AgentClient = mock;
  const instance = await client.createTeamInstance({ teamId: "default-team", scope: "global" });
  const coordinator = await client.getTeamChatCoordinationConversation({ teamInstanceId: instance.id });
  const lead = (await client.listConversationHierarchy()).find(item => item.id === instance.rootConversationId)!;
  const session: ProjectSession = { ...lead, pinOrder: lead.pinOrder ?? null };
  const base = await client.getConversationContextUsage({ conversationId: coordinator.id, permissionMode: "full_access" });
  const usage: ConversationContextUsage = { ...base, estimatedInputTokens: 45_000, skillReserveTokens: 0,
    providerCache: { firstTokenLatencyMs: 1250, outputTokensPerSecond: 44,
      cumulative: { cacheCreationInputTokens: 0, cachedInputTokens: 27_006, hitRate: 0.625, inputTokens: 43_210, reportedRequestCount: 1, requestCount: 1 },
      latest: { cacheCreationInputTokens: 0, cachedInputTokens: 27_006, hitRate: 0.625, inputTokens: 43_210, outputTokens: 88, trendDelta: null } } };
  const measured = vi.spyOn(client, "getConversationContextUsage").mockResolvedValue(usage);
  const resolve = vi.spyOn(client, "getTeamChatCoordinationConversation");
  const timeline = vi.spyOn(client, "listConversationTimelinePage");
  const listeners = new Set<(event: ConversationRunEvent) => void>();
  const subscribe = vi.spyOn(client, "onConversationRunEvent").mockImplementation(listener => { listeners.add(listener); return () => listeners.delete(listener); });
  const emit = (event: ConversationRunEvent) => { for (const listener of [...listeners]) listener(event); };
  const show = async (active = true, instanceId = instance.id) => {
    await act(async () => { root?.render(<TooltipProvider><ConversationWorkspace agentClient={client} project={null} session={session}
      active={active} groupChat={{ instanceId }} /></TooltipProvider>); await flush(); });
  };
  return { client, instance, coordinator, session, usage, measured, resolve, timeline, subscribe, emit, show };
}

it("shows the owner's actual metrics and context without reading the leader's private history or subscribing to text streams", async () => {
  const f = await fixture(); await f.show(false);
  expect(f.resolve).not.toHaveBeenCalled(); expect(f.measured).not.toHaveBeenCalled();
  await f.show();
  expect(f.measured).toHaveBeenCalled();
  expect(f.measured.mock.calls.every(([input]) => input.conversationId === f.coordinator.id)).toBe(true);
  expect(f.timeline).not.toHaveBeenCalled();
  expect(f.subscribe.mock.calls.every(([, streams]) => (streams?.length ?? 0) === 0)).toBe(true);
  expect(container.textContent).toContain("43,210"); expect(container.textContent).toContain("62.5%");
  expect(container.querySelector('.context-usage-indicator__trigger')?.getAttribute("data-pressure")).not.toBe("unknown");
  expect(f.resolve).toHaveBeenCalledTimes(1);
});

it("refreshes on owner execution boundaries, preserves measurements while waiting and only catches up when a hidden group returns", async () => {
  const f = await fixture(); await f.show();
  const runId = crypto.randomUUID(); const previousCalls = f.measured.mock.calls.length;
  await act(async () => {
    f.emit({ type: "run.finished", conversationId: f.session.id, runId, status: "completed", error: null });
    f.emit({ type: "assistant.delta", conversationId: f.coordinator.id, runId, messageId: crypto.randomUUID(), modelId: "fixture", delta: "输出" });
    await flush();
  });
  expect(f.measured).toHaveBeenCalledTimes(previousCalls);
  f.measured.mockResolvedValue({ ...f.usage, providerCache: { ...f.usage.providerCache!, latest: null } });
  await act(async () => { f.emit({ type: "model.request_started", conversationId: f.coordinator.id, runId }); await flush(); });
  expect(container.textContent).toContain("43,210");
  await f.show(false); const hiddenCalls = f.measured.mock.calls.length;
  f.measured.mockResolvedValue({ ...f.usage, estimatedInputTokens: 52_000,
    providerCache: { ...f.usage.providerCache!, latest: { ...f.usage.providerCache!.latest!, inputTokens: 50_001 } } });
  await act(async () => { f.emit({ type: "run.finished", conversationId: f.coordinator.id, runId, status: "completed", error: null }); await flush(); });
  expect(f.measured).toHaveBeenCalledTimes(hiddenCalls);
  await f.show(); expect(container.textContent).toContain("50,001"); expect(f.resolve).toHaveBeenCalledTimes(1);
  const caughtUp = f.measured.mock.calls.length;
  await f.show(false); await f.show(); expect(f.measured).toHaveBeenCalledTimes(caughtUp);
});

it("does not let a late measurement from the previous group overwrite the new owner's figures", async () => {
  const f = await fixture();
  const other = await f.client.createTeamInstance({ teamId: "default-team", scope: "project", projectId: (await f.client.listProjects())[0]!.id });
  const otherOwner = await f.client.getTeamChatCoordinationConversation({ teamInstanceId: other.id });
  let release: (usage: ConversationContextUsage) => void = () => {};
  f.measured.mockImplementation(input => input.conversationId === f.coordinator.id ? new Promise(resolve => { release = resolve; })
    : Promise.resolve({ ...f.usage, providerCache: { ...f.usage.providerCache!, latest: { ...f.usage.providerCache!.latest!, inputTokens: 9_999 } } }));
  await f.show(); await f.show(true, other.id);
  expect(f.measured.mock.calls.at(-1)?.[0].conversationId).toBe(otherOwner.id);
  expect(container.textContent).toContain("9,999");
  await act(async () => { release(f.usage); await flush(); });
  expect(container.textContent).toContain("9,999"); expect(container.textContent).not.toContain("43,210");
});

it("keeps reported metrics through a transient query failure and retries on the next owner event", async () => {
  const f = await fixture(); await f.show(); const runId = crypto.randomUUID();
  f.measured.mockRejectedValueOnce(new Error("temporary"));
  await act(async () => { f.emit({ type: "run.finished", conversationId: f.coordinator.id, runId, status: "failed", error: "temporary" }); await flush(); });
  expect(container.textContent).toContain("43,210");
  expect(container.querySelector('.context-usage-indicator__trigger')?.getAttribute("data-pressure")).toBe("unknown");
  await act(async () => { f.emit({ type: "model.request_started", conversationId: f.coordinator.id, runId }); await flush(); });
  expect(container.querySelector('.context-usage-indicator__trigger')?.getAttribute("data-pressure")).not.toBe("unknown");
});
