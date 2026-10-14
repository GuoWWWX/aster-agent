import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ConversationRunEvent } from "@agent/protocol";
import type { CompleteTurnInput, ModelTurnResult } from "../model/model-contracts.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ConversationAttachmentStore } from "../storage/conversation-attachment-store.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { AgentRuntime } from "./agent-runtime.js";

it("finishes independent work after asking, wakes on an answer and preserves answer receipts across restart checkpoints", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-questions-runtime-"));
  const database = new AgentDatabase(":memory:"); const restored = new AgentDatabase(":memory:");
  const projects = new ProjectRegistry(database); const tools = new ProjectToolRegistry(projects);
  try {
    const log = new ThreadLog(directory); const projector = new EventProjector(database, log);
    const attachments = new ConversationAttachmentStore(database, projects, directory);
    const creation = database.prepareConversationCreation(null); database.projectConversationCreated(creation);
    log.append(creation.conversation.id, { type: "conversation_created", payload: creation }); projector.projectConversation(creation.conversation.id);
    const requests: CompleteTurnInput[] = [];
    const model = { completeTurn: (input: CompleteTurnInput): Promise<ModelTurnResult> => {
      requests.push(input);
      if (requests.length === 1) return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{ name: "request_user_input", id: "ask_scope", arguments: JSON.stringify({ questions: [{ id: "scope", title: "范围", question: "要检查哪些页面？" }] }) }] });
      const content = requests.length === 2 ? "独立检查已完成，等待你的范围说明。" : "已根据回答完成。";
      input.onTextDelta(content); return Promise.resolve({ content, finishReason: "stop", toolCalls: [] });
    } };
    const runtime = new AgentRuntime(database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://example.test/v1", modelId: "fixture-model", reasoningOptions: [] }) },
      projects, tools, model, undefined, undefined, null, attachments, null, null, null, undefined, null, log, projector);
    const firstFinished = new Promise<ConversationRunEvent>((resolve) => runtime.sendMessage({ conversationId: creation.conversation.id, content: "检查页面" }, (event) => { if (event.type === "run.finished") resolve(event); }));
    await expect(firstFinished).resolves.toMatchObject({ status: "completed" });
    const question = runtime.listUserQuestions(creation.conversation.id)[0]!;
    expect(question).toMatchObject({ status: "pending", toolCallId: "ask_scope" });
    expect(requests).toHaveLength(2);
    const image = await attachments.importBytes(creation.conversation.id, { name: "answer.png", mimeType: "image/png",
      bytes: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nksAAAAASUVORK5CYII=", "base64") });
    expect(() => runtime.answerUserQuestion({ questionId: question.id, answers: { scope: "设置页面" }, attachmentIds: [crypto.randomUUID()] }, () => undefined)).toThrow("回答附件必须属于");
    expect(runtime.listUserQuestions(creation.conversation.id)[0]?.status).toBe("pending");
    const answeredFinished = new Promise<ConversationRunEvent>((resolve) => {
      const answered = runtime.answerUserQuestion({ questionId: question.id, answers: { scope: "设置页面" }, attachmentIds: [image.id] }, (event) => { if (event.type === "run.finished") resolve(event); });
      expect(answered.deliveryComplete).toBe(true);
    });
    await expect(answeredFinished).resolves.toMatchObject({ status: "completed" });
    expect(requests).toHaveLength(3); expect(requests[2]?.messages.some((message) => message.content.includes("用户回答：设置页面"))).toBe(true);
    expect(requests[2]?.messages.some(message => message.attachments.some(attachment => attachment.name === "answer.png"))).toBe(true);
    expect(log.read(creation.conversation.id)?.events.some((event) => event.type === "run_queued" && event.payload.questionAnswerId === question.id)).toBe(true);
    projector.checkpointInactiveConversations();
    const recovery = new EventProjector(restored, log); recovery.projectAllConversationLogs({ releaseHistory: true });
    expect(restored.getUserQuestion(question.id)).toMatchObject({ status: "answered", deliveryComplete: true, answers: { scope: "设置页面" }, answerAttachmentIds: [image.id] });
    expect(restored.wasUserQuestionAnswerDelivered(question.id, creation.conversation.id)).toBe(true);
    recovery.ensureConversationHistoryProjected(creation.conversation.id);
    expect(restored.wasUserQuestionAnswerDelivered(question.id, creation.conversation.id)).toBe(true);
    expect(restored.getUserQuestion(question.id).deliveryComplete).toBe(true);
  } finally { tools.dispose(); database.close(); restored.close(); await rm(directory, { recursive: true, force: true }); }
}, 15_000);

describe("Question runtime tool contract", () => {
  it("waits explicitly without model polling, then consumes the asynchronous answer as Steer", async () => {
    const database = new AgentDatabase(":memory:"); const projects = new ProjectRegistry(database); const tools = new ProjectToolRegistry(projects);
    const conversation = database.createConversation(null); const requests: CompleteTurnInput[] = [];
    let questionId = "";
    const model = { completeTurn: (input: CompleteTurnInput): Promise<ModelTurnResult> => {
      requests.push(input);
      if (requests.length === 1) return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{ id: "ask", name: "request_user_input", arguments: JSON.stringify({ questions: [{ id: "scope", title: "范围", question: "哪些页面？" }] }) }] });
      if (requests.length === 2) return Promise.resolve({ content: "", finishReason: "tool_calls", toolCalls: [{ id: "wait", name: "wait_for_user_input", arguments: JSON.stringify({ questionIds: [questionId], timeoutMs: 5000 }) }] });
      input.onTextDelta("已处理回答"); return Promise.resolve({ content: "已处理回答", finishReason: "stop", toolCalls: [] });
    } };
    const runtime = new AgentRuntime(database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions", baseUrl: "https://example.test/v1", modelId: "fixture-model", reasoningOptions: [] }) }, projects, tools, model);
    try {
      const finished = new Promise<ConversationRunEvent>((resolve) => {
        const emit = (event: ConversationRunEvent): void => {
          if (event.type === "user_question.updated") questionId = event.question.id;
          if (event.type === "tool.started" && event.tool.name === "wait_for_user_input") setTimeout(() => {
            runtime.answerUserQuestion({ questionId, answers: { scope: "设置页面" } }, emit);
          }, 10);
          if (event.type === "run.finished") resolve(event);
        };
        runtime.sendMessage({ conversationId: conversation.id, content: "等待我的范围选择再检查" }, emit);
      });
      await expect(finished).resolves.toMatchObject({ status: "completed" }); expect(requests).toHaveLength(3);
      expect(requests[2]?.messages.some((message) => message.content.includes("用户回答：设置页面"))).toBe(true);
      expect(database.listPendingMessages(conversation.id)).toEqual([]);
    } finally { tools.dispose(); database.close(); }
  }, 10_000);
  it("preserves pending question state in an inactive startup checkpoint", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-question-checkpoint-"));
    const database = new AgentDatabase(":memory:"); const restored = new AgentDatabase(":memory:");
    const projects = new ProjectRegistry(database); const tools = new ProjectToolRegistry(projects);
    try {
      const log = new ThreadLog(directory); const projector = new EventProjector(database, log);
      const creation = database.prepareConversationCreation(null); database.projectConversationCreated(creation);
      log.append(creation.conversation.id, { type: "conversation_created", payload: creation }); projector.projectConversation(creation.conversation.id);
      const runtime = new AgentRuntime(database, { getConfiguration: () => { throw new Error("no model needed"); } }, projects, tools, undefined,
        undefined, undefined, null, null, null, null, null, undefined, null, log, projector);
      const question = runtime.userQuestions.request({ conversationId: creation.conversation.id, runId: crypto.randomUUID(), toolCallId: "ask",
        questions: [{ id: "scope", title: "范围", question: "哪些页面？", options: [] }] }, () => undefined);
      projector.checkpointInactiveConversations(); new EventProjector(restored, log).projectAllConversationLogs({ releaseHistory: true });
      expect(restored.getUserQuestion(question.id)).toEqual(question);
    } finally { tools.dispose(); database.close(); restored.close(); await rm(directory, { recursive: true, force: true }); }
  });
});
