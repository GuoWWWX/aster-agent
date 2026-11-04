import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { teamChatMessageSchema } from "@agent/protocol";
import { backupLegacyTeamChatDatabase, TeamChatJournal } from "./team-chat-journal.js";
import { AgentDatabase } from "./agent-database.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "aster-group-jsonl-")); roots.push(root);
  const room = randomUUID(); const journal = new TeamChatJournal(root);
  const message = teamChatMessageSchema.parse({ id: randomUUID(), teamInstanceId: room, sequence: 1, content: "用户原文与表情🙂",
    senderConversationId: null, senderName: "你", intent: "request", recipientConversationIds: [], taskContextId: null,
    replyToId: null, createdAt: new Date().toISOString(), rootMessageId: randomUUID(), depth: 0, sourceRunId: null, deliveries: [],
    coordinator: { agentId: "default-agent", modelSelection: null, status: "pending", error: null } });
  return { root, room, journal, message };
}
it("restores the owner conversation mapping before the first public message without making it a group member", () => {
  const { root, room, journal, message } = fixture();
  const conversationId = randomUUID();
  journal.bindCoordinator(room, "default-agent", conversationId);
  journal.bindCoordinator(room, "default-agent", conversationId);
  expect(journal.ids(room)).toEqual([]); expect(journal.lastSequence(room)).toBe(0);
  journal.appendMessage(message, null);
  const reopened = new TeamChatJournal(root);
  expect(reopened.coordinators(room)).toEqual([["default-agent", conversationId]]);
  expect(reopened.ids(room)).toEqual([message.id]);
  expect(readFileSync(journal.file(room), "utf8").split('"coordinator_conversation"')).toHaveLength(2);
  reopened.bindCoordinator(room, "another-agent", conversationId);
  expect(new TeamChatJournal(root).coordinators(room)).toEqual([["another-agent", conversationId]]);
});
it("preserves text and coordinator decisions across restart without repeating the message body", () => {
  const { root, room, journal, message } = fixture();
  journal.appendMessage(message, { id: "request-1", fingerprint: "hash" });
  const completed = { ...message, coordinator: { ...message.coordinator!, status: "completed" as const }, recipientConversationIds: [randomUUID()] };
  journal.coordinate(completed);
  const reopened = new TeamChatJournal(root);
  expect(reopened.message(room, message.id)).toEqual(completed);
  expect(reopened.request(room, "request-1")?.messageId).toBe(message.id);
  expect(readFileSync(journal.file(room), "utf8").split(message.content)).toHaveLength(2);
  reopened.appendMessage(message, { id: "request-1", fingerprint: "hash" });
  expect(reopened.ids(room)).toEqual([message.id]);
});
it("retains bounded append-only coordination steps through terminal state patches and restart", () => {
  const { root, room, journal, message } = fixture();
  journal.appendMessage(message, null);
  for (let attempt = 1; attempt <= 70; attempt++) journal.coordinationStep(room, message.id, {
    type: "model_requested", at: new Date().toISOString(), attempt, modelId: "fixture" });
  const current = journal.message(room, message.id)!;
  journal.coordinate({ ...current, coordinator: { ...current.coordinator!, status: "completed" } }, {
    type: "completed", at: new Date().toISOString(), detail: "选择与当前问题相关的成员", recipientConversationIds: [] });
  const restored = new TeamChatJournal(root).message(room, message.id)!;
  expect(restored.coordinator?.status).toBe("completed");
  expect(restored.coordinator?.steps).toHaveLength(64);
  expect(restored.coordinator?.steps?.at(-1)?.detail).toBe("选择与当前问题相关的成员");
  const lines = readFileSync(journal.file(room), "utf8").trim().split("\n").map(line => JSON.parse(line) as { type: string; coordinator?: { steps?: unknown[] } });
  expect(lines.filter(line => line.type === "coordination_step")).toHaveLength(70);
  expect(lines.at(-1)?.coordinator?.steps).toBeUndefined();
});
it("restores a user-paused coordinator without turning the pause into a failure", () => {
  const { root, room, journal, message } = fixture();
  journal.appendMessage(message, null);
  journal.coordinate({ ...message, coordinator: { ...message.coordinator!, status: "paused", error: null } }, {
    type: "paused", at: new Date().toISOString(), detail: "用户暂停" });
  expect(new TeamChatJournal(root).message(room, message.id)?.coordinator).toMatchObject({ status: "paused", error: null, steps: [{ type: "paused" }] });
});
it("rejects traversal and corrupt or incomplete canonical records without replacing the original", () => {
  const { root, room, journal, message } = fixture(); journal.appendMessage(message, null);
  expect(() => journal.file("../other")).toThrow();
  appendFileSync(journal.file(room), '{"version":1');
  const original = readFileSync(journal.file(room));
  expect(() => new TeamChatJournal(root).message(room, message.id)).toThrow("incomplete");
  expect(readFileSync(journal.file(room))).toEqual(original);
});
it("imports an old SQL group body before clearing it and recovers the JSONL source on repeated startup", () => {
  const { root, room, message } = fixture(); const file = path.join(root, "db.sqlite");
  new AgentDatabase(file).close();
  const old = new DatabaseSync(file);
  old.prepare("INSERT INTO team_chat_messages VALUES (?, ?, ?, ?)").run(message.id, room, 1, JSON.stringify(message)); old.close();
  new AgentDatabase(file).close();
  const sql = new DatabaseSync(file);
  expect(String(sql.prepare("SELECT payload_json FROM team_chat_messages").get()?.payload_json)).not.toContain(message.content); sql.close();
  new AgentDatabase(file).close();
  expect(new TeamChatJournal(path.join(root, "team-chats")).message(room, message.id)?.content).toBe(message.content);
});
it("leaves old SQL text untouched when the journal cannot be written", () => {
  const { root, room, message } = fixture(); const file = path.join(root, "db.sqlite"); new AgentDatabase(file).close();
  const old = new DatabaseSync(file); old.prepare("INSERT INTO team_chat_messages VALUES (?, ?, ?, ?)").run(message.id, room, 1, JSON.stringify(message)); old.close();
  mkdirSync(path.join(root, "team-chats")); writeFileSync(path.join(root, "team-chats", room), "blocked");
  expect(() => new AgentDatabase(file)).toThrow();
  const unchanged = new DatabaseSync(file);
  expect(String(unchanged.prepare("SELECT payload_json FROM team_chat_messages").get()?.payload_json)).toContain(message.content); unchanged.close();
});
it("backs up a legacy database before migration and does not overwrite that backup or back up new metadata-only stores", async () => {
  const { root, room, message } = fixture(); const file = path.join(root, "db.sqlite"); new AgentDatabase(file).close();
  await backupLegacyTeamChatDatabase(file); expect(existsSync(`${file}.before-team-chat-jsonl.bak`)).toBe(false);
  const old = new DatabaseSync(file); old.prepare("INSERT INTO team_chat_messages VALUES (?, ?, ?, ?)").run(message.id, room, 1, JSON.stringify(message)); old.close();
  await backupLegacyTeamChatDatabase(file); const original = readFileSync(`${file}.before-team-chat-jsonl.bak`);
  const backup = new DatabaseSync(`${file}.before-team-chat-jsonl.bak`);
  expect(String(backup.prepare("SELECT payload_json FROM team_chat_messages").get()?.payload_json)).toContain(message.content); backup.close();
  new AgentDatabase(file).close(); await backupLegacyTeamChatDatabase(file);
  expect(readFileSync(`${file}.before-team-chat-jsonl.bak`)).toEqual(original);
});
