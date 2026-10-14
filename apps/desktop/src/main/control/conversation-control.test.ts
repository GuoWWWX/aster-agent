import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_APPLICATION_SETTINGS, localControlCommandSchema } from "@agent/protocol";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentDatabase } from "../storage/agent-database.js";
import { ConversationLifecycleService } from "../storage/conversation-lifecycle-service.js";
import { EventProjector } from "../storage/event-projector.js";
import { ThreadLog } from "../storage/thread-log.js";
import { ConversationControl } from "./conversation-control.js";

describe("ConversationControl", () => {
  let directory: string;
  let database: AgentDatabase;
  let lifecycle: ConversationLifecycleService;
  let log: ThreadLog;
  let projector: EventProjector;
  let control: ConversationControl;
  const emit = vi.fn();
  const sendMessage = vi.fn(() => ({ kind: "pending" as const, pendingMessage: {
    id: randomUUID(), conversationId: randomUUID(), content: "hello", createdAt: new Date().toISOString(),
    deliveryMode: "queue" as const, attachmentIds: [], referencedConversationIds: [], referencedProjectPaths: [],
  } }));
  const cancelConversation = vi.fn();
  const settings = { getConfiguration: () => DEFAULT_APPLICATION_SETTINGS };
  const teams = { sendExecutionGuidance: vi.fn(sendMessage) };
  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(path.join(os.tmpdir(), "aster-conversation-control-"));
    database = new AgentDatabase(":memory:");
    log = new ThreadLog(directory);
    projector = new EventProjector(database, log);
    lifecycle = new ConversationLifecycleService(database, log, projector);
    control = new ConversationControl(database, lifecycle, { sendMessage, cancelConversation }, projector, settings, teams, emit);
  });
  afterEach(async () => { database.close(); await rm(directory, { force: true, recursive: true }); });
  const execute = (command: unknown) => control.execute(localControlCommandSchema.parse(command));

  it("persists creation before broadcasting and recovers it from JSONL", async () => {
    await execute({ command: "conversations.create", input: {} });
    const conversation = database.listConversations()[0]!;
    expect(conversation.agentId).toBe("default-agent");
    expect(conversation.permissionMode).toBe(DEFAULT_APPLICATION_SETTINGS.general.defaultPermissionMode);
    expect(emit).toHaveBeenCalledExactlyOnceWith({ type: "conversation.updated", conversation });
    const restored = new AgentDatabase(":memory:");
    try {
      new EventProjector(restored, new ThreadLog(directory)).projectConversation(conversation.id);
      expect(restored.getConversation(conversation.id)).toEqual(conversation);
    } finally { restored.close(); }
  });
  it("does not broadcast or create when the Agent or project is invalid", async () => {
    await expect(execute({ command: "conversations.create", input: { agentId: "missing" } })).rejects.toThrow();
    await expect(execute({ command: "conversations.create", input: { projectId: randomUUID() } })).rejects.toThrow();
    expect(database.listConversations()).toEqual([]);
    expect(emit).not.toHaveBeenCalled();
  });
  it("preserves saved model and permission mode and passes Steer through the Runtime", async () => {
    const conversation = lifecycle.createConversation(null);
    lifecycle.setConversationPermissionMode(conversation.id, "read_only");
    const selection = { providerId: randomUUID(), modelId: "saved-model", reasoning: null };
    lifecycle.setConversationModelSelection(conversation.id, selection);
    await execute({ command: "messages.send", input: { conversationId: conversation.id, content: "hello", deliveryMode: "steer" } });
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({ conversationId: conversation.id, content: "hello",
      deliveryMode: "steer", permissionMode: "read_only", providerId: selection.providerId, modelId: "saved-model" }, emit);
  });
  it("reads paged canonical history after a restart and cancels through the Runtime", async () => {
    const conversation = lifecycle.createConversation(null);
    const runId = randomUUID();
    log.append(conversation.id, { type: "run_queued", payload: { runId, messageId: randomUUID(), modelId: "fake", content: "hello" } });
    log.append(conversation.id, { type: "run_terminal", payload: { runId, messageId: randomUUID(), modelId: "fake", content: "world",
      result: "world", status: "completed", error: null, assistantKind: "turn" } });
    projector.projectConversation(conversation.id);
    projector.releaseInactiveConversationHistories();
    expect(await execute({ command: "conversations.read", input: { conversationId: conversation.id } }))
      .toMatchObject({ items: [{ content: "hello" }, { content: "world" }], hasMore: false });
    await execute({ command: "runs.cancel", input: { conversationId: conversation.id } });
    expect(cancelConversation).toHaveBeenCalledExactlyOnceWith(conversation.id);
  });
});
