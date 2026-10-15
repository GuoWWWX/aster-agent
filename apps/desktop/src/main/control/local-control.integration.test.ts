import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_APPLICATION_SETTINGS, conversationMessageSubmissionSchema, conversationSummarySchema,
  conversationTimelinePageSchema, type ConversationRunEvent } from "@agent/protocol";
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

describe("local control through the real Runtime", () => {
  it("creates, sends two turns, streams to observers and recovers canonical history", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "aster-control-integration-"));
    const database = new AgentDatabase(":memory:");
    const log = new ThreadLog(path.join(directory, "conversations"));
    const projector = new EventProjector(database, log);
    const lifecycle = new ConversationLifecycleService(database, log, projector);
    const projects = new ProjectRegistry(database);
    const tools = new ProjectToolRegistry(projects);
    const requests: CompleteTurnInput[] = [];
    const model = { completeTurn(input: CompleteTurnInput): Promise<ModelTurnResult> {
      requests.push(input);
      input.onTextDelta("来自"); input.onTextDelta("后台的回答");
      return Promise.resolve({ content: "来自后台的回答", finishReason: "stop", toolCalls: [] });
    } };
    const runtime = new AgentRuntime(database, { getConfiguration: () => ({ apiKey: "fixture", apiFormat: "openai-chat-completions",
      baseUrl: "https://fixture.invalid/v1", modelId: "fixture-model", reasoningOptions: [] }) }, projects, tools, model,
    undefined, undefined, null, null, null, null, null, undefined, null, log, projector, null, null, null, null, null, {}, lifecycle);
    const rendererEvents: ConversationRunEvent[] = [];
    const server = new LocalControlServer((command) => control.execute(command), (error) => { throw error; });
    const emit = (event: ConversationRunEvent) => { rendererEvents.push(event); server.publish(event); };
    const control = new ConversationControl(database, lifecycle, runtime, projector,
      { getConfiguration: () => DEFAULT_APPLICATION_SETTINGS }, { sendExecutionGuidance: (input, onEvent) => runtime.sendMessage(input, onEvent) }, emit,
      { resolveSelection: (selection) => selection, saveConfiguration: () => { throw new Error("Not configured in fixture."); }, getStatus: () => { throw new Error("Not configured in fixture."); } });
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      const connectionPath = path.join(directory, "connection.json");
      await server.start(connectionPath);
      const connection = z.object({ url: z.string(), token: z.string() }).parse(JSON.parse(await readFile(connectionPath, "utf8")));
      const headers = { Authorization: `Bearer ${connection.token}`, "Content-Type": "application/json" };
      const stream = await fetch(`${connection.url}/v1/events`, { headers, signal: controller.signal });
      reader = stream.body!.getReader();
      await reader.read();
      const command = async (command: string, input: unknown) => {
        const response = await fetch(`${connection.url}/v1/commands`, { method: "POST", headers, body: JSON.stringify({ command, input }) });
        expect(response.status).toBe(200);
        const result: unknown = await response.json();
        return result;
      };
      const conversation = conversationSummarySchema.parse(await command("conversations.create", {}));
      const decoder = new TextDecoder();
      let frames = "";
      for (const content of ["第一轮", "第二轮"]) {
        const accepted = conversationMessageSubmissionSchema.parse(await command("messages.send", { conversationId: conversation.id, content }));
        expect(accepted.kind).toBe("started");
        while (!frames.includes('"type":"run.finished"')) frames += decoder.decode((await reader.read()).value, { stream: true });
        expect(frames).toContain('"type":"assistant.delta"');
        expect(frames).toContain('"status":"completed"');
        frames = "";
      }
      const timeline = conversationTimelinePageSchema.parse(await command("conversations.read", { conversationId: conversation.id }));
      expect(timeline.items.filter((item) => item.kind === "message").map((item) => item.content))
        .toEqual(["第一轮", "来自后台的回答", "第二轮", "来自后台的回答"]);
      expect(rendererEvents[0]).toMatchObject({ type: "conversation.updated", conversation: { id: conversation.id } });
      expect(rendererEvents.filter((event) => event.type === "run.finished")).toHaveLength(2);
      expect(requests[1]?.messages.some((message) => message.content === "第一轮")).toBe(true);
      const restored = new AgentDatabase(":memory:");
      try {
        const replay = new EventProjector(restored, new ThreadLog(path.join(directory, "conversations")));
        replay.projectConversation(conversation.id);
        await replay.prepareTimeline(conversation.id);
        expect(replay.listTimelinePage({ conversationId: conversation.id, limit: 120 }).items).toEqual(timeline.items);
      } finally { restored.close(); }
    } finally {
      await reader?.cancel(); controller.abort(); await server.close(); await tools.dispose(); database.close();
      await rm(directory, { recursive: true, force: true });
    }
  }, 15_000);
});
