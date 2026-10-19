// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConversationRunEvent, ConversationToolItem } from "@agent/protocol";
import { MockAgentClient } from "../../runtime/mock-agent-client.js";
import { ConversationWorkIndicator, ConversationWorkProvider, toolWorkPhase, updateConversationWorkState } from "./conversation-work-state.js";

const conversationId = "00000000-0000-4000-8000-000000000001";
const runId = "00000000-0000-4000-8000-000000000002";
function tool(id: string, name: string): ConversationToolItem {
  return { id, name, conversationId, runId, kind: "tool", batchId: null, createdAt: "2026-10-16T00:00:00Z", arguments: "{}", result: null, diff: null, status: "running" };
}
const request: ConversationRunEvent = { type: "model.request_started", conversationId, runId };
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("conversation work phases", () => {
  it.each([['web_search','searching'],['search_text','searching'],['read_file','searching'],['run_command','executing'],['apply_patch','executing'],['wait_for_subagents','waiting'],['request_user_input','waiting']])("maps %s to %s", (name, phase) => {
    expect(toolWorkPhase(name)).toBe(phase);
  });

  it("keeps parallel tools active until the last tool finishes", () => {
    const search = tool("search", "web_search"), command = tool("command", "run_command");
    let state = updateConversationWorkState({}, request);
    state = updateConversationWorkState(state, { type: "tool.started", conversationId, runId, tool: search });
    state = updateConversationWorkState(state, { type: "tool.started", conversationId, runId, tool: command });
    expect(state[runId]?.phase).toBe("executing");
    state = updateConversationWorkState(state, { type: "tool.completed", conversationId, runId, tool: { ...command, status: "completed" } });
    expect(state[runId]?.phase).toBe("searching");
    state = updateConversationWorkState(state, { type: "tool.completed", conversationId, runId, tool: { ...search, status: "completed" } });
    expect(state[runId]?.phase).toBe("thinking");
  });

  it("waits for approval, then resumes execution and output without updating on every token", () => {
    const command = tool("command", "run_command");
    let state = updateConversationWorkState({}, { type: "tool.approval_requested", conversationId, runId, tool: { ...command, status: "awaiting_approval" } });
    expect(state[runId]?.phase).toBe("waiting");
    state = updateConversationWorkState(state, { type: "tool.started", conversationId, runId, tool: command });
    expect(state[runId]?.phase).toBe("executing");
    const delta: ConversationRunEvent = { type: "assistant.delta", conversationId, runId, delta: "回复", messageId: "message", modelId: "model" };
    state = updateConversationWorkState(state, delta);
    expect(state[runId]?.phase).toBe("writing");
    expect(updateConversationWorkState(state, { ...delta, delta: "下一段" })).toBe(state);
    state = updateConversationWorkState(state, { type: "run.finished", conversationId, runId, status: "completed", error: null });
    expect(state[runId]).toBeUndefined();
  });

  it("does not let an old Run's finish clear a newer Run", () => {
    const state = updateConversationWorkState({}, request);
    expect(updateConversationWorkState(state, { type: "run.finished", conversationId, runId: "old-run", status: "cancelled", error: null })).toBe(state);
  });

  it("shares real phases between indicators and releases its event subscription", () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    const client = new MockAgentClient();
    const unsubscribe = vi.fn();
    let emit: (event: ConversationRunEvent) => void = () => {};
    vi.spyOn(client, "onConversationRunEvent").mockImplementation(callback => { emit = callback; return unsubscribe; });
    const node = document.createElement("div"); document.body.append(node);
    const root = createRoot(node);
    act(() => root.render(<ConversationWorkProvider agentClient={client}>
      <ConversationWorkIndicator runId={runId} aria-label="工作过程" />
      <ConversationWorkIndicator runId={runId} aria-label="对话标签" />
      <ConversationWorkIndicator runId="other-run" aria-label="其他对话" />
      <ConversationWorkIndicator runId={runId} showLabel />
    </ConversationWorkProvider>));
    act(() => emit({ type: "tool.started", conversationId, runId, tool: tool("search", "web_search") }));
    expect(node.querySelector('[aria-label="工作过程"]')?.getAttribute("data-phase")).toBe("searching");
    expect(node.querySelector('[aria-label="对话标签"]')?.getAttribute("data-phase")).toBe("searching");
    expect(node.querySelector('[aria-label="其他对话"]')?.getAttribute("data-phase")).toBe("thinking");
    expect(node.textContent).toBe("正在查阅");
    act(() => emit({ type: "assistant.delta", conversationId, runId, delta: "回复", messageId: "message", modelId: "model" }));
    expect(node.textContent).toBe("正在输出");
    act(() => root.unmount()); node.remove();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
