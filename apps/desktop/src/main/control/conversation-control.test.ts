import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DEFAULT_APPLICATION_SETTINGS, localControlCommandSchema, type ConversationModelSelection } from "@agent/protocol";
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
  const models = { resolveSelection: vi.fn((selection: ConversationModelSelection) => selection), saveConfiguration: vi.fn(), getStatus: vi.fn() };
  const interactions = { listUserQuestions: vi.fn(() => []), answerUserQuestion: vi.fn(), approveToolChange: vi.fn(), listBackgroundCommands: vi.fn(() => []), readBackgroundCommand: vi.fn(), stopBackgroundCommand: vi.fn() };
  beforeEach(async () => {
    vi.clearAllMocks();
    directory = await mkdtemp(path.join(os.tmpdir(), "aster-conversation-control-"));
    database = new AgentDatabase(":memory:");
    log = new ThreadLog(directory);
    projector = new EventProjector(database, log);
    lifecycle = new ConversationLifecycleService(database, log, projector);
    control = new ConversationControl(database, lifecycle, { sendMessage, cancelConversation, ...interactions }, projector, settings, teams, emit,
      models);
  });
  afterEach(async () => { database.close(); await rm(directory, { force: true, recursive: true }); });
  const execute = (command: unknown) => control.execute(localControlCommandSchema.parse(command));
  it("routes command output reads through the scoped runtime", async () => {
    const conversationId = randomUUID(); const commandId = randomUUID();
    const output = { command: { commandId, conversationId, command: "echo ok", mode: "batch", serviceName: null, workingDirectory: ".",
      startedAt: "2026-10-14T01:00:00Z", completedAt: "2026-10-14T01:00:01Z", status: "completed", exitCode: 0 },
      stdout: "ok", stderr: "", error: null, timedOut: false, truncated: false };
    interactions.readBackgroundCommand.mockReturnValue(output);
    await expect(execute({ command: "background_commands.read", input: { conversationId, commandId } })).resolves.toEqual(output);
    expect(interactions.readBackgroundCommand).toHaveBeenCalledExactlyOnceWith({ conversationId, commandId });
  });

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
  it("validates permission changes, persists them and publishes the saved state", async () => {
    const conversation = lifecycle.createConversation(null);
    const summary = await execute({ command: "conversations.set_permission", input: { conversationId: conversation.id, permissionMode: "read_only" } });
    expect(database.getConversation(conversation.id).permissionMode).toBe("read_only");
    expect(emit).toHaveBeenCalledExactlyOnceWith({ type: "conversation.updated", conversation: summary });
    expect(localControlCommandSchema.safeParse({ command: "conversations.set_permission", input: { conversationId: conversation.id, permissionMode: "invalid" } }).success).toBe(false);
  });
  it("renames and archives the saved conversation while keeping its identity", async () => {
    const conversation = lifecycle.createConversation(null);
    await execute({ command: "conversations.rename", input: { conversationId: conversation.id, title: "后台全流程验收" } });
    await execute({ command: "conversations.archive", input: { conversationId: conversation.id, archived: true } });
    expect(database.getConversation(conversation.id)).toMatchObject({ id: conversation.id, title: "后台全流程验收", isArchived: true });
    expect(emit).toHaveBeenCalledTimes(2);
    await execute({ command: "conversations.archive", input: { conversationId: conversation.id, archived: false } });
    expect(database.getConversation(conversation.id).isArchived).toBe(false);
  });
  it("uses the Runtime approval boundary and propagates expired approval failures", async () => {
    const input = { toolId: randomUUID(), runId: randomUUID(), approved: false, scope: "once" };
    expect(await execute({ command: "approvals.resolve", input })).toEqual({ resolved: true });
    expect(interactions.approveToolChange).toHaveBeenCalledExactlyOnceWith(input);
    interactions.approveToolChange.mockImplementationOnce(() => { throw new Error("Expired approval"); });
    await expect(execute({ command: "approvals.resolve", input })).rejects.toThrow("Expired approval");
  });
  it("keeps question and background program queries scoped and preserves stop failures", async () => {
    const conversationId = randomUUID();
    expect(await execute({ command: "user_questions.list", input: { conversationId } })).toEqual([]);
    expect(interactions.listUserQuestions).toHaveBeenCalledExactlyOnceWith(conversationId);
    expect(await execute({ command: "background_commands.list", input: { conversationId } })).toEqual([]);
    expect(interactions.listBackgroundCommands).toHaveBeenCalledExactlyOnceWith(conversationId);
    const commandId = randomUUID();
    interactions.stopBackgroundCommand.mockRejectedValueOnce(new Error("Different conversation"));
    await expect(execute({ command: "background_commands.stop", input: { conversationId, commandId } })).rejects.toThrow("Different conversation");
    expect(interactions.stopBackgroundCommand).toHaveBeenCalledExactlyOnceWith(conversationId, commandId);
  });
  it("saves a validated model selection before broadcasting creation", async () => {
    const selection = { providerId: randomUUID(), modelId: "configured-model", reasoning: null };
    await execute({ command: "conversations.create", input: { modelSelection: selection } });
    expect(models.resolveSelection).toHaveBeenCalledExactlyOnceWith(selection);
    expect(emit).toHaveBeenCalledExactlyOnceWith({ type: "conversation.updated", conversation: database.listConversations()[0] });
    expect(database.listConversations()[0]?.modelSelection).toEqual(selection);
    models.resolveSelection.mockImplementationOnce(() => { throw new Error("Unknown model"); });
    await expect(execute({ command: "conversations.create", input: { modelSelection: selection } })).rejects.toThrow("Unknown model");
    expect(database.listConversations()).toHaveLength(1);
  });
  it("requests the desktop to open a saved conversation without changing its history", async () => {
    const conversation = lifecycle.createConversation(null);
    expect(await execute({ command: "conversations.open", input: { conversationId: conversation.id } })).toEqual({ requested: true });
    expect(emit).toHaveBeenCalledExactlyOnceWith({ type: "conversation.open_requested", conversation });
    lifecycle.setConversationArchived(conversation.id, true);
    await expect(execute({ command: "conversations.open", input: { conversationId: conversation.id } })).rejects.toThrow("Only active");
    expect(emit).toHaveBeenCalledTimes(1);
  });
  it("routes model configuration through the credential store and validates the safe response", async () => {
    const input = { apiKey: "fixture-key", apiFormat: "openai-chat-completions", baseUrl: "https://example.test/v1", providerName: "Fixture", models: [{ modelId: "fixture-model", displayName: "Fixture", contextWindow: 0, reasoningOptions: [] }] };
    models.saveConfiguration.mockReturnValue({ configured: true, baseUrl: input.baseUrl, modelId: "fixture-model", providerId: randomUUID(), models: [], supportsStreaming: true, supportsTools: true });
    const result = await execute({ command: "models.configure", input });
    expect(models.saveConfiguration).toHaveBeenCalledExactlyOnceWith(localControlCommandSchema.parse({ command: "models.configure", input }).input);
    expect(JSON.stringify(result)).not.toContain("fixture-key");
    expect(localControlCommandSchema.safeParse({ command: "models.configure", input: { ...input, extra: true } }).success).toBe(false);
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
