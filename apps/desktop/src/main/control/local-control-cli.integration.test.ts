import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import { z } from "zod";
import { DEFAULT_APPLICATION_SETTINGS, modelApiFormatSchema, type ConversationRunEvent } from "@agent/protocol";
import { AgentRuntime } from "../agent/agent-runtime.js";
import { ModelAdapterRegistry } from "../model/model-adapter-registry.js";
import type { ModelConfiguration, ModelProviderAdapter } from "../model/model-contracts.js";
import { ProjectRegistry } from "../projects/project-registry.js";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ProjectToolRegistry } from "../tools/project-tool-registry.js";
import { ConversationControl } from "./conversation-control.js";
import { LocalControlServer } from "./local-control-server.js";

const exec = promisify(execFile);

it("verifies both CLI turns through HTTP, Runtime, model streaming and shared Renderer events", async () => {
  const modelFile = process.env.ASTER_CONTROL_TEST_MODEL_FILE;
  let configuration: ModelConfiguration = { apiKey: "fixture", apiFormat: "openai-chat-completions",
    baseUrl: "https://fixture.invalid/v1", modelId: "fixture-model", reasoningOptions: [] };
  if (modelFile !== undefined) {
    configuration = { ...z.object({ apiKey: z.string().min(1), baseUrl: z.url(), modelId: z.string().min(1),
      apiFormat: modelApiFormatSchema.default("openai-chat-completions") }).strict().parse(JSON.parse(await readFile(modelFile, "utf8"))), reasoningOptions: [] };
  }
  const model: ModelProviderAdapter = modelFile === undefined ? { completeTurn(input) {
    input.onTextDelta("后台验收");
    return Promise.resolve({ content: "后台验收", finishReason: "stop", toolCalls: [] });
  } } : new ModelAdapterRegistry();
  const directory = await mkdtemp(path.join(os.tmpdir(), "aster-control-cli-"));
  const database = new AgentDatabase(":memory:");
  const log = new ThreadLog(path.join(directory, "conversations"));
  const projector = new EventProjector(database, log);
  const lifecycle = new ConversationLifecycleService(database, log, projector);
  const projects = new ProjectRegistry(database);
  const tools = new ProjectToolRegistry(projects);
  const runtime = new AgentRuntime(database, { getConfiguration: () => configuration }, projects, tools, model,
    undefined, undefined, null, null, null, null, null, undefined, null, log, projector, null, null, null, null, null, {}, lifecycle);
  const rendererEvents: ConversationRunEvent[] = [];
  const serverErrors: unknown[] = [];
  const server = new LocalControlServer((command) => control.execute(command), (error) => { serverErrors.push(error); });
  const emit = (event: ConversationRunEvent): void => { rendererEvents.push(event); server.publish(event); };
  const control = new ConversationControl(database, lifecycle, runtime, projector,
    { getConfiguration: () => DEFAULT_APPLICATION_SETTINGS }, { sendExecutionGuidance: (input, onEvent) => runtime.sendMessage(input, onEvent) }, emit,
    { resolveSelection: (selection) => selection, saveConfiguration: () => { throw new Error("Not configured in fixture."); }, getStatus: () => { throw new Error("Not configured in fixture."); } });
  try {
    const connectionPath = path.join(directory, "connection.json");
    await server.start(connectionPath);
    const cliPath = fileURLToPath(new URL("../../../../../scripts/aster-control.mjs", import.meta.url));
    const { stdout } = await exec(process.execPath, [cliPath, "--connection", connectionPath, "verify"], { timeout: 130_000 });
    const result = z.object({ ok: z.literal(true), conversationId: z.uuid(), runIds: z.array(z.uuid()).length(2),
      rounds: z.literal(2), userMessages: z.literal(2), assistantMessages: z.literal(2) })
      .parse(JSON.parse(stdout.trim().split("\n").at(-1) ?? "null"));
    expect(serverErrors).toEqual([]);
    expect(rendererEvents[0]).toMatchObject({ type: "conversation.updated", conversation: { id: result.conversationId } });
    for (const runId of result.runIds) {
      expect(rendererEvents).toContainEqual(expect.objectContaining({ type: "run.started", runId }));
      expect(rendererEvents).toContainEqual(expect.objectContaining({ type: "assistant.delta", runId }));
      expect(rendererEvents).toContainEqual(expect.objectContaining({ type: "run.finished", runId, status: "completed" }));
    }
    await projector.prepareTimeline(result.conversationId);
    expect(projector.listTimelinePage({ conversationId: result.conversationId, limit: 120 }).items.filter((item) => item.kind === "message"))
      .toHaveLength(4);
  } finally {
    await server.close(); tools.dispose(); database.close();
    await rm(directory, { recursive: true, force: true });
  }
}, 150_000);
