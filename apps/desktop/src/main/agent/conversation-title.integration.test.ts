import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { ConversationRunEvent } from "@agent/protocol";
import type { CompleteTurnInput, ModelProviderAdapter, ModelTurnResult } from "../model/model-contracts.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { AgentRuntime } from "./agent-runtime.js";
import { ConversationTitleGenerator } from "./conversation-title-generator.js";

const answer = (content: string): ModelTurnResult => ({ content, finishReason: "stop", toolCalls: [] });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
async function fixture(main: ModelProviderAdapter, naming: ModelProviderAdapter) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "conversation-title-"));
  const database = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(database);
  const project = await projects.registerDirectory(directory);
  const tools = new ProjectToolRegistry(projects);
  const log = new ThreadLog(path.join(directory, "conversations"));
  const projector = new EventProjector(database, log);
  const lifecycle = new ConversationLifecycleService(database, log, projector);
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions",
    baseUrl: "https://fixture.invalid", modelId: "selected-model", reasoningOptions: [{ kind: "effort", value: "minimal" }] }) }, projects, tools, main,
    undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined,
    log, projector, undefined, undefined, undefined, undefined, undefined, {}, lifecycle, null, new ConversationTitleGenerator(naming));
  const conversation = lifecycle.createConversation(project.id);
  return { database, runtime, lifecycle, conversation, log, cleanup: async () => {
    await runtime.stopAllRuns(); await tools.dispose(); database.close(); await rm(directory, { recursive: true, force: true });
  } };
}

describe("background conversation naming", () => {
  it("runs alongside the first task, persists its title through JSONL and never adds naming text or usage to that task", async () => {
    const mainDone = deferred<ModelTurnResult>(), titleDone = deferred<ModelTurnResult>();
    const main = { completeTurn: vi.fn<ModelProviderAdapter["completeTurn"]>().mockReturnValue(mainDone.promise) };
    const naming = { completeTurn: vi.fn<ModelProviderAdapter["completeTurn"]>().mockReturnValue(titleDone.promise) };
    const f = await fixture(main, naming); const events: ConversationRunEvent[] = [];
    try {
      const content = "请设计一个支持多人并行协作和群消息查询的页面";
      f.runtime.sendMessage({ conversationId: f.conversation.id, content, permissionMode: "read_only" }, event => events.push(event));
      expect(f.database.getConversation(f.conversation.id).title).toBe(Array.from(content).slice(0, 20).join(""));
      await vi.waitFor(() => { expect(main.completeTurn).toHaveBeenCalledTimes(1); expect(naming.completeTurn).toHaveBeenCalledTimes(1); });
      expect(naming.completeTurn.mock.calls[0]![0].configuration.modelId).toBe(main.completeTurn.mock.calls[0]![0].configuration.modelId);
      titleDone.resolve(answer("团队协作与群消息查询"));
      await vi.waitFor(() => expect(f.database.getConversation(f.conversation.id).title).toBe("团队协作与群消息查询"));
      expect(f.database.getConversation(f.conversation.id).activeRunId).not.toBeNull();
      mainDone.resolve(answer("实际任务结果"));
      await vi.waitFor(() => expect(f.database.getConversation(f.conversation.id).lastRunStatus).toBe("completed"));
      expect(events.filter(event => event.type === "model.request_started")).toHaveLength(1);
      expect(f.database.listTimeline(f.conversation.id).filter(item => item.kind === "message").map(item => item.content)).toEqual([content, "实际任务结果"]);
      const history = f.log.read(f.conversation.id)!;
      expect(JSON.stringify(history.events.filter(event => event.type === "conversation_properties_changed").at(-1))).toContain("团队协作与群消息查询");
      f.database.renameConversation(f.conversation.id, "损坏的投影");
      f.database.restoreThreadLogConversationProperties(f.conversation.id, history.events);
      expect(f.database.getConversation(f.conversation.id).title).toBe("团队协作与群消息查询");
      f.runtime.sendMessage({ conversationId: f.conversation.id, content: "补充说明", permissionMode: "read_only" }, () => undefined);
      await vi.waitFor(() => expect(f.database.getConversation(f.conversation.id).activeRunId).toBeNull());
      expect(naming.completeTurn).toHaveBeenCalledTimes(1);
    } finally { mainDone.resolve(answer("结束")); titleDone.resolve(answer("结束")); await f.cleanup(); }
  });
  it.each(["manual", "archive", "cancel"])("discards a late title after %s", async change => {
    const done = deferred<ModelTurnResult>(); const naming = { completeTurn: vi.fn<ModelProviderAdapter["completeTurn"]>().mockReturnValue(done.promise) };
    const f = await fixture({ completeTurn: () => Promise.resolve(answer("你好")) }, naming);
    try {
      f.runtime.sendMessage({ conversationId: f.conversation.id, content: "首条用户消息" }, () => undefined);
      await vi.waitFor(() => expect(naming.completeTurn).toHaveBeenCalledTimes(1));
      if (change === "manual") f.lifecycle.renameConversation(f.conversation.id, "用户自己的名字");
      else if (change === "archive") f.lifecycle.setConversationArchived(f.conversation.id, true);
      else f.runtime.cancelConversation(f.conversation.id);
      done.resolve(answer("后台生成的名字")); await new Promise(resolve => setImmediate(resolve));
      expect(f.database.getConversation(f.conversation.id).title).toBe(change === "manual" ? "用户自己的名字" : "首条用户消息");
    } finally { done.resolve(answer("结束")); await f.cleanup(); }
  });
  it("retains the fallback when both naming attempts fail without failing the main task", async () => {
    const naming = { completeTurn: vi.fn<ModelProviderAdapter["completeTurn"]>().mockRejectedValue(new Error("fetch failed")) };
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const f = await fixture({ completeTurn: () => Promise.resolve(answer("实际任务结果")) }, naming);
    try {
      f.runtime.sendMessage({ conversationId: f.conversation.id, content: "首条用户消息" }, () => undefined);
      await vi.waitFor(() => { expect(naming.completeTurn).toHaveBeenCalledTimes(2); expect(f.database.getConversation(f.conversation.id).lastRunStatus).toBe("completed"); });
      expect(f.database.getConversation(f.conversation.id).title).toBe("首条用户消息");
      expect(error).toHaveBeenCalled();
    } finally { await f.cleanup(); error.mockRestore(); }
  });
  it("cancels and drains naming on shutdown", async () => {
    const naming = { completeTurn: vi.fn<ModelProviderAdapter["completeTurn"]>().mockImplementation((input: CompleteTurnInput) => new Promise((_resolve, reject) => {
      input.signal.addEventListener("abort", () => reject(new DOMException("stopped", "AbortError")), { once: true });
    })) };
    const f = await fixture({ completeTurn: () => Promise.resolve(answer("你好")) }, naming);
    try {
      f.runtime.sendMessage({ conversationId: f.conversation.id, content: "首条用户消息" }, () => undefined);
      await vi.waitFor(() => expect(naming.completeTurn).toHaveBeenCalledTimes(1));
      await f.runtime.stopAllRuns();
      expect(naming.completeTurn.mock.calls[0]![0].signal.aborted).toBe(true); expect(naming.completeTurn).toHaveBeenCalledTimes(1);
    } finally { await f.cleanup(); }
  });
  it.each(["manual", "override", "subagent"])("does not rename a fixed %s conversation", async kind => {
    const naming = { completeTurn: vi.fn<ModelProviderAdapter["completeTurn"]>().mockResolvedValue(answer("后台标题")) };
    const f = await fixture({ completeTurn: () => Promise.resolve(answer("你好")) }, naming);
    try {
      let conversation = f.conversation;
      if (kind === "manual") conversation = f.lifecycle.renameConversation(conversation.id, "固定名称");
      else if (kind === "subagent") conversation = f.database.forkConversation(conversation.id, "subagent");
      f.runtime.sendMessage({ conversationId: conversation.id, content: "首条用户消息" }, () => undefined,
        kind === "override" ? { titleOverride: "固定名称" } : undefined);
      await vi.waitFor(() => expect(f.database.getConversation(conversation.id).lastRunStatus).toBe("completed"));
      expect(naming.completeTurn).not.toHaveBeenCalled();
      if (kind !== "subagent") expect(f.database.getConversation(conversation.id).title).toBe("固定名称");
    } finally { await f.cleanup(); }
  });
});
