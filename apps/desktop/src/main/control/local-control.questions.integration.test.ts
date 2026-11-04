import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_APPLICATION_SETTINGS, conversationSummarySchema, userQuestionSchema, type ConversationRunEvent } from "@agent/protocol";
import { AgentRuntime } from "../agent/agent-runtime.js";
import type { CompleteTurnInput, ModelTurnResult } from "../model/model-contracts.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { ConversationControl } from "./conversation-control.js";
import { LocalControlServer } from "./local-control-server.js";

it("answers a model question through HTTP, wakes the same conversation and deduplicates repeated answers", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-control-questions-"));
  const database = new AgentDatabase(":memory:");
  const log = new ThreadLog(path.join(directory, "conversations"));
  const projector = new EventProjector(database, log);
  const lifecycle = new ConversationLifecycleService(database, log, projector);
  const projects = new ProjectRegistry(database);
  const tools = new ProjectToolRegistry(projects);
  const requests: CompleteTurnInput[] = [];
  const model = { completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
    requests.push(input);
    if (requests.length === 1) return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{ id: "scope-question", name: "request_user_input",
      arguments: JSON.stringify({ questions: [{ id: "scope", title: "范围", question: "检查哪些页面？" }] }) }] });
    const content = requests.length === 2 ? "独立工作已完成" : "已处理设置页面";
    input.onTextDelta(content); return Promise.resolve({ content, finishReason: "stop", toolCalls: [] });
  } };
  const runtime = new AgentRuntime(database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://fixture.invalid/v1", modelId: "fixture-model", reasoningOptions: [] }) },
    projects, tools, model, undefined, undefined, null, null, null, null, null, undefined, null, log, projector, null, null, null, null, null, {}, lifecycle);
  const events: ConversationRunEvent[] = [];
  let finished = Promise.withResolvers<ConversationRunEvent>();
  const errors: unknown[] = [];
  const server = new LocalControlServer((command) => control.execute(command), (error) => { errors.push(error); });
  const emit = (event: ConversationRunEvent): void => { events.push(event); server.publish(event); if (event.type === "run.finished") finished.resolve(event); };
  const control = new ConversationControl(database, lifecycle, runtime, projector,
    { getConfiguration: () => DEFAULT_APPLICATION_SETTINGS }, { sendExecutionGuidance: (input, listener) => runtime.sendMessage(input, listener) }, emit,
    { resolveSelection: (selection) => selection, saveConfiguration: () => { throw new Error("No model configuration required"); }, getStatus: () => { throw new Error("No model status required"); } });
  try {
    const connectionPath = path.join(directory, "connection.json"); await server.start(connectionPath);
    const connection = z.object({ url: z.string(), token: z.string() }).parse(JSON.parse(await readFile(connectionPath, "utf8")));
    const command = async (command: string, input: unknown, expectedStatus = 200): Promise<unknown> => {
      const response = await fetch(`${connection.url}/v1/commands`, { method: "POST", headers: { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ command, input }) });
      expect(response.status).toBe(expectedStatus); return response.json();
    };
    const conversation = conversationSummarySchema.parse(await command("conversations.create", {}));
    await command("messages.send", { conversationId: conversation.id, content: "检查页面" });
    await expect(finished.promise).resolves.toMatchObject({ status: "completed" });
    const [question] = z.array(userQuestionSchema).parse(await command("user_questions.list", { conversationId: conversation.id }));
    expect(question?.status).toBe("pending");
    await command("user_questions.answer", { questionId: question!.id, answers: {} }, 500);
    finished = Promise.withResolvers<ConversationRunEvent>();
    const input = { questionId: question!.id, answers: { scope: "设置页面" } };
    expect(userQuestionSchema.parse(await command("user_questions.answer", input))).toMatchObject({ status: "answered", deliveryComplete: true });
    await expect(finished.promise).resolves.toMatchObject({ status: "completed", conversationId: conversation.id });
    expect(requests).toHaveLength(3);
    expect(requests[2]?.messages.some((message) => message.content.includes("用户回答：设置页面"))).toBe(true);
    await command("user_questions.answer", input);
    await command("user_questions.answer", { ...input, answers: { scope: "其他页面" } }, 500);
    expect(requests).toHaveLength(3);
    expect(events.filter((event) => event.type === "run.finished")).toHaveLength(2);
    expect(events.some((event) => event.type === "user_question.updated" && event.reason === "answered")).toBe(true);
    expect(errors).toHaveLength(2);
  } finally { await server.close(); await tools.dispose(); database.close(); await rm(directory, { recursive: true, force: true }); }
}, 15000);
