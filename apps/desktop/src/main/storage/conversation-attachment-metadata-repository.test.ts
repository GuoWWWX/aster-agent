import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { ConversationAttachmentMetadataRepository } from "./conversation-attachment-metadata-repository.js";
import type { StoredConversationAttachment } from "./conversation-storage-contracts.js";

const databases: DatabaseSync[] = [];

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = new DatabaseSync(":memory:");
  databases.push(database);
  database.exec(`
    CREATE TABLE conversations (id TEXT PRIMARY KEY, deletion_pending INTEGER);
    CREATE TABLE conversation_timeline (id TEXT, conversation_id TEXT, kind TEXT);
    CREATE TABLE conversation_attachments (
      id TEXT PRIMARY KEY, conversation_id TEXT, message_id TEXT, pending_message_id TEXT,
      source TEXT, kind TEXT, name TEXT, mime_type TEXT, size_bytes INTEGER,
      project_path TEXT, stored_path TEXT, extracted_text_path TEXT,
      context_tokens INTEGER, truncated INTEGER, created_at TEXT
    );
  `);
  const repository = new ConversationAttachmentMetadataRepository(database);
  const conversationId = randomUUID();
  const otherConversationId = randomUUID();
  database.prepare("INSERT INTO conversations VALUES (?, 0), (?, 0)")
    .run(conversationId, otherConversationId);
  const add = (options: Partial<StoredConversationAttachment> = {}) => {
    const attachment: StoredConversationAttachment = {
      id: randomUUID(), conversationId, createdAt: "2026-10-19T00:00:00.000Z",
      contextTokens: 10, kind: "file", messageId: null, mimeType: "text/plain", name: "note.txt",
      pendingMessageId: null, projectPath: null, sizeBytes: 20, source: "upload",
      storedPath: "C:/managed/note.txt", extractedTextPath: null, truncated: false, ...options,
    };
    const reference = repository.insertConversationAttachment(attachment);
    if (attachment.pendingMessageId !== null) {
      database.prepare("UPDATE conversation_attachments SET pending_message_id = ? WHERE id = ?")
        .run(attachment.pendingMessageId, attachment.id);
    }
    return { attachment, reference };
  };
  return { add, conversationId, database, otherConversationId, repository };
}

describe("ConversationAttachmentMetadataRepository", () => {
  it("separates sent, unbound and queued attachments within their conversation", () => {
    const { add, conversationId, otherConversationId, repository } = fixture();
    const first = add().attachment;
    const second = add().attachment;
    const sent = add({ messageId: randomUUID() }).attachment;
    add({ pendingMessageId: randomUUID() });
    add({ conversationId: otherConversationId });

    expect(repository.listUnbound(conversationId).map(item => item.id)).toEqual([first.id, second.id]);
    expect(repository.listSent(conversationId).map(item => item.id)).toEqual([sent.id]);
    expect(repository.getConversationAttachment(conversationId, first.id)).toEqual(first);
  });

  it("preserves requested ID order and rejects duplicate, missing or cross-conversation references", () => {
    const { add, conversationId, otherConversationId, repository } = fixture();
    const first = add().attachment;
    const second = add().attachment;
    const other = add({ conversationId: otherConversationId }).attachment;
    expect(repository.listConversationAttachmentsByIds(conversationId, [second.id, first.id]))
      .toEqual([second, first]);
    expect(repository.listConversationAttachmentsByIds(conversationId, [])).toEqual([]);
    expect(() => repository.listConversationAttachmentsByIds(conversationId, [first.id, first.id]))
      .toThrow("contains duplicates");
    expect(() => repository.listConversationAttachmentsByIds(conversationId, [other.id]))
      .toThrow("was not found");
    expect(() => repository.getConversationAttachment(conversationId, randomUUID())).toThrow("was not found");
  });

  it("finds cancelled-pending and legacy-unbound cleanup candidates without taking sent or other queued attachments", () => {
    const { add, conversationId, otherConversationId, repository } = fixture();
    const pendingMessageId = randomUUID();
    const cancelled = add({ pendingMessageId }).attachment;
    const legacy = add().attachment;
    const queued = add({ pendingMessageId: randomUUID() }).attachment;
    const sent = add({ messageId: randomUUID() }).attachment;
    const other = add({ conversationId: otherConversationId }).attachment;
    const candidates = repository.listCancelledPendingAttachments(
      conversationId, [cancelled.id, legacy.id, queued.id, sent.id, other.id], pendingMessageId,
    );
    expect(candidates).toHaveLength(2);
    expect(candidates.map(item => item.id)).toEqual(expect.arrayContaining([cancelled.id, legacy.id]));
  });

  it("protects stored and extracted files referenced outside cleanup scope or by a conversation not pending deletion", () => {
    const { add, conversationId, database, otherConversationId, repository } = fixture();
    const shared = "C:/managed/shared.txt";
    const first = add({ storedPath: shared }).attachment;
    const second = add({ conversationId: otherConversationId, extractedTextPath: shared }).attachment;
    database.prepare("UPDATE conversations SET deletion_pending = 1 WHERE id = ?").run(otherConversationId);
    expect(repository.isConversationAttachmentFileReferencedByActiveConversation(shared)).toBe(true);
    expect(repository.isConversationAttachmentFileReferencedOutside(shared, [])).toBe(true);
    expect(repository.isConversationAttachmentFileReferencedOutside(shared, [first.id])).toBe(true);
    expect(repository.isConversationAttachmentFileReferencedOutside(shared, [first.id, second.id])).toBe(false);
    database.prepare("UPDATE conversations SET deletion_pending = 1 WHERE id = ?").run(conversationId);
    expect(repository.isConversationAttachmentFileReferencedByActiveConversation(shared)).toBe(false);
    expect(repository.isConversationAttachmentFileReferencedOutside("missing", [])).toBe(false);
  });

  it("keeps managed paths internal and fails a zero-row storage-location update", () => {
    const { add, conversationId, repository } = fixture();
    const { attachment, reference } = add();
    expect(reference).not.toHaveProperty("storedPath");
    expect(reference).not.toHaveProperty("extractedTextPath");
    repository.updateConversationAttachmentStoragePaths({
      id: attachment.id, storedPath: "C:/new/note.txt", extractedTextPath: "C:/new/extracted.txt",
    });
    expect(repository.listConversationAttachmentStoragePaths()).toEqual([{
      id: attachment.id, storedPath: "C:/new/note.txt", extractedTextPath: "C:/new/extracted.txt",
    }]);
    expect(repository.getConversationAttachment(conversationId, attachment.id).storedPath).toBe("C:/new/note.txt");
    expect(() => repository.updateConversationAttachmentStoragePaths({
      id: randomUUID(), storedPath: "C:/new/missing.txt", extractedTextPath: null,
    })).toThrow("was not found");
  });

  it("removes only unbound drafts and preserves sent or queued references", () => {
    const { add, conversationId, repository } = fixture();
    const draft = add().attachment;
    const sent = add({ messageId: randomUUID() }).attachment;
    const queued = add({ pendingMessageId: randomUUID() }).attachment;
    expect(() => repository.removeDraftConversationAttachment(conversationId, sent.id)).toThrow("sent or queued");
    expect(() => repository.removeDraftConversationAttachment(conversationId, queued.id)).toThrow("sent or queued");
    expect(repository.removeDraftConversationAttachment(conversationId, draft.id)).toEqual(draft);
    expect(() => repository.getConversationAttachment(conversationId, draft.id)).toThrow("was not found");
    expect(repository.getConversationAttachment(conversationId, sent.id)).toEqual(sent);
    expect(repository.getConversationAttachment(conversationId, queued.id)).toEqual(queued);
  });

  it("accepts an image owner only when the existing timeline item is a tool in the same conversation", () => {
    const { conversationId, database, otherConversationId, repository } = fixture();
    const toolId = randomUUID();
    const messageId = randomUUID();
    database.prepare("INSERT INTO conversation_timeline VALUES (?, ?, 'tool'), (?, ?, 'message')")
      .run(toolId, conversationId, messageId, conversationId);
    expect(repository.hasToolImageOwner(conversationId, toolId)).toBe(true);
    expect(repository.hasToolImageOwner(otherConversationId, toolId)).toBe(false);
    expect(repository.hasToolImageOwner(conversationId, messageId)).toBe(false);
    expect(repository.hasToolImageOwner(conversationId, randomUUID())).toBe(false);
  });

  it("joins the caller's transaction without committing attachment rows independently", () => {
    const { add, conversationId, database, repository } = fixture();
    database.exec("BEGIN IMMEDIATE");
    const draft = add().attachment;
    expect(repository.getConversationAttachment(conversationId, draft.id)).toEqual(draft);
    database.exec("ROLLBACK");
    expect(() => repository.getConversationAttachment(conversationId, draft.id)).toThrow("was not found");
  });
});
