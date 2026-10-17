import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, statSync } from "node:fs";
import path from "node:path";
import { rename, rm } from "node:fs/promises";
import { backup, DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { teamChatMessageSchema, type TeamChatMessage } from "@agent/protocol";

const eventSchema = z.discriminatedUnion("type", [
  z.object({ version: z.literal(1), type: z.literal("message"), message: teamChatMessageSchema,
    request: z.object({ id: z.string(), fingerprint: z.string() }).nullable() }).strict(),
  z.object({ version: z.literal(1), type: z.literal("coordination"), messageId: z.string().uuid(),
    coordinator: teamChatMessageSchema.shape.coordinator, recipientConversationIds: z.array(z.string().uuid()),
    deliveries: z.array(teamChatMessageSchema.shape.deliveries.element) }).strict(),
]);
type Event = z.infer<typeof eventSchema>;
type Position = { offset: number; length: number };
type Index = { size: number; lastSequence: number; positions: Map<string, Position[]>; requests: Map<string, { fingerprint: string; messageId: string }> };

/** One-time online SQLite backup; never block the UI copying a live database/WAL. */
export async function backupLegacyTeamChatDatabase(databasePath: string): Promise<void> {
  if (!existsSync(databasePath)) return;
  const target = `${databasePath}.before-team-chat-jsonl.bak`;
  const database = new DatabaseSync(databasePath, { readOnly: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    if (database.prepare("SELECT 1 FROM sqlite_master WHERE name = 'team_chat_messages'").get() === undefined) return;
    if (database.prepare("SELECT 1 FROM team_chat_messages WHERE json_extract(payload_json, '$.content') <> '' LIMIT 1").get() === undefined) return;
    if (existsSync(target)) return;
    await backup(database, temporary);
    await rename(temporary, target);
  } finally { database.close(); await rm(temporary, { force: true }); }
}

/** Canonical group history. Cached indexes contain byte positions, never message bodies. */
export class TeamChatJournal {
  private readonly indexes = new Map<string, Index>();
  private readonly memory = new Map<string, string>();
  public constructor(private readonly root: string | null) {}

  public file(roomId: string): string {
    return path.join(this.root ?? "", z.string().uuid().parse(roomId), "conversation.jsonl");
  }
  public rooms(): string[] {
    if (this.root === null) return [...this.memory.keys()];
    if (!existsSync(this.root)) return [];
    return readdirSync(this.root, { withFileTypes: true }).flatMap(entry =>
      entry.isDirectory() && z.string().uuid().safeParse(entry.name).success && existsSync(this.file(entry.name)) ? [entry.name] : []);
  }
  public ids(roomId: string): string[] { return [...this.index(roomId).positions.keys()]; }
  public lastSequence(roomId: string): number { return this.index(roomId).lastSequence; }
  public request(roomId: string, id: string) { return this.index(roomId).requests.get(id); }
  public requests(roomId: string) { return [...this.index(roomId).requests.entries()]; }
  public message(roomId: string, id: string): TeamChatMessage | null {
    return this.messages(roomId, [id])[0] ?? null;
  }
  public messages(roomId: string, ids: readonly string[]): TeamChatMessage[] {
    const index = this.index(roomId); if (ids.length === 0 || index.size === 0) return [];
    const result: TeamChatMessage[] = [];
    const fd = this.root === null ? null : openSync(this.file(roomId), "r");
    try {
      for (const id of ids) {
        const positions = index.positions.get(id); if (positions === undefined) continue;
        let message: TeamChatMessage | null = null;
        for (const position of positions) {
          const bytes = Buffer.alloc(position.length);
          if (fd === null) Buffer.from(this.memory.get(roomId) ?? "").copy(bytes, 0, position.offset, position.offset + position.length);
          else if (readSync(fd, bytes, 0, bytes.length, position.offset) !== bytes.length) throw new Error("Group journal changed during read.");
          const event = eventSchema.parse(JSON.parse(bytes.toString("utf8")));
          if (event.type === "message" ? event.message.id !== id || event.message.teamInstanceId !== roomId : event.messageId !== id) throw new Error("Group journal source identity changed.");
          if (event.type === "message") message = event.message;
          else if (message !== null) message = teamChatMessageSchema.parse(Object.assign({}, message, { coordinator: event.coordinator,
            recipientConversationIds: event.recipientConversationIds, deliveries: event.deliveries }));
        }
        if (message !== null) result.push(message);
      }
    } finally { if (fd !== null) closeSync(fd); }
    return result;
  }
  public appendMessage(message: TeamChatMessage, request: { id: string; fingerprint: string } | null): void {
    const existing = this.message(message.teamInstanceId, message.id);
    if (existing !== null) {
      if (existing.content !== message.content) throw new Error("Group journal message conflicts with stored history.");
      return;
    }
    this.append(message.teamInstanceId, { version: 1, type: "message", message, request });
  }
  public coordinate(message: TeamChatMessage): void {
    this.append(message.teamInstanceId, { version: 1, type: "coordination", messageId: message.id,
      coordinator: message.coordinator, recipientConversationIds: message.recipientConversationIds, deliveries: message.deliveries });
  }
  private append(roomId: string, input: Event): void {
    const event = eventSchema.parse(input); const index = this.index(roomId);
    if (event.type === "message" ? index.positions.has(event.message.id) || event.message.sequence <= index.lastSequence
      : !index.positions.has(event.messageId)) throw new Error("Group journal event does not follow its canonical history.");
    const line = JSON.stringify(event); const bytes = Buffer.byteLength(line);
    if (this.root === null) this.memory.set(roomId, (this.memory.get(roomId) ?? "") + line + "\n");
    else { mkdirSync(path.dirname(this.file(roomId)), { recursive: true }); appendFileSync(this.file(roomId), line + "\n", "utf8"); }
    this.add(index, event, { offset: index.size, length: bytes }); index.size += bytes + 1;
  }
  private add(index: Index, event: Event, position: Position): void {
    const id = event.type === "message" ? event.message.id : event.messageId;
    if (event.type === "message") {
      if (index.positions.has(id)) throw new Error("Duplicate group journal message.");
      if (event.message.sequence <= index.lastSequence) throw new Error("Group journal message sequence is not increasing.");
      index.lastSequence = event.message.sequence;
      index.positions.set(id, [position]);
      if (event.request !== null) index.requests.set(event.request.id, { fingerprint: event.request.fingerprint, messageId: id });
    } else {
      const positions = index.positions.get(id);
      if (positions === undefined) throw new Error("Group coordination has no original message.");
      positions.push(position);
    }
  }
  private index(roomId: string): Index {
    const file = this.file(roomId);
    const size = this.root === null ? Buffer.byteLength(this.memory.get(roomId) ?? "") : existsSync(file) ? statSync(file).size : 0;
    const cached = this.indexes.get(roomId); if (cached?.size === size) return cached;
    const index: Index = { size, lastSequence: 0, positions: new Map(), requests: new Map() };
    if (size > 0) {
      const fd = this.root === null ? null : openSync(file, "r");
      let offset = 0; let pending = Buffer.alloc(0);
      try {
        const chunk = Buffer.alloc(64 * 1024); let scanned = 0;
        while (scanned < size) {
          const count = fd === null ? Buffer.from(this.memory.get(roomId) ?? "").copy(chunk, 0, scanned, Math.min(scanned + chunk.length, size))
            : readSync(fd, chunk, 0, Math.min(chunk.length, size - scanned), scanned);
          if (count === 0) throw new Error("Group journal changed during indexing.");
          scanned += count; pending = Buffer.concat([pending, chunk.subarray(0, count)]);
          let newline: number;
          while ((newline = pending.indexOf(10)) >= 0) {
            const event = eventSchema.parse(JSON.parse(pending.subarray(0, newline).toString("utf8")));
            if (event.type === "message" && event.message.teamInstanceId !== roomId) throw new Error("Group journal room identity does not match its directory.");
            this.add(index, event, { offset, length: newline });
            offset += newline + 1; pending = pending.subarray(newline + 1);
          }
        }
        if (pending.length > 0) throw new Error("Group journal has an incomplete record; original file was preserved.");
      } finally { if (fd !== null) closeSync(fd); }
    }
    if (this.indexes.size >= 64) this.indexes.delete(this.indexes.keys().next().value ?? "");
    this.indexes.set(roomId, index); return index;
  }
}
