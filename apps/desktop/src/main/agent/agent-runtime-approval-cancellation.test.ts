import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { z } from "zod";
import type { ConversationRunEvent } from "@agent/protocol";
import type { ModelProviderAdapter } from "../model/model-contracts.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { AgentRuntime } from "./agent-runtime.js";

it.each([
  [false, "once"], [false, "session"], [true, "once"], [true, "session"],
] as const)("rejects same-tick approval after cancellation without granting later execution (WAL=%s, scope=%s)", async (writeAhead, scope) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-approval-cancel-"));
  const database = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(database);
  const conversation = database.createConversation(null);
  const tools = new ProjectToolRegistry(projects);
  // Even a regression in permission handling cannot start a real shell here.
  const execute = vi.spyOn(tools, "executePreparedCommand").mockResolvedValue({
    content: JSON.stringify({ ok: true, value: { mock: true } }), isError: false, kind: "completed",
  });
  let calls = 0;
  const model: ModelProviderAdapter = { completeTurn: () => {
    calls += 1;
    return Promise.resolve(calls <= 2
      ? { content: "", finishReason: "tool_calls", toolCalls: [{
          id: `cancel_approval_${calls}`, name: "run_command",
          arguments: JSON.stringify({ command: "Write-Output approval-cancellation-fixture", yieldTimeMs: 0 }),
        }] }
      : { content: "done", finishReason: "stop", toolCalls: [] });
  } };
  const threadLog = writeAhead ? new ThreadLog(path.join(root, "conversations")) : null;
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({
    apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://fixture.invalid/v1",
    modelId: "fixture", reasoningOptions: [],
  }) }, projects, tools, model, undefined, undefined, null, null, null, null, null, undefined, null,
  threadLog, threadLog === null ? null : new EventProjector(database, threadLog));
  let staleApprovalError: unknown;
  let secondApprovals = 0;
  const afterCancelEvents: string[] = [];
  let cancelReturned = false;
  try {
    const firstFinished = await new Promise<Extract<ConversationRunEvent, { type: "run.finished" }>>(resolve => {
      runtime.sendMessage({ content: "first command", conversationId: conversation.id, permissionMode: "request_approval" }, event => {
        if (cancelReturned) afterCancelEvents.push(event.type);
        if (event.type === "tool.approval_requested") {
          runtime.cancelRun(event.runId);
          cancelReturned = true;
          try { runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id, scope }); }
          catch (error) { staleApprovalError = error; }
        }
        if (event.type === "run.finished") resolve(event);
      });
    });
    const firstTools = database.listTimeline(conversation.id).filter(item => item.kind === "tool");
    await new Promise<void>(resolve => {
      runtime.sendMessage({ content: "second same command", conversationId: conversation.id, permissionMode: "request_approval" }, event => {
        if (event.type === "tool.approval_requested") {
          secondApprovals += 1;
          runtime.approveToolChange({ approved: false, runId: event.runId, toolId: event.tool.id, scope: "once" });
        }
        if (event.type === "run.finished") resolve();
      });
    });
    expect.soft(firstFinished.status).toBe("cancelled");
    expect.soft(firstFinished.agentError?.code).toBe("PROCESS_CANCELLED");
    expect.soft(staleApprovalError).toMatchObject({ code: "APPROVAL_EXPIRED" });
    expect.soft(afterCancelEvents).not.toContain("tool.started");
    expect.soft(firstTools).toHaveLength(1);
    expect.soft(firstTools[0]).toMatchObject({ status: "cancelled", result: "审批已失效：所属运行已经结束。" });
    expect.soft(secondApprovals).toBe(1);
    expect.soft(execute).not.toHaveBeenCalled();
    if (threadLog !== null) {
      const events = threadLog.read(conversation.id)?.events ?? [];
      expect.soft(events.filter(event => event.type === "tool_approval_expired")).toHaveLength(1);
      expect.soft(events.filter(event => event.type === "tool_approval_decided")).toHaveLength(1);
    }
  } finally {
    await runtime.stopAllRuns();
    await tools.dispose();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([[false, false], [true, false], [false, true], [true, true]] as const)("replays mixed parallel approval decisions once per original ToolCall (WAL=%s, shared candidates=%s)", async (writeAhead, sharedCandidates) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-approval-batch-"));
  const database = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(database);
  const conversation = database.createConversation(null);
  const tools = new ProjectToolRegistry(projects);
  const executed: string[] = [];
  vi.spyOn(tools, "executePreparedCommand").mockImplementation(command => {
    executed.push(command.description ?? command.command);
    return Promise.resolve({ content: JSON.stringify({ ok: true, value: { mock: true } }), isError: false, kind: "completed" });
  });
  let calls = 0;
  const model: ModelProviderAdapter = { completeTurn: () => Promise.resolve(++calls === 1
    ? { content: "", finishReason: "tool_calls", toolCalls: ["one", "two", "three", "four"].map((label, index) => ({
        id: `mixed_approval_${label}`, name: "run_command", arguments: JSON.stringify({ command: sharedCandidates ? `shared-${Math.floor(index / 2)}` : label, description: label, yieldTimeMs: 0 }),
      })) }
    : { content: "done", finishReason: "stop", toolCalls: [] }) };
  const threadLog = writeAhead ? new ThreadLog(path.join(root, "conversations")) : null;
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({
    apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://fixture.invalid/v1",
    modelId: "fixture", reasoningOptions: [],
  }) }, projects, tools, model, undefined, undefined, null, null, null, null, null, undefined, null,
  threadLog, threadLog === null ? null : new EventProjector(database, threadLog));
  const requested = new Map<string, number>();
  const decisionErrors: unknown[] = [];
  const labelOf = (argumentsText: string) => z.object({ description: z.string() }).parse(JSON.parse(argumentsText)).description;
  try {
    await new Promise<void>(resolve => {
      runtime.sendMessage({ content: "mixed decisions", conversationId: conversation.id, permissionMode: "request_approval" }, event => {
        if (event.type === "tool.approval_requested") {
          requested.set(event.tool.id, (requested.get(event.tool.id) ?? 0) + 1);
          try {
            runtime.approveToolChange({ approved: ["one", "three"].includes(labelOf(event.tool.arguments)), runId: event.runId, toolId: event.tool.id, scope: sharedCandidates ? "session" : "once" });
          } catch (error) { decisionErrors.push(error); throw error; }
        }
        if (event.type === "run.finished") resolve();
      });
    });
    const rows = database.listTimeline(conversation.id).filter(item => item.kind === "tool");
    expect.soft(requested.size).toBe(4);
    expect.soft([...requested.values()]).toEqual([1, 1, 1, 1]);
    expect.soft(decisionErrors).toEqual([]);
    expect.soft(executed.sort()).toEqual(["one", "three"]);
    expect.soft(rows.map(tool => [labelOf(tool.arguments), tool.status])).toEqual([
      ["one", "completed"], ["two", "rejected"], ["three", "completed"], ["four", "rejected"],
    ]);
    if (threadLog !== null) {
      const events = threadLog.read(conversation.id)?.events ?? [];
      for (const tool of rows) {
        expect.soft(events.filter(event => event.type === "tool_approval_requested" && event.payload.toolId === tool.id)).toHaveLength(1);
        expect.soft(events.filter(event => event.type === "tool_approval_decided" && event.payload.toolId === tool.id)).toHaveLength(1);
      }
    }
  } finally {
    await runtime.stopAllRuns();
    await tools.dispose();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([false, true])("allows retry after failed decision persistence without leaking a session grant (WAL=%s)", async writeAhead => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-approval-persist-"));
  const database = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(database);
  const conversation = database.createConversation(null);
  const tools = new ProjectToolRegistry(projects);
  const execute = vi.spyOn(tools, "executePreparedCommand").mockResolvedValue({
    content: JSON.stringify({ ok: true, value: { mock: true } }), isError: false, kind: "completed",
  });
  let calls = 0;
  const model: ModelProviderAdapter = { completeTurn: () => {
    calls += 1;
    return Promise.resolve(calls % 2 === 1
      ? { content: "", finishReason: "tool_calls", toolCalls: [{
          id: `failed_persistence_${calls}`, name: "run_command",
          arguments: JSON.stringify({ command: "Write-Output approval-persistence-fixture", yieldTimeMs: 0 }),
        }] }
      : { content: "done", finishReason: "stop", toolCalls: [] });
  } };
  const threadLog = writeAhead ? new ThreadLog(path.join(root, "conversations")) : null;
  let failNext = true;
  if (threadLog !== null) {
    const append = threadLog.append.bind(threadLog);
    vi.spyOn(threadLog, "append").mockImplementation((id, event) => {
      if (event.type === "tool_approval_decided" && failNext) { failNext = false; throw new Error("fixture decision write failed"); }
      return append(id, event);
    });
  } else {
    const update = database.updateTool.bind(database);
    vi.spyOn(database, "updateTool").mockImplementation(tool => {
      if (tool.status === "running" && failNext) { failNext = false; throw new Error("fixture decision write failed"); }
      update(tool);
    });
  }
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({
    apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://fixture.invalid/v1",
    modelId: "fixture", reasoningOptions: [],
  }) }, projects, tools, model, undefined, undefined, null, null, null, null, null, undefined, null,
  threadLog, threadLog === null ? null : new EventProjector(database, threadLog));
  let failure: unknown;
  let secondApprovals = 0;
  try {
    await new Promise<void>(resolve => {
      runtime.sendMessage({ content: "first decision fails", conversationId: conversation.id, permissionMode: "request_approval" }, event => {
        if (event.type === "tool.approval_requested") {
          try { runtime.approveToolChange({ approved: true, runId: event.runId, toolId: event.tool.id, scope: "session" }); }
          catch (error) { failure = error; }
          runtime.approveToolChange({ approved: false, runId: event.runId, toolId: event.tool.id, scope: "once" });
        }
        if (event.type === "run.finished") resolve();
      });
    });
    const firstTools = database.listTimeline(conversation.id).filter(item => item.kind === "tool");
    await new Promise<void>(resolve => {
      runtime.sendMessage({ content: "second same command", conversationId: conversation.id, permissionMode: "request_approval" }, event => {
        if (event.type === "tool.approval_requested") {
          secondApprovals += 1;
          runtime.approveToolChange({ approved: false, runId: event.runId, toolId: event.tool.id, scope: "once" });
        }
        if (event.type === "run.finished") resolve();
      });
    });
    expect.soft(failure).toMatchObject({ message: "fixture decision write failed" });
    expect.soft(firstTools[0]).toMatchObject({ status: "rejected" });
    expect.soft(secondApprovals).toBe(1);
    expect.soft(execute).not.toHaveBeenCalled();
  } finally {
    await runtime.stopAllRuns();
    await tools.dispose();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});

it.each([
  [false, false, false], [true, false, false],
  [false, true, false], [true, true, false],
  [false, true, true], [true, true, true],
] as const)("settles an approval before a second decision can grant permission (WAL=%s, first approved=%s, reentrant=%s)", async (writeAhead, firstApproved, reentrant) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "agent-approval-settled-"));
  const database = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(database);
  const conversation = database.createConversation(null);
  const tools = new ProjectToolRegistry(projects);
  const execute = vi.spyOn(tools, "executePreparedCommand").mockResolvedValue({
    content: JSON.stringify({ ok: true, value: { mock: true } }), isError: false, kind: "completed",
  });
  let calls = 0;
  const model: ModelProviderAdapter = { completeTurn: () => {
    calls += 1;
    return Promise.resolve(calls % 2 === 1
      ? { content: "", finishReason: "tool_calls", toolCalls: [{
          id: `settled_approval_${calls}`, name: "run_command",
          arguments: JSON.stringify({ command: "Write-Output settled-approval-fixture", yieldTimeMs: 0 }),
        }] }
      : { content: "done", finishReason: "stop", toolCalls: [] });
  } };
  const threadLog = writeAhead ? new ThreadLog(path.join(root, "conversations")) : null;
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({
    apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://fixture.invalid/v1",
    modelId: "fixture", reasoningOptions: [],
  }) }, projects, tools, model, undefined, undefined, null, null, null, null, null, undefined, null,
  threadLog, threadLog === null ? null : new EventProjector(database, threadLog));
  let firstApproval: Extract<ConversationRunEvent, { type: "tool.approval_requested" }> | undefined;
  let submittingFirstDecision = false;
  let duplicateAttempts = 0;
  let duplicateError: unknown;
  let secondApprovals = 0;
  const attemptDuplicate = (): void => {
    if (firstApproval === undefined || duplicateAttempts > 0) return;
    duplicateAttempts += 1;
    try { runtime.approveToolChange({ approved: true, runId: firstApproval.runId, toolId: firstApproval.tool.id, scope: "session" }); }
    catch (error) { duplicateError = error; }
  };
  try {
    await new Promise<void>(resolve => {
      runtime.sendMessage({ content: "first decision", conversationId: conversation.id, permissionMode: "request_approval" }, event => {
        if (event.type === "tool.approval_requested") {
          firstApproval = event;
          submittingFirstDecision = true;
          runtime.approveToolChange({ approved: firstApproved, runId: event.runId, toolId: event.tool.id, scope: "once" });
          submittingFirstDecision = false;
          if (!reentrant) attemptDuplicate();
        }
        if (event.type === "tool.started" && submittingFirstDecision && reentrant) attemptDuplicate();
        if (event.type === "run.finished") resolve();
      });
    });
    const firstTools = database.listTimeline(conversation.id).filter(item => item.kind === "tool");
    await new Promise<void>(resolve => {
      runtime.sendMessage({ content: "second same command", conversationId: conversation.id, permissionMode: "request_approval" }, event => {
        if (event.type === "tool.approval_requested") {
          secondApprovals += 1;
          runtime.approveToolChange({ approved: false, runId: event.runId, toolId: event.tool.id, scope: "once" });
        }
        if (event.type === "run.finished") resolve();
      });
    });
    expect.soft(duplicateAttempts).toBe(1);
    expect.soft(duplicateError).toMatchObject({ code: "APPROVAL_EXPIRED" });
    expect.soft(firstTools[0]).toMatchObject({ status: firstApproved ? "completed" : "rejected" });
    expect.soft(secondApprovals).toBe(1);
    expect.soft(execute).toHaveBeenCalledTimes(firstApproved ? 1 : 0);
    if (threadLog !== null) {
      const events = threadLog.read(conversation.id)?.events ?? [];
      expect.soft(events.filter(event => event.type === "tool_approval_decided")).toHaveLength(2);
      expect.soft(events.filter(event => event.type === "tool_approval_expired")).toHaveLength(0);
    }
  } finally {
    await runtime.stopAllRuns();
    await tools.dispose();
    database.close();
    await rm(root, { recursive: true, force: true });
  }
});
