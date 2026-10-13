import { describe, expect, it, vi } from "vitest";
import { DEFAULT_APPLICATION_SETTINGS, type ScheduledTask, type ConversationSummary, type CreateConversationInput } from "@agent/protocol";
import type { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import type { AgentRuntime } from "../agent/agent-runtime.js";
import type { AgentDatabase } from "../storage/agent-database.js";
import type { ProjectRegistry } from "../projects/project-registry.js";
import type { ApplicationSettingsStore } from "../settings/application-settings-store.js";
import { AgentScheduledTaskRunner } from "./agent-scheduled-task-runner.js";
const id = "00000000-0000-4000-8000-000000000001";
const task: ScheduledTask = { id, name: "巡检", prompt: "检查项目", enabled: true, projectId: id, agentId: null,
  permissionMode: "ask_before_changes", recurrence: { kind: "daily", time: "09:00", timezone: "UTC" },
  createdAt: "2026-10-14T00:00:00.000Z", updatedAt: "2026-10-14T00:00:00.000Z", nextRunAt: null, executions: [] };
function fixture() {
  const selection = { providerId: id, modelId: "chosen-model", reasoning: null };
  const create = vi.fn<(projectId: string | null, options: Omit<CreateConversationInput, "projectId">) => { id: string }>(() => ({ id })); const rename = vi.fn();
  const send = vi.fn<AgentRuntime["sendMessage"]>();
  const runner = new AgentScheduledTaskRunner(
    { createConversation: create, renameConversation: rename } as unknown as ConversationLifecycleService,
    { sendMessage: send } as unknown as AgentRuntime,
    { getConversation: () => ({ modelSelection: selection } as ConversationSummary), getConversationRunOutcome: () => ({ status: "completed" }) } as unknown as AgentDatabase,
    { listProjects: () => [{ id }] } as unknown as ProjectRegistry,
    { getConfiguration: () => structuredClone(DEFAULT_APPLICATION_SETTINGS) } as unknown as ApplicationSettingsStore,
  );
  return { runner, create, rename, send, selection };
}
describe("scheduled Agent execution adapter", () => {
  it("creates an ordinary project conversation with the current Agent instructions", () => {
    const { runner, create, rename } = fixture(); runner.validate(task);
    expect(runner.createConversation(task)).toBe(id);
    expect(create.mock.calls[0]?.[0]).toBe(id);
    expect(create.mock.calls[0]?.[1].agent?.isDefault).toBe(true);
    expect(rename).toHaveBeenCalledWith(id, "定时 · 巡检");
  });
  it("uses the existing runtime with explicit permission and the conversation model snapshot", () => {
    const { runner, send, selection } = fixture(); const accepted = vi.fn(); const emit = vi.fn();
    runner.start(task, id, accepted, emit);
    expect(send.mock.calls[0]?.[0]).toEqual({ conversationId: id, content: task.prompt, permissionMode: "ask_before_changes",
      providerId: selection.providerId, modelId: selection.modelId });
    expect(send.mock.calls[0]?.[1]).toBe(emit);
    expect(send.mock.calls[0]?.[2]?.titleOverride).toBe("定时 · 巡检");
    expect(typeof send.mock.calls[0]?.[2]?.beforeRunScheduled).toBe("function");
    expect(runner.outcome(id, id)).toBe("completed");
  });
  it("rejects a removed project and a removed Agent instead of silently choosing another target", () => {
    const { runner } = fixture();
    expect(() => runner.validate({ ...task, projectId: "00000000-0000-4000-8000-000000000099" })).toThrow("项目不存在");
    expect(() => runner.validate({ ...task, agentId: "removed" })).toThrow("Agent 不存在");
  });
});
